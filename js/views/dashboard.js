/**
 * TAS WT — Dashboard View
 * 역할별 대시보드. DB 데이터 없어도 항상 정상 렌더링.
 * 모든 DB 호출은 safeLoad()로 감싸 — 실패해도 화면이 죽지 않음.
 */

import { authStore, ROLES }   from "../core/auth.js";
import { trainingsDB, completionsDB, assignmentsDB, announcementsDB } from "../core/db.js";
import { formatDate, isOverdue, isExpiringSoon, daysFromNow } from "../utils/date.js";
import { router } from "../core/router.js";

export async function render(container) {
  const role = authStore.role;

  if (role === ROLES.SUPER_ADMIN) {
    renderSuperAdminDashboard(container);       // 동기 — DB 읽기 없음
  } else if (role === ROLES.HQ_ADMIN) {
    await renderHQAdminDashboard(container);
  } else if (role === ROLES.INSTRUCTOR) {
    await renderInstructorDashboard(container);
  } else {
    await renderEmployeeDashboard(container);
  }
}

/* ═══════════════════════════════════════════════════════════
   ① 슈퍼관리자 대시보드 — DB 읽기 없이 즉시 렌더링
═══════════════════════════════════════════════════════════ */
function renderSuperAdminDashboard(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">시스템 관리 대시보드</div>
        <div class="section-subtitle">${todayLabel()}</div>
      </div>
    </div>

    <div class="dashboard-grid">
      ${statCard({ label: "회사",         icon: iconBuilding(), variant: "primary" })}
      ${statCard({ label: "지점",         icon: iconMapPin(),   variant: "info"    })}
      ${statCard({ label: "관리자",       icon: iconShield(),   variant: "warning" })}
      ${statCard({ label: "전체 사용자",  icon: iconUsers(),    variant: "neutral" })}
    </div>

    <div class="dashboard-main">
      <div class="card">
        <div class="card__header"><div class="card__title">빠른 메뉴</div></div>
        <div class="card__body"
          style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--space-4)">
          ${quickBtn("admin/companies", iconBuilding(), "회사 관리")}
          ${quickBtn("admin/branches",  iconMapPin(),   "지점 관리")}
          ${quickBtn("admin/accounts",  iconUsers(),    "계정 관리")}
          ${quickBtn("admin/settings",  iconSettings(), "시스템 설정")}
        </div>
      </div>

      <div class="card">
        <div class="card__header"><div class="card__title">시스템 정보</div></div>
        <div class="card__body">
          <div class="info-row"><span class="info-row__label">플랫폼</span><span class="info-row__value">TAS Web Training v1.0</span></div>
          <div class="info-row"><span class="info-row__label">환경</span><span class="info-row__value">Firebase + Vercel</span></div>
          <div class="info-row"><span class="info-row__label">로그인 UID</span><span class="info-row__value" style="font-family:var(--font-mono);font-size:var(--text-xs)">${authStore.uid ?? "–"}</span></div>
          <div class="info-row"><span class="info-row__label">역할</span><span class="info-row__value">슈퍼관리자 (System Admin)</span></div>
        </div>
      </div>
    </div>
  `;

  // 빠른 메뉴 클릭
  container.querySelectorAll("[data-path]").forEach(el =>
    el.addEventListener("click", () => router.push(el.dataset.path))
  );
}

function quickBtn(path, icon, label) {
  return `
    <div class="training-card" data-path="${path}"
      style="cursor:pointer;flex-direction:row;align-items:center;gap:var(--space-3)">
      <div class="stat-card__icon stat-card__icon--primary"
        style="position:static;width:36px;height:36px;flex-shrink:0">${icon}</div>
      <span style="font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--gray-700)">${label}</span>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   ② 본사 교육관리자 대시보드
═══════════════════════════════════════════════════════════ */
async function renderHQAdminDashboard(container) {
  container.innerHTML = skeletonAdminDashboard();

  // 각각 실패해도 빈 배열로 폴백
  const [trainings, announcements] = await Promise.all([
    safeLoad(() => trainingsDB.list(authStore.companyId), []),
    safeLoad(() => announcementsDB.recent(authStore.companyId, 5), []),
  ]);

  const now      = Date.now();
  const active   = trainings.filter(t => t.startDate <= now && (!t.endDate || t.endDate >= now));
  const todayEnd = trainings.filter(t => isSameDay(t.deadline, now));
  const overdue  = trainings.filter(t => t.deadline && t.deadline < now && t.status !== "closed");

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">교육 관리 대시보드</div>
        <div class="section-subtitle">${todayLabel()}</div>
      </div>
      <button class="btn btn--primary" id="btn-new-training">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        교육 등록
      </button>
    </div>

    <div class="dashboard-grid">
      ${statCard({ label: "진행중인 교육",  value: active.length,    icon: bookIcon(),   variant: "primary" })}
      ${statCard({ label: "오늘 마감 교육",  value: todayEnd.length,  icon: calIcon(),    variant: todayEnd.length > 0 ? "warning" : "neutral" })}
      ${statCard({ label: "기한 초과 교육",  value: overdue.length,   icon: alertIcon(),  variant: overdue.length > 0 ? "danger"  : "success"  })}
      ${statCard({ label: "전체 교육 수",    value: trainings.length, icon: layersIcon(), variant: "neutral" })}
    </div>

    <div class="dashboard-main">
      <div class="card">
        <div class="card__header">
          <div>
            <div class="card__title">최근 등록된 교육</div>
            <div class="card__subtitle">전체 교육 목록에서 상세 내용을 확인하세요</div>
          </div>
          <button class="btn btn--ghost btn--sm" id="btn-all-trainings">전체 보기</button>
        </div>
        <div style="padding:0">${recentTrainingsTable(trainings.slice(0, 8))}</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        ${overdue.length > 0 ? `
          <div class="card">
            <div class="card__header">
              <div class="card__title" style="color:var(--color-danger)">⚠ 기한 초과 교육</div>
            </div>
            <div class="card__body card__body--compact">
              ${overdue.map(t => `
                <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:var(--space-2) 0;border-bottom:var(--border-thin);font-size:var(--text-sm)">
                  <span style="color:var(--gray-700)">${esc(t.title)}</span>
                  <span class="chip chip--danger">${Math.abs(daysFromNow(t.deadline))}일 초과</span>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <div class="card">
          <div class="card__header">
            <div class="card__title">공지사항</div>
            <button class="btn btn--ghost btn--sm" id="btn-announcements">더 보기</button>
          </div>
          <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-3)">
            ${announcements.length
              ? announcements.map(a => announcementItem(a)).join("")
              : `<div class="empty-state">등록된 공지사항이 없습니다</div>`}
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("btn-new-training")?.addEventListener("click",   () => router.push("trainings"));
  document.getElementById("btn-all-trainings")?.addEventListener("click",  () => router.push("trainings"));
  document.getElementById("btn-announcements")?.addEventListener("click",  () => router.push("announcements"));
}

/* ═══════════════════════════════════════════════════════════
   ③ 강사 대시보드
═══════════════════════════════════════════════════════════ */
async function renderInstructorDashboard(container) {
  const assignments = await safeLoad(() => assignmentsDB.forUser(authStore.uid), []);

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">안녕하세요, ${esc(authStore.name)}님</div>
        <div class="section-subtitle">배정된 교육을 확인하세요</div>
      </div>
    </div>

    <div class="dashboard-grid" style="grid-template-columns:repeat(3,1fr)">
      ${statCard({ label: "배정된 교육",  value: assignments.length,                                                       icon: bookIcon(),  variant: "primary" })}
      ${statCard({ label: "진행중",       value: assignments.filter(a => a.status === "active").length,                    icon: playIcon(),  variant: "success" })}
      ${statCard({ label: "이번 달 강의", value: assignments.filter(a => a.startDate && isThisMonth(a.startDate)).length,  icon: calIcon(),   variant: "info"    })}
    </div>

    <div class="card">
      <div class="card__header"><div class="card__title">배정된 교육 목록</div></div>
      <div>${recentTrainingsTable(assignments)}</div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   ④ 직원 대시보드
═══════════════════════════════════════════════════════════ */
async function renderEmployeeDashboard(container) {
  const uid = authStore.uid;
  const [assignments, completions] = await Promise.all([
    safeLoad(() => assignmentsDB.forUser(uid), []),
    safeLoad(() => completionsDB.forUser(uid), []),
  ]);

  const completedIds = new Set(completions.map(c => c.trainingId));
  const pending      = assignments.filter(a => !completedIds.has(a.trainingId));
  const overdueList  = pending.filter(a => a.deadline && isOverdue(a.deadline));

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">안녕하세요, ${esc(authStore.name)}님</div>
        <div class="section-subtitle">배정된 교육을 확인하고 수료하세요</div>
      </div>
    </div>

    <div class="dashboard-grid" style="grid-template-columns:repeat(3,1fr)">
      ${statCard({ label: "전체 교육", value: assignments.length, icon: layersIcon(), variant: "neutral" })}
      ${statCard({ label: "미수료",    value: pending.length,     icon: alertIcon(),  variant: pending.length > 0 ? "warning" : "success" })}
      ${statCard({ label: "수료 완료", value: completions.length, icon: checkIcon(),  variant: "success" })}
    </div>

    ${overdueList.length > 0 ? `
      <div style="background:var(--color-danger-bg);border:1px solid rgba(214,56,66,.2);
        border-radius:var(--radius-lg);padding:var(--space-4);margin-bottom:var(--space-4);
        display:flex;gap:var(--space-3);align-items:flex-start">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
          style="color:var(--color-danger);flex-shrink:0;margin-top:2px">
          <path d="M10 2L2 17h16L10 2zm0 5v5m0 2.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <div>
          <div style="font-size:var(--text-sm);font-weight:var(--weight-semibold);color:#7a1a1e">
            기한이 초과된 교육이 ${overdueList.length}건 있습니다
          </div>
          <div style="font-size:var(--text-xs);color:#7a1a1e;opacity:.7;margin-top:2px">
            ${overdueList.map(t => esc(t.trainingTitle ?? t.trainingId ?? "교육")).join(", ")}
          </div>
        </div>
      </div>
    ` : ""}

    <div class="card">
      <div class="card__header">
        <div class="card__title">내 교육 목록</div>
        <button class="btn btn--ghost btn--sm" id="btn-all-my">전체 보기</button>
      </div>
      <div class="card__body"
        style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--space-4)">
        ${pending.length === 0 && completions.length === 0
          ? `<div class="empty-state" style="grid-column:1/-1">배정된 교육이 없습니다</div>`
          : [
              ...pending.slice(0, 6).map(a => employeeTrainingCard(a, false)),
              ...completions.slice(0, 3).map(a => employeeTrainingCard(a, true)),
            ].join("")}
      </div>
    </div>
  `;

  document.getElementById("btn-all-my")?.addEventListener("click", () => router.push("my-trainings"));
}

/* ═══════════════════════════════════════════════════════════
   공통 컴포넌트
═══════════════════════════════════════════════════════════ */
function statCard({ label, value = "–", icon, variant = "neutral" }) {
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
    return `<div class="empty-state" style="padding:var(--space-10)">
      <div class="empty-state__title">등록된 교육이 없습니다</div>
    </div>`;
  }
  const now = Date.now();
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>교육명</th><th>시작일</th><th>수료기한</th><th>상태</th>
        </tr>
      </thead>
      <tbody>
        ${trainings.map(t => `
          <tr>
            <td style="font-weight:var(--weight-medium);color:var(--gray-800)">${esc(t.title ?? t.trainingTitle ?? "–")}</td>
            <td>${formatDate(t.startDate)}</td>
            <td>${formatDate(t.deadline)}</td>
            <td>${statusChip(t, now)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function statusChip(t, now) {
  if (t.status === "closed")                    return `<span class="chip chip--neutral">종료</span>`;
  if (t.deadline && t.deadline < now)           return `<span class="chip chip--danger">기한 초과</span>`;
  if (t.startDate && t.startDate > now)         return `<span class="chip chip--info">예정</span>`;
  return `<span class="chip chip--success">진행중</span>`;
}

function announcementItem(a) {
  return `
    <div class="announcement-item ${a.important ? "announcement-item--important" : ""}">
      <div class="announcement-item__title">${esc(a.title ?? "")}</div>
      <div class="announcement-item__body">${esc(a.content ?? "")}</div>
      <div class="announcement-item__meta">${formatDate(a.createdAt)}</div>
    </div>
  `;
}

function employeeTrainingCard(t, completed) {
  const days = t.deadline ? daysFromNow(t.deadline) : null;
  return `
    <div class="training-card">
      <div class="training-card__header">
        <div class="training-card__title">${esc(t.trainingTitle ?? t.title ?? "교육")}</div>
        ${completed
          ? `<span class="chip chip--success">수료</span>`
          : days !== null && days < 0
            ? `<span class="chip chip--danger">기한 초과</span>`
            : days !== null && days <= 3
              ? `<span class="chip chip--warning">D-${days}</span>`
              : `<span class="chip chip--info">미수료</span>`}
      </div>
      <div class="training-card__meta">
        <span class="training-card__meta-item">수료기한 ${formatDate(t.deadline)}</span>
      </div>
      ${!completed
        ? `<button class="btn btn--primary btn--sm" style="margin-top:auto">교육 시작</button>`
        : `<div style="font-size:var(--text-xs);color:var(--color-success);margin-top:auto">✓ ${formatDate(t.completedAt)} 수료</div>`}
    </div>
  `;
}

/* ── Skeleton ────────────────────────────────────────────── */
function skeletonAdminDashboard() {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-6)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="skeleton" style="height:24px;width:180px;border-radius:4px"></div>
          <div class="skeleton" style="height:16px;width:240px;border-radius:4px"></div>
        </div>
        <div class="skeleton" style="width:100px;height:36px;border-radius:8px"></div>
      </div>
      <div class="dashboard-grid">
        ${Array(4).fill(`<div class="skeleton" style="height:110px;border-radius:12px"></div>`).join("")}
      </div>
      <div class="dashboard-main">
        <div class="skeleton" style="height:260px;border-radius:12px"></div>
        <div style="display:flex;flex-direction:column;gap:var(--space-4)">
          <div class="skeleton" style="height:120px;border-radius:12px"></div>
          <div class="skeleton" style="height:120px;border-radius:12px"></div>
        </div>
      </div>
    </div>
  `;
}

/* ── Utilities ───────────────────────────────────────────── */

/** DB 호출 실패 시 fallback 반환 — 화면이 죽지 않음 */
async function safeLoad(fn, fallback = null) {
  try {
    return await fn();
  } catch (err) {
    console.warn("[dashboard] DB load failed:", err?.message ?? err);
    return fallback;
  }
}

/** XSS 방지 */
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function todayLabel() {
  return new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
}

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
const ic = (d) => `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const bookIcon     = () => ic("M3 2h11a1 1 0 011 1v14l-6-3-6 3V3a1 1 0 011-1z");
const calIcon      = () => ic("M6 2v3M14 2v3M2 8h16M4 5h12a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z");
const alertIcon    = () => ic("M10 2L2 17h16L10 2zm0 5v5m0 2.5v.01");
const layersIcon   = () => ic("M10 2L2 6l8 4 8-4-8-4zM2 14l8 4 8-4M2 10l8 4 8-4");
const checkIcon    = () => ic("M4 10l4 4 8-8");
const playIcon     = () => ic("M5 3l12 7-12 7V3z");
const iconBuilding = () => ic("M2 18V4a1 1 0 011-1h14a1 1 0 011 1v14M2 18h16M8 18v-5h4v5");
const iconMapPin   = () => ic("M10 10a3 3 0 100-6 3 3 0 000 6zm0 0c0 5-6 8-6 8h12s-6-3-6-8z");
const iconShield   = () => ic("M10 2l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V5l7-3z");
const iconUsers    = () => ic("M14 17v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1m8-9a3 3 0 11-6 0 3 3 0 016 0zm5 3a2 2 0 100-4 2 2 0 000 4zm2 6v-1a3 3 0 00-2-2.83");
const iconSettings = () => ic("M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm6.5-2.5a6.5 6.5 0 01-.1.9l1.7 1.4-1.5 2.6-2-.8a6 6 0 01-1.6.9l-.3 2h-3l-.3-2a6 6 0 01-1.6-.9l-2 .8L4.4 14l1.7-1.4A6.5 6.5 0 016 12a6.5 6.5 0 01.1-.9L4.4 9.7l1.5-2.6 2 .8A6 6 0 019.5 7l.3-2h3l.3 2a6 6 0 011.6.9l2-.8 1.5 2.6-1.7 1.3A6.5 6.5 0 0116.5 12z");
