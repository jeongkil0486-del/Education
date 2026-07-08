/**
 * TAS Learning Hub — Trainings View (HQ Admin)
 * List, create, edit, delete trainings.
 * Each training can be assigned to users and tracked.
 */

import { authStore }    from "../core/auth.js";
import { trainingsDB }  from "../core/db.js";
import { modal }        from "../utils/modal.js";
import { toast }        from "../utils/toast.js";
import { formatDate, isOverdue, daysFromNow } from "../utils/date.js";
import { router }       from "../core/router.js";

let _allTrainings = [];

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">교육 관리</div>
        <div class="section-subtitle">교육을 등록하고 대상자를 지정하세요</div>
      </div>
      <button class="btn btn--primary" id="btn-create-training">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        교육 등록
      </button>
    </div>

    <!-- Filter bar -->
    <div class="filter-bar">
      <div class="filter-bar__search input-group" style="flex:1;max-width:320px">
        <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
          <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
        </svg>
        <input class="form-control" type="search" id="search-trainings" placeholder="교육명 검색…" />
      </div>
      <div class="filter-bar__selects">
        <select class="form-control" id="filter-status" style="min-width:120px">
          <option value="">전체 상태</option>
          <option value="active">진행중</option>
          <option value="upcoming">예정</option>
          <option value="overdue">기한 초과</option>
          <option value="closed">종료</option>
        </select>
      </div>
      <div class="filter-bar__actions">
        <button class="btn btn--secondary btn--sm" id="btn-export">
          엑셀 다운로드
        </button>
      </div>
    </div>

    <!-- Table -->
    <div class="table-wrap" id="trainings-table-wrap">
      <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-12)">
        <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>
    </div>
  `;

  document.getElementById("btn-create-training")?.addEventListener("click", openCreateModal);
  document.getElementById("search-trainings")?.addEventListener("input", e => filterTable(e.target.value));
  document.getElementById("filter-status")?.addEventListener("change", e => filterTable(null, e.target.value));
  document.getElementById("btn-export")?.addEventListener("click", exportToExcel);

  await loadTrainings();
}

async function loadTrainings() {
  _allTrainings = await trainingsDB.list(authStore.companyId);
  renderTable(_allTrainings);
}

function renderTable(trainings) {
  const wrap = document.getElementById("trainings-table-wrap");
  if (!wrap) return;

  if (!trainings.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-16)">
      <div class="empty-state__title">등록된 교육이 없습니다</div>
      <div>교육 등록 버튼으로 첫 교육을 추가하세요</div>
    </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>교육명</th>
          <th>대상</th>
          <th>담당 강사</th>
          <th>시작일</th>
          <th>수료기한</th>
          <th>상태</th>
          <th>완료율</th>
          <th style="width:80px"></th>
        </tr>
      </thead>
      <tbody>
        ${trainings.map(t => trainingRow(t)).join("")}
      </tbody>
    </table>
  `;

  // Row click → detail
  wrap.querySelectorAll("tr[data-id]").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest(".cell--actions")) return;
      router.push("training-detail", { id: row.dataset.id });
    });
  });

  // Action buttons
  wrap.querySelectorAll(".btn-edit").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const t = _allTrainings.find(t => t.id === btn.dataset.id);
      if (t) openEditModal(t);
    });
  });

  wrap.querySelectorAll(".btn-delete").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      confirmDelete(btn.dataset.id);
    });
  });
}

function trainingRow(t) {
  const now     = Date.now();
  const overdue = t.deadline && t.deadline < now;
  const upcoming = t.startDate && t.startDate > now;
  const pct     = t.totalAssigned > 0
    ? Math.round((t.totalCompleted / t.totalAssigned) * 100) : 0;

  return `
    <tr data-id="${t.id}" style="cursor:pointer">
      <td style="font-weight:var(--weight-medium);color:var(--gray-800)">${t.title}</td>
      <td style="font-size:var(--text-xs);color:var(--gray-500)">${targetLabel(t.target)}</td>
      <td style="font-size:var(--text-sm)">${t.instructorName ?? "–"}</td>
      <td>${formatDate(t.startDate)}</td>
      <td style="color:${overdue ? "var(--color-danger)" : "inherit"}">${formatDate(t.deadline)}</td>
      <td>${statusChip(t, now)}</td>
      <td style="min-width:120px">
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <div class="progress" style="flex:1"><div class="progress__fill" style="width:${pct}%"></div></div>
          <span style="font-size:var(--text-xs);color:var(--gray-400);min-width:32px;text-align:right">${pct}%</span>
        </div>
      </td>
      <td class="cell--actions">
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn btn--ghost btn--sm btn-edit" data-id="${t.id}" title="수정">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2l3 3-7 7H2V9l7-7z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="btn btn--ghost btn--sm btn-delete" data-id="${t.id}" title="삭제"
            style="color:var(--color-danger)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 3h10M5 3V2h4v1M4 3v8a1 1 0 001 1h4a1 1 0 001-1V3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function statusChip(t, now) {
  if (t.status === "closed") return `<span class="chip chip--neutral">종료</span>`;
  if (t.deadline && t.deadline < now) return `<span class="chip chip--danger">기한 초과</span>`;
  if (t.startDate && t.startDate > now) return `<span class="chip chip--info">예정</span>`;
  return `<span class="chip chip--success">진행중</span>`;
}

function targetLabel(target) {
  if (!target || target === "all") return "전체";
  if (target.branch)     return `지점: ${target.branch}`;
  if (target.department) return `부서: ${target.department}`;
  if (target.grade)      return `직급: ${target.grade}`;
  return "개별 지정";
}

/* ── Filter ──────────────────────────────────────────────── */
function filterTable(search, status) {
  const s = search ?? document.getElementById("search-trainings")?.value ?? "";
  const f = status ?? document.getElementById("filter-status")?.value ?? "";
  const now = Date.now();

  let filtered = _allTrainings;

  if (s) {
    const q = s.toLowerCase();
    filtered = filtered.filter(t => t.title?.toLowerCase().includes(q));
  }

  if (f) {
    filtered = filtered.filter(t => {
      if (f === "active")   return t.startDate <= now && t.deadline >= now;
      if (f === "upcoming") return t.startDate > now;
      if (f === "overdue")  return t.deadline < now && t.status !== "closed";
      if (f === "closed")   return t.status === "closed";
      return true;
    });
  }

  renderTable(filtered);
}

/* ── Create / Edit Modal ─────────────────────────────────── */
function openCreateModal() {
  openFormModal({ mode: "create" });
}

function openEditModal(training) {
  openFormModal({ mode: "edit", training });
}

function openFormModal({ mode, training = {} }) {
  const isEdit = mode === "edit";

  modal.open({
    title: isEdit ? "교육 수정" : "교육 등록",
    size: "lg",
    body: trainingForm(training),
    actions: [
      { label: "취소",                variant: "secondary", onClick: () => modal.close() },
      { label: isEdit ? "저장" : "등록", variant: "primary",   onClick: () => submitForm(training.id) },
    ],
  });

  // Date pickers, etc. initialized after DOM is ready
  initFormListeners();
}

function trainingForm(t = {}) {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="form-group">
        <label class="form-label form-label--required">교육명</label>
        <input class="form-control" id="f-title" type="text" value="${t.title ?? ""}" placeholder="예) 2024년 서비스교육" />
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label form-label--required">시작일</label>
          <input class="form-control" id="f-start" type="date" value="${tsToDateInput(t.startDate)}" />
        </div>
        <div class="form-group">
          <label class="form-label form-label--required">종료일</label>
          <input class="form-control" id="f-end" type="date" value="${tsToDateInput(t.endDate)}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label form-label--required">수료기한</label>
        <input class="form-control" id="f-deadline" type="date" value="${tsToDateInput(t.deadline)}" />
      </div>

      <div class="form-group">
        <label class="form-label">교육 대상</label>
        <select class="form-control" id="f-target">
          <option value="all" ${t.targetType === "all" ? "selected" : ""}>전체</option>
          <option value="branch" ${t.targetType === "branch" ? "selected" : ""}>지점별</option>
          <option value="department" ${t.targetType === "department" ? "selected" : ""}>부서별</option>
          <option value="grade" ${t.targetType === "grade" ? "selected" : ""}>직급별</option>
          <option value="individual" ${t.targetType === "individual" ? "selected" : ""}>개별 지정</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">담당 강사</label>
        <input class="form-control" id="f-instructor" type="text" value="${t.instructorName ?? ""}"
          placeholder="강사 이름 또는 이메일 검색" />
      </div>

      <div class="form-group">
        <label class="form-label">교육 설명</label>
        <textarea class="form-control" id="f-description" rows="3" placeholder="교육 목표, 내용 요약 등을 입력하세요">${t.description ?? ""}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label">교육자료</label>
        <select class="form-control" id="f-material">
          <option value="">교육자료를 선택하세요</option>
        </select>
        <div class="form-hint">교육자료 탭에서 먼저 자료를 업로드하세요</div>
      </div>
    </div>
  `;
}

function initFormListeners() {
  // Could load material options dynamically here
}

async function submitForm(existingId) {
  const title      = document.getElementById("f-title")?.value?.trim();
  const startDate  = dateInputToTs("f-start");
  const endDate    = dateInputToTs("f-end");
  const deadline   = dateInputToTs("f-deadline");
  const targetType = document.getElementById("f-target")?.value;
  const instructor = document.getElementById("f-instructor")?.value?.trim();
  const description = document.getElementById("f-description")?.value?.trim();
  const materialId = document.getElementById("f-material")?.value;

  if (!title) { toast.error("교육명을 입력하세요."); return; }
  if (!startDate || !endDate) { toast.error("시작일과 종료일을 입력하세요."); return; }
  if (!deadline) { toast.error("수료기한을 입력하세요."); return; }

  modal.setLoading("등록", true);
  modal.setLoading("저장", true);

  try {
    const data = {
      title, startDate, endDate, deadline,
      targetType: targetType || "all",
      instructorName: instructor,
      description,
      materialId: materialId || null,
      companyId: authStore.companyId,
      status: "active",
    };

    if (existingId) {
      await trainingsDB.update(existingId, data);
      toast.success("교육이 수정되었습니다.");
    } else {
      await trainingsDB.create(data);
      toast.success("교육이 등록되었습니다.");
    }

    modal.close();
    await loadTrainings();
  } catch (err) {
    console.error(err);
    toast.error("저장 중 오류가 발생했습니다.");
  } finally {
    modal.setLoading("등록", false);
    modal.setLoading("저장", false);
  }
}

async function confirmDelete(id) {
  const t = _allTrainings.find(t => t.id === id);
  modal.open({
    title: "교육 삭제",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      <strong>"${t?.title ?? "이 교육"}"</strong>을(를) 삭제하시겠습니까?<br/>
      관련 배정 및 수료 기록도 함께 삭제됩니다.
    </p>`,
    actions: [
      { label: "취소",  variant: "secondary", onClick: () => modal.close() },
      { label: "삭제",  variant: "danger",    onClick: async () => {
        modal.setLoading("삭제", true);
        try {
          await trainingsDB.delete(id);
          toast.success("삭제되었습니다.");
          modal.close();
          await loadTrainings();
        } catch {
          toast.error("삭제 중 오류가 발생했습니다.");
          modal.setLoading("삭제", false);
        }
      }},
    ],
  });
}

/* ── Excel export placeholder ────────────────────────────── */
function exportToExcel() {
  // TODO: implement with SheetJS or Cloud Function
  toast.info("엑셀 다운로드 기능은 곧 제공될 예정입니다.");
}

/* ── Date helpers ────────────────────────────────────────── */
function tsToDateInput(ts) {
  if (!ts) return "";
  return new Date(ts).toISOString().slice(0, 10);
}

function dateInputToTs(id) {
  const val = document.getElementById(id)?.value;
  return val ? new Date(val).getTime() : null;
}
