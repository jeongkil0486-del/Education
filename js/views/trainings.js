/**
 * trainings.js — hq_admin / super_admin 전용 교육 관리 화면
 * 교육 등록 버튼 없음 (instructor 전용)
 */

import { modal }        from "../utils/modal.js";
import { toast }        from "../utils/toast.js";
import { formatDate }   from "../utils/date.js";
import { router }       from "../core/router.js";
import {
  TRAINING_STATUS_LABELS,
  TRAINING_TYPES,
  TRAINING_TYPE_LABELS,
  buildStatusChip,
  closeTraining,
  computeTrainingStatus,
  deleteTraining,
  isDeadlineSoon,
  listManagedTrainings,
  loadTrainingReferences,
} from "../services/training-service.js";

let activeStatFilter = null;
let state = { references: null, trainings: [] };

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">교육 관리</div>
        <div class="section-subtitle">강사들이 등록한 교육 목록을 조회하고 운영 현황을 관리합니다.</div>
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
            ${Object.entries(TRAINING_STATUS_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}
          </select>
          <select class="form-control" id="filter-type" style="flex:1;min-width:110px">
            <option value="">전체 유형</option>
            ${TRAINING_TYPES.map(t=>`<option value="${t}">${TRAINING_TYPE_LABELS[t]}</option>`).join("")}
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

  document.getElementById("search-trainings")  ?.addEventListener("input",  renderTable);
  document.getElementById("filter-instructor") ?.addEventListener("change", renderTable);
  document.getElementById("filter-status")     ?.addEventListener("change", renderTable);
  document.getElementById("filter-type")       ?.addEventListener("change", renderTable);
  document.getElementById("filter-branch")     ?.addEventListener("change", renderTable);

  await loadData();
}

async function loadData() {
  try {
    const [references, trainings] = await Promise.all([
      loadTrainingReferences(),
      listManagedTrainings(),
    ]);
    state = { references, trainings };
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
  const sel = document.getElementById("filter-instructor");
  if (!sel) return;
  const map = new Map();
  state.trainings.forEach(t => { if (t.instructorId && t.instructorName) map.set(t.instructorId, t.instructorName); });
  sel.innerHTML = `<option value="">전체 강사</option>` +
    Array.from(map.entries()).map(([uid, name]) => `<option value="${uid}">${esc(name)}</option>`).join("");
}

function fillBranchFilter() {
  const sel = document.getElementById("filter-branch");
  if (!sel) return;
  const branches = state.references?.branches ?? [];
  sel.innerHTML = `<option value="">전체 지점</option>` +
    branches.map(b => `<option value="${b.id}">${esc(b.name ?? b.code ?? b.id)}</option>`).join("");
}

function renderStats() {
  const wrap = document.getElementById("training-stats");
  if (!wrap) return;
  const now  = Date.now();
  const list = state.trainings;
  const cards = [
    { key:"total",      label:"전체교육", value:list.length,                                                          sub:"조회 가능한 전체 교육",   tone:"" },
    { key:"inProgress", label:"진행중",   value:list.filter(t=>computeTrainingStatus(t,now)==="in_progress").length,  sub:"현재 운영 중인 교육",     tone:"success" },
    { key:"soon",       label:"기한촉박", value:list.filter(t=>isDeadlineSoon(t,now)).length,                         sub:"수료기한 3일 이내",       tone:"warning" },
    { key:"overdue",    label:"기한초과", value:list.filter(t=>computeTrainingStatus(t,now)==="overdue").length,       sub:"기한이 지난 교육",        tone:"danger" },
  ];
  wrap.innerHTML = cards.map(({key,label,value,sub,tone}) => `
    <div class="stat-card stat-card--clickable ${activeStatFilter===key?"stat-card--active":""}" data-key="${key}" style="cursor:pointer">
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value ${tone?`stat-card__value--${tone}`:""}">${value}</div>
      <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:2px">${sub}</div>
    </div>
  `).join("");
  wrap.querySelectorAll(".stat-card--clickable").forEach(card => {
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
  const now        = Date.now();
  const search     = (document.getElementById("search-trainings")?.value  ?? "").trim().toLowerCase();
  const instructor = document.getElementById("filter-instructor")?.value  ?? "";
  const status     = document.getElementById("filter-status")?.value      ?? "";
  const type       = document.getElementById("filter-type")?.value        ?? "";
  const branch     = document.getElementById("filter-branch")?.value      ?? "";

  const filtered = state.trainings.filter(t => {
    if (activeStatFilter === "inProgress" && computeTrainingStatus(t,now) !== "in_progress") return false;
    if (activeStatFilter === "soon"       && !isDeadlineSoon(t,now))                          return false;
    if (activeStatFilter === "overdue"    && computeTrainingStatus(t,now) !== "overdue")       return false;
    if (search     && !String(t.title ?? "").toLowerCase().includes(search))         return false;
    if (instructor && t.instructorId !== instructor)                                  return false;
    if (status     && t.computedStatus !== status)                                    return false;
    if (type       && t.trainingType   !== type)                                      return false;
    if (branch     && !t.branchIds?.includes(branch))                                 return false;
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
          <th>교육명</th><th>유형</th><th>회사/지점</th><th>교육기간</th>
          <th>수료기한</th><th>담당 강사</th><th>상태</th><th>생성일</th>
          <th style="width:90px"></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(t => {
          const branch = t.branchNames?.length ? t.branchNames.join(", ") : "전체 지점";
          const soon   = isDeadlineSoon(t, now);
          return `
            <tr data-id="${t.id}" style="cursor:pointer">
              <td><div style="font-weight:var(--weight-semibold);color:var(--gray-800)">${esc(t.title)}</div></td>
              <td>${esc(TRAINING_TYPE_LABELS[t.trainingType] ?? "기타")}</td>
              <td><div>${esc(t.companyName||"-")}</div><div style="font-size:var(--text-xs);color:var(--gray-400)">${esc(branch)}</div></td>
              <td style="white-space:nowrap">${formatDate(t.startDate)} ~ ${formatDate(t.endDate)}</td>
              <td style="white-space:nowrap">${soon?`<span style="color:var(--color-warning)">⚠ </span>`:""}${formatDate(t.deadline)}</td>
              <td>${esc(t.instructorName||"-")}</td>
              <td>${buildStatusChip(t.computedStatus)}</td>
              <td>${formatDate(t.createdAt)}</td>
              <td class="cell--actions">
                <div style="display:flex;gap:4px;justify-content:flex-end">
                  ${t.computedStatus !== "closed" ? `<button class="btn btn--ghost btn--sm btn-close" data-id="${t.id}">종료</button>` : ""}
                  <button class="btn btn--ghost btn--sm btn-del" data-id="${t.id}" style="color:var(--color-danger)">삭제</button>
                </div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("tr[data-id]").forEach(row =>
    row.addEventListener("click", e => { if (!e.target.closest(".cell--actions")) router.push("training-detail", {id: row.dataset.id}); })
  );
  wrap.querySelectorAll(".btn-close").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); confirmClose(btn.dataset.id); })
  );
  wrap.querySelectorAll(".btn-del").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); confirmDelete(btn.dataset.id); })
  );
}

function confirmClose(id) {
  const t = state.trainings.find(x => x.id === id);
  if (!t) return;
  modal.open({
    title: "교육 종료 처리", size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)"><strong>${esc(t.title)}</strong> 교육을 종료 처리하시겠습니까?</p>`,
    actions: [
      { label:"취소", variant:"secondary", onClick:()=>modal.close() },
      { label:"종료", variant:"primary", onClick: async()=>{
        modal.setLoading("종료",true);
        try { await closeTraining(id); toast.success("종료 처리되었습니다."); modal.close(); await loadData(); }
        catch(err) { console.error("[trainings] close",err?.message,err); toast.error("오류가 발생했습니다."); modal.setLoading("종료",false); }
      }},
    ],
  });
}

function confirmDelete(id) {
  const t = state.trainings.find(x => x.id === id);
  if (!t) return;
  modal.open({
    title: "교육 삭제", size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)"><strong>${esc(t.title)}</strong> 교육을 삭제하시겠습니까?</p>`,
    actions: [
      { label:"취소", variant:"secondary", onClick:()=>modal.close() },
      { label:"삭제", variant:"danger", onClick: async()=>{
        modal.setLoading("삭제",true);
        try { await deleteTraining(id); toast.success("삭제되었습니다."); modal.close(); await loadData(); }
        catch(err) { console.error("[trainings] delete",err?.message,err); toast.error("오류가 발생했습니다."); modal.setLoading("삭제",false); }
      }},
    ],
  });
}

function esc(v) { return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
