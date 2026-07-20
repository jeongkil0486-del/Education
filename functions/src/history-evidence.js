"use strict";

const crypto = require("crypto");

const HISTORY_EVIDENCE_MAX_FILE_SIZE = 50 * 1024 * 1024;
const HISTORY_EVIDENCE_MIME = "application/pdf";
const HISTORY_EVIDENCE_PREFIX = "history-evidence";
const HISTORY_EVIDENCE_SOURCES = new Set(["manual", "session", "legacy"]);

function text(value) {
  return String(value ?? "").trim();
}

function safeSegment(value, fallback = "unknown") {
  const normalized = text(value)
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 160);
  return normalized || fallback;
}

function assertHistoryEvidenceRecordId(value, label = "교육이력 ID") {
  const recordId = text(value);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(recordId)) {
    const error = new Error(`${label}가 올바르지 않습니다.`);
    error.code = "invalid-history-id";
    throw error;
  }
  return recordId;
}

function normalizeHistoryEvidenceRef(input = {}) {
  const source = text(input.source).toLowerCase();
  if (!HISTORY_EVIDENCE_SOURCES.has(source)) {
    const error = new Error("지원하지 않는 교육이력 유형입니다.");
    error.code = "invalid-history-source";
    throw error;
  }

  const rawRecordId = source === "manual"
    ? input.historyId ?? input.recordId
    : source === "session"
      ? input.sessionId ?? input.recordId
      : input.trainingId ?? input.recordId;
  const recordId = assertHistoryEvidenceRecordId(rawRecordId);

  return {
    source,
    recordId,
    historyRefKey: `${source}:${recordId}`,
  };
}

function historyEvidenceId(employeeUid, source, recordId) {
  const uid = assertHistoryEvidenceRecordId(employeeUid, "직원 UID");
  const ref = normalizeHistoryEvidenceRef({ source, recordId });
  const digest = crypto
    .createHash("sha256")
    .update(`${uid}|${ref.source}|${ref.recordId}`)
    .digest("hex");
  return `he_${digest.slice(0, 40)}`;
}

function buildHistoryEvidenceR2Key({ companyId, employeeUid, evidenceId, objectId }) {
  const safeEvidenceId = text(evidenceId);
  if (!/^he_[a-f0-9]{40}$/.test(safeEvidenceId)) {
    const error = new Error("증빙 ID가 올바르지 않습니다.");
    error.code = "invalid-evidence-id";
    throw error;
  }
  const safeObjectId = text(objectId).replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/i.test(safeObjectId)) {
    const error = new Error("증빙 객체 ID가 올바르지 않습니다.");
    error.code = "invalid-object-id";
    throw error;
  }
  return [
    HISTORY_EVIDENCE_PREFIX,
    safeSegment(companyId, "company"),
    safeSegment(employeeUid, "employee"),
    safeEvidenceId,
    `${safeObjectId.toLowerCase()}.pdf`,
  ].join("/");
}

function isAllowedHistoryEvidenceR2Key({ companyId, employeeUid, evidenceId, key }) {
  const prefix = [
    HISTORY_EVIDENCE_PREFIX,
    safeSegment(companyId, "company"),
    safeSegment(employeeUid, "employee"),
    text(evidenceId),
    "",
  ].join("/");
  return text(key).startsWith(prefix)
    && new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-f0-9]{32}\\.pdf$`).test(text(key));
}

function validateHistoryEvidenceFile({ fileName, fileType, fileSize }) {
  const normalizedName = text(fileName);
  const normalizedType = text(fileType).toLowerCase();
  const normalizedSize = Number(fileSize);
  if (!normalizedName.toLowerCase().endsWith(".pdf") || normalizedType !== HISTORY_EVIDENCE_MIME) {
    return "교육 증빙은 PDF 파일만 업로드할 수 있습니다.";
  }
  if (!Number.isFinite(normalizedSize) || normalizedSize <= 0) {
    return "비어 있는 PDF 파일은 업로드할 수 없습니다.";
  }
  if (normalizedSize > HISTORY_EVIDENCE_MAX_FILE_SIZE) {
    return "교육 증빙 PDF는 최대 50MB까지 업로드할 수 있습니다.";
  }
  return "";
}

function publicHistoryEvidenceMetadata(record = {}) {
  return {
    evidenceId: text(record.evidenceId),
    historySource: text(record.historySource),
    sourceRecordId: text(record.sourceRecordId),
    historyRefKey: text(record.historyRefKey),
    hasEvidence: Boolean(record.r2Key),
    fileName: text(record.fileName),
    contentType: text(record.contentType || HISTORY_EVIDENCE_MIME),
    sizeBytes: Number(record.sizeBytes) || 0,
    uploadedAt: Number(record.uploadedAt) || 0,
    uploadedByName: text(record.uploadedByName),
    updatedAt: Number(record.updatedAt) || 0,
    updatedByName: text(record.updatedByName),
  };
}

module.exports = {
  HISTORY_EVIDENCE_MAX_FILE_SIZE,
  HISTORY_EVIDENCE_MIME,
  HISTORY_EVIDENCE_PREFIX,
  buildHistoryEvidenceR2Key,
  historyEvidenceId,
  isAllowedHistoryEvidenceR2Key,
  normalizeHistoryEvidenceRef,
  publicHistoryEvidenceMetadata,
  validateHistoryEvidenceFile,
};
