import { authStore, ROLES } from "../core/auth.js";
import { TEXT } from "../constants/text.js";
import { router } from "../core/router.js";

const NAV_CONFIG = {
  [ROLES.SUPER_ADMIN]: [
    {
      group: TEXT.nav.groups.system,
      items: [
        { path: "dashboard",        label: TEXT.routes.dashboard,      icon: iconGrid() },
        { path: "admin/companies",  label: TEXT.routes.companies,      icon: iconBuilding() },
        { path: "admin/branches",   label: TEXT.routes.branches,       icon: iconMapPin() },
        { path: "admin/accounts",   label: TEXT.routes.accounts,       icon: iconUsers() },
        { path: "admin/employees",  label: TEXT.routes.adminEmployees, icon: iconUserPlus() },
        { path: "history-overview", label: TEXT.routes.historyOverview, icon: iconHistory() },
        { path: "admin/settings",   label: TEXT.routes.adminSettings,  icon: iconSettings() },
      ],
    },
    {
      group: TEXT.nav.groups.operations,
      items: [
        { path: "materials", label: TEXT.routes.materials, icon: iconFile() },
      ],
    },
  ],
  [ROLES.HQ_ADMIN]: [
    {
      group: TEXT.nav.groups.operations,
      items: [
        { path: "dashboard", label: TEXT.routes.dashboard, icon: iconGrid() },
        { path: "trainings", label: TEXT.routes.trainings, icon: iconBook() },
        { path: "materials", label: TEXT.routes.materials, icon: iconFile() },
        { path: "lesson-plan", label: TEXT.routes.lessonPlan, icon: iconPencil() },
        { path: "templates", label: TEXT.routes.templates, icon: iconLayers() },
      ],
    },
    {
      group: TEXT.nav.groups.people,
      items: [
        { path: "employees", label: TEXT.routes.employees, icon: iconUsers() },
        { path: "history-cards", label: TEXT.routes.historyCards, icon: iconHistory() },
        { path: "audit-logs", label: TEXT.routes.auditLogs, icon: iconHistory() },
      ],
    },
    {
      group: TEXT.nav.groups.communication,
      items: [
        { path: "announcements", label: TEXT.routes.announcements, icon: iconBell() },
        { path: "notification-settings", label: TEXT.routes.notificationSettings, icon: iconSettings() },
      ],
    },
  ],
  [ROLES.INSTRUCTOR]: [
    {
      group: TEXT.nav.groups.teaching,
      items: [
        { path: "dashboard",             label: TEXT.routes.dashboard,             icon: iconGrid() },
        { path: "materials",             label: TEXT.routes.materials,             icon: iconFile() },
        { path: "lesson-plan",           label: TEXT.routes.lessonPlan,            icon: iconPencil() },
        { path: "slideshow",             label: TEXT.routes.slideshow,             icon: iconPlay() },
      ],
    },
    {
      group: TEXT.nav.groups.people,
      items: [
        { path: "employees", label: TEXT.routes.employees, icon: iconUsers() },
        { path: "history-cards", label: TEXT.routes.historyCards, icon: iconHistory() },
      ],
    },
    {
      group: TEXT.nav.groups.info,
      items: [
        { path: "announcements", label: TEXT.routes.announcements, icon: iconBell() },
      ],
    },
  ],
};

export function initNav() {
  renderNav();
  router.onChange((path) => setActiveItem(path));

  document.getElementById("sidebar-toggle")?.addEventListener("click", toggleSidebar);
  document.getElementById("mobile-menu-btn")?.addEventListener("click", openMobileSidebar);
  syncSidebarToggleState();

  document.addEventListener("click", (event) => {
    const sidebar = document.getElementById("sidebar");
    const menuBtn = document.getElementById("mobile-menu-btn");
    if (
      sidebar?.classList.contains("mobile--open") &&
      !sidebar.contains(event.target) &&
      !menuBtn?.contains(event.target)
    ) {
      sidebar.classList.remove("mobile--open");
    }
  });
}

function renderNav() {
  const nav = document.getElementById("main-nav");
  if (!nav) return;

  const config = NAV_CONFIG[authStore.role] ?? [];
  nav.innerHTML = config.map((group) => `
    <div class="nav-group">
      <div class="nav-group__label">${group.group}</div>
      ${group.items.map((item) => `
        <div class="nav-item" data-path="${item.path}" role="button" tabindex="0" aria-label="${item.label}">
          <span class="nav-item__icon">${item.icon}</span>
          <span class="nav-item__label">${item.label}</span>
        </div>
      `).join("")}
    </div>
  `).join("");

  nav.querySelectorAll(".nav-item").forEach((element) => {
    const go = () => {
      router.push(element.dataset.path);
      document.getElementById("sidebar")?.classList.remove("mobile--open");
    };
    element.addEventListener("click", go);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter") go();
    });
  });

  setActiveItem(router.currentPath ?? "dashboard");
}

function setActiveItem(path) {
  document.querySelectorAll(".nav-item").forEach((element) => {
    element.classList.toggle("active", element.dataset.path === path);
  });
}

function toggleSidebar() {
  document.getElementById("app-shell")?.classList.toggle("sidebar--collapsed");
  document.getElementById("sidebar")?.classList.toggle("sidebar--collapsed");
  syncSidebarToggleState();
}

function openMobileSidebar() {
  document.getElementById("sidebar")?.classList.add("mobile--open");
}

function syncSidebarToggleState() {
  const collapsed = document.getElementById("sidebar")?.classList.contains("sidebar--collapsed");
  const ariaLabel = collapsed ? "사이드바 펼치기" : "사이드바 접기";

  document.getElementById("sidebar-toggle")?.setAttribute("aria-label", ariaLabel);
}

function svg(d, opts = "") {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" ${opts} xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function iconGrid()     { return svg("M2 2h6v6H2V2zm8 0h6v6h-6V2zM2 10h6v6H2v-6zm8 0h6v6h-6v-6z"); }
function iconBook()     { return svg("M3 2h9a1 1 0 011 1v13l-5-2.5L3 16V3a1 1 0 011-1zm9 0h1a1 1 0 011 1v13"); }
function iconFile()     { return svg("M10 2H4a1 1 0 00-1 1v12a1 1 0 001 1h10a1 1 0 001-1V6l-5-4zm0 0v4h4"); }
function iconUsers()    { return svg("M13 15v-1a4 4 0 00-4-4H5a4 4 0 00-4 4v1m8-9a3 3 0 11-6 0 3 3 0 016 0zm5 3a2 2 0 100-4 2 2 0 000 4zm2 6v-1a3 3 0 00-2-2.83"); }
function iconUserPlus() { return svg("M8 15v-1a4 4 0 00-4-4H5a4 4 0 00-4 4v1m8-9a3 3 0 11-6 0 3 3 0 016 0m7 2v4m-2-2h4"); }
function iconChart()    { return svg("M2 14l4-4 4 2 4-6 2 2"); }
function iconBell()     { return svg("M9 2a5 5 0 00-5 5v3l-1.5 2h13L14 10V7a5 5 0 00-5-5zM7 16a2 2 0 004 0"); }
function iconSettings() { return svg("M9 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3.5 9a5.5 5.5 0 00.05.75L2 11l1.5 2.6 1.85-.74A5.5 5.5 0 007 13.9V16h4v-2.1a5.5 5.5 0 001.65-1.04l1.85.74L16 11l-1.55-1.25A5.5 5.5 0 0014.5 9a5.5 5.5 0 00-.05-.75L16 7 14.5 4.4l-1.85.74A5.5 5.5 0 0011 4.1V2H7v2.1A5.5 5.5 0 005.35 5.14L3.5 4.4 2 7l1.55 1.25A5.5 5.5 0 003.5 9z"); }
function iconBuilding() { return svg("M2 15V3a1 1 0 011-1h12a1 1 0 011 1v12M2 15h14M6 15V9m6 6V9m-3 0h0M9 5h0M5 5h0M13 5h0"); }
function iconMapPin()   { return svg("M9 9a2 2 0 100-4 2 2 0 000 4zm0 0c0 4-5 7-5 7h10s-5-3-5-7zM9 1a6 6 0 016 6"); }
function iconLayers()   { return svg("M9 1L1 5l8 4 8-4-8-4zM1 13l8 4 8-4M1 9l8 4 8-4"); }
function iconPlay()     { return svg("M5 3l10 6-10 6V3z"); }
function iconPencil()   { return svg("M12 2l4 4-9 9H3v-4l9-9z"); }
function iconHistory()  { return svg("M1 9a8 8 0 100 0zm8 0V5m0 4l2.5 2.5"); }
