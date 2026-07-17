"use strict";

const ZERO_WIDTH_CHARS = /[\u200b-\u200d\u2060\ufeff]/g;
const EMPLOYEE_WHITESPACE = /[\s\u00a0]+/g;

function normalizeImportEmployeeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(EMPLOYEE_WHITESPACE, " ")
    .trim();
}

function normalizeImportEmployeeNumber(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(EMPLOYEE_WHITESPACE, "")
    .toUpperCase();
}

function importEmployeeNamesMatch(targetName, importedName) {
  if (!targetName || !importedName) return true;
  return targetName === importedName || targetName.replace(/\s/g, "") === importedName.replace(/\s/g, "");
}

function compareImportEmployeeIdentity(targetEmployee = {}, importedEmployee = {}) {
  const targetEmpNo = normalizeImportEmployeeNumber(targetEmployee.empNo);
  const importedEmpNo = normalizeImportEmployeeNumber(importedEmployee.empNo);
  const targetName = normalizeImportEmployeeName(targetEmployee.name);
  const importedName = normalizeImportEmployeeName(importedEmployee.name);

  if (targetEmpNo && importedEmpNo) {
    if (targetEmpNo !== importedEmpNo) {
      return {
        matches: false,
        mismatchField: "empNo",
        targetEmpNo,
        importedEmpNo,
        targetName,
        importedName,
      };
    }

    if (!importEmployeeNamesMatch(targetName, importedName)) {
      return {
        matches: false,
        mismatchField: "name",
        targetEmpNo,
        importedEmpNo,
        targetName,
        importedName,
      };
    }

    // 명확한 UID를 통해 조회한 실제 사용자와 사번이 같으면 사번을 기본 식별값으로 사용한다.
    // 이름은 보조 검증하되 NFKC/공백 차이만으로는 차단하지 않는다.
    return {
      matches: true,
      matchedBy: "empNo",
      nameMatches: true,
      targetEmpNo,
      importedEmpNo,
      targetName,
      importedName,
    };
  }

  if (!targetEmpNo && importedEmpNo && (!targetName || !importedName)) {
    return {
      matches: false,
      mismatchField: "empNo",
      targetEmpNo,
      importedEmpNo,
      targetName,
      importedName,
    };
  }

  if (!importEmployeeNamesMatch(targetName, importedName)) {
    return {
      matches: false,
      mismatchField: "name",
      targetEmpNo,
      importedEmpNo,
      targetName,
      importedName,
    };
  }

  return {
    matches: true,
    matchedBy: targetName && importedName ? "name" : "targetUid",
    nameMatches: true,
    targetEmpNo,
    importedEmpNo,
    targetName,
    importedName,
  };
}

function importEmployeeMismatchMessage(comparison, sourceLabel = "엑셀 직원 정보") {
  if (comparison?.mismatchField === "empNo") {
    return `${sourceLabel}: 선택 직원 사번 ${comparison.targetEmpNo || "없음"} / 엑셀 사번 ${comparison.importedEmpNo || "없음"}이 일치하지 않습니다.`;
  }
  if (comparison?.mismatchField === "name") {
    return `${sourceLabel}: 선택 직원 이름과 엑셀 이름이 일치하지 않습니다.`;
  }
  return `${sourceLabel}와 선택한 직원이 일치하지 않습니다.`;
}

module.exports = {
  compareImportEmployeeIdentity,
  importEmployeeMismatchMessage,
  normalizeImportEmployeeName,
  normalizeImportEmployeeNumber,
};
