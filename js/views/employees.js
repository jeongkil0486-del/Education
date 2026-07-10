import { router } from "../core/router.js";
import { loadTrainingReferences, listManagedItems, TRAINING_SUBJECT_OPTIONS, TRAINING_TYPE_LABELS } from "../services/training-service.js";
import { bulkImportManualTrainingHistories } from "../core/admin-api.js";
import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { authStore, ROLES } from "../core/auth.js";

let viewState = { company: null, branches: [], employees: [] };
let pendingHistoryRows = [];
// 양식 다운로드 시 선택한 교육 항목 메타데이터
let selectedTemplateMeta = null;

export async function render(container) {
  const references = await loadTrainingReferences();
  viewState = {
    company: references.company ?? null,
    branches: [...(references.branches ?? [])].sort((a, b) => String(a.name ?? a.code ?? "").localeCompare(String(b.name ?? b.code ?? ""), "ko")),
    employees: [...(references.employees ?? [])].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko")),
  };

  const isHQAdmin = authStore.role === ROLES.HQ_ADMIN;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">직원 관리</div>
        <div class="section-subtitle">직원 조회와 개인 교육이력 일괄 등록을 관리합니다.</div>
      </div>
      <button class="btn btn--secondary" id="btn-open-history-cards">직원 교육 이력카드</button>
    </div>

    ${isHQAdmin ? `
    <!-- 개인 교육이력 일괄 등록 카드 (HQ_ADMIN 전용) -->
    <div class="card" style="margin-bottom:var(--space-5);border-left:4px solid var(--brand-400)">
      <div class="card__header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-2)">
        <div>
          <div class="card__title">개인 교육이력 일괄 등록</div>
          <div class="card__subtitle">교육 항목을 선택하여 양식을 다운로드하고, 날짜를 입력한 뒤 업로드하면 이력이 자동 등록됩니다.</div>
        </div>
        <button class="btn btn--secondary btn--sm" id="btn-history-template">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><path d="M8 2v8m0 0L5 7m3 3l3-3M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          양식 다운로드
        </button>
      </div>
      <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-4)">
        <!-- ① 파일 선택 -->
        <div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap">
          <label class="btn btn--secondary" style="cursor:pointer;margin:0">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><path d="M3 4h10M3 8h6M3 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="9" y="8" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M12 9.5v3M10.5 11h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            Excel 파일 선택
            <input type="file" id="history-upload-file-inline" accept=".xlsx,.xls,.csv" style="display:none"/>
          </label>
          <span id="history-upload-filename" style="font-size:var(--text-sm);color:var(--gray-500)">선택된 파일 없음</span>
        </div>

        <!-- ② 미리보기 + 검증 결과 -->
        <div id="history-upload-preview-inline">
          <div style="background:var(--gray-50);border:1px dashed var(--gray-300);border-radius:var(--radius-md);padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">
            교육 항목 양식의 Excel 파일을 선택하면 미리보기와 검증 결과가 표시됩니다.
          </div>
        </div>

        <!-- ③ 업로드 실행 버튼 + 결과 -->
        <div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap">
          <button class="btn btn--primary" id="btn-history-upload-submit" disabled>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><path d="M8 10V2m0 0L5 5m3-3l3 3M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            이력 업로드
          </button>
          <div id="history-upload-result" style="font-size:var(--text-sm);color:var(--gray-600)"></div>
        </div>
      </div>
    </div>
    ` : ""}

    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card__body card__body--compact">
        <div class="filter-bar" style="display:flex;gap:var(--space-3);flex-wrap:wrap">
          <div class="input-group filter-bar__search" style="flex:2;min-width:220px">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>
            <input class="form-control" id="employee-search" type="search" placeholder="이름, 사번, 지점으로 검색" />
          </div>
          <select class="form-control" id="employee-branch-filter" style="flex:1;min-width:180px">
            <option value="">전체 지점</option>
            ${viewState.branches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name ?? branch.code ?? branch.id)}</option>`).join("")}
          </select>
        </div>
        <div id="employee-summary" style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--gray-500)"></div>
      </div>
    </div>
    <div class="table-wrap" id="employee-table-wrap"></div>`;

  document.getElementById("btn-open-history-cards")?.addEventListener("click", () => router.push("history-cards"));

  if (isHQAdmin) {
    document.getElementById("btn-history-template")?.addEventListener("click", openTemplateSelectModal);
    document.getElementById("history-upload-file-inline")?.addEventListener("change", parseHistoryUploadFileInline);
    document.getElementById("btn-history-upload-submit")?.addEventListener("click", submitHistoryUploadInline);
  }

  document.getElementById("employee-search")?.addEventListener("input", () => renderTable(container));
  document.getElementById("employee-branch-filter")?.addEventListener("change", () => renderTable(container));
  renderTable(container);
}

function renderTable(container) {
  const wrap = container.querySelector("#employee-table-wrap");
  if (!wrap) return;
  const search = String(document.getElementById("employee-search")?.value ?? "").trim().toLowerCase();
  const branchId = document.getElementById("employee-branch-filter")?.value ?? "";
  const branch = viewState.branches.find((item) => item.id === branchId) ?? null;
  const filtered = viewState.employees.filter((employee) => {
    if (branch && !matchesSelectedBranch(employee, branch)) return false;
    if (!search) return true;
    return [employee.name, employee.empNo, employee.companyName, employee.branchName, employee.branchCode, employee.position].join(" ").toLowerCase().includes(search);
  });
  const summary = document.getElementById("employee-summary");
  if (summary) summary.textContent = `${viewState.company?.name ? `${viewState.company.name} · ` : ""}조회 결과 ${filtered.length}명`;
  if (!filtered.length) { wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-16)"><div class="empty-state__title">조건에 맞는 직원이 없습니다.</div></div>`; return; }
  wrap.innerHTML = `<table class="data-table"><thead><tr><th>이름</th><th>사번</th><th>회사</th><th>지점</th><th>직급</th><th style="width:180px"></th></tr></thead><tbody>
    ${filtered.map((employee) => { const uid=employee.id??employee.uid; return `<tr><td>${escapeHtml(employee.name??"-")}</td><td class="cell--mono">${escapeHtml(employee.empNo??"-")}</td><td>${escapeHtml(employee.companyName??"-")}</td><td>${escapeHtml(employee.branchName??employee.branchCode??"-")}</td><td>${escapeHtml(employee.position??"-")}</td><td class="cell--actions"><div style="display:flex;gap:var(--space-2);justify-content:flex-end"><button class="btn btn--ghost btn--sm btn-employee-history" data-uid="${uid}">이력카드</button><button class="btn btn--ghost btn--sm btn-employee-detail" data-uid="${uid}">상세</button></div></td></tr>`; }).join("")}
  </tbody></table>`;
  wrap.querySelectorAll(".btn-employee-history").forEach((button) => button.addEventListener("click", () => router.push("history-cards", { uid: button.dataset.uid })));
  wrap.querySelectorAll(".btn-employee-detail").forEach((button) => button.addEventListener("click", () => router.push("employee-detail", { uid: button.dataset.uid })));
}

/* ──────────────────────────────────────────────────────────
   XLSX 로더
────────────────────────────────────────────────────────── */
async function loadXlsx() { return import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"); }

/* ──────────────────────────────────────────────────────────
   교육 항목 선택 모달 → 양식 다운로드
────────────────────────────────────────────────────────── */
async function openTemplateSelectModal() {
  // 온라인/기타 기존 등록 항목 조회
  let registeredItems = [];
  try {
    registeredItems = await listManagedItems();
  } catch (e) {
    console.warn("[employees] listManagedItems 조회 실패", e);
  }

  const onlineItems = registeredItems.filter((i) => i.trainingType === "online");
  const otherItems  = registeredItems.filter((i) => i.trainingType === "other");

  const currentYear = new Date().getFullYear();
  const prevYear    = currentYear - 1;

  modal.open({
    title: "교육 항목 선택 — 양식 다운로드",
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="background:var(--blue-50,#eff6ff);border:1px solid var(--blue-200,#bfdbfe);border-radius:var(--radius-md);padding:var(--space-3);font-size:var(--text-sm);color:var(--blue-800,#1e40af)">
          선택한 교육 항목 전용 양식을 다운로드합니다.<br/>
          직원 기본정보는 현재 지점 필터에 따라 자동으로 채워집니다. (기준연도: ${currentYear}년)
        </div>

        <div class="form-group">
          <label class="form-label form-label--required">교육유형</label>
          <select class="form-control" id="tpl-training-type">
            <option value="">선택하세요</option>
            <option value="job">직무교육</option>
            <option value="legal">법정교육</option>
            <option value="online">온라인교육</option>
            <option value="other">기타</option>
          </select>
        </div>

        <!-- 직무교육 세부분류 -->
        <div class="form-group" id="tpl-job-subjects" style="display:none">
          <label class="form-label form-label--required">교육 세부분류</label>
          <select class="form-control" id="tpl-job-subject">
            <option value="">선택하세요</option>
            ${(TRAINING_SUBJECT_OPTIONS.job ?? []).map((s) => `<option value="${s.code}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </div>

        <!-- 법정교육 세부분류 -->
        <div class="form-group" id="tpl-legal-subjects" style="display:none">
          <label class="form-label form-label--required">교육 세부분류</label>
          <select class="form-control" id="tpl-legal-subject">
            <option value="">선택하세요</option>
            ${(TRAINING_SUBJECT_OPTIONS.legal ?? []).map((s) => `<option value="${s.code}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </div>

        <!-- 온라인교육 세부분류 -->
        <div class="form-group" id="tpl-online-subjects" style="display:none">
          <label class="form-label form-label--required">교육 세부분류</label>
          ${onlineItems.length ? `
          <select class="form-control" id="tpl-online-subject-select">
            <option value="">기존 항목 선택 또는 직접 입력</option>
            ${onlineItems.map((i) => `<option value="${escapeHtml(i.subjectCode||i.id)}" data-name="${escapeHtml(i.subjectName||i.title)}">${escapeHtml(i.subjectName||i.title)}</option>`).join("")}
          </select>
          <div style="margin-top:var(--space-2);font-size:var(--text-xs);color:var(--gray-400)">또는 직접 입력:</div>` : ""}
          <input class="form-control" id="tpl-online-subject-input" placeholder="교육 항목명 직접 입력" style="margin-top:var(--space-1)"/>
        </div>

        <!-- 기타 세부분류 -->
        <div class="form-group" id="tpl-other-subjects" style="display:none">
          <label class="form-label form-label--required">교육 세부분류</label>
          ${otherItems.length ? `
          <select class="form-control" id="tpl-other-subject-select">
            <option value="">기존 항목 선택 또는 직접 입력</option>
            ${otherItems.map((i) => `<option value="${escapeHtml(i.subjectCode||i.id)}" data-name="${escapeHtml(i.subjectName||i.title)}">${escapeHtml(i.subjectName||i.title)}</option>`).join("")}
          </select>
          <div style="margin-top:var(--space-2);font-size:var(--text-xs);color:var(--gray-400)">또는 직접 입력:</div>` : ""}
          <input class="form-control" id="tpl-other-subject-input" placeholder="교육 항목명 직접 입력" style="margin-top:var(--space-1)"/>
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "선택 항목 양식 다운로드",
        variant: "primary",
        onClick: async () => {
          const trainingType = document.getElementById("tpl-training-type")?.value;
          if (!trainingType) { toast.warning("교육유형을 선택해 주세요."); return; }

          let subjectCode = "";
          let subjectName = "";

          if (trainingType === "job") {
            const sel = document.getElementById("tpl-job-subject");
            subjectCode = sel?.value ?? "";
            subjectName = sel?.options[sel.selectedIndex]?.dataset?.name ?? "";
            if (!subjectCode) { toast.warning("교육 세부분류를 선택해 주세요."); return; }
          } else if (trainingType === "legal") {
            const sel = document.getElementById("tpl-legal-subject");
            subjectCode = sel?.value ?? "";
            subjectName = sel?.options[sel.selectedIndex]?.dataset?.name ?? "";
            if (!subjectCode) { toast.warning("교육 세부분류를 선택해 주세요."); return; }
          } else if (trainingType === "online") {
            const sel = document.getElementById("tpl-online-subject-select");
            const inp = document.getElementById("tpl-online-subject-input");
            if (inp?.value?.trim()) {
              subjectName = inp.value.trim();
              subjectCode = "online_custom";
            } else if (sel?.value) {
              subjectCode = sel.value;
              subjectName = sel?.options[sel.selectedIndex]?.dataset?.name ?? sel.value;
            }
            if (!subjectName) { toast.warning("교육 세부분류를 선택하거나 입력해 주세요."); return; }
          } else if (trainingType === "other") {
            const sel = document.getElementById("tpl-other-subject-select");
            const inp = document.getElementById("tpl-other-subject-input");
            if (inp?.value?.trim()) {
              subjectName = inp.value.trim();
              subjectCode = "other_custom";
            } else if (sel?.value) {
              subjectCode = sel.value;
              subjectName = sel?.options[sel.selectedIndex]?.dataset?.name ?? sel.value;
            }
            if (!subjectName) { toast.warning("교육 세부분류를 선택하거나 입력해 주세요."); return; }
          }

          modal.setLoading("선택 항목 양식 다운로드", true);
          try {
            await downloadTypedTemplate({ trainingType, subjectCode, subjectName });
            modal.close();
          } catch (err) {
            console.error("[employees] template download error", err);
            toast.error("양식을 만들지 못했습니다.");
            modal.setLoading("선택 항목 양식 다운로드", false);
          }
        },
      },
    ],
  });

  // 교육유형 변경 시 세부분류 영역 토글
  document.getElementById("tpl-training-type")?.addEventListener("change", (e) => {
    const type = e.target.value;
    ["job", "legal", "online", "other"].forEach((t) => {
      const el = document.getElementById(`tpl-${t}-subjects`);
      if (el) el.style.display = type === t ? "block" : "none";
    });
  });

  // 온라인/기타 셀렉트 선택 시 직접 입력 초기화
  document.getElementById("tpl-online-subject-select")?.addEventListener("change", (e) => {
    if (e.target.value) document.getElementById("tpl-online-subject-input").value = "";
  });
  document.getElementById("tpl-other-subject-select")?.addEventListener("change", (e) => {
    if (e.target.value) document.getElementById("tpl-other-subject-input").value = "";
  });
}

/* ──────────────────────────────────────────────────────────
   교육 항목 전용 Excel 양식 생성 + 다운로드
────────────────────────────────────────────────────────── */
async function downloadTypedTemplate({ trainingType, subjectCode, subjectName }) {
  const XLSX = await loadXlsx();
  const currentYear = new Date().getFullYear();
  const prevYear    = currentYear - 1;

  // 현재 지점 필터 적용
  const branchId = document.getElementById("employee-branch-filter")?.value ?? "";
  const branch = viewState.branches.find((b) => b.id === branchId) ?? null;
  const targetEmployees = viewState.employees.filter((emp) => {
    if (branch) return matchesSelectedBranch(emp, branch);
    return true;
  });

  const typeLabel = TRAINING_TYPE_LABELS[trainingType] ?? trainingType;
  const wb = XLSX.utils.book_new();

  // ── _meta 숨김 시트
  const meta = {
    trainingType,
    subjectCode,
    subjectName,
    typeLabel,
    currentYear,
    previousYear: prevYear,
    templateVersion: 1,
    generatedAt: Date.now(),
  };
  const metaWs = XLSX.utils.aoa_to_sheet([
    ["trainingType",   trainingType],
    ["subjectCode",    subjectCode],
    ["subjectName",    subjectName],
    ["typeLabel",      typeLabel],
    ["currentYear",    currentYear],
    ["previousYear",   prevYear],
    ["templateVersion", 1],
    ["generatedAt",    Date.now()],
  ]);
  XLSX.utils.book_append_sheet(wb, metaWs, "_meta");

  // ── 안내 문구 (1~3행)
  const infoRows = [
    [`[${typeLabel} — ${subjectName}] 개인 교육이력 등록 양식`],
    [`기준연도: ${currentYear}년 (전년도: ${prevYear}년 / 금년도: ${currentYear}년)`],
    ["※ 성명·사번은 수정하지 마세요. 날짜는 YYYY-MM-DD 형식으로 입력하세요. 동일 연도 복수 날짜는 쉼표로 구분: 2026-01-15, 2026-07-20"],
    [], // 빈 행
    // 헤더
    ["성명", "사번", "입사일", "직급/직책", "초기교육", "최종교육일", `${prevYear}년`, `${currentYear}년`, "비고"],
  ];

  // 직원 데이터 행
  const dataRows = targetEmployees.map((emp) => [
    emp.name ?? "",
    emp.empNo ?? "",
    emp.joinDate ? formatDateYMD(emp.joinDate) : "",
    emp.position ?? "",
    "", // 초기교육 (입력)
    "", // 최종교육일 (입력)
    "", // 전년도 (입력)
    "", // 금년도 (입력)
    "", // 비고
  ]);

  const allRows = [...infoRows, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 20 },
  ];
  // 안내 행 보호: 1~4행 (sheetProtect은 클라이언트 XLSX에서 제한적이므로 스타일만)

  XLSX.utils.book_append_sheet(wb, ws, "개인교육이력");

  const safeSubject = subjectName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  XLSX.writeFile(wb, `${currentYear}_${typeLabel}_${safeSubject}_이력양식.xlsx`);
}

function formatDateYMD(millis) {
  if (!millis) return "";
  const d = new Date(Number(millis));
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

/* ──────────────────────────────────────────────────────────
   인라인 Excel 업로드 — 파싱 + 검증
────────────────────────────────────────────────────────── */
async function parseHistoryUploadFileInline(event) {
  const file      = event.target.files?.[0];
  const filenameEl = document.getElementById("history-upload-filename");
  const previewEl  = document.getElementById("history-upload-preview-inline");
  const submitBtn  = document.getElementById("btn-history-upload-submit");
  const resultEl   = document.getElementById("history-upload-result");

  if (filenameEl) filenameEl.textContent = file ? file.name : "선택된 파일 없음";
  if (resultEl)   resultEl.textContent = "";
  if (submitBtn)  submitBtn.disabled = true;
  pendingHistoryRows = [];
  selectedTemplateMeta = null;

  if (!file || !previewEl) return;
  previewEl.innerHTML = `<div style="padding:var(--space-4);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">파일을 분석하는 중...</div>`;

  try {
    const XLSX = await loadXlsx();
    const wb   = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });

    // ── 1) _meta 시트 읽기
    const metaSheet = wb.Sheets["_meta"];
    if (!metaSheet) {
      previewEl.innerHTML = `<div style="color:var(--color-danger,#dc2626);padding:var(--space-4);font-size:var(--text-sm);border:1px solid #fecaca;border-radius:var(--radius-md);background:#fff1f2">지원하지 않는 양식입니다. 교육 항목을 선택하여 새 양식을 다운로드해 주세요.</div>`;
      return;
    }
    const metaRows = XLSX.utils.sheet_to_json(metaSheet, { header: 1, defval: "" });
    const metaMap  = {};
    metaRows.forEach(([k, v]) => { if (k) metaMap[k] = v; });

    const { trainingType, subjectCode, subjectName, typeLabel, currentYear, previousYear, templateVersion } = metaMap;
    if (!trainingType || !currentYear) {
      previewEl.innerHTML = `<div style="color:var(--color-danger,#dc2626);padding:var(--space-4);font-size:var(--text-sm);border:1px solid #fecaca;border-radius:var(--radius-md);background:#fff1f2">양식 메타데이터가 손상되었습니다. 새 양식을 다운로드해 주세요.</div>`;
      return;
    }

    selectedTemplateMeta = { trainingType, subjectCode, subjectName, typeLabel, currentYear: Number(currentYear), previousYear: Number(previousYear), templateVersion };

    // ── 2) 개인교육이력 시트 읽기
    const dataSheet = wb.Sheets[wb.SheetNames.find((n) => n !== "_meta") ?? wb.SheetNames[0]];
    const allRows   = XLSX.utils.sheet_to_json(dataSheet, { header: 1, defval: "" });

    // ★ 헤더 행 탐지: '성명'과 '사번'이 동시에 존재하는 행만 헤더로 판단
    //   (안내문에 '성명' 글자가 포함되어 있어 단순 includes로는 오탐됨)
    const normCell = (v) => String(v ?? "").trim();
    let headerRowIdx = allRows.findIndex((r) => {
      const cells = r.map(normCell);
      return cells.includes("성명") && cells.includes("사번");
    });
    if (headerRowIdx < 0) headerRowIdx = 4; // fallback

    const headers = allRows[headerRowIdx].map(normCell);

    // ★ 헤더명 기반 컬럼 인덱스 맵 — 고정 인덱스 사용 금지
    const col = {
      name:     headers.indexOf("성명"),
      empNo:    headers.indexOf("사번"),
      joinDate: headers.indexOf("입사일"),
      position: headers.findIndex((h) => h.includes("직급") || h.includes("직책")),
      initial:  headers.findIndex((h) => h.includes("초기")),
      lastDate: headers.findIndex((h) => h.includes("최종")),
      prev:     headers.findIndex((h) => h.includes(String(Number(previousYear)))),
      curr:     headers.findIndex((h) => h.includes(String(Number(currentYear)))),
      note:     headers.indexOf("비고"),
    };

    // ★ 데이터 행: 헤더 다음 행부터, 성명·사번이 모두 비어있으면 건너뜀
    const dataRaw = allRows.slice(headerRowIdx + 1).filter((r) => {
      const n = normCell(r[col.name]);
      const e = normCell(r[col.empNo]);
      return n !== "" || e !== "";
    });

    // ★ 사번 정규화: 숫자 사번도 안전하게 문자열로 변환
    const safeEmpNo = (v) => {
      if (v === null || v === undefined) return "";
      // Excel serial 숫자가 아닌 일반 숫자·문자열 모두 처리
      return String(v).trim();
    };

    // ★ Excel 날짜 셀 정규화: serial number / JS Date / 문자열 모두 지원
    const xlDateToYMD = (v) => {
      if (v === null || v === undefined || v === "") return "";
      // Excel serial number (일반적으로 40000~50000 범위)
      if (typeof v === "number" && v > 0 && v < 3000) {
        // XLSX.SSF.parse_date_code 대신 직접 계산
        const d = new Date(Math.round((v - 25569) * 86400 * 1000));
        if (!isNaN(d.getTime())) return formatDateYMD(d.getTime());
        return "";
      }
      // 문자열 또는 큰 숫자(밀리초 타임스탬프)
      const s = String(v).trim();
      if (!s) return "";
      const d = new Date(s);
      if (!isNaN(d.getTime())) return formatDateYMD(d.getTime());
      return "";
    };

    // 사번 → 직원 매핑
    const empByNo = new Map(viewState.employees.map((e) => [safeEmpNo(e.empNo), e]));

    pendingHistoryRows = dataRaw.map((row, i) => {
      const getStr  = (idx) => idx >= 0 ? normCell(row[idx]) : "";
      const getRaw  = (idx) => idx >= 0 ? row[idx] ?? "" : "";

      const name     = getStr(col.name);
      const empNo    = safeEmpNo(getRaw(col.empNo));
      const joinDate = xlDateToYMD(getRaw(col.joinDate));
      const position = getStr(col.position);
      const initial  = getStr(col.initial);
      const lastDate = getStr(col.lastDate);
      const prevDate = getStr(col.prev);
      const currDate = getStr(col.curr);
      const note     = getStr(col.note);

      // ── 검증 (요구 순서대로)
      const errors = [];
      if (!name)  errors.push("성명 누락");
      if (!empNo) errors.push("사번 누락");

      const emp = empNo ? empByNo.get(empNo) : null;
      if (empNo && !emp) errors.push("존재하지 않는 사번");
      else if (emp && name && emp.name !== name) errors.push("사번과 성명 불일치");

      // 날짜 파싱 — 쉼표 구분 여러 날짜 지원
      const parsedInitial = parseDateCells(initial,  Number(currentYear) - 10, Number(currentYear) + 1, errors, "초기교육");
      const parsedPrev    = parseDateCells(prevDate,  Number(previousYear), Number(previousYear), errors, `${previousYear}년`);
      const parsedCurr    = parseDateCells(currDate,  Number(currentYear),  Number(currentYear),  errors, `${currentYear}년`);
      const parsedLast    = parseDateCell(lastDate);

      // 날짜가 하나도 없으면 건너뜀(실패 아님)
      const allDates = [...parsedInitial, ...parsedPrev, ...parsedCurr];
      const skip     = allDates.length === 0 && errors.length === 0;

      return {
        _rowNum:      headerRowIdx + 1 + i + 2, // 1-based 행번호
        _skip:        skip,
        _errors:      errors,
        name, empNo, joinDate, position, note,
        uid:          emp?.id ?? emp?.uid ?? "",
        initialDates:  parsedInitial,
        prevYearDates: parsedPrev,
        currYearDates: parsedCurr,
        lastDate:      parsedLast,
      };
    });

    // ── 통계
    const nonSkipped = pendingHistoryRows.filter((r) => !r._skip);
    const invalid    = nonSkipped.filter((r) => r._errors.length);
    const valid      = nonSkipped.filter((r) => !r._errors.length);
    const skippedCnt = pendingHistoryRows.filter((r) => r._skip).length;

    previewEl.innerHTML = `
      <div style="margin-bottom:var(--space-2)">
        <span style="font-size:var(--text-sm);font-weight:var(--weight-semibold)">${typeLabel ?? trainingType} — ${subjectName}</span>
        <span style="font-size:var(--text-xs);color:var(--gray-400);margin-left:var(--space-2)">(${previousYear}년 / ${currentYear}년)</span>
      </div>
      <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-3);flex-wrap:wrap">
        <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm)">전체 <strong>${nonSkipped.length}건</strong></div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm);color:#15803d">정상 <strong>${valid.length}건</strong></div>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm);color:#c2410c">오류 <strong>${invalid.length}건</strong></div>
        ${skippedCnt ? `<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm);color:var(--gray-400)">날짜 없음(건너뜀) <strong>${skippedCnt}건</strong></div>` : ""}
      </div>
      <div class="table-wrap" style="max-height:360px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius-md)">
        <table class="data-table" style="min-width:900px">
          <thead>
            <tr>
              <th>행</th><th>성명</th><th>사번</th>
              <th>입사일</th><th>직급/직책</th>
              <th>초기교육</th><th>최종교육일</th>
              <th>${previousYear}년</th><th>${currentYear}년</th>
              <th>비고</th><th>검증</th>
            </tr>
          </thead>
          <tbody>
            ${pendingHistoryRows.map((r) => `
              <tr style="background:${r._errors.length ? "#fff7ed" : r._skip ? "#f9fafb" : ""}">
                <td style="color:var(--gray-400);text-align:center">${r._rowNum}</td>
                <td>${escapeHtml(r.name)}</td>
                <td style="font-family:monospace;font-size:var(--text-xs)">${escapeHtml(r.empNo)}</td>
                <td style="font-size:var(--text-xs)">${escapeHtml(r.joinDate || "–")}</td>
                <td style="font-size:var(--text-xs)">${escapeHtml(r.position || "–")}</td>
                <td style="font-size:var(--text-xs)">${escapeHtml(r.initialDates.join(", ") || "–")}</td>
                <td style="font-size:var(--text-xs)">${escapeHtml(r.lastDate || "–")}</td>
                <td style="font-size:var(--text-xs)">${escapeHtml(r.prevYearDates.join(", ") || "–")}</td>
                <td style="font-size:var(--text-xs)">${escapeHtml(r.currYearDates.join(", ") || "–")}</td>
                <td style="font-size:var(--text-xs)">${escapeHtml(r.note || "–")}</td>
                <td>${r._skip
                  ? `<span style="color:var(--gray-400);font-size:var(--text-xs)">건너뜀</span>`
                  : r._errors.length
                    ? `<span style="color:#c2410c;font-size:var(--text-xs)">${escapeHtml(r._errors.join(" / "))}</span>`
                    : `<span style="color:#15803d;font-size:var(--text-xs)">✓ 정상</span>`
                }</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    if (submitBtn) submitBtn.disabled = valid.length === 0;
  } catch (err) {
    console.error("[employees] parseHistoryUploadFileInline", err);
    pendingHistoryRows = [];
    selectedTemplateMeta = null;
    previewEl.innerHTML = `<div style="color:var(--color-danger,#dc2626);font-size:var(--text-sm);padding:var(--space-3)">파일을 읽지 못했습니다. xlsx 형식인지 확인해 주세요.</div>`;
  }
}

// 날짜 셀 파싱 — 단일 날짜 (Excel serial / 문자열 / 밀리초 모두 지원)
function parseDateCell(value) {
  if (value === null || value === undefined || value === "") return "";
  // Excel serial number
  if (typeof value === "number" && value > 0 && value < 3000) {
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? "" : formatDateYMD(d.getTime());
  }
  const s = String(value).trim();
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return formatDateYMD(d.getTime());
}

// 날짜 셀 파싱 — 쉼표 구분 복수 날짜, 연도 범위 검증
// Excel serial number / 문자열 / 밀리초 모두 지원
function parseDateCells(value, minYear, maxYear, errors, label) {
  if (value === null || value === undefined || value === "") return [];

  // Excel serial number는 쉼표 구분이 없으므로 단독 처리
  if (typeof value === "number") {
    const ymd = parseDateCell(value);
    if (!ymd) { errors.push(`${label} 날짜 형식 오류`); return []; }
    const year = new Date(ymd).getFullYear();
    if (year < minYear || year > maxYear) {
      errors.push(`${label} 연도 오류 (${year}년, ${minYear}~${maxYear}년만 허용)`);
      return [];
    }
    return [ymd];
  }

  const s = String(value).trim();
  if (!s) return [];
  const parts = s.split(/[,，、]/);
  const results = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) {
      errors.push(`${label} 날짜 형식 오류: ${trimmed}`);
      continue;
    }
    const year = d.getFullYear();
    if (year < minYear || year > maxYear) {
      errors.push(`${label} 연도 오류 (${year}년, ${minYear}~${maxYear}년만 허용)`);
      continue;
    }
    results.push(formatDateYMD(d.getTime()));
  }
  return results;
}

/* ──────────────────────────────────────────────────────────
   인라인 업로드 실행 → Cloud Function 호출
────────────────────────────────────────────────────────── */
async function submitHistoryUploadInline() {
  const submitBtn = document.getElementById("btn-history-upload-submit");
  const resultEl  = document.getElementById("history-upload-result");

  if (!selectedTemplateMeta) { toast.warning("먼저 교육 항목 양식의 Excel 파일을 선택해 주세요."); return; }

  const { trainingType, subjectCode, subjectName, currentYear, previousYear } = selectedTemplateMeta;
  const validRows = pendingHistoryRows.filter((r) => !r._skip && !r._errors.length);
  if (!validRows.length) { toast.warning("업로드할 수 있는 정상 행이 없습니다."); return; }

  // 행 하나에 여러 날짜 → 날짜별 개별 이력 생성
  const historyEntries = [];
  for (const row of validRows) {
    const stages = [
      ...row.initialDates.map((d)  => ({ completedAt: d, educationStage: "initial" })),
      ...row.prevYearDates.map((d) => ({ completedAt: d, educationStage: "previous_year" })),
      ...row.currYearDates.map((d) => ({ completedAt: d, educationStage: "current_year" })),
    ];
    for (const { completedAt, educationStage } of stages) {
      historyEntries.push({
        empNo:          row.empNo,
        employeeName:   row.name,
        trainingType,
        subjectCode,
        subjectName,
        title:          subjectName,
        courseName:     subjectName,
        completedAt,
        educationStage,
        source:         "manual_excel",
        note:           row.note ?? "",
        // cycleMonths는 서버에서 교육 항목 설정값으로 채워지도록 여기서는 0
        cycleMonths:    0,
      });
    }
  }

  if (!historyEntries.length) { toast.warning("업로드할 날짜가 없습니다."); return; }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "업로드 중..."; }
  if (resultEl)  resultEl.textContent = "";

  try {
    const result = await bulkImportManualTrainingHistories({ rows: historyEntries });

    const msg = `✅ 등록 ${result.succeededCount ?? 0}건 · 중복 ${result.skippedCount ?? 0}건 · 실패 ${result.failedCount ?? 0}건`;
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--color-success,#16a34a)">${escapeHtml(msg)}</span>`;
    toast.success(msg);

    // 초기화
    pendingHistoryRows = [];
    selectedTemplateMeta = null;
    const fileInput = document.getElementById("history-upload-file-inline");
    if (fileInput) fileInput.value = "";
    const filenameEl = document.getElementById("history-upload-filename");
    if (filenameEl) filenameEl.textContent = "선택된 파일 없음";
    const previewEl = document.getElementById("history-upload-preview-inline");
    if (previewEl) previewEl.innerHTML = `<div style="background:var(--gray-50);border:1px dashed var(--gray-300);border-radius:var(--radius-md);padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">업로드가 완료되었습니다. 다음 파일을 선택하세요.</div>`;
  } catch (err) {
    console.error("[employees] submitHistoryUploadInline", err);
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--color-danger,#dc2626)">${escapeHtml(err?.message || "업로드에 실패했습니다.")}</span>`;
    toast.error(err?.message || "업로드에 실패했습니다.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><path d="M8 10V2m0 0L5 5m3-3l3 3M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>이력 업로드`;
    }
  }
}

/* ──────────────────────────────────────────────────────────
   헬퍼
────────────────────────────────────────────────────────── */
function matchesSelectedBranch(employee, branch) {
  const c = [branch.id, branch.code, branch.name].map(normalizeKey).filter(Boolean);
  return [employee.branchId, employee.branchCode, employee.branchName].map(normalizeKey).some((v) => v && c.includes(v));
}
function normalizeKey(value) { return String(value ?? "").trim().toLowerCase(); }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
