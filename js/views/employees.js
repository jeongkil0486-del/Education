/**
 * 직원관리대장 (employees.js)
 * - 지점 + 교육 항목 선택 후 조회
 * - 4개 요약 카드 (전체/30일이내/7일이내/기한초과) + 클릭 필터
 * - 체크박스 선택 + Excel 이력 초기화
 * - 직원 정보 수정 (HQ_ADMIN)
 * - 재교육 주기 설정 (HQ_ADMIN)
 * - Excel 양식 다운로드 / 업로드
 * - HQ_ADMIN: 전체 기능, SUPER_ADMIN: 조회만
 */

import { router } from "../core/router.js";
import {
  loadTrainingReferences,
  listManagedItems,
  applyDueMetadata,
  TRAINING_SUBJECT_OPTIONS,
  TRAINING_TYPE_LABELS,
  buildSelectableTrainingItems,
  normalizeTrainingType,
} from "../services/training-service.js";
import {
  bulkImportManualTrainingHistories,
  updateEmployeeManagementProfile,
  resetSelectedManualTrainingHistories,
  saveEducationCycleConfig,
  replaceEmployeeManualTrainingHistories,
  getEducationCycleConfig,
} from "../core/admin-api.js";
import { manualTrainingHistoriesDB, sessionCompletionsDB, educationCycleConfigsDB } from "../core/db.js";
import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { authStore, ROLES } from "../core/auth.js";

/* ─── 상수 ─────────────────────────────────────────────── */
const CY = new Date().getFullYear();
const PY = CY - 1;

/* ─── 모듈 상태 ─────────────────────────────────────────── */
let viewState = { company: null, branches: [], employees: [], items: [] };
let pendingHistoryRows   = [];
let selectedTemplateMeta = null;
let ledgerRows    = [];
let ledgerFilter  = "all";   // all | soon30 | soon7 | overdue
let ledgerSearch  = "";
let ledgerSort    = { key: "", direction: "none" }; // none | asc | desc
let selectedUids  = new Set();
let currentLedgerMeta = null;   // { branchId, branchLabel, trainingVal, trainingMeta, cycleMonths }

async function refreshViewState() {
  const [references, items] = await Promise.all([
    loadTrainingReferences(),
    listManagedItems().catch(() => []),
  ]);

  viewState = {
    company: references.company ?? null,
    branches: [...(references.branches ?? [])].sort((a, b) =>
      String(a.name ?? a.code ?? "").localeCompare(String(b.name ?? b.code ?? ""), "ko")),
    employees: [...(references.employees ?? [])].sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko")),
    items,
  };
}

function getSelectedBranch() {
  const branchId = document.getElementById("ledger-branch")?.value ?? "";
  return viewState.branches.find((branch) => String(branch.id) === String(branchId)) ?? null;
}

function getSelectedTrainingMeta() {
  return parseTrainingValue(document.getElementById("ledger-training")?.value ?? "");
}

function getEffectiveCompanyId(trainingMeta = getSelectedTrainingMeta(), branch = getSelectedBranch()) {
  const itemCompanyId = trainingMeta?.itemId
    ? viewState.items.find((item) => item.id === trainingMeta.itemId)?.companyId
    : null;
  const candidateCompanyIds = new Set([
    ...viewState.branches.map((item) => item?.companyId),
    ...viewState.items.map((item) => item?.companyId),
  ].map((value) => String(value ?? "").trim()).filter(Boolean));

  return String(
    authStore.companyId ??
    branch?.companyId ??
    itemCompanyId ??
    viewState.company?.id ??
    (candidateCompanyIds.size === 1 ? [...candidateCompanyIds][0] : null) ??
    ""
  ).trim();
}

/* ═══════════════════════════════════════════════════════
   render
═══════════════════════════════════════════════════════ */
export async function render(container) {
  const isHQAdmin = authStore.role === ROLES.HQ_ADMIN;

  container.innerHTML = `<div style="padding:var(--space-2);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">로딩 중...</div>`;

  try {
    await refreshViewState();
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="padding:var(--space-16)"><div class="empty-state__title">데이터를 불러오지 못했습니다.</div></div>`;
    console.error("[employees] init error", err);
    return;
  }

  const trainingOptions = buildTrainingOptions(viewState.items);

  container.innerHTML = `
    <!-- 헤더 -->
    <div class="section-header">
      <div>
        <div class="section-title">직원관리대장</div>
        <div class="section-subtitle">지점과 교육 항목을 선택하여 직원별 교육 현황을 관리합니다.</div>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center">
        ${isHQAdmin ? `
          <button class="btn btn--secondary btn--sm" id="btn-history-template">양식 다운로드</button>
          <button class="btn btn--secondary btn--sm" id="btn-cycle-config">재교육 주기 설정</button>
        ` : ""}
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
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:var(--space-3);align-items:end">
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
      <!-- 요약 카드 4개 (클릭 필터) -->
      <div id="ledger-summary" style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-3);margin-bottom:var(--space-4)"></div>

      <!-- 결과 테이블 -->
      <div class="card">
        <div class="card__header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-2)">
          <div>
            <div class="card__title" id="ledger-title">관리대장</div>
            <div class="card__subtitle" id="ledger-subtitle"></div>
          </div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center">
            ${isHQAdmin ? `<button class="btn btn--danger btn--sm" id="btn-reset-history" disabled>초기화</button>` : ""}
            <div class="input-group" style="width:200px">
              <svg class="input-group__icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>
              <input class="form-control" id="ledger-search" type="search" placeholder="이름·사번 검색"/>
            </div>
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
  if (isHQAdmin) {
    document.getElementById("upload-card-toggle")?.addEventListener("click", () => {
      const body    = document.getElementById("upload-card-body");
      const chevron = document.getElementById("upload-chevron");
      const open    = body.style.display === "none";
      body.style.display      = open ? "block" : "none";
      chevron.style.transform = open ? "rotate(180deg)" : "";
    });
    document.getElementById("btn-history-template")?.addEventListener("click", () => {
      const branchId    = document.getElementById("ledger-branch")?.value ?? "";
      const trainingVal = document.getElementById("ledger-training")?.value ?? "";
      openTemplateSelectModal(branchId, trainingVal);
    });
    document.getElementById("history-upload-file-inline")?.addEventListener("change", parseHistoryUploadFileInline);
    document.getElementById("btn-history-upload-submit")?.addEventListener("click", submitHistoryUploadInline);
    document.getElementById("btn-reset-history")?.addEventListener("click", openResetConfirmModal);
    document.getElementById("btn-cycle-config")?.addEventListener("click", openCycleConfigModal);
  }

  const branchSel   = document.getElementById("ledger-branch");
  const trainingSel = document.getElementById("ledger-training");
  const searchBtn   = document.getElementById("btn-ledger-search");

  const checkBtnState = () => {
    const ok = !!(branchSel?.value && trainingSel?.value);
    if (searchBtn) searchBtn.disabled = !ok;
    if (isHQAdmin) {
      const cycleBtn = document.getElementById("btn-cycle-config");
      if (cycleBtn) cycleBtn.disabled = false;
    }
  };
  branchSel?.addEventListener("change", () => { selectedUids.clear(); checkBtnState(); });
  trainingSel?.addEventListener("change", () => { selectedUids.clear(); checkBtnState(); });

  searchBtn?.addEventListener("click", runLedgerQuery);

  document.getElementById("ledger-search")?.addEventListener("input", (e) => {
    ledgerSearch = e.target.value.trim().toLowerCase();
    renderLedgerTable();
  });
}

/* ═══════════════════════════════════════════════════════
   교육 옵션 목록 빌드
═══════════════════════════════════════════════════════ */
function buildTrainingOptions(items) {
  return buildSelectableTrainingItems(items).map((item) => ({
    ...item,
    value: `${item.trainingType}|${item.subjectCode || item.itemId || item.normalizedKey}`,
    label: `${TRAINING_TYPE_LABELS[item.trainingType] ?? "기타"} - ${item.displayName}`,
  }));
}

function parseTrainingValue(val) {
  if (!val) return null;
  const allOpts = buildTrainingOptions(viewState.items);
  return allOpts.find((o) => o.value === val) ?? null;
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
    const branch       = viewState.branches.find((b) => b.id === branchId);
    const branchLabel  = branch?.name ?? branch?.code ?? branchId;
    const trainingLabel = trainingMeta?.label ?? trainingVal;
    const effectiveCompanyId = getEffectiveCompanyId(trainingMeta, branch);

    // 재교육 주기 설정 조회
    let cycleMonths = 0;
    let defaultDuration = 0;
    let resolvedCycleConfig = null;
    try {
      const config = await loadEducationCycleConfig(effectiveCompanyId, trainingMeta);
      resolvedCycleConfig = config;
      cycleMonths = Number(config?.cycleMonths ?? 0) || 0;
      defaultDuration = Number(config?.defaultDuration ?? 0) || 0;
      // trainingItem 자체 cycleMonths도 폴백
      if (!cycleMonths && trainingMeta?.itemId) {
        const item = viewState.items.find((i) => i.id === trainingMeta.itemId);
        cycleMonths = Number(item?.cycleMonths ?? 0) || 0;
      }
    } catch (e) { /* cycleMonths 조회 실패 무시 */ }

    currentLedgerMeta = { branchId, branchLabel, trainingVal, trainingMeta, cycleMonths, defaultDuration, companyId: effectiveCompanyId };

    const branchEmployees = viewState.employees.filter((e) => matchesBranch(e, branchId));
    const [manualAll, sessionAll] = await Promise.all([
      manualTrainingHistoriesDB.listAll().catch(() => []),
      fetchAllSessionCompletions(),
    ]);

    const allHistories = [...manualAll, ...sessionAll];
    const relevant = filterByTraining(allHistories, trainingMeta);
    const selectedTrainingKey = canonicalLedgerMetaKey(trainingMeta);
    const instructorHistories = allHistories
      .filter((history) => canonicalLedgerRecordKey(history) === LEDGER_JOB_INSTRUCTOR_KEY);
    const ledgerEmployees = selectedTrainingKey === LEDGER_JOB_INSTRUCTOR_KEY
      ? branchEmployees.filter((employee) => relevant.some((history) => historyBelongsToEmployee(history, employee)))
      : selectedTrainingKey === LEDGER_JOB_DUTY_KEY
        ? branchEmployees.filter((employee) => !instructorHistories.some((history) => historyBelongsToEmployee(history, employee)))
        : branchEmployees;
    ledgerRows = aggregateLedger(ledgerEmployees, relevant, trainingMeta, cycleMonths);
    logLedgerMatchDiagnostics({
      trainingMeta,
      selectedTrainingKey,
      allHistories,
      relevant,
      branchEmployees,
      ledgerEmployees,
      ledgerRows,
      cycleConfigLookupKeys: educationCycleLookupKeys(trainingMeta),
      resolvedCycleConfig,
    });

    document.getElementById("ledger-title").textContent = `${branchLabel} · ${trainingLabel}`;
    document.getElementById("ledger-subtitle").textContent = `기준연도: ${CY}년${cycleMonths ? ` · 재교육 주기: ${cycleMonths}개월` : " · 재교육 주기: 미설정"}`;

    selectedUids.clear();
    document.getElementById("ledger-empty-guide").style.display = "none";
    document.getElementById("ledger-result").style.display = "block";
    ledgerFilter = "all";
    ledgerSearch = "";
    ledgerSort = { key: "", direction: "none" };
    const srch = document.getElementById("ledger-search");
    if (srch) srch.value = "";

    renderLedgerSummary();
    renderLedgerTable();
    updateResetBtn();
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

const LEDGER_JOB_INSTRUCTOR_KEY = "job_instructor";
const LEDGER_JOB_DUTY_KEY = "job_duty";

function normalizeLedgerTrainingKey(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]+/g, "");
}

function historyEmployeeUid(record) {
  return String(
    record?.employeeUid
    ?? record?.uid
    ?? record?.userId
    ?? record?.employeeId
    ?? record?.staffUid
    ?? ""
  ).trim();
}

function normalizedEmployeeNumber(record) {
  return normalizeLedgerTrainingKey(record?.empNo ?? record?.employeeNo ?? "");
}

function resolveEmployeeIdentityKeys(employee) {
  const keys = new Set();
  for (const value of [
    employee?.id,
    employee?.uid,
    employee?.employeeUid,
    employee?.userId,
    employee?.employeeId,
    employee?.staffUid,
  ]) {
    const uid = String(value ?? "").trim();
    if (uid) keys.add(`uid:${uid}`);
  }
  const empNo = normalizedEmployeeNumber(employee);
  if (empNo) keys.add(`emp:${empNo}`);
  return keys;
}

function resolveHistoryEmployeeIdentity(row) {
  const keys = new Set();
  for (const value of [
    row?.employeeUid,
    row?.uid,
    row?.userId,
    row?.employeeId,
    row?.staffUid,
  ]) {
    const uid = String(value ?? "").trim();
    if (uid) keys.add(`uid:${uid}`);
  }
  const empNo = normalizedEmployeeNumber(row);
  if (empNo) keys.add(`emp:${empNo}`);
  return keys;
}

function historyBelongsToEmployee(row, employee) {
  const historyKeys = resolveHistoryEmployeeIdentity(row);
  for (const key of resolveEmployeeIdentityKeys(employee)) {
    if (historyKeys.has(key)) return true;
  }
  return false;
}

function ledgerHistoryNote(record) {
  return record?.note
    ?? record?.memo
    ?? record?.remark
    ?? record?.remarks
    ?? record?.comment
    ?? record?.comments
    ?? record?.["비고"]
    ?? "";
}

function canonicalLedgerKey(value) {
  const raw = normalizeLedgerTrainingKey(value);
  if (["jobinstructor", "사내강사", "사내강사양성과정", "instructortraining"].includes(raw)
    || (raw.includes("사내강사") && (raw.includes("양성교육") || raw.includes("양성과정")))) {
    return LEDGER_JOB_INSTRUCTOR_KEY;
  }
  if ([
    "jobduty", "jobinitial", "jobrecurrent", "jobrecurring",
    "직무", "직무교육", "직무초기교육", "직무보수교육",
  ].includes(raw)) return LEDGER_JOB_DUTY_KEY;
  if (["jobwb", "wb", "weightbalance", "탑재관리"].includes(raw) || raw.includes("탑재관리")) return "job_wb";
  if ([
    "joboperations", "flightoperations", "운항관리", "운항담당",
    "운항관리사", "운항통제", "flightdispatch",
  ].includes(raw) || raw.includes("운항담당자")) return "job_operations";
  if (["legalsms", "sms", "sms교육", "safetymanagementsystem", "안전관리시스템", "안전관리시스템교육"].includes(raw)) {
    return "legal_sms";
  }
  if (["legalsecurity", "항공보안", "항공보안교육", "aviationsecurity", "보안교육"].includes(raw)
    || raw.includes("항공보안") || raw.includes("aviationsecurity")) {
    return "legal_security";
  }
  if ([
    "legaldangerousgoods", "위험물", "위험물규정", "위험물교육",
    "dangerousgoods", "dangerousgoodsregulation", "dangerousgoodsregulations", "dg", "dgr",
  ].includes(raw)) return "legal_dangerous_goods";
  return raw;
}

function ledgerRecordKeys(record) {
  const keys = [
    record?.canonicalCourseKey,
    record?.subjectCode,
    record?.canonicalCourseName,
    record?.courseName,
    record?.title,
    record?.subjectName,
  ].map(canonicalLedgerKey).filter(Boolean);
  return new Set(keys);
}

function canonicalLedgerRecordKey(record) {
  const type = normalizeTrainingType(record?.trainingType);
  const noteKey = normalizeLedgerTrainingKey(ledgerHistoryNote(record));
  if (type === "job" && noteKey === "직무사내강사") return LEDGER_JOB_INSTRUCTOR_KEY;

  const keys = ledgerRecordKeys(record);
  const knownKeys = [
    LEDGER_JOB_INSTRUCTOR_KEY,
    LEDGER_JOB_DUTY_KEY,
    "job_wb",
    "job_operations",
    "legal_sms",
    "legal_security",
    "legal_dangerous_goods",
  ];
  for (const key of knownKeys) {
    if (keys.has(key)) return key;
  }
  return keys.values().next().value ?? "";
}

function canonicalLedgerMetaKey(meta) {
  return canonicalLedgerKey(meta?.subjectCode || meta?.normalizedKey || meta?.subjectName);
}

function filterByTraining(histories, meta) {
  if (!meta) return [];
  const selectedKey = canonicalLedgerMetaKey(meta);
  return histories.filter((history) => {
    if (!history) return false;
    const recordKey = canonicalLedgerRecordKey(history);
    if (selectedKey === LEDGER_JOB_INSTRUCTOR_KEY) return recordKey === LEDGER_JOB_INSTRUCTOR_KEY;
    if (recordKey === LEDGER_JOB_INSTRUCTOR_KEY) return false;
    const recordKeys = ledgerRecordKeys(history);

    // Canonical aliases are the primary identity. Historical rows may have a stale
    // trainingType or a different itemId even though they represent the same item.
    if (recordKey === selectedKey || recordKeys.has(selectedKey)) return true;
    if (meta.itemId && history.itemId && String(history.itemId) === String(meta.itemId)) return true;
    return false;
  });
}

function logLedgerMatchDiagnostics({
  trainingMeta,
  selectedTrainingKey,
  allHistories,
  relevant,
  branchEmployees,
  ledgerEmployees,
  ledgerRows,
  cycleConfigLookupKeys,
  resolvedCycleConfig,
}) {
  const perEmployeeMatchedCount = branchEmployees
    .map((employee) => {
      const uid = String(employee.id ?? employee.uid ?? "");
      const matchedCount = relevant.filter((history) => historyBelongsToEmployee(history, employee)).length;
      return { uid, empNo: employee.empNo ?? employee.employeeNo ?? "", name: employee.name ?? "", matchedCount };
    })
    .sort((a, b) => b.matchedCount - a.matchedCount)
    .slice(0, 10);

  const diagnosticKeys = [
    LEDGER_JOB_DUTY_KEY,
    LEDGER_JOB_INSTRUCTOR_KEY,
    "job_wb",
    "job_operations",
    "legal_sms",
    "legal_security",
    "legal_dangerous_goods",
  ];
  const options = buildTrainingOptions(viewState.items);
  const keySamples = Object.fromEntries(diagnosticKeys.map((key) => {
    const meta = options.find((option) => canonicalLedgerMetaKey(option) === key);
    const matches = meta ? filterByTraining(allHistories, meta) : [];
    return [key, {
      selectedValue: meta?.value ?? "",
      matchedCount: matches.length,
      matchedKeys: [...new Set(matches.slice(0, 5).flatMap((history) => [...ledgerRecordKeys(history)]))],
    }];
  }));
  const rowsWithHistory = (ledgerRows ?? []).filter((row) => row.hasHistory);
  const recurrentRows = rowsWithHistory.filter((row) => row._hasRecurrent);
  const initialOnlyRows = rowsWithHistory.filter((row) => row._initialOnly);
  const cycleConfiguredRows = rowsWithHistory.filter((row) => row.cycleMonths > 0 && row._cycleBaseDate);
  const failedDueRows = cycleConfiguredRows.filter((row) => !row.nextDueDate);

  console.info("[employees] ledger match diagnostics", {
    selectedTrainingItem: trainingMeta,
    selectedCanonicalKey: selectedTrainingKey,
    selectedSubjectCode: trainingMeta?.subjectCode ?? "",
    selectedSubjectName: trainingMeta?.subjectName ?? "",
    allEmployeesCount: branchEmployees.length,
    allHistoryRowsCount: allHistories.length,
    matchedHistoryRowsCount: relevant.length,
    matchedHistoryRowsSample: relevant.slice(0, 10).map((row) => ({
      id: row?.id ?? row?.historyId ?? "",
      source: row?._source ?? row?.source ?? "manual",
      employeeUid: historyEmployeeUid(row),
      trainingType: row?.trainingType ?? "",
      stage: row?.stage ?? "",
      trainingStage: row?.trainingStage ?? "",
      subType: row?.subType ?? "",
      courseStage: row?.courseStage ?? "",
      isInitial: row?.isInitial ?? null,
      resolvedStage: ledgerRecordStage(row),
      courseName: row?.courseName ?? row?.title ?? "",
      subjectName: row?.subjectName ?? "",
      canonicalKey: canonicalLedgerRecordKey(row),
      educationYear: row?.educationYear ?? null,
      educationStage: row?.educationStage ?? "",
      completedAt: row?.completedAt ?? null,
      startDate: row?.startDate ?? null,
      endDate: row?.endDate ?? null,
    })),
    perEmployeeMatchedCount,
    finalRenderedCount: ledgerEmployees.length,
    aggregateCounts: {
      employees: ledgerEmployees.length,
      matchedHistoryZero: ledgerEmployees.length - rowsWithHistory.length,
      initialOnly: initialOnlyRows.length,
      recurrent: recurrentRows.length,
      cycleConfigFound: cycleConfiguredRows.length,
      nextDueDateCalculated: cycleConfiguredRows.filter((row) => row.nextDueDate).length,
      eligibleWithConfigButNoDue: failedDueRows.length,
    },
    eligibleWithConfigButNoDue: failedDueRows.map((row) => ({
      name: row.name,
      empNo: row.empNo,
      uid: row.uid,
      canonicalKey: selectedTrainingKey,
      matchedRows: relevant.filter((history) => historyBelongsToEmployee(history, row._emp)).length,
      latestRecurrentDate: row._latestRecurrentDate,
      cycleBaseDate: row._cycleBaseDate,
      latestHistoryStage: ledgerRecordStage(row._latestHistory),
      cycleMonths: row.cycleMonths,
      reason: row._dueReason,
    })),
    cycleConfigLookupKeys,
    resolvedCycleConfig: resolvedCycleConfig ? {
      cycleMonths: resolvedCycleConfig.cycleMonths ?? 0,
      defaultDuration: resolvedCycleConfig.defaultDuration ?? 0,
    } : null,
    displayedYearValues: (ledgerRows ?? []).filter((row) => row.hasHistory).slice(0, 10).map((row) => ({
      employeeUid: row.uid,
      empNo: row.empNo,
      computedYearValues: { [PY]: row.prevDates, [CY]: row.currDates },
      computedInitialDate: row.initialDate,
      computedLatestDate: row.lastDate,
      latestRecurrentDate: row._latestRecurrentDate,
      cycleBaseDate: row._cycleBaseDate,
      latestHistoryStage: ledgerRecordStage(row._latestHistory),
      nextDueDate: row.nextDueDate,
      remainingDays: row.daysRemaining,
      status: row.dueStatusLabel,
      note: row.note,
      reason: row._dueReason,
    })),
    keySamples,
  });
}

function ledgerRecordStage(record) {
  const values = [
    record?.stage,
    record?.trainingStage,
    record?.type,
    record?.subType,
    record?.educationStage,
    record?.courseStage,
    record?.educationType,
    record?.initialRecurrent,
    record?.initialOrRecurrent,
    record?.trainingPhase,
  ].map((value) => normalizeLedgerTrainingKey(value)).filter(Boolean);

  const recurrentValues = new Set([
    "recurrent", "recurring", "regular", "renewal", "refresher", "retraining", "recurrenttraining",
    "보수", "보수교육", "정기", "정기교육", "갱신", "갱신교육", "재교육",
  ]);
  if (values.some((value) => recurrentValues.has(value) || /^year\d{4}$/.test(value))) {
    return "recurrent";
  }

  const initialValues = new Set(["initial", "초기", "초기교육", "입문", "입문교육"]);
  if (values.some((value) => initialValues.has(value))) return "initial";
  if (record?.isInitial === true) return "initial";
  if (record?.isInitial === false) return "recurrent";
  return "";
}

function isInitialRec(record) {
  return ledgerRecordStage(record) === "initial";
}

function isRecurrentRec(record) {
  return ledgerRecordStage(record) === "recurrent";
}

function aggregateLedger(employees, histories, trainingMeta, globalCycleMonths = 0) {
  return employees.map((emp) => {
    const uid  = String(emp.id ?? emp.uid ?? "").trim();
    const recs = histories.filter((history) => historyBelongsToEmployee(history, emp));

    const toYmd = (v) => {
      if (!v) return null;
      if (v instanceof Date) return isNaN(v.getTime()) ? null : formatDateYMD(v.getTime());
      if (typeof v === "object") {
        const seconds = Number(v?.seconds ?? v?._seconds);
        if (Number.isFinite(seconds)) return formatDateYMD(seconds * 1000);
      }
      const raw = String(v).trim();
      if (!raw) return null;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 1e11) return formatDateYMD(n);
      if (Number.isFinite(n) && n >= 1e9 && n <= 1e11) return formatDateYMD(n * 1000);
      if (Number.isFinite(n) && n >= 60 && n <= 2958465) {
        const d = new Date(Math.round((n - 25569) * 86400 * 1000));
        return isNaN(d.getTime()) ? null : formatDateYMD(d.getTime());
      }
      const normalizedDate = /^\d{4}[./]\d{1,2}[./]\d{1,2}$/.test(raw)
        ? raw.replace(/[.]/g, "-").replace(/\//g, "-")
        : raw;
      const d = new Date(normalizedDate);
      return isNaN(d.getTime()) ? null : formatDateYMD(d.getTime());
    };

    // 입사일: 다중 필드 폴백
    const rawHire = emp.hireDate ?? emp.joinDate ?? emp.joinedAt ?? emp.employmentDate ?? emp.enteredAt ?? null;
    const joinDate = toYmd(rawHire) ?? "–";

    const explicitRecordEducationYear = (record) => {
      const explicit = Number(record?.educationYear);
      if (Number.isInteger(explicit) && explicit >= 2000 && explicit <= 2100) return explicit;
      const stageMatch = String(record?.educationStage ?? "").match(/^year_(\d{4})$/);
      if (stageMatch) return Number(stageMatch[1]);
      if (record?.educationStage === "previous_year") return PY;
      if (record?.educationStage === "current_year") return CY;
      return null;
    };

    const recordDate = (record) => {
      const raw = [record?.completedAt, record?.endDate, record?.startDate]
        .find((value) => value !== null && value !== undefined && value !== "");
      return toYmd(raw);
    };

    const recordEducationYear = (record) => {
      const explicit = explicitRecordEducationYear(record);
      if (explicit !== null) return explicit;
      const ymd = recordDate(record);
      return ymd ? Number(ymd.slice(0, 4)) : null;
    };

    const datedRecords = recs
      .map((record, originalIndex) => ({ record, originalIndex, date: recordDate(record) }))
      .filter((entry) => entry.date)
      .sort((a, b) => a.date.localeCompare(b.date) || a.originalIndex - b.originalIndex);
    const uniqueDates = [...new Set(datedRecords.map((entry) => entry.date))];

    // Explicit initial rows take precedence. When legacy rows have no stage, the
    // earliest dated occurrence of the selected canonical item is the initial one.
    const explicitInitialDates = datedRecords
      .filter((entry) => isInitialRec(entry.record))
      .map((entry) => entry.date);
    const initialDate = explicitInitialDates[0] ?? uniqueDates[0] ?? null;
    const lastDate = uniqueDates.at(-1) ?? null;

    const datesForYear = (year) => [...new Set(recs.filter((record) => {
      // 초기교육 기준일과 동일한 초기 레코드만 연도 열에서 제외한다. 이후 연도에
      // 입력된 별도 회차가 legacy 데이터에서 initial로 남아 있어도 숨기지 않는다.
      if (isInitialRec(record) && recordDate(record) === initialDate) return false;
      const explicitYear = explicitRecordEducationYear(record);
      if (explicitYear !== null) return explicitYear === year;
      return recordEducationYear(record) === year;
    }).map(recordDate).filter(Boolean))].sort();

    // 전년도
    const prevDates = datesForYear(PY);

    // 금년도
    const currDates = datesForYear(CY);

    // 비고 및 cycleMonths
    const lastRec = datedRecords.at(-1)?.record ?? recs.at(-1) ?? null;
    const noteRec = [...datedRecords].reverse().find((entry) => String(ledgerHistoryNote(entry.record)).trim())?.record
      ?? [...recs].reverse().find((record) => String(ledgerHistoryNote(record)).trim())
      ?? lastRec;
    const note    = ledgerHistoryNote(noteRec);
    // 회사 공통 교육항목 설정을 최우선 적용하고 기존 값은 안전한 fallback으로 유지
    const itemCycle = (() => { if (!trainingMeta?.itemId) return 0; const it = viewState.items.find((i) => i.id === trainingMeta.itemId); return Number(it?.cycleMonths ?? 0) || 0; })();
    const historyCycle = [...datedRecords].reverse()
      .map((entry) => Number(entry.record?.cycleMonths ?? 0) || 0)
      .find(Boolean) ?? 0;
    const effectiveCycle = globalCycleMonths || itemCycle || historyCycle || Number(lastRec?.cycleMonths ?? 0) || 0;

    // 예정일은 전체 최종일이 아니라 최신 보수/정기 회차를 기준으로 계산한다.
    // 명시 stage가 없는 legacy 데이터는 서로 다른 날짜가 2개 이상일 때 최신 회차를
    // 보수로 간주한다. 보수 이후 잘못 저장된 초기 레코드가 있어도 기준일을 덮지 않는다.
    const recurrentEntries = datedRecords.filter((entry) => isRecurrentRec(entry.record));
    const latestDatedEntry = datedRecords.at(-1) ?? null;
    const latestDatedStage = ledgerRecordStage(latestDatedEntry?.record);
    const latestRecurrentEntry = recurrentEntries.at(-1)
      ?? (!latestDatedStage && uniqueDates.length > 1 ? latestDatedEntry : null);
    const latestRecurrentDate = latestRecurrentEntry?.date ?? null;
    const initialOnly = Boolean(lastDate && !latestRecurrentDate);
    // 직원관리대장에서는 초기 회차도 주기의 시작점이다. 최신 보수 회차가 없으면
    // 초기교육일을 사용하고, legacy 데이터의 stage/date가 불완전하면 최종 유효일로 보완한다.
    const cycleBaseDate = latestRecurrentDate ?? initialDate ?? lastDate;
    const dueRow = cycleBaseDate ? applyDueMetadata([{
      completedAt: new Date(cycleBaseDate).getTime(),
      cycleMonths: effectiveCycle,
      subType: "recurrent",
    }])[0] : null;

    // daysRemaining 기반 직접 상태 결정
    let dueStatus, dueStatusLabel, daysRemaining, nextDueDate, dueReason;
    if (!lastDate) {
      dueStatus = "none"; dueStatusLabel = "-"; daysRemaining = null; nextDueDate = null; dueReason = recs.length ? "no_valid_date" : "no_history";
    } else if (!effectiveCycle) {
      dueStatus = "unconfigured"; dueStatusLabel = "-"; daysRemaining = null; nextDueDate = null; dueReason = "cycle_missing";
    } else {
      daysRemaining = dueRow?.daysRemaining ?? null;
      nextDueDate   = dueRow?.nextDueDate   ?? null;
      if (daysRemaining === null)       { dueStatus = "unconfigured"; dueStatusLabel = "주기 미설정"; dueReason = "calculation_failed"; }
      else if (daysRemaining < 0)       { dueStatus = "overdue";      dueStatusLabel = "기한 초과"; dueReason = "calculated"; }
      else if (daysRemaining <= 7)      { dueStatus = "soon7";        dueStatusLabel = "7일 이내"; dueReason = "calculated"; }
      else if (daysRemaining <= 30)     { dueStatus = "soon30";       dueStatusLabel = "30일 이내"; dueReason = "calculated"; }
      else                              { dueStatus = "normal";        dueStatusLabel = "정상"; dueReason = "calculated"; }
    }

    return {
      uid, name: emp.name ?? "–", empNo: emp.empNo ?? "–",
      joinDate, position: emp.position ?? "–",
      initialDate, lastDate, prevDates, currDates, note,
      cycleMonths: effectiveCycle, hasHistory: recs.length > 0,
      dueStatus, dueStatusLabel, daysRemaining, nextDueDate,
      _latestHistory: latestRecurrentEntry?.record ?? lastRec,
      _latestRecurrentDate: latestRecurrentDate,
      _cycleBaseDate: cycleBaseDate,
      _hasRecurrent: Boolean(latestRecurrentDate),
      _initialOnly: initialOnly,
      _dueReason: dueReason,
      // 수정 모달용 원본 필드
      _emp: emp,
    };
  });
}

/* ─── 요약 카드 4개 ────────────────────────────────────── */
function renderLedgerSummary() {
  const el = document.getElementById("ledger-summary");
  if (!el) return;

  const total   = ledgerRows.length;
  const soon30  = ledgerRows.filter((r) => r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining <= 30).length;
  const soon7   = ledgerRows.filter((r) => r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining <= 7).length;
  const overdue = ledgerRows.filter((r) => r.daysRemaining !== null && r.daysRemaining < 0).length;

  const cards = [
    { key: "all",     label: "전체 직원",  value: total,   tone: "neutral" },
    { key: "soon30",  label: "30일 이내",  value: soon30,  tone: "warning" },
    { key: "soon7",   label: "7일 이내",   value: soon7,   tone: "danger"  },
    { key: "overdue", label: "기한 초과",  value: overdue, tone: "danger"  },
  ];

  el.innerHTML = cards.map(({ key, label, value, tone }) => `
    <div class="stat-card" data-filter-key="${key}" style="cursor:pointer;transition:box-shadow 0.15s;border:2px solid ${ledgerFilter === key ? "var(--brand-400)" : "transparent"};border-radius:var(--radius-lg)">
      <div class="stat-card__label" style="color:${tone === "danger" ? "var(--color-danger,#dc2626)" : tone === "warning" ? "var(--color-warning,#d97706)" : "var(--gray-500)"}">${esc(label)}</div>
      <div class="stat-card__value" style="color:${tone === "danger" ? "var(--color-danger,#dc2626)" : tone === "warning" ? "var(--color-warning,#d97706)" : "inherit"}">${value}</div>
    </div>`).join("");

  el.querySelectorAll(".stat-card[data-filter-key]").forEach((card) => {
    card.addEventListener("click", () => {
      ledgerFilter = card.dataset.filterKey;
      renderLedgerSummary();
      renderLedgerTable();
    });
  });
}

/* ─── 관리대장 표 ────────────────────────────────────────── */
function renderLedgerTable() {
  const el = document.getElementById("ledger-table");
  if (!el) return;
  const isHQAdmin = authStore.role === ROLES.HQ_ADMIN;

  let rows = ledgerRows;

  // 검색 필터
  if (ledgerSearch) {
    rows = rows.filter((r) =>
      String(r.name).toLowerCase().includes(ledgerSearch) ||
      String(r.empNo).toLowerCase().includes(ledgerSearch)
    );
  }

  // 상태 필터 (요약 카드 클릭)
  if (ledgerFilter !== "all") {
    rows = rows.filter((r) => {
      if (ledgerFilter === "soon30")  return r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining <= 30;
      if (ledgerFilter === "soon7")   return r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining <= 7;
      if (ledgerFilter === "overdue") return r.daysRemaining !== null && r.daysRemaining < 0;
      return true;
    });
  }

  rows = sortLedgerRows(rows);

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state" style="padding:var(--space-10)"><div class="empty-state__title" style="font-size:var(--text-sm)">조건에 맞는 직원이 없습니다.</div></div>`;
    return;
  }

  const visibleUids = new Set(rows.map((r) => r.uid));
  const allSelected = visibleUids.size > 0 && [...visibleUids].every((uid) => selectedUids.has(uid));

  el.innerHTML = `
    <table class="data-table" style="min-width:1100px">
      <thead>
        <tr>
          ${isHQAdmin ? `<th style="width:36px"><input type="checkbox" id="chk-all" ${allSelected ? "checked" : ""} title="전체 선택"/></th>` : ""}
          ${sortableLedgerHeader("name", "성명")}${sortableLedgerHeader("empNo", "사번")}${sortableLedgerHeader("joinDate", "입사일")}${sortableLedgerHeader("position", "직급/직책")}
          ${sortableLedgerHeader("initialDate", "초기교육")}${sortableLedgerHeader("lastDate", "최종교육일")}
          ${sortableLedgerHeader("prevDates", `${PY}년`)}${sortableLedgerHeader("currDates", `${CY}년`)}
          ${sortableLedgerHeader("nextDueDate", "다음 예정일")}${sortableLedgerHeader("daysRemaining", "남은 일수")}${sortableLedgerHeader("dueStatus", "상태")}${sortableLedgerHeader("note", "비고")}
          ${isHQAdmin ? "<th style='width:60px'>관리</th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => {
          const isChecked = selectedUids.has(r.uid);
          const tone = r.dueStatus === "overdue" ? "danger"
            : (r.dueStatus === "soon7" || r.dueStatus === "soon30") ? "warning"
            : r.dueStatus === "normal" ? "success" : "neutral";
          const days = r.daysRemaining === null ? "–"
            : r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)}일 초과` : `${r.daysRemaining}일`;
          const statusCell = !r.dueStatusLabel || r.dueStatusLabel === "-"
            ? "-"
            : `<span class="chip chip--${tone}" style="font-size:var(--text-xs)">${esc(r.dueStatusLabel)}</span>`;
          return `<tr data-uid="${esc(r.uid)}" class="${isChecked ? "row--selected" : ""}" title="더블클릭: 이력카드" style="${isChecked ? "background:var(--brand-50,#eff6ff)" : ""}">
            ${isHQAdmin ? `<td style="text-align:center"><input type="checkbox" class="chk-row" data-uid="${esc(r.uid)}" ${isChecked ? "checked" : ""}></td>` : ""}
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
            <td>${statusCell}</td>
            <td style="font-size:var(--text-xs)">${esc(r.note || "–")}</td>
            ${isHQAdmin ? `<td style="text-align:right;white-space:nowrap">
              <button class="btn btn--ghost btn--sm btn-view-card" data-uid="${esc(r.uid)}" style="padding:2px 6px;font-size:var(--text-xs)">이력카드</button>
              <button class="btn btn--ghost btn--sm btn-edit-emp" data-uid="${esc(r.uid)}" style="padding:2px 6px;font-size:var(--text-xs)">수정</button>
            </td>` : ""}
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;

  el.querySelectorAll("th[data-sort-key]").forEach((header) => {
    header.addEventListener("click", () => cycleLedgerSort(header.dataset.sortKey));
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        cycleLedgerSort(header.dataset.sortKey);
      }
    });
  });

  // 전체 선택 체크박스
  if (isHQAdmin) {
    document.getElementById("chk-all")?.addEventListener("change", (e) => {
      e.stopPropagation();
      if (e.target.checked) { visibleUids.forEach((uid) => selectedUids.add(uid)); }
      else                  { visibleUids.forEach((uid) => selectedUids.delete(uid)); }
      updateResetBtn();
      renderLedgerTable();
    });

    // 개별 체크박스
    el.querySelectorAll(".chk-row").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        e.stopPropagation();
        if (e.target.checked) selectedUids.add(e.target.dataset.uid);
        else                  selectedUids.delete(e.target.dataset.uid);
        updateResetBtn();
        renderLedgerTable();
      });
      chk.addEventListener("click", (e) => e.stopPropagation());
    });

    // 이력카드 버튼
    el.querySelectorAll(".btn-view-card").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        router.push("history-cards", { uid: btn.dataset.uid });
      });
    });

    // 수정 버튼
    el.querySelectorAll(".btn-edit-emp").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const row = ledgerRows.find((r) => r.uid === btn.dataset.uid);
        if (row) openEditEmployeeModal(row);
      });
    });
  }

  // 단일 클릭 = 하이라이트, 더블클릭 = 이력카드
  el.querySelectorAll("tbody tr[data-uid]").forEach((row) => {
    let clickTimer = null;
    row.addEventListener("click", (e) => {
      if (e.target.type === "checkbox" || e.target.closest("button")) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        el.querySelectorAll("tbody tr").forEach((r) => { if (!selectedUids.has(r.dataset.uid)) r.style.background = ""; });
        if (!selectedUids.has(row.dataset.uid)) row.style.background = "var(--gray-50)";
      }, 220);
    });
    row.addEventListener("dblclick", (e) => {
      if (e.target.type === "checkbox" || e.target.closest("button")) return;
      clearTimeout(clickTimer);
      router.push("history-cards", { uid: row.dataset.uid });
    });
  });
}

function sortableLedgerHeader(key, label) {
  const active = ledgerSort.key === key && ledgerSort.direction !== "none";
  const icon = active ? (ledgerSort.direction === "asc" ? "▲" : "▼") : "";
  const ariaSort = !active ? "none" : ledgerSort.direction === "asc" ? "ascending" : "descending";
  return `<th data-sort-key="${esc(key)}" tabindex="0" role="columnheader" aria-sort="${ariaSort}" style="cursor:pointer;user-select:none;white-space:nowrap" title="클릭하여 정렬">${esc(label)}${icon ? ` <span aria-hidden="true" style="font-size:10px">${icon}</span>` : ""}</th>`;
}

function cycleLedgerSort(key) {
  if (ledgerSort.key !== key || ledgerSort.direction === "none") {
    ledgerSort = { key, direction: "asc" };
  } else if (ledgerSort.direction === "asc") {
    ledgerSort = { key, direction: "desc" };
  } else {
    ledgerSort = { key: "", direction: "none" };
  }
  renderLedgerTable();
}

function sortLedgerRows(inputRows) {
  const rows = [...inputRows];
  if (!ledgerSort.key || ledgerSort.direction === "none") {
    const order = { none: 0, overdue: 1, soon7: 2, soon30: 3, normal: 4, unconfigured: 5 };
    return rows.sort((a, b) =>
      (order[a.dueStatus] ?? 6) - (order[b.dueStatus] ?? 6) ||
      String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko", { numeric: true })
    );
  }

  const { key, direction } = ledgerSort;
  const multiplier = direction === "asc" ? 1 : -1;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const av = ledgerSortValue(a.row, key);
    const bv = ledgerSortValue(b.row, key);
    const aEmpty = av === null || av === undefined || av === "" || Number.isNaN(av);
    const bEmpty = bv === null || bv === undefined || bv === "" || Number.isNaN(bv);
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1; // 빈 값은 방향과 관계없이 항상 마지막
    if (aEmpty && bEmpty) return a.index - b.index;

    let compared;
    if (typeof av === "number" && typeof bv === "number") compared = av - bv;
    else compared = String(av).localeCompare(String(bv), "ko", { numeric: true, sensitivity: "base" });
    return compared * multiplier || a.index - b.index;
  }).map(({ row }) => row);
}

function ledgerSortValue(row, key) {
  const latestDate = (values) => {
    const dates = (Array.isArray(values) ? values : [values])
      .flatMap((value) => typeof value === "string" ? value.split(/[,，、]/) : [value])
      .map(ledgerDateValue)
      .filter((value) => value !== null);
    return dates.length ? Math.max(...dates) : null;
  };
  if (["joinDate", "initialDate", "lastDate", "nextDueDate"].includes(key)) return ledgerDateValue(row[key]);
  if (key === "prevDates" || key === "currDates") return latestDate(row[key]);
  if (key === "daysRemaining") return Number.isFinite(Number(row.daysRemaining)) ? Number(row.daysRemaining) : null;
  if (key === "dueStatus") {
    const statusOrder = { overdue: 0, soon7: 1, soon30: 2, normal: 3, unconfigured: 4, none: 5 };
    return statusOrder[row.dueStatus] ?? 6;
  }
  return String(row[key] ?? "").trim() || null;
}

function ledgerDateValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const dates = value.map(ledgerDateValue).filter((item) => item !== null);
    return dates.length ? Math.max(...dates) : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (value > 100000000000) return value;
    if (value > 1000000000) return value * 1000;
  }

  const text = String(value).trim();
  if (!text || text === "-" || text === "–") return null;
  const first = text.split(/[,，、]/)[0].trim();
  const ymd = first.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const timestamp = Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const timestamp = Date.parse(first);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function updateResetBtn() {
  const btn = document.getElementById("btn-reset-history");
  if (!btn) return;
  const cnt = selectedUids.size;
  btn.disabled = cnt === 0;
  btn.textContent = cnt > 0 ? `초기화 (${cnt}명)` : "초기화";
}

/* ═══════════════════════════════════════════════════════
   이력 초기화 모달
═══════════════════════════════════════════════════════ */
async function openResetConfirmModal() {
  if (!currentLedgerMeta || selectedUids.size === 0) { toast.warning("지점·교육 조회 후 직원을 선택하세요."); return; }
  const { branchLabel } = currentLedgerMeta;
  const uids = [...selectedUids];

  // 삭제 예정 이력 수 계산 (선택 직원의 manual/manual_excel 전체)
  let deleteCnt = 0;
  try {
    const allManual = await manualTrainingHistoriesDB.listAll();
    deleteCnt = allManual.filter((h) =>
      uids.includes(h.uid) &&
      ["manual", "manual_excel"].includes(String(h.source ?? "").toLowerCase())
    ).length;
  } catch (e) { /* 조회 실패 무시 */ }

  modal.open({
    title: "선택 직원 개인이력 전체 초기화",
    size: "sm",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="font-size:var(--text-sm);line-height:1.7">
          <div><b>지점:</b> ${esc(branchLabel)}</div>
          <div><b>선택 직원:</b> ${uids.length}명</div>
          <div><b>삭제 예정 개인이력:</b> ${deleteCnt}건</div>
        </div>
        <div style="background:#fff1f2;border:1px solid #fecaca;border-radius:var(--radius-md);padding:var(--space-3);font-size:var(--text-sm);color:#dc2626">
          ⚠️ 선택한 직원의 수동 입력 / Excel 업로드 개인이력이 모두 삭제됩니다.<br/>
          회차 완료 이력과 기존 완료 이력은 삭제되지 않습니다.<br/>
          삭제 후 복구할 수 없습니다.
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">확인을 위해 <b>초기화</b>를 입력하세요</label>
          <input class="form-control" id="reset-confirm-input" placeholder="초기화" autocomplete="off"/>
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "선택 직원 개인이력 전체 초기화",
        variant: "danger",
        onClick: async () => {
          const val = document.getElementById("reset-confirm-input")?.value?.trim();
          if (val !== "초기화") { toast.warning("'초기화'를 정확히 입력해 주세요."); return; }
          modal.setLoading("선택 직원 개인이력 전체 초기화", true);
          try {
            const result = await resetSelectedManualTrainingHistories({
              uids: Array.from(selectedUids),
              resetAllForUser: true,
            });
            toast.success(`초기화 완료: ${result.deletedCount ?? 0}건 삭제`);
            modal.close();
            selectedUids.clear();
            updateResetBtn();
            await runLedgerQuery();
          } catch (err) {
            console.error("[employees] reset failed", err);
            toast.error(err?.message || "초기화에 실패했습니다.");
            modal.setLoading("선택 직원 개인이력 전체 초기화", false);
          }
        },
      },
    ],
  });

  // 입력값에 따라 버튼 활성화
  setTimeout(() => {
    document.getElementById("reset-confirm-input")?.addEventListener("input", (e) => {
      const actionBtns = document.querySelectorAll(".modal__action");
      // 확인 버튼(danger)은 마지막 버튼
    });
  }, 100);
}

/* ═══════════════════════════════════════════════════════
   교육이력 수정 모달 (수동/Excel 이력만 편집)
═══════════════════════════════════════════════════════ */
async function openEditEmployeeModal(row) {
  if (authStore.role !== ROLES.HQ_ADMIN || !currentLedgerMeta?.trainingMeta) {
    toast.error("현재 교육 항목의 이력을 수정할 수 없습니다.");
    return;
  }

  const trainingMeta = currentLedgerMeta.trainingMeta;
  const trainingLabel = trainingMeta.label ?? trainingMeta.subjectName ?? currentLedgerMeta.trainingVal;
  let manualRecords = [];
  try {
    const all = await manualTrainingHistoriesDB.listAll();
    manualRecords = all.filter((record) =>
      record?.uid === row.uid &&
      ["manual", "manual_excel"].includes(String(record.source ?? "").toLowerCase()) &&
      filterByTraining([record], trainingMeta).length > 0
    );
  } catch (err) {
    console.error("[employees] load editable histories failed", err);
    toast.error("수정할 교육이력을 불러오지 못했습니다.");
    return;
  }

  const datesFor = (predicate) => [...new Set(manualRecords
    .filter(predicate)
    .map((record) => formatDateYMD(record.completedAt))
    .filter(Boolean))].sort();
  const initialDates = datesFor((record) => isInitialRec(record));
  const yearDates = new Map();
  for (const record of manualRecords.filter((record) => !isInitialRec(record))) {
    const ymd = formatDateYMD(record.completedAt);
    if (!ymd) continue;
    const year = Number(ymd.slice(0, 4));
    if (!yearDates.has(year)) yearDates.set(year, []);
    yearDates.get(year).push(ymd);
  }
  const editableYears = [...new Set([PY, CY, ...yearDates.keys()])].sort((a, b) => a - b);
  const latestRecord = [...manualRecords].sort((a, b) => Number(b.completedAt ?? 0) - Number(a.completedAt ?? 0))[0] ?? {};
  const existingInstructor = latestRecord.instructorName ?? "";
  const existingHours = Number(latestRecord.hours ?? 0) || Number(currentLedgerMeta.defaultDuration ?? 0) || 0;
  const yearFields = editableYears.map((year) => `
          <div class="form-group">
            <label class="form-label">${year}년</label>
            <textarea class="form-control history-date-field" id="edit-history-year-${year}" rows="1" placeholder="YYYY-MM-DD, YYYY-MM-DD" style="height:40px;min-height:40px;max-height:40px;resize:none;line-height:1.4;overflow-y:auto;padding-top:9px;padding-bottom:9px">${esc([...new Set(yearDates.get(year) ?? [])].sort().join(", "))}</textarea>
          </div>`).join("");

  modal.open({
    title: `교육이력 수정 — ${esc(row.name)}`,
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="background:var(--gray-50);border-radius:var(--radius-md);padding:var(--space-3);font-size:var(--text-sm);color:var(--gray-500)">
          <strong style="color:var(--gray-700)">${esc(trainingLabel)}</strong><br>
          ${esc(row.name)} · 사번 ${esc(row.empNo)}<br>
          수동 입력 및 Excel 업로드 이력만 변경되며 회차 완료 이력은 유지됩니다.
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">초기교육</label>
            <textarea class="form-control history-date-field" id="edit-history-initial" rows="1" placeholder="YYYY-MM-DD, YYYY-MM-DD" style="height:40px;min-height:40px;max-height:40px;resize:none;line-height:1.4;overflow-y:auto;padding-top:9px;padding-bottom:9px">${esc(initialDates.join(", "))}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">최종교육일 (자동 계산)</label>
            <input class="form-control history-date-field" value="${esc(row.lastDate ?? "–")}" readonly style="height:40px;min-height:40px;max-height:40px;line-height:1.4"/>
          </div>
        </div>
        <div class="form-row">${yearFields}</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">강사</label><input class="form-control" id="edit-history-instructor" value="${esc(existingInstructor)}" placeholder="강사명"/></div>
          <div class="form-group"><label class="form-label">교육시간</label><input class="form-control" id="edit-history-hours" type="number" min="0" max="100" step="1" value="${existingHours || ""}" placeholder="시간"/><div class="form-hint">미입력 시 교육항목 기본 교육시간 또는 기존 이력을 사용합니다.</div></div>
        </div>
        <div style="font-size:var(--text-xs);color:var(--gray-400)">
          날짜는 YYYY-MM-DD 형식으로 입력하고 여러 날짜는 쉼표로 구분하세요.
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "저장",
        variant: "primary",
        onClick: async () => {
          const parseDates = (id, expectedYear, label) => {
            const raw = document.getElementById(id)?.value ?? "";
            const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
            const unique = [];
            for (const value of values) {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || xlDateToYMD(value) !== value) {
                throw new Error(`${label} 날짜 형식이 올바르지 않습니다: ${value}`);
              }
              if (expectedYear && Number(value.slice(0, 4)) !== expectedYear) {
                throw new Error(`${label}에는 ${expectedYear}년 날짜만 입력할 수 있습니다.`);
              }
              if (!unique.includes(value)) unique.push(value);
            }
            return unique.sort();
          };

          let initialDatesInput, yearDatesInput;
          try {
            initialDatesInput = parseDates("edit-history-initial", null, "초기교육");
            yearDatesInput = Object.fromEntries(editableYears.map((year) => [
              year,
              parseDates(`edit-history-year-${year}`, year, `${year}년`),
            ]));
          } catch (err) {
            toast.error(err.message);
            return;
          }

          modal.setLoading("저장", true);
          try {
            await replaceEmployeeManualTrainingHistories({
              uid: row.uid,
              trainingType: trainingMeta.trainingType,
              subjectCode: trainingMeta.subjectCode ?? "",
              subjectName: trainingMeta.subjectName ?? trainingLabel,
              itemId: trainingMeta.itemId ?? "",
              initialDates: initialDatesInput,
              yearDates: yearDatesInput,
              cycleMonths: currentLedgerMeta.cycleMonths ?? 0,
              defaultDuration: currentLedgerMeta.defaultDuration ?? 0,
              instructorName: document.getElementById("edit-history-instructor")?.value?.trim() ?? "",
              hours: Number(document.getElementById("edit-history-hours")?.value) || 0,
            });
            toast.success("교육이력이 수정되었습니다.");
            modal.close();
            await runLedgerQuery();
          } catch (err) {
            console.error("[employees] replace histories failed", err);
            toast.error(err?.message || "수정에 실패했습니다.");
            modal.setLoading("저장", false);
          }
        },
      },
    ],
  });
}

/* ═══════════════════════════════════════════════════════
   재교육 주기 설정 모달
═══════════════════════════════════════════════════════ */
async function openCycleConfigModal() {
  const options = buildTrainingOptions(viewState.items);
  if (!options.length) { toast.warning("설정할 교육항목이 없습니다."); return; }
  const preselectedValue = document.getElementById("ledger-training")?.value ?? "";
  const preselected = options.find((option) => option.value === preselectedValue) ?? options[0];
  const types = [...new Set(options.map((option) => option.trainingType))];

  modal.open({
    title: "재교육 주기 설정",
    size: "sm",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="form-group" style="margin:0"><label class="form-label form-label--required">교육유형</label><select class="form-control" id="cycle-training-type">${types.map((type) => `<option value="${type}" ${type === preselected.trainingType ? "selected" : ""}>${esc(TRAINING_TYPE_LABELS[type] ?? type)}</option>`).join("")}</select></div>
        <div class="form-group" style="margin:0"><label class="form-label form-label--required">교육항목</label><select class="form-control" id="cycle-training-item"></select></div>
        <div style="font-size:var(--text-sm);line-height:1.7"><b>현재 주기:</b> <span id="cycle-current-label">불러오는 중…</span><div class="form-hint">이 설정은 지점과 관계없이 회사 전체의 동일 교육항목에 적용됩니다.</div></div>
        <div class="form-group" style="margin:0">
          <label class="form-label form-label--required">새 재교육 주기</label>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-2)">
            ${[1,3,6,12,24].map((m) =>
              `<button type="button" class="btn btn--secondary btn--sm cycle-preset" data-val="${m}">${m}개월</button>`
            ).join("")}
            <button type="button" class="btn btn--ghost btn--sm cycle-preset" data-val="0">주기 없음</button>
          </div>
          <input class="form-control" id="cycle-months-input" type="number" min="0" max="120" step="1"
            placeholder="직접 입력 (0 = 주기 없음)" value="0"/>
          <div class="form-hint">0~120 사이 정수 · 0은 주기 없음</div>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">기본 교육시간</label>
          <input class="form-control" id="cycle-default-duration-input" type="number" min="0" max="100" step="1"
            placeholder="시간 입력 (0 또는 빈값 = 미설정)" value="0"/>
          <div class="form-hint">관리대장 등록·수정 시 직접 입력한 시간보다 낮은 우선순위로 적용됩니다.</div>
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      {
        label: "저장",
        variant: "primary",
        onClick: async () => {
          const raw = document.getElementById("cycle-months-input")?.value?.trim();
          const val = raw === "" ? 0 : Number(raw);
          const durationRaw = document.getElementById("cycle-default-duration-input")?.value?.trim();
          const defaultDuration = durationRaw === "" ? 0 : Number(durationRaw);
          if (!Number.isInteger(val) || val < 0 || val > 120) {
            toast.error("0~120 사이 정수를 입력하세요.");
            return;
          }
          if (!Number.isInteger(defaultDuration) || defaultDuration < 0 || defaultDuration > 100) {
            toast.error("교육시간은 0~100 사이 정수를 입력하세요.");
            return;
          }
          modal.setLoading("저장", true);
          try {
            const selectedValue = document.getElementById("cycle-training-item")?.value ?? "";
            const trainingMeta = options.find((option) => option.value === selectedValue);
            if (!trainingMeta) throw new Error("교육항목을 선택해 주세요.");
            const companyId = getEffectiveCompanyId(trainingMeta, null);
            const payload = {
              companyId,
              itemId:       trainingMeta.itemId ?? "",
              trainingType: trainingMeta.trainingType,
              subjectCode:  trainingMeta.subjectCode ?? "",
              subjectName:  trainingMeta.subjectName ?? "",
              cycleMonths:  val,
              defaultDuration,
            };
            console.info("[employees] saveEducationCycleConfig request", {
              selectedEducation: trainingMeta,
              currentUser: {
                uid: authStore.uid,
                role: authStore.role,
                companyId: authStore.companyId,
                branchId: authStore.branchId,
              },
              candidateCompanyIds: [...new Set(viewState.branches.map((item) => item?.companyId).filter(Boolean))],
              payload,
            });
            const result = await saveEducationCycleConfig(payload);
            console.info("[employees] saveEducationCycleConfig response", result);
            toast.success(`재교육 주기와 기본 교육시간이 저장되었습니다.`);
            modal.close();
            await refreshViewState();
            if (document.getElementById("ledger-branch")?.value && document.getElementById("ledger-training")?.value) {
              await runLedgerQuery();
            }
          } catch (err) {
            console.error("[employees] saveEducationCycleConfig failed", {
              code: err?.code,
              message: err?.message,
              details: err?.details,
              error: err,
            });
            toast.error(err?.message || "저장에 실패했습니다.");
            modal.setLoading("저장", false);
          }
        },
      },
    ],
  });

  const loadCurrentCycle = async () => {
    const selectedValue = document.getElementById("cycle-training-item")?.value ?? "";
    const trainingMeta = options.find((option) => option.value === selectedValue);
    const label = document.getElementById("cycle-current-label");
    const input = document.getElementById("cycle-months-input");
    const durationInput = document.getElementById("cycle-default-duration-input");
    if (!trainingMeta) { if (label) label.textContent = "미설정"; return; }
    const companyId = getEffectiveCompanyId(trainingMeta, null);
    let currentCycle = 0;
    let currentDuration = 0;
    try {
      const config = await loadEducationCycleConfig(companyId, trainingMeta);
      currentCycle = Number(config?.cycleMonths ?? 0) || 0;
      currentDuration = Number(config?.defaultDuration ?? 0) || 0;
      if (!currentCycle && trainingMeta.itemId) {
        currentCycle = Number(viewState.items.find((item) => item.id === trainingMeta.itemId)?.cycleMonths ?? 0) || 0;
      }
    } catch (error) { console.warn("[employees] cycle config lookup failed", error); }
    if (label) label.textContent = currentCycle ? `${currentCycle}개월` : "미설정";
    if (input) input.value = String(currentCycle);
    if (durationInput) durationInput.value = String(currentDuration);
  };
  const renderCycleItems = (preferredValue = "") => {
    const type = document.getElementById("cycle-training-type")?.value ?? "";
    const itemSelect = document.getElementById("cycle-training-item");
    const typeOptions = options.filter((option) => option.trainingType === type);
    if (!itemSelect) return;
    itemSelect.innerHTML = typeOptions.map((option) => `<option value="${esc(option.value)}">${esc(option.subjectName)}</option>`).join("");
    if (typeOptions.some((option) => option.value === preferredValue)) itemSelect.value = preferredValue;
    loadCurrentCycle();
  };

  document.querySelectorAll(".cycle-preset").forEach((btn) => btn.addEventListener("click", () => {
    const input = document.getElementById("cycle-months-input");
    if (input) input.value = btn.dataset.val;
  }));
  document.getElementById("cycle-training-type")?.addEventListener("change", () => renderCycleItems());
  document.getElementById("cycle-training-item")?.addEventListener("change", loadCurrentCycle);
  renderCycleItems(preselected.value);
}

function buildEducationKey(meta) {
  const typeKey = String(meta?.trainingType ?? "other").trim().toLowerCase() || "other";
  const subjectKey = normalizeEducationCycleSubjectKey(meta?.subjectCode || meta?.subjectName);
  return `${typeKey}__${subjectKey || "default"}`;
}

function rawEducationCycleSubjectKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeEducationCycleSubjectKey(value) {
  const normalized = rawEducationCycleSubjectKey(value);
  const canonical = canonicalLedgerKey(normalized);
  if ([
    LEDGER_JOB_DUTY_KEY,
    LEDGER_JOB_INSTRUCTOR_KEY,
    "job_wb",
    "job_operations",
    "legal_sms",
    "legal_security",
    "legal_dangerous_goods",
  ].includes(canonical)) return canonical;
  if (["job_wb", "w_b", "wb", "weight_balance", "탑재관리"].includes(normalized)) return "job_wb";
  if (["job_operations", "flight_operations", "운항관리", "운항담당"].includes(normalized)) return "job_operations";
  return normalized;
}

function educationCycleLookupKeys(meta) {
  const typeKey = String(meta?.trainingType ?? "other").trim().toLowerCase() || "other";
  const canonicalSubjectKey = normalizeEducationCycleSubjectKey(meta?.subjectCode || meta?.normalizedKey || meta?.subjectName);
  const keys = [`${typeKey}__${canonicalSubjectKey || "default"}`];
  const legacySubjects = {
    job_duty: ["직무", "직무교육", "job_initial", "job_recurrent"],
    job_instructor: ["사내강사", "직무사내강사"],
    job_wb: ["w_b", "wb", "weight_balance", "탑재관리"],
    job_operations: ["flight_operations", "운항관리", "운항담당"],
    legal_sms: ["sms", "sms_교육", "safety_management_system"],
    legal_security: ["항공보안", "aviation_security"],
    legal_dangerous_goods: ["위험물", "위험물_규정", "dg", "dgr"],
  };
  for (const subject of (legacySubjects[canonicalSubjectKey] ?? [])) {
    keys.push(`${typeKey}__${rawEducationCycleSubjectKey(subject)}`);
  }
  const rawSubject = rawEducationCycleSubjectKey(meta?.subjectCode || meta?.normalizedKey || meta?.subjectName);
  if (rawSubject) keys.push(`${typeKey}__${rawSubject}`);
  return [...new Set(keys)];
}

async function loadEducationCycleConfig(companyId, meta) {
  if (!companyId) return null;
  const lookupKeys = educationCycleLookupKeys(meta);
  for (const key of lookupKeys) {
    const config = await educationCycleConfigsDB.get(companyId, key);
    if (config) return { id: key, ...config };
  }

  // 기존 저장 데이터에는 itemId/표시명/legacy key가 혼재한다. 직접 경로 조회가
  // 실패한 경우 회사 설정 목록을 canonical key로 비교해 동일 항목을 찾는다.
  const selectedCanonicalKey = canonicalLedgerMetaKey(meta);
  const selectedType = normalizeTrainingType(meta?.trainingType);
  const configs = await educationCycleConfigsDB.listAll(companyId).catch(() => []);
  return configs.find((config) => {
    if (meta?.itemId && config?.itemId && String(meta.itemId) === String(config.itemId)) return true;
    const configType = normalizeTrainingType(config?.trainingType || String(config?.id ?? "").split("__")[0]);
    if (selectedType && configType && selectedType !== configType) return false;
    const idSubject = String(config?.id ?? "").split("__").slice(1).join("__");
    const configKeys = [
      config?.subjectCode,
      config?.normalizedKey,
      config?.subjectName,
      idSubject,
    ].map(canonicalLedgerKey).filter(Boolean);
    return configKeys.includes(selectedCanonicalKey);
  }) ?? null;
}

/* ═══════════════════════════════════════════════════════
   교육 항목 선택 모달 → 양식 다운로드
═══════════════════════════════════════════════════════ */
async function openTemplateSelectModal(preselectedBranchId = "", preselectedTrainingVal = "") {
  const onlineItems = viewState.items.filter((i) => i.trainingType === "online");
  const otherItems  = viewState.items.filter((i) => i.trainingType === "other");
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
            <option value="job" ${preTraining?.trainingType==="job"?"selected":""}>직무교육</option>
            <option value="legal" ${preTraining?.trainingType==="legal"?"selected":""}>법정교육</option>
            <option value="online" ${preTraining?.trainingType==="online"?"selected":""}>온라인교육</option>
            <option value="other" ${preTraining?.trainingType==="other"?"selected":""}>기타</option>
          </select>
        </div>
        <div class="form-group" id="tpl-job-subjects" style="display:${preTraining?.trainingType==="job"?"block":"none"}">
          <label class="form-label form-label--required">교육 세부분류</label>
          <select class="form-control" id="tpl-job-subject">
            <option value="">선택하세요</option>
            ${(TRAINING_SUBJECT_OPTIONS.job ?? []).map((s) => `<option value="${s.code}" data-name="${esc(s.name)}" ${preTraining?.subjectCode===s.code?"selected":""}>${esc(s.name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group" id="tpl-legal-subjects" style="display:${preTraining?.trainingType==="legal"?"block":"none"}">
          <label class="form-label form-label--required">교육 세부분류</label>
          <select class="form-control" id="tpl-legal-subject">
            <option value="">선택하세요</option>
            ${(TRAINING_SUBJECT_OPTIONS.legal ?? []).map((s) => `<option value="${s.code}" data-name="${esc(s.name)}" ${preTraining?.subjectCode===s.code?"selected":""}>${esc(s.name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group" id="tpl-online-subjects" style="display:${preTraining?.trainingType==="online"?"block":"none"}">
          <label class="form-label form-label--required">교육 세부분류</label>
          ${onlineItems.length?`<select class="form-control" id="tpl-online-subject-select"><option value="">기존 항목 선택 또는 직접 입력</option>${onlineItems.map((i)=>`<option value="${esc(i.subjectCode||i.id)}" data-name="${esc(i.subjectName||i.title)}">${esc(i.subjectName||i.title)}</option>`).join("")}</select>`:""}
          <input class="form-control" id="tpl-online-subject-input" placeholder="교육 항목명 직접 입력" style="margin-top:4px"/>
        </div>
        <div class="form-group" id="tpl-other-subjects" style="display:${preTraining?.trainingType==="other"?"block":"none"}">
          <label class="form-label form-label--required">교육 세부분류</label>
          ${otherItems.length?`<select class="form-control" id="tpl-other-subject-select"><option value="">기존 항목 선택 또는 직접 입력</option>${otherItems.map((i)=>`<option value="${esc(i.subjectCode||i.id)}" data-name="${esc(i.subjectName||i.title)}">${esc(i.subjectName||i.title)}</option>`).join("")}</select>`:""}
          <input class="form-control" id="tpl-other-subject-input" placeholder="교육 항목명 직접 입력" style="margin-top:4px"/>
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "선택 항목 양식 다운로드", variant: "primary", onClick: async () => {
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
            const activeBranchId = preselectedBranchId || document.getElementById("ledger-branch")?.value || "";
            await downloadTypedTemplate({ trainingType, subjectCode, subjectName, overrideBranchId: activeBranchId });
            modal.close();
          } catch (err) { console.error(err); toast.error("양식을 만들지 못했습니다."); modal.setLoading("선택 항목 양식 다운로드", false); }
      }},
    ],
  });

  document.getElementById("tpl-training-type")?.addEventListener("change", (e) => {
    const type = e.target.value;
    ["job","legal","online","other"].forEach((t) => {
      const el = document.getElementById(`tpl-${t}-subjects`);
      if (el) el.style.display = type === t ? "block" : "none";
    });
  });
  document.getElementById("tpl-online-subject-select")?.addEventListener("change", (e) => { if (e.target.value) document.getElementById("tpl-online-subject-input").value = ""; });
  document.getElementById("tpl-other-subject-select")?.addEventListener("change", (e) => { if (e.target.value) document.getElementById("tpl-other-subject-input").value = ""; });
}

/* ═══════════════════════════════════════════════════════
   Excel 양식 생성 + 다운로드
═══════════════════════════════════════════════════════ */
async function downloadTypedTemplate({ trainingType, subjectCode, subjectName, overrideBranchId = "" }) {
  const XLSX = await loadXlsx();
  const typeLabel = TRAINING_TYPE_LABELS[trainingType] ?? trainingType;
  const wb = XLSX.utils.book_new();

  const metaWs = XLSX.utils.aoa_to_sheet([
    ["trainingType", trainingType], ["subjectCode", subjectCode], ["subjectName", subjectName],
    ["typeLabel", typeLabel], ["currentYear", CY], ["previousYear", PY],
    ["templateVersion", 1], ["generatedAt", Date.now()],
  ]);
  XLSX.utils.book_append_sheet(wb, metaWs, "_meta");

  const branchId = overrideBranchId || document.getElementById("ledger-branch")?.value || "";
  const branch   = viewState.branches.find((b) => b.id === branchId) ?? null;
  const targets  = viewState.employees.filter((e) => branch ? matchesBranch(e, branchId) : true);

  const parseJoinDate = (emp) => {
    const raw = emp.hireDate ?? emp.joinDate ?? emp.joinedAt ?? emp.employmentDate ?? emp.enteredAt ?? null;
    if (!raw) return null;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 1e11) return new Date(n);
    const d = new Date(String(raw)); return isNaN(d.getTime()) ? null : d;
  };

  const infoRows = [
    [`[${typeLabel} — ${subjectName}] 개인 교육이력 등록 양식`],
    [`기준연도: ${CY}년 (전년도: ${PY}년 / 금년도: ${CY}년)`],
    ["※ 성명·사번은 수정하지 마세요. 날짜는 YYYY-MM-DD 형식으로 입력하세요. 복수 날짜는 쉼표 구분"],
    [],
    ["성명", "사번", "입사일", "직급/직책", "초기교육", "최종교육일", `${PY}년`, `${CY}년`, "강사", "교육시간", "비고"],
  ];

  const dataRows = targets.map((emp) => [
    emp.name ?? "",
    String(emp.empNo ?? ""),
    parseJoinDate(emp),
    emp.position ?? "",
    null, null, null, null, "", null, "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([...infoRows, ...dataRows], { cellDates: true, dateNF: "yyyy-mm-dd" });
  ws["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 20 }];

  const colName = (idx) => { let n = ""; let i = idx; do { n = String.fromCharCode(65 + (i % 26)) + n; i = Math.floor(i / 26) - 1; } while (i >= 0); return n; };
  const DATA_START = 6; const DATA_END = DATA_START + dataRows.length - 1;
  for (let r = DATA_START; r <= DATA_END; r++) {
    for (const c of [2, 4, 5, 6, 7]) {
      const addr = `${colName(c)}${r}`;
      if (!ws[addr]) ws[addr] = { t: "z", v: undefined, z: "yyyy-mm-dd" };
      else ws[addr].z = "yyyy-mm-dd";
    }
    const ea = `${colName(1)}${r}`; if (ws[ea]) ws[ea].t = "s";
  }

  XLSX.utils.book_append_sheet(wb, ws, "개인교육이력");
  const safe = subjectName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  XLSX.writeFile(wb, `${CY}_${typeLabel}_${safe}_이력양식.xlsx`);
}

/* ═══════════════════════════════════════════════════════
   인라인 Excel 업로드
═══════════════════════════════════════════════════════ */
async function parseHistoryUploadFileInline(event) {
  const file       = event.target.files?.[0];
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

    const metaSheet = wb.Sheets["_meta"];
    if (!metaSheet) { previewEl.innerHTML = metaError("지원하지 않는 양식입니다. 교육 항목을 선택하여 새 양식을 다운로드해 주세요."); return; }
    const metaMap = {};
    XLSX.utils.sheet_to_json(metaSheet, { header: 1, defval: "" }).forEach(([k, v]) => { if (k) metaMap[k] = v; });
    const { trainingType, subjectCode, subjectName, typeLabel, currentYear, previousYear } = metaMap;
    if (!trainingType || !currentYear) { previewEl.innerHTML = metaError("양식 메타데이터가 손상되었습니다."); return; }

    const metaCY = Number(currentYear), metaPY = Number(previousYear);
    selectedTemplateMeta = { trainingType, subjectCode, subjectName, typeLabel, currentYear: metaCY, previousYear: metaPY };

    const dataSheet = wb.Sheets[wb.SheetNames.find((n) => n !== "_meta") ?? wb.SheetNames[0]];
    const allRows   = XLSX.utils.sheet_to_json(dataSheet, { header: 1, defval: "" });

    const normCell = (v) => String(v ?? "").replace(/\s+/g, "").trim();
    let hIdx = allRows.findIndex((r) => { const c = r.map(normCell); return c.includes("성명") && c.includes("사번"); });
    if (hIdx < 0) hIdx = 4;
    const headers = allRows[hIdx].map(normCell);

    const yearColumns = headers.map((header, index) => {
      const match = String(header).match(/^(?:(\d{4})|(\d{2}))년?$/);
      if (!match) return null;
      const year = match[1] ? Number(match[1]) : 2000 + Number(match[2]);
      return year >= 2000 && year <= 2100 ? { year, index } : null;
    }).filter(Boolean);
    console.info("[ledger-upload] detectedYears", yearColumns.map(({ year }) => year));
    const col = {
      name:     headers.indexOf("성명"),
      empNo:    headers.indexOf("사번"),
      joinDate: headers.indexOf("입사일"),
      position: headers.findIndex((h) => h.includes("직급") || h.includes("직책")),
      initial:  headers.findIndex((h) => h.includes("초기")),
      lastDate: headers.findIndex((h) => h.includes("최종")),
      instructor: headers.findIndex((h) => h === "강사" || h === "강사명"),
      hours: headers.findIndex((h) => h === "교육시간" || h === "교육시간(시간)" || h === "시간"),
      note:     headers.indexOf("비고"),
    };

    const dataRaw = allRows.slice(hIdx + 1).filter((r) => { const n = normCell(r[col.name]); const e = normCell(r[col.empNo]); return n !== "" || e !== ""; });
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
      const instructorName = getStr(col.instructor);
      const hours = Number(String(getRaw(col.hours) ?? "").replace(/[^0-9.]/g, "")) || 0;

      const errors = [];
      if (!name)  errors.push("성명 누락");
      if (!empNo) errors.push("사번 누락");
      const emp = empNo ? empByNo.get(empNo) : null;
      if (empNo && !emp) errors.push("존재하지 않는 사번");
      else if (emp && name && emp.name !== name) errors.push("사번과 성명 불일치");

      const parsedInitial = parseDateCells(getRaw(col.initial),  null,    null,    errors, "초기교육");
      const yearDates = Object.fromEntries(yearColumns.map(({ year, index }) => [
        year,
        parseDateCells(getRaw(index), year, year, errors, `${year}년`),
      ]));
      const parsedLast    = xlDateToYMD(getRaw(col.lastDate));
      const allDates      = [...parsedInitial, ...Object.values(yearDates).flat()];
      // 최종교육일만 있어도 이력 1건으로 인정 (건너뜀 아님)
      const hasAnyDate    = allDates.length > 0 || Boolean(parsedLast);
      const skip          = !hasAnyDate && errors.length === 0;

      return {
        _rowNum: hIdx + 1 + i + 2, _skip: skip, _errors: errors,
        name, empNo, joinDate, position, note, instructorName, hours,
        uid: emp?.id ?? emp?.uid ?? "",
        initialDates: parsedInitial, yearDates, lastDate: parsedLast,
      };
    });

    const nonSkipped = pendingHistoryRows.filter((r) => !r._skip);
    const invalid    = nonSkipped.filter((r) => r._errors.length);
    const valid      = nonSkipped.filter((r) => !r._errors.length);
    const skippedCnt = pendingHistoryRows.filter((r) => r._skip).length;
    console.info("[ledger-upload] preview yearValues", pendingHistoryRows.slice(0, 3).map((row) => ({
      empNo: row.empNo,
      yearValues: row.yearDates,
    })));

    previewEl.innerHTML = `
      <div style="margin-bottom:var(--space-2)">
        <span style="font-size:var(--text-sm);font-weight:var(--weight-semibold)">${esc(typeLabel ?? trainingType)} — ${esc(subjectName)}</span>
        <span style="font-size:var(--text-xs);color:var(--gray-400);margin-left:var(--space-2)">감지된 연도: ${yearColumns.map(({ year }) => `${year}년`).join(" / ") || "없음"}</span>
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
            <th>초기교육</th><th>최종교육일</th><th>연도별 교육일</th><th>강사</th><th>교육시간</th>
            <th>비고</th><th>이력 수</th><th>검증</th>
          </tr></thead>
          <tbody>
            ${pendingHistoryRows.map((r) => {
              const datesByYear = Object.entries(r.yearDates ?? {}).flatMap(([year, values]) => values.length ? [`${year}: ${values.join(", ")}`] : []);
              const yearCount = Object.values(r.yearDates ?? {}).flat().length;
              const cnt = r.initialDates.length + yearCount + (r.initialDates.length === 0 && yearCount === 0 && r.lastDate ? 1 : 0);
              return `<tr style="background:${r._errors.length ? "#fff7ed" : r._skip ? "#f9fafb" : ""}">
                <td style="color:var(--gray-400);text-align:center">${r._rowNum}</td>
                <td>${esc(r.name)}</td>
                <td style="font-family:monospace;font-size:var(--text-xs)">${esc(r.empNo)}</td>
                <td style="font-size:var(--text-xs)">${esc(r.joinDate || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(r.position || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(r.initialDates.join(", ") || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(r.lastDate || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(datesByYear.join(" / ") || "–")}</td>
                <td style="font-size:var(--text-xs)">${esc(r.instructorName || "–")}</td>
                <td style="font-size:var(--text-xs)">${r.hours ? `${esc(r.hours)}시간` : "–"}</td>
                <td style="font-size:var(--text-xs)">${esc(r.note || "–")}</td>
                <td style="text-align:center;font-size:var(--text-xs)">${r._skip ? "–" : cnt}</td>
                <td>${r._skip ? `<span style="color:var(--gray-400);font-size:var(--text-xs)">건너뜀</span>` : r._errors.length ? `<span style="color:#c2410c;font-size:var(--text-xs)">${esc(r._errors.join(" / "))}</span>` : `<span style="color:#15803d;font-size:var(--text-xs)">✓ 정상</span>`}</td>
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

  // 해당 교육의 기본 주기 포함
  const trainingMeta = parseTrainingValue(`${trainingType}|${subjectCode}`);
  const effectiveCompanyId = getEffectiveCompanyId(trainingMeta, getSelectedBranch());
  let defaultCycle   = 0;
  let defaultDuration = 0;
  try {
    const cfg = await loadEducationCycleConfig(effectiveCompanyId, trainingMeta ?? { trainingType, subjectCode, subjectName });
    defaultCycle = Number(cfg?.cycleMonths ?? 0) || 0;
    defaultDuration = Number(cfg?.defaultDuration ?? 0) || 0;
  } catch (e) { /* 무시 */ }

  const historyEntries = [];
  for (const row of validRows) {
    const stages = [
      ...row.initialDates.map((d) => ({ completedAt: d, educationStage: "initial",       educationType: "initial" })),
      ...Object.entries(row.yearDates ?? {}).flatMap(([year, dates]) =>
        dates.map((d) => ({ completedAt: d, educationYear: Number(year), educationStage: `year_${year}`, educationType: "recurrent" }))
      ),
    ];
    // 초기/전년도/금년도 날짜가 없고 최종교육일만 있으면 latest_only로 이력 1건 생성
    if (stages.length === 0 && row.lastDate) {
      stages.push({ completedAt: row.lastDate, educationStage: "latest_only", educationType: "recurrent" });
    }
    for (const { completedAt, educationYear, educationStage, educationType } of stages) {
      historyEntries.push({
        empNo: row.empNo, employeeName: row.name,
        hireDate: row.joinDate || "",
        position: row.position || "",
        trainingType, subjectCode, subjectName,
        title: subjectName, courseName: subjectName,
        completedAt, educationYear, educationStage, educationType,
        startDate: completedAt, endDate: completedAt,
        source: "manual_excel", note: row.note ?? "",
        instructorName: row.instructorName ?? "",
        hours: row.hours || defaultDuration,
        cycleMonths: defaultCycle,
      });
    }
  }

  if (!historyEntries.length) { toast.warning("업로드할 날짜가 없습니다."); return; }
  console.info("[ledger-upload] payload yearValues", historyEntries.slice(0, 6).map((entry) => ({
    empNo: entry.empNo,
    educationYear: entry.educationYear,
    completedAt: entry.completedAt,
  })));
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "업로드 중..."; }
  if (resultEl)  resultEl.textContent = "";

  try {
    const result = await bulkImportManualTrainingHistories({ rows: historyEntries });
    console.info("[ledger-upload] savedYearValues", result?.savedYearValues ?? []);
    const msg = `✅ 등록 ${result.succeededCount ?? 0}건 · 중복 ${result.skippedCount ?? 0}건 · 실패 ${result.failedCount ?? 0}건`;
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--color-success,#16a34a)">${esc(msg)}</span>`;
    toast.success(msg);
    await refreshViewState();
    await runLedgerQuery();
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
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><path d="M8 10V2m0 0L5 5m3-3l3 3M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>이력 업로드`; }
  }
}

/* ──────────────────────────────────────────────────────
   최종교육일 계산 헬퍼
   규칙: 최신 교육연도 + 초기교육 월/일
   초기교육이 없으면 실제 최신 교육일 반환
   윤년 2월 29일 → 비윤년이면 2월 28일로 보정
────────────────────────────────────────────────────── */
function calculateAdjustedLastDate(initialDate, allDates) {
  // 날짜가 아예 없으면 null
  if (!allDates || allDates.length === 0) return null;

  // 실제 최신 날짜 (rawLastDate)
  const rawLast = allDates[allDates.length - 1];

  // 초기교육 날짜가 없으면 실제 최신 날짜 그대로 반환
  if (!initialDate) return rawLast;

  // 초기교육의 월/일 추출 (UTC 기준, 하루 밀림 방지)
  const initParts = initialDate.split("-").map(Number);
  if (initParts.length < 3 || initParts.some(isNaN)) return rawLast;
  const initMonth = initParts[1]; // 1~12
  const initDay   = initParts[2]; // 1~31

  // 모든 이력 중 가장 최신 연도 추출
  const years = allDates.map((d) => Number(d.slice(0, 4))).filter((y) => y > 0);
  if (!years.length) return rawLast;
  const latestYear = Math.max(...years);

  // 해당 연도에서 초기교육 월/일이 유효한지 확인 (윤년 보정)
  const day = clampDayInMonth(latestYear, initMonth, initDay);
  const mm  = String(initMonth).padStart(2, "0");
  const dd  = String(day).padStart(2, "0");
  return `${latestYear}-${mm}-${dd}`;
}

/** 해당 연도·월에서 day가 초과하면 그 달의 마지막 날로 보정 */
function clampDayInMonth(year, month, day) {
  // month: 1~12, Date(year, month, 0) = 해당 월의 마지막 날 (JS: 0-indexed month)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(day, lastDay);
}

/* ═══════════════════════════════════════════════════════
   날짜 유틸
═══════════════════════════════════════════════════════ */
const _SN_MIN = 60, _SN_MAX = 2958465;

function formatDateYMD(ms) {
  const d = new Date(typeof ms === "number" ? ms : Number(ms));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function _rawToYmd(v) {
  if (v === null || v === undefined || v === "") return "";
  // JS Date 객체 (cellDates:true)
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : formatDateYMD(v.getTime());
  // Excel serial number (60 ~ 2958465)
  if (typeof v === "number" && v >= _SN_MIN && v <= _SN_MAX) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? "" : formatDateYMD(d.getTime());
  }
  // 문자열 처리 — 먼저 직접 Date() 시도 (ISO timestamp 등 파손 방지)
  const s = String(v).trim();
  if (!s) return "";
  const dDirect = new Date(s);
  if (!isNaN(dDirect.getTime())) return formatDateYMD(dDirect.getTime());
  // 구분자 변환 후 재시도 (YYYY.MM.DD / YYYY/MM/DD)
  const sNorm = s.replace(/[./]/g, "-");
  const dNorm = new Date(sNorm);
  return isNaN(dNorm.getTime()) ? "" : formatDateYMD(dNorm.getTime());
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
  const s = String(value).trim(); if (!s) return [];
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
function matchesBranch(emp, branchId) { return String(emp.branchId ?? "") === String(branchId); }
function metaError(msg) { return `<div style="color:var(--color-danger,#dc2626);padding:var(--space-4);font-size:var(--text-sm);border:1px solid #fecaca;border-radius:var(--radius-md);background:#fff1f2">${esc(msg)}</div>`; }
function esc(v) { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
