"use strict";

const assert = require("node:assert/strict");
const {
  mergeGuidePageNotes,
  normalizeGuideInput,
  normalizeGuidePageNotes,
} = require("../src/instructor-guide");

const arrayNotes = [
  null,
  { note: "1 설명", emphasis: "1 강조", question: "1 질문", updatedAt: 10 },
  { note: "2 설명", emphasis: "2 강조", question: "2 질문", updatedAt: 20 },
  { note: "3 설명", emphasis: "3 강조", question: "3 질문", updatedAt: 30 },
];
assert.equal(Object.keys(normalizeGuidePageNotes(arrayNotes)).length, 3);

const existing = {
  title: "기존 교안",
  materialId: "material_1",
  trainingItemId: "항공보안",
  estimatedMinutes: 45,
  objectives: "기존 목표",
  openingNotes: "기존 시작",
  generalNotes: "기존 진행",
  closingNotes: "기존 마무리",
  pageNotes: arrayNotes,
};

const titleOnly = normalizeGuideInput({ title: "수정 교안" }, existing);
assert.equal(titleOnly.title, "수정 교안");
assert.equal(titleOnly.objectives, "기존 목표");
assert.equal(titleOnly.openingNotes, "기존 시작");
assert.equal(titleOnly.generalNotes, "기존 진행");
assert.equal(titleOnly.closingNotes, "기존 마무리");
assert.equal(Object.keys(titleOnly.pageNotes).length, 3);

const explicitBlank = normalizeGuideInput({ closingNotes: "" }, existing);
assert.equal(explicitBlank.closingNotes, "");
assert.equal(explicitBlank.objectives, "기존 목표");

const partialPage = mergeGuidePageNotes(arrayNotes, {
  2: { emphasis: "2 강조 수정" },
});
assert.equal(partialPage["1"].note, "1 설명");
assert.equal(partialPage["2"].note, "2 설명");
assert.equal(partialPage["2"].emphasis, "2 강조 수정");
assert.equal(partialPage["2"].question, "2 질문");
assert.equal(partialPage["3"].note, "3 설명");

const clearedPage = mergeGuidePageNotes(arrayNotes, {
  2: { note: "", emphasis: "", question: "" },
});
assert.equal("2" in clearedPage, false);
assert.equal(Object.keys(clearedPage).length, 2);

console.log("instructor guide tests passed");
