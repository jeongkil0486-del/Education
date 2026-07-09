import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { formatDate } from "../utils/date.js";
import { router } from "../core/router.js";
import { settingsDB } from "../core/db.js";
import {
  TRAINING_STATUS_LABELS,
  TRAINING_TYPES,
  TRAINING_TYPE_LABELS,
  buildStatusChip,
  closeTraining,
  computeTrainingStatus,
  deleteTraining,
  listManagedTrainings,
  loadTrainingReferences,
} from "../services/training-service.js";
import {
  getVisibleDeadlineBuckets,
  normalizeNotificationSettings,
  bucketIncludesTraining,
} from "../services/notification-settings-service.js";

let activeStatFilter = null;
let state = {
  references: null,
  trainings: [],
  notificationSettings: null,
};

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">교육 관리</div>
        <div class="section-subtitle">강사가 등록한 교육 목록을 조회하고 운영 현황을 관리합니다.</div>
      </div>
    </div>

    <div class="dashboard-grid dashboard-grid--compact" id="training-stats" style="margin-bottom:var(--space-5)"></div>

    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card__body" style="padding:var(--space-4)">
        <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-3)">
          <div class="input-group" style="flex:2;min-width:200px">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input class="form-control" id="search-trainings" type="search" placeholder="교육명으로 검색" />
          </div>
          <select class="form-control" id="filter-instructor" style="flex:1;min-width:140px">
            <option value="">전체 강사</option>
          </select>
        </div>
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
          <select class="form-control" id="filter-status" style="flex:1;min-width:110px">
            <option value="">전체 상태</option>
            ${Object.entries(TRAINING_STATUS_LABELS).map(([key, value]) => `<option value="${key}">${value}</option>`).join("")}
          </select>
          <select class="form-control" id="filter-type" style="flex:1;min-width:110px">
            <option value="">전체 유형</option>
            ${TRAINING_TYPES.map((type) => `<option value="${type}">${TRAINING_TYPE_LABELS[type]}</option>`).join("")}
          </select>
          <select class="form-control" id="filter-branch" style="flex:1;min-width:130px">
            <option value="">전체 지점</option>
          </select>
        </div>
      </div>
    </div>

    <div class="table-wrap" id="trainings-table-wrap">
      <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-12)">
        <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>
    </div>
  `;

  document.getElementById("search-trainings")?.addEventListener("input", renderTable);
  document.getElementById("filter-instructor")?.addEventListener("change", renderTable);
  document.getElementById("filter-status")?.addEventListener("change", renderTable);
  document.getElementById("filter-type")?.addEventListener("change", renderTable);
  document.getElementById("filter-branch")?.addEventListener("change", renderTable);

  await loadData();
}

async function loadData() {
  try {
    const [references, trainings, notifications] = await Promise.all([
      loadTrainingReferences(),
      listManagedTrainings(),
      settingsDB.getNotifications().catch(() => null),
    ]);

    state = {
      references,
      trainings,
      notificationSettings: normalizeNotificationSettings(notifications ?? {}),
    };
    if (!getVisibleDeadlineBuckets(state.notificationSettings).some((bucket) => bucket.key === activeStatFilter)) {
      activeStatFilter = null;
    }

    fillInstructorFilter();
    fillBranchFilter();
    renderStats();
    renderTable();
  } catch (err) {
    console.error("[trainings] load failed", err?.message, err);
    toast.error("교육 데이터를 불러오지 못했습니다.");
  }
}

function fillInstructorFilter() {
  const select = document.getElementById("filter-instructor");
  if (!select) return;

  const byId = new Map();
  const byName = new Map();

  state.trainings.forEach((training) => {
    if (training.instructorId && training.instructorName) {
      if (!byId.has(training.instructorId)) byId.set(training.instructorId, training.instructorName);
    } else if (training.instructorName) {
      byName.set(training.instructorName, true);
    }
  });

  const optionsById = Array.from(byId.entries())
    .map(([uid, name]) => `<option value="${uid}">${esc(name)}</option>`);
  const optionsByName = Array.from(byName.keys())
    .filter((name) => ![...byId.values()].includes(name))
    .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`);

  select.innerHTML = `<option value="">전체 강사</option>${optionsById.join("")}${optionsByName.join("")}`;
}

function fillBranchFilter() {
  const select = document.getElementById("filter-branch");
  if (!select) return;

  const branches = state.references?.branches ?? [];
  select.innerHTML = `<option value="">전체 지점</option>${
    branches.map((branch) => `<option value="${branch.id}">${esc(branch.name ?? branch.code ?? branch.id)}</option>`).join("")
  }`;
}

function renderStats() {
  const wrap = document.getElementById("training-stats");
  if (!wrap) return;

  const visibleBuckets = getVisibleDeadlineBuckets(state.notificationSettings);
  wrap.innerHTML = visibleBuckets.map((bucket) => {
    const count = state.trainings.filter((training) => bucketIncludesTraining(bucket, training)).length;
    const sub = bucket.type === "overdue"
      ? "수료기한이 지난 교육"
      : `오늘부터 ${bucket.days}일 이내 마감`;
    const tone = bucket.type === "overdue" ? "danger" : "warning";

    return `
      <div class="stat-card stat-card--clickable ${activeStatFilter === bucket.key ? "stat-card--active" : ""}" data-key="${bucket.key}" style="cursor:pointer">
        <div class="stat-card__label">${esc(bucket.label)}</div>
        <div class="stat-card__value ${tone ? `stat-card__value--${tone}` : ""}">${count}</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:2px">${sub}</div>
      </div>
    `;
  }).join("");

  wrap.querySelectorAll(".stat-card--clickable").forEach((card) => {
    card.addEventListener("click", () => {
      activeStatFilter = activeStatFilter === card.dataset.key ? null : card.dataset.key;
      renderStats();
      renderTable();
    });
  });
}

function renderTable() {
  const wrap = document.getElementById("trainings-table-wrap");
  if (!wrap) return;

  const search = (document.getElementById("search-trainings")?.value ?? "").trim().toLowerCase();
  const instructor = document.getElementById("filter-instructor")?.value ?? "";
  const status = document.getElementById("filter-status")?.value ?? "";
  const type = document.getElementById("filter-type")?.value ?? "";
  const branch = document.getElementById("filter-branch")?.value ?? "";
  const activeBucket = state.notificationSettings?.deadlineBuckets?.find((bucket) => bucket.key === activeStatFilter) ?? null;

  const filtered = state.trainings.filter((training) => {
    if (activeBucket && !bucketIncludesTraining(activeBucket, training)) return false;
    if (search && !String(training.title ?? "").toLowerCase().includes(search)) return false;
    if (instructor && training.instructorId !== instructor && training.instructorName !== instructor) return false;
    if (status && training.computedStatus !== status) return false;
    if (type && training.trainingType !== type) return false;
    if (branch && !training.branchIds?.includes(branch)) return false;
    return true;
  });

  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-16)"><div class="empty-state__title">조건에 맞는 교육이 없습니다.</div></div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>교육명</th>
          <th>유형</th>
          <th>회사/지점</th>
          <th>교육기간</th>
          <th>수료기한</th>
          <th>담당 강사</th>
          <th>상태</th>
          <th>생성일</th>
          <th style="width:90px"></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((training) => {
          const branchSummary = training.branchNames?.length ? training.branchNames.join(", ") : "전체 지점";
          return `
            <tr data-id="${training.id}" style="cursor:pointer">
              <td><div style="font-weight:var(--weight-semibold);color:var(--gray-800)">${esc(training.title)}</div></td>
              <td>${esc(TRAINING_TYPE_LABELS[training.trainingType] ?? "기타")}</td>
              <td><div>${esc(training.companyName || "-")}</div><div style="font-size:var(--text-xs);color:var(--gray-400)">${esc(branchSummary)}</div></td>
              <td style="white-space:nowrap">${formatDate(training.startDate)} ~ ${formatDate(training.endDate)}</td>
              <td style="white-space:nowrap">${formatDate(training.deadline)}</td>
              <td>${esc(training.instructorName || "-")}</td>
              <td>${buildStatusChip(training.computedStatus)}</td>
              <td>${formatDate(training.createdAt)}</td>
              <td class="cell--actions">
                <div style="display:flex;gap:4px;justify-content:flex-end">
                  ${training.computedStatus !== "closed" ? `<button class="btn btn--ghost btn--sm btn-close" data-id="${training.id}">종료</button>` : ""}
                  <button class="btn btn--ghost btn--sm btn-del" data-id="${training.id}" style="color:var(--color-danger)">삭제</button>
                </div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (!event.target.closest(".cell--actions")) {
        router.push("training-detail", { id: row.dataset.id });
      }
    });
  });
  wrap.querySelectorAll(".btn-close").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      confirmClose(button.dataset.id);
    });
  });
  wrap.querySelectorAll(".btn-del").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      confirmDelete(button.dataset.id);
    });
  });
}

function confirmClose(id) {
  const training = state.trainings.find((item) => item.id === id);
  if (!training) return;

  modal.open({
    title: "교육 종료 처리",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)"><strong>${esc(training.title)}</strong> 교육을 종료 처리하시겠습니까?</p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "종료",
        variant: "primary",
        onClick: async () => {
          modal.setLoading("종료", true);
          try {
            await closeTraining(id);
            toast.success("교육을 종료 처리했습니다.");
            modal.close();
            await loadData();
          } catch (err) {
            console.error("[trainings] close", err?.message, err);
            toast.error("오류가 발생했습니다.");
            modal.setLoading("종료", false);
          }
        },
      },
    ],
  });
}

function confirmDelete(id) {
  const training = state.trainings.find((item) => item.id === id);
  if (!training) return;

  modal.open({
    title: "교육 삭제",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)"><strong>${esc(training.title)}</strong> 교육을 삭제하시겠습니까?</p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "삭제",
        variant: "danger",
        onClick: async () => {
          modal.setLoading("삭제", true);
          try {
            await deleteTraining(id);
            toast.success("삭제했습니다.");
            modal.close();
            await loadData();
          } catch (err) {
            console.error("[trainings] delete", err?.message, err);
            toast.error("오류가 발생했습니다.");
            modal.setLoading("삭제", false);
          }
        },
      },
    ],
  });
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
