import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const { functions } = window.__firebase;

const createEmployeesCallable      = httpsCallable(functions, "createEmployeeAccounts");
const createManagedAccountCallable = httpsCallable(functions, "createManagedAccount");
const updateManagedAccountCallable = httpsCallable(functions, "updateManagedAccount");
const deleteEmployeeCallable       = httpsCallable(functions, "deleteEmployeeAccount");
const deleteManagedAccountCallable = httpsCallable(functions, "deleteManagedAccount");

export async function createEmployeeAccounts(payload) {
  const result = await createEmployeesCallable(payload);
  return result.data;
}

export async function createManagedAccount(payload) {
  const result = await createManagedAccountCallable(payload);
  return result.data;
}

export async function updateManagedAccount(payload) {
  const result = await updateManagedAccountCallable(payload);
  return result.data;
}

export async function deleteEmployeeAccount(payload) {
  const result = await deleteEmployeeCallable(payload);
  return result.data;
}

export async function deleteManagedAccount(payload) {
  const result = await deleteManagedAccountCallable(payload);
  return result.data;
}

/**
 * 직원 다중 삭제
 * 별도 Cloud Function 없이, 이미 배포된 deleteEmployeeAccount를 순차 반복 호출합니다.
 * 중간 실패해도 중단하지 않고 마지막에 결과를 반환합니다.
 *
 * @param {{ uids: string[] }} payload
 * @returns {{ succeededCount, failedCount, succeeded, failed }}
 */
export async function bulkDeleteEmployeeAccounts({ uids }) {
  const succeeded = [];
  const failed    = [];

  for (const uid of uids) {
    try {
      await deleteEmployeeCallable({ uid });
      succeeded.push({ uid });
    } catch (err) {
      console.error("[admin-api] bulkDeleteEmployeeAccounts uid error", uid, err?.code, err?.message);
      failed.push({ uid, message: err?.message ?? "삭제 실패" });
    }
  }

  return {
    succeededCount: succeeded.length,
    failedCount:    failed.length,
    succeeded,
    failed,
  };
}

/**
 * 관리 계정 다중 삭제 (hq_admin / instructor)
 * 별도 Cloud Function 없이, 이미 배포된 deleteManagedAccount를 순차 반복 호출합니다.
 * 중간 실패해도 중단하지 않고 마지막에 결과를 반환합니다.
 *
 * @param {{ uids: string[] }} payload
 * @returns {{ succeededCount, failedCount, succeeded, failed }}
 */
export async function bulkDeleteManagedAccounts({ uids }) {
  const succeeded = [];
  const failed    = [];

  for (const uid of uids) {
    try {
      await deleteManagedAccountCallable({ uid });
      succeeded.push({ uid });
    } catch (err) {
      console.error("[admin-api] bulkDeleteManagedAccounts uid error", uid, err?.code, err?.message);
      failed.push({ uid, message: err?.message ?? "삭제 실패" });
    }
  }

  return {
    succeededCount: succeeded.length,
    failedCount:    failed.length,
    succeeded,
    failed,
  };
}
