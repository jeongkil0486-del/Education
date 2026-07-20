"use strict";

const GUIDE_PAGE_LIMIT = 5000;
const GUIDE_PAGE_NOTE_LIMIT = 2000;

function hasOwn(value, key) {
  return Boolean(value && typeof value === "object"
    && Object.prototype.hasOwnProperty.call(value, key));
}

function guideText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function guidePageSource(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeGuidePageNotes(value) {
  const source = guidePageSource(value);
  const pageNotes = {};
  for (const [rawPage, rawNote] of Object.entries(source).slice(0, GUIDE_PAGE_NOTE_LIMIT)) {
    const page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1 || page > GUIDE_PAGE_LIMIT) continue;
    const note = rawNote && typeof rawNote === "object" ? rawNote : {};
    const normalized = {
      note: guideText(note.note, 5000),
      emphasis: guideText(note.emphasis, 1500),
      question: guideText(note.question, 1500),
      updatedAt: Number(note.updatedAt) || 0,
    };
    if (normalized.note || normalized.emphasis || normalized.question) {
      pageNotes[String(page)] = normalized;
    }
  }
  return pageNotes;
}

function mergeGuidePageNotes(existingValue, incomingValue) {
  const merged = normalizeGuidePageNotes(existingValue);
  const source = guidePageSource(incomingValue);
  const now = Date.now();

  for (const [rawPage, rawNote] of Object.entries(source).slice(0, GUIDE_PAGE_NOTE_LIMIT)) {
    const page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1 || page > GUIDE_PAGE_LIMIT) continue;
    const pageKey = String(page);

    if (rawNote === null) {
      delete merged[pageKey];
      continue;
    }
    if (!rawNote || typeof rawNote !== "object") continue;

    const previous = merged[pageKey] ?? {};
    const next = {
      note: hasOwn(rawNote, "note") ? guideText(rawNote.note, 5000) : guideText(previous.note, 5000),
      emphasis: hasOwn(rawNote, "emphasis")
        ? guideText(rawNote.emphasis, 1500)
        : guideText(previous.emphasis, 1500),
      question: hasOwn(rawNote, "question")
        ? guideText(rawNote.question, 1500)
        : guideText(previous.question, 1500),
    };
    const changed = ["note", "emphasis", "question"].some((key) => hasOwn(rawNote, key));
    if (next.note || next.emphasis || next.question) {
      next.updatedAt = changed ? now : Number(previous.updatedAt) || now;
      merged[pageKey] = next;
    } else if (changed) {
      delete merged[pageKey];
    }
  }
  return merged;
}

function normalizeGuideInput(value, existingValue = {}) {
  const input = value && typeof value === "object" ? value : {};
  const existing = existingValue && typeof existingValue === "object" ? existingValue : {};
  const resolveText = (key, maxLength) => guideText(hasOwn(input, key) ? input[key] : existing[key], maxLength);
  const estimatedMinutesSource = hasOwn(input, "estimatedMinutes")
    ? input.estimatedMinutes
    : existing.estimatedMinutes;

  return {
    title: resolveText("title", 160),
    materialId: resolveText("materialId", 140),
    trainingItemId: resolveText("trainingItemId", 120),
    estimatedMinutes: Math.min(1440, Math.max(0, Math.round(Number(estimatedMinutesSource) || 0))),
    objectives: resolveText("objectives", 5000),
    openingNotes: resolveText("openingNotes", 5000),
    closingNotes: resolveText("closingNotes", 5000),
    generalNotes: resolveText("generalNotes", 10000),
    pageNotes: hasOwn(input, "pageNotes")
      ? mergeGuidePageNotes(existing.pageNotes, input.pageNotes)
      : normalizeGuidePageNotes(existing.pageNotes),
  };
}

module.exports = {
  hasOwn,
  mergeGuidePageNotes,
  normalizeGuideInput,
  normalizeGuidePageNotes,
};
