import { authStore, ROLES } from "../core/auth.js";
import {
  assignmentsDB,
  branchesDB,
  completionsDB,
  templatesDB,
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

export function isDeadlineSoon(training, now = Date.now()) {
  if (!training?.deadline) return false;
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
  const computedStatus = currentTraining?.status === "closed"
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
      completedAt: completion.completedAt ?? null,
      signedAt: completion.signedAt ?? null,
      signatureUrl: completion.signatureUrl ?? "",
      completionStatus: completion.status ?? assignment.status ?? "pending",
      instructorName: training.instructorName ?? "-",
      deadline: assignment.deadline ?? training.deadline ?? null,
      note: completion.note ?? "",
    };
  });

  return {
    employee: user ? { uid, ...user } : null,
    rows: sortByRecent(rows, "completedAt"),
  };
}
