/**
 * TAS Education Lab — Cloud Functions
 *
 * 모든 callable은 firebase-functions/v2/https의 onCall을 사용합니다.
 * cors: true 로 Vercel Preview 등 외부 origin을 허용합니다.
 * region: "us-central1" 은 Firebase JS SDK 기본값과 일치시킵니다.
 *
 * 다중 삭제(bulk)는 클라이언트에서 단일 삭제 함수를 반복 호출합니다.
 * → bulkDeleteEmployeeAccounts / bulkDeleteManagedAccounts Function은 없습니다.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin  = require("firebase-admin");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl }               = require("@aws-sdk/s3-request-presigner");

admin.initializeApp();

const auth = admin.auth();
const db   = admin.database();

const EMAIL_DOMAIN = "tas.local";

/** 모든 함수 공통 옵션 */
const OPTS = { region: "us-central1", cors: true };

/* ── R2 설정 ──────────────────────────────────────────────────
   환경변수 설정 방법 (한 번만 실행):

     firebase functions:secrets:set R2_ACCESS_KEY_ID
     firebase functions:secrets:set R2_SECRET_ACCESS_KEY
     firebase functions:secrets:set R2_ENDPOINT
     firebase functions:secrets:set R2_BUCKET
     firebase functions:secrets:set R2_PUBLIC_BASE_URL

   또는 functions/.env 파일에:
     R2_ACCESS_KEY_ID=...
     R2_SECRET_ACCESS_KEY=...
     R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
     R2_BUCKET=education-materials
     R2_PUBLIC_BASE_URL=https://pub-<hash>.r2.dev
                     (또는 https://materials.yourdomain.com 등 커스텀 도메인)
─────────────────────────────────────────────────────────────── */

/** 허용 MIME 타입 */
const ALLOWED_MATERIAL_MIME = ["application/pdf"];
/** presigned URL 유효 시간(초): 5분 */
const PRESIGN_EXPIRES_SECONDS = 300;
/** 최대 파일 크기: 50 MB */
const MAX_MATERIAL_FILE_SIZE = 50 * 1024 * 1024;

/** Cloudflare R2 S3-호환 클라이언트 (런타임 생성) */
function buildR2Client() {
  const endpoint  = process.env.R2_ENDPOINT;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKey || !secretKey) {
    logger.error("R2 env missing", {
      hasEndpoint:  !!endpoint,
      hasAccessKey: !!accessKey,
      hasSecretKey: !!secretKey,
    });
    throw new HttpsError(
      "failed-precondition",
      "R2 환경변수가 설정되지 않았습니다. R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY 를 확인하세요."
    );
  }

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
}

/** R2 오브젝트 키: materials/{materialId}/{safeFileName} */
function buildR2Key(materialId, fileName) {
  const safe = String(fileName ?? "upload.pdf")
    .replace(/[^\w.\-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 200);
  return `materials/${materialId}/${safe}`;
}

// ─────────────────────────────────────────────────────────────
// createMaterialUploadUrl
//   hq_admin이 PDF 업로드 전에 R2 presigned PUT URL을 요청합니다.
//   클라이언트는 반환된 uploadUrl로 PUT 요청해 파일을 R2에 직접 업로드하고,
//   업로드 성공 후 publicUrl을 materials DB에 저장합니다.
//
//   Request:  { fileName: string, fileType: string, fileSize: number }
//   Response: { uploadUrl: string, publicUrl: string, materialId: string, key: string }
// ─────────────────────────────────────────────────────────────
exports.createMaterialUploadUrl = onCall(OPTS, async (request) => {
  // 1) 인증 확인
  ensureAuthenticated(request);

  // 2) 권한 확인: hq_admin만 업로드 가능
  const callerSnap = await db.ref(`users/${request.auth.uid}/role`).get();
  const callerRole = callerSnap.val();
  if (callerRole !== "hq_admin") {
    throw new HttpsError("permission-denied", "교육관리자(hq_admin)만 파일을 업로드할 수 있습니다.");
  }

  // 3) 입력값 검증
  const fileName = normalizeText(request.data?.fileName);
  const fileType = normalizeText(request.data?.fileType);
  const fileSize = Number(request.data?.fileSize ?? 0);

  if (!fileName) throw new HttpsError("invalid-argument", "파일명이 필요합니다.");
  if (!ALLOWED_MATERIAL_MIME.includes(fileType)) {
    throw new HttpsError("invalid-argument", "PDF 파일만 업로드할 수 있습니다.");
  }
  if (fileSize <= 0 || fileSize > MAX_MATERIAL_FILE_SIZE) {
    throw new HttpsError(
      "invalid-argument",
      `파일 크기가 올바르지 않습니다. 1B 이상 50MB 이하여야 합니다. (전달값: ${fileSize})`
    );
  }

  // 4) R2 환경변수 확인
  const bucket       = process.env.R2_BUCKET;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!bucket || !publicBaseUrl) {
    logger.error("R2_BUCKET or R2_PUBLIC_BASE_URL missing");
    throw new HttpsError(
      "failed-precondition",
      "R2_BUCKET 또는 R2_PUBLIC_BASE_URL 환경변수가 설정되지 않았습니다."
    );
  }

  // 5) Firebase RTDB에 materialId 사전 생성 (placeholder)
  const newRef = db.ref("materials").push();
  const materialId = newRef.key;

  // 6) R2 오브젝트 키 및 presigned URL 생성
  const key = buildR2Key(materialId, fileName);
  const r2  = buildR2Client();

  const command = new PutObjectCommand({
    Bucket:        bucket,
    Key:           key,
    ContentType:   fileType,
    ContentLength: fileSize,
    // 업로드자 태그 (R2 메타데이터)
    Metadata: {
      "uploaded-by":  request.auth.uid,
      "material-id":  materialId,
      "original-name": encodeURIComponent(fileName),
    },
  });

  let uploadUrl;
  try {
    uploadUrl = await getSignedUrl(r2, command, { expiresIn: PRESIGN_EXPIRES_SECONDS });
  } catch (err) {
    logger.error("presign failed", { materialId, key, message: err?.message, code: err?.code });
    throw new HttpsError("internal", `presigned URL 생성 실패: ${err?.message ?? "알 수 없는 오류"}`);
  }

  // 7) 공개 다운로드 URL
  const publicUrl = `${publicBaseUrl}/${key}`;

  logger.info("createMaterialUploadUrl", {
    uid: request.auth.uid,
    materialId,
    key,
    fileSize,
    fileType,
  });

  return { uploadUrl, publicUrl, materialId, key };
});

// ─────────────────────────────────────────────────────────────
// 직원 계정 생성 (Excel 업로드)
// ─────────────────────────────────────────────────────────────
exports.createEmployeeAccounts = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const employees = Array.isArray(request.data?.employees) ? request.data.employees : [];
  if (!employees.length)    throw new HttpsError("invalid-argument", "업로드할 직원 데이터가 없습니다.");
  if (employees.length > 1000) throw new HttpsError("invalid-argument", "한 번에 최대 1000명까지 업로드할 수 있습니다.");

  const seenEmpNos  = new Set();
  const branchCache = new Map();
  const created = [];
  const skipped = [];
  const failed  = [];

  for (const item of employees) {
    const empNo    = normalizeEmpNo(item.empNo);
    const name     = normalizeText(item.name);
    const branchId = normalizeText(item.branchId);
    const position = normalizeText(item.position);

    if (!empNo || !name || !branchId) { failed.push({ empNo, name, message: "필수값이 누락되었습니다." }); continue; }
    if (seenEmpNos.has(empNo))        { failed.push({ empNo, name, message: "업로드 파일 내 사번이 중복되었습니다." }); continue; }
    seenEmpNos.add(empNo);

    try {
      const branch = await getBranch(branchId, branchCache);
      if (!branch) { failed.push({ empNo, name, message: "존재하지 않는 지점입니다." }); continue; }

      const email        = `${empNo}@${EMAIL_DOMAIN}`;
      const existingUser = await getAuthUserByEmail(email);

      if (existingUser) {
        const snap = await db.ref(`users/${existingUser.uid}`).get();
        if (snap.exists()) {
          if (snap.val().role !== "employee") {
            failed.push({ empNo, name, message: "동일 이메일 계정이 다른 권한으로 이미 존재합니다." });
          } else {
            skipped.push({ empNo, name, uid: existingUser.uid, message: "이미 등록된 직원입니다." });
          }
          continue;
        }
        await saveEmployeeProfile(existingUser.uid, { empNo, name, email, position, branch });
        created.push({ empNo, name, uid: existingUser.uid, message: "인증 계정과 DB를 연결했습니다." });
        continue;
      }

      const newUser = await auth.createUser({ email, password: empNo, displayName: name, disabled: false });
      await saveEmployeeProfile(newUser.uid, { empNo, name, email, position, branch });
      created.push({ empNo, name, uid: newUser.uid, message: "생성 완료" });
    } catch (err) {
      logger.error("createEmployeeAccounts row error", { empNo, message: err?.message, code: err?.code });
      failed.push({ empNo, name, message: simplifyError(err) });
    }
  }

  return { createdCount: created.length, skippedCount: skipped.length, failedCount: failed.length, created, skipped, failed };
});

// ─────────────────────────────────────────────────────────────
// 관리 계정 생성 (hq_admin / instructor)
// ─────────────────────────────────────────────────────────────
exports.createManagedAccount = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const role     = normalizeText(request.data?.role);
  const name     = normalizeText(request.data?.name);
  const empNo    = normalizeEmpNo(request.data?.empNo).toLowerCase();
  const password = String(request.data?.password ?? "").trim();

  if (!["hq_admin", "instructor"].includes(role)) throw new HttpsError("invalid-argument", "생성할 계정 권한이 올바르지 않습니다.");
  if (!name || !empNo || !password)                throw new HttpsError("invalid-argument", "이름, 사번, 임시 비밀번호를 모두 입력해 주세요.");
  if (password.length < 6)                         throw new HttpsError("invalid-argument", "임시 비밀번호는 6자 이상이어야 합니다.");

  const email = `${empNo}@${EMAIL_DOMAIN}`;

  try {
    const existingUser = await getAuthUserByEmail(email);
    if (existingUser) {
      const snap = await db.ref(`users/${existingUser.uid}`).get();
      if (snap.exists()) {
        const p = snap.val();
        if (p.role === role) throw new HttpsError("already-exists", "이미 등록된 계정입니다.");
        throw new HttpsError("failed-precondition", "동일한 사번의 계정이 다른 권한으로 이미 존재합니다.");
      }
      await auth.updateUser(existingUser.uid, { password, displayName: name, disabled: false });
      await saveManagedProfile(existingUser.uid, { empNo, name, email, role });
      return { uid: existingUser.uid, empNo, role, email, message: "인증 계정과 사용자 프로필을 연결했습니다." };
    }

    const newUser = await auth.createUser({ email, password, displayName: name, disabled: false });
    await saveManagedProfile(newUser.uid, { empNo, name, email, role });
    return { uid: newUser.uid, empNo, role, email, message: "생성 완료" };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("createManagedAccount error", { role, empNo, message: err?.message, code: err?.code });
    throw new HttpsError("internal", simplifyError(err));
  }
});

// ─────────────────────────────────────────────────────────────
// 직원 단일 삭제
// ─────────────────────────────────────────────────────────────
exports.deleteEmployeeAccount = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const uid = normalizeText(request.data?.uid);
  if (!uid) throw new HttpsError("invalid-argument", "삭제할 직원 UID가 필요합니다.");

  const snap = await db.ref(`users/${uid}`).get();
  if (!snap.exists()) throw new HttpsError("not-found", "직원 정보를 찾을 수 없습니다.");

  const profile = snap.val();
  if (profile.role !== "employee") throw new HttpsError("failed-precondition", "직원 계정만 삭제할 수 있습니다.");

  await deleteAuthAndProfile(uid);
  return { uid, empNo: profile.empNo ?? "", message: "삭제 완료" };
});

// ─────────────────────────────────────────────────────────────
// 관리 계정 단일 삭제 (hq_admin / instructor)
// ─────────────────────────────────────────────────────────────
exports.deleteManagedAccount = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const uid = normalizeText(request.data?.uid);
  if (!uid) throw new HttpsError("invalid-argument", "삭제할 계정 UID가 필요합니다.");

  const snap = await db.ref(`users/${uid}`).get();
  if (!snap.exists()) throw new HttpsError("not-found", "계정 정보를 찾을 수 없습니다.");

  const profile = snap.val();
  if (!["employee", "hq_admin", "instructor"].includes(profile.role)) {
    throw new HttpsError("failed-precondition", "삭제할 수 없는 계정입니다.");
  }

  await deleteAuthAndProfile(uid);
  return { uid, empNo: profile.empNo ?? "", role: profile.role ?? "", message: "삭제 완료" };
});

// ─────────────────────────────────────────────────────────────
// 공통 헬퍼
// ─────────────────────────────────────────────────────────────

async function deleteAuthAndProfile(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
  }
  await db.ref(`users/${uid}`).remove();
}

function ensureAuthenticated(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
}

async function ensureSuperAdmin(uid) {
  const snap = await db.ref(`users/${uid}/role`).get();
  if (!snap.exists() || snap.val() !== "super_admin") {
    throw new HttpsError("permission-denied", "슈퍼관리자만 실행할 수 있습니다.");
  }
}

async function getBranch(branchId, cache) {
  if (cache.has(branchId)) return cache.get(branchId);
  const snap   = await db.ref(`branches/${branchId}`).get();
  const branch = snap.exists() ? { id: branchId, ...snap.val() } : null;
  cache.set(branchId, branch);
  return branch;
}

async function saveEmployeeProfile(uid, payload) {
  await db.ref(`users/${uid}`).set({
    empNo:       payload.empNo,
    name:        payload.name,
    email:       payload.email,
    role:        "employee",
    position:    payload.position,
    branchId:    payload.branch.id,
    branchCode:  payload.branch.code        ?? "",
    branchName:  payload.branch.name        ?? "",
    companyId:   payload.branch.companyId   ?? null,
    companyName: payload.branch.companyName ?? "",
    active:      true,
    createdAt:   admin.database.ServerValue.TIMESTAMP,
  });
}

async function saveManagedProfile(uid, payload) {
  await db.ref(`users/${uid}`).set({
    empNo:       payload.empNo,
    name:        payload.name,
    email:       payload.email,
    role:        payload.role,
    position:    payload.position    ?? "",
    branchId:    payload.branchId    ?? "",
    branchCode:  payload.branchCode  ?? "",
    branchName:  payload.branchName  ?? "",
    companyId:   payload.companyId   ?? null,
    companyName: payload.companyName ?? "",
    active:      true,
    createdAt:   admin.database.ServerValue.TIMESTAMP,
  });
}

async function getAuthUserByEmail(email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (err) {
    if (err?.code === "auth/user-not-found") return null;
    throw err;
  }
}

function normalizeEmpNo(value) { return String(value ?? "").trim(); }
function normalizeText(value)  { return String(value ?? "").trim(); }

function simplifyError(err) {
  if (err?.code === "auth/email-already-exists") return "동일 이메일 계정이 이미 존재합니다.";
  if (err?.code === "auth/invalid-password")     return "비밀번호 정책에 맞지 않습니다.";
  return err?.message || "알 수 없는 오류";
}
