/**
 * TAS Learning Hub — Toast Utility
 * Lightweight, auto-dismissing notification toasts.
 */

const DEFAULT_DURATION = 3500;

export const toast = {
  success: (msg, dur) => show(msg, "success", dur),
  error:   (msg, dur) => show(msg, "error",   dur),
  warning: (msg, dur) => show(msg, "warning", dur),
  info:    (msg, dur) => show(msg, "info",    dur),
};

function show(message, type = "info", duration = DEFAULT_DURATION) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const el = document.createElement("div");
  el.className = `toast toast--${type}`;

  const icon = {
    success: "✓",
    error:   "✕",
    warning: "⚠",
    info:    "ℹ",
  }[type] ?? "ℹ";

  el.innerHTML = `
    <span style="font-size:var(--text-sm);flex-shrink:0;opacity:.8">${icon}</span>
    <span style="flex:1;line-height:var(--leading-normal)">${message}</span>
    <button
      style="opacity:.5;font-size:var(--text-xs);padding:0 var(--space-1);flex-shrink:0"
      aria-label="닫기"
    >✕</button>
  `;

  el.querySelector("button").addEventListener("click", () => dismiss(el));
  container.appendChild(el);

  // Auto dismiss
  const timer = setTimeout(() => dismiss(el), duration);
  el._timer = timer;
}

function dismiss(el) {
  clearTimeout(el._timer);
  el.style.opacity = "0";
  el.style.transform = "translateY(4px)";
  el.style.transition = "opacity 0.2s, transform 0.2s";
  setTimeout(() => el.remove(), 220);
}
