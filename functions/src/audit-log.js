"use strict";

const SENSITIVE_KEY = /(password|token|secret|authorization|signedurl|downloadurl|r2|credential)/i;
const MAX_TEXT_LENGTH = 500;
const MAX_ARRAY_LENGTH = 30;
const MAX_OBJECT_KEYS = 40;

function text(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "string") return text(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return undefined;
  if (Array.isArray(value)) {
    const values = value.slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
    return values.length ? values : undefined;
  }
  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      if (SENSITIVE_KEY.test(key)) continue;
      const sanitized = sanitizeValue(item, depth + 1);
      if (sanitized !== undefined) result[key] = sanitized;
    }
    return Object.keys(result).length ? result : undefined;
  }
  return undefined;
}

function changedFields(before = {}, after = {}, allowedFields = []) {
  const previous = {};
  const next = {};
  for (const field of allowedFields) {
    const beforeValue = sanitizeValue(before?.[field]);
    const afterValue = sanitizeValue(after?.[field]);
    if (JSON.stringify(beforeValue ?? null) === JSON.stringify(afterValue ?? null)) continue;
    previous[field] = beforeValue ?? null;
    next[field] = afterValue ?? null;
  }
  return { before: previous, after: next };
}

function employeeTarget(employee = {}, uid = "") {
  return {
    type: "EMPLOYEE",
    uid: text(uid || employee.uid),
    name: text(employee.name),
    empNo: text(employee.empNo),
    branchId: text(employee.branchId),
    branchName: text(employee.branchName),
  };
}

function trainingHistorySnapshot(record = {}) {
  return sanitizeValue({
    historyId: record.historyId || record.id,
    source: record.source || record._source,
    trainingType: record.trainingType,
    subType: record.subType || record.educationStage || record.educationType,
    courseName: record.courseName || record.title,
    subjectName: record.subjectName,
    completedAt: record.completedAt,
    startDate: record.startDate,
    endDate: record.endDate,
    instructorName: record.instructorName,
    hours: record.hours,
    result: record.result,
    note: record.note || record.remarks || record.comment,
  }) ?? {};
}

function createAuditLogger({ db, logger, resolveCompanyId }) {
  async function writeAuditLog(payload = {}) {
    const actor = payload.actor ?? {};
    const target = payload.target ?? {};
    const companyId = text(payload.companyId || actor.companyId || await resolveCompanyId(actor));
    if (!companyId) throw new Error("감사 로그 companyId를 결정할 수 없습니다.");

    const logId = db.ref("auditLogs").push().key;
    const record = {
      companyId,
      action: text(payload.action, 80),
      category: text(payload.category, 80),
      actorUid: text(actor.uid),
      actorName: text(actor.name),
      actorRole: text(actor.role),
      actorBranchId: text(actor.branchId),
      actorBranchName: text(actor.branchName),
      targetType: text(target.type),
      targetUid: text(target.uid),
      targetName: text(target.name),
      targetEmpNo: text(target.empNo),
      targetBranchId: text(target.branchId),
      targetBranchName: text(target.branchName),
      summary: text(payload.summary, 300),
      status: text(payload.status || "SUCCESS", 40),
      createdAt: Date.now(),
    };
    const before = sanitizeValue(payload.before);
    const after = sanitizeValue(payload.after);
    const metadata = sanitizeValue(payload.metadata);
    if (before) record.before = before;
    if (after) record.after = after;
    if (metadata) record.metadata = metadata;

    await db.ref(`auditLogs/${logId}`).set(record);
    return { logId, ...record };
  }

  async function writeAuditLogSafe(payload) {
    try {
      return await writeAuditLog(payload);
    } catch (error) {
      logger.error("[audit] write failed", {
        action: payload?.action,
        actorUid: payload?.actor?.uid,
        targetUid: payload?.target?.uid,
        message: error?.message,
      });
      return null;
    }
  }

  async function listCompanyAuditLogs({ companyId, limit = 100, beforeCreatedAt, from, to, action, status, branchId, actorName, targetQuery }) {
    const pageSize = Math.min(Math.max(Number(limit) || 100, 1), 100);
    const scanLimit = Math.min(Math.max(pageSize * 5, 100), 500);
    let query = db.ref("auditLogs").orderByChild("createdAt");
    const upperBound = Number(beforeCreatedAt || to || Date.now());
    if (Number.isFinite(upperBound)) query = query.endAt(upperBound);
    if (Number(from) > 0) query = query.startAt(Number(from));
    const snap = await query.limitToLast(scanLimit).get();
    const actorNeedle = text(actorName).toLowerCase();
    const targetNeedle = text(targetQuery).toLowerCase();
    const rows = [];
    snap.forEach((child) => {
      const row = { id: child.key, ...child.val() };
      if (text(row.companyId) !== text(companyId)) return;
      if (action && text(row.action) !== text(action)) return;
      if (status && text(row.status) !== text(status)) return;
      if (branchId && ![row.actorBranchId, row.targetBranchId].map(text).includes(text(branchId))) return;
      if (actorNeedle && !text(row.actorName).toLowerCase().includes(actorNeedle)) return;
      if (targetNeedle && ![row.targetName, row.targetEmpNo, row.summary].some((value) => text(value).toLowerCase().includes(targetNeedle))) return;
      rows.push(row);
    });
    rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const page = rows.slice(0, pageSize);
    return {
      logs: page,
      nextCursor: page.length === pageSize ? Number(page[page.length - 1].createdAt || 0) - 1 : null,
      limit: pageSize,
    };
  }

  return { writeAuditLog, writeAuditLogSafe, listCompanyAuditLogs };
}

module.exports = {
  changedFields,
  createAuditLogger,
  employeeTarget,
  sanitizeValue,
  trainingHistorySnapshot,
};
