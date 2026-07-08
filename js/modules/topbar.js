/**
 * TAS Learning Hub — Topbar Module
 * Page title, breadcrumb, profile dropdown, logout.
 */

import { authStore } from "../core/auth.js";
import { router }    from "../core/router.js";
import { toast }     from "../utils/toast.js";

export function initTopbar() {
  const profile = authStore.profile;

  // Fill in user info everywhere
  setElement("nav-user-name",  profile.name);
  setElement("nav-user-role",  roleLabel(profile.role));
  setElement("nav-avatar",     authStore.initials);
  setElement("topbar-avatar",  authStore.initials);
  setElement("profile-name",   profile.name);
  setElement("profile-meta",   `${profile.branchName ?? "본사"} · ${roleLabel(profile.role)}`);

  // Toggle profile dropdown
  document.getElementById("btn-profile-menu")?.addEventListener("click", e => {
    e.stopPropagation();
    toggleDropdown("profile-menu");
    closeDropdown("notif-panel");
  });

  // Logout buttons
  ["btn-logout", "btn-logout2"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", handleLogout);
  });

  // My profile
  document.getElementById("btn-my-profile")?.addEventListener("click", () => {
    closeDropdown("profile-menu");
    router.push("my-profile");
  });

  // Change password
  document.getElementById("btn-change-password")?.addEventListener("click", () => {
    closeDropdown("profile-menu");
    import("../modules/change-password.js").then(m => m.openChangePasswordModal());
  });

  // Close dropdowns on outside click
  document.addEventListener("click", () => {
    closeDropdown("profile-menu");
    closeDropdown("notif-panel");
  });
}

export function setPageTitle(title) {
  document.getElementById("page-title").textContent = title;
  document.title = `${title} — TAS Learning Hub`;
}

export function setBreadcrumb(title) {
  const el = document.getElementById("breadcrumb");
  if (!el) return;
  el.innerHTML = `
    <span class="breadcrumb__item">홈</span>
    <span class="breadcrumb__sep">›</span>
    <span class="breadcrumb__item">${title}</span>
  `;
}

export function setBreadcrumbItems(items) {
  const el = document.getElementById("breadcrumb");
  if (!el) return;
  el.innerHTML = items.map((item, i) => `
    ${i > 0 ? '<span class="breadcrumb__sep">›</span>' : ""}
    <span class="breadcrumb__item">${item}</span>
  `).join("");
}

/* ── Helpers ─────────────────────────────────────────────── */
function setElement(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function toggleDropdown(id) {
  document.getElementById(id)?.classList.toggle("hidden");
}

function closeDropdown(id) {
  document.getElementById(id)?.classList.add("hidden");
}

async function handleLogout() {
  try {
    await authStore.signOut();
    window.location.reload();
  } catch (err) {
    toast.error("로그아웃 중 오류가 발생했습니다.");
  }
}

const ROLE_LABELS = {
  super_admin: "슈퍼관리자",
  hq_admin:    "본사 교육관리자",
  instructor:  "강사",
  employee:    "직원",
};

function roleLabel(role) {
  return ROLE_LABELS[role] ?? role ?? "–";
}
