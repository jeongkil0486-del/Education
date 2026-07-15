import { TEXT } from "../constants/text.js";

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
  renderNotifications([]);
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
