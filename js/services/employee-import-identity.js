const ZERO_WIDTH_CHARS = /[\u200b-\u200d\u2060\ufeff]/g;
const EMPLOYEE_WHITESPACE = /[\s\u00a0]+/g;

export function normalizeEmployeeImportName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(EMPLOYEE_WHITESPACE, " ")
    .trim();
}

export function normalizeEmployeeImportNumber(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(EMPLOYEE_WHITESPACE, "")
    .toUpperCase();
}

function namesMatch(targetName, importedName) {
  if (!targetName || !importedName) return true;
  return targetName === importedName || targetName.replace(/\s/g, "") === importedName.replace(/\s/g, "");
}

export function compareEmployeeImportIdentity(targetEmployee = {}, importedEmployee = {}) {
  const targetEmpNo = normalizeEmployeeImportNumber(targetEmployee.empNo);
  const importedEmpNo = normalizeEmployeeImportNumber(importedEmployee.empNo);
  const targetName = normalizeEmployeeImportName(targetEmployee.name);
  const importedName = normalizeEmployeeImportName(importedEmployee.name);

  if (targetEmpNo && importedEmpNo) {
    if (targetEmpNo !== importedEmpNo) {
      return { matches: false, mismatchField: "empNo", targetEmpNo, importedEmpNo, targetName, importedName };
    }
    if (!namesMatch(targetName, importedName)) {
      return { matches: false, mismatchField: "name", targetEmpNo, importedEmpNo, targetName, importedName };
    }
    return { matches: true, matchedBy: "empNo", targetEmpNo, importedEmpNo, targetName, importedName };
  }

  if (!targetEmpNo && importedEmpNo && (!targetName || !importedName)) {
    return { matches: false, mismatchField: "empNo", targetEmpNo, importedEmpNo, targetName, importedName };
  }
  if (!namesMatch(targetName, importedName)) {
    return { matches: false, mismatchField: "name", targetEmpNo, importedEmpNo, targetName, importedName };
  }
  return {
    matches: true,
    matchedBy: targetName && importedName ? "name" : "targetUid",
    targetEmpNo,
    importedEmpNo,
    targetName,
    importedName,
  };
}

export function employeeImportMismatchMessage(comparison, sourceLabel = "Excel 직원 정보") {
  if (comparison?.mismatchField === "empNo") {
    return `${sourceLabel}: 선택 직원 사번 ${comparison.targetEmpNo || "없음"} / Excel 사번 ${comparison.importedEmpNo || "없음"}이 일치하지 않습니다.`;
  }
  if (comparison?.mismatchField === "name") {
    return `${sourceLabel}: 선택 직원 이름과 Excel 이름이 일치하지 않습니다.`;
  }
  return `${sourceLabel}가 선택한 직원과 일치하지 않습니다.`;
}
