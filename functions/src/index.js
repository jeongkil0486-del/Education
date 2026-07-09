/**
 * TAS Education Lab — Cloud Functions
 *
 * 모든 callable은 firebase-functions/v2/https의 onCall을 사용합니다.
 * cors: true 로 Vercel Preview 등 외부 origin을 허용합니다.
 * region: "us-central1" 은 Firebase JS SDK 기본값과 일치시킵니다.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const auth = admin.auth();
const db = admin.database();

const EMAIL_DOMAIN = "tas.local";

/**
 * 모든 함수에 적용하는 공통 옵션
 * - region: Firebase JS SDK getFunctions() 기본값과 일치
 * - cors: Vercel Preview URL 등 외부 origin preflight 허용
 */
const OPTS = { region: "us-central1", cors: true };

// ─────────────────────────────────────────────────────────────
// 직원 계정 생성 (Excel 업로드)
// ─────────────────────────────────────────────────────────────
exports.createEmployeeAccounts = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const employees = Array.isArray(request.data?.employees) ? request.data.employees : [];
  if (!employees.length) throw new HttpsError("invalid-argument", "업로드할 직원 데이터가 없습니다.");
  if (employees.length > 1000) throw new HttpsError("invalid-argument", "한 번에 최대 1000명까지 업로드할 수 있습니다.");

  const seenEmpNos = new Set();
  const branchCache = new Map();
  const created = [];
  const skipped = [];
  const failed = [];

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
// 직원 다중 삭제
// - 중간 실패해도 중단 없이 전체 처리
// - 결과: { succeededCount, failedCount, succeeded[], failed[] }
// ─────────────────────────────────────────────────────────────
exports.bulkDeleteEmployeeAccounts = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const uids = Array.isArray(request.data?.uids) ? request.data.uids : [];
  if (!uids.length)    throw new HttpsError("invalid-argument", "삭제할 UID 목록이 비어 있습니다.");
  if (uids.length > 200) throw new HttpsError("invalid-argument", "한 번에 최대 200명까지 삭제할 수 있습니다.");

  const succeeded = [];
  const failed    = [];

  for (const uid of uids) {
    try {
      const snap = await db.ref(`users/${uid}`).get();
      if (!snap.exists()) {
        failed.push({ uid, message: "사용자 정보를 찾을 수 없습니다." });
        continue;
      }
      const profile = snap.val();
      if (profile.role !== "employee") {
        failed.push({ uid, empNo: profile.empNo ?? "", name: profile.name ?? "", message: "직원 계정이 아닙니다." });
        continue;
      }
      await deleteAuthAndProfile(uid);
      succeeded.push({ uid, empNo: profile.empNo ?? "", name: profile.name ?? "" });
    } catch (err) {
      logger.error("bulkDeleteEmployeeAccounts uid error", { uid, message: err?.message, code: err?.code });
      failed.push({ uid, message: simplifyError(err) });
    }
  }

  logger.info("bulkDeleteEmployeeAccounts done", { succeeded: succeeded.length, failed: failed.length });
  return { succeededCount: succeeded.length, failedCount: failed.length, succeeded, failed };
});

// ─────────────────────────────────────────────────────────────
// 관리 계정 다중 삭제 (hq_admin / instructor)
// - 중간 실패해도 중단 없이 전체 처리
// - 결과: { succeededCount, failedCount, succeeded[], failed[] }
// ─────────────────────────────────────────────────────────────
exports.bulkDeleteManagedAccounts = onCall(OPTS, async (request) => {
  ensureAuthenticated(request);
  await ensureSuperAdmin(request.auth.uid);

  const uids = Array.isArray(request.data?.uids) ? request.data.uids : [];
  if (!uids.length)    throw new HttpsError("invalid-argument", "삭제할 UID 목록이 비어 있습니다.");
  if (uids.length > 200) throw new HttpsError("invalid-argument", "한 번에 최대 200개까지 삭제할 수 있습니다.");

  const succeeded = [];
  const failed    = [];

  for (const uid of uids) {
    try {
      const snap = await db.ref(`users/${uid}`).get();
      if (!snap.exists()) {
        failed.push({ uid, message: "계정 정보를 찾을 수 없습니다." });
        continue;
      }
      const profile = snap.val();
      if (!["hq_admin", "instructor"].includes(profile.role)) {
        failed.push({ uid, empNo: profile.empNo ?? "", name: profile.name ?? "", message: "삭제할 수 없는 계정입니다." });
        continue;
      }
      await deleteAuthAndProfile(uid);
      succeeded.push({ uid, empNo: profile.empNo ?? "", name: profile.name ?? "" });
    } catch (err) {
      logger.error("bulkDeleteManagedAccounts uid error", { uid, message: err?.message, code: err?.code });
      failed.push({ uid, message: simplifyError(err) });
    }
  }

  logger.info("bulkDeleteManagedAccounts done", { succeeded: succeeded.length, failed: failed.length });
  return { succeededCount: succeeded.length, failedCount: failed.length, succeeded, failed };
});

// ─────────────────────────────────────────────────────────────
// 공통 헬퍼
// ─────────────────────────────────────────────────────────────

/** Auth + DB 동시 삭제. Auth 계정이 없어도 DB는 삭제 */
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
  const snap = await db.ref(`branches/${branchId}`).get();
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
    branchCode:  payload.branch.code   ?? "",
    branchName:  payload.branch.name   ?? "",
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
    position:    payload.position   ?? "",
    branchId:    payload.branchId   ?? "",
    branchCode:  payload.branchCode ?? "",
    branchName:  payload.branchName ?? "",
    companyId:   payload.companyId  ?? null,
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
