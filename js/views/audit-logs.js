import { authStore, ROLES } from "../core/auth.js";
import { listAuditLogs } from "../core/admin-api.js";
import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";

const ACTION_LABELS = {
  RESET_EMPLOYEE_HISTORY: "개인이력 초기화",
  RESET_EMPLOYEE_LEDGER: "직원관리대장 초기화",
  CREATE_TRAINING_HISTORY: "교육이력 추가",
  UPDATE_TRAINING_HISTORY: "교육이력 수정",
  DELETE_TRAINING_HISTORY: "교육이력 삭제",
  UPDATE_EMPLOYEE_PROFILE: "직원 인적사항 수정",
  IMPORT_EMPLOYEE_LEDGER: "직원관리대장 업로드",
  RESET_ACCOUNT_PASSWORD: "계정 비밀번호 초기화",
  COMPLETE_REQUIRED_PASSWORD_CHANGE: "초기화 비밀번호 변경 완료",
};

const FIELD_LABELS = {
  name: "성명", empNo: "사번", birthDate: "생년월일", hireDate: "입사일", joinDate: "입사일",
  employmentDate: "입사일", entryType: "신입/경력", internalLicense: "사내자격", externalLicense: "외부자격",
  position: "직책", jobTitle: "직무", branchId: "지점 ID", branchName: "지점", departmentName: "부서",
  departmentId: "부서 ID", rank: "직급", note: "비고", courseName: "과정명", subjectName: "교육항목",
  trainingType: "교육유형", subType: "초기/보수", completedAt: "수료일", startDate: "시작일", endDate: "종료일",
  instructorName: "강사", hours: "교육시간", result: "결과", dates: "교육일",
};

let state = { logs: [], nextCursor: null, loading: false };

export async function render(container) {
  if (authStore.role !== ROLES.HQ_ADMIN) {
    container.innerHTML = '<div class="empty-state" style="padding:var(--space-16)"><div class="empty-state__title">접근 권한이 없습니다.</div></div>';
    return;
  }

  state = { logs: [], nextCursor: null, loading: false };
  container.innerHTML = `
    <div class="section-header">
      <div><div class="section-title">감사 로그</div><div class="section-subtitle">주요 직원·교육이력 변경 작업을 최신순으로 확인합니다.</div></div>
    </div>
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card__body card__body--compact">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3);align-items:end">
          <div class="form-group" style="margin:0"><label class="form-label">시작일</label><input class="form-control" id="audit-from" type="date"></div>
          <div class="form-group" style="margin:0"><label class="form-label">종료일</label><input class="form-control" id="audit-to" type="date"></div>
          <div class="form-group" style="margin:0"><label class="form-label">작업 유형</label><select class="form-control" id="audit-action"><option value="">전체</option>${Object.entries(ACTION_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>
          <div class="form-group" style="margin:0"><label class="form-label">작업자</label><input class="form-control" id="audit-actor" placeholder="작업자 이름"></div>
          <div class="form-group" style="margin:0"><label class="form-label">대상</label><input class="form-control" id="audit-target" placeholder="직원명 또는 사번"></div>
          <div class="form-group" style="margin:0"><label class="form-label">지점</label><select class="form-control" id="audit-branch"><option value="">전체</option></select></div>
          <div class="form-group" style="margin:0"><label class="form-label">상태</label><select class="form-control" id="audit-status"><option value="">전체</option><option value="SUCCESS">성공</option><option value="PARTIAL_SUCCESS">부분 성공</option><option value="FAILED">실패</option></select></div>
          <button class="btn btn--primary" id="audit-search">조회</button>
        </div>
      </div>
    </div>
    <div class="card"><div class="card__body" style="padding:0"><div id="audit-results"><div class="empty-state" style="padding:var(--space-12)">감사 로그를 불러오는 중입니다.</div></div></div></div>
    <div style="display:flex;justify-content:center;margin-top:var(--space-4)"><button class="btn btn--secondary" id="audit-more" style="display:none">더보기</button></div>`;

  document.getElementById("audit-search")?.addEventListener("click", () => loadLogs(false));
  document.getElementById("audit-more")?.addEventListener("click", () => loadLogs(true));
  await loadLogs(false);
}

function filters() {
  const fromValue = document.getElementById("audit-from")?.value;
  const toValue = document.getElementById("audit-to")?.value;
  return {
    limit: 100,
    from: fromValue ? new Date(`${fromValue}T00:00:00`).getTime() : null,
    to: toValue ? new Date(`${toValue}T23:59:59.999`).getTime() : null,
    action: document.getElementById("audit-action")?.value ?? "",
    actorName: document.getElementById("audit-actor")?.value?.trim() ?? "",
    targetQuery: document.getElementById("audit-target")?.value?.trim() ?? "",
    branchId: document.getElementById("audit-branch")?.value ?? "",
    status: document.getElementById("audit-status")?.value ?? "",
  };
}

async function loadLogs(append) {
  if (state.loading) return;
  state.loading = true;
  const searchButton = document.getElementById("audit-search");
  const moreButton = document.getElementById("audit-more");
  if (searchButton) searchButton.disabled = true;
  if (moreButton) moreButton.disabled = true;
  try {
    const result = await listAuditLogs({
      ...filters(),
      beforeCreatedAt: append ? state.nextCursor : null,
    });
    state.logs = append ? [...state.logs, ...(result.logs ?? [])] : (result.logs ?? []);
    state.nextCursor = result.nextCursor ?? null;
    renderBranchOptions();
    renderTable();
  } catch (error) {
    console.error("[audit-logs] load failed", error);
    if (!append) document.getElementById("audit-results").innerHTML = '<div class="empty-state" style="padding:var(--space-12)"><div class="empty-state__title">감사 로그를 불러오지 못했습니다.</div></div>';
    toast.error(error?.message ?? "감사 로그 조회에 실패했습니다.");
  } finally {
    state.loading = false;
    if (searchButton) searchButton.disabled = false;
    if (moreButton) {
      moreButton.disabled = false;
      moreButton.style.display = state.nextCursor ? "inline-flex" : "none";
    }
  }
}

function renderBranchOptions() {
  const select = document.getElementById("audit-branch");
  if (!select) return;
  const selected = select.value;
  const branches = new Map();
  for (const log of state.logs) {
    if (log.actorBranchId) branches.set(log.actorBranchId, log.actorBranchName || log.actorBranchId);
    if (log.targetBranchId) branches.set(log.targetBranchId, log.targetBranchName || log.targetBranchId);
  }
  select.innerHTML = `<option value="">전체</option>${[...branches.entries()].sort((a, b) => a[1].localeCompare(b[1], "ko")).map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join("")}`;
  if ([...branches.keys()].includes(selected)) select.value = selected;
}

function renderTable() {
  const target = document.getElementById("audit-results");
  if (!target) return;
  if (!state.logs.length) {
    target.innerHTML = '<div class="empty-state" style="padding:var(--space-12)">조회된 감사 로그가 없습니다.</div>';
    return;
  }
  target.innerHTML = `<div style="overflow-x:auto"><table class="data-table" style="min-width:1320px"><thead><tr>
    <th>일시</th><th>작업자</th><th>역할</th><th>작업자 지점</th><th>작업 유형</th><th>대상</th><th>대상 사번</th><th>대상 지점</th><th>작업 내용</th><th>상태</th><th>상세</th>
  </tr></thead><tbody>${state.logs.map((log) => `<tr>
    <td style="white-space:nowrap">${esc(formatDateTime(log.createdAt))}</td>
    <td>${esc(log.actorName || "-")}</td><td>${esc(roleLabel(log.actorRole))}</td><td>${esc(log.actorBranchName || log.actorBranchId || "-")}</td>
    <td>${esc(ACTION_LABELS[log.action] || log.action || "-")}</td><td>${esc(log.targetName || targetTypeLabel(log.targetType))}</td>
    <td>${esc(log.targetEmpNo || "-")}</td><td>${esc(log.targetBranchName || log.targetBranchId || "-")}</td>
    <td style="max-width:320px">${esc(log.summary || "-")}</td><td>${statusChip(log.status)}</td>
    <td><button class="btn btn--ghost btn--sm" data-audit-detail="${esc(log.id)}">상세</button></td>
  </tr>`).join("")}</tbody></table></div>`;
  target.querySelectorAll("[data-audit-detail]").forEach((button) => button.addEventListener("click", () => {
    const log = state.logs.find((item) => item.id === button.dataset.auditDetail);
    if (log) openDetail(log);
  }));
}

function openDetail(log) {
  modal.open({
    title: ACTION_LABELS[log.action] || log.action || "감사 로그 상세",
    size: "lg",
    body: `<div style="display:flex;flex-direction:column;gap:var(--space-4)">
      ${detailGrid([
        ["작업 일시", formatDateTime(log.createdAt)], ["작업자", log.actorName || "-"], ["역할", roleLabel(log.actorRole)],
        ["작업자 지점", log.actorBranchName || log.actorBranchId || "-"], ["대상", log.targetName || targetTypeLabel(log.targetType)],
        ["대상 사번", log.targetEmpNo || "-"], ["대상 지점", log.targetBranchName || log.targetBranchId || "-"], ["상태", statusLabel(log.status)],
      ])}
      <div><div class="form-label">요약</div><div style="background:var(--gray-50);padding:var(--space-3);border-radius:var(--radius-md)">${esc(log.summary || "-")}</div></div>
      ${changeSection("변경 전", log.before)}${changeSection("변경 후", log.after)}
      ${detailGrid([
        ["파일명", log.metadata?.fileName || "-"], ["처리 직원 수", countValue(log.metadata?.affectedEmployeeCount, "명")],
        ["처리 이력 수", countValue(log.metadata?.affectedHistoryCount, "건")], ["성공 건수", countValue(log.metadata?.successCount, "건")],
        ["실패 건수", countValue(log.metadata?.failureCount, "건")], ["중복 건수", countValue(log.metadata?.duplicateCount, "건")],
      ])}
    </div>`,
    actions: [{ label: "닫기", variant: "secondary", onClick: () => modal.close() }],
  });
}

function detailGrid(items) {
  return `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-3)">${items.map(([label, value]) => `<div><div class="form-label">${esc(label)}</div><div>${esc(value)}</div></div>`).join("")}</div>`;
}

function changeSection(title, values) {
  if (!values || !Object.keys(values).length) return "";
  return `<div><div class="form-label">${esc(title)}</div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;background:var(--gray-50);padding:var(--space-3);border-radius:var(--radius-md)">${Object.entries(values).map(([field, value]) => `<div><strong>${esc(FIELD_LABELS[field] || field)}</strong>: ${esc(formatValue(field, value))}</div>`).join("")}</div></div>`;
}

function formatValue(field, value) {
  if (Array.isArray(value)) return value.map((item) => formatValue(field, item)).join(", ");
  if (["completedAt", "startDate", "endDate", "birthDate", "hireDate", "joinDate", "employmentDate"].includes(field) && Number(value) > 0) return formatDateTime(value, false);
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDateTime(value, includeTime = true) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "-";
  return includeTime ? date.toLocaleString("ko-KR") : date.toLocaleDateString("ko-KR");
}

function roleLabel(role) {
  return ({ hq_admin: "본사 교육관리자", instructor: "강사", employee: "직원" })[role] || role || "-";
}

function statusLabel(status) {
  return ({ SUCCESS: "성공", PARTIAL_SUCCESS: "부분 성공", FAILED: "실패" })[status] || status || "-";
}

function statusChip(status) {
  const tone = status === "SUCCESS" ? "success" : status === "PARTIAL_SUCCESS" ? "warning" : "danger";
  return `<span class="chip chip--${tone}">${esc(statusLabel(status))}</span>`;
}

function targetTypeLabel(type) {
  return ({ EMPLOYEE: "직원", EMPLOYEE_LEDGER: "직원관리대장" })[type] || type || "-";
}

function countValue(value, suffix) {
  return value === null || value === undefined || value === "" ? "-" : `${value}${suffix}`;
}

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
