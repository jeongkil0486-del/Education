import { authStore } from "../core/auth.js";
import { toast } from "../utils/toast.js";
import { formatDate, formatDateTime } from "../utils/date.js";
import { completeAssignedTraining, getCurrentUserAssignments } from "../services/training-service.js";

export async function render(container) {
  const assignments = await getCurrentUserAssignments();
  const canComplete = authStore.isEmployee();

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">내 교육</div>
        <div class="section-subtitle">나에게 배정된 교육과 수료 상태를 확인합니다.</div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>교육명</th>
            <th>수료기한</th>
            <th>배정일</th>
            <th>완료일시</th>
            <th>상태</th>
            <th style="width:140px"></th>
          </tr>
        </thead>
        <tbody>
          ${assignments.length ? assignments.map((assignment) => `
            <tr>
              <td>${escapeHtml(assignment.trainingTitle ?? "-")}</td>
              <td>${formatDate(assignment.deadline)}</td>
              <td>${formatDateTime(assignment.assignedAt)}</td>
              <td>${formatDateTime(assignment.completion?.completedAt)}</td>
              <td>${assignment.completion?.completedAt ? '<span class="chip chip--success">수료 완료</span>' : '<span class="chip chip--info">진행중</span>'}</td>
              <td class="cell--actions">
                ${assignment.completion?.completedAt
                  ? '<span style="font-size:var(--text-xs);color:var(--gray-400)">서명 완료</span>'
                  : canComplete
                    ? `<button class="btn btn--primary btn--sm btn-complete-training" data-id="${assignment.trainingId}" data-title="${escapeAttr(assignment.trainingTitle ?? "교육")}">완료 처리</button>`
                    : '<span style="font-size:var(--text-xs);color:var(--gray-400)">조회 전용</span>'}
              </td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="6" style="text-align:center;padding:var(--space-12);color:var(--gray-400)">배정된 교육이 없습니다.</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll(".btn-complete-training").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await completeAssignedTraining(button.dataset.id, button.dataset.title);
        toast.success("교육 완료와 전자서명 완료 시점이 기록되었습니다.");
        await render(container);
      } catch (error) {
        console.error("[my-trainings] complete failed", error);
        toast.error("교육 완료 처리 중 오류가 발생했습니다.");
      }
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
