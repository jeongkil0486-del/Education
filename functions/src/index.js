"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { classifyTraining, reconcileHistoryRecords } = require("./training-classification");

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
  await reconcileManualHistoryClassifications([uid]);

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
  const existingByKey = new Map();
  for (const [id, item] of Object.entries(existingSnap.val() ?? {})) {
    if (!item) continue;
    const record = { id, ...item };
    if (item.dedupeKey) existingByKey.set(item.dedupeKey, record);
    existingByKey.set(buildManualHistoryDedupeKey(record), record);
  }

  const updates = {};
  const succeeded = [];
  const failed = [];
  const skipped = [];
  const batchKeys = new Set();
  const affectedUids = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const sourceRow = rows[index] ?? {};
    const empNo = normalizeEmpNo(sourceRow.empNo).toLowerCase();
    const employee = employeeByEmpNo.get(empNo);
    try {
      if (!empNo || !employee) throw new Error("등록된 사번을 찾을 수 없습니다.");
      assertSameCompany(actor, employee);
      affectedUids.add(employee.uid);
      const inputName = normalizeText(sourceRow.employeeName || sourceRow.name);
      if (inputName && inputName !== normalizeText(employee.name)) throw new Error("사번과 이름이 일치하지 않습니다.");

      const normalized = normalizeManualHistory(sourceRow, employee, request.auth.uid, actor.name ?? "");
      const historyId = db.ref("manualTrainingHistories").push().key;
      const now = Date.now();

      // Excel의 직원 기본정보는 교육이력이 중복이더라도 갱신한다.
      // 빈 셀은 기존 프로필을 지우지 않으며 권한 관련 필드는 변경하지 않는다.
      const hireDateInput = sourceRow.hireDate ?? sourceRow.joinDate;
      if (hireDateInput !== null && hireDateInput !== undefined && hireDateInput !== "") {
        updates[`users/${employee.uid}/hireDate`] = normalizeProfileDate(hireDateInput);
      }
      const positionInput = normalizeText(sourceRow.position);
      if (positionInput) updates[`users/${employee.uid}/position`] = positionInput;

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
        source: normalizeText(sourceRow.source) || "manual_excel",
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
      const existing = existingByKey.get(record.dedupeKey);
      if (existing) {
        const repaired = {
          ...existing,
          educationStage: existing.educationStage || record.educationStage,
          educationType: existing.educationType || record.educationType,
          source: existing.source || record.source,
          updatedAt: now,
          updatedBy: request.auth.uid,
          updatedByName: actor.name ?? "",
        };
        delete repaired.id;
        updates[`manualTrainingHistories/${existing.id}`] = repaired;
        updates[`userManualTrainingHistories/${employee.uid}/${existing.id}`] = repaired;
        skipped.push({ row: index + 2, empNo, message: "기존 이력의 분류 정보를 확인·보정했습니다." });
        continue;
      }
      if (batchKeys.has(record.dedupeKey)) {
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
  await reconcileManualHistoryClassifications(affectedUids);
  return {
    succeededCount: succeeded.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    succeeded,
    skipped,
    failed,
  };
});

exports.replaceEmployeeManualTrainingHistories = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid);
  const payload = request.data ?? {};
  const uid = normalizeText(payload.uid);
  const trainingType = normalizeTrainingTypeValue(payload.trainingType);
  const subjectCode = normalizeText(payload.subjectCode);
  const subjectName = normalizeText(payload.subjectName);
  const itemId = normalizeText(payload.itemId);
  if (!uid || !trainingType || (!itemId && !subjectCode && !subjectName)) {
    throw new HttpsError("invalid-argument", "직원 및 교육 항목 정보가 필요합니다.");
  }

  const employeeSnap = await db.ref(`users/${uid}`).get();
  if (!employeeSnap.exists() || employeeSnap.val()?.role !== "employee") {
    throw new HttpsError("not-found", "직원 정보를 찾을 수 없습니다.");
  }
  const employee = employeeSnap.val();
  assertSameCompany(actor, employee);

  const normalizeDates = (values, expectedYear, label) => Array.from(new Set(
    (Array.isArray(values) ? values : []).map((value) => {
      const millis = normalizeDateMillis(value, label);
      if (!millis) throw new HttpsError("invalid-argument", `${label} 날짜가 올바르지 않습니다.`);
      if (expectedYear && new Date(millis).getUTCFullYear() !== expectedYear) {
        throw new HttpsError("invalid-argument", `${label}에는 ${expectedYear}년 날짜만 입력할 수 있습니다.`);
      }
      return millis;
    })
  )).sort((a, b) => a - b);
  const currentYear = new Date().getUTCFullYear();
  const stages = [
    ...normalizeDates(payload.initialDates, null, "초기교육").map((completedAt) => ({ completedAt, educationStage: "initial", educationType: "initial" })),
    ...normalizeDates(payload.previousYearDates, currentYear - 1, "전년도").map((completedAt) => ({ completedAt, educationStage: "previous_year", educationType: "recurrent" })),
    ...normalizeDates(payload.currentYearDates, currentYear, "금년도").map((completedAt) => ({ completedAt, educationStage: "current_year", educationType: "recurrent" })),
  ];

  const userHistorySnap = await db.ref(`userManualTrainingHistories/${uid}`).get();
  const currentRecords = userHistorySnap.val() ?? {};
  const matchesIdentity = (record) => {
    if (!record || normalizeTrainingTypeValue(record.trainingType) !== trainingType) return false;
    const recordItemId = normalizeText(record.itemId);
    if (itemId && recordItemId) return recordItemId === itemId;
    if (subjectCode) return normalizeText(record.subjectCode) === subjectCode;
    return normalizeText(record.subjectName || record.title || record.courseName) === subjectName;
  };
  const updates = {};
  let deletedCount = 0;
  for (const [historyId, record] of Object.entries(currentRecords)) {
    const source = normalizeText(record?.source).toLowerCase();
    if (!["manual", "manual_excel"].includes(source) || !matchesIdentity(record)) continue;
    updates[`manualTrainingHistories/${historyId}`] = null;
    updates[`userManualTrainingHistories/${uid}/${historyId}`] = null;
    deletedCount += 1;
  }

  const now = Date.now();
  const cycleMonths = Math.max(0, Number(payload.cycleMonths) || 0);
  for (const stage of stages) {
    const historyId = db.ref("manualTrainingHistories").push().key;
    const record = {
      historyId, uid,
      empNo: employee.empNo ?? "",
      employeeName: employee.name ?? "",
      branchId: employee.branchId ?? "",
      branchName: employee.branchName ?? "",
      companyId: employee.companyId ?? actor.companyId ?? null,
      companyName: employee.companyName ?? actor.companyName ?? "",
      trainingType, subjectCode, subjectName, itemId,
      title: subjectName, courseName: subjectName,
      completedAt: stage.completedAt,
      educationStage: stage.educationStage,
      educationType: stage.educationType,
      source: "manual", cycleMonths,
      result: "PASS", completionStatus: "completed", status: "completed",
      createdAt: now, createdBy: request.auth.uid, createdByName: actor.name ?? "",
      updatedAt: now, updatedBy: request.auth.uid, updatedByName: actor.name ?? "",
    };
    record.dedupeKey = buildManualHistoryDedupeKey(record);
    updates[`manualTrainingHistories/${historyId}`] = record;
    updates[`userManualTrainingHistories/${uid}/${historyId}`] = record;
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  await reconcileManualHistoryClassifications([uid]);
  return { uid, deletedCount, createdCount: stages.length, message: "교육이력을 수정했습니다." };
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

const HISTORY_MOVE_TARGETS = {
  job_initial: { trainingType: "job", subType: "initial", courseName: "직무초기교육", canonicalCourseKey: "job_initial" },
  job_recurring: { trainingType: "job", subType: "recurrent", courseName: "직무보수교육", canonicalCourseKey: "job_recurrent" },
  legal: { trainingType: "legal", subType: "" },
  online: { trainingType: "online", subType: "" },
  other: { trainingType: "other", subType: "" },
};

function historyMoveCourseKey(trainingType, courseName) {
  const nameKey = normalizeText(courseName)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${trainingType}_${nameKey || "moved"}`;
}

exports.moveEmployeeHistoryCourse = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid);
  const uid = normalizeText(request.data?.uid);
  const sourceSection = normalizeText(request.data?.sourceSection);
  const targetSection = normalizeText(request.data?.targetSection);
  const requestedCourseName = normalizeText(request.data?.courseName);
  const records = Array.isArray(request.data?.records) ? request.data.records : [];
  const target = HISTORY_MOVE_TARGETS[targetSection];

  if (!uid || !target || !records.length ||
      !["job_initial", "job_recurring", "legal", "online", "external", "other"].includes(sourceSection) ||
      sourceSection === targetSection) {
    throw new HttpsError("invalid-argument", "직원, 대상 섹션 및 이동할 이력이 필요합니다.");
  }
  if (records.length > 500) {
    throw new HttpsError("invalid-argument", "한 번에 최대 500건까지 이동할 수 있습니다.");
  }

  const employeeSnap = await db.ref(`users/${uid}`).get();
  if (!employeeSnap.exists() || employeeSnap.val()?.role !== "employee") {
    throw new HttpsError("not-found", "직원 정보를 찾을 수 없습니다.");
  }
  assertSameCompany(actor, employeeSnap.val());

  const uniqueRecords = [];
  const seen = new Set();
  for (const raw of records) {
    const source = normalizeText(raw?.source).toLowerCase();
    const id = source === "manual"
      ? normalizeText(raw?.historyId)
      : source === "session"
        ? normalizeText(raw?.sessionId)
        : source === "legacy"
          ? normalizeText(raw?.trainingId)
          : "";
    if (!id || !["manual", "session", "legacy"].includes(source)) {
      throw new HttpsError("invalid-argument", "이동할 이력 식별자가 올바르지 않습니다.");
    }
    const identity = `${source}:${id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    uniqueRecords.push({ source, id });
  }

  const loaded = await Promise.all(uniqueRecords.map(async ({ source, id }) => {
    const paths = source === "manual"
      ? [`manualTrainingHistories/${id}`, `userManualTrainingHistories/${uid}/${id}`]
      : source === "session"
        ? [`sessionCompletions/${id}/${uid}`, `userSessionCompletions/${uid}/${id}`]
        : [`trainingCompletions/${id}/${uid}`, `userCompletions/${uid}/${id}`];
    const [primarySnap, mirrorSnap] = await Promise.all(paths.map((path) => db.ref(path).get()));
    const record = primarySnap.exists() ? primarySnap.val() : mirrorSnap.exists() ? mirrorSnap.val() : null;
    if (!record) throw new HttpsError("not-found", `이동할 ${source} 이력을 찾을 수 없습니다.`);
    if (record.uid && normalizeText(record.uid) !== uid) {
      throw new HttpsError("permission-denied", "다른 직원의 이력은 이동할 수 없습니다.");
    }
    return { source, id, paths, record };
  }));

  const updates = {};
  const sourceCounts = { manual: 0, session: 0, legacy: 0 };
  const now = Date.now();
  for (const entry of loaded) {
    const originalCourseName = requestedCourseName || normalizeText(
      entry.record.courseName || entry.record.title || entry.record.trainingTitle || entry.record.subjectName
    );
    const courseName = target.courseName || originalCourseName;
    const canonicalCourseKey = target.canonicalCourseKey || historyMoveCourseKey(target.trainingType, courseName);
    const patch = {
      trainingType: target.trainingType,
      subType: target.subType,
      educationStage: target.subType,
      initialOrRecurrent: target.subType,
      sectionKey: targetSection,
      courseName,
      title: courseName,
      canonicalCourseName: courseName,
      canonicalCourseKey,
      classificationOverride: true,
      classificationOverrideAt: now,
      classificationOverrideBy: request.auth.uid,
      updatedAt: now,
      updatedBy: request.auth.uid,
      updatedByName: actor.name ?? "",
    };
    const updatedRecord = { ...entry.record, ...patch };
    if (entry.source === "manual") updatedRecord.dedupeKey = buildManualHistoryDedupeKey(updatedRecord);
    for (const path of entry.paths) updates[path] = updatedRecord;
    sourceCounts[entry.source] += 1;
  }

  await db.ref().update(updates);
  return {
    uid,
    sourceSection,
    targetSection,
    updatedCount: loaded.length,
    firebasePathCount: Object.keys(updates).length,
    sourceCounts,
    message: `${loaded.length}건의 교육이력을 이동했습니다.`,
  };
});


exports.updateEmployeeManagementProfile = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid);

  const uid = normalizeText(request.data?.uid || request.data?.employeeUid || request.data?.targetUid);
  if (!uid) {
    throw new HttpsError("invalid-argument", "직원 UID가 필요합니다.");
  }

  const employeeSnap = await db.ref(`users/${uid}`).get();
  if (!employeeSnap.exists()) {
    throw new HttpsError("not-found", "직원 정보를 찾을 수 없습니다.");
  }

  const employee = { uid, ...employeeSnap.val() };
  if (employee.role !== "employee") {
    throw new HttpsError("failed-precondition", "직원 계정만 처리할 수 있습니다.");
  }
  assertSameCompany(actor, employee);

  const source = request.data?.profile && typeof request.data.profile === "object"
    ? request.data.profile
    : request.data?.fields && typeof request.data.fields === "object"
      ? request.data.fields
      : request.data ?? {};

  const updates = buildEmployeeManagementUpdates(source);
  if (!Object.keys(updates).length) {
    throw new HttpsError("invalid-argument", "업데이트할 관리 프로필 필드가 없습니다.");
  }

  updates.updatedAt = admin.database.ServerValue.TIMESTAMP;
  updates.updatedBy = request.auth.uid;
  updates.updatedByName = actor.name ?? "";

  await db.ref(`users/${uid}`).update(updates);

  return {
    uid,
    updatedFields: Object.keys(updates).filter((key) => !["updatedAt", "updatedBy", "updatedByName"].includes(key)),
    message: "직원 관리정보가 저장되었습니다.",
  };
});

exports.resetSelectedManualTrainingHistories = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid);

  const historyIds = normalizeStringArray(request.data?.historyIds ?? request.data?.selectedHistoryIds);
  const singleHistoryId = normalizeText(request.data?.historyId);
  const uid = normalizeText(request.data?.uid || request.data?.employeeUid);
  const uids = normalizeStringArray(request.data?.uids ?? request.data?.selectedUids);
  const trainingType = normalizeTrainingTypeValue(request.data?.trainingType);
  const subjectCode = normalizeText(request.data?.subjectCode);
  const subjectName = normalizeText(request.data?.subjectName);
  const title = normalizeText(request.data?.title || request.data?.courseName);
  const ALLOWED_RESET_SOURCES = new Set(["manual", "manual_excel", "history_excel"]);
  const RESET_SCOPE_SOURCES = {
    manual: ["manual"],
    excel: ["manual_excel", "history_excel"],
    all: ["manual", "manual_excel", "history_excel"],
  };
  const scope = normalizeText(request.data?.scope).toLowerCase();
  const requestedSourceValues = normalizeStringArray(request.data?.sources)
    .concat(normalizeText(request.data?.source || request.data?.historySource))
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean);
  const requestedSources = Array.from(new Set(
    (requestedSourceValues.length ? requestedSourceValues : (RESET_SCOPE_SOURCES[scope] ?? []))
  ));
  if (requestedSources.some((source) => !ALLOWED_RESET_SOURCES.has(source))) {
    throw new HttpsError("invalid-argument", "허용되지 않은 개인이력 source가 포함되어 있습니다.");
  }
  const allowAllForUser = Boolean(request.data?.resetAllForUser || request.data?.resetAll || request.data?.all);

  const targetHistoryIds = Array.from(new Set([singleHistoryId, ...historyIds].filter(Boolean)));
  const targetUids = Array.from(new Set([uid, ...uids].filter(Boolean)));

  if (!targetHistoryIds.length && !targetUids.length) {
    throw new HttpsError("invalid-argument", "초기화할 개인 이력 또는 직원을 선택해야 합니다.");
  }

  const updates = {};
  const deletedHistoryIds = [];
  const deletedByUid = {};
  const deletedSourceById = {};

  // 두 미러 경로가 과거 오류/부분 저장으로 서로 어긋나도 초기화가 누락되지 않게
  // source와 uid를 양쪽 레코드에서 복구한다.
  const inferResetSource = (record) => {
    const explicit = normalizeText(record?.source).toLowerCase();
    if (ALLOWED_RESET_SOURCES.has(explicit)) return explicit;
    if (record?.importTraceId || record?.sourceSheetName || record?.sourceRowNumber != null) return "history_excel";
    return explicit;
  };

  const shouldDeleteRecord = (record) => {
    if (!record) return false;
    const recordSource = inferResetSource(record);
    if (!ALLOWED_RESET_SOURCES.has(recordSource)) return false;
    if (requestedSources.length && !requestedSources.includes(recordSource)) return false;
    if (trainingType && normalizeTrainingTypeValue(record.trainingType) !== trainingType) return false;
    if (subjectCode && normalizeText(record.subjectCode) !== subjectCode) return false;
    if (subjectName && normalizeText(record.subjectName) !== subjectName) return false;
    if (title && normalizeText(record.title || record.courseName) !== title) return false;
    return true;
  };

  if (targetHistoryIds.length) {
    const historySnaps = await Promise.all(
      targetHistoryIds.map((id) => db.ref(`manualTrainingHistories/${id}`).get())
    );

    for (let index = 0; index < targetHistoryIds.length; index += 1) {
      const historyId = targetHistoryIds[index];
      const snap = historySnaps[index];
      if (!snap.exists()) continue;

      const record = snap.val();
      const employeeSnap = await db.ref(`users/${record.uid}`).get();
      if (employeeSnap.exists()) {
        assertSameCompany(actor, { uid: record.uid, ...employeeSnap.val() });
      } else if (actor.companyId && record.companyId && actor.companyId !== record.companyId) {
        throw new HttpsError("permission-denied", "다른 회사 이력은 초기화할 수 없습니다.");
      }

      if (!shouldDeleteRecord(record)) continue;

      updates[`manualTrainingHistories/${historyId}`] = null;
      updates[`userManualTrainingHistories/${record.uid}/${historyId}`] = null;
      deletedHistoryIds.push(historyId);
      deletedSourceById[historyId] = normalizeText(record.source).toLowerCase();
      deletedByUid[record.uid] = (deletedByUid[record.uid] ?? 0) + 1;
    }
  }

  if (targetUids.length) {
    const employeeSnaps = await Promise.all(targetUids.map((targetUid) => db.ref(`users/${targetUid}`).get()));
    const userHistorySnaps = await Promise.all(targetUids.map((targetUid) => db.ref(`userManualTrainingHistories/${targetUid}`).get()));
    const rootHistorySnap = await db.ref("manualTrainingHistories").get();
    const rootRecords = rootHistorySnap.val() ?? {};

    for (let index = 0; index < targetUids.length; index += 1) {
      const targetUid = targetUids[index];
      const employeeSnap = employeeSnaps[index];
      if (!employeeSnap.exists()) continue;

      const employee = { uid: targetUid, ...employeeSnap.val() };
      assertSameCompany(actor, employee);

      const records = { ...(userHistorySnaps[index].val() ?? {}) };
      // user 미러에 없는 루트 레코드도 uid 기준으로 함께 검사한다.
      for (const [historyId, record] of Object.entries(rootRecords)) {
        if (normalizeText(record?.uid || record?.employeeUid || record?.userUid) === targetUid) {
          records[historyId] = { ...(records[historyId] ?? {}), ...record };
        }
      }
      const hasFilter = Boolean(targetHistoryIds.length || trainingType || subjectCode || subjectName || title || requestedSources.length);
      if (!hasFilter && !allowAllForUser) {
        throw new HttpsError("invalid-argument", "선택 초기화 기능은 교육 항목 또는 이력 선택이 필요합니다.");
      }

      for (const [historyId, record] of Object.entries(records)) {
        if (targetHistoryIds.length && !targetHistoryIds.includes(historyId)) continue;
        if (!shouldDeleteRecord(record)) continue;

        updates[`manualTrainingHistories/${historyId}`] = null;
        updates[`userManualTrainingHistories/${targetUid}/${historyId}`] = null;
        deletedHistoryIds.push(historyId);
        deletedSourceById[historyId] = inferResetSource(record);
        deletedByUid[targetUid] = (deletedByUid[targetUid] ?? 0) + 1;
      }
    }
  }

  const uniqueDeletedHistoryIds = Array.from(new Set(deletedHistoryIds));
  if (Object.keys(updates).length) {
    await db.ref().update(updates);
  }

  const deletedSourceCounts = { manual: 0, manual_excel: 0, history_excel: 0 };
  for (const historyId of uniqueDeletedHistoryIds) {
    const source = deletedSourceById[historyId];
    if (source in deletedSourceCounts) deletedSourceCounts[source] += 1;
  }

  const firstUid = targetUids[0] || "";
  const firstEmployee = firstUid ? (await db.ref(`users/${firstUid}`).get()).val() : null;
  const countUidRecords = (value, uidValue) => {
    if (!value || typeof value !== "object") return 0;
    let count = normalizeText(value.uid || value.employeeUid || value.userUid) === uidValue ? 1 : 0;
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") count += countUidRecords(child, uidValue);
    }
    return count;
  };
  let preservedCompletionCount = 0;
  let beforeCount = 0;
  let afterCount = 0;
  if (firstUid) {
    const [beforeRoot, beforeUser] = await Promise.all([
      db.ref("manualTrainingHistories").get(),
      db.ref(`userManualTrainingHistories/${firstUid}`).get(),
    ]);
    const rootForUid = Object.values(beforeRoot.val() ?? {}).filter((record) =>
      normalizeText(record?.uid || record?.employeeUid || record?.userUid) === firstUid && shouldDeleteRecord(record)
    ).length;
    const userForUid = Object.values(beforeUser.val() ?? {}).filter(shouldDeleteRecord).length;
    // 삭제 후 남은 대상 건수. beforeCount는 실제 삭제 건수 + 잔존 건수로 복원한다.
    afterCount = Math.max(rootForUid, userForUid);
    beforeCount = uniqueDeletedHistoryIds.length + afterCount;
  }
  if (firstUid) {
    const completionSnaps = await Promise.all([
      db.ref("sessionCompletions").get(),
      db.ref(`userSessionCompletions/${firstUid}`).get(),
      db.ref("trainingCompletions").get(),
      db.ref(`userCompletions/${firstUid}`).get(),
    ]);
    preservedCompletionCount = countUidRecords(completionSnaps[0].val(), firstUid)
      + Object.keys(completionSnaps[1].val() ?? {}).length
      + countUidRecords(completionSnaps[2].val(), firstUid)
      + Object.keys(completionSnaps[3].val() ?? {}).length;
  }
  return {
    employeeUid: firstUid,
    employeeName: firstEmployee?.name ?? "",
    scope: scope || (requestedSources.length === 3 ? "all" : "custom"),
    requestedSources,
    beforeCount,
    deletedCount: uniqueDeletedHistoryIds.length,
    deletedManualCount: deletedSourceCounts.manual,
    deletedManualExcelCount: deletedSourceCounts.manual_excel,
    deletedHistoryExcelCount: deletedSourceCounts.history_excel,
    preservedCompletionCount,
    afterCount,
    deletedPathsCount: Object.keys(updates).length,
    deletedPaths: Object.keys(updates),
    deletedHistoryIds: uniqueDeletedHistoryIds,
    deletedByUid,
    message: uniqueDeletedHistoryIds.length
      ? `${uniqueDeletedHistoryIds.length}건의 개인 교육이력을 초기화했습니다.`
      : "초기화할 개인 교육이력이 없습니다.",
  };
});

exports.saveEducationCycleConfig = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid);

  const payload = request.data && typeof request.data === "object" ? request.data : {};
  const itemId = normalizeText(payload.itemId);
  const branchId = normalizeText(payload.branchId);
  const companyResolution = await resolveEducationCycleCompanyId({
    payloadCompanyId: normalizeText(payload.companyId),
    actor,
    itemId,
    branchId,
  });
  const companyId = companyResolution.companyId;
  const trainingType = normalizeTrainingTypeValue(payload.trainingType);
  const subjectCode = normalizeText(payload.subjectCode);
  const subjectName = normalizeText(payload.subjectName);

  if (!companyId) {
    logger.warn("[saveEducationCycleConfig] company resolution failed", {
      actorUid: request.auth.uid,
      actorRole: actor.role ?? "",
      payloadCompanyId: normalizeText(payload.companyId),
      branchId,
      itemId,
      resolution: companyResolution,
    });
    throw new HttpsError(
      "failed-precondition",
      "companyId를 결정할 수 없습니다.",
      companyResolution
    );
  }
  if (!subjectCode && !subjectName) {
    throw new HttpsError("invalid-argument", "subjectCode 또는 subjectName이 필요합니다.");
  }

  const cycleInfo = normalizeCycleMonths(payload.cycleMonths ?? payload.value ?? payload.months);
  const configKey = buildEducationCycleConfigKey(trainingType, subjectCode, subjectName);
  const targetPath = `educationCycleConfigs/${companyId}/${configKey}`;

  if (cycleInfo.unset) {
    await db.ref(targetPath).remove();
    return {
      companyId,
      trainingType,
      subjectCode,
      subjectName,
      cycleMonths: null,
      unset: true,
      message: "교육 주기 설정을 해제했습니다.",
    };
  }

  await db.ref(targetPath).set({
    companyId,
    scope: "company",
    itemId,
    trainingType,
    subjectCode,
    subjectName,
    cycleMonths: cycleInfo.value,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
    updatedBy: request.auth.uid,
    updatedByName: actor.name ?? "",
  });

  logger.info("[saveEducationCycleConfig] saved", {
    actorUid: request.auth.uid,
    companyId,
    companyResolutionSource: companyResolution.source,
    scope: "company",
    itemId,
    configKey,
    cycleMonths: cycleInfo.value,
    targetPath,
  });

  return {
    companyId,
    companyResolutionSource: companyResolution.source,
    branchId,
    itemId,
    configKey,
    trainingType,
    subjectCode,
    subjectName,
    cycleMonths: cycleInfo.value,
    unset: false,
    message: "교육 주기 설정이 저장되었습니다.",
  };
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
  if (!raw) return "";   // 빈 값은 "" 반환 — 필터 없음으로 처리
  const map = {
    job: "job", "직무": "job", "직무교육": "job", "직무 교육": "job",
    initial: "job", recurrent: "job", recurring: "job", refresher: "job",
    legal: "legal", "법정교육": "legal", "법정 교육": "legal",
    online: "online", "온라인교육": "online", "온라인 교육": "online",
    external: "external", "외부교육": "external", "외부 교육": "external",
    other: "other", "기타": "other",
  };
  return map[raw] || map[normalizeText(value)] || "other";
}

function normalizeHistoryStage(...values) {
  for (const value of values) {
    const normalized = normalizeText(value)
      .replace(/\([^)]*\)/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (["초기", "초기교육", "입문", "입문교육", "initial"].includes(normalized)) return "initial";
    if ([
      "보수", "보수교육", "정기", "정기교육", "갱신", "갱신교육", "재교육",
      "recurrent", "recurring", "refresher", "recurrenttraining",
    ].includes(normalized)) return "recurrent";
  }
  const context = values.map((value) => normalizeText(value).toLowerCase()).join("|");
  if (/초기|입문|initial/.test(context)) return "initial";
  if (/보수|정기|갱신|재교육|recurr|refresher/.test(context)) return "recurrent";
  return "";
}

function normalizeHistoryImportType(row) {
  const rowContext = [row?.courseName, row?.subjectName]
    .map((value) => normalizeText(value).toLowerCase())
    .join("|");
  if (/직무/.test(rowContext)) return "job";
  if (/법정/.test(rowContext)) return "legal";
  const explicit = normalizeTrainingTypeValue(row?.trainingType);
  if (explicit && explicit !== "other") return explicit;
  const context = `${rowContext}|${normalizeText(row?.sourceSheetName).toLowerCase()}`;
  if (/법정/.test(context)) return "legal";
  if (/직무|보수|정기|갱신|재교육|초기|입문/.test(context)) return "job";
  return explicit || "other";
}

function normalizeDateMillis(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue > 100000000000) return numberValue;
  // YYYYMMDD 형식 지원 (20241207 → ms)
  if (Number.isFinite(numberValue) && numberValue >= 19700101 && numberValue <= 21001231) {
    const s = String(Math.round(numberValue));
    if (/^\d{8}$/.test(s)) {
      const d = new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`);
      if (!isNaN(d.getTime())) return d.getTime();
    }
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    // throw 대신 null 반환 (importHistoryExcelData에서 무효행 처리)
    return null;
  }
  return parsed;
}

function normalizeManualHistory(data, employee, actorUid, actorName) {
  const subjectName = normalizeText(data?.subjectName || data?.trainingSubject || data?.courseSubject);
  const rawCourseName = normalizeText(data?.title || data?.courseName || subjectName);
  const classification = classifyTraining({
    trainingType: data?.trainingType,
    courseName: rawCourseName,
    subjectName,
    subType: data?.subType,
    educationStage: data?.educationStage,
    educationType: data?.educationType,
    initialOrRecurrent: data?.initialOrRecurrent,
    trainingPhase: data?.trainingPhase,
  });
  const trainingType = classification.trainingType || normalizeTrainingTypeValue(data?.trainingType);
  const title = classification.canonicalCourseName || rawCourseName;
  const completedAt = normalizeDateMillis(data?.completedAt || data?.completionDate, "수료일");
  if (!title) throw new Error("교육과정명이 필요합니다.");
  if (!subjectName) throw new Error("교육 세부분류 또는 교육과목이 필요합니다.");
  if (!completedAt) throw new Error("수료일이 필요합니다.");

  const cycleMonths = Math.max(0, Number(data?.cycleMonths ?? data?.retrainingCycleMonths ?? 0) || 0);
  const hours = Math.max(0, Number(data?.hours ?? data?.trainingHours ?? 0) || 0);
  return {
    trainingType,
    canonicalCourseName: classification.canonicalCourseName,
    canonicalCourseKey: classification.canonicalCourseKey,
    sectionKey: classification.sectionKey,
    stageSource: classification.stageSource,
    itemId: normalizeText(data?.itemId),
    subjectCode: normalizeText(data?.subjectCode),
    subjectName,
    title,
    courseName: classification.canonicalCourseName || normalizeText(data?.courseName || title),
    instructorName: normalizeText(data?.instructorName),
    hours,
    startDate: normalizeDateMillis(data?.startDate, "교육 시작일"),
    endDate: normalizeDateMillis(data?.endDate, "교육 종료일"),
    completedAt,
    result: normalizeText(data?.result || "PASS").toUpperCase(),
    subType: classification.subType || normalizeText(data?.subType),
    educationStage: classification.subType || normalizeText(data?.educationStage),
    educationType: normalizeText(data?.educationType),
    source: normalizeText(data?.source) || "manual",
    initialRecurrent: normalizeText(data?.initialRecurrent),
    trainingPhase: normalizeText(data?.trainingPhase),
    note: normalizeText(data?.note),
    cycleMonths,
    enteredBy: actorUid,
    enteredByName: actorName,
  };
}

async function reconcileManualHistoryClassifications(uids) {
  const updates = {};
  for (const uid of new Set([...uids].filter(Boolean))) {
    const snap = await db.ref(`userManualTrainingHistories/${uid}`).get();
    const current = snap.val() ?? {};
    const reconciled = reconcileHistoryRecords(Object.entries(current).map(([historyId, record]) => ({
      ...record,
      historyId: record.historyId ?? historyId,
      uid,
    })));
    for (const record of reconciled) {
      const historyId = record.historyId;
      const previous = current[historyId] ?? {};
      const next = { ...previous, ...record };
      const changed = [
        "trainingType", "courseName", "title", "canonicalCourseName", "canonicalCourseKey",
        "subType", "educationStage", "sectionKey", "stageSource",
      ].some((field) => previous[field] !== next[field]);
      if (!changed) continue;
      next.updatedAt = Date.now();
      updates[`manualTrainingHistories/${historyId}`] = next;
      updates[`userManualTrainingHistories/${uid}/${historyId}`] = next;
    }
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
}

function buildManualHistoryDedupeKey(record) {
  const classification = classifyTraining(record);
  return [
    normalizeEmpNo(record.empNo).toLowerCase(),
    classification.trainingType || normalizeText(record.trainingType).toLowerCase(),
    normalizeText(record.subjectCode || record.subjectName).toLowerCase(),
    classification.canonicalCourseKey || normalizeText(record.title).toLowerCase(),
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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeText(item)).filter(Boolean)));
}

function normalizeProfileDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 100000000000) {
    return numeric;
  }

  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new HttpsError("invalid-argument", "날짜 형식이 올바르지 않습니다.");
  }
  return parsed;
}

function buildEmployeeManagementUpdates(source) {
  const updates = {};
  const textFields = [
    "position",
    "jobTitle",
    "note",
    "birthDate",
    "entryType",
    "internalLicense",
    "externalLicense",
    "departmentName",
    "departmentId",
    "rank",
  ];

  textFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      updates[field] = normalizeText(source[field]);
    }
  });

  ["hireDate", "joinDate", "employmentDate"].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      updates[field] = normalizeProfileDate(source[field]);
    }
  });

  return updates;
}

function buildEducationCycleConfigKey(trainingType, subjectCode, subjectName) {
  const typeKey = normalizeText(trainingType || "other").toLowerCase();
  const normalizedSubjectKey = normalizeText(subjectCode || subjectName)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const subjectKey = ["job_wb", "w_b", "wb", "weight_balance", "탑재관리"].includes(normalizedSubjectKey)
    ? "job_wb"
    : ["job_operations", "flight_operations", "운항관리", "운항담당"].includes(normalizedSubjectKey)
      ? "job_operations"
      : normalizedSubjectKey;
  return `${typeKey}__${subjectKey || "default"}`;
}

async function resolveEducationCycleCompanyId({ payloadCompanyId, actor, itemId, branchId }) {
  const trace = {
    payloadCompanyId: normalizeText(payloadCompanyId),
    actorCompanyId: normalizeText(actor?.companyId),
    actorBranchId: normalizeText(actor?.branchId),
    itemId: normalizeText(itemId),
    branchId: normalizeText(branchId),
    itemCompanyId: "",
    branchCompanyId: "",
    actorBranchCompanyId: "",
    branchCompanyIds: [],
    companyIds: [],
  };
  const resolved = (companyId, source) => ({ companyId, source, trace });

  if (trace.payloadCompanyId) return resolved(trace.payloadCompanyId, "payload");
  if (trace.actorCompanyId) return resolved(trace.actorCompanyId, "actor");

  if (itemId) {
    const itemSnap = await db.ref(`trainingItems/${itemId}/companyId`).get();
    if (itemSnap.exists() && normalizeText(itemSnap.val())) {
      trace.itemCompanyId = normalizeText(itemSnap.val());
      return resolved(trace.itemCompanyId, "trainingItem");
    }
  }

  if (branchId) {
    const branchSnap = await db.ref(`branches/${branchId}/companyId`).get();
    if (branchSnap.exists() && normalizeText(branchSnap.val())) {
      trace.branchCompanyId = normalizeText(branchSnap.val());
      return resolved(trace.branchCompanyId, "branch");
    }
  }

  const actorBranchId = normalizeText(actor?.branchId);
  if (actorBranchId) {
    const branchSnap = await db.ref(`branches/${actorBranchId}/companyId`).get();
    if (branchSnap.exists() && normalizeText(branchSnap.val())) {
      trace.actorBranchCompanyId = normalizeText(branchSnap.val());
      return resolved(trace.actorBranchCompanyId, "actorBranch");
    }
  }

  const branchesSnap = await db.ref("branches").get();
  trace.branchCompanyIds = [...new Set(Object.values(branchesSnap.val() ?? {})
    .map((branch) => normalizeText(branch?.companyId))
    .filter(Boolean))];
  if (trace.branchCompanyIds.length === 1) {
    return resolved(trace.branchCompanyIds[0], "uniqueBranchCompany");
  }

  const companiesSnap = await db.ref("companies").get();
  trace.companyIds = Object.keys(companiesSnap.val() ?? {});
  if (trace.companyIds.length === 1) {
    return resolved(trace.companyIds[0], "uniqueCompany");
  }

  return resolved("", "unresolved");
}

function normalizeCycleMonths(value) {
  if (value === null || value === undefined || value === "") {
    return { unset: true, value: null };
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new HttpsError("invalid-argument", "재교육 주기는 숫자만 입력할 수 있습니다.");
  }
  if (!Number.isInteger(numeric)) {
    throw new HttpsError("invalid-argument", "재교육 주기는 정수 개월만 허용됩니다.");
  }
  if (numeric < 0 || numeric > 120) {
    throw new HttpsError("invalid-argument", "재교육 주기는 0~120개월 범위에서만 설정할 수 있습니다.");
  }
  if (numeric === 0) {
    return { unset: true, value: null };
  }

  return { unset: false, value: numeric };
}

function simplifyError(err) {
  if (err?.code === "auth/email-already-exists") return "동일 이메일 계정이 이미 존재합니다.";
  if (err?.code === "auth/invalid-password") return "비밀번호 정책에 맞지 않습니다.";
  return err?.message || "알 수 없는 오류";
}

/* ══════════════════════════════════════════════════════════
   기존 교육이력 Excel 가져오기
   - 클라이언트에서 Excel 파싱 후 rows를 전달
   - 기존 이력과 매칭 → 빈 필드 보완 또는 신규 추가
   - 덮어쓰기 여부: mode = "fill"(기본) | "overwrite"
══════════════════════════════════════════════════════════ */
exports.importHistoryExcelData = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  const actor = await ensureHQAdminProfile(request.auth.uid).catch(async () => {
    // SUPER_ADMIN도 허용
    await ensureSuperAdmin(request.auth.uid);
    const snap = await db.ref(`users/${request.auth.uid}`).get();
    return snap.val() ?? { uid: request.auth.uid };
  });

  const rows = Array.isArray(request.data?.rows) ? request.data.rows : [];
  const mode = normalizeText(request.data?.mode) === "overwrite" ? "overwrite" : "fill";

  if (!rows.length) {
    return { parsedCount: 0, validCount: 0, matchedEmployeeCount: 0, unmatchedEmployeeCount: 0,
             matchedExistingCount: 0, updatedCount: 0, createdCount: 0,
             skippedDuplicateCount: 0, skippedInvalidCount: 0,
             matchedEmployees: 0, skippedCount: 0, errors: ["전송된 이력이 없습니다."] };
  }

  // 회사 직원 목록 조회
  const usersSnap = await db.ref("users").get();
  const allUsers  = Object.entries(usersSnap.val() ?? {}).map(([uid, u]) => ({ uid, ...u }));
  // empNo: 탭·공백 완전 제거 후 대소문자 무시
  const normalizeImportEmpNo = (value) => String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u00a0\u200b-\u200d\u2060\ufeff]/g, "")
    .toUpperCase();
  const empByNo   = new Map(
    allUsers
      .filter((u) => u.empNo)
      .map((u) => [normalizeImportEmpNo(u.empNo).toLowerCase(), u])
  );
  const empByName = new Map();
  for (const u of allUsers) {
    if (!u.name) continue;
    const k = String(u.name).replace(/\s+/g, " ").trim();
    if (!empByName.has(k)) empByName.set(k, []);
    empByName.get(k).push(u);
  }

  // 기존 manualTrainingHistories 전체 조회
  const manualSnap = await db.ref("manualTrainingHistories").get();
  const manualAll  = Object.entries(manualSnap.val() ?? {}).map(([id, r]) => ({ _id: id, ...r }));

  const updates         = {};
  const matchedEmpUids  = new Set();
  let updatedCount          = 0;
  let createdCount          = 0;
  let skippedCount          = 0;
  let skippedDuplicateCount = 0;
  let skippedInvalidCount   = 0;
  let unmatchedEmpCount     = 0;
  let matchedExistingCount  = 0;
  let matchedRecordCount    = 0;
  const errors      = [];
  const traceSamples = [];
  const parsedCount = rows.length;
  const affectedUids = new Set();

  // dedupeKey 세트 (중복 방지)
  const processedKeys = new Set(manualAll.map((r) => r.dedupeKey).filter(Boolean));

  for (const row of rows) {
    // empNo: 탭·공백 완전 제거 (\tT259144 같은 패턴 처리)
    const empNoRaw   = normalizeImportEmpNo(row.empNo ?? row.employeeEmpNo ?? "");
    const empNameRaw = String(row.employeeName ?? row.name ?? "").replace(/\s+/g, " ").trim();
    const rawTrainingType = normalizeHistoryImportType(row);
    const rawCourseName = normalizeText(row.courseName ?? row.subjectName ?? "");
    const subjectName  = normalizeText(row.subjectName ?? row.courseName ?? "");
    const classification = classifyTraining({
      trainingType: rawTrainingType,
      courseName: rawCourseName,
      subjectName,
      educationStage: row.educationStage,
      subType: row.subType,
      educationType: row.educationType,
      initialOrRecurrent: row.initialOrRecurrent,
      trainingPhase: row.trainingPhase,
    });
    const trainingType = classification.trainingType;
    const courseName = classification.canonicalCourseName || rawCourseName;
    const normalizedStage = classification.subType || normalizeHistoryStage(
      row.educationStage,
      row.subType,
      row.initialOrRecurrent,
      courseName,
      row.sourceSheetName
    );
    // normalizeDateMillis는 null을 반환할 수 있음 (throw 대신)
    let completedAt = null;
    try { completedAt = normalizeDateMillis(row.completedAt, "수료일"); } catch(e) { completedAt = null; }

    if (!courseName && !subjectName) {
      errors.push(`교육과정명 없음`);
      skippedInvalidCount++;
      continue;
    }
    if (!completedAt) {
      errors.push(`수료일 없음 또는 형식 오류 (과정: ${courseName}, 원본값: ${row.completedAt})`);
      skippedInvalidCount++;
      continue;
    }

    // 직원 탐색
    let employee = null;
    if (empNoRaw) {
      employee = empByNo.get(empNoRaw.toLowerCase()) ?? null;
    }
    if (!employee && empNameRaw) {
      const candidates = empByName.get(empNameRaw) ?? [];
      if (candidates.length === 1) employee = candidates[0];
      else if (candidates.length > 1) {
        errors.push(`동명이인: ${empNameRaw} (${candidates.length}명) — 사번으로 특정 필요`);
        continue;
      }
    }
    if (!employee) {
      errors.push(`직원 미매칭: ${empNameRaw || empNoRaw || "?"}`);
      unmatchedEmpCount++;
      continue;
    }

    matchedEmpUids.add(employee.uid);
    affectedUids.add(employee.uid);
    matchedRecordCount++;

    // 기존 이력 매칭: trainingType + (courseName|subjectName) + completedAt
    const normalize = (s) => String(s ?? "").toLowerCase().replace(/[\s\(\)\[\]·]/g, "");
    let existingRec = manualAll.find((r) => {
      if (r.uid !== employee.uid) return false;
      const existingClassification = classifyTraining(r);
      const rType  = normalize(existingClassification.trainingType ?? r.trainingType ?? "");
      const rCourse = normalize(existingClassification.canonicalCourseKey ?? r.courseName ?? r.title ?? r.subjectName ?? "");
      const rSubject = normalize(r.subjectCode ?? r.subjectName ?? r.courseName ?? r.title ?? "");
      const rDate  = Number(r.completedAt ?? 0);
      return rType === normalize(trainingType) &&
             rCourse === normalize(classification.canonicalCourseKey || courseName || subjectName) &&
             rSubject === normalize(row.subjectCode || subjectName || courseName) &&
             rDate === completedAt;
    });

    // 과거 Import가 유형만 잘못 저장한 경우, 같은 과정·과목·날짜의 Excel 이력을 교정한다.
    if (!existingRec) {
      existingRec = manualAll.find((r) => {
        if (r.uid !== employee.uid || normalizeText(r.source) !== "history_excel") return false;
        const rCourse = normalize(classifyTraining(r).canonicalCourseKey ?? r.courseName ?? r.title ?? r.subjectName ?? "");
        const rSubject = normalize(r.subjectCode ?? r.subjectName ?? r.courseName ?? r.title ?? "");
        return rCourse === normalize(classification.canonicalCourseKey || courseName || subjectName) &&
          rSubject === normalize(row.subjectCode || subjectName || courseName) &&
          Number(r.completedAt ?? 0) === completedAt;
      });
    }

    const detailFields = {
      instructorName: normalizeText(row.instructorName),
      hours:          row.trainingHours != null ? Number(row.trainingHours) : undefined,
      startDate:      row.startDate     ? normalizeDateMillis(row.startDate, "시작일")  : undefined,
      endDate:        row.endDate       ? normalizeDateMillis(row.endDate,   "종료일")  : undefined,
      result:         normalizeText(row.result)        || "PASS",
      subType:        normalizedStage,
      educationStage: normalizedStage,
      canonicalCourseName: classification.canonicalCourseName,
      canonicalCourseKey: classification.canonicalCourseKey,
      sectionKey: classification.sectionKey,
      stageSource: classification.stageSource || (normalizedStage ? "explicit" : ""),
      note:           normalizeText(row.note),
      source:         "history_excel",
    };

    if (existingRec) {
      // 기존 이력 보완
      const patch = {};
      for (const [k, v] of Object.entries(detailFields)) {
        if (v === undefined || v === "" || v === null) continue;
        const existing = existingRec[k];
        // fill 모드: 기존 값이 비어있거나 "-"인 경우만 채움
        if (mode === "fill" && existing && existing !== "-" && existing !== "") continue;
        patch[k] = v;
      }
      const existingStage = normalizeHistoryStage(existingRec.subType, existingRec.educationStage);
      if (normalizeTrainingTypeValue(existingRec.trainingType) !== trainingType) {
        patch.trainingType = trainingType;
      }
      for (const field of ["canonicalCourseName", "canonicalCourseKey", "sectionKey", "stageSource"]) {
        if (detailFields[field] && existingRec[field] !== detailFields[field]) patch[field] = detailFields[field];
      }
      if (classification.canonicalCourseName && existingRec.courseName !== classification.canonicalCourseName) {
        patch.courseName = classification.canonicalCourseName;
        patch.title = classification.canonicalCourseName;
      }
      if (normalizedStage && existingStage !== normalizedStage) {
        patch.subType = normalizedStage;
        patch.educationStage = normalizedStage;
      }
      matchedExistingCount++;
      if (Object.keys(patch).length > 0) {
        patch.updatedAt    = Date.now();
        patch.updatedBy    = request.auth.uid;
        const correctedRecord = { ...existingRec, ...patch };
        correctedRecord.dedupeKey = buildManualHistoryDedupeKey(correctedRecord);
        updates[`manualTrainingHistories/${existingRec._id}`] = correctedRecord;
        updates[`userManualTrainingHistories/${employee.uid}/${existingRec._id}`] = correctedRecord;
        processedKeys.add(correctedRecord.dedupeKey);
        if (traceSamples.length < 10 && trainingType === "job" && normalizedStage === "recurrent") {
          traceSamples.push({
            action: "updated",
            sourceSheetName: normalizeText(row.sourceSheetName),
            sourceRowNumber: row.sourceRowNumber ?? null,
            sourceBlockStartRow: row.sourceBlockStartRow ?? null,
            sourceBlockEndRow: row.sourceBlockEndRow ?? null,
            importTraceId: normalizeText(row.importTraceId),
            rawCourseName: normalizeText(row.rawCourseName),
            rawStage: normalizeText(row.rawStage),
            rawPeriod: normalizeText(row.rawPeriod),
            rawCompletedAt: row.rawCompletedAt ?? null,
            courseName,
            subjectName,
            trainingType,
            subType: normalizedStage,
            dedupeKey: correctedRecord.dedupeKey,
            savedPaths: [
              `manualTrainingHistories/${existingRec._id}`,
              `userManualTrainingHistories/${employee.uid}/${existingRec._id}`,
            ],
          });
        }
        updatedCount++;
      } else {
        skippedCount++;
      }
    } else {
      // 신규 이력 생성
      const historyId = db.ref("manualTrainingHistories").push().key;
      const record = {
        historyId,
        uid:           employee.uid,
        empNo:         employee.empNo ?? "",
        employeeName:  employee.name  ?? "",
        branchId:      employee.branchId   ?? "",
        branchName:    employee.branchName ?? "",
        companyId:     employee.companyId  ?? actor.companyId ?? null,
        companyName:   employee.companyName ?? actor.companyName ?? "",
        trainingType,
        canonicalCourseName: classification.canonicalCourseName,
        canonicalCourseKey: classification.canonicalCourseKey,
        sectionKey: classification.sectionKey,
        stageSource: classification.stageSource || (normalizedStage ? "explicit" : ""),
        subjectCode:   normalizeText(row.subjectCode ?? ""),
        subjectName:   subjectName || courseName,
        title:         courseName  || subjectName,
        courseName:    courseName  || subjectName,
        completedAt,
        completionStatus: "completed",
        status:        "completed",
        result:        detailFields.result || "PASS",
        instructorName: detailFields.instructorName || "",
        hours:         detailFields.hours ?? 0,
        startDate:     detailFields.startDate ?? null,
        endDate:       detailFields.endDate   ?? null,
        subType:       detailFields.subType   || "",
        educationStage: detailFields.educationStage || "",
        note:          detailFields.note || "",
        sourceRowNumber: row.sourceRowNumber ?? null,
        sourceBlockStartRow: row.sourceBlockStartRow ?? null,
        sourceBlockEndRow: row.sourceBlockEndRow ?? null,
        sourceSheetName: normalizeText(row.sourceSheetName),
        importTraceId: normalizeText(row.importTraceId),
        cycleMonths:   0,
        source:        "history_excel",
        createdAt:     Date.now(),
        createdBy:     request.auth.uid,
        createdByName: actor.name ?? "",
        updatedAt:     Date.now(),
        updatedBy:     request.auth.uid,
        updatedByName: actor.name ?? "",
      };
      record.dedupeKey = buildManualHistoryDedupeKey(record);

      // 중복 체크
      if (processedKeys.has(record.dedupeKey)) { skippedCount++; skippedDuplicateCount++; continue; }
      processedKeys.add(record.dedupeKey);

      updates[`manualTrainingHistories/${historyId}`] = record;
      updates[`userManualTrainingHistories/${employee.uid}/${historyId}`] = record;
      if (traceSamples.length < 10 && trainingType === "job" && normalizedStage === "recurrent") {
        traceSamples.push({
          action: "created",
          sourceSheetName: record.sourceSheetName,
          sourceRowNumber: record.sourceRowNumber,
          sourceBlockStartRow: record.sourceBlockStartRow,
          sourceBlockEndRow: record.sourceBlockEndRow,
          importTraceId: record.importTraceId,
          rawCourseName: normalizeText(row.rawCourseName),
          rawStage: normalizeText(row.rawStage),
          rawPeriod: normalizeText(row.rawPeriod),
          rawCompletedAt: row.rawCompletedAt ?? null,
          courseName: record.courseName,
          subjectName: record.subjectName,
          trainingType: record.trainingType,
          subType: record.subType,
          dedupeKey: record.dedupeKey,
          savedPaths: [
            `manualTrainingHistories/${historyId}`,
            `userManualTrainingHistories/${employee.uid}/${historyId}`,
          ],
        });
      }
      createdCount++;
    }
  }

  if (Object.keys(updates).length) {
    await db.ref().update(updates);
  }
  await reconcileManualHistoryClassifications(affectedUids);

  const validCount = parsedCount - skippedInvalidCount;
  const resultSummary = {
    parsedCount,
    validCount,
    matchedEmployeeCount: matchedEmpUids.size,
    matchedRecordCount,
    unmatchedEmployeeCount: unmatchedEmpCount,
    matchedExistingCount,
    updatedCount,
    createdCount,
    duplicateCount: skippedDuplicateCount,
    invalidCount: skippedInvalidCount,
    savedCount: createdCount + updatedCount,
    firebasePathCount: Object.keys(updates).length,
    uniqueFirebasePathCount: new Set(Object.keys(updates)).size,
    skippedDuplicateCount,
    skippedInvalidCount,
    // 하위 호환 필드
    matchedEmployees: matchedEmpUids.size,
    skippedCount,
    errors: errors.slice(0, 30),
    traceSamples,
  };
  logger.info("[importHistoryExcelData] result", resultSummary);
  return resultSummary;
});
