import { authStore, ROLES } from "../core/auth.js";
import {
  assignmentsDB,
  branchesDB,
  completionsDB,
  templatesDB,
  trainingsDB,
  usersDB,
} from "../core/db.js";

/** 수료기한 임박 기준: 오늘 포함 N일 이내 */
export const DEADLINE_SOON_DAYS = 3;

export const TRAINING_TYPES = [
  "initial",
  "recurring",
  "external",
  "online",
  "other",
];

export const TRAINING_TYPE_LABELS = {
  initial:   "초기교육",
  recurring: "정기교육",
  external:  "외부교육",
  online:    "온라인교육",
  other:     "기타",
};

export const TRAINING_STATUS_LABELS = {
  scheduled: "예정",
  in_progress: "진행중",
  closed: "종료",
  overdue: "기한초과",
  completed: "완료",
};

export function getTrainingTypeLabel(type) {
  return TRAINING_TYPE_LABELS[type] ?? "기타";
}

export function computeTrainingStatus(training, now = Date.now()) {
  if (!training) return "scheduled";
  if (training.status === "completed" || training.completedAt) return "completed";
  if (training.status === "closed" || training.closedAt) return "closed";
  if (training.deadline && training.deadline < now) return "overdue";
  if (training.startDate && training.startDate > now) return "scheduled";
  return "in_progress";
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

export async function loadTrainingReferences() {
  const [branches, allUsers, templates] = await Promise.all([
    branchesDB.listAll(),
    usersDB.listAll(),
    templatesDB.list(authStore.companyId),
  ]);

  const companyId = authStore.companyId ?? null;
  const users = allUsers.filter((user) => {
    if (authStore.role === ROLES.SUPER_ADMIN || !companyId) return true;
    return user.companyId === companyId || !user.companyId;
  });
  const filteredBranches = branches.filter((branch) => !companyId || branch.companyId === companyId);
  const employees = users.filter((user) => user.role === ROLES.EMPLOYEE);
  const instructors = users.filter((user) => user.role === ROLES.INSTRUCTOR);

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

/**
 * 수료기한 임박 여부 (status가 overdue가 아닌 것 중, deadline이 DEADLINE_SOON_DAYS일 이내)
 */
export function isDeadlineSoon(training, now = Date.now()) {
  if (!training?.deadline) return false;
  const status = computeTrainingStatus(training, now);
  if (status === "closed" || status === "overdue") return false;
  const diffMs = training.deadline - now;
  return diffMs >= 0 && diffMs <= DEADLINE_SOON_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * hq_admin: 전체 교육 목록 조회 (등록 권한 없음)
 * super_admin: 전체 조회
 */
export async function listManagedTrainings() {
  const trainings = authStore.role === ROLES.SUPER_ADMIN
    ? await trainingsDB.listAll()
    : await trainingsDB.list(authStore.companyId);

  return sortByRecent(trainings, "createdAt").map(enrichTrainingRecord);
}

/**
 * instructor: 본인이 등록(createdBy)하거나 담당 강사(instructorId)인 교육 목록
 */
export async function listInstructorTrainings() {
  const uid = authStore.uid;
  const companyId = authStore.companyId ?? null;

  const allTrainings = companyId
    ? await trainingsDB.list(companyId)
    : await trainingsDB.listAll();

  const myTrainings = allTrainings.filter(
    (t) => t.createdBy === uid || t.instructorId === uid
  );

  return sortByRecent(myTrainings, "createdAt").map(enrichTrainingRecord);
}

export function enrichTrainingRecord(training) {
  const status = computeTrainingStatus(training);
  return {
    ...training,
    computedStatus: status,
    computedStatusLabel: TRAINING_STATUS_LABELS[status],
    typeLabel: getTrainingTypeLabel(training.trainingType),
  };
}

export function buildTrainingPayload(values, references, currentTraining = null) {
  const selectedBranchIds = Array.from(new Set(values.branchIds.filter(Boolean)));
  const branchMap = new Map(references.branches.map((branch) => [branch.id, branch]));
  const selectedBranches = selectedBranchIds
    .map((branchId) => branchMap.get(branchId))
    .filter(Boolean);
  const selectedInstructor = references.instructors.find((user) => (user.id ?? user.uid) === values.instructorId);
  const computedStatus = currentTraining?.status === "closed"
    ? "closed"
    : computeTrainingStatus({
        ...currentTraining,
        startDate: values.startDate,
        deadline: values.deadline,
      });

  return {
    title: values.title,
    trainingType: values.trainingType,
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
    training: enrichTrainingRecord(training),
    references,
    assignments: assignmentRows,
    completions: completionRows,
  };
}

export async function assignEmployees(training, employeeIds, references = null) {
  const refs = references ?? await loadTrainingReferences();
  const selectedUsers = refs.employees.filter((employee) => employeeIds.includes(employee.id ?? employee.uid));
  await assignmentsDB.assignUsers(training.id, selectedUsers, {
    assignedBy: authStore.uid,
    status: "pending",
    trainingTitle: training.title,
    deadline: training.deadline ?? null,
  });
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
  const completions = await completionsDB.forUser(authStore.uid);
  return sortByRecent(completions, "completedAt");
}

export async function buildEmployeeHistoryRows(uid) {
  const [user, assignments, completions, trainings] = await Promise.all([
    usersDB.get(uid),
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

    return {
      uid,
      trainingId,
      employeeName: user?.name ?? "-",
      empNo: user?.empNo ?? "-",
      companyName: user?.companyName ?? training.companyName ?? "-",
      branchName: user?.branchName ?? assignment.branchName ?? "-",
      title: training.title ?? assignment.trainingTitle ?? "-",
      trainingType: training.trainingType ?? "other",
      trainingTypeLabel: getTrainingTypeLabel(training.trainingType),
      assignedAt: assignment.assignedAt ?? null,
      completedAt: completion.completedAt ?? null,
      signedAt: completion.signedAt ?? null,
      signatureUrl: completion.signatureUrl ?? "",
      completionStatus: completion.status ?? assignment.status ?? "pending",
      instructorName: training.instructorName ?? "-",
      deadline: assignment.deadline ?? training.deadline ?? null,
      note: completion.note ?? "",
      startDate: training.startDate ?? null,
      endDate: training.endDate ?? null,
      subType: training.subType ?? "",
    };
  });

  return {
    employee: user ? { uid, ...user } : null,
    rows: sortByRecent(rows, "completedAt"),
  };
}
