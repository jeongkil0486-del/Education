import { toast } from "../utils/toast.js";
import { modal } from "../utils/modal.js";
import { formatDate } from "../utils/date.js";
import {
  buildEmployeeHistoryRowsV2,
  loadTrainingReferences,
  listManagedItems,
  buildSelectableTrainingItems,
  DUE_STATUS_LABELS,
} from "../services/training-service.js";
import { authStore, ROLES } from "../core/auth.js";
import { deleteEmployeeHistory, upsertManualTrainingHistory, resetSelectedManualTrainingHistories, moveEmployeeHistoryCourse } from "../core/admin-api.js";
import {
  exportEmployeeHistoryCard,
} from "../services/history-card-export.js";
import { importHistoryExcelData } from "../core/admin-api.js";
import {
  analyzeExcel,
  validateAndPreview,
  renderDetailedPreview,
  getImportableRows,
  STATUS as IMPORT_STATUS,
} from "../services/excel-import-engine.js";

/* ──────────────────────────────────────────────────────────
   교육유형 → 섹션 매핑
────────────────────────────────────────────────────────── */
const SECTION_ORDER = ["job_initial", "job_recurring", "legal", "online", "external", "other"];
const SECTION_LABELS = {
  job_initial:   "직무초기교육",
  job_recurring: "직무보수교육",
  legal:         "법정교육",
  online:        "온라인교육",
  external:      "외부교육",
  other:         "기타",
};
function getSectionKey(row) {
  if (SECTION_ORDER.includes(row.sectionKey)) return row.sectionKey;
  if (row.trainingType === "job") {
    const stage = _normStage(row.subType) ?? _normStage(row.educationStage) ?? "";
    return stage === "initial" ? "job_initial" : "job_recurring";
  }
  return row.trainingType;
}

/* ──────────────────────────────────────────────────────────
   State
────────────────────────────────────────────────────────── */
let S = {
  employees:          [],   // 전체 직원 목록
  branches:           [],   // 전체 지점 목록
  selectedBranchId:   "",
  searchText:         "",
  selectedEmployeeId: "",
  selectedEmployee:   null,
  rows:               [],
  templates:          [],
  items:              [],
  dueStatusFilter:    "",
};
const MOVABLE_SECTION_KEYS = new Set(["job_initial", "job_recurring", "legal", "online", "other"]);
const historyCardSortBySection = Object.fromEntries(
  SECTION_ORDER.map((sectionKey) => [sectionKey, { key: null, direction: "none" }])
);
const historyMoveGroups = new Map();
let activeHistoryMoveId = "";
const canManageEmployeeHistory = () => [ROLES.HQ_ADMIN, ROLES.INSTRUCTOR].includes(authStore.role);

/* ──────────────────────────────────────────────────────────
   render
────────────────────────────────────────────────────────── */
export async function render(container, params = {}) {
  container.innerHTML = `
    <div class="hc-wrap">
      <!-- 헤더 -->
      <div class="section-header">
        <div>
          <div class="section-title">직원 교육 이력카드</div>
          <div class="section-subtitle">지점별 직원을 선택하여 교육 이력을 조회하고 다운로드합니다.</div>
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          ${authStore.role === ROLES.HQ_ADMIN || authStore.role === ROLES.SUPER_ADMIN ? `
            <button class="btn btn--secondary" id="btn-import-excel">교육 이력 업로드</button>
          ` : ''}
          ${canManageEmployeeHistory() ? '<button class="btn btn--secondary" id="btn-add-manual-history" disabled>개인 이력 추가</button>' : ''}
          ${authStore.role === ROLES.HQ_ADMIN ? '<button class="btn btn--danger" id="btn-reset-all-history" disabled>개인이력 초기화</button>' : ''}
          <button class="btn btn--primary" id="btn-download-card" disabled>다운로드</button>
        </div>
      </div>

      <!-- 검색 / 지점 필터 -->
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card__body card__body--compact">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">직원 검색</label>
              <div class="input-group">
                <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
                  <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
                </svg>
                <input class="form-control" id="hc-search" type="search" placeholder="이름 또는 사번으로 검색" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">지점 선택</label>
              <select class="form-control" id="hc-branch">
                <option value="">전체 지점</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">재교육 상태</label>
              <select class="form-control" id="hc-due-status">
                <option value="">전체 상태</option>
                <option value="normal">정상</option>
                <option value="soon">재교육 임박</option>
                <option value="overdue">기한 초과</option>
                <option value="unconfigured">주기 미설정</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- 직원 목록 테이블 -->
      <div class="card" style="margin-bottom:var(--space-5)">
        <div class="card__header">
          <div class="card__title">직원 목록</div>
          <div class="card__subtitle" id="hc-employee-count">지점을 선택하거나 검색어를 입력하세요.</div>
        </div>
        <div class="card__body" style="padding:0;max-height:320px;overflow-y:auto" id="hc-employee-list">
          <div class="empty-state" style="padding:var(--space-10)">
            <div class="empty-state__title" style="font-size:var(--text-sm)">지점을 선택하거나 이름·사번으로 검색해 주세요.</div>
          </div>
        </div>
      </div>

      <!-- 이력카드 본문 (직원 선택 후 표시) -->
      <div id="hc-card-section" style="display:none">
        <!-- 선택 직원 배너 -->
        <div id="hc-selected-banner" style="
          display:flex;align-items:center;justify-content:space-between;
          background:var(--brand-50,#eff6ff);border:1px solid var(--brand-200,#bfdbfe);
          border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4);
          margin-bottom:var(--space-4);font-size:var(--text-sm);
        ">
          <span id="hc-selected-label" style="font-weight:var(--weight-semibold);color:var(--brand-700,#1d4ed8)"></span>
          <button class="btn btn--ghost btn--sm" id="btn-deselect" style="color:var(--gray-500)">✕ 선택 해제</button>
        </div>

        <!-- 요약 카드 (웹 전용) -->
        <div class="hc-summary-grid" id="hc-summary"></div>

        <!-- 인적사항 -->
        <div class="card" style="margin-bottom:var(--space-4)">
          <div class="card__header"><div class="card__title">인적사항</div></div>
          <div class="card__body" id="hc-profile"></div>
        </div>

        <!-- 교육유형별 섹션 -->
        <div id="hc-sections"></div>
      </div>

      <!-- 로딩 -->
      <div id="hc-loading" style="display:none;padding:var(--space-16);text-align:center">
        <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400);margin:auto"></div>
      </div>
    </div>
  `;

  /* 이벤트 */
  document.getElementById("btn-import-excel")?.addEventListener("click", openImportExcelModal);
  document.getElementById("btn-add-manual-history")?.addEventListener("click", () => openManualHistoryModal());
  document.getElementById("btn-download-card")?.addEventListener("click", handleDownload);
  document.getElementById("btn-reset-all-history")?.addEventListener("click", openResetAllHistoryModal);
  document.getElementById("btn-deselect")?.addEventListener("click", deselectEmployee);
  document.getElementById("hc-search")?.addEventListener("input", onFilter);
  document.getElementById("hc-branch")?.addEventListener("change", onFilter);
  document.getElementById("hc-due-status")?.addEventListener("change", () => {
    S.dueStatusFilter = document.getElementById("hc-due-status")?.value ?? "";
    if (S.selectedEmployee) { renderSummary(S.selectedEmployee, filteredRows()); renderSections(filteredRows()); }
  });
  const sectionsEl = document.getElementById("hc-sections");
  const handleSortHeader = (event) => {
    const header = event.target.closest("th[data-hc-sort-key]");
    if (!header || !sectionsEl?.contains(header)) return;
    cycleHistoryCardSort(header.dataset.hcSectionKey, header.dataset.hcSortKey);
  };
  sectionsEl?.addEventListener("click", handleSortHeader);
  sectionsEl?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const header = event.target.closest("th[data-hc-sort-key]");
    if (!header || !sectionsEl.contains(header)) return;
    event.preventDefault();
    cycleHistoryCardSort(header.dataset.hcSectionKey, header.dataset.hcSortKey);
  });

  await initView(params.uid ?? "");
}

/* ──────────────────────────────────────────────────────────
   초기화
────────────────────────────────────────────────────────── */
async function initView(initialUid = "") {
  try {
    const [references, items] = await Promise.all([
      loadTrainingReferences(),
      canManageEmployeeHistory() ? listManagedItems().catch(() => []) : Promise.resolve([]),
    ]);

    S.employees = references.employees ?? [];
    S.branches  = references.branches  ?? [];
    S.templates = [];
    S.items = items;

    // 지점 셀렉트 채우기
    const branchSel = document.getElementById("hc-branch");
    if (branchSel) {
      branchSel.innerHTML = `<option value="">전체 지점</option>` +
        S.branches.map((b) => `<option value="${b.id}">${esc(b.name ?? b.code ?? b.id)}</option>`).join("");
      if (authStore.role === ROLES.INSTRUCTOR) {
        branchSel.value = S.branches[0]?.id ?? "";
        branchSel.disabled = true;
        branchSel.title = "강사는 담당 지점만 조회할 수 있습니다.";
        S.selectedBranchId = branchSel.value;
      }
    }

    if (initialUid) {
      S.selectedEmployeeId = initialUid;
      renderEmployeeList();
      await loadCard(initialUid);
    } else {
      renderEmployeeList();
    }
  } catch (err) {
    console.error("[history-cards] init failed", err);
    toast.error(err?.code === "permission-denied" ? "조회 권한이 없는 직원입니다." : "교육 이력카드 화면을 불러오지 못했습니다.");
  }
}

/* ──────────────────────────────────────────────────────────
   필터 핸들러
────────────────────────────────────────────────────────── */
function onFilter() {
  S.searchText       = String(document.getElementById("hc-search")?.value ?? "").trim().toLowerCase();
  S.selectedBranchId = document.getElementById("hc-branch")?.value ?? "";
  renderEmployeeList();
}

/* ──────────────────────────────────────────────────────────
   직원 목록 테이블 렌더링
────────────────────────────────────────────────────────── */
function renderEmployeeList() {
  const listEl   = document.getElementById("hc-employee-list");
  const countEl  = document.getElementById("hc-employee-count");
  if (!listEl) return;

  const filtered = S.employees.filter((emp) => {
    const matchBranch = !S.selectedBranchId || emp.branchId === S.selectedBranchId;
    const matchSearch = !S.searchText || [emp.name, emp.empNo]
      .some((v) => String(v ?? "").toLowerCase().includes(S.searchText));
    return matchBranch && matchSearch;
  });

  if (countEl) {
    countEl.textContent = filtered.length
      ? `총 ${filtered.length}명`
      : "검색 결과가 없습니다.";
  }

  if (!filtered.length) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding:var(--space-10)">
        <div class="empty-state__title" style="font-size:var(--text-sm)">해당 조건의 직원이 없습니다.</div>
      </div>`;
    return;
  }

  listEl.innerHTML = `
    <table class="hc-employee-table">
      <thead>
        <tr>
          <th>이름</th>
          <th>사번</th>
          <th>지점</th>
          <th>직책</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((emp) => {
          const uid = emp.id ?? emp.uid;
          const isSelected = uid === S.selectedEmployeeId;
          return `
            <tr data-uid="${uid}" class="${isSelected ? "hc-row--selected" : ""}" title="더블클릭하여 이력카드 조회">
              <td style="font-weight:${isSelected ? "var(--weight-semibold)" : "normal"}">${esc(emp.name ?? "–")}</td>
              <td style="font-family:monospace;font-size:var(--text-xs)">${esc(emp.empNo ?? "–")}</td>
              <td>${esc(emp.branchName ?? "–")}</td>
              <td>${esc(emp.position ?? "–")}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;

  // 단일 클릭 = 행 선택 표시, 더블클릭 = 이력카드 조회
  listEl.querySelectorAll("tbody tr[data-uid]").forEach((row) => {
    row.addEventListener("click", () => {
      // 선택 표시
      listEl.querySelectorAll("tbody tr").forEach((r) => r.classList.remove("hc-row--selected"));
      row.classList.add("hc-row--selected");
      S.selectedEmployeeId = row.dataset.uid;
    });

    row.addEventListener("dblclick", async () => {
      S.selectedEmployeeId = row.dataset.uid;
      await loadCard(row.dataset.uid);
    });
  });
}

/* ──────────────────────────────────────────────────────────
   이력카드 로드
────────────────────────────────────────────────────────── */
async function loadCard(uid) {
  const cardSection = document.getElementById("hc-card-section");
  const loadingEl   = document.getElementById("hc-loading");
  const dlBtn       = document.getElementById("btn-download-card");

  if (cardSection) cardSection.style.display = "none";
  if (loadingEl)   loadingEl.style.display = "block";

  try {
    const { employee, rows } = await buildEmployeeHistoryRowsV2(uid);
    S.selectedEmployee = employee;
    S.rows = rows;

    if (dlBtn) dlBtn.disabled = false;
    const addManualBtn = document.getElementById("btn-add-manual-history");
    if (addManualBtn) addManualBtn.disabled = false;
    const resetBtn = document.getElementById("btn-reset-all-history");
    if (resetBtn) resetBtn.disabled = false;

    // 선택 배너
    const bannerLabel = document.getElementById("hc-selected-label");
    if (bannerLabel) {
      bannerLabel.textContent = `${employee?.name ?? "–"} (${employee?.empNo ?? "–"}) · ${employee?.branchName ?? "–"} · ${employee?.position ?? "–"}`;
    }

    renderSummary(employee, filteredRows());
    renderProfile(employee);
    renderSections(filteredRows());

    if (cardSection) cardSection.style.display = "block";
  } catch (err) {
    console.error("[history-cards] load failed", err);
    toast.error("교육 이력을 불러오지 못했습니다.");
  } finally {
    if (loadingEl) loadingEl.style.display = "none";
  }
}

function deselectEmployee() {
  S.selectedEmployeeId = "";
  S.selectedEmployee   = null;
  S.rows               = [];

  const cardSection = document.getElementById("hc-card-section");
  if (cardSection) cardSection.style.display = "none";
  const addManualBtn = document.getElementById("btn-add-manual-history");
  if (addManualBtn) addManualBtn.disabled = true;

  const dlBtn = document.getElementById("btn-download-card");
  if (dlBtn) dlBtn.disabled = true;
  const resetBtn = document.getElementById("btn-reset-all-history");
  if (resetBtn) resetBtn.disabled = true;

  renderEmployeeList();
}

function filteredRows() {
  if (!S.dueStatusFilter) return S.rows;
  return S.rows.filter((row) => row.dueStatus === S.dueStatusFilter);
}

/* ──────────────────────────────────────────────────────────
   요약 카드 렌더링 (웹 전용)
────────────────────────────────────────────────────────── */
function renderSummary(emp, rows) {
  const el  = document.getElementById("hc-summary");
  if (!el) return;

  const now           = Date.now();
  const totalCount    = rows.length;
  const completedCnt  = rows.filter((r) => r.completionStatus === "completed").length;
  const inProgressCnt = rows.filter((r) => r.completionStatus !== "completed" && (!r.deadline || r.deadline >= now)).length;
  const failCnt       = rows.filter((r) => r.completionStatus !== "completed" && r.deadline && r.deadline < now).length;
  const lastDate      = rows.filter((r) => r.completedAt).sort((a, b) => b.completedAt - a.completedAt)[0]?.completedAt ?? null;
  const activeDueRows = rows.filter((r) => r.dueStatus && r.dueStatus !== "history");
  const nextDate = activeDueRows.filter((r) => r.nextDueDate).sort((a, b) => a.nextDueDate - b.nextDueDate)[0]?.nextDueDate ?? null;
  const dueSoonCnt = activeDueRows.filter((r) => r.dueStatus === "soon").length;
  const overdueCnt = activeDueRows.filter((r) => r.dueStatus === "overdue").length;

  el.innerHTML = [
    { label: "총 교육 과정 수",  value: new Set(rows.map((r) => groupKey(r))).size, isDate: false },
    { label: "총 이력 건수",     value: totalCount,                                  isDate: false },
    { label: "수료 건수",        value: completedCnt,                               isDate: false },
    { label: "진행중",           value: inProgressCnt,                              isDate: false },
    { label: "미수료",          value: failCnt,                             isDate: false },
    { label: "최근 교육일",     value: lastDate ? formatDate(lastDate) : "–", isDate: true },
    { label: "다음 교육 예정일", value: nextDate ? formatDate(nextDate) : "–", isDate: true },
    { label: "30일 이내",       value: dueSoonCnt,                         isDate: false },
    { label: "기한 초과",       value: overdueCnt,                         isDate: false },
  ].map(({ label, value, isDate }) => `
    <div class="stat-card">
      <div class="stat-card__label">${esc(label)}</div>
      <div class="stat-card__value" style="${isDate ? "font-size:var(--text-base);font-weight:var(--weight-semibold)" : ""}">${esc(String(value))}</div>
    </div>`).join("");
}

/* ──────────────────────────────────────────────────────────
   인적사항 렌더링
────────────────────────────────────────────────────────── */
function renderProfile(emp) {
  const el = document.getElementById("hc-profile");
  if (!el) return;

  const fields = [
    { label: "성명",      value: emp?.name ?? "–" },
    { label: "사번",      value: emp?.empNo ?? "–" },
    { label: "생년월일",  value: emp?.birthDate ? formatDate(emp.birthDate) : "–" },
    { label: "입사일",    value: emp?.joinDate  ? formatDate(emp.joinDate)  : "–" },
    { label: "신입/경력", value: emp?.entryType ?? "–" },
    { label: "사내 자격", value: emp?.internalLicense ?? "–" },
    { label: "사외 자격", value: emp?.externalLicense ?? "–" },
    { label: "지점",      value: emp?.branchName ?? "–" },
    { label: "직책",      value: emp?.position ?? "–" },
  ];

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-3)">
      ${fields.map(({ label, value }) => `
        <div style="display:flex;flex-direction:column;gap:2px">
          <div style="font-size:var(--text-xs);color:var(--gray-400)">${esc(label)}</div>
          <div style="font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--gray-800)">${esc(value)}</div>
        </div>`).join("")}
    </div>`;
}

/* ──────────────────────────────────────────────────────────
   교육유형별 섹션 렌더링
────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────
   그룹화 조회  (교육과정 단위)
   DB는 그대로 / 화면만 course 단위로 묶어서 표시
────────────────────────────────────────────────────────── */

/**
 * 그룹 키: 직원 + 교육유형섹션 + 교육과정명 + 초기/보수
 * 동일 키 → 하나의 그룹 (Accordion)
 */
function groupKey(row) {
  const normStr = (s) => String(s ?? "").trim().toLowerCase();
  // stage는 정규화된 값(initial/recurrent/null)으로 그룹화 → 정기·보수·recurrent·recurring 모두 같은 그룹
  const stageNorm = _normStage(row.subType) ?? _normStage(row.educationStage) ?? "";
  return `${getSectionKey(row)}||${normStr(row.courseName ?? row.title)}||${stageNorm}`;
}

/**
 * rows → 그룹 배열
 * 그룹 대표: 수료일 최신 row
 */
function groupRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const k = groupKey(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  const groups = [];
  for (const [, members] of map) {
    // 수료일 내림차순 정렬 → 첫 번째가 최신
    const sorted = [...members].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    const rep = sorted[0]; // 대표 행
    groups.push({ rep, members: sorted });
  }
  return groups;
}

const HISTORY_CARD_SORT_COLUMNS = {
  courseName:     { type: "string", value: (rep) => rep.courseName ?? rep.title },
  instructorName: { type: "string", value: (rep) => rep.instructorName },
  hours:          { type: "number", value: (rep) => Number(rep.hours) > 0 ? Number(rep.hours) : null },
  period:         { type: "range",  value: (rep) => [rep.startDate, rep.endDate] },
  completedAt:    { type: "date",   value: (rep) => rep.completedAt },
  subType:        { type: "string", value: (rep) => getStageLabel(rep) },
  nextDueDate:    { type: "date",   value: (rep) => rep.nextDueDate },
  daysRemaining:  { type: "number", value: (rep) => rep.daysRemaining },
  status:         { type: "string", value: (rep) => rep.dueStatusLabel ?? DUE_STATUS_LABELS[rep.dueStatus] },
  note:           { type: "string", value: (rep) => rep.note },
};

function isMissingSortValue(value, type) {
  if (type === "string") {
    const text = String(value ?? "").trim();
    return !text || text === "-" || text === "–" || text === "미설정";
  }
  if (value == null || value === "") return true;
  const number = Number(value);
  return !Number.isFinite(number) || (type === "date" && number <= 0);
}

function compareHistoryValues(a, b, type, direction) {
  if (type === "range") {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    const startComparison = compareHistoryValues(left[0], right[0], "date", direction);
    if (startComparison || isMissingSortValue(left[0], "date")) return startComparison;
    return compareHistoryValues(left[1], right[1], "date", direction);
  }
  const aMissing = isMissingSortValue(a, type);
  const bMissing = isMissingSortValue(b, type);
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  const comparison = type === "string"
    ? String(a).localeCompare(String(b), "ko", { numeric: true, sensitivity: "base" })
    : Number(a) - Number(b);
  return direction === "asc" ? comparison : -comparison;
}

function sortCourseGroups(groups, sectionKey) {
  const sortState = historyCardSortBySection[sectionKey] ?? { key: null, direction: "none" };
  const column = HISTORY_CARD_SORT_COLUMNS[sortState.key];
  if (!column || sortState.direction === "none") return groups;
  return groups
    .map((group, originalIndex) => ({ group, originalIndex }))
    .sort((a, b) => compareHistoryValues(
      column.value(a.group.rep),
      column.value(b.group.rep),
      column.type,
      sortState.direction
    ) || a.originalIndex - b.originalIndex)
    .map(({ group }) => group);
}

function cycleHistoryCardSort(sectionKey, key) {
  const current = historyCardSortBySection[sectionKey] ?? { key: null, direction: "none" };
  const previousDirection = current.key === key ? current.direction : "none";
  const nextDirection = previousDirection === "none" ? "asc" : previousDirection === "asc" ? "desc" : "none";
  historyCardSortBySection[sectionKey] = { key: nextDirection === "none" ? null : key, direction: nextDirection };
  renderSections(filteredRows());
}

function sortableHistoryCardHeader(sectionKey, key, label) {
  const sortState = historyCardSortBySection[sectionKey] ?? { key: null, direction: "none" };
  const active = sortState.key === key && sortState.direction !== "none";
  const icon = active ? (sortState.direction === "asc" ? "▲" : "▼") : "";
  const ariaSort = !active ? "none" : sortState.direction === "asc" ? "ascending" : "descending";
  return `<th data-hc-section-key="${esc(sectionKey)}" data-hc-sort-key="${esc(key)}" tabindex="0" role="columnheader" aria-sort="${ariaSort}" style="cursor:pointer;user-select:none;white-space:nowrap" title="클릭하여 정렬">${esc(label)}${icon ? ` <span aria-hidden="true" style="font-size:10px">${icon}</span>` : ""}</th>`;
}

function renderSections(rows) {
  const el = document.getElementById("hc-sections");
  if (!el) return;
  historyMoveGroups.clear();

  // 섹션별 그룹 구성
  const sectionMap = {};
  for (const key of SECTION_ORDER) sectionMap[key] = [];
  for (const row of rows) sectionMap[getSectionKey(row)]?.push(row);

  el.innerHTML = SECTION_ORDER.map((secKey) => {
    const sRows   = sectionMap[secKey] ?? [];
    const groups  = sortCourseGroups(groupRows(sRows), secKey);
    const isAdmin = canManageEmployeeHistory();

    return `
      <div class="card hc-section-card" data-hc-drop-section="${esc(secKey)}" style="margin-bottom:var(--space-4);transition:outline-color .15s,background-color .15s">
        <div class="card__header" style="background:var(--gray-50);border-bottom:1px solid var(--gray-200)">
          <div class="card__title" style="font-size:var(--text-sm)">
            ${esc(SECTION_LABELS[secKey])}
            <span class="chip chip--info" style="margin-left:var(--space-2)">${groups.length}과정</span>
          </div>
        </div>
        <div class="card__body" style="padding:0">
          ${groups.length === 0
            ? `<div style="padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">이력 없음</div>`
            : `<div class="table-wrap">
                <table class="hc-section-table" style="min-width:${isAdmin ? "940px" : "900px"}">
                  <thead>
                    <tr>
                      <th style="width:28px"></th>
                      ${sortableHistoryCardHeader(secKey, "courseName", "교육과정명")}
                      ${sortableHistoryCardHeader(secKey, "instructorName", "강사")}
                      ${sortableHistoryCardHeader(secKey, "hours", "교육시간")}
                      ${sortableHistoryCardHeader(secKey, "period", "교육기간")}
                      ${sortableHistoryCardHeader(secKey, "completedAt", "최신 수료일")}
                      ${sortableHistoryCardHeader(secKey, "subType", "초기/보수")}
                      ${sortableHistoryCardHeader(secKey, "nextDueDate", "다음 예정일")}
                      ${sortableHistoryCardHeader(secKey, "daysRemaining", "남은 일수")}
                      ${sortableHistoryCardHeader(secKey, "status", "상태")}
                      ${sortableHistoryCardHeader(secKey, "note", "비고")}
                      ${isAdmin ? '<th style="width:42px;text-align:center;white-space:nowrap">이동</th>' : ""}
                    </tr>
                  </thead>
                  <tbody>
                    ${groups.map((g, gi) => courseGroupRows(g, gi, secKey, isAdmin)).join("")}
                  </tbody>
                </table>
              </div>`
          }
        </div>
      </div>`;
  }).join("");

  // Accordion 토글 이벤트 — 1단계: 과정
  el.querySelectorAll(".hc-group-toggle").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      if (event.target.closest(".hc-course-move-handle")) return;
      const gid  = btn.dataset.gid;
      const icon = btn.querySelector(".hc-toggle-icon");
      const isOpen = icon?.textContent === "▼";

      // 과정 펼침/접힘: data-group-detail 행들 토글
      el.querySelectorAll(`[data-group-detail="${gid}"]`).forEach((tr) => {
        // 날짜 그룹 헤더 행만 보이게/숨기게 (세부 이력은 날짜 토글로 제어)
        const isDgRow = tr.classList.contains("hc-date-toggle");
        const isDgDetail = tr.hasAttribute("data-date-detail");
        if (isOpen) {
          // 접기: 모두 숨기고 날짜 아이콘 초기화
          tr.style.display = "none";
          if (isDgRow) {
            const icon2 = tr.querySelector(".hc-date-icon");
            if (icon2) icon2.textContent = "▶";
          }
        } else {
          // 펼치기: 날짜 그룹 헤더만 보여줌, 세부 이력은 숨김
          if (isDgRow)    tr.style.display = "";
          if (isDgDetail) tr.style.display = "none";
        }
      });
      if (icon) icon.textContent = isOpen ? "▶" : "▼";
    });
  });

  // 2단계: 날짜 그룹 토글
  el.querySelectorAll(".hc-date-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const dgid = btn.dataset.dateGid;
      const icon = btn.querySelector(".hc-date-icon");
      const isOpen = icon?.textContent === "▼";

      el.querySelectorAll(`[data-date-detail="${dgid}"]`).forEach((tr) => {
        tr.style.display = isOpen ? "none" : "";
      });
      if (icon) icon.textContent = isOpen ? "▶" : "▼";
    });
  });

  if (canManageEmployeeHistory()) {
    const clearDropHighlights = () => {
      el.querySelectorAll(".hc-section-card").forEach((card) => {
        card.style.outline = "";
        card.style.backgroundColor = "";
      });
    };
    el.querySelectorAll(".hc-course-move-handle").forEach((handle) => {
      handle.addEventListener("click", (event) => {
        event.stopPropagation();
        openMoveCourseModal(handle.dataset.moveId);
      });
      handle.addEventListener("dragstart", (event) => {
        event.stopPropagation();
        activeHistoryMoveId = handle.dataset.moveId ?? "";
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", activeHistoryMoveId);
      });
      handle.addEventListener("dragend", () => {
        activeHistoryMoveId = "";
        clearDropHighlights();
      });
    });
    el.querySelectorAll(".hc-section-card").forEach((card) => {
      card.addEventListener("dragover", (event) => {
        const targetSection = card.dataset.hcDropSection;
        const group = historyMoveGroups.get(activeHistoryMoveId);
        if (!MOVABLE_SECTION_KEYS.has(targetSection) || !group || group.sourceSection === targetSection) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        clearDropHighlights();
        card.style.outline = "2px dashed var(--brand-500,#3b82f6)";
        card.style.backgroundColor = "var(--brand-50,#eff6ff)";
      });
      card.addEventListener("dragleave", (event) => {
        if (!card.contains(event.relatedTarget)) {
          card.style.outline = "";
          card.style.backgroundColor = "";
        }
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        const moveId = event.dataTransfer?.getData("text/plain") || activeHistoryMoveId;
        const targetSection = card.dataset.hcDropSection;
        activeHistoryMoveId = "";
        clearDropHighlights();
        if (moveId && MOVABLE_SECTION_KEYS.has(targetSection)) openMoveCourseModal(moveId, targetSection);
      });
    });
  }

  // 수정 버튼
  if (canManageEmployeeHistory()) {
    el.querySelectorAll(".hc-edit-history").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = S.rows.find((item) => item._source === "manual" && String(item.historyId) === String(btn.dataset.historyId));
        if (row) openManualHistoryModal(row);
      });
    });
    // 삭제 버튼
    el.querySelectorAll(".hc-delete-history").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!S.selectedEmployeeId) return;
        const ok = window.confirm("이 교육이력을 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.");
        if (!ok) return;
        try {
          btn.disabled = true;
          await deleteEmployeeHistory({
            uid:        S.selectedEmployeeId,
            source:     btn.dataset.source,
            sessionId:  btn.dataset.sessionId  || "",
            trainingId: btn.dataset.trainingId || "",
            historyId:  btn.dataset.historyId  || "",
          });
          toast.success("교육이력이 삭제되었습니다.");
          await loadCard(S.selectedEmployeeId);
        } catch (err) {
          console.error("[history-cards] delete history failed", err);
          toast.error(err?.code === "functions/permission-denied"
            ? "본사 교육관리자만 교육이력을 삭제할 수 있습니다."
            : "교육이력 삭제에 실패했습니다.");
          btn.disabled = false;
        }
      });
    });
  }
}

function openMoveCourseModal(moveId, preferredTarget = "") {
  if (!canManageEmployeeHistory() || !S.selectedEmployeeId) return;
  const group = historyMoveGroups.get(moveId);
  if (!group) {
    toast.error("이동할 과정을 찾을 수 없습니다.");
    return;
  }
  const targets = [...MOVABLE_SECTION_KEYS].filter((sectionKey) => sectionKey !== group.sourceSection);
  const selectedTarget = targets.includes(preferredTarget) ? preferredTarget : targets[0];
  const courseName = group.rep.courseName ?? group.rep.title ?? "과정";
  modal.open({
    title: "교육과정 이동",
    body: `<div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div><strong>'${esc(courseName)}'</strong> 과정을 <strong>'${esc(SECTION_LABELS[group.sourceSection])}'</strong>에서 다른 섹션으로 이동합니다.</div>
      <div class="form-group"><label class="form-label form-label--required">이동할 섹션</label>
        <select class="form-control" id="hc-move-target">
          ${targets.map((sectionKey) => `<option value="${esc(sectionKey)}" ${sectionKey === selectedTarget ? "selected" : ""}>${esc(SECTION_LABELS[sectionKey])}</option>`).join("")}
        </select>
      </div>
      <div style="padding:var(--space-3);background:var(--gray-50);border-radius:var(--radius-md);font-size:var(--text-sm)">
        이 과정에 포함된 <strong>${group.members.length}개 세부 이력</strong>의 교육유형이 함께 변경됩니다. 세부 과목과 강사·시간·기간·수료일·결과·비고는 유지됩니다.
      </div>
    </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "이동", variant: "primary", onClick: async () => {
        const targetSection = document.getElementById("hc-move-target")?.value ?? "";
        if (!MOVABLE_SECTION_KEYS.has(targetSection) || targetSection === group.sourceSection) {
          toast.error("다른 이동 대상 섹션을 선택해 주세요.");
          return;
        }
        const records = group.members.map((row) => ({
          source: row._source,
          historyId: row.historyId ?? "",
          sessionId: row.sessionId ?? "",
          trainingId: row.trainingId ?? "",
        }));
        modal.setLoading("이동", true);
        try {
          const result = await moveEmployeeHistoryCourse({
            uid: S.selectedEmployeeId,
            courseName,
            sourceSection: group.sourceSection,
            targetSection,
            records,
          });
          toast.success(result?.message || `${group.members.length}건의 교육이력을 이동했습니다.`);
          modal.close();
          await loadCard(S.selectedEmployeeId);
        } catch (err) {
          console.error("[history-cards] move course failed", err);
          toast.error(err?.message || "교육과정 이동에 실패했습니다.");
          modal.setLoading("이동", false);
        }
      } },
    ],
  });
}

/**
 * 그룹 대표 행 + 펼침 상세 행 생성
 */
/**
 * 날짜 ms → "YYYY.MM.DD." 표시용 문자열
 */
function fmtDateDot(ms) {
  if (!ms) return "–";
  const numeric = Number(ms);
  const d = new Date(Number.isFinite(numeric) ? numeric : ms);
  if (Number.isNaN(d.getTime())) return "–";
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}.`;
}

/**
 * ms → "YYYY-MM-DD" (날짜 비교용 키)
 */
function dateKey(ms) {
  if (!ms) return "";
  const numeric = Number(ms);
  const d = new Date(Number.isFinite(numeric) ? numeric : ms);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function historyDateValue(row) {
  return [row?.completedAt, row?.endDate, row?.startDate]
    .find((value) => value !== null && value !== undefined && value !== "" && value !== 0) ?? null;
}

function countCourseOccurrences(members) {
  const keys = new Set();
  members.forEach((member, index) => {
    const key = dateKey(historyDateValue(member));
    keys.add(key || `missing:${index}`);
  });
  return keys.size;
}

/**
 * members → 수료일 기준 날짜 그룹 배열 (최신순)
 * [{ dateLabel, dateKey, items: row[] }]
 */
function groupByDate(members) {
  const map = new Map();
  members.forEach((m, index) => {
    const dateValue = historyDateValue(m);
    const dk = dateKey(dateValue) || `missing:${index}`;
    if (!map.has(dk)) map.set(dk, []);
    map.get(dk).push(m);
  });
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))   // 최신 먼저
    .map(([dk, items]) => ({
      dateLabel: historyDateValue(items[0]) ? fmtDateDot(historyDateValue(items[0])) : "날짜 미상",
      dk,
      items,
    }));
}

/**
 * 날짜 그룹의 공통 요약 (강사·시간·초기보수·결과가 모두 같을 때만 표시)
 */
function dateSummary(items) {
  const uniq = (fn) => new Set(items.map(fn).filter(Boolean));
  const instructors = uniq((m) => m.instructorName);
  const hours       = uniq((m) => m.hours);
  const stages      = uniq((m) => getStageLabel(m));
  const results     = uniq((m) => getResultLabel(m));

  const parts = [];
  if (instructors.size === 1) parts.push(esc([...instructors][0]));
  if (hours.size       === 1) parts.push(`${[...hours][0]}시간`);
  if (stages.size      === 1 && [...stages][0] !== "–") parts.push([...stages][0]);
  if (results.size     === 1 && [...results][0] !== "–") parts.push([...results][0]);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

/**
 * 2-level Accordion
 *  과정(1단계) ▶ 날짜그룹(2단계) ▶ 세부 이력
 */
function courseGroupRows(group, gi, secKey, isAdmin) {
  const { rep, members } = group;
  const gid = `g_${secKey}_${gi}`;
  const moveId = `${secKey}:${gi}`;
  if (isAdmin) historyMoveGroups.set(moveId, { sourceSection: secKey, rep, members });

  // ── 대표 행 정보
  const period = rep.startDate
    ? (rep.endDate ? `${formatDate(rep.startDate)} ~ ${formatDate(rep.endDate)}` : formatDate(rep.startDate))
    : "–";
  const subType = getStageLabel(rep);
  const days    = rep.daysRemaining == null ? "–"
                : rep.daysRemaining < 0 ? `${Math.abs(rep.daysRemaining)}일 초과`
                : `${rep.daysRemaining}일`;
  const tone    = rep.dueStatus === "overdue" ? "danger"
                : rep.dueStatus === "soon"    ? "warning"
                : rep.dueStatus === "normal"  ? "success" : "neutral";
  const statusLabel = rep.dueStatusLabel ?? DUE_STATUS_LABELS[rep.dueStatus] ?? "–";
  const statusCell = !statusLabel || statusLabel === "-"
    ? "-"
    : `<span class="chip chip--${tone}">${esc(statusLabel)}</span>`;
  const occurrenceCount = countCourseOccurrences(members);
  const subjCount = `<span style="color:var(--gray-400);font-size:11px;margin-left:4px">(${occurrenceCount}건)</span>`;

  // ── 1단계: 과정 대표 행
  const repRow = `
    <tr style="cursor:pointer" class="hc-group-toggle" data-gid="${gid}">
      <td style="text-align:center;padding:0 4px">
        <span class="hc-toggle-icon" style="font-size:10px;color:var(--gray-400)">▶</span>
      </td>
      <td><strong>${esc(rep.courseName ?? rep.title)}</strong>${subjCount}</td>
      <td>${esc(rep.instructorName ?? "–")}</td>
      <td>${rep.hours ? `${rep.hours}시간` : "–"}</td>
      <td style="white-space:nowrap">${period}</td>
      <td style="white-space:nowrap">${rep.completedAt ? formatDate(rep.completedAt) : "–"}</td>
      <td>${subType}</td>
      <td style="white-space:nowrap">${rep.nextDueDate ? formatDate(rep.nextDueDate) : "–"}</td>
      <td style="white-space:nowrap">${days}</td>
      <td>${statusCell}</td>
      <td>${esc(rep.note || "–")}</td>
      ${isAdmin ? `<td style="text-align:center;padding:0 4px"><button type="button" class="hc-course-move-handle" draggable="true" data-move-id="${esc(moveId)}" aria-label="과정 이동" title="끌어서 섹션 이동 · 클릭하면 이동 메뉴" style="border:0;background:transparent;color:var(--gray-400);cursor:grab;padding:6px 4px;font-size:13px;line-height:1">⋮⋮</button></td>` : ""}
    </tr>`;

  // ── 2단계: 날짜 그룹 + 세부 이력
  const dateGroups = groupByDate(members);

  const dateGroupRows = dateGroups.map((dg, di) => {
    const dgid = `${gid}_d${di}`;
    const summary = dateSummary(dg.items);

    // 날짜 그룹 헤더 행
    const dateHeaderRow = `
      <tr data-group-detail="${gid}" data-date-gid="${dgid}"
          style="display:none;cursor:pointer;background:var(--blue-50,#eff6ff)"
          class="hc-date-toggle">
        <td style="border-left:3px solid var(--blue-400,#60a5fa);text-align:center;padding:0 4px">
          <span class="hc-date-icon" style="font-size:9px;color:var(--blue-500,#3b82f6)">▶</span>
        </td>
        <td colspan="${isAdmin ? 11 : 10}" style="padding:6px var(--space-3);font-size:var(--text-sm)">
          <span style="font-weight:var(--weight-semibold);color:var(--blue-700,#1d4ed8)">${esc(dg.dateLabel)}</span>
          <span style="color:var(--gray-500);font-size:11px;margin-left:6px">(${dg.items.length}건)${summary}</span>
        </td>
      </tr>`;

    // 세부 이력 행들
    const itemRows = dg.items.map((m) => {
      const mPeriod = m.startDate
        ? (m.endDate ? `${formatDate(m.startDate)} ~ ${formatDate(m.endDate)}` : formatDate(m.startDate))
        : "–";
      const canEditManual = isAdmin && m._source === "manual";
      const adminBtns = isAdmin
        ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">
             ${canEditManual ? `<button type="button" class="btn btn--ghost btn--sm hc-edit-history" data-history-id="${esc(m.historyId ?? "")}">수정</button>` : ""}
             <button type="button" class="btn btn--ghost btn--sm hc-delete-history"
               data-source="${esc(m._source)}"
               data-session-id="${esc(m.sessionId ?? "")}"
               data-training-id="${esc(m.trainingId ?? "")}"
               data-history-id="${esc(m.historyId ?? "")}">삭제</button>
           </div>`
        : "";

      return `
        <tr data-group-detail="${gid}" data-date-detail="${dgid}"
            style="display:none;background:var(--gray-50)">
          <td style="border-left:5px solid var(--blue-300,#93c5fd)"></td>
          <td colspan="${isAdmin ? 11 : 10}" style="padding:var(--space-2) var(--space-3)">
            <div style="display:flex;flex-wrap:wrap;gap:var(--space-4);font-size:var(--text-sm)">
              <div>
                <span style="color:var(--gray-500);font-size:11px">수료일</span><br/>
                <strong>${m.completedAt ? formatDate(m.completedAt) : "–"}</strong>
              </div>
              <div>
                <span style="color:var(--gray-500);font-size:11px">교육기간</span><br/>${mPeriod}
              </div>
              <div>
                <span style="color:var(--gray-500);font-size:11px">강사</span><br/>${esc(m.instructorName ?? "–")}
              </div>
              <div>
                <span style="color:var(--gray-500);font-size:11px">시간</span><br/>${m.hours ? `${m.hours}시간` : "–"}
              </div>
              <div>
                <span style="color:var(--gray-500);font-size:11px">초기/보수</span><br/>${getStageLabel(m)}
              </div>
              <div>
                <span style="color:var(--gray-500);font-size:11px">결과</span><br/>${getResultLabel(m)}
              </div>
              ${m.subjectName && m.subjectName !== (m.courseName ?? m.title)
                ? `<div><span style="color:var(--gray-500);font-size:11px">교육과목</span><br/>${esc(m.subjectName)}</div>`
                : ""}
              ${m.note ? `<div><span style="color:var(--gray-500);font-size:11px">비고</span><br/>${esc(m.note)}</div>` : ""}
            </div>
            ${adminBtns}
          </td>
        </tr>`;
    }).join("");

    return dateHeaderRow + itemRows;
  }).join("");

  return repRow + dateGroupRows;
}

/* ──────────────────────────────────────────────────────────
   Stage / Result 정규화 Helper  (화면 표시 + 그룹화 공용)
────────────────────────────────────────────────────────── */

/** stage 값 정규화 → "initial" | "recurrent" | null */
function _normStage(v) {
  if (!v) return null;
  const s = String(v).replace(/\([^)]*\)/g, "").replace(/\s+/g, "").toLowerCase().trim();
  if (["초기", "초기교육", "입문", "입문교육", "initial"].includes(s)) return "initial";
  if ([
    "보수", "보수교육", "정기", "정기교육", "갱신", "갱신교육", "재교육",
    "recurrent", "recurring", "refresher", "recurrenttraining",
  ].includes(s)) return "recurrent";
  return null;  // PASS, FAIL, 이수 등 result 값은 null 반환
}

/** result 값 정규화 → "PASS" | "FAIL" | null */
function _normResult(v) {
  if (!v) return null;
  const s = String(v).replace(/\([^)]*\)/g, "").replace(/\s+/g, "").toLowerCase().trim();
  // stage 값이 result 자리에 있으면 null
  if (_normStage(v)) return null;
  if (["pass", "이수", "수료", "완료", "합격"].includes(s)) return "PASS";
  if (["fail", "미수료", "불합격"].includes(s)) return "FAIL";
  return null;
}

/**
 * 여러 후보 필드에서 stage 를 찾아 한글 라벨로 반환
 * 기존에 잘못 저장된 경우(result 자리에 stage 값): result 필드도 탐색
 */
function getStageLabel(row) {
  // 1차: 정상 위치에서 탐색
  for (const v of [row.subType, row.educationStage, row.initialOrRecurrent, row.trainingPhase]) {
    const s = _normStage(v);
    if (s === "initial")   return "초기";
    if (s === "recurrent") return "보수";
  }
  // 2차: result 자리에 stage 값이 잘못 저장된 경우 → result 필드에서 탐색
  const stageFromResult = _normStage(row.result);
  if (stageFromResult === "initial")   return "초기";
  if (stageFromResult === "recurrent") return "보수";
  return "–";
}

/**
 * 여러 후보 필드에서 result 를 찾아 반환
 * 기존에 잘못 저장된 경우(subType 자리에 result 값): subType 필드도 탐색
 */
function getResultLabel(row) {
  // 1차: 정상 위치에서 탐색
  for (const v of [row.result]) {
    const r = _normResult(v);
    if (r === "PASS") return "PASS";
    if (r === "FAIL") return "FAIL";
  }
  // 2차: stage 자리에 result 값이 잘못 저장된 경우 → subType/educationStage 필드에서 탐색
  for (const v of [row.subType, row.educationStage, row.initialOrRecurrent]) {
    const r = _normResult(v);
    if (r === "PASS") return "PASS";
    if (r === "FAIL") return "FAIL";
  }
  // 3차: completionStatus
  if (row.completionStatus === "completed") return "PASS";
  return "–";
}

/** @deprecated — getStageLabel() 사용 권장 */
function _stageLabel(subType) {
  return getStageLabel({ subType });
}

function toInputDate(value) {
  if (!value) return "";
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function dateInputMillis(id) { const value=document.getElementById(id)?.value; return value ? new Date(`${value}T00:00:00`).getTime() : null; }

function normalizeManualStage(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (["recurrent", "recurring", "refresher", "보수", "정기", "갱신", "재교육"].includes(key)) return "recurrent";
  if (["initial", "초기", "입문"].includes(key)) return "initial";
  return "";
}

function manualCategoryForRow(row) {
  if (row?.trainingType !== "job") return row?.trainingType ?? "job";
  return normalizeManualStage(row?.subType ?? row?.educationStage) === "recurrent" ? "job_recurrent" : "job_initial";
}

function getManualSelectableItems(category, row) {
  const trainingType = category.startsWith("job_") ? "job" : category;
  const categoryStage = category === "job_initial" ? "initial" : category === "job_recurrent" ? "recurrent" : "";
  const items = buildSelectableTrainingItems(S.items)
    .filter((item) => item.trainingType === trainingType)
    .filter((item) => !categoryStage || !item.subType || item.subType === categoryStage)
    .map((item) => ({
      ...item,
      courseName: item.displayName,
      subType: item.subType || categoryStage,
    }));

  if (row && ["job", "legal"].includes(trainingType)) {
    items.push({
      itemId: row.itemId ?? "",
      subjectCode: row.subjectCode ?? "",
      subjectName: row.subjectName ?? row.courseName ?? row.title ?? "",
      courseName: row.courseName ?? row.title ?? row.subjectName ?? "",
      subType: normalizeManualStage(row.subType) || categoryStage,
    });
  }

  const seen = new Set();
  return items.filter((item) => {
    if (!item.courseName) return false;
    const key = `${item.itemId}|${item.subjectCode}|${item.courseName}|${item.subType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.courseName.localeCompare(b.courseName, "ko"));
}

function openManualHistoryModal(row = null) {
  if (!S.selectedEmployeeId || !S.selectedEmployee) { toast.warning("먼저 직원을 선택해 주세요."); return; }
  const initialCategory = manualCategoryForRow(row);
  let selectableItems = [];
  modal.open({
    title: row ? "개인 교육이력 수정" : "개인 교육이력 추가", size: "lg",
    body: `<div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div style="padding:var(--space-3);background:var(--gray-50);border-radius:var(--radius-md);font-size:var(--text-sm)"><b>${esc(S.selectedEmployee.name ?? "–")}</b> (${esc(S.selectedEmployee.empNo ?? "–")})에게만 등록됩니다.</div>
      <div class="form-row"><div class="form-group"><label class="form-label form-label--required">교육유형</label><select class="form-control" id="mh-category">${[["job_initial","직무초기교육"],["job_recurrent","직무보수교육"],["legal","법정교육"],["online","온라인교육"],["external","외부교육"],["other","기타"]].map(([v,l])=>`<option value="${v}" ${initialCategory===v?"selected":""}>${l}</option>`).join("")}</select></div><div class="form-group"><label class="form-label form-label--required">교육과목명</label><input class="form-control" id="mh-subject" value="${esc(row?.subjectName??"")}"/></div></div>
      <div class="form-row"><div class="form-group" id="mh-item-wrap"><label class="form-label form-label--required">교육항목 선택</label><select class="form-control" id="mh-item"><option value="">-- 교육항목을 선택하세요 --</option></select><div class="form-hint">등록된 교육항목만 선택할 수 있습니다.</div></div><div class="form-group" id="mh-title-wrap"><label class="form-label form-label--required">교육과정명</label><input class="form-control" id="mh-title" value="${esc(row?.courseName??row?.title??"")}"/></div><div class="form-group"><label class="form-label">강사명</label><input class="form-control" id="mh-instructor" value="${esc(row?.instructorName??"")}"/></div></div>
      <input type="hidden" id="mh-item-id" value="${esc(row?.itemId??"")}"/><input type="hidden" id="mh-subject-code" value="${esc(row?.subjectCode??"")}"/>
      <div class="form-row form-row--3"><div class="form-group"><label class="form-label">교육시간</label><input class="form-control" id="mh-hours" type="number" min="0" step="0.5" value="${row?.hours??""}"/></div><div class="form-group"><label class="form-label">초기/보수</label><select class="form-control" id="mh-subtype"><option value="">구분 없음</option><option value="initial">초기</option><option value="recurrent">보수</option></select></div><div class="form-group"><label class="form-label">결과</label><input class="form-control" id="mh-result" value="${esc(row?.result??"PASS")}"/></div></div>
      <div class="form-row form-row--3"><div class="form-group"><label class="form-label">교육 시작일</label><input class="form-control" id="mh-start" type="date" value="${toInputDate(row?.startDate)}"/></div><div class="form-group"><label class="form-label">교육 종료일</label><input class="form-control" id="mh-end" type="date" value="${toInputDate(row?.endDate)}"/></div><div class="form-group"><label class="form-label form-label--required">수료일</label><input class="form-control" id="mh-completed" type="date" value="${toInputDate(row?.completedAt)}"/></div></div>
      <div class="form-group"><label class="form-label">비고</label><textarea class="form-control" id="mh-note" rows="2">${esc(row?.note??"")}</textarea></div>
    </div>`,
    actions:[{label:"취소",variant:"secondary",onClick:()=>modal.close()},{label:row?"수정":"등록",variant:"primary",onClick:async()=>{
      const category = document.getElementById("mh-category")?.value ?? "";
      const trainingType = category.startsWith("job_") ? "job" : category;
      const payload={historyId:row?.historyId??"",uid:S.selectedEmployeeId,itemId:document.getElementById("mh-item-id")?.value??"",trainingType,subjectCode:document.getElementById("mh-subject-code")?.value??"",subjectName:document.getElementById("mh-subject")?.value?.trim(),title:document.getElementById("mh-title")?.value?.trim(),courseName:document.getElementById("mh-title")?.value?.trim(),instructorName:document.getElementById("mh-instructor")?.value?.trim(),hours:Number(document.getElementById("mh-hours")?.value)||0,subType:document.getElementById("mh-subtype")?.value,cycleMonths:Number(row?.cycleMonths??0)||0,startDate:dateInputMillis("mh-start"),endDate:dateInputMillis("mh-end"),completedAt:dateInputMillis("mh-completed"),result:document.getElementById("mh-result")?.value?.trim()||"PASS",note:document.getElementById("mh-note")?.value?.trim()};
      if(!payload.subjectName||!payload.title||!payload.completedAt){toast.error("교육항목/과정명, 교육과목명, 수료일을 확인해 주세요.");return;}
      if(["job","legal"].includes(trainingType)&&!document.getElementById("mh-item")?.value){toast.error("등록된 교육항목을 선택해 주세요.");return;}
      modal.setLoading(row?"수정":"등록",true);try{await upsertManualTrainingHistory(payload);toast.success(`개인 교육이력을 ${row?"수정":"등록"}했습니다.`);modal.close();await loadCard(S.selectedEmployeeId);}catch(err){console.error(err);toast.error(err?.message||"저장에 실패했습니다.");modal.setLoading(row?"수정":"등록",false);}
    }}]
  });

  const refreshCourseControl = () => {
    const category = document.getElementById("mh-category")?.value ?? "";
    const directInput = ["online", "external", "other"].includes(category);
    const itemWrap = document.getElementById("mh-item-wrap");
    const titleWrap = document.getElementById("mh-title-wrap");
    const itemSelect = document.getElementById("mh-item");
    const subType = document.getElementById("mh-subtype");
    if (itemWrap) itemWrap.style.display = directInput ? "none" : "block";
    if (titleWrap) titleWrap.style.display = directInput ? "block" : "none";
    selectableItems = directInput ? [] : getManualSelectableItems(category, row);
    if (itemSelect) {
      itemSelect.innerHTML = `<option value="">-- 교육항목을 선택하세요 --</option>` + selectableItems.map((item, index) => `<option value="${index}">${esc(item.courseName)}${item.subjectName !== item.courseName ? ` · ${esc(item.subjectName)}` : ""}</option>`).join("");
      const selectedIndex = selectableItems.findIndex((item) =>
        (row?.itemId && item.itemId === row.itemId) ||
        (row && item.courseName === (row.courseName ?? row.title) && (!row.subjectCode || item.subjectCode === row.subjectCode))
      );
      if (selectedIndex >= 0) itemSelect.value = String(selectedIndex);
    }
    if (subType) {
      if (category === "job_initial") { subType.value = "initial"; subType.disabled = true; }
      else if (category === "job_recurrent") { subType.value = "recurrent"; subType.disabled = true; }
      else { subType.disabled = false; subType.value = normalizeManualStage(row?.subType) || ""; }
    }
  };

  document.getElementById("mh-category")?.addEventListener("change", () => {
    document.getElementById("mh-title").value = "";
    document.getElementById("mh-subject").value = "";
    document.getElementById("mh-item-id").value = "";
    document.getElementById("mh-subject-code").value = "";
    refreshCourseControl();
  });
  document.getElementById("mh-item")?.addEventListener("change", (event) => {
    if (event.target.value === "") {
      document.getElementById("mh-title").value = "";
      document.getElementById("mh-item-id").value = "";
      document.getElementById("mh-subject-code").value = "";
      return;
    }
    const item = selectableItems[Number(event.target.value)];
    if (!item) return;
    document.getElementById("mh-title").value = item.courseName;
    document.getElementById("mh-subject").value = item.subjectName;
    document.getElementById("mh-item-id").value = item.itemId;
    document.getElementById("mh-subject-code").value = item.subjectCode;
  });
  refreshCourseControl();
}


/* ──────────────────────────────────────────────────────────
   기존 교육이력 가져오기  (Excel Import Engine v2.0)
────────────────────────────────────────────────────────── */
function openImportExcelModal() {
  modal.open({
    title: "기존 교육이력 가져오기",
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="background:var(--blue-50,#eff6ff);border:1px solid var(--blue-200,#bfdbfe);border-radius:var(--radius-md);padding:var(--space-3);font-size:var(--text-sm);color:var(--blue-800,#1e40af)">
          <strong>안내</strong><br/>
          기존 교육이력 Excel 파일(법정/직무 시트 포함)을 업로드하면
          시스템 이력의 빈 항목(강사·교육시간·교육기간·초기/보수·비고)을 자동으로 채웁니다.
          매칭되지 않은 이력은 신규 이력으로 추가할 수 있습니다.
        </div>

        <div class="form-group">
          <label class="form-label form-label--required">교육이력 Excel 파일 (.xlsx)</label>
          <input class="form-control" id="import-excel-file" type="file" accept=".xlsx,.xlsm,.xls"/>
          <div class="form-hint">법정/직무 시트가 포함된 개인 교육이력 파일을 선택하세요.</div>
        </div>

        <div class="form-group">
          <label class="form-label">업데이트 방식</label>
          <div style="display:flex;flex-direction:column;gap:var(--space-2)">
            <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer">
              <input type="radio" name="import-mode" value="fill" checked/> 빈 항목만 채우기 (기본)
            </label>
            <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer">
              <input type="radio" name="import-mode" value="overwrite"/> Excel 값으로 덮어쓰기
            </label>
          </div>
        </div>

        <div id="import-preview" style="display:none">
          <div style="font-weight:var(--weight-semibold);font-size:var(--text-sm);margin-bottom:var(--space-2)">미리보기</div>
          <div id="import-preview-content"></div>
        </div>
        <div id="import-parse-status" style="font-size:var(--text-sm);color:var(--gray-500)"></div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "분석",
        variant: "secondary",
        onClick: async () => {
          const file = document.getElementById("import-excel-file")?.files?.[0];
          if (!file) { toast.warning("파일을 선택해 주세요."); return; }
          const statusEl = document.getElementById("import-parse-status");
          if (statusEl) statusEl.textContent = "파일 분석 중...";
          try {
            const analyzed = await analyzeExcel(file);

            // 기본 미리보기 통계 (직원 매칭은 서버에서)
            let newCount = 0, errorCount = 0;
            for (const r of analyzed.rows) {
              if (!r.completedAt || (!r.courseName && !r.subjectName)) errorCount++;
              else newCount++;
            }
            const preview = {
              summary: { total: analyzed.rows.length, new: newCount, fill: 0, duplicate: 0, error: errorCount },
              rows: analyzed.rows,
            };

            window._importAnalyzed = analyzed;

            const previewEl = document.getElementById("import-preview");
            const contentEl = document.getElementById("import-preview-content");
            if (previewEl) previewEl.style.display = "block";
            if (contentEl) renderDetailedPreview(contentEl, preview);

            const parserInfo = analyzed.parsersUsed?.join(", ") ?? "";
            const validCount = analyzed.rows.filter((r) => r.completedAt && (r.courseName || r.subjectName)).length;
            if (statusEl) statusEl.textContent =
              `분석 완료: 총 ${analyzed.rows.length}건 (저장 가능: ${validCount}건, 오류: ${errorCount}건)` +
              (parserInfo ? `  [${parserInfo}]` : "");
          } catch (err) {
            console.error("[history-cards] analyzeExcel failed", err);
            if (statusEl) statusEl.textContent = `분석 실패: ${err.message}`;
            toast.error("파일을 분석하지 못했습니다.");
          }
        },
      },
      {
        label: "저장",
        variant: "primary",
        onClick: async () => {
          const analyzed = window._importAnalyzed;
          if (!analyzed?.rows?.length) { toast.warning("먼저 파일을 분석해 주세요."); return; }
          const mode = document.querySelector("input[name='import-mode']:checked")?.value ?? "fill";

          // 수료일 없는 행 제외 (필수), 과정명 없는 행 제외
          const payload = analyzed.rows
            .filter((r) => r.completedAt && (r.courseName || r.subjectName))
            .map((r) => ({
              empNo:          String(r.empNo ?? "").trim(),
              employeeName:   String(r.employeeName ?? "").trim(),
              trainingType:   r.trainingType,
              courseName:     String(r.courseName ?? "").trim(),
              subjectName:    String(r.subjectName ?? "").trim(),
              instructorName: String(r.instructor ?? "").trim(),
              trainingHours:  r.hours != null ? Number(r.hours) : 0,
              startDate:      r.startDate  ?? null,
              endDate:        r.endDate    ?? null,
              completedAt:    r.completedAt,
              result:         r.result     ?? "PASS",
              educationStage: r.initialOrRecurrent ?? "",
              subType:        r.initialOrRecurrent ?? "",
              note:           String(r.note ?? "").trim(),
              sourceRowNumber: r.sourceRowNumber ?? null,
              sourceBlockStartRow: r.sourceBlockStartRow ?? r.sourceRowNumber ?? null,
              sourceBlockEndRow: r.sourceBlockEndRow ?? r.sourceRowNumber ?? null,
              sourceSheetName: r.sourceSheetName ?? "",
              importTraceId:   r.importTraceId ?? "",
              rawCourseName:   r.rawCourseName ?? "",
              rawStage:        r.rawStage ?? "",
              rawPeriod:       r.rawPeriod ?? "",
              rawCompletedAt:  r.rawCompletedAt ?? null,
            }));

          if (!payload.length) {
            toast.warning("저장 가능한 이력이 없습니다. (수료일 또는 과정명 누락)");
            return;
          }
          modal.setLoading("저장", true);
          try {
            console.info("[history-cards] import payload", {
              parsedCount: analyzed.rows.length,
              validCount: payload.length,
              selectedEmployeeUid: S.selectedEmployeeId,
              records: payload,
            });
            const result = await importHistoryExcelData({ rows: payload, mode });
            console.info("[history-cards] import result", result);

            // 상세 결과 구성
            const totalSaved = (result.createdCount ?? 0) + (result.updatedCount ?? 0);
            const parts = [
              `분석: ${result.parsedCount ?? payload.length}건`,
              `직원매칭: ${result.matchedEmployeeCount ?? result.matchedEmployees ?? 0}명`,
              result.createdCount  ? `신규: ${result.createdCount}건` : null,
              result.updatedCount  ? `보완: ${result.updatedCount}건` : null,
              result.skippedDuplicateCount ? `중복: ${result.skippedDuplicateCount}건` : null,
              result.skippedInvalidCount   ? `오류: ${result.skippedInvalidCount}건` : null,
              result.unmatchedEmployeeCount ? `직원미매칭: ${result.unmatchedEmployeeCount}건` : null,
            ].filter(Boolean).join(" · ");

            if (totalSaved === 0) {
              // 0건 시 이유 표시
              const reasons = [];
              if (result.unmatchedEmployeeCount > 0) reasons.push(`직원 미매칭: ${result.unmatchedEmployeeCount}건`);
              if (result.skippedInvalidCount    > 0) reasons.push(`유효하지 않은 수료일: ${result.skippedInvalidCount}건`);
              if (result.skippedDuplicateCount  > 0) reasons.push(`중복으로 건너뜀: ${result.skippedDuplicateCount}건`);
              if (result.matchedExistingCount   > 0 && result.updatedCount === 0) reasons.push(`기존 이력에 보완할 내용 없음: ${result.matchedExistingCount}건`);
              if (result.errors?.length)             reasons.push(...result.errors.slice(0, 3));
              toast.warning(`저장된 이력이 없습니다.\n${reasons.join("\n") || "알 수 없는 이유"}`);
            } else {
              toast.success(parts);
            }
            modal.close();
            delete window._importAnalyzed;
            if (S.selectedEmployeeId) await loadCard(S.selectedEmployeeId);
          } catch (err) {
            console.error("[history-cards] importHistoryExcelData failed", err);
            toast.error(err?.message || "저장에 실패했습니다.");
            modal.setLoading("저장", false);
          }
        },
      },
    ],
  });
}

/* ──────────────────────────────────────────────────────────
   Excel 파싱 → excel-import-engine.js 로 이전됨 (v2.0)
   아래 함수들은 더 이상 사용되지 않으며, Engine이 대체합니다.
────────────────────────────────────────────────────────── */
async function parseHistoryExcel(file) {
  const XLSX = await loadXlsx();
  if (!XLSX) throw new Error("SheetJS 라이브러리를 불러올 수 없습니다.");

  const buffer = await file.arrayBuffer();
  const wb     = XLSX.read(buffer, { type: "array", cellDates: true, dense: false });

  const SHEET_TYPE_MAP = {
    "법정": "legal",
    "직무": "job",
  };

  const allRows = [];

  for (const sheetName of wb.SheetNames) {
    if (sheetName.startsWith("_")) continue; // _meta 등 무시
    const trainingType = Object.entries(SHEET_TYPE_MAP).find(([k]) => sheetName.includes(k))?.[1] ?? "other";
    const ws = wb.Sheets[sheetName];
    const rows = parseSheet(XLSX, ws, trainingType);
    allRows.push(...rows);
  }

  // 직원 기본정보 (첫 번째 유효 시트에서)
  let empInfo = { empNo: "", employeeName: "" };
  for (const sheetName of wb.SheetNames) {
    if (sheetName.startsWith("_")) continue;
    const ws = wb.Sheets[sheetName];
    empInfo = detectEmployeeInfo(XLSX, ws);
    if (empInfo.empNo || empInfo.employeeName) break;
  }

  return { empInfo, rows: allRows, fileName: file.name };
}

function parseSheet(XLSX, ws, trainingType) {
  if (!ws || !ws["!ref"]) return [];
  const range = XLSX.utils.decode_range(ws["!ref"]);

  // 헤더 행 탐지 (교육과정명 or 교육과목 포함 행)
  let headerRow = -1;
  for (let r = 0; r <= Math.min(range.e.r, 20); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = getCellValue(ws, r, c);
      if (v && (v.includes("교육과정") || v.includes("교육과목"))) {
        headerRow = r; break;
      }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return [];

  // 컬럼 인덱스 탐지
  const COL_KEYS = {
    courseName:    ["교육과정명", "교육과정", "과정명"],
    subjectName:   ["교육과목", "과목"],
    instructorName:["강사"],
    trainingHours: ["교육시간", "시간"],
    period:        ["교육기간", "기간"],
    completedAt:   ["수료일자", "수료일", "완료일"],
    result:        ["결과"],
    subType:       ["초기/보수", "초기", "보수"],
    note:          ["비고"],
  };
  const colMap = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const v = getCellValue(ws, headerRow, c) ?? "";
    const clean = v.replace(/\s+/g, "");
    for (const [key, patterns] of Object.entries(COL_KEYS)) {
      if (!colMap[key] !== undefined && patterns.some((p) => clean.includes(p.replace(/\s+/g, "")))) {
        colMap[key] = c; break;
      }
    }
  }

  // 병합 범위 맵 구축 (셀 주소 → 병합 기준 셀 주소)
  const mergeMap = buildMergeMap(XLSX, ws);

  // 데이터 행 파싱
  const rows = [];
  let lastCourseName = "";
  let lastInstructor = "";
  let lastHours      = "";
  let lastPeriod     = "";
  let lastCompletedAt= "";
  let lastResult     = "";
  let lastSubType    = "";
  let lastNote       = "";

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    // 병합 고려해서 값 읽기
    const getVal = (colKey) => {
      const c = colMap[colKey];
      if (c === undefined) return "";
      return getMergedValue(ws, r, c, mergeMap) ?? "";
    };

    const courseNameRaw = getVal("courseName");
    const subjectName   = String(getVal("subjectName")).trim();

    // 과정명: 이전 값 상속 (병합셀 처리)
    const courseName = courseNameRaw ? String(courseNameRaw).trim() : lastCourseName;
    if (courseNameRaw) lastCourseName = courseName;

    // 과정명도 없고 과목명도 없으면 행 건너뜀
    if (!courseName && !subjectName) continue;

    const instructor = getVal("instructorName") || lastInstructor;
    const hours      = getVal("trainingHours")  || lastHours;
    const period     = getVal("period")          || lastPeriod;
    const completedRaw = getVal("completedAt")   || lastCompletedAt;
    const result     = getVal("result")          || lastResult;
    const subTypeRaw = getVal("subType")         || lastSubType;
    const note       = getVal("note")            || lastNote;

    // 값 갱신 (병합 고려)
    if (getVal("instructorName")) lastInstructor  = instructor;
    if (getVal("trainingHours"))  lastHours       = hours;
    if (getVal("period"))         lastPeriod      = period;
    if (getVal("completedAt"))    lastCompletedAt = completedRaw;
    if (getVal("result"))         lastResult      = result;
    if (getVal("subType"))        lastSubType     = subTypeRaw;
    if (getVal("note"))           lastNote        = note;

    // 날짜 파싱
    const { startDate, endDate } = parsePeriod(period);
    const completedAt = parseHistDate(completedRaw);
    if (!completedAt && !courseNameRaw) continue; // 수료일도 과정명도 없으면 실질 빈 행

    rows.push({
      trainingType,
      courseName:     courseName || subjectName,
      subjectName:    subjectName || courseName,
      instructorName: String(instructor).trim(),
      trainingHours:  normalizeHours(hours),
      startDate,
      endDate,
      completedAt,
      result:         normalizeResult(result),
      educationStage: normalizeStage(subTypeRaw),
      subType:        normalizeStage(subTypeRaw),
      note:           String(note).trim(),
      source:         "history_excel",
    });
  }

  return rows;
}

function detectEmployeeInfo(XLSX, ws) {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1:Z20");
  let empNo = "", employeeName = "";
  for (let r = 0; r <= Math.min(range.e.r, 12); r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const v = getCellValue(ws, r, c);
      if (!v) continue;
      const clean = String(v).replace(/\s+/g, "");
      if (clean === "성명" || clean === "이름") {
        employeeName = String(getCellValue(ws, r, c + 1) ?? getCellValue(ws, r, c + 2) ?? "").trim();
      }
      if (clean === "사번" || clean === "직원번호") {
        empNo = String(getCellValue(ws, r, c + 1) ?? getCellValue(ws, r, c + 2) ?? "").trim();
      }
    }
  }
  return { empNo, employeeName };
}

function buildMergeMap(XLSX, ws) {
  const map = new Map(); // "R,C" → 기준 셀 값
  const merges = ws["!merges"] ?? [];
  for (const m of merges) {
    const anchorAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
    const anchorCell = ws[anchorAddr];
    const val = anchorCell?.v ?? anchorCell?.w ?? null;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        map.set(`${r},${c}`, val);
      }
    }
  }
  return map;
}

function getMergedValue(ws, r, c, mergeMap) {
  const key = `${r},${c}`;
  if (mergeMap.has(key)) return mergeMap.get(key);
  const addr = `${colLetter(c)}${r + 1}`;
  const cell = ws[addr];
  return cell?.v ?? cell?.w ?? null;
}

function getCellValue(ws, r, c) {
  const addr = `${colLetter(c)}${r + 1}`;
  const cell = ws[addr];
  if (!cell) return null;
  if (cell.v instanceof Date) return cell.w ?? cell.v.toISOString();
  return cell.v != null ? String(cell.v) : null;
}

function colLetter(colIdx) {
  let s = "";
  let n = colIdx + 1;
  while (n > 0) { s = String.fromCharCode(64 + (n % 26 || 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* ──────────────────────────────────────────────────────────
   날짜 / 서브타입 / 결과 정규화
────────────────────────────────────────────────────────── */
function parseHistDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  const n = Number(v);
  // Excel serial
  if (Number.isFinite(n) && n >= 60 && n < 2958466) {
    return Math.round((n - 25569) * 86400 * 1000);
  }
  const s = String(v).trim().replace(/[./]/g, "-");
  // 날짜 범위면 첫 번째만
  const first = s.split(/[~\s]/)[0].trim();
  const d = new Date(first);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function parsePeriod(s) {
  if (!s) return { startDate: null, endDate: null };
  s = String(s).trim();
  // 패턴1: YYYY.MM.DD~YYYY.MM.DD (전체 연도 포함)
  const m1 = s.match(/^(\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2})\s*[~\-–]\s*(\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2})$/);
  if (m1) return { startDate: parseHistDate(m1[1]), endDate: parseHistDate(m1[2]) };
  // 패턴2: YYYY.MM.DD~MM.DD (단축 종료일 - 연도 공유)
  const m2 = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s*[~\-–]\s*(\d{1,2})[.\-\/](\d{1,2})$/);
  if (m2) {
    const [, y, sm, sd, em, ed] = m2;
    return {
      startDate: parseHistDate(`${y}-${sm.padStart(2,"0")}-${sd.padStart(2,"0")}`),
      endDate:   parseHistDate(`${y}-${em.padStart(2,"0")}-${ed.padStart(2,"0")}`),
    };
  }
  return { startDate: parseHistDate(s), endDate: null };
}

function normalizeHours(v) {
  if (!v && v !== 0) return "";
  const s = String(v).replace(/[Hh][Rr][Ss]?|시간/g, "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? String(v) : n;
}

/** @deprecated — _normResult() + getResultLabel() 사용 권장 */
function normalizeResult(v) {
  return _normResult(v) ?? "PASS";
}

/** @deprecated — _normStage() + getStageLabel() 사용 권장 */
function normalizeStage(v) {
  return _normStage(v) ?? "";
}

/* ──────────────────────────────────────────────────────────
   미리보기 렌더
────────────────────────────────────────────────────────── */
function renderImportPreview(parsed) {
  const el = document.getElementById("import-preview");
  const contentEl = document.getElementById("import-preview-content");
  if (!el || !contentEl) return;

  const TYPE_LABEL = { legal: "법정", job: "직무", other: "기타" };

  contentEl.innerHTML = `
    <div class="table-wrap" style="max-height:280px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius-md)">
      <table class="data-table" style="min-width:600px">
        <thead>
          <tr>
            <th>유형</th><th>교육과정명</th><th>교육과목</th>
            <th>강사</th><th>수료일</th><th>초기/보수</th>
          </tr>
        </thead>
        <tbody>
          ${parsed.rows.slice(0, 50).map((r) => `
            <tr>
              <td style="font-size:var(--text-xs)">${TYPE_LABEL[r.trainingType] ?? r.trainingType}</td>
              <td style="font-size:var(--text-xs)">${esc(r.courseName)}</td>
              <td style="font-size:var(--text-xs)">${esc(r.subjectName)}</td>
              <td style="font-size:var(--text-xs)">${esc(r.instructorName) || "–"}</td>
              <td style="font-size:var(--text-xs)">${r.completedAt ? fmtDateMs(r.completedAt) : "–"}</td>
              <td style="font-size:var(--text-xs)">${getStageLabel({ subType: r.educationStage, educationStage: r.educationStage, initialOrRecurrent: r.initialOrRecurrent })}</td>
            </tr>`).join("")}
          ${parsed.rows.length > 50 ? `<tr><td colspan="6" style="text-align:center;color:var(--gray-400);font-size:var(--text-xs)">… 외 ${parsed.rows.length - 50}건</td></tr>` : ""}
        </tbody>
      </table>
    </div>`;

  el.style.display = "block";
}

function fmtDateMs(ms) {
  if (!ms) return "–";
  const d = new Date(Number(ms));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

/* ──────────────────────────────────────────────────────────
   개인이력 전체 초기화
────────────────────────────────────────────────────────── */
function openResetAllHistoryModal() {
  if (!S.selectedEmployeeId || !S.selectedEmployee) {
    toast.warning("먼저 직원을 선택해 주세요.");
    return;
  }
  const emp = S.selectedEmployee;
  const empName = esc(emp.name ?? "–");
  const empNo   = esc(emp.empNo ?? "–");
  modal.open({
    title: "개인이력 전체 초기화",
    body: `
      <div style="padding:var(--space-2)">
        <p style="margin-bottom:var(--space-3);font-weight:var(--weight-semibold);color:var(--red-600,#dc2626)">
          ⚠ 주의: 이 작업은 되돌릴 수 없습니다.
        </p>
        <p style="margin-bottom:var(--space-3)"><strong>${empName}</strong> (${empNo})의 삭제 범위를 선택하세요.</p>
        <div style="background:var(--gray-50);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-3);font-size:var(--text-sm)">
          <div style="font-weight:var(--weight-semibold);margin-bottom:var(--space-2)">삭제 범위 (단일 선택)</div>
          <label style="display:block;margin:8px 0"><input type="radio" name="history-reset-scope" value="manual"> 수동 등록 이력만 <small>(manual)</small></label>
          <label style="display:block;margin:8px 0"><input type="radio" name="history-reset-scope" value="excel"> Excel로 가져온 이력만 <small>(manual_excel, history_excel)</small></label>
          <label style="display:block;margin:8px 0"><input type="radio" name="history-reset-scope" value="all" checked> 수동 등록 + Excel 가져오기 모두</label>
        </div>
        <div style="background:var(--green-50,#f0fdf4);border-radius:var(--radius-md);padding:var(--space-3);font-size:var(--text-sm)">
          <div style="font-weight:var(--weight-semibold);margin-bottom:var(--space-2);color:var(--green-700,#15803d)">삭제 제외 (유지)</div>
          <ul style="margin:0;padding-left:var(--space-4);color:var(--gray-700)">
            <li>교육 회차 완료 이력 4종은 삭제되지 않습니다.</li>
            <li>선택한 직원 외 다른 직원 이력은 유지됩니다.</li>
          </ul>
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "전체 초기화",
        variant: "primary",
        onClick: async () => {
          const scope = document.querySelector('input[name="history-reset-scope"]:checked')?.value;
          if (!scope) { toast.warning("삭제 범위를 선택해 주세요."); return; }
          const scopeLabels = { manual: "수동 등록 이력만", excel: "Excel로 가져온 이력만", all: "수동 등록과 Excel 이력 모두" };
          if (!window.confirm(`${emp.name ?? "선택 직원"} (${emp.empNo ?? "–"})\n삭제 범위: ${scopeLabels[scope]}\n\n계속하시겠습니까?`)) return;
          modal.setLoading("전체 초기화", true);
          try {
            const result = await resetSelectedManualTrainingHistories({
              uids: [S.selectedEmployeeId],
              resetAllForUser: true,
              scope,
            });
            const count = result.deletedCount ?? 0;
            if (count > 0) {
              toast.success(
                `${emp.name ?? "선택 직원"}의 ${scopeLabels[scope]} ${count}건을 초기화했습니다. (삭제 전 ${result.beforeCount ?? count}건 → 삭제 후 ${result.afterCount ?? 0}건, DB 경로 ${result.deletedPathsCount ?? 0}개) 회차 완료 ${result.preservedCompletionCount ?? 0}건은 유지되었습니다.`
              );
            } else {
              toast.info(`삭제 대상이 없습니다. (삭제 전 ${result.beforeCount ?? 0}건, 삭제 후 ${result.afterCount ?? 0}건)`);
            }
            modal.close();
            await loadCard(S.selectedEmployeeId);
          } catch (err) {
            console.error("[history-cards] resetAllHistory failed", err);
            toast.error(err?.message || "초기화에 실패했습니다.");
            modal.setLoading("전체 초기화", false);
          }
        },
      },
    ],
  });
}

/* ──────────────────────────────────────────────────────────
   다운로드 (단순 Excel 출력)
────────────────────────────────────────────────────────── */
async function handleDownload() {
  if (!S.selectedEmployee) { toast.warning("먼저 직원을 선택해 주세요."); return; }
  try {
    const result = await exportEmployeeHistoryCard({ employee: S.selectedEmployee, rows: S.rows });
    toast.success(`${result.fileName} 다운로드가 시작되었습니다.`);
  } catch (err) {
    console.error("[history-cards] export failed", err);
    toast.error("이력카드 다운로드 중 오류가 발생했습니다.");
  }
}

/* ──────────────────────────────────────────────────────────
   헬퍼
────────────────────────────────────────────────────────── */
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

function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
