/**
 * TAS WT — Notifications Module
 * - Bell icon with unread count
 * - Notification dropdown panel
 * - Alert banner for employees (overdue / expiring soon)
 */

import { authStore, ROLES } from "../core/auth.js";
import { completionsDB, trainingsDB, assignmentsDB } from "../core/db.js";
import { formatDate, daysFromNow } from "../utils/date.js";

export async function initNotifications() {
  document.getElementById("btn-notifications")
    ?.addEventListener("click", e => {
      e.stopPropagation();
      togglePanel();
    });

  document.getElementById("btn-mark-all-read")
    ?.addEventListener("click", markAllRead);

  await loadNotifications();
}

/* ── Load & render ───────────────────────────────────────── */
async function loadNotifications() {
  const role = authStore.role;

  if (role === ROLES.EMPLOYEE) {
    await loadEmployeeNotifications();
  } else if (role === ROLES.HQ_ADMIN) {
    await loadAdminNotifications();
  }
}

async function loadEmployeeNotifications() {
  const uid         = authStore.uid;
  const assignments = await assignmentsDB.forUser(uid);
  const completions = await completionsDB.forUser(uid);
  const completedIds = new Set(completions.map(c => c.trainingId));

  const pending     = assignments.filter(a => !completedIds.has(a.trainingId));
  const now         = Date.now();
  const overdue     = pending.filter(a => a.deadline && a.deadline < now);
  const expiringSoon = pending.filter(a =>
    a.deadline && a.deadline >= now && daysFromNow(a.deadline) <= 3
  );

  const notifs = [
    ...overdue.map(a => ({
      id: a.trainingId,
      type: "danger",
      text: `[기한 초과] ${a.trainingTitle ?? "교육"}이 기한을 초과했습니다.`,
      time: "–",
      read: false,
    })),
    ...expiringSoon.map(a => ({
      id: a.trainingId,
      type: "warning",
      text: `[마감 임박] "${a.trainingTitle ?? "교육"}" 수료기한이 ${daysFromNow(a.deadline)}일 남았습니다.`,
      time: formatDate(a.deadline),
      read: false,
    })),
  ];

  renderNotifications(notifs);

  // Alert banner
  if (overdue.length > 0) {
    showAlertBanner(
      `기한이 초과된 교육이 ${overdue.length}건 있습니다.`,
      "danger"
    );
  } else if (expiringSoon.length > 0) {
    showAlertBanner(
      `수료기한이 3일 이내인 교육이 ${expiringSoon.length}건 있습니다.`,
      "warning"
    );
  }
}

async function loadAdminNotifications() {
  // Placeholder — real impl queries overdue assignments across all employees
  const notifs = [];
  renderNotifications(notifs);
}

/* ── Render ──────────────────────────────────────────────── */
function renderNotifications(notifs) {
  const list  = document.getElementById("notif-list");
  const badge = document.getElementById("notif-badge");

  const unread = notifs.filter(n => !n.read).length;

  // Badge
  if (unread > 0) {
    badge?.classList.remove("hidden");
    badge && (badge.textContent = unread > 9 ? "9+" : unread);
  } else {
    badge?.classList.add("hidden");
  }

  // List
  if (!list) return;

  if (notifs.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:var(--space-8) var(--space-4)">새 알림이 없습니다</div>`;
    return;
  }

  list.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read ? "" : "notif-item--unread"}" data-id="${n.id}">
      <div class="notif-item__dot" style="${dotColor(n.type)}"></div>
      <div class="notif-item__body">
        <div class="notif-item__text">${n.text}</div>
        <div class="notif-item__time">${n.time}</div>
      </div>
    </div>
  `).join("");
}

function dotColor(type) {
  const map = {
    danger:  "background:var(--color-danger)",
    warning: "background:var(--color-warning)",
    info:    "background:var(--brand-400)",
    success: "background:var(--color-success)",
  };
  return map[type] ?? "";
}

function markAllRead() {
  document.querySelectorAll(".notif-item--unread")
    .forEach(el => el.classList.remove("notif-item--unread"));
  document.getElementById("notif-badge")?.classList.add("hidden");
}

function togglePanel() {
  const panel = document.getElementById("notif-panel");
  panel?.classList.toggle("hidden");
}

/* ── Alert banner ────────────────────────────────────────── */
function showAlertBanner(text, type = "warning") {
  const el = document.getElementById("alert-banner");
  if (!el) return;
  el.className = `alert-banner alert-banner--${type}`;
  el.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1L1 14h14L8 1zm0 4v4m0 2h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span>${text}</span>
  `;
  el.classList.remove("hidden");
}
