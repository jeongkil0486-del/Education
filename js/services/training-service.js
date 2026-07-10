import { authStore, ROLES } from "../core/auth.js";
import {
  assignmentsDB,
  branchesDB,
  completionsDB,
  sessionAssignmentsDB,
  sessionCompletionsDB,
  manualTrainingHistoriesDB,
  templatesDB,
  trainingItemsDB,
  trainingSessionsDB,
  trainingsDB,
  usersDB,
} from "../core/db.js";

export const DEADLINE_SOON_DAYS = 3;

export const TRAINING_TYPES = [
  "job",
  "legal",
  "external",
  "online",
  "other",
];

export const TRAINING_TYPE_LABELS = {
  job: "직무교육",
  legal: "법정교육",
  external: "외부교육",
  online: "온라인교육",
  other: "기타",
};

export const TRAINING_SUBJECT_OPTIONS = {
  job: [
    { code: "job_duty", name: "직무" },
    { code: "job_operations", name: "운항관리" },
    { code: "job_instructor", name: "사내강사" },
    { code: "job_wb", name: "W&B" },
  ],
  legal: [
    { code: "legal_sms", name: "SMS" },
    { code: "legal_security", name: "항공보안" },
    { code: "legal_dangerous_goods", name: "위험물" },
  ],
};

export const DUE_STATUS_LABELS = {
  normal: "정상",
  soon: "재교육 임박",
  overdue: "기한 초과",
  unconfigured: "주기 미설정",
  history: "과거 이력",
};


const LEGACY_TRAINING_TYPE_MAP = {
  initial: "job",
  recurring: "legal",
  external: "external",
  online: "online",
  other: "other",
  job: "job",
  legal: "legal",
  "직무교육": "job",
  "법정교육": "legal",
  "외부교육": "external",
  "온라인교육": "online",
  "기타": "other",
};

export const TRAINING_STATUS_LABELS = {
  scheduled: "예정",
  in_progress: "진행중",
  closed: "종료",
  overdue: "기한초과",
  completed: "완료",
};

export function normalizeTrainingType(type) {
  const normalized = String(type ?? "").trim();
  return LEGACY_TRAINING_TYPE_MAP[normalized] ?? "other";
}

export function getTrainingTypeLabel(type) {
  return TRAINING_TYPE_LABELS[normalizeTrainingType(type)] ?? TRAINING_TYPE_LABELS.other;
}

export function computeTrainingStatus(training, now = Date.now()) {
  if (!training) return "scheduled";
  if (training.status === "completed" || training.completedAt) return "completed";
  if (training.status === "closed" || training.closedAt) return "closed";
  if (training.deadline && training.deadline < now) return "overdue";

  if (training.startDate && training.endDate) {
    if (training.startDate > now) return "scheduled";
    if (training.endDate >= now) return "in_progress";
    return "scheduled";
  }

  return "scheduled";
}

export function statusTone(status) {
  return {
    scheduled: "info",
    in_progress: "success",
    closed: "neutral",
    overdue: "danger",
    completed: "success",
  }[status] ?? "neutral";
}

export function buildStatusChip(status) {
  return `<span class="chip chip--${statusTone(status)}">${TRAINING_STATUS_LABELS[status] ?? status}</span>`;
}

export function sortByRecent(items, field = "createdAt") {
  return [...items].sort((a, b) => Number(b?.[field] ?? 0) - Number(a?.[field] ?? 0));
}

export function getAssignedBranchIds(profile = authStore.profile) {
  const value = profile?.assignedBranches;
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(String).map((id) => id.trim()).filter(Boolean)));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).filter(([, enabled]) => !!enabled).map(([id]) => id);
  }
  return [];
}

async function getLatestAssignedBranchIds() {
  if (authStore.role !== ROLES.INSTRUCTOR) return [];

  const latestProfile = await usersDB.get(authStore.uid).catch(() => null);
  return getAssignedBranchIds(latestProfile ?? authStore.profile);
}

export function canAccessEmployeeHistory(employee, assignedBranchIds = getAssignedBranchIds()) {
  if (!employee) return false;
  if (authStore.role === ROLES.HQ_ADMIN || authStore.role === ROLES.SUPER_ADMIN) return true;
  if (authStore.role === ROLES.INSTRUCTOR) {
    return assignedBranchIds.includes(String(employee.branchId ?? ""));
  }
  return (employee.id ?? employee.uid) === authStore.uid;
}

async function assertEmployeeHistoryAccess(uid) {
  const employee = await usersDB.get(uid);
  const assignedBranchIds = authStore.role === ROLES.INSTRUCTOR
    ? await getLatestAssignedBranchIds()
    : getAssignedBranchIds();

  if (!canAccessEmployeeHistory(employee ? { uid, ...employee } : null, assignedBranchIds)) {
    const error = new Error("조회 권한이 없는 직원입니다.");
    error.code = "permission-denied";
    throw error;
  }

  return employee;
}

export async function loadTrainingReferences() {
  const [branches, allUsers, templates, latestAssignedBranchIds] = await Promise.all([
    branchesDB.listAll(),
    usersDB.listAll(),
    templatesDB.list(authStore.companyId),
    getLatestAssignedBranchIds(),
  ]);

  const companyId = authStore.companyId ?? null;
  const companyUsers = allUsers.filter((user) => {
    if (authStore.role === ROLES.SUPER_ADMIN || !companyId) return true;
    return user.companyId === companyId || !user.companyId;
  });
  const companyBranches = branches.filter((branch) => !companyId || branch.companyId === companyId);

  const assignedBranchIds = authStore.role === ROLES.INSTRUCTOR ? latestAssignedBranchIds : [];
  const assignedSet = new Set(assignedBranchIds);
  const filteredBranches = authStore.role === ROLES.INSTRUCTOR
    ? companyBranches.filter((branch) => assignedSet.has(String(branch.id ?? branch.branchId ?? "")))
    : companyBranches;
  const users = authStore.role === ROLES.INSTRUCTOR
    ? companyUsers.filter((user) => user.role !== ROLES.EMPLOYEE || assignedSet.has(String(user.branchId ?? "")))
    : companyUsers;
  const employees = users.filter((user) => user.role === ROLES.EMPLOYEE);
  const instructors = companyUsers.filter((user) => user.role === ROLES.INSTRUCTOR);

  return {
    company: {
      id: companyId,
      name: authStore.profile?.companyName ?? "",
    },
    branches: sortByRecent(filteredBranches, "createdAt"),
    users,
    employees,
    instructors,
    templates: sortByRecent(
      templates.filter((template) => template.templateType === "history_card"),
      "uploadedAt"
    ),
  };
}

export function isDeadlineSoon(training, now = Date.now()) {
  if (!training?.deadline) return false;
  if (training.status === "completed" || training.completedAt) return false;
  if (training.status === "closed" || training.closedAt) return false;
  if (training.deadline < now) return false;

  const diffMs = training.deadline - now;
  return diffMs <= DEADLINE_SOON_DAYS * 24 * 60 * 60 * 1000;
}

export async function listManagedTrainings() {
  const trainings = authStore.role === ROLES.SUPER_ADMIN
    ? await trainingsDB.listAll()
    : await trainingsDB.list(authStore.companyId);

  return sortByRecent(trainings, "createdAt").map(enrichTrainingRecord);
}

export async function listInstructorTrainings() {
  const uid = authStore.uid;
  const companyId = authStore.companyId ?? null;
  const allTrainings = companyId
    ? await trainingsDB.list(companyId)
    : await trainingsDB.listAll();

  return sortByRecent(
    allTrainings.filter((training) => training.createdBy === uid || training.instructorId === uid),
    "createdAt"
  ).map(enrichTrainingRecord);
}

export function enrichTrainingRecord(training) {
  const status = computeTrainingStatus(training);
  const trainingType = normalizeTrainingType(training.trainingType);

  return {
    ...training,
    trainingType,
    computedStatus: status,
    computedStatusLabel: TRAINING_STATUS_LABELS[status],
    typeLabel: getTrainingTypeLabel(trainingType),
  };
}

export function buildTrainingPayload(values, references, currentTraining = null) {
  const selectedBranchIds = Array.from(new Set(values.branchIds.filter(Boolean)));
  const branchMap = new Map(references.branches.map((branch) => [branch.id, branch]));
  const selectedBranches = selectedBranchIds
    .map((branchId) => branchMap.get(branchId))
    .filter(Boolean);
  const selectedInstructor = references.instructors.find((user) => (user.id ?? user.uid) === values.instructorId);
  const computedStatus = currentTraining?.status === "completed"
    ? "completed"
    : currentTraining?.status === "closed"
    ? "closed"
    : computeTrainingStatus({
        ...currentTraining,
        startDate: values.startDate,
        deadline: values.deadline,
      });

  return {
    title: values.title,
    trainingType: normalizeTrainingType(values.trainingType),
    description: values.description,
    companyId: references.company.id ?? currentTraining?.companyId ?? null,
    companyName: references.company.name ?? currentTraining?.companyName ?? "",
    branchIds: selectedBranchIds,
    branchNames: selectedBranches.map((branch) => branch.name ?? branch.code ?? branch.id),
    startDate: values.startDate,
    endDate: values.endDate,
    deadline: values.deadline,
    instructorId: values.instructorId || "",
    instructorName: selectedInstructor?.name ?? values.instructorName ?? "",
    status: computedStatus,
    createdBy: currentTraining?.createdBy ?? authStore.uid,
    createdByName: currentTraining?.createdByName ?? authStore.name,
    updatedBy: authStore.uid,
    updatedByName: authStore.name,
  };
}

export async function saveTraining(payload, trainingId = null) {
  if (trainingId) {
    await trainingsDB.update(trainingId, payload);
    return trainingId;
  }

  const created = await trainingsDB.create(payload);
  return created.key;
}

export async function closeTraining(trainingId) {
  await trainingsDB.close(trainingId, {
    closedBy: authStore.uid,
    closedByName: authStore.name,
  });
}

/**
 * 강사가 교육 완료 처리:
 * 1. training.status = "completed" 저장
 * 2. 배정된 모든 직원에게 교육이력카드(completion) 생성 (중복 방지)
 */
export async function completeTraining(trainingId) {
  const [training, assignments, existingCompletions] = await Promise.all([
    trainingsDB.get(trainingId),
    assignmentsDB.forTraining(trainingId),
    completionsDB.forTraining(trainingId),
  ]);

  if (!training) throw new Error("교육 정보를 찾을 수 없습니다.");
  if (!assignments.length) throw new Error("NO_ASSIGNMENTS");

  const existingUids = new Set(existingCompletions.map((c) => c.uid));
  const now = Date.now();

  // 배정 직원 중 아직 완료 기록이 없는 직원만 생성 (중복 방지)
  const pendingAssignments = assignments.filter((a) => !existingUids.has(a.uid));

  for (const assignment of pendingAssignments) {
    await completionsDB.complete(trainingId, assignment.uid, {
      uid: assignment.uid,
      trainingId,
      trainingTitle: training.title ?? "",
      trainingType: training.trainingType ?? "other",
      instructorName: training.instructorName ?? "",
      startDate: training.startDate ?? null,
      endDate: training.endDate ?? null,
      completedAt: now,
      signedAt: now,
      signatureUrl: "",
      status: "completed",
      completedByInstructor: true,
      completedBy: authStore.uid,
      completedByName: authStore.name,
    });
  }

  // training 상태 완료로 업데이트
  // trainingsDB.complete 메서드를 직접 호출하거나, 없으면 update로 fallback
  if (typeof trainingsDB.complete === "function") {
    await trainingsDB.complete(trainingId, {
      completedBy: authStore.uid,
      completedByName: authStore.name,
    });
  } else {
    await trainingsDB.update(trainingId, {
      status: "completed",
      completedAt: Date.now(),
      completedBy: authStore.uid,
      completedByName: authStore.name,
      updatedAt: Date.now(),
    });
  }
}

export async function deleteTraining(trainingId) {
  await trainingsDB.deleteCascade(trainingId);
}

export async function getTrainingDetail(trainingId) {
  const [training, assignments, completions, references] = await Promise.all([
    trainingsDB.get(trainingId),
    assignmentsDB.forTraining(trainingId),
    completionsDB.forTraining(trainingId),
    loadTrainingReferences(),
  ]);

  if (!training) return null;

  const usersById = new Map(references.users.map((user) => [user.id ?? user.uid, user]));
  const completionsByUid = new Map(completions.map((completion) => [completion.uid, completion]));

  const assignmentRows = assignments
    .map((assignment) => {
      const user = usersById.get(assignment.uid) ?? {};
      const completion = completionsByUid.get(assignment.uid);
      return {
        ...assignment,
        name: assignment.employeeName ?? user.name ?? "-",
        empNo: assignment.empNo ?? user.empNo ?? "-",
        companyName: assignment.companyName ?? user.companyName ?? "-",
        branchName: assignment.branchName ?? user.branchName ?? "-",
        position: user.position ?? "",
        completionStatus: completion?.status ?? "pending",
        completedAt: completion?.completedAt ?? null,
        signedAt: completion?.signedAt ?? null,
      };
    })
    .sort((a, b) => Number(b.assignedAt ?? 0) - Number(a.assignedAt ?? 0));

  const completionRows = completions
    .map((completion) => {
      const user = usersById.get(completion.uid) ?? {};
      return {
        ...completion,
        name: user.name ?? "-",
        empNo: user.empNo ?? "-",
        companyName: user.companyName ?? "-",
        branchName: user.branchName ?? "-",
        position: user.position ?? "",
      };
    })
    .sort((a, b) => Number(b.completedAt ?? 0) - Number(a.completedAt ?? 0));

  return {
    training: enrichTrainingRecord({ ...training, id: training.id ?? trainingId }),
    references,
    assignments: assignmentRows,
    completions: completionRows,
  };
}

export async function assignEmployees(training, employeeIds, references = null) {
  const trainingId = training?.id ?? training?.trainingId;
  if (!trainingId) {
    const error = new Error("assignEmployees: trainingId is required.");
    console.error("[training-service] assignEmployees error", { training, employeeIds }, error.message);
    throw error;
  }

  const refs = references ?? await loadTrainingReferences();
  const selectedUsers = refs.employees.filter((employee) => employeeIds.includes(employee.id ?? employee.uid));
  if (!selectedUsers.length) {
    console.warn("[training-service] assignEmployees: no matched employees", { employeeIds });
    return;
  }

  try {
    await assignmentsDB.assignUsers(trainingId, selectedUsers, {
      assignedBy: authStore.uid,
      status: "pending",
      trainingTitle: training.title ?? "",
      deadline: training.deadline ?? null,
    });
  } catch (err) {
    console.error(
      "[training-service] assignUsers failed",
      { trainingId, employeeIds, code: err?.code, message: err?.message },
      err
    );
    throw err;
  }
}

export async function unassignEmployee(trainingId, uid) {
  await assignmentsDB.remove(trainingId, uid);
}

export async function completeAssignedTraining(trainingId, trainingTitle) {
  const currentCompletion = await completionsDB.get(trainingId, authStore.uid);
  await completionsDB.complete(trainingId, authStore.uid, {
    trainingTitle,
    completedAt: currentCompletion?.completedAt ?? Date.now(),
    signedAt: Date.now(),
    signatureUrl: currentCompletion?.signatureUrl ?? "",
    status: "completed",
  });
}

export async function getCurrentUserAssignments() {
  const [assignments, completions] = await Promise.all([
    assignmentsDB.forUser(authStore.uid),
    completionsDB.forUser(authStore.uid),
  ]);
  const completionMap = new Map(completions.map((completion) => [completion.trainingId, completion]));

  return assignments
    .map((assignment) => ({
      ...assignment,
      completion: completionMap.get(assignment.trainingId) ?? null,
      computedStatus: assignment.status === "completed"
        ? "closed"
        : computeTrainingStatus(assignment),
    }))
    .sort((a, b) => Number(a.deadline ?? 0) - Number(b.deadline ?? 0));
}

export async function getCurrentUserHistory() {
  const { rows } = await buildEmployeeHistoryRowsV2(authStore.uid);
  return sortByRecent(rows.filter((row) => row.completionStatus === "completed"), "completedAt");
}

export async function buildEmployeeHistoryRows(uid) {
  const user = await assertEmployeeHistoryAccess(uid);
  const [assignments, completions, trainings] = await Promise.all([
    assignmentsDB.forUser(uid),
    completionsDB.forUser(uid),
    authStore.role === ROLES.SUPER_ADMIN ? trainingsDB.listAll() : trainingsDB.list(authStore.companyId),
  ]);

  const trainingMap = new Map(trainings.map((training) => [training.id, training]));
  const completionMap = new Map(completions.map((completion) => [completion.trainingId, completion]));
  const assignmentMap = new Map(assignments.map((assignment) => [assignment.trainingId, assignment]));
  const trainingIds = Array.from(new Set([...assignmentMap.keys(), ...completionMap.keys()]));

  const rows = trainingIds.map((trainingId) => {
    const training = trainingMap.get(trainingId) ?? {};
    const assignment = assignmentMap.get(trainingId) ?? {};
    const completion = completionMap.get(trainingId) ?? {};
    const trainingType = normalizeTrainingType(training.trainingType);

    return {
      uid,
      trainingId,
      employeeName: user?.name ?? "-",
      empNo: user?.empNo ?? "-",
      companyName: user?.companyName ?? training.companyName ?? "-",
      branchName: user?.branchName ?? assignment.branchName ?? "-",
      title: training.title ?? assignment.trainingTitle ?? "-",
      trainingType,
      trainingTypeLabel: getTrainingTypeLabel(trainingType),
      assignedAt: assignment.assignedAt ?? null,
      startDate: training.startDate ?? null,
      endDate: training.endDate ?? null,
      completedAt: completion.completedAt ?? null,
      signedAt: completion.signedAt ?? null,
      signatureUrl: completion.signatureUrl ?? "",
      completionStatus: completion.status ?? assignment.status ?? "pending",
      instructorName: training.instructorName ?? "-",
      deadline: assignment.deadline ?? training.deadline ?? null,
      note: completion.note ?? "",
      // 엑셀 양식용: 초기/보수 구분 (직무교육은 initial/recurring 구분, 나머지는 "-")
      subType: training.subType ?? "",
    };
  });

  return {
    employee: user ? { uid, ...user } : null,
    rows: sortByRecent(rows, "completedAt"),
  };
}

/* ══════════════════════════════════════════════════════════
   ★ Step 1 신규: 교육 항목(Item) / 교육 회차(Session) 서비스
   기존 trainings 기반 함수는 위에 그대로 유지됨
   신규 함수는 이 아래에만 추가
══════════════════════════════════════════════════════════ */


/* ──────────────────────────────────────────────────────────
   교육 항목(Item) 상수 및 유틸
────────────────────────────────────────────────────────── */

/** 초기/보수 구분 */
export const ITEM_SUB_TYPES = ["initial", "recurring"];
export const ITEM_SUB_TYPE_LABELS = {
  initial:   "초기",
  recurring: "보수",
};

/** 회차 상태 */
export const SESSION_STATUS_LABELS = {
  scheduled:   "예정",
  in_progress: "진행중",
  completed:   "완료",
  closed:      "종료",
};

/**
 * 회차 computedStatus 계산
 * training과 동일한 로직 — status 필드 우선, 없으면 날짜 기반 계산
 */
export function computeSessionStatus(session, now = Date.now()) {
  if (!session) return "scheduled";
  if (session.status === "completed") return "completed";
  if (session.status === "closed")    return "closed";

  const { startDate, endDate } = session;
  if (startDate && endDate) {
    if (startDate > now) return "scheduled";
    if (endDate >= now)  return "in_progress";
    return "scheduled";
  }
  return "scheduled";
}

export function buildSessionStatusChip(status) {
  const tone = {
    scheduled:   "info",
    in_progress: "success",
    completed:   "success",
    closed:      "neutral",
  }[status] ?? "neutral";
  return `<span class="chip chip--${tone}">${SESSION_STATUS_LABELS[status] ?? status}</span>`;
}

/* ──────────────────────────────────────────────────────────
   교육 항목 CRUD
────────────────────────────────────────────────────────── */

/**
 * 교육 항목 생성
 * @param {object} values
 *   title, trainingType, subType, instructorId, instructorName,
 *   defaultHours, note, materialIds, companyId, companyName
 */
export async function createTrainingItem(values) {
  const now = Date.now();
  const payload = {
    title:          String(values.title ?? "").trim(),
    trainingType:   normalizeTrainingType(values.trainingType),
    subType:        values.subType ?? "",          // initial | recurring | ""
    subjectCode:    String(values.subjectCode ?? "").trim(),
    subjectName:    String(values.subjectName ?? values.title ?? "").trim(),
    cycleMonths:    Math.max(0, Number(values.cycleMonths ?? 0) || 0),
    instructorId:   values.instructorId ?? authStore.uid,
    instructorName: values.instructorName ?? authStore.name,
    defaultHours:   Number(values.defaultHours ?? 0),
    note:           String(values.note ?? "").trim(),
    materialIds:    Array.isArray(values.materialIds) ? values.materialIds : [],
    companyId:      values.companyId ?? authStore.companyId ?? null,
    companyName:    values.companyName ?? authStore.profile?.companyName ?? "",
    createdBy:      authStore.uid,
    createdByName:  authStore.name,
    createdAt:      now,
    updatedAt:      now,
  };

  const ref = await trainingItemsDB.create(payload);
  return ref.key;
}

/**
 * 교육 항목 수정
 */
export async function updateTrainingItem(itemId, values) {
  const payload = {
    title:          String(values.title ?? "").trim(),
    trainingType:   normalizeTrainingType(values.trainingType),
    subType:        values.subType ?? "",
    subjectCode:    String(values.subjectCode ?? "").trim(),
    subjectName:    String(values.subjectName ?? values.title ?? "").trim(),
    cycleMonths:    Math.max(0, Number(values.cycleMonths ?? 0) || 0),
    instructorId:   values.instructorId ?? "",
    instructorName: values.instructorName ?? "",
    defaultHours:   Number(values.defaultHours ?? 0),
    note:           String(values.note ?? "").trim(),
    materialIds:    Array.isArray(values.materialIds) ? values.materialIds : [],
    updatedBy:      authStore.uid,
    updatedByName:  authStore.name,
  };
  await trainingItemsDB.update(itemId, payload);
}

/**
 * 교육 항목 삭제 (연결된 회차도 함께 삭제)
 */
export async function deleteTrainingItem(itemId) {
  // 해당 항목의 모든 회차 조회 후 cascade 삭제
  const sessions = await trainingSessionsDB.listByItem(itemId);
  await Promise.all(sessions.map((s) => trainingSessionsDB.deleteCascade(s.id)));
  await trainingItemsDB.delete(itemId);
}

/**
 * 교육 항목 목록 조회 (강사 본인 또는 담당 항목)
 */
export async function listInstructorItems() {
  const uid       = authStore.uid;
  const companyId = authStore.companyId ?? null;

  const items = companyId
    ? await trainingItemsDB.list(companyId)
    : await trainingItemsDB.listAll();

  return sortByRecent(
    items.filter((item) => item.createdBy === uid || item.instructorId === uid),
    "createdAt"
  ).map(enrichItemRecord);
}

/**
 * 교육 항목 전체 목록 (HQ_ADMIN / SUPER_ADMIN)
 */
export async function listManagedItems() {
  const items = authStore.role === ROLES.SUPER_ADMIN
    ? await trainingItemsDB.listAll()
    : await trainingItemsDB.list(authStore.companyId);

  return sortByRecent(items, "createdAt").map(enrichItemRecord);
}

export function enrichItemRecord(item) {
  const trainingType = normalizeTrainingType(item.trainingType);
  return {
    ...item,
    trainingType,
    typeLabel:    getTrainingTypeLabel(trainingType),
    subTypeLabel: ITEM_SUB_TYPE_LABELS[item.subType] ?? "",
    subjectName:  item.subjectName ?? item.title ?? "",
    subjectCode:  item.subjectCode ?? "",
    cycleMonths:  Math.max(0, Number(item.cycleMonths ?? 0) || 0),
  };
}

/* ──────────────────────────────────────────────────────────
   교육 회차 CRUD
────────────────────────────────────────────────────────── */

/**
 * 교육 회차 생성
 * @param {object} values
 *   itemId, startDate, endDate, deadline, branchIds, branchNames,
 *   note, companyId, companyName
 *   (title, trainingType, instructorId, instructorName 은 항목에서 상속)
 */
export async function createTrainingSession(item, values) {
  if (!item?.id) throw new Error("createTrainingSession: itemId 가 필요합니다.");

  const now = Date.now();
  const status = computeSessionStatus({
    startDate: values.startDate,
    endDate:   values.endDate,
  });

  const payload = {
    itemId:         item.id,
    // 항목에서 상속
    title:          item.title ?? "",
    trainingType:   item.trainingType ?? "other",
    subType:        item.subType ?? "",
    subjectCode:    item.subjectCode ?? "",
    subjectName:    item.subjectName ?? item.title ?? "",
    cycleMonths:    Math.max(0, Number(item.cycleMonths ?? 0) || 0),
    instructorId:   item.instructorId ?? "",
    instructorName: item.instructorName ?? "",
    defaultHours:   item.defaultHours ?? 0,
    // 회차 고유 필드
    startDate:      values.startDate ?? null,
    endDate:        values.endDate   ?? null,
    deadline:       values.deadline  ?? null,
    branchIds:      Array.isArray(values.branchIds)   ? values.branchIds   : [],
    branchNames:    Array.isArray(values.branchNames) ? values.branchNames : [],
    note:           String(values.note ?? "").trim(),
    status,
    companyId:      values.companyId ?? item.companyId ?? authStore.companyId ?? null,
    companyName:    values.companyName ?? item.companyName ?? "",
    createdBy:      authStore.uid,
    createdByName:  authStore.name,
    createdAt:      now,
    updatedAt:      now,
  };

  const ref = await trainingSessionsDB.create(payload);
  return ref.key;
}

/**
 * 교육 회차 수정
 */
export async function updateTrainingSession(sessionId, values) {
  const status = computeSessionStatus({
    startDate: values.startDate,
    endDate:   values.endDate,
  });
  await trainingSessionsDB.update(sessionId, {
    startDate:   values.startDate ?? null,
    endDate:     values.endDate   ?? null,
    deadline:    values.deadline  ?? null,
    branchIds:   Array.isArray(values.branchIds)   ? values.branchIds   : [],
    branchNames: Array.isArray(values.branchNames) ? values.branchNames : [],
    note:        String(values.note ?? "").trim(),
    status,
    updatedBy:      authStore.uid,
    updatedByName:  authStore.name,
  });
}

/**
 * 교육 회차 종료
 */
export async function closeSession(sessionId) {
  await trainingSessionsDB.close(sessionId, {
    closedBy:     authStore.uid,
    closedByName: authStore.name,
  });
}

/**
 * 교육 회차 완료 처리
 * — 배정된 직원 전원에게 sessionCompletion 생성 (중복 방지)
 * — 이 기록이 직원 교육이력카드 PASS의 근거가 됨
 */
export async function completeSession(sessionId) {
  const [session, assignments, existing] = await Promise.all([
    trainingSessionsDB.get(sessionId),
    sessionAssignmentsDB.forSession(sessionId),
    sessionCompletionsDB.forSession(sessionId),
  ]);

  if (!session) throw new Error("회차 정보를 찾을 수 없습니다.");
  if (!assignments.length) throw new Error("NO_ASSIGNMENTS");

  const existingUids = new Set(existing.map((c) => c.uid));
  const now = Date.now();

  // 아직 완료 기록이 없는 직원만 생성 (중복 방지)
  const pending = assignments.filter((a) => !existingUids.has(a.uid));

  for (const assignment of pending) {
    await sessionCompletionsDB.complete(sessionId, assignment.uid, {
      itemId:          session.itemId ?? "",
      trainingTitle:   session.title ?? "",
      trainingType:    session.trainingType ?? "other",
      subType:         session.subType ?? "",
      subjectCode:     session.subjectCode ?? "",
      subjectName:     session.subjectName ?? session.title ?? "",
      cycleMonths:     Math.max(0, Number(session.cycleMonths ?? 0) || 0),
      hours:           Number(session.defaultHours ?? 0),
      instructorName:  session.instructorName ?? "",
      startDate:       session.startDate ?? null,
      endDate:         session.endDate   ?? null,
      completedAt:     now,
      completedBy:     authStore.uid,
      completedByName: authStore.name,
    });
  }

  await trainingSessionsDB.complete(sessionId, {
    completedBy:     authStore.uid,
    completedByName: authStore.name,
  });
}

/**
 * 교육 회차 삭제 (배정/수료 데이터 포함)
 */
export async function deleteSession(sessionId) {
  await trainingSessionsDB.deleteCascade(sessionId);
}

/* ──────────────────────────────────────────────────────────
   회차 대상자 배정
────────────────────────────────────────────────────────── */

/**
 * 회차에 직원 배정
 */
export async function assignEmployeesToSession(session, employeeIds, references = null) {
  const sessionId = session?.id;
  if (!sessionId) throw new Error("assignEmployeesToSession: sessionId 가 필요합니다.");

  const refs = references ?? await loadTrainingReferences();
  const users = refs.employees.filter((e) => employeeIds.includes(e.id ?? e.uid));
  if (!users.length) return;

  await sessionAssignmentsDB.assignUsers(sessionId, users, {
    assignedBy:   authStore.uid,
    sessionTitle: session.title ?? "",
    itemId:       session.itemId ?? "",
    deadline:     session.deadline ?? null,
  });
}

/**
 * 회차 배정 해제
 */
export async function unassignFromSession(sessionId, uid) {
  await sessionAssignmentsDB.remove(sessionId, uid);
}

/* ──────────────────────────────────────────────────────────
   회차 상세 조회 (배정/수료 포함)
────────────────────────────────────────────────────────── */

export async function getSessionDetail(sessionId) {
  const [session, assignments, completions, references] = await Promise.all([
    trainingSessionsDB.get(sessionId),
    sessionAssignmentsDB.forSession(sessionId),
    sessionCompletionsDB.forSession(sessionId),
    loadTrainingReferences(),
  ]);

  if (!session) return null;

  const usersById         = new Map(references.users.map((u) => [u.id ?? u.uid, u]));
  const completionsByUid  = new Map(completions.map((c) => [c.uid, c]));

  const assignmentRows = assignments.map((a) => {
    const user       = usersById.get(a.uid) ?? {};
    const completion = completionsByUid.get(a.uid);
    return {
      ...a,
      name:             a.employeeName ?? user.name ?? "-",
      empNo:            a.empNo ?? user.empNo ?? "-",
      companyName:      a.companyName ?? user.companyName ?? "-",
      branchName:       a.branchName ?? user.branchName ?? "-",
      completionStatus: completion?.status ?? "pending",
      completedAt:      completion?.completedAt ?? null,
    };
  }).sort((a, b) => Number(b.assignedAt ?? 0) - Number(a.assignedAt ?? 0));

  const completionRows = completions.map((c) => {
    const user = usersById.get(c.uid) ?? {};
    return {
      ...c,
      name:        user.name ?? "-",
      empNo:       user.empNo ?? "-",
      companyName: user.companyName ?? "-",
      branchName:  user.branchName ?? "-",
    };
  }).sort((a, b) => Number(b.completedAt ?? 0) - Number(a.completedAt ?? 0));

  return {
    session: {
      ...session,
      id: session.id ?? sessionId,
      computedStatus: computeSessionStatus(session),
    },
    item:        null,   // Step 2에서 항목 정보 연결
    references,
    assignments: assignmentRows,
    completions: completionRows,
  };
}

/* ──────────────────────────────────────────────────────────
   항목 상세 조회 (회차 목록 포함)
────────────────────────────────────────────────────────── */

export async function getItemDetail(itemId) {
  /* item과 sessions를 병렬 조회 — 어느 쪽이 실패해도 개별 처리 */
  const [itemResult, sessionsResult] = await Promise.allSettled([
    trainingItemsDB.get(itemId),
    trainingSessionsDB.listByItem(itemId),
  ]);

  const item     = itemResult.status === "fulfilled" ? itemResult.value : null;
  const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value : [];

  if (sessionsResult.status === "rejected") {
    console.warn("[training-service] getItemDetail: sessions 조회 실패", sessionsResult.reason?.message);
  }

  /* item이 null이면 sessions만으로 최소 결과 반환 (화면 렌더는 가능) */
  return {
    item: item ? enrichItemRecord({ ...item, id: item.id ?? itemId }) : null,
    sessions: sortByRecent(sessions, "startDate").map((s) => ({
      ...s,
      computedStatus: computeSessionStatus(s),
    })),
  };
}

/* ──────────────────────────────────────────────────────────
   직원 교육이력카드 — 회차 수료 기록 포함
   기존 buildEmployeeHistoryRows 는 위에 그대로 유지
   신규: buildEmployeeHistoryRowsV2 — 회차 기반 이력 포함
────────────────────────────────────────────────────────── */

export async function buildEmployeeHistoryRowsV2(uid) {
  const user = await assertEmployeeHistoryAccess(uid);
  const [
    legacyAssignments,
    legacyCompletions,
    legacyTrainings,
    sessionCompletionsList,
    manualHistories,
  ] = await Promise.all([
    assignmentsDB.forUser(uid),
    completionsDB.forUser(uid),
    authStore.role === ROLES.SUPER_ADMIN
      ? trainingsDB.listAll()
      : trainingsDB.list(authStore.companyId),
    sessionCompletionsDB.forUser(uid),
    manualTrainingHistoriesDB.forUser(uid),
  ]);

  // ── 기존 trainings 기반 행 (기존 buildEmployeeHistoryRows 와 동일)
  const trainingMap   = new Map(legacyTrainings.map((t) => [t.id, t]));
  const completionMap = new Map(legacyCompletions.map((c) => [c.trainingId, c]));
  const assignmentMap = new Map(legacyAssignments.map((a) => [a.trainingId, a]));
  const legacyIds     = Array.from(new Set([...assignmentMap.keys(), ...completionMap.keys()]));

  const legacyRows = legacyIds.map((trainingId) => {
    const training   = trainingMap.get(trainingId) ?? {};
    const assignment = assignmentMap.get(trainingId) ?? {};
    const completion = completionMap.get(trainingId) ?? {};
    const trainingType = normalizeTrainingType(training.trainingType);

    return {
      _source:         "legacy",         // 기존 trainings 기반임을 표시
      uid,
      trainingId,
      sessionId:       null,
      historyId:       null,
      subjectCode:     training.subjectCode ?? "",
      subjectName:     training.subjectName ?? training.title ?? assignment.trainingTitle ?? "",
      courseName:      training.courseName ?? training.title ?? assignment.trainingTitle ?? "",
      hours:           Number(training.hours ?? training.defaultHours ?? 0),
      cycleMonths:     Math.max(0, Number(training.cycleMonths ?? 0) || 0),
      employeeName:    user?.name ?? "-",
      empNo:           user?.empNo ?? "-",
      companyName:     user?.companyName ?? training.companyName ?? "-",
      branchName:      user?.branchName ?? assignment.branchName ?? "-",
      title:           training.title ?? assignment.trainingTitle ?? "-",
      trainingType,
      trainingTypeLabel: getTrainingTypeLabel(trainingType),
      subType:         training.subType ?? "",
      assignedAt:      assignment.assignedAt ?? null,
      startDate:       training.startDate ?? null,
      endDate:         training.endDate   ?? null,
      completedAt:     completion.completedAt ?? null,
      signedAt:        completion.signedAt ?? null,
      signatureUrl:    completion.signatureUrl ?? "",
      completionStatus: completion.status ?? assignment.status ?? "pending",
      instructorName:  training.instructorName ?? "-",
      deadline:        assignment.deadline ?? training.deadline ?? null,
      note:            completion.note ?? "",
    };
  });

  // ── 신규 sessions 기반 행
  const sessionRows = sessionCompletionsList.map((sc) => {
    const trainingType = normalizeTrainingType(sc.trainingType);
    return {
      _source:         "session",        // 신규 sessions 기반임을 표시
      uid,
      trainingId:      null,
      sessionId:       sc.sessionId,
      itemId:          sc.itemId ?? "",
      historyId:       null,
      subjectCode:     sc.subjectCode ?? "",
      subjectName:     sc.subjectName ?? sc.trainingTitle ?? "",
      courseName:      sc.courseName ?? sc.trainingTitle ?? "",
      hours:           Number(sc.hours ?? sc.defaultHours ?? 0),
      cycleMonths:     Math.max(0, Number(sc.cycleMonths ?? 0) || 0),
      employeeName:    user?.name ?? "-",
      empNo:           user?.empNo ?? "-",
      companyName:     user?.companyName ?? "-",
      branchName:      user?.branchName ?? "-",
      title:           sc.trainingTitle ?? "-",
      trainingType,
      trainingTypeLabel: getTrainingTypeLabel(trainingType),
      subType:         sc.subType ?? "",
      assignedAt:      null,
      startDate:       sc.startDate ?? null,
      endDate:         sc.endDate   ?? null,
      completedAt:     sc.completedAt ?? null,
      signedAt:        sc.completedAt ?? null,  // 회차 완료 = 서명 처리
      signatureUrl:    "",
      completionStatus: "completed",    // 회차 수료는 항상 PASS
      instructorName:  sc.instructorName ?? "-",
      deadline:        null,
      note:            sc.note ?? "",
    };
  });

  // ── 본사 교육관리자가 직접 입력/업로드한 개인 교육이력
  const manualRows = manualHistories.map((mh) => ({
    ...mh,
    _source: "manual",
    uid,
    historyId: mh.historyId ?? mh.id,
    trainingId: null,
    sessionId: null,
    employeeName: user?.name ?? mh.employeeName ?? "-",
    empNo: user?.empNo ?? mh.empNo ?? "-",
    companyName: user?.companyName ?? mh.companyName ?? "-",
    branchName: user?.branchName ?? mh.branchName ?? "-",
    title: mh.title ?? mh.courseName ?? mh.subjectName ?? "-",
    courseName: mh.courseName ?? mh.title ?? "-",
    subjectCode: mh.subjectCode ?? "",
    subjectName: mh.subjectName ?? mh.title ?? "-",
    trainingType: normalizeTrainingType(mh.trainingType),
    trainingTypeLabel: getTrainingTypeLabel(mh.trainingType),
    subType: mh.subType ?? "",
    hours: Number(mh.hours ?? 0),
    cycleMonths: Math.max(0, Number(mh.cycleMonths ?? 0) || 0),
    completionStatus: "completed",
    completedAt: mh.completedAt ?? null,
    instructorName: mh.instructorName ?? "-",
    note: mh.note ?? "",
  }));

  // ── 합산 후 교육별 최신 이력을 기준으로 재교육 예정일/잔여일 계산
  const allRows = applyDueMetadata([...legacyRows, ...sessionRows, ...manualRows]);

  return {
    employee: user ? { uid, ...user } : null,
    rows:     sortByRecent(allRows, "completedAt"),
  };
}
