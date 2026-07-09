import { router } from "../core/router.js";
import { loadTrainingReferences } from "../services/training-service.js";

let viewState = {
  company: null,
  branches: [],
  employees: [],
};

export async function render(container) {
  const references = await loadTrainingReferences();

  viewState = {
    company: references.company ?? null,
    branches: [...(references.branches ?? [])].sort((a, b) =>
      String(a.name ?? a.code ?? "").localeCompare(String(b.name ?? b.code ?? ""), "ko")
    ),
    employees: [...(references.employees ?? [])].sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko")
    ),
  };

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">직원 조회</div>
        <div class="section-subtitle">교육 배정 대상 직원과 기본 소속 정보를 조회합니다.</div>
      </div>
      <button class="btn btn--secondary" id="btn-open-history-cards">직원 교육 이력카드</button>
    </div>

    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card__body card__body--compact">
        <div class="filter-bar" style="display:flex;gap:var(--space-3);flex-wrap:wrap">
          <div class="input-group filter-bar__search" style="flex:2;min-width:220px">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input class="form-control" id="employee-search" type="search" placeholder="이름, 사번, 지점으로 검색" />
          </div>
          <select class="form-control" id="employee-branch-filter" style="flex:1;min-width:180px">
            <option value="">전체 지점</option>
            ${viewState.branches.map((branch) => `
              <option value="${branch.id}">${escapeHtml(branch.name ?? branch.code ?? branch.id)}</option>
            `).join("")}
          </select>
        </div>
        <div id="employee-summary" style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--gray-500)"></div>
      </div>
    </div>

    <div class="table-wrap" id="employee-table-wrap"></div>
  `;

  document.getElementById("btn-open-history-cards")?.addEventListener("click", () => {
    router.push("history-cards");
  });
  document.getElementById("employee-search")?.addEventListener("input", () => renderTable(container));
  document.getElementById("employee-branch-filter")?.addEventListener("change", () => renderTable(container));

  renderTable(container);
}

function renderTable(container) {
  const wrap = container.querySelector("#employee-table-wrap");
  if (!wrap) return;

  const search = String(document.getElementById("employee-search")?.value ?? "").trim().toLowerCase();
  const branchId = document.getElementById("employee-branch-filter")?.value ?? "";
  const branch = viewState.branches.find((item) => item.id === branchId) ?? null;

  const filtered = viewState.employees.filter((employee) => {
    if (branch && !matchesSelectedBranch(employee, branch)) return false;
    if (!search) return true;

    const haystack = [
      employee.name,
      employee.empNo,
      employee.companyName,
      employee.branchName,
      employee.branchCode,
      employee.position,
    ].join(" ").toLowerCase();

    return haystack.includes(search);
  });

  const summary = document.getElementById("employee-summary");
  if (summary) {
    const companyName = viewState.company?.name ? `${viewState.company.name} · ` : "";
    summary.textContent = `${companyName}조회 결과 ${filtered.length}명`;
  }

  if (!filtered.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">조건에 맞는 직원이 없습니다.</div>
        <div>검색어 또는 지점 필터를 확인해 주세요.</div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>이름</th>
          <th>사번</th>
          <th>회사</th>
          <th>지점</th>
          <th>직급</th>
          <th style="width:180px"></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((employee) => {
          const uid = employee.id ?? employee.uid;
          return `
            <tr>
              <td>${escapeHtml(employee.name ?? "-")}</td>
              <td class="cell--mono">${escapeHtml(employee.empNo ?? "-")}</td>
              <td>${escapeHtml(employee.companyName ?? "-")}</td>
              <td>${escapeHtml(employee.branchName ?? employee.branchCode ?? "-")}</td>
              <td>${escapeHtml(employee.position ?? "-")}</td>
              <td class="cell--actions">
                <div style="display:flex;gap:var(--space-2);justify-content:flex-end">
                  <button class="btn btn--ghost btn--sm btn-employee-history" data-uid="${uid}">이력카드</button>
                  <button class="btn btn--ghost btn--sm btn-employee-detail" data-uid="${uid}">상세</button>
                </div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll(".btn-employee-history").forEach((button) => {
    button.addEventListener("click", () => router.push("history-cards", { uid: button.dataset.uid }));
  });

  wrap.querySelectorAll(".btn-employee-detail").forEach((button) => {
    button.addEventListener("click", () => router.push("employee-detail", { uid: button.dataset.uid }));
  });
}

function matchesSelectedBranch(employee, branch) {
  const branchCandidates = [branch.id, branch.code, branch.name]
    .map((value) => normalizeKey(value))
    .filter(Boolean);

  return [employee.branchId, employee.branchCode, employee.branchName]
    .map((value) => normalizeKey(value))
    .some((value) => value && branchCandidates.includes(value));
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
