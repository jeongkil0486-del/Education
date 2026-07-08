/**
 * TAS WT — 지점 관리 (슈퍼관리자 전용)
 * js/views/admin/branches.js
 *
 * 저장: branchesDB.create(data)  → /branches/{pushId}  (companyId 필드 포함)
 * 조회: branchesDB.listAll()     → /branches 전체
 * 필터: branchesDB.list(companyId) → companyId 기준
 */

import { branchesDB, companiesDB } from "../../core/db.js";
import { modal }    from "../../utils/modal.js";
import { toast }    from "../../utils/toast.js";
import { formatDate } from "../../utils/date.js";

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">지점 관리</div>
        <div class="section-subtitle">회사별 지점을 등록하고 관리합니다</div>
      </div>
      <button class="btn btn--primary" id="btn-add-branch">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        지점 등록
      </button>
    </div>

    <div class="filter-bar">
      <select class="form-control" id="filter-company" style="max-width:240px">
        <option value="">전체 회사</option>
      </select>
      <div class="input-group" style="flex:1;max-width:280px">
        <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
          <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
        </svg>
        <input class="form-control" type="search" id="search-branch" placeholder="지점명 검색…"/>
      </div>
    </div>

    <div class="table-wrap" id="branch-table-wrap">
      <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-12)">
        <div class="splash__spinner"
          style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>
    </div>
  `;

  document.getElementById("btn-add-branch")
    ?.addEventListener("click", () => openForm());
  document.getElementById("filter-company")
    ?.addEventListener("change", () => applyFilter());
  document.getElementById("search-branch")
    ?.addEventListener("input", () => applyFilter());

  await loadData();
}

/* ── State ─────────────────────────────────────────────── */
let _branches  = [];
let _companies = [];

/* ── Load ──────────────────────────────────────────────── */
async function loadData() {
  try {
    // 반드시 listAll() 사용 — list()는 companyId 필터 필요
    [_branches, _companies] = await Promise.all([
      branchesDB.listAll().catch(() => []),
      companiesDB.list().catch(() => []),
    ]);
  } catch (err) {
    console.warn("[branches] loadData failed:", err?.message);
    _branches = []; _companies = [];
  }

  // 회사 필터 옵션 동기화
  const sel = document.getElementById("filter-company");
  if (sel) {
    // 기존 옵션(전체 제외) 제거 후 재삽입
    while (sel.options.length > 1) sel.remove(1);
    _companies.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
  }

  applyFilter();
}

/* ── Filter & Render ───────────────────────────────────── */
function applyFilter() {
  const companyId = document.getElementById("filter-company")?.value ?? "";
  const query     = (document.getElementById("search-branch")?.value ?? "").toLowerCase();

  let list = _branches;
  if (companyId) list = list.filter(b => b.companyId === companyId);
  if (query)     list = list.filter(b => (b.name ?? "").toLowerCase().includes(query));

  renderTable(list);
}

function renderTable(list) {
  const wrap = document.getElementById("branch-table-wrap");
  if (!wrap) return;

  if (!list.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">등록된 지점이 없습니다</div>
        <div>지점 등록 버튼으로 첫 번째 지점을 추가하세요.</div>
      </div>`;
    return;
  }

  const companyMap = Object.fromEntries(_companies.map(c => [c.id, c.name]));

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>지점명</th>
          <th>소속 회사</th>
          <th>지점코드</th>
          <th>지점장</th>
          <th>연락처</th>
          <th>등록일</th>
          <th style="width:80px"></th>
        </tr>
      </thead>
      <tbody>
        ${list.map(b => `
          <tr>
            <td style="font-weight:var(--weight-medium);color:var(--gray-800)">${esc(b.name)}</td>
            <td>${esc(companyMap[b.companyId] ?? "–")}</td>
            <td class="cell--mono">${esc(b.code ?? "–")}</td>
            <td>${esc(b.managerName ?? "–")}</td>
            <td>${esc(b.phone ?? "–")}</td>
            <td>${formatDate(b.createdAt)}</td>
            <td class="cell--actions">
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="btn btn--ghost btn--sm btn-edit" data-id="${b.id}" title="수정">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M9 2l3 3-7 7H2V9l7-7z"
                      stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
                  </svg>
                </button>
                <button class="btn btn--ghost btn--sm btn-delete"
                  data-id="${b.id}" title="삭제" style="color:var(--color-danger)">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 3h10M5 3V2h4v1M4 3v8a1 1 0 001 1h4a1 1 0 001-1V3"
                      stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll(".btn-edit").forEach(btn =>
    btn.addEventListener("click", () => {
      const item = _branches.find(b => b.id === btn.dataset.id);
      if (item) openForm(item);
    })
  );
  wrap.querySelectorAll(".btn-delete").forEach(btn =>
    btn.addEventListener("click", () => confirmDelete(btn.dataset.id))
  );
}

/* ── Form ──────────────────────────────────────────────── */
function openForm(item = null) {
  const isEdit = !!item;

  if (!_companies.length) {
    toast.warning("먼저 회사를 등록하세요.");
    return;
  }

  modal.open({
    title: isEdit ? "지점 수정" : "지점 등록",
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label form-label--required">소속 회사</label>
          <select class="form-control" id="f-company">
            <option value="">회사를 선택하세요</option>
            ${_companies.map(c =>
              `<option value="${c.id}" ${item?.companyId === c.id ? "selected" : ""}>${esc(c.name)}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">지점명</label>
            <input class="form-control" id="f-name" type="text"
              value="${esc(item?.name ?? "")}" placeholder="예) 서울 강남점"/>
          </div>
          <div class="form-group">
            <label class="form-label">지점코드</label>
            <input class="form-control" id="f-code" type="text"
              value="${esc(item?.code ?? "")}" placeholder="예) GN01"/>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">지점장</label>
            <input class="form-control" id="f-manager" type="text"
              value="${esc(item?.managerName ?? "")}"/>
          </div>
          <div class="form-group">
            <label class="form-label">연락처</label>
            <input class="form-control" id="f-phone" type="text"
              value="${esc(item?.phone ?? "")}" placeholder="02-0000-0000"/>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">주소</label>
          <input class="form-control" id="f-address" type="text"
            value="${esc(item?.address ?? "")}"/>
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: isEdit ? "저장" : "등록", variant: "primary",
        onClick: () => submitForm(item?.id ?? null) },
    ],
  });
}

async function submitForm(existingId) {
  const companyId   = document.getElementById("f-company")?.value;
  const name        = document.getElementById("f-name")?.value?.trim();
  const code        = document.getElementById("f-code")?.value?.trim();
  const managerName = document.getElementById("f-manager")?.value?.trim();
  const phone       = document.getElementById("f-phone")?.value?.trim();
  const address     = document.getElementById("f-address")?.value?.trim();

  if (!companyId) { toast.error("소속 회사를 선택하세요."); return; }
  if (!name)      { toast.error("지점명을 입력하세요."); return; }

  // 소속 회사명도 함께 저장 (목록에서 join 없이 표시하기 위해)
  const company     = _companies.find(c => c.id === companyId);
  const companyName = company?.name ?? "";

  const label = existingId ? "저장" : "등록";
  modal.setLoading(label, true);

  try {
    const data = { companyId, companyName, name, code, managerName, phone, address };

    if (existingId) {
      await branchesDB.update(existingId, data);
      toast.success("수정되었습니다.");
    } else {
      await branchesDB.create(data);
      toast.success("등록되었습니다.");
    }

    modal.close();
    await loadData();   // ← 저장 후 즉시 목록 갱신
  } catch (err) {
    console.error("[branches] submitForm error:", err);
    toast.error("저장 중 오류가 발생했습니다.");
    modal.setLoading(label, false);
  }
}

function confirmDelete(id) {
  const item = _branches.find(b => b.id === id);
  modal.open({
    title: "지점 삭제",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      <strong>"${esc(item?.name ?? "이 지점")}"</strong>을 삭제하시겠습니까?
    </p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "삭제", variant: "danger", onClick: async () => {
        modal.setLoading("삭제", true);
        try {
          await branchesDB.delete(id);
          toast.success("삭제되었습니다.");
          modal.close();
          await loadData();   // ← 삭제 후 즉시 목록 갱신
        } catch (err) {
          console.error("[branches] delete error:", err);
          toast.error("삭제 중 오류가 발생했습니다.");
          modal.setLoading("삭제", false);
        }
      }},
    ],
  });
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
