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
   교육유형 → 이력카드 섹션 매핑
   직무교육(job) → 직무초기교육 / 직무보수교육 (subType으로 분기)
   법정(legal) / 온라인(online) / 외부(external) / 기타(other)
────────────────────────────────────────────────────────── */
const SECTION_ORDER = [
  "job_initial",
  "job_recurring",
  "legal",
  "online",
  "external",
  "other",
];

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
  return row.trainingType; // legal / online / external / other
}

/* ──────────────────────────────────────────────────────────
   State
────────────────────────────────────────────────────────── */
let historyState = {
  employees: [],
  selectedEmployeeId: "",
  selectedEmployee: null,
  rows: [],
  templates: [],
};

/* ──────────────────────────────────────────────────────────
   render
────────────────────────────────────────────────────────── */
export async function render(container, params = {}) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">직원 교육 이력카드</div>
        <div class="section-subtitle">직원별 교육 이력을 조회하고 엑셀 양식으로 다운로드합니다.</div>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        <button class="btn btn--secondary" id="btn-upload-history-template">양식 업로드</button>
        <button class="btn btn--primary" id="btn-download-history-card" disabled>이력카드 다운로드</button>
      </div>
    </div>

    <!-- 직원 검색/선택 -->
    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card__body card__body--compact">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">직원 검색</label>
            <input class="form-control" id="hc-search" type="search" placeholder="이름, 사번, 지점으로 검색" />
          </div>
          <div class="form-group">
            <label class="form-label">직원 선택</label>
            <select class="form-control" id="hc-employee-select">
              <option value="">직원을 선택해 주세요.</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- 이력카드 본문 -->
    <div id="hc-body">
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">직원을 선택해 주세요.</div>
        <div>검색 후 직원을 선택하면 교육 이력카드가 표시됩니다.</div>
      </div>
    </div>
  `;

  document.getElementById("btn-upload-history-template")?.addEventListener("click", openTemplateUploadModal);
  document.getElementById("btn-download-history-card")?.addEventListener("click", handleDownload);
  document.getElementById("hc-search")?.addEventListener("input", syncEmployeeOptions);
  document.getElementById("hc-employee-select")?.addEventListener("change", async (e) => {
    historyState.selectedEmployeeId = e.target.value;
    await loadEmployeeHistory();
  });

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
    historyState.employees  = references.employees;
    historyState.templates  = templates;
    historyState.selectedEmployeeId = initialUid;
    syncEmployeeOptions();
    if (initialUid) await loadEmployeeHistory();
  } catch (err) {
    console.error("[history-cards] init failed", err);
    toast.error("교육 이력카드 화면을 불러오지 못했습니다.");
  }
}

function syncEmployeeOptions() {
  const search  = String(document.getElementById("hc-search")?.value ?? "").trim().toLowerCase();
  const select  = document.getElementById("hc-employee-select");
  if (!select) return;

  const filtered = historyState.employees.filter((emp) =>
    !search || [emp.name, emp.empNo, emp.branchName, emp.companyName]
      .some((v) => String(v ?? "").toLowerCase().includes(search))
  );

  select.innerHTML = `
    <option value="">직원을 선택해 주세요.</option>
    ${filtered.map((emp) => {
      const uid = emp.id ?? emp.uid;
      return `<option value="${uid}" ${uid === historyState.selectedEmployeeId ? "selected" : ""}>${esc(emp.name)} (${esc(emp.empNo ?? "-")})</option>`;
    }).join("")}
  `;
}

async function loadEmployeeHistory() {
  const body = document.getElementById("hc-body");
  const dlBtn = document.getElementById("btn-download-history-card");
  if (!body) return;

  if (!historyState.selectedEmployeeId) {
    historyState.selectedEmployee = null;
    historyState.rows = [];
    if (dlBtn) dlBtn.disabled = true;
    body.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">직원을 선택해 주세요.</div>
      </div>`;
    return;
  }

  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-16)">
      <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
    </div>`;

  try {
    const { employee, rows } = await buildEmployeeHistoryRows(historyState.selectedEmployeeId);
    historyState.selectedEmployee = employee;
    historyState.rows = rows;
    if (dlBtn) dlBtn.disabled = false;
    renderHistoryCard();
  } catch (err) {
    console.error("[history-cards] load failed", err);
    body.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">교육 이력을 불러오지 못했습니다.</div>
      </div>`;
  }
}

/* ──────────────────────────────────────────────────────────
   웹 화면 렌더링
────────────────────────────────────────────────────────── */
function renderHistoryCard() {
  const body = document.getElementById("hc-body");
  if (!body) return;

  const emp  = historyState.selectedEmployee;
  const rows = historyState.rows;
  const now  = Date.now();

  // ── 요약 통계
  const totalCount     = rows.length;
  const completedCount = rows.filter((r) => r.completionStatus === "completed").length;
  const inProgressCount= rows.filter((r) => r.completionStatus !== "completed" && (!r.deadline || r.deadline >= now)).length;
  const failCount      = rows.filter((r) => r.completionStatus !== "completed" && r.deadline && r.deadline < now).length;
  const lastDate       = rows.filter((r) => r.completedAt).sort((a, b) => b.completedAt - a.completedAt)[0]?.completedAt ?? null;
  const nextDate       = rows.filter((r) => r.deadline && r.deadline > now).sort((a, b) => a.deadline - b.deadline)[0]?.deadline ?? null;

  // ── 섹션 분류
  const sections = {};
  for (const row of rows) {
    const key = getSectionKey(row);
    if (!sections[key]) sections[key] = [];
    sections[key].push(row);
  }

  body.innerHTML = `
    <!-- 요약 카드 (웹 전용) -->
    <div class="dashboard-grid dashboard-grid--compact" style="margin-bottom:var(--space-5)">
      ${summaryCard("총 교육 건수", totalCount, "")}
      ${summaryCard("수료 건수", completedCount, "PASS")}
      ${summaryCard("진행중", inProgressCount, "")}
      ${summaryCard("미수료", failCount, "")}
      ${summaryCard("최근 교육일", lastDate ? formatDate(lastDate) : "–", "")}
      ${summaryCard("다음 교육 예정일", nextDate ? formatDate(nextDate) : "–", "")}
    </div>

    <!-- 인적사항 카드 -->
    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card__header">
        <div class="card__title">인적사항</div>
      </div>
      <div class="card__body">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-3)">
          ${infoItem("성명",     emp?.name ?? "–")}
          ${infoItem("사번",     emp?.empNo ?? "–")}
          ${infoItem("생년월일", emp?.birthDate ? formatDate(emp.birthDate) : "–")}
          ${infoItem("입사일",   emp?.joinDate  ? formatDate(emp.joinDate)  : "–")}
          ${infoItem("신입/경력", emp?.entryType ?? "–")}
          ${infoItem("사내 자격", emp?.internalLicense ?? "–")}
          ${infoItem("사외 자격", emp?.externalLicense ?? "–")}
          ${infoItem("지점",     emp?.branchName ?? "–")}
          ${infoItem("직책",     emp?.position ?? "–")}
        </div>
      </div>
    </div>

    <!-- 교육유형별 섹션 -->
    ${SECTION_ORDER.map((key) => {
      const sectionRows = sections[key] ?? [];
      return `
        <div class="card" style="margin-bottom:var(--space-4)">
          <div class="card__header" style="background:var(--gray-50);border-bottom:1px solid var(--gray-200)">
            <div class="card__title" style="font-size:var(--text-sm)">
              ${esc(SECTION_LABELS[key])}
              <span class="chip chip--info" style="margin-left:var(--space-2)">${sectionRows.length}건</span>
            </div>
          </div>
          <div class="card__body" style="padding:0">
            ${sectionRows.length === 0
              ? `<div style="padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">이력 없음</div>`
              : `<div class="table-wrap">
                  <table class="data-table" style="font-size:var(--text-xs)">
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
                      ${sectionRows.map((row) => historyRow(row)).join("")}
                    </tbody>
                  </table>
                </div>`
            }
          </div>
        </div>
      `;
    }).join("")}
  `;
}

function historyRow(row) {
  const period = (row.startDate && row.endDate)
    ? `${formatDate(row.startDate)} ~ ${formatDate(row.endDate)}`
    : (row.startDate ? formatDate(row.startDate) : "–");

  const result = row.completionStatus === "completed" ? "PASS" : "–";
  const subType = row.trainingType === "job"
    ? (row.subType === "initial" ? "초기" : "보수")
    : "–";

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
    </tr>
  `;
}

/* ──────────────────────────────────────────────────────────
   양식 업로드 모달
────────────────────────────────────────────────────────── */
function openTemplateUploadModal() {
  modal.open({
    title: "교육이력카드 양식 업로드",
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="background:var(--blue-50,#eff6ff);border:1px solid var(--blue-200,#bfdbfe);border-radius:var(--radius-md);padding:var(--space-4);font-size:var(--text-sm);color:var(--blue-800,#1e40af)">
          <strong>안내</strong><br/>
          회사에서 사용 중인 교육이력카드 엑셀 양식(.xlsx)을 업로드하세요.<br/>
          원본 서식(병합셀·글꼴·테두리·색상·행높이·열너비)을 그대로 유지하고 셀 매핑 후 직원 데이터를 채워 넣습니다.
        </div>
        <div class="form-group">
          <label class="form-label form-label--required">양식 파일 (.xlsx)</label>
          <input class="form-control" id="hc-template-file" type="file" accept=".xlsx,.xlsm,.xls" />
          <div class="form-hint">병합 셀, 인쇄 설정이 포함된 원본 양식을 올려주세요.</div>
        </div>
      </div>
    `,
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
            historyState.templates = await listHistoryCardTemplates();
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
  if (!historyState.selectedEmployee) {
    toast.warning("먼저 직원을 선택해 주세요.");
    return;
  }

  const template = await getLatestHistoryCardTemplate().catch(() => null);

  if (!template) {
    toast.warning("업로드된 양식이 없습니다. 먼저 교육이력카드 양식을 업로드해 주세요.");
    return;
  }

  try {
    const result = await exportEmployeeHistoryCard({
      employee: historyState.selectedEmployee,
      rows: historyState.rows,
      template,
    });
    toast.success(
      result.mode === "json-fallback"
        ? "라이브러리를 불러오지 못해 JSON 형식으로 다운로드했습니다."
        : `${result.fileName} 다운로드가 시작되었습니다.`
    );
  } catch (err) {
    console.error("[history-cards] export failed", err);
    toast.error("이력카드 다운로드 중 오류가 발생했습니다.");
  }
}

/* ──────────────────────────────────────────────────────────
   UI 헬퍼
────────────────────────────────────────────────────────── */
function summaryCard(label, value, sub) {
  return `
    <div class="stat-card">
      <div class="stat-card__label">${esc(label)}</div>
      <div class="stat-card__value">${esc(String(value))}</div>
      ${sub ? `<div style="font-size:var(--text-xs);color:var(--gray-400)">${esc(sub)}</div>` : ""}
    </div>
  `;
}

function infoItem(label, value) {
  return `
    <div style="display:flex;flex-direction:column;gap:2px">
      <div style="font-size:var(--text-xs);color:var(--gray-400)">${esc(label)}</div>
      <div style="font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--gray-800)">${esc(value)}</div>
    </div>
  `;
}

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
