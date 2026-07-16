import { authStore, ROLES } from "../core/auth.js";
import { router } from "../core/router.js";
import {
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../core/admin-api.js";
import { TEXT } from "../constants/text.js";
import { toast } from "../utils/toast.js";

let items = [];
let unreadCount = 0;
let loading = false;

export async function initNotifications() {
  const button = document.getElementById("btn-notifications");
  const panel = document.getElementById("notif-panel");
  const badge = document.getElementById("notif-badge");
  const title = panel?.querySelector(".dropdown__header span");
  const markAllReadButton = document.getElementById("btn-mark-all-read");
  const isInstructor = authStore.role === ROLES.INSTRUCTOR;

  button?.classList.toggle("hidden", !isInstructor);
  panel?.classList.add("hidden");
  badge?.classList.add("hidden");
  if (title) title.textContent = TEXT.notifications.title;
  if (markAllReadButton) markAllReadButton.textContent = TEXT.notifications.markAllRead;

  if (!isInstructor) {
    items = [];
    unreadCount = 0;
    renderNotifications();
    return;
  }

  if (button) {
    button.onclick = async (event) => {
      event.stopPropagation();
      panel?.classList.toggle("hidden");
      if (!panel?.classList.contains("hidden")) await loadNotifications(true);
    };
  }
  if (markAllReadButton) {
    markAllReadButton.onclick = async (event) => {
      event.stopPropagation();
      await markAllRead();
    };
  }

  await loadNotifications(false);
}

async function loadNotifications(showLoading) {
  if (loading) return;
  loading = true;
  const list = document.getElementById("notif-list");
  if (showLoading && list) list.innerHTML = '<div class="empty-state" style="padding:var(--space-8) var(--space-4)">알림을 불러오는 중입니다.</div>';
  try {
    const result = await listUserNotifications();
    items = Array.isArray(result?.notifications) ? result.notifications : [];
    unreadCount = Math.max(0, Number(result?.unreadCount) || 0);
    renderNotifications();
  } catch (error) {
    console.error("[notifications] load failed", error?.code, error?.message);
    items = [];
    unreadCount = 0;
    renderNotifications("알림을 불러오지 못했습니다.");
  } finally {
    loading = false;
  }
}

function renderNotifications(errorMessage = "") {
  const list = document.getElementById("notif-list");
  const badge = document.getElementById("notif-badge");

  if (unreadCount > 0) {
    badge?.classList.remove("hidden");
    if (badge) badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
  } else {
    badge?.classList.add("hidden");
  }

  if (!list) return;
  if (errorMessage) {
    list.innerHTML = `<div class="empty-state" style="padding:var(--space-8) var(--space-4)">${esc(errorMessage)}</div>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="empty-state" style="padding:var(--space-8) var(--space-4)">${TEXT.notifications.empty}</div>`;
    return;
  }

  list.innerHTML = items.map((item) => `
    <button type="button" class="notif-item ${item.read === true ? "" : "notif-item--unread"}" data-notification-id="${escAttr(item.id)}">
      <span class="notif-item__dot" style="${dotColor(item)}"></span>
      <span class="notif-item__body">
        <span class="notif-item__title">${esc(item.title || notificationTypeLabel(item))}</span>
        <span class="notif-item__text">${esc(item.message || "-")}</span>
        <span class="notif-item__time">${relativeTime(item.createdAt)}</span>
      </span>
    </button>
  `).join("");

  list.querySelectorAll("[data-notification-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await openNotification(button.dataset.notificationId);
    });
  });
}

async function openNotification(id) {
  const item = items.find((entry) => entry.id === id);
  if (!item) return;
  try {
    if (item.read !== true) {
      await markNotificationRead({ notificationId: id });
      item.read = true;
      unreadCount = Math.max(0, unreadCount - 1);
      renderNotifications();
    }
    document.getElementById("notif-panel")?.classList.add("hidden");
    const allowedPages = new Set(["announcements", "materials"]);
    router.push(allowedPages.has(item.targetPage) ? item.targetPage : item.type === "MATERIAL" ? "materials" : "announcements");
  } catch (error) {
    console.error("[notifications] mark read failed", error?.code, error?.message);
    toast.error("알림을 읽음 처리하지 못했습니다.");
  }
}

async function markAllRead() {
  if (!unreadCount) return;
  const button = document.getElementById("btn-mark-all-read");
  if (button) button.disabled = true;
  try {
    await markAllNotificationsRead();
    items.forEach((item) => { item.read = true; });
    unreadCount = 0;
    renderNotifications();
  } catch (error) {
    console.error("[notifications] mark all read failed", error?.code, error?.message);
    toast.error("알림을 모두 읽음 처리하지 못했습니다.");
  } finally {
    if (button) button.disabled = false;
  }
}

function dotColor(item) {
  if (item?.important === true) return "background:var(--color-danger)";
  return item?.type === "MATERIAL" ? "background:var(--brand-400)" : "background:var(--color-warning)";
}

function notificationTypeLabel(item) {
  if (item?.type === "MATERIAL") return "새 교육자료";
  return item?.important === true ? "중요 공지사항" : "새 공지사항";
}

function relativeTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return "방금 전";
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escAttr(value) {
  return esc(value);
}
