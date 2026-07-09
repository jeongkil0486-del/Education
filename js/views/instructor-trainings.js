/**
 * instructor-trainings.js — instructor 전용 교육 관리 화면
 * 교육 등록 가능, 본인 교육만 조회
 */

import { modal }        from "../utils/modal.js";
import { toast }        from "../utils/toast.js";
import { formatDate }   from "../utils/date.js";
import { router }       from "../core/router.js";
import { authStore }    from "../core/auth.js";
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
let state = { references: null, trainings: [] };

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

    <div class="dashboard-grid dashboard-grid--compact" id="training-stats" style="margin-bottom:var(--space-5)"></div>

    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card__body" style="padding:var(--space-4)">
        <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-3)">
          <div class="input-group" style="flex:1;min-width:200px">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input class="form-control" id="search-trainings" type="search" placeholder="교육명으로 검색" />
          </div>
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

  document.getElementById("btn-create-training")?.addEventListener("click", () => openModal());
  document.getElementById("search-trainings")   ?.addEventListener("input",  renderTable);
  document.getElementById("filter-status")      ?.addEventListener("change", renderTable);
  document.getElementById("filter-type")        ?.addEventListener("change", renderTable);
  document.getElementById("filter-branch")      ?.addEventListener("change", renderTable);

  await loadData();
}

async function loadData() {
  try {
    const [references, trainings] = await Promise.all([
      loadTrainingReferences(),
      listInstructorTrainings(),
    ]);
    state = { references, trainings };
    fillBranchFilter();
    renderStats();
    renderTable();
  } catch (err) {
    console.error("[instructor-trainings] load failed", err?.message, err);
    toast.error("교육 데이터를 불러오지 못했습니다.");
  }
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
    { key:"total",      label:"전체교육", value:list.length,                                                          sub:"내 전체 교육 수",     tone:"" },
    { key:"inProgress", label:"진행중",   value:list.filter(t=>computeTrainingStatus(t,now)==="in_progress").length,  sub:"현재 운영 중",        tone:"success" },
    { key:"soon",       label:"기한촉박", value:list.filter(t=>isDeadlineSoon(t,now)).length,                         sub:"수료기한 3일 이내",   tone:"warning" },
    { key:"overdue",    label:"기한초과", value:list.filter(t=>computeTrainingStatus(t,now)==="overdue").length,       sub:"기한이 지난 교육",    tone:"danger" },
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
  const now    = Date.now();
  const search = (document.getElementById("search-trainings")?.value ?? "").trim().toLowerCase();
  const status = document.getElementById("filter-status")?.value ?? "";
  const type   = document.getElementById("filter-type")?.value   ?? "";
  const branch = document.getElementById("filter-branch")?.value ?? "";

  const filtered = state.trainings.filter(t => {
    if (activeStatFilter === "inProgress" && computeTrainingStatus(t,now) !== "in_progress") return false;
    if (activeStatFilter === "soon"       && !isDeadlineSoon(t,now))                          return false;
    if (activeStatFilter === "overdue"    && computeTrainingStatus(t,now) !== "overdue")       return false;
    if (search && !String(t.title ?? "").toLowerCase().includes(search)) return false;
    if (status && t.computedStatus !== status) return false;
    if (type   && t.trainingType   !== type)   return false;
    if (branch && !t.branchIds?.includes(branch)) return false;
    return true;
  });

  if (!filtered.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">등록한 교육이 없습니다.</div>
        <div>교육 등록 버튼으로 새 교육을 추가해 주세요.</div>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>교육명</th><th>유형</th><th>회사/지점</th><th>교육기간</th>
          <th>수료기한</th><th>상태</th><th>생성일</th><th style="width:140px"></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(t => {
          const branchSummary = t.branchNames?.length ? t.branchNames.join(", ") : "전체 지점";
          const soon          = isDeadlineSoon(t, now);
          const isOwner       = t.createdBy === authStore.uid;
          return `
            <tr data-id="${t.id}" style="cursor:pointer">
              <td><div style="font-weight:var(--weight-semibold);color:var(--gray-800)">${esc(t.title)}</div></td>
              <td>${esc(TRAINING_TYPE_LABELS[t.trainingType] ?? "기타")}</td>
              <td><div>${esc(t.companyName||"-")}</div><div style="font-size:var(--text-xs);color:var(--gray-400)">${esc(branchSummary)}</div></td>
              <td style="white-space:nowrap">${formatDate(t.startDate)} ~ ${formatDate(t.endDate)}</td>
              <td style="white-space:nowrap">${soon?`<span style="color:var(--color-warning)">⚠ </span>`:""}${formatDate(t.deadline)}</td>
              <td>${buildStatusChip(t.computedStatus)}</td>
              <td>${formatDate(t.createdAt)}</td>
              <td class="cell--actions">
                <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
                  ${isOwner ? `<button class="btn btn--ghost btn--sm btn-edit" data-id="${t.id}">수정</button>` : ""}
                  ${isOwner && t.computedStatus !== "closed" ? `<button class="btn btn--ghost btn--sm btn-close" data-id="${t.id}">종료</button>` : ""}
                  ${isOwner ? `<button class="btn btn--ghost btn--sm btn-del" data-id="${t.id}" style="color:var(--color-danger)">삭제</button>` : `<span style="font-size:var(--text-xs);color:var(--gray-400)">담당</span>`}
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
  wrap.querySelectorAll(".btn-edit").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); const t = state.trainings.find(x=>x.id===btn.dataset.id); if(t) openModal(t); })
  );
  wrap.querySelectorAll(".btn-close").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); confirmClose(btn.dataset.id); })
  );
  wrap.querySelectorAll(".btn-del").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); confirmDelete(btn.dataset.id); })
  );
}

// ── 교육 등록/수정 모달 ────────────────────────────────────

function openModal(training = null) {
  const refs   = state.references;
  const label  = training ? "저장" : "등록";
  const branchIds = training?.branchIds ?? [];

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
              ${TRAINING_TYPES.map(tp => `<option value="${tp}" ${training?.trainingType===tp?"selected":""}>${TRAINING_TYPE_LABELS[tp]}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">회사</label>
            <input class="form-control" type="text" value="${escAttr(refs?.company?.name || "-")}" disabled />
          </div>
          <div class="form-group">
            <label class="form-label">담당 강사 (나)</label>
            <input class="form-control" type="text" value="${escAttr(authStore.name)}" disabled />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">지점</label>
          <div class="selection-grid">
            ${(refs?.branches ?? []).map(b => `
              <label class="selection-chip">
                <input type="checkbox" class="branch-selector" value="${b.id}" ${branchIds.includes(b.id)?"checked":""} />
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
      { label:"취소", variant:"secondary", onClick:()=>modal.close() },
      { label, variant:"primary", onClick:()=>submitForm(training?.id ?? null, label, refs, training) },
    ],
  });
}

async function submitForm(trainingId, label, refs, current) {
  const title      = document.getElementById("t-title")?.value?.trim();
  const trainingType = document.getElementById("t-type")?.value;
  const branchIds  = Array.from(document.querySelectorAll(".branch-selector:checked")).map(c=>c.value);
  const startDate  = readDate("t-start");
  const endDate    = readDate("t-end");
  const deadline   = readDate("t-deadline");

  if (!title)                            { toast.error("교육명을 입력해 주세요."); return; }
  if (!startDate || !endDate || !deadline){ toast.error("날짜를 모두 입력해 주세요."); return; }
  if (endDate < startDate)               { toast.error("종료일은 시작일 이후여야 합니다."); return; }
  if (deadline < endDate)                { toast.error("수료기한은 종료일과 같거나 이후여야 합니다."); return; }

  modal.setLoading(label, true);
  try {
    const payload = buildTrainingPayload(
      { title, trainingType, description:"", instructorId: authStore.uid, instructorName: authStore.name, branchIds, startDate, endDate, deadline },
      refs,
      current
    );
    if (!trainingId) {
      payload.createdBy      = authStore.uid;
      payload.createdByName  = authStore.name;
      payload.instructorId   = authStore.uid;
      payload.instructorName = authStore.name;
    }
    payload.updatedAt = Date.now();
    await saveTraining(payload, trainingId);
    toast.success(trainingId ? "교육이 수정되었습니다." : "교육이 등록되었습니다.");
    modal.close();
    await loadData();
  } catch (err) {
    console.error("[instructor-trainings] save failed", err?.code, err?.message, err);
    toast.error("교육 저장 중 오류가 발생했습니다.");
    modal.setLoading(label, false);
  }
}

function confirmClose(id) {
  const t = state.trainings.find(x=>x.id===id);
  if (!t) return;
  modal.open({
    title:"교육 종료 처리", size:"sm",
    body:`<p style="font-size:var(--text-sm);color:var(--gray-600)"><strong>${esc(t.title)}</strong> 교육을 종료 처리하시겠습니까?</p>`,
    actions:[
      {label:"취소",variant:"secondary",onClick:()=>modal.close()},
      {label:"종료",variant:"primary",onClick:async()=>{
        modal.setLoading("종료",true);
        try{await closeTraining(id);toast.success("종료 처리되었습니다.");modal.close();await loadData();}
        catch(err){console.error("[instructor-trainings] close",err?.message,err);toast.error("오류가 발생했습니다.");modal.setLoading("종료",false);}
      }},
    ],
  });
}

function confirmDelete(id) {
  const t = state.trainings.find(x=>x.id===id);
  if (!t) return;
  modal.open({
    title:"교육 삭제", size:"sm",
    body:`<p style="font-size:var(--text-sm);color:var(--gray-600)"><strong>${esc(t.title)}</strong> 교육을 삭제하시겠습니까?</p>`,
    actions:[
      {label:"취소",variant:"secondary",onClick:()=>modal.close()},
      {label:"삭제",variant:"danger",onClick:async()=>{
        modal.setLoading("삭제",true);
        try{await deleteTraining(id);toast.success("삭제되었습니다.");modal.close();await loadData();}
        catch(err){console.error("[instructor-trainings] delete",err?.message,err);toast.error("오류가 발생했습니다.");modal.setLoading("삭제",false);}
      }},
    ],
  });
}

function readDate(id){ const v=document.getElementById(id)?.value; return v?new Date(`${v}T00:00:00`).getTime():null; }
function toDateInput(ts){ return ts?new Date(ts).toISOString().slice(0,10):""; }
function esc(v){ return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escAttr(v){ return esc(v).replace(/'/g,"&#39;"); }
