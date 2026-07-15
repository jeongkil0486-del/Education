import { authStore } from "../core/auth.js";
import { TEXT } from "../constants/text.js";
import { toast } from "../utils/toast.js";

export function initTopbar() {
  const profile = authStore.profile;

  setElement("nav-user-name", profile.name);
  setElement("nav-user-role", roleLabel(profile.role));
  setElement("nav-avatar", authStore.initials);
  setElement("topbar-avatar", authStore.initials);
  setElement("profile-name", profile.name);
  setElement(
    "profile-meta",
    `${profile.branchName ?? TEXT.roles.headquarters}${TEXT.topbar.profileMetaSeparator}${roleLabel(profile.role)}`
  );
  setElement("btn-change-password", TEXT.common.changePassword);
  setElement("btn-logout2", TEXT.common.logout);

  const sidebarLogoutLabel = document.querySelector("#btn-logout span");
  if (sidebarLogoutLabel) sidebarLogoutLabel.textContent = TEXT.common.logout;

  document.getElementById("btn-profile-menu")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleDropdown("profile-menu");
    closeDropdown("notif-panel");
  });

  ["btn-logout", "btn-logout2"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", handleLogout);
  });

  document.getElementById("btn-change-password")?.addEventListener("click", () => {
    closeDropdown("profile-menu");
    import("../modules/change-password.js").then((module) => module.openChangePasswordModal());
  });

  document.addEventListener("click", () => {
    closeDropdown("profile-menu");
    closeDropdown("notif-panel");
  });
}

export function setPageTitle(title) {
  const el = document.getElementById("page-title");
  if (el) el.textContent = title;
  document.title = `${title} | ${TEXT.topbar.titleSuffix}`;
}

export function setBreadcrumb(title) {
  const el = document.getElementById("breadcrumb");
  if (!el) return;
  el.innerHTML = `
    <span class="breadcrumb__item">${TEXT.common.home}</span>
    <span class="breadcrumb__sep">/</span>
    <span class="breadcrumb__item">${title}</span>
  `;
}

export function setBreadcrumbItems(items) {
  const el = document.getElementById("breadcrumb");
  if (!el) return;
  el.innerHTML = items.map((item, index) => `
    ${index > 0 ? '<span class="breadcrumb__sep">/</span>' : ""}
    <span class="breadcrumb__item">${item}</span>
  `).join("");
}

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
    console.error("[topbar] logout failed", err);
    toast.error(TEXT.topbar.logoutFailed);
  }
}

function roleLabel(role) {
  return TEXT.roles[role] ?? role ?? "";
}
