/**
 * TAS WT — 계정 관리 (슈퍼관리자 전용)
 * js/views/admin/accounts.js
 *
 * 관리자·강사 계정 생성/삭제/비밀번호 초기화/권한 변경.
 * 직원 계정은 별도 직원 관리 화면에서 처리.
 */

import { usersDB }    from "../../core/db.js";
import { modal }      from "../../utils/modal.js";
import { toast }      from "../../utils/toast.js";
import { formatDate } from "../../utils/date.js";

const ROLE_LABELS = {
  super_admin: "슈퍼관리자",
  hq_admin:    "본사 교육관리자",
  instructor:  "강사",
  employee:    "직원",
};

const MANAGEABLE_ROLES = ["hq_admin", "instructor"];

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">계정 관리</div>
        <div class="section-subtitle">관리자·강사 계정을 생성하고 권한을 관리합니다</div>
      </div>
      <button class="btn btn--primary" id="btn-add-account">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        계정 생성
      </button>
    </div>

    <!-- 역할 필터 탭 -->
    <div class="tabs" id="role-tabs">
      <button class="tab-btn active" data-role="">전체</button>
      <button class="tab-btn" data-role="hq_admin">본사 교육관리자</button>
      <button class="tab-btn" data-role="instructor">강사</button>
    </div>

    <!-- 검색 -->
    <div class="filter-bar">
      <div class="input-group filter-bar__search">
        <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
          <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
        </svg>
        <input class="form-control" type="search" id="search-accounts" placeholder="이름·사번 검색…"/>
      </div>
    </div>

    <div class="table-wrap" id="account-table-wrap">
      <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-12)">
        <div class="splash__spinner"
          style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>
    </div>
  `;

  document.getElementById("btn-add-account")
    ?.addEventListener("click", () => openCreateModal());
  document.getElementById("search-accounts")
    ?.addEventListener("input", e => applyFilter(e.target.value));
  document.querySelectorAll(".tab-btn[data-role]").forEach(btn =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyFilter(null, btn.dataset.role);
    })
  );

  await loadList();
}

let _list = [];

async function loadList() {
  try {
    const all = await usersDB.listAll();
    _list = all.filter(u => MANAGEABLE_ROLES.includes(u.role));
  } catch (err) {
    console.warn("[accounts] load failed:", err?.message);
    _list = [];
  }
  renderTable(_list);
}

function applyFilter(search, role) {
  const q = (search ?? document.getElementById("search-accounts")?.value ?? "").toLowerCase();
  const r = role ?? document.querySelector(".tab-btn.active")?.dataset.role ?? "";
  let filtered = _list;
  if (q) filtered = filtered.filter(u =>
    (u.name ?? "").toLowerCase().includes(q) ||
    (u.empNo ?? "").toLowerCase().includes(q)
  );
  if (r) filtered = filtered.filter(u => u.role === r);
  renderTable(filtered);
}

function renderTable(list) {
  const wrap = document.getElementById("account-table-wrap");
  if (!wrap) return;

  if (!list.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">등록된 계정이 없습니다</div>
        <div>계정 생성 버튼으로 첫 번째 계정을 추가하세요.</div>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>이름</th>
          <th>사번</th>
          <th>역할</th>
          <th>소속 지점</th>
          <th>상태</th>
          <th>등록일</th>
          <th style="width:120px"></th>
        </tr>
      </thead>
      <tbody>
        ${list.map(u => `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:var(--space-3)">
                <div class="avatar avatar--sm">${initials(u.name)}</div>
                <span style="font-weight:var(--weight-medium);color:var(--gray-800)">${esc(u.name)}</span>
              </div>
            </td>
            <td class="cell--mono">${esc(u.empNo ?? u.uid?.slice(0, 8) ?? "–")}</td>
            <td><span class="chip chip--${roleChipVariant(u.role)}">${ROLE_LABELS[u.role] ?? u.role}</span></td>
            <td>${esc(u.branchName ?? "–")}</td>
            <td>
              <span class="status-dot status-dot--${u.disabled ? "danger" : "active"}"
                style="display:inline-block;margin-right:4px"></span>
              ${u.disabled ? "비활성" : "활성"}
            </td>
            <td>${formatDate(u.createdAt)}</td>
            <td class="cell--actions">
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="btn btn--ghost btn--sm btn-role"
                  data-id="${u.uid}" data-role="${u.role}" title="권한 변경">
                  권한
                </button>
                <button class="btn btn--ghost btn--sm btn-reset-pw"
                  data-id="${u.uid}" title="비밀번호 초기화">
                  PW
                </button>
                <button class="btn btn--ghost btn--sm btn-delete"
                  data-id="${u.uid}" data-name="${esc(u.name)}"
                  title="계정 삭제" style="color:var(--color-danger)">
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

  wrap.querySelectorAll(".btn-role").forEach(btn =>
    btn.addEventListener("click", () => openRoleModal(btn.dataset.id, btn.dataset.role))
  );
  wrap.querySelectorAll(".btn-reset-pw").forEach(btn =>
    btn.addEventListener("click", () => confirmResetPw(btn.dataset.id))
  );
  wrap.querySelectorAll(".btn-delete").forEach(btn =>
    btn.addEventListener("click", () => confirmDelete(btn.dataset.id, btn.dataset.name))
  );
}

/* ── 계정 생성 ─────────────────────────────────────────── */
function openCreateModal() {
  modal.open({
    title: "계정 생성",
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label form-label--required">역할</label>
          <select class="form-control" id="f-role">
            <option value="hq_admin">본사 교육관리자</option>
            <option value="instructor">강사</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">이름</label>
            <input class="form-control" id="f-name" type="text" placeholder="홍길동"/>
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">사번</label>
            <input class="form-control" id="f-empno" type="text"
              placeholder="예) TASEDU" autocapitalize="none"/>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label form-label--required">임시 비밀번호</label>
          <input class="form-control" id="f-pw" type="text" placeholder="초기 비밀번호"/>
          <div class="form-hint">
            계정 생성 후 Firebase Authentication에서 이메일 계정을 별도로 생성해야 합니다.<br/>
            이메일 형식: <code style="font-family:var(--font-mono)">{사번소문자}@tas.local</code>
          </div>
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "생성", variant: "primary", onClick: submitCreate },
    ],
  });
}

async function submitCreate() {
  const role  = document.getElementById("f-role")?.value;
  const name  = document.getElementById("f-name")?.value?.trim();
  const empNo = document.getElementById("f-empno")?.value?.trim().toLowerCase();

  if (!name)  { toast.error("이름을 입력하세요."); return; }
  if (!empNo) { toast.error("사번을 입력하세요."); return; }

  modal.setLoading("생성", true);
  try {
    // DB에 프로필 저장 (Firebase Auth 계정은 Firebase Console에서 별도 생성)
    // uid를 empNo로 쓰거나, push key 사용 — 여기서는 empNo를 key로 사용
    await usersDB.create(empNo, { name, empNo, role, email: `${empNo}@tas.local` });
    toast.success(`계정이 생성되었습니다. Firebase Console에서 ${empNo}@tas.local 인증 계정을 추가하세요.`);
    modal.close();
    await loadList();
  } catch (err) {
    toast.error("생성 중 오류가 발생했습니다.");
    console.error(err);
    modal.setLoading("생성", false);
  }
}

/* ── 권한 변경 ─────────────────────────────────────────── */
function openRoleModal(uid, currentRole) {
  modal.open({
    title: "권한 변경",
    size: "sm",
    body: `
      <div class="form-group">
        <label class="form-label">새 역할</label>
        <select class="form-control" id="f-new-role">
          ${MANAGEABLE_ROLES.map(r =>
            `<option value="${r}" ${r === currentRole ? "selected" : ""}>${ROLE_LABELS[r]}</option>`
          ).join("")}
        </select>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "변경", variant: "primary", onClick: async () => {
        const newRole = document.getElementById("f-new-role")?.value;
        modal.setLoading("변경", true);
        try {
          await usersDB.update(uid, { role: newRole });
          toast.success("권한이 변경되었습니다.");
          modal.close();
          await loadList();
        } catch {
          toast.error("변경 중 오류가 발생했습니다.");
          modal.setLoading("변경", false);
        }
      }},
    ],
  });
}

/* ── 비밀번호 초기화 안내 ─────────────────────────────── */
function confirmResetPw(uid) {
  modal.open({
    title: "비밀번호 초기화",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      비밀번호 초기화는 Firebase Console →<br/>
      Authentication → 해당 계정 → 비밀번호 재설정에서 처리하세요.<br/><br/>
      또는 Cloud Functions를 통해 자동화할 수 있습니다.
    </p>`,
    actions: [
      { label: "확인", variant: "primary", onClick: () => modal.close() },
    ],
  });
}

/* ── 계정 삭제 ─────────────────────────────────────────── */
function confirmDelete(uid, name) {
  modal.open({
    title: "계정 삭제",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      <strong>"${esc(name)}"</strong> 계정을 삭제하시겠습니까?<br/>
      Firebase Authentication 계정은 Console에서 별도로 삭제하세요.
    </p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "삭제", variant: "danger", onClick: async () => {
        modal.setLoading("삭제", true);
        try {
          await usersDB.delete(uid);
          toast.success("삭제되었습니다.");
          modal.close();
          await loadList();
        } catch {
          toast.error("삭제 중 오류가 발생했습니다.");
          modal.setLoading("삭제", false);
        }
      }},
    ],
  });
}

/* ── helpers ───────────────────────────────────────────── */
function roleChipVariant(role) {
  return { super_admin: "danger", hq_admin: "primary", instructor: "info", employee: "neutral" }[role] ?? "neutral";
}
function initials(name) {
  return String(name ?? "–").slice(0, 2).toUpperCase();
}
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
