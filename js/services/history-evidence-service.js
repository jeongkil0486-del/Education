import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { putFileToR2 } from "./material-service.js";

const { functions } = window.__firebase;

export const HISTORY_EVIDENCE_MAX_FILE_SIZE = 50 * 1024 * 1024;
export const HISTORY_EVIDENCE_MIME = "application/pdf";

const listHistoryEvidenceCallable = httpsCallable(functions, "listHistoryEvidence");
const createHistoryEvidenceUploadUrlCallable = httpsCallable(functions, "createHistoryEvidenceUploadUrl");
const finalizeHistoryEvidenceUploadCallable = httpsCallable(functions, "finalizeHistoryEvidenceUpload");
const getHistoryEvidenceDownloadUrlCallable = httpsCallable(functions, "getHistoryEvidenceDownloadUrl");
const deleteHistoryEvidenceCallable = httpsCallable(functions, "deleteHistoryEvidence");

function text(value) {
  return String(value ?? "").trim();
}

export function historyEvidenceRef(row = {}) {
  const source = text(row._source || row.source).toLowerCase();
  const completionStatus = text(row.completionStatus || row.status).toLowerCase();
  if (source === "legacy"
    && !["completed", "pass", "수료", "완료"].includes(completionStatus)) {
    return null;
  }
  const recordId = source === "manual"
    ? text(row.historyId || row.id)
    : source === "session"
      ? text(row.sessionId)
      : source === "legacy"
        ? text(row.trainingId)
        : "";
  if (!["manual", "session", "legacy"].includes(source) || !recordId) return null;
  return {
    source,
    recordId,
    historyRefKey: `${source}:${recordId}`,
    historyId: source === "manual" ? recordId : "",
    sessionId: source === "session" ? recordId : "",
    trainingId: source === "legacy" ? recordId : "",
  };
}

export function validateHistoryEvidenceFile(file) {
  if (!file) return "PDF 파일을 선택해 주세요.";
  const fileName = text(file.name).toLowerCase();
  const fileType = text(file.type).toLowerCase();
  const fileSize = Number(file.size);
  if (!fileName.endsWith(".pdf") || fileType !== HISTORY_EVIDENCE_MIME) {
    return "교육 증빙은 PDF 파일만 업로드할 수 있습니다.";
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return "비어 있는 PDF 파일은 업로드할 수 없습니다.";
  }
  if (fileSize > HISTORY_EVIDENCE_MAX_FILE_SIZE) {
    return "교육 증빙 PDF는 최대 50MB까지 업로드할 수 있습니다.";
  }
  return "";
}

function requestPayload(employeeUid, row) {
  const ref = historyEvidenceRef(row);
  if (!employeeUid || !ref) throw new Error("증빙을 연결할 교육이력 ID를 확인할 수 없습니다.");
  return {
    employeeUid,
    source: ref.source,
    historyId: ref.historyId,
    sessionId: ref.sessionId,
    trainingId: ref.trainingId,
  };
}

export async function listHistoryEvidence(employeeUid) {
  const result = await listHistoryEvidenceCallable({ employeeUid });
  return Array.isArray(result.data?.items) ? result.data.items : [];
}

export async function uploadHistoryEvidence({ employeeUid, row, file, onProgress }) {
  const validationMessage = validateHistoryEvidenceFile(file);
  if (validationMessage) throw new Error(validationMessage);
  const payload = requestPayload(employeeUid, row);

  onProgress?.("업로드 준비 중", 5);
  const createResult = await createHistoryEvidenceUploadUrlCallable({
    ...payload,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  });
  const { uploadId, uploadUrl } = createResult.data ?? {};
  if (!uploadId || !uploadUrl) throw new Error("교육 증빙 업로드 URL을 받지 못했습니다.");

  await putFileToR2(uploadUrl, file, {
    onProgress: (percent) => onProgress?.("PDF 업로드 중", 10 + Math.round(percent * 0.8)),
  });

  onProgress?.("업로드 확인 중", 95);
  const finalizeResult = await finalizeHistoryEvidenceUploadCallable({ uploadId });
  onProgress?.("완료", 100);
  return finalizeResult.data;
}

export async function getHistoryEvidenceDownloadUrl({ employeeUid, row, disposition = "inline" }) {
  const result = await getHistoryEvidenceDownloadUrlCallable({
    ...requestPayload(employeeUid, row),
    disposition,
  });
  if (!result.data?.downloadUrl) throw new Error("교육 증빙 보기 URL을 받지 못했습니다.");
  return result.data;
}

export async function deleteHistoryEvidence({ employeeUid, row }) {
  const result = await deleteHistoryEvidenceCallable(requestPayload(employeeUid, row));
  return result.data;
}
