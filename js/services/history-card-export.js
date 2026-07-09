import { authStore } from "../core/auth.js";
import { templatesDB } from "../core/db.js";
import { formatDate, formatDateTime } from "../utils/date.js";

export const DEFAULT_HISTORY_CARD_MAPPING = {
  overviewSheetName: "이력카드",
  dataSheetName: "이력데이터",
  titleCell: "A1",
  summaryStartCell: "A3",
  dataStartCell: "A1",
};

let xlsxModulePromise = null;

async function loadXlsxModule() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs")
      .catch(() => null);
  }
  return xlsxModulePromise;
}

export async function listHistoryCardTemplates() {
  const templates = await templatesDB.list(authStore.companyId);
  return templates
    .filter((template) => template.templateType === "history_card")
    .sort((a, b) => Number(b.uploadedAt ?? b.createdAt ?? 0) - Number(a.uploadedAt ?? a.createdAt ?? 0));
}

export async function getLatestHistoryCardTemplate() {
  const templates = await listHistoryCardTemplates();
  return templates[0] ?? null;
}

export async function uploadHistoryCardTemplate(file) {
  const buffer = await file.arrayBuffer();
  const xlsx = await loadXlsxModule();

  let sheetNames = [];
  let mergeCount = 0;

  if (xlsx) {
    try {
      const workbook = xlsx.read(buffer, { type: "array", cellStyles: true, dense: false });
      sheetNames = workbook.SheetNames ?? [];
      mergeCount = sheetNames.reduce((count, sheetName) => {
        const merges = workbook.Sheets?.[sheetName]?.["!merges"] ?? [];
        return count + merges.length;
      }, 0);
    } catch (error) {
      console.warn("[history-card-export] template parse failed", error);
    }
  }

  const created = await templatesDB.create({
    companyId: authStore.companyId,
    companyName: authStore.profile?.companyName ?? "",
    templateType: "history_card",
    title: "개인교육이력카드 양식",
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    uploadedAt: Date.now(),
    uploadedBy: authStore.uid,
    uploadedByName: authStore.name,
    sheetNames,
    mergeCount,
    mappingVersion: 1,
    mappingMode: "data-sheet-fallback",
    fileData: arrayBufferToBase64(buffer),
  });

  return created.key;
}

export async function exportEmployeeHistoryCard({ employee, rows, template = null }) {
  const xlsx = await loadXlsxModule();
  if (!xlsx) {
    downloadBlob(
      new Blob([JSON.stringify({ employee, rows }, null, 2)], { type: "application/json;charset=utf-8" }),
      buildFileName(employee, "json")
    );
    return { mode: "json-fallback", fileName: buildFileName(employee, "json") };
  }

  let workbook = null;
  const targetTemplate = template ?? await getLatestHistoryCardTemplate();
  if (targetTemplate?.fileData) {
    workbook = xlsx.read(base64ToArrayBuffer(targetTemplate.fileData), {
      type: "array",
      cellStyles: true,
      cellNF: true,
      cellDates: true,
    });
  } else {
    workbook = xlsx.utils.book_new();
  }

  applyHistoryCardMapping(xlsx, workbook, employee, rows);

  const output = xlsx.write(workbook, {
    type: "array",
    bookType: "xlsx",
    cellStyles: true,
  });

  const fileName = buildFileName(employee, "xlsx");
  downloadBlob(
    new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName
  );

  return {
    mode: targetTemplate?.fileData ? "template-workbook" : "generated-workbook",
    fileName,
  };
}

function applyHistoryCardMapping(xlsx, workbook, employee, rows) {
  const overviewSheetName = workbook.SheetNames?.[0] ?? DEFAULT_HISTORY_CARD_MAPPING.overviewSheetName;
  const overviewSheet = workbook.Sheets?.[overviewSheetName] ?? xlsx.utils.aoa_to_sheet([]);
  workbook.Sheets[overviewSheetName] = overviewSheet;
  if (!workbook.SheetNames?.includes(overviewSheetName)) {
    workbook.SheetNames.unshift(overviewSheetName);
  }

  const overviewRows = [
    ["개인교육이력카드"],
    [],
    ["직원명", employee?.name ?? "-"],
    ["사번", employee?.empNo ?? "-"],
    ["회사", employee?.companyName ?? "-"],
    ["지점", employee?.branchName ?? "-"],
    ["생성일시", formatDateTime(Date.now())],
    ["이력 건수", rows.length],
  ];

  xlsx.utils.sheet_add_aoa(overviewSheet, overviewRows, {
    origin: DEFAULT_HISTORY_CARD_MAPPING.titleCell,
  });

  const historyRows = rows.map((row) => ({
    직원명: row.employeeName,
    사번: row.empNo,
    회사: row.companyName,
    지점: row.branchName,
    교육명: row.title,
    교육유형: row.trainingTypeLabel,
    배정일: formatDate(row.assignedAt),
    완료일시: formatDateTime(row.completedAt),
    서명여부: row.signedAt ? "완료" : "미완료",
    수료상태: row.completionStatus === "completed" ? "수료" : "진행중",
    담당강사: row.instructorName,
    비고: row.note || "",
  }));

  const dataSheet = xlsx.utils.json_to_sheet(historyRows.length ? historyRows : [
    {
      직원명: employee?.name ?? "-",
      사번: employee?.empNo ?? "-",
      회사: employee?.companyName ?? "-",
      지점: employee?.branchName ?? "-",
      교육명: "",
      교육유형: "",
      배정일: "",
      완료일시: "",
      서명여부: "",
      수료상태: "",
      담당강사: "",
      비고: "",
    },
  ]);

  workbook.Sheets[DEFAULT_HISTORY_CARD_MAPPING.dataSheetName] = dataSheet;
  if (!workbook.SheetNames.includes(DEFAULT_HISTORY_CARD_MAPPING.dataSheetName)) {
    workbook.SheetNames.push(DEFAULT_HISTORY_CARD_MAPPING.dataSheetName);
  }

  dataSheet["!cols"] = [
    { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 },
    { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 20 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 20 },
  ];
}

function buildFileName(employee, extension) {
  const empNo = employee?.empNo || "employee";
  return `history-card-${empNo}.${extension}`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
