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

    <div class="card" style="margin-bottom:var(--space-5);border-left:4px solid var(--brand-400)">
      <div class="card__body" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);flex-wrap:wrap">
        <div>
          <div style="font-weight:var(--weight-semibold);color:var(--gray-800)">개인 교육이력 일괄 관리</div>
          <div style="font-size:var(--text-sm);color:var(--gray-500);margin-top:4px">양식을 내려받아 기존 수료 이력을 입력한 뒤 업로드하면 재교육 예정일과 잔여일이 계산됩니다.</div>
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          <button class="btn btn--secondary" id="btn-history-template">양식 다운로드</button>
          <button class="btn btn--primary" id="btn-history-upload">작성 양식 업로드</button>
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
  document.getElementById("btn-history-upload")?.addEventListener("click", openHistoryUploadModal);
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
