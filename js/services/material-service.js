/**
 * material-service.js — 교육자료 서비스
 *
 * 파일 저장 구조:
 *   PDF 파일     → Cloudflare R2  (presigned PUT URL 사용)
 *   메타 + URL   → Firebase RTDB  /materials/{materialId}
 *
 * 업로드 흐름:
 *   1. createMaterialUploadUrl (Firebase Function 호출)
 *      → { uploadUrl, publicUrl, materialId, key } 반환
 *   2. 브라우저에서 uploadUrl로 PUT 요청 (파일 직접 전송)
 *   3. 업로드 성공 후 saveMaterialMeta로 Firebase DB에 메타 저장
 *
 * Firebase DB에는 base64/DataURL을 절대 저장하지 않습니다.
 *
 * 교육 연결 확장:
 *   training 문서에 materialIds: string[] 배열 추가 가능 (추후 확장)
 */

import { getFunctions, httpsCallable } from
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { authStore, ROLES } from "../core/auth.js";
import { materialsDB }      from "../core/db.js";

const { app } = window.__firebase;

/* ════════════════════════════════════════════════════════════
   상수
════════════════════════════════════════════════════════════ */

export const MATERIAL_TYPES = [
  "initial",
  "recurring",
  "external",
  "online",
  "other",
];

export const MATERIAL_TYPE_LABELS = {
  initial:   "초기교육",
  recurring: "정기교육",
  external:  "외부교육",
  online:    "온라인교육",
  other:     "기타",
};

/** 허용 MIME 타입 */
export const ALLOWED_MIME   = ["application/pdf"];
/** <input accept> 값 */
export const ALLOWED_EXT    = ".pdf";
/** 최대 업로드 크기: 50 MB */
export const MAX_FILE_SIZE  = 50 * 1024 * 1024;

/* ════════════════════════════════════════════════════════════
   유틸
════════════════════════════════════════════════════════════ */

export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k     = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const i     = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ════════════════════════════════════════════════════════════
   파일 유효성 검사 (클라이언트 사전 검증)
════════════════════════════════════════════════════════════ */

/** @returns {string|null} 오류 메시지 또는 null(정상) */
export function validateFile(file) {
  if (!file)                             return "파일을 선택해 주세요.";
  if (!ALLOWED_MIME.includes(file.type)) return "PDF 파일만 업로드할 수 있습니다.";
  if (file.size <= 0)                    return "파일이 비어 있습니다.";
  if (file.size > MAX_FILE_SIZE)
    return `파일 크기가 너무 큽니다. 최대 ${formatFileSize(MAX_FILE_SIZE)} 이하.`;
  return null;
}

/* ════════════════════════════════════════════════════════════
   Step 1 — presigned PUT URL 요청 (Firebase Function 호출)

   반환값: { uploadUrl, publicUrl, materialId, key }
════════════════════════════════════════════════════════════ */

/**
 * @param {File} file
 * @returns {Promise<{ uploadUrl: string, publicUrl: string, materialId: string, key: string }>}
 */
export async function requestUploadUrl(file) {
  const functions = getFunctions(app, "us-central1");
  const fn        = httpsCallable(functions, "createMaterialUploadUrl");

  let result;
  try {
    result = await fn({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
  } catch (err) {
    console.error("[material-service] requestUploadUrl failed",
      err?.code, err?.message, err);
    // Firebase Functions 에러를 사용자 친화적 메시지로 변환
    const msg = err?.message ?? "presigned URL 요청에 실패했습니다.";
    const e   = new Error(msg);
    e.code    = err?.code ?? "functions/unknown";
    throw e;
  }

  const { uploadUrl, publicUrl, materialId, key } = result.data ?? {};
  if (!uploadUrl || !publicUrl || !materialId) {
    throw new Error("서버에서 업로드 URL을 받지 못했습니다. 다시 시도해 주세요.");
  }

  return { uploadUrl, publicUrl, materialId, key };
}

/* ════════════════════════════════════════════════════════════
   Step 2 — 브라우저 → R2 PUT 업로드

   presigned URL로 파일을 직접 R2에 전송합니다.
   Firebase를 경유하지 않으므로 DB에 파일 본문이 저장되지 않습니다.
════════════════════════════════════════════════════════════ */

/**
 * @param {string} uploadUrl  presigned PUT URL
 * @param {File}   file
 * @param {{ onProgress?: (pct: number) => void }} [opts]
 * @returns {Promise<void>}
 */
export async function putFileToR2(uploadUrl, file, opts = {}) {
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);

    if (opts.onProgress) {
      xhr.upload.addEventListener("progress", e => {
        if (e.lengthComputable) opts.onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        const err = new Error(`R2 업로드 실패 (HTTP ${xhr.status})`);
        err.code  = `r2/${xhr.status}`;
        reject(err);
      }
    });

    xhr.addEventListener("error",  () => reject(new Error("R2 업로드 중 네트워크 오류가 발생했습니다.")));
    xhr.addEventListener("abort",  () => reject(new Error("R2 업로드가 취소되었습니다.")));
    xhr.addEventListener("timeout",() => reject(new Error("R2 업로드 시간이 초과되었습니다.")));

    xhr.timeout = 5 * 60 * 1000; // 5분
    xhr.send(file);
  });
}

/* ════════════════════════════════════════════════════════════
   Step 3 — Firebase DB에 메타 저장

   업로드 성공 후에만 호출합니다.
   url은 R2 공개 URL입니다. base64/DataURL 저장 없음.
════════════════════════════════════════════════════════════ */

/**
 * @param {string} materialId  requestUploadUrl이 반환한 materialId
 * @param {{ title, trainingType, description }} values
 * @param {{ publicUrl, fileName, fileSize, fileType, key }} fileInfo
 * @returns {Promise<void>}
 */
export async function saveMaterialMeta(materialId, values, fileInfo) {
  // materialId는 Function이 사전 생성한 키 — 해당 경로에 직접 set
  await materialsDB.update(materialId, {
    title:          values.title.trim(),
    trainingType:   values.trainingType,
    description:    values.description?.trim() ?? "",
    fileName:       fileInfo.fileName,
    fileType:       fileInfo.fileType,
    fileSize:       fileInfo.fileSize,
    url:            fileInfo.publicUrl,   // R2 공개 URL
    r2Key:          fileInfo.key ?? "",   // 삭제 시 활용
    companyId:      authStore.companyId ?? null,
    uploadedBy:     authStore.uid,
    uploadedByName: authStore.name,
    createdAt:      Date.now(),
  });
}

/* ════════════════════════════════════════════════════════════
   통합 업로드 (requestUploadUrl + putFileToR2 + saveMaterialMeta)
════════════════════════════════════════════════════════════ */

/**
 * @param {{ title, trainingType, description }} values
 * @param {File}   file
 * @param {{ onProgress?: (pct: number) => void }} [opts]
 * @returns {Promise<string>} materialId
 */
export async function uploadMaterial(values, file, opts = {}) {
  // 1) presigned URL 요청
  const { uploadUrl, publicUrl, materialId, key } = await requestUploadUrl(file);

  // 2) R2로 파일 직접 업로드
  await putFileToR2(uploadUrl, file, opts);

  // 3) Firebase DB에 메타 저장
  await saveMaterialMeta(materialId, values, {
    publicUrl,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    key,
  });

  return materialId;
}

/* ════════════════════════════════════════════════════════════
   교육자료 목록 조회
════════════════════════════════════════════════════════════ */

export async function listMaterials() {
  const companyId = authStore.companyId;

  const items = (authStore.role === ROLES.SUPER_ADMIN || !companyId)
    ? await materialsDB.listAll()
    : await materialsDB.list(companyId);

  return items
    .map(m => ({ ...m, typeLabel: MATERIAL_TYPE_LABELS[m.trainingType] ?? "기타" }))
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
}

/* ════════════════════════════════════════════════════════════
   교육자료 삭제
   ※ R2 실제 파일 삭제는 별도 Function 필요 (현재 메타만 삭제)
════════════════════════════════════════════════════════════ */

export async function deleteMaterial(id) {
  // TODO: R2 파일 삭제 Function 연결 후 함께 호출
  // const functions = getFunctions(app, "us-central1");
  // await httpsCallable(functions, "deleteMaterialFile")({ materialId: id });
  await materialsDB.delete(id);
}
