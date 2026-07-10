/**
 * instructor-trainings.js ??媛뺤궗 援먯쑁 愿由??붾㈃ (Step 2)
 *
 * ??援ъ“
 *   [援먯쑁 ??ぉ]  ???좉퇋: trainingItems / trainingSessions 湲곕컲
 *   [湲곗〈 援먯쑁]  ???덇굅?? trainings 湲곕컲 (湲곗〈 ?곗씠???좎?)
 *
 * ?좉퇋 ?먮쫫
 *   1. 援먯쑁 ??ぉ ?깅줉/愿由? *   2. ??ぉ ???대┃ ???대떦 ??ぉ???뚯감 紐⑸줉 ?몃씪???꾧컻
 *   3. ?뚯감 異붽? ??援먯쑁?쇱옄, ?섎즺湲고븳, 吏?? *   4. ?뚯감 ?곸꽭 ??諛곗젙 吏곸썝 愿由? *   5. ?뚯감 ?꾨즺 ??吏곸썝 援먯쑁?대젰移대뱶 PASS ?앹꽦
 */

import { modal }     from "../utils/modal.js";
import { toast }     from "../utils/toast.js";
import { formatDate } from "../utils/date.js";
import { router }    from "../core/router.js";
import { authStore } from "../core/auth.js";
import { settingsDB } from "../core/db.js";
import { render as renderHistoryCards } from "./history-cards.js";
import {
  /* 湲곗〈 trainings 愿??*/
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
  /* ?좉퇋 Item / Session 愿??*/
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
import {
  bucketIncludesTraining,
  getVisibleDeadlineBuckets,
  normalizeNotificationSettings,
} from "../services/notification-settings-service.js";

/* ??????????????????????????????????????????????????????????
   State
?????????????????????????????????????????????????????????? */
let activeTab       = "items";   // "items" | "history"
let activeStatFilter = null;
let historyPaneInitialized = false;
let expandedItemId  = null;      // ?꾩옱 ?뚯감 ?⑤꼸???대┛ ??ぉ ID

let S = {
  /* 怨듯넻 */
  references:          null,
  notificationSettings: null,
  /* ?좉퇋 */
  items:               [],       // enrichItemRecord 泥섎━??援먯쑁 ??ぉ 諛곗뿴
  sessionsByItem:      {},       // { [itemId]: session[] }
  sessionDetail:       null,     // ?꾩옱 ?대┛ ?뚯감 ?곸꽭 { sessionId, detail }
  /* ?덇굅??*/
  trainings:           [],
};

/* ??????????????????????????????????????????????????????????
   吏꾩엯???????????????????????????????????????????????????????????? */
export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">援먯쑁 愿由?/div>
        <div class="section-subtitle">援먯쑁 ??ぉ???깅줉?섍퀬 ?뚯감蹂꾨줈 ?댁쁺?⑸땲??</div>
      </div>
      <div style="display:flex;gap:var(--space-2)" id="header-actions">
        <button class="btn btn--primary" id="btn-new-item">
          <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          援먯쑁 ??ぉ 異붽?
        </button>
      </div>
    </div>

    <!-- ??-->
    <div style="display:flex;gap:0;border-bottom:2px solid var(--gray-200);margin-bottom:var(--space-5)">
      <button class="tab-btn active" id="tab-items"  style="padding:var(--space-3) var(--space-5);font-size:var(--text-sm)">援먯쑁 ??ぉ</button>
      <button class="tab-btn"        id="tab-history" style="padding:var(--space-3) var(--space-5);font-size:var(--text-sm)">援먯쑁?대젰移대뱶</button>
    </div>

    <!-- ?좉퇋: 援먯쑁 ??ぉ ??-->
    <div id="pane-items">
      <div class="dashboard-grid dashboard-grid--compact" id="item-stats" style="margin-bottom:var(--space-5)"></div>
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card__body card__body--compact">
          <div class="input-group">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input class="form-control" id="search-items" type="search" placeholder="援먯쑁 ??ぉ紐낆쑝濡?寃?? />
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
      <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-12)">
        <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>
    </div>
  `;

  /* ???대깽??*/
  document.getElementById("tab-items")?.addEventListener("click",  () => switchTab("items"));
  document.getElementById("tab-history")?.addEventListener("click", () => switchTab("history"));

  /* ?좉퇋 ??ぉ ?대깽??*/
  document.getElementById("btn-new-item")?.addEventListener("click",   () => openItemModal());
  document.getElementById("search-items")?.addEventListener("input",   () => renderItemsTable());


  await loadAll();
}

/* ??????????????????????????????????????????????????????????
   ?곗씠??濡쒕뱶
?????????????????????????????????????????????????????????? */
async function loadAll() {
  try {
    const [references, items, trainings, notifications] = await Promise.all([
      loadTrainingReferences(),
      listInstructorItems(),
      listInstructorTrainings(),
      settingsDB.getNotifications().catch(() => null),
    ]);

    S.references           = references;
    S.items                = items;
    S.trainings            = trainings;
    S.notificationSettings = normalizeNotificationSettings(notifications ?? {});
    S.sessionsByItem       = {};  // ?뚯감????ぉ ?대┃ ??lazy load

    if (!getVisibleDeadlineBuckets(S.notificationSettings).some((b) => b.key === activeStatFilter)) {
      activeStatFilter = null;
    }

    renderBranchFilter();
    renderItemStats();
    renderItemsTable();
    renderTrainingStats();
    renderTrainingTable();
  } catch (err) {
    console.error("[instructor-trainings] loadAll failed", err);
    toast.error("?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲??");
  }
}

/* ??????????????????????????????????????????????????????????
   ???꾪솚
?????????????????????????????????????????????????????????? */
function switchTab(tab) {
  activeTab = tab;
  document.getElementById("pane-items").style.display = tab === "items" ? "" : "none";
  document.getElementById("pane-history").style.display = tab === "history" ? "" : "none";
  document.getElementById("tab-items").classList.toggle("active", tab === "items");
  document.getElementById("tab-history").classList.toggle("active", tab === "history");

  const headerBtn = document.getElementById("btn-new-item");
  if (headerBtn) headerBtn.style.display = tab === "items" ? "" : "none";

  if (tab === "history") {
    void ensureHistoryPane();
  }
}

async function ensureHistoryPane() {
  if (historyPaneInitialized) return;
  const pane = document.getElementById("pane-history");
  if (!pane) return;

  historyPaneInitialized = true;
  await renderHistoryCards(pane);
}
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
    { label: "援먯쑁 ??ぉ ??,   value: total,     tone: "" },
    { label: "吏꾪뻾以??뚯감",    value: active,    tone: "success" },
    { label: "?꾨즺???뚯감",    value: completed, tone: "" },
  ].map(({ label, value, tone }) => `
    <div class="stat-card">
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value ${tone ? `stat-card__value--${tone}` : ""}">${value}</div>
    </div>`).join("");
}

/* ??ぉ ?뚯씠釉??뚮뜑留?*/
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
        <div class="empty-state__title">?깅줉??援먯쑁 ??ぉ???놁뒿?덈떎.</div>
        <div style="margin-top:var(--space-3)">
          <button class="btn btn--primary btn--sm" id="btn-empty-new-item">援먯쑁 ??ぉ 異붽?</button>
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
            <th>援먯쑁 ??ぉ紐?/th>
            <th>援먯쑁?좏삎</th>
            <th>珥덇린/蹂댁닔</th>
            <th>湲곕낯 援먯쑁?쒓컙</th>
            <th>鍮꾧퀬</th>
            <th style="width:140px"></th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => itemRow(item)).join("")}
        </tbody>
      </table>
    </div>`;

  /* ???대┃ ???뚯감 ?⑤꼸 ?좉? */
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

  /* ?대? ?대젮?덈뜕 ?⑤꼸 蹂듭썝 */
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
      <td>${esc(item.subTypeLabel || "??)}</td>
      <td>${item.defaultHours ? `${item.defaultHours}?쒓컙` : "??}</td>
      <td style="color:var(--gray-400);font-size:var(--text-xs)">${esc(item.note || "??)}</td>
      <td class="cell--actions">
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn btn--ghost btn--sm btn-add-session"  data-id="${item.id}" title="?뚯감 異붽?">?뚯감 異붽?</button>
          <button class="btn btn--ghost btn--sm btn-item-edit"    data-id="${item.id}" title="?섏젙">?섏젙</button>
          <button class="btn btn--ghost btn--sm btn-item-delete"  data-id="${item.id}" title="??젣" style="color:var(--color-danger)">??젣</button>
        </div>
      </td>
    </tr>
    <tr id="session-panel-${item.id}" style="${isExpanded ? "" : "display:none"}">
      <td colspan="6" style="padding:0;background:var(--gray-50)">
        <div id="session-panel-body-${item.id}" style="padding:var(--space-4)">
          <div style="color:var(--gray-400);font-size:var(--text-sm);padding:var(--space-4)">遺덈윭?ㅻ뒗 以묅?/div>
        </div>
      </td>
    </tr>`;
}

/* ??????????????????????????????????????????????????????????
   ?뚯감 ?⑤꼸 (??ぉ ???꾨옒 ?몃씪???꾧컻)
?????????????????????????????????????????????????????????? */
async function toggleSessionPanel(itemId) {
  if (expandedItemId === itemId) {
    expandedItemId = null;
    renderItemsTable();
    return;
  }
  /* loadAndRenderSessions ?대??먯꽌 expandedItemId ?ㅼ젙 + renderItemsTable ?몄텧 */
  await loadAndRenderSessions(itemId);
}

async function loadAndRenderSessions(itemId) {
  /* ?⑤꼸 DOM??議댁옱?섎룄濡?癒쇱? ?뚯씠釉붿쓣 ?뚮뜑 */
  if (expandedItemId !== itemId) {
    expandedItemId = itemId;
    renderItemsTable();
  }

  const panelBody = document.getElementById(`session-panel-body-${itemId}`);
  if (panelBody) {
    panelBody.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-4);color:var(--gray-400);font-size:var(--text-sm)">
        <div class="splash__spinner" style="width:14px;height:14px;border-width:2px;border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
        ?뚯감 ?곗씠??遺덈윭?ㅻ뒗 以묅?      </div>`;
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
        ?뚯감 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲?? (${err?.message ?? "?????녿뒗 ?ㅻ쪟"})
        <button class="btn btn--ghost btn--sm" style="margin-left:var(--space-2)"
          onclick="this.closest('td').querySelector('button').disabled=true;location.reload()">?덈줈怨좎묠</button>
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
        ?뚯감 紐⑸줉 <span style="font-weight:normal;color:var(--gray-400)">(${sessions.length}嫄?</span>
      </div>
      <button class="btn btn--primary btn--sm btn-add-session-inner" data-id="${itemId}">+ ?뚯감 異붽?</button>
    </div>
    ${sessions.length === 0
      ? `<div style="padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">?깅줉???뚯감媛 ?놁뒿?덈떎. ?뚯감瑜?異붽???二쇱꽭??</div>`
      : `<table class="data-table" style="font-size:var(--text-xs)">
          <thead>
            <tr>
              <th>援먯쑁湲곌컙</th>
              <th>?섎즺湲고븳</th>
              <th>吏??/th>
              <th>?곹깭</th>
              <th style="width:190px"></th>
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
      if (s && i) void openSessionModal(i, s);
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
    : "??;
  const branches = s.branchNames?.length ? s.branchNames.join(", ") : "?꾩껜 吏??;
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
                data-sid="${s.id}" style="color:var(--color-success,#16a34a)" title="?꾨즺 泥섎━">?꾨즺</button>`
            : ""}
          ${!isClosed && !isDone
            ? `<button class="btn btn--ghost btn--sm btn-session-close"
                data-sid="${s.id}" title="醫낅즺 泥섎━">醫낅즺</button>`
            : ""}
          <button class="btn btn--ghost btn--sm btn-session-edit"
            data-sid="${s.id}" title="?섏젙">?섏젙</button>
          <button class="btn btn--ghost btn--sm btn-session-delete"
            data-sid="${s.id}" style="color:var(--color-danger)" title="??젣">??젣</button>
        </div>
      </td>
    </tr>`;
}

/* ??????????????????????????????????????????????????????????
   援먯쑁 ??ぉ 紐⑤떖 (?깅줉/?섏젙)
?????????????????????????????????????????????????????????? */
function openItemModal(item = null) {
  const label = item ? "?섏젙" : "?깅줉";
  const refs  = S.references;

  modal.open({
    title: item ? "援먯쑁 ??ぉ ?섏젙" : "援먯쑁 ??ぉ ?깅줉",
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">援먯쑁 ??ぉ紐?/label>
            <input class="form-control" id="it-title" type="text"
              value="${escAttr(item?.title ?? "")}" placeholder="?? ?좎엯吏곸썝 吏곷Т援먯쑁" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">援먯쑁?좏삎</label>
            <select class="form-control" id="it-type">
              ${TRAINING_TYPES.map((t) => `
                <option value="${t}" ${item?.trainingType === t ? "selected" : ""}>${TRAINING_TYPE_LABELS[t]}</option>
              `).join("")}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">珥덇린/蹂댁닔</label>
            <select class="form-control" id="it-subtype">
              <option value="">援щ텇 ?놁쓬</option>
              <option value="initial"   ${item?.subType === "initial"   ? "selected" : ""}>珥덇린</option>
              <option value="recurring" ${item?.subType === "recurring" ? "selected" : ""}>蹂댁닔</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">湲곕낯 援먯쑁?쒓컙 (?쒓컙)</label>
            <input class="form-control" id="it-hours" type="number" min="0" step="0.5"
              value="${item?.defaultHours ?? ""}" placeholder="?? 8" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">?대떦 媛뺤궗</label>
          <input class="form-control" type="text" value="${escAttr(authStore.name)}" disabled />
          <div class="form-hint">?꾩옱 濡쒓렇??怨꾩젙???대떦 媛뺤궗濡???λ맗?덈떎.</div>
        </div>
        <div class="form-group">
          <label class="form-label">鍮꾧퀬</label>
          <textarea class="form-control" id="it-note" rows="2"
            placeholder="援먯쑁 ??ぉ?????硫붾え">${esc(item?.note ?? "")}</textarea>
        </div>
      </div>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
      {
        label,
        variant: "primary",
        onClick: async () => {
          const title    = document.getElementById("it-title")?.value?.trim();
          const trainType = document.getElementById("it-type")?.value;
          const subType  = document.getElementById("it-subtype")?.value;
          const hours    = parseFloat(document.getElementById("it-hours")?.value ?? "") || 0;
          const note     = document.getElementById("it-note")?.value?.trim() ?? "";

          if (!title) { toast.error("援먯쑁 ??ぉ紐낆쓣 ?낅젰??二쇱꽭??"); return; }
          if (!trainType) { toast.error("援먯쑁?좏삎???좏깮??二쇱꽭??"); return; }

          modal.setLoading(label, true);
          try {
            const values = {
              title, trainingType: trainType, subType, defaultHours: hours, note,
              instructorId: authStore.uid, instructorName: authStore.name,
              companyId: S.references?.company?.id, companyName: S.references?.company?.name,
            };
            if (item) {
              await updateTrainingItem(item.id, values);
              toast.success("援먯쑁 ??ぉ???섏젙?덉뒿?덈떎.");
            } else {
              await createTrainingItem(values);
              toast.success("援먯쑁 ??ぉ???깅줉?덉뒿?덈떎.");
            }
            modal.close();
            await loadAll();
          } catch (err) {
            console.error("[instructor-trainings] item save failed", err);
            toast.error("???以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
            modal.setLoading(label, false);
          }
        },
      },
    ],
  });
}

/* ??????????????????????????????????????????????????????????
   ?뚯감 紐⑤떖 (?깅줉/?섏젙 + 吏곸썝 利됱떆 諛곗젙)
?????????????????????????????????????????????????????????? */
async function openSessionModal(item, session = null) {
  const label = session ? "?섏젙" : "異붽?";
  const refs = S.references;
  const branches = refs?.branches ?? [];
  const employees = refs?.employees ?? [];

  let filterBranchId = "";
  let filterSearch = "";
  let selectedUids = new Set();
  let existingAssignedUids = new Set();

  if (session?.id) {
    try {
      const detail = await getSessionDetail(session.id);
      existingAssignedUids = new Set((detail?.assignments ?? []).map((assignment) => assignment.uid));
      selectedUids = new Set(existingAssignedUids);
    } catch (err) {
      console.error("[instructor-trainings] preload session assignments failed", err);
      toast.error("기존 배정 직원을 불러오지 못했습니다.");
    }
  }

  function getFilteredEmployees() {
    return employees.filter((employee) => {
      const matchBranch = !filterBranchId || employee.branchId === filterBranchId;
      const matchSearch = !filterSearch
        || String(employee.name ?? "").toLowerCase().includes(filterSearch)
        || String(employee.empNo ?? "").toLowerCase().includes(filterSearch);
      return matchBranch && matchSearch;
    });
  }

  function updateSelCount() {
    const el = document.getElementById("ss-sel-count");
    if (el) el.textContent = `선택: ${selectedUids.size}명`;
  }

  function renderEmployeePicker() {
    const list = document.getElementById("ss-emp-list");
    if (!list) return;

    const filtered = getFilteredEmployees();
    if (!filtered.length) {
      list.innerHTML = `<div style="padding:var(--space-4);color:var(--gray-400);font-size:var(--text-sm);text-align:center">?대떦 議곌굔??吏곸썝???놁뒿?덈떎.</div>`;
      return;
    }

    list.innerHTML = filtered.map((employee) => {
      const uid = employee.id ?? employee.uid;
      const checked = selectedUids.has(uid);
      return `
        <label class="picker-item" style="padding:var(--space-2) var(--space-3)">
          <input type="checkbox" class="ss-emp-cb" value="${uid}" ${checked ? "checked" : ""} />
          <div class="picker-item__body">
            <div class="picker-item__title" style="font-size:var(--text-sm)">${esc(employee.name ?? "??)}</div>
            <div class="picker-item__meta">${esc(employee.empNo ?? "??)} 쨌 ${esc(employee.branchName ?? "??)}</div>
          </div>
        </label>`;
    }).join("");

    list.querySelectorAll(".ss-emp-cb").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedUids.add(checkbox.value);
        else selectedUids.delete(checkbox.value);
        updateSelCount();
      });
    });
  }

  modal.open({
    title: session ? `?뚯감 ?섏젙 ??${esc(item.title)}` : `?뚯감 異붽? ??${esc(item.title)}`,
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="form-row form-row--3">
          <div class="form-group">
            <label class="form-label form-label--required">援먯쑁 ?쒖옉??/label>
            <input class="form-control" id="ss-start" type="date" value="${toDateInput(session?.startDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">援먯쑁 醫낅즺??/label>
            <input class="form-control" id="ss-end" type="date" value="${toDateInput(session?.endDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">?섎즺湲고븳</label>
            <input class="form-control" id="ss-deadline" type="date" value="${toDateInput(session?.deadline)}" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">鍮꾧퀬</label>
          <input class="form-control" id="ss-note" type="text"
            value="${escAttr(session?.note ?? "")}" placeholder="?뚯감蹂?硫붾え" />
        </div>

        <div class="form-group">
          <label class="form-label" style="font-weight:var(--weight-semibold)">
            諛곗젙 吏곸썝 ?좏깮
            <span id="ss-sel-count" style="font-weight:normal;color:var(--gray-400);margin-left:var(--space-2)">선택: ${selectedUids.size}명</span>
          </label>
          <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2)">
            <select class="form-control" id="ss-filter-branch" style="flex:0 0 160px">
              <option value="">?꾩껜 吏??/option>
              ${branches.map((branch) => `<option value="${branch.id}">${esc(branch.name ?? branch.code ?? branch.id)}</option>`).join("")}
            </select>
            <div class="input-group" style="flex:1">
              <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
                <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
              </svg>
              <input class="form-control" id="ss-filter-search" type="search" placeholder="?대쫫 ?먮뒗 ?щ쾲 寃?? />
            </div>
            <button class="btn btn--ghost btn--sm" id="ss-select-all" type="button">?꾩껜 ?좏깮</button>
            <button class="btn btn--ghost btn--sm" id="ss-clear-all" type="button">?꾩껜 ?댁젣</button>
          </div>
          <div class="picker-list" id="ss-emp-list" style="max-height:240px;overflow-y:auto">
            <div style="padding:var(--space-4);color:var(--gray-400);font-size:var(--text-sm);text-align:center">遺덈윭?ㅻ뒗 以묅?/div>
          </div>
          <div class="form-hint">저장 시 회차 정보와 직원 배정이 함께 저장됩니다. 체크 해제하면 배정 해제되고, 새로 체크하면 추가 배정됩니다.</div>
        </div>
      </div>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
      {
        label,
        variant: "primary",
        onClick: async () => {
          const startDate = readDate("ss-start");
          const endDate = readDate("ss-end");
          const deadline = readDate("ss-deadline");
          const note = document.getElementById("ss-note")?.value?.trim() ?? "";

          if (!startDate || !endDate || !deadline) { toast.error("援먯쑁湲곌컙怨??섎즺湲고븳??紐⑤몢 ?낅젰??二쇱꽭??"); return; }
          if (endDate < startDate) { toast.error("醫낅즺?쇱? ?쒖옉???댄썑?ъ빞 ?⑸땲??"); return; }
          if (deadline < endDate) { toast.error("?섎즺湲고븳? 醫낅즺?쇨낵 媛숆굅???댄썑?ъ빞 ?⑸땲??"); return; }

          const selectedEmployees = employees.filter((employee) => selectedUids.has(employee.id ?? employee.uid));
          const branchIds = [...new Set(selectedEmployees.map((employee) => employee.branchId).filter(Boolean))];
          const branchNames = branchIds.map((branchId) => branches.find((branch) => branch.id === branchId)?.name ?? branchId);
          const addedUids = [...selectedUids].filter((uid) => !existingAssignedUids.has(uid));
          const removedUids = [...existingAssignedUids].filter((uid) => !selectedUids.has(uid));

          modal.setLoading(label, true);
          try {
            let sessionId;
            if (session) {
              await updateTrainingSession(session.id, { startDate, endDate, deadline, branchIds, branchNames, note });
              sessionId = session.id;
            } else {
              sessionId = await createTrainingSession(item, {
                startDate, endDate, deadline, branchIds, branchNames, note,
                companyId: S.references?.company?.id,
                companyName: S.references?.company?.name,
              });
            }

            if (addedUids.length > 0) {
              const sessionObj = { id: sessionId, deadline, title: item.title, itemId: item.id };
              await assignEmployeesToSession(sessionObj, addedUids, refs);
            }
            if (removedUids.length > 0) {
              await Promise.all(removedUids.map((uid) => unassignFromSession(sessionId, uid)));
            }

            const msg = session
              ? `?뚯감瑜??섏젙?덉뒿?덈떎.${addedUids.length || removedUids.length ? ` (추가 ${addedUids.length}명, 해제 ${removedUids.length}명)` : ""}`
              : `?뚯감瑜?異붽??덉뒿?덈떎.${addedUids.length ? ` (${addedUids.length}명 배정)` : ""}`;
            toast.success(msg);

            modal.close();
            await loadAndRenderSessions(item.id);
          } catch (err) {
            console.error("[instructor-trainings] session save failed", err?.code, err?.message, err);
            toast.error(`???以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎: ${err?.message ?? "?????녿뒗 ?ㅻ쪟"}`);
            modal.setLoading(label, false);
          }
        },
      },
    ],
  });

  requestAnimationFrame(() => {
    renderEmployeePicker();
    updateSelCount();

    document.getElementById("ss-filter-branch")?.addEventListener("change", (event) => {
      filterBranchId = event.target.value;
      renderEmployeePicker();
    });
    document.getElementById("ss-filter-search")?.addEventListener("input", (event) => {
      filterSearch = event.target.value.trim().toLowerCase();
      renderEmployeePicker();
    });
    document.getElementById("ss-select-all")?.addEventListener("click", () => {
      getFilteredEmployees().forEach((employee) => selectedUids.add(employee.id ?? employee.uid));
      renderEmployeePicker();
      updateSelCount();
    });
    document.getElementById("ss-clear-all")?.addEventListener("click", () => {
      getFilteredEmployees().forEach((employee) => selectedUids.delete(employee.id ?? employee.uid));
      renderEmployeePicker();
      updateSelCount();
    });
  });
}
async function openSessionDetailModal(sessionId, itemId) {
  /* 濡쒕뵫 ?쒖떆 */
  modal.open({
    title: "諛곗젙 愿由?,
    size: "lg",
    body: `<div style="display:flex;justify-content:center;padding:var(--space-10)">
      <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
    </div>`,
    actions: [{ label: "?リ린", variant: "secondary", onClick: () => modal.close() }],
  });

  try {
    const detail = await getSessionDetail(sessionId);
    if (!detail) { toast.error("?뚯감 ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎."); modal.close(); return; }

    S.sessionDetail = { sessionId, detail };
    renderSessionDetailBody(detail, itemId);
  } catch (err) {
    console.error("[instructor-trainings] session detail failed", err);
    toast.error("?뚯감 ?뺣낫瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??");
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
    : "??;

  /* 諛곗젙 媛?ν븳 吏곸썝 紐⑸줉 */
  const candidates = employees.filter((e) => {
    const uid = e.id ?? e.uid;
    return !assignedUids.has(uid);
  });

  const body = `
    <div style="display:flex;flex-direction:column;gap:var(--space-5)">
      <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;font-size:var(--text-sm);color:var(--gray-600)">
        <span>援먯쑁湲곌컙: <strong>${period}</strong></span>
        <span>?섎즺湲고븳: <strong>${formatDate(session.deadline)}</strong></span>
        <span>?곹깭: ${buildSessionStatusChip(session.computedStatus)}</span>
      </div>

      <!-- 諛곗젙 ?꾪솴 -->
      <div>
        <div style="font-weight:var(--weight-semibold);font-size:var(--text-sm);margin-bottom:var(--space-2)">
          諛곗젙 ?꾪솴 (${assignments.length}紐?
        </div>
        ${assignments.length === 0
          ? `<div style="color:var(--gray-400);font-size:var(--text-sm)">諛곗젙??吏곸썝???놁뒿?덈떎.</div>`
          : `<table class="data-table" style="font-size:var(--text-xs)">
              <thead><tr><th>?대쫫</th><th>?щ쾲</th><th>吏??/th><th>?섎즺 ?곹깭</th><th style="width:80px"></th></tr></thead>
              <tbody>
                ${assignments.map((a) => `
                  <tr>
                    <td>${esc(a.name)}</td>
                    <td style="font-family:monospace">${esc(a.empNo)}</td>
                    <td>${esc(a.branchName)}</td>
                    <td>${completedUids.has(a.uid)
                      ? `<span class="chip chip--success">?섎즺</span>`
                      : `<span class="chip chip--neutral">?湲?/span>`}</td>
                    <td class="cell--actions">
                      <button class="btn btn--ghost btn--sm btn-unassign-session"
                        data-uid="${a.uid}" style="color:var(--color-danger)">?댁젣</button>
                    </td>
                  </tr>`).join("")}
              </tbody>
            </table>`
        }
      </div>

      <!-- 吏곸썝 諛곗젙 -->
      <div>
        <div style="font-weight:var(--weight-semibold);font-size:var(--text-sm);margin-bottom:var(--space-2)">吏곸썝 諛곗젙</div>
        <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2)">
          <div class="input-group" style="flex:1">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input class="form-control" id="detail-search" type="search" placeholder="?대쫫, ?щ쾲?쇰줈 寃?? />
          </div>
          <button class="btn btn--primary btn--sm" id="btn-do-assign">?좏깮 諛곗젙</button>
        </div>
        <div class="picker-list" id="candidate-picker" style="max-height:200px">
          ${candidates.length === 0
            ? `<div style="padding:var(--space-4);color:var(--gray-400);font-size:var(--text-sm)">諛곗젙 媛?ν븳 吏곸썝???놁뒿?덈떎.</div>`
            : candidates.map((e) => {
                const uid = e.id ?? e.uid;
                return `
                  <label class="picker-item">
                    <input type="checkbox" class="candidate-cb" value="${uid}" />
                    <div class="picker-item__body">
                      <div class="picker-item__title">${esc(e.name ?? "??)}</div>
                      <div class="picker-item__meta">${esc(e.empNo ?? "??)} 쨌 ${esc(e.branchName ?? "??)}</div>
                    </div>
                  </label>`;
              }).join("")}
        </div>
      </div>
    </div>`;

  /* 紐⑤떖 body 援먯껜 */
  const modalBody = document.querySelector(".modal__body");
  if (modalBody) modalBody.innerHTML = body;

  /* 寃???꾪꽣 */
  document.getElementById("detail-search")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".candidate-cb").forEach((cb) => {
      const item = cb.closest(".picker-item");
      const text = item?.textContent?.toLowerCase() ?? "";
      item.style.display = q && !text.includes(q) ? "none" : "";
    });
  });

  /* 諛곗젙 ?ㅽ뻾 */
  document.getElementById("btn-do-assign")?.addEventListener("click", async () => {
    const ids = Array.from(document.querySelectorAll(".candidate-cb:checked")).map((c) => c.value);
    if (!ids.length) { toast.warning("諛곗젙??吏곸썝???좏깮??二쇱꽭??"); return; }
    try {
      await assignEmployeesToSession(
        { ...session, id: sessionId },
        ids,
        S.sessionDetail?.detail?.references
      );
      toast.success(`${ids.length}紐낆쓣 諛곗젙?덉뒿?덈떎.`);
      const newDetail = await getSessionDetail(sessionId);
      S.sessionDetail = { sessionId, detail: newDetail };
      renderSessionDetailBody(newDetail, itemId);
    } catch (err) {
      console.error("[instructor-trainings] assign session failed", err);
      toast.error("諛곗젙 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
    }
  });

  /* 諛곗젙 ?댁젣 */
  document.querySelectorAll(".btn-unassign-session").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await unassignFromSession(sessionId, btn.dataset.uid);
        toast.success("諛곗젙???댁젣?덉뒿?덈떎.");
        const newDetail = await getSessionDetail(sessionId);
        S.sessionDetail = { sessionId, detail: newDetail };
        renderSessionDetailBody(newDetail, itemId);
      } catch (err) {
        console.error("[instructor-trainings] unassign session failed", err);
        toast.error("諛곗젙 ?댁젣 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
      }
    });
  });
}

/* ??????????????????????????????????????????????????????????
   ?뚯감 ?꾨즺 ?뺤씤
?????????????????????????????????????????????????????????? */
function confirmCompleteSession(sessionId, itemId) {
  modal.open({
    title: "?뚯감 ?꾨즺 泥섎━",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        ???뚯감瑜??꾨즺 泥섎━?섏떆寃좎뒿?덇퉴?<br/>
        諛곗젙??吏곸썝??援먯쑁 ?대젰移대뱶???먮룞?쇰줈 <strong>PASS</strong> ?섎즺 湲곕줉???앹꽦?⑸땲??
      </p>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
      {
        label: "?꾨즺",
        variant: "primary",
        onClick: async () => {
          modal.setLoading("?꾨즺", true);
          try {
            await completeSession(sessionId);
            toast.success("?뚯감瑜??꾨즺 泥섎━?덉뒿?덈떎. 吏곸썝 ?대젰移대뱶???섎즺 湲곕줉???앹꽦?섏뿀?듬땲??");
            modal.close();
            await loadAndRenderSessions(itemId);
          } catch (err) {
            if (err?.message === "NO_ASSIGNMENTS") {
              toast.error("諛곗젙??吏곸썝???놁뒿?덈떎. 癒쇱? 吏곸썝??諛곗젙??二쇱꽭??");
            } else {
              console.error("[instructor-trainings] completeSession failed", err);
              toast.error("?꾨즺 泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
            }
            modal.setLoading("?꾨즺", false);
          }
        },
      },
    ],
  });
}

/* ??????????????????????????????????????????????????????????
   ?뚯감 醫낅즺 ?뺤씤
?????????????????????????????????????????????????????????? */
function confirmCloseSession(sessionId, itemId) {
  modal.open({
    title: "?뚯감 醫낅즺",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">???뚯감瑜?醫낅즺 泥섎━?섏떆寃좎뒿?덇퉴?<br/>?섎즺 湲곕줉? ?앹꽦?섏? ?딆뒿?덈떎.</p>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
      {
        label: "醫낅즺",
        variant: "primary",
        onClick: async () => {
          modal.setLoading("醫낅즺", true);
          try {
            await closeSession(sessionId);
            toast.success("?뚯감瑜?醫낅즺?덉뒿?덈떎.");
            modal.close();
            await loadAndRenderSessions(itemId);
          } catch (err) {
            console.error("[instructor-trainings] closeSession failed", err);
            toast.error("?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
            modal.setLoading("醫낅즺", false);
          }
        },
      },
    ],
  });
}

/* ??????????????????????????????????????????????????????????
   ?뚯감 ??젣 ?뺤씤
?????????????????????????????????????????????????????????? */
function confirmDeleteSession(sessionId, itemId) {
  modal.open({
    title: "?뚯감 ??젣",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">???뚯감瑜???젣?섏떆寃좎뒿?덇퉴?<br/>諛곗젙 諛??섎즺 ?곗씠?곕룄 ?④퍡 ??젣?⑸땲??</p>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
      {
        label: "??젣",
        variant: "danger",
        onClick: async () => {
          modal.setLoading("??젣", true);
          try {
            await deleteSession(sessionId);
            toast.success("?뚯감瑜???젣?덉뒿?덈떎.");
            modal.close();
            await loadAndRenderSessions(itemId);
          } catch (err) {
            console.error("[instructor-trainings] deleteSession failed", err);
            toast.error("??젣 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
            modal.setLoading("??젣", false);
          }
        },
      },
    ],
  });
}

/* ??????????????????????????????????????????????????????????
   ??ぉ ??젣 ?뺤씤
?????????????????????????????????????????????????????????? */
function confirmDeleteItem(itemId) {
  const item = S.items.find((i) => i.id === itemId);
  if (!item) return;

  modal.open({
    title: "援먯쑁 ??ぉ ??젣",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        <strong>${esc(item.title)}</strong> ??ぉ????젣?섏떆寃좎뒿?덇퉴?<br/>
        ?곌껐??紐⑤뱺 ?뚯감? 諛곗젙/?섎즺 ?곗씠?곕룄 ?④퍡 ??젣?⑸땲??
      </p>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
      {
        label: "??젣",
        variant: "danger",
        onClick: async () => {
          modal.setLoading("??젣", true);
          try {
            await deleteTrainingItem(itemId);
            toast.success("援먯쑁 ??ぉ????젣?덉뒿?덈떎.");
            if (expandedItemId === itemId) expandedItemId = null;
            modal.close();
            await loadAll();
          } catch (err) {
            console.error("[instructor-trainings] deleteItem failed", err);
            toast.error("??젣 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
            modal.setLoading("??젣", false);
          }
        },
      },
    ],
  });
}

/* ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
   ?덇굅?? 湲곗〈 trainings ??(湲곗〈 肄붾뱶 ?꾩쟾 蹂댁〈)
?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧 */

function renderBranchFilter() {
  const select = document.getElementById("filter-branch");
  if (!select) return;
  const branches = S.references?.branches ?? [];
  select.innerHTML = `
    <option value="">?꾩껜 吏??/option>
    ${branches.map((b) => `<option value="${b.id}">${esc(b.name ?? b.code ?? b.id)}</option>`).join("")}
  `;
}

function renderTrainingStats() {
  const wrap = document.getElementById("training-stats");
  if (!wrap) return;

  const visibleBuckets = getVisibleDeadlineBuckets(S.notificationSettings);
  wrap.innerHTML = visibleBuckets.map((bucket) => {
    const count = S.trainings.filter((t) => bucketIncludesTraining(bucket, t)).length;
    const sub  = bucket.type === "completed" ? "?꾨즺 泥섎━??援먯쑁"
               : bucket.type === "overdue"   ? "?섎즺湲고븳??吏??援먯쑁"
               : `?ㅻ뒛遺??${bucket.days}???대궡 留덇컧`;
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
        <div class="empty-state__title">議곌굔??留욌뒗 援먯쑁???놁뒿?덈떎.</div>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>援먯쑁紐?/th><th>援먯쑁?좏삎</th><th>?뚯궗/吏??/th>
          <th>援먯쑁湲곌컙</th><th>?섎즺湲고븳</th><th>?곹깭</th><th>?앹꽦??/th>
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
  const branchSummary = training.branchNames?.length ? training.branchNames.join(", ") : "?꾩껜 吏??;
  const isOwner       = training.createdBy === authStore.uid;
  const isInstructor  = training.instructorId === authStore.uid;
  const canAct        = isOwner || isInstructor;
  const isCompleted   = training.computedStatus === "completed";
  const isClosed      = training.computedStatus === "closed";
  const actions       = [];

  if (isOwner) actions.push(`<button class="btn btn--ghost btn--sm btn-training-edit" data-id="${training.id}">?섏젙</button>`);
  if (canAct && !isCompleted) actions.push(`<button class="btn btn--ghost btn--sm btn-training-complete" data-id="${training.id}" style="color:var(--color-success,#16a34a)">?꾨즺</button>`);
  if (!isClosed && !isCompleted && canAct) actions.push(`<button class="btn btn--ghost btn--sm btn-training-close" data-id="${training.id}">醫낅즺</button>`);
  if (isOwner) actions.push(`<button class="btn btn--ghost btn--sm btn-training-delete" data-id="${training.id}" style="color:var(--color-danger)">??젣</button>`);

  return `
    <tr data-id="${training.id}" style="cursor:pointer">
      <td><div style="font-weight:var(--weight-semibold)">${esc(training.title)}</div></td>
      <td>${esc(training.typeLabel)}</td>
      <td>
        <div>${esc(training.companyName || "??)}</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400)">${esc(branchSummary)}</div>
      </td>
      <td style="white-space:nowrap">${formatDate(training.startDate)} ~ ${formatDate(training.endDate)}</td>
      <td style="white-space:nowrap">${formatDate(training.deadline)}</td>
      <td>${buildStatusChip(training.computedStatus)}</td>
      <td>${formatDate(training.createdAt)}</td>
      <td class="cell--actions">
        <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
          ${actions.join("") || `<span style="font-size:var(--text-xs);color:var(--gray-400)">議고쉶 ?꾩슜</span>`}
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

/* ?덇굅??援먯쑁 ?깅줉/?섏젙 紐⑤떖 */
function openTrainingModal(training = null) {
  const label   = training ? "?섏젙" : "?깅줉";
  const refs    = S.references;
  const branchIds = training?.branchIds ?? [];

  modal.open({
    title: training ? "援먯쑁 ?섏젙" : "援먯쑁 ?깅줉 (湲곗〈 諛⑹떇)",
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">援먯쑁紐?/label>
            <input class="form-control" id="t-title" type="text"
              value="${escAttr(training?.title ?? "")}" placeholder="?? 2026 ?쒕퉬?ㅺ탳?? />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">援먯쑁?좏삎</label>
            <select class="form-control" id="t-type">
              ${TRAINING_TYPES.map((t) => `<option value="${t}" ${training?.trainingType === t ? "selected" : ""}>${TRAINING_TYPE_LABELS[t]}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">?뚯궗</label>
            <input class="form-control" type="text" value="${escAttr(refs?.company?.name || "??)}" disabled />
          </div>
          <div class="form-group">
            <label class="form-label">?대떦 媛뺤궗</label>
            <input class="form-control" type="text" value="${escAttr(authStore.name)}" disabled />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label form-label--required">吏??/label>
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
            <label class="form-label form-label--required">援먯쑁 ?쒖옉??/label>
            <input class="form-control" id="t-start" type="date" value="${toDateInput(training?.startDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">援먯쑁 醫낅즺??/label>
            <input class="form-control" id="t-end" type="date" value="${toDateInput(training?.endDate)}" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">?섎즺湲고븳</label>
            <input class="form-control" id="t-deadline" type="date" value="${toDateInput(training?.deadline)}" />
          </div>
        </div>
      </div>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
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

  if (!title)                              { toast.error("援먯쑁紐낆쓣 ?낅젰??二쇱꽭??"); return; }
  if (!startDate || !endDate || !deadline) { toast.error("?좎쭨瑜?紐⑤몢 ?낅젰??二쇱꽭??"); return; }
  if (endDate < startDate)                 { toast.error("醫낅즺?쇱? ?쒖옉???댄썑?ъ빞 ?⑸땲??"); return; }
  if (deadline < endDate)                  { toast.error("?섎즺湲고븳? 醫낅즺?쇨낵 媛숆굅???댄썑?ъ빞 ?⑸땲??"); return; }

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
    toast.success(trainingId ? "援먯쑁???섏젙?덉뒿?덈떎." : "援먯쑁???깅줉?덉뒿?덈떎.");
    modal.close();
    await loadAll();
  } catch (err) {
    console.error("[instructor-trainings] legacy save failed", err);
    toast.error("???以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
    modal.setLoading(label, false);
  }
}

function confirmComplete(trainingId) {
  const t = S.trainings.find((x) => x.id === trainingId);
  if (!t) return;
  modal.open({
    title: "援먯쑁 ?꾨즺 泥섎━", size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      <strong>${esc(t.title)}</strong> 援먯쑁???꾨즺 泥섎━?섏떆寃좎뒿?덇퉴?<br/>
      諛곗젙??吏곸썝??援먯쑁 ?대젰移대뱶???먮룞?쇰줈 ?섎즺 湲곕줉???앹꽦?⑸땲??</p>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
      { label: "?꾨즺", variant: "primary", onClick: async () => {
        modal.setLoading("?꾨즺", true);
        try {
          await completeTraining(trainingId);
          toast.success("援먯쑁???꾨즺 泥섎━?덉뒿?덈떎.");
          modal.close(); await loadAll();
        } catch (err) {
          if (err?.message === "NO_ASSIGNMENTS") toast.error("諛곗젙??吏곸썝???놁뒿?덈떎.");
          else toast.error("?꾨즺 泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
          modal.setLoading("?꾨즺", false);
        }
      }},
    ],
  });
}

function confirmClose(trainingId) {
  const t = S.trainings.find((x) => x.id === trainingId);
  if (!t) return;
  modal.open({
    title: "援먯쑁 醫낅즺 泥섎━", size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      <strong>${esc(t.title)}</strong> 援먯쑁??醫낅즺 泥섎━?섏떆寃좎뒿?덇퉴?</p>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
      { label: "醫낅즺", variant: "primary", onClick: async () => {
        modal.setLoading("醫낅즺", true);
        try {
          await closeTraining(trainingId);
          toast.success("援먯쑁??醫낅즺?덉뒿?덈떎.");
          modal.close(); await loadAll();
        } catch (err) {
          toast.error("?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
          modal.setLoading("醫낅즺", false);
        }
      }},
    ],
  });
}

function confirmDelete(trainingId) {
  const t = S.trainings.find((x) => x.id === trainingId);
  if (!t) return;
  modal.open({
    title: "援먯쑁 ??젣", size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      <strong>${esc(t.title)}</strong> 援먯쑁????젣?섏떆寃좎뒿?덇퉴?<br/>
      諛곗젙/?섎즺 ?곗씠?곕룄 ?④퍡 ??젣?⑸땲??</p>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
      { label: "??젣", variant: "danger", onClick: async () => {
        modal.setLoading("??젣", true);
        try {
          await deleteTraining(trainingId);
          toast.success("??젣?덉뒿?덈떎.");
          modal.close(); await loadAll();
        } catch (err) {
          toast.error("??젣 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
          modal.setLoading("??젣", false);
        }
      }},
    ],
  });
}

/* ??????????????????????????????????????????????????????????
   怨듯넻 ?ы띁
?????????????????????????????????????????????????????????? */
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


