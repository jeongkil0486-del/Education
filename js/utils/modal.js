/**
 * TAS Learning Hub — Modal Utility
 * Programmatic modal open/close with callback support.
 */

let _onClose = null;

export const modal = {
  /**
   * Open a modal.
   * @param {object} opts
   * @param {string}   opts.title
   * @param {string}   opts.body        - HTML string for modal body
   * @param {string}   [opts.size]      - sm | md | lg | xl
   * @param {Array}    [opts.actions]   - [{label, variant, onClick}]
   * @param {function} [opts.onClose]
   */
  open({ title, body, size = "md", actions = [], onClose }) {
    _onClose = onClose ?? null;

    const actionsHtml = actions.map(a => `
      <button class="btn btn--${a.variant ?? "secondary"}" data-action="${a.label}">
        ${a.label}
      </button>
    `).join("");

    const container = document.getElementById("modal-container");
    const backdrop  = document.getElementById("modal-backdrop");

    container.innerHTML = `
      <div class="modal modal--${size}" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal__header">
          <h2 class="modal__title">${title}</h2>
          <button class="modal__close" id="modal-close-btn" aria-label="닫기">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="modal__body">${body}</div>
        ${actions.length ? `<div class="modal__footer">${actionsHtml}</div>` : ""}
      </div>
    `;

    container.classList.remove("hidden");
    backdrop.classList.remove("hidden");

    // Action handlers
    container.querySelectorAll("[data-action]").forEach(btn => {
      const action = actions.find(a => a.label === btn.dataset.action);
      if (action?.onClick) btn.addEventListener("click", action.onClick);
    });

    // Close button
    document.getElementById("modal-close-btn")
      ?.addEventListener("click", () => modal.close());

    // Backdrop click
    backdrop.addEventListener("click", () => modal.close(), { once: true });

    // ESC key
    const escHandler = e => { if (e.key === "Escape") modal.close(); };
    document.addEventListener("keydown", escHandler);
    container._escHandler = escHandler;

    // Focus trap: first focusable inside modal
    container.querySelector("button, input, select, textarea")?.focus();
  },

  close() {
    document.getElementById("modal-container")?.classList.add("hidden");
    document.getElementById("modal-backdrop")?.classList.add("hidden");

    const container = document.getElementById("modal-container");
    if (container?._escHandler) {
      document.removeEventListener("keydown", container._escHandler);
      delete container._escHandler;
    }

    if (_onClose) { _onClose(); _onClose = null; }
  },

  /** Replace only the body content of an open modal */
  setBody(html) {
    const body = document.querySelector(".modal__body");
    if (body) body.innerHTML = html;
  },

  /** Update footer actions */
  setLoading(btnLabel, loading) {
    const btn = document.querySelector(`[data-action="${btnLabel}"]`);
    if (!btn) return;
    btn.classList.toggle("btn--loading", loading);
    btn.disabled = loading;
  },
};
