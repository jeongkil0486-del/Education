/**
 * TAS WT — Dashboard View
 * 역할별 대시보드. DB 데이터 없어도 항상 정상 렌더링.
 * 모든 DB 호출은 safeLoad()로 감싸 — 실패해도 화면이 죽지 않음.
 */

import { authStore, ROLES }   from "../core/auth.js";
import { TEXT } from "../constants/text.js";
import {
  trainingsDB, completionsDB, assignmentsDB, announcementsDB,
  companiesDB, branchesDB, usersDB, settingsDB,
} from "../core/db.js";
import { formatDate, isOverdue, isExpiringSoon, daysFromNow } from "../utils/date.js";
import { router } from "../core/router.js";
import { modal } from "../utils/modal.js";
import { loadEmployeeDeadlineDashboardRows } from "./employees.js";

export async function render(container) {
  const role = authStore.role;

  if (role === ROLES.SUPER_ADMIN) {
    await renderSuperAdminDashboard(container);  // DB 카운트 포함
  } else if (role === ROLES.HQ_ADMIN) {
    await renderManagementDashboard(container, ROLES.HQ_ADMIN);
  } else if (role === ROLES.INSTRUCTOR) {
    await renderManagementDashboard(container, ROLES.INSTRUCTOR);
  } else {
    await renderEmployeeDashboard(container);
  }
}

let managementDashboardState = {
  deadlineRows: [],
  branches: [],
  buckets: [],
  role: "",
};

async function renderManagementDashboard(container, role) {
  container.innerHTML = skeletonAdminDashboard();
  const isInstructor = role === ROLES.INSTRUCTOR;
  const [deadlineData, notificationSettings] = await Promise.all([
    safeLoad(() => loadEmployeeDeadlineDashboardRows(), { rows: [], branches: [], employees: [] }),
    safeLoad(() => settingsDB.getNotifications(), {}),
  ]);
  const dashboardCompanyId = authStore.companyId ?? deadlineData.company?.id ?? null;
  const announcements = dashboardCompanyId
    ? await safeLoad(() => announcementsDB.list(dashboardCompanyId), [])
    : [];

  const roleScopedAnnouncements = announcements.filter((item) => announcementVisibleToRole(item, role));
  const visibleAnnouncements = isInstructor
    ? roleScopedAnnouncements.filter(isPublishedAnnouncement)
    : roleScopedAnnouncements;
  const publishedAnnouncements = visibleAnnouncements.filter(isPublishedAnnouncement);
  const importantAnnouncements = visibleAnnouncements.filter(isImportantAnnouncement);
  const unreadAnnouncements = visibleAnnouncements.filter((item) => !announcementReadBy(item, authStore.uid));
  const buckets = resolveDashboardDeadlineBuckets(notificationSettings);
  const maxSoonDays = Math.max(0, ...buckets.map((bucket) => bucket.days));
  const uniqueDeadlineRows = dedupeDeadlineRows(deadlineData.rows ?? []);
  const soonRows = notificationSettings?.showExpiringSoon === false
    ? []
    : uniqueDeadlineRows.filter((row) => row.daysRemaining !== null && row.daysRemaining >= 0 && row.daysRemaining <= maxSoonDays);
  const overdueRows = uniqueDeadlineRows.filter((row) => row.daysRemaining !== null && row.daysRemaining < 0);

  managementDashboardState = {
    deadlineRows: [...overdueRows, ...soonRows],
    branches: deadlineData.branches ?? [],
    buckets,
    role,
  };

  const announcementCards = isInstructor
    ? [
      { label: "확인 가능 공지", value: visibleAnnouncements.length, action: "announcements", variant: "primary" },
      { label: "미확인 공지", value: unreadAnnouncements.length, action: "announcements", variant: unreadAnnouncements.length ? "warning" : "success" },
      { label: "중요 공지", value: importantAnnouncements.length, action: "announcements", variant: importantAnnouncements.length ? "danger" : "neutral" },
    ]
    : [
      { label: "전체 공지", value: visibleAnnouncements.length, action: "announcements", variant: "primary" },
      { label: "중요 공지", value: importantAnnouncements.length, action: "announcements", variant: importantAnnouncements.length ? "danger" : "neutral" },
      { label: "게시 중 공지", value: publishedAnnouncements.length, action: "announcements", variant: "success" },
    ];
  const deadlineCards = [
    { label: "교육기한 임박", rows: soonRows, action: "soon", variant: soonRows.length ? "warning" : "success" },
    { label: "교육기한 초과", rows: overdueRows, action: "overdue", variant: overdueRows.length ? "danger" : "success" },
  ];

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">${isInstructor ? `안녕하세요, ${esc(authStore.name)}님` : "교육관리 업무 대시보드"}</div>
        <div class="section-subtitle">${isInstructor ? "소속 지점의 공지와 직원 교육기한 현황입니다." : "전체 지점의 공지와 직원 교육기한 현황입니다."} · ${todayLabel()}</div>
      </div>
    </div>
    <div class="dashboard-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      ${announcementCards.map(dashboardAnnouncementCard).join("")}
      ${deadlineCards.map(dashboardDeadlineCard).join("")}
    </div>
    <div class="dashboard-main" style="grid-template-columns:1fr 1fr">
      <div class="card">
        <div class="card__header"><div><div class="card__title">공지 현황</div><div class="card__subtitle">기존 공지사항 데이터를 기준으로 집계합니다.</div></div></div>
        <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-3)">
          ${publishedAnnouncements.length
            ? publishedAnnouncements.slice(0, 5).map(announcementDashboardItem).join("")
            : '<div class="empty-state">게시 중인 공지사항이 없습니다.</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card__header"><div><div class="card__title">교육기한 현황</div><div class="card__subtitle">직원관리대장과 동일한 주기 계산 결과입니다.</div></div></div>
        <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-3)">
          ${deadlineSummaryRow("교육기한 임박", soonRows, "warning")}
          ${deadlineSummaryRow("교육기한 초과", overdueRows, "danger")}
          ${isInstructor && !(deadlineData.branches ?? []).length
            ? '<div class="empty-state">소속 지점 정보가 없어 현황을 조회할 수 없습니다.</div>'
            : ""}
        </div>
      </div>
    </div>`;

  container.querySelectorAll('[data-dashboard-action="announcements"]').forEach((card) => {
    card.addEventListener("click", () => router.push("announcements"));
  });
  container.querySelectorAll('[data-dashboard-action="soon"], [data-dashboard-action="overdue"]').forEach((card) => {
    card.addEventListener("click", () => openDeadlineDashboardModal(card.dataset.dashboardAction));
  });
}

function dashboardAnnouncementCard(card) {
  return `<button type="button" class="stat-card" data-dashboard-action="${card.action}" style="text-align:left;cursor:pointer;border:0;width:100%">
    <div class="stat-card__icon stat-card__icon--${card.variant}">${iconBell()}</div>
    <div class="stat-card__label">${esc(card.label)}</div>
    <div class="stat-card__value">${card.value}</div>
  </button>`;
}

function dashboardDeadlineCard(card) {
  const employeeCount = new Set(card.rows.map((row) => row.employeeUid)).size;
  return `<button type="button" class="stat-card" data-dashboard-action="${card.action}" style="text-align:left;cursor:pointer;border:0;width:100%">
    <div class="stat-card__icon stat-card__icon--${card.variant}">${alertIcon()}</div>
    <div class="stat-card__label">${esc(card.label)}</div>
    <div class="stat-card__value">${card.rows.length}건</div>
    <div style="font-size:var(--text-xs);color:var(--gray-500);margin-top:2px">대상 직원 ${employeeCount}명</div>
  </button>`;
}

function deadlineSummaryRow(label, rows, tone) {
  const employees = new Set(rows.map((row) => row.employeeUid)).size;
  return `<button type="button" data-dashboard-action="${tone === "danger" ? "overdue" : "soon"}" class="btn btn--ghost" style="display:flex;justify-content:space-between;width:100%">
    <span>${esc(label)}</span><strong>${rows.length}건 · ${employees}명</strong>
  </button>`;
}

function resolveDashboardDeadlineBuckets(settings = {}) {
  const configured = (Array.isArray(settings?.deadlineBuckets) ? settings.deadlineBuckets : [])
    .filter((bucket) => bucket?.enabled !== false && Number(bucket?.days) > 0 && !/초과|완료/.test(String(bucket?.label ?? "")))
    .map((bucket) => ({ key: String(bucket.key ?? ""), label: String(bucket.label ?? `D-${bucket.days}`), days: Number(bucket.days) }))
    .sort((a, b) => b.days - a.days);
  return configured.length ? configured : [30, 14, 7].map((days) => ({ key: `d${days}`, label: `D-${days}`, days }));
}

function dedupeDeadlineRows(rows) {
  const unique = new Map();
  for (const row of rows) {
    const key = `${row.employeeUid}::${row.trainingKey}`;
    const existing = unique.get(key);
    if (!existing || Number(row.daysRemaining) < Number(existing.daysRemaining)) unique.set(key, row);
  }
  return [...unique.values()];
}

function announcementVisibleToRole(item, role) {
  if (item?.companyId && authStore.companyId && item.companyId !== authStore.companyId) return false;
  if (role !== ROLES.INSTRUCTOR) return true;
  const instructorBranch = String(authStore.branchId ?? authStore.profile?.branchId ?? "").trim();
  if (!instructorBranch) return false;
  const branchValues = [item?.branchId, item?.targetBranchId, item?.branchIds, item?.targetBranchIds, item?.targetBranches]
    .flatMap((value) => Array.isArray(value) ? value : value && typeof value === "object" ? Object.keys(value).filter((key) => value[key]) : [value])
    .map((value) => String(value ?? "").trim()).filter(Boolean);
  return !branchValues.length || branchValues.includes("all") || branchValues.includes(instructorBranch);
}

function isPublishedAnnouncement(item) {
  const status = String(item?.status ?? "published").toLowerCase();
  if (["draft", "archived", "hidden", "closed"].includes(status)) return false;
  const now = Date.now();
  const start = Number(item?.publishedAt ?? item?.startsAt ?? item?.startAt ?? 0) || 0;
  const end = Number(item?.expiresAt ?? item?.endsAt ?? item?.endAt ?? 0) || 0;
  return (!start || start <= now) && (!end || end >= now);
}

function isImportantAnnouncement(item) {
  return item?.important === true || item?.pinned === true || ["important", "urgent", "high"].includes(String(item?.priority ?? "").toLowerCase());
}

function announcementReadBy(item, uid) {
  const candidates = [item?.readBy, item?.viewedBy, item?.acknowledgedBy, item?.readUids];
  return candidates.some((value) => Array.isArray(value) ? value.includes(uid) : value && typeof value === "object" ? !!value[uid] : false);
}

function announcementDashboardItem(item) {
  return `<button type="button" data-dashboard-action="announcements" class="announcement-item ${isImportantAnnouncement(item) ? "announcement-item--important" : ""}" style="border:0;text-align:left;cursor:pointer;width:100%">
    <div class="announcement-item__title">${esc(item.title ?? "공지사항")}</div>
    <div class="announcement-item__meta">${isImportantAnnouncement(item) ? "중요 · " : ""}${formatDate(item.publishedAt ?? item.createdAt)}</div>
  </button>`;
}

function deadlineBucketForRow(row, buckets) {
  if (row.daysRemaining < 0) return "overdue";
  const ascending = [...buckets].sort((a, b) => a.days - b.days);
  return ascending.find((bucket) => row.daysRemaining <= bucket.days)?.key ?? "";
}

function openDeadlineDashboardModal(initialKind) {
  const state = managementDashboardState;
  const initialFilter = initialKind === "overdue" ? "overdue" : "all-soon";
  modal.open({
    title: initialKind === "overdue" ? "교육기한 초과 상세" : "교육기한 임박 상세",
    size: "xl",
    body: `<div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div style="display:grid;grid-template-columns:1fr 1fr ${state.role === ROLES.HQ_ADMIN ? "1fr" : ""};gap:var(--space-3)">
        <input class="form-control" id="dashboard-deadline-search" type="search" placeholder="직원명·사번·교육항목 검색" />
        <select class="form-control" id="dashboard-deadline-filter">
          <option value="all">전체</option>
          <option value="all-soon" ${initialFilter === "all-soon" ? "selected" : ""}>교육기한 임박</option>
          ${state.buckets.map((bucket) => `<option value="${esc(bucket.key)}">${esc(bucket.label)}</option>`).join("")}
          <option value="overdue" ${initialFilter === "overdue" ? "selected" : ""}>기한 초과</option>
        </select>
        ${state.role === ROLES.HQ_ADMIN ? `<select class="form-control" id="dashboard-deadline-branch"><option value="">전체 지점</option>${state.branches.map((branch) => `<option value="${esc(branch.id ?? branch.branchId)}">${esc(branch.name ?? branch.branchName ?? branch.id)}</option>`).join("")}</select>` : ""}
      </div>
      <div id="dashboard-deadline-results"></div>
    </div>`,
    actions: [{ label: "닫기", variant: "secondary", onClick: () => modal.close() }],
  });

  const renderRows = () => {
    const query = String(document.getElementById("dashboard-deadline-search")?.value ?? "").trim().toLowerCase();
    const filter = document.getElementById("dashboard-deadline-filter")?.value ?? "all";
    const branchId = document.getElementById("dashboard-deadline-branch")?.value ?? "";
    const rows = state.deadlineRows.filter((row) => {
      const bucket = deadlineBucketForRow(row, state.buckets);
      const matchFilter = filter === "all" || (filter === "all-soon" ? row.daysRemaining >= 0 : bucket === filter);
      const matchBranch = !branchId || row.branchId === branchId;
      const matchQuery = !query || [row.employeeName, row.empNo, row.trainingItemName].some((value) => String(value ?? "").toLowerCase().includes(query));
      return matchFilter && matchBranch && matchQuery;
    }).sort((a, b) => Number(a.daysRemaining) - Number(b.daysRemaining));
    const target = document.getElementById("dashboard-deadline-results");
    if (!target) return;
    if (!rows.length) {
      target.innerHTML = `<div class="empty-state" style="padding:var(--space-10)">현재 조건에 맞는 교육기한 대상자가 없습니다.</div>`;
      return;
    }
    target.innerHTML = `<div style="overflow-x:auto"><table class="data-table" style="min-width:900px"><thead><tr><th>직원명</th><th>사번</th><th>지점</th><th>교육항목</th><th>기준 교육일</th><th>다음 예정일</th><th>남은 일수</th><th>상태</th></tr></thead><tbody>${rows.map((row) => `<tr data-employee-uid="${esc(row.employeeUid)}" style="cursor:pointer"><td>${esc(row.employeeName)}</td><td>${esc(row.empNo)}</td><td>${esc(row.branchName || "-")}</td><td>${esc(row.trainingItemName)}</td><td>${esc(row.baseTrainingDate || "-")}</td><td>${row.nextDueDate ? esc(formatDate(row.nextDueDate)) : "-"}</td><td>${row.daysRemaining < 0 ? `${Math.abs(row.daysRemaining)}일 초과` : `${row.daysRemaining}일`}</td><td>${esc(row.dueStatusLabel || "-")}</td></tr>`).join("")}</tbody></table></div>`;
    target.querySelectorAll("tr[data-employee-uid]").forEach((row) => row.addEventListener("click", () => {
      modal.close();
      router.push("history-cards", { uid: row.dataset.employeeUid });
    }));
  };
  document.getElementById("dashboard-deadline-search")?.addEventListener("input", renderRows);
  document.getElementById("dashboard-deadline-filter")?.addEventListener("change", renderRows);
  document.getElementById("dashboard-deadline-branch")?.addEventListener("change", renderRows);
  renderRows();
}

/* ═══════════════════════════════════════════════════════════
   ① 슈퍼관리자 대시보드
   — 먼저 "–"로 즉시 렌더링, 이후 DB 카운트 비동기 반영
═══════════════════════════════════════════════════════════ */
async function renderSuperAdminDashboard(container) {
  // 즉시 구조 렌더링 (카드는 "–" 상태)
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">시스템 관리 대시보드</div>
        <div class="section-subtitle">${todayLabel()}</div>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="stat-card" id="sc-companies">
        <div class="stat-card__icon stat-card__icon--primary">${iconBuilding()}</div>
        <div class="stat-card__label">회사</div>
        <div class="stat-card__value">–</div>
      </div>
      <div class="stat-card" id="sc-branches">
        <div class="stat-card__icon stat-card__icon--info">${iconMapPin()}</div>
        <div class="stat-card__label">지점</div>
        <div class="stat-card__value">–</div>
      </div>
      <div class="stat-card" id="sc-admins">
        <div class="stat-card__icon stat-card__icon--warning">${iconShield()}</div>
        <div class="stat-card__label">관리자·강사</div>
        <div class="stat-card__value">–</div>
      </div>
      <div class="stat-card" id="sc-users">
        <div class="stat-card__icon stat-card__icon--neutral">${iconUsers()}</div>
        <div class="stat-card__label">전체 사용자</div>
        <div class="stat-card__value">–</div>
      </div>
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
          <div class="info-row">
            <span class="info-row__label">플랫폼</span>
            <span class="info-row__value">TAS Education Lab v1.0</span>
          </div>
          <div class="info-row">
            <span class="info-row__label">환경</span>
            <span class="info-row__value">Firebase 및 Vercel</span>
          </div>
          <div class="info-row">
            <span class="info-row__label">로그인 UID</span>
            <span class="info-row__value"
              style="font-family:var(--font-mono);font-size:var(--text-xs)">${authStore.uid ?? "–"}</span>
          </div>
          <div class="info-row">
            <span class="info-row__label">역할</span>
            <span class="info-row__value">슈퍼관리자</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // 빠른 메뉴 클릭
  container.querySelectorAll("[data-path]").forEach(el =>
    el.addEventListener("click", () => router.push(el.dataset.path))
  );

  configureSuperAdminDashboard(container);

  // DB 카운트 비동기 반영 — Permission denied여도 화면 안 죽음
  const [companies, branches, users] = await Promise.all([
    safeLoad(() => companiesDB.list(),   []),
    safeLoad(() => branchesDB.listAll(), []),
    safeLoad(() => usersDB.listAll(),    []),
  ]);

  void companies;
  const managedUsers = users.filter(
    (user) => user?.active !== false && user?.role !== "super_admin"
  );
  const employeeUsers = managedUsers.filter(user => user?.role === "employee");
  const hqAdmins = managedUsers.filter(user => user?.role === "hq_admin");
  const instructors = managedUsers.filter(user => user?.role === "instructor");

  setStatValue("sc-users", managedUsers.length);
  setStatValue("sc-employees", employeeUsers.length);
  setStatValue("sc-hq-admins", hqAdmins.length);
  setStatValue("sc-instructors", instructors.length);
  setInfoValue("sc-branches-count", branches.length);
}

/** stat 카드 값만 교체 */
function setStatValue(cardId, value) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const el = card.querySelector(".stat-card__value");
  if (el) el.textContent = value;
}

function configureSuperAdminDashboard(container) {
  const dashboardCards = Array.from(container.querySelectorAll(".dashboard-grid .stat-card"));
  if (dashboardCards.length >= 4) {
    updateStatCard(dashboardCards[0], {
      id: "sc-users",
      label: "전체 사용자",
      icon: iconUsers(),
      iconClass: "stat-card__icon stat-card__icon--neutral",
    });
    updateStatCard(dashboardCards[1], {
      id: "sc-employees",
      label: "직원",
      icon: iconUsers(),
      iconClass: "stat-card__icon stat-card__icon--primary",
    });
    updateStatCard(dashboardCards[2], {
      id: "sc-hq-admins",
      label: "본사 교육관리자",
      icon: iconShield(),
      iconClass: "stat-card__icon stat-card__icon--warning",
    });
    updateStatCard(dashboardCards[3], {
      id: "sc-instructors",
      label: "강사",
      icon: iconUserTie(),
      iconClass: "stat-card__icon stat-card__icon--info",
    });
  }

  const infoCardBody = container.querySelector(".dashboard-main .card:last-child .card__body");
  if (infoCardBody && !infoCardBody.querySelector("#sc-branches-count")) {
    const branchRow = document.createElement("div");
    branchRow.className = "info-row";
    branchRow.innerHTML = `
      <span class="info-row__label">지점 수</span>
      <span class="info-row__value" id="sc-branches-count">0</span>
    `;
    infoCardBody.prepend(branchRow);
  }

  const platformValue = container.querySelector(".dashboard-main .card:last-child .info-row .info-row__value");
  if (platformValue) {
    platformValue.textContent = TEXT.brand.platformName;
  }
}

function updateStatCard(card, { id, label, icon, iconClass }) {
  if (!card) return;
  card.id = id;

  const iconElement = card.querySelector(".stat-card__icon");
  if (iconElement) {
    iconElement.className = iconClass;
    iconElement.innerHTML = icon;
  }

  const labelElement = card.querySelector(".stat-card__label");
  if (labelElement) labelElement.textContent = label;

  const valueElement = card.querySelector(".stat-card__value");
  if (valueElement) valueElement.textContent = "0";
}

function setInfoValue(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) element.textContent = value;
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

function iconUserTie() {
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 12C14.4853 12 16.5 9.98528 16.5 7.5C16.5 5.01472 14.4853 3 12 3C9.51472 3 7.5 5.01472 7.5 7.5C7.5 9.98528 9.51472 12 12 12Z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M5 20.25C5.97888 17.1798 8.66155 15 12 15C15.3384 15 18.0211 17.1798 19 20.25" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M11 12.75H13L12.4 15.5L13.75 19H10.25L11.6 15.5L11 12.75Z" fill="currentColor"/>
    </svg>
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
      <button class="btn btn--ghost btn--sm" id="btn-new-training" style="display:none" aria-hidden="true"></button>
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
const iconBell     = () => ic("M10 2a4 4 0 00-4 4v3.5L4 13h12l-2-3.5V6a4 4 0 00-4-4zm-2 13a2 2 0 004 0");
