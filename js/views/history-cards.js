import { toast } from "../utils/toast.js";
import { modal } from "../utils/modal.js";
import { formatDate } from "../utils/date.js";
import { buildEmployeeHistoryRows, loadTrainingReferences } from "../services/training-service.js";
import {
  exportEmployeeHistoryCard,
  getLatestHistoryCardTemplate,
  listHistoryCardTemplates,
  uploadHistoryCardTemplate,
} from "../services/history-card-export.js";

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
  if (row.trainingType === "job") return row.subType === "initial" ? "job_initial" : "job_recurring";
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
};

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
          <button class="btn btn--secondary" id="btn-upload-template">양식 업로드</button>
          <button class="btn btn--primary" id="btn-download-card" disabled>이력카드 다운로드</button>
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
  document.getElementById("btn-upload-template")?.addEventListener("click", openUploadModal);
  document.getElementById("btn-download-card")?.addEventListener("click", handleDownload);
  document.getElementById("btn-deselect")?.addEventListener("click", deselectEmployee);
  document.getElementById("hc-search")?.addEventListener("input", onFilter);
  document.getElementById("hc-branch")?.addEventListener("change", onFilter);

  await initView(params.uid ?? "");
}

/* ──────────────────────────────────────────────────────────
   초기화
────────────────────────────────────────────────────────── */
async function initView(initialUid = "") {
  try {
    const [references, templates] = await Promise.all([
      loadTrainingReferences(),
      listHistoryCardTemplates(),
    ]);

    S.employees  = references.employees ?? [];
    S.branches   = references.branches  ?? [];
    S.templates  = templates;

    // 지점 셀렉트 채우기
    const branchSel = document.getElementById("hc-branch");
    if (branchSel) {
      branchSel.innerHTML = `<option value="">전체 지점</option>` +
        S.branches.map((b) => `<option value="${b.id}">${esc(b.name ?? b.code ?? b.id)}</option>`).join("");
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
    toast.error("교육 이력카드 화면을 불러오지 못했습니다.");
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
    const { employee, rows } = await buildEmployeeHistoryRows(uid);
    S.selectedEmployee = employee;
    S.rows = rows;

    if (dlBtn) dlBtn.disabled = false;

    // 선택 배너
    const bannerLabel = document.getElementById("hc-selected-label");
    if (bannerLabel) {
      bannerLabel.textContent = `${employee?.name ?? "–"} (${employee?.empNo ?? "–"}) · ${employee?.branchName ?? "–"} · ${employee?.position ?? "–"}`;
    }

    renderSummary(employee, rows);
    renderProfile(employee);
    renderSections(rows);

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

  const dlBtn = document.getElementById("btn-download-card");
  if (dlBtn) dlBtn.disabled = true;

  renderEmployeeList();
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
  const nextDate      = rows.filter((r) => r.deadline && r.deadline > now).sort((a, b) => a.deadline - b.deadline)[0]?.deadline ?? null;

  el.innerHTML = [
    { label: "총 교육 건수",    value: totalCount,                     sub: "" },
    { label: "수료 건수",       value: completedCnt,                   sub: "PASS" },
    { label: "진행중",          value: inProgressCnt,                  sub: "" },
    { label: "미수료",          value: failCnt,                        sub: "" },
    { label: "최근 교육일",     value: lastDate ? formatDate(lastDate) : "–", sub: "" },
    { label: "다음 교육 예정일", value: nextDate ? formatDate(nextDate) : "–", sub: "" },
  ].map(({ label, value, sub }) => `
    <div class="stat-card">
      <div class="stat-card__label">${esc(label)}</div>
      <div class="stat-card__value">${esc(String(value))}</div>
      ${sub ? `<div style="font-size:var(--text-xs);color:var(--gray-400)">${esc(sub)}</div>` : ""}
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
function renderSections(rows) {
  const el = document.getElementById("hc-sections");
  if (!el) return;

  const sectionMap = {};
  for (const row of rows) {
    const key = getSectionKey(row);
    if (!sectionMap[key]) sectionMap[key] = [];
    sectionMap[key].push(row);
  }

  el.innerHTML = SECTION_ORDER.map((key) => {
    const sRows = sectionMap[key] ?? [];
    return `
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card__header" style="background:var(--gray-50);border-bottom:1px solid var(--gray-200)">
          <div class="card__title" style="font-size:var(--text-sm)">
            ${esc(SECTION_LABELS[key])}
            <span class="chip chip--info" style="margin-left:var(--space-2)">${sRows.length}건</span>
          </div>
        </div>
        <div class="card__body" style="padding:0">
          ${sRows.length === 0
            ? `<div style="padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">이력 없음</div>`
            : `<div class="table-wrap">
                <table class="hc-section-table">
                  <thead>
                    <tr>
                      <th>교육과정명</th>
                      <th>교육과목</th>
                      <th>강사</th>
                      <th>교육시간</th>
                      <th>교육기간</th>
                      <th>수료일</th>
                      <th>결과</th>
                      <th>초기/보수</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${sRows.map((row) => historyRow(row)).join("")}
                  </tbody>
                </table>
              </div>`
          }
        </div>
      </div>`;
  }).join("");
}

function historyRow(row) {
  const period = (row.startDate && row.endDate)
    ? `${formatDate(row.startDate)} ~ ${formatDate(row.endDate)}`
    : (row.startDate ? formatDate(row.startDate) : "–");
  const result  = row.completionStatus === "completed" ? "PASS" : "–";
  const subType = row.trainingType === "job" ? (row.subType === "initial" ? "초기" : "보수") : "–";

  return `
    <tr>
      <td>${esc(row.title)}</td>
      <td>–</td>
      <td>${esc(row.instructorName)}</td>
      <td>–</td>
      <td style="white-space:nowrap">${period}</td>
      <td style="white-space:nowrap">${row.completedAt ? formatDate(row.completedAt) : "–"}</td>
      <td>${result}</td>
      <td>${subType}</td>
      <td>${esc(row.note || "–")}</td>
    </tr>`;
}

/* ──────────────────────────────────────────────────────────
   양식 업로드
────────────────────────────────────────────────────────── */
function openUploadModal() {
  modal.open({
    title: "교육이력카드 양식 업로드",
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="background:var(--blue-50,#eff6ff);border:1px solid var(--blue-200,#bfdbfe);border-radius:var(--radius-md);padding:var(--space-4);font-size:var(--text-sm);color:var(--blue-800,#1e40af)">
          <strong>안내</strong><br/>
          회사에서 사용 중인 교육이력카드 엑셀 양식(.xlsx)을 업로드하세요.<br/>
          원본 서식(병합셀·글꼴·테두리·색상·행높이·열너비)을 그대로 유지하고 데이터만 채워 넣습니다.
        </div>
        <div class="form-group">
          <label class="form-label form-label--required">양식 파일 (.xlsx)</label>
          <input class="form-control" id="hc-template-file" type="file" accept=".xlsx,.xlsm,.xls" />
          <div class="form-hint">병합 셀, 인쇄 설정이 포함된 원본 양식을 올려주세요.</div>
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "업로드",
        variant: "primary",
        onClick: async () => {
          const file = document.getElementById("hc-template-file")?.files?.[0];
          if (!file) { toast.warning("양식 파일을 선택해 주세요."); return; }
          modal.setLoading("업로드", true);
          try {
            await uploadHistoryCardTemplate(file);
            S.templates = await listHistoryCardTemplates();
            toast.success("교육이력카드 양식이 업로드되었습니다.");
            modal.close();
          } catch (err) {
            console.error("[history-cards] upload failed", err);
            toast.error("양식 업로드 중 오류가 발생했습니다.");
            modal.setLoading("업로드", false);
          }
        },
      },
    ],
  });
}

/* ──────────────────────────────────────────────────────────
   다운로드
────────────────────────────────────────────────────────── */
async function handleDownload() {
  if (!S.selectedEmployee) { toast.warning("먼저 직원을 선택해 주세요."); return; }

  const template = await getLatestHistoryCardTemplate().catch(() => null);
  if (!template) {
    toast.warning("업로드된 양식이 없습니다. 먼저 교육이력카드 양식을 업로드해 주세요.");
    return;
  }

  try {
    const result = await exportEmployeeHistoryCard({ employee: S.selectedEmployee, rows: S.rows, template });
    toast.success(result.mode === "json-fallback"
      ? "라이브러리를 불러오지 못해 JSON 형식으로 다운로드했습니다."
      : `${result.fileName} 다운로드가 시작되었습니다.`);
  } catch (err) {
    console.error("[history-cards] export failed", err);
    toast.error("이력카드 다운로드 중 오류가 발생했습니다.");
  }
}

/* ──────────────────────────────────────────────────────────
   헬퍼
────────────────────────────────────────────────────────── */
function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
