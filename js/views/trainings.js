import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { formatDate } from "../utils/date.js";
import { router } from "../core/router.js";
import {
  TRAINING_STATUS_LABELS,
  TRAINING_TYPES,
  TRAINING_TYPE_LABELS,
  buildStatusChip,
  buildTrainingPayload,
  closeTraining,
  computeTrainingStatus,
  deleteTraining,
  enrichTrainingRecord,
  listManagedTrainings,
  loadTrainingReferences,
  saveTraining,
} from "../services/training-service.js";

let trainingState = {
  references: null,
  trainings: [],
};

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">교육 관리</div>
        <div class="section-subtitle">교육 등록, 운영 상태 관리, 종료 처리까지 한 화면에서 관리합니다.</div>
      </div>
      <button class="btn btn--primary" id="btn-create-training">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        교육 등록
      </button>
    </div>

    <div class="dashboard-grid dashboard-grid--compact" id="training-stats"></div>

    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card__body card__body--compact">
        <div class="filter-bar">
          <div class="filter-bar__search input-group" style="flex:1;min-width:240px">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input class="form-control" id="search-trainings" type="search" placeholder="교육명, 설명, 강사명으로 검색" />
          </div>
          <div class="filter-bar__selects" style="display:flex;gap:var(--space-3);flex-wrap:wrap">
            <select class="form-control" id="filter-status" style="min-width:140px">
              <option value="">전체 상태</option>
              ${Object.entries(TRAINING_STATUS_LABELS).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}
            </select>
            <select class="form-control" id="filter-type" style="min-width:140px">
              <option value="">전체 유형</option>
              ${TRAINING_TYPES.map((type) => `<option value="${type}">${TRAINING_TYPE_LABELS[type]}</option>`).join("")}
            </select>
            <select class="form-control" id="filter-branch" style="min-width:180px">
              <option value="">전체 지점</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="table-wrap" id="trainings-table-wrap">
      <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-12)">
        <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>
    </div>
  `;

  document.getElementById("btn-create-training")?.addEventListener("click", () => openTrainingModal());
  document.getElementById("search-trainings")?.addEventListener("input", () => renderTrainingTable());
  document.getElementById("filter-status")?.addEventListener("change", () => renderTrainingTable());
  document.getElementById("filter-type")?.addEventListener("change", () => renderTrainingTable());
  document.getElementById("filter-branch")?.addEventListener("change", () => renderTrainingTable());

  await loadViewData();
}

async function loadViewData() {
  try {
    const [references, trainings] = await Promise.all([
      loadTrainingReferences(),
      listManagedTrainings(),
    ]);

    trainingState = {
      references,
      trainings,
    };

    renderBranchFilter();
    renderTrainingStats();
    renderTrainingTable();
  } catch (error) {
    console.error("[trainings] load failed", error);
    toast.error("교육 관리 데이터를 불러오지 못했습니다.");
  }
}

function renderBranchFilter() {
  const select = document.getElementById("filter-branch");
  if (!select) return;

  const options = trainingState.references?.branches ?? [];
  select.innerHTML = `
    <option value="">전체 지점</option>
    ${options.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name ?? branch.code ?? branch.id)}</option>`).join("")}
  `;
}

function renderTrainingStats() {
  const wrap = document.getElementById("training-stats");
  if (!wrap) return;

  const trainings = trainingState.trainings;
  const counts = {
    total: trainings.length,
    scheduled: trainings.filter((training) => computeTrainingStatus(training) === "scheduled").length,
    inProgress: trainings.filter((training) => computeTrainingStatus(training) === "in_progress").length,
    overdue: trainings.filter((training) => computeTrainingStatus(training) === "overdue").length,
  };

  wrap.innerHTML = `
    ${statCard("전체 교육", counts.total, "운영 중인 전체 교육 수")}
    ${statCard("예정", counts.scheduled, "시작 전 교육")}
    ${statCard("진행중", counts.inProgress, "현재 운영 중")}
    ${statCard("기한초과", counts.overdue, "후속 조치 필요")}
  `;
}

function renderTrainingTable() {
  const wrap = document.getElementById("trainings-table-wrap");
  if (!wrap) return;

  const filtered = getFilteredTrainings();

  if (!filtered.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">조건에 맞는 교육이 없습니다.</div>
        <div>필터를 조정하거나 새 교육을 등록해 주세요.</div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>교육명</th>
          <th>교육유형</th>
          <th>회사/지점</th>
          <th>교육기간</th>
          <th>수료기한</th>
          <th>담당 강사</th>
          <th>상태</th>
          <th>생성일</th>
          <th style="width:150px"></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((training) => trainingRow(training)).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest(".cell--actions")) return;
      router.push("training-detail", { id: row.dataset.id });
    });
  });

  wrap.querySelectorAll(".btn-training-edit").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const training = trainingState.trainings.find((item) => item.id === button.dataset.id);
      if (training) openTrainingModal(training);
    });
  });

  wrap.querySelectorAll(".btn-training-close").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      confirmCloseTraining(button.dataset.id);
    });
  });

  wrap.querySelectorAll(".btn-training-delete").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      confirmDeleteTraining(button.dataset.id);
    });
  });
}

function trainingRow(training) {
  const branchSummary = training.branchNames?.length
    ? training.branchNames.join(", ")
    : "전체 지점";
  const actionButtons = [];

  actionButtons.push(`
    <button class="btn btn--ghost btn--sm btn-training-edit" data-id="${training.id}" title="수정">수정</button>
  `);

  if (training.computedStatus !== "closed") {
    actionButtons.push(`
      <button class="btn btn--ghost btn--sm btn-training-close" data-id="${training.id}" title="종료 처리">종료</button>
    `);
  }

  actionButtons.push(`
    <button class="btn btn--ghost btn--sm btn-training-delete" data-id="${training.id}" title="삭제" style="color:var(--color-danger)">삭제</button>
  `);

  return `
    <tr data-id="${training.id}" style="cursor:pointer">
      <td>
        <div style="font-weight:var(--weight-semibold);color:var(--gray-800)">${escapeHtml(training.title)}</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:4px">${escapeHtml(training.description || "설명 없음")}</div>
      </td>
      <td>${escapeHtml(training.typeLabel)}</td>
      <td>
        <div>${escapeHtml(training.companyName || "-")}</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:4px">${escapeHtml(branchSummary)}</div>
      </td>
      <td>${formatDate(training.startDate)} ~ ${formatDate(training.endDate)}</td>
      <td>${formatDate(training.deadline)}</td>
      <td>${escapeHtml(training.instructorName || "-")}</td>
      <td>${buildStatusChip(training.computedStatus)}</td>
      <td>${formatDate(training.createdAt)}</td>
      <td class="cell--actions">
        <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
          ${actionButtons.join("")}
        </div>
      </td>
    </tr>
  `;
}

function getFilteredTrainings() {
  const search = String(document.getElementById("search-trainings")?.value ?? "").trim().toLowerCase();
  const status = document.getElementById("filter-status")?.value ?? "";
  const type = document.getElementById("filter-type")?.value ?? "";
  const branch = document.getElementById("filter-branch")?.value ?? "";

  return trainingState.trainings.filter((training) => {
    const matchesSearch = !search || [
      training.title,
      training.description,
      training.instructorName,
    ].some((value) => String(value ?? "").toLowerCase().includes(search));

    const matchesStatus = !status || training.computedStatus === status;
    const matchesType = !type || training.trainingType === type;
    const matchesBranch = !branch || training.branchIds?.includes(branch);

    return matchesSearch && matchesStatus && matchesType && matchesBranch;
  });
}

function openTrainingModal(training = null) {
  const actionLabel = training ? "저장" : "등록";
  const references = trainingState.references;
  const branchIds = training?.branchIds ?? [];

  modal.open({
    title: training ? "교육 수정" : "교육 등록",
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">교육명</label>
            <input class="form-control" id="training-title" type="text" value="${escapeAttr(training?.title ?? "")}" placeholder="예: 2026 서비스 교육" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육유형</label>
            <select class="form-control" id="training-type">
              ${TRAINING_TYPES.map((type) => `
                <option value="${type}" ${training?.trainingType === type ? "selected" : ""}>${TRAINING_TYPE_LABELS[type]}</option>
              `).join("")}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">교육 설명</label>
          <textarea class="form-control" id="training-description" rows="4" placeholder="교육 목적, 대상, 진행 방식을 입력해 주세요.">${escapeHtml(training?.description ?? "")}</textarea>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">회사</label>
            <input class="form-control" type="text" value="${escapeAttr(references?.company?.name || "-")}" disabled />
          </div>
          <div class="form-group">
            <label class="form-label">담당 강사</label>
            <select class="form-control" id="training-instructor">
              <option value="">담당 강사 미지정</option>
              ${(references?.instructors ?? []).map((instructor) => `
                <option value="${instructor.id ?? instructor.uid}" ${(instructor.id ?? instructor.uid) === training?.instructorId ? "selected" : ""}>${escapeHtml(instructor.name)}${instructor.empNo ? ` (${escapeHtml(instructor.empNo)})` : ""}</option>
              `).join("")}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label form-label--required">지점</label>
          <div class="selection-grid">
            ${(references?.branches ?? []).map((branch) => `
              <label class="selection-chip">
                <input type="checkbox" class="branch-selector" value="${branch.id}" ${branchIds.includes(branch.id) ? "checked" : ""} />
                <span>${escapeHtml(branch.name ?? branch.code ?? branch.id)}</span>
              </label>
            `).join("")}
          </div>
          <div class="form-hint">한 개 이상 선택하면 해당 지점 기준 교육으로 저장됩니다. 선택하지 않으면 전체 지점 교육으로 저장됩니다.</div>
        </div>

        <div class="form-row form-row--3">
          <div class="form-group">
            <label class="form-label form-label--required">교육 시작일</label>
            <input class="form-control" id="training-start" type="date" value="${toDateInput(training?.startDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육 종료일</label>
            <input class="form-control" id="training-end" type="date" value="${toDateInput(training?.endDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">수료기한</label>
            <input class="form-control" id="training-deadline" type="date" value="${toDateInput(training?.deadline)}" />
          </div>
        </div>
      </div>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: actionLabel,
        variant: "primary",
        onClick: () => submitTrainingForm(training?.id ?? null, actionLabel),
      },
    ],
  });
}

async function submitTrainingForm(trainingId, actionLabel) {
  const references = trainingState.references;
  const currentTraining = trainingId
    ? trainingState.trainings.find((training) => training.id === trainingId)
    : null;

  const title = document.getElementById("training-title")?.value?.trim();
  const trainingType = document.getElementById("training-type")?.value;
  const description = document.getElementById("training-description")?.value?.trim();
  const instructorId = document.getElementById("training-instructor")?.value;
  const branchIds = Array.from(document.querySelectorAll(".branch-selector:checked")).map((checkbox) => checkbox.value);
  const startDate = readDate("training-start");
  const endDate = readDate("training-end");
  const deadline = readDate("training-deadline");

  if (!title) {
    toast.error("교육명을 입력해 주세요.");
    return;
  }

  if (!startDate || !endDate || !deadline) {
    toast.error("교육 시작일, 종료일, 수료기한을 모두 입력해 주세요.");
    return;
  }

  if (endDate < startDate) {
    toast.error("교육 종료일은 시작일 이후여야 합니다.");
    return;
  }

  if (deadline < endDate) {
    toast.error("수료기한은 교육 종료일과 같거나 이후여야 합니다.");
    return;
  }

  modal.setLoading(actionLabel, true);

  try {
    const payload = buildTrainingPayload({
      title,
      trainingType,
      description,
      instructorId,
      branchIds,
      startDate,
      endDate,
      deadline,
    }, references, currentTraining);

    await saveTraining(payload, trainingId);
    toast.success(trainingId ? "교육이 수정되었습니다." : "교육이 등록되었습니다.");
    modal.close();
    await loadViewData();
  } catch (error) {
    console.error("[trainings] save failed", error);
    toast.error("교육 저장 중 오류가 발생했습니다.");
    modal.setLoading(actionLabel, false);
  }
}

function confirmCloseTraining(trainingId) {
  const training = trainingState.trainings.find((item) => item.id === trainingId);
  if (!training) return;

  modal.open({
    title: "교육 종료 처리",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        <strong>${escapeHtml(training.title)}</strong> 교육을 종료 처리하시겠습니까?<br/>
        종료 처리 후 상태는 <strong>종료</strong>로 표시되며 상세 화면에서 이력은 계속 조회할 수 있습니다.
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
            await loadViewData();
          } catch (error) {
            console.error("[trainings] close failed", error);
            toast.error("교육 종료 처리 중 오류가 발생했습니다.");
            modal.setLoading("종료", false);
          }
        },
      },
    ],
  });
}

function confirmDeleteTraining(trainingId) {
  const training = trainingState.trainings.find((item) => item.id === trainingId);
  if (!training) return;

  modal.open({
    title: "교육 삭제",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        <strong>${escapeHtml(training.title)}</strong> 교육을 삭제하시겠습니까?<br/>
        교육 정보와 배정/완료 연결 데이터가 함께 삭제됩니다.
      </p>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "삭제",
        variant: "danger",
        onClick: async () => {
          modal.setLoading("삭제", true);
          try {
            await deleteTraining(trainingId);
            toast.success("교육이 삭제되었습니다.");
            modal.close();
            await loadViewData();
          } catch (error) {
            console.error("[trainings] delete failed", error);
            toast.error("교육 삭제 중 오류가 발생했습니다.");
            modal.setLoading("삭제", false);
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
