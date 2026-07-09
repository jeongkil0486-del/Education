/**
 * material-service.js — 교육자료 서비스
 *
 * 저장 경로: /materials/{materialId}
 * 파일 저장: Cloudflare R2 (uploadMaterialFile) — 업로드 API 미연결 시 mock URL 사용
 *
 * 교육 연결:
 *   training 문서에 materialIds: string[] 배열을 추가해 연결 가능 (추후 확장)
 */

import { authStore, ROLES } from "../core/auth.js";
import { materialsDB } from "../core/db.js";

/* ── 상수 ─────────────────────────────────────────────────── */

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
export const ALLOWED_MIME = ["application/pdf"];
/** 허용 확장자 표시용 */
export const ALLOWED_EXT  = ".pdf";
/** 최대 업로드 크기: 50 MB */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/* ── 파일 크기 포맷 ───────────────────────────────────────── */
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ── 교육자료 목록 조회 ───────────────────────────────────── */
export async function listMaterials() {
  const role      = authStore.role;
  const companyId = authStore.companyId;

  let items;
  if (role === ROLES.SUPER_ADMIN || !companyId) {
    items = await materialsDB.listAll();
  } else {
    items = await materialsDB.list(companyId);
  }

  return items
    .map(m => ({
      ...m,
      typeLabel: MATERIAL_TYPE_LABELS[m.trainingType] ?? "기타",
    }))
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
}

/* ── 교육자료 삭제 ────────────────────────────────────────── */
export async function deleteMaterial(id) {
  await materialsDB.delete(id);
}

/* ── 파일 유효성 검사 ─────────────────────────────────────── */
export function validateFile(file) {
  if (!file) return "파일을 선택해 주세요.";
  if (!ALLOWED_MIME.includes(file.type)) return "PDF 파일만 업로드할 수 있습니다.";
  if (file.size > MAX_FILE_SIZE) return `파일 크기가 너무 큽니다. 최대 ${formatFileSize(MAX_FILE_SIZE)} 이하.`;
  return null;
}

/* ── 실제 파일 업로드 (Cloudflare R2 연결 전 mock) ──────── */
/**
 * Cloudflare R2에 파일을 업로드하고 공개 URL을 반환합니다.
 *
 * ※ 현재 R2 업로드 전용 API(서버 함수)가 없으므로
 *   메타 데이터만 Firebase에 저장하고, url은 빈 문자열로 처리합니다.
 *   실제 R2 업로드 API 연결 시 아래 TODO 블록을 교체하세요.
 *
 * @param {File}   file
 * @param {string} materialId  Firebase push key (사전 생성)
 * @returns {Promise<{url: string, fileName: string, fileSize: number, fileType: string}>}
 */
export async function uploadMaterialFile(file, materialId) {
  // TODO: R2 presigned URL 또는 서버 업로드 API 연결
  // const formData = new FormData();
  // formData.append("file", file);
  // formData.append("materialId", materialId);
  // const res = await fetch("/api/upload-material", { method: "POST", body: formData });
  // const { url } = await res.json();
  // return { url, fileName: file.name, fileSize: file.size, fileType: file.type };

  // ── 현재: 파일 내용을 직접 저장하지 않고 메타만 저장 ──
  // 브라우저에서 파일을 읽어 Data URL로 임시 저장 (소용량 POC용)
  // 실제 운영에서는 R2 연결 후 위 TODO 코드로 교체하세요.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        url:      reader.result,   // Data URL (POC — 실운영 시 R2 URL로 교체)
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
    };
    reader.onerror = () => reject(new Error("파일 읽기 실패"));
    reader.readAsDataURL(file);
  });
}

/* ── 교육자료 저장 (메타 + 파일) ─────────────────────────── */
/**
 * @param {{ title, trainingType, description }} values
 * @param {File} file
 * @returns {Promise<string>} materialId
 */
export async function saveMaterial(values, file) {
  const companyId = authStore.companyId;

  // 1) 파일 업로드
  const { url, fileName, fileSize, fileType } = await uploadMaterialFile(file, "pending");

  // 2) Firebase에 메타 저장
  const ref = await materialsDB.create({
    title:          values.title.trim(),
    trainingType:   values.trainingType,
    description:    values.description?.trim() ?? "",
    fileName,
    fileType,
    fileSize,
    url,
    companyId:      companyId ?? null,
    uploadedBy:     authStore.uid,
    uploadedByName: authStore.name,
  });

  return ref.key;
}
