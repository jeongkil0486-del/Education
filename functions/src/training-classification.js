"use strict";

function text(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function key(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9가-힣]+/g, "");
}

function normalizeTrainingType(value) {
  const valueKey = key(value);
  if (["job", "직무", "직무교육", "initial", "recurrent", "recurring", "refresher"].includes(valueKey)) return "job";
  if (["legal", "법정", "법정교육"].includes(valueKey)) return "legal";
  if (["online", "온라인", "온라인교육"].includes(valueKey)) return "online";
  if (["external", "외부", "외부교육"].includes(valueKey)) return "external";
  return valueKey ? "other" : "";
}

function normalizeStage(...values) {
  for (const value of values) {
    const valueKey = key(String(value ?? "").replace(/\([^)]*\)/g, ""));
    if (["초기", "초기교육", "입문", "입문교육", "initial"].includes(valueKey)) return "initial";
    if (["보수", "보수교육", "정기", "정기교육", "갱신", "갱신교육", "재교육", "recurrent", "recurring", "refresher", "recurrenttraining"].includes(valueKey)) return "recurrent";
  }
  return "";
}

function standardCourse(courseName, trainingType) {
  const courseKey = key(courseName);
  const isJob = trainingType === "job" || /직무|initial|recurrent|recurr|refresher/.test(courseKey);
  const matches = (values) => values.includes(courseKey);

  if (isJob && matches(["직무초기교육", "직무초기", "초기직무", "초기", "입문", "입문교육", "initial"])) {
    return { canonicalCourseName: "직무초기교육", canonicalCourseKey: "job_initial", trainingType: "job", subType: "initial", sectionKey: "job_initial", stageSource: "canonical" };
  }
  if (isJob && matches(["직무보수교육", "직무보수", "보수", "보수교육", "정기", "정기교육", "갱신", "갱신교육", "재교육", "recurrent", "recurring", "refresher"])) {
    return { canonicalCourseName: "직무보수교육", canonicalCourseKey: "job_recurrent", trainingType: "job", subType: "recurrent", sectionKey: "job_recurring", stageSource: "canonical" };
  }
  if (matches(["sms", "sms교육", "safetymanagementsystem", "안전관리시스템", "안전관리시스템교육"])) {
    return { canonicalCourseName: "SMS", canonicalCourseKey: "legal_sms", trainingType: "legal", subType: "", sectionKey: "legal", stageSource: "" };
  }
  if (matches(["항공보안", "항공보안교육", "aviationsecurity", "보안교육"])) {
    return { canonicalCourseName: "항공보안", canonicalCourseKey: "legal_security", trainingType: "legal", subType: "", sectionKey: "legal", stageSource: "" };
  }
  if (matches(["사내강사", "사내강사양성과정", "instructortraining"])) {
    return { canonicalCourseName: "사내강사", canonicalCourseKey: "job_instructor", trainingType: "job", subType: "", sectionKey: "job_recurring", stageSource: "" };
  }
  if (matches(["운항관리", "운항관리사", "운항통제", "flightdispatch"])) {
    return { canonicalCourseName: "운항관리", canonicalCourseKey: "job_operations", trainingType: "job", subType: "", sectionKey: "job_recurring", stageSource: "" };
  }
  if (matches(["위험물", "위험물규정", "위험물교육", "dangerousgoods", "dangerousgoodsregulation", "dangerousgoodsregulations", "dg", "dgr"])) {
    return { canonicalCourseName: "위험물", canonicalCourseKey: "legal_dangerous_goods", trainingType: "legal", subType: "", sectionKey: "legal", stageSource: "" };
  }
  if (matches(["wb", "weightbalance"])) {
    return { canonicalCourseName: "W&B", canonicalCourseKey: "job_wb", trainingType: "job", subType: "", sectionKey: "job_recurring", stageSource: "" };
  }
  const normalizedType = normalizeTrainingType(trainingType) || "other";
  const canonicalCourseName = text(courseName);
  const canonicalCourseKey = normalizedType === "job" && ["직무", "직무교육", "job", "jobduty"].includes(courseKey)
    ? "job_duty"
    : `${normalizedType}_${courseKey || "default"}`;
  return {
    canonicalCourseName,
    canonicalCourseKey,
    trainingType: normalizedType,
    subType: "",
    sectionKey: normalizedType,
    stageSource: "",
  };
}

function classifyTraining(input = {}) {
  const rawCourseName = text(input.courseName || input.title || input.subjectName);
  const rawTrainingType = normalizeTrainingType(input.trainingType);
  if (input.classificationOverride === true && rawTrainingType) {
    const subType = normalizeStage(input.subType, input.educationStage, input.initialOrRecurrent);
    const canonicalCourseName = text(input.canonicalCourseName || rawCourseName);
    return {
      canonicalCourseName,
      canonicalCourseKey: text(input.canonicalCourseKey) || `${rawTrainingType}_${key(canonicalCourseName) || "moved"}`,
      trainingType: rawTrainingType,
      subType,
      sectionKey: text(input.sectionKey) || (rawTrainingType === "job"
        ? subType === "initial" ? "job_initial" : "job_recurring"
        : rawTrainingType),
      stageSource: "override",
    };
  }
  const standard = standardCourse(rawCourseName, rawTrainingType);
  const explicitStage = normalizeStage(input.subType, input.educationStage, input.educationType, input.initialOrRecurrent, input.trainingPhase);
  const subType = standard.subType || explicitStage;
  const trainingType = standard.trainingType || rawTrainingType || "other";
  const isGenericJobCourse = trainingType === "job" && standard.canonicalCourseKey === "job_duty";
  const canonicalCourseName = isGenericJobCourse && subType
    ? subType === "initial" ? "직무초기교육" : "직무보수교육"
    : standard.canonicalCourseName || rawCourseName;
  const canonicalCourseKey = isGenericJobCourse && subType
    ? subType === "initial" ? "job_initial" : "job_recurrent"
    : standard.canonicalCourseKey;
  const sectionKey = trainingType === "job"
    ? subType === "initial" ? "job_initial" : subType === "recurrent" ? "job_recurring" : "job_recurring"
    : trainingType;
  return {
    canonicalCourseName,
    canonicalCourseKey,
    trainingType,
    subType,
    sectionKey,
    stageSource: standard.stageSource || (explicitStage ? "explicit" : ""),
  };
}

function reconcileHistoryRecords(records = []) {
  const classified = records.map((record) => {
    const classification = classifyTraining(record);
    const existingStage = normalizeStage(record.subType, record.educationStage, record.educationType, record.initialOrRecurrent, record.trainingPhase);
    const stageSource = record.stageSource || classification.stageSource || (existingStage ? "explicit" : "");
    return {
      ...record,
      ...classification,
      courseName: classification.canonicalCourseName || record.courseName,
      title: classification.canonicalCourseName || record.title,
      subType: classification.subType || existingStage,
      stageSource,
    };
  });
  const groups = new Map();
  for (const record of classified) {
    if (record.trainingType !== "job" || !record.completedAt) continue;
    const groupKey = `${record.uid || ""}__${record.canonicalCourseKey || "job_default"}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(record);
  }
  for (const recordsForItem of groups.values()) {
    const dates = [...new Set(recordsForItem.map((record) => Number(record.completedAt)).filter(Number.isFinite))].sort((a, b) => a - b);
    if (!dates.length) continue;
    const firstDate = dates[0];
    for (const record of recordsForItem) {
      if (record.stageSource || !record.completedAt) continue;
      record.subType = Number(record.completedAt) === firstDate ? "initial" : "recurrent";
      record.educationStage = record.subType;
      record.sectionKey = record.subType === "initial" ? "job_initial" : "job_recurring";
      record.canonicalCourseName = record.subType === "initial" ? "직무초기교육" : "직무보수교육";
      record.canonicalCourseKey = record.subType === "initial" ? "job_initial" : "job_recurrent";
      record.courseName = record.canonicalCourseName;
      record.title = record.canonicalCourseName;
      record.stageSource = "inferred";
    }
  }
  return classified.map((record) => {
    const isGenericJobCourse = record.trainingType === "job" && record.canonicalCourseKey === "job_duty";
    const canonicalCourseName = isGenericJobCourse && record.subType
      ? record.subType === "initial" ? "직무초기교육" : "직무보수교육"
      : record.canonicalCourseName;
    const canonicalCourseKey = isGenericJobCourse && record.subType
      ? record.subType === "initial" ? "job_initial" : "job_recurrent"
      : record.canonicalCourseKey;
    return {
      ...record,
      canonicalCourseName,
      canonicalCourseKey,
      courseName: canonicalCourseName || record.courseName,
      title: canonicalCourseName || record.title,
      educationStage: record.subType || text(record.educationStage),
      sectionKey: record.trainingType === "job"
        ? record.subType === "initial" ? "job_initial" : "job_recurring"
        : record.sectionKey,
    };
  });
}

module.exports = { classifyTraining, normalizeStage, normalizeTrainingType, reconcileHistoryRecords };
