/**
 * TAS WT — 알림 설정 (본사 교육관리자 전용)
 * js/views/notification-settings.js
 *
 * /settings/notifications 경로에 저장.
 * 슈퍼관리자가 아닌 HQ Admin이 운영 단위로 설정.
 */

import { settingsDB } from "../core/db.js";
import { toast }      from "../utils/toast.js";

const DEFAULTS = {
  alertDays:      3,      // 기한 임박 알림 기준일
  showOverdueBanner: true, // 기한 초과 배너 표시
  showExpiringSoon:  true, // 임박 배너 표시
};

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">알림 설정</div>
        <div class="section-subtitle">수료기한 알림 기준을 설정합니다</div>
      </div>
    </div>

    <div class="card" style="max-width:560px">
      <div class="card__header"><div class="card__title">수료기한 알림</div></div>
      <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-5)">

        <div class="form-group">
          <label class="form-label">기한 임박 알림 기준 (일 전)</label>
          <div style="display:flex;align-items:center;gap:var(--space-3)">
            <input class="form-control" type="number" id="s-alert-days"
              min="1" max="30" value="${DEFAULTS.alertDays}" style="max-width:100px"/>
            <span style="font-size:var(--text-sm);color:var(--gray-500)">일 이내 남으면 알림 표시</span>
          </div>
          <div class="form-hint">
            직원이 로그인할 때 수료기한이 N일 이하이면 상단에 알림을 표시합니다.
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">표시 항목</label>
          <div style="display:flex;flex-direction:column;gap:var(--space-2)">
            <label class="check-group">
              <input type="checkbox" id="s-show-expiring" checked/>
              <span class="check-group__label">수료기한 임박 배너 표시</span>
            </label>
            <label class="check-group">
              <input type="checkbox" id="s-show-overdue" checked/>
              <span class="check-group__label">기한 초과 배너 표시</span>
            </label>
          </div>
        </div>

        <div style="padding:var(--space-4);background:var(--brand-50);
          border-radius:var(--radius-md);border:1px solid var(--brand-100)">
          <div style="font-size:var(--text-sm);font-weight:var(--weight-medium);
            color:var(--brand-600);margin-bottom:var(--space-2)">미리보기</div>
          <div id="preview-banner"
            style="background:var(--color-warning-bg);border:1px solid rgba(217,135,10,.2);
            border-radius:var(--radius-md);padding:var(--space-3);
            font-size:var(--text-sm);color:#7a4d00;display:flex;align-items:center;gap:var(--space-2)">
            ⚠ 수료기한이 <strong id="preview-days">3</strong>일 이내인 교육이 있습니다.
          </div>
        </div>
      </div>
      <div class="card__footer">
        <button class="btn btn--secondary btn--sm" id="btn-reset">기본값 복원</button>
        <button class="btn btn--primary btn--sm" id="btn-save">저장</button>
      </div>
    </div>
  `;

  // 저장된 설정 로드
  await loadSettings();

  // 미리보기 실시간 반영
  document.getElementById("s-alert-days")?.addEventListener("input", updatePreview);

  document.getElementById("btn-save")?.addEventListener("click", saveSettings);
  document.getElementById("btn-reset")?.addEventListener("click", () => {
    applyValues(DEFAULTS);
    toast.info("기본값으로 복원되었습니다.");
  });
}

async function loadSettings() {
  try {
    const saved = await settingsDB.getNotifications();
    applyValues(saved ? { ...DEFAULTS, ...saved } : DEFAULTS);
  } catch (err) {
    console.warn("[notification-settings] load failed:", err?.message);
    applyValues(DEFAULTS);
  }
}

function applyValues(v) {
  const daysEl      = document.getElementById("s-alert-days");
  const expiringEl  = document.getElementById("s-show-expiring");
  const overdueEl   = document.getElementById("s-show-overdue");
  if (daysEl)     daysEl.value   = v.alertDays ?? DEFAULTS.alertDays;
  if (expiringEl) expiringEl.checked = v.showExpiringSoon ?? DEFAULTS.showExpiringSoon;
  if (overdueEl)  overdueEl.checked  = v.showOverdueBanner ?? DEFAULTS.showOverdueBanner;
  updatePreview();
}

function updatePreview() {
  const days = document.getElementById("s-alert-days")?.value ?? "3";
  const el   = document.getElementById("preview-days");
  if (el) el.textContent = days;
}

async function saveSettings() {
  const alertDays       = parseInt(document.getElementById("s-alert-days")?.value ?? "3", 10);
  const showExpiringSoon  = document.getElementById("s-show-expiring")?.checked ?? true;
  const showOverdueBanner = document.getElementById("s-show-overdue")?.checked ?? true;

  if (!alertDays || alertDays < 1) {
    toast.error("기준 일수는 1 이상이어야 합니다.");
    return;
  }

  const btn = document.getElementById("btn-save");
  if (btn) { btn.classList.add("btn--loading"); btn.disabled = true; }

  try {
    await settingsDB.setNotifications({ alertDays, showExpiringSoon, showOverdueBanner });
    toast.success("설정이 저장되었습니다.");
  } catch (err) {
    console.error("[notification-settings] save error:", err);
    toast.error("저장 중 오류가 발생했습니다.");
  } finally {
    if (btn) { btn.classList.remove("btn--loading"); btn.disabled = false; }
  }
}
