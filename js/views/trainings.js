/**
 * trainings.js — hq_admin / super_admin 전용 교육 관리 화면
 *
 * - 교육 등록 버튼 없음 (instructor 전용)
 * - 전체 강사 교육 목록 조회
 * - 통계 카드: 전체교육 / 진행중 / 기한촉박 / 기한초과
 * - 필터: 강사별 / 교육명 검색 / 회사·지점 / 상태
 */

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
  isDeadlineSoon,
  listManagedTrainings,
  loadTrainingReferences,
  saveTraining,
} from "../services/training-service.js";
import { authStore, ROLES } from "../core/auth.js";

/** 현재 활성 통계 필터 (null = 전체) */
let activeStatFilter = null;

let trainingState = {
  references: null,
  trainings: [],
};

export async function render(container) {
  // hq_admin은 등록 버튼 없음, super_admin도 동일
  const canRegister = false;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">교육 관리</div>
        <div class="section-subtitle">강사들이 등록한 교육 목록을 조회하고 운영 현황을 관리합니다.</div>
      </div>
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
            <select class="form-control" id="filter-instructor" style="min-width:160px">
              <option value="">전체 강사</option>
            </select>
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

  document.getElementById("search-trainings")?.addEventListener("input", () => renderTrainingTable());
  document.getElementById("filter-instructor")?.addEventListener("change", () => renderTrainingTable());
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

    trainingState = { references, trainings };

    renderInstructorFilter();
    renderBranchFilter();
    renderTrainingStats();
    renderTrainingTable();
  } catch (error) {
    console.error("[trainings] load failed", error);
    toast.error("교육 관리 데이터를 불러오지 못했습니다.");
  }
}

function renderInstructorFilter() {
  const select = document.getElementById("filter-instructor");
  if (!select) return;

  // 목록에 실제 등장한 강사 uid 추출
  const instructorMap = new Map();
  trainingState.trainings.forEach((t) => {
    if (t.instructorId && t.instructorName) {
      instructorMap.set(t.instructorId, t.instructorName);
    }
  });

  const options = Array.from(instructorMap.entries())
    .map(([uid, name]) => `<option value="${uid}">${esc(name)}</option>`)
    .join("");

  select.innerHTML = `<option value="">전체 강사</option>${options}`;
}

function renderBranchFilter() {
  const select = document.getElementById("filter-branch");
  if (!select) return;

  const branches = trainingState.references?.branches ?? [];
  select.innerHTML = `
    <option value="">전체 지점</option>
    ${branches.map((b) => `<option value="${b.id}">${esc(b.name ?? b.code ?? b.id)}</option>`).join("")}
  `;
}

function renderTrainingStats() {
  const wrap = document.getElementById("training-stats");
  if (!wrap) return;

  const now = Date.now();
  const list = trainingState.trainings;

  const counts = {
    total:      list.length,
    inProgress: list.filter((t) => computeTrainingStatus(t, now) === "in_progress").length,
    soon:       list.filter((t) => isDeadlineSoon(t, now)).length,
    overdue:    list.filter((t) => computeTrainingStatus(t, now) === "overdue").length,
  };

  const cards = [
    { key: "total",      label: "전체교육",  value: counts.total,      sub: "조회 가능한 전체 교육",      tone: "" },
    { key: "inProgress", label: "진행중",    value: counts.inProgress,  sub: "현재 운영 중인 교육",        tone: "success" },
    { key: "soon",       label: "기한촉박",  value: counts.soon,        sub: `수료기한 3일 이내`,          tone: "warning" },
    { key: "overdue",    label: "기한초과",  value: counts.overdue,     sub: "기한이 지난 교육",           tone: "danger" },
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
      renderTrainingStats();   // 카드 active 상태 갱신
      renderTrainingTable();
    });
  });
}

function renderTrainingTable() {
  const wrap = document.getElementById("trainings-table-wrap");
  if (!wrap) return;

  const filtered = getFilteredTrainings();

  if (!filtered.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">조건에 맞는 교육이 없습니다.</div>
        <div>필터를 조정해 주세요.</div>
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
          <th style="width:100px"></th>
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

  wrap.querySelectorAll(".btn-training-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmCloseTraining(btn.dataset.id);
    });
  });

  wrap.querySelectorAll(".btn-training-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmDeleteTraining(btn.dataset.id);
    });
  });
}

function trainingRow(t) {
  const branchSummary = t.branchNames?.length ? t.branchNames.join(", ") : "전체 지점";
  const soon = isDeadlineSoon(t);
  const actions = [];

  if (t.computedStatus !== "closed") {
    actions.push(`<button class="btn btn--ghost btn--sm btn-training-close" data-id="${t.id}" title="종료 처리">종료</button>`);
  }
  actions.push(`<button class="btn btn--ghost btn--sm btn-training-delete" data-id="${t.id}" title="삭제" style="color:var(--color-danger)">삭제</button>`);

  return `
    <tr data-id="${t.id}" style="cursor:pointer">
      <td>
        <div style="font-weight:var(--weight-semibold);color:var(--gray-800)">${esc(t.title)}</div>
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
      <td>${esc(t.instructorName || "-")}</td>
      <td>${buildStatusChip(t.computedStatus)}</td>
      <td>${formatDate(t.createdAt)}</td>
      <td class="cell--actions">
        <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
          ${actions.join("")}
        </div>
      </td>
    </tr>
  `;
}

function getFilteredTrainings() {
  const now = Date.now();
  const search      = (document.getElementById("search-trainings")?.value ?? "").trim().toLowerCase();
  const instructor  = document.getElementById("filter-instructor")?.value ?? "";
  const status      = document.getElementById("filter-status")?.value ?? "";
  const type        = document.getElementById("filter-type")?.value ?? "";
  const branch      = document.getElementById("filter-branch")?.value ?? "";

  return trainingState.trainings.filter((t) => {
    // 통계 카드 클릭 필터
    if (activeStatFilter === "inProgress" && computeTrainingStatus(t, now) !== "in_progress") return false;
    if (activeStatFilter === "soon"       && !isDeadlineSoon(t, now))                          return false;
    if (activeStatFilter === "overdue"    && computeTrainingStatus(t, now) !== "overdue")       return false;
    // total은 전체 통과

    if (search && ![t.title, t.description, t.instructorName].some((v) => String(v ?? "").toLowerCase().includes(search))) return false;
    if (instructor && t.instructorId !== instructor) return false;
    if (status && t.computedStatus !== status) return false;
    if (type   && t.trainingType   !== type)   return false;
    if (branch && !t.branchIds?.includes(branch)) return false;

    return true;
  });
}

function confirmCloseTraining(trainingId) {
  const t = trainingState.trainings.find((item) => item.id === trainingId);
  if (!t) return;

  modal.open({
    title: "교육 종료 처리",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        <strong>${esc(t.title)}</strong> 교육을 종료 처리하시겠습니까?<br/>
        종료 후 상태는 <strong>종료</strong>로 표시되며, 이력은 계속 조회할 수 있습니다.
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
  const t = trainingState.trainings.find((item) => item.id === trainingId);
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

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
