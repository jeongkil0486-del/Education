"use strict";

const assert = require("node:assert/strict");
const {
  HISTORY_EVIDENCE_MAX_FILE_SIZE,
  buildHistoryEvidenceR2Key,
  historyEvidenceId,
  isAllowedHistoryEvidenceR2Key,
  normalizeHistoryEvidenceRef,
  publicHistoryEvidenceMetadata,
  validateHistoryEvidenceFile,
} = require("../src/history-evidence");

assert.deepEqual(
  normalizeHistoryEvidenceRef({ source: "manual", historyId: "history_1" }),
  { source: "manual", recordId: "history_1", historyRefKey: "manual:history_1" }
);
assert.deepEqual(
  normalizeHistoryEvidenceRef({ source: "session", sessionId: "session_1" }),
  { source: "session", recordId: "session_1", historyRefKey: "session:session_1" }
);
assert.deepEqual(
  normalizeHistoryEvidenceRef({ source: "legacy", trainingId: "training_1" }),
  { source: "legacy", recordId: "training_1", historyRefKey: "legacy:training_1" }
);
assert.throws(() => normalizeHistoryEvidenceRef({ source: "unknown", recordId: "record_1" }));
assert.throws(() => normalizeHistoryEvidenceRef({ source: "manual", historyId: "../record" }));

const employeeUid = "employee_uid_1";
const evidenceId = historyEvidenceId(employeeUid, "manual", "history_1");
assert.match(evidenceId, /^he_[a-f0-9]{40}$/);
assert.equal(evidenceId, historyEvidenceId(employeeUid, "manual", "history_1"));
assert.notEqual(evidenceId, historyEvidenceId("employee_uid_2", "manual", "history_1"));
assert.notEqual(evidenceId, historyEvidenceId(employeeUid, "session", "history_1"));

const key = buildHistoryEvidenceR2Key({
  companyId: "company_1",
  employeeUid,
  evidenceId,
  objectId: "12345678-1234-1234-1234-1234567890ab",
});
assert.equal(
  key,
  `history-evidence/company_1/${employeeUid}/${evidenceId}/123456781234123412341234567890ab.pdf`
);
assert.equal(isAllowedHistoryEvidenceR2Key({
  companyId: "company_1",
  employeeUid,
  evidenceId,
  key,
}), true);
assert.equal(isAllowedHistoryEvidenceR2Key({
  companyId: "company_1",
  employeeUid: "different_employee",
  evidenceId,
  key,
}), false);

assert.equal(validateHistoryEvidenceFile({
  fileName: "교육 증빙.pdf",
  fileType: "application/pdf",
  fileSize: 1024,
}), "");
assert.match(validateHistoryEvidenceFile({
  fileName: "교육 증빙.png",
  fileType: "image/png",
  fileSize: 1024,
}), /PDF/);
assert.match(validateHistoryEvidenceFile({
  fileName: "교육 증빙.pdf",
  fileType: "application/pdf",
  fileSize: 0,
}), /비어/);
assert.match(validateHistoryEvidenceFile({
  fileName: "교육 증빙.pdf",
  fileType: "application/pdf",
  fileSize: HISTORY_EVIDENCE_MAX_FILE_SIZE + 1,
}), /50MB/);

const publicMetadata = publicHistoryEvidenceMetadata({
  evidenceId,
  historySource: "manual",
  sourceRecordId: "history_1",
  historyRefKey: "manual:history_1",
  r2Key: key,
  fileName: "교육 증빙.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
  uploadedAt: 100,
  uploadedByName: "담당자",
  uploadedByUid: "private_uid",
});
assert.equal(publicMetadata.hasEvidence, true);
assert.equal(publicMetadata.fileName, "교육 증빙.pdf");
assert.equal("r2Key" in publicMetadata, false);
assert.equal("uploadedByUid" in publicMetadata, false);

console.log("history evidence tests passed");
