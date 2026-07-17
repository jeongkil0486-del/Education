"use strict";

const assert = require("node:assert/strict");
const {
  compareImportEmployeeIdentity,
  importEmployeeMismatchMessage,
  normalizeImportEmployeeName,
  normalizeImportEmployeeNumber,
} = require("../src/employee-import-identity");

assert.equal(normalizeImportEmployeeName("  신\n 태용  "), "신 태용");
assert.equal(normalizeImportEmployeeName("\u1109\u1175\u11AB\u1110\u1162\u110B\u116D\u11BC"), "신태용");
assert.equal(normalizeImportEmployeeNumber("\tｔ２４９０２６\ufeff"), "T249026");

assert.equal(compareImportEmployeeIdentity(
  { name: "신태용", empNo: "T249026" },
  { name: " 신태용 ", empNo: "t249026" }
).matches, true);

assert.equal(compareImportEmployeeIdentity(
  { name: "신태용", empNo: "T249026" },
  { name: "신 태용", empNo: "Ｔ２４９０２６" }
).matches, true);

assert.equal(compareImportEmployeeIdentity(
  { name: "신태용", empNo: "T249026" },
  { name: "다른 이름", empNo: "Ｔ２４９０２６" }
).matches, false);

const empNoMismatch = compareImportEmployeeIdentity(
  { name: "신태용", empNo: "T249026" },
  { name: "신태용", empNo: "T249027" }
);
assert.equal(empNoMismatch.matches, false);
assert.equal(empNoMismatch.mismatchField, "empNo");
assert.match(importEmployeeMismatchMessage(empNoMismatch), /T249026.*T249027/);

assert.equal(compareImportEmployeeIdentity(
  { name: "신 태용", empNo: "" },
  { name: "신\u00a0태용", empNo: "" }
).matches, true);

assert.equal(compareImportEmployeeIdentity(
  { name: "신태용", empNo: "" },
  { name: "다른직원", empNo: "" }
).matches, false);

assert.equal(compareImportEmployeeIdentity(
  { name: "", empNo: "" },
  { name: "", empNo: "T249026" }
).matches, false);

console.log("employee import identity tests passed");
