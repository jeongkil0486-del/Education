import { router } from "../core/router.js";
import { loadTrainingReferences } from "../services/training-service.js";
import { bulkImportManualTrainingHistories } from "../core/admin-api.js";
import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";

let viewState = { company: null, branches: [], employees: [] };
let pendingHistoryRows = [];

export async function render(container) {
  const references = await loadTrainingReferences();
  viewState = {
    company: references.company ?? null,
    branches: [...(references.branches ?? [])].sort((a, b) => String(a.name ?? a.code ?? "").localeCompare(String(b.name ?? b.code ?? ""), "ko")),
    employees: [...(references.employees ?? [])].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko")),
  };

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">직원 관리</div>
        <div class="section-subtitle">직원 조회와 개인 교육이력 일괄 등록을 관리합니다.</div>
      </div>
      <button class="btn btn--secondary" id="btn-open-history-cards">직원 교육 이력카드</button>
    </div>

    <!-- 개인 교육이력 일괄 등록 카드 -->
    <div class="card" style="margin-bottom:var(--space-5);border-left:4px solid var(--brand-400)">
      <div class="card__header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-2)">
        <div>
          <div class="card__title">개인 교육이력 일괄 등록</div>
          <div class="card__subtitle">양식을 내려받아 수료 이력을 입력한 뒤 업로드하면 재교육 예정일과 잔여일이 자동 계산됩니다.</div>
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
          <!-- 파일 선택 전 안내 -->
          <div style="background:var(--gray-50);border:1px dashed var(--gray-300);border-radius:var(--radius-md);padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">
            Excel 파일을 선택하면 내용 미리보기와 검증 결과가 여기에 표시됩니다.
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
  document.getElementById("btn-history-template")?.addEventListener("click", downloadHistoryTemplate);
  document.getElementById("history-upload-file-inline")?.addEventListener("change", parseHistoryUploadFileInline);
  document.getElementById("btn-history-upload-submit")?.addEventListener("click", submitHistoryUploadInline);
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

async function loadXlsx() { return import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"); }

async function downloadHistoryTemplate() {
  try {
    const XLSX = await loadXlsx();
    const headers = ["사번","이름","교육유형","교육세부분류","교육과정명","교육과목","강사명","교육시간","교육시작일","교육종료일","수료일","결과","초기/보수","비고","재교육주기개월"];
    const sample = ["123456","홍길동","직무교육","직무","직무","직무","김강사",8,"2026-01-01","2026-01-01","2026-01-01","PASS","보수","예시 행",12];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, h.length + 4) }));
    XLSX.utils.book_append_sheet(wb, ws, "개인교육이력");
    XLSX.writeFile(wb, "personal-training-history-template.xlsx");
  } catch (err) { console.error(err); toast.error("양식을 만들지 못했습니다."); }
}

/* ──────────────────────────────────────────────────────────
   인라인 Excel 업로드 (화면 본문)
────────────────────────────────────────────────────────── */
async function parseHistoryUploadFileInline(event) {
  const file = event.target.files?.[0];
  const filenameEl = document.getElementById("history-upload-filename");
  const previewEl  = document.getElementById("history-upload-preview-inline");
  const submitBtn  = document.getElementById("btn-history-upload-submit");
  const resultEl   = document.getElementById("history-upload-result");

  if (filenameEl) filenameEl.textContent = file ? file.name : "선택된 파일 없음";
  if (resultEl)   resultEl.textContent = "";
  if (submitBtn)  submitBtn.disabled = true;
  pendingHistoryRows = [];

  if (!file || !previewEl) return;

  previewEl.innerHTML = `<div style="padding:var(--space-4);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">파일을 분석하는 중...</div>`;

  try {
    const XLSX = await loadXlsx();
    const wb   = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const raw  = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });

    pendingHistoryRows = raw.map(normalizeUploadRow);
    const employees = viewState.employees;
    const empByNo   = new Map(employees.map((e) => [String(e.empNo ?? "").trim(), e]));

    // 사번·이름 교차 검증
    pendingHistoryRows.forEach((r) => {
      const emp = empByNo.get(r.empNo);
      if (r.empNo && !emp) {
        r._errors.push("존재하지 않는 사번");
      } else if (emp && r.employeeName && emp.name && emp.name !== r.employeeName) {
        r._errors.push("사번과 이름 불일치");
      }
    });

    const total   = pendingHistoryRows.length;
    const invalid = pendingHistoryRows.filter((r) => r._errors.length).length;
    const valid   = total - invalid;

    const summaryColor = invalid > 0 ? "var(--color-warning, #d97706)" : "var(--color-success, #16a34a)";

    previewEl.innerHTML = `
      <div style="display:flex;gap:var(--space-4);margin-bottom:var(--space-3);flex-wrap:wrap">
        <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm)">전체 <strong>${total}건</strong></div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm);color:#15803d">정상 <strong>${valid}건</strong></div>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:var(--radius-md);padding:var(--space-2) var(--space-4);font-size:var(--text-sm);color:#c2410c">오류 <strong>${invalid}건</strong></div>
        ${invalid > 0 ? `<div style="font-size:var(--text-xs);color:var(--gray-500);align-self:center">※ 오류 행을 수정 후 재업로드하거나, 정상 행만 업로드할 수 있습니다.</div>` : ""}
      </div>
      <div class="table-wrap" style="max-height:360px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius-md)">
        <table class="data-table" style="min-width:720px">
          <thead>
            <tr>
              <th style="width:40px">행</th>
              <th>사번</th>
              <th>이름</th>
              <th>교육유형</th>
              <th>세부분류</th>
              <th>교육과정명</th>
              <th>수료일</th>
              <th>재교육주기</th>
              <th>검증 결과</th>
            </tr>
          </thead>
          <tbody>
            ${pendingHistoryRows.map((r, i) => `
              <tr style="background:${r._errors.length ? "#fff7ed" : ""}">
                <td style="color:var(--gray-400);text-align:center">${i + 2}</td>
                <td>${escapeHtml(r.empNo)}</td>
                <td>${escapeHtml(r.employeeName)}</td>
                <td>${escapeHtml(r.trainingType)}</td>
                <td>${escapeHtml(r.subjectName)}</td>
                <td>${escapeHtml(r.title)}</td>
                <td>${escapeHtml(String(r.completedAt || ""))}</td>
                <td style="text-align:center">${r.cycleMonths ? `${r.cycleMonths}개월` : "–"}</td>
                <td>${r._errors.length
                  ? `<span style="color:#c2410c;font-size:var(--text-xs)">${escapeHtml(r._errors.join(" / "))}</span>`
                  : `<span style="color:#15803d;font-size:var(--text-xs)">✓ 정상</span>`
                }</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    if (submitBtn) submitBtn.disabled = valid === 0;
  } catch (err) {
    console.error("[employees] parseHistoryUploadFileInline", err);
    pendingHistoryRows = [];
    previewEl.innerHTML = `<div style="color:var(--color-danger);font-size:var(--text-sm);padding:var(--space-3)">파일을 읽지 못했습니다. xlsx 형식인지 확인해 주세요.</div>`;
  }
}

async function submitHistoryUploadInline() {
  const submitBtn = document.getElementById("btn-history-upload-submit");
  const resultEl  = document.getElementById("history-upload-result");

  const validRows = pendingHistoryRows.filter((r) => !r._errors.length);
  if (!validRows.length) { toast.warning("업로드할 수 있는 정상 행이 없습니다."); return; }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "업로드 중..."; }
  if (resultEl)  resultEl.textContent = "";

  try {
    const rows   = validRows.map(({ _errors, ...row }) => row);
    const result = await bulkImportManualTrainingHistories({ rows });

    const msg = `✅ 등록 ${result.succeededCount ?? 0}건 · 중복 ${result.skippedCount ?? 0}건 · 실패 ${result.failedCount ?? 0}건`;
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--color-success,#16a34a)">${escapeHtml(msg)}</span>`;
    toast.success(msg);

    // 결과 표시 후 초기화
    pendingHistoryRows = [];
    const fileInput = document.getElementById("history-upload-file-inline");
    if (fileInput) fileInput.value = "";
    const filenameEl = document.getElementById("history-upload-filename");
    if (filenameEl) filenameEl.textContent = "선택된 파일 없음";
    const previewEl = document.getElementById("history-upload-preview-inline");
    if (previewEl) previewEl.innerHTML = `<div style="background:var(--gray-50);border:1px dashed var(--gray-300);border-radius:var(--radius-md);padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">업로드가 완료되었습니다. 다음 파일을 선택하세요.</div>`;
  } catch (err) {
    console.error("[employees] submitHistoryUploadInline", err);
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--color-danger)">${escapeHtml(err?.message || "업로드에 실패했습니다.")}</span>`;
    toast.error(err?.message || "업로드에 실패했습니다.");
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px"><path d="M8 10V2m0 0L5 5m3-3l3 3M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>이력 업로드`; }
  }
}

/* ──────────────────────────────────────────────────────────
   Excel 업로드 모달 (기존 — 유지)
────────────────────────────────────────────────────────── */
function openHistoryUploadModal() {
  pendingHistoryRows = [];
  modal.open({
    title: "개인 교육이력 Excel 업로드", size: "lg",
    body: `<div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="form-group"><label class="form-label form-label--required">작성된 Excel 파일</label><input class="form-control" id="history-upload-file" type="file" accept=".xlsx,.xls,.csv"/><div class="form-hint">사번, 교육유형, 교육세부분류/교육과목, 교육과정명, 수료일은 필수입니다.</div></div>
      <div id="history-upload-preview"><div class="empty-state" style="padding:var(--space-8)">파일을 선택하면 검증 결과가 표시됩니다.</div></div>
    </div>`,
    actions: [
      { label:"취소", variant:"secondary", onClick:()=>modal.close() },
      { label:"업로드", variant:"primary", onClick:submitHistoryUpload },
    ],
  });
  document.getElementById("history-upload-file")?.addEventListener("change", parseHistoryUploadFile);
}

async function parseHistoryUploadFile(event) {
  const file = event.target.files?.[0]; const preview=document.getElementById("history-upload-preview");
  if (!file || !preview) return;
  try {
    const XLSX=await loadXlsx(); const wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
    const raw=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:"",raw:false});
    pendingHistoryRows=raw.map(normalizeUploadRow);
    const invalid=pendingHistoryRows.filter((r)=>r._errors.length);
    preview.innerHTML=`<div style="font-size:var(--text-sm);margin-bottom:var(--space-2)">총 ${pendingHistoryRows.length}건 · 정상 ${pendingHistoryRows.length-invalid.length}건 · 오류 ${invalid.length}건</div><div class="table-wrap" style="max-height:320px"><table class="data-table"><thead><tr><th>행</th><th>사번</th><th>이름</th><th>교육유형</th><th>세부분류</th><th>수료일</th><th>검증</th></tr></thead><tbody>${pendingHistoryRows.slice(0,30).map((r,i)=>`<tr><td>${i+2}</td><td>${escapeHtml(r.empNo)}</td><td>${escapeHtml(r.employeeName)}</td><td>${escapeHtml(r.trainingType)}</td><td>${escapeHtml(r.subjectName)}</td><td>${escapeHtml(String(r.completedAt||""))}</td><td>${r._errors.length?`<span style="color:var(--color-danger)">${escapeHtml(r._errors.join(", "))}</span>`:"정상"}</td></tr>`).join("")}</tbody></table></div>`;
  } catch(err) { console.error(err); pendingHistoryRows=[]; preview.innerHTML=`<div style="color:var(--color-danger)">파일을 읽지 못했습니다.</div>`; }
}

function normalizeUploadRow(row) {
  const get=(...keys)=>{for(const key of keys){if(row[key]!==undefined&&row[key]!=="")return row[key];}return "";};
  const result={
    empNo:String(get("사번","empNo")).trim(), employeeName:String(get("이름","성명","name")).trim(),
    trainingType:String(get("교육유형","trainingType")).trim(), subjectName:String(get("교육세부분류","교육과목","subjectName")).trim(),
    subjectCode:String(get("세부분류코드","subjectCode")).trim(), title:String(get("교육과정명","courseName","title")).trim(),
    courseName:String(get("교육과정명","courseName")).trim(), instructorName:String(get("강사명","instructorName")).trim(),
    hours:Number(get("교육시간","hours"))||0, startDate:get("교육시작일","startDate"), endDate:get("교육종료일","endDate"),
    completedAt:get("수료일","completionDate","completedAt"), result:String(get("결과","result")||"PASS").trim(),
    subType:normalizeSubType(get("초기/보수","subType")), note:String(get("비고","note")).trim(), cycleMonths:Number(get("재교육주기개월","cycleMonths"))||0,
  };
  result._errors=[]; if(!result.empNo)result._errors.push("사번 누락"); if(!result.trainingType)result._errors.push("교육유형 누락"); if(!result.subjectName)result._errors.push("세부분류 누락"); if(!result.title)result._errors.push("교육과정명 누락"); if(!result.completedAt)result._errors.push("수료일 누락"); return result;
}
function normalizeSubType(v){const x=String(v??"").trim();return x==="초기"?"initial":x==="보수"?"recurring":x;}

async function submitHistoryUpload(){
  if(!pendingHistoryRows.length){toast.warning("먼저 Excel 파일을 선택해 주세요.");return;}
  const invalid=pendingHistoryRows.filter((r)=>r._errors.length); if(invalid.length){toast.error(`오류 행 ${invalid.length}건을 수정해 주세요.`);return;}
  modal.setLoading("업로드",true);
  try{const rows=pendingHistoryRows.map(({_errors,...row})=>row);const result=await bulkImportManualTrainingHistories({rows});modal.close();toast.success(`등록 ${result.succeededCount}건 · 중복 ${result.skippedCount}건 · 실패 ${result.failedCount}건`);}
  catch(err){console.error(err);toast.error(err?.message||"업로드에 실패했습니다.");modal.setLoading("업로드",false);}
}

function matchesSelectedBranch(employee, branch) { const c=[branch.id,branch.code,branch.name].map(normalizeKey).filter(Boolean); return [employee.branchId,employee.branchCode,employee.branchName].map(normalizeKey).some((v)=>v&&c.includes(v)); }
function normalizeKey(value){return String(value??"").trim().toLowerCase();}
function escapeHtml(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
