import assert from "node:assert/strict";
import {
  compareEmployeeImportIdentity,
  employeeImportMismatchMessage,
  normalizeEmployeeImportName,
  normalizeEmployeeImportNumber,
} from "../js/services/employee-import-identity.js";

assert.equal(normalizeEmployeeImportName("  신\n 태용  "), "신 태용");
assert.equal(normalizeEmployeeImportName("\u1109\u1175\u11AB\u1110\u1162\u110B\u116D\u11BC"), "신태용");
assert.equal(normalizeEmployeeImportNumber("\tＴ２４９０２６\ufeff"), "T249026");

assert.equal(compareEmployeeImportIdentity(
  { name: "신태용", empNo: "T249026" },
  { name: " 신 태용 ", empNo: "t249026" },
).matches, true);

const mismatch = compareEmployeeImportIdentity(
  { name: "신태용", empNo: "T249026" },
  { name: "신태용", empNo: "T240026" },
);
assert.equal(mismatch.matches, false);
assert.equal(mismatch.mismatchField, "empNo");
assert.match(employeeImportMismatchMessage(mismatch, "Excel 이력 11행"), /T249026.*T240026/);

assert.equal(compareEmployeeImportIdentity(
  { name: "신태용", empNo: "T249026" },
  { name: "다른 직원", empNo: "T249026" },
).matches, false);

console.log("employee import preview identity tests passed");
