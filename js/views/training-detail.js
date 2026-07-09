import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { formatDate, formatDateTime } from "../utils/date.js";
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
}

function renderDetail(container) {
  const { training, assignments, completions } = detailState.detail;
  const completionRate = assignments.length
    ? Math.round((completions.length / assignments.length) * 100)
    : 0;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">${escapeHtml(training.title)}</div>
        <div class="section-subtitle">${escapeHtml(training.companyName || "-")} · ${escapeHtml(training.branchNames?.join(", ") || "전체 지점")} · ${buildStatusChip(training.computedStatus)}</div>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        <button class="btn btn--secondary" id="btn-detail-edit">교육 수정</button>
        ${training.computedStatus !== "closed" ? '<button class="btn btn--secondary" id="btn-detail-close">교육 종료</button>' : ""}
      </div>
    </div>

    <div class="dashboard-grid dashboard-grid--compact">
      ${statCard("배정 인원", assignments.length, "전체 대상자 수")}
      ${statCard("완료 인원", completions.length, "전자서명 완료 기준")}
      ${statCard("미완료", Math.max(assignments.length - completions.length, 0), "후속 관리 대상")}
      ${statCard("완료율", `${completionRate}%`, "현재 진행률")}
    </div>

    <div class="detail-layout">
      <div class="detail-main">
        <div class="card" style="margin-bottom:var(--space-5)">
          <div class="card__header">
            <div>
              <div class="card__title">교육 기본 정보</div>
              <div class="card__subtitle">기본 CRUD 대상 필드와 상태 정보를 관리합니다.</div>
            </div>
          </div>
          <div class="card__body detail-info-grid">
            ${infoRow("교육유형", TRAINING_TYPE_LABELS[training.trainingType] ?? "기타")}
            ${infoRow("담당 강사", training.instructorName || "-")}
            ${infoRow("교육 시작일", formatDate(training.startDate))}
            ${infoRow("교육 종료일", formatDate(training.endDate))}
            ${infoRow("수료기한", formatDate(training.deadline))}
            ${infoRow("생성자", training.createdByName || "-")}
            ${infoRow("생성일", formatDateTime(training.createdAt))}
            ${infoRow("수정일", formatDateTime(training.updatedAt))}
          </div>
          <div class="card__body" style="border-top:var(--border-thin)">
            <div class="card__title" style="margin-bottom:var(--space-2)">교육 설명</div>
            <div style="font-size:var(--text-sm);color:var(--gray-600);line-height:var(--leading-relaxed)">
              ${escapeHtml(training.description || "등록된 교육 설명이 없습니다.")}
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom:var(--space-5)">
          <div class="card__header">
            <div>
              <div class="card__title">교육 대상자 배정</div>
              <div class="card__subtitle">회사/지점/직원 기준으로 배정 구조를 관리합니다.</div>
            </div>
          </div>
          <div class="card__body">
            ${assignmentComposer()}
          </div>
        </div>

        <div class="card" style="margin-bottom:var(--space-5)">
          <div class="card__header">
            <div>
              <div class="card__title">배정 현황</div>
              <div class="card__subtitle">trainingAssignments / userAssignments 구조와 연결됩니다.</div>
            </div>
          </div>
          <div class="card__body card__body--compact" id="assignment-table-wrap">
            ${assignmentTable()}
          </div>
        </div>

        <div class="card">
          <div class="card__header">
            <div>
              <div class="card__title">수료 및 서명 현황</div>
              <div class="card__subtitle">trainingCompletions / userCompletions 구조와 연결됩니다.</div>
            </div>
          </div>
          <div class="card__body card__body--compact">
            ${completionTable()}
          </div>
        </div>
      </div>

      <aside class="detail-side">
        <div class="card">
          <div class="card__header">
            <div>
              <div class="card__title">구현 메모</div>
              <div class="card__subtitle">다음 단계에서 확장할 포인트</div>
            </div>
          </div>
          <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-3);font-size:var(--text-sm);color:var(--gray-600)">
            <div>대량 자동 배정 로직은 현재 수동 선택 기반입니다.</div>
            <div>전자서명 이미지 업로드와 서명 패드는 다음 단계에서 연결합니다.</div>
            <div>강의자료, 교안, 평가지 연결 필드는 현재 교육 기본 구조만 준비했습니다.</div>
          </div>
        </div>
      </aside>
    </div>
  `;

  bindDetailEvents(container);
}

function bindDetailEvents(container) {
  const { training } = detailState.detail;

  document.getElementById("btn-detail-edit")?.addEventListener("click", () => openEditModal(training));
  document.getElementById("btn-detail-close")?.addEventListener("click", () => confirmClose(training.id, training.title));
  document.getElementById("assignment-scope")?.addEventListener("change", () => refreshCandidateList());
  document.getElementById("assignment-branch")?.addEventListener("change", () => refreshCandidateList());
  document.getElementById("assignment-search")?.addEventListener("input", () => refreshCandidateList());
  document.getElementById("btn-select-all-candidates")?.addEventListener("click", () => toggleCandidates(true));
  document.getElementById("btn-clear-candidates")?.addEventListener("click", () => toggleCandidates(false));
  document.getElementById("btn-assign-selected")?.addEventListener("click", () => handleAssign(training.id));

  container.querySelectorAll(".candidate-checkbox").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) detailState.selectedEmployeeIds.add(input.value);
      else detailState.selectedEmployeeIds.delete(input.value);
      updateSelectionSummary();
    });
  });

  container.querySelectorAll(".btn-unassign").forEach((button) => {
    button.addEventListener("click", async () => {
      const uid = button.dataset.uid;
      try {
        await unassignEmployee(training.id, uid);
        toast.success("배정이 해제되었습니다.");
        await loadDetail(document.getElementById("page-content"), training.id);
      } catch (error) {
        console.error("[training-detail] unassign failed", error);
        toast.error("배정 해제 중 오류가 발생했습니다.");
      }
    });
  });
}

function assignmentComposer() {
  const { references, assignments } = detailState.detail;
  const assignedIds = new Set(assignments.map((assignment) => assignment.uid));

  return `
    <div class="form-row" style="align-items:end">
      <div class="form-group">
        <label class="form-label">배정 기준</label>
        <select class="form-control" id="assignment-scope">
          <option value="company">회사 전체</option>
          <option value="branch">지점 기준</option>
          <option value="employee">직원 직접 선택</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">지점</label>
        <select class="form-control" id="assignment-branch">
          <option value="">전체 지점</option>
          ${references.branches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name ?? branch.code ?? branch.id)}</option>`).join("")}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">직원 검색</label>
        <input class="form-control" id="assignment-search" type="search" placeholder="이름, 사번, 지점으로 검색" />
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);margin:var(--space-4) 0 var(--space-3)">
      <div id="assignment-selection-summary" style="font-size:var(--text-sm);color:var(--gray-500)">선택된 직원 0명</div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn--secondary btn--sm" id="btn-select-all-candidates">전체 선택</button>
        <button class="btn btn--secondary btn--sm" id="btn-clear-candidates">선택 해제</button>
        <button class="btn btn--primary btn--sm" id="btn-assign-selected">선택 직원 배정</button>
      </div>
    </div>

    <div class="picker-list" id="assignment-candidate-list">
      ${references.employees.map((employee) => candidateItem(employee, assignedIds.has(employee.id ?? employee.uid))).join("")}
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
          <th>직원명</th>
          <th>사번</th>
          <th>회사</th>
          <th>지점</th>
          <th>배정일</th>
          <th>수료 상태</th>
          <th style="width:100px"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td class="cell--mono">${escapeHtml(row.empNo)}</td>
            <td>${escapeHtml(row.companyName)}</td>
            <td>${escapeHtml(row.branchName)}</td>
            <td>${formatDateTime(row.assignedAt)}</td>
            <td>${row.completionStatus === "completed" ? '<span class="chip chip--success">수료</span>' : '<span class="chip chip--neutral">대기</span>'}</td>
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
        <tr>
          <th>직원명</th>
          <th>사번</th>
          <th>완료일시</th>
          <th>서명일시</th>
          <th>상태</th>
          <th>서명 URL</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td class="cell--mono">${escapeHtml(row.empNo)}</td>
            <td>${formatDateTime(row.completedAt)}</td>
            <td>${formatDateTime(row.signedAt)}</td>
            <td><span class="chip chip--success">completed</span></td>
            <td>${row.signatureUrl ? `<a href="${escapeAttr(row.signatureUrl)}" target="_blank" rel="noopener noreferrer">보기</a>` : "-"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function candidateItem(employee, assigned) {
  const uid = employee.id ?? employee.uid;
  return `
    <label class="picker-item ${assigned ? "picker-item--disabled" : ""}" data-candidate-id="${uid}">
      <input type="checkbox" class="candidate-checkbox" value="${uid}" ${assigned ? "disabled" : ""} />
      <div class="picker-item__body">
        <div class="picker-item__title">${escapeHtml(employee.name ?? "-")} ${assigned ? '<span class="chip chip--neutral">이미 배정됨</span>' : ""}</div>
        <div class="picker-item__meta">${escapeHtml(employee.empNo ?? "-")} · ${escapeHtml(employee.companyName ?? "-")} · ${escapeHtml(employee.branchName ?? "-")}</div>
      </div>
    </label>
  `;
}

function refreshCandidateList() {
  const list = document.getElementById("assignment-candidate-list");
  if (!list) return;

  const scope = document.getElementById("assignment-scope")?.value ?? "company";
  const branchId = document.getElementById("assignment-branch")?.value ?? "";
  const search = String(document.getElementById("assignment-search")?.value ?? "").trim().toLowerCase();
  const assignedIds = new Set(detailState.detail.assignments.map((assignment) => assignment.uid));

  const filtered = detailState.detail.references.employees.filter((employee) => {
    const uid = employee.id ?? employee.uid;
    if (assignedIds.has(uid)) return true;

    const branchMatch = !branchId || employee.branchId === branchId;
    const searchMatch = !search || [
      employee.name,
      employee.empNo,
      employee.branchName,
      employee.companyName,
    ].some((value) => String(value ?? "").toLowerCase().includes(search));

    if (scope === "branch") return branchMatch && searchMatch;
    if (scope === "employee") return searchMatch && branchMatch;
    return searchMatch && branchMatch;
  });

  list.innerHTML = filtered.map((employee) => candidateItem(employee, assignedIds.has(employee.id ?? employee.uid))).join("");
  list.querySelectorAll(".candidate-checkbox").forEach((input) => {
    if (detailState.selectedEmployeeIds.has(input.value)) input.checked = true;
    input.addEventListener("change", () => {
      if (input.checked) detailState.selectedEmployeeIds.add(input.value);
      else detailState.selectedEmployeeIds.delete(input.value);
      updateSelectionSummary();
    });
  });

  updateSelectionSummary();
}

function toggleCandidates(checked) {
  document.querySelectorAll(".candidate-checkbox:not(:disabled)").forEach((input) => {
    input.checked = checked;
    if (checked) detailState.selectedEmployeeIds.add(input.value);
    else detailState.selectedEmployeeIds.delete(input.value);
  });
  updateSelectionSummary();
}

function updateSelectionSummary() {
  const summary = document.getElementById("assignment-selection-summary");
  if (summary) {
    summary.textContent = `선택된 직원 ${detailState.selectedEmployeeIds.size}명`;
  }
}

async function handleAssign(trainingId) {
  if (!detailState.selectedEmployeeIds.size) {
    toast.warning("먼저 배정할 직원을 선택해 주세요.");
    return;
  }

  try {
    await assignEmployees(detailState.detail.training, [...detailState.selectedEmployeeIds], detailState.detail.references);
    toast.success("선택한 직원에게 교육이 배정되었습니다.");
    await loadDetail(document.getElementById("page-content"), trainingId);
  } catch (error) {
    console.error("[training-detail] assign failed", error);
    toast.error("교육 배정 중 오류가 발생했습니다.");
  }
}

function openEditModal(training) {
  const references = detailState.detail.references;
  const actionLabel = "저장";

  modal.open({
    title: "교육 수정",
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">교육명</label>
            <input class="form-control" id="training-title" type="text" value="${escapeAttr(training.title)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육유형</label>
            <select class="form-control" id="training-type">
              ${TRAINING_TYPES.map((type) => `<option value="${type}" ${training.trainingType === type ? "selected" : ""}>${TRAINING_TYPE_LABELS[type]}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">교육 설명</label>
          <textarea class="form-control" id="training-description" rows="4">${escapeHtml(training.description || "")}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">회사</label>
            <input class="form-control" type="text" value="${escapeAttr(references.company.name || "-")}" disabled />
          </div>
          <div class="form-group">
            <label class="form-label">담당 강사</label>
            <select class="form-control" id="training-instructor">
              <option value="">담당 강사 미지정</option>
              ${references.instructors.map((instructor) => `<option value="${instructor.id ?? instructor.uid}" ${(instructor.id ?? instructor.uid) === training.instructorId ? "selected" : ""}>${escapeHtml(instructor.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">지점</label>
          <div class="selection-grid">
            ${references.branches.map((branch) => `
              <label class="selection-chip">
                <input type="checkbox" class="branch-selector" value="${branch.id}" ${training.branchIds?.includes(branch.id) ? "checked" : ""} />
                <span>${escapeHtml(branch.name ?? branch.code ?? branch.id)}</span>
              </label>
            `).join("")}
          </div>
        </div>
        <div class="form-row form-row--3">
          <div class="form-group">
            <label class="form-label form-label--required">교육 시작일</label>
            <input class="form-control" id="training-start" type="date" value="${toDateInput(training.startDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육 종료일</label>
            <input class="form-control" id="training-end" type="date" value="${toDateInput(training.endDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">수료기한</label>
            <input class="form-control" id="training-deadline" type="date" value="${toDateInput(training.deadline)}" />
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
          const payload = buildTrainingPayload({
            title: document.getElementById("training-title")?.value?.trim(),
            trainingType: document.getElementById("training-type")?.value,
            description: document.getElementById("training-description")?.value?.trim(),
            instructorId: document.getElementById("training-instructor")?.value,
            branchIds: Array.from(document.querySelectorAll(".branch-selector:checked")).map((checkbox) => checkbox.value),
            startDate: readDate("training-start"),
            endDate: readDate("training-end"),
            deadline: readDate("training-deadline"),
          }, references, training);

          modal.setLoading(actionLabel, true);
          try {
            await saveTraining(payload, training.id);
            toast.success("교육 정보가 수정되었습니다.");
            modal.close();
            await loadDetail(document.getElementById("page-content"), training.id);
          } catch (error) {
            console.error("[training-detail] update failed", error);
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
        <strong>${escapeHtml(title)}</strong> 교육을 종료 처리하시겠습니까?
      </p>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "종료",
        variant: "primary",
        onClick: async () => {
          modal.setLoading("종료", true);
          try {
            await closeTraining(trainingId);
            toast.success("교육이 종료 처리되었습니다.");
            modal.close();
            await loadDetail(document.getElementById("page-content"), trainingId);
          } catch (error) {
            console.error("[training-detail] close failed", error);
            toast.error("교육 종료 처리 중 오류가 발생했습니다.");
            modal.setLoading("종료", false);
          }
        },
      },
    ],
  });
}

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
      <span class="info-row__value">${escapeHtml(value || "-")}</span>
    </div>
  `;
}

function readDate(id) {
  const value = document.getElementById(id)?.value;
  return value ? new Date(`${value}T00:00:00`).getTime() : null;
}

function toDateInput(timestamp) {
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : "";
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
