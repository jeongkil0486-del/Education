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



exports.upsertManualTrainingHistory = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid);

  const historyId = normalizeText(request.data?.historyId);
  const uid = normalizeText(request.data?.uid);
  if (!uid) throw new HttpsError("invalid-argument", "직원 UID가 필요합니다.");

  const employeeSnap = await db.ref(`users/${uid}`).get();
  if (!employeeSnap.exists() || employeeSnap.val()?.role !== "employee") {
    throw new HttpsError("not-found", "직원 정보를 찾을 수 없습니다.");
  }
  const employee = employeeSnap.val();
  assertSameCompany(actor, employee);

  const normalized = normalizeManualHistory(request.data, employee, request.auth.uid, actor.name ?? "");
  const targetId = historyId || db.ref("manualTrainingHistories").push().key;
  const existingSnap = historyId ? await db.ref(`manualTrainingHistories/${historyId}`).get() : null;
  if (historyId && !existingSnap?.exists()) {
    throw new HttpsError("not-found", "수정할 개인 교육이력을 찾을 수 없습니다.");
  }
  if (existingSnap?.exists() && existingSnap.val()?.uid !== uid) {
    throw new HttpsError("failed-precondition", "직원 정보가 일치하지 않습니다.");
  }

  const now = Date.now();
  const record = {
    ...(existingSnap?.exists() ? existingSnap.val() : {}),
    ...normalized,
    historyId: targetId,
    uid,
    empNo: employee.empNo ?? "",
    employeeName: employee.name ?? "",
    branchId: employee.branchId ?? "",
    branchName: employee.branchName ?? "",
    companyId: employee.companyId ?? actor.companyId ?? null,
    companyName: employee.companyName ?? actor.companyName ?? "",
    source: "manual",
    completionStatus: "completed",
    status: "completed",
    createdAt: existingSnap?.val()?.createdAt ?? now,
    createdBy: existingSnap?.val()?.createdBy ?? request.auth.uid,
    createdByName: existingSnap?.val()?.createdByName ?? actor.name ?? "",
    updatedAt: now,
    updatedBy: request.auth.uid,
    updatedByName: actor.name ?? "",
  };
  record.dedupeKey = buildManualHistoryDedupeKey(record);

  await db.ref().update({
    [`manualTrainingHistories/${targetId}`]: record,
    [`userManualTrainingHistories/${uid}/${targetId}`]: record,
  });

  return { historyId: targetId, uid, message: historyId ? "개인 교육이력 수정 완료" : "개인 교육이력 등록 완료" };
});

exports.bulkImportManualTrainingHistories = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid);
  const rows = Array.isArray(request.data?.rows) ? request.data.rows : [];
  if (!rows.length) throw new HttpsError("invalid-argument", "업로드할 교육이력이 없습니다.");
  if (rows.length > 2000) throw new HttpsError("invalid-argument", "한 번에 최대 2000건까지 업로드할 수 있습니다.");

  const [usersSnap, existingSnap] = await Promise.all([
    db.ref("users").get(),
    db.ref("manualTrainingHistories").get(),
  ]);
  const users = usersSnap.val() ?? {};
  const employeeByEmpNo = new Map();
  Object.entries(users).forEach(([uid, user]) => {
    if (user?.role === "employee") employeeByEmpNo.set(normalizeEmpNo(user.empNo).toLowerCase(), { uid, ...user });
  });
  const existingKeys = new Set(Object.values(existingSnap.val() ?? {}).map((item) => item?.dedupeKey).filter(Boolean));

  const updates = {};
  const succeeded = [];
  const failed = [];
  const skipped = [];
  const batchKeys = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const sourceRow = rows[index] ?? {};
    const empNo = normalizeEmpNo(sourceRow.empNo).toLowerCase();
    const employee = employeeByEmpNo.get(empNo);
    try {
      if (!empNo || !employee) throw new Error("등록된 사번을 찾을 수 없습니다.");
      assertSameCompany(actor, employee);
      const inputName = normalizeText(sourceRow.employeeName || sourceRow.name);
      if (inputName && inputName !== normalizeText(employee.name)) throw new Error("사번과 이름이 일치하지 않습니다.");

      const normalized = normalizeManualHistory(sourceRow, employee, request.auth.uid, actor.name ?? "");
      const historyId = db.ref("manualTrainingHistories").push().key;
      const now = Date.now();
      const record = {
        ...normalized,
        historyId,
        uid: employee.uid,
        empNo: employee.empNo ?? empNo,
        employeeName: employee.name ?? "",
        branchId: employee.branchId ?? "",
        branchName: employee.branchName ?? "",
        companyId: employee.companyId ?? actor.companyId ?? null,
        companyName: employee.companyName ?? actor.companyName ?? "",
        source: "manual",
        completionStatus: "completed",
        status: "completed",
        createdAt: now,
        createdBy: request.auth.uid,
        createdByName: actor.name ?? "",
        updatedAt: now,
        updatedBy: request.auth.uid,
        updatedByName: actor.name ?? "",
      };
      record.dedupeKey = buildManualHistoryDedupeKey(record);
      if (existingKeys.has(record.dedupeKey) || batchKeys.has(record.dedupeKey)) {
        skipped.push({ row: index + 2, empNo, message: "동일 교육이력이 이미 등록되어 있습니다." });
        continue;
      }
      batchKeys.add(record.dedupeKey);
      updates[`manualTrainingHistories/${historyId}`] = record;
      updates[`userManualTrainingHistories/${employee.uid}/${historyId}`] = record;
      succeeded.push({ row: index + 2, empNo, historyId });
    } catch (err) {
      failed.push({ row: index + 2, empNo, message: err?.message || "검증 실패" });
    }
  }

  if (Object.keys(updates).length) await db.ref().update(updates);
  return {
    succeededCount: succeeded.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    succeeded,
    skipped,
    failed,
  };
});

exports.deleteEmployeeHistory = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureHQAdmin(request.auth.uid);

  const uid = normalizeText(request.data?.uid);
  const source = normalizeText(request.data?.source);
  const sessionId = normalizeText(request.data?.sessionId);
  const trainingId = normalizeText(request.data?.trainingId);
  const historyId = normalizeText(request.data?.historyId);

  if (!uid || !["session", "legacy", "manual"].includes(source)) {
    throw new HttpsError("invalid-argument", "삭제할 교육이력 정보가 올바르지 않습니다.");
  }

  const updates = {};
  if (source === "session") {
    if (!sessionId) throw new HttpsError("invalid-argument", "회차 ID가 필요합니다.");
    updates[`sessionCompletions/${sessionId}/${uid}`] = null;
    updates[`userSessionCompletions/${uid}/${sessionId}`] = null;
  } else if (source === "legacy") {
    if (!trainingId) throw new HttpsError("invalid-argument", "교육 ID가 필요합니다.");
    updates[`trainingCompletions/${trainingId}/${uid}`] = null;
    updates[`userCompletions/${uid}/${trainingId}`] = null;
  } else {
    if (!historyId) throw new HttpsError("invalid-argument", "개인 교육이력 ID가 필요합니다.");
    const historySnap = await db.ref(`manualTrainingHistories/${historyId}`).get();
    if (!historySnap.exists() || historySnap.val()?.uid !== uid) {
      throw new HttpsError("not-found", "개인 교육이력을 찾을 수 없습니다.");
    }
    updates[`manualTrainingHistories/${historyId}`] = null;
    updates[`userManualTrainingHistories/${uid}/${historyId}`] = null;
  }

  await db.ref().update(updates);
  return { uid, source, sessionId, trainingId, historyId, message: "교육이력 삭제 완료" };
});


async function ensureHQAdminProfile(uid) {
  const snap = await db.ref(`users/${uid}`).get();
  if (!snap.exists() || snap.val()?.role !== "hq_admin") {
    throw new HttpsError("permission-denied", "본사 교육관리자만 개인 교육이력을 관리할 수 있습니다.");
  }
  return { uid, ...snap.val() };
}

function assertSameCompany(actor, employee) {
  if (actor?.companyId && employee?.companyId && actor.companyId !== employee.companyId) {
    throw new HttpsError("permission-denied", "다른 회사 직원의 교육이력은 관리할 수 없습니다.");
  }
}

function normalizeTrainingTypeValue(value) {
  const raw = normalizeText(value).toLowerCase();
  const map = {
    job: "job", "직무교육": "job", "직무 교육": "job",
    legal: "legal", "법정교육": "legal", "법정 교육": "legal",
    online: "online", "온라인교육": "online", "온라인 교육": "online",
    external: "external", "외부교육": "external", "외부 교육": "external",
    other: "other", "기타": "other",
  };
  return map[raw] || map[normalizeText(value)] || "other";
}

function normalizeDateMillis(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue > 100000000000) return numberValue;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return parsed;
}

function normalizeManualHistory(data, employee, actorUid, actorName) {
  const trainingType = normalizeTrainingTypeValue(data?.trainingType);
  const subjectName = normalizeText(data?.subjectName || data?.trainingSubject || data?.courseSubject);
  const title = normalizeText(data?.title || data?.courseName || subjectName);
  const completedAt = normalizeDateMillis(data?.completedAt || data?.completionDate, "수료일");
  if (!title) throw new Error("교육과정명이 필요합니다.");
  if (!subjectName) throw new Error("교육 세부분류 또는 교육과목이 필요합니다.");
  if (!completedAt) throw new Error("수료일이 필요합니다.");

  const cycleMonths = Math.max(0, Number(data?.cycleMonths ?? data?.retrainingCycleMonths ?? 0) || 0);
  const hours = Math.max(0, Number(data?.hours ?? data?.trainingHours ?? 0) || 0);

  // educationStage: initial | previous_year | current_year (Excel 교육항목 양식 업로드용)
  const educationStage = normalizeText(data?.educationStage);
  // source: manual | manual_excel
  const sourceValue = ["manual_excel"].includes(normalizeText(data?.source)) ? "manual_excel" : "manual";

  return {
    trainingType,
    subjectCode: normalizeText(data?.subjectCode),
    subjectName,
    title,
    courseName: normalizeText(data?.courseName || title),
    instructorName: normalizeText(data?.instructorName),
    hours,
    startDate: normalizeDateMillis(data?.startDate, "교육 시작일"),
    endDate: normalizeDateMillis(data?.endDate, "교육 종료일"),
    completedAt,
    result: normalizeText(data?.result || "PASS").toUpperCase(),
    subType: normalizeText(data?.subType),
    note: normalizeText(data?.note),
    cycleMonths,
    educationStage: educationStage || null,
    source: sourceValue,
    enteredBy: actorUid,
    enteredByName: actorName,
  };
}

function buildManualHistoryDedupeKey(record) {
  return [
    normalizeEmpNo(record.empNo).toLowerCase(),
    normalizeText(record.trainingType).toLowerCase(),
    normalizeText(record.subjectCode || record.subjectName).toLowerCase(),
    normalizeText(record.title).toLowerCase(),
    Number(record.completedAt || 0),
  ].join("|");
}

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

/* ══════════════════════════════════════════════════════════
   직원관리대장 신규 Cloud Functions
══════════════════════════════════════════════════════════ */

/**
 * 직원 기본정보 수정 (HQ_ADMIN 전용)
 * 수정 가능: name, hireDate, position, branchId, managementNote
 * 수정 불가: empNo, role, password, Auth email, companyId
 */
exports.updateEmployeeManagementProfile = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid);

  const uid           = normalizeText(request.data?.uid);
  const name          = normalizeText(request.data?.name);
  const hireDate      = request.data?.hireDate ?? null;
  const position      = normalizeText(request.data?.position ?? "");
  const branchId      = normalizeText(request.data?.branchId ?? "");
  const managementNote = normalizeText(request.data?.managementNote ?? "");

  if (!uid)  throw new HttpsError("invalid-argument", "직원 UID가 필요합니다.");
  if (!name) throw new HttpsError("invalid-argument", "성명을 입력해 주세요.");

  const empSnap = await db.ref(`users/${uid}`).get();
  if (!empSnap.exists() || empSnap.val()?.role !== "employee") {
    throw new HttpsError("not-found", "직원 정보를 찾을 수 없습니다.");
  }
  const emp = empSnap.val();
  assertSameCompany(actor, emp);

  // 선택 지점이 같은 회사 소속인지 확인
  if (branchId) {
    const branchSnap = await db.ref(`branches/${branchId}`).get();
    if (!branchSnap.exists()) throw new HttpsError("invalid-argument", "존재하지 않는 지점입니다.");
    const branch = branchSnap.val();
    if (actor.companyId && branch.companyId && actor.companyId !== branch.companyId) {
      throw new HttpsError("permission-denied", "다른 회사 지점으로 변경할 수 없습니다.");
    }
  }

  // hireDate 정규화: 밀리초 timestamp 또는 null
  let hireDateMs = null;
  if (hireDate !== null && hireDate !== undefined && hireDate !== "") {
    const n = Number(hireDate);
    if (Number.isFinite(n) && n > 0) hireDateMs = n;
    else if (typeof hireDate === "string" && hireDate.trim()) {
      const d = Date.parse(hireDate.trim());
      if (!Number.isNaN(d)) hireDateMs = d;
    }
  }

  const updates = {
    name,
    position,
    managementNote,
    updatedAt: Date.now(),
    updatedBy: request.auth.uid,
  };
  if (hireDateMs !== null) updates.hireDate = hireDateMs;
  if (branchId) {
    const branchSnap = await db.ref(`branches/${branchId}`).get();
    const branch = branchSnap.val() ?? {};
    updates.branchId   = branchId;
    updates.branchCode = branch.code ?? emp.branchCode ?? "";
    updates.branchName = branch.name ?? emp.branchName ?? "";
  }

  // Auth displayName 업데이트
  try { await auth.updateUser(uid, { displayName: name }); } catch (e) { /* 무시 */ }
  await db.ref(`users/${uid}`).update(updates);

  return { uid, message: "직원 정보가 수정되었습니다." };
});

/**
 * 선택 직원의 Excel 업로드 이력 초기화 (HQ_ADMIN 전용)
 * source==="manual_excel" + 해당 교육항목 이력만 삭제
 */
exports.resetSelectedManualTrainingHistories = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid);

  const companyId    = normalizeText(request.data?.companyId ?? "");
  const branchId     = normalizeText(request.data?.branchId  ?? "");
  const itemId       = normalizeText(request.data?.itemId    ?? "");
  const trainingType = normalizeText(request.data?.trainingType ?? "");
  const subjectCode  = normalizeText(request.data?.subjectCode ?? "");
  const subjectName  = normalizeText(request.data?.subjectName ?? "");
  const employeeUids = Array.isArray(request.data?.employeeUids) ? request.data.employeeUids : [];

  if (!employeeUids.length) throw new HttpsError("invalid-argument", "삭제할 직원을 선택해 주세요.");
  if (employeeUids.length > 200) throw new HttpsError("invalid-argument", "한 번에 최대 200명까지 처리할 수 있습니다.");
  if (companyId && actor.companyId && companyId !== actor.companyId) {
    throw new HttpsError("permission-denied", "다른 회사의 이력은 초기화할 수 없습니다.");
  }

  // 직원 UID가 해당 회사 소속인지 확인 + manualTrainingHistories 조회
  const [usersSnap, manualSnap] = await Promise.all([
    db.ref("users").get(),
    db.ref("manualTrainingHistories").get(),
  ]);
  const users  = usersSnap.val()  ?? {};
  const manual = manualSnap.val() ?? {};

  const uidSet = new Set(employeeUids);

  // 대상 이력 필터
  const updates = {};
  let deletedCount = 0;

  for (const [historyId, h] of Object.entries(manual)) {
    if (!h || !uidSet.has(h.uid)) continue;
    if (h.source !== "manual_excel")           continue;
    if (actor.companyId && h.companyId && h.companyId !== actor.companyId) continue;

    // 교육 항목 매칭
    const htType = normalizeText(h.trainingType).toLowerCase();
    const targetType = normalizeText(trainingType).toLowerCase();
    if (htType !== targetType && targetType) continue;

    const matched =
      (itemId      && h.itemId      === itemId)      ||
      (subjectCode && h.subjectCode === subjectCode)  ||
      (subjectName && (h.subjectName === subjectName || h.title === subjectName || h.courseName === subjectName));
    if (!matched && (itemId || subjectCode || subjectName)) continue;

    updates[`manualTrainingHistories/${historyId}`] = null;
    updates[`userManualTrainingHistories/${h.uid}/${historyId}`] = null;
    deletedCount++;
  }

  if (Object.keys(updates).length) await db.ref().update(updates);

  return {
    success: true,
    selectedEmployeeCount: employeeUids.length,
    deletedHistoryCount: deletedCount,
  };
});

/**
 * 교육 항목별 재교육 주기 저장 (HQ_ADMIN 전용)
 * 저장 경로: /educationCycleConfigs/{companyId}/{educationKey}
 */
exports.saveEducationCycleConfig = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid);

  const companyId   = normalizeText(request.data?.companyId   ?? actor.companyId ?? "");
  const itemId      = normalizeText(request.data?.itemId      ?? "");
  const trainingType = normalizeText(request.data?.trainingType ?? "");
  const subjectCode = normalizeText(request.data?.subjectCode ?? "");
  const subjectName = normalizeText(request.data?.subjectName ?? "");
  const cycleMonths = Number(request.data?.cycleMonths ?? 0);

  if (!companyId) throw new HttpsError("invalid-argument", "companyId가 필요합니다.");
  if (actor.companyId && companyId !== actor.companyId) {
    throw new HttpsError("permission-denied", "다른 회사의 설정은 변경할 수 없습니다.");
  }
  if (!Number.isInteger(cycleMonths) || cycleMonths < 0 || cycleMonths > 120) {
    throw new HttpsError("invalid-argument", "재교육 주기는 0~120 사이 정수여야 합니다.");
  }

  // educationKey 생성
  let educationKey;
  if (itemId)       educationKey = `item_${itemId}`;
  else if (subjectCode) educationKey = `${trainingType}_${subjectCode}`;
  else              educationKey = `${trainingType}_${subjectName.replace(/\s+/g, "_")}`;

  const record = {
    companyId,
    itemId:       itemId || null,
    trainingType,
    subjectCode:  subjectCode || null,
    subjectName:  subjectName || null,
    cycleMonths,
    updatedBy:    request.auth.uid,
    updatedAt:    Date.now(),
  };

  await db.ref(`educationCycleConfigs/${companyId}/${educationKey}`).set(record);

  // 해당 trainingItem에도 cycleMonths 반영 (itemId 있을 때)
  if (itemId) {
    const itemSnap = await db.ref(`trainingItems/${itemId}`).get();
    if (itemSnap.exists()) {
      await db.ref(`trainingItems/${itemId}`).update({ cycleMonths, updatedAt: Date.now() });
    }
  }

  return { success: true, educationKey, cycleMonths, message: "재교육 주기가 저장되었습니다." };
});
