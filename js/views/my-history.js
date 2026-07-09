import { formatDate, formatDateTime } from "../utils/date.js";
import { getCurrentUserHistory } from "../services/training-service.js";

export async function render(container) {
  const history = await getCurrentUserHistory();

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">교육 이력</div>
        <div class="section-subtitle">완료된 교육과 전자서명 이력을 확인합니다.</div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>교육명</th>
            <th>완료일시</th>
            <th>서명일시</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          ${history.length ? history.map((row) => `
            <tr>
              <td>${escapeHtml(row.trainingTitle || row.trainingId)}</td>
              <td>${formatDateTime(row.completedAt)}</td>
              <td>${formatDateTime(row.signedAt)}</td>
              <td>${row.status === "completed" ? '<span class="chip chip--success">수료 완료</span>' : '<span class="chip chip--neutral">대기</span>'}</td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="4" style="text-align:center;padding:var(--space-12);color:var(--gray-400)">완료된 교육 이력이 없습니다.</td>
            </tr>
          `}
        </tbody>
      </table>
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
