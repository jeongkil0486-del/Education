/**
 * history-card-export.js  (v3 — 원본 양식 구조 완전 대응)
 *
 * 원본 양식 구조:
 *   시트 "법정"  → legal 교육
 *   시트 "직무"  → job 교육
 *   온라인/기타  → 직무 시트 하단 (기타교육 레이블)
 *
 * 고정 셀 위치 (두 시트 동일):
 *   성명:  C5   사번:  F5
 *   입사일: F6   (생년월일·자격 등은 데이터 없으면 빈칸 유지)
 *
 * 교육이력 데이터 시작 행: 12 (헤더 행 11)
 *
 * 각 교육과정 = 그룹 (여러 서브과목 행)
 *   그룹 첫 행: A(과정명), C(강사), D(시간), E(기간), F(수료일), G(결과), H(초기보수), I(비고) 입력
 *   그룹 나머지 행: B(서브과목)만 입력, 나머지 병합 or 빈칸
 *   A열은 그룹 전체 병합 (첫 행만 값)
 *   B열 서브과목이 없으면 단일 행
 */

import { authStore } from "../core/auth.js";
import { templatesDB } from "../core/db.js";
import { formatDate } from "../utils/date.js";
import { createEmployeeHistoryCardPdf } from "./history-card-pdf-export.js";

/* ──────────────────────────────────────────────────────────
   SheetJS 로더
────────────────────────────────────────────────────────── */
let _xlsxPromise = null;
async function loadXlsx() {
  if (!_xlsxPromise) {
    _xlsxPromise = import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs").catch(() => null);
  }
  return _xlsxPromise;
}

/* ──────────────────────────────────────────────────────────
   Template DB 함수 (기존 호환 유지)
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
  const base64 = arrayBufferToBase64(buffer);

  // SheetJS로 시트명 및 병합 수 파악
  const xlsx = await loadXlsx();
  let sheetNames = [];
  let mergeCount = 0;
  if (xlsx) {
    try {
      const wb = xlsx.read(buffer, { type: "array", cellStyles: true });
      sheetNames = wb.SheetNames ?? [];
      mergeCount = sheetNames.reduce((n, sn) => n + (wb.Sheets?.[sn]?.["!merges"]?.length ?? 0), 0);
    } catch (e) { /* 무시 */ }
  }

  const created = await templatesDB.create({
    companyId:      authStore.companyId,
    companyName:    authStore.profile?.companyName ?? "",
    templateType:   "history_card",
    title:          "개인교육이력카드 양식",
    fileName:       file.name,
    fileSize:       file.size,
    mimeType:       file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    uploadedAt:     Date.now(),
    uploadedBy:     authStore.uid,
    uploadedByName: authStore.name,
    sheetNames,
    mergeCount,
    mappingVersion: 3,
    mappingMode:    "fixed-cell-v3",
    fileData:       base64,
  });

  return created.key;
}

/* ──────────────────────────────────────────────────────────
   메인 내보내기 함수
────────────────────────────────────────────────────────── */
export async function exportEmployeeHistoryCard({ employee, rows }) {
  return createEmployeeHistoryCardPdf({ employee, rows });
}

/* ──────────────────────────────────────────────────────────
   원본 양식에 데이터 채우기
   - 원본 양식: "법정" 시트 + "직무" 시트
   - 인적사항 고정 셀: C5=성명, F5=사번, F6=입사일
   - 데이터 시작: 행 12 (헤더=행 11)
────────────────────────────────────────────────────────── */
function fillTemplateWorkbook(xlsx, wb, employee, rows) {
  const sheetNames = wb.SheetNames ?? [];

  // 시트명 감지 (법정/직무 또는 유사 이름)
  const legalSheetName = sheetNames.find((n) => n.includes("법정") || n.includes("legal")) ?? sheetNames[0];
  const jobSheetName   = sheetNames.find((n) => n.includes("직무") || n.includes("job")) ?? sheetNames[1] ?? sheetNames[0];

  // 교육 분류
  const legalRows = rows.filter((r) => normalizeType(r.trainingType) === "legal");
  const jobRows   = rows.filter((r) => normalizeType(r.trainingType) !== "legal");

  if (legalSheetName && wb.Sheets[legalSheetName]) {
    fillSheet(xlsx, wb.Sheets[legalSheetName], employee, legalRows, "법정");
  }
  if (jobSheetName && wb.Sheets[jobSheetName]) {
    fillSheet(xlsx, wb.Sheets[jobSheetName], employee, jobRows, "직무");
  }
}

function normalizeType(t) {
  if (!t) return "";
  const s = String(t).toLowerCase();
  if (s === "legal") return "legal";
  if (s === "job")   return "job";
  return s;
}

/* ──────────────────────────────────────────────────────────
   단일 시트 채우기
────────────────────────────────────────────────────────── */
function fillSheet(xlsx, sheet, employee, rows, sheetType) {
  // ─ 인적사항 고정 셀 채우기
  // 원본 양식 위치: 성명=C5, 사번=F5, 입사일=F6
  // 실제 양식의 셀 위치를 탐지
  const profileCells = detectProfileCells(xlsx, sheet);
  writeCell(sheet, profileCells.name    ?? "C5", employee?.name     ?? "");
  writeCell(sheet, profileCells.empNo   ?? "F5", employee?.empNo    ?? "");
  writeCell(sheet, profileCells.joinDate?? "F6", fmtDate(employee?.joinDate  ?? employee?.hireDate ?? employee?.joinedAt));

  // ─ 데이터 헤더 행 탐지 (교육과정명, 교육과목 등이 있는 행)
  const headerRow = detectHeaderRow(xlsx, sheet);  // 0-based
  const dataStart = headerRow + 1;                 // 0-based

  // ─ 원본에 있던 기존 데이터 행 모두 지우기 (헤더 아래 행만)
  clearDataRows(xlsx, sheet, dataStart);

  if (!rows || rows.length === 0) return;

  // ─ 교육과정 그룹화 (과정명 + 수료일 기준)
  const groups = groupByTraining(rows);

  // ─ 컬럼 매핑 탐지
  const colMap = detectColMap(xlsx, sheet, headerRow);

  // ─ 템플릿 행 서식 복제 소스
  const templateRowNum = dataStart; // 0-based

  let currentRow = dataStart; // 0-based

  for (const group of groups) {
    const subjectCount = Math.max(1, group.subjects.length);

    for (let i = 0; i < subjectCount; i++) {
      // 행 서식 복제 (템플릿 행에서)
      copyRowStyle(sheet, templateRowNum, currentRow, 9);
      sheet["!rows"] = sheet["!rows"] ?? [];
      sheet["!rows"][currentRow] = { hpt: 16.5 }; // 행 높이

      // 첫 행: 과정명·강사·시간·기간·수료일·결과·초기보수·비고 입력
      if (i === 0) {
        setCell(sheet, colMap.title       ?? 0, currentRow, group.title);
        setCell(sheet, colMap.instructor  ?? 2, currentRow, group.instructorName ?? "");
        setCell(sheet, colMap.hours       ?? 3, currentRow, group.hours         ?? "");
        setCell(sheet, colMap.period      ?? 4, currentRow, fmtPeriod(group.startDate, group.endDate, group.completedAt));
        setCell(sheet, colMap.completedAt ?? 5, currentRow, fmtDate(group.completedAt));
        setCell(sheet, colMap.result      ?? 6, currentRow, group.result || "PASS");
        setCell(sheet, colMap.subType     ?? 7, currentRow, fmtSubType(group));
        setCell(sheet, colMap.note        ?? 8, currentRow, group.note ?? "");
      }

      // B열: 교육과목 (각 행마다)
      const subject = group.subjects[i] ?? "";
      if (subject) {
        setCell(sheet, colMap.subject ?? 1, currentRow, subject);
      }

      currentRow++;
    }
  }

  // ─ !ref 범위 갱신
  const oldRange = xlsx.utils.decode_range(sheet["!ref"] ?? "A1:I200");
  if (currentRow - 1 > oldRange.e.r) oldRange.e.r = currentRow - 1;
  sheet["!ref"] = xlsx.utils.encode_range(oldRange);
}

/* ──────────────────────────────────────────────────────────
   교육 그룹화: 과정명(title) + 수료일 기준
────────────────────────────────────────────────────────── */
function groupByTraining(rows) {
  // 1. 과정명 + 수료일로 그룹키 생성
  const grouped = new Map();

  const sortedRows = [...rows].sort((a, b) => {
    const ta = a.courseName ?? a.title ?? a.subjectName ?? "";
    const tb = b.courseName ?? b.title ?? b.subjectName ?? "";
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return Number(a.completedAt ?? 0) - Number(b.completedAt ?? 0);
  });

  for (const row of sortedRows) {
    const title    = row.courseName ?? row.title ?? row.subjectName ?? "";
    const compDate = fmtDate(row.completedAt);
    const key      = `${title}__${compDate}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        title,
        instructorName: row.instructorName ?? "",
        hours:          fmtHours(row.hours ?? row.durationHours),
        startDate:      row.startDate,
        endDate:        row.endDate,
        completedAt:    row.completedAt,
        result:         row.result ?? (row.completionStatus === "completed" ? "PASS" : ""),
        educationStage: row.educationStage,
        educationType:  row.educationType,
        subType:        row.subType,
        note:           row.note ?? "",
        trainingType:   row.trainingType,
        subjects:       [],
      });
    }

    // 교육과목 추가
    const subj = row.subjectName ?? row.subject ?? "";
    const group = grouped.get(key);
    if (subj && subj !== title && !group.subjects.includes(subj)) {
      group.subjects.push(subj);
    }
  }

  return [...grouped.values()];
}

/* ──────────────────────────────────────────────────────────
   셀 감지 함수들
────────────────────────────────────────────────────────── */
function detectProfileCells(xlsx, sheet) {
  // 원본 양식 고정: 성명 옆 = C5, 사번 옆 = F5, 입사일 옆 = F6
  const range = xlsx.utils.decode_range(sheet["!ref"] ?? "A1:Z50");
  const map   = {};

  const LABELS = {
    name:     ["성명", "이름"],
    empNo:    ["사번", "직원번호"],
    joinDate: ["입사일"],
  };

  for (let r = range.s.r; r <= Math.min(range.e.r, 15); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell?.v) continue;
      const text = String(cell.v).replace(/\s+/g, "");

      for (const [field, patterns] of Object.entries(LABELS)) {
        if (map[field]) continue;
        if (patterns.some((p) => text.includes(p.replace(/\s+/g, "")))) {
          // 오른쪽 두 번째 또는 오른쪽 셀이 값 입력 위치
          const rightAddr  = xlsx.utils.encode_cell({ r, c: c + 1 });
          const right2Addr = xlsx.utils.encode_cell({ r, c: c + 2 });
          const rightCell  = sheet[rightAddr];
          // 값이 있으면 그 셀 자체가 값 셀
          if (rightCell?.v) {
            map[field] = rightAddr;
          } else {
            map[field] = right2Addr;
          }
          break;
        }
      }
    }
  }

  return map;
}

function detectHeaderRow(xlsx, sheet) {
  const range = xlsx.utils.decode_range(sheet["!ref"] ?? "A1:Z200");
  for (let r = range.s.r; r <= Math.min(range.e.r, 20); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell?.v) continue;
      const text = String(cell.v).trim();
      if (text.includes("교육과정명") || text === "교육과정") return r;
    }
  }
  return 10; // fallback: 행 11 (0-based)
}

function detectColMap(xlsx, sheet, headerRow) {
  const colMap = {};
  const range  = xlsx.utils.decode_range(sheet["!ref"] ?? "A1:Z200");
  const COL_PATTERNS = {
    title:       ["교육과정명", "교육과정", "과정명", "교육명"],
    subject:     ["교육과목", "과목"],
    instructor:  ["강사"],
    hours:       ["교육시간", "시간"],
    period:      ["교육기간", "기간"],
    completedAt: ["수료일자", "수료일", "완료일"],
    result:      ["결과"],
    subType:     ["초기/보수", "초기", "보수"],
    note:        ["비고"],
  };

  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = xlsx.utils.encode_cell({ r: headerRow, c });
    const cell = sheet[addr];
    if (!cell?.v) continue;
    const text = String(cell.v).trim().replace(/\s+/g, "");
    for (const [field, patterns] of Object.entries(COL_PATTERNS)) {
      if (colMap[field] !== undefined) continue;
      if (patterns.some((p) => text.includes(p.replace(/\s+/g, "")))) {
        colMap[field] = c;
        break;
      }
    }
  }

  // fallback (원본 양식 기준: A=0 B=1 C=2 D=3 E=4 F=5 G=6 H=7 I=8)
  if (Object.keys(colMap).length < 5) {
    return { title: 0, subject: 1, instructor: 2, hours: 3, period: 4, completedAt: 5, result: 6, subType: 7, note: 8 };
  }
  return colMap;
}

/* ──────────────────────────────────────────────────────────
   행 서식 복제 (병합 제외, 값과 서식만)
────────────────────────────────────────────────────────── */
function copyRowStyle(sheet, srcRow, dstRow, numCols) {
  for (let c = 0; c < numCols; c++) {
    const srcAddr = encodeCell(c, srcRow);
    const dstAddr = encodeCell(c, dstRow);
    const srcCell = sheet[srcAddr];
    if (srcCell) {
      // 기존 서식 구조 복제 (값 제외)
      const newCell = {
        t: "z", // 빈 값
        s: srcCell.s ? JSON.parse(JSON.stringify(srcCell.s)) : undefined,
      };
      sheet[dstAddr] = newCell;
    } else {
      sheet[dstAddr] = { t: "z" };
    }
  }
}

function clearDataRows(xlsx, sheet, dataStartRow) {
  const range = xlsx.utils.decode_range(sheet["!ref"] ?? "A1:I200");
  for (let r = dataStartRow; r <= range.e.r; r++) {
    for (let c = 0; c < 9; c++) {
      const addr = encodeCell(c, r);
      if (sheet[addr]) {
        sheet[addr].v = undefined;
        sheet[addr].t = "z";
        delete sheet[addr].f;
      }
    }
  }
  // 기존 병합 제거 (데이터 영역)
  if (sheet["!merges"]) {
    sheet["!merges"] = sheet["!merges"].filter(
      (m) => m.e.r < dataStartRow || m.s.r < dataStartRow
    );
  }
}

function setCell(sheet, colIdx, rowIdx, value) {
  if (colIdx === undefined || colIdx < 0) return;
  const addr = encodeCell(colIdx, rowIdx);
  if (!sheet[addr]) sheet[addr] = {};
  sheet[addr].v = value ?? "";
  sheet[addr].t = (typeof value === "number") ? "n" : "s";
  delete sheet[addr].f;
}

function writeCell(sheet, addr, value) {
  if (!addr) return;
  if (!sheet[addr]) sheet[addr] = {};
  sheet[addr].v = value ?? "";
  sheet[addr].t = "s";
  delete sheet[addr].f;
}

function encodeCell(col, row) {
  const col26 = (n) => {
    let s = "";
    n++;
    while (n > 0) { s = String.fromCharCode(64 + (n % 26 || 26)) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  return `${col26(col)}${row + 1}`;
}

/* ──────────────────────────────────────────────────────────
   포맷 헬퍼
────────────────────────────────────────────────────────── */
function fmtDate(v) {
  if (!v) return "";
  const n = Number(v);
  let d;
  if (Number.isFinite(n) && n > 1e10) {
    d = new Date(n);
  } else {
    d = new Date(String(v));
  }
  if (isNaN(d.getTime())) return String(v ?? "");
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function fmtPeriod(startDate, endDate, completedAt) {
  if (startDate && endDate) {
    const s = fmtDate(startDate);
    const e = fmtDate(endDate);
    return s === e ? s : `${s}~${e}`;
  }
  if (startDate) return fmtDate(startDate);
  if (completedAt) return fmtDate(completedAt);
  return "";
}

function fmtHours(h) {
  if (!h && h !== 0) return "";
  const n = Number(h);
  if (isNaN(n) || n === 0) return "";
  return Number.isInteger(n) ? `${n}HRS` : `${n}HRS`;
}

function fmtSubType(group) {
  // educationStage 우선
  const es = String(group.educationStage ?? "").toLowerCase();
  const et = String(group.educationType  ?? "").toLowerCase();
  const st = String(group.subType        ?? "").toLowerCase();

  if (es === "initial" || et === "initial" || st === "initial")   return "초기";
  if (es === "previous_year" || es === "current_year" || es === "latest_only") return "보수";
  if (et === "recurrent" || st === "recurring" || st === "recurrent") return "보수";
  return "";
}

/* ──────────────────────────────────────────────────────────
   양식 없을 때 기본 워크북 생성
────────────────────────────────────────────────────────── */
function buildDefaultWorkbook(xlsx, employee, rows) {
  const wb = xlsx.utils.book_new();

  const legalRows = rows.filter((r) => normalizeType(r.trainingType) === "legal");
  const jobRows   = rows.filter((r) => normalizeType(r.trainingType) !== "legal");

  for (const [sheetName, sheetRows] of [["법정", legalRows], ["직무", jobRows]]) {
    const aoa = [
      ["교   육   이  력   카   드"],
      [],
      [],
      [],
      ["", "성       명", employee?.name ?? "", "", "사     번", employee?.empNo ?? ""],
      ["", "입 사 일", fmtDate(employee?.joinDate ?? employee?.hireDate), "", "", ""],
      [],
      [],
      [sheetName === "법정" ? "법정교육" : "보수교육 및 사내교육"],
      ["교육과정명", "교육과목", "강사", "교육시간", "교육기간", "수료일자", "결과", "초기/보수", "비고"],
      ...buildDefaultDataAoa(sheetRows),
    ];

    const ws = xlsx.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 18 }, { wch: 28 }, { wch: 10 }, { wch: 10 },
      { wch: 18 }, { wch: 12 }, { wch: 8  }, { wch: 10 }, { wch: 16 },
    ];
    xlsx.utils.book_append_sheet(wb, ws, sheetName);
  }

  return wb;
}

function buildDefaultDataAoa(rows) {
  const groups = groupByTraining(rows);
  const aoa = [];
  for (const g of groups) {
    const subs = g.subjects.length > 0 ? g.subjects : [""];
    subs.forEach((sub, i) => {
      if (i === 0) {
        aoa.push([
          g.title,
          sub,
          g.instructorName ?? "",
          g.hours ?? "",
          fmtPeriod(g.startDate, g.endDate, g.completedAt),
          fmtDate(g.completedAt),
          g.result || "PASS",
          fmtSubType(g),
          g.note ?? "",
        ]);
      } else {
        aoa.push(["", sub, "", "", "", "", "", "", ""]);
      }
    });
  }
  return aoa;
}

/* ──────────────────────────────────────────────────────────
   JSON fallback
────────────────────────────────────────────────────────── */
function buildJsonFallback(employee, rows) {
  return {
    employee: {
      name:     employee?.name     ?? "",
      empNo:    employee?.empNo    ?? "",
      joinDate: fmtDate(employee?.joinDate ?? employee?.hireDate),
      position: employee?.position ?? "",
      branch:   employee?.branchName ?? "",
    },
    법정교육: groupByTraining(rows.filter((r) => normalizeType(r.trainingType) === "legal")),
    직무교육: groupByTraining(rows.filter((r) => normalizeType(r.trainingType) !== "legal")),
  };
}

/* ──────────────────────────────────────────────────────────
   유틸리티
────────────────────────────────────────────────────────── */
function buildFileName(employee, ext) {
  const name  = String(employee?.name  ?? "").replace(/[^a-zA-Z0-9가-힣]/g, "_") || "직원";
  const empNo = String(employee?.empNo ?? "").replace(/[^a-zA-Z0-9가-힣]/g, "_") || "사번없음";
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
   하위 호환 export
────────────────────────────────────────────────────────── */
export const DEFAULT_HISTORY_CARD_MAPPING = {
  overviewSheetName: "법정",
  dataSheetName:     "직무",
  titleCell:         "A2",
  summaryStartCell:  "C5",
  dataStartCell:     "A12",
};
