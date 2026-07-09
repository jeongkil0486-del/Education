/**
 * materials.js — 교육자료 관리
 *
 * 접근 권한:
 *   HQ_ADMIN   — 목록·다운로드·업로드(R2 연결 후)·삭제
 *   INSTRUCTOR — 목록·다운로드
 *   SUPER_ADMIN— 목록·다운로드·삭제
 *
 * 파일 저장: Cloudflare R2 (현재 미연결)
 *   → 업로드 버튼 클릭 시 "R2 업로드 API 연결 후 사용 가능" 안내
 *   → Firebase DB에 base64/DataURL 저장 없음
 *
 * 다운로드: url 필드가 있는 자료만 버튼 활성화
 */

import { modal }             from "../utils/modal.js";
import { toast }             from "../utils/toast.js";
import { authStore, ROLES }  from "../core/auth.js";
import {
  MATERIAL_TYPES,
  MATERIAL_TYPE_LABELS,
  ALLOWED_EXT,
  MAX_FILE_SIZE,
  formatFileSize,
  listMaterials,
  deleteMaterial,
  uploadMaterialFile,
  saveMaterialMeta,
  validateFile,
} from "../services/material-service.js";

/* ── 상태 ─────────────────────────────────────────────────── */
let state = { materials: [] };

/* ── 권한 헬퍼 ────────────────────────────────────────────── */
const canUpload = () => authStore.role === ROLES.HQ_ADMIN;
const canDelete = () =>
  authStore.role === ROLES.HQ_ADMIN || authStore.role === ROLES.SUPER_ADMIN;

/* ════════════════════════════════════════════════════════════
   진입점
════════════════════════════════════════════════════════════ */
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

/* ════════════════════════════════════════════════════════════
   뼈대 HTML
════════════════════════════════════════════════════════════ */
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
        </div>
      ` : ""}
    </div>

    <!-- R2 미연결 안내 배너 (HQ_ADMIN에게만 표시) -->
    ${canUpload() ? `
      <div id="r2-notice" style="
        display:flex;align-items:flex-start;gap:var(--space-3);
        padding:var(--space-4) var(--space-5);
        background:var(--yellow-50,#fffbeb);
        border:1px solid var(--yellow-200,#fde68a);
        border-radius:var(--radius-md);
        margin-bottom:var(--space-5);
        font-size:var(--text-sm);
        color:var(--yellow-800,#92400e);
      ">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"
             style="flex-shrink:0;margin-top:1px;color:var(--yellow-500,#f59e0b)">
          <path d="M9 2L1.5 15h15L9 2z"
                stroke="currentColor" stroke-width="1.5"
                stroke-linejoin="round"/>
          <path d="M9 7v4M9 13v.5"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <div>
          <strong>파일 업로드 기능 준비 중</strong><br>
          PDF 파일은 Cloudflare R2에 저장됩니다.
          R2 업로드 API가 연결되면 업로드 버튼이 활성화됩니다.<br>
          현재는 자료명·유형 등 메타 정보만 등록 가능합니다.
        </div>
      </div>
    ` : ""}

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

/* ════════════════════════════════════════════════════════════
   정적 이벤트 바인딩
════════════════════════════════════════════════════════════ */
function bindStaticEvents(container) {
  container.querySelector("#btn-upload-material")
    ?.addEventListener("click", () => openUploadModal(container));

  container.querySelector("#mat-search")
    ?.addEventListener("input", () => renderTable(container));

  container.querySelector("#mat-filter-type")
    ?.addEventListener("change", () => renderTable(container));
}

/* ════════════════════════════════════════════════════════════
   데이터 로드
════════════════════════════════════════════════════════════ */
async function loadData(container) {
  try {
    state.materials = await listMaterials();
  } catch (err) {
    console.error("[materials] loadData failed", err?.code, err?.message, err);
    toast.error("교육자료를 불러오지 못했습니다.");
    state.materials = [];
  }
  renderTable(container);
}

/* ════════════════════════════════════════════════════════════
   목록 테이블
════════════════════════════════════════════════════════════ */
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

  const filtered = state.materials.filter(m => {
    const matchSearch = !search    || String(m.title ?? "").toLowerCase().includes(search);
    const matchType   = !typeFilter || m.trainingType === typeFilter;
    return matchSearch && matchType;
  });

  if (!filtered.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" class="empty-state__icon">
          <rect x="8" y="4" width="24" height="32" rx="2"
                stroke="currentColor" stroke-width="1.5"/>
          <path d="M20 4v8h12M12 18h16M12 23h10"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <div class="empty-state__title">등록된 교육자료가 없습니다.</div>
        ${canUpload()
          ? `<div class="empty-state__desc">PDF 업로드 버튼으로 자료를 추가하세요.</div>`
          : ""}
      </div>
    `;
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
          <th style="width:130px"></th>
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
              ${esc(m.fileName ?? "-")}
            </td>
            <td style="white-space:nowrap">${esc(formatFileSize(m.fileSize))}</td>
            <td>${esc(m.uploadedByName ?? "-")}</td>
            <td style="white-space:nowrap">${fmtDate(m.createdAt)}</td>
            <td class="cell--actions">
              <div style="display:flex;gap:4px;justify-content:flex-end;align-items:center">
                ${m.url
                  /* url이 있을 때만 다운로드 버튼 활성화 */
                  ? `<a class="btn btn--ghost btn--sm"
                        href="${esc(m.url)}"
                        download="${esc(m.fileName ?? "download.pdf")}"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="다운로드">
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
                     </a>`
                  : `<span style="font-size:var(--text-xs);color:var(--gray-300);
                                  white-space:nowrap">파일 미등록</span>`
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
    </table>
  `;

  wrap.querySelectorAll(".btn-mat-delete").forEach(btn => {
    btn.addEventListener("click", () =>
      confirmDelete(btn.dataset.id, btn.dataset.title, container)
    );
  });
}

/* ════════════════════════════════════════════════════════════
   업로드 모달
   - R2 연결 전: 파일 선택 UI는 표시하되, 실제 저장 시 안내 메시지 출력
   - R2 연결 후: uploadMaterialFile → saveMaterialMeta 순서 호출
════════════════════════════════════════════════════════════ */
function openUploadModal(container) {
  let selectedFile = null;

  modal.open({
    title: "교육자료 등록",
    size:  "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">

        <!-- R2 미연결 안내 (모달 내부) -->
        <div style="
          display:flex;gap:var(--space-2);align-items:flex-start;
          padding:var(--space-3) var(--space-4);
          background:var(--yellow-50,#fffbeb);
          border:1px solid var(--yellow-200,#fde68a);
          border-radius:var(--radius-sm);
          font-size:var(--text-xs);
          color:var(--yellow-800,#92400e);
        ">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
               style="flex-shrink:0;margin-top:1px;color:var(--yellow-500,#f59e0b)">
            <path d="M7 1.5L1 12h12L7 1.5z"
                  stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M7 5.5v3M7 10v.5"
                  stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          <span>
            현재 R2 업로드 API가 연결되지 않아 <strong>파일 저장이 비활성화</strong>되어 있습니다.
            자료명·유형·설명은 저장 가능하며, 파일(PDF)은 R2 연결 후 업로드하세요.
          </span>
        </div>

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
          <label class="form-label">
            PDF 파일
            <span style="font-size:var(--text-xs);color:var(--gray-400);
                         font-weight:normal;margin-left:6px">(R2 연결 후 활성화)</span>
          </label>
          <!-- 드롭존: 시각적으로만 표시, 실제 저장은 R2 연결 후 -->
          <div id="mat-dropzone" style="
            border:2px dashed var(--gray-200);
            border-radius:var(--radius-md);
            padding:var(--space-8);
            text-align:center;
            cursor:pointer;
            transition:border-color .15s,background .15s;
            opacity:.7;
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
              PDF 전용 · 최대 ${formatFileSize(MAX_FILE_SIZE)} · R2 연결 후 실제 업로드
            </div>
          </div>
          <input type="file" id="mat-file-input" accept="${ALLOWED_EXT}" style="display:none" />
          <div id="mat-file-error"
               style="font-size:var(--text-xs);color:var(--color-danger);
                      margin-top:4px;display:none"></div>
        </div>

      </div>
    `,
    actions: [
      { label: "취소",    variant: "secondary", onClick: () => modal.close() },
      { label: "저장",   variant: "primary",   onClick: () => handleSave(container, selectedFile) },
    ],
  });

  /* 파일 선택 UI 이벤트 (선택만 가능, 실제 전송은 handleSave에서 차단) */
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
        return;
      }
      selectedFile = file;
      fileLabel.innerHTML = `
        <span style="color:var(--gray-700);font-weight:var(--weight-medium)">
          ${esc(file.name)}
        </span>
        <span style="color:var(--gray-400);margin-left:8px">
          ${formatFileSize(file.size)}
        </span>
        <div style="font-size:var(--text-xs);color:var(--yellow-600,#d97706);margin-top:4px">
          ※ R2 연결 후 실제로 저장됩니다
        </div>
      `;
      dropzone.style.borderColor = "var(--gray-300)";
      dropzone.style.background  = "var(--gray-50)";
    };

    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) applyFile(fileInput.files[0]);
    });
    dropzone.addEventListener("dragover", e => {
      e.preventDefault();
      dropzone.style.borderColor = "var(--gray-400)";
    });
    dropzone.addEventListener("dragleave", () => {
      if (!selectedFile) dropzone.style.borderColor = "var(--gray-200)";
    });
    dropzone.addEventListener("drop", e => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) applyFile(file);
    });
  });
}

/* ── 저장 핸들러 ──────────────────────────────────────────── */
async function handleSave(container, selectedFile) {
  const title = document.getElementById("mat-title")?.value?.trim();
  const type  = document.getElementById("mat-type")?.value;
  const desc  = document.getElementById("mat-desc")?.value ?? "";

  if (!title) { toast.error("자료명을 입력해 주세요."); return; }
  if (!type)  { toast.error("교육 유형을 선택해 주세요."); return; }

  /* ── 파일이 선택된 경우: R2 업로드 시도 ── */
  if (selectedFile) {
    const fileErr = validateFile(selectedFile);
    if (fileErr) { toast.error(fileErr); return; }

    modal.setLoading("저장", true);
    try {
      // uploadMaterialFile은 R2 미연결 시 R2_NOT_CONFIGURED 에러를 throw함
      const fileInfo = await uploadMaterialFile(selectedFile, "pending");
      await saveMaterialMeta({ title, trainingType: type, description: desc }, fileInfo);
      toast.success("교육자료가 등록되었습니다.");
      modal.close();
      await loadData(container);
    } catch (err) {
      if (err?.code === "R2_NOT_CONFIGURED") {
        // R2 미연결 안내 — 파일 없이 메타만 저장할지 묻기
        modal.setLoading("저장", false);
        _confirmMetaOnlyFallback(title, type, desc, container);
      } else {
        console.error("[materials] upload failed", err?.code, err?.message, err);
        toast.error(`업로드 실패: ${err?.message ?? "알 수 없는 오류"}`);
        modal.setLoading("저장", false);
      }
    }
    return;
  }

  /* ── 파일 선택 없음: 메타만 저장 ── */
  modal.setLoading("저장", true);
  try {
    await saveMaterialMeta(
      { title, trainingType: type, description: desc },
      { url: "", fileName: "", fileSize: 0, fileType: "" }
    );
    toast.success("자료 정보가 저장되었습니다. (파일은 R2 연결 후 업로드 가능)");
    modal.close();
    await loadData(container);
  } catch (err) {
    console.error("[materials] meta save failed", err?.code, err?.message, err);
    toast.error(`저장 실패: ${err?.message ?? "알 수 없는 오류"}`);
    modal.setLoading("저장", false);
  }
}

/* ── R2 미연결 시 메타만 저장 확인 다이얼로그 ─────────────── */
function _confirmMetaOnlyFallback(title, type, desc, container) {
  modal.open({
    title: "파일 업로드 불가",
    size:  "sm",
    body: `
      <div style="font-size:var(--text-sm);color:var(--gray-600);line-height:1.7">
        <p style="margin-bottom:var(--space-3)">
          <strong>R2 업로드 API가 연결되지 않아 PDF 파일을 저장할 수 없습니다.</strong>
        </p>
        <p>자료명·유형·설명 정보만 먼저 저장하시겠습니까?<br>
           파일은 R2 API 연결 후 별도로 업로드할 수 있습니다.</p>
      </div>
    `,
    actions: [
      { label: "취소",             variant: "secondary", onClick: () => modal.close() },
      { label: "정보만 저장",      variant: "primary",  onClick: async () => {
        modal.setLoading("정보만 저장", true);
        try {
          await saveMaterialMeta(
            { title, trainingType: type, description: desc },
            { url: "", fileName: "", fileSize: 0, fileType: "" }
          );
          toast.success("자료 정보가 저장되었습니다. (파일은 R2 연결 후 업로드 가능)");
          modal.close();
          await loadData(container);
        } catch (err2) {
          console.error("[materials] meta fallback failed", err2?.code, err2?.message, err2);
          toast.error(`저장 실패: ${err2?.message ?? "알 수 없는 오류"}`);
          modal.setLoading("정보만 저장", false);
        }
      }},
    ],
  });
}

/* ════════════════════════════════════════════════════════════
   삭제 확인
════════════════════════════════════════════════════════════ */
function confirmDelete(id, title, container) {
  modal.open({
    title: "교육자료 삭제",
    size:  "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600)">
        <strong>${esc(title)}</strong> 자료를 삭제하시겠습니까?<br>
        <span style="color:var(--color-danger)">
          이 작업은 되돌릴 수 없습니다.
          R2에 저장된 실제 파일은 별도 삭제가 필요할 수 있습니다.
        </span>
      </p>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "삭제", variant: "danger",    onClick: async () => {
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

/* ════════════════════════════════════════════════════════════
   헬퍼
════════════════════════════════════════════════════════════ */
function spinner() {
  return `
    <div style="display:flex;align-items:center;justify-content:center;
                padding:var(--space-16)">
      <div class="splash__spinner"
           style="border-color:var(--gray-200);
                  border-top-color:var(--brand-400)"></div>
    </div>
  `;
}

function errorState(err) {
  return `
    <div class="empty-state" style="padding:var(--space-16)">
      <div class="empty-state__title">페이지를 불러올 수 없습니다.</div>
      <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:var(--space-2)">
        ${esc(err?.message ?? "알 수 없는 오류")}
      </div>
    </div>
  `;
}

function fmtDate(ts) {
  if (!ts) return "-";
  return new Date(Number(ts)).toLocaleDateString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function esc(v)     { return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escAttr(v) { return esc(v).replace(/'/g,"&#39;"); }
