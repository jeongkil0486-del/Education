import { authStore, ROLES } from "../core/auth.js";
import { branchesDB } from "../core/db.js";
import { listAnnouncements, saveAnnouncement, deleteAnnouncement } from "../core/admin-api.js";
import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { formatDate } from "../utils/date.js";

let pageState = { announcements: [], branches: [], container: null };
const canWrite = () => [ROLES.SUPER_ADMIN, ROLES.HQ_ADMIN].includes(authStore.role);

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
  container.querySelectorAll("[data-announcement-edit]").forEach((button) => button.addEventListener("click", () => {
    openEditor(pageState.announcements.find((item) => item.id === button.dataset.announcementEdit));
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
  return `<article style="border:1px solid var(--gray-200);border-radius:var(--radius-lg);padding:var(--space-4)">
    <div style="display:flex;justify-content:space-between;gap:var(--space-3);align-items:flex-start">
      <div><div style="font-weight:var(--weight-semibold);color:var(--gray-900)">${item.important ? '<span style="color:var(--red-600)">중요 · </span>' : ""}${esc(item.title)}</div>
      <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:4px">작성자 ${esc(item.authorName ?? item.createdByName ?? "-")} · ${esc(period)}</div></div>
      ${canWrite() ? `<div style="display:flex;gap:var(--space-2)"><button class="btn btn--ghost btn--sm" data-announcement-edit="${esc(item.id)}">수정</button><button class="btn btn--danger btn--sm" data-announcement-delete="${esc(item.id)}">삭제</button></div>` : ""}
    </div>
    <div style="white-space:pre-wrap;margin-top:var(--space-3);font-size:var(--text-sm);line-height:1.6">${esc(item.content)}</div>
  </article>`;
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
          if (item) pageState.announcements = pageState.announcements.map((row) => row.id === item.id ? result.announcement : row);
          else pageState.announcements.unshift(result.announcement);
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

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
