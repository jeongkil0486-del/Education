import { authStore, ROLES } from "./auth.js";
import { TEXT } from "../constants/text.js";
import { setBreadcrumb, setPageTitle } from "../modules/topbar.js";
import { toast } from "../utils/toast.js";

const routes = [
  { path: "dashboard", title: TEXT.routes.dashboard, allow: null, view: () => import("../views/dashboard.js").then((m) => m.render) },
  { path: "my-trainings", title: TEXT.routes.myTrainings, allow: [ROLES.EMPLOYEE, ROLES.INSTRUCTOR], view: () => import("../views/my-trainings.js").then((m) => m.render) },
  { path: "my-history", title: TEXT.routes.myHistory, allow: [ROLES.EMPLOYEE], view: () => import("../views/my-history.js").then((m) => m.render) },
  { path: "trainings", title: TEXT.routes.trainings, allow: [ROLES.HQ_ADMIN, ROLES.SUPER_ADMIN], view: () => import("../views/trainings.js").then((m) => m.render) },
  { path: "training-detail", title: TEXT.routes.trainingDetail, allow: [ROLES.HQ_ADMIN, ROLES.SUPER_ADMIN], view: () => import("../views/training-detail.js").then((m) => m.render) },
  { path: "history-cards", title: TEXT.routes.historyCards, allow: [ROLES.HQ_ADMIN], view: () => import("../views/history-cards.js").then((m) => m.render) },
  { path: "materials", title: TEXT.routes.materials, allow: [ROLES.HQ_ADMIN, ROLES.INSTRUCTOR], view: () => import("../views/materials.js").then((m) => m.render) },
  { path: "employees", title: TEXT.routes.employees, allow: [ROLES.HQ_ADMIN], view: () => import("../views/employees.js").then((m) => m.render) },
  { path: "employee-detail", title: TEXT.routes.employeeDetail, allow: [ROLES.HQ_ADMIN], view: () => import("../views/employee-detail.js").then((m) => m.render) },
  { path: "statistics", title: TEXT.routes.statistics, allow: [ROLES.HQ_ADMIN], view: () => import("../views/statistics.js").then((m) => m.render) },
  { path: "announcements", title: TEXT.routes.announcements, allow: null, view: () => import("../views/announcements.js").then((m) => m.render) },
  { path: "templates", title: TEXT.routes.templates, allow: [ROLES.HQ_ADMIN], view: () => import("../views/templates.js").then((m) => m.render) },
  { path: "notification-settings", title: TEXT.routes.notificationSettings, allow: [ROLES.HQ_ADMIN], view: () => import("../views/notification-settings.js").then((m) => m.render) },
  { path: "slideshow", title: TEXT.routes.slideshow, allow: [ROLES.INSTRUCTOR, ROLES.HQ_ADMIN], view: () => import("../views/slideshow.js").then((m) => m.render) },
  { path: "lesson-plan", title: TEXT.routes.lessonPlan, allow: [ROLES.INSTRUCTOR], view: () => import("../views/lesson-plan.js").then((m) => m.render) },
  { path: "admin/companies", title: TEXT.routes.companies, allow: [ROLES.SUPER_ADMIN], view: () => import("../views/admin/companies.js").then((m) => m.render) },
  { path: "admin/branches", title: TEXT.routes.branches, allow: [ROLES.SUPER_ADMIN], view: () => import("../views/admin/branches.js").then((m) => m.render) },
  { path: "admin/accounts", title: TEXT.routes.accounts, allow: [ROLES.SUPER_ADMIN], view: () => import("../views/admin/accounts.js").then((m) => m.render) },
  { path: "admin/employees", title: TEXT.routes.adminEmployees, allow: [ROLES.SUPER_ADMIN], view: () => import("../views/admin/employees.js").then((m) => m.render) },
  { path: "admin/settings", title: TEXT.routes.adminSettings, allow: [ROLES.SUPER_ADMIN], view: () => import("../views/admin/settings.js").then((m) => m.render) },
];

class Router {
  #currentPath = null;
  #listeners = [];

  init() {
    window.addEventListener("hashchange", () => this.#resolve());
    this.#resolve();
  }

  push(path, params = {}) {
    const qs = Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : "";
    window.location.hash = `#/${path}${qs}`;
  }

  get params() {
    const raw = window.location.hash.replace(/^#\/[^?]*\??/, "");
    return raw ? Object.fromEntries(new URLSearchParams(raw)) : {};
  }

  get currentPath() {
    return this.#currentPath;
  }

  onChange(fn) {
    this.#listeners.push(fn);
  }

  async #resolve() {
    const hash = window.location.hash.replace(/^#\//, "").split("?")[0];
    const path = hash || "dashboard";
    const route = routes.find((item) => item.path === path);

    if (!route) {
      this.push("dashboard");
      return;
    }

    if (route.allow && !route.allow.includes(authStore.role)) {
      toast.warning(TEXT.common.accessDenied);
      this.push("dashboard");
      return;
    }

    this.#currentPath = path;
    this.#listeners.forEach((fn) => fn(path, route));

    setPageTitle(route.title);
    setBreadcrumb(route.title);

    const content = document.getElementById("page-content");
    if (!content) return;

    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:200px;">
        <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>
    `;

    try {
      const render = await route.view();
      await render(content, this.params);
    } catch (err) {
      console.error(`[router] Failed to load view: ${path}`, err);
      const hint = err instanceof TypeError && err.message.includes("import")
        ? "The requested view module could not be loaded."
        : (err.message || "Unknown error");

      content.innerHTML = `
        <div class="empty-state" style="padding:var(--space-16)">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" class="empty-state__icon">
            <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/>
            <path d="M24 16v10M24 30v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <div class="empty-state__title">${TEXT.common.pageLoadFailed}</div>
          <div style="font-size:var(--text-xs);font-family:var(--font-mono);color:var(--gray-400);margin-top:var(--space-2);max-width:400px;word-break:break-all">${hint}</div>
          <button class="btn btn--ghost btn--sm" style="margin-top:var(--space-4)" onclick="window.location.hash='#/dashboard'">${TEXT.common.goToDashboard}</button>
        </div>
      `;
    }
  }
}

export const router = new Router();
