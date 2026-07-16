import { TEXT } from "../constants/text.js";

let onCloseHandler = null;
let backdropClickHandler = null;

export const modal = {
  open({ title, body, size = "md", actions = [], onClose, dismissible = true }) {
    onCloseHandler = onClose ?? null;

    const actionsHtml = actions.map((action) => `
      <button class="btn btn--${action.variant ?? "secondary"}" data-action="${action.label}">
        ${action.label}
      </button>
    `).join("");

    const container = document.getElementById("modal-container");
    const backdrop = document.getElementById("modal-backdrop");
    if (!container || !backdrop) return;

    container.innerHTML = `
      <div class="modal modal--${size}" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal__header">
          <h2 class="modal__title">${title}</h2>
          ${dismissible ? `<button class="modal__close" id="modal-close-btn" aria-label="${TEXT.common.close}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>` : ""}
        </div>
        <div class="modal__body">${body}</div>
        ${actions.length ? `<div class="modal__footer">${actionsHtml}</div>` : ""}
      </div>
    `;

    container.classList.remove("hidden");
    backdrop.classList.remove("hidden");

    container.querySelectorAll("[data-action]").forEach((button) => {
      const action = actions.find((item) => item.label === button.dataset.action);
      if (action?.onClick) button.addEventListener("click", action.onClick);
    });

    if (backdropClickHandler) backdrop.removeEventListener("click", backdropClickHandler);
    backdropClickHandler = dismissible ? () => modal.close() : null;
    if (backdropClickHandler) backdrop.addEventListener("click", backdropClickHandler);

    document.getElementById("modal-close-btn")?.addEventListener("click", () => modal.close());

    const escHandler = (event) => {
      if (dismissible && event.key === "Escape") modal.close();
    };
    document.addEventListener("keydown", escHandler);
    container._escHandler = escHandler;

    container.querySelector("button, input, select, textarea")?.focus();
  },

  close() {
    document.getElementById("modal-container")?.classList.add("hidden");
    document.getElementById("modal-backdrop")?.classList.add("hidden");

    const container = document.getElementById("modal-container");
    const backdrop = document.getElementById("modal-backdrop");
    if (backdrop && backdropClickHandler) {
      backdrop.removeEventListener("click", backdropClickHandler);
      backdropClickHandler = null;
    }
    if (container?._escHandler) {
      document.removeEventListener("keydown", container._escHandler);
      delete container._escHandler;
    }

    if (onCloseHandler) {
      onCloseHandler();
      onCloseHandler = null;
    }
  },

  setBody(html) {
    const body = document.querySelector(".modal__body");
    if (body) body.innerHTML = html;
  },

  setLoading(buttonLabel, loading) {
    const button = document.querySelector(`[data-action="${buttonLabel}"]`);
    if (!button) return;
    button.classList.toggle("btn--loading", loading);
    button.disabled = loading;
  },
};
