import { formatDate } from "../utils/date.js";
import { getCurrentUserHistory, getTrainingTypeLabel } from "../services/training-service.js";

export async function render(container) {
  const history = await getCurrentUserHistory();
  container.innerHTML = `
    <div class="section-header"><div><div class="section-title">교육 이력</div><div class="section-subtitle">개인 수료 이력과 재교육 예정일을 확인합니다.</div></div></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>교육유형</th><th>교육과정</th><th>세부분류</th><th>수료일</th><th>다음 예정일</th><th>남은 일수</th><th>상태</th></tr></thead><tbody>
      ${history.length ? history.map((row) => `<tr><td>${escapeHtml(getTrainingTypeLabel(row.trainingType))}</td><td>${escapeHtml(row.courseName || row.title || "-")}</td><td>${escapeHtml(row.subjectName || "-")}</td><td>${row.completedAt ? formatDate(row.completedAt) : "-"}</td><td>${row.nextDueDate ? formatDate(row.nextDueDate) : "-"}</td><td>${row.daysRemaining == null ? "-" : row.daysRemaining < 0 ? `${Math.abs(row.daysRemaining)}일 초과` : `${row.daysRemaining}일`}</td><td>${escapeHtml(row.dueStatusLabel || "-")}</td></tr>`).join("") : `<tr><td colspan="7" style="text-align:center;padding:var(--space-12);color:var(--gray-400)">완료된 교육 이력이 없습니다.</td></tr>`}
    </tbody></table></div>`;
}
function escapeHtml(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
