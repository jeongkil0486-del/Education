import { authStore, ROLES } from "../core/auth.js";
import { completionsDB, assignmentsDB } from "../core/db.js";
import { TEXT } from "../constants/text.js";
import { formatDate, daysFromNow } from "../utils/date.js";

export async function initNotifications() {
  const title = document.querySelector("#notif-panel .dropdown__header span");
  const markAllReadButton = document.getElementById("btn-mark-all-read");
  if (title) title.textContent = TEXT.notifications.title;
  if (markAllReadButton) {
    markAllReadButton.textContent = TEXT.notifications.markAllRead;
  }

  document.getElementById("btn-notifications")?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePanel();
  });

  document.getElementById("btn-mark-all-read")?.addEventListener("click", markAllRead);

  await loadNotifications();
}

async function loadNotifications() {
  if (authStore.role === ROLES.EMPLOYEE) {
    await loadEmployeeNotifications();
    return;
  }

  if (authStore.role === ROLES.HQ_ADMIN) {
    renderNotifications([]);
  }
}

async function loadEmployeeNotifications() {
  const assignments = await assignmentsDB.forUser(authStore.uid);
  const completions = await completionsDB.forUser(authStore.uid);
  const completedIds = new Set(completions.map((item) => item.trainingId));

  const pending = assignments.filter((item) => !completedIds.has(item.trainingId));
  const now = Date.now();
  const overdue = pending.filter((item) => item.deadline && item.deadline < now);
  const expiringSoon = pending.filter((item) => item.deadline && item.deadline >= now && daysFromNow(item.deadline) <= 3);

  const notifications = [
    ...overdue.map((item) => ({
      id: item.trainingId,
      type: "danger",
      text: `${TEXT.notifications.overduePrefix} ${TEXT.notifications.overdueMessage(item.trainingTitle ?? "교육")}`,
      time: "방금",
      read: false,
    })),
    ...expiringSoon.map((item) => ({
      id: item.trainingId,
      type: "warning",
      text: `${TEXT.notifications.expiringPrefix} ${TEXT.notifications.expiringMessage(item.trainingTitle ?? "교육", daysFromNow(item.deadline))}`,
      time: formatDate(item.deadline),
      read: false,
    })),
  ];

  renderNotifications(notifications);

  if (overdue.length > 0) {
    showAlertBanner(TEXT.notifications.overdueBanner(overdue.length), "danger");
  } else if (expiringSoon.length > 0) {
    showAlertBanner(TEXT.notifications.expiringBanner(expiringSoon.length), "warning");
  }
}

function renderNotifications(items) {
  const list = document.getElementById("notif-list");
  const badge = document.getElementById("notif-badge");
  const unreadCount = items.filter((item) => !item.read).length;

  if (unreadCount > 0) {
    badge?.classList.remove("hidden");
    if (badge) badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
  } else {
    badge?.classList.add("hidden");
  }

  if (!list) return;

  if (!items.length) {
    list.innerHTML = `<div class="empty-state" style="padding:var(--space-8) var(--space-4)">${TEXT.notifications.empty}</div>`;
    return;
  }

  list.innerHTML = items.map((item) => `
    <div class="notif-item ${item.read ? "" : "notif-item--unread"}" data-id="${item.id}">
      <div class="notif-item__dot" style="${dotColor(item.type)}"></div>
      <div class="notif-item__body">
        <div class="notif-item__text">${item.text}</div>
        <div class="notif-item__time">${item.time}</div>
      </div>
    </div>
  `).join("");
}

function dotColor(type) {
  const colors = {
    danger: "background:var(--color-danger)",
    warning: "background:var(--color-warning)",
    info: "background:var(--brand-400)",
    success: "background:var(--color-success)",
  };
  return colors[type] ?? "";
}

function markAllRead() {
  document.querySelectorAll(".notif-item--unread").forEach((element) => {
    element.classList.remove("notif-item--unread");
  });
  document.getElementById("notif-badge")?.classList.add("hidden");
}

function togglePanel() {
  document.getElementById("notif-panel")?.classList.toggle("hidden");
}

function showAlertBanner(text, type = "warning") {
  const element = document.getElementById("alert-banner");
  if (!element) return;

  element.className = `alert-banner alert-banner--${type}`;
  element.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1L1 14h14L8 1zm0 4v4m0 2h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span>${text}</span>
  `;
  element.classList.remove("hidden");
}
