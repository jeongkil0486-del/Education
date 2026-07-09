import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { formatDate, formatDateTime } from "../utils/date.js";
import { authStore, ROLES } from "../core/auth.js";
import {
  TRAINING_TYPES,
  TRAINING_TYPE_LABELS,
  buildStatusChip,
  buildTrainingPayload,
  closeTraining,
  getTrainingDetail,
  loadTrainingReferences,
  saveTraining,
  assignEmployees,
  unassignEmployee,
} from "../services/training-service.js";

let detailState = {
  detail: null,
  selectedEmployeeIds: new Set(),
};

export async function render(container, params = {}) {
  const trainingId = params.id;
  if (!trainingId) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">교육을 찾을 수 없습니다.</div>
        <div>교육 목록에서 다시 선택해 주세요.</div>
      </div>
    `;
    return;
  }
  await loadDetail(container, trainingId);
}

async function loadDetail(container, trainingId) {
  try {
    const detail = await getTrainingDetail(trainingId);
    if (!detail) {
      container.innerHTML = `
        <div class="empty-state" style="padding:var(--space-16)">
          <div class="empty-state__title">교육 정보가 없습니다.</div>
          <div>삭제되었거나 접근할 수 없는 교육입니다.</div>
        </div>
      `;
      return;
    }
    detailState.detail = detail;
    detailState.selectedEmployeeIds = new Set();
    renderDetail(container);
  } catch (err) {
    console.error("[training-detail] loadDetail failed", err?.code, err?.message, err);
    toast.error("교육 상세 정보를 불러오지 못했습니다.");
  }
}

function renderDetail(container) {
  const { training, assignments, completions } = detailState.detail;
  const completionRate = assignments.length
    ? Math.round((completions.length / assignments.length) * 100)
    : 0;

  // instructor는 본인 교육만 수정 가능
  const canEdit = authStore.role !== ROLES.INSTRUCTOR || training.createdBy === authStore.uid;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">${esc(training.title)}</div>
        <div class="section-subtitle">
          ${esc(training.companyName || "-")} · ${esc(training.branchNames?.join(", ") || "전체 지점")} · ${buildStatusChip(training.computedStatus)}
        </div>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        ${canEdit ? `<button class="btn btn--secondary" id="btn-detail-edit">교육 수정</button>` : ""}
        ${canEdit && training.computedStatus !== "closed" ? `<button class="btn btn--secondary" id="btn-detail-close">교육 종료</button>` : ""}
      </div>
    </div>

    <div class="dashboard-grid dashboard-grid--compact">
      ${statCard("배정 인원",  assignments.length,                                "전체 대상자 수")}
      ${statCard("완료 인원",  completions.length,                                "전자서명 완료 기준")}
      ${statCard("미완료",     Math.max(assignments.length - completions.length, 0), "후속 관리 대상")}
      ${statCard("완료율",     `${completionRate}%`,                             "현재 진행률")}
    </div>

    <div class="detail-layout">
      <div class="detail-main">

        <!-- 교육 기본 정보 -->
        <div class="card" style="margin-bottom:var(--space-5)">
          <div class="card__header">
            <div>
              <div class="card__title">교육 기본 정보</div>
            </div>
          </div>
          <div class="card__body detail-info-grid">
            ${infoRow("교육유형",   TRAINING_TYPE_LABELS[training.trainingType] ?? "기타")}
            ${infoRow("담당 강사",  training.instructorName || "-")}
            ${infoRow("교육 시작일", formatDate(training.startDate))}
            ${infoRow("교육 종료일", formatDate(training.endDate))}
            ${infoRow("수료기한",   formatDate(training.deadline))}
            ${infoRow("생성자",     training.createdByName || "-")}
            ${infoRow("생성일",     formatDateTime(training.createdAt))}
            ${infoRow("수정일",     formatDateTime(training.updatedAt))}
          </div>
        </div>

        <!-- 대상자 배정 -->
        <div class="card" style="margin-bottom:var(--space-5)">
          <div class="card__header">
            <div>
              <div class="card__title">교육 대상자 배정</div>
              <div class="card__subtitle">직원을 선택해 교육을 배정합니다.</div>
            </div>
          </div>
          <div class="card__body">
            ${assignmentComposer()}
          </div>
        </div>

        <!-- 배정 현황 -->
        <div class="card" style="margin-bottom:var(--space-5)">
          <div class="card__header">
            <div>
              <div class="card__title">배정 현황</div>
              <div class="card__subtitle">배정된 직원 목록과 수료 상태입니다.</div>
            </div>
          </div>
          <div class="card__body card__body--compact" id="assignment-table-wrap">
            ${assignmentTable()}
          </div>
        </div>

        <!-- 수료 현황 -->
        <div class="card">
          <div class="card__header">
            <div>
              <div class="card__title">수료 및 서명 현황</div>
            </div>
          </div>
          <div class="card__body card__body--compact">
            ${completionTable()}
          </div>
        </div>

      </div><!-- /detail-main -->
    </div><!-- /detail-layout -->
  `;

  bindDetailEvents(container);
}

function bindDetailEvents(container) {
  const { training } = detailState.detail;

  document.getElementById("btn-detail-edit")?.addEventListener("click", () => openEditModal(training));
  document.getElementById("btn-detail-close")?.addEventListener("click", () => confirmClose(training.id, training.title));

  // 배정 영역 — 지점 필터 + 검색
  document.getElementById("assignment-branch")?.addEventListener("change", refreshCandidateList);
  document.getElementById("assignment-search")?.addEventListener("input",  refreshCandidateList);
  document.getElementById("btn-select-all-candidates")?.addEventListener("click", () => toggleCandidates(true));
  document.getElementById("btn-clear-candidates")?.addEventListener("click", () => toggleCandidates(false));
  document.getElementById("btn-assign-selected")?.addEventListener("click", () => handleAssign(training.id));

  // 초기 체크박스 이벤트 바인딩
  bindCandidateCheckboxes(container);

  // 배정 해제 버튼
  container.querySelectorAll(".btn-unassign").forEach((button) => {
    button.addEventListener("click", async () => {
      const uid = button.dataset.uid;
      try {
        await unassignEmployee(training.id, uid);
        toast.success("배정이 해제되었습니다.");
        await loadDetail(document.getElementById("page-content"), training.id);
      } catch (err) {
        console.error("[training-detail] unassign failed", err?.code, err?.message, err);
        toast.error("배정 해제 중 오류가 발생했습니다.");
      }
    });
  });
}

/** 후보 체크박스에 change 이벤트 바인딩 */
function bindCandidateCheckboxes(root) {
  (root ?? document).querySelectorAll(".candidate-checkbox").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) detailState.selectedEmployeeIds.add(input.value);
      else               detailState.selectedEmployeeIds.delete(input.value);
      updateSelectionSummary();
    });
  });
}

// ─── 배정 Composer ──────────────────────────────────────────

function assignmentComposer() {
  const { references, assignments } = detailState.detail;
  const assignedIds = new Set(assignments.map((a) => a.uid));

  return `
    <!-- 필터: 지점 선택 + 검색 (1줄) -->
    <div class="filter-bar" style="margin-bottom:var(--space-4)">
      <select class="form-control" id="assignment-branch" style="min-width:180px">
        <option value="">전체 지점</option>
        ${references.branches.map((b) => `<option value="${b.id}">${esc(b.name ?? b.code ?? b.id)}</option>`).join("")}
      </select>
      <div class="input-group filter-bar__search" style="flex:1;min-width:200px">
        <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
          <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
        </svg>
        <input class="form-control" id="assignment-search" type="search" placeholder="이름, 사번으로 검색" />
      </div>
    </div>

    <!-- 선택 요약 + 액션 버튼 -->
    <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3)">
      <div id="assignment-selection-summary" style="font-size:var(--text-sm);color:var(--gray-500)">선택된 직원 0명</div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn--secondary btn--sm" id="btn-select-all-candidates">전체 선택</button>
        <button class="btn btn--secondary btn--sm" id="btn-clear-candidates">선택 해제</button>
        <button class="btn btn--primary btn--sm" id="btn-assign-selected">선택 직원 배정</button>
      </div>
    </div>

    <!-- 후보 목록 -->
    <div class="picker-list" id="assignment-candidate-list">
      ${references.employees.map((e) => candidateItem(e, assignedIds.has(e.id ?? e.uid))).join("")}
    </div>
  `;
}

function assignmentTable() {
  const rows = detailState.detail.assignments;
  if (!rows.length) {
    return `
      <div class="empty-state" style="padding:var(--space-10)">
        <div class="empty-state__title">아직 배정된 직원이 없습니다.</div>
        <div>상단 배정 영역에서 직원에게 교육을 배정해 주세요.</div>
      </div>
    `;
  }
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>직원명</th><th>사번</th><th>회사</th><th>지점</th>
          <th>배정일</th><th>수료 상태</th><th style="width:100px"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${esc(row.name)}</td>
            <td class="cell--mono">${esc(row.empNo)}</td>
            <td>${esc(row.companyName)}</td>
            <td>${esc(row.branchName)}</td>
            <td>${formatDateTime(row.assignedAt)}</td>
            <td>${row.completionStatus === "completed"
              ? '<span class="chip chip--success">수료</span>'
              : '<span class="chip chip--neutral">대기</span>'}</td>
            <td class="cell--actions">
              <button class="btn btn--ghost btn--sm btn-unassign" data-uid="${row.uid}" style="color:var(--color-danger)">배정 해제</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function completionTable() {
  const rows = detailState.detail.completions;
  if (!rows.length) {
    return `
      <div class="empty-state" style="padding:var(--space-10)">
        <div class="empty-state__title">아직 완료된 교육 이력이 없습니다.</div>
        <div>직원이 전자서명 완료 후 이 영역에 기록됩니다.</div>
      </div>
    `;
  }
  return `
    <table class="data-table">
      <thead>
        <tr><th>직원명</th><th>사번</th><th>완료일시</th><th>서명일시</th><th>상태</th><th>서명 URL</th></tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${esc(row.name)}</td>
            <td class="cell--mono">${esc(row.empNo)}</td>
            <td>${formatDateTime(row.completedAt)}</td>
            <td>${formatDateTime(row.signedAt)}</td>
            <td><span class="chip chip--success">수료</span></td>
            <td>${row.signatureUrl ? `<a href="${escAttr(row.signatureUrl)}" target="_blank" rel="noopener noreferrer">보기</a>` : "-"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function candidateItem(employee, assigned) {
  const uid = employee.id ?? employee.uid;
  const checked = !assigned && detailState.selectedEmployeeIds.has(uid);
  return `
    <label class="picker-item ${assigned ? "picker-item--disabled" : ""}" data-candidate-id="${uid}">
      <input type="checkbox" class="candidate-checkbox" value="${uid}" ${assigned ? "disabled" : ""} ${checked ? "checked" : ""} />
      <div class="picker-item__body">
        <div class="picker-item__title">
          ${esc(employee.name ?? "-")}
          ${assigned ? '<span class="chip chip--neutral" style="font-size:var(--text-2xs)">이미 배정됨</span>' : ""}
        </div>
        <div class="picker-item__meta">${esc(employee.empNo ?? "-")} · ${esc(employee.branchName ?? "-")}</div>
      </div>
    </label>
  `;
}

function refreshCandidateList() {
  const list = document.getElementById("assignment-candidate-list");
  if (!list) return;

  const branchId = document.getElementById("assignment-branch")?.value ?? "";
  const search   = String(document.getElementById("assignment-search")?.value ?? "").trim().toLowerCase();
  const assignedIds = new Set(detailState.detail.assignments.map((a) => a.uid));

  const filtered = detailState.detail.references.employees.filter((e) => {
    const uid = e.id ?? e.uid;
    if (assignedIds.has(uid)) return true;  // 이미 배정된 사람은 항상 표시 (비활성)

    const branchMatch  = !branchId || e.branchId === branchId;
    const searchMatch  = !search   || [e.name, e.empNo, e.branchName].some((v) => String(v ?? "").toLowerCase().includes(search));
    return branchMatch && searchMatch;
  });

  list.innerHTML = filtered.map((e) => candidateItem(e, assignedIds.has(e.id ?? e.uid))).join("");

  // 새로 렌더된 체크박스에 이벤트 재바인딩
  bindCandidateCheckboxes(list);
  updateSelectionSummary();
}

function toggleCandidates(checked) {
  document.querySelectorAll(".candidate-checkbox:not(:disabled)").forEach((input) => {
    input.checked = checked;
    if (checked) detailState.selectedEmployeeIds.add(input.value);
    else         detailState.selectedEmployeeIds.delete(input.value);
  });
  updateSelectionSummary();
}

function updateSelectionSummary() {
  const el = document.getElementById("assignment-selection-summary");
  if (el) el.textContent = `선택된 직원 ${detailState.selectedEmployeeIds.size}명`;
}

async function handleAssign(trainingId) {
  const ids = Array.from(detailState.selectedEmployeeIds);
  if (!ids.length) {
    toast.warning("먼저 배정할 직원을 선택해 주세요.");
    return;
  }

  // 이미 배정된 uid 제외
  const assignedIds = new Set(detailState.detail.assignments.map((a) => a.uid));
  const newIds = ids.filter((uid) => !assignedIds.has(uid));
  if (!newIds.length) {
    toast.warning("선택한 직원 모두 이미 배정되어 있습니다.");
    return;
  }

  const btn = document.getElementById("btn-assign-selected");
  if (btn) { btn.disabled = true; btn.textContent = "배정 중…"; }

  try {
    await assignEmployees(detailState.detail.training, newIds, detailState.detail.references);
    toast.success(`${newIds.length}명에게 교육이 배정되었습니다.`);
    await loadDetail(document.getElementById("page-content"), trainingId);
  } catch (err) {
    console.error("[training-detail] assign failed", err?.code, err?.message, err);
    toast.error(`교육 배정 중 오류가 발생했습니다: ${err?.message ?? "알 수 없는 오류"}`);
    if (btn) { btn.disabled = false; btn.textContent = "선택 직원 배정"; }
  }
}

// ─── 수정 모달 ──────────────────────────────────────────────

function openEditModal(training) {
  const refs = detailState.detail.references;
  const actionLabel = "저장";
  const isInstructor = authStore.role === ROLES.INSTRUCTOR;

  modal.open({
    title: "교육 수정",
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">교육명</label>
            <input class="form-control" id="t-title" type="text" value="${escAttr(training.title)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육유형</label>
            <select class="form-control" id="t-type">
              ${TRAINING_TYPES.map((tp) => `<option value="${tp}" ${training.trainingType === tp ? "selected" : ""}>${TRAINING_TYPE_LABELS[tp]}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">회사</label>
            <input class="form-control" type="text" value="${escAttr(refs.company.name || "-")}" disabled />
          </div>
          <div class="form-group">
            <label class="form-label">담당 강사</label>
            ${isInstructor
              ? `<input class="form-control" type="text" value="${escAttr(authStore.name)}" disabled />`
              : `<select class="form-control" id="t-instructor">
                   <option value="">담당 강사 미지정</option>
                   ${refs.instructors.map((ins) => `<option value="${ins.id ?? ins.uid}" ${(ins.id ?? ins.uid) === training.instructorId ? "selected" : ""}>${esc(ins.name)}</option>`).join("")}
                 </select>`
            }
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">지점</label>
          <div class="selection-grid">
            ${refs.branches.map((b) => `
              <label class="selection-chip">
                <input type="checkbox" class="branch-selector" value="${b.id}" ${training.branchIds?.includes(b.id) ? "checked" : ""} />
                <span>${esc(b.name ?? b.code ?? b.id)}</span>
              </label>
            `).join("")}
          </div>
        </div>

        <div class="form-row form-row--3">
          <div class="form-group">
            <label class="form-label form-label--required">교육 시작일</label>
            <input class="form-control" id="t-start" type="date" value="${toDateInput(training.startDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육 종료일</label>
            <input class="form-control" id="t-end" type="date" value="${toDateInput(training.endDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">수료기한</label>
            <input class="form-control" id="t-deadline" type="date" value="${toDateInput(training.deadline)}" />
          </div>
        </div>
      </div>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: actionLabel,
        variant: "primary",
        onClick: async () => {
          const title     = document.getElementById("t-title")?.value?.trim();
          const trainType = document.getElementById("t-type")?.value;
          const instructorId = isInstructor
            ? authStore.uid
            : (document.getElementById("t-instructor")?.value ?? "");
          const branchIds = Array.from(document.querySelectorAll(".branch-selector:checked")).map((c) => c.value);
          const startDate = readDate("t-start");
          const endDate   = readDate("t-end");
          const deadline  = readDate("t-deadline");

          if (!title)    { toast.error("교육명을 입력해 주세요."); return; }
          if (!startDate || !endDate || !deadline) { toast.error("날짜를 모두 입력해 주세요."); return; }
          if (endDate < startDate) { toast.error("종료일은 시작일 이후여야 합니다."); return; }
          if (deadline < endDate)  { toast.error("수료기한은 종료일과 같거나 이후여야 합니다."); return; }

          modal.setLoading(actionLabel, true);
          try {
            const payload = buildTrainingPayload(
              { title, trainingType: trainType, description: training.description ?? "", instructorId, branchIds, startDate, endDate, deadline },
              refs,
              training
            );
            await saveTraining(payload, training.id);
            toast.success("교육 정보가 수정되었습니다.");
            modal.close();
            await loadDetail(document.getElementById("page-content"), training.id);
          } catch (err) {
            console.error("[training-detail] update failed", err?.code, err?.message, err);
            toast.error("교육 수정 중 오류가 발생했습니다.");
            modal.setLoading(actionLabel, false);
          }
        },
      },
    ],
  });
}

function confirmClose(trainingId, title) {
  modal.open({
    title: "교육 종료 처리",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        <strong>${esc(title)}</strong> 교육을 종료 처리하시겠습니까?
      </p>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "종료", variant: "primary",
        onClick: async () => {
          modal.setLoading("종료", true);
          try {
            await closeTraining(trainingId);
            toast.success("교육이 종료 처리되었습니다.");
            modal.close();
            await loadDetail(document.getElementById("page-content"), trainingId);
          } catch (err) {
            console.error("[training-detail] close failed", err?.code, err?.message, err);
            toast.error("교육 종료 처리 중 오류가 발생했습니다.");
            modal.setLoading("종료", false);
          }
        },
      },
    ],
  });
}

// ─── 헬퍼 ──────────────────────────────────────────────────

function statCard(label, value, subtitle) {
  return `
    <div class="stat-card">
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value">${value}</div>
      <div style="font-size:var(--text-xs);color:var(--gray-400)">${subtitle}</div>
    </div>
  `;
}

function infoRow(label, value) {
  return `
    <div class="info-row">
      <span class="info-row__label">${label}</span>
      <span class="info-row__value">${esc(value || "-")}</span>
    </div>
  `;
}

function readDate(id) {
  const v = document.getElementById(id)?.value;
  return v ? new Date(`${v}T00:00:00`).getTime() : null;
}

function toDateInput(ts) {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "";
}

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escAttr(v) {
  return esc(v).replace(/'/g, "&#39;");
}
