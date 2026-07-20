import { authStore, ROLES } from "../core/auth.js";
import { router } from "../core/router.js";
import { listMaterials, requestMaterialSlideshowSource } from "../services/material-service.js";
import { deleteInstructorGuide, getInstructorGuide, listInstructorGuides, saveInstructorGuide } from "../services/guide-service.js";
import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";

const PDFJS_VERSION = "6.1.200";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
let pdfJsPromise = null;
let activeCleanup = null;

const state = {
  guides: [], materials: [], guide: null, pdf: null, loadingTask: null,
  page: 1, pageCount: 0, thumbObserver: null, renderTask: null,
};

export async function render(container, params = {}) {
  activeCleanup?.();
  activeCleanup = cleanupEditor;
  if (![ROLES.INSTRUCTOR, ROLES.HQ_ADMIN].includes(authStore.role)) {
    renderError(container, "개인 교안을 관리할 권한이 없습니다.");
    return;
  }
  container.innerHTML = '<div class="empty-state" style="padding:var(--space-16)">개인 교안을 불러오는 중입니다.</div>';
  try {
    [state.guides, state.materials] = await Promise.all([
      listInstructorGuides(),
      listMaterials({ maxAgeMs: 30_000 }),
    ]);
    state.materials = state.materials.filter(isPdfMaterial);
    const guideId = String(params.guideId || "").trim();
    if (guideId) await openEditor(container, guideId);
    else renderGuideList(container);
  } catch (error) {
    console.error("[lesson-plan] load failed", error?.code, error?.message);
    renderError(container, error?.message || "교안을 불러오지 못했습니다.");
  }
}

function isPdfMaterial(material) {
  return Boolean(material?.r2Key) && String(material?.fileName || "").toLowerCase().endsWith(".pdf");
}

function renderGuideList(container) {
  container.innerHTML = `
    <div class="section-header">
      <div><div class="section-title">교안 작성</div><div class="section-subtitle">개인 교안은 본인만 조회하고 편집할 수 있습니다.</div></div>
      <button class="btn btn--primary" id="guide-new">새 교안 작성</button>
    </div>
    <div class="card guide-filter"><div class="card__body">
      <input class="form-control" id="guide-search" type="search" placeholder="교안 제목 검색">
      <select class="form-control" id="guide-material-filter"><option value="">전체 교육자료</option>${state.materials.map((item) => `<option value="${escAttr(item.id)}">${esc(item.title)}</option>`).join("")}</select>
    </div></div>
    <div id="guide-list"></div>`;
  const rerender = () => renderGuideRows(container);
  container.querySelector("#guide-new")?.addEventListener("click", () => openEditor(container));
  container.querySelector("#guide-search")?.addEventListener("input", rerender);
  container.querySelector("#guide-material-filter")?.addEventListener("change", rerender);
  renderGuideRows(container);
}

function renderGuideRows(container) {
  const wrap = container.querySelector("#guide-list");
  if (!wrap) return;
  const query = String(container.querySelector("#guide-search")?.value || "").trim().toLowerCase();
  const materialId = String(container.querySelector("#guide-material-filter")?.value || "");
  const rows = state.guides.filter((guide) =>
    (!query || String(guide.title).toLowerCase().includes(query))
    && (!materialId || guide.materialId === materialId));
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state card" style="padding:var(--space-16)"><div class="empty-state__title">작성된 개인 교안이 없습니다.</div><div class="empty-state__desc">조회 가능한 PDF 교육자료를 연결해 첫 교안을 작성하세요.</div></div>';
    return;
  }
  wrap.innerHTML = `<div class="card"><div class="table-wrap"><table class="data-table guide-table"><thead><tr><th>교안 제목</th><th>연결 교육자료</th><th>교육과정</th><th>예상 시간</th><th>페이지 메모</th><th>수정 일시</th><th></th></tr></thead><tbody>${rows.map((guide) => `<tr>
    <td><strong>${esc(guide.title)}</strong></td><td>${esc(guide.materialTitle || "-")}</td><td>${esc(guide.trainingItemId || "-")}</td>
    <td>${guide.estimatedMinutes ? `${Number(guide.estimatedMinutes)}분` : "-"}</td><td>${Number(guide.pageNoteCount || 0)}개</td><td>${fmtDateTime(guide.updatedAt)}</td>
    <td class="cell--actions"><div class="guide-actions"><button class="btn btn--primary btn--sm" data-present="${escAttr(guide.id)}">발표 시작</button><button class="btn btn--ghost btn--sm" data-edit="${escAttr(guide.id)}">수정</button><button class="btn btn--ghost btn--sm" data-delete="${escAttr(guide.id)}">삭제</button></div></td>
  </tr>`).join("")}</tbody></table></div></div>`;
  wrap.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openEditor(container, button.dataset.edit)));
  wrap.querySelectorAll("[data-present]").forEach((button) => button.addEventListener("click", () => {
    const guide = state.guides.find((item) => item.id === button.dataset.present);
    if (guide) router.push("slideshow", { materialId: guide.materialId, guideId: guide.id, presenter: "1" });
  }));
  wrap.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => confirmDelete(container, button.dataset.delete)));
}

async function openEditor(container, guideId = "") {
  cleanupPdf();
  container.innerHTML = '<div class="empty-state" style="padding:var(--space-16)">교안 편집기를 준비하는 중입니다.</div>';
  state.guide = guideId ? await getInstructorGuide(guideId) : emptyGuide();
  state.page = 1;
  renderEditor(container);
  if (state.guide.materialId) await loadGuidePdf(container, state.guide.materialId);
}

function emptyGuide() {
  return { id: "", title: "", materialId: "", trainingItemId: "", estimatedMinutes: 0, objectives: "", openingNotes: "", generalNotes: "", closingNotes: "", pageNotes: {} };
}

function renderEditor(container) {
  const guide = state.guide;
  container.innerHTML = `
    <div class="section-header"><div><div class="section-title">${guide.id ? "교안 수정" : "새 교안 작성"}</div><div class="section-subtitle">페이지별 메모는 슬라이드 발표자 화면에만 표시됩니다.</div></div><div class="guide-header-actions"><button class="btn btn--ghost" id="guide-back">목록</button><button class="btn btn--primary" id="guide-save">교안 저장</button></div></div>
    <div class="card guide-meta"><div class="card__body guide-meta__grid">
      ${field("교안 제목", `<input class="form-control" id="guide-title" maxlength="160" value="${escAttr(guide.title)}">`)}
      ${field("연결 PDF 교육자료", `<select class="form-control" id="guide-material"><option value="">선택</option>${state.materials.map((item) => `<option value="${escAttr(item.id)}" ${item.id === guide.materialId ? "selected" : ""}>${esc(item.title)} · ${esc(item.fileName)}</option>`).join("")}</select>`)}
      ${field("교육과정", `<input class="form-control" id="guide-training-item" maxlength="120" value="${escAttr(guide.trainingItemId)}" placeholder="예: 항공보안">`)}
      ${field("예상 교육시간(분)", `<input class="form-control" id="guide-minutes" type="number" min="0" max="1440" value="${Number(guide.estimatedMinutes || 0)}">`)}
      ${field("교육 목표", `<textarea class="form-control" id="guide-objectives" rows="3">${esc(guide.objectives)}</textarea>`, "guide-meta__wide")}
      ${field("교육 시작 멘트", `<textarea class="form-control" id="guide-opening" rows="3">${esc(guide.openingNotes)}</textarea>`, "guide-meta__wide")}
      ${field("전체 진행 참고사항", `<textarea class="form-control" id="guide-general" rows="4">${esc(guide.generalNotes)}</textarea>`, "guide-meta__wide")}
      ${field("마무리 멘트", `<textarea class="form-control" id="guide-closing" rows="3">${esc(guide.closingNotes)}</textarea>`, "guide-meta__wide")}
    </div></div>
    <div class="guide-editor" id="guide-editor">
      <aside class="guide-thumbnails"><div class="guide-pane-title">페이지 <span id="guide-page-total">-</span></div><div id="guide-thumb-list" class="guide-thumb-list"><div class="empty-state">PDF를 선택하세요.</div></div></aside>
      <section class="guide-preview"><div class="guide-pane-title">미리보기 <span id="guide-current-page"></span></div><div class="guide-preview__canvas"><canvas id="guide-preview-canvas"></canvas><div id="guide-preview-loading">PDF 교육자료를 선택하세요.</div></div></section>
      <aside class="guide-page-note"><div class="guide-pane-title">페이지별 교안</div><div id="guide-page-note-empty" class="empty-state">PDF 페이지를 선택하세요.</div><div id="guide-page-note-fields" class="hidden">
        <div class="guide-page-badge" id="guide-note-page"></div>
        ${field("설명 메모", '<textarea class="form-control" id="guide-page-note" rows="10" placeholder="이 페이지에서 설명할 내용을 입력하세요."></textarea>')}
        ${field("강조할 내용", '<textarea class="form-control" id="guide-page-emphasis" rows="4"></textarea>')}
        ${field("교육생 질문", '<textarea class="form-control" id="guide-page-question" rows="4"></textarea>')}
      </div></aside>
    </div>`;
  bindEditor(container);
}

function field(label, control, className = "") {
  return `<label class="form-field ${className}"><span>${label}</span>${control}</label>`;
}

function bindEditor(container) {
  container.querySelector("#guide-back")?.addEventListener("click", async () => {
    cleanupPdf();
    state.guides = await listInstructorGuides();
    renderGuideList(container);
  });
  container.querySelector("#guide-save")?.addEventListener("click", () => saveGuide(container));
  container.querySelector("#guide-material")?.addEventListener("change", async (event) => {
    state.guide.materialId = event.target.value;
    if (event.target.value) await loadGuidePdf(container, event.target.value);
    else cleanupPdfAndResetUi(container);
  });
  const noteBindings = [
    ["guide-page-note", "note"], ["guide-page-emphasis", "emphasis"], ["guide-page-question", "question"],
  ];
  noteBindings.forEach(([id, key]) => container.querySelector(`#${id}`)?.addEventListener("input", (event) => {
    const pageKey = String(state.page);
    state.guide.pageNotes ??= {};
    state.guide.pageNotes[pageKey] ??= {};
    state.guide.pageNotes[pageKey][key] = event.target.value;
  }));
}

async function loadGuidePdf(container, materialId) {
  cleanupPdf();
  const loading = container.querySelector("#guide-preview-loading");
  if (loading) loading.textContent = "PDF 페이지를 불러오는 중입니다.";
  try {
    pdfJsPromise ??= import(`${PDFJS_BASE}/build/pdf.mjs`).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/build/pdf.worker.mjs`;
      return pdfjs;
    });
    const [pdfjs, source] = await Promise.all([pdfJsPromise, requestMaterialSlideshowSource(materialId)]);
    state.loadingTask = pdfjs.getDocument({
      url: source.url, httpHeaders: source.httpHeaders, rangeChunkSize: 1024 * 1024,
      disableStream: true, disableAutoFetch: true,
      cMapUrl: `${PDFJS_BASE}/cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
    });
    state.pdf = await state.loadingTask.promise;
    state.pageCount = state.pdf.numPages;
    state.page = Math.min(Math.max(1, state.page), state.pageCount);
    buildThumbnails(container);
    await selectPage(container, state.page);
  } catch (error) {
    console.error("[lesson-plan] PDF load failed", error?.name, error?.message);
    if (loading) loading.textContent = "PDF를 불러오지 못했습니다. 자료 권한과 파일 상태를 확인하세요.";
    toast.error("PDF 교육자료를 불러오지 못했습니다.");
  }
}

function buildThumbnails(container) {
  const list = container.querySelector("#guide-thumb-list");
  container.querySelector("#guide-page-total").textContent = `/ ${state.pageCount}`;
  list.innerHTML = Array.from({ length: state.pageCount }, (_, index) => `<button type="button" class="guide-thumb ${index + 1 === state.page ? "is-active" : ""}" data-page="${index + 1}"><canvas width="92" height="120"></canvas><span>${index + 1}</span></button>`).join("");
  list.querySelectorAll(".guide-thumb").forEach((button) => button.addEventListener("click", () => selectPage(container, Number(button.dataset.page))));
  state.thumbObserver = new IntersectionObserver((entries, observer) => {
    entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
      observer.unobserve(entry.target);
      renderThumbnail(entry.target).catch(() => {});
    });
  }, { root: list, rootMargin: "160px" });
  list.querySelectorAll(".guide-thumb").forEach((button) => state.thumbObserver.observe(button));
}

async function renderThumbnail(button) {
  if (!state.pdf || button.dataset.rendered) return;
  button.dataset.rendered = "1";
  const page = await state.pdf.getPage(Number(button.dataset.page));
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 92 / base.width });
  const canvas = button.querySelector("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
}

async function selectPage(container, pageNumber) {
  if (!state.pdf) return;
  captureCurrentPageNotes(container);
  state.page = Math.min(state.pageCount, Math.max(1, pageNumber));
  container.querySelectorAll(".guide-thumb").forEach((button) => button.classList.toggle("is-active", Number(button.dataset.page) === state.page));
  container.querySelector("#guide-current-page").textContent = `${state.page} / ${state.pageCount}`;
  container.querySelector("#guide-note-page").textContent = `${state.page}페이지`;
  container.querySelector("#guide-page-note-empty").classList.add("hidden");
  container.querySelector("#guide-page-note-fields").classList.remove("hidden");
  const note = state.guide.pageNotes?.[String(state.page)] ?? {};
  container.querySelector("#guide-page-note").value = note.note ?? "";
  container.querySelector("#guide-page-emphasis").value = note.emphasis ?? "";
  container.querySelector("#guide-page-question").value = note.question ?? "";
  const loading = container.querySelector("#guide-preview-loading");
  loading.textContent = "페이지를 렌더링하는 중입니다.";
  loading.classList.remove("hidden");
  state.renderTask?.cancel?.();
  const page = await state.pdf.getPage(state.page);
  const base = page.getViewport({ scale: 1 });
  const host = container.querySelector(".guide-preview__canvas");
  const scale = Math.min(Math.max(300, host.clientWidth - 32) / base.width, 720 / base.height);
  const viewport = page.getViewport({ scale });
  const canvas = container.querySelector("#guide-preview-canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.ceil(viewport.width * dpr);
  canvas.height = Math.ceil(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  state.renderTask = page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
  try { await state.renderTask.promise; loading.classList.add("hidden"); } catch (error) { if (error?.name !== "RenderingCancelledException") loading.textContent = "페이지 렌더링에 실패했습니다."; }
}

function captureCurrentPageNotes(container) {
  if (!state.page || !state.guide) return;
  if (container.querySelector("#guide-page-note-fields")?.classList.contains("hidden")) return;
  state.guide.pageNotes ??= {};
  const pageKey = String(state.page);
  const note = {
    note: container.querySelector("#guide-page-note")?.value ?? "",
    emphasis: container.querySelector("#guide-page-emphasis")?.value ?? "",
    question: container.querySelector("#guide-page-question")?.value ?? "",
  };
  if (note.note || note.emphasis || note.question) {
    state.guide.pageNotes[pageKey] = {
      ...(state.guide.pageNotes[pageKey] ?? {}),
      ...note,
    };
  } else {
    delete state.guide.pageNotes[pageKey];
  }
}

async function saveGuide(container) {
  const button = container.querySelector("#guide-save");
  if (button.disabled) return;
  captureCurrentPageNotes(container);
  const materialId = container.querySelector("#guide-material").value;
  const payload = {
    ...state.guide,
    title: container.querySelector("#guide-title").value,
    materialId,
    trainingItemId: container.querySelector("#guide-training-item").value,
    estimatedMinutes: Number(container.querySelector("#guide-minutes").value || 0),
    objectives: container.querySelector("#guide-objectives").value,
    openingNotes: container.querySelector("#guide-opening").value,
    generalNotes: container.querySelector("#guide-general").value,
    closingNotes: container.querySelector("#guide-closing").value,
    pageNotes: state.guide.pageNotes ?? {},
  };
  if (!payload.title.trim() || !materialId) { toast.warning("교안 제목과 PDF 교육자료를 입력해 주세요."); return; }
  button.disabled = true;
  button.textContent = "저장 중...";
  try {
    const result = await saveInstructorGuide(payload);
    state.guide = result.guide;
    toast.success(result.message || "교안을 저장했습니다.");
    state.guides = await listInstructorGuides();
    renderGuideList(container);
  } catch (error) {
    console.error("[lesson-plan] save failed", error?.code, error?.message);
    toast.error(error?.message || "교안을 저장하지 못했습니다.");
    button.disabled = false;
    button.textContent = "교안 저장";
  }
}

function confirmDelete(container, guideId) {
  const guide = state.guides.find((item) => item.id === guideId);
  modal.open({ title: "개인 교안 삭제", body: `<p><strong>${esc(guide?.title || "교안")}</strong>을 삭제하시겠습니까?</p><p class="text-muted">삭제한 교안은 복구할 수 없습니다.</p>`, actions: [
    { label: "취소", variant: "ghost", onClick: () => modal.close() },
    { label: "삭제", variant: "danger", onClick: async () => {
      modal.setLoading("삭제", true);
      try { await deleteInstructorGuide(guideId); modal.close(); toast.success("교안을 삭제했습니다."); state.guides = await listInstructorGuides(); renderGuideList(container); }
      catch (error) { modal.setLoading("삭제", false); toast.error(error?.message || "교안을 삭제하지 못했습니다."); }
    } },
  ] });
}

function cleanupPdfAndResetUi(container) {
  cleanupPdf();
  container.querySelector("#guide-thumb-list").innerHTML = '<div class="empty-state">PDF를 선택하세요.</div>';
  container.querySelector("#guide-preview-loading").textContent = "PDF 교육자료를 선택하세요.";
}

function cleanupPdf() {
  state.thumbObserver?.disconnect();
  state.thumbObserver = null;
  state.renderTask?.cancel?.();
  state.renderTask = null;
  state.loadingTask?.destroy?.();
  state.loadingTask = null;
  state.pdf?.destroy?.();
  state.pdf = null;
  state.pageCount = 0;
}

function cleanupEditor() { cleanupPdf(); }

function renderError(container, message) {
  container.innerHTML = `<div class="empty-state" style="padding:var(--space-16)"><div class="empty-state__title">교안 화면을 열 수 없습니다.</div><div class="empty-state__desc">${esc(message)}</div></div>`;
}

function fmtDateTime(value) {
  const date = new Date(Number(value || 0));
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR");
}

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character])); }
function escAttr(value) { return esc(value); }
