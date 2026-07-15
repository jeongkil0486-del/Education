import { authStore, ROLES } from "../core/auth.js";
import { router } from "../core/router.js";
import { listMaterials, requestMaterialSlideshowSource } from "../services/material-service.js";
import { getInstructorGuide, saveInstructorGuide } from "../services/guide-service.js";
import { createPresenterSync } from "../modules/presenter-sync.js";
import { toast } from "../utils/toast.js";

const PDFJS_VERSION = "6.1.200";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
const PDFJS_MODULE = `${PDFJS_BASE}/build/pdf.mjs`;
const PDFJS_WORKER = `${PDFJS_BASE}/build/pdf.worker.mjs`;
const RANGE_CHUNK_SIZE = 1024 * 1024;
const MAX_PIXEL_RATIO = 1.5;
const COLORS = ["#facc15", "#ef4444", "#2563eb"];
const PEN_WIDTHS = [2, 4, 7];
const HIGHLIGHT_WIDTHS = [14, 24, 36];
const TEXT_SIZES = [18, 28, 40];

let closeActiveSlideshow = null;
let pdfJsModulePromise = null;
let pdfWorkerWarmPromise = null;

function preparePdfRuntime() {
  pdfJsModulePromise ??= import(PDFJS_MODULE).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return pdfjs;
  });
  pdfWorkerWarmPromise ??= fetch(PDFJS_WORKER, { cache: "force-cache", mode: "cors" })
    .then((response) => {
      if (!response.ok) throw new Error(`PDF Worker preload failed (${response.status})`);
      return response.arrayBuffer();
    })
    .then(() => undefined)
    .catch((error) => {
      console.warn("[slideshow] PDF Worker preload skipped", error?.message);
    });
  return Promise.all([pdfJsModulePromise, pdfWorkerWarmPromise]).then(([pdfjs]) => pdfjs);
}

function createPerformanceTracker(params) {
  const launchAt = Number(window.__slideshowLaunchAt) || performance.now();
  delete window.__slideshowLaunchAt;
  const enabled = params.perf === "1" || /(^localhost$|^127\.|\.vercel\.app$)/.test(window.location.hostname);
  const marks = { launch: launchAt };
  return {
    mark(name) { marks[name] = performance.now(); },
    report(sourceUrl) {
      if (!enabled) return;
      const resource = performance.getEntriesByName(sourceUrl)[0];
      const duration = (from, to) => marks[to] != null && marks[from] != null
        ? Math.round((marks[to] - marks[from]) * 10) / 10
        : null;
      console.info("[slideshow:perf] first-page", {
        pdfRuntimeMs: duration("runtimeStart", "pdfJsReady"),
        authTokenMs: duration("authStart", "authReady"),
        documentParseMs: duration("documentStart", "documentReady"),
        firstPageGetMs: duration("pageGetStart", "pageGetReady"),
        firstPageRenderMs: duration("pageRenderStart", "firstPageVisible"),
        streamFirstResponseMs: resource?.responseStart ? Math.round((resource.responseStart - resource.startTime) * 10) / 10 : null,
        totalVisibleMs: duration("launch", "firstPageVisible"),
      });
    },
  };
}

export async function render(container, params = {}) {
  closeActiveSlideshow?.(false);
  closeActiveSlideshow = null;
  if (![ROLES.INSTRUCTOR, ROLES.HQ_ADMIN].includes(authStore.role)) {
    renderError(container, "슬라이드쇼를 실행할 권한이 없습니다.");
    return;
  }

  const materialId = String(params.materialId ?? "").trim();
  const mode = params.audience === "1" ? "audience" : params.presenter === "1" ? "presenter" : "standard";
  const requestedSessionId = String(params.sessionId ?? "").trim();
  if (mode === "audience" && !/^[A-Za-z0-9_-]{8,100}$/.test(requestedSessionId)) {
    renderError(container, "올바른 발표 세션 정보가 없습니다.");
    return;
  }
  const sessionId = mode === "presenter"
    ? (/^[A-Za-z0-9_-]{8,100}$/.test(requestedSessionId) ? requestedSessionId : crypto.randomUUID())
    : requestedSessionId;
  const guideId = String(params.guideId ?? "").trim();
  const guideReady = mode === "presenter" && guideId
    ? getInstructorGuide(guideId).then((guide) => ({ guide, error: null })).catch((error) => {
      console.warn("[slideshow] guide unavailable", error?.code, error?.message);
      return { guide: null, error };
    })
    : Promise.resolve({ guide: null, error: null });
  const perf = createPerformanceTracker(params);
  perf.mark("runtimeStart");
  const pdfRuntimeReady = materialId
    ? preparePdfRuntime().then((pdfjs) => {
      perf.mark("pdfJsReady");
      return pdfjs;
    })
    : null;
  const slideshowSourceReady = materialId
    ? (perf.mark("authStart"), requestMaterialSlideshowSource(materialId).then((source) => {
      perf.mark("authReady");
      return source;
    }))
    : null;
  const slideshowStartupReady = materialId
    ? Promise.all([pdfRuntimeReady, slideshowSourceReady])
    : null;
  container.innerHTML = '<div class="empty-state" style="padding:var(--space-16)">교육자료를 확인하는 중입니다.</div>';
  try {
    const materials = await listMaterials({ maxAgeMs: 30_000 });
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
    await startSlideshow(container, material, { slideshowStartupReady, perf, mode, sessionId, guideReady });
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
    button.addEventListener("click", () => {
      window.__slideshowLaunchAt = performance.now();
      router.push("slideshow", { materialId: button.dataset.slideshowMaterial });
    });
  });
}

async function startSlideshow(container, material, runtime) {
  container.innerHTML = '<div class="empty-state" style="padding:var(--space-16)">슬라이드쇼를 준비하는 중입니다.</div>';
  const overlay = document.createElement("div");
  overlay.className = `pdf-slideshow pdf-slideshow--${runtime.mode}`;
  overlay.id = "pdf-slideshow-root";
  overlay.innerHTML = slideshowShell(material, runtime.mode);
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
    pageCache: new Map(),
    firstPageVisible: false,
    mode: runtime.mode,
    sessionId: runtime.sessionId,
    guide: null,
    guideLoadError: null,
    sync: null,
    pendingRemoteState: null,
    audienceWindow: null,
    pointerState: { x: 0, y: 0, visible: false },
    timerStartedAt: Date.now(),
    timerElapsedBeforePause: 0,
    timerRunning: true,
    timerInterval: null,
    heartbeatCleanup: null,
    nextRenderTask: null,
    guideFontScale: 1,
    guideCollapsed: false,
    destroyed: false,
  };

  let resizeTimer = null;
  let lastStageWidth = 0;
  let lastStageHeight = 0;
  const onResize = () => {
    const width = Math.round(stage.clientWidth);
    const height = Math.round(stage.clientHeight);
    if (!state.firstPageVisible || (width === lastStageWidth && height === lastStageHeight)) return;
    lastStageWidth = width;
    lastStageHeight = height;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.pdf && renderPage(), 120);
  };
  const resizeObserver = new ResizeObserver(onResize);

  const close = (navigate = true) => {
    if (state.destroyed) return;
    state.destroyed = true;
    state.renderTask?.cancel?.();
    state.nextRenderTask?.cancel?.();
    state.loadingTask?.destroy?.();
    state.pdf?.destroy?.();
    if (state.mode === "presenter") state.sync?.end();
    state.sync?.close();
    state.audienceWindow?.close?.();
    clearInterval(state.timerInterval);
    resizeObserver.disconnect();
    clearTimeout(resizeTimer);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    window.removeEventListener("hashchange", onHashChange);
    window.removeEventListener("beforeunload", onBeforeUnload);
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
  const onBeforeUnload = () => close(false);
  const onFullscreenChange = () => {
    overlay.classList.toggle("is-fullscreen", document.fullscreenElement === overlay);
    overlay.querySelectorAll('[data-action="fullscreen"]').forEach((button) => {
      button.textContent = document.fullscreenElement === overlay ? "전체화면 종료" : "전체화면";
    });
    onResize();
  };
  const onKeyDown = (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if (state.mode === "audience") {
      if (["f", "F"].includes(event.key)) { event.preventDefault(); toggleFullscreen(); }
      return;
    }
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
  window.addEventListener("beforeunload", onBeforeUnload);

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

  function getPdfPage(pageNumber) {
    if (!state.pageCache.has(pageNumber)) {
      state.pageCache.set(pageNumber, state.pdf.getPage(pageNumber).catch((error) => {
        state.pageCache.delete(pageNumber);
        throw error;
      }));
    }
    return state.pageCache.get(pageNumber);
  }

  function prepareNextPage() {
    const nextPage = state.page + 1;
    if (nextPage > state.pageCount || state.pageCache.has(nextPage) || state.destroyed) return;
    const prepare = () => {
      if (!state.destroyed) getPdfPage(nextPage).catch(() => {});
    };
    if ("requestIdleCallback" in window) window.requestIdleCallback(prepare, { timeout: 1200 });
    else setTimeout(prepare, 180);
  }

  async function renderPage() {
    if (!state.pdf || state.destroyed) return;
    const nonce = ++state.renderNonce;
    state.renderTask?.cancel?.();
    closeTextEditor();
    loading.classList.remove("hidden");
    const isFirstRender = !state.firstPageVisible;
    loading.innerHTML = `<div class="splash__spinner"></div><span>${isFirstRender ? "첫 페이지를 불러오는 중입니다." : "페이지를 불러오는 중입니다."}</span>`;
    try {
      if (isFirstRender) runtime.perf.mark("pageGetStart");
      const page = await getPdfPage(state.page);
      if (nonce !== state.renderNonce || state.destroyed) return;
      if (isFirstRender) runtime.perf.mark("pageGetReady");
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(240, stage.clientWidth - 28);
      const availableHeight = Math.max(180, stage.clientHeight - 28);
      const fitScale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
      const viewport = page.getViewport({ scale: fitScale * state.zoom });
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      for (const canvas of [pdfCanvas, annotationCanvas]) {
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
      }
      canvasStack.style.width = `${viewport.width}px`;
      canvasStack.style.height = `${viewport.height}px`;
      const context = pdfCanvas.getContext("2d", { alpha: false });
      loading.innerHTML = `<div class="splash__spinner"></div><span>${isFirstRender ? "첫 페이지를 렌더링하는 중입니다." : "페이지를 렌더링하는 중입니다."}</span>`;
      if (isFirstRender) runtime.perf.mark("pageRenderStart");
      state.renderTask = page.render({ canvasContext: context, viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
      await state.renderTask.promise;
      if (nonce !== state.renderNonce || state.destroyed) return;
      renderAnnotations();
      updateControls();
      loading.classList.add("hidden");
      if (isFirstRender) {
        state.firstPageVisible = true;
        lastStageWidth = Math.round(stage.clientWidth);
        lastStageHeight = Math.round(stage.clientHeight);
        resizeObserver.observe(stage);
        runtime.perf.mark("firstPageVisible");
        runtime.perf.report(runtime.sourceUrl);
        renderPresenterNextPreview();
      }
      state.sync?.sendState();
      prepareNextPage();
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
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
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
    state.sync?.sendAnnotations(state.page, pageAnnotations().items);
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
    updatePresenterGuide();
    renderPresenterNextPreview();
  }

  function setTool(tool) {
    closeTextEditor();
    state.tool = tool;
    annotationCanvas.dataset.tool = tool;
    pointer.classList.remove("is-visible", "is-pulsing");
    if (tool !== "pointer" && state.pointerState.visible) {
      state.pointerState = { ...state.pointerState, visible: false };
      state.sync?.sendPointer(state.pointerState);
    }
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
    state.pointerState = { x: point.x, y: point.y, visible: true };
    state.sync?.sendPointer(state.pointerState);
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

  function connectionLabel(status) {
    return ({
      waiting: "청중 화면 연결 대기",
      connected: "청중 화면 연결됨",
      disconnected: "청중 화면 연결 끊김 · 다시 열 수 있습니다",
      unsupported: "이 브라우저는 발표자 동기화를 지원하지 않습니다",
    })[status] || "연결 상태 확인 중";
  }

  function updateConnection(status) {
    const element = overlay.querySelector("#presenter-connection");
    if (!element) return;
    element.dataset.state = status;
    element.textContent = connectionLabel(status);
  }

  function applyRemotePointer(remotePointer) {
    if (state.mode !== "audience" || !remotePointer) return;
    const rect = annotationCanvas.getBoundingClientRect();
    if (!remotePointer.visible) {
      pointer.classList.remove("is-visible");
      return;
    }
    pointer.style.left = `${Number(remotePointer.x || 0) * rect.width}px`;
    pointer.style.top = `${Number(remotePointer.y || 0) * rect.height}px`;
    pointer.classList.add("is-visible");
  }

  async function applyRemoteState(remoteState) {
    if (state.mode !== "audience" || !remoteState) return;
    if (!state.pdf) {
      state.pendingRemoteState = remoteState;
      return;
    }
    const page = Math.min(state.pageCount, Math.max(1, Number(remoteState.pageNumber) || 1));
    state.page = page;
    state.zoom = Math.min(3, Math.max(0.5, Number(remoteState.zoom) || 1));
    pageAnnotations(page).items = Array.isArray(remoteState.annotations)
      ? structuredClone(remoteState.annotations)
      : [];
    await renderPage();
  }

  function applyRemoteAnnotations(pageNumber, annotations) {
    if (state.mode !== "audience") return;
    const page = Number(pageNumber);
    if (!Number.isInteger(page) || page < 1) return;
    pageAnnotations(page).items = Array.isArray(annotations) ? structuredClone(annotations) : [];
    if (page === state.page && state.pdf) renderAnnotations();
  }

  function syncSnapshot() {
    return {
      pageNumber: state.page,
      zoom: state.zoom,
      annotations: structuredClone(pageAnnotations().items),
      pointerMode: state.tool === "pointer",
    };
  }

  function openAudienceWindow() {
    if (state.mode !== "presenter") return;
    const params = new URLSearchParams({ materialId: material.id, audience: "1", sessionId: state.sessionId });
    const url = `${window.location.origin}${window.location.pathname}#/slideshow?${params.toString()}`;
    state.audienceWindow = window.open(url, `tas-presenter-${state.sessionId}`, "popup=yes,width=1280,height=800");
    if (!state.audienceWindow) {
      updateConnection("disconnected");
      toast.warning("팝업이 차단되었습니다. 브라우저에서 팝업을 허용한 뒤 다시 시도하세요.");
      return;
    }
    updateConnection("waiting");
    state.audienceWindow.focus();
    toast.info("청중용 발표 창을 빔프로젝터 화면으로 이동한 뒤 전체화면으로 전환하세요.");
  }

  function formatTimer(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    return `${hours}:${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function elapsedTimer() {
    return state.timerElapsedBeforePause + (state.timerRunning ? Date.now() - state.timerStartedAt : 0);
  }

  function renderTimer() {
    const element = overlay.querySelector("#presenter-timer");
    if (element) element.textContent = formatTimer(elapsedTimer());
  }

  function toggleTimer() {
    if (state.timerRunning) {
      state.timerElapsedBeforePause += Date.now() - state.timerStartedAt;
      state.timerRunning = false;
    } else {
      state.timerStartedAt = Date.now();
      state.timerRunning = true;
    }
    const button = overlay.querySelector('[data-action="timer-toggle"]');
    if (button) button.textContent = state.timerRunning ? "일시정지" : "계속";
    renderTimer();
  }

  function resetTimer() {
    state.timerElapsedBeforePause = 0;
    state.timerStartedAt = Date.now();
    state.timerRunning = true;
    const button = overlay.querySelector('[data-action="timer-toggle"]');
    if (button) button.textContent = "일시정지";
    renderTimer();
  }

  function adjustGuideFont(delta) {
    state.guideFontScale = Math.min(1.5, Math.max(0.85, state.guideFontScale + delta));
    const guidePanel = overlay.querySelector(".presenter-card--guide");
    if (guidePanel) guidePanel.style.setProperty("--guide-font-scale", String(state.guideFontScale));
  }

  function toggleGuidePanel() {
    state.guideCollapsed = !state.guideCollapsed;
    const guidePanel = overlay.querySelector(".presenter-card--guide");
    guidePanel?.classList.toggle("is-collapsed", state.guideCollapsed);
    const button = overlay.querySelector('[data-action="guide-toggle"]');
    if (button) button.textContent = state.guideCollapsed ? "펼치기" : "접기";
  }

  function currentGuideNote() {
    return state.guide?.pageNotes?.[String(state.page)] || {};
  }

  function updatePresenterGuide() {
    if (state.mode !== "presenter") return;
    const page = overlay.querySelector("#presenter-guide-page");
    if (page) page.textContent = `${state.page} / ${state.pageCount || "-"} 페이지`;
    const note = currentGuideNote();
    const status = overlay.querySelector("#presenter-guide-status");
    if (status) status.textContent = state.guide
      ? ""
      : state.guideLoadError
        ? "교안을 불러오지 못했습니다. 교안 목록에서 다시 발표를 시작하세요."
        : "연결된 교안이 없습니다. 교안 작성 메뉴에서 교안을 선택해 발표를 시작하세요.";
    const mappings = [
      ["#presenter-page-note", note.note],
      ["#presenter-page-emphasis", note.emphasis],
      ["#presenter-page-question", note.question],
      ["#presenter-general-note", state.guide?.generalNotes],
    ];
    mappings.forEach(([selector, value]) => {
      const element = overlay.querySelector(selector);
      if (element && element !== document.activeElement) element.value = value || "";
    });
    const saveButton = overlay.querySelector('[data-action="guide-quick-save"]');
    if (saveButton) saveButton.disabled = !state.guide;
  }

  async function savePresenterGuide() {
    if (!state.guide) {
      toast.warning("연결된 교안이 없습니다. 교안 작성 메뉴에서 먼저 교안을 연결하세요.");
      return;
    }
    const pageKey = String(state.page);
    state.guide.pageNotes ??= {};
    state.guide.pageNotes[pageKey] = {
      ...(state.guide.pageNotes[pageKey] || {}),
      note: overlay.querySelector("#presenter-page-note")?.value || "",
      emphasis: overlay.querySelector("#presenter-page-emphasis")?.value || "",
      question: overlay.querySelector("#presenter-page-question")?.value || "",
    };
    state.guide.generalNotes = overlay.querySelector("#presenter-general-note")?.value || "";
    const button = overlay.querySelector('[data-action="guide-quick-save"]');
    if (button) button.disabled = true;
    try {
      const result = await saveInstructorGuide(state.guide);
      state.guide = result.guide;
      toast.success("교안을 저장했습니다.");
    } catch (error) {
      console.error("[slideshow] guide quick save failed", error?.code, error?.message);
      toast.error(error?.message || "교안을 저장하지 못했습니다.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function renderPresenterNextPreview() {
    if (state.mode !== "presenter" || !state.pdf || !state.firstPageVisible) return;
    const canvas = overlay.querySelector("#presenter-next-canvas");
    const empty = overlay.querySelector("#presenter-next-empty");
    if (!canvas || !empty) return;
    state.nextRenderTask?.cancel?.();
    if (state.page >= state.pageCount) {
      canvas.classList.add("hidden");
      empty.classList.remove("hidden");
      empty.textContent = "마지막 페이지입니다.";
      return;
    }
    empty.classList.add("hidden");
    canvas.classList.remove("hidden");
    const targetPage = state.page + 1;
    const render = async () => {
      try {
        const page = await getPdfPage(targetPage);
        if (state.destroyed || targetPage !== state.page + 1) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(300 / base.width, 180 / base.height);
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        state.nextRenderTask = page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport });
        await state.nextRenderTask.promise;
      } catch (error) {
        if (error?.name !== "RenderingCancelledException") console.warn("[slideshow] next preview failed", error?.message);
      }
    };
    if ("requestIdleCallback" in window) window.requestIdleCallback(render, { timeout: 900 });
    else setTimeout(render, 120);
  }

  if (["presenter", "audience"].includes(state.mode)) {
    state.sync = createPresenterSync({
      mode: state.mode,
      sessionId: state.sessionId,
      getState: syncSnapshot,
      onState: applyRemoteState,
      onAnnotations: applyRemoteAnnotations,
      onPointer: applyRemotePointer,
      onConnection: updateConnection,
      onEnd: () => {
        if (state.mode !== "audience") return;
        loading.classList.remove("hidden");
        loading.innerHTML = '<div class="pdf-slideshow__error">발표가 종료되었습니다.<br><button class="pdf-slideshow__button" data-action="close">닫기</button></div>';
        loading.querySelector('[data-action="close"]')?.addEventListener("click", () => close(true));
      },
    });
  }

  if (state.mode === "presenter") {
    state.timerInterval = setInterval(renderTimer, 500);
    renderTimer();
    runtime.guideReady.then(({ guide, error }) => {
      if (state.destroyed) return;
      state.guide = guide;
      state.guideLoadError = error;
      updatePresenterGuide();
    });
  }

  if (state.mode === "audience") {
    let controlsTimer = null;
    const showAudienceControls = () => {
      overlay.classList.remove("is-controls-hidden");
      clearTimeout(controlsTimer);
      controlsTimer = setTimeout(() => overlay.classList.add("is-controls-hidden"), 2200);
    };
    overlay.addEventListener("pointermove", showAudienceControls);
    showAudienceControls();
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
    if (state.tool === "pointer") {
      pointer.classList.remove("is-visible");
      state.pointerState = { ...state.pointerState, visible: false };
      state.sync?.sendPointer(state.pointerState);
    }
  });

  overlay.querySelectorAll(".pdf-slideshow__toolbar [data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  overlay.querySelector('[data-action="previous"]').addEventListener("click", () => goPage(state.page - 1));
  overlay.querySelector('[data-action="next"]').addEventListener("click", () => goPage(state.page + 1));
  overlay.querySelector('[data-action="zoom-in"]').addEventListener("click", () => { state.zoom = Math.min(3, state.zoom + 0.25); renderPage(); });
  overlay.querySelector('[data-action="zoom-out"]').addEventListener("click", () => { state.zoom = Math.max(0.5, state.zoom - 0.25); renderPage(); });
  overlay.querySelector('[data-action="fit"]').addEventListener("click", () => { state.zoom = 1; renderPage(); });
  overlay.querySelectorAll('[data-action="fullscreen"]').forEach((button) => button.addEventListener("click", toggleFullscreen));
  overlay.querySelector('[data-action="presenter-mode"]')?.addEventListener("click", () => {
    window.__slideshowLaunchAt = performance.now();
    router.push("slideshow", { materialId: material.id, presenter: "1" });
  });
  overlay.querySelector('[data-action="open-audience"]')?.addEventListener("click", openAudienceWindow);
  overlay.querySelector('[data-action="timer-toggle"]')?.addEventListener("click", toggleTimer);
  overlay.querySelector('[data-action="timer-reset"]')?.addEventListener("click", resetTimer);
  overlay.querySelector('[data-action="guide-smaller"]')?.addEventListener("click", () => adjustGuideFont(-0.1));
  overlay.querySelector('[data-action="guide-larger"]')?.addEventListener("click", () => adjustGuideFont(0.1));
  overlay.querySelector('[data-action="guide-toggle"]')?.addEventListener("click", toggleGuidePanel);
  overlay.querySelector('[data-action="guide-quick-save"]')?.addEventListener("click", savePresenterGuide);
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
    const [pdfjs, source] = await runtime.slideshowStartupReady;
    if (state.destroyed) return;
    runtime.sourceUrl = source.url;
    loading.innerHTML = '<div class="splash__spinner"></div><span>PDF 문서를 분석하는 중입니다.</span>';
    runtime.perf.mark("documentStart");
    state.loadingTask = pdfjs.getDocument({
      url: source.url,
      httpHeaders: source.httpHeaders,
      rangeChunkSize: RANGE_CHUNK_SIZE,
      disableStream: true,
      disableAutoFetch: true,
      cMapUrl: `${PDFJS_BASE}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
    });
    state.pdf = await state.loadingTask.promise;
    runtime.perf.mark("documentReady");
    state.pageCount = state.pdf.numPages;
    setTool("pointer");
    await renderPage();
    if (state.mode === "audience" && state.pendingRemoteState) {
      const pending = state.pendingRemoteState;
      state.pendingRemoteState = null;
      await applyRemoteState(pending);
    }
    if (state.mode === "audience") state.sync?.requestState();
  } catch (error) {
    console.error("[slideshow] PDF load failed", error?.name, error?.message);
    loading.classList.remove("hidden");
    loading.innerHTML = `<div class="pdf-slideshow__error">${esc(slideshowErrorMessage(error))}<br><button class="pdf-slideshow__button" data-action="close">닫기</button></div>`;
    loading.querySelector('[data-action="close"]')?.addEventListener("click", () => close(true));
  }
}

function slideshowShell(material, mode = "standard") {
  const headerActions = mode === "presenter"
    ? '<div id="presenter-connection" class="presenter-connection" data-state="waiting">청중 화면 연결 대기</div><button type="button" class="pdf-slideshow__button" data-action="open-audience">청중 화면 열기</button><button type="button" class="pdf-slideshow__button" data-action="fullscreen">전체화면</button>'
    : mode === "audience"
      ? '<button type="button" class="pdf-slideshow__button" data-action="fullscreen">전체화면</button>'
      : '<div id="slideshow-status">임시 주석 · 종료 시 삭제</div><button type="button" class="pdf-slideshow__button" data-action="presenter-mode">발표자 보기</button><button type="button" class="pdf-slideshow__button" data-action="fullscreen">전체화면</button>';
  const presenterPanel = mode === "presenter" ? `
    <aside class="pdf-slideshow__presenter" aria-label="발표자 전용 정보">
      <section class="presenter-card presenter-card--timer">
        <div><span class="presenter-card__label">발표 시간</span><strong id="presenter-timer">00:00:00</strong></div>
        <div class="presenter-card__actions"><button type="button" data-action="timer-toggle">일시정지</button><button type="button" data-action="timer-reset">초기화</button></div>
      </section>
      <section class="presenter-card">
        <div class="presenter-card__title">다음 슬라이드</div>
        <div class="presenter-next"><canvas id="presenter-next-canvas"></canvas><div id="presenter-next-empty" class="hidden"></div></div>
      </section>
      <section class="presenter-card presenter-card--guide">
        <div class="presenter-card__title"><span>발표자 교안</span><span id="presenter-guide-page">1 / - 페이지</span></div>
        <div class="presenter-guide-controls"><button type="button" data-action="guide-smaller" aria-label="교안 글자 작게">A−</button><button type="button" data-action="guide-larger" aria-label="교안 글자 크게">A+</button><button type="button" data-action="guide-toggle">접기</button></div>
        <div class="presenter-guide-body">
          <div id="presenter-guide-status" class="presenter-guide-status">교안을 불러오는 중입니다.</div>
          <label>페이지 설명<textarea id="presenter-page-note" rows="5" placeholder="연결된 교안의 페이지 메모가 표시됩니다."></textarea></label>
          <label>강조 내용<textarea id="presenter-page-emphasis" rows="3"></textarea></label>
          <label>교육생 질문<textarea id="presenter-page-question" rows="3"></textarea></label>
          <label>전체 진행 참고사항<textarea id="presenter-general-note" rows="3"></textarea></label>
          <button type="button" class="pdf-slideshow__button" data-action="guide-quick-save" disabled>교안 저장</button>
        </div>
      </section>
    </aside>` : "";
  return `
    <header class="pdf-slideshow__header"><div><strong>${esc(material.title)}</strong><span>${esc(material.fileName)}</span></div>${headerActions}<button type="button" class="pdf-slideshow__button" data-action="close">종료</button></header>
    <main class="pdf-slideshow__stage" id="slideshow-stage">
      <div class="pdf-slideshow__canvas-stack" id="slideshow-canvas-stack">
        <canvas id="slideshow-pdf-canvas"></canvas>
        <canvas id="slideshow-annotation-canvas" data-tool="pointer"></canvas>
        <div class="pdf-slideshow__pointer" id="slideshow-pointer"></div>
      </div>
      <div class="pdf-slideshow__loading" id="slideshow-loading"><div class="splash__spinner"></div><span>PDF를 불러오는 중입니다.</span></div>
    </main>
    ${presenterPanel}
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
