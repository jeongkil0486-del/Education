import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const { functions } = window.__firebase;

const createEmployeesCallable      = httpsCallable(functions, "createEmployeeAccounts");
const createManagedAccountCallable = httpsCallable(functions, "createManagedAccount");
const updateManagedAccountCallable = httpsCallable(functions, "updateManagedAccount");
const deleteEmployeeCallable       = httpsCallable(functions, "deleteEmployeeAccount");
const deleteManagedAccountCallable = httpsCallable(functions, "deleteManagedAccount");
const deleteEmployeeHistoryCallable = httpsCallable(functions, "deleteEmployeeHistory");
const upsertManualTrainingHistoryCallable = httpsCallable(functions, "upsertManualTrainingHistory");
const bulkImportManualTrainingHistoriesCallable = httpsCallable(functions, "bulkImportManualTrainingHistories");
// 직원관리대장 신규 함수
const updateEmployeeManagementProfileCallable  = httpsCallable(functions, "updateEmployeeManagementProfile");
const resetSelectedManualTrainingHistoriesCallable = httpsCallable(functions, "resetSelectedManualTrainingHistories");
const saveEducationCycleConfigCallable         = httpsCallable(functions, "saveEducationCycleConfig");

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

export async function deleteEmployeeHistory(payload) {
  const result = await deleteEmployeeHistoryCallable(payload);
  return result.data;
}

export async function upsertManualTrainingHistory(payload) {
  const result = await upsertManualTrainingHistoryCallable(payload);
  return result.data;
}

export async function bulkImportManualTrainingHistories(payload) {
  const result = await bulkImportManualTrainingHistoriesCallable(payload);
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

/* ─── 직원관리대장 신규 API ──────────────────────────────── */

/**
 * 직원 기본정보 수정 (HQ_ADMIN 전용)
 * 수정 가능: name, hireDate, position, branchId, managementNote
 * 수정 불가: empNo, role, password, Auth email
 */
export async function updateEmployeeManagementProfile(payload) {
  const result = await updateEmployeeManagementProfileCallable(payload);
  return result.data;
}

/**
 * 선택 직원의 Excel 업로드 이력 초기화 (HQ_ADMIN 전용)
 * source==="manual_excel" + 선택 교육항목 이력만 삭제
 */
export async function resetSelectedManualTrainingHistories(payload) {
  const result = await resetSelectedManualTrainingHistoriesCallable(payload);
  return result.data;
}

/**
 * 교육 항목별 재교육 주기 설정 저장 (HQ_ADMIN 전용)
 */
export async function saveEducationCycleConfig(payload) {
  const result = await saveEducationCycleConfigCallable(payload);
  return result.data;
}

/**
 * 교육 항목별 재교육 주기 설정 조회 (클라이언트 직접 DB 조회 가능하지만 API도 제공)
 */
export async function getEducationCycleConfig(payload) {
  // 클라이언트에서 직접 DB를 읽어도 되므로 여기서는 noop (educationCycleConfigsDB.get 사용)
  return null;
}

