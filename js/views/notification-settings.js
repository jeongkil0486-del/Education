import { settingsDB } from "../core/db.js";
import { toast } from "../utils/toast.js";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
} from "../services/notification-settings-service.js";

let state = {
  settings: normalizeNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS),
};

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">교육기한 설정</div>
        <div class="section-subtitle">교육관리 대시보드와 직원관리대장에 표시할 교육기한 기준을 설정합니다.</div>
      </div>
    </div>

    <div class="card" style="max-width:920px">
      <div class="card__header">
        <div>
          <div class="card__title">교육 기한 카드 설정</div>
          <div class="card__subtitle">4개 카드 각각의 이름, 기준일, 표시 여부를 관리합니다.</div>
        </div>
      </div>
      <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div id="deadline-bucket-settings" style="display:flex;flex-direction:column;gap:var(--space-4)"></div>
        <div style="padding:var(--space-4);background:var(--brand-50);border:1px solid var(--brand-100);border-radius:var(--radius-md)">
          <div style="font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--brand-700);margin-bottom:var(--space-2)">저장 예시</div>
          <pre id="deadline-bucket-preview" style="margin:0;white-space:pre-wrap;font-size:var(--text-xs);color:var(--gray-700)"></pre>
        </div>
      </div>
      <div class="card__footer">
        <button class="btn btn--secondary btn--sm" id="btn-reset">기본값 복원</button>
        <button class="btn btn--primary btn--sm" id="btn-save">저장</button>
      </div>
    </div>
  `;

  await loadSettings();

  document.getElementById("btn-reset")?.addEventListener("click", () => {
    state.settings = normalizeNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
    renderBucketSettings();
    toast.info("기본 카드 설정으로 복원했습니다.");
  });
  document.getElementById("btn-save")?.addEventListener("click", saveSettings);
}

async function loadSettings() {
  try {
    const saved = await settingsDB.getNotifications();
    state.settings = normalizeNotificationSettings(saved ?? DEFAULT_NOTIFICATION_SETTINGS);
  } catch (err) {
    console.warn("[notification-settings] load failed:", err?.message);
    state.settings = normalizeNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
  }

  renderBucketSettings();
}

function renderBucketSettings() {
  const wrap = document.getElementById("deadline-bucket-settings");
  if (!wrap) return;

  wrap.innerHTML = state.settings.deadlineBuckets.map((bucket, index) => `
    <div class="card" style="border:1px solid var(--gray-200)">
      <div class="card__header">
        <div class="card__title">카드 ${index + 1}</div>
      </div>
      <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label form-label--required">카드명</label>
            <input class="form-control bucket-input" data-key="${bucket.key}" data-field="label" type="text" value="${escAttr(bucket.label)}" maxlength="30" />
          </div>
          <div class="form-group">
            <label class="form-label form-label--required">기준 유형</label>
            <select class="form-control bucket-input" data-key="${bucket.key}" data-field="type">
              <option value="withinDays" ${bucket.type === "withinDays" ? "selected" : ""}>마감 N일 이내</option>
              <option value="overdue" ${bucket.type === "overdue" ? "selected" : ""}>기한 초과</option>
              <option value="completed" ${bucket.type === "completed" ? "selected" : ""}>완료된 교육</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">기준일(days)</label>
            <input
              class="form-control bucket-input"
              data-key="${bucket.key}"
              data-field="days"
              type="number"
              min="1"
              max="365"
              value="${bucket.days ?? ""}"
              ${(bucket.type === "overdue" || bucket.type === "completed") ? "disabled" : ""}
            />
            <div class="form-hint">${
              bucket.type === "completed" ? "완료된 교육(status=completed)을 집계합니다." :
              bucket.type === "overdue"   ? "기한 초과는 기준일을 사용하지 않습니다." :
              "오늘부터 N일 이내인 교육을 집계합니다."
            }</div>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-4);flex-wrap:wrap">
          <label class="check-group">
            <input class="bucket-input" data-key="${bucket.key}" data-field="enabled" type="checkbox" ${bucket.enabled ? "checked" : ""} />
            <span class="check-group__label">카드 표시</span>
          </label>
        </div>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll(".bucket-input").forEach((input) => {
    input.addEventListener("input", handleBucketChange);
    input.addEventListener("change", handleBucketChange);
  });

  updatePreview();
}

function handleBucketChange(event) {
  const key = event.target.dataset.key;
  const field = event.target.dataset.field;
  const bucket = state.settings.deadlineBuckets.find((item) => item.key === key);
  if (!bucket || !field) return;

  if (field === "enabled") {
    bucket[field] = event.target.checked;
  } else if (field === "days") {
    const parsed = Number(event.target.value);
    bucket.days = Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 1;
  } else {
    bucket[field] = event.target.value;
  }

  if (field === "type") {
    bucket.days = (bucket.type === "overdue" || bucket.type === "completed") ? null : Math.max(1, Number(bucket.days || 1));
    renderBucketSettings();
    return;
  }

  updatePreview();
}

function updatePreview() {
  const preview = document.getElementById("deadline-bucket-preview");
  if (!preview) return;

  preview.textContent = JSON.stringify(
    {
      deadlineBuckets: state.settings.deadlineBuckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        type: bucket.type,
        ...(bucket.type === "withinDays" ? { days: Number(bucket.days ?? 1) } : {}),  // overdue/completed는 days 없음
        enabled: !!bucket.enabled,
      })),
    },
    null,
    2
  );
}

async function saveSettings() {
  const invalidBucket = state.settings.deadlineBuckets.find((bucket) => {
    if (!String(bucket.label ?? "").trim()) return true;
    if (bucket.type === "withinDays" && (!bucket.days || Number(bucket.days) < 1)) return true;
    return false;
  });

  if (invalidBucket) {
    toast.error("카드명과 기준일을 확인해 주세요.");
    return;
  }

  const btn = document.getElementById("btn-save");
  if (btn) {
    btn.classList.add("btn--loading");
    btn.disabled = true;
  }

  try {
    const current = normalizeNotificationSettings(await settingsDB.getNotifications());
    const payload = {
      ...current,
      deadlineBuckets: state.settings.deadlineBuckets.map((bucket) => ({
        key: bucket.key,
        label: String(bucket.label).trim(),
        type: bucket.type,
        ...(bucket.type === "withinDays" ? { days: Number(bucket.days) } : {}),
        enabled: !!bucket.enabled,
      })),
    };

    await settingsDB.setNotifications(payload);
    state.settings = normalizeNotificationSettings(payload);
    renderBucketSettings();
    toast.success("교육기한 설정을 저장했습니다.");
  } catch (err) {
    console.error("[notification-settings] save error:", err);
    toast.error("설정 저장 중 오류가 발생했습니다.");
  } finally {
    if (btn) {
      btn.classList.remove("btn--loading");
      btn.disabled = false;
    }
  }
}

function escAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
