import { authStore, ROLES } from "../core/auth.js";
import { branchesDB } from "../core/db.js";
import {
  deleteAnnouncement,
  getAnnouncementReadStatus,
  listAnnouncements,
  markAnnouncementRead,
  saveAnnouncement,
} from "../core/admin-api.js";
import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { formatDate } from "../utils/date.js";

let pageState = { announcements: [], branches: [], container: null };
const canWrite = () => [ROLES.SUPER_ADMIN, ROLES.HQ_ADMIN].includes(authStore.role);
const canViewReadStatus = () => authStore.role === ROLES.HQ_ADMIN;

export async function render(container) {
  container.innerHTML = '<div class="empty-state" style="padding:var(--space-16)">공지사항을 불러오는 중입니다.</div>';
  try {
    const [result, branches] = await Promise.all([
      listAnnouncements(),
      canWrite() ? branchesDB.listAll().catch(() => []) : Promise.resolve([]),
    ]);
    pageState = { announcements: result.announcements ?? [], branches, container };
    renderPage(container);
  } catch (err) {
    console.error("[announcements] load failed", err);
    container.innerHTML = `<div class="empty-state" style="padding:var(--space-16)"><div class="empty-state__title">공지사항을 불러오지 못했습니다.</div><div>${esc(err?.message ?? "알 수 없는 오류")}</div></div>`;
  }
}

function renderPage(container) {
  container.innerHTML = `
    <div class="section-header">
      <div><div class="section-title">공지사항</div><div class="section-subtitle">교육 관련 공지와 중요 안내를 확인합니다.</div></div>
      ${canWrite() ? '<button class="btn btn--primary" id="btn-create-announcement">공지 작성</button>' : ""}
    </div>
    <div class="card" style="margin-top:var(--space-5)">
      <div class="card__body" style="display:grid;gap:var(--space-3)">
        ${pageState.announcements.length ? pageState.announcements.map(announcementCard).join("") : '<div class="empty-state">등록된 공지사항이 없습니다.</div>'}
      </div>
    </div>`;
  document.getElementById("btn-create-announcement")?.addEventListener("click", () => openEditor());
  container.querySelectorAll("[data-announcement-open]").forEach((button) => button.addEventListener("click", () => {
    const item = pageState.announcements.find((row) => row.id === button.dataset.announcementOpen);
    if (item) openAnnouncementDetail(item);
  }));
  container.querySelectorAll("[data-announcement-edit]").forEach((button) => button.addEventListener("click", () => {
    openEditor(pageState.announcements.find((item) => item.id === button.dataset.announcementEdit));
  }));
  container.querySelectorAll("[data-announcement-read-status]").forEach((button) => button.addEventListener("click", () => {
    const item = pageState.announcements.find((row) => row.id === button.dataset.announcementReadStatus);
    if (item) openAnnouncementReadStatus(item);
  }));
  container.querySelectorAll("[data-announcement-delete]").forEach((button) => button.addEventListener("click", async () => {
    const item = pageState.announcements.find((row) => row.id === button.dataset.announcementDelete);
    if (!item || !window.confirm(`'${item.title}' 공지를 삭제하시겠습니까?`)) return;
    try {
      await deleteAnnouncement({ announcementId: item.id });
      pageState.announcements = pageState.announcements.filter((row) => row.id !== item.id);
      renderPage(container);
      toast.success("공지사항이 삭제되었습니다.");
    } catch (err) { toast.error(err?.message ?? "공지사항 삭제에 실패했습니다."); }
  }));
}

function announcementCard(item) {
  const period = [item.startsAt ? formatDate(item.startsAt) : "즉시", item.endsAt ? formatDate(item.endsAt) : "종료일 없음"].join(" ~ ");
  const summary = item.readSummary;
  const readSummary = canViewReadStatus() && summary
    ? `<span class="chip ${summary.unreadUserCount ? "chip--warning" : "chip--success"}">확인 ${summary.readUserCount} / ${summary.targetUserCount}명</span>`
    : authStore.role === ROLES.INSTRUCTOR
      ? `<span class="chip ${item.currentUserRead ? "chip--success" : "chip--warning"}">${item.currentUserRead ? "확인됨" : "미확인"}</span>`
      : "";
  return `<article style="border:1px solid var(--gray-200);border-radius:var(--radius-lg);padding:var(--space-4)">
    <div style="display:flex;justify-content:space-between;gap:var(--space-3);align-items:flex-start">
      <button type="button" data-announcement-open="${esc(item.id)}" style="flex:1;border:0;background:none;padding:0;text-align:left;cursor:pointer">
        <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
          <div style="font-weight:var(--weight-semibold);color:var(--gray-900)">${item.important ? '<span style="color:var(--red-600)">중요 · </span>' : ""}${esc(item.title)}</div>
          ${readSummary}
        </div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:4px">작성자 ${esc(item.authorName ?? item.createdByName ?? "-")} · ${esc(period)}</div>
        <div style="font-size:var(--text-sm);color:var(--primary-600);margin-top:var(--space-3)">내용 보기</div>
      </button>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;justify-content:flex-end">
        ${canViewReadStatus() ? `<button class="btn btn--ghost btn--sm" data-announcement-read-status="${esc(item.id)}">읽음 현황</button>` : ""}
        ${canWrite() ? `<button class="btn btn--ghost btn--sm" data-announcement-edit="${esc(item.id)}">수정</button><button class="btn btn--danger btn--sm" data-announcement-delete="${esc(item.id)}">삭제</button>` : ""}
      </div>
    </div>
  </article>`;
}

function openAnnouncementDetail(item) {
  modal.open({
    title: item.title || "공지사항",
    size: "lg",
    body: `<div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div style="font-size:var(--text-xs);color:var(--gray-500)">작성자 ${esc(item.authorName ?? item.createdByName ?? "-")} · ${formatDateTime(item.createdAt)}</div>
      <div style="white-space:pre-wrap;font-size:var(--text-sm);line-height:1.7;color:var(--gray-800)">${esc(item.content)}</div>
    </div>`,
    actions: [{ label: "닫기", variant: "secondary", onClick: () => modal.close() }],
  });

  markAnnouncementRead({ announcementId: item.id }).then((result) => {
    item.currentUserRead = true;
    item.currentUserReadAt = result?.read?.readAt ?? item.currentUserReadAt;
    renderPage(pageState.container);
  }).catch((error) => {
    console.error("[announcements] mark read failed", error?.code, error?.message);
    toast.error(error?.message ?? "공지사항 읽음 처리에 실패했습니다.");
  });
}

async function openAnnouncementReadStatus(item) {
  if (!canViewReadStatus()) return;
  modal.open({
    title: "공지사항 읽음 현황",
    size: "xl",
    body: '<div class="empty-state">읽음 현황을 불러오는 중입니다.</div>',
    actions: [{ label: "닫기", variant: "secondary", onClick: () => modal.close() }],
  });
  try {
    const data = await getAnnouncementReadStatus({ announcementId: item.id });
    modal.setBody(readStatusBody(data));
    bindReadStatusFilters(data);
  } catch (error) {
    console.error("[announcements] read status failed", error?.code, error?.message);
    modal.setBody(`<div class="empty-state"><div class="empty-state__title">읽음 현황을 불러오지 못했습니다.</div><div>${esc(error?.message ?? "알 수 없는 오류")}</div></div>`);
  }
}

function readStatusBody(data) {
  const summary = data?.summary ?? {};
  return `<div style="display:flex;flex-direction:column;gap:var(--space-4)">
    <div><div style="font-weight:var(--weight-semibold);color:var(--gray-900)">${esc(data?.announcement?.title ?? "공지사항")}</div></div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:var(--space-3)">
      ${readStatusMetric("대상자", summary.targetUserCount ?? 0, "명")}
      ${readStatusMetric("확인", summary.readUserCount ?? 0, "명")}
      ${readStatusMetric("미확인", summary.unreadUserCount ?? 0, "명")}
      ${readStatusMetric("확인율", summary.readRate ?? 0, "%")}
    </div>
    <div style="display:grid;grid-template-columns:1fr 180px;gap:var(--space-3)">
      <input class="form-control" id="announcement-read-search" type="search" placeholder="이름·지점 검색" />
      <select class="form-control" id="announcement-read-filter"><option value="all">전체</option><option value="read">확인</option><option value="unread">미확인</option></select>
    </div>
    <div id="announcement-read-results"></div>
  </div>`;
}

function readStatusMetric(label, value, suffix) {
  return `<div style="border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:var(--space-3)"><div style="font-size:var(--text-xs);color:var(--gray-500)">${label}</div><div style="font-size:var(--text-xl);font-weight:var(--weight-semibold);margin-top:4px">${value}${suffix}</div></div>`;
}

function bindReadStatusFilters(data) {
  const users = [...(data?.unreadUsers ?? []), ...(data?.readUsers ?? [])];
  const renderResults = () => {
    const query = String(document.getElementById("announcement-read-search")?.value ?? "").trim().toLowerCase();
    const filter = document.getElementById("announcement-read-filter")?.value ?? "all";
    const rows = users.filter((user) => {
      const matchesFilter = filter === "all" || user.status === filter;
      const haystack = `${user.name ?? ""} ${user.branchName ?? ""}`.toLowerCase();
      return matchesFilter && (!query || haystack.includes(query));
    });
    const results = document.getElementById("announcement-read-results");
    if (!results) return;
    if (!users.length) {
      results.innerHTML = '<div class="empty-state">읽음 대상자가 없습니다.</div>';
      return;
    }
    if (!rows.length) {
      results.innerHTML = '<div class="empty-state">검색 조건에 맞는 대상자가 없습니다.</div>';
      return;
    }
    results.innerHTML = `<div style="overflow:auto"><table class="table"><thead><tr><th>이름</th><th>역할</th><th>지점</th><th>상태</th><th>확인 일시</th></tr></thead><tbody>${rows.map((user) => `<tr><td>${esc(user.name)}</td><td>강사</td><td>${esc(user.branchName)}</td><td><span class="chip ${user.status === "read" ? "chip--success" : "chip--warning"}">${user.status === "read" ? "확인" : "미확인"}</span></td><td>${user.readAt ? formatDateTime(user.readAt) : "-"}</td></tr>`).join("")}</tbody></table></div>`;
  };
  document.getElementById("announcement-read-search")?.addEventListener("input", renderResults);
  document.getElementById("announcement-read-filter")?.addEventListener("change", renderResults);
  renderResults();
}

function openEditor(item = null) {
  if (!canWrite()) return;
  const branchOptions = pageState.branches.map((branch) => `<option value="${esc(branch.id)}" ${item?.targetBranchId === branch.id ? "selected" : ""}>${esc(branch.name ?? branch.code ?? branch.id)}</option>`).join("");
  modal.open({
    title: item ? "공지 수정" : "공지 작성",
    size: "lg",
    body: `<div style="display:grid;gap:var(--space-4)">
      <div class="form-group"><label class="form-label form-label--required">제목</label><input class="form-control" id="announcement-title" value="${esc(item?.title ?? "")}"></div>
      <div class="form-group"><label class="form-label form-label--required">내용</label><textarea class="form-control" id="announcement-content" rows="7">${esc(item?.content ?? "")}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">대상 지점</label><select class="form-control" id="announcement-branch"><option value="">전체 지점</option>${branchOptions}</select></div>
        <div class="form-group"><label class="form-label">상태</label><select class="form-control" id="announcement-status"><option value="published" ${item?.status !== "draft" ? "selected" : ""}>게시</option><option value="draft" ${item?.status === "draft" ? "selected" : ""}>임시저장</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">게시 시작</label><input class="form-control" type="date" id="announcement-start" value="${dateInputValue(item?.startsAt)}"></div>
        <div class="form-group"><label class="form-label">게시 종료</label><input class="form-control" type="date" id="announcement-end" value="${dateInputValue(item?.endsAt)}"></div>
      </div>
      <label style="display:flex;gap:var(--space-2);align-items:center"><input type="checkbox" id="announcement-important" ${item?.important ? "checked" : ""}> 중요 공지</label>
    </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "저장", variant: "primary", onClick: async () => {
        modal.setLoading("저장", true);
        try {
          const result = await saveAnnouncement({
            announcementId: item?.id ?? "",
            title: document.getElementById("announcement-title")?.value,
            content: document.getElementById("announcement-content")?.value,
            targetBranchId: document.getElementById("announcement-branch")?.value ?? "",
            status: document.getElementById("announcement-status")?.value ?? "published",
            startsAt: document.getElementById("announcement-start")?.value || null,
            endsAt: document.getElementById("announcement-end")?.value || null,
            important: document.getElementById("announcement-important")?.checked ?? false,
          });
          const refreshed = await listAnnouncements();
          pageState.announcements = refreshed.announcements ?? [];
          modal.close();
          renderPage(pageState.container);
          toast.success(result.message);
        } catch (err) {
          toast.error(err?.message ?? "공지사항 저장에 실패했습니다.");
          modal.setLoading("저장", false);
        }
      } },
    ],
  });
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(Number(value) || value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
