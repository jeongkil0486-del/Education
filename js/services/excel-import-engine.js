/**
 * Excel Import Engine  v3.0
 * ─────────────────────────────────────────────────────────────────
 * Reader → Normalizer → TemplateDetector → Mapper → Validator → Preview → Import
 *
 * 지원 양식:
 *  A. 법정/직무 분리 시트 — 표준형 (전정길, 신형 영문병기 등)
 *  B. 법정/직무 분리 시트 — TAS형 (김소현, 박진우, 김연수, 배예나, 김채영)
 *  C. 법정/직무 분리 시트 — 보수예정/교육이수형 (신태용, 배수민, 강재원)
 *  D. Sheet1 단일 시트 — 섹션 분리형 (이지현)
 * ─────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════
// § 0.  SheetJS 로더
// ═══════════════════════════════════════════════════════════════════
let _xlsxPromise = null;
async function loadXlsx() {
  if (!_xlsxPromise) {
    _xlsxPromise = import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs").catch(() => null);
  }
  return _xlsxPromise;
}

// ═══════════════════════════════════════════════════════════════════
// § 1.  READER  —  원본 셀 데이터 추출
// ═══════════════════════════════════════════════════════════════════
async function readerRead(file) {
  const XLSX = await loadXlsx();
  if (!XLSX) throw new Error("SheetJS 로드 실패");

  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: false, dense: false });

  return wb.SheetNames.filter((n) => !n.startsWith("_")).map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const ref = ws["!ref"] ?? "A1:A1";
    const range = XLSX.utils.decode_range(ref);

    const cells = {};
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;
        let v = cell.v;
        if (v == null) v = cell.w ?? null;
        if (v != null) cells[`${r},${c}`] = v;
      }
    }

    // 병합맵
    const mergeMap = {};
    for (const m of ws["!merges"] ?? []) {
      const anchorAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
      const anchorVal = ws[anchorAddr]?.v ?? ws[anchorAddr]?.w ?? null;
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          mergeMap[`${r},${c}`] = anchorVal;
        }
      }
    }

    return { sheetName, cells, mergeMap, maxRow: range.e.r, maxCol: range.e.c };
  });
}

function rawCell(sheet, r, c) {
  const key = `${r},${c}`;
  if (key in sheet.mergeMap) return sheet.mergeMap[key];
  return sheet.cells[key] ?? null;
}

// ═══════════════════════════════════════════════════════════════════
// § 2.  NORMALIZER
// ═══════════════════════════════════════════════════════════════════

// 공백·괄호 제거 + 소문자
function norm(v) {
  if (v == null) return "";
  return String(v)
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

// ── Stage 정규화
const STAGE_INITIAL  = new Set(["초기", "초기교육", "initial"]);
const STAGE_RECURRENT = new Set(["보수", "보수교육", "정기", "정기교육", "recurrent", "recurring", "갱신"]);
const RESULT_PASS_SET = new Set(["pass", "이수", "수료", "완료", "합격"]);
const RESULT_FAIL_SET = new Set(["fail", "미수료", "불합격"]);

function normStage(v) {
  if (!v) return null;
  const s = norm(v);
  if (STAGE_INITIAL.has(s))   return "initial";
  if (STAGE_RECURRENT.has(s)) return "recurrent";
  return null; // result 값은 null
}

function normResult(v) {
  if (!v) return null;
  const s = norm(v);
  if (STAGE_INITIAL.has(s) || STAGE_RECURRENT.has(s)) return null; // stage 값은 무시
  if (RESULT_PASS_SET.has(s)) return "PASS";
  if (RESULT_FAIL_SET.has(s)) return "FAIL";
  return null;
}

/** result/stage 열 교차 감지·보정 */
function resolveResultStage(rawResult, rawStage) {
  const stageFromResultCol  = normStage(rawResult);
  const resultFromStageCol  = normResult(rawStage);
  const stageFromStageCol   = normStage(rawStage);
  const resultFromResultCol = normResult(rawResult);

  let finalResult = resultFromResultCol ?? null;
  let finalStage  = stageFromStageCol  ?? null;

  if (!finalResult && resultFromStageCol) finalResult = resultFromStageCol;
  if (!finalStage  && stageFromResultCol) finalStage  = stageFromResultCol;

  return {
    result:             finalResult ?? "PASS",
    initialOrRecurrent: finalStage  ?? null,
  };
}

// ── 헤더 별칭 테이블
const HEADER_ALIAS = {
  // 교육과정명
  교육과정명:    "courseName",  교육과정:  "courseName",
  과정명:        "courseName",  교육과정명curriculum: "courseName",
  // 교육과목
  교육과목:      "subjectName", 과목:      "subjectName",
  // 강사
  강사:          "instructor",  instructor: "instructor",
  // 교육시간
  교육시간:      "hours",       "교육\n시간": "hours",
  교육시간time:  "hours",       시간:          "hours",
  // 교육기간 / 교육일자 / 교육날짜
  교육기간:      "period",      교육일자:   "period",
  교육기간period:"period",      기간:       "period",
  // 수료일자
  수료일자:      "completedAt", 수료일:     "completedAt",
  "수료\n일자":  "completedAt", completion:  "completedAt",
  // 결과
  결과:          "result",      result:     "result",
  결과result:    "result",
  // 초기/보수 (stage)
  "초기/보수":   "stage",       초기보수:   "stage",
  "initial/recurrent": "stage", initialrecurrent: "stage",
  // 보수 예정 (신태용/배수민 양식): stage
  보수예정:      "stage",
  // 교육 이수 / 발령일자 (신태용/배수민 양식): result 대용
  교육이수:      "result2",     발령일자:   "result2",
  // 비고
  비고:          "note",        remark:     "note",
};

function normHeader(v) {
  if (!v) return "";
  const cleaned = norm(v);
  return HEADER_ALIAS[cleaned] ?? cleaned;
}

// ── 시간 파싱: "3 HRS" → 3, "4H" → 4, "27H" → 27, "8HRS\n(4HRS...)" → 8
function normHours(v) {
  if (v == null || v === "") return null;
  const s = String(v).split(/[\n(]/)[0]
    .replace(/[Hh][Rr][Ss]?/g, "")
    .replace(/시간/g, "")
    .trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ── 날짜: Excel serial / ISO / YYYY.MM.DD / YYYY-MM-DD / datetime string
function normDate(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 30000 && n < 2958466) {
    return Math.round((n - 25569) * 86400 * 1000);
  }
  let s = String(v).trim();
  // "2024-02-26 00:00:00" 패턴 (datetime string)
  s = s.replace(/ 00:00:00$/, "").trim();
  // 범위면 첫 번째만
  s = s.split(/[~–\n/]/)[0].trim();
  // 구분자 통일
  s = s.replace(/[.]/g, "-");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// ── 기간: 다양한 패턴 → { startDate, endDate }
function normPeriod(v) {
  if (!v) return { startDate: null, endDate: null };
  const s = String(v).trim();

  // YYYY.MM.DD\nYYYY.MM.DD 또는 YYYY.MM.DD~YYYY.MM.DD (전체 연도)
  const m0 = s.match(
    /(\d{4})[.\-\/\s]+(\d{1,2})[.\-\/\s]+(\d{1,2})\s*[~–\-\n\/]\s*(\d{4})[.\-\/\s]+(\d{1,2})[.\-\/\s]+(\d{1,2})/
  );
  if (m0) {
    return {
      startDate: normDate(`${m0[1]}-${m0[2].padStart(2,"0")}-${m0[3].padStart(2,"0")}`),
      endDate:   normDate(`${m0[4]}-${m0[5].padStart(2,"0")}-${m0[6].padStart(2,"0")}`),
    };
  }
  // YYYY.MM.DD~MM.DD (단축 종료)
  const m1 = s.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s*[~–-]\s*(\d{1,2})[.\-](\d{1,2})$/);
  if (m1) {
    return {
      startDate: normDate(`${m1[1]}-${m1[2].padStart(2,"0")}-${m1[3].padStart(2,"0")}`),
      endDate:   normDate(`${m1[1]}-${m1[4].padStart(2,"0")}-${m1[5].padStart(2,"0")}`),
    };
  }
  return { startDate: normDate(s), endDate: null };
}

// ── 이름 정규화 (공백, 영문 제거)
function normName(v) {
  if (!v) return "";
  return String(v)
    .replace(/\([^)]*\)/g, "")
    .replace(/[a-zA-Z]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── 사번 정규화 (탭·공백 제거)
function normEmpNo(v) {
  if (!v) return "";
  return String(v).replace(/[\t\s]/g, "").toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════
// § 3.  TEMPLATE DETECTOR
// ═══════════════════════════════════════════════════════════════════

/**
 * 공통 헤더 행 탐지: 교육과정명/과목 포함 행
 * 반환: 행 인덱스(0-based) 또는 -1
 */
function findHeaderRow(sheet, startRow = 0, endRow = 30) {
  for (let r = startRow; r <= Math.min(endRow, sheet.maxRow); r++) {
    for (let c = 0; c <= sheet.maxCol; c++) {
      const v = rawCell(sheet, r, c);
      if (!v) continue;
      const h = normHeader(v);
      if (h === "courseName" || h === "subjectName") return r;
    }
  }
  return -1;
}

/**
 * 섹션 헤더 탐지: "법정교육"/"보수교육 및 사내교육" 같은 섹션 구분자 행
 * 반환: { row, type: "legal"|"job" }[]
 */
function findSectionHeaders(sheet) {
  const sections = [];
  for (let r = 0; r <= sheet.maxRow; r++) {
    const v = String(rawCell(sheet, r, 0) ?? rawCell(sheet, r, 1) ?? "").trim();
    const n = norm(v);
    if (n.includes("법정교육"))                    sections.push({ row: r, type: "legal" });
    else if (n.includes("직무교육") || n.includes("보수교육") || n.includes("사내교육"))
                                                    sections.push({ row: r, type: "job" });
  }
  return sections;
}

/** 시트가 TAS 양식인지 (수료일 열이 헤더에 없고 6~7열에 존재) */
function isTasSheet(sheet) {
  const hr = findHeaderRow(sheet);
  if (hr < 0) return false;
  // 헤더에 completedAt 열이 없으면 TAS
  for (let c = 0; c <= sheet.maxCol; c++) {
    const v = rawCell(sheet, hr, c);
    if (normHeader(v) === "completedAt") return false;
  }
  return true;
}

/** 시트가 보수예정/교육이수형인지 */
function isBosooSheet(sheet) {
  const hr = findHeaderRow(sheet);
  if (hr < 0) return false;
  for (let c = 0; c <= sheet.maxCol; c++) {
    const v = rawCell(sheet, hr, c);
    const h = normHeader(v);
    if (h === "stage" && norm(rawCell(sheet, hr, c) ?? "") === "보수예정") return true;
  }
  return false;
}

// ── Parser A: 표준형 (법정/직무 시트 분리, 컬럼 정상 존재)
const ParserStandard = {
  id: "standard",
  name: "표준형 (법정/직무 분리)",
  detect(sheet) {
    return !isTasSheet(sheet) && !isBosooSheet(sheet) && findHeaderRow(sheet) >= 0;
  },
  parse(sheet, trainingType) {
    return _parseBlock(sheet, findHeaderRow(sheet), sheet.maxRow, trainingType, { splitSubjects: false });
  },
};

// ── Parser B: TAS형 (수료일 열 헤더 없음 → 6열 또는 7열에서 직접 읽기)
const ParserTAS = {
  id: "tas",
  name: "TAS형 (수료일 헤더 없음)",
  detect(sheet) { return isTasSheet(sheet); },
  parse(sheet, trainingType) {
    return _parseTAS(sheet, trainingType);
  },
};

// ── Parser C: 보수예정/교육이수형 (신태용/배수민/강재원)
const ParserBosoo = {
  id: "bosoo",
  name: "보수예정/교육이수형",
  detect(sheet) { return isBosooSheet(sheet); },
  parse(sheet, trainingType) {
    return _parseBosoo(sheet, trainingType);
  },
};

// ── Parser D: Sheet1 단일 시트 섹션형 (이지현)
const ParserSheet1 = {
  id: "sheet1_section",
  name: "Sheet1 섹션 분리형",
  detect(sheet) {
    const sections = findSectionHeaders(sheet);
    return sections.length >= 2;
  },
  parse(sheet) {
    return _parseSheet1(sheet);
  },
};

// ── Parser Z: Generic (fallback)
const ParserGeneric = {
  id: "generic",
  name: "Generic",
  detect() { return true; },
  parse(sheet, trainingType) {
    return _parseBlock(sheet, findHeaderRow(sheet), sheet.maxRow, trainingType, { splitSubjects: false });
  },
};

// 순서: 구체적인 것 먼저
const PARSERS = [ParserSheet1, ParserTAS, ParserBosoo, ParserStandard, ParserGeneric];

function detectParser(sheet) {
  for (const p of PARSERS) {
    if (p.detect(sheet)) return p;
  }
  return ParserGeneric;
}

// ═══════════════════════════════════════════════════════════════════
// § 4.  MAPPER
// ═══════════════════════════════════════════════════════════════════

/** 직원 정보 탐지 */
function detectEmpInfo(sheet, headerRow) {
  let name = "", empNo = "";
  const limit = Math.min(headerRow + 1, 15);
  for (let r = 0; r <= limit; r++) {
    for (let c = 0; c <= sheet.maxCol; c++) {
      const v = rawCell(sheet, r, c);
      if (!v) continue;
      const key = norm(v);
      if (key === "성명" || key === "이름" || key === "성명name") {
        for (let dc = 1; dc <= 5; dc++) {
          const cand = rawCell(sheet, r, c + dc);
          if (cand) {
            const s = normName(String(cand));
            if (s && norm(s) !== "사번" && norm(s) !== "생년월일") { name = s; break; }
          }
        }
      }
      if (key === "사번" || key === "사번idnbr" || key === "직원번호") {
        for (let dc = 1; dc <= 5; dc++) {
          const cand = rawCell(sheet, r, c + dc);
          if (cand) {
            const s = normEmpNo(String(cand));
            if (s && !["성명", "이름", "생년월일"].includes(norm(s))) { empNo = s; break; }
          }
        }
      }
    }
  }
  return { name, empNo };
}

/** 컬럼맵 구축 */
function buildColMap(sheet, headerRow) {
  const colMap = {};
  for (let c = 0; c <= sheet.maxCol; c++) {
    const v = rawCell(sheet, headerRow, c);
    if (!v) continue;
    const key = normHeader(v);
    if (key && !colMap[key]) colMap[key] = c;
  }
  return colMap;
}

/**
 * 표준 블록 파싱
 * dataStart: 데이터 시작 행(0-based), dataEnd: 종료 행
 * trainingType: "legal"|"job"|"other"
 */
function _parseBlock(sheet, headerRow, dataEnd, trainingType, { splitSubjects = false } = {}) {
  if (headerRow < 0) return [];

  const colMap  = buildColMap(sheet, headerRow);
  const empInfo = detectEmpInfo(sheet, headerRow);
  const rows    = [];

  const inherit = {
    courseName: "", instructor: "", hours: null, period: "",
    completedAt: null, result: "", stage: "", note: "",
  };

  for (let r = headerRow + 1; r <= dataEnd; r++) {
    const get = (field) => {
      const c = colMap[field];
      return c !== undefined ? rawCell(sheet, r, c) : null;
    };

    const courseRaw    = get("courseName");
    const subjectRaw   = get("subjectName");
    const instructorRaw = get("instructor");
    const hoursRaw     = get("hours");
    const periodRaw    = get("period");
    const completedRaw = get("completedAt");
    const resultRaw    = get("result");
    // result2 = 교육이수 / 발령일자 → stage 혹은 result 보조
    const result2Raw   = get("result2");
    const stageRaw     = get("stage");
    const noteRaw      = get("note");

    // ── 과정명 상속
    const courseName = courseRaw != null
      ? String(courseRaw).replace(/\n/g, " ").trim()
      : inherit.courseName;
    if (courseRaw != null) inherit.courseName = courseName;

    // ── 나머지 상속
    const instructor  = instructorRaw  != null ? String(instructorRaw).replace(/\n/g, ", ").trim() : inherit.instructor;
    const hoursVal    = hoursRaw       != null ? hoursRaw : inherit.hours;
    const period      = periodRaw      != null ? String(periodRaw)  : inherit.period;
    const completedAt = completedRaw   != null ? completedRaw       : inherit.completedAt;
    const result      = resultRaw      != null ? String(resultRaw)  : inherit.result;
    const stage       = stageRaw       != null ? String(stageRaw)   : inherit.stage;
    const note        = noteRaw        != null ? String(noteRaw)    : inherit.note;

    if (instructorRaw  != null) inherit.instructor  = instructor;
    if (hoursRaw       != null) inherit.hours       = hoursRaw;
    if (periodRaw      != null) inherit.period      = period;
    if (completedRaw   != null) inherit.completedAt = completedRaw;
    if (resultRaw      != null) inherit.result      = result;
    if (stageRaw       != null) inherit.stage       = stage;
    if (noteRaw        != null) inherit.note        = note;

    if (!courseName && !subjectRaw) continue;

    const { startDate, endDate } = normPeriod(period);
    const completedMs = normDate(completedAt);

    // result2(교육이수) 처리: stage 열에 보수예정, result2 열에 이수 같은 구조
    let rawResultFinal = result;
    let rawStageFinal  = stage;
    if (result2Raw != null) {
      const r2 = String(result2Raw).trim();
      // result2가 result 값이면 result로 사용
      if (normResult(r2)) rawResultFinal = r2;
      // result2가 stage 값이면 stage로 사용 (보완)
      else if (normStage(r2)) rawStageFinal = rawStageFinal || r2;
    }

    let subjects = [];
    if (subjectRaw != null) {
      const raw = String(subjectRaw);
      subjects = splitSubjects
        ? raw.split(/\n/).map((s) => s.trim()).filter(Boolean)
        : [raw.trim()].filter(Boolean);
    }
    if (!subjects.length) subjects = [""];

    if (!courseName && subjects.every((s) => !s) && !completedMs) continue;

    for (const subjectName of subjects) {
      rows.push({
        employeeName: empInfo.name,
        empNo:        empInfo.empNo,
        trainingType,
        courseName:   courseName || subjectName,
        subjectName:  subjectName || courseName,
        instructor,
        hours:        normHours(hoursVal),
        startDate,
        endDate,
        completedAt:  completedMs,
        ...resolveResultStage(rawResultFinal, rawStageFinal),
        note:         String(note).replace(/\n/g, " ").trim(),
      });
    }
  }

  return rows;
}

/**
 * TAS 형 파싱
 * 헤더에 수료일자 열이 없고, 실제 데이터에서 6열(col5) 또는 7열(col6)에 수료일이 있음
 * 교육일자 열을 period로, 별도 수료일을 completedAt으로 처리
 */
function _parseTAS(sheet, trainingType) {
  const hr = findHeaderRow(sheet);
  if (hr < 0) return [];

  const colMap  = buildColMap(sheet, hr);
  const empInfo = detectEmpInfo(sheet, hr);
  const rows    = [];

  // TAS에서 수료일은 헤더가 없어도 6열(col5)이나 7열(col6)에 있음
  // period 열(교육일자) 옆 열을 completedAt으로 추정
  let completedAtCol = -1;
  const periodCol = colMap["period"] ?? -1;
  if (periodCol >= 0) {
    // 헤더에 없는 오른쪽 열 탐색 (데이터 행에서 날짜값 확인)
    for (let dc = 1; dc <= 3; dc++) {
      const testCol = periodCol + dc;
      // 이 열이 다른 헤더가 아닌지 확인
      const headerVal = normHeader(rawCell(sheet, hr, testCol) ?? "");
      if (headerVal === "stage" || headerVal === "note" || headerVal === "result2") continue;
      // 데이터 행에서 날짜 같은 값이 있는지
      for (let r = hr + 1; r <= Math.min(hr + 5, sheet.maxRow); r++) {
        const v = rawCell(sheet, r, testCol);
        if (v && normDate(v)) { completedAtCol = testCol; break; }
      }
      if (completedAtCol >= 0) break;
    }
  }

  const inherit = {
    courseName: "", instructor: "", hours: null, period: "",
    completedAt: null, result: "", stage: "", note: "",
  };

  for (let r = hr + 1; r <= sheet.maxRow; r++) {
    const get = (field) => {
      const c = colMap[field];
      return c !== undefined ? rawCell(sheet, r, c) : null;
    };

    const courseRaw    = get("courseName");
    const subjectRaw   = get("subjectName");
    const instructorRaw = get("instructor");
    const hoursRaw     = get("hours");
    const periodRaw    = get("period");
    const completedRaw = completedAtCol >= 0 ? rawCell(sheet, r, completedAtCol) : get("completedAt");
    const stageRaw     = get("stage");
    const result2Raw   = get("result2");
    const noteRaw      = get("note");

    const courseName = courseRaw != null
      ? String(courseRaw).replace(/\n/g, " ").trim()
      : inherit.courseName;
    if (courseRaw != null) inherit.courseName = courseName;

    const instructor  = instructorRaw  != null ? String(instructorRaw).replace(/\n/g, ", ").trim() : inherit.instructor;
    const hoursVal    = hoursRaw       != null ? hoursRaw : inherit.hours;
    const period      = periodRaw      != null ? String(periodRaw)  : inherit.period;
    const completedAt = completedRaw   != null ? completedRaw       : inherit.completedAt;
    const stage       = stageRaw       != null ? String(stageRaw)   : inherit.stage;
    const note        = noteRaw        != null ? String(noteRaw)    : inherit.note;

    if (instructorRaw  != null) inherit.instructor  = instructor;
    if (hoursRaw       != null) inherit.hours       = hoursRaw;
    if (periodRaw      != null) inherit.period      = period;
    if (completedRaw   != null) inherit.completedAt = completedRaw;
    if (stageRaw       != null) inherit.stage       = stage;
    if (noteRaw        != null) inherit.note        = note;

    if (!courseName && !subjectRaw) continue;

    // TAS에서 result는 "이수"(교육이수 열), stage는 "초기"(보수예정 열)
    let rawResult = "PASS";
    let rawStage  = stage;
    if (result2Raw != null) {
      const r2 = String(result2Raw).trim();
      if (normResult(r2)) rawResult = r2;
    }

    const { startDate, endDate } = normPeriod(period);
    const completedMs = normDate(completedAt);

    if (!courseName && !subjectRaw && !completedMs) continue;

    const subjectName = subjectRaw != null ? String(subjectRaw).trim() : "";
    rows.push({
      employeeName: empInfo.name,
      empNo:        empInfo.empNo,
      trainingType,
      courseName:   courseName || subjectName,
      subjectName:  subjectName || courseName,
      instructor,
      hours:        normHours(hoursVal),
      startDate,
      endDate,
      completedAt:  completedMs,
      ...resolveResultStage(rawResult, rawStage),
      note:         String(note).replace(/\n/g, " ").trim(),
    });
  }

  return rows;
}

/**
 * 보수예정/교육이수형 파싱 (신태용, 배수민, 강재원)
 * - 헤더: 보수예정(stage), 교육이수/발령일자(result2)
 * - 법정: 교육일자 열(period=교육날짜), 직무: 교육기간 열
 */
function _parseBosoo(sheet, trainingType) {
  // 표준 파싱과 동일하되 result2 처리 포함
  return _parseBlock(sheet, findHeaderRow(sheet), sheet.maxRow, trainingType, { splitSubjects: false });
}

/**
 * Sheet1 섹션 분리형 파싱 (이지현)
 * 단일 시트에 법정+직무 섹션이 순서대로 있음
 */
function _parseSheet1(sheet) {
  const sections = findSectionHeaders(sheet);
  const empInfo  = detectEmpInfo(sheet, findHeaderRow(sheet));
  const allRows  = [];

  for (let i = 0; i < sections.length; i++) {
    const sec     = sections[i];
    const nextSec = sections[i + 1];
    const secEnd  = nextSec ? nextSec.row - 1 : sheet.maxRow;

    // 섹션 내 헤더 행 탐지
    const hr = findHeaderRow(sheet, sec.row, sec.row + 5);
    if (hr < 0) continue;

    const blockRows = _parseBlock(sheet, hr, secEnd, sec.type, { splitSubjects: false });
    // 직원 정보 덮어쓰기 (Sheet1에서 한 번만 탐지됨)
    for (const row of blockRows) {
      row.employeeName = row.employeeName || empInfo.name;
      row.empNo        = row.empNo        || empInfo.empNo;
    }
    allRows.push(...blockRows);
  }

  return allRows;
}

// ═══════════════════════════════════════════════════════════════════
// § 5.  VALIDATOR
// ═══════════════════════════════════════════════════════════════════
const STATUS = {
  NEW:       "신규",
  FILL:      "보완",
  DUPLICATE: "중복",
  ERROR:     "오류",
};

function validate(rows, { empByNo, empByName, existingHistory }) {
  const normKey = (s) => String(s ?? "").toLowerCase().replace(/[\s()[\]·\-]/g, "");

  return rows.map((row) => {
    if (!row.courseName && !row.subjectName) {
      return { ...row, _status: STATUS.ERROR, _statusDetail: "과정명 없음" };
    }
    if (!row.completedAt) {
      return { ...row, _status: STATUS.ERROR, _statusDetail: "수료일 없음" };
    }

    // 직원 매칭
    let employee = null;
    if (row.empNo) employee = empByNo.get(row.empNo.toLowerCase()) ?? null;
    if (!employee && row.employeeName) {
      const cands = empByName.get(row.employeeName) ?? [];
      if (cands.length === 1) employee = cands[0];
      else if (cands.length > 1) {
        return { ...row, _status: STATUS.ERROR, _statusDetail: `동명이인 (${cands.length}명)` };
      }
    }
    if (!employee) {
      return { ...row, _status: STATUS.ERROR, _statusDetail: `직원 미매칭: ${row.employeeName || row.empNo || "?"}` };
    }

    // 기존 이력 매칭
    const courseKey = normKey(row.courseName || row.subjectName);
    const existing = existingHistory.find((h) => {
      if (h.uid !== employee.uid) return false;
      const hCourse = normKey(h.courseName ?? h.title ?? h.subjectName ?? "");
      const hDate   = Number(h.completedAt ?? 0);
      return hCourse === courseKey && hDate === Number(row.completedAt);
    });

    if (existing) {
      const fillable = ["instructor", "hours", "startDate", "endDate", "initialOrRecurrent", "note"].filter((f) => {
        const existVal = existing[f === "instructor" ? "instructorName" : f === "initialOrRecurrent" ? "educationStage" : f];
        return (!existVal || existVal === "" || existVal === "-") && !!row[f];
      });
      return {
        ...row,
        _status: fillable.length > 0 ? STATUS.FILL : STATUS.DUPLICATE,
        _statusDetail: fillable.join(", ") || "완료",
        _employee: employee,
        _existing: existing,
      };
    }

    return { ...row, _status: STATUS.NEW, _statusDetail: "신규 생성", _employee: employee };
  });
}

// ═══════════════════════════════════════════════════════════════════
// § 6.  PREVIEW
// ═══════════════════════════════════════════════════════════════════
export function renderDetailedPreview(container, preview) {
  if (!container) return;
  const STATUS_COLOR = {
    신규: "var(--green-600,#16a34a)",
    보완: "var(--blue-600,#2563eb)",
    중복: "var(--gray-400,#9ca3af)",
    오류: "var(--red-600,#dc2626)",
  };
  const fmt = (ms) => {
    if (!ms) return "–";
    const d = new Date(Number(ms));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const stageLabel = { initial: "초기", recurrent: "보수" };
  const { summary, rows } = preview;

  container.innerHTML = `
    <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-3);font-size:var(--text-sm)">
      <span>전체 <strong>${summary.total}</strong></span>
      <span style="color:var(--green-600,#16a34a)">신규 <strong>${summary.new}</strong></span>
      <span style="color:var(--blue-600,#2563eb)">보완 <strong>${summary.fill}</strong></span>
      <span style="color:var(--gray-400,#9ca3af)">중복 <strong>${summary.duplicate}</strong></span>
      <span style="color:var(--red-600,#dc2626)">오류 <strong>${summary.error}</strong></span>
    </div>
    <div style="overflow-x:auto;max-height:400px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius-md)">
      <table class="data-table" style="min-width:960px;font-size:var(--text-xs)">
        <thead>
          <tr>
            <th>처리</th><th>직원명</th><th>사번</th><th>유형</th>
            <th>교육과정</th><th>교육과목</th><th>강사</th>
            <th>시간</th><th>시작일</th><th>종료일</th>
            <th>수료일</th><th>결과</th><th>초기/보수</th><th>비고</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><span style="color:${STATUS_COLOR[r._status] ?? "inherit"};font-weight:600">${esc(r._status)}</span>
                  ${r._statusDetail ? `<br/><span style="color:var(--gray-400);font-size:10px">${esc(r._statusDetail)}</span>` : ""}
              </td>
              <td>${esc(r._employee?.name ?? r.employeeName)}</td>
              <td>${esc(r._employee?.empNo ?? r.empNo)}</td>
              <td>${r.trainingType === "legal" ? "법정" : r.trainingType === "job" ? "직무" : "기타"}</td>
              <td>${esc(r.courseName)}</td>
              <td>${esc(r.subjectName)}</td>
              <td>${esc(r.instructor)}</td>
              <td>${r.hours ?? "–"}</td>
              <td>${fmt(r.startDate)}</td>
              <td>${fmt(r.endDate)}</td>
              <td>${fmt(r.completedAt)}</td>
              <td>${esc(r.result)}</td>
              <td>${esc(stageLabel[r.initialOrRecurrent] ?? r.initialOrRecurrent ?? "–")}</td>
              <td>${esc(r.note)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// § 7.  공개 API
// ═══════════════════════════════════════════════════════════════════

/**
 * 파일 분석 (Reader → Normalizer → TemplateDetector → Mapper)
 */
export async function analyzeExcel(file) {
  const sheetRaws = await readerRead(file);

  const SHEET_TYPE = { 법정: "legal", 직무: "job" };

  const allRows    = [];
  const parsersUsed = [];

  for (const sheetRaw of sheetRaws) {
    const parser = detectParser(sheetRaw);
    if (!parsersUsed.includes(parser.name)) parsersUsed.push(parser.name);

    // 시트 이름에서 교육유형 판별
    const trainingType =
      Object.entries(SHEET_TYPE).find(([k]) => sheetRaw.sheetName.includes(k))?.[1] ?? "other";

    let rows;
    if (parser.id === "sheet1_section") {
      // Sheet1 섹션형은 내부에서 교육유형을 스스로 판별
      rows = parser.parse(sheetRaw);
    } else {
      rows = parser.parse(sheetRaw, trainingType);
    }
    allRows.push(...rows);
  }

  // 직원 정보 추출 (첫 번째 유효 시트)
  let empInfo = { name: "", empNo: "" };
  for (const sheetRaw of sheetRaws) {
    const hr = findHeaderRow(sheetRaw);
    const info = detectEmpInfo(sheetRaw, hr >= 0 ? hr : 12);
    if (info.name || info.empNo) { empInfo = info; break; }
  }

  return { empInfo, rows: allRows, parsersUsed, fileName: file.name };
}

export function validateAndPreview(rows, lookups) {
  const validated = validate(rows, lookups);
  const summary = {
    total:     validated.length,
    new:       validated.filter((r) => r._status === STATUS.NEW).length,
    fill:      validated.filter((r) => r._status === STATUS.FILL).length,
    duplicate: validated.filter((r) => r._status === STATUS.DUPLICATE).length,
    error:     validated.filter((r) => r._status === STATUS.ERROR).length,
  };
  return { summary, rows: validated };
}

export function getImportableRows(validatedRows) {
  return validatedRows.filter((r) => r._status === STATUS.NEW || r._status === STATUS.FILL);
}

export { STATUS };
