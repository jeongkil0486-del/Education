import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const { functions } = window.__firebase;

async function callGuideFunction(name, payload = {}) {
  try {
    const result = await httpsCallable(functions, name)(payload);
    return result.data ?? {};
  } catch (error) {
    const normalized = new Error(error?.message || "교안 요청을 처리하지 못했습니다.");
    normalized.code = error?.code || "functions/unknown";
    throw normalized;
  }
}

export async function listInstructorGuides() {
  const result = await callGuideFunction("listInstructorGuides");
  return Array.isArray(result.guides) ? result.guides : [];
}

export async function getInstructorGuide(guideId) {
  const result = await callGuideFunction("getInstructorGuide", { guideId });
  if (!result.guide) throw new Error("교안을 찾을 수 없습니다.");
  return result.guide;
}

export async function saveInstructorGuide(guide) {
  const result = await callGuideFunction("saveInstructorGuide", { guide });
  if (!result.guide) throw new Error("저장된 교안 정보를 받지 못했습니다.");
  return result;
}

export async function deleteInstructorGuide(guideId) {
  return callGuideFunction("deleteInstructorGuide", { guideId });
}
