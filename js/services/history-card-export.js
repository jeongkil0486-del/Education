/**
 * history-card-export.js
 *
 * 교육이력카드 엑셀 다운로드
 * ─ 원본 양식(병합셀·글꼴·테두리·색상·행높이·열너비) 완전 유지
 * ─ 인적사항 셀 매핑 → 직원 데이터 기입
 * ─ 교육유형별 섹션에 이력 행 삽입
 * ─ 양식이 없으면 기본 레이아웃으로 생성
 */

import { authStore } from "../core/auth.js";
import { templatesDB } from "../core/db.js";
import { formatDate } from "../utils/date.js";

/* ──────────────────────────────────────────────────────────
   교육유형 섹션 정의 (양식 시트 내 섹션 제목과 매핑)
────────────────────────────────────────────────────────── */
const SECTION_ORDER = ["job_initial", "job_recurring", "legal", "online", "external", "other"];

const SECTION_LABELS = {
  job_initial:  "직무초기교육",
  job_recurring:"직무보수교육",
  legal:        "법정교육",
  online:       "온라인교육",
  external:     "외부교육",
  other:        "기타",
};

function getSectionKey(row) {
  if (row.trainingType === "job") {
    return row.subType === "initial" ? "job_initial" : "job_recurring";
  }
  return row.trainingType;
}

/* ──────────────────────────────────────────────────────────
   SheetJS 로더 (CDN)
────────────────────────────────────────────────────────── */
let _xlsxPromise = null;
async function loadXlsx() {
  if (!_xlsxPromise) {
    _xlsxPromise = import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs").catch(() => null);
  }
  return _xlsxPromise;
}

/* ──────────────────────────────────────────────────────────
   Template DB 함수들
────────────────────────────────────────────────────────── */
export async function listHistoryCardTemplates() {
  const templates = await templatesDB.list(authStore.companyId);
  return templates
    .filter((t) => t.templateType === "history_card")
    .sort((a, b) => Number(b.uploadedAt ?? b.createdAt ?? 0) - Number(a.uploadedAt ?? a.createdAt ?? 0));
}

export async function getLatestHistoryCardTemplate() {
  const templates = await listHistoryCardTemplates();
  return templates[0] ?? null;
}

export async function uploadHistoryCardTemplate(file) {
  const buffer = await file.arrayBuffer();
  const xlsx   = await loadXlsx();

  let sheetNames = [];
  let mergeCount = 0;
  let cellMap    = {};  // 자동 감지된 인적사항 셀 위치

  if (xlsx) {
    try {
      const wb = xlsx.read(buffer, { type: "array", cellStyles: true, dense: false });
      sheetNames = wb.SheetNames ?? [];
      mergeCount = sheetNames.reduce((cnt, sn) => cnt + (wb.Sheets?.[sn]?.["!merges"]?.length ?? 0), 0);

      // 첫 번째 시트에서 인적사항 키워드 셀 자동 탐색
      const firstSheet = wb.Sheets?.[sheetNames[0]];
      if (firstSheet) {
        cellMap = detectCellMap(xlsx, firstSheet);
      }
    } catch (err) {
      console.warn("[history-card-export] template parse warning", err);
    }
  }

  const created = await templatesDB.create({
    companyId:       authStore.companyId,
    companyName:     authStore.profile?.companyName ?? "",
    templateType:    "history_card",
    title:           "개인교육이력카드 양식",
    fileName:        file.name,
    fileSize:        file.size,
    mimeType:        file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    uploadedAt:      Date.now(),
    uploadedBy:      authStore.uid,
    uploadedByName:  authStore.name,
    sheetNames,
    mergeCount,
    cellMap,
    mappingVersion:  2,
    mappingMode:     "template-cell-mapping",
    fileData:        arrayBufferToBase64(buffer),
  });

  return created.key;
}

/* ──────────────────────────────────────────────────────────
   셀 키워드 자동 감지
   - 양식에서 "성명", "사번" 등 라벨 옆 셀을 자동으로 찾는다
────────────────────────────────────────────────────────── */
const LABEL_PATTERNS = {
  name:            ["성명", "이름"],
  empNo:           ["사번", "직원번호"],
  birthDate:       ["생년월일"],
  joinDate:        ["입사일"],
  entryType:       ["신입", "경력", "신입/경력"],
  internalLicense: ["사내자격", "사내 자격"],
  externalLicense: ["사외자격", "사외 자격"],
  branchName:      ["지점", "근무지"],
  position:        ["직책", "직급"],
};

function detectCellMap(xlsx, sheet) {
  const map = {};
  const range = xlsx.utils.decode_range(sheet["!ref"] ?? "A1:Z100");

  for (let r = range.s.r; r <= Math.min(range.e.r, 50); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || !cell.v) continue;

      const cellText = String(cell.v).trim().replace(/\s+/g, "");

      for (const [field, patterns] of Object.entries(LABEL_PATTERNS)) {
        if (map[field]) continue;
        if (patterns.some((p) => cellText.includes(p.replace(/\s+/g, "")))) {
          // 오른쪽 셀 또는 아래 셀을 값 입력 위치로 지정
          const rightAddr = xlsx.utils.encode_cell({ r, c: c + 1 });
          const downAddr  = xlsx.utils.encode_cell({ r: r + 1, c });
          const rightCell = sheet[rightAddr];
          const downCell  = sheet[downAddr];

          // 오른쪽 셀이 비어있으면 우선 사용
          if (!rightCell || !rightCell.v || String(rightCell.v).trim() === "") {
            map[field] = rightAddr;
          } else if (!downCell || !downCell.v || String(downCell.v).trim() === "") {
            map[field] = downAddr;
          } else {
            map[field] = rightAddr; // fallback
          }
          break;
        }
      }
    }
  }

  return map;
}

/* ──────────────────────────────────────────────────────────
   섹션 시작 행 탐지
   - 양식에서 "직무초기교육" 등 섹션 제목 행을 찾아 교육 데이터를 삽입
────────────────────────────────────────────────────────── */
function detectSectionRows(xlsx, sheet) {
  const sectionRows = {};
  const range = xlsx.utils.decode_range(sheet["!ref"] ?? "A1:Z200");

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || !cell.v) continue;

      const text = String(cell.v).trim().replace(/\s+/g, "");
      for (const [key, label] of Object.entries(SECTION_LABELS)) {
        if (!sectionRows[key] && text.includes(label.replace(/\s+/g, ""))) {
          sectionRows[key] = r; // 0-based 행 번호
          break;
        }
      }
    }
  }

  return sectionRows;
}

/* ──────────────────────────────────────────────────────────
   교육 데이터 행 컬럼 헤더 탐지
   - 섹션 아래 "교육과정명", "강사" 등 컬럼 헤더 행을 찾는다
────────────────────────────────────────────────────────── */
const COL_PATTERNS = {
  title:        ["교육과정", "과정명", "교육명"],
  subject:      ["교육과목", "과목"],
  instructor:   ["강사"],
  hours:        ["교육시간", "시간"],
  period:       ["교육기간", "기간"],
  completedAt:  ["수료일", "완료일"],
  result:       ["결과"],
  subType:      ["초기", "보수", "초기/보수"],
  note:         ["비고"],
};

function detectColMap(xlsx, sheet, headerRow) {
  const colMap = {};
  const range = xlsx.utils.decode_range(sheet["!ref"] ?? "A1:Z200");

  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = xlsx.utils.encode_cell({ r: headerRow, c });
    const cell = sheet[addr];
    if (!cell || !cell.v) continue;

    const text = String(cell.v).trim().replace(/\s+/g, "");
    for (const [field, patterns] of Object.entries(COL_PATTERNS)) {
      if (!colMap[field] && patterns.some((p) => text.includes(p.replace(/\s+/g, "")))) {
        colMap[field] = c;
        break;
      }
    }
  }

  return colMap;
}

/* ──────────────────────────────────────────────────────────
   엑셀 내보내기 메인 함수
────────────────────────────────────────────────────────── */
export async function exportEmployeeHistoryCard({ employee, rows, template = null }) {
  const xlsx = await loadXlsx();

  // SheetJS 없으면 JSON fallback
  if (!xlsx) {
    const jsonData = buildJsonFallback(employee, rows);
    downloadBlob(
      new Blob([JSON.stringify(jsonData, null, 2)], { type: "application/json;charset=utf-8" }),
      buildFileName(employee, "json")
    );
    return { mode: "json-fallback", fileName: buildFileName(employee, "json") };
  }

  const targetTemplate = template ?? await getLatestHistoryCardTemplate();
  let workbook;

  if (targetTemplate?.fileData) {
    // ── 원본 양식 로드 (서식 완전 유지)
    workbook = xlsx.read(base64ToArrayBuffer(targetTemplate.fileData), {
      type:       "array",
      cellStyles: true,
      cellNF:     true,
      cellDates:  true,
      dense:      false,
    });
    applyTemplateMapping(xlsx, workbook, employee, rows, targetTemplate);
  } else {
    // ── 양식 없음: 기본 레이아웃 생성
    workbook = buildDefaultWorkbook(xlsx, employee, rows);
  }

  const output = xlsx.write(workbook, {
    type:       "array",
    bookType:   "xlsx",
    cellStyles: true,
  });

  const fileName = buildFileName(employee, "xlsx");
  downloadBlob(
    new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    fileName
  );

  return {
    mode:     targetTemplate?.fileData ? "template-workbook" : "generated-workbook",
    fileName,
  };
}

/* ──────────────────────────────────────────────────────────
   원본 양식에 데이터 매핑
────────────────────────────────────────────────────────── */
function applyTemplateMapping(xlsx, workbook, employee, rows, template) {
  const sheetName   = workbook.SheetNames?.[0];
  if (!sheetName) return;

  const sheet = workbook.Sheets[sheetName];
  const cellMap    = template.cellMap ?? {};
  const sectionMap = detectSectionRows(xlsx, sheet);

  // ── 1. 인적사항 셀 매핑
  const profileData = {
    name:            employee?.name ?? "",
    empNo:           employee?.empNo ?? "",
    birthDate:       employee?.birthDate ? formatDate(employee.birthDate) : "",
    joinDate:        employee?.joinDate  ? formatDate(employee.joinDate)  : "",
    entryType:       employee?.entryType ?? "",
    internalLicense: employee?.internalLicense ?? "",
    externalLicense: employee?.externalLicense ?? "",
    branchName:      employee?.branchName ?? "",
    position:        employee?.position ?? "",
  };

  for (const [field, addr] of Object.entries(cellMap)) {
    if (!addr || !profileData[field] === undefined) continue;
    const value = profileData[field];
    if (!value) continue;

    // 기존 셀 스타일 보존하면서 값만 변경
    if (!sheet[addr]) sheet[addr] = {};
    sheet[addr].v = value;
    sheet[addr].t = "s";
    delete sheet[addr].f; // 수식 제거
  }

  // ── 2. 교육유형별 섹션에 데이터 행 삽입
  const sectionedRows = {};
  for (const row of rows) {
    const key = getSectionKey(row);
    if (!sectionedRows[key]) sectionedRows[key] = [];
    sectionedRows[key].push(row);
  }

  // 섹션별로 처리 (행 삽입 시 오프셋 추적)
  let insertedRowCount = 0;

  for (const key of SECTION_ORDER) {
    const sectionHeaderRow = sectionMap[key];
    if (sectionHeaderRow === undefined) continue;

    const dataRows = sectionedRows[key] ?? [];
    if (!dataRows.length) continue;

    // 섹션 헤더 다음 행에서 컬럼 헤더 탐색 (최대 3행 내)
    let colHeaderRow = null;
    let colMap = {};
    for (let offset = 1; offset <= 3; offset++) {
      const candidateRow = sectionHeaderRow + offset + insertedRowCount;
      const cm = detectColMap(xlsx, sheet, candidateRow);
      if (Object.keys(cm).length >= 3) {
        colHeaderRow = candidateRow;
        colMap = cm;
        break;
      }
    }

    // 컬럼 헤더를 찾지 못하면 기본 컬럼 순서 사용 (A~I)
    if (colHeaderRow === null) {
      colMap = { title: 0, subject: 1, instructor: 2, hours: 3, period: 4, completedAt: 5, result: 6, subType: 7, note: 8 };
      colHeaderRow = sectionHeaderRow + 1 + insertedRowCount;
    }

    const dataStartRow = colHeaderRow + 1;

    // 기존 시트 범위 확장
    const currentRange = xlsx.utils.decode_range(sheet["!ref"] ?? "A1:A1");

    dataRows.forEach((row, idx) => {
      const r = dataStartRow + idx;

      const period = (row.startDate && row.endDate)
        ? `${formatDate(row.startDate)} ~ ${formatDate(row.endDate)}`
        : (row.startDate ? formatDate(row.startDate) : "");

      const subTypeLabel = row.trainingType === "job"
        ? (row.subType === "initial" ? "초기" : "보수")
        : "";

      const cellData = {
        title:       row.title ?? "",
        subject:     "",            // 현재 시스템에 교육과목 필드 없음 → 공백
        instructor:  row.instructorName ?? "",
        hours:       "",            // 현재 시스템에 교육시간 필드 없음 → 공백
        period,
        completedAt: row.completedAt ? formatDate(row.completedAt) : "",
        result:      row.completionStatus === "completed" ? "PASS" : "",
        subType:     subTypeLabel,
        note:        row.note ?? "",
      };

      for (const [field, colIdx] of Object.entries(colMap)) {
        const addr = xlsx.utils.encode_cell({ r, c: colIdx });
        if (!sheet[addr]) sheet[addr] = {};
        sheet[addr].v = cellData[field] ?? "";
        sheet[addr].t = "s";
      }

      // 범위 확장
      if (r > currentRange.e.r) currentRange.e.r = r;
    });

    sheet["!ref"] = xlsx.utils.encode_range(currentRange);
    insertedRowCount += dataRows.length;
  }
}

/* ──────────────────────────────────────────────────────────
   양식 없을 때 기본 워크북 생성
────────────────────────────────────────────────────────── */
function buildDefaultWorkbook(xlsx, employee, rows) {
  const wb = xlsx.utils.book_new();

  // ─ 인적사항 데이터
  const profileAoa = [
    ["개인교육이력카드"],
    [],
    ["성명",     employee?.name ?? ""],
    ["사번",     employee?.empNo ?? ""],
    ["생년월일", employee?.birthDate ? formatDate(employee.birthDate) : ""],
    ["입사일",   employee?.joinDate  ? formatDate(employee.joinDate)  : ""],
    ["신입/경력", employee?.entryType ?? ""],
    ["사내 자격", employee?.internalLicense ?? ""],
    ["사외 자격", employee?.externalLicense ?? ""],
    ["지점",     employee?.branchName ?? ""],
    ["직책",     employee?.position ?? ""],
  ];

  const ws = xlsx.utils.aoa_to_sheet(profileAoa);

  // 열 너비 설정
  ws["!cols"] = [{ wch: 16 }, { wch: 30 }];

  let nextRow = profileAoa.length + 1;

  // ─ 교육유형별 섹션 추가
  const sectionedRows = {};
  for (const row of rows) {
    const key = getSectionKey(row);
    if (!sectionedRows[key]) sectionedRows[key] = [];
    sectionedRows[key].push(row);
  }

  const headers = ["교육과정명", "교육과목", "강사", "교육시간", "교육기간", "수료일", "결과", "초기/보수", "비고"];

  for (const key of SECTION_ORDER) {
    const sectionRows = sectionedRows[key] ?? [];
    const sectionAoa  = [
      [],
      [SECTION_LABELS[key]],
      headers,
      ...sectionRows.map((row) => {
        const period = (row.startDate && row.endDate)
          ? `${formatDate(row.startDate)} ~ ${formatDate(row.endDate)}`
          : (row.startDate ? formatDate(row.startDate) : "");
        const subType = row.trainingType === "job"
          ? (row.subType === "initial" ? "초기" : "보수")
          : "";
        return [
          row.title ?? "",
          "",
          row.instructorName ?? "",
          "",
          period,
          row.completedAt ? formatDate(row.completedAt) : "",
          row.completionStatus === "completed" ? "PASS" : "",
          subType,
          row.note ?? "",
        ];
      }),
    ];

    xlsx.utils.sheet_add_aoa(ws, sectionAoa, { origin: { r: nextRow, c: 0 } });
    nextRow += sectionAoa.length;
  }

  // 열 너비 재설정
  ws["!cols"] = [
    { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 10 },
    { wch: 24 }, { wch: 14 }, { wch: 8  }, { wch: 10 }, { wch: 20 },
  ];

  xlsx.utils.book_append_sheet(wb, ws, "교육이력카드");
  return wb;
}

/* ──────────────────────────────────────────────────────────
   JSON fallback 데이터 구조
────────────────────────────────────────────────────────── */
function buildJsonFallback(employee, rows) {
  return {
    employee: {
      name:            employee?.name ?? "",
      empNo:           employee?.empNo ?? "",
      birthDate:       employee?.birthDate ? formatDate(employee.birthDate) : "",
      joinDate:        employee?.joinDate  ? formatDate(employee.joinDate)  : "",
      entryType:       employee?.entryType ?? "",
      internalLicense: employee?.internalLicense ?? "",
      externalLicense: employee?.externalLicense ?? "",
      branchName:      employee?.branchName ?? "",
      position:        employee?.position ?? "",
    },
    sections: SECTION_ORDER.map((key) => ({
      label: SECTION_LABELS[key],
      rows: rows
        .filter((r) => getSectionKey(r) === key)
        .map((r) => ({
          교육과정명: r.title ?? "",
          교육과목:   "",
          강사:       r.instructorName ?? "",
          교육시간:   "",
          교육기간:   (r.startDate && r.endDate) ? `${formatDate(r.startDate)} ~ ${formatDate(r.endDate)}` : "",
          수료일:     r.completedAt ? formatDate(r.completedAt) : "",
          결과:       r.completionStatus === "completed" ? "PASS" : "",
          초기보수:   r.trainingType === "job" ? (r.subType === "initial" ? "초기" : "보수") : "",
          비고:       r.note ?? "",
        })),
    })),
  };
}

/* ──────────────────────────────────────────────────────────
   유틸리티
────────────────────────────────────────────────────────── */
function buildFileName(employee, ext) {
  const empNo = String(employee?.empNo ?? "").replace(/[^a-zA-Z0-9가-힣]/g, "_") || "employee";
  const name  = String(employee?.name  ?? "").replace(/[^a-zA-Z0-9가-힣]/g, "_") || "unknown";
  return `교육이력카드_${name}_${empNo}.${ext}`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/* ──────────────────────────────────────────────────────────
   DEFAULT_HISTORY_CARD_MAPPING (하위 호환 export)
────────────────────────────────────────────────────────── */
export const DEFAULT_HISTORY_CARD_MAPPING = {
  overviewSheetName: "교육이력카드",
  dataSheetName:     "이력데이터",
  titleCell:         "A1",
  summaryStartCell:  "A3",
  dataStartCell:     "A1",
};
