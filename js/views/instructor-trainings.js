/**
 * instructor-trainings.js — instructor 전용 교육 관리 화면
 *
 * - 교육 등록 가능
 * - 본인이 등록(createdBy)하거나 담당 강사(instructorId)인 교육만 조회
 * - 통계 카드: 전체교육 / 진행중 / 기한촉박 / 기한초과
 * - 교육 수정 / 종료 / 삭제 / 대상자 배정 연결
 */

import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { formatDate } from "../utils/date.js";
import { router } from "../core/router.js";
import { authStore } from "../core/auth.js";
import {
  TRAINING_STATUS_LABELS,
  TRAINING_TYPES,
  TRAINING_TYPE_LABELS,
  buildStatusChip,
  buildTrainingPayload,
  closeTraining,
  computeTrainingStatus,
  deleteTraining,
  isDeadlineSoon,
  listInstructorTrainings,
  loadTrainingReferences,
  saveTraining,
} from "../services/training-service.js";

let activeStatFilter = null;

let state = {
  references: null,
  trainings: [],
};

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">교육 관리</div>
        <div class="section-subtitle">내가 등록하고 담당하는 교육을 관리합니다.</div>
      </div>
      <button class="btn btn--primary" id="btn-create-training">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        교육 등록
      </button>
    </div>

    <!-- 통계 카드 4개 -->
    <div class="dashboard-grid dashboard-grid--compact" id="training-stats" style="margin-bottom:var(--space-5)"></div>

    <!-- 필터 바 -->
    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card__body card__body--compact">
        <div class="filter-bar">
          <div class="filter-bar__search input-group" style="flex:1;min-width:220px">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input class="form-control" id="search-trainings" type="search" placeholder="교육명, 설명으로 검색" />
          </div>
          <div class="filter-bar__selects" style="display:flex;gap:var(--space-3);flex-wrap:wrap">
            <select class="form-control" id="filter-status" style="min-width:130px">
              <option value="">전체 상태</option>
              ${Object.entries(TRAINING_STATUS_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
            </select>
            <select class="form-control" id="filter-type" style="min-width:130px">
              <option value="">전체 유형</option>
              ${TRAINING_TYPES.map((t) => `<option value="${t}">${TRAINING_TYPE_LABELS[t]}</option>`).join("")}
            </select>
            <select class="form-control" id="filter-branch" style="min-width:160px">
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
      listInstructorTrainings(),
    ]);

    state = { references, trainings };

    renderBranchFilter();
    renderTrainingStats();
    renderTrainingTable();
  } catch (error) {
    console.error("[instructor-trainings] load failed", error);
    toast.error("교육 데이터를 불러오지 못했습니다.");
  }
}

function renderBranchFilter() {
  const select = document.getElementById("filter-branch");
  if (!select) return;

  const branches = state.references?.branches ?? [];
  select.innerHTML = `
    <option value="">전체 지점</option>
    ${branches.map((b) => `<option value="${b.id}">${esc(b.name ?? b.code ?? b.id)}</option>`).join("")}
  `;
}

function renderTrainingStats() {
  const wrap = document.getElementById("training-stats");
  if (!wrap) return;

  const now  = Date.now();
  const list = state.trainings;

  const counts = {
    total:      list.length,
    inProgress: list.filter((t) => computeTrainingStatus(t, now) === "in_progress").length,
    soon:       list.filter((t) => isDeadlineSoon(t, now)).length,
    overdue:    list.filter((t) => computeTrainingStatus(t, now) === "overdue").length,
  };

  const cards = [
    { key: "total",      label: "전체교육", value: counts.total,      sub: "내 전체 교육 수",        tone: "" },
    { key: "inProgress", label: "진행중",   value: counts.inProgress,  sub: "현재 운영 중",           tone: "success" },
    { key: "soon",       label: "기한촉박", value: counts.soon,        sub: "수료기한 3일 이내",      tone: "warning" },
    { key: "overdue",    label: "기한초과", value: counts.overdue,     sub: "기한이 지난 교육",       tone: "danger" },
  ];

  wrap.innerHTML = cards.map(({ key, label, value, sub, tone }) => `
    <div
      class="stat-card stat-card--clickable ${activeStatFilter === key ? "stat-card--active" : ""}"
      data-filter-key="${key}"
      style="cursor:pointer"
      title="${label} 필터 ${activeStatFilter === key ? "해제" : "적용"}"
    >
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value ${tone ? `stat-card__value--${tone}` : ""}">${value}</div>
      <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:2px">${sub}</div>
    </div>
  `).join("");

  wrap.querySelectorAll(".stat-card--clickable").forEach((card) => {
    card.addEventListener("click", () => {
      const key = card.dataset.filterKey;
      activeStatFilter = activeStatFilter === key ? null : key;
      renderTrainingStats();
      renderTrainingTable();
    });
  });
}

function renderTrainingTable() {
  const wrap = document.getElementById("trainings-table-wrap");
  if (!wrap) return;

  const filtered = getFiltered();

  if (!filtered.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">등록한 교육이 없습니다.</div>
        <div>교육 등록 버튼으로 새 교육을 추가해 주세요.</div>
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
          <th>상태</th>
          <th>생성일</th>
          <th style="width:160px"></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((t) => trainingRow(t)).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".cell--actions")) return;
      router.push("training-detail", { id: row.dataset.id });
    });
  });

  wrap.querySelectorAll(".btn-training-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const training = state.trainings.find((t) => t.id === btn.dataset.id);
      if (training) openTrainingModal(training);
    });
  });

  wrap.querySelectorAll(".btn-training-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmClose(btn.dataset.id);
    });
  });

  wrap.querySelectorAll(".btn-training-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmDelete(btn.dataset.id);
    });
  });
}

function trainingRow(t) {
  const branchSummary = t.branchNames?.length ? t.branchNames.join(", ") : "전체 지점";
  const soon = isDeadlineSoon(t);
  const isOwner = t.createdBy === authStore.uid;
  const actions = [];

  if (isOwner) {
    actions.push(`<button class="btn btn--ghost btn--sm btn-training-edit" data-id="${t.id}" title="수정">수정</button>`);
  }
  if (t.computedStatus !== "closed" && isOwner) {
    actions.push(`<button class="btn btn--ghost btn--sm btn-training-close" data-id="${t.id}" title="종료 처리">종료</button>`);
  }
  if (isOwner) {
    actions.push(`<button class="btn btn--ghost btn--sm btn-training-delete" data-id="${t.id}" title="삭제" style="color:var(--color-danger)">삭제</button>`);
  }

  const ownerBadge = t.createdBy !== authStore.uid
    ? `<span class="chip chip--neutral" style="font-size:var(--text-2xs)">담당</span> `
    : "";

  return `
    <tr data-id="${t.id}" style="cursor:pointer">
      <td>
        <div style="font-weight:var(--weight-semibold);color:var(--gray-800)">${ownerBadge}${esc(t.title)}</div>
        ${t.description ? `<div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:4px">${esc(t.description)}</div>` : ""}
      </td>
      <td>${esc(t.typeLabel)}</td>
      <td>
        <div>${esc(t.companyName || "-")}</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:4px">${esc(branchSummary)}</div>
      </td>
      <td style="white-space:nowrap">${formatDate(t.startDate)} ~ ${formatDate(t.endDate)}</td>
      <td style="white-space:nowrap">
        ${soon ? `<span style="color:var(--color-warning);font-weight:var(--weight-semibold)">⚠ </span>` : ""}
        ${formatDate(t.deadline)}
      </td>
      <td>${buildStatusChip(t.computedStatus)}</td>
      <td>${formatDate(t.createdAt)}</td>
      <td class="cell--actions">
        <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
          ${actions.join("") || `<span style="font-size:var(--text-xs);color:var(--gray-400)">조회 전용</span>`}
        </div>
      </td>
    </tr>
  `;
}

function getFiltered() {
  const now    = Date.now();
  const search = (document.getElementById("search-trainings")?.value ?? "").trim().toLowerCase();
  const status = document.getElementById("filter-status")?.value ?? "";
  const type   = document.getElementById("filter-type")?.value ?? "";
  const branch = document.getElementById("filter-branch")?.value ?? "";

  return state.trainings.filter((t) => {
    if (activeStatFilter === "inProgress" && computeTrainingStatus(t, now) !== "in_progress") return false;
    if (activeStatFilter === "soon"       && !isDeadlineSoon(t, now))                          return false;
    if (activeStatFilter === "overdue"    && computeTrainingStatus(t, now) !== "overdue")       return false;

    if (search && ![t.title, t.description].some((v) => String(v ?? "").toLowerCase().includes(search))) return false;
    if (status && t.computedStatus !== status) return false;
    if (type   && t.trainingType   !== type)   return false;
    if (branch && !t.branchIds?.includes(branch)) return false;

    return true;
  });
}

// ─── 교육 등록 / 수정 모달 ──────────────────────────────────

function openTrainingModal(training = null) {
  const actionLabel = training ? "저장" : "등록";
  const refs        = state.references;
  const branchIds   = training?.branchIds ?? [];

  modal.open({
    title: training ? "교육 수정" : "교육 등록",
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">교육명</label>
            <input class="form-control" id="t-title" type="text" value="${escAttr(training?.title ?? "")}" placeholder="예: 2026 서비스 교육" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육유형</label>
            <select class="form-control" id="t-type">
              ${TRAINING_TYPES.map((tp) => `<option value="${tp}" ${training?.trainingType === tp ? "selected" : ""}>${TRAINING_TYPE_LABELS[tp]}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">교육 설명</label>
          <textarea class="form-control" id="t-description" rows="3" placeholder="교육 목적, 대상, 진행 방식을 입력해 주세요.">${esc(training?.description ?? "")}</textarea>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">회사</label>
            <input class="form-control" type="text" value="${escAttr(refs?.company?.name || "-")}" disabled />
          </div>
          <div class="form-group">
            <label class="form-label">담당 강사 (나)</label>
            <input class="form-control" type="text" value="${escAttr(authStore.name)}" disabled />
            <div class="form-hint">교육 등록 시 담당 강사는 자동으로 현재 계정으로 설정됩니다.</div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label form-label--required">지점</label>
          <div class="selection-grid">
            ${(refs?.branches ?? []).map((b) => `
              <label class="selection-chip">
                <input type="checkbox" class="branch-selector" value="${b.id}" ${branchIds.includes(b.id) ? "checked" : ""} />
                <span>${esc(b.name ?? b.code ?? b.id)}</span>
              </label>
            `).join("")}
          </div>
          <div class="form-hint">선택하지 않으면 전체 지점 교육으로 저장됩니다.</div>
        </div>

        <div class="form-row form-row--3">
          <div class="form-group">
            <label class="form-label form-label--required">교육 시작일</label>
            <input class="form-control" id="t-start" type="date" value="${toDateInput(training?.startDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육 종료일</label>
            <input class="form-control" id="t-end" type="date" value="${toDateInput(training?.endDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">수료기한</label>
            <input class="form-control" id="t-deadline" type="date" value="${toDateInput(training?.deadline)}" />
          </div>
        </div>
      </div>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: actionLabel, variant: "primary", onClick: () => submitForm(training?.id ?? null, actionLabel) },
    ],
  });
}

async function submitForm(trainingId, actionLabel) {
  const refs    = state.references;
  const current = trainingId ? state.trainings.find((t) => t.id === trainingId) : null;

  const title       = document.getElementById("t-title")?.value?.trim();
  const trainingType = document.getElementById("t-type")?.value;
  const description  = document.getElementById("t-description")?.value?.trim();
  const branchIds    = Array.from(document.querySelectorAll(".branch-selector:checked")).map((c) => c.value);
  const startDate    = readDate("t-start");
  const endDate      = readDate("t-end");
  const deadline     = readDate("t-deadline");

  if (!title) { toast.error("교육명을 입력해 주세요."); return; }
  if (!startDate || !endDate || !deadline) { toast.error("교육 시작일, 종료일, 수료기한을 모두 입력해 주세요."); return; }
  if (endDate < startDate) { toast.error("교육 종료일은 시작일 이후여야 합니다."); return; }
  if (deadline < endDate)  { toast.error("수료기한은 교육 종료일과 같거나 이후여야 합니다."); return; }

  modal.setLoading(actionLabel, true);

  try {
    const payload = buildTrainingPayload(
      {
        title, trainingType, description,
        // 강사 본인을 instructorId로 고정
        instructorId:   authStore.uid,
        instructorName: authStore.name,
        branchIds, startDate, endDate, deadline,
      },
      refs,
      current
    );

    // createdBy / instructorId 명시 저장 (신규 등록 시)
    if (!trainingId) {
      payload.createdBy     = authStore.uid;
      payload.createdByName = authStore.name;
      payload.instructorId  = authStore.uid;
      payload.instructorName = authStore.name;
    }
    payload.updatedAt = Date.now();

    await saveTraining(payload, trainingId);
    toast.success(trainingId ? "교육이 수정되었습니다." : "교육이 등록되었습니다.");
    modal.close();
    await loadViewData();
  } catch (error) {
    console.error("[instructor-trainings] save failed", error);
    toast.error("교육 저장 중 오류가 발생했습니다.");
    modal.setLoading(actionLabel, false);
  }
}

function confirmClose(trainingId) {
  const t = state.trainings.find((item) => item.id === trainingId);
  if (!t) return;

  modal.open({
    title: "교육 종료 처리",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        <strong>${esc(t.title)}</strong> 교육을 종료 처리하시겠습니까?<br/>
        종료 후 상태는 <strong>종료</strong>로 표시되며 이력은 계속 조회할 수 있습니다.
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
            await loadViewData();
          } catch (err) {
            console.error("[instructor-trainings] close failed", err);
            toast.error("교육 종료 처리 중 오류가 발생했습니다.");
            modal.setLoading("종료", false);
          }
        },
      },
    ],
  });
}

function confirmDelete(trainingId) {
  const t = state.trainings.find((item) => item.id === trainingId);
  if (!t) return;

  modal.open({
    title: "교육 삭제",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        <strong>${esc(t.title)}</strong> 교육을 삭제하시겠습니까?<br/>
        교육 정보와 배정/완료 연결 데이터가 함께 삭제됩니다.
      </p>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "삭제", variant: "danger",
        onClick: async () => {
          modal.setLoading("삭제", true);
          try {
            await deleteTraining(trainingId);
            toast.success("교육이 삭제되었습니다.");
            modal.close();
            await loadViewData();
          } catch (err) {
            console.error("[instructor-trainings] delete failed", err);
            toast.error("교육 삭제 중 오류가 발생했습니다.");
            modal.setLoading("삭제", false);
          }
        },
      },
    ],
  });
}

// ─── 헬퍼 ──────────────────────────────────────────────────

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
