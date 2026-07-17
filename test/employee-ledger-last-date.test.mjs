import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  calculateAdjustedLastDate,
  isValidLedgerEducationRecord,
} from "../js/services/employee-ledger-last-date.js";

const adjustedFromRecords = (initialDate, records) => calculateAdjustedLastDate(
  initialDate,
  records.filter(isValidLedgerEducationRecord).map((record) => record.date),
);

const cases = [
  ["2025-03-03", ["2025-03-03", "2026-03-31"], "2026-03-03"],
  ["2025-03-03", ["2025-03-03", "2026-04-04"], "2026-03-03"],
  ["2017-12-07", ["2017-12-07", "2026-03-19"], "2026-12-07"],
  ["2023-01-11", ["2023-01-11", "2026-01-12"], "2026-01-11"],
  ["2023-04-18", ["2023-04-18", "2026-04-27"], "2026-04-18"],
  ["2025-03-03", ["2025-03-03"], "2025-03-03"],
  ["2024-02-29", ["2024-02-29", "2025-08-01"], "2025-02-28"],
  ["2024-02-29", ["2024-02-29", "2028-08-01"], "2028-02-29"],
];

for (const [initialDate, dates, expected] of cases) {
  assert.equal(calculateAdjustedLastDate(initialDate, dates), expected);
}

assert.equal(
  adjustedFromRecords("2025-03-03", [
    { date: "2025-03-03", result: "PASS" },
    { date: "2026-04-04", completionStatus: "completed" },
    { date: "2027-05-05", result: "FAIL" },
  ]),
  "2026-03-03",
);

assert.equal(
  adjustedFromRecords("2025-03-03", [
    { date: "2025-03-03", result: "PASS" },
    { date: "2026-03-31", result: "PASS" },
    { date: "2026-04-04", result: "PASS" },
  ]),
  "2026-03-03",
);

assert.equal(isValidLedgerEducationRecord({ result: "PASS" }), true);
assert.equal(isValidLedgerEducationRecord({ completionStatus: "completed" }), true);
assert.equal(isValidLedgerEducationRecord({ result: "FAIL" }), false);
assert.equal(isValidLedgerEducationRecord({ status: "취소" }), false);
assert.equal(isValidLedgerEducationRecord({ isDeleted: true, result: "PASS" }), false);

const employeesSource = await readFile(
  new URL("../js/views/employees.js", import.meta.url),
  "utf8",
);

assert.match(
  employeesSource,
  /const cycleBaseDate = latestRecurrentDate \?\? initialDate \?\? rawLastDate;/,
  "다음 예정일 기준일은 표시용 최종교육일이 아니라 기존 실제 교육일을 사용해야 합니다.",
);
assert.match(
  employeesSource,
  /completedAt: new Date\(cycleBaseDate\)\.getTime\(\)/,
  "다음 예정일 계산 입력은 기존 cycleBaseDate를 유지해야 합니다.",
);

console.log("employee ledger last-date tests passed");
