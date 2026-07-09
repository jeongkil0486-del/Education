import { router } from "../core/router.js";
import { loadTrainingReferences } from "../services/training-service.js";

export async function render(container) {
  const references = await loadTrainingReferences();
  const employees = references.employees;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">직원 조회</div>
        <div class="section-subtitle">교육 배정 대상 직원과 기본 소속 정보를 조회합니다.</div>
      </div>
      <button class="btn btn--secondary" id="btn-open-history-cards">직원 교육 이력카드</button>
    </div>

    <div class="table-wrap">
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
          ${employees.map((employee) => {
            const uid = employee.id ?? employee.uid;
            return `
              <tr>
                <td>${escapeHtml(employee.name ?? "-")}</td>
                <td class="cell--mono">${escapeHtml(employee.empNo ?? "-")}</td>
                <td>${escapeHtml(employee.companyName ?? "-")}</td>
                <td>${escapeHtml(employee.branchName ?? "-")}</td>
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
    </div>
  `;

  document.getElementById("btn-open-history-cards")?.addEventListener("click", () => {
    router.push("history-cards");
  });

  container.querySelectorAll(".btn-employee-history").forEach((button) => {
    button.addEventListener("click", () => router.push("history-cards", { uid: button.dataset.uid }));
  });

  container.querySelectorAll(".btn-employee-detail").forEach((button) => {
    button.addEventListener("click", () => router.push("employee-detail", { uid: button.dataset.uid }));
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
