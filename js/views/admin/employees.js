import { branchesDB, usersDB } from "../../core/db.js";
import { TEXT } from "../../constants/text.js";
import { createEmployeeAccounts, deleteEmployeeAccount } from "../../core/admin-api.js";
import { modal } from "../../utils/modal.js";
import { toast } from "../../utils/toast.js";
import { formatDate } from "../../utils/date.js";

let employees = [];
let branches = [];
let pendingUploadRows = [];

const t = TEXT.employeeAdmin;

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">${t.title}</div>
        <div class="section-subtitle">${t.subtitle}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn--secondary" id="btn-download-template">${t.downloadTemplate}</button>
        <button class="btn btn--primary" id="btn-upload-employees">${t.excelUpload}</button>
      </div>
    </div>

    <div class="dashboard-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:var(--space-4)">
      ${statCard(t.stats.employees, "employee-count")}
      ${statCard(t.stats.active, "employee-active-count")}
      ${statCard(t.stats.branches, "employee-branch-count")}
    </div>

    <div class="filter-bar">
      <select class="form-control" id="employee-branch-filter" style="max-width:220px">
        <option value="">${t.allBranches}</option>
      </select>
      <div class="input-group filter-bar__search">
        <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.25"/>
          <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
        </svg>
        <input class="form-control" type="search" id="employee-search" placeholder="${t.searchPlaceholder}" />
      </div>
    </div>

    <div class="table-wrap" id="employee-table-wrap">
      <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-12)">
        <div class="splash__spinner" style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>
    </div>
  `;

  document.getElementById("btn-upload-employees")?.addEventListener("click", openUploadModal);
  document.getElementById("btn-download-template")?.addEventListener("click", downloadTemplate);
  document.getElementById("employee-branch-filter")?.addEventListener("change", applyFilters);
  document.getElementById("employee-search")?.addEventListener("input", applyFilters);

  await loadData();
}

async function loadData() {
  try {
    const [allUsers, branchList] = await Promise.all([
      usersDB.listAll().catch(() => []),
      branchesDB.listAll().catch(() => []),
    ]);
    employees = allUsers
      .filter((item) => item?.role === "employee")
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    branches = branchList;
  } catch (err) {
    console.error("[employees] load failed", err);
    employees = [];
    branches = [];
  }

  fillBranchFilter();
  renderStats();
  applyFilters();
}

function renderStats() {
  setText("employee-count", String(employees.length));
  setText("employee-active-count", String(employees.filter((item) => item.active !== false && !item.disabled).length));
  setText(
    "employee-branch-count",
    String(new Set(employees.map((item) => employeeBranchKey(item)).filter(Boolean)).size)
  );
}

function fillBranchFilter() {
  const select = document.getElementById("employee-branch-filter");
  if (!select) return;

  while (select.options.length > 1) select.remove(1);

  branches
    .slice()
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "en"))
    .forEach((branch) => {
      const option = document.createElement("option");
      option.value = branch.id;
      option.textContent = branchLabel(branch);
      select.appendChild(option);
    });

  const hasSelectedBranch = Array.from(select.options).some((option) => option.value === select.value);
  if (!hasSelectedBranch) select.value = "";
}

function applyFilters() {
  const branchId = document.getElementById("employee-branch-filter")?.value ?? "";
  const query = (document.getElementById("employee-search")?.value ?? "").trim().toLowerCase();

  let filtered = employees.slice();

  if (branchId) {
    const selectedBranch = branches.find((branch) => branch.id === branchId) ?? null;
    filtered = filtered.filter((item) => matchesSelectedBranch(item, selectedBranch));
  }

  if (query) {
    filtered = filtered.filter((item) => {
      const haystack = [
        item.empNo,
        item.name,
        item.branchName,
        item.branchCode,
        item.position,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  renderTable(filtered);
}

function renderTable(list) {
  const wrap = document.getElementById("employee-table-wrap");
  if (!wrap) return;

  if (!list.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">${t.emptyTitle}</div>
        <div>${t.emptyDescription}</div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>${t.table.empNo}</th>
          <th>${t.table.name}</th>
          <th>${t.table.branch}</th>
          <th>${t.table.position}</th>
          <th>${t.table.login}</th>
          <th>${t.table.status}</th>
          <th>${t.table.createdAt}</th>
          <th style="width:96px"></th>
        </tr>
      </thead>
      <tbody>
        ${list.map((item) => `
          <tr>
            <td class="cell--mono">${esc(item.empNo)}</td>
            <td style="font-weight:var(--weight-medium);color:var(--gray-800)">${esc(item.name)}</td>
            <td>${esc(item.branchName ?? item.branchCode ?? "-")}</td>
            <td>${esc(item.position ?? "-")}</td>
            <td class="cell--mono">${esc(item.email ?? `${item.empNo}@tas.local`)}</td>
            <td>
              <span class="chip ${item.active === false || item.disabled ? "chip--danger" : "chip--success"}">
                ${item.active === false || item.disabled ? t.status.inactive : t.status.active}
              </span>
            </td>
            <td>${formatDate(item.createdAt)}</td>
            <td class="cell--actions">
              <button
                class="btn btn--ghost btn--sm btn-delete-employee"
                data-id="${item.id}"
                data-name="${attr(item.name)}"
                style="color:var(--color-danger)"
              >
                ${TEXT.common.delete}
              </button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll(".btn-delete-employee").forEach((button) => {
    button.addEventListener("click", () => confirmDeleteEmployee(button.dataset.id, button.dataset.name));
  });
}

function openUploadModal() {
  pendingUploadRows = [];

  modal.open({
    title: t.uploadModal.title,
    size: "xl",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="card">
          <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-4)">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">${t.uploadModal.defaultBranch}</label>
                <select class="form-control" id="upload-default-branch">
                  <option value="">${t.uploadModal.useFileBranch}</option>
                  ${branches.map((branch) => `
                    <option value="${branch.id}">${esc(branchLabel(branch))}</option>
                  `).join("")}
                </select>
                <div class="form-hint">${t.uploadModal.defaultBranchHint}</div>
              </div>
              <div class="form-group">
                <label class="form-label form-label--required">${t.uploadModal.file}</label>
                <input class="form-control" id="upload-file" type="file" accept=".xlsx,.xls,.csv" />
                <div class="form-hint">${t.uploadModal.fileHint}</div>
              </div>
            </div>
            <div style="font-size:var(--text-xs);color:var(--gray-500);line-height:1.7">
              ${t.uploadModal.example}<br/>
              ${t.uploadModal.branchExample}
            </div>
          </div>
        </div>
        <div id="upload-preview" class="card">
          <div class="card__body" style="color:var(--gray-500)">
            ${t.uploadModal.previewIdle}
          </div>
        </div>
      </div>
    `,
    actions: [
      { label: TEXT.common.close, variant: "secondary", onClick: () => modal.close() },
      { label: t.uploadModal.action, variant: "primary", onClick: submitBulkUpload },
    ],
  });

  document.getElementById("upload-file")?.addEventListener("change", handleFileSelection);
  document.getElementById("upload-default-branch")?.addEventListener("change", () => {
    if (pendingUploadRows.length) renderUploadPreview(pendingUploadRows);
  });
}

async function handleFileSelection(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    pendingUploadRows = await parseWorkbook(file);
    renderUploadPreview(pendingUploadRows);
  } catch (err) {
    console.error("[employees] parse failed", err);
    pendingUploadRows = [];
    toast.error(t.uploadModal.parseFailed);
    renderUploadMessage(t.uploadModal.parseFailedDetail);
  }
}

function renderUploadPreview(rows) {
  const defaultBranchId = document.getElementById("upload-default-branch")?.value ?? "";
  const preview = rows.map((row, index) => normalizeUploadRow(row, index, defaultBranchId));
  const valid = preview.filter((row) => row.valid);
  const invalid = preview.filter((row) => !row.valid);

  const previewEl = document.getElementById("upload-preview");
  if (!previewEl) return;

  previewEl.innerHTML = `
    <div class="card__header">
      <div>
        <div class="card__title">${t.uploadModal.previewTitle}</div>
        <div class="card__subtitle">${t.uploadModal.validSummary(valid.length, invalid.length)}</div>
      </div>
    </div>
    <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-4)">
      ${invalid.length ? `
        <div style="padding:var(--space-4);border-radius:var(--radius-md);background:var(--color-danger-bg);color:#7a1a1e;font-size:var(--text-xs);line-height:1.7">
          ${invalid.map((row) => `${t.uploadModal.row} ${row.rowNumber}: ${esc(row.error)}`).join("<br/>")}
        </div>
      ` : `
        <div style="padding:var(--space-4);border-radius:var(--radius-md);background:var(--brand-50);color:var(--brand-500);font-size:var(--text-xs)">
          ${t.uploadModal.validationPassed}
        </div>
      `}
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t.uploadModal.row}</th>
              <th>${t.table.empNo}</th>
              <th>${t.table.name}</th>
              <th>${t.table.branch}</th>
              <th>${t.table.position}</th>
              <th>${t.table.status}</th>
            </tr>
          </thead>
          <tbody>
            ${preview.slice(0, 20).map((row) => `
              <tr>
                <td>${row.rowNumber}</td>
                <td class="cell--mono">${esc(row.empNo ?? "")}</td>
                <td>${esc(row.name ?? "")}</td>
                <td>${esc(row.branchName ?? row.branchInput ?? "")}</td>
                <td>${esc(row.position ?? "")}</td>
                <td><span class="chip ${row.valid ? "chip--success" : "chip--danger"}">${row.valid ? t.uploadModal.ready : t.uploadModal.error}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${preview.length > 20 ? `<div class="form-hint">${t.uploadModal.previewOnly}</div>` : ""}
    </div>
  `;
}

function renderUploadMessage(message) {
  const previewEl = document.getElementById("upload-preview");
  if (!previewEl) return;

  previewEl.innerHTML = `
    <div class="card__body" style="color:var(--gray-500)">
      ${message}
    </div>
  `;
}

async function submitBulkUpload() {
  if (!pendingUploadRows.length) {
    toast.error(t.uploadModal.noFile);
    return;
  }

  const defaultBranchId = document.getElementById("upload-default-branch")?.value ?? "";
  const normalized = pendingUploadRows.map((row, index) => normalizeUploadRow(row, index, defaultBranchId));
  const invalid = normalized.filter((row) => !row.valid);

  if (invalid.length) {
    toast.error(t.uploadModal.invalidRows);
    renderUploadPreview(pendingUploadRows);
    return;
  }

  modal.setLoading(t.uploadModal.action, true);
  try {
    const payload = normalized.map((row) => ({
      empNo: row.empNo,
      name: row.name,
      branchId: row.branchId,
      branchCode: row.branchCode,
      branchName: row.branchName,
      position: row.position,
    }));

    const result = await createEmployeeAccounts({ employees: payload });
    toast.success(t.uploadModal.createSuccess(result.createdCount, result.skippedCount));
    modal.close();
    resetFilters();
    await loadData();
    openUploadResultModal(result);
  } catch (err) {
    console.error("[employees] create failed", err);
    toast.error(err?.message ?? t.uploadModal.createFailed);
    modal.setLoading(t.uploadModal.action, false);
  }
}

function openUploadResultModal(result) {
  modal.open({
    title: t.uploadModal.resultTitle,
    size: "lg",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="dashboard-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:0">
          ${inlineStat(t.uploadModal.created, result.createdCount)}
          ${inlineStat(t.uploadModal.skipped, result.skippedCount)}
          ${inlineStat(t.uploadModal.failed, result.failedCount)}
        </div>
        <div class="card">
          <div class="card__body" style="font-size:var(--text-sm);line-height:1.7">
            ${t.uploadModal.loginFormat}: <code style="font-family:var(--font-mono)">empNo@tas.local</code><br/>
            ${t.uploadModal.initialPassword}: <code style="font-family:var(--font-mono)">empNo</code>
          </div>
        </div>
        ${renderResultList(t.uploadModal.createdEmployees, result.created, "chip--success")}
        ${renderResultList(t.uploadModal.skippedEmployees, result.skipped, "chip--warning")}
        ${renderResultList(t.uploadModal.failedEmployees, result.failed, "chip--danger")}
      </div>
    `,
    actions: [
      { label: TEXT.common.close, variant: "primary", onClick: () => modal.close() },
    ],
  });
}

function renderResultList(title, items, chipClass) {
  if (!items?.length) return "";
  return `
    <div class="card">
      <div class="card__header">
        <div class="card__title">${title}</div>
      </div>
      <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-2)">
        ${items.slice(0, 30).map((item) => `
          <div style="display:flex;justify-content:space-between;gap:var(--space-3);font-size:var(--text-sm)">
            <span>${esc(item.empNo ?? item.uid ?? "-")} ${t.branchLabelSeparator} ${esc(item.name ?? "")}</span>
            <span class="chip ${chipClass}">${esc(item.message ?? t.uploadModal.done)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function confirmDeleteEmployee(uid, name) {
  modal.open({
    title: t.deleteModal.title,
    size: "sm",
    body: `
      <p style="font-size:var(--text-sm);color:var(--gray-600);line-height:1.7">
        ${t.deleteModal.description(`<strong>${esc(name)}</strong>`)}
      </p>
    `,
    actions: [
      { label: TEXT.common.cancel, variant: "secondary", onClick: () => modal.close() },
      {
        label: TEXT.common.delete,
        variant: "danger",
        onClick: async () => {
          modal.setLoading(TEXT.common.delete, true);
          try {
            await deleteEmployeeAccount({ uid });
            toast.success(t.deleteModal.success);
            modal.close();
            await loadData();
          } catch (err) {
            console.error("[employees] delete failed", err);
            toast.error(err?.message ?? t.deleteModal.failed);
            modal.setLoading(TEXT.common.delete, false);
          }
        },
      },
    ],
  });
}

async function parseWorkbook(file) {
  const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function normalizeUploadRow(sourceRow, index, defaultBranchId) {
  const row = lowerCaseKeys(sourceRow);
  const empNo = normalizeEmpNo(readField(row, ["employee number", "empno", "emp no", "employee_no", "id", "사번"]));
  const name = String(readField(row, ["name", "이름", "성명"])).trim();
  const branchInput = String(readField(row, ["branch", "branchcode", "branch code", "지점", "지점코드"])).trim();
  const position = String(readField(row, ["position", "title", "직급", "직책"])).trim();
  const branch = resolveBranch(branchInput, defaultBranchId);

  if (!empNo) {
      return { rowNumber: index + 2, valid: false, error: t.uploadModal.missingEmpNo };
  }
  if (!name) {
    return { rowNumber: index + 2, empNo, valid: false, error: t.uploadModal.missingName };
  }
  if (!branch) {
    return {
      rowNumber: index + 2,
      empNo,
      name,
      branchInput,
      valid: false,
      error: t.uploadModal.branchNotMatched,
    };
  }

  return {
    rowNumber: index + 2,
    empNo,
    name,
    position,
    branchInput,
    branchId: branch.id,
    branchCode: branch.code ?? "",
    branchName: branch.name ?? "",
    valid: true,
  };
}

function resolveBranch(branchInput, defaultBranchId) {
  const normalizedInput = normalizeKey(branchInput);
  if (normalizedInput) {
    const matched = branches.find((branch) =>
      normalizeKey(branch.code) === normalizedInput ||
      normalizeKey(branch.name) === normalizedInput
    );
    if (matched) return matched;
  }

  if (defaultBranchId) {
    return branches.find((branch) => branch.id === defaultBranchId) ?? null;
  }

  return null;
}

async function downloadTemplate() {
  const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  const rows = [
    { "employee number": "100001", name: "홍길동", branch: "PUS", position: "사원" },
    { "employee number": "100002", name: "김철수", branch: "TAE", position: "주임" },
  ];
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "직원목록");
  XLSX.writeFile(workbook, "employee-upload-template.xlsx");
}

function statCard(label, valueId) {
  return `
    <div class="stat-card">
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value" id="${valueId}">0</div>
    </div>
  `;
}

function inlineStat(label, value) {
  return `
    <div class="stat-card">
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value">${value}</div>
    </div>
  `;
}

function branchLabel(branch) {
  return branch.code ? `${branch.code}${t.branchLabelSeparator}${branch.name}` : (branch.name ?? branch.id);
}

function readField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return "";
}

function lowerCaseKeys(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase(), value])
  );
}

function normalizeEmpNo(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function employeeBranchKey(item) {
  return item?.branchId || item?.branchCode || item?.branchName || "";
}

function matchesSelectedBranch(item, branch) {
  if (!branch) return true;
  const branchCandidates = [branch.id, branch.code, branch.name]
    .map((value) => normalizeKey(value))
    .filter(Boolean);
  return [item?.branchId, item?.branchCode, item?.branchName]
    .map((value) => normalizeKey(value))
    .some((value) => value && branchCandidates.includes(value));
}

function resetFilters() {
  const branchFilter = document.getElementById("employee-branch-filter");
  const searchInput = document.getElementById("employee-search");
  if (branchFilter) branchFilter.value = "";
  if (searchInput) searchInput.value = "";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(value) {
  return esc(value).replace(/'/g, "&#39;");
}
