import { toast } from "../utils/toast.js";
import { modal } from "../utils/modal.js";
import { formatDate, formatDateTime } from "../utils/date.js";
import { buildEmployeeHistoryRows, loadTrainingReferences } from "../services/training-service.js";
import {
  exportEmployeeHistoryCard,
  getLatestHistoryCardTemplate,
  listHistoryCardTemplates,
  uploadHistoryCardTemplate,
} from "../services/history-card-export.js";

let historyState = {
  employees: [],
  selectedEmployeeId: "",
  selectedEmployee: null,
  rows: [],
  templates: [],
};

export async function render(container, params = {}) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">직원 교육 이력카드</div>
        <div class="section-subtitle">직원별 교육 이력을 조회하고 양식 기반 다운로드 구조를 관리합니다.</div>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        <button class="btn btn--secondary" id="btn-upload-history-template">양식 업로드</button>
        <button class="btn btn--primary" id="btn-download-history-card">이력카드 다운로드</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card__body card__body--compact">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">직원 검색</label>
            <input class="form-control" id="history-card-search" type="search" placeholder="이름, 사번, 지점으로 검색" />
          </div>
          <div class="form-group">
            <label class="form-label">직원 선택</label>
            <select class="form-control" id="history-card-employee-select">
              <option value="">직원을 선택해 주세요.</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="history-card-layout">
      <div class="card">
        <div class="card__header">
          <div>
            <div class="card__title">직원별 교육 이력</div>
            <div class="card__subtitle">직원 선택 후 최신 수료 이력과 배정 현황을 확인할 수 있습니다.</div>
          </div>
        </div>
        <div class="card__body" id="history-card-body">
          <div class="empty-state" style="padding:var(--space-12)">
            <div class="empty-state__title">직원을 선택해 주세요.</div>
            <div>검색 후 직원 1명을 선택하면 교육 이력카드 미리보기가 표시됩니다.</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <div class="card__title">양식 관리</div>
            <div class="card__subtitle">업로드된 양식 메타와 다운로드 준비 상태</div>
          </div>
        </div>
        <div class="card__body" id="history-template-body"></div>
      </div>
    </div>
  `;

  document.getElementById("btn-upload-history-template")?.addEventListener("click", openTemplateUploadModal);
  document.getElementById("btn-download-history-card")?.addEventListener("click", handleDownloadHistoryCard);
  document.getElementById("history-card-search")?.addEventListener("input", syncEmployeeOptions);
  document.getElementById("history-card-employee-select")?.addEventListener("change", async (event) => {
    historyState.selectedEmployeeId = event.target.value;
    await loadSelectedEmployeeHistory();
  });

  await initializeHistoryCardView(params.uid ?? "");
}

async function initializeHistoryCardView(initialEmployeeId = "") {
  try {
    const [references, templates] = await Promise.all([
      loadTrainingReferences(),
      listHistoryCardTemplates(),
    ]);

    historyState.employees = references.employees;
    historyState.templates = templates;
    historyState.selectedEmployeeId = initialEmployeeId;

    syncEmployeeOptions();
    renderTemplatePanel();

    if (initialEmployeeId) {
      await loadSelectedEmployeeHistory();
    }
  } catch (error) {
    console.error("[history-cards] init failed", error);
    toast.error("직원 교육 이력카드 화면을 불러오지 못했습니다.");
  }
}

function syncEmployeeOptions() {
  const search = String(document.getElementById("history-card-search")?.value ?? "").trim().toLowerCase();
  const select = document.getElementById("history-card-employee-select");
  if (!select) return;

  const filtered = historyState.employees.filter((employee) =>
    !search || [
      employee.name,
      employee.empNo,
      employee.branchName,
      employee.companyName,
    ].some((value) => String(value ?? "").toLowerCase().includes(search))
  );

  select.innerHTML = `
    <option value="">직원을 선택해 주세요.</option>
    ${filtered.map((employee) => {
      const uid = employee.id ?? employee.uid;
      return `<option value="${uid}" ${uid === historyState.selectedEmployeeId ? "selected" : ""}>${escapeHtml(employee.name)} (${escapeHtml(employee.empNo ?? "-")})</option>`;
    }).join("")}
  `;
}

async function loadSelectedEmployeeHistory() {
  const body = document.getElementById("history-card-body");
  if (!body) return;

  if (!historyState.selectedEmployeeId) {
    body.innerHTML = `
      <div class="empty-state" style="padding:var(--space-12)">
        <div class="empty-state__title">직원을 선택해 주세요.</div>
        <div>직원 선택 후 교육 이력카드와 다운로드 정보를 확인할 수 있습니다.</div>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-12)">
      <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
    </div>
  `;

  try {
    const { employee, rows } = await buildEmployeeHistoryRows(historyState.selectedEmployeeId);
    historyState.selectedEmployee = employee;
    historyState.rows = rows;
    renderEmployeeHistory();
  } catch (error) {
    console.error("[history-cards] load employee history failed", error);
    body.innerHTML = `
      <div class="empty-state" style="padding:var(--space-12)">
        <div class="empty-state__title">교육 이력을 불러오지 못했습니다.</div>
        <div>잠시 후 다시 시도해 주세요.</div>
      </div>
    `;
  }
}

function renderEmployeeHistory() {
  const body = document.getElementById("history-card-body");
  if (!body) return;

  const employee = historyState.selectedEmployee;
  const rows = historyState.rows;
  const completedCount = rows.filter((row) => row.completedAt).length;

  body.innerHTML = `
    <div class="dashboard-grid dashboard-grid--compact" style="margin-bottom:var(--space-5)">
      ${statCard("직원명", employee?.name ?? "-", employee?.empNo ?? "-")}
      ${statCard("회사/지점", employee?.companyName ?? "-", employee?.branchName ?? "-")}
      ${statCard("전체 이력", rows.length, "배정 + 수료 기준")}
      ${statCard("수료 완료", completedCount, "전자서명 포함")}
    </div>

    <div class="history-card-summary">
      <div class="info-row"><span class="info-row__label">회사</span><span class="info-row__value">${escapeHtml(employee?.companyName ?? "-")}</span></div>
      <div class="info-row"><span class="info-row__label">지점</span><span class="info-row__value">${escapeHtml(employee?.branchName ?? "-")}</span></div>
      <div class="info-row"><span class="info-row__label">직급</span><span class="info-row__value">${escapeHtml(employee?.position ?? "-")}</span></div>
    </div>

    <div class="table-wrap" style="margin-top:var(--space-4)">
      <table class="data-table">
        <thead>
          <tr>
            <th>직원명</th>
            <th>사번</th>
            <th>회사</th>
            <th>지점</th>
            <th>교육명</th>
            <th>교육유형</th>
            <th>배정일</th>
            <th>완료일시</th>
            <th>서명 여부</th>
            <th>수료 상태</th>
            <th>담당 강사</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.employeeName)}</td>
              <td class="cell--mono">${escapeHtml(row.empNo)}</td>
              <td>${escapeHtml(row.companyName)}</td>
              <td>${escapeHtml(row.branchName)}</td>
              <td>${escapeHtml(row.title)}</td>
              <td>${escapeHtml(row.trainingTypeLabel)}</td>
              <td>${formatDate(row.assignedAt)}</td>
              <td>${formatDateTime(row.completedAt)}</td>
              <td>${row.signedAt ? '<span class="chip chip--success">완료</span>' : '<span class="chip chip--neutral">미완료</span>'}</td>
              <td>${row.completedAt ? '<span class="chip chip--success">수료</span>' : '<span class="chip chip--info">진행중</span>'}</td>
              <td>${escapeHtml(row.instructorName)}</td>
              <td>${escapeHtml(row.note || "-")}</td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="12" style="text-align:center;padding:var(--space-10);color:var(--gray-400)">표시할 교육 이력이 없습니다.</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  `;
}

function renderTemplatePanel() {
  const body = document.getElementById("history-template-body");
  if (!body) return;

  const latest = historyState.templates[0];
  if (!latest) {
    body.innerHTML = `
      <div class="empty-state" style="padding:var(--space-10)">
        <div class="empty-state__title">업로드된 양식이 없습니다.</div>
        <div>개인교육이력카드 양식을 업로드하면 다운로드 구조와 함께 연결됩니다.</div>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="info-row"><span class="info-row__label">파일명</span><span class="info-row__value">${escapeHtml(latest.fileName || "-")}</span></div>
      <div class="info-row"><span class="info-row__label">업로드일</span><span class="info-row__value">${formatDateTime(latest.uploadedAt || latest.createdAt)}</span></div>
      <div class="info-row"><span class="info-row__label">업로드 사용자</span><span class="info-row__value">${escapeHtml(latest.uploadedByName || "-")}</span></div>
      <div class="info-row"><span class="info-row__label">시트 수</span><span class="info-row__value">${latest.sheetNames?.length ?? 0}</span></div>
      <div class="info-row"><span class="info-row__label">병합 셀 수</span><span class="info-row__value">${latest.mergeCount ?? 0}</span></div>
      <div class="info-row"><span class="info-row__label">내보내기 방식</span><span class="info-row__value">양식 유지 + 이력 데이터 시트 추가</span></div>
      <div style="font-size:var(--text-xs);color:var(--gray-400);line-height:var(--leading-relaxed)">
        현재 단계에서는 업로드된 양식의 기본 서식을 최대한 유지하고, 실제 직원 이력 데이터는 별도 데이터 시트에 함께 기록합니다.
        실제 셀 매핑과 서명 이미지 배치는 다음 단계에서 <code>history-card-export.js</code>에서 확장할 수 있습니다.
      </div>
    </div>
  `;
}

function openTemplateUploadModal() {
  modal.open({
    title: "개인교육이력카드 양식 업로드",
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label form-label--required">양식 파일</label>
          <input class="form-control" id="history-template-file" type="file" accept=".xlsx,.xlsm,.xls" />
          <div class="form-hint">업로드한 양식은 메타 정보와 함께 저장되며, 내보내기 시 동일 워크북 구조를 기반으로 사용합니다.</div>
        </div>
      </div>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "업로드",
        variant: "primary",
        onClick: async () => {
          const file = document.getElementById("history-template-file")?.files?.[0];
          if (!file) {
            toast.warning("업로드할 양식 파일을 선택해 주세요.");
            return;
          }

          modal.setLoading("업로드", true);
          try {
            await uploadHistoryCardTemplate(file);
            historyState.templates = await listHistoryCardTemplates();
            renderTemplatePanel();
            toast.success("개인교육이력카드 양식이 업로드되었습니다.");
            modal.close();
          } catch (error) {
            console.error("[history-cards] upload template failed", error);
            toast.error("양식 업로드 중 오류가 발생했습니다.");
            modal.setLoading("업로드", false);
          }
        },
      },
    ],
  });
}

async function handleDownloadHistoryCard() {
  if (!historyState.selectedEmployee) {
    toast.warning("먼저 직원을 선택해 주세요.");
    return;
  }

  try {
    const template = await getLatestHistoryCardTemplate();
    const result = await exportEmployeeHistoryCard({
      employee: historyState.selectedEmployee,
      rows: historyState.rows,
      template,
    });
    toast.success(result.mode === "json-fallback"
      ? "엑셀 라이브러리를 불러오지 못해 JSON 형식으로 다운로드했습니다."
      : "직원 교육 이력카드 다운로드가 시작되었습니다.");
  } catch (error) {
    console.error("[history-cards] export failed", error);
    toast.error("이력카드 다운로드 중 오류가 발생했습니다.");
  }
}

function statCard(label, value, subtitle) {
  return `
    <div class="stat-card">
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value">${escapeHtml(value)}</div>
      <div style="font-size:var(--text-xs);color:var(--gray-400)">${escapeHtml(subtitle)}</div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
