/**
 * material-service.js — 교육자료 서비스
 *
 * 파일 저장 구조:
 *   실제 PDF 파일  → Cloudflare R2  (uploadMaterialFile — 현재 미연결)
 *   메타정보·URL  → Firebase RTDB  /materials/{materialId}
 *
 * Firebase에는 base64·DataURL을 절대 저장하지 않습니다.
 * R2 업로드 API 준비 후 uploadMaterialFile 내부 TODO 블록만 교체하세요.
 *
 * 교육 연결 확장:
 *   training 문서에 materialIds: string[] 배열로 자료를 연결할 수 있습니다.
 *   예) trainingsDB.update(trainingId, { materialIds: ["mat1", "mat2"] })
 */

import { authStore, ROLES } from "../core/auth.js";
import { materialsDB }      from "../core/db.js";

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

/** 허용 MIME 타입 (PDF 전용) */
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
   파일 유효성 검사
════════════════════════════════════════════════════════════ */

/** @returns {string|null} 오류 메시지 또는 null(정상) */
export function validateFile(file) {
  if (!file)                            return "파일을 선택해 주세요.";
  if (!ALLOWED_MIME.includes(file.type)) return "PDF 파일만 업로드할 수 있습니다.";
  if (file.size > MAX_FILE_SIZE)         return `파일 크기가 너무 큽니다. 최대 ${formatFileSize(MAX_FILE_SIZE)} 이하.`;
  return null;
}

/* ════════════════════════════════════════════════════════════
   R2 파일 업로드 — 현재 미연결 (placeholder)

   연결 방법:
     1. Cloudflare Workers 또는 Firebase Functions에
        presigned PUT URL 발급 or 직접 업로드 엔드포인트 구현
     2. 아래 TODO 블록을 실제 fetch 호출로 교체
     3. 반환값 형식은 그대로 유지:
        { url: string, fileName: string, fileSize: number, fileType: string }
════════════════════════════════════════════════════════════ */

/**
 * Cloudflare R2에 PDF를 업로드하고 공개 URL을 반환합니다.
 *
 * ※ 현재 R2 업로드 엔드포인트가 준비되지 않았으므로
 *   이 함수는 즉시 R2_NOT_CONFIGURED 에러를 throw합니다.
 *   Firebase DB에 base64/DataURL을 저장하지 않습니다.
 *
 * @param {File}   file
 * @param {string} materialId  Firebase push key
 * @returns {Promise<{url: string, fileName: string, fileSize: number, fileType: string}>}
 */
export async function uploadMaterialFile(file, materialId) {
  // ── TODO: R2 업로드 API 연결 후 아래 블록으로 교체 ──────────────
  //
  // 방법 A — Cloudflare Worker presigned URL:
  //   const presignRes = await fetch("/api/r2-presign", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ materialId, fileName: file.name, fileType: file.type }),
  //   });
  //   const { uploadUrl, publicUrl } = await presignRes.json();
  //   await fetch(uploadUrl, { method: "PUT", body: file,
  //                            headers: { "Content-Type": file.type } });
  //   return { url: publicUrl, fileName: file.name,
  //            fileSize: file.size, fileType: file.type };
  //
  // 방법 B — Firebase Function 경유:
  //   const token = await authStore.firebaseUser.getIdToken();
  //   const form  = new FormData();
  //   form.append("file", file);
  //   form.append("materialId", materialId);
  //   const res = await fetch("https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/uploadMaterial",
  //                           { method: "POST", headers: { Authorization: `Bearer ${token}` },
  //                             body: form });
  //   const { url } = await res.json();
  //   return { url, fileName: file.name, fileSize: file.size, fileType: file.type };
  //
  // ────────────────────────────────────────────────────────────────

  // R2 API 미연결 시 반드시 에러를 throw해 DB 저장을 막습니다.
  const err = new Error("R2_NOT_CONFIGURED");
  err.code  = "R2_NOT_CONFIGURED";
  throw err;
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
   교육자료 메타 저장 (파일 업로드 성공 후 호출)

   Firebase DB에는 url(R2 공개 URL)과 파일 정보만 저장합니다.
   base64·DataURL은 절대 저장하지 않습니다.
════════════════════════════════════════════════════════════ */

/**
 * @param {{ title: string, trainingType: string, description: string }} values
 * @param {{ url: string, fileName: string, fileSize: number, fileType: string }} fileInfo
 * @returns {Promise<string>} materialId
 */
export async function saveMaterialMeta(values, fileInfo) {
  const ref = await materialsDB.create({
    title:          values.title.trim(),
    trainingType:   values.trainingType,
    description:    values.description?.trim() ?? "",
    fileName:       fileInfo.fileName,
    fileType:       fileInfo.fileType,
    fileSize:       fileInfo.fileSize,
    url:            fileInfo.url,               // R2 공개 URL
    companyId:      authStore.companyId ?? null,
    uploadedBy:     authStore.uid,
    uploadedByName: authStore.name,
  });
  return ref.key;
}

/* ════════════════════════════════════════════════════════════
   교육자료 삭제
   ※ R2 실제 파일 삭제는 별도 API 필요 (현재 메타만 삭제)
════════════════════════════════════════════════════════════ */

export async function deleteMaterial(id) {
  // TODO: R2 파일 삭제 API 연결 후 함께 호출
  // await fetch(`/api/r2-delete?materialId=${id}`, { method: "DELETE" });
  await materialsDB.delete(id);
}
