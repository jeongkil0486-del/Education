import { TEXT } from "../constants/text.js";

const DEFAULT_DURATION = 3500;

export const toast = {
  success: (message, duration) => show(message, "success", duration),
  error: (message, duration) => show(message, "error", duration),
  warning: (message, duration) => show(message, "warning", duration),
  info: (message, duration) => show(message, "info", duration),
};

function show(message, type = "info", duration = DEFAULT_DURATION) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const element = document.createElement("div");
  element.className = `toast toast--${type}`;

  const icon = {
    success: "OK",
    error: "!",
    warning: "!!",
    info: "i",
  }[type] ?? "i";

  element.innerHTML = `
    <span style="font-size:var(--text-sm);flex-shrink:0;opacity:.8">${icon}</span>
    <span style="flex:1;line-height:var(--leading-normal)">${message}</span>
    <button
      style="opacity:.5;font-size:var(--text-xs);padding:0 var(--space-1);flex-shrink:0"
      aria-label="${TEXT.common.closeToast}"
    >&times;</button>
  `;

  element.querySelector("button")?.addEventListener("click", () => dismiss(element));
  container.appendChild(element);

  const timer = setTimeout(() => dismiss(element), duration);
  element._timer = timer;
}

function dismiss(element) {
  clearTimeout(element._timer);
  element.style.opacity = "0";
  element.style.transform = "translateY(4px)";
  element.style.transition = "opacity 0.2s, transform 0.2s";
  setTimeout(() => element.remove(), 220);
}
