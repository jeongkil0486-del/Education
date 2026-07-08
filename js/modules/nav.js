/**
 * TAS WT — Navigation Module
 * Renders role-based sidebar nav and handles active state.
 */

import { authStore, ROLES } from "../core/auth.js";
import { router } from "../core/router.js";

/* ── Nav config per role ─────────────────────────────────── */
const NAV_CONFIG = {
  [ROLES.SUPER_ADMIN]: [
    {
      group: "시스템 관리",
      items: [
        { path: "dashboard",        label: "대시보드",    icon: iconGrid() },
        { path: "admin/companies",  label: "회사 관리",   icon: iconBuilding() },
        { path: "admin/branches",   label: "지점 관리",   icon: iconMapPin() },
        { path: "admin/accounts",   label: "계정 관리",   icon: iconUsers() },
        { path: "admin/settings",   label: "시스템 설정", icon: iconSettings() },
      ],
    },
  ],

  [ROLES.HQ_ADMIN]: [
    {
      group: "운영",
      items: [
        { path: "dashboard",     label: "대시보드",    icon: iconGrid() },
        { path: "trainings",     label: "교육 관리",   icon: iconBook() },
        { path: "materials",     label: "교육자료",    icon: iconFile() },
        { path: "templates",     label: "교육 템플릿", icon: iconLayers() },
      ],
    },
    {
      group: "인원",
      items: [
        { path: "employees",     label: "직원 관리",   icon: iconUsers() },
        { path: "statistics",    label: "통계",        icon: iconChart() },
      ],
    },
    {
      group: "커뮤니케이션",
      items: [
        { path: "announcements", label: "공지사항",    icon: iconBell() },
      ],
    },
  ],

  [ROLES.INSTRUCTOR]: [
    {
      group: "강의",
      items: [
        { path: "dashboard",     label: "대시보드",   icon: iconGrid() },
        { path: "my-trainings",  label: "배정 교육",  icon: iconBook() },
        { path: "materials",     label: "교육자료",   icon: iconFile() },
        { path: "lesson-plan",   label: "교안 작성",  icon: iconPencil() },
        { path: "slideshow",     label: "슬라이드쇼", icon: iconPlay() },
      ],
    },
    {
      group: "정보",
      items: [
        { path: "announcements", label: "공지사항",   icon: iconBell() },
      ],
    },
  ],

  [ROLES.EMPLOYEE]: [
    {
      group: "교육",
      items: [
        { path: "dashboard",    label: "대시보드",   icon: iconGrid() },
        { path: "my-trainings", label: "내 교육",    icon: iconBook() },
        { path: "my-history",   label: "교육 이력",  icon: iconHistory() },
      ],
    },
    {
      group: "정보",
      items: [
        { path: "announcements", label: "공지사항",  icon: iconBell() },
      ],
    },
  ],
};

/* ── Init ────────────────────────────────────────────────── */
export function initNav() {
  renderNav();
  router.onChange((path) => setActiveItem(path));

  // Sidebar toggle
  document.getElementById("sidebar-toggle")?.addEventListener("click", toggleSidebar);
  document.getElementById("mobile-menu-btn")?.addEventListener("click", openMobileSidebar);

  // Close mobile sidebar when clicking outside
  document.addEventListener("click", e => {
    const sidebar = document.getElementById("sidebar");
    const menuBtn = document.getElementById("mobile-menu-btn");
    if (
      sidebar?.classList.contains("mobile--open") &&
      !sidebar.contains(e.target) &&
      !menuBtn?.contains(e.target)
    ) {
      sidebar.classList.remove("mobile--open");
    }
  });
}

function renderNav() {
  const nav    = document.getElementById("main-nav");
  const config = NAV_CONFIG[authStore.role] ?? [];

  nav.innerHTML = config.map(group => `
    <div class="nav-group">
      <div class="nav-group__label">${group.group}</div>
      ${group.items.map(item => `
        <div
          class="nav-item"
          data-path="${item.path}"
          role="button"
          tabindex="0"
          aria-label="${item.label}"
        >
          <span class="nav-item__icon">${item.icon}</span>
          <span class="nav-item__label">${item.label}</span>
          ${item.badge ? `<span class="badge badge--alert nav-item__badge" id="nav-badge-${item.path}">${item.badge}</span>` : ""}
        </div>
      `).join("")}
    </div>
  `).join("");

  // Click handlers
  nav.querySelectorAll(".nav-item").forEach(el => {
    const go = () => {
      router.push(el.dataset.path);
      document.getElementById("sidebar")?.classList.remove("mobile--open");
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", e => e.key === "Enter" && go());
  });

  // Set initial active state
  setActiveItem(router.currentPath ?? "dashboard");
}

function setActiveItem(path) {
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.path === path);
  });
}

function toggleSidebar() {
  const shell   = document.getElementById("app-shell");
  const sidebar = document.getElementById("sidebar");
  shell?.classList.toggle("sidebar--collapsed");
  sidebar?.classList.toggle("sidebar--collapsed");
}

function openMobileSidebar() {
  document.getElementById("sidebar")?.classList.add("mobile--open");
}

/* ── SVG icon helpers (inline, no external dep) ─────────── */
function svg(d, opts = "") {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" ${opts} xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function iconGrid()     { return svg("M2 2h6v6H2V2zm8 0h6v6h-6V2zM2 10h6v6H2v-6zm8 0h6v6h-6v-6z"); }
function iconBook()     { return svg("M3 2h9a1 1 0 011 1v13l-5-2.5L3 16V3a1 1 0 011-1zm9 0h1a1 1 0 011 1v13"); }
function iconFile()     { return svg("M10 2H4a1 1 0 00-1 1v12a1 1 0 001 1h10a1 1 0 001-1V6l-5-4zm0 0v4h4"); }
function iconUsers()    { return svg("M13 15v-1a4 4 0 00-4-4H5a4 4 0 00-4 4v1m8-9a3 3 0 11-6 0 3 3 0 016 0zm5 3a2 2 0 100-4 2 2 0 000 4zm2 6v-1a3 3 0 00-2-2.83"); }
function iconChart()    { return svg("M2 14l4-4 4 2 4-6 2 2"); }
function iconBell()     { return svg("M9 2a5 5 0 00-5 5v3l-1.5 2h13L14 10V7a5 5 0 00-5-5zM7 16a2 2 0 004 0"); }
function iconSettings() { return svg("M9 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3.5 9a5.5 5.5 0 00.05.75L2 11l1.5 2.6 1.85-.74A5.5 5.5 0 007 13.9V16h4v-2.1a5.5 5.5 0 001.65-1.04l1.85.74L16 11l-1.55-1.25A5.5 5.5 0 0014.5 9a5.5 5.5 0 00-.05-.75L16 7 14.5 4.4l-1.85.74A5.5 5.5 0 0011 4.1V2H7v2.1A5.5 5.5 0 005.35 5.14L3.5 4.4 2 7l1.55 1.25A5.5 5.5 0 003.5 9z"); }
function iconBuilding() { return svg("M2 15V3a1 1 0 011-1h12a1 1 0 011 1v12M2 15h14M6 15V9m6 6V9m-3 0h0M9 5h0M5 5h0M13 5h0"); }
function iconMapPin()   { return svg("M9 9a2 2 0 100-4 2 2 0 000 4zm0 0c0 4-5 7-5 7h10s-5-3-5-7zM9 1a6 6 0 016 6"); }
function iconLayers()   { return svg("M9 1L1 5l8 4 8-4-8-4zM1 13l8 4 8-4M1 9l8 4 8-4"); }
function iconPlay()     { return svg("M5 3l10 6-10 6V3z"); }
function iconPencil()   { return svg("M12 2l4 4-9 9H3v-4l9-9z"); }
function iconHistory()  { return svg("M1 9a8 8 0 100 0zm8 0V5m0 4l2.5 2.5"); }
