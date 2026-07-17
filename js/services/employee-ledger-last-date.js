const INVALID_COMPLETION_VALUES = new Set([
  "fail",
  "failed",
  "incomplete",
  "notcompleted",
  "pending",
  "assigned",
  "inprogress",
  "cancel",
  "cancelled",
  "canceled",
  "deleted",
  "미수료",
  "불합격",
  "미완료",
  "진행중",
  "취소",
  "삭제",
]);

function normalizeCompletionValue(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}

export function isValidLedgerEducationRecord(record = {}) {
  if (
    record?.deleted === true
    || record?.isDeleted === true
    || record?.cancelled === true
    || record?.canceled === true
    || record?.deletedAt
    || record?.cancelledAt
    || record?.canceledAt
  ) {
    return false;
  }

  const completionValues = [
    record?.result,
    record?.completionStatus,
    record?.status,
  ].map(normalizeCompletionValue).filter(Boolean);

  return !completionValues.some((value) => INVALID_COMPLETION_VALUES.has(value));
}

export function calculateAdjustedLastDate(initialDate, allDates) {
  const dates = [...new Set((allDates ?? [])
    .map((value) => String(value ?? "").trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))]
    .sort();

  if (!dates.length) return null;

  const rawLastDate = dates.at(-1);
  const match = String(initialDate ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return rawLastDate;

  const initialMonth = Number(match[2]);
  const initialDay = Number(match[3]);
  if (
    !Number.isInteger(initialMonth)
    || initialMonth < 1
    || initialMonth > 12
    || !Number.isInteger(initialDay)
    || initialDay < 1
  ) {
    return rawLastDate;
  }

  const latestYear = Math.max(...dates.map((date) => Number(date.slice(0, 4))));
  const adjustedDay = clampDayInMonth(latestYear, initialMonth, initialDay);

  return [
    String(latestYear).padStart(4, "0"),
    String(initialMonth).padStart(2, "0"),
    String(adjustedDay).padStart(2, "0"),
  ].join("-");
}

function clampDayInMonth(year, month, day) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(day, lastDay);
}
