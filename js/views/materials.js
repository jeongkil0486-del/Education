/**
 * materials.js — 교육자료 관리
 *
 * 접근 권한:
 *   HQ_ADMIN    — 목록·다운로드·업로드·삭제
 *   INSTRUCTOR  — 목록·다운로드
 *   SUPER_ADMIN — 목록·다운로드·삭제
 *
 * 업로드 흐름:
 *   1. createMaterialUploadUrl Function → presigned PUT URL
 *   2. 브라우저 XHR PUT → R2 직접 전송 (진행률 표시)
 *   3. 업로드 성공 → Firebase DB 메타 저장 (url = R2 공개 URL)
 *
 * 다운로드: url 필드가 있는 자료만 버튼 활성화
 */

import { modal }            from "../utils/modal.js";
import { toast }            from "../utils/toast.js";
import { authStore, ROLES } from "../core/auth.js";
import { router }           from "../core/router.js";
import {
  MATERIAL_TYPES,
  MATERIAL_TYPE_LABELS,
  ALLOWED_EXT,
  MAX_FILE_SIZE,
  formatFileSize,
  validateFile,
  listMaterials,
  requestMaterialDownloadUrl,
  deleteMaterial,
  uploadMaterial,
} from "../services/material-service.js";

/* ── 상태 ─────────────────────────────────────────────────── */
let state = { materials: [], loadError: null };

/* ── 권한 헬퍼 ────────────────────────────────────────────── */
const canUpload = () => authStore.role === ROLES.HQ_ADMIN;
const canDelete = () =>
  authStore.role === ROLES.HQ_ADMIN || authStore.role === ROLES.SUPER_ADMIN;
const canSlideshow = () => [ROLES.HQ_ADMIN, ROLES.INSTRUCTOR].includes(authStore.role);

/* ══════════════════════════════════════════════════════════
   진입점
══════════════════════════════════════════════════════════ */
export async function render(container) {
  try {
    container.innerHTML = buildSkeleton();
    bindStaticEvents(container);
    await loadData(container);
  } catch (err) {
    console.error("[materials] render failed", err?.code, err?.message, err);
    container.innerHTML = errorState(err);
  }
}

/* ══════════════════════════════════════════════════════════
   뼈대 HTML
══════════════════════════════════════════════════════════ */
function buildSkeleton() {
  return `
    <div class="section-header">
      <div>
        <div class="section-title">교육자료 관리</div>
        <div class="section-subtitle">PDF 교육자료를 등록·조회·다운로드합니다.</div>
      </div>
      ${canUpload() ? `
        <div>
          <button class="btn btn--primary" id="btn-upload-material">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                 style="margin-right:6px;vertical-align:middle">
              <path d="M8 2v8M4 6l4-4 4 4"
                    stroke="currentColor" stroke-width="1.5"
                    stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 12h12"
                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            PDF 업로드
          </button>
        </div>` : ""}
    </div>

    <!-- 필터 바 -->
    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card__body" style="padding:var(--space-4)">
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
          <div class="input-group" style="flex:2;min-width:200px">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input class="form-control" id="mat-search" type="search"
                   placeholder="자료명으로 검색" />
          </div>
          <select class="form-control" id="mat-filter-type" style="flex:1;min-width:130px">
            <option value="">전체 유형</option>
            ${MATERIAL_TYPES.map(t =>
              `<option value="${t}">${MATERIAL_TYPE_LABELS[t]}</option>`
            ).join("")}
          </select>
        </div>
      </div>
    </div>

    <!-- 목록 영역 -->
    <div id="materials-table-wrap">${spinner()}</div>
  `;
}

/* ══════════════════════════════════════════════════════════
   정적 이벤트
══════════════════════════════════════════════════════════ */
function bindStaticEvents(container) {
  container.querySelector("#btn-upload-material")
    ?.addEventListener("click", () => openUploadModal(container));
  container.querySelector("#mat-search")
    ?.addEventListener("input", () => renderTable(container));
  container.querySelector("#mat-filter-type")
    ?.addEventListener("change", () => renderTable(container));
}

/* ══════════════════════════════════════════════════════════
   데이터 로드
══════════════════════════════════════════════════════════ */
async function loadData(container) {
  try {
    state.materials = await listMaterials();
    state.loadError = null;
  } catch (err) {
    console.error("[materials] loadData failed", err?.code, err?.message, err);
    toast.error("교육자료를 불러오지 못했습니다.");
    state.materials = [];
    state.loadError = err;
  }
  renderTable(container);
}

/* ══════════════════════════════════════════════════════════
   목록 테이블
══════════════════════════════════════════════════════════ */
function renderTable(container) {
  const wrap = container.querySelector("#materials-table-wrap")
    ?? document.getElementById("materials-table-wrap");
  if (!wrap) return;

  const search = String(
    (container.querySelector("#mat-search")
      ?? document.getElementById("mat-search"))?.value ?? ""
  ).trim().toLowerCase();

  const typeFilter = String(
    (container.querySelector("#mat-filter-type")
      ?? document.getElementById("mat-filter-type"))?.value ?? ""
  );

  if (state.loadError) {
    wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-12)"><div class="empty-state__title">교육자료를 불러오지 못했습니다.</div><div class="empty-state__desc">${esc(state.loadError?.message || "잠시 후 다시 시도해 주세요.")}</div></div>`;
    return;
  }

  const filtered = state.materials.filter(m => {
    const matchSearch = !search     || String(m.title ?? "").toLowerCase().includes(search);
    const matchType   = !typeFilter || m.trainingType === typeFilter;
    return matchSearch && matchType;
  });

  if (!filtered.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" class="empty-state__icon">
          <rect x="8" y="4" width="24" height="32" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M20 4v8h12M12 18h16M12 23h10"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <div class="empty-state__title">등록된 교육자료가 없습니다.</div>
        ${canUpload()
          ? `<div class="empty-state__desc">PDF 업로드 버튼으로 자료를 추가하세요.</div>`
          : ""}
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>자료명</th>
          <th>교육 유형</th>
          <th>파일명</th>
          <th>크기</th>
          <th>업로드자</th>
          <th>등록일</th>
          <th style="width:250px"></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(m => `
          <tr>
            <td>
              <div style="font-weight:var(--weight-semibold);color:var(--gray-800)">
                ${esc(m.title)}
              </div>
              ${m.description
                ? `<div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:2px">
                     ${esc(m.description)}
                   </div>`
                : ""}
            </td>
            <td><span class="chip chip--info">${esc(m.typeLabel)}</span></td>
            <td class="cell--mono" style="font-size:var(--text-xs)">
              ${esc(m.fileName || "-")}
            </td>
            <td style="white-space:nowrap">
              ${m.fileSize ? esc(formatFileSize(m.fileSize)) : "-"}
            </td>
            <td>${esc(m.uploadedByName ?? "-")}</td>
            <td style="white-space:nowrap">${fmtDate(m.createdAt)}</td>
            <td class="cell--actions">
              <div style="display:flex;gap:4px;justify-content:flex-end;align-items:center">
                ${canSlideshow() && m.r2Key
                  ? `<button class="btn btn--primary btn--sm btn-mat-slideshow" data-id="${esc(m.id)}">슬라이드쇼</button>`
                  : ""}
                ${m.url || m.r2Key
                  ? `<button class="btn btn--ghost btn--sm btn-mat-download" data-id="${esc(m.id)}" title="다운로드">
                       <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                            style="margin-right:3px;vertical-align:middle">
                         <path d="M7 2v7M4 6l3 3 3-3"
                               stroke="currentColor" stroke-width="1.5"
                               stroke-linecap="round" stroke-linejoin="round"/>
                         <path d="M2 11h10"
                               stroke="currentColor" stroke-width="1.5"
                               stroke-linecap="round"/>
                       </svg>
                       다운로드
                     </button>`
                  : `<span style="font-size:var(--text-xs);color:var(--gray-300)">
                       파일 미등록
                     </span>`
                }
                ${canDelete()
                  ? `<button class="btn btn--ghost btn--sm btn-mat-delete"
                             data-id="${m.id}"
                             data-title="${escAttr(m.title)}"
                             style="color:var(--color-danger)">삭제</button>`
                  : ""}
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;

  wrap.querySelectorAll(".btn-mat-delete").forEach(btn => {
    btn.addEventListener("click", () =>
      confirmDelete(btn.dataset.id, btn.dataset.title, container)
    );
  });
  wrap.querySelectorAll(".btn-mat-slideshow").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.__slideshowLaunchAt = performance.now();
      router.push("slideshow", { materialId: btn.dataset.id });
    });
  });
  wrap.querySelectorAll(".btn-mat-download").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const url = await requestMaterialDownloadUrl(btn.dataset.id);
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (err) {
        console.error("[materials] download failed", err);
        toast.error(err?.message || "교육자료를 다운로드하지 못했습니다.");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

/* ══════════════════════════════════════════════════════════
   업로드 모달
══════════════════════════════════════════════════════════ */
function openUploadModal(container) {
  let selectedFile = null;

  modal.open({
    title: "교육자료 업로드",
    size:  "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">

        <div class="form-group">
          <label class="form-label form-label--required">자료명</label>
          <input class="form-control" id="mat-title" type="text"
                 placeholder="예) 신규입사자 초기교육 자료" maxlength="100" />
        </div>

        <div class="form-group">
          <label class="form-label form-label--required">교육 유형</label>
          <select class="form-control" id="mat-type">
            <option value="">선택하세요</option>
            ${MATERIAL_TYPES.map(t =>
              `<option value="${t}">${MATERIAL_TYPE_LABELS[t]}</option>`
            ).join("")}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">설명/비고</label>
          <textarea class="form-control" id="mat-desc" rows="2"
            placeholder="자료에 대한 간단한 설명을 입력하세요."
            maxlength="300" style="resize:vertical"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label form-label--required">PDF 파일</label>
          <div id="mat-dropzone" style="
            border:2px dashed var(--gray-200);
            border-radius:var(--radius-md);
            padding:var(--space-8);
            text-align:center;
            cursor:pointer;
            transition:border-color .15s, background .15s;
          ">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none"
                 style="color:var(--gray-300);margin:0 auto var(--space-2)">
              <path d="M16 4v14M8 10l8-6 8 6"
                    stroke="currentColor" stroke-width="1.5"
                    stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4 24h24"
                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <div id="mat-file-label"
                 style="font-size:var(--text-sm);color:var(--gray-400)">
              클릭하거나 PDF를 여기에 끌어다 놓으세요
            </div>
            <div style="font-size:var(--text-xs);color:var(--gray-300);margin-top:4px">
              PDF 전용 · 최대 ${formatFileSize(MAX_FILE_SIZE)}
            </div>
          </div>
          <input type="file" id="mat-file-input" accept="${ALLOWED_EXT}" style="display:none"/>
          <div id="mat-file-error"
               style="font-size:var(--text-xs);color:var(--color-danger);
                      margin-top:4px;display:none"></div>
        </div>

        <!-- 진행률 바 -->
        <div id="mat-progress-wrap" style="display:none">
          <div style="display:flex;justify-content:space-between;
                      font-size:var(--text-xs);color:var(--gray-500);
                      margin-bottom:4px">
            <span id="mat-progress-label">준비 중…</span>
            <span id="mat-progress-pct">0%</span>
          </div>
          <div style="height:6px;background:var(--gray-100);
                      border-radius:999px;overflow:hidden">
            <div id="mat-progress-bar"
                 style="height:100%;width:0%;
                        background:var(--brand-500);
                        border-radius:999px;
                        transition:width .25s ease"></div>
          </div>
        </div>

      </div>`,
    actions: [
      { label: "취소",    variant: "secondary", onClick: () => modal.close() },
      { label: "업로드", variant: "primary",
        onClick: () => handleUpload(container, () => selectedFile) },
    ],
  });

  /* 파일 드롭존 이벤트 */
  requestAnimationFrame(() => {
    const dropzone  = document.getElementById("mat-dropzone");
    const fileInput = document.getElementById("mat-file-input");
    const fileLabel = document.getElementById("mat-file-label");
    const fileError = document.getElementById("mat-file-error");
    if (!dropzone || !fileInput) return;

    const applyFile = (file) => {
      selectedFile = null;
      fileError.style.display = "none";
      const err = validateFile(file);
      if (err) {
        fileError.textContent   = err;
        fileError.style.display = "block";
        fileLabel.textContent   = "클릭하거나 PDF를 여기에 끌어다 놓으세요";
        dropzone.style.borderColor = "var(--color-danger)";
        dropzone.style.background  = "";
        return;
      }
      selectedFile = file;
      fileLabel.innerHTML = `
        <span style="color:var(--gray-700);font-weight:var(--weight-medium)">
          ${esc(file.name)}
        </span>
        <span style="color:var(--gray-400);margin-left:8px">
          ${formatFileSize(file.size)}
        </span>`;
      dropzone.style.borderColor = "var(--brand-400)";
      dropzone.style.background  = "var(--brand-50,#f0f7ff)";
    };

    dropzone.addEventListener("click",    () => fileInput.click());
    fileInput.addEventListener("change",  () => { if (fileInput.files[0]) applyFile(fileInput.files[0]); });
    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.style.borderColor = "var(--brand-400)"; });
    dropzone.addEventListener("dragleave",()  => { if (!selectedFile) dropzone.style.borderColor = "var(--gray-200)"; });
    dropzone.addEventListener("drop",     (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) applyFile(file);
    });
  });
}

/* ── 업로드 실행 ──────────────────────────────────────────── */
async function handleUpload(container, getFile) {
  const title = document.getElementById("mat-title")?.value?.trim();
  const type  = document.getElementById("mat-type")?.value;
  const desc  = document.getElementById("mat-desc")?.value ?? "";
  const file  = getFile();

  if (!title) { toast.error("자료명을 입력해 주세요."); return; }
  if (!type)  { toast.error("교육 유형을 선택해 주세요."); return; }
  if (!file)  { toast.error("PDF 파일을 선택해 주세요."); return; }

  const fileErr = validateFile(file);
  if (fileErr) { toast.error(fileErr); return; }

  /* 진행률 UI */
  modal.setLoading("업로드", true);
  const progressWrap = document.getElementById("mat-progress-wrap");
  const progressBar  = document.getElementById("mat-progress-bar");
  const progressPct  = document.getElementById("mat-progress-pct");
  const progressLbl  = document.getElementById("mat-progress-label");
  if (progressWrap) progressWrap.style.display = "block";

  const setProgress = (label, pct) => {
    if (progressLbl) progressLbl.textContent = label;
    if (progressBar) progressBar.style.width  = `${pct}%`;
    if (progressPct) progressPct.textContent  = `${pct}%`;
  };

  try {
    await uploadMaterial(
      { title, trainingType: type, description: desc },
      file,
      { onProgress: setProgress }
    );

    toast.success("교육자료가 업로드되었습니다.");
    setTimeout(() => { modal.close(); loadData(container); }, 400);

  } catch (err) {
    console.error("[materials] upload failed", { code: err?.code, message: err?.message }, err);

    let msg = err?.message ?? "업로드 중 오류가 발생했습니다.";
    if (err?.code === "functions/permission-denied")   msg = "업로드 권한이 없습니다.";
    if (err?.code === "functions/failed-precondition") msg = "R2 설정이 완료되지 않았습니다. 관리자에게 문의하세요.";
    if (err?.code?.startsWith("r2/"))                  msg = `R2 업로드 실패 (${err.code}). 잠시 후 다시 시도해 주세요.`;

    toast.error(msg);
    if (progressWrap) progressWrap.style.display = "none";
    modal.setLoading("업로드", false);
  }
}

/* ══════════════════════════════════════════════════════════
   삭제 확인
══════════════════════════════════════════════════════════ */
function confirmDelete(id, title, container) {
  modal.open({
    title: "교육자료 삭제",
    size:  "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600);line-height:1.7">
        <strong>${esc(title)}</strong> 자료를 삭제하시겠습니까?<br>
        <span style="color:var(--color-danger)">
          Firebase 메타 정보가 삭제됩니다.<br>
          R2에 저장된 실제 파일은 Cloudflare 대시보드에서 별도 삭제하세요.
        </span>
      </p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "삭제", variant: "danger", onClick: async () => {
        modal.setLoading("삭제", true);
        try {
          await deleteMaterial(id);
          toast.success("삭제되었습니다.");
          modal.close();
          await loadData(container);
        } catch (err) {
          console.error("[materials] delete failed", err?.code, err?.message, err);
          toast.error("삭제 중 오류가 발생했습니다.");
          modal.setLoading("삭제", false);
        }
      }},
    ],
  });
}

/* ══════════════════════════════════════════════════════════
   헬퍼
══════════════════════════════════════════════════════════ */
function spinner() {
  return `<div style="display:flex;align-items:center;justify-content:center;padding:var(--space-16)">
    <div class="splash__spinner"
         style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
  </div>`;
}

function errorState(err) {
  return `<div class="empty-state" style="padding:var(--space-16)">
    <div class="empty-state__title">페이지를 불러올 수 없습니다.</div>
    <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:var(--space-2)">
      ${esc(err?.message ?? "알 수 없는 오류")}
    </div>
  </div>`;
}

function fmtDate(ts) {
  if (!ts) return "-";
  return new Date(Number(ts)).toLocaleDateString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function esc(v)     { return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escAttr(v) { return esc(v).replace(/'/g,"&#39;"); }
