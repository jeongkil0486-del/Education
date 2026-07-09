/**
 * TAS Education Lab — Cloud Functions
 *
 * 모든 callable은 firebase-functions/v2/https의 onCall을 사용합니다.
 * cors: true 로 Vercel Preview 등 외부 origin을 허용합니다.
 * region: "us-central1" 은 Firebase JS SDK 기본값과 일치시킵니다.
 */

"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger                 = require("firebase-functions/logger");
const admin                  = require("firebase-admin");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl }               = require("@aws-sdk/s3-request-presigner");

admin.initializeApp();

const auth = admin.auth();
const db   = admin.database();

const EMAIL_DOMAIN = "tas.local";

/** 모든 함수 공통 옵션 */
const OPTS = { region: "us-central1", cors: true };

/* ─────────────────────────────────────────────────────────────
   R2 상수
───────────────────────────────────────────────────────────── */
/** 허용 MIME */
const ALLOWED_MATERIAL_MIME  = ["application/pdf"];
/** presigned URL 유효 시간 (초) */
const PRESIGN_EXPIRES_SEC    = 300;          // 5분
/** 최대 파일 크기 50 MB */
const MAX_MATERIAL_FILE_SIZE = 50 * 1024 * 1024;

/* ─────────────────────────────────────────────────────────────
   R2 헬퍼
   환경변수는 모두 process.env 에서 읽습니다.
   코드에 AccessKey를 하드코딩하지 않습니다.

   필요한 환경변수 (functions/.env 또는 Firebase Secrets):
     R2_ACCESS_KEY_ID
     R2_SECRET_ACCESS_KEY
     R2_ENDPOINT          https://<ACCOUNT_ID>.r2.cloudflarestorage.com
     R2_BUCKET            tas-education-materials
     R2_PUBLIC_BASE_URL   https://pub-<hash>.r2.dev  (또는 커스텀 도메인)
───────────────────────────────────────────────────────────── */
function buildR2Client() {
  const endpoint  = process.env.R2_ENDPOINT;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKey || !secretKey) {
    logger.error("[R2] env missing", {
      hasEndpoint:  !!endpoint,
      hasAccessKey: !!accessKey,
      hasSecretKey: !!secretKey,
    });
    throw new HttpsError(
      "failed-precondition",
      "R2 환경변수가 설정되지 않았습니다. (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)"
    );
  }

  return new S3Client({
    region:      "auto",
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
}

/** R2 오브젝트 키: materials/{materialId}/{safeFileName} */
function buildR2Key(materialId, fileName) {
  const safe = String(fileName || "upload.pdf")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 200);
  return `materials/${materialId}/${safe}`;
}

/* ─────────────────────────────────────────────────────────────
   createMaterialUploadUrl
   ─ hq_admin 전용
   ─ R2 presigned PUT URL 발급
   ─ Firebase DB에 materialId 사전 생성
   ─ 반환: { uploadUrl, publicUrl, materialId, key }
───────────────────────────────────────────────────────────── */
exports.createMaterialUploadUrl = onCall(OPTS, async (request) => {
  // 1) 인증
  ensureAuthenticated(request);

  // 2) 권한: hq_admin 만
  const roleSnap = await db.ref(`users/${request.auth.uid}/role`).get();
  if (!roleSnap.exists() || roleSnap.val() !== "hq_admin") {
    throw new HttpsError("permission-denied", "교육관리자(hq_admin)만 파일을 업로드할 수 있습니다.");
  }

  // 3) 입력 검증
  const fileName = normalizeText(request.data?.fileName);
  const fileType = normalizeText(request.data?.fileType);
  const fileSize = Number(request.data?.fileSize ?? 0);

  if (!fileName) {
    throw new HttpsError("invalid-argument", "fileName이 필요합니다.");
  }
  if (!ALLOWED_MATERIAL_MIME.includes(fileType)) {
    throw new HttpsError("invalid-argument", "PDF 파일만 업로드할 수 있습니다. (application/pdf)");
  }
  if (fileSize <= 0 || fileSize > MAX_MATERIAL_FILE_SIZE) {
    throw new HttpsError(
      "invalid-argument",
      `파일 크기가 올바르지 않습니다. 1 B 이상 50 MB 이하여야 합니다. (전달값: ${fileSize} B)`
    );
  }

  // 4) R2 환경변수 추가 확인
  const bucket        = process.env.R2_BUCKET;
  const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!bucket || !publicBaseUrl) {
    logger.error("[R2] R2_BUCKET or R2_PUBLIC_BASE_URL missing");
    throw new HttpsError("failed-precondition", "R2_BUCKET 또는 R2_PUBLIC_BASE_URL 환경변수가 없습니다.");
  }

  // 5) Firebase RTDB에 materialId 사전 생성 (메타는 업로드 후 클라이언트가 저장)
  const newRef     = db.ref("materials").push();
  const materialId = newRef.key;

  // 6) R2 오브젝트 키 및 presigned URL 생성
  const key     = buildR2Key(materialId, fileName);
  const r2      = buildR2Client();
  const command = new PutObjectCommand({
    Bucket:        bucket,
    Key:           key,
    ContentType:   fileType,
    ContentLength: fileSize,
    Metadata: {
      "material-id":   materialId,
      "uploaded-by":   request.auth.uid,
      "original-name": encodeURIComponent(fileName),
    },
  });

  let uploadUrl;
  try {
    uploadUrl = await getSignedUrl(r2, command, { expiresIn: PRESIGN_EXPIRES_SEC });
  } catch (err) {
    logger.error("[R2] presign failed", {
      materialId, key,
      code: err?.code, message: err?.message,
    });
    throw new HttpsError("internal", `presigned URL 생성 실패: ${err?.message || "알 수 없는 오류"}`);
  }

  const publicUrl = `${publicBaseUrl}/${key}`;

  logger.info("[R2] presign ok", {
    uid: request.auth.uid, materialId, key, fileSize, fileType,
  });

  return { uploadUrl, publicUrl, materialId, key };
});

/* ─────────────────────────────────────────────────────────────
   createEmployeeAccounts  (기존 유지)
───────────────────────────────────────────────────────────── */
exports.createEmployeeAccounts = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const employees = Array.isArray(request.data?.employees) ? request.data.employees : [];
  if (!employees.length)       throw new HttpsError("invalid-argument", "업로드할 직원 데이터가 없습니다.");
  if (employees.length > 1000) throw new HttpsError("invalid-argument", "한 번에 최대 1000명까지 업로드할 수 있습니다.");

  const seenEmpNos  = new Set();
  const branchCache = new Map();
  const created = [], skipped = [], failed = [];

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

/* ─────────────────────────────────────────────────────────────
   createManagedAccount  (기존 유지)
───────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
   deleteEmployeeAccount  (기존 유지)
───────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
   deleteManagedAccount  (기존 유지)
───────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
   공통 헬퍼
───────────────────────────────────────────────────────────── */
async function deleteAuthAndProfile(uid) {
  try { await auth.deleteUser(uid); }
  catch (err) { if (err?.code !== "auth/user-not-found") throw err; }
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
  try { return await auth.getUserByEmail(email); }
  catch (err) {
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
