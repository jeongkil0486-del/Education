import { authStore, ROLES } from "../core/auth.js";
import { router } from "../core/router.js";
import { listMaterials, requestMaterialSlideshowSource } from "../services/material-service.js";

const PDFJS_VERSION = "6.1.200";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
const PDFJS_MODULE = `${PDFJS_BASE}/build/pdf.mjs`;
const PDFJS_WORKER = `${PDFJS_BASE}/build/pdf.worker.mjs`;
const COLORS = ["#facc15", "#ef4444", "#2563eb"];
const PEN_WIDTHS = [2, 4, 7];
const HIGHLIGHT_WIDTHS = [14, 24, 36];
const TEXT_SIZES = [18, 28, 40];

let closeActiveSlideshow = null;

export async function render(container, params = {}) {
  closeActiveSlideshow?.(false);
  closeActiveSlideshow = null;
  if (![ROLES.INSTRUCTOR, ROLES.HQ_ADMIN].includes(authStore.role)) {
    renderError(container, "슬라이드쇼를 실행할 권한이 없습니다.");
    return;
  }

  const materialId = String(params.materialId ?? "").trim();
  container.innerHTML = '<div class="empty-state" style="padding:var(--space-16)">교육자료를 확인하는 중입니다.</div>';
  try {
    const materials = await listMaterials();
    const pdfMaterials = materials.filter(isSlideshowPdf);
    if (!materialId) {
      renderMaterialPicker(container, pdfMaterials);
      return;
    }
    const material = pdfMaterials.find((item) => item.id === materialId);
    if (!material) {
      renderError(container, "조회 권한이 없거나 슬라이드쇼로 실행할 수 없는 PDF 자료입니다.");
      return;
    }
    await startSlideshow(container, material);
  } catch (error) {
    console.error("[slideshow] initialization failed", error?.code, error?.message);
    renderError(container, slideshowErrorMessage(error));
  }
}

function isSlideshowPdf(material) {
  const fileName = String(material?.fileName ?? "").toLowerCase();
  const fileType = String(material?.fileType ?? "application/pdf").toLowerCase();
  return Boolean(material?.r2Key) && fileName.endsWith(".pdf") && fileType === "application/pdf";
}

function renderMaterialPicker(container, materials) {
  container.innerHTML = `
    <div class="section-header"><div><div class="section-title">슬라이드쇼</div><div class="section-subtitle">강의할 PDF 교육자료를 선택하세요.</div></div></div>
    <div class="card" style="margin-top:var(--space-5)"><div class="card__body" style="display:grid;gap:var(--space-3)">
      ${materials.length ? materials.map((item) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);padding:var(--space-4);border:1px solid var(--gray-200);border-radius:var(--radius-lg)"><div><div style="font-weight:var(--weight-semibold);color:var(--gray-900)">${esc(item.title)}</div><div style="font-size:var(--text-xs);color:var(--gray-500);margin-top:4px">${esc(item.fileName)}</div></div><button class="btn btn--primary" data-slideshow-material="${esc(item.id)}">슬라이드쇼</button></div>`).join("") : '<div class="empty-state">슬라이드쇼로 실행할 수 있는 PDF 자료가 없습니다.</div>'}
    </div></div>`;
  container.querySelectorAll("[data-slideshow-material]").forEach((button) => {
    button.addEventListener("click", () => router.push("slideshow", { materialId: button.dataset.slideshowMaterial }));
  });
}

async function startSlideshow(container, material) {
  container.innerHTML = '<div class="empty-state" style="padding:var(--space-16)">슬라이드쇼를 준비하는 중입니다.</div>';
  const overlay = document.createElement("div");
  overlay.className = "pdf-slideshow";
  overlay.id = "pdf-slideshow-root";
  overlay.innerHTML = slideshowShell(material);
  document.body.appendChild(overlay);
  document.body.classList.add("pdf-slideshow-open");

  const pdfCanvas = overlay.querySelector("#slideshow-pdf-canvas");
  const annotationCanvas = overlay.querySelector("#slideshow-annotation-canvas");
  const canvasStack = overlay.querySelector("#slideshow-canvas-stack");
  const stage = overlay.querySelector("#slideshow-stage");
  const pointer = overlay.querySelector("#slideshow-pointer");
  const loading = overlay.querySelector("#slideshow-loading");
  const state = {
    pdf: null,
    loadingTask: null,
    renderTask: null,
    renderNonce: 0,
    page: 1,
    pageCount: 0,
    zoom: 1,
    tool: "pointer",
    color: COLORS[0],
    sizeIndex: 1,
    textSizeIndex: 1,
    annotationsByPage: new Map(),
    drawing: false,
    erasing: false,
    eraseChanged: false,
    activeStroke: null,
    textEditor: null,
    destroyed: false,
  };

  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.pdf && renderPage(), 120);
  };
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(stage);

  const close = (navigate = true) => {
    if (state.destroyed) return;
    state.destroyed = true;
    state.renderTask?.cancel?.();
    state.loadingTask?.destroy?.();
    state.pdf?.destroy?.();
    resizeObserver.disconnect();
    clearTimeout(resizeTimer);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    window.removeEventListener("hashchange", onHashChange);
    if (document.fullscreenElement === overlay) document.exitFullscreen().catch(() => {});
    overlay.remove();
    document.body.classList.remove("pdf-slideshow-open");
    closeActiveSlideshow = null;
    if (navigate) router.push("materials");
  };
  closeActiveSlideshow = close;

  const onHashChange = () => {
    if (!window.location.hash.startsWith("#/slideshow")) close(false);
  };
  const onFullscreenChange = () => {
    overlay.classList.toggle("is-fullscreen", document.fullscreenElement === overlay);
    overlay.querySelector('[data-action="fullscreen"]').textContent = document.fullscreenElement === overlay ? "전체화면 종료" : "전체화면";
    onResize();
  };
  const onKeyDown = (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    const actions = {
      ArrowLeft: () => goPage(state.page - 1), PageUp: () => goPage(state.page - 1),
      ArrowRight: () => goPage(state.page + 1), PageDown: () => goPage(state.page + 1),
      " ": () => goPage(state.page + 1), Home: () => goPage(1), End: () => goPage(state.pageCount),
      f: toggleFullscreen, F: toggleFullscreen,
    };
    if (event.key === "Escape") {
      if (state.textEditor) closeTextEditor();
      else if (!document.fullscreenElement) setTool("pointer");
      return;
    }
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  window.addEventListener("hashchange", onHashChange);

  function pageAnnotations(pageNumber = state.page) {
    if (!state.annotationsByPage.has(pageNumber)) {
      state.annotationsByPage.set(pageNumber, { items: [], undo: [], redo: [] });
    }
    return state.annotationsByPage.get(pageNumber);
  }

  function snapshot() {
    const pageState = pageAnnotations();
    pageState.undo.push(structuredClone(pageState.items));
    if (pageState.undo.length > 60) pageState.undo.shift();
    pageState.redo = [];
  }

  function undo() {
    const pageState = pageAnnotations();
    if (!pageState.undo.length) return;
    pageState.redo.push(structuredClone(pageState.items));
    pageState.items = pageState.undo.pop();
    renderAnnotations();
    updateHistoryButtons();
  }

  function redo() {
    const pageState = pageAnnotations();
    if (!pageState.redo.length) return;
    pageState.undo.push(structuredClone(pageState.items));
    pageState.items = pageState.redo.pop();
    renderAnnotations();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const pageState = pageAnnotations();
    overlay.querySelector('[data-action="undo"]').disabled = !pageState.undo.length;
    overlay.querySelector('[data-action="redo"]').disabled = !pageState.redo.length;
  }

  async function renderPage() {
    if (!state.pdf || state.destroyed) return;
    const nonce = ++state.renderNonce;
    state.renderTask?.cancel?.();
    closeTextEditor();
    loading.classList.remove("hidden");
    loading.innerHTML = '<div class="splash__spinner"></div><span>페이지를 렌더링하는 중입니다.</span>';
    try {
      const page = await state.pdf.getPage(state.page);
      if (nonce !== state.renderNonce || state.destroyed) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(240, stage.clientWidth - 28);
      const availableHeight = Math.max(180, stage.clientHeight - 28);
      const fitScale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
      const viewport = page.getViewport({ scale: fitScale * state.zoom });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const canvas of [pdfCanvas, annotationCanvas]) {
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
      }
      canvasStack.style.width = `${viewport.width}px`;
      canvasStack.style.height = `${viewport.height}px`;
      const context = pdfCanvas.getContext("2d", { alpha: false });
      state.renderTask = page.render({ canvasContext: context, viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
      await state.renderTask.promise;
      if (nonce !== state.renderNonce || state.destroyed) return;
      renderAnnotations();
      updateControls();
      loading.classList.add("hidden");
    } catch (error) {
      if (error?.name === "RenderingCancelledException") return;
      console.error("[slideshow] page render failed", error?.name, error?.message);
      loading.classList.remove("hidden");
      loading.innerHTML = '<div class="pdf-slideshow__error">페이지를 렌더링하지 못했습니다.<br><button class="pdf-slideshow__button" data-retry-page>다시 시도</button></div>';
      loading.querySelector("[data-retry-page]")?.addEventListener("click", renderPage);
    }
  }

  function renderAnnotations() {
    const context = annotationCanvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = annotationCanvas.clientWidth;
    const height = annotationCanvas.clientHeight;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const item of pageAnnotations().items) {
      if (item.type === "text") {
        const fontSize = Math.max(10, item.fontSize * height);
        context.save();
        context.globalAlpha = 1;
        context.fillStyle = item.color;
        context.font = `600 ${fontSize}px sans-serif`;
        context.textBaseline = "top";
        String(item.text).split("\n").forEach((line, index) => context.fillText(line, item.x * width, item.y * height + index * fontSize * 1.25));
        context.restore();
        continue;
      }
      if (!item.points?.length) continue;
      context.save();
      context.strokeStyle = item.color;
      context.globalAlpha = item.type === "highlight" ? 0.3 : 1;
      context.lineWidth = Math.max(1, item.width * Math.min(width, height));
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      item.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (!index) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      if (item.points.length === 1) {
        const point = item.points[0];
        context.lineTo(point.x * width + 0.01, point.y * height + 0.01);
      }
      context.stroke();
      context.restore();
    }
  }

  function goPage(pageNumber) {
    if (!state.pdf) return;
    const next = Math.min(state.pageCount, Math.max(1, Number(pageNumber) || 1));
    if (next === state.page) return;
    state.page = next;
    renderPage();
  }

  function updateControls() {
    overlay.querySelector("#slideshow-page-input").value = String(state.page);
    overlay.querySelector("#slideshow-page-count").textContent = `/ ${state.pageCount}`;
    overlay.querySelector("#slideshow-zoom-label").textContent = `${Math.round(state.zoom * 100)}%`;
    overlay.querySelector('[data-action="previous"]').disabled = state.page <= 1;
    overlay.querySelector('[data-action="next"]').disabled = state.page >= state.pageCount;
    updateHistoryButtons();
  }

  function setTool(tool) {
    closeTextEditor();
    state.tool = tool;
    annotationCanvas.dataset.tool = tool;
    pointer.classList.remove("is-visible", "is-pulsing");
    overlay.querySelectorAll(".pdf-slideshow__toolbar [data-tool]").forEach((button) => button.classList.toggle("is-active", button.dataset.tool === tool));
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === overlay) document.exitFullscreen().catch(() => {});
    else overlay.requestFullscreen().catch(() => showTransientStatus("전체화면을 시작할 수 없습니다."));
  }

  function showTransientStatus(message) {
    const status = overlay.querySelector("#slideshow-status");
    status.textContent = message;
    setTimeout(() => { if (status.textContent === message) status.textContent = "임시 주석 · 종료 시 삭제"; }, 2500);
  }

  function normalizedPoint(event) {
    const rect = annotationCanvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      px: event.clientX - rect.left,
      py: event.clientY - rect.top,
      rect,
    };
  }

  function movePointer(point) {
    pointer.style.left = `${point.px}px`;
    pointer.style.top = `${point.py}px`;
    pointer.classList.add("is-visible");
  }

  function pulsePointer() {
    pointer.classList.remove("is-pulsing");
    void pointer.offsetWidth;
    pointer.classList.add("is-pulsing");
  }

  function selectedStrokeWidth(type, rect) {
    const values = type === "highlight" ? HIGHLIGHT_WIDTHS : PEN_WIDTHS;
    return values[state.sizeIndex] / Math.min(rect.width, rect.height);
  }

  function eraseAt(point) {
    const pageState = pageAnnotations();
    const threshold = 20 / Math.min(point.rect.width, point.rect.height);
    const before = pageState.items.length;
    pageState.items = pageState.items.filter((item) => !annotationHit(item, point, threshold, point.rect));
    if (pageState.items.length !== before) {
      state.eraseChanged = true;
      renderAnnotations();
    }
  }

  function annotationHit(item, point, threshold, rect) {
    if (item.type === "text") {
      const fontPx = item.fontSize * rect.height;
      const lines = String(item.text).split("\n");
      const width = Math.max(...lines.map((line) => line.length), 1) * fontPx * 0.65 / rect.width;
      const height = lines.length * fontPx * 1.25 / rect.height;
      return point.x >= item.x - threshold && point.x <= item.x + width + threshold && point.y >= item.y - threshold && point.y <= item.y + height + threshold;
    }
    return (item.points ?? []).some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= threshold);
  }

  function openTextEditor(point) {
    closeTextEditor();
    const editor = document.createElement("div");
    editor.className = "pdf-slideshow__text-editor";
    editor.style.left = `${Math.min(point.px, Math.max(0, point.rect.width - 280))}px`;
    editor.style.top = `${Math.min(point.py, Math.max(0, point.rect.height - 150))}px`;
    editor.innerHTML = '<textarea rows="3" placeholder="텍스트 입력 (Enter: 확인, Shift+Enter: 줄바꿈)"></textarea><div><button type="button" data-text-confirm>확인</button><button type="button" data-text-cancel>취소</button></div>';
    canvasStack.appendChild(editor);
    state.textEditor = editor;
    const textarea = editor.querySelector("textarea");
    const commit = () => {
      const text = textarea.value.trim();
      if (text) {
        snapshot();
        pageAnnotations().items.push({
          type: "text", text, x: point.x, y: point.y, color: state.color,
          fontSize: TEXT_SIZES[state.textSizeIndex] / point.rect.height,
        });
        renderAnnotations();
        updateHistoryButtons();
      }
      closeTextEditor();
    };
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commit(); }
      if (event.key === "Escape") { event.preventDefault(); closeTextEditor(); }
    });
    editor.querySelector("[data-text-confirm]").addEventListener("click", commit);
    editor.querySelector("[data-text-cancel]").addEventListener("click", closeTextEditor);
    textarea.focus();
  }

  function closeTextEditor() {
    state.textEditor?.remove();
    state.textEditor = null;
  }

  annotationCanvas.addEventListener("pointerdown", (event) => {
    if (!state.pdf) return;
    const point = normalizedPoint(event);
    if (state.tool === "pointer") {
      movePointer(point);
      pulsePointer();
      return;
    }
    if (state.tool === "text") {
      openTextEditor(point);
      return;
    }
    annotationCanvas.setPointerCapture?.(event.pointerId);
    if (["pen", "highlight"].includes(state.tool)) {
      snapshot();
      state.drawing = true;
      state.activeStroke = {
        type: state.tool,
        color: state.color,
        width: selectedStrokeWidth(state.tool, point.rect),
        points: [{ x: point.x, y: point.y }],
      };
      pageAnnotations().items.push(state.activeStroke);
      renderAnnotations();
    } else if (state.tool === "eraser") {
      snapshot();
      state.erasing = true;
      state.eraseChanged = false;
      eraseAt(point);
    }
    updateHistoryButtons();
  });

  annotationCanvas.addEventListener("pointermove", (event) => {
    const point = normalizedPoint(event);
    if (state.tool === "pointer") movePointer(point);
    if (state.drawing && state.activeStroke) {
      const last = state.activeStroke.points.at(-1);
      if (Math.hypot(last.x - point.x, last.y - point.y) > 0.0015) {
        state.activeStroke.points.push({ x: point.x, y: point.y });
        renderAnnotations();
      }
    }
    if (state.erasing) eraseAt(point);
  });

  const endPointerAction = (event) => {
    if (state.erasing && !state.eraseChanged) pageAnnotations().undo.pop();
    state.drawing = false;
    state.erasing = false;
    state.activeStroke = null;
    annotationCanvas.releasePointerCapture?.(event.pointerId);
    updateHistoryButtons();
  };
  annotationCanvas.addEventListener("pointerup", endPointerAction);
  annotationCanvas.addEventListener("pointercancel", endPointerAction);
  annotationCanvas.addEventListener("pointerleave", () => {
    if (state.tool === "pointer") pointer.classList.remove("is-visible");
  });

  overlay.querySelectorAll(".pdf-slideshow__toolbar [data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  overlay.querySelector('[data-action="previous"]').addEventListener("click", () => goPage(state.page - 1));
  overlay.querySelector('[data-action="next"]').addEventListener("click", () => goPage(state.page + 1));
  overlay.querySelector('[data-action="zoom-in"]').addEventListener("click", () => { state.zoom = Math.min(3, state.zoom + 0.25); renderPage(); });
  overlay.querySelector('[data-action="zoom-out"]').addEventListener("click", () => { state.zoom = Math.max(0.5, state.zoom - 0.25); renderPage(); });
  overlay.querySelector('[data-action="fit"]').addEventListener("click", () => { state.zoom = 1; renderPage(); });
  overlay.querySelector('[data-action="fullscreen"]').addEventListener("click", toggleFullscreen);
  overlay.querySelectorAll('[data-action="close"]').forEach((button) => button.addEventListener("click", () => close(true)));
  overlay.querySelector('[data-action="undo"]').addEventListener("click", undo);
  overlay.querySelector('[data-action="redo"]').addEventListener("click", redo);
  overlay.querySelector('[data-action="clear"]').addEventListener("click", () => {
    if (!pageAnnotations().items.length || !window.confirm("현재 페이지의 임시 주석을 모두 지우시겠습니까?")) return;
    snapshot();
    pageAnnotations().items = [];
    renderAnnotations();
    updateHistoryButtons();
  });
  overlay.querySelector("#slideshow-color").addEventListener("change", (event) => { state.color = event.target.value; });
  overlay.querySelector("#slideshow-size").addEventListener("change", (event) => { state.sizeIndex = Number(event.target.value); });
  overlay.querySelector("#slideshow-text-size").addEventListener("change", (event) => { state.textSizeIndex = Number(event.target.value); });
  overlay.querySelector("#slideshow-page-input").addEventListener("change", (event) => goPage(event.target.value));

  try {
    const [pdfjs, source] = await Promise.all([
      import(PDFJS_MODULE),
      requestMaterialSlideshowSource(material.id),
    ]);
    if (state.destroyed) return;
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    state.loadingTask = pdfjs.getDocument({
      url: source.url,
      httpHeaders: source.httpHeaders,
      rangeChunkSize: 65536,
      disableStream: true,
      disableAutoFetch: true,
      cMapUrl: `${PDFJS_BASE}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
    });
    state.pdf = await state.loadingTask.promise;
    state.pageCount = state.pdf.numPages;
    setTool("pointer");
    await renderPage();
  } catch (error) {
    console.error("[slideshow] PDF load failed", error?.name, error?.message);
    loading.classList.remove("hidden");
    loading.innerHTML = `<div class="pdf-slideshow__error">${esc(slideshowErrorMessage(error))}<br><button class="pdf-slideshow__button" data-action="close">닫기</button></div>`;
    loading.querySelector('[data-action="close"]')?.addEventListener("click", () => close(true));
  }
}

function slideshowShell(material) {
  return `
    <header class="pdf-slideshow__header"><div><strong>${esc(material.title)}</strong><span>${esc(material.fileName)}</span></div><div id="slideshow-status">임시 주석 · 종료 시 삭제</div><button type="button" class="pdf-slideshow__button" data-action="close">종료</button></header>
    <main class="pdf-slideshow__stage" id="slideshow-stage">
      <div class="pdf-slideshow__canvas-stack" id="slideshow-canvas-stack">
        <canvas id="slideshow-pdf-canvas"></canvas>
        <canvas id="slideshow-annotation-canvas" data-tool="pointer"></canvas>
        <div class="pdf-slideshow__pointer" id="slideshow-pointer"></div>
      </div>
      <div class="pdf-slideshow__loading" id="slideshow-loading"><div class="splash__spinner"></div><span>PDF를 불러오는 중입니다.</span></div>
    </main>
    <footer class="pdf-slideshow__toolbar">
      <div class="pdf-slideshow__tool-group"><button data-action="previous">이전</button><input id="slideshow-page-input" type="number" min="1" value="1" aria-label="페이지 이동"><span id="slideshow-page-count">/ -</span><button data-action="next">다음</button></div>
      <div class="pdf-slideshow__tool-group"><button data-tool="pointer">포인터</button><button data-tool="pen">펜</button><button data-tool="highlight">형광펜</button><button data-tool="text">텍스트</button><button data-tool="eraser">지우개</button></div>
      <div class="pdf-slideshow__tool-group"><label>색상<select id="slideshow-color">${COLORS.map((color, index) => `<option value="${color}">${["노랑", "빨강", "파랑"][index]}</option>`).join("")}</select></label><label>굵기<select id="slideshow-size"><option value="0">얇게</option><option value="1" selected>보통</option><option value="2">굵게</option></select></label><label>글자<select id="slideshow-text-size"><option value="0">작게</option><option value="1" selected>보통</option><option value="2">크게</option></select></label></div>
      <div class="pdf-slideshow__tool-group"><button data-action="undo" disabled>실행 취소</button><button data-action="redo" disabled>다시 실행</button><button data-action="clear">현재 페이지 지우기</button></div>
      <div class="pdf-slideshow__tool-group"><button data-action="zoom-out">축소</button><span id="slideshow-zoom-label">100%</span><button data-action="zoom-in">확대</button><button data-action="fit">화면 맞춤</button><button data-action="fullscreen">전체화면</button></div>
    </footer>`;
}

function slideshowErrorMessage(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  if (/permission-denied|403/.test(code + message)) return "이 교육자료를 슬라이드쇼로 열 권한이 없습니다.";
  if (/unauthenticated|401/.test(code + message)) return "로그인 인증이 만료되었습니다. 다시 로그인한 후 시도해 주세요.";
  if (/not-found|404/.test(code + message)) return "교육자료를 찾을 수 없습니다.";
  if (/InvalidPDF|PDF/.test(message) && /invalid|format/i.test(message)) return "올바른 PDF 파일이 아닙니다.";
  if (/UnexpectedResponse|response|fetch|network/i.test(message)) return "PDF를 불러오지 못했습니다. 인증 만료 또는 네트워크 상태를 확인해 주세요.";
  return message || "PDF 슬라이드쇼를 시작하지 못했습니다.";
}

function renderError(container, message) {
  container.innerHTML = `<div class="empty-state" style="padding:var(--space-16)"><div class="empty-state__title">슬라이드쇼를 시작할 수 없습니다.</div><div class="empty-state__desc">${esc(message)}</div><button class="btn btn--ghost" id="slideshow-back" style="margin-top:var(--space-4)">교육자료로 돌아가기</button></div>`;
  container.querySelector("#slideshow-back")?.addEventListener("click", () => router.push("materials"));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}
