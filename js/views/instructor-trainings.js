/**
 * instructor-trainings.js — 강사 교육 관리 화면 (Step 2)
 *
 * 탭 구조
 *   [교육 항목]  — 신규: trainingItems / trainingSessions 기반
 *   [기존 교육]  — 레거시: trainings 기반 (기존 데이터 유지)
 *
 * 신규 흐름
 *   1. 교육 항목 등록/관리
 *   2. 항목 행 클릭 → 해당 항목의 회차 목록 인라인 전개
 *   3. 회차 추가 → 교육일자, 수료기한, 지점
 *   4. 회차 상세 → 배정 직원 관리
 *   5. 회차 완료 → 직원 교육이력카드 PASS 생성
 */

import { modal }     from "../utils/modal.js";
import { toast }     from "../utils/toast.js";
import { formatDate } from "../utils/date.js";
import { router }    from "../core/router.js";
import { authStore } from "../core/auth.js";
import { settingsDB } from "../core/db.js";
import {
  /* 기존 trainings 관련 */
  TRAINING_STATUS_LABELS,
  TRAINING_TYPES,
  TRAINING_TYPE_LABELS,
  buildStatusChip,
  buildTrainingPayload,
  closeTraining,
  completeTraining,
  deleteTraining,
  listInstructorTrainings,
  loadTrainingReferences,
  saveTraining,
  /* 신규 Item / Session 관련 */
  ITEM_SUB_TYPE_LABELS,
  SESSION_STATUS_LABELS,
  buildSessionStatusChip,
  createTrainingItem,
  updateTrainingItem,
  deleteTrainingItem,
  listInstructorItems,
  enrichItemRecord,
  createTrainingSession,
  updateTrainingSession,
  closeSession,
  completeSession,
  deleteSession,
  assignEmployeesToSession,
  unassignFromSession,
  getSessionDetail,
  getItemDetail,
} from "../services/training-service.js";
import { render as renderHistoryCards } from "./history-cards.js";
import {
  bucketIncludesTraining,
  getVisibleDeadlineBuckets,
  normalizeNotificationSettings,
} from "../services/notification-settings-service.js";

/* ──────────────────────────────────────────────────────────
   State
────────────────────────────────────────────────────────── */
let activeTab       = "items";   // "items" | "history"
let activeStatFilter = null;
let expandedItemId  = null;      // 현재 회차 패널이 열린 항목 ID

let S = {
  /* 공통 */
  references:          null,
  notificationSettings: null,
  /* 신규 */
  items:               [],       // enrichItemRecord 처리된 교육 항목 배열
  sessionsByItem:      {},       // { [itemId]: session[] }
  sessionDetail:       null,     // 현재 열린 회차 상세 { sessionId, detail }
  allowedBranchIds:    [],
};

/* ──────────────────────────────────────────────────────────
   진입점
────────────────────────────────────────────────────────── */
export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">교육 관리</div>
        <div class="section-subtitle">교육 항목을 등록하고 회차별로 운영합니다.</div>
      </div>
      <div style="display:flex;gap:var(--space-2)" id="header-actions">
        <button class="btn btn--primary" id="btn-new-item">
          <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          교육 항목 추가
        </button>
      </div>
    </div>

    <!-- 탭 -->
    <div style="display:flex;gap:0;border-bottom:2px solid var(--gray-200);margin-bottom:var(--space-5)">
      <button class="tab-btn active" id="tab-items"  style="padding:var(--space-3) var(--space-5);font-size:var(--text-sm)">교육 항목</button>
      <button class="tab-btn" id="tab-history" style="padding:var(--space-3) var(--space-5);font-size:var(--text-sm)">교육이력카드</button>
    </div>

    <!-- 신규: 교육 항목 탭 -->
    <div id="pane-items">
      <div class="dashboard-grid dashboard-grid--compact" id="item-stats" style="margin-bottom:var(--space-5)"></div>
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card__body card__body--compact">
          <div class="input-group">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input class="form-control" id="search-items" type="search" placeholder="교육 항목명으로 검색" />
          </div>
        </div>
      </div>
      <div id="items-body">
        <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-16)">
          <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
        </div>
      </div>
    </div>

    <!-- 강사용 교육이력카드 탭 -->
    <div id="pane-history" style="display:none">
      <div id="instructor-history-root"></div>
    </div>
  `;

  /* 탭 이벤트 */
  document.getElementById("tab-items")?.addEventListener("click",  () => switchTab("items"));
  document.getElementById("tab-history")?.addEventListener("click", () => switchTab("history"));

  /* 신규 항목 이벤트 */
  document.getElementById("btn-new-item")?.addEventListener("click",   () => openItemModal());
  document.getElementById("search-items")?.addEventListener("input",   () => renderItemsTable());

  /* 레거시 이벤트 */

  await loadAll();
}

/* ──────────────────────────────────────────────────────────
   데이터 로드
────────────────────────────────────────────────────────── */
async function loadAll() {
  try {
    const [references, items, notifications] = await Promise.all([
      loadTrainingReferences(),
      listInstructorItems(),
      settingsDB.getNotifications().catch(() => null),
    ]);

    S.references           = references;
    S.items                = items;
    S.notificationSettings = normalizeNotificationSettings(notifications ?? {});
    S.sessionsByItem       = {};

    const details = await Promise.all(items.map((item) => getItemDetail(item.id).catch(() => ({ sessions: [] }))));
    const branchIds = new Set();
    items.forEach((item, index) => {
      (item.branchIds ?? []).forEach((id) => branchIds.add(id));
      const sessions = details[index]?.sessions ?? [];
      S.sessionsByItem[item.id] = sessions;
      sessions.forEach((session) => (session.branchIds ?? []).forEach((id) => branchIds.add(id)));
    });
    S.allowedBranchIds = [...branchIds];

    renderItemStats();
    renderItemsTable();
  } catch (err) {
    console.error("[instructor-trainings] loadAll failed", err);
    toast.error("데이터를 불러오지 못했습니다.");
  }
}

/* ──────────────────────────────────────────────────────────
   탭 전환
────────────────────────────────────────────────────────── */
function switchTab(tab) {
  activeTab = tab;
  document.getElementById("pane-items").style.display   = tab === "items" ? "" : "none";
  document.getElementById("pane-history").style.display = tab === "history" ? "" : "none";
  document.getElementById("tab-items").classList.toggle("active", tab === "items");
  document.getElementById("tab-history").classList.toggle("active", tab === "history");

  const headerBtn = document.getElementById("btn-new-item");
  if (headerBtn) headerBtn.style.display = tab === "items" ? "" : "none";

  if (tab === "history") {
    const root = document.getElementById("instructor-history-root");
    if (root) {
      if (!S.allowedBranchIds.length) {
        root.innerHTML = `<div class="empty-state" style="padding:var(--space-16)"><div class="empty-state__title">조회 가능한 지점이 없습니다.</div><div>담당 교육 회차에 직원을 배정하면 해당 지점 직원의 교육이력카드를 조회할 수 있습니다.</div></div>`;
      } else {
        renderHistoryCards(root, { allowedBranchIds: S.allowedBranchIds });
      }
    }
  }
}

/* ══════════════════════════════════════════════════════════
   ★ 신규: 교육 항목 탭
══════════════════════════════════════════════════════════ */

function renderItemStats() {
  const wrap = document.getElementById("item-stats");
  if (!wrap) return;

  const items    = S.items;
  const total    = items.length;
  const active   = items.filter((i) => {
    const sessions = S.sessionsByItem[i.id] ?? [];
    return sessions.some((s) => s.computedStatus === "in_progress");
  }).length;
  const completed = items.filter((i) => {
    const sessions = S.sessionsByItem[i.id] ?? [];
    return sessions.some((s) => s.computedStatus === "completed");
  }).length;

  wrap.innerHTML = [
    { label: "교육 항목 수",   value: total,     tone: "" },
    { label: "진행중 회차",    value: active,    tone: "success" },
    { label: "완료된 회차",    value: completed, tone: "" },
  ].map(({ label, value, tone }) => `
    <div class="stat-card">
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value ${tone ? `stat-card__value--${tone}` : ""}">${value}</div>
    </div>`).join("");
}

/* 항목 테이블 렌더링 */
function renderItemsTable() {
  const body   = document.getElementById("items-body");
  if (!body) return;

  const search = (document.getElementById("search-items")?.value ?? "").trim().toLowerCase();
  const items  = S.items.filter((i) =>
    !search || String(i.title ?? "").toLowerCase().includes(search)
  );

  if (!items.length) {
    body.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">등록된 교육 항목이 없습니다.</div>
        <div style="margin-top:var(--space-3)">
          <button class="btn btn--primary btn--sm" id="btn-empty-new-item">교육 항목 추가</button>
        </div>
      </div>`;
    body.querySelector("#btn-empty-new-item")?.addEventListener("click", () => openItemModal());
    return;
  }

  body.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>교육 항목명</th>
            <th>교육유형</th>
            <th>초기/보수</th>
            <th>기본 교육시간</th>
            <th>비고</th>
            <th style="width:140px"></th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => itemRow(item)).join("")}
        </tbody>
      </table>
    </div>`;

  /* 행 클릭 → 회차 패널 토글 */
  body.querySelectorAll("tr[data-item-id]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".cell--actions")) return;
      toggleSessionPanel(row.dataset.itemId);
    });
  });

  body.querySelectorAll(".btn-item-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = S.items.find((i) => i.id === btn.dataset.id);
      if (item) openItemModal(item);
    });
  });
  body.querySelectorAll(".btn-item-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmDeleteItem(btn.dataset.id);
    });
  });
  body.querySelectorAll(".btn-add-session").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = S.items.find((i) => i.id === btn.dataset.id);
      if (item) openSessionModal(item);
    });
  });

  /* 이미 열려있던 패널 복원 */
  if (expandedItemId && S.items.find((i) => i.id === expandedItemId)) {
    renderSessionPanel(expandedItemId);
  }
}

function itemRow(item) {
  const isExpanded = expandedItemId === item.id;
  return `
    <tr data-item-id="${item.id}" style="cursor:pointer;${isExpanded ? "background:var(--brand-50,#eff6ff)" : ""}">
      <td>
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="color:var(--gray-400);flex-shrink:0;transition:transform .2s;${isExpanded ? "transform:rotate(90deg)" : ""}">
            <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span style="font-weight:var(--weight-semibold)">${esc(item.title)}</span>
        </div>
      </td>
      <td>${esc(item.typeLabel)}</td>
      <td>${esc(item.subTypeLabel || "–")}</td>
      <td>${item.defaultHours ? `${item.defaultHours}시간` : "–"}</td>
      <td style="color:var(--gray-400);font-size:var(--text-xs)">${esc(item.note || "–")}</td>
      <td class="cell--actions">
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn btn--ghost btn--sm btn-add-session"  data-id="${item.id}" title="회차 추가">회차 추가</button>
          <button class="btn btn--ghost btn--sm btn-item-edit"    data-id="${item.id}" title="수정">수정</button>
          <button class="btn btn--ghost btn--sm btn-item-delete"  data-id="${item.id}" title="삭제" style="color:var(--color-danger)">삭제</button>
        </div>
      </td>
    </tr>
    <tr id="session-panel-${item.id}" style="${isExpanded ? "" : "display:none"}">
      <td colspan="6" style="padding:0;background:var(--gray-50)">
        <div id="session-panel-body-${item.id}" style="padding:var(--space-4)">
          <div style="color:var(--gray-400);font-size:var(--text-sm);padding:var(--space-4)">불러오는 중…</div>
        </div>
      </td>
    </tr>`;
}

/* ──────────────────────────────────────────────────────────
   회차 패널 (항목 행 아래 인라인 전개)
────────────────────────────────────────────────────────── */
async function toggleSessionPanel(itemId) {
  if (expandedItemId === itemId) {
    expandedItemId = null;
    renderItemsTable();
    return;
  }
  /* loadAndRenderSessions 내부에서 expandedItemId 설정 + renderItemsTable 호출 */
  await loadAndRenderSessions(itemId);
}

async function loadAndRenderSessions(itemId) {
  /* 패널 DOM이 존재하도록 먼저 테이블을 렌더 */
  if (expandedItemId !== itemId) {
    expandedItemId = itemId;
    renderItemsTable();
  }

  const panelBody = document.getElementById(`session-panel-body-${itemId}`);
  if (panelBody) {
    panelBody.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-4);color:var(--gray-400);font-size:var(--text-sm)">
        <div class="splash__spinner" style="width:14px;height:14px;border-width:2px;border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
        회차 데이터 불러오는 중…
      </div>`;
  }

  try {
    const detail = await getItemDetail(itemId);
    S.sessionsByItem[itemId] = detail?.sessions ?? [];
    renderSessionPanel(itemId);
    renderItemStats();
  } catch (err) {
    console.error("[instructor-trainings] loadSessions failed", err?.code, err?.message, err);
    const pb = document.getElementById(`session-panel-body-${itemId}`);
    if (pb) pb.innerHTML = `
      <div style="padding:var(--space-4);color:var(--color-danger);font-size:var(--text-sm)">
        회차 데이터를 불러오지 못했습니다. (${err?.message ?? "알 수 없는 오류"})
        <button class="btn btn--ghost btn--sm" style="margin-left:var(--space-2)"
          onclick="this.closest('td').querySelector('button').disabled=true;location.reload()">새로고침</button>
      </div>`;
  }
}

function renderSessionPanel(itemId) {
  const panelBody = document.getElementById(`session-panel-body-${itemId}`);
  if (!panelBody) return;

  const sessions = S.sessionsByItem[itemId] ?? [];
  const item     = S.items.find((i) => i.id === itemId);

  panelBody.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3)">
      <div style="font-size:var(--text-sm);font-weight:var(--weight-semibold);color:var(--gray-700)">
        회차 목록 <span style="font-weight:normal;color:var(--gray-400)">(${sessions.length}건)</span>
      </div>
      <button class="btn btn--primary btn--sm btn-add-session-inner" data-id="${itemId}">+ 회차 추가</button>
    </div>
    ${sessions.length === 0
      ? `<div style="padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">등록된 회차가 없습니다. 회차를 추가해 주세요.</div>`
      : `<table class="data-table" style="font-size:var(--text-xs)">
          <thead>
            <tr>
              <th>교육기간</th>
              <th>수료기한</th>
              <th>지점</th>
              <th>상태</th>
              <th style="width:160px"></th>
            </tr>
          </thead>
          <tbody>
            ${sessions.map((s) => sessionRow(s, item)).join("")}
          </tbody>
        </table>`
    }`;

  panelBody.querySelector(".btn-add-session-inner")?.addEventListener("click", () => {
    if (item) openSessionModal(item);
  });

  panelBody.querySelectorAll(".btn-session-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = (S.sessionsByItem[itemId] ?? []).find((x) => x.id === btn.dataset.sid);
      const i = S.items.find((x) => x.id === itemId);
      if (s && i) openSessionModal(i, s);
    });
  });
  panelBody.querySelectorAll(".btn-session-complete").forEach((btn) => {
    btn.addEventListener("click", () => confirmCompleteSession(btn.dataset.sid, itemId));
  });
  panelBody.querySelectorAll(".btn-session-close").forEach((btn) => {
    btn.addEventListener("click", () => confirmCloseSession(btn.dataset.sid, itemId));
  });
  panelBody.querySelectorAll(".btn-session-delete").forEach((btn) => {
    btn.addEventListener("click", () => confirmDeleteSession(btn.dataset.sid, itemId));
  });
}

function sessionRow(s, item) {
  const period   = (s.startDate && s.endDate)
    ? `${formatDate(s.startDate)} ~ ${formatDate(s.endDate)}`
    : "–";
  const branches = s.branchNames?.length ? s.branchNames.join(", ") : "전체 지점";
  const isDone   = s.computedStatus === "completed";
  const isClosed = s.computedStatus === "closed";

  return `
    <tr>
      <td style="white-space:nowrap">${period}</td>
      <td style="white-space:nowrap">${formatDate(s.deadline)}</td>
      <td>${esc(branches)}</td>
      <td>${buildSessionStatusChip(s.computedStatus)}</td>
      <td class="cell--actions">
        <div style="display:flex;gap:4px;justify-content:flex-end">
          ${!isDone && !isClosed
            ? `<button class="btn btn--ghost btn--sm btn-session-complete"
                data-sid="${s.id}" style="color:var(--color-success,#16a34a)" title="완료 처리">완료</button>`
            : ""}
          ${!isClosed && !isDone
            ? `<button class="btn btn--ghost btn--sm btn-session-close"
                data-sid="${s.id}" title="종료 처리">종료</button>`
            : ""}
          <button class="btn btn--ghost btn--sm btn-session-edit"
            data-sid="${s.id}" title="수정">수정</button>
          <button class="btn btn--ghost btn--sm btn-session-delete"
            data-sid="${s.id}" style="color:var(--color-danger)" title="삭제">삭제</button>
        </div>
      </td>
    </tr>`;
}

/* ──────────────────────────────────────────────────────────
   교육 항목 모달 (등록/수정)
────────────────────────────────────────────────────────── */
function openItemModal(item = null) {
  const label = item ? "수정" : "등록";
  const refs  = S.references;

  modal.open({
    title: item ? "교육 항목 수정" : "교육 항목 등록",
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">교육 항목명</label>
            <input class="form-control" id="it-title" type="text"
              value="${escAttr(item?.title ?? "")}" placeholder="예: 신입직원 직무교육" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육유형</label>
            <select class="form-control" id="it-type">
              ${TRAINING_TYPES.map((t) => `
                <option value="${t}" ${item?.trainingType === t ? "selected" : ""}>${TRAINING_TYPE_LABELS[t]}</option>
              `).join("")}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">초기/보수</label>
            <select class="form-control" id="it-subtype">
              <option value="">구분 없음</option>
              <option value="initial"   ${item?.subType === "initial"   ? "selected" : ""}>초기</option>
              <option value="recurring" ${item?.subType === "recurring" ? "selected" : ""}>보수</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">기본 교육시간 (시간)</label>
            <input class="form-control" id="it-hours" type="number" min="0" step="0.5"
              value="${item?.defaultHours ?? ""}" placeholder="예: 8" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">담당 강사</label>
          <input class="form-control" type="text" value="${escAttr(authStore.name)}" disabled />
          <div class="form-hint">현재 로그인 계정이 담당 강사로 저장됩니다.</div>
        </div>
        <div class="form-group">
          <label class="form-label">비고</label>
          <textarea class="form-control" id="it-note" rows="2"
            placeholder="교육 항목에 대한 메모">${esc(item?.note ?? "")}</textarea>
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label,
        variant: "primary",
        onClick: async () => {
          const title    = document.getElementById("it-title")?.value?.trim();
          const trainType = document.getElementById("it-type")?.value;
          const subType  = document.getElementById("it-subtype")?.value;
          const hours    = parseFloat(document.getElementById("it-hours")?.value ?? "") || 0;
          const note     = document.getElementById("it-note")?.value?.trim() ?? "";

          if (!title) { toast.error("교육 항목명을 입력해 주세요."); return; }
          if (!trainType) { toast.error("교육유형을 선택해 주세요."); return; }

          modal.setLoading(label, true);
          try {
            const values = {
              title, trainingType: trainType, subType, defaultHours: hours, note,
              instructorId: authStore.uid, instructorName: authStore.name,
              companyId: S.references?.company?.id, companyName: S.references?.company?.name,
            };
            if (item) {
              await updateTrainingItem(item.id, values);
              toast.success("교육 항목을 수정했습니다.");
            } else {
              await createTrainingItem(values);
              toast.success("교육 항목을 등록했습니다.");
            }
            modal.close();
            await loadAll();
          } catch (err) {
            console.error("[instructor-trainings] item save failed", err);
            toast.error("저장 중 오류가 발생했습니다.");
            modal.setLoading(label, false);
          }
        },
      },
    ],
  });
}

/* ──────────────────────────────────────────────────────────
   회차 모달 (등록/수정 + 직원 즉시 배정)
────────────────────────────────────────────────────────── */
async function openSessionModal(item, session = null) {
  let existingAssignments = [];
  if (session?.id) {
    try {
      const detail = await getSessionDetail(session.id);
      existingAssignments = detail?.assignments ?? [];
    } catch (err) {
      console.error("[instructor-trainings] session assignments load failed", err);
      toast.error("기존 배정 직원을 불러오지 못했습니다.");
      return;
    }
  }

  const label    = session ? "수정" : "추가";
  const refs     = S.references;
  const branches = refs?.branches ?? [];
  const employees = refs?.employees ?? [];
  const existingBranchIds = session?.branchIds ?? [];

  /* 직원 필터 상태 (모달 내부 클로저로 관리) */
  let filterBranchId = "";
  let filterSearch   = "";
  const originalUids = new Set(existingAssignments.map((a) => a.uid));
  let selectedUids   = new Set(originalUids);

  function getFilteredEmployees() {
    return employees.filter((e) => {
      const matchBranch = !filterBranchId || e.branchId === filterBranchId;
      const matchSearch = !filterSearch
        || String(e.name ?? "").toLowerCase().includes(filterSearch)
        || String(e.empNo ?? "").toLowerCase().includes(filterSearch);
      return matchBranch && matchSearch;
    });
  }

  function renderEmployeePicker() {
    const list = document.getElementById("ss-emp-list");
    if (!list) return;
    const filtered = getFilteredEmployees();
    if (!filtered.length) {
      list.innerHTML = `<div style="padding:var(--space-4);color:var(--gray-400);font-size:var(--text-sm);text-align:center">해당 조건의 직원이 없습니다.</div>`;
      return;
    }
    list.innerHTML = filtered.map((e) => {
      const uid = e.id ?? e.uid;
      const checked = selectedUids.has(uid);
      return `
        <label class="picker-item" style="padding:var(--space-2) var(--space-3)">
          <input type="checkbox" class="ss-emp-cb" value="${uid}" ${checked ? "checked" : ""} />
          <div class="picker-item__body">
            <div class="picker-item__title" style="font-size:var(--text-sm)">${esc(e.name ?? "–")}</div>
            <div class="picker-item__meta">${esc(e.empNo ?? "–")} · ${esc(e.branchName ?? "–")}</div>
          </div>
        </label>`;
    }).join("");

    list.querySelectorAll(".ss-emp-cb").forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked) selectedUids.add(cb.value);
        else            selectedUids.delete(cb.value);
        updateSelCount();
      });
    });
  }

  function updateSelCount() {
    const el = document.getElementById("ss-sel-count");
    if (el) el.textContent = `선택: ${selectedUids.size}명`;
  }

  modal.open({
    title: session ? `회차 수정 — ${esc(item.title)}` : `회차 추가 — ${esc(item.title)}`,
    size:  "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">

        <!-- 교육 기간 -->
        <div class="form-row form-row--3">
          <div class="form-group">
            <label class="form-label form-label--required">교육 시작일</label>
            <input class="form-control" id="ss-start" type="date" value="${toDateInput(session?.startDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육 종료일</label>
            <input class="form-control" id="ss-end" type="date" value="${toDateInput(session?.endDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">수료기한</label>
            <input class="form-control" id="ss-deadline" type="date" value="${toDateInput(session?.deadline)}" />
          </div>
        </div>

        <!-- 비고 -->
        <div class="form-group">
          <label class="form-label">비고</label>
          <input class="form-control" id="ss-note" type="text"
            value="${escAttr(session?.note ?? "")}" placeholder="회차별 메모" />
        </div>

        <!-- 직원 배정 -->
        <div class="form-group">
          <label class="form-label" style="font-weight:var(--weight-semibold)">
            배정 직원 선택
            <span id="ss-sel-count" style="font-weight:normal;color:var(--gray-400);margin-left:var(--space-2)">선택: 0명</span>
          </label>

          <!-- 지점 필터 + 검색 -->
          <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2)">
            <select class="form-control" id="ss-filter-branch" style="flex:0 0 160px">
              <option value="">전체 지점</option>
              ${branches.map((b) => `<option value="${b.id}">${esc(b.name ?? b.code ?? b.id)}</option>`).join("")}
            </select>
            <div class="input-group" style="flex:1">
              <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
                <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
              </svg>
              <input class="form-control" id="ss-filter-search" type="search" placeholder="이름 또는 사번 검색" />
            </div>
            <button class="btn btn--ghost btn--sm" id="ss-select-all" type="button">전체 선택</button>
            <button class="btn btn--ghost btn--sm" id="ss-clear-all" type="button">전체 해제</button>
          </div>

          <!-- 직원 목록 -->
          <div class="picker-list" id="ss-emp-list" style="max-height:240px;overflow-y:auto">
            <div style="padding:var(--space-4);color:var(--gray-400);font-size:var(--text-sm);text-align:center">불러오는 중…</div>
          </div>
          <div class="form-hint">회차 저장 시 선택한 직원 배정이 함께 갱신됩니다.</div>
        </div>

      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label,
        variant: "primary",
        onClick: async () => {
          const startDate = readDate("ss-start");
          const endDate   = readDate("ss-end");
          const deadline  = readDate("ss-deadline");
          const note      = document.getElementById("ss-note")?.value?.trim() ?? "";

          if (!startDate || !endDate || !deadline) { toast.error("교육기간과 수료기한을 모두 입력해 주세요."); return; }
          if (endDate < startDate) { toast.error("종료일은 시작일 이후여야 합니다."); return; }
          if (deadline < endDate)  { toast.error("수료기한은 종료일과 같거나 이후여야 합니다."); return; }

          /* 선택된 직원 branchIds 자동 집계 (지점 저장용) */
          const selectedEmployees = employees.filter((e) => selectedUids.has(e.id ?? e.uid));
          const branchIds   = [...new Set(selectedEmployees.map((e) => e.branchId).filter(Boolean))];
          const branchNames = branchIds.map((bid) =>
            branches.find((b) => b.id === bid)?.name ?? bid
          );

          modal.setLoading(label, true);
          try {
            let sessionId;
            if (session) {
              await updateTrainingSession(session.id, { startDate, endDate, deadline, branchIds, branchNames, note });
              sessionId = session.id;
            } else {
              sessionId = await createTrainingSession(item, {
                startDate, endDate, deadline, branchIds, branchNames, note,
                companyId:   S.references?.company?.id,
                companyName: S.references?.company?.name,
              });
            }

            /* 배정 직원 동기화: 신규 추가 + 체크 해제된 직원 배정 해제 */
            const sessionObj = { id: sessionId, deadline, title: item.title, itemId: item.id };
            const toAdd = [...selectedUids].filter((uid) => !originalUids.has(uid));
            const toRemove = [...originalUids].filter((uid) => !selectedUids.has(uid));
            if (!session && selectedUids.size > 0) {
              await assignEmployeesToSession(sessionObj, [...selectedUids], refs);
            } else {
              if (toAdd.length) await assignEmployeesToSession(sessionObj, toAdd, refs);
              for (const uid of toRemove) await unassignFromSession(sessionId, uid);
            }

            /* 모든 처리 완료 후 단일 알림 */
            const msg = session
              ? `회차를 수정했습니다. (배정 ${selectedUids.size}명)`
              : `회차를 추가했습니다.${selectedUids.size ? ` (${selectedUids.size}명 배정)` : ""}`;
            toast.success(msg);

            modal.close();
            await loadAndRenderSessions(item.id);
          } catch (err) {
            console.error("[instructor-trainings] session save failed", err?.code, err?.message, err);
            toast.error(`저장 중 오류가 발생했습니다: ${err?.message ?? "알 수 없는 오류"}`);
            modal.setLoading(label, false);
          }
        },
      },
    ],
  });

  /* 모달 열린 후 이벤트 바인딩 (requestAnimationFrame으로 DOM 렌더 보장) */
  requestAnimationFrame(() => {
    renderEmployeePicker();

    document.getElementById("ss-filter-branch")?.addEventListener("change", (e) => {
      filterBranchId = e.target.value;
      renderEmployeePicker();
    });
    document.getElementById("ss-filter-search")?.addEventListener("input", (e) => {
      filterSearch = e.target.value.trim().toLowerCase();
      renderEmployeePicker();
    });
    document.getElementById("ss-select-all")?.addEventListener("click", () => {
      getFilteredEmployees().forEach((e) => selectedUids.add(e.id ?? e.uid));
      renderEmployeePicker();
      updateSelCount();
    });
    document.getElementById("ss-clear-all")?.addEventListener("click", () => {
      getFilteredEmployees().forEach((e) => selectedUids.delete(e.id ?? e.uid));
      renderEmployeePicker();
      updateSelCount();
    });
  });
}

/* ──────────────────────────────────────────────────────────
   회차 배정 모달 (배정 관리)
────────────────────────────────────────────────────────── */
async function openSessionDetailModal(sessionId, itemId) {
  /* 로딩 표시 */
  modal.open({
    title: "배정 관리",
    size: "lg",
    body: `<div style="display:flex;justify-content:center;padding:var(--space-10)">
      <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
    </div>`,
    actions: [{ label: "닫기", variant: "secondary", onClick: () => modal.close() }],
  });

  try {
    const detail = await getSessionDetail(sessionId);
    if (!detail) { toast.error("회차 정보를 찾을 수 없습니다."); modal.close(); return; }

    S.sessionDetail = { sessionId, detail };
    renderSessionDetailBody(detail, itemId);
  } catch (err) {
    console.error("[instructor-trainings] session detail failed", err);
    toast.error("회차 정보를 불러오지 못했습니다.");
    modal.close();
  }
}

function renderSessionDetailBody(detail, itemId) {
  const { session, assignments, completions, references } = detail;
  const assignedUids = new Set(assignments.map((a) => a.uid));
  const completedUids = new Set(completions.map((c) => c.uid));
  const employees    = references?.employees ?? [];

  const period = (session.startDate && session.endDate)
    ? `${formatDate(session.startDate)} ~ ${formatDate(session.endDate)}`
    : "–";

  /* 배정 가능한 직원 목록 */
  const candidates = employees.filter((e) => {
    const uid = e.id ?? e.uid;
    return !assignedUids.has(uid);
  });

  const body = `
    <div style="display:flex;flex-direction:column;gap:var(--space-5)">
      <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;font-size:var(--text-sm);color:var(--gray-600)">
        <span>교육기간: <strong>${period}</strong></span>
        <span>수료기한: <strong>${formatDate(session.deadline)}</strong></span>
        <span>상태: ${buildSessionStatusChip(session.computedStatus)}</span>
      </div>

      <!-- 배정 현황 -->
      <div>
        <div style="font-weight:var(--weight-semibold);font-size:var(--text-sm);margin-bottom:var(--space-2)">
          배정 현황 (${assignments.length}명)
        </div>
        ${assignments.length === 0
          ? `<div style="color:var(--gray-400);font-size:var(--text-sm)">배정된 직원이 없습니다.</div>`
          : `<table class="data-table" style="font-size:var(--text-xs)">
              <thead><tr><th>이름</th><th>사번</th><th>지점</th><th>수료 상태</th><th style="width:80px"></th></tr></thead>
              <tbody>
                ${assignments.map((a) => `
                  <tr>
                    <td>${esc(a.name)}</td>
                    <td style="font-family:monospace">${esc(a.empNo)}</td>
                    <td>${esc(a.branchName)}</td>
                    <td>${completedUids.has(a.uid)
                      ? `<span class="chip chip--success">수료</span>`
                      : `<span class="chip chip--neutral">대기</span>`}</td>
                    <td class="cell--actions">
                      <button class="btn btn--ghost btn--sm btn-unassign-session"
                        data-uid="${a.uid}" style="color:var(--color-danger)">해제</button>
                    </td>
                  </tr>`).join("")}
              </tbody>
            </table>`
        }
      </div>

      <!-- 직원 배정 -->
      <div>
        <div style="font-weight:var(--weight-semibold);font-size:var(--text-sm);margin-bottom:var(--space-2)">직원 배정</div>
        <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2)">
          <div class="input-group" style="flex:1">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input class="form-control" id="detail-search" type="search" placeholder="이름, 사번으로 검색" />
          </div>
          <button class="btn btn--primary btn--sm" id="btn-do-assign">선택 배정</button>
        </div>
        <div class="picker-list" id="candidate-picker" style="max-height:200px">
          ${candidates.length === 0
            ? `<div style="padding:var(--space-4);color:var(--gray-400);font-size:var(--text-sm)">배정 가능한 직원이 없습니다.</div>`
            : candidates.map((e) => {
                const uid = e.id ?? e.uid;
                return `
                  <label class="picker-item">
                    <input type="checkbox" class="candidate-cb" value="${uid}" />
                    <div class="picker-item__body">
                      <div class="picker-item__title">${esc(e.name ?? "–")}</div>
                      <div class="picker-item__meta">${esc(e.empNo ?? "–")} · ${esc(e.branchName ?? "–")}</div>
                    </div>
                  </label>`;
              }).join("")}
        </div>
      </div>
    </div>`;

  /* 모달 body 교체 */
  const modalBody = document.querySelector(".modal__body");
  if (modalBody) modalBody.innerHTML = body;

  /* 검색 필터 */
  document.getElementById("detail-search")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".candidate-cb").forEach((cb) => {
      const item = cb.closest(".picker-item");
      const text = item?.textContent?.toLowerCase() ?? "";
      item.style.display = q && !text.includes(q) ? "none" : "";
    });
  });

  /* 배정 실행 */
  document.getElementById("btn-do-assign")?.addEventListener("click", async () => {
    const ids = Array.from(document.querySelectorAll(".candidate-cb:checked")).map((c) => c.value);
    if (!ids.length) { toast.warning("배정할 직원을 선택해 주세요."); return; }
    try {
      await assignEmployeesToSession(
        { ...session, id: sessionId },
        ids,
        S.sessionDetail?.detail?.references
      );
      toast.success(`${ids.length}명을 배정했습니다.`);
      const newDetail = await getSessionDetail(sessionId);
      S.sessionDetail = { sessionId, detail: newDetail };
      renderSessionDetailBody(newDetail, itemId);
    } catch (err) {
      console.error("[instructor-trainings] assign session failed", err);
      toast.error("배정 중 오류가 발생했습니다.");
    }
  });

  /* 배정 해제 */
  document.querySelectorAll(".btn-unassign-session").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await unassignFromSession(sessionId, btn.dataset.uid);
        toast.success("배정을 해제했습니다.");
        const newDetail = await getSessionDetail(sessionId);
        S.sessionDetail = { sessionId, detail: newDetail };
        renderSessionDetailBody(newDetail, itemId);
      } catch (err) {
        console.error("[instructor-trainings] unassign session failed", err);
        toast.error("배정 해제 중 오류가 발생했습니다.");
      }
    });
  });
}

/* ──────────────────────────────────────────────────────────
   회차 완료 확인
────────────────────────────────────────────────────────── */
function confirmCompleteSession(sessionId, itemId) {
  modal.open({
    title: "회차 완료 처리",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        이 회차를 완료 처리하시겠습니까?<br/>
        배정된 직원의 교육 이력카드에 자동으로 <strong>PASS</strong> 수료 기록이 생성됩니다.
      </p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "완료",
        variant: "primary",
        onClick: async () => {
          modal.setLoading("완료", true);
          try {
            await completeSession(sessionId);
            toast.success("회차를 완료 처리했습니다. 직원 이력카드에 수료 기록이 생성되었습니다.");
            modal.close();
            await loadAndRenderSessions(itemId);
          } catch (err) {
            if (err?.message === "NO_ASSIGNMENTS") {
              toast.error("배정된 직원이 없습니다. 먼저 직원을 배정해 주세요.");
            } else {
              console.error("[instructor-trainings] completeSession failed", err);
              toast.error("완료 처리 중 오류가 발생했습니다.");
            }
            modal.setLoading("완료", false);
          }
        },
      },
    ],
  });
}

/* ──────────────────────────────────────────────────────────
   회차 종료 확인
────────────────────────────────────────────────────────── */
function confirmCloseSession(sessionId, itemId) {
  modal.open({
    title: "회차 종료",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">이 회차를 종료 처리하시겠습니까?<br/>수료 기록은 생성되지 않습니다.</p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "종료",
        variant: "primary",
        onClick: async () => {
          modal.setLoading("종료", true);
          try {
            await closeSession(sessionId);
            toast.success("회차를 종료했습니다.");
            modal.close();
            await loadAndRenderSessions(itemId);
          } catch (err) {
            console.error("[instructor-trainings] closeSession failed", err);
            toast.error("오류가 발생했습니다.");
            modal.setLoading("종료", false);
          }
        },
      },
    ],
  });
}

/* ──────────────────────────────────────────────────────────
   회차 삭제 확인
────────────────────────────────────────────────────────── */
function confirmDeleteSession(sessionId, itemId) {
  modal.open({
    title: "회차 삭제",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">이 회차를 삭제하시겠습니까?<br/>배정 및 수료 데이터도 함께 삭제됩니다.</p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "삭제",
        variant: "danger",
        onClick: async () => {
          modal.setLoading("삭제", true);
          try {
            await deleteSession(sessionId);
            toast.success("회차를 삭제했습니다.");
            modal.close();
            await loadAndRenderSessions(itemId);
          } catch (err) {
            console.error("[instructor-trainings] deleteSession failed", err);
            toast.error("삭제 중 오류가 발생했습니다.");
            modal.setLoading("삭제", false);
          }
        },
      },
    ],
  });
}

/* ──────────────────────────────────────────────────────────
   항목 삭제 확인
────────────────────────────────────────────────────────── */
function confirmDeleteItem(itemId) {
  const item = S.items.find((i) => i.id === itemId);
  if (!item) return;

  modal.open({
    title: "교육 항목 삭제",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        <strong>${esc(item.title)}</strong> 항목을 삭제하시겠습니까?<br/>
        연결된 모든 회차와 배정/수료 데이터도 함께 삭제됩니다.
      </p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "삭제",
        variant: "danger",
        onClick: async () => {
          modal.setLoading("삭제", true);
          try {
            await deleteTrainingItem(itemId);
            toast.success("교육 항목을 삭제했습니다.");
            if (expandedItemId === itemId) expandedItemId = null;
            modal.close();
            await loadAll();
          } catch (err) {
            console.error("[instructor-trainings] deleteItem failed", err);
            toast.error("삭제 중 오류가 발생했습니다.");
            modal.setLoading("삭제", false);
          }
        },
      },
    ],
  });
}

/* ══════════════════════════════════════════════════════════
   레거시: 기존 trainings 탭 (기존 코드 완전 보존)
══════════════════════════════════════════════════════════ */

function renderBranchFilter() {
  const select = document.getElementById("filter-branch");
  if (!select) return;
  const branches = S.references?.branches ?? [];
  select.innerHTML = `
    <option value="">전체 지점</option>
    ${branches.map((b) => `<option value="${b.id}">${esc(b.name ?? b.code ?? b.id)}</option>`).join("")}
  `;
}

function renderTrainingStats() {
  const wrap = document.getElementById("training-stats");
  if (!wrap) return;

  const visibleBuckets = getVisibleDeadlineBuckets(S.notificationSettings);
  wrap.innerHTML = visibleBuckets.map((bucket) => {
    const count = S.trainings.filter((t) => bucketIncludesTraining(bucket, t)).length;
    const sub  = bucket.type === "completed" ? "완료 처리된 교육"
               : bucket.type === "overdue"   ? "수료기한이 지난 교육"
               : `오늘부터 ${bucket.days}일 이내 마감`;
    const tone = bucket.type === "completed" ? "success"
               : bucket.type === "overdue"   ? "danger"
               : "warning";
    return `
      <div class="stat-card stat-card--clickable ${activeStatFilter === bucket.key ? "stat-card--active" : ""}"
        data-filter-key="${bucket.key}" style="cursor:pointer">
        <div class="stat-card__label">${esc(bucket.label)}</div>
        <div class="stat-card__value ${tone ? `stat-card__value--${tone}` : ""}">${count}</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:2px">${sub}</div>
      </div>`;
  }).join("");

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

  const filtered = getLegacyFiltered();
  if (!filtered.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">조건에 맞는 교육이 없습니다.</div>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>교육명</th><th>교육유형</th><th>회사/지점</th>
          <th>교육기간</th><th>수료기한</th><th>상태</th><th>생성일</th>
          <th style="width:160px"></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((t) => legacyTrainingRow(t)).join("")}
      </tbody>
    </table>`;

  wrap.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".cell--actions")) return;
      router.push("training-detail", { id: row.dataset.id });
    });
  });
  wrap.querySelectorAll(".btn-training-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = S.trainings.find((x) => x.id === btn.dataset.id);
      if (t) openTrainingModal(t);
    });
  });
  wrap.querySelectorAll(".btn-training-complete").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); confirmComplete(btn.dataset.id); });
  });
  wrap.querySelectorAll(".btn-training-close").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); confirmClose(btn.dataset.id); });
  });
  wrap.querySelectorAll(".btn-training-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); confirmDelete(btn.dataset.id); });
  });
}

function legacyTrainingRow(training) {
  const branchSummary = training.branchNames?.length ? training.branchNames.join(", ") : "전체 지점";
  const isOwner       = training.createdBy === authStore.uid;
  const isInstructor  = training.instructorId === authStore.uid;
  const canAct        = isOwner || isInstructor;
  const isCompleted   = training.computedStatus === "completed";
  const isClosed      = training.computedStatus === "closed";
  const actions       = [];

  if (isOwner) actions.push(`<button class="btn btn--ghost btn--sm btn-training-edit" data-id="${training.id}">수정</button>`);
  if (canAct && !isCompleted) actions.push(`<button class="btn btn--ghost btn--sm btn-training-complete" data-id="${training.id}" style="color:var(--color-success,#16a34a)">완료</button>`);
  if (!isClosed && !isCompleted && canAct) actions.push(`<button class="btn btn--ghost btn--sm btn-training-close" data-id="${training.id}">종료</button>`);
  if (isOwner) actions.push(`<button class="btn btn--ghost btn--sm btn-training-delete" data-id="${training.id}" style="color:var(--color-danger)">삭제</button>`);

  return `
    <tr data-id="${training.id}" style="cursor:pointer">
      <td><div style="font-weight:var(--weight-semibold)">${esc(training.title)}</div></td>
      <td>${esc(training.typeLabel)}</td>
      <td>
        <div>${esc(training.companyName || "–")}</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400)">${esc(branchSummary)}</div>
      </td>
      <td style="white-space:nowrap">${formatDate(training.startDate)} ~ ${formatDate(training.endDate)}</td>
      <td style="white-space:nowrap">${formatDate(training.deadline)}</td>
      <td>${buildStatusChip(training.computedStatus)}</td>
      <td>${formatDate(training.createdAt)}</td>
      <td class="cell--actions">
        <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
          ${actions.join("") || `<span style="font-size:var(--text-xs);color:var(--gray-400)">조회 전용</span>`}
        </div>
      </td>
    </tr>`;
}

function getLegacyFiltered() {
  const search = (document.getElementById("search-trainings")?.value ?? "").trim().toLowerCase();
  const status = document.getElementById("filter-status")?.value ?? "";
  const type   = document.getElementById("filter-type")?.value ?? "";
  const branch = document.getElementById("filter-branch")?.value ?? "";
  const activeBucket = S.notificationSettings?.deadlineBuckets?.find((b) => b.key === activeStatFilter) ?? null;

  return S.trainings.filter((t) => {
    if (activeBucket && !bucketIncludesTraining(activeBucket, t)) return false;
    if (search && ![t.title, t.description].some((v) => String(v ?? "").toLowerCase().includes(search))) return false;
    if (status && t.computedStatus !== status) return false;
    if (type   && t.trainingType   !== type)   return false;
    if (branch && !t.branchIds?.includes(branch)) return false;
    return true;
  });
}

/* 레거시 교육 등록/수정 모달 */
function openTrainingModal(training = null) {
  const label   = training ? "수정" : "등록";
  const refs    = S.references;
  const branchIds = training?.branchIds ?? [];

  modal.open({
    title: training ? "교육 수정" : "교육 등록 (기존 방식)",
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">교육명</label>
            <input class="form-control" id="t-title" type="text"
              value="${escAttr(training?.title ?? "")}" placeholder="예: 2026 서비스교육" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">교육유형</label>
            <select class="form-control" id="t-type">
              ${TRAINING_TYPES.map((t) => `<option value="${t}" ${training?.trainingType === t ? "selected" : ""}>${TRAINING_TYPE_LABELS[t]}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">회사</label>
            <input class="form-control" type="text" value="${escAttr(refs?.company?.name || "–")}" disabled />
          </div>
          <div class="form-group">
            <label class="form-label">담당 강사</label>
            <input class="form-control" type="text" value="${escAttr(authStore.name)}" disabled />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label form-label--required">지점</label>
          <div class="selection-grid">
            ${(refs?.branches ?? []).map((b) => `
              <label class="selection-chip">
                <input type="checkbox" class="branch-selector" value="${b.id}"
                  ${branchIds.includes(b.id) ? "checked" : ""} />
                <span>${esc(b.name ?? b.code ?? b.id)}</span>
              </label>`).join("")}
          </div>
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
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label, variant: "primary", onClick: () => submitLegacyForm(training?.id ?? null, label) },
    ],
  });
}

async function submitLegacyForm(trainingId, label) {
  const refs    = S.references;
  const current = trainingId ? S.trainings.find((t) => t.id === trainingId) : null;
  const title   = document.getElementById("t-title")?.value?.trim();
  const trainType = document.getElementById("t-type")?.value;
  const branchIds = Array.from(document.querySelectorAll(".branch-selector:checked")).map((c) => c.value);
  const startDate = readDate("t-start");
  const endDate   = readDate("t-end");
  const deadline  = readDate("t-deadline");

  if (!title)                              { toast.error("교육명을 입력해 주세요."); return; }
  if (!startDate || !endDate || !deadline) { toast.error("날짜를 모두 입력해 주세요."); return; }
  if (endDate < startDate)                 { toast.error("종료일은 시작일 이후여야 합니다."); return; }
  if (deadline < endDate)                  { toast.error("수료기한은 종료일과 같거나 이후여야 합니다."); return; }

  modal.setLoading(label, true);
  try {
    const payload = buildTrainingPayload(
      { title, trainingType: trainType, description: "", instructorId: authStore.uid,
        instructorName: authStore.name, branchIds, startDate, endDate, deadline },
      refs, current
    );
    if (!trainingId) {
      payload.createdBy = authStore.uid;
      payload.createdByName = authStore.name;
      payload.instructorId = authStore.uid;
      payload.instructorName = authStore.name;
    }
    payload.updatedAt = Date.now();
    await saveTraining(payload, trainingId);
    toast.success(trainingId ? "교육을 수정했습니다." : "교육을 등록했습니다.");
    modal.close();
    await loadAll();
  } catch (err) {
    console.error("[instructor-trainings] legacy save failed", err);
    toast.error("저장 중 오류가 발생했습니다.");
    modal.setLoading(label, false);
  }
}

function confirmComplete(trainingId) {
  const t = S.trainings.find((x) => x.id === trainingId);
  if (!t) return;
  modal.open({
    title: "교육 완료 처리", size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      <strong>${esc(t.title)}</strong> 교육을 완료 처리하시겠습니까?<br/>
      배정된 직원의 교육 이력카드에 자동으로 수료 기록이 생성됩니다.</p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "완료", variant: "primary", onClick: async () => {
        modal.setLoading("완료", true);
        try {
          await completeTraining(trainingId);
          toast.success("교육을 완료 처리했습니다.");
          modal.close(); await loadAll();
        } catch (err) {
          if (err?.message === "NO_ASSIGNMENTS") toast.error("배정된 직원이 없습니다.");
          else toast.error("완료 처리 중 오류가 발생했습니다.");
          modal.setLoading("완료", false);
        }
      }},
    ],
  });
}

function confirmClose(trainingId) {
  const t = S.trainings.find((x) => x.id === trainingId);
  if (!t) return;
  modal.open({
    title: "교육 종료 처리", size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      <strong>${esc(t.title)}</strong> 교육을 종료 처리하시겠습니까?</p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "종료", variant: "primary", onClick: async () => {
        modal.setLoading("종료", true);
        try {
          await closeTraining(trainingId);
          toast.success("교육을 종료했습니다.");
          modal.close(); await loadAll();
        } catch (err) {
          toast.error("오류가 발생했습니다.");
          modal.setLoading("종료", false);
        }
      }},
    ],
  });
}

function confirmDelete(trainingId) {
  const t = S.trainings.find((x) => x.id === trainingId);
  if (!t) return;
  modal.open({
    title: "교육 삭제", size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      <strong>${esc(t.title)}</strong> 교육을 삭제하시겠습니까?<br/>
      배정/수료 데이터도 함께 삭제됩니다.</p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "삭제", variant: "danger", onClick: async () => {
        modal.setLoading("삭제", true);
        try {
          await deleteTraining(trainingId);
          toast.success("삭제했습니다.");
          modal.close(); await loadAll();
        } catch (err) {
          toast.error("삭제 중 오류가 발생했습니다.");
          modal.setLoading("삭제", false);
        }
      }},
    ],
  });
}

/* ──────────────────────────────────────────────────────────
   공통 헬퍼
────────────────────────────────────────────────────────── */
function readDate(id) {
  const v = document.getElementById(id)?.value;
  return v ? new Date(`${v}T00:00:00`).getTime() : null;
}
function toDateInput(ts) {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "";
}
function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(v) {
  return esc(v).replace(/'/g, "&#39;");
}
