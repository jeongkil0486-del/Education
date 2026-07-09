/**
 * material-service.js — 교육자료 서비스
 *
 * 파일 저장 구조:
 *   PDF 파일    → Cloudflare R2  (presigned PUT URL 직접 업로드)
 *   메타 + URL  → Firebase RTDB  /materials/{materialId}
 *
 * 업로드 흐름:
 *   1. requestUploadUrl()   — createMaterialUploadUrl Function 호출
 *                             → { uploadUrl, publicUrl, materialId, key }
 *   2. putFileToR2()        — 브라우저 XHR PUT으로 R2에 직접 전송 (진행률 콜백 포함)
 *   3. saveMaterialMeta()   — Firebase DB에 메타+URL만 저장 (파일 본문 저장 없음)
 *
 * Firebase DB에는 base64/DataURL을 절대 저장하지 않습니다.
 */

import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { authStore, ROLES } from "../core/auth.js";
import { materialsDB }      from "../core/db.js";

/** window.__firebase.functions 는 index.html에서 getFunctions(app) 으로 초기화됨 */
const { functions } = window.__firebase;

/* ══════════════════════════════════════════════════════════
   상수
══════════════════════════════════════════════════════════ */
export const MATERIAL_TYPES = ["initial", "recurring", "external", "online", "other"];

export const MATERIAL_TYPE_LABELS = {
  initial:   "초기교육",
  recurring: "정기교육",
  external:  "외부교육",
  online:    "온라인교육",
  other:     "기타",
};

export const ALLOWED_MIME  = ["application/pdf"];
export const ALLOWED_EXT   = ".pdf";
export const MAX_FILE_SIZE = 50 * 1024 * 1024;   // 50 MB

/* ══════════════════════════════════════════════════════════
   유틸
══════════════════════════════════════════════════════════ */
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

/* ══════════════════════════════════════════════════════════
   파일 유효성 검사 (클라이언트 사전 검증)
══════════════════════════════════════════════════════════ */
/** @returns {string|null} 오류 메시지 또는 null(정상) */
export function validateFile(file) {
  if (!file)                             return "파일을 선택해 주세요.";
  if (!ALLOWED_MIME.includes(file.type)) return "PDF 파일만 업로드할 수 있습니다.";
  if (file.size <= 0)                    return "파일이 비어 있습니다.";
  if (file.size > MAX_FILE_SIZE)
    return `파일 크기가 너무 큽니다. 최대 ${formatFileSize(MAX_FILE_SIZE)} 이하.`;
  return null;
}

/* ══════════════════════════════════════════════════════════
   Step 1 — presigned PUT URL 요청
   Firebase Function: createMaterialUploadUrl
   반환: { uploadUrl, publicUrl, materialId, key }
══════════════════════════════════════════════════════════ */
/**
 * @param {File} file
 * @returns {Promise<{ uploadUrl: string, publicUrl: string, materialId: string, key: string }>}
 */
export async function requestUploadUrl(file) {
  const fn = httpsCallable(functions, "createMaterialUploadUrl");

  let result;
  try {
    result = await fn({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
  } catch (err) {
    console.error("[material-service] requestUploadUrl failed",
      { code: err?.code, message: err?.message }, err);
    const e   = new Error(err?.message ?? "presigned URL 요청에 실패했습니다.");
    e.code    = err?.code ?? "functions/unknown";
    throw e;
  }

  const { uploadUrl, publicUrl, materialId, key } = result.data ?? {};
  if (!uploadUrl || !publicUrl || !materialId) {
    throw new Error("서버에서 업로드 URL을 받지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  return { uploadUrl, publicUrl, materialId, key };
}

/* ══════════════════════════════════════════════════════════
   Step 2 — 브라우저 → R2 PUT 업로드
   XHR을 사용해 진행률(onProgress)을 추적합니다.
   Firebase를 경유하지 않으므로 DB에 파일 본문이 저장되지 않습니다.
══════════════════════════════════════════════════════════ */
/**
 * @param {string} uploadUrl  presigned PUT URL (Function이 발급)
 * @param {File}   file
 * @param {{ onProgress?: (pct: number) => void }} [opts]
 * @returns {Promise<void>}
 */
export function putFileToR2(uploadUrl, file, opts = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);

    if (opts.onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          opts.onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener("load", () => {
      // R2 presigned PUT 성공: 200 또는 204
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        const e  = new Error(`R2 업로드 실패 (HTTP ${xhr.status})`);
        e.code   = `r2/http-${xhr.status}`;
        reject(e);
      }
    });

    xhr.addEventListener("error",   () => reject(new Error("R2 업로드 중 네트워크 오류가 발생했습니다.")));
    xhr.addEventListener("abort",   () => reject(new Error("R2 업로드가 취소되었습니다.")));
    xhr.addEventListener("timeout", () => reject(new Error("R2 업로드 시간이 초과되었습니다.")));

    xhr.timeout = 10 * 60 * 1000;  // 10분 (대용량 PDF 대비)
    xhr.send(file);
  });
}

/* ══════════════════════════════════════════════════════════
   Step 3 — Firebase DB에 메타 저장
   R2 업로드 성공 후에만 호출합니다.
   저장 필드: title / trainingType / description /
             fileName / fileSize / fileType / url /
             uploadedBy / uploadedByName / createdAt
   ※ 파일 본문(base64/DataURL)은 절대 저장하지 않습니다.
══════════════════════════════════════════════════════════ */
/**
 * @param {string} materialId   requestUploadUrl이 반환한 materialId
 * @param {{ title, trainingType, description }} values
 * @param {{ publicUrl, key, fileName, fileSize, fileType }} fileInfo
 * @returns {Promise<void>}
 */
export async function saveMaterialMeta(materialId, values, fileInfo) {
  // materialId는 Function이 DB.push()로 사전 생성한 키이므로 update() 사용
  await materialsDB.update(materialId, {
    title:          values.title.trim(),
    trainingType:   values.trainingType,
    description:    values.description?.trim() ?? "",
    fileName:       fileInfo.fileName,
    fileType:       fileInfo.fileType,
    fileSize:       fileInfo.fileSize,
    url:            fileInfo.publicUrl,   // R2 공개 URL (다운로드에 사용)
    r2Key:          fileInfo.key ?? "",   // 추후 R2 파일 삭제 시 활용
    companyId:      authStore.companyId ?? null,
    uploadedBy:     authStore.uid,
    uploadedByName: authStore.name,
    createdAt:      Date.now(),
  });
}

/* ══════════════════════════════════════════════════════════
   uploadMaterial — 1·2·3 통합
══════════════════════════════════════════════════════════ */
/**
 * @param {{ title, trainingType, description }} values
 * @param {File}   file
 * @param {{ onProgress?: (label: string, pct: number) => void }} [opts]
 * @returns {Promise<string>} materialId
 */
export async function uploadMaterial(values, file, opts = {}) {
  const notify = (label, pct) => opts.onProgress?.(label, pct);

  // 1) presigned URL 요청
  notify("업로드 URL 요청 중…", 5);
  const { uploadUrl, publicUrl, materialId, key } = await requestUploadUrl(file);

  // 2) R2 직접 PUT 업로드 (진행률: 10 ~ 90%)
  await putFileToR2(uploadUrl, file, {
    onProgress: (pct) => notify("R2에 업로드 중…", 10 + Math.round(pct * 0.8)),
  });

  // 3) Firebase DB에 메타 저장
  notify("저장 중…", 95);
  await saveMaterialMeta(materialId, values, {
    publicUrl,
    key,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
  });

  notify("완료", 100);
  return materialId;
}

/* ══════════════════════════════════════════════════════════
   교육자료 목록 조회
══════════════════════════════════════════════════════════ */
export async function listMaterials() {
  const companyId = authStore.companyId;
  const items = (authStore.role === ROLES.SUPER_ADMIN || !companyId)
    ? await materialsDB.listAll()
    : await materialsDB.list(companyId);

  return items
    .map(m => ({ ...m, typeLabel: MATERIAL_TYPE_LABELS[m.trainingType] ?? "기타" }))
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
}

/* ══════════════════════════════════════════════════════════
   교육자료 삭제 (Firebase 메타만 삭제)
   ※ R2 실제 파일은 r2Key를 이용해 별도 Function으로 삭제 가능 (추후 확장)
══════════════════════════════════════════════════════════ */
export async function deleteMaterial(id) {
  await materialsDB.delete(id);
}
