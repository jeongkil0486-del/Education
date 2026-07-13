/**
 * Excel Import Engine  v2.0
 * ─────────────────────────────────────────────────────────────────
 * 단계:  Reader → Normalizer → TemplateDetector → Mapper
 *        → Validator → (Preview) → Import
 *
 * 새 양식이 생겨도 PARSERS 배열에 Parser 하나만 추가하면 됩니다.
 * if 문 복붙 금지.
 * ─────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════
// § 0.  SheetJS 로더 (싱글턴)
// ═══════════════════════════════════════════════════════════════════
let _xlsxPromise = null;
async function loadXlsx() {
  if (!_xlsxPromise) {
    _xlsxPromise = import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs").catch(() => null);
  }
  return _xlsxPromise;
}

// ═══════════════════════════════════════════════════════════════════
// § 1.  READER  —  원본 셀 데이터 추출 (의미 해석 없음)
// ═══════════════════════════════════════════════════════════════════
/**
 * @returns {{ sheetName, trainingType, cells, mergeMap, maxRow, maxCol }[]}
 */
async function readerRead(file) {
  const XLSX = await loadXlsx();
  if (!XLSX) throw new Error("SheetJS 로드 실패");

  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: false, dense: false });

  const SHEET_TYPE = { 법정: "legal", 직무: "job" };

  return wb.SheetNames.filter((n) => !n.startsWith("_")).map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const trainingType =
      Object.entries(SHEET_TYPE).find(([k]) => sheetName.includes(k))?.[1] ?? "other";

    const ref = ws["!ref"] ?? "A1:A1";
    const range = XLSX.utils.decode_range(ref);

    // 모든 셀 읽기
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

    // 병합맵 (비어있는 나머지 셀에 anchor 값 채움)
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

    return {
      sheetName,
      trainingType,
      cells,
      mergeMap,
      maxRow: range.e.r,
      maxCol: range.e.c,
    };
  });
}

/** 셀 값 읽기 (병합 우선) */
function rawCell(sheet, r, c) {
  const key = `${r},${c}`;
  if (key in sheet.mergeMap) return sheet.mergeMap[key];
  return sheet.cells[key] ?? null;
}

// ═══════════════════════════════════════════════════════════════════
// § 2.  NORMALIZER  —  문자열 정규화
// ═══════════════════════════════════════════════════════════════════
const STAGE_MAP = {
  // ── 초기
  초기: "initial",
  초기교육: "initial",
  initial: "initial",
  // ── 보수
  보수: "recurrent",
  보수교육: "recurrent",
  정기: "recurrent",
  정기교육: "recurrent",
  recurrent: "recurrent",
  recurring: "recurrent",
  갱신: "recurrent",
  // ── 결과값이 stage 열에 잘못 들어온 경우 → 빈값으로 처리 (결과 필드로 이동)
  pass: "",
  fail: "",
  이수: "",
  수료: "",
  완료: "",
  합격: "",
  미수료: "",
  불합격: "",
};
const RESULT_PASS = ["pass", "수료", "완료", "합격", "이수"];
const RESULT_FAIL = ["fail", "미수료", "불합격"];

/** 공백 제거 + 영문 병기 제거 + 소문자 */
function norm(v) {
  if (v == null) return "";
  return String(v)
    .replace(/\([^)]*\)/g, "")   // (영문) 제거
    .replace(/\[[^\]]*\]/g, "")  // [영문] 제거
    .replace(/\s+/g, "")         // 공백 전부 제거
    .toLowerCase()
    .trim();
}

/** 헤더 정규화 (콜론 기준 앞부분 + 특수 매핑) */
const HEADER_ALIAS = {
  교육과정명: "courseName",
  교육과정: "courseName",
  과정명: "courseName",
  curriculum: "courseName",
  교육과목: "subjectName",
  과목: "subjectName",
  subject: "subjectName",
  강사: "instructor",
  instructor: "instructor",
  교육시간: "hours",
  시간: "hours",
  time: "hours",
  교육기간: "period",
  기간: "period",
  period: "period",
  수료일자: "completedAt",
  수료일: "completedAt",
  completion: "completedAt",
  완료일: "completedAt",
  결과: "result",
  result: "result",
  "초기/보수": "stage",
  초기보수: "stage",
  "initial/recurrent": "stage",
  initialrecurrent: "stage",
  비고: "note",
  remark: "note",
};

function normHeader(v) {
  const cleaned = norm(v);
  return HEADER_ALIAS[cleaned] ?? cleaned;
}

/** 시간 숫자화: "3 HRS" → 3, "8HRS\n(4HRS E-learning)" → 8 */
function normHours(v) {
  if (v == null || v === "") return null;
  const s = String(v)
    .split(/[\n(]/)[0]          // 첫 줄 / 괄호 전
    .replace(/[Hh][Rr][Ss]?/g, "")
    .replace(/시간/g, "")
    .trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** stage 정규화 — result 값이 들어오면 null 반환 */
function normStage(v) {
  if (!v) return null;
  const s = norm(v);
  if (s in STAGE_MAP) return STAGE_MAP[s] || null;  // ""→null
  return null;  // 매핑 없으면 stage 아님
}

/** result 정규화 — stage 값이 들어오면 null 반환 */
function normResult(v) {
  if (!v) return null;
  const s = norm(v);
  // stage 값이 result 열에 들어온 경우 → null (stage 쪽으로 처리됨)
  if (["initial", "초기", "초기교육", "recurrent", "recurring", "recurrent", "정기", "정기교육", "보수", "보수교육", "갱신"].includes(s)) return null;
  if (RESULT_PASS.some((w) => s.includes(w))) return "PASS";
  if (RESULT_FAIL.some((w) => s.includes(w))) return "FAIL";
  return null;
}

/**
 * 날짜 → Unix ms
 * 지원:  Excel serial / ISO string / 2024.03.01 / 2024-03-01 00:00:00 / 범위(첫날)
 */
function normDate(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 30000 && n < 2958466) {
    // Excel serial (Windows epoch: 25569)
    return Math.round((n - 25569) * 86400 * 1000);
  }
  let s = String(v).trim();
  // 범위면 첫 번째만
  s = s.split(/[~–\n]/)[0].trim();
  // 구분자 통일
  s = s.replace(/[./]/g, "-").replace(/\s+/g, " ").replace(/ 00:00:00$/, "");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * 기간 → { startDate, endDate }
 * 지원 패턴:
 *   2024.03.01               → start only
 *   2024.03.01~03.07         → start + 같은해 end
 *   2024.03.01~2024.03.07    → start + end (full)
 *   2024.03.01\n2024.03.07   → start + end (newline)
 *   2024. 11. 23\n2024. 11. 26  → start + end (space)
 */
function normPeriod(v) {
  if (!v) return { startDate: null, endDate: null };
  const s = String(v).trim();

  // "YYYY. MM. DD\nYYYY. MM. DD" 패턴 (space after dot)
  const m0 = s.match(
    /^(\d{4})[.\-\/\s]+(\d{1,2})[.\-\/\s]+(\d{1,2})\s*[\n~–-]\s*(\d{4})[.\-\/\s]+(\d{1,2})[.\-\/\s]+(\d{1,2})/
  );
  if (m0) {
    return {
      startDate: normDate(`${m0[1]}-${m0[2].padStart(2,"0")}-${m0[3].padStart(2,"0")}`),
      endDate:   normDate(`${m0[4]}-${m0[5].padStart(2,"0")}-${m0[6].padStart(2,"0")}`),
    };
  }

  // "YYYY.MM.DD~MM.DD" (단축 종료일)
  const m1 = s.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s*[~–-]\s*(\d{1,2})[.\-](\d{1,2})$/);
  if (m1) {
    return {
      startDate: normDate(`${m1[1]}-${m1[2].padStart(2,"0")}-${m1[3].padStart(2,"0")}`),
      endDate:   normDate(`${m1[1]}-${m1[4].padStart(2,"0")}-${m1[5].padStart(2,"0")}`),
    };
  }

  // 단일 날짜 or 나머지
  return { startDate: normDate(s), endDate: null };
}

/** 이름에서 공백·괄호 내 영문 제거 (순수 한글 이름 추출) */
function normName(v) {
  if (!v) return "";
  return String(v)
    .replace(/\([^)]*\)/g, "")
    .replace(/[a-zA-Z]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 사번 정규화 */
function normEmpNo(v) {
  if (!v) return "";
  return String(v)
    .replace(/\([^)]*\)/g, "")
    .trim()
    .toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════
// § 3.  TEMPLATE DETECTOR  —  양식 판별
// ═══════════════════════════════════════════════════════════════════
/**
 * Parser 인터페이스:
 *   { id, name, detect(sheet) → boolean, parse(sheet) → MappedRow[] }
 *
 * detect()가 true를 반환한 첫 번째 Parser가 사용됩니다.
 * 맨 마지막에 항상 GenericParser를 두세요.
 */

// ── Parser A: 신형 양식 2024+  (영문 병기, 10열, 과목 줄바꿈 합산)
const ParserModern = {
  id: "modern_2024",
  name: "신형 양식 (2024+, 영문 병기)",
  detect(sheet) {
    // 헤더 행에 "(Curriculum)" or "(Subject)" or "(Instructor)" 포함
    for (let r = 0; r <= Math.min(sheet.maxRow, 20); r++) {
      for (let c = 0; c <= sheet.maxCol; c++) {
        const v = String(rawCell(sheet, r, c) ?? "");
        if (v.includes("Curriculum") || v.includes("Subject") || v.includes("Instructor")) return true;
      }
    }
    return false;
  },
  parse(sheet) {
    return _parseStandard(sheet, { splitSubjects: true, colOffset: 0 });
  },
};

// ── Parser B: 구형 양식 (한글 전용, 9열)
const ParserLegacy = {
  id: "legacy_kr",
  name: "구형 양식 (한글 전용)",
  detect(sheet) {
    for (let r = 0; r <= Math.min(sheet.maxRow, 20); r++) {
      for (let c = 0; c <= sheet.maxCol; c++) {
        const v = String(rawCell(sheet, r, c) ?? "");
        if (norm(v) === "교육과정명" || norm(v) === "교육과목") return true;
      }
    }
    return false;
  },
  parse(sheet) {
    return _parseStandard(sheet, { splitSubjects: false, colOffset: 0 });
  },
};

// ── Parser Z: Generic (fallback)
const ParserGeneric = {
  id: "generic",
  name: "Generic (자동 탐지)",
  detect() { return true; },
  parse(sheet) {
    return _parseStandard(sheet, { splitSubjects: false, colOffset: 0 });
  },
};

/** 등록된 Parser 목록 (순서 중요: 가장 구체적인 것 먼저) */
const PARSERS = [ParserModern, ParserLegacy, ParserGeneric];

function detectTemplate(sheet) {
  for (const p of PARSERS) {
    if (p.detect(sheet)) return p;
  }
  return ParserGeneric;
}

// ═══════════════════════════════════════════════════════════════════
// § 4.  MAPPER  —  각 Parser의 공통 파싱 로직 + 통일된 출력 구조
// ═══════════════════════════════════════════════════════════════════
/**
 * 표준 파싱 로직 (두 양식 모두 커버)
 * splitSubjects: true → 과목이 단일 셀 줄바꿈으로 합쳐진 경우 분리
 */
function _parseStandard(sheet, { splitSubjects }) {
  // ── 헤더 행 탐지
  let headerRow = -1;
  for (let r = 0; r <= Math.min(sheet.maxRow, 25); r++) {
    for (let c = 0; c <= sheet.maxCol; c++) {
      const v = rawCell(sheet, r, c);
      if (!v) continue;
      const h = normHeader(v);
      if (h === "courseName" || h === "subjectName") { headerRow = r; break; }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return [];

  // ── 컬럼맵 구축
  const colMap = {};  // fieldKey → colIndex
  for (let c = 0; c <= sheet.maxCol; c++) {
    const v = rawCell(sheet, headerRow, c);
    if (!v) continue;
    const key = normHeader(v);
    if (key && !colMap[key]) colMap[key] = c;
  }

  // ── 직원 정보 탐지 (헤더 행 위쪽)
  const empInfo = _detectEmpInfo(sheet, headerRow);

  // ── 데이터 행 파싱
  const rows = [];

  // 상속 값 (병합셀 처리)
  const inherit = {
    courseName: "", instructor: "", hours: null, period: "",
    completedAt: null, result: "", stage: "", note: "",
  };

  for (let r = headerRow + 1; r <= sheet.maxRow; r++) {
    const get = (field) => {
      const c = colMap[field];
      if (c === undefined) return null;
      return rawCell(sheet, r, c);
    };

    const courseRaw   = get("courseName");
    const subjectRaw  = get("subjectName");
    const instructorRaw = get("instructor");
    const hoursRaw    = get("hours");
    const periodRaw   = get("period");
    const completedRaw = get("completedAt");
    const resultRaw   = get("result");
    const stageRaw    = get("stage");
    const noteRaw     = get("note");

    // 과정명 상속
    const courseName = courseRaw != null
      ? String(courseRaw).replace(/\n/g, " ").trim()
      : inherit.courseName;
    if (courseRaw != null) inherit.courseName = courseName;

    // 나머지 필드 상속
    const instructor = instructorRaw != null ? String(instructorRaw).replace(/\n/g, ", ").trim() : inherit.instructor;
    const hoursVal   = hoursRaw != null ? hoursRaw : (inherit.hours != null ? inherit.hours : null);
    const period     = periodRaw != null ? String(periodRaw) : inherit.period;
    const completedAt = completedRaw != null ? completedRaw : inherit.completedAt;
    const result     = resultRaw != null ? String(resultRaw) : inherit.result;
    const stage      = stageRaw != null ? String(stageRaw) : inherit.stage;
    const note       = noteRaw != null ? String(noteRaw) : inherit.note;

    if (instructorRaw != null) inherit.instructor = instructor;
    if (hoursRaw != null) inherit.hours = hoursRaw;
    if (periodRaw != null) inherit.period = period;
    if (completedRaw != null) inherit.completedAt = completedRaw;
    if (resultRaw != null) inherit.result = result;
    if (stageRaw != null) inherit.stage = stage;
    if (noteRaw != null) inherit.note = note;

    // 빈 행 건너뜀
    if (!courseName && !subjectRaw) continue;

    // 날짜 파싱
    const { startDate, endDate } = normPeriod(period);
    const completedMs = normDate(completedAt);

    // 과목 분리 (신형: 단일 셀에 \n으로 과목 목록)
    let subjects = [];
    if (subjectRaw != null) {
      const raw = String(subjectRaw);
      subjects = splitSubjects
        ? raw.split(/\n/).map((s) => s.trim()).filter(Boolean)
        : [raw.trim()].filter(Boolean);
    }
    if (!subjects.length) subjects = [""];

    // 행 완전히 비어있으면 skip
    if (!courseName && subjects.every((s) => !s) && !completedMs) continue;

    // 과목별 row 생성 (신형: 과목마다 한 행, 구형: 이미 행별 분리됨)
    for (const subjectName of subjects) {
      rows.push({
        // 직원
        employeeName: empInfo.name,
        empNo: empInfo.empNo,
        // 교육
        trainingType: sheet.trainingType,
        courseName:   courseName || subjectName,
        subjectName:  subjectName || courseName,
        instructor:   instructor,
        hours:        normHours(hoursVal),
        startDate,
        endDate,
        completedAt:  completedMs,
        ..._resolveResultAndStage(result, stage),
        note:         String(note).replace(/\n/g, " ").trim(),
        // 내부
        _raw: { course: courseRaw, subject: subjectRaw, stage, result },
        _rowIdx: r,
      });
    }
  }

  return rows;
}

/** 직원 기본정보 탐지 (헤더 위 영역) */
function _detectEmpInfo(sheet, headerRow) {
  let name = "", empNo = "";
  const SEARCH_LIMIT = Math.min(headerRow, 15);

  for (let r = 0; r <= SEARCH_LIMIT; r++) {
    for (let c = 0; c <= sheet.maxCol; c++) {
      const v = rawCell(sheet, r, c);
      if (!v) continue;
      const key = norm(v);
      if (key === "성명" || key === "이름" || key === "성명name") {
        // 오른쪽 셀들 탐색
        for (let dc = 1; dc <= 4; dc++) {
          const candidate = rawCell(sheet, r, c + dc);
          if (candidate && norm(candidate) !== "사번" && norm(candidate) !== "생년월일") {
            name = normName(String(candidate));
            break;
          }
        }
      }
      if (key === "사번" || key === "사번idnbr" || key === "직원번호") {
        for (let dc = 1; dc <= 4; dc++) {
          const candidate = rawCell(sheet, r, c + dc);
          if (candidate) {
            const n = normEmpNo(String(candidate));
            if (n && !["성명", "이름", "생년월일"].includes(norm(n))) {
              empNo = n;
              break;
            }
          }
        }
      }
    }
  }
  return { name, empNo };
}

// ═══════════════════════════════════════════════════════════════════
// § 5.  VALIDATOR  —  행별 검증
// ═══════════════════════════════════════════════════════════════════
const STATUS = {
  NEW:       "신규",
  UPDATE:    "업데이트",
  FILL:      "보완",
  DUPLICATE: "중복",
  ERROR:     "오류",
};

/**
 * @param {object[]} rows  - Mapper 출력
 * @param {Map}      empByNo   - 사번 → employee 객체
 * @param {Map}      empByName - 이름 → employee 객체[]
 * @param {object[]} existingHistory - 기존 manualTrainingHistories
 * @returns {object[]}  ValidatedRow (row + _status + _statusDetail + _employee)
 */
function validate(rows, { empByNo, empByName, existingHistory }) {
  const normalize = (s) =>
    String(s ?? "").toLowerCase().replace(/[\s()[\]·\-]/g, "");

  const existingKeys = new Set(
    existingHistory.map((h) => h.dedupeKey).filter(Boolean)
  );

  return rows.map((row) => {
    // ① 과정명 없음
    if (!row.courseName && !row.subjectName) {
      return { ...row, _status: STATUS.ERROR, _statusDetail: "과정명 없음" };
    }

    // ② 수료일 없음 (경고지만 저장 가능)
    if (!row.completedAt) {
      return { ...row, _status: STATUS.ERROR, _statusDetail: "수료일 없음" };
    }

    // ③ 직원 매칭
    let employee = null;
    if (row.empNo) {
      employee = empByNo.get(row.empNo.toLowerCase()) ?? null;
    }
    if (!employee && row.employeeName) {
      const candidates = empByName.get(row.employeeName) ?? [];
      if (candidates.length === 1) employee = candidates[0];
      else if (candidates.length > 1) {
        return { ...row, _status: STATUS.ERROR, _statusDetail: `동명이인 (${candidates.length}명): 사번 필요` };
      }
    }
    if (!employee) {
      return { ...row, _status: STATUS.ERROR, _statusDetail: `직원 미매칭: ${row.employeeName || row.empNo || "?"}` };
    }

    // ④ 기존 이력 매칭
    const courseKey = normalize(row.courseName || row.subjectName);
    const existing = existingHistory.find((h) => {
      if (h.uid !== employee.uid) return false;
      const hType   = normalize(h.trainingType ?? "");
      const hCourse = normalize(h.courseName ?? h.title ?? h.subjectName ?? "");
      const hDate   = Number(h.completedAt ?? 0);
      return hType   === normalize(row.trainingType) &&
             hCourse === courseKey &&
             hDate   === Number(row.completedAt);
    });

    if (existing) {
      // 보완할 빈 필드가 있는지 확인
      const fillable = ["instructor", "hours", "startDate", "endDate",
                        "initialOrRecurrent", "note"].filter((f) => {
        const existVal = existing[f === "instructor" ? "instructorName" :
                                  f === "initialOrRecurrent" ? "educationStage" : f];
        return (!existVal || existVal === "" || existVal === "-") && !!row[f];
      });
      const status = fillable.length > 0 ? STATUS.FILL : STATUS.DUPLICATE;
      return { ...row, _status: status, _statusDetail: fillable.join(", ") || "이미 완료", _employee: employee, _existing: existing };
    }

    return { ...row, _status: STATUS.NEW, _statusDetail: "신규 생성", _employee: employee };
  });
}

// ═══════════════════════════════════════════════════════════════════
// § 6.  PREVIEW  —  상세 미리보기 데이터 생성
// ═══════════════════════════════════════════════════════════════════
/**
 * @returns { summary, rows: ValidatedRow[] }
 */
function buildPreview(validatedRows) {
  const summary = {
    total:     validatedRows.length,
    new:       0,
    fill:      0,
    duplicate: 0,
    error:     0,
  };
  for (const r of validatedRows) {
    if (r._status === STATUS.NEW)       summary.new++;
    else if (r._status === STATUS.FILL) summary.fill++;
    else if (r._status === STATUS.DUPLICATE) summary.duplicate++;
    else if (r._status === STATUS.ERROR) summary.error++;
  }
  return { summary, rows: validatedRows };
}

/** HTML 미리보기 테이블 렌더 */
export function renderDetailedPreview(container, preview) {
  if (!container) return;
  const STATUS_COLOR = {
    신규: "var(--green-600,#16a34a)",
    보완: "var(--blue-600,#2563eb)",
    중복: "var(--gray-400,#9ca3af)",
    오류: "var(--red-600,#dc2626)",
    업데이트: "var(--orange-500,#f97316)",
  };

  const fmt = (ms) => {
    if (!ms) return "–";
    const d = new Date(Number(ms));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const stageLabel = { initial: "초기", recurrent: "보수", pass: "이수" };

  const { summary, rows } = preview;

  container.innerHTML = `
    <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-3);font-size:var(--text-sm)">
      <span>전체 <strong>${summary.total}</strong></span>
      <span style="color:var(--green-600,#16a34a)">신규 <strong>${summary.new}</strong></span>
      <span style="color:var(--blue-600,#2563eb)">보완 <strong>${summary.fill}</strong></span>
      <span style="color:var(--gray-400,#9ca3af)">중복 <strong>${summary.duplicate}</strong></span>
      <span style="color:var(--red-600,#dc2626)">오류 <strong>${summary.error}</strong></span>
    </div>
    <div style="overflow-x:auto;max-height:360px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius-md)">
      <table class="data-table" style="min-width:900px;font-size:var(--text-xs)">
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
 * result 열과 stage 열 값이 뒤집힌 경우를 감지·교정하여 올바른 필드에 배치
 *
 * 처리 순서:
 *  1. 각 열 값을 result 후보 / stage 후보로 분석
 *  2. 열이 뒤집힌 경우(result열→stage값, stage열→result값) 교환
 *  3. 한쪽만 유효한 경우 의미에 맞는 필드에 배치
 *  4. PASS를 stage로, 초기/보수를 result로 저장하지 않음
 */
function _resolveResultAndStage(rawResult, rawStage) {
  const stageFromResultCol = normStage(rawResult);   // result 열에서 stage 값 감지
  const resultFromStageCol = normResult(rawStage);   // stage 열에서 result 값 감지
  const stageFromStageCol  = normStage(rawStage);    // stage 열에서 stage 값 감지
  const resultFromResultCol = normResult(rawResult); // result 열에서 result 값 감지

  let finalResult = null;
  let finalStage  = null;

  // ── 정상: 각 열이 올바른 값 보유
  if (resultFromResultCol) finalResult = resultFromResultCol;
  if (stageFromStageCol)   finalStage  = stageFromStageCol;

  // ── 보정: result열에 stage값, stage열에 result값 → 교환
  if (!finalResult && resultFromStageCol) finalResult = resultFromStageCol;
  if (!finalStage  && stageFromResultCol) finalStage  = stageFromResultCol;

  return {
    result:             finalResult ?? "PASS",
    initialOrRecurrent: finalStage  ?? null,
  };
}
/**
 * @returns {{ empInfo, rows, parserUsed, fileName }}
 */
export async function analyzeExcel(file) {
  const sheets = await readerRead(file);

  const allRows = [];
  const parsersUsed = [];

  for (const sheet of sheets) {
    const parser = detectTemplate(sheet);
    if (!parsersUsed.includes(parser.name)) parsersUsed.push(parser.name);
    const rows = parser.parse(sheet);
    allRows.push(...rows);
  }

  // 직원 정보: 첫 번째 유효 시트에서
  let empInfo = { name: "", empNo: "" };
  for (const sheet of sheets) {
    const info = _detectEmpInfo(sheet, (() => {
      for (let r = 0; r <= Math.min(sheet.maxRow, 25); r++) {
        for (let c = 0; c <= sheet.maxCol; c++) {
          const v = rawCell(sheet, r, c);
          if (!v) continue;
          const h = normHeader(v);
          if (h === "courseName" || h === "subjectName") return r;
        }
      }
      return 10;
    })());
    if (info.name || info.empNo) { empInfo = info; break; }
  }

  return {
    empInfo,
    rows: allRows,
    parsersUsed,
    fileName: file.name,
  };
}

/**
 * 검증 + 미리보기 빌드
 * @param {object[]} rows
 * @param {{ empByNo, empByName, existingHistory }} lookups
 */
export function validateAndPreview(rows, lookups) {
  const validated = validate(rows, lookups);
  return buildPreview(validated);
}

/**
 * 저장할 행만 추출 (신규 + 보완, 중복·오류 제외)
 */
export function getImportableRows(validatedRows) {
  return validatedRows.filter(
    (r) => r._status === STATUS.NEW || r._status === STATUS.FILL
  );
}

export { STATUS };
