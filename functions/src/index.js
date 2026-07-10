"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

admin.initializeApp();

const auth = admin.auth();
const db = admin.database();

const EMAIL_DOMAIN = "tas.local";
const OPTS = { region: "us-central1", cors: true };

const R2_ACCESS_KEY_ID = defineSecret("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = defineSecret("R2_SECRET_ACCESS_KEY");
const R2_ENDPOINT = defineSecret("R2_ENDPOINT");
const R2_BUCKET = defineSecret("R2_BUCKET");
const R2_PUBLIC_BASE_URL = defineSecret("R2_PUBLIC_BASE_URL");

const R2_OPTS = {
  ...OPTS,
  secrets: [
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_ENDPOINT,
    R2_BUCKET,
    R2_PUBLIC_BASE_URL,
  ],
};

const ALLOWED_MATERIAL_MIME = ["application/pdf"];
const ALLOWED_MATERIAL_EXT = ".pdf";
const PRESIGN_EXPIRES_SEC = 300;
const MAX_MATERIAL_FILE_SIZE = 50 * 1024 * 1024;
const PDF_ONLY_MESSAGE = "교육자료는 PDF 파일만 업로드할 수 있습니다.";
const PDF_SIZE_MESSAGE = "PDF 파일은 최대 50MB까지 업로드할 수 있습니다.";

function getR2Config() {
  return {
    endpoint: String(R2_ENDPOINT.value() || "").trim(),
    accessKey: String(R2_ACCESS_KEY_ID.value() || "").trim(),
    secretKey: String(R2_SECRET_ACCESS_KEY.value() || "").trim(),
    bucket: String(R2_BUCKET.value() || "").trim(),
    publicBaseUrl: String(R2_PUBLIC_BASE_URL.value() || "").trim().replace(/\/$/, ""),
  };
}

function buildR2Client(r2Config = getR2Config()) {
  const { endpoint, accessKey, secretKey } = r2Config;

  if (!endpoint || !accessKey || !secretKey) {
    logger.error("[R2] env missing", {
      hasEndpoint: !!endpoint,
      hasAccessKey: !!accessKey,
      hasSecretKey: !!secretKey,
    });
    throw new HttpsError(
      "failed-precondition",
      "R2 환경변수가 설정되지 않았습니다. (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)"
    );
  }

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  });
}

function buildR2Key(materialId, fileName) {
  const safe = String(fileName || "upload.pdf")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 200);

  return `materials/${materialId}/${safe}`;
}

function hasPdfExtension(fileName) {
  return String(fileName || "").trim().toLowerCase().endsWith(ALLOWED_MATERIAL_EXT);
}

exports.createMaterialUploadUrl = onCall(R2_OPTS, async (request) => {
  ensureAuthenticated(request);

  const roleSnap = await db.ref(`users/${request.auth.uid}/role`).get();
  if (!roleSnap.exists() || roleSnap.val() !== "hq_admin") {
    throw new HttpsError("permission-denied", "교육관리자(hq_admin)만 파일을 업로드할 수 있습니다.");
  }

  const fileName = normalizeText(request.data?.fileName);
  const fileType = normalizeText(request.data?.fileType).toLowerCase();
  const fileSize = Number(request.data?.fileSize ?? 0);

  if (!fileName) {
    throw new HttpsError("invalid-argument", "fileName이 필요합니다.");
  }
  if (!hasPdfExtension(fileName) || !ALLOWED_MATERIAL_MIME.includes(fileType)) {
    throw new HttpsError("invalid-argument", PDF_ONLY_MESSAGE);
  }
  if (fileSize <= 0 || fileSize > MAX_MATERIAL_FILE_SIZE) {
    throw new HttpsError("invalid-argument", PDF_SIZE_MESSAGE);
  }

  const { bucket, publicBaseUrl } = getR2Config();
  if (!bucket) {
    logger.error("[R2] R2_BUCKET missing");
    throw new HttpsError("failed-precondition", "R2_BUCKET 환경변수가 없습니다.");
  }

  const newRef = db.ref("materials").push();
  const materialId = newRef.key;
  const key = buildR2Key(materialId, fileName);
  const r2 = buildR2Client();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: fileType,
    ContentLength: fileSize,
    Metadata: {
      "material-id": materialId,
      "uploaded-by": request.auth.uid,
      "original-name": encodeURIComponent(fileName),
    },
  });

  let uploadUrl;
  try {
    uploadUrl = await getSignedUrl(r2, command, { expiresIn: PRESIGN_EXPIRES_SEC });
  } catch (err) {
    logger.error("[R2] presign failed", {
      materialId,
      key,
      code: err?.code,
      message: err?.message,
    });
    throw new HttpsError("internal", `presigned URL 생성 실패: ${err?.message || "알 수 없는 오류"}`);
  }

  const publicUrl = publicBaseUrl ? `${publicBaseUrl}/${key}` : "";

  logger.info("[R2] presign ok", {
    uid: request.auth.uid,
    materialId,
    key,
    fileSize,
    fileType,
  });

  return { uploadUrl, publicUrl, materialId, key };
});

exports.getMaterialDownloadUrl = onCall(R2_OPTS, async (request) => {
  ensureAuthenticated(request);

  const materialId = normalizeText(request.data?.materialId);
  if (!materialId) {
    throw new HttpsError("invalid-argument", "materialId가 필요합니다.");
  }

  const profileSnap = await db.ref(`users/${request.auth.uid}`).get();
  if (!profileSnap.exists()) {
    throw new HttpsError("permission-denied", "사용자 프로필을 찾을 수 없습니다.");
  }

  const profile = profileSnap.val();
  if (!["super_admin", "hq_admin", "instructor"].includes(profile.role)) {
    throw new HttpsError("permission-denied", "교육자료 다운로드 권한이 없습니다.");
  }

  const materialSnap = await db.ref(`materials/${materialId}`).get();
  if (!materialSnap.exists()) {
    throw new HttpsError("not-found", "교육자료를 찾을 수 없습니다.");
  }

  const material = materialSnap.val();
  if (
    profile.role !== "super_admin" &&
    profile.companyId &&
    material.companyId &&
    profile.companyId !== material.companyId
  ) {
    throw new HttpsError("permission-denied", "다른 회사의 교육자료에는 접근할 수 없습니다.");
  }

  if (!material.r2Key) {
    if (material.url) {
      return { downloadUrl: material.url };
    }
    throw new HttpsError("failed-precondition", "다운로드 가능한 파일 경로가 없습니다.");
  }

  const { bucket } = getR2Config();
  if (!bucket) {
    throw new HttpsError("failed-precondition", "R2_BUCKET 환경변수가 없습니다.");
  }

  const r2 = buildR2Client();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: material.r2Key,
    ResponseContentType: material.fileType || "application/pdf",
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(material.fileName || "download.pdf")}`,
  });

  try {
    const downloadUrl = await getSignedUrl(r2, command, { expiresIn: PRESIGN_EXPIRES_SEC });
    return { downloadUrl };
  } catch (err) {
    logger.error("[R2] download presign failed", {
      materialId,
      key: material.r2Key,
      code: err?.code,
      message: err?.message,
    });
    throw new HttpsError("internal", `download presigned URL 생성 실패: ${err?.message || "알 수 없는 오류"}`);
  }
});

exports.createEmployeeAccounts = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const employees = Array.isArray(request.data?.employees) ? request.data.employees : [];
  if (!employees.length) {
    throw new HttpsError("invalid-argument", "업로드할 직원 데이터가 없습니다.");
  }
  if (employees.length > 1000) {
    throw new HttpsError("invalid-argument", "한 번에 최대 1000명까지 업로드할 수 있습니다.");
  }

  const seenEmpNos = new Set();
  const branchCache = new Map();
  const created = [];
  const skipped = [];
  const failed = [];

  for (const item of employees) {
    const empNo = normalizeEmpNo(item.empNo);
    const name = normalizeText(item.name);
    const branchId = normalizeText(item.branchId);
    const position = normalizeText(item.position);

    if (!empNo || !name || !branchId) {
      failed.push({ empNo, name, message: "필수값이 누락되었습니다." });
      continue;
    }
    if (seenEmpNos.has(empNo)) {
      failed.push({ empNo, name, message: "업로드 파일 내 사번이 중복되었습니다." });
      continue;
    }
    seenEmpNos.add(empNo);

    try {
      const branch = await getBranch(branchId, branchCache);
      if (!branch) {
        failed.push({ empNo, name, message: "존재하지 않는 지점입니다." });
        continue;
      }

      const email = `${empNo}@${EMAIL_DOMAIN}`;
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

        await auth.updateUser(existingUser.uid, {
          password: empNo,
          displayName: name,
          disabled: false,
        });

        await saveEmployeeProfile(existingUser.uid, { empNo, name, email, position, branch });
        const migration = await migrateEmployeeHistoryByEmpNo(empNo, existingUser.uid);

        created.push({
          empNo,
          name,
          uid: existingUser.uid,
          migratedHistoryCount: migration.migratedCompletionCount,
          message: migration.migratedCompletionCount > 0
            ? `기존 계정을 활성화하고 교육이력 ${migration.migratedCompletionCount}건을 다시 연결했습니다.`
            : "기존 계정을 활성화하고 DB 프로필을 다시 연결했습니다.",
        });
        continue;
      }

      const newUser = await auth.createUser({
        email,
        password: empNo,
        displayName: name,
        disabled: false,
      });

      await saveEmployeeProfile(newUser.uid, { empNo, name, email, position, branch });
      created.push({ empNo, name, uid: newUser.uid, message: "생성 완료" });
    } catch (err) {
      logger.error("createEmployeeAccounts row error", { empNo, message: err?.message, code: err?.code });
      failed.push({ empNo, name, message: simplifyError(err) });
    }
  }

  return {
    createdCount: created.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    created,
    skipped,
    failed,
  };
});

exports.createManagedAccount = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const role = normalizeText(request.data?.role);
  const name = normalizeText(request.data?.name);
  const empNo = normalizeEmpNo(request.data?.empNo).toLowerCase();
  const password = String(request.data?.password ?? "").trim();
  const assignedBranches = normalizeAssignedBranches(request.data?.assignedBranches);

  if (!["hq_admin", "instructor"].includes(role)) {
    throw new HttpsError("invalid-argument", "생성할 계정 권한이 올바르지 않습니다.");
  }
  if (!name || !empNo || !password) {
    throw new HttpsError("invalid-argument", "이름, 사번, 임시 비밀번호를 모두 입력해 주세요.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "임시 비밀번호는 6자 이상이어야 합니다.");
  }
  if (role === "instructor" && assignedBranches.length === 0) {
    throw new HttpsError("invalid-argument", "강사 계정은 담당 지점을 1개 이상 선택해야 합니다.");
  }
  if (role === "instructor") {
    const branchSnaps = await Promise.all(assignedBranches.map((branchId) => db.ref(`branches/${branchId}`).get()));
    if (branchSnaps.some((snap) => !snap.exists())) {
      throw new HttpsError("invalid-argument", "존재하지 않는 담당 지점이 포함되어 있습니다.");
    }
  }

  const email = `${empNo}@${EMAIL_DOMAIN}`;

  try {
    const existingUser = await getAuthUserByEmail(email);
    if (existingUser) {
      const snap = await db.ref(`users/${existingUser.uid}`).get();
      if (snap.exists()) {
        const profile = snap.val();
        if (profile.role === role) {
          throw new HttpsError("already-exists", "이미 등록된 계정입니다.");
        }
        throw new HttpsError("failed-precondition", "동일 사번의 계정이 다른 권한으로 이미 존재합니다.");
      }

      await auth.updateUser(existingUser.uid, {
        password,
        displayName: name,
        disabled: false,
      });
      await saveManagedProfile(existingUser.uid, {
        empNo,
        name,
        email,
        role,
        assignedBranches: role === "instructor" ? assignedBranches : [],
      }, { overwrite: true });

      return {
        uid: existingUser.uid,
        empNo,
        role,
        email,
        message: "인증 계정과 사용자 프로필을 연결했습니다.",
      };
    }

    const newUser = await auth.createUser({
      email,
      password,
      displayName: name,
      disabled: false,
    });
    await saveManagedProfile(newUser.uid, {
      empNo,
      name,
      email,
      role,
      assignedBranches: role === "instructor" ? assignedBranches : [],
    }, { overwrite: true });

    return {
      uid: newUser.uid,
      empNo,
      role,
      email,
      message: "생성 완료",
    };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("createManagedAccount error", { role, empNo, message: err?.message, code: err?.code });
    throw new HttpsError("internal", simplifyError(err));
  }
});

exports.updateManagedAccount = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const uid = normalizeText(request.data?.uid);
  const role = normalizeText(request.data?.role);
  const name = normalizeText(request.data?.name);
  const assignedBranches = normalizeAssignedBranches(request.data?.assignedBranches);

  if (!uid) {
    throw new HttpsError("invalid-argument", "怨꾩젙 UID媛 ?꾩슂?⑸땲??");
  }
  if (!["hq_admin", "instructor"].includes(role)) {
    throw new HttpsError("invalid-argument", "蹂寃쏀븷 沅뚰븳???щ컮瑜댁? ?딆뒿?덈떎.");
  }
  if (!name) {
    throw new HttpsError("invalid-argument", "?대쫫???낅젰??二쇱꽭??");
  }
  if (role === "instructor" && assignedBranches.length === 0) {
    throw new HttpsError("invalid-argument", "媛뺤궗 怨꾩젙? ?대떦 吏?먯쓣 1媛??댁긽 ?좏깮?댁빞 ?⑸땲??");
  }
  if (role === "instructor") {
    const branchSnaps = await Promise.all(assignedBranches.map((branchId) => db.ref(`branches/${branchId}`).get()));
    if (branchSnaps.some((snap) => !snap.exists())) {
      throw new HttpsError("invalid-argument", "議댁옱?섏? ?딅뒗 ?대떦 吏?먯씠 ?ы븿?섏뼱 ?덉뒿?덈떎.");
    }
  }

  const snap = await db.ref(`users/${uid}`).get();
  if (!snap.exists()) {
    throw new HttpsError("not-found", "怨꾩젙 ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎.");
  }

  const profile = snap.val();
  if (!["hq_admin", "instructor"].includes(profile.role)) {
    throw new HttpsError("failed-precondition", "愿由??ㅼ젙 怨꾩젙留?섏젙?????덉뒿?덈떎.");
  }

  try {
    await auth.updateUser(uid, {
      displayName: name,
      disabled: false,
    });
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
  }

  await saveManagedProfile(uid, {
    empNo: profile.empNo ?? "",
    name,
    email: profile.email ?? "",
    role,
    assignedBranches: role === "instructor" ? assignedBranches : [],
    position: profile.position ?? "",
    active: profile.active !== false,
  }, { overwrite: false });

  return {
    uid,
    role,
    assignedBranches: role === "instructor" ? assignedBranches : [],
    message: "?섏젙 ?꾨즺",
  };
});

exports.deleteEmployeeAccount = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const uid = normalizeText(request.data?.uid);
  if (!uid) {
    throw new HttpsError("invalid-argument", "삭제할 직원 UID가 필요합니다.");
  }

  const snap = await db.ref(`users/${uid}`).get();
  if (!snap.exists()) {
    throw new HttpsError("not-found", "직원 정보를 찾을 수 없습니다.");
  }

  const profile = snap.val();
  if (profile.role !== "employee") {
    throw new HttpsError("failed-precondition", "직원 계정만 삭제할 수 있습니다.");
  }

  await deactivateEmployeeAndRemoveProfile(uid);
  return {
    uid,
    empNo: profile.empNo ?? "",
    message: "계정 비활성화 및 직원 목록 제거 완료",
  };
});

exports.deleteManagedAccount = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const uid = normalizeText(request.data?.uid);
  if (!uid) {
    throw new HttpsError("invalid-argument", "삭제할 계정 UID가 필요합니다.");
  }

  const snap = await db.ref(`users/${uid}`).get();
  if (!snap.exists()) {
    throw new HttpsError("not-found", "계정 정보를 찾을 수 없습니다.");
  }

  const profile = snap.val();
  if (!["employee", "hq_admin", "instructor"].includes(profile.role)) {
    throw new HttpsError("failed-precondition", "삭제할 수 없는 계정입니다.");
  }

  if (profile.role === "employee") {
    await deactivateEmployeeAndRemoveProfile(uid);
  } else {
    await deleteAuthAndProfile(uid);
  }

  return {
    uid,
    empNo: profile.empNo ?? "",
    role: profile.role ?? "",
    message: profile.role === "employee"
      ? "계정 비활성화 및 직원 목록 제거 완료"
      : "삭제 완료",
  };
});


exports.deleteEmployeeHistory = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureHQAdmin(request.auth.uid);

  const uid = normalizeText(request.data?.uid);
  const source = normalizeText(request.data?.source);
  const sessionId = normalizeText(request.data?.sessionId);
  const trainingId = normalizeText(request.data?.trainingId);

  if (!uid || !["session", "legacy"].includes(source)) {
    throw new HttpsError("invalid-argument", "삭제할 교육이력 정보가 올바르지 않습니다.");
  }

  const updates = {};
  if (source === "session") {
    if (!sessionId) throw new HttpsError("invalid-argument", "회차 ID가 필요합니다.");
    updates[`sessionCompletions/${sessionId}/${uid}`] = null;
    updates[`userSessionCompletions/${uid}/${sessionId}`] = null;
  } else {
    if (!trainingId) throw new HttpsError("invalid-argument", "교육 ID가 필요합니다.");
    updates[`trainingCompletions/${trainingId}/${uid}`] = null;
    updates[`userCompletions/${uid}/${trainingId}`] = null;
  }

  await db.ref().update(updates);
  return { uid, source, sessionId, trainingId, message: "교육이력 삭제 완료" };
});

async function deactivateEmployeeAndRemoveProfile(uid) {
  try {
    await auth.updateUser(uid, { disabled: true });
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
  }

  await db.ref(`users/${uid}`).remove();
}

async function migrateEmployeeHistoryByEmpNo(empNo, targetUid) {
  const normalizedEmpNo = normalizeEmpNo(empNo);
  if (!normalizedEmpNo || !targetUid) {
    return { migratedAssignmentCount: 0, migratedCompletionCount: 0 };
  }

  const [
    sessionAssignmentsSnap,
    sessionCompletionsSnap,
    trainingAssignmentsSnap,
    trainingCompletionsSnap,
  ] = await Promise.all([
    db.ref("sessionAssignments").get(),
    db.ref("sessionCompletions").get(),
    db.ref("trainingAssignments").get(),
    db.ref("trainingCompletions").get(),
  ]);

  const sessionAssignments = sessionAssignmentsSnap.val() ?? {};
  const sessionCompletions = sessionCompletionsSnap.val() ?? {};
  const trainingAssignments = trainingAssignmentsSnap.val() ?? {};
  const trainingCompletions = trainingCompletionsSnap.val() ?? {};

  const updates = {};
  let migratedAssignmentCount = 0;
  let migratedCompletionCount = 0;
  const migratedAt = Date.now();

  for (const [sessionId, assignmentsByUid] of Object.entries(sessionAssignments)) {
    for (const [oldUid, assignment] of Object.entries(assignmentsByUid ?? {})) {
      if (oldUid === targetUid) continue;
      if (normalizeEmpNo(assignment?.empNo) !== normalizedEmpNo) continue;

      const migratedAssignment = {
        ...assignment,
        uid: targetUid,
        migratedFromUid: oldUid,
        migratedAt,
      };

      updates[`sessionAssignments/${sessionId}/${targetUid}`] = migratedAssignment;
      updates[`userSessionAssignments/${targetUid}/${sessionId}`] = migratedAssignment;
      updates[`sessionAssignments/${sessionId}/${oldUid}`] = null;
      updates[`userSessionAssignments/${oldUid}/${sessionId}`] = null;
      migratedAssignmentCount += 1;

      const completion = sessionCompletions?.[sessionId]?.[oldUid];
      if (completion) {
        const migratedCompletion = {
          ...completion,
          uid: targetUid,
          migratedFromUid: oldUid,
          migratedAt,
        };

        updates[`sessionCompletions/${sessionId}/${targetUid}`] = migratedCompletion;
        updates[`userSessionCompletions/${targetUid}/${sessionId}`] = migratedCompletion;
        updates[`sessionCompletions/${sessionId}/${oldUid}`] = null;
        updates[`userSessionCompletions/${oldUid}/${sessionId}`] = null;
        migratedCompletionCount += 1;
      }
    }
  }

  for (const [trainingId, assignmentsByUid] of Object.entries(trainingAssignments)) {
    for (const [oldUid, assignment] of Object.entries(assignmentsByUid ?? {})) {
      if (oldUid === targetUid) continue;
      if (normalizeEmpNo(assignment?.empNo) !== normalizedEmpNo) continue;

      const migratedAssignment = {
        ...assignment,
        uid: targetUid,
        migratedFromUid: oldUid,
        migratedAt,
      };

      updates[`trainingAssignments/${trainingId}/${targetUid}`] = migratedAssignment;
      updates[`userAssignments/${targetUid}/${trainingId}`] = migratedAssignment;
      updates[`trainingAssignments/${trainingId}/${oldUid}`] = null;
      updates[`userAssignments/${oldUid}/${trainingId}`] = null;
      migratedAssignmentCount += 1;

      const completion = trainingCompletions?.[trainingId]?.[oldUid];
      if (completion) {
        const migratedCompletion = {
          ...completion,
          uid: targetUid,
          migratedFromUid: oldUid,
          migratedAt,
        };

        updates[`trainingCompletions/${trainingId}/${targetUid}`] = migratedCompletion;
        updates[`userCompletions/${targetUid}/${trainingId}`] = migratedCompletion;
        updates[`trainingCompletions/${trainingId}/${oldUid}`] = null;
        updates[`userCompletions/${oldUid}/${trainingId}`] = null;
        migratedCompletionCount += 1;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    logger.info("employee history relink completed", {
      empNo: normalizedEmpNo,
      targetUid,
      migratedAssignmentCount,
      migratedCompletionCount,
    });
  }

  return { migratedAssignmentCount, migratedCompletionCount };
}

async function deleteAuthAndProfile(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
  }
  await db.ref(`users/${uid}`).remove();
}

function ensureAuthenticated(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
}

async function ensureSuperAdmin(uid) {
  const snap = await db.ref(`users/${uid}/role`).get();
  if (!snap.exists() || snap.val() !== "super_admin") {
    throw new HttpsError("permission-denied", "슈퍼관리자만 실행할 수 있습니다.");
  }
}

async function ensureHQAdmin(uid) {
  const snap = await db.ref(`users/${uid}/role`).get();
  if (!snap.exists() || snap.val() !== "hq_admin") {
    throw new HttpsError("permission-denied", "본사 교육관리자만 교육이력을 삭제할 수 있습니다.");
  }
}

async function getBranch(branchId, cache) {
  if (cache.has(branchId)) return cache.get(branchId);

  const snap = await db.ref(`branches/${branchId}`).get();
  const branch = snap.exists() ? { id: branchId, ...snap.val() } : null;
  cache.set(branchId, branch);
  return branch;
}

async function saveEmployeeProfile(uid, payload) {
  await db.ref(`users/${uid}`).set({
    empNo: payload.empNo,
    name: payload.name,
    email: payload.email,
    role: "employee",
    position: payload.position,
    branchId: payload.branch.id,
    branchCode: payload.branch.code ?? "",
    branchName: payload.branch.name ?? "",
    companyId: payload.branch.companyId ?? null,
    companyName: payload.branch.companyName ?? "",
    active: true,
    createdAt: admin.database.ServerValue.TIMESTAMP,
  });
}

async function saveManagedProfile(uid, payload, options = {}) {
  const assignedBranches = normalizeAssignedBranches(payload.assignedBranches);
  const primaryBranchId = assignedBranches[0] ?? payload.branchId ?? "";

  let primaryBranch = null;
  if (primaryBranchId) {
    primaryBranch = await getBranch(primaryBranchId, new Map());
  }

  const record = {
    empNo: payload.empNo,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    assignedBranches,
    position: payload.position ?? "",
    branchId: primaryBranch?.id ?? payload.branchId ?? "",
    branchCode: primaryBranch?.code ?? payload.branchCode ?? "",
    branchName: primaryBranch?.name ?? payload.branchName ?? "",
    companyId: primaryBranch?.companyId ?? payload.companyId ?? null,
    companyName: primaryBranch?.companyName ?? payload.companyName ?? "",
    active: payload.active ?? true,
  };

  if (options.overwrite) {
    await db.ref(`users/${uid}`).set({
      ...record,
      createdAt: admin.database.ServerValue.TIMESTAMP,
    });
    return;
  }

  await db.ref(`users/${uid}`).update({
    ...record,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
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

function normalizeAssignedBranches(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function normalizeEmpNo(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function simplifyError(err) {
  if (err?.code === "auth/email-already-exists") return "동일 이메일 계정이 이미 존재합니다.";
  if (err?.code === "auth/invalid-password") return "비밀번호 정책에 맞지 않습니다.";
  return err?.message || "알 수 없는 오류";
}
