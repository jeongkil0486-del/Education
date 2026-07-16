import { formatDate, formatDateTime } from "../utils/date.js";
import { buildEmployeeHistoryRows } from "../services/training-service.js";

export async function render(container, params = {}) {
  if (!params.uid) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">직원 정보가 없습니다.</div>
        <div>직원 조회 화면에서 다시 선택해 주세요.</div>
      </div>
    `;
    return;
  }

  const { employee, rows } = await buildEmployeeHistoryRows(params.uid);

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">${escapeHtml(employee?.name ?? "직원 상세")}</div>
        <div class="section-subtitle">${escapeHtml(employee?.empNo ?? "-")} · ${escapeHtml(employee?.companyName ?? "-")} · ${escapeHtml(employee?.branchName ?? "-")}</div>
      </div>
    </div>

    <div class="dashboard-grid dashboard-grid--compact">
      ${statCard("직급", employee?.position ?? "-", "현재 등록 기준")}
      ${statCard("총 이력", rows.length, "배정/수료 합산")}
      ${statCard("수료 건수", rows.filter((row) => row.completedAt).length, "완료 처리 포함")}
      ${statCard("최근 완료", rows[0]?.completedAt ? formatDate(rows[0].completedAt) : "-", "가장 최신 기록")}
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>교육명</th>
            <th>유형</th>
            <th>배정일</th>
            <th>완료일시</th>
            <th>서명 여부</th>
            <th>담당 강사</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.title)}</td>
              <td>${escapeHtml(row.trainingTypeLabel)}</td>
              <td>${formatDate(row.assignedAt)}</td>
              <td>${formatDateTime(row.completedAt)}</td>
              <td>${row.signedAt ? "완료" : "미완료"}</td>
              <td>${escapeHtml(row.instructorName)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
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
