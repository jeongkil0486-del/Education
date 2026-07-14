import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { authStore } from "../core/auth.js";
import { materialsDB } from "../core/db.js";

const { functions } = window.__firebase;

export const MATERIAL_TYPES = ["job", "legal", "external", "online", "other"];

export const MATERIAL_TYPE_LABELS = {
  job: "직무교육",
  legal: "법정교육",
  external: "외부교육",
  online: "온라인교육",
  other: "기타",
};

const LEGACY_MATERIAL_TYPE_MAP = {
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

export const ALLOWED_MIME = ["application/pdf"];
export const ALLOWED_EXT = ".pdf";
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const PDF_ONLY_MESSAGE = "교육자료는 PDF 파일만 업로드할 수 있습니다.";
export const PDF_SIZE_MESSAGE = "PDF 파일은 최대 50MB까지 업로드할 수 있습니다.";

export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function validateFile(file) {
  if (!file) return "파일을 선택해 주세요.";

  const fileName = String(file.name ?? "").trim().toLowerCase();
  const fileType = String(file.type ?? "").trim().toLowerCase();
  const hasPdfExtension = fileName.endsWith(ALLOWED_EXT);
  const hasPdfMime = ALLOWED_MIME.includes(fileType);

  if (!hasPdfExtension || !hasPdfMime) return PDF_ONLY_MESSAGE;
  if (file.size <= 0) return "파일이 비어 있습니다.";
  if (file.size > MAX_FILE_SIZE) return PDF_SIZE_MESSAGE;
  return null;
}

export function normalizeMaterialType(type) {
  const normalized = String(type ?? "").trim();
  return LEGACY_MATERIAL_TYPE_MAP[normalized] ?? "other";
}

export async function requestUploadUrl(file) {
  const validationMessage = validateFile(file);
  if (validationMessage) {
    throw new Error(validationMessage);
  }

  const fn = httpsCallable(functions, "createMaterialUploadUrl");

  let result;
  try {
    result = await fn({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
  } catch (err) {
    console.error("[material-service] requestUploadUrl failed", { code: err?.code, message: err?.message }, err);
    const error = new Error(err?.message ?? "presigned URL 요청에 실패했습니다.");
    error.code = err?.code ?? "functions/unknown";
    throw error;
  }

  const { uploadUrl, publicUrl, materialId, key } = result.data ?? {};
  if (!uploadUrl || !materialId) {
    throw new Error("서버에서 업로드 URL을 받지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  return { uploadUrl, publicUrl, materialId, key };
}

export async function requestMaterialDownloadUrl(materialId) {
  const fn = httpsCallable(functions, "getMaterialDownloadUrl");

  let result;
  try {
    result = await fn({ materialId });
  } catch (err) {
    console.error("[material-service] requestMaterialDownloadUrl failed", { code: err?.code, message: err?.message }, err);
    const error = new Error(err?.message ?? "다운로드 URL 요청에 실패했습니다.");
    error.code = err?.code ?? "functions/unknown";
    throw error;
  }

  const { downloadUrl } = result.data ?? {};
  if (!downloadUrl) {
    throw new Error("서버에서 다운로드 URL을 받지 못했습니다.");
  }
  return downloadUrl;
}

export function putFileToR2(uploadUrl, file, opts = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);

    if (opts.onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          opts.onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        const error = new Error(`R2 업로드 실패 (HTTP ${xhr.status})`);
        error.code = `r2/http-${xhr.status}`;
        reject(error);
      }
    });

    xhr.addEventListener("error", () => reject(new Error("R2 업로드 중 네트워크 오류가 발생했습니다.")));
    xhr.addEventListener("abort", () => reject(new Error("R2 업로드가 취소되었습니다.")));
    xhr.addEventListener("timeout", () => reject(new Error("R2 업로드 시간이 초과되었습니다.")));

    xhr.timeout = 10 * 60 * 1000;
    xhr.send(file);
  });
}

export async function saveMaterialMeta(materialId, values, fileInfo) {
  await materialsDB.update(materialId, {
    title: values.title.trim(),
    trainingType: normalizeMaterialType(values.trainingType),
    description: values.description?.trim() ?? "",
    fileName: fileInfo.fileName,
    fileType: fileInfo.fileType,
    fileSize: fileInfo.fileSize,
    url: fileInfo.publicUrl,
    r2Key: fileInfo.key ?? "",
    companyId: authStore.companyId ?? null,
    uploadedBy: authStore.uid,
    uploadedByName: authStore.name,
    createdAt: Date.now(),
  });
}

export async function uploadMaterial(values, file, opts = {}) {
  const notify = (label, pct) => opts.onProgress?.(label, pct);

  notify("업로드 URL 요청 중...", 5);
  const { uploadUrl, publicUrl, materialId, key } = await requestUploadUrl(file);

  await putFileToR2(uploadUrl, file, {
    onProgress: (pct) => notify("R2 업로드 중...", 10 + Math.round(pct * 0.8)),
  });

  notify("저장 중...", 95);
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

export async function listMaterials() {
  const fn = httpsCallable(functions, "listMaterials");
  const result = await fn({});
  const items = result.data?.materials ?? [];

  return items
    .map((item) => {
      const trainingType = normalizeMaterialType(item.trainingType);
      return {
        ...item,
        trainingType,
        typeLabel: MATERIAL_TYPE_LABELS[trainingType] ?? "기타",
      };
    })
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
}

export async function deleteMaterial(id) {
  await materialsDB.delete(id);
}
