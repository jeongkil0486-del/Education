/**
 * 직원관리대장 (employees.js)
 *
 * - 지점 + 교육 항목 선택 후 '조회' 버튼으로 직원별 교육현황 집계 표시
 * - Excel 양식 다운로드 / 업로드 기능 유지 (기존 로직 그대로)
 * - HQ_ADMIN: 전체 기능, SUPER_ADMIN: 조회만
 */

import { router } from "../core/router.js";
import {
  loadTrainingReferences,
  listManagedItems,
  applyDueMetadata,
  TRAINING_SUBJECT_OPTIONS,
  TRAINING_TYPE_LABELS,
  getTrainingTypeLabel,
  normalizeTrainingType,
} from "../services/training-service.js";
import { bulkImportManualTrainingHistories } from "../core/admin-api.js";
import { manualTrainingHistoriesDB, sessionCompletionsDB } from "../core/db.js";
import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { authStore, ROLES } from "../core/auth.js";
import { formatDate } from "../utils/date.js";

/* ─── 상수 ─────────────────────────────────────────────── */
const CY = new Date().getFullYear();   // currentYear
const PY = CY - 1;                     // previousYear

/* ─── 모듈 상태 ─────────────────────────────────────────── */
let viewState = { company: null, branches: [], employees: [], items: [] };
let pendingHistoryRows   = [];
let selectedTemplateMeta = null;
// 조회 결과
let ledgerRows = [];        // 집계된 관리대장 행
let ledgerFilter = "all";   // all | has | none
let ledgerSearch = "";

/* ═══════════════════════════════════════════════════════
   render
═══════════════════════════════════════════════════════ */
export async function render(container) {
  const isHQAdmin = authStore.role === ROLES.HQ_ADMIN;

  container.innerHTML = `<div style="padding:var(--space-2);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">로딩 중...</div>`;

  try {
    const [references, items] = await Promise.all([
      loadTrainingReferences(),
      listManagedItems().catch(() => []),
    ]);

    viewState = {
      company:   references.company ?? null,
      branches:  [...(references.branches ?? [])].sort((a, b) =>
        String(a.name ?? a.code ?? "").localeCompare(String(b.name ?? b.code ?? ""), "ko")),
      employees: [...(references.employees ?? [])].sort((a, b) =>
        String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko")),
      items,
    };
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="padding:var(--space-16)"><div class="empty-state__title">데이터를 불러오지 못했습니다.</div></div>`;
    console.error("[employees] init error", err);
    return;
  }

  // 교육 옵션 목록 빌드
  const trainingOptions = buildTrainingOptions(viewState.items);

  container.innerHTML = `
    <!-- 헤더 -->
    <div class="section-header">
      <div>
        <div class="section-title">직원관리대장</div>
        <div class="section-subtitle">지점과 교육 항목을 선택하여 직원별 교육 현황을 관리합니다.</div>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        ${isHQAdmin ? `
          <button class="btn btn--ghost btn--sm" id="btn-open-history-cards">이력카드</button>
          <button class="btn btn--ghost btn--sm" id="btn-open-add-manual">개인 이력 추가</button>
          <button class="btn btn--secondary btn--sm" id="btn-history-template">양식 다운로드</button>
        ` : `<button class="btn btn--ghost btn--sm" id="btn-open-history-cards">이력카드</button>`}
      </div>
    </div>

    ${isHQAdmin ? `
    <!-- Excel 업로드 카드 -->
    <div class="card" id="upload-card" style="margin-bottom:var(--space-4);border-left:4px solid var(--brand-400)">
      <div class="card__header" style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between" id="upload-card-toggle">
        <div>
          <div class="card__title">개인 교육이력 일괄 등록 <span style="font-size:var(--text-xs);color:var(--gray-400);font-weight:normal">(교육 항목 양식 전용)</span></div>
          <div class="card__subtitle">양식을 다운로드하고 날짜를 입력한 뒤 업로드하면 이력이 자동 등록됩니다.</div>
        </div>
        <svg id="upload-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" style="transition:transform 0.2s;color:var(--gray-400)"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div id="upload-card-body" style="display:none">
        <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-4)">
          <div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap">
            <label class="btn btn--secondary" style="cursor:pointer;margin:0">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><path d="M3 4h10M3 8h6M3 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="9" y="8" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M12 9.5v3M10.5 11h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              Excel 파일 선택
              <input type="file" id="history-upload-file-inline" accept=".xlsx,.xls,.csv" style="display:none"/>
            </label>
            <span id="history-upload-filename" style="font-size:var(--text-sm);color:var(--gray-500)">선택된 파일 없음</span>
          </div>
          <div id="history-upload-preview-inline">
            <div style="background:var(--gray-50);border:1px dashed var(--gray-300);border-radius:var(--radius-md);padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">
              교육 항목 양식의 Excel 파일을 선택하면 미리보기와 검증 결과가 표시됩니다.
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap">
            <button class="btn btn--primary" id="btn-history-upload-submit" disabled>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><path d="M8 10V2m0 0L5 5m3-3l3 3M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              이력 업로드
            </button>
            <div id="history-upload-result" style="font-size:var(--text-sm);color:var(--gray-600)"></div>
          </div>
        </div>
      </div>
    </div>
    ` : ""}

    <!-- 필터 카드 -->
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card__body card__body--compact">
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:var(--space-3);align-items:end;flex-wrap:wrap">
          <div class="form-group" style="margin:0">
            <label class="form-label form-label--required">지점 선택</label>
            <select class="form-control" id="ledger-branch">
              <option value="">-- 지점을 선택하세요 --</option>
              ${viewState.branches.map((b) =>
                `<option value="${b.id}">${esc(b.name ?? b.code ?? b.id)}</option>`
              ).join("")}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label form-label--required">교육 선택</label>
            <select class="form-control" id="ledger-training">
              <option value="">-- 교육을 선택하세요 --</option>
              ${trainingOptions.map((o) =>
                `<option value="${esc(o.value)}">${esc(o.label)}</option>`
              ).join("")}
            </select>
          </div>
          <button class="btn btn--primary" id="btn-ledger-search" disabled>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            조회
          </button>
        </div>
      </div>
    </div>

    <!-- 조회 결과 -->
    <div id="ledger-result" style="display:none">
      <!-- 요약 카드 -->
      <div id="ledger-summary" class="dashboard-grid dashboard-grid--compact" style="margin-bottom:var(--space-4)"></div>

      <!-- 결과 테이블 필터 -->
      <div class="card">
        <div class="card__header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-2)">
          <div>
            <div class="card__title" id="ledger-title">관리대장</div>
            <div class="card__subtitle" id="ledger-subtitle"></div>
          </div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center">
            <div class="input-group" style="width:200px">
              <svg class="input-group__icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>
              <input class="form-control" id="ledger-search" type="search" placeholder="이름·사번 검색"/>
            </div>
            <select class="form-control" id="ledger-status-filter" style="width:140px">
              <option value="all">전체</option>
              <option value="none">미이수</option>
              <option value="overdue">기한 초과</option>
              <option value="soon">30일 이내</option>
              <option value="normal">정상</option>
              <option value="unconfigured">주기 미설정</option>
            </select>
          </div>
        </div>
        <div class="card__body" style="padding:0;overflow-x:auto">
          <div id="ledger-table"></div>
        </div>
      </div>
    </div>

    <!-- 초기 안내 -->
    <div id="ledger-empty-guide" class="card">
      <div class="card__body" style="text-align:center;padding:var(--space-16)">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style="color:var(--gray-300);margin:0 auto var(--space-4)"><rect x="6" y="10" width="36" height="28" rx="2" stroke="currentColor" stroke-width="2"/><path d="M14 18h20M14 24h14M14 30h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <div style="font-weight:var(--weight-semibold);color:var(--gray-600);margin-bottom:var(--space-2)">지점과 교육을 선택한 뒤 조회하세요</div>
        <div style="font-size:var(--text-sm);color:var(--gray-400)">선택한 교육 항목의 직원별 이수 현황이 표시됩니다.</div>
      </div>
    </div>
  `;

  /* 이벤트 바인딩 */
  document.getElementById("btn-open-history-cards")?.addEventListener("click", () => router.push("history-cards"));

  if (isHQAdmin) {
    // 업로드 카드 토글
    document.getElementById("upload-card-toggle")?.addEventListener("click", () => {
      const body    = document.getElementById("upload-card-body");
      const chevron = document.getElementById("upload-chevron");
      const open    = body.style.display === "none";
      body.style.display    = open ? "block" : "none";
      chevron.style.transform = open ? "rotate(180deg)" : "";
    });

    document.getElementById("btn-open-add-manual")?.addEventListener("click", () => {
      toast.warning("조회 후 직원 행을 선택하면 개인 이력을 추가할 수 있습니다.");
    });

    document.getElementById("btn-history-template")?.addEventListener("click", () => {
      const branchId   = document.getElementById("ledger-branch")?.value ?? "";
      const trainingVal = document.getElementById("ledger-training")?.value ?? "";
      openTemplateSelectModal(branchId, trainingVal);
    });

    document.getElementById("history-upload-file-inline")?.addEventListener("change", parseHistoryUploadFileInline);
    document.getElementById("btn-history-upload-submit")?.addEventListener("click", submitHistoryUploadInline);
  }

  // 필터 조회 활성화
  const branchSel   = document.getElementById("ledger-branch");
  const trainingSel = document.getElementById("ledger-training");
  const searchBtn   = document.getElementById("btn-ledger-search");

  const checkBtnState = () => {
    if (searchBtn) searchBtn.disabled = !(branchSel?.value && trainingSel?.value);
  };
  branchSel?.addEventListener("change", checkBtnState);
  trainingSel?.addEventListener("change", checkBtnState);

  searchBtn?.addEventListener("click", runLedgerQuery);

  document.getElementById("ledger-search")?.addEventListener("input", (e) => {
    ledgerSearch = e.target.value.trim().toLowerCase();
    renderLedgerTable();
  });
  document.getElementById("ledger-status-filter")?.addEventListener("change", (e) => {
    ledgerFilter = e.target.value;
    renderLedgerTable();
  });
}

/* ═══════════════════════════════════════════════════════
   교육 옵션 목록 빌드
═══════════════════════════════════════════════════════ */
function buildTrainingOptions(items) {
  const opts = [];
  // 고정: 직무교육
  for (const s of TRAINING_SUBJECT_OPTIONS.job ?? []) {
    opts.push({ value: `job|${s.code}`, label: `직무교육 - ${s.name}`, trainingType: "job", subjectCode: s.code, subjectName: s.name });
  }
  // 고정: 법정교육
  for (const s of TRAINING_SUBJECT_OPTIONS.legal ?? []) {
    opts.push({ value: `legal|${s.code}`, label: `법정교육 - ${s.name}`, trainingType: "legal", subjectCode: s.code, subjectName: s.name });
  }
  // 동적: 온라인
  for (const item of items.filter((i) => i.trainingType === "online")) {
    const sn = item.subjectName ?? item.title ?? "";
    opts.push({ value: `online|${item.subjectCode || item.id}`, label: `온라인교육 - ${sn}`, trainingType: "online", subjectCode: item.subjectCode || item.id, subjectName: sn, itemId: item.id });
  }
  // 동적: 기타
  for (const item of items.filter((i) => i.trainingType === "other")) {
    const sn = item.subjectName ?? item.title ?? "";
    opts.push({ value: `other|${item.subjectCode || item.id}`, label: `기타 - ${sn}`, trainingType: "other", subjectCode: item.subjectCode || item.id, subjectName: sn, itemId: item.id });
  }
  return opts;
}

function parseTrainingValue(val) {
  if (!val) return null;
  const [trainingType, subjectCode] = val.split("|");
  const allOpts = buildTrainingOptions(viewState.items);
  return allOpts.find((o) => o.value === val) ?? { trainingType, subjectCode, subjectName: subjectCode, label: val };
}

/* ═══════════════════════════════════════════════════════
   관리대장 조회
═══════════════════════════════════════════════════════ */
async function runLedgerQuery() {
  const branchId    = document.getElementById("ledger-branch")?.value ?? "";
  const trainingVal = document.getElementById("ledger-training")?.value ?? "";
  if (!branchId || !trainingVal) { toast.warning("지점과 교육을 모두 선택하세요."); return; }

  const btn = document.getElementById("btn-ledger-search");
  if (btn) { btn.disabled = true; btn.textContent = "조회 중..."; }

  try {
    const trainingMeta = parseTrainingValue(trainingVal);
    const branch = viewState.branches.find((b) => b.id === branchId);

    // 해당 지점 직원만
    const branchEmployees = viewState.employees.filter((e) => matchesBranch(e, branchId));

    // manualTrainingHistories 전체 조회 후 클라이언트 필터
    const [manualAll, sessionAll] = await Promise.all([
      manualTrainingHistoriesDB.listAll().catch(() => []),
      fetchAllSessionCompletions(),
    ]);

    // 해당 교육 항목에 해당하는 이력 필터
    const relevant = filterByTraining([...manualAll, ...sessionAll], trainingMeta);

    // 직원별 집계
    ledgerRows = aggregateLedger(branchEmployees, relevant, trainingMeta);

    // 제목 업데이트
    const branchLabel = branch?.name ?? branch?.code ?? branchId;
    const trainingLabel = trainingMeta?.label ?? trainingVal;
    document.getElementById("ledger-title").textContent = `${branchLabel} · ${trainingLabel}`;
    document.getElementById("ledger-subtitle").textContent = `기준연도: ${CY}년`;

    // 요약
    renderLedgerSummary();

    // 결과 표시
    document.getElementById("ledger-empty-guide").style.display = "none";
    document.getElementById("ledger-result").style.display = "block";
    ledgerFilter = "all";
    ledgerSearch = "";
    document.getElementById("ledger-status-filter").value = "all";
    document.getElementById("ledger-search").value = "";
    renderLedgerTable();
  } catch (err) {
    console.error("[employees] ledger query failed", err);
    toast.error("조회 중 오류가 발생했습니다.");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>조회`; }
  }
}

async function fetchAllSessionCompletions() {
  try {
    const groups = await sessionCompletionsDB.listAll();
    const result = [];
    for (const group of (Array.isArray(groups) ? groups : [])) {
      if (group && typeof group === "object") {
        for (const [key, rec] of Object.entries(group)) {
          if (key !== "id" && rec && rec.uid) result.push({ ...rec, _source: "session" });
        }
      }
    }
    return result;
  } catch { return []; }
}

function filterByTraining(histories, meta) {
  if (!meta) return [];
  return histories.filter((h) => {
    if (!h) return false;
    const ht = normalizeTrainingType(h.trainingType);
    if (ht !== meta.trainingType) return false;
    // itemId 일치 우선
    if (meta.itemId && h.itemId === meta.itemId) return true;
    // subjectCode 일치
    if (meta.subjectCode && h.subjectCode === meta.subjectCode) return true;
    // subjectName 일치
    if (meta.subjectName && (h.subjectName === meta.subjectName || h.title === meta.subjectName)) return true;
    return false;
  });
}

function aggregateLedger(employees, histories, trainingMeta) {
  const byUid = new Map();
  for (const h of histories) {
    const uid = h.uid;
    if (!uid) continue;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid).push(h);
  }

  return employees.map((emp) => {
    const uid  = emp.id ?? emp.uid;
    const recs = byUid.get(uid) ?? [];

    // 날짜 추출 함수
    const toYmd = (v) => {
      if (!v) return null;
      const d = new Date(typeof v === "number" ? v : String(v));
      return isNaN(d.getTime()) ? null : formatDateYMD(d.getTime());
    };

    // 초기교육: educationStage==="initial" 또는 subType==="initial", 가장 이른 날짜
    const initialRecs = recs.filter((r) => r.educationStage === "initial" || r.educationType === "initial" || r.subType === "initial");
    const initialDates = initialRecs.map((r) => toYmd(r.completedAt)).filter(Boolean).sort();
    const initialDate  = initialDates[0] ?? null; // 최초값

    // 전년도
    const prevRecs  = recs.filter((r) => {
      if (r.educationStage === "previous_year") return true;
      const y = toYmd(r.completedAt);
      return y && y.startsWith(String(PY));
    });
    const prevDates = [...new Set(prevRecs.map((r) => toYmd(r.completedAt)).filter(Boolean))].sort();

    // 금년도
    const currRecs  = recs.filter((r) => {
      if (r.educationStage === "current_year") return true;
      const y = toYmd(r.completedAt);
      return y && y.startsWith(String(CY));
    });
    const currDates = [...new Set(currRecs.map((r) => toYmd(r.completedAt)).filter(Boolean))].sort();

    // 최종교육일: 전체 이력 중 가장 최근
    const allDates  = recs.map((r) => toYmd(r.completedAt)).filter(Boolean).sort();
    const lastDate  = allDates.length ? allDates[allDates.length - 1] : null;

    // 비고: 가장 최근 이력의 note
    const lastRec = recs.sort((a, b) => Number(b.completedAt ?? 0) - Number(a.completedAt ?? 0))[0];
    const note    = lastRec?.note ?? "";

    // cycleMonths: 이력에서 가져오거나 0
    const cycleMonths = Number(lastRec?.cycleMonths ?? 0);

    // applyDueMetadata 적용 (completedAt = lastDate)
    const dueRow = lastDate ? applyDueMetadata([{
      completedAt: new Date(lastDate).getTime(),
      cycleMonths,
    }])[0] : { dueStatus: recs.length === 0 ? "none" : "unconfigured", nextDueDate: null, daysRemaining: null, dueStatusLabel: recs.length === 0 ? "미이수" : "주기 미설정" };

    return {
      uid,
      name:        emp.name ?? "–",
      empNo:       emp.empNo ?? "–",
      joinDate:    toYmd(emp.joinDate ?? emp.hireDate ?? emp.joinedAt ?? emp.employmentDate) ?? "–",
      position:    emp.position ?? "–",
      initialDate,
      lastDate,
      prevDates,
      currDates,
      note,
      cycleMonths,
      hasHistory:  recs.length > 0,
      dueStatus:   dueRow.dueStatus ?? (recs.length === 0 ? "none" : "unconfigured"),
      nextDueDate: dueRow.nextDueDate ?? null,
      daysRemaining: dueRow.daysRemaining ?? null,
      dueStatusLabel: dueRow.dueStatusLabel ?? (recs.length === 0 ? "미이수" : "–"),
    };
  });
}

/* ─── 요약 카드 ─────────────────────────────────────────── */
function renderLedgerSummary() {
  const el = document.getElementById("ledger-summary");
  if (!el) return;
  const total    = ledgerRows.length;
  const hasH     = ledgerRows.filter((r) => r.hasHistory).length;
  const none     = total - hasH;
  const overdue  = ledgerRows.filter((r) => r.dueStatus === "overdue").length;
  const soon     = ledgerRows.filter((r) => r.dueStatus === "soon").length;

  el.innerHTML = [
    { label: "전체 직원",  value: total },
    { label: "이력 보유",  value: hasH },
    { label: "미이수",     value: none },
    { label: "기한 초과",  value: overdue },
    { label: "30일 이내",  value: soon },
  ].map(({ label, value }) => `
    <div class="stat-card">
      <div class="stat-card__label">${esc(label)}</div>
      <div class="stat-card__value">${value}</div>
    </div>`).join("");
}

/* ─── 관리대장 표 ────────────────────────────────────────── */
function renderLedgerTable() {
  const el = document.getElementById("ledger-table");
  if (!el) return;

  // 필터
  let rows = ledgerRows;
  if (ledgerSearch) {
    rows = rows.filter((r) =>
      String(r.name).toLowerCase().includes(ledgerSearch) ||
      String(r.empNo).toLowerCase().includes(ledgerSearch)
    );
  }
  if (ledgerFilter !== "all") {
    rows = rows.filter((r) => {
      if (ledgerFilter === "none")         return !r.hasHistory;
      if (ledgerFilter === "overdue")      return r.dueStatus === "overdue";
      if (ledgerFilter === "soon")         return r.dueStatus === "soon";
      if (ledgerFilter === "normal")       return r.dueStatus === "normal";
      if (ledgerFilter === "unconfigured") return r.dueStatus === "unconfigured";
      return true;
    });
  }

  // 정렬: 미이수 → 초과 → 임박 → 정상 → 성명
  const ORDER = { none: 0, overdue: 1, soon: 2, unconfigured: 3, normal: 4 };
  rows = [...rows].sort((a, b) =>
    (ORDER[a.dueStatus] ?? 5) - (ORDER[b.dueStatus] ?? 5) ||
    String(a.name).localeCompare(String(b.name), "ko")
  );

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state" style="padding:var(--space-10)"><div class="empty-state__title" style="font-size:var(--text-sm)">조건에 맞는 직원이 없습니다.</div></div>`;
    return;
  }

  el.innerHTML = `
    <table class="data-table" style="min-width:1000px">
      <thead>
        <tr>
          <th>성명</th><th>사번</th><th>입사일</th><th>직급/직책</th>
          <th>초기교육</th><th>최종교육일</th>
          <th>${PY}년</th><th>${CY}년</th>
          <th>다음 예정일</th><th>남은 일수</th><th>상태</th><th>비고</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => {
          const tone = r.dueStatus === "overdue" ? "danger"
            : r.dueStatus === "soon"         ? "warning"
            : r.dueStatus === "normal"       ? "success"
            : r.dueStatus === "none"         ? "neutral"
            : "neutral";
          const days = r.daysRemaining === null ? "–"
            : r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)}일 초과`
            : `${r.daysRemaining}일`;

          return `<tr data-uid="${esc(r.uid)}" title="더블클릭하면 개인 이력카드로 이동" style="cursor:pointer">
            <td style="font-weight:var(--weight-medium)">${esc(r.name)}</td>
            <td style="font-family:monospace;font-size:var(--text-xs)">${esc(r.empNo)}</td>
            <td style="font-size:var(--text-xs)">${esc(r.joinDate)}</td>
            <td style="font-size:var(--text-xs)">${esc(r.position)}</td>
            <td style="font-size:var(--text-xs)">${esc(r.initialDate ?? "–")}</td>
            <td style="font-size:var(--text-xs)">${esc(r.lastDate ?? "–")}</td>
            <td style="font-size:var(--text-xs)">${esc(r.prevDates.join(", ") || "–")}</td>
            <td style="font-size:var(--text-xs)">${esc(r.currDates.join(", ") || "–")}</td>
            <td style="font-size:var(--text-xs)">${r.nextDueDate ? esc(formatDateYMD(r.nextDueDate)) : "–"}</td>
            <td style="font-size:var(--text-xs)">${esc(days)}</td>
            <td><span class="chip chip--${tone}" style="font-size:var(--text-xs)">${esc(r.dueStatusLabel)}</span></td>
            <td style="font-size:var(--text-xs)">${esc(r.note || "–")}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;

  // 단일 클릭 = 하이라이트, 더블클릭 = 이력카드 이동
  // dblclick은 click 이벤트 2회 발화를 수반하므로 타이머로 구분
  el.querySelectorAll("tbody tr[data-uid]").forEach((row) => {
    let clickTimer = null;

    row.addEventListener("click", () => {
      // 이전 단일클릭 타이머 취소 (더블클릭이면 이 블록은 실행 안 됨)
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        // 단일 클릭: 행 선택 하이라이트
        el.querySelectorAll("tbody tr").forEach((r) => r.style.background = "");
        row.style.background = "var(--brand-50, #eff6ff)";
      }, 220); // 더블클릭 인식 시간(보통 200ms)보다 약간 길게
    });

    row.addEventListener("dblclick", () => {
      clearTimeout(clickTimer); // 단일클릭 타이머 취소
      // 더블클릭: 개인 교육이력카드로 이동
      // SUPER_ADMIN은 history-cards가 읽기 전용으로 열림 (권한 처리는 history-cards.js에서 담당)
      router.push("history-cards", { uid: row.dataset.uid });
    });
  });
}

/* ═══════════════════════════════════════════════════════
   교육 항목 선택 모달 → 양식 다운로드
═══════════════════════════════════════════════════════ */
async function openTemplateSelectModal(preselectedBranchId = "", preselectedTrainingVal = "") {
  let registeredItems = viewState.items;
  const onlineItems = registeredItems.filter((i) => i.trainingType === "online");
  const otherItems  = registeredItems.filter((i) => i.trainingType === "other");

  // 현재 필터에서 교육유형·세부분류 사전 설정
  const preTraining = parseTrainingValue(preselectedTrainingVal);

  modal.open({
    title: "교육 항목 선택 — 양식 다운로드",
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="background:var(--blue-50,#eff6ff);border:1px solid var(--blue-200,#bfdbfe);border-radius:var(--radius-md);padding:var(--space-3);font-size:var(--text-sm);color:var(--blue-800,#1e40af)">
          선택한 교육 항목 전용 양식을 다운로드합니다. (기준연도: ${CY}년)
        </div>
        <div class="form-group">
          <label class="form-label form-label--required">교육유형</label>
          <select class="form-control" id="tpl-training-type">
            <option value="">선택하세요</option>
            <option value="job" ${preTraining?.trainingType === "job" ? "selected" : ""}>직무교육</option>
            <option value="legal" ${preTraining?.trainingType === "legal" ? "selected" : ""}>법정교육</option>
            <option value="online" ${preTraining?.trainingType === "online" ? "selected" : ""}>온라인교육</option>
            <option value="other" ${preTraining?.trainingType === "other" ? "selected" : ""}>기타</option>
          </select>
        </div>
        <div class="form-group" id="tpl-job-subjects" style="display:${preTraining?.trainingType === "job" ? "block" : "none"}">
          <label class="form-label form-label--required">교육 세부분류</label>
          <select class="form-control" id="tpl-job-subject">
            <option value="">선택하세요</option>
            ${(TRAINING_SUBJECT_OPTIONS.job ?? []).map((s) =>
              `<option value="${s.code}" data-name="${esc(s.name)}" ${preTraining?.subjectCode === s.code ? "selected" : ""}>${esc(s.name)}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group" id="tpl-legal-subjects" style="display:${preTraining?.trainingType === "legal" ? "block" : "none"}">
          <label class="form-label form-label--required">교육 세부분류</label>
          <select class="form-control" id="tpl-legal-subject">
            <option value="">선택하세요</option>
            ${(TRAINING_SUBJECT_OPTIONS.legal ?? []).map((s) =>
              `<option value="${s.code}" data-name="${esc(s.name)}" ${preTraining?.subjectCode === s.code ? "selected" : ""}>${esc(s.name)}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group" id="tpl-online-subjects" style="display:${preTraining?.trainingType === "online" ? "block" : "none"}">
          <label class="form-label form-label--required">교육 세부분류</label>
          ${onlineItems.length ? `
          <select class="form-control" id="tpl-online-subject-select">
            <option value="">기존 항목 선택 또는 직접 입력</option>
            ${onlineItems.map((i) => `<option value="${esc(i.subjectCode||i.id)}" data-name="${esc(i.subjectName||i.title)}" ${preTraining?.subjectCode === (i.subjectCode||i.id) ? "selected" : ""}>${esc(i.subjectName||i.title)}</option>`).join("")}
          </select>
          <div style="margin-top:4px;font-size:var(--text-xs);color:var(--gray-400)">또는 직접 입력:</div>` : ""}
          <input class="form-control" id="tpl-online-subject-input" placeholder="교육 항목명 직접 입력" style="margin-top:4px"/>
        </div>
        <div class="form-group" id="tpl-other-subjects" style="display:${preTraining?.trainingType === "other" ? "block" : "none"}">
          <label class="form-label form-label--required">교육 세부분류</label>
          ${otherItems.length ? `
          <select class="form-control" id="tpl-other-subject-select">
            <option value="">기존 항목 선택 또는 직접 입력</option>
            ${otherItems.map((i) => `<option value="${esc(i.subjectCode||i.id)}" data-name="${esc(i.subjectName||i.title)}" ${preTraining?.subjectCode === (i.subjectCode||i.id) ? "selected" : ""}>${esc(i.subjectName||i.title)}</option>`).join("")}
          </select>
          <div style="margin-top:4px;font-size:var(--text-xs);color:var(--gray-400)">또는 직접 입력:</div>` : ""}
          <input class="form-control" id="tpl-other-subject-input" placeholder="교육 항목명 직접 입력" style="margin-top:4px"/>
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
          let subjectCode = "", subjectName = "";
          if (trainingType === "job") {
            const sel = document.getElementById("tpl-job-subject");
            subjectCode = sel?.value ?? ""; subjectName = sel?.options[sel.selectedIndex]?.dataset?.name ?? "";
            if (!subjectCode) { toast.warning("교육 세부분류를 선택해 주세요."); return; }
          } else if (trainingType === "legal") {
            const sel = document.getElementById("tpl-legal-subject");
            subjectCode = sel?.value ?? ""; subjectName = sel?.options[sel.selectedIndex]?.dataset?.name ?? "";
            if (!subjectCode) { toast.warning("교육 세부분류를 선택해 주세요."); return; }
          } else if (trainingType === "online") {
            const sel = document.getElementById("tpl-online-subject-select");
            const inp = document.getElementById("tpl-online-subject-input");
            if (inp?.value?.trim()) { subjectName = inp.value.trim(); subjectCode = "online_custom"; }
            else if (sel?.value) { subjectCode = sel.value; subjectName = sel?.options[sel.selectedIndex]?.dataset?.name ?? sel.value; }
            if (!subjectName) { toast.warning("교육 세부분류를 선택하거나 입력해 주세요."); return; }
          } else if (trainingType === "other") {
            const sel = document.getElementById("tpl-other-subject-select");
            const inp = document.getElementById("tpl-other-subject-input");
            if (inp?.value?.trim()) { subjectName = inp.value.trim(); subjectCode = "other_custom"; }
            else if (sel?.value) { subjectCode = sel.value; subjectName = sel?.options[sel.selectedIndex]?.dataset?.name ?? sel.value; }
            if (!subjectName) { toast.warning("교육 세부분류를 선택하거나 입력해 주세요."); return; }
          }
          modal.setLoading("선택 항목 양식 다운로드", true);
          try {
            // 현재 지점 필터 반영
            const activeBranchId = preselectedBranchId || document.getElementById("ledger-branch")?.value || "";
            await downloadTypedTemplate({ trainingType, subjectCode, subjectName, overrideBranchId: activeBranchId });
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

  document.getElementById("tpl-training-type")?.addEventListener("change", (e) => {
    const type = e.target.value;
    ["job", "legal", "online", "other"].forEach((t) => {
      const el = document.getElementById(`tpl-${t}-subjects`);
      if (el) el.style.display = type === t ? "block" : "none";
    });
  });
  document.getElementById("tpl-online-subject-select")?.addEventListener("change", (e) => {
    if (e.target.value) document.getElementById("tpl-online-subject-input").value = "";
  });
  document.getElementById("tpl-other-subject-select")?.addEventListener("change", (e) => {
    if (e.target.value) document.getElementById("tpl-other-subject-input").value = "";
  });
}

/* ═══════════════════════════════════════════════════════
   Excel 양식 생성 + 다운로드
═══════════════════════════════════════════════════════ */
async function downloadTypedTemplate({ trainingType, subjectCode, subjectName, overrideBranchId = "" }) {
  const XLSX = await loadXlsx();
  const typeLabel = TRAINING_TYPE_LABELS[trainingType] ?? trainingType;
  const wb = XLSX.utils.book_new();

  // _meta 시트
  const metaWs = XLSX.utils.aoa_to_sheet([
    ["trainingType",    trainingType],
    ["subjectCode",     subjectCode],
    ["subjectName",     subjectName],
    ["typeLabel",       typeLabel],
    ["currentYear",     CY],
    ["previousYear",    PY],
    ["templateVersion", 1],
    ["generatedAt",     Date.now()],
  ]);
  XLSX.utils.book_append_sheet(wb, metaWs, "_meta");

  // 지점 필터 적용
  const branchId = overrideBranchId || document.getElementById("ledger-branch")?.value || "";
  const branch   = viewState.branches.find((b) => b.id === branchId) ?? null;
  const targets  = viewState.employees.filter((e) => branch ? matchesBranch(e, branchId) : true);

  const parseJoinDate = (emp) => {
    const raw = emp.joinDate ?? emp.hireDate ?? emp.joinedAt ?? emp.employmentDate ?? null;
    if (!raw) return null;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 1e11) return new Date(n);
    const d = new Date(String(raw));
    return isNaN(d.getTime()) ? null : d;
  };

  const infoRows = [
    [`[${typeLabel} — ${subjectName}] 개인 교육이력 등록 양식`],
    [`기준연도: ${CY}년 (전년도: ${PY}년 / 금년도: ${CY}년)`],
    ["※ 성명·사번은 수정하지 마세요. 날짜는 YYYY-MM-DD 형식으로 입력하세요. 복수 날짜는 쉼표 구분: 2026-01-15, 2026-07-20"],
    [],
    ["성명", "사번", "입사일", "직급/직책", "초기교육", "최종교육일", `${PY}년`, `${CY}년`, "비고"],
  ];

  const dataRows = targets.map((emp) => [
    emp.name ?? "",
    String(emp.empNo ?? ""),
    parseJoinDate(emp),
    emp.position ?? "",
    null, null, null, null, "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([...infoRows, ...dataRows], { cellDates: true, dateNF: "yyyy-mm-dd" });
  ws["!cols"] = [
    { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 20 },
  ];

  const colName = (idx) => { let n = ""; let i = idx; do { n = String.fromCharCode(65 + (i % 26)) + n; i = Math.floor(i / 26) - 1; } while (i >= 0); return n; };
  const DATA_START = 6; const DATA_END = DATA_START + dataRows.length - 1;
  for (let r = DATA_START; r <= DATA_END; r++) {
    for (const c of [2, 4, 5, 6, 7]) {
      const addr = `${colName(c)}${r}`;
      if (!ws[addr]) ws[addr] = { t: "z", v: undefined, z: "yyyy-mm-dd" };
      else ws[addr].z = "yyyy-mm-dd";
    }
    const ea = `${colName(1)}${r}`;
    if (ws[ea]) ws[ea].t = "s";
  }

  XLSX.utils.book_append_sheet(wb, ws, "개인교육이력");
  const safe = subjectName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  XLSX.writeFile(wb, `${CY}_${typeLabel}_${safe}_이력양식.xlsx`);
}

/* ═══════════════════════════════════════════════════════
   인라인 Excel 업로드
═══════════════════════════════════════════════════════ */
async function parseHistoryUploadFileInline(event) {
  const file      = event.target.files?.[0];
  const filenameEl = document.getElementById("history-upload-filename");
  const previewEl  = document.getElementById("history-upload-preview-inline");
  const submitBtn  = document.getElementById("btn-history-upload-submit");
  const resultEl   = document.getElementById("history-upload-result");

  if (filenameEl) filenameEl.textContent = file ? file.name : "선택된 파일 없음";
  if (resultEl)   resultEl.textContent = "";
  if (submitBtn)  submitBtn.disabled = true;
  pendingHistoryRows = []; selectedTemplateMeta = null;
  if (!file || !previewEl) return;
  previewEl.innerHTML = `<div style="padding:var(--space-4);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">파일을 분석하는 중...</div>`;

  try {
    const XLSX = await loadXlsx();
    const wb   = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });

    // _meta
    const metaSheet = wb.Sheets["_meta"];
    if (!metaSheet) { previewEl.innerHTML = metaError("지원하지 않는 양식입니다. 교육 항목을 선택하여 새 양식을 다운로드해 주세요."); return; }
    const metaMap = {};
    XLSX.utils.sheet_to_json(metaSheet, { header: 1, defval: "" }).forEach(([k, v]) => { if (k) metaMap[k] = v; });
    const { trainingType, subjectCode, subjectName, typeLabel, currentYear, previousYear } = metaMap;
    if (!trainingType || !currentYear) { previewEl.innerHTML = metaError("양식 메타데이터가 손상되었습니다. 새 양식을 다운로드해 주세요."); return; }

    const metaCY = Number(currentYear), metaPY = Number(previousYear);
    selectedTemplateMeta = { trainingType, subjectCode, subjectName, typeLabel, currentYear: metaCY, previousYear: metaPY };

    // 데이터 시트
    const dataSheet = wb.Sheets[wb.SheetNames.find((n) => n !== "_meta") ?? wb.SheetNames[0]];
    const allRows   = XLSX.utils.sheet_to_json(dataSheet, { header: 1, defval: "" });

    const normCell = (v) => String(v ?? "").trim();
    let hIdx = allRows.findIndex((r) => { const c = r.map(normCell); return c.includes("성명") && c.includes("사번"); });
    if (hIdx < 0) hIdx = 4;
    const headers = allRows[hIdx].map(normCell);

    const col = {
      name:     headers.indexOf("성명"),
      empNo:    headers.indexOf("사번"),
      joinDate: headers.indexOf("입사일"),
      position: headers.findIndex((h) => h.includes("직급") || h.includes("직책")),
      initial:  headers.findIndex((h) => h.includes("초기")),
      lastDate: headers.findIndex((h) => h.includes("최종")),
      prev:     headers.findIndex((h) => h.includes(String(metaPY))),
      curr:     headers.findIndex((h) => h.includes(String(metaCY))),
      note:     headers.indexOf("비고"),
    };

    const dataRaw = allRows.slice(hIdx + 1).filter((r) => {
      const n = normCell(r[col.name]); const e = normCell(r[col.empNo]); return n !== "" || e !== "";
    });

    const safeEmpNo = (v) => (v === null || v === undefined) ? "" : String(v).trim();
    const empByNo   = new Map(viewState.employees.map((e) => [safeEmpNo(e.empNo), e]));

    pendingHistoryRows = dataRaw.map((row, i) => {
      const getStr = (idx) => idx >= 0 ? normCell(row[idx]) : "";
      const getRaw = (idx) => idx >= 0 ? row[idx] ?? "" : "";
      const name     = getStr(col.name);
      const empNo    = safeEmpNo(getRaw(col.empNo));
      const joinDate = xlDateToYMD(getRaw(col.joinDate));
      const position = getStr(col.position);
      const note     = getStr(col.note);

      const errors = [];
      if (!name)  errors.push("성명 누락");
      if (!empNo) errors.push("사번 누락");
      const emp = empNo ? empByNo.get(empNo) : null;
      if (empNo && !emp) errors.push("존재하지 않는 사번");
      else if (emp && name && emp.name !== name) errors.push("사번과 성명 불일치");

      const parsedInitial = parseDateCells(getRaw(col.initial),  null,    null,    errors, "초기교육");
      const parsedPrev    = parseDateCells(getRaw(col.prev),     metaPY,  metaPY,  errors, `${metaPY}년`);
      const parsedCurr    = parseDateCells(getRaw(col.curr),     metaCY,  metaCY,  errors, `${metaCY}년`);
      const parsedLast    = xlDateToYMD(getRaw(col.lastDate));

      const allDates = [...parsedInitial, ...parsedPrev, ...parsedCurr];
      const skip     = allDates.length === 0 && errors.length === 0;

      return {
        _rowNum: hIdx + 1 + i + 2, _skip: skip, _errors: errors,
        name, empNo, joinDate, position, note,
        uid: emp?.id ?? emp?.uid ?? "",
        initialDates: parsedInitial, prevYearDates: parsedPrev, currYearDates: parsedCurr, lastDate: parsedLast,
      };
    });

    const nonSkipped = pendingHistoryRows.filter((r) => !r._skip);
    const invalid    = nonSkipped.filter((r) => r._errors.length);
    const valid      = nonSkipped.filter((r) => !r._errors.length);
    const skippedCnt = pendingHistoryRows.filter((r) => r._skip).length;

    previewEl.innerHTML = `
      <div style="margin-bottom:var(--space-2)">
        <span style="font-size:var(--text-sm);font-weight:var(--weight-semibold)">${esc(typeLabel ?? trainingType)} — ${esc(subjectName)}</span>
        <span style="font-size:var(--text-xs);color:var(--gray-400);margin-left:var(--space-2)">(${metaPY}년 / ${metaCY}년)</span>
      </div>
      <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-3);flex-wrap:wrap">
        <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm)">전체 <strong>${nonSkipped.length}건</strong></div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm);color:#15803d">정상 <strong>${valid.length}건</strong></div>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm);color:#c2410c">오류 <strong>${invalid.length}건</strong></div>
        ${skippedCnt ? `<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm);color:var(--gray-400)">건너뜀 <strong>${skippedCnt}건</strong></div>` : ""}
      </div>
      <div class="table-wrap" style="max-height:320px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius-md)">
        <table class="data-table" style="min-width:900px">
          <thead><tr>
            <th>행</th><th>성명</th><th>사번</th><th>입사일</th><th>직급/직책</th>
            <th>초기교육</th><th>최종교육일</th><th>${metaPY}년</th><th>${metaCY}년</th>
            <th>비고</th><th>이력 수</th><th>검증</th>
          </tr></thead>
          <tbody>
            ${pendingHistoryRows.map((r) => {
              const cnt = r.initialDates.length + r.prevYearDates.length + r.currYearDates.length;
              return `<tr style="background:${r._errors.length ? "#fff7ed" : r._skip ? "#f9fafb" : ""}">
                <td style="color:var(--gray-400);text-align:center">${r._rowNum}</td>
                <td>${esc(r.name)}</td>
                <td style="font-family:monospace;font-size:var(--text-xs)">${esc(r.empNo)}</td>
                <td style="font-size:var(--text-xs)">${esc(r.joinDate || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(r.position || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(r.initialDates.join(", ") || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(r.lastDate || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(r.prevYearDates.join(", ") || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(r.currYearDates.join(", ") || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(r.note || "–")}</td>
                <td style="text-align:center;font-size:var(--text-xs)">${r._skip ? "–" : cnt}</td>
                <td>${r._skip
                  ? `<span style="color:var(--gray-400);font-size:var(--text-xs)">건너뜀</span>`
                  : r._errors.length
                    ? `<span style="color:#c2410c;font-size:var(--text-xs)">${esc(r._errors.join(" / "))}</span>`
                    : `<span style="color:#15803d;font-size:var(--text-xs)">✓ 정상</span>`
                }</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;

    if (submitBtn) submitBtn.disabled = valid.length === 0;
  } catch (err) {
    console.error("[employees] parseHistoryUploadFileInline", err);
    pendingHistoryRows = []; selectedTemplateMeta = null;
    previewEl.innerHTML = metaError("파일을 읽지 못했습니다. xlsx 형식인지 확인해 주세요.");
  }
}

async function submitHistoryUploadInline() {
  const submitBtn = document.getElementById("btn-history-upload-submit");
  const resultEl  = document.getElementById("history-upload-result");
  if (!selectedTemplateMeta) { toast.warning("먼저 교육 항목 양식의 Excel 파일을 선택해 주세요."); return; }

  const { trainingType, subjectCode, subjectName } = selectedTemplateMeta;
  const validRows = pendingHistoryRows.filter((r) => !r._skip && !r._errors.length);
  if (!validRows.length) { toast.warning("업로드할 수 있는 정상 행이 없습니다."); return; }

  const historyEntries = [];
  for (const row of validRows) {
    const stages = [
      ...row.initialDates.map((d)  => ({ completedAt: d, educationStage: "initial",      educationType: "initial" })),
      ...row.prevYearDates.map((d) => ({ completedAt: d, educationStage: "previous_year", educationType: "recurrent" })),
      ...row.currYearDates.map((d) => ({ completedAt: d, educationStage: "current_year",  educationType: "recurrent" })),
    ];
    for (const { completedAt, educationStage, educationType } of stages) {
      historyEntries.push({
        empNo: row.empNo, employeeName: row.name,
        trainingType, subjectCode, subjectName,
        title: subjectName, courseName: subjectName,
        completedAt, educationStage, educationType,
        source: "manual_excel", note: row.note ?? "", cycleMonths: 0,
      });
    }
  }

  if (!historyEntries.length) { toast.warning("업로드할 날짜가 없습니다."); return; }
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "업로드 중..."; }
  if (resultEl)  resultEl.textContent = "";

  try {
    const result = await bulkImportManualTrainingHistories({ rows: historyEntries });
    const msg = `✅ 등록 ${result.succeededCount ?? 0}건 · 중복 ${result.skippedCount ?? 0}건 · 실패 ${result.failedCount ?? 0}건`;
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--color-success,#16a34a)">${esc(msg)}</span>`;
    toast.success(msg);
    // 초기화
    pendingHistoryRows = []; selectedTemplateMeta = null;
    const fi = document.getElementById("history-upload-file-inline"); if (fi) fi.value = "";
    const fn = document.getElementById("history-upload-filename"); if (fn) fn.textContent = "선택된 파일 없음";
    const pr = document.getElementById("history-upload-preview-inline");
    if (pr) pr.innerHTML = `<div style="background:var(--gray-50);border:1px dashed var(--gray-300);border-radius:var(--radius-md);padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">업로드가 완료되었습니다. 다음 파일을 선택하세요.</div>`;
  } catch (err) {
    console.error("[employees] submitHistoryUploadInline", err);
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--color-danger,#dc2626)">${esc(err?.message || "업로드에 실패했습니다.")}</span>`;
    toast.error(err?.message || "업로드에 실패했습니다.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><path d="M8 10V2m0 0L5 5m3-3l3 3M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>이력 업로드`;
    }
  }
}

/* ═══════════════════════════════════════════════════════
   날짜 유틸
═══════════════════════════════════════════════════════ */
const _SN_MIN = 60, _SN_MAX = 2958465;

function formatDateYMD(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function _rawToYmd(v) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : formatDateYMD(v.getTime());
  if (typeof v === "number" && v >= _SN_MIN && v <= _SN_MAX) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? "" : formatDateYMD(d.getTime());
  }
  const s = String(v).trim().replace(/[./]/g, "-");
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : formatDateYMD(d.getTime());
}

function xlDateToYMD(v) { return _rawToYmd(v); }

function parseDateCell(v) { return _rawToYmd(v); }

function parseDateCells(value, minYear, maxYear, errors, label) {
  if (value === null || value === undefined || value === "") return [];
  if (value instanceof Date || (typeof value === "number" && value >= _SN_MIN && value <= _SN_MAX)) {
    const ymd = _rawToYmd(value);
    if (!ymd) { errors.push(`${label} 날짜 형식 오류`); return []; }
    if (minYear !== null && maxYear !== null) {
      const year = Number(ymd.slice(0, 4));
      if (year < minYear || year > maxYear) { errors.push(`${label} 연도 오류 (${year}년 입력, ${minYear}년 날짜만 허용)`); return []; }
    }
    return [ymd];
  }
  const s = String(value).trim();
  if (!s) return [];
  const results = [];
  for (const part of s.split(/[,，、]/)) {
    const trimmed = part.trim(); if (!trimmed) continue;
    const ymd = _rawToYmd(trimmed);
    if (!ymd) { errors.push(`${label} 날짜 형식 오류: ${trimmed}`); continue; }
    if (minYear !== null && maxYear !== null) {
      const year = Number(ymd.slice(0, 4));
      if (year < minYear || year > maxYear) { errors.push(`${label} 연도 오류 (${year}년 입력, ${minYear}년 날짜만 허용)`); continue; }
    }
    results.push(ymd);
  }
  return results;
}

/* ═══════════════════════════════════════════════════════
   헬퍼
═══════════════════════════════════════════════════════ */
async function loadXlsx() { return import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"); }

function matchesBranch(employee, branchId) {
  return String(employee.branchId ?? "") === String(branchId);
}

function metaError(msg) {
  return `<div style="color:var(--color-danger,#dc2626);padding:var(--space-4);font-size:var(--text-sm);border:1px solid #fecaca;border-radius:var(--radius-md);background:#fff1f2">${esc(msg)}</div>`;
}

function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
