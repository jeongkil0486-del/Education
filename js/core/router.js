/**
 * TAS WT — Router
 * Hash-based SPA router with role-based guards.
 *
 * URL pattern: /#/{view}/{...params}
 * e.g.  /#/dashboard
 *        /#/trainings
 *        /#/trainings/abc123
 *        /#/admin/users
 */

import { authStore, ROLES } from "./auth.js";
import { setBreadcrumb, setPageTitle } from "../modules/topbar.js";
import { toast } from "../utils/toast.js";

/* ── Route definitions ───────────────────────────────────── */
// Each route: { path, view: async fn, title, allow: [ROLES...] | null (all) }
const routes = [
  // ── Shared / common
  {
    path: "dashboard",
    title: "대시보드",
    allow: null,
    view: () => import("../views/dashboard.js").then(m => m.render),
  },
  {
    path: "my-trainings",
    title: "내 교육",
    allow: [ROLES.EMPLOYEE, ROLES.INSTRUCTOR],
    view: () => import("../views/my-trainings.js").then(m => m.render),
  },
  {
    path: "my-history",
    title: "교육 이력",
    allow: [ROLES.EMPLOYEE],
    view: () => import("../views/my-history.js").then(m => m.render),
  },

  // ── HQ Admin
  {
    path: "trainings",
    title: "교육 관리",
    allow: [ROLES.HQ_ADMIN, ROLES.SUPER_ADMIN],
    view: () => import("../views/trainings.js").then(m => m.render),
  },
  {
    path: "training-detail",
    title: "교육 상세",
    allow: [ROLES.HQ_ADMIN, ROLES.SUPER_ADMIN],
    view: () => import("../views/training-detail.js").then(m => m.render),
  },
  {
    path: "materials",
    title: "교육자료",
    allow: [ROLES.HQ_ADMIN, ROLES.INSTRUCTOR],
    view: () => import("../views/materials.js").then(m => m.render),
  },
  {
    path: "employees",
    title: "직원 관리",
    allow: [ROLES.HQ_ADMIN],
    view: () => import("../views/employees.js").then(m => m.render),
  },
  {
    path: "employee-detail",
    title: "직원 상세",
    allow: [ROLES.HQ_ADMIN],
    view: () => import("../views/employee-detail.js").then(m => m.render),
  },
  {
    path: "statistics",
    title: "통계",
    allow: [ROLES.HQ_ADMIN],
    view: () => import("../views/statistics.js").then(m => m.render),
  },
  {
    path: "announcements",
    title: "공지사항",
    allow: null,
    view: () => import("../views/announcements.js").then(m => m.render),
  },
  {
    path: "templates",
    title: "교육 템플릿",
    allow: [ROLES.HQ_ADMIN],
    view: () => import("../views/templates.js").then(m => m.render),
  },

  // ── Instructor
  {
    path: "slideshow",
    title: "슬라이드쇼",
    allow: [ROLES.INSTRUCTOR, ROLES.HQ_ADMIN],
    view: () => import("../views/slideshow.js").then(m => m.render),
  },
  {
    path: "lesson-plan",
    title: "교안 작성",
    allow: [ROLES.INSTRUCTOR],
    view: () => import("../views/lesson-plan.js").then(m => m.render),
  },

  // ── Super Admin
  {
    path: "admin/companies",
    title: "회사 관리",
    allow: [ROLES.SUPER_ADMIN],
    view: () => import("../views/admin/companies.js").then(m => m.render),
  },
  {
    path: "admin/branches",
    title: "지점 관리",
    allow: [ROLES.SUPER_ADMIN],
    view: () => import("../views/admin/branches.js").then(m => m.render),
  },
  {
    path: "admin/accounts",
    title: "계정 관리",
    allow: [ROLES.SUPER_ADMIN],
    view: () => import("../views/admin/accounts.js").then(m => m.render),
  },
  {
    path: "admin/settings",
    title: "시스템 설정",
    allow: [ROLES.SUPER_ADMIN],
    view: () => import("../views/admin/settings.js").then(m => m.render),
  },
];

/* ── Router ─────────────────────────────────────────────── */
class Router {
  #currentPath = null;
  #listeners   = [];

  init() {
    window.addEventListener("hashchange", () => this.#resolve());
    this.#resolve();
  }

  /** Navigate to a path, optionally with query params */
  push(path, params = {}) {
    const qs = Object.keys(params).length
      ? "?" + new URLSearchParams(params).toString()
      : "";
    window.location.hash = `#/${path}${qs}`;
  }

  /** Get current URL params */
  get params() {
    const raw = window.location.hash.replace(/^#\/[^?]*\??/, "");
    return raw ? Object.fromEntries(new URLSearchParams(raw)) : {};
  }

  /** Get current path segment */
  get currentPath() { return this.#currentPath; }

  /** Subscribe to route changes */
  onChange(fn) { this.#listeners.push(fn); }

  async #resolve() {
    const hash = window.location.hash.replace(/^#\//, "").split("?")[0];
    const path = hash || "dashboard";

    const route = routes.find(r => r.path === path);

    if (!route) {
      this.push("dashboard");
      return;
    }

    // Role guard
    if (route.allow && !route.allow.includes(authStore.role)) {
      toast.warning("접근 권한이 없습니다.");
      this.push("dashboard");
      return;
    }

    this.#currentPath = path;
    this.#listeners.forEach(fn => fn(path, route));

    setPageTitle(route.title);
    setBreadcrumb(route.title);

    // Load & render the view
    const content = document.getElementById("page-content");
    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:200px;">
        <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>`;

    try {
      const renderFn = await route.view();
      await renderFn(content, this.params);
    } catch (err) {
      console.error(`[router] Failed to load view: ${path}`, err);
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__title">페이지를 불러올 수 없습니다</div>
          <div>${err.message}</div>
        </div>`;
    }
  }
}

export const router = new Router();
