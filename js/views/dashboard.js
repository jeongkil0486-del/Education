/**
 * TAS Learning Hub — Dashboard View
 * Renders different dashboards based on role.
 */

import { authStore, ROLES }   from "../core/auth.js";
import { trainingsDB, completionsDB, assignmentsDB, announcementsDB } from "../core/db.js";
import { formatDate, isOverdue, isExpiringSoon, daysFromNow } from "../utils/date.js";
import { router } from "../core/router.js";

export async function render(container) {
  const role = authStore.role;

  if (role === ROLES.HQ_ADMIN || role === ROLES.SUPER_ADMIN) {
    await renderAdminDashboard(container);
  } else if (role === ROLES.INSTRUCTOR) {
    await renderInstructorDashboard(container);
  } else {
    await renderEmployeeDashboard(container);
  }
}

/* ══════════════════════════════════════════════════════════
   HQ Admin Dashboard
══════════════════════════════════════════════════════════ */
async function renderAdminDashboard(container) {
  container.innerHTML = skeletonAdminDashboard();

  // Parallel data load
  const [trainings, announcements] = await Promise.all([
    trainingsDB.list(authStore.companyId),
    announcementsDB.recent(authStore.companyId, 5),
  ]);

  const now       = Date.now();
  const active    = trainings.filter(t => t.startDate <= now && t.endDate >= now);
  const todayEnd  = trainings.filter(t => isSameDay(t.deadline, now));
  const overdue   = trainings.filter(t => t.deadline < now && t.status !== "closed");

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">대시보드</div>
        <div class="section-subtitle">${new Date().toLocaleDateString("ko-KR", { year:"numeric",month:"long",day:"numeric",weekday:"long" })}</div>
      </div>
      <button class="btn btn--primary" onclick="router.push('trainings')">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        교육 등록
      </button>
    </div>

    <!-- Stat cards -->
    <div class="dashboard-grid">
      ${statCard({
        label: "진행중인 교육",
        value: active.length,
        icon: bookIcon(),
        variant: "primary",
      })}
      ${statCard({
        label: "오늘 마감 교육",
        value: todayEnd.length,
        icon: calIcon(),
        variant: todayEnd.length > 0 ? "warning" : "neutral",
      })}
      ${statCard({
        label: "기한 초과 교육",
        value: overdue.length,
        icon: alertIcon(),
        variant: overdue.length > 0 ? "danger" : "success",
      })}
      ${statCard({
        label: "총 교육 수",
        value: trainings.length,
        icon: layersIcon(),
        variant: "neutral",
      })}
    </div>

    <!-- Main + Sidebar -->
    <div class="dashboard-main">
      <!-- Recent trainings -->
      <div class="card">
        <div class="card__header">
          <div>
            <div class="card__title">최근 등록된 교육</div>
            <div class="card__subtitle">전체 교육 목록에서 상세 내용을 확인하세요</div>
          </div>
          <button class="btn btn--ghost btn--sm" id="btn-all-trainings">전체 보기</button>
        </div>
        <div class="card__body card__body--compact" style="padding:0">
          ${recentTrainingsTable(trainings.slice(0, 8))}
        </div>
      </div>

      <!-- Sidebar -->
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">

        <!-- Overdue alerts -->
        ${overdue.length > 0 ? `
          <div class="card">
            <div class="card__header">
              <div class="card__title" style="color:var(--color-danger)">기한 초과 교육</div>
            </div>
            <div class="card__body card__body--compact">
              ${overdue.map(t => `
                <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:var(--space-2) 0;border-bottom:var(--border-thin);font-size:var(--text-sm)">
                  <span style="color:var(--gray-700)">${t.title}</span>
                  <span class="chip chip--danger">${Math.abs(daysFromNow(t.deadline))}일 초과</span>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <!-- Announcements -->
        <div class="card">
          <div class="card__header">
            <div class="card__title">공지사항</div>
            <button class="btn btn--ghost btn--sm" id="btn-announcements">더 보기</button>
          </div>
          <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-3)">
            ${announcements.length
              ? announcements.map(a => announcementItem(a)).join("")
              : `<div class="empty-state">공지사항이 없습니다</div>`
            }
          </div>
        </div>

      </div>
    </div>
  `;

  // Button handlers
  document.getElementById("btn-all-trainings")?.addEventListener("click", () => router.push("trainings"));
  document.getElementById("btn-announcements")?.addEventListener("click", () => router.push("announcements"));
}

/* ══════════════════════════════════════════════════════════
   Instructor Dashboard
══════════════════════════════════════════════════════════ */
async function renderInstructorDashboard(container) {
  const assignments = await assignmentsDB.forUser(authStore.uid);

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">안녕하세요, ${authStore.name}님</div>
        <div class="section-subtitle">배정된 교육을 확인하세요</div>
      </div>
    </div>

    <div class="dashboard-grid" style="grid-template-columns:repeat(3,1fr)">
      ${statCard({ label: "배정된 교육", value: assignments.length, icon: bookIcon(), variant: "primary" })}
      ${statCard({ label: "이번 달 강의", value: assignments.filter(a => isThisMonth(a.startDate)).length, icon: calIcon(), variant: "info" })}
      ${statCard({ label: "진행중", value: assignments.filter(a => a.status === "active").length, icon: playIcon(), variant: "success" })}
    </div>

    <div class="card">
      <div class="card__header"><div class="card__title">배정된 교육</div></div>
      <div class="card__body card__body--compact" style="padding:0">
        ${recentTrainingsTable(assignments)}
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════════════
   Employee Dashboard
══════════════════════════════════════════════════════════ */
async function renderEmployeeDashboard(container) {
  const uid = authStore.uid;
  const [assignments, completions] = await Promise.all([
    assignmentsDB.forUser(uid),
    completionsDB.forUser(uid),
  ]);

  const completedIds  = new Set(completions.map(c => c.trainingId));
  const pending       = assignments.filter(a => !completedIds.has(a.trainingId));
  const overdueList   = pending.filter(a => a.deadline && isOverdue(a.deadline));
  const expiringSoon  = pending.filter(a => a.deadline && isExpiringSoon(a.deadline));

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">안녕하세요, ${authStore.name}님</div>
        <div class="section-subtitle">배정된 교육을 확인하고 수료하세요</div>
      </div>
    </div>

    <div class="dashboard-grid" style="grid-template-columns:repeat(3,1fr)">
      ${statCard({ label: "전체 교육", value: assignments.length, icon: layersIcon(), variant: "neutral" })}
      ${statCard({ label: "미수료", value: pending.length, icon: alertIcon(), variant: pending.length > 0 ? "warning" : "success" })}
      ${statCard({ label: "수료 완료", value: completions.length, icon: checkIcon(), variant: "success" })}
    </div>

    ${overdueList.length > 0 ? `
      <div style="background:var(--color-danger-bg);border:1px solid rgba(214,56,66,.2);border-radius:var(--radius-lg);
        padding:var(--space-4);margin-bottom:var(--space-4);display:flex;gap:var(--space-3);align-items:center">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="color:var(--color-danger);flex-shrink:0">
          <path d="M10 2L2 17h16L10 2zm0 5v5m0 2.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <div>
          <div style="font-size:var(--text-sm);font-weight:var(--weight-semibold);color:#7a1a1e">
            기한이 초과된 교육이 ${overdueList.length}건 있습니다
          </div>
          <div style="font-size:var(--text-xs);color:#7a1a1e;opacity:.7;margin-top:2px">
            ${overdueList.map(t => t.trainingTitle ?? t.trainingId).join(", ")}
          </div>
        </div>
      </div>
    ` : ""}

    <div class="card">
      <div class="card__header">
        <div class="card__title">내 교육 목록</div>
        <button class="btn btn--ghost btn--sm" id="btn-all-my">전체 보기</button>
      </div>
      <div class="card__body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--space-4)">
        ${pending.slice(0, 6).map(a => employeeTrainingCard(a, false)).join("")}
        ${completions.slice(0, 3).map(a => employeeTrainingCard(a, true)).join("")}
        ${(pending.length + completions.length) === 0
          ? `<div class="empty-state" style="grid-column:1/-1">배정된 교육이 없습니다</div>`
          : ""}
      </div>
    </div>
  `;

  document.getElementById("btn-all-my")?.addEventListener("click", () => router.push("my-trainings"));
}

/* ── Sub-components ──────────────────────────────────────── */
function statCard({ label, value, icon, variant = "neutral" }) {
  return `
    <div class="stat-card">
      <div class="stat-card__icon stat-card__icon--${variant}">${icon}</div>
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value">${value}</div>
    </div>
  `;
}

function recentTrainingsTable(trainings) {
  if (!trainings.length) {
    return `<div class="empty-state">등록된 교육이 없습니다</div>`;
  }
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>교육명</th>
          <th>시작일</th>
          <th>수료기한</th>
          <th>상태</th>
        </tr>
      </thead>
      <tbody>
        ${trainings.map(t => `
          <tr>
            <td style="font-weight:var(--weight-medium);color:var(--gray-800)">${t.title ?? t.trainingTitle ?? "–"}</td>
            <td>${formatDate(t.startDate)}</td>
            <td>${formatDate(t.deadline)}</td>
            <td>${trainingStatusChip(t)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function trainingStatusChip(t) {
  const now = Date.now();
  if (t.status === "closed")         return `<span class="chip chip--neutral">종료</span>`;
  if (t.deadline && t.deadline < now) return `<span class="chip chip--danger">기한 초과</span>`;
  if (t.startDate && t.startDate > now) return `<span class="chip chip--info">예정</span>`;
  return `<span class="chip chip--success">진행중</span>`;
}

function announcementItem(a) {
  return `
    <div class="announcement-item ${a.important ? "announcement-item--important" : ""}">
      <div class="announcement-item__title">${a.title}</div>
      <div class="announcement-item__body">${a.content ?? ""}</div>
      <div class="announcement-item__meta">${formatDate(a.createdAt)}</div>
    </div>
  `;
}

function employeeTrainingCard(t, completed) {
  const days = t.deadline ? daysFromNow(t.deadline) : null;
  return `
    <div class="training-card">
      <div class="training-card__header">
        <div class="training-card__title">${t.trainingTitle ?? t.title ?? "교육"}</div>
        ${completed
          ? `<span class="chip chip--success">수료</span>`
          : days !== null && days < 0
            ? `<span class="chip chip--danger">기한 초과</span>`
            : days !== null && days <= 3
              ? `<span class="chip chip--warning">D-${days}</span>`
              : `<span class="chip chip--info">미수료</span>`
        }
      </div>
      <div class="training-card__meta">
        <span class="training-card__meta-item">수료기한 ${formatDate(t.deadline)}</span>
      </div>
      ${!completed ? `
        <button class="btn btn--primary btn--sm" style="margin-top:auto" data-training-id="${t.trainingId}">
          교육 시작
        </button>
      ` : `
        <div style="font-size:var(--text-xs);color:var(--color-success);margin-top:auto">
          ✓ ${formatDate(t.completedAt)} 수료
        </div>
      `}
    </div>
  `;
}

/* ── Skeleton ────────────────────────────────────────────── */
function skeletonAdminDashboard() {
  const bar = (w) => `<div class="skeleton" style="height:16px;width:${w};border-radius:4px"></div>`;
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-6)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;flex-direction:column;gap:8px">${bar("160px")}${bar("220px")}</div>
        <div class="skeleton" style="width:110px;height:36px;border-radius:8px"></div>
      </div>
      <div class="dashboard-grid">
        ${Array(4).fill(`<div class="skeleton" style="height:120px;border-radius:12px"></div>`).join("")}
      </div>
      <div class="skeleton" style="height:280px;border-radius:12px"></div>
    </div>
  `;
}

/* ── Helpers ─────────────────────────────────────────────── */
function isSameDay(ts, now) {
  if (!ts) return false;
  const a = new Date(ts), b = new Date(now);
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth() &&
         a.getDate()     === b.getDate();
}

function isThisMonth(ts) {
  if (!ts) return false;
  const a = new Date(ts), b = new Date();
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

/* ── Icons ───────────────────────────────────────────────── */
const icSvg = (d) => `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const bookIcon   = () => icSvg("M3 2h11a1 1 0 011 1v14l-6-3-6 3V3a1 1 0 011-1z");
const calIcon    = () => icSvg("M6 2v3M14 2v3M2 8h16M4 5h12a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z");
const alertIcon  = () => icSvg("M10 2L2 17h16L10 2zm0 5v5m0 2.5v.01");
const layersIcon = () => icSvg("M10 2L2 6l8 4 8-4-8-4zM2 14l8 4 8-4M2 10l8 4 8-4");
const checkIcon  = () => icSvg("M4 10l4 4 8-8");
const playIcon   = () => icSvg("M5 3l12 7-12 7V3z");
