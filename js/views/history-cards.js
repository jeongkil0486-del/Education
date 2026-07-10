import { authStore, ROLES } from "../core/auth.js";
import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";
import { formatDate } from "../utils/date.js";
import { buildEmployeeHistoryRowsV2, loadTrainingReferences } from "../services/training-service.js";
import {
  exportEmployeeHistoryCard,
  getLatestHistoryCardTemplate,
  listHistoryCardTemplates,
  uploadHistoryCardTemplate,
} from "../services/history-card-export.js";

const SECTION_ORDER = ["job_initial", "job_recurring", "legal", "online", "external", "other"];
const SECTION_LABELS = {
  job_initial: "吏곷Т珥덇린援먯쑁",
  job_recurring: "吏곷Т蹂댁닔援먯쑁",
  legal: "踰뺤젙援먯쑁",
  online: "?⑤씪?멸탳??,
  external: "?몃?援먯쑁",
  other: "湲고?",
};

function getSectionKey(row) {
  if (row.trainingType === "job") {
    return row.subType === "initial" ? "job_initial" : "job_recurring";
  }
  return row.trainingType;
}

let S = {
  employees: [],
  branches: [],
  selectedBranchId: "",
  searchText: "",
  selectedEmployeeId: "",
  selectedEmployee: null,
  rows: [],
  templates: [],
};

export async function render(container, params = {}) {
  const canManageTemplates = authStore.role === ROLES.HQ_ADMIN;

  container.innerHTML = `
    <div class="hc-wrap">
      <div class="section-header">
        <div>
          <div class="section-title">吏곸썝 援먯쑁 ?대젰移대뱶</div>
          <div class="section-subtitle">${canManageTemplates ? "吏?먮퀎 吏곸썝???좏깮?섏뿬 援먯쑁 ?대젰??議고쉶?섍퀬 ?ㅼ슫濡쒕뱶?⑸땲??" : "담당 지점 직원의 교육 이력을 조회하고 확인합니다."}</div>
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          ${canManageTemplates ? '<button class="btn btn--secondary" id="btn-upload-template">?묒떇 ?낅줈??/button>' : ""}
          <button class="btn btn--primary" id="btn-download-card" disabled>?대젰移대뱶 ?ㅼ슫濡쒕뱶</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card__body card__body--compact">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">吏곸썝 寃??/label>
              <div class="input-group">
                <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
                  <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
                </svg>
                <input class="form-control" id="hc-search" type="search" placeholder="?대쫫 ?먮뒗 ?щ쾲?쇰줈 寃?? />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">吏???좏깮</label>
              <select class="form-control" id="hc-branch">
                <option value="">?꾩껜 吏??/option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-5)">
        <div class="card__header">
          <div class="card__title">吏곸썝 紐⑸줉</div>
          <div class="card__subtitle" id="hc-employee-count">吏?먯쓣 ?좏깮?섍굅??寃?됱뼱瑜??낅젰?섏꽭??</div>
        </div>
        <div class="card__body" style="padding:0;max-height:320px;overflow-y:auto" id="hc-employee-list">
          <div class="empty-state" style="padding:var(--space-10)">
            <div class="empty-state__title" style="font-size:var(--text-sm)">吏?먯쓣 ?좏깮?섍굅???대쫫쨌?щ쾲?쇰줈 寃?됲빐 二쇱꽭??</div>
          </div>
        </div>
      </div>

      <div id="hc-card-section" style="display:none">
        <div id="hc-selected-banner" style="
          display:flex;align-items:center;justify-content:space-between;
          background:var(--brand-50,#eff6ff);border:1px solid var(--brand-200,#bfdbfe);
          border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4);
          margin-bottom:var(--space-4);font-size:var(--text-sm);
        ">
          <span id="hc-selected-label" style="font-weight:var(--weight-semibold);color:var(--brand-700,#1d4ed8)"></span>
          <button class="btn btn--ghost btn--sm" id="btn-deselect" style="color:var(--gray-500)">???좏깮 ?댁젣</button>
        </div>

        <div class="hc-summary-grid" id="hc-summary"></div>

        <div class="card" style="margin-bottom:var(--space-4)">
          <div class="card__header"><div class="card__title">?몄쟻?ы빆</div></div>
          <div class="card__body" id="hc-profile"></div>
        </div>

        <div id="hc-sections"></div>
      </div>

      <div id="hc-loading" style="display:none;padding:var(--space-16);text-align:center">
        <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400);margin:auto"></div>
      </div>
    </div>
  `;

  document.getElementById("btn-upload-template")?.addEventListener("click", openUploadModal);
  document.getElementById("btn-download-card")?.addEventListener("click", handleDownload);
  document.getElementById("btn-deselect")?.addEventListener("click", deselectEmployee);
  document.getElementById("hc-search")?.addEventListener("input", onFilter);
  document.getElementById("hc-branch")?.addEventListener("change", onFilter);

  await initView(params.uid ?? "");
}

async function initView(initialUid = "") {
  try {
    const [references, templates] = await Promise.all([
      loadTrainingReferences(),
      listHistoryCardTemplates(),
    ]);

    S.employees = references.employees ?? [];
    S.branches = references.branches ?? [];
    S.templates = templates;

    const branchSel = document.getElementById("hc-branch");
    if (branchSel) {
      branchSel.innerHTML = `<option value="">?꾩껜 吏??/option>` +
        S.branches.map((branch) => `<option value="${branch.id}">${esc(branch.name ?? branch.code ?? branch.id)}</option>`).join("");
    }

    if (initialUid) {
      if (!S.employees.some((employee) => (employee.id ?? employee.uid) === initialUid)) {
        toast.warning("조회 권한이 없는 직원입니다.");
        renderEmployeeList();
        return;
      }
      S.selectedEmployeeId = initialUid;
      renderEmployeeList();
      await loadCard(initialUid);
      return;
    }

    renderEmployeeList();
  } catch (err) {
    console.error("[history-cards] init failed", err);
    toast.error("援먯쑁 ?대젰移대뱶 ?붾㈃??遺덈윭?ㅼ? 紐삵뻽?듬땲??");
  }
}

function onFilter() {
  S.searchText = String(document.getElementById("hc-search")?.value ?? "").trim().toLowerCase();
  S.selectedBranchId = document.getElementById("hc-branch")?.value ?? "";
  renderEmployeeList();
}

function renderEmployeeList() {
  const listEl = document.getElementById("hc-employee-list");
  const countEl = document.getElementById("hc-employee-count");
  if (!listEl) return;

  const filtered = S.employees.filter((employee) => {
    const matchBranch = !S.selectedBranchId || employee.branchId === S.selectedBranchId;
    const matchSearch = !S.searchText || [employee.name, employee.empNo]
      .some((value) => String(value ?? "").toLowerCase().includes(S.searchText));
    return matchBranch && matchSearch;
  });

  if (countEl) {
    countEl.textContent = filtered.length ? `珥?${filtered.length}紐?` : "寃??寃곌낵媛 ?놁뒿?덈떎.";
  }

  if (!filtered.length) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding:var(--space-10)">
        <div class="empty-state__title" style="font-size:var(--text-sm)">?대떦 議곌굔??吏곸썝???놁뒿?덈떎.</div>
      </div>`;
    return;
  }

  listEl.innerHTML = `
    <table class="hc-employee-table">
      <thead>
        <tr>
          <th>?대쫫</th>
          <th>?щ쾲</th>
          <th>吏??/th>
          <th>吏곸콉</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((employee) => {
          const uid = employee.id ?? employee.uid;
          const isSelected = uid === S.selectedEmployeeId;
          return `
            <tr data-uid="${uid}" class="${isSelected ? "hc-row--selected" : ""}" title="?붾툝?대┃?섏뿬 ?대젰移대뱶 議고쉶">
              <td style="font-weight:${isSelected ? "var(--weight-semibold)" : "normal"}">${esc(employee.name ?? "??)}</td>
              <td style="font-family:monospace;font-size:var(--text-xs)">${esc(employee.empNo ?? "??)}</td>
              <td>${esc(employee.branchName ?? "??)}</td>
              <td>${esc(employee.position ?? "??)}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;

  listEl.querySelectorAll("tbody tr[data-uid]").forEach((row) => {
    row.addEventListener("click", () => {
      listEl.querySelectorAll("tbody tr").forEach((item) => item.classList.remove("hc-row--selected"));
      row.classList.add("hc-row--selected");
      S.selectedEmployeeId = row.dataset.uid;
    });

    row.addEventListener("dblclick", async () => {
      S.selectedEmployeeId = row.dataset.uid;
      await loadCard(row.dataset.uid);
    });
  });
}

async function loadCard(uid) {
  const cardSection = document.getElementById("hc-card-section");
  const loadingEl = document.getElementById("hc-loading");
  const downloadBtn = document.getElementById("btn-download-card");

  if (cardSection) cardSection.style.display = "none";
  if (loadingEl) loadingEl.style.display = "block";

  try {
    if (!S.employees.some((employee) => (employee.id ?? employee.uid) === uid)) {
      throw new Error("ACCESS_DENIED");
    }

    const { employee, rows } = await buildEmployeeHistoryRowsV2(uid);
    S.selectedEmployee = employee;
    S.rows = rows;

    if (downloadBtn) downloadBtn.disabled = false;

    const bannerLabel = document.getElementById("hc-selected-label");
    if (bannerLabel) {
      bannerLabel.textContent = `${employee?.name ?? "??} (${employee?.empNo ?? "??}) 쨌 ${employee?.branchName ?? "??} 쨌 ${employee?.position ?? "??}`;
    }

    renderSummary(rows);
    renderProfile(employee);
    renderSections(rows);

    if (cardSection) cardSection.style.display = "block";
  } catch (err) {
    console.error("[history-cards] load failed", err);
    toast.error(err?.message === "ACCESS_DENIED"
      ? "조회 권한이 없는 직원입니다."
      : "援먯쑁 ?대젰??遺덈윭?ㅼ? 紐삵뻽?듬땲??");
  } finally {
    if (loadingEl) loadingEl.style.display = "none";
  }
}

function deselectEmployee() {
  S.selectedEmployeeId = "";
  S.selectedEmployee = null;
  S.rows = [];

  const cardSection = document.getElementById("hc-card-section");
  if (cardSection) cardSection.style.display = "none";

  const downloadBtn = document.getElementById("btn-download-card");
  if (downloadBtn) downloadBtn.disabled = true;

  renderEmployeeList();
}

function renderSummary(rows) {
  const el = document.getElementById("hc-summary");
  if (!el) return;

  const now = Date.now();
  const totalCount = rows.length;
  const completedCount = rows.filter((row) => row.completionStatus === "completed").length;
  const inProgressCount = rows.filter((row) => row.completionStatus !== "completed" && (!row.deadline || row.deadline >= now)).length;
  const failCount = rows.filter((row) => row.completionStatus !== "completed" && row.deadline && row.deadline < now).length;
  const lastDate = rows.filter((row) => row.completedAt).sort((a, b) => b.completedAt - a.completedAt)[0]?.completedAt ?? null;
  const nextDate = rows.filter((row) => row.deadline && row.deadline > now).sort((a, b) => a.deadline - b.deadline)[0]?.deadline ?? null;

  el.innerHTML = [
    { label: "珥?援먯쑁 嫄댁닔", value: totalCount, isDate: false },
    { label: "?섎즺 嫄댁닔", value: completedCount, isDate: false },
    { label: "吏꾪뻾以?", value: inProgressCount, isDate: false },
    { label: "誘몄닔猷?", value: failCount, isDate: false },
    { label: "理쒓렐 援먯쑁??", value: lastDate ? formatDate(lastDate) : "??, isDate: true },
    { label: "?ㅼ쓬 援먯쑁 ?덉젙??", value: nextDate ? formatDate(nextDate) : "??, isDate: true },
  ].map(({ label, value, isDate }) => `
    <div class="stat-card">
      <div class="stat-card__label">${esc(label)}</div>
      <div class="stat-card__value" style="${isDate ? "font-size:var(--text-base);font-weight:var(--weight-semibold)" : ""}">${esc(String(value))}</div>
    </div>`).join("");
}

function renderProfile(employee) {
  const el = document.getElementById("hc-profile");
  if (!el) return;

  const fields = [
    { label: "?깅챸", value: employee?.name ?? "?? },
    { label: "?щ쾲", value: employee?.empNo ?? "?? },
    { label: "?앸뀈?붿씪", value: employee?.birthDate ? formatDate(employee.birthDate) : "?? },
    { label: "?낆궗??", value: employee?.joinDate ? formatDate(employee.joinDate) : "?? },
    { label: "?좎엯/寃쎈젰", value: employee?.entryType ?? "?? },
    { label: "?щ궡 ?먭꺽", value: employee?.internalLicense ?? "?? },
    { label: "?ъ쇅 ?먭꺽", value: employee?.externalLicense ?? "?? },
    { label: "吏??", value: employee?.branchName ?? "?? },
    { label: "吏곸콉", value: employee?.position ?? "?? },
  ];

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-3)">
      ${fields.map(({ label, value }) => `
        <div style="display:flex;flex-direction:column;gap:2px">
          <div style="font-size:var(--text-xs);color:var(--gray-400)">${esc(label)}</div>
          <div style="font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--gray-800)">${esc(value)}</div>
        </div>`).join("")}
    </div>`;
}

function renderSections(rows) {
  const el = document.getElementById("hc-sections");
  if (!el) return;

  const sectionMap = {};
  rows.forEach((row) => {
    const key = getSectionKey(row);
    if (!sectionMap[key]) sectionMap[key] = [];
    sectionMap[key].push(row);
  });

  el.innerHTML = SECTION_ORDER.map((key) => {
    const sectionRows = sectionMap[key] ?? [];
    return `
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card__header" style="background:var(--gray-50);border-bottom:1px solid var(--gray-200)">
          <div class="card__title" style="font-size:var(--text-sm)">
            ${esc(SECTION_LABELS[key])}
            <span class="chip chip--info" style="margin-left:var(--space-2)">${sectionRows.length}嫄?/span>
          </div>
        </div>
        <div class="card__body" style="padding:0">
          ${sectionRows.length === 0
            ? `<div style="padding:var(--space-6);text-align:center;color:var(--gray-400);font-size:var(--text-sm)">?대젰 ?놁쓬</div>`
            : `<div class="table-wrap">
                <table class="hc-section-table">
                  <thead>
                    <tr>
                      <th>援먯쑁怨쇱젙紐?/th>
                      <th>援먯쑁怨쇰ぉ</th>
                      <th>媛뺤궗</th>
                      <th>援먯쑁?쒓컙</th>
                      <th>援먯쑁湲곌컙</th>
                      <th>?섎즺??/th>
                      <th>寃곌낵</th>
                      <th>珥덇린/蹂댁닔</th>
                      <th>鍮꾧퀬</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${sectionRows.map((row) => historyRow(row)).join("")}
                  </tbody>
                </table>
              </div>`
          }
        </div>
      </div>`;
  }).join("");
}

function historyRow(row) {
  const period = (row.startDate && row.endDate)
    ? `${formatDate(row.startDate)} ~ ${formatDate(row.endDate)}`
    : (row.startDate ? formatDate(row.startDate) : "??);
  const result = row.completionStatus === "completed" ? "PASS" : "??;
  const subType = row.trainingType === "job" ? (row.subType === "initial" ? "珥덇린" : "蹂댁닔") : "??;

  return `
    <tr>
      <td>${esc(row.title)}</td>
      <td>??/td>
      <td>${esc(row.instructorName)}</td>
      <td>??/td>
      <td style="white-space:nowrap">${period}</td>
      <td style="white-space:nowrap">${row.completedAt ? formatDate(row.completedAt) : "??}</td>
      <td>${result}</td>
      <td>${subType}</td>
      <td>${esc(row.note || "??)}</td>
    </tr>`;
}

function openUploadModal() {
  modal.open({
    title: "援먯쑁?대젰移대뱶 ?묒떇 ?낅줈??,
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="background:var(--blue-50,#eff6ff);border:1px solid var(--blue-200,#bfdbfe);border-radius:var(--radius-md);padding:var(--space-4);font-size:var(--text-sm);color:var(--blue-800,#1e40af)">
          <strong>?덈궡</strong><br/>
          ?뚯궗?먯꽌 ?ъ슜 以묒씤 援먯쑁?대젰移대뱶 ?묒? ?묒떇(.xlsx)???낅줈?쒗븯?몄슂.<br/>
          ?먮낯 ?쒖떇(蹂묓빀?쨌湲瑗는룻뀒?먮━쨌?됱긽쨌?됰넂?는룹뿴?덈퉬)??洹몃?濡??좎??섍퀬 ?곗씠?곕쭔 梨꾩썙 ?ｌ뒿?덈떎.
        </div>
        <div class="form-group">
          <label class="form-label form-label--required">?묒떇 ?뚯씪 (.xlsx)</label>
          <input class="form-control" id="hc-template-file" type="file" accept=".xlsx,.xlsm,.xls" />
          <div class="form-hint">蹂묓빀 ?, ?몄뇙 ?ㅼ젙???ы븿???먮낯 ?묒떇???щ젮二쇱꽭??</div>
        </div>
      </div>`,
    actions: [
      { label: "痍⑥냼", variant: "secondary", onClick: () => modal.close() },
      {
        label: "?낅줈??,
        variant: "primary",
        onClick: async () => {
          const file = document.getElementById("hc-template-file")?.files?.[0];
          if (!file) {
            toast.warning("?묒떇 ?뚯씪???좏깮??二쇱꽭??");
            return;
          }
          modal.setLoading("?낅줈??, true);
          try {
            await uploadHistoryCardTemplate(file);
            S.templates = await listHistoryCardTemplates();
            toast.success("援먯쑁?대젰移대뱶 ?묒떇???낅줈?쒕릺?덉뒿?덈떎.");
            modal.close();
          } catch (err) {
            console.error("[history-cards] upload failed", err);
            toast.error("?묒떇 ?낅줈??以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
            modal.setLoading("?낅줈??, false);
          }
        },
      },
    ],
  });
}

async function handleDownload() {
  if (!S.selectedEmployee) {
    toast.warning("癒쇱? 吏곸썝???좏깮??二쇱꽭??");
    return;
  }

  const template = await getLatestHistoryCardTemplate().catch(() => null);
  if (!template) {
    toast.warning("?낅줈?쒕맂 ?묒떇???놁뒿?덈떎. 癒쇱? 援먯쑁?대젰移대뱶 ?묒떇???낅줈?쒗빐 二쇱꽭??");
    return;
  }

  try {
    const result = await exportEmployeeHistoryCard({ employee: S.selectedEmployee, rows: S.rows, template });
    toast.success(result.mode === "json-fallback"
      ? "?쇱씠釉뚮윭由щ? 遺덈윭?ㅼ? 紐삵빐 JSON ?뺤떇?쇰줈 ?ㅼ슫濡쒕뱶?덉뒿?덈떎."
      : `${result.fileName} ?ㅼ슫濡쒕뱶媛 ?쒖옉?섏뿀?듬땲??`);
  } catch (err) {
    console.error("[history-cards] export failed", err);
    toast.error("?대젰移대뱶 ?ㅼ슫濡쒕뱶 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
  }
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
