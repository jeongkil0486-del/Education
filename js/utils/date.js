/**
 * TAS Learning Hub — Date Utilities
 */

const KO_LOCALE = "ko-KR";

export function formatDate(ts) {
  if (!ts) return "–";
  return new Date(ts).toLocaleDateString(KO_LOCALE, {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

export function formatDateTime(ts) {
  if (!ts) return "–";
  return new Date(ts).toLocaleString(KO_LOCALE, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function formatDateShort(ts) {
  if (!ts) return "–";
  return new Date(ts).toLocaleDateString(KO_LOCALE, {
    month: "2-digit", day: "2-digit",
  });
}

/** Days from now (positive = future, negative = past) */
export function daysFromNow(ts) {
  if (!ts) return null;
  const diff = ts - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function isOverdue(ts) {
  return ts != null && ts < Date.now();
}

export function isExpiringSoon(ts, days = 3) {
  if (!ts) return false;
  const d = daysFromNow(ts);
  return d !== null && d >= 0 && d <= days;
}

export function relativeTime(ts) {
  if (!ts) return "–";
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);

  if (mins < 1)   return "방금 전";
  if (mins < 60)  return `${mins}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7)   return `${days}일 전`;
  return formatDate(ts);
}

export function monthLabel(ts) {
  return new Date(ts).toLocaleDateString(KO_LOCALE, { year: "numeric", month: "long" });
}
