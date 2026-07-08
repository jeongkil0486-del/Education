/**
 * TAS Education Lab - 계정 관리
 * 슈퍼관리자가 본사 교육관리자/강사 계정을 생성, 삭제, 권한 변경합니다.
 */

import { usersDB } from "../../core/db.js";
import { createManagedAccount, deleteManagedAccount } from "../../core/admin-api.js";
import { modal } from "../../utils/modal.js";
import { toast } from "../../utils/toast.js";
import { formatDate } from "../../utils/date.js";

const ROLE_LABELS = {
  super_admin: "슈퍼관리자",
  hq_admin: "본사 교육관리자",
  instructor: "강사",
  employee: "직원",
};

const MANAGEABLE_ROLES = ["hq_admin", "instructor"];

let accountList = [];

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">계정 관리</div>
        <div class="section-subtitle">본사 교육관리자와 강사 계정을 생성하고 권한을 관리합니다.</div>
      </div>
      <button class="btn btn--primary" id="btn-add-account">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        계정 생성
      </button>
    </div>

    <div class="tabs" id="role-tabs">
      <button class="tab-btn active" data-role="">전체</button>
      <button class="tab-btn" data-role="hq_admin">본사 교육관리자</button>
      <button class="tab-btn" data-role="instructor">강사</button>
    </div>

    <div class="filter-bar">
      <div class="input-group filter-bar__search">
        <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
          <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
        </svg>
        <input class="form-control" type="search" id="search-accounts" placeholder="이름, 사번으로 검색" />
      </div>
    </div>

    <div class="table-wrap" id="account-table-wrap">
      <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-12)">
        <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>
    </div>
  `;

  document.getElementById("btn-add-account")?.addEventListener("click", openCreateModal);
  document.getElementById("search-accounts")?.addEventListener("input", (event) => {
    applyFilter(event.target.value);
  });

  document.querySelectorAll(".tab-btn[data-role]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      applyFilter(null, button.dataset.role);
    });
  });

  await loadList();
}

async function loadList() {
  try {
    const allUsers = await usersDB.listAll();
    accountList = allUsers.filter((user) => MANAGEABLE_ROLES.includes(user?.role));
  } catch (error) {
    console.warn("[accounts] load failed:", error?.message);
    accountList = [];
  }

  renderTable(accountList);
}

function applyFilter(search, role) {
  const query = String(search ?? document.getElementById("search-accounts")?.value ?? "").trim().toLowerCase();
  const selectedRole = role ?? document.querySelector(".tab-btn.active")?.dataset.role ?? "";

  let filtered = accountList;

  if (query) {
    filtered = filtered.filter((user) =>
      String(user?.name ?? "").toLowerCase().includes(query) ||
      String(user?.empNo ?? "").toLowerCase().includes(query)
    );
  }

  if (selectedRole) {
    filtered = filtered.filter((user) => user?.role === selectedRole);
  }

  renderTable(filtered);
}

function renderTable(list) {
  const wrap = document.getElementById("account-table-wrap");
  if (!wrap) return;

  if (!list.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">등록된 계정이 없습니다.</div>
        <div>계정 생성 버튼으로 본사 교육관리자 또는 강사 계정을 추가해 주세요.</div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>이름</th>
          <th>사번</th>
          <th>권한</th>
          <th>소속 지점</th>
          <th>상태</th>
          <th>등록일</th>
          <th style="width:120px"></th>
        </tr>
      </thead>
      <tbody>
        ${list.map((user) => {
          const uid = accountKey(user);
          const inactive = user?.active === false || user?.disabled === true;

          return `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:var(--space-3)">
                  <div class="avatar avatar--sm">${initials(user?.name)}</div>
                  <span style="font-weight:var(--weight-medium);color:var(--gray-800)">${esc(user?.name)}</span>
                </div>
              </td>
              <td class="cell--mono">${esc(user?.empNo || uid.slice(0, 8) || "-")}</td>
              <td><span class="chip chip--${roleChipVariant(user?.role)}">${ROLE_LABELS[user?.role] ?? esc(user?.role)}</span></td>
              <td>${esc(user?.branchName ?? "-")}</td>
              <td>
                <span class="status-dot status-dot--${inactive ? "danger" : "active"}" style="display:inline-block;margin-right:4px"></span>
                ${inactive ? "비활성" : "활성"}
              </td>
              <td>${formatDate(user?.createdAt)}</td>
              <td class="cell--actions">
                <div style="display:flex;gap:4px;justify-content:flex-end">
                  <button class="btn btn--ghost btn--sm btn-role" data-id="${uid}" data-role="${user?.role}" title="권한 변경">
                    권한
                  </button>
                  <button class="btn btn--ghost btn--sm btn-reset-pw" data-id="${uid}" title="비밀번호 초기화 안내">
                    PW
                  </button>
                  <button class="btn btn--ghost btn--sm btn-delete" data-id="${uid}" data-name="${escAttr(user?.name)}" title="계정 삭제" style="color:var(--color-danger)">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 3h10M5 3V2h4v1M4 3v8a1 1 0 001 1h4a1 1 0 001-1V3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll(".btn-role").forEach((button) => {
    button.addEventListener("click", () => openRoleModal(button.dataset.id, button.dataset.role));
  });

  wrap.querySelectorAll(".btn-reset-pw").forEach((button) => {
    button.addEventListener("click", () => confirmResetPw(button.dataset.id));
  });

  wrap.querySelectorAll(".btn-delete").forEach((button) => {
    button.addEventListener("click", () => confirmDelete(button.dataset.id, button.dataset.name));
  });
}

function openCreateModal() {
  modal.open({
    title: "계정 생성",
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label form-label--required">권한</label>
          <select class="form-control" id="f-role">
            <option value="hq_admin">본사 교육관리자</option>
            <option value="instructor">강사</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">이름</label>
            <input class="form-control" id="f-name" type="text" placeholder="이름 입력" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">사번</label>
            <input class="form-control" id="f-empno" type="text" placeholder="예: tasedu01" autocapitalize="none" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label form-label--required">임시 비밀번호</label>
          <input class="form-control" id="f-pw" type="text" placeholder="초기 비밀번호" />
          <div class="form-hint">
            생성 버튼을 누르면 Firebase Authentication 계정과 Realtime Database 사용자 정보가 함께 등록됩니다.<br/>
            생성 이메일: <code style="font-family:var(--font-mono)">{사번}@tas.local</code>
          </div>
        </div>
      </div>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "생성", variant: "primary", onClick: submitCreate },
    ],
  });
}

async function submitCreate() {
  const role = document.getElementById("f-role")?.value;
  const name = document.getElementById("f-name")?.value?.trim();
  const empNo = document.getElementById("f-empno")?.value?.trim().toLowerCase();
  const password = document.getElementById("f-pw")?.value?.trim();

  if (!name) {
    toast.error("이름을 입력해 주세요.");
    return;
  }

  if (!empNo) {
    toast.error("사번을 입력해 주세요.");
    return;
  }

  if (!password) {
    toast.error("임시 비밀번호를 입력해 주세요.");
    return;
  }

  if (password.length < 6) {
    toast.error("임시 비밀번호는 6자 이상으로 입력해 주세요.");
    return;
  }

  modal.setLoading("생성", true);

  try {
    await createManagedAccount({ role, name, empNo, password });
    toast.success(`${ROLE_LABELS[role] ?? "계정"} 계정이 생성되었습니다.`);
    modal.close();
    await loadList();
  } catch (error) {
    console.error("[accounts] create failed", error);
    toast.error(error?.message || "계정 생성 중 오류가 발생했습니다.");
    modal.setLoading("생성", false);
  }
}

function openRoleModal(uid, currentRole) {
  modal.open({
    title: "권한 변경",
    size: "sm",
    body: `
      <div class="form-group">
        <label class="form-label">권한</label>
        <select class="form-control" id="f-new-role">
          ${MANAGEABLE_ROLES.map((role) =>
            `<option value="${role}" ${role === currentRole ? "selected" : ""}>${ROLE_LABELS[role]}</option>`
          ).join("")}
        </select>
      </div>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "변경",
        variant: "primary",
        onClick: async () => {
          const newRole = document.getElementById("f-new-role")?.value;
          modal.setLoading("변경", true);

          try {
            await usersDB.update(uid, { role: newRole });
            toast.success("권한이 변경되었습니다.");
            modal.close();
            await loadList();
          } catch (error) {
            console.error("[accounts] role update failed", error);
            toast.error("권한 변경 중 오류가 발생했습니다.");
            modal.setLoading("변경", false);
          }
        },
      },
    ],
  });
}

function confirmResetPw() {
  modal.open({
    title: "비밀번호 초기화 안내",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        비밀번호 초기화는 현재 Firebase Console의 Authentication 메뉴에서 처리하고 있습니다.<br/><br/>
        추후 필요하면 Cloud Function 기반 초기화 기능으로 확장할 수 있습니다.
      </p>
    `,
    actions: [
      { label: "확인", variant: "primary", onClick: () => modal.close() },
    ],
  });
}

function confirmDelete(uid, name) {
  modal.open({
    title: "계정 삭제",
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        <strong>"${esc(name)}"</strong> 계정을 삭제하시겠습니까?<br/>
        Firebase Authentication 계정과 Realtime Database 사용자 정보가 함께 삭제됩니다.
      </p>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "삭제",
        variant: "danger",
        onClick: async () => {
          modal.setLoading("삭제", true);

          try {
            await deleteManagedAccount({ uid });
            toast.success("계정이 삭제되었습니다.");
            modal.close();
            await loadList();
          } catch (error) {
            console.error("[accounts] delete failed", error);
            toast.error(error?.message || "계정 삭제 중 오류가 발생했습니다.");
            modal.setLoading("삭제", false);
          }
        },
      },
    ],
  });
}

function roleChipVariant(role) {
  return {
    super_admin: "danger",
    hq_admin: "primary",
    instructor: "info",
    employee: "neutral",
  }[role] ?? "neutral";
}

function initials(name) {
  return String(name ?? "--").slice(0, 2).toUpperCase();
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(value) {
  return esc(value).replace(/'/g, "&#39;");
}

function accountKey(user) {
  return user?.id ?? user?.uid ?? "";
}
