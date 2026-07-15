const PDF_BRAND = "Trinity Air Service";
const PDF_TITLE = "개인 교육이력카드";
const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
const HTML2CANVAS_URL = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";

let pdfLibrariesPromise = null;

export async function createEmployeeHistoryCardPdf({ employee, rows = [], download = true }) {
  if (!employee) throw new Error("다운로드할 직원을 선택해주세요.");

  const records = rows.filter(Boolean).map(toPdfRecord);
  const pages = paginateRecords(records);
  const { jsPDF, html2canvas } = await loadPdfLibraries();
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const staging = document.createElement("div");

  staging.setAttribute("aria-hidden", "true");
  Object.assign(staging.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "1120px",
    transform: "translateX(-20000px)",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  const reportStyle = document.createElement("style");
  reportStyle.textContent = pdfStyles();
  staging.appendChild(reportStyle);
  document.body.appendChild(staging);

  try {
    if (document.fonts?.ready) await document.fonts.ready;

    for (let index = 0; index < pages.length; index += 1) {
      const page = buildPdfPage({
        employee,
        records: pages[index],
        totalRecords: records.length,
        pageNumber: index + 1,
        pageCount: pages.length,
      });
      staging.appendChild(page);
      await waitForPaint();

      const canvas = await html2canvas(page, {
        backgroundColor: "#ffffff",
        scale: 1.45,
        logging: false,
        useCORS: true,
        width: 1120,
        height: 790,
        windowWidth: 1120,
        windowHeight: 790,
      });
      const opaqueCanvas = document.createElement("canvas");
      opaqueCanvas.width = canvas.width;
      opaqueCanvas.height = canvas.height;
      const opaqueContext = opaqueCanvas.getContext("2d");
      opaqueContext.fillStyle = "#ffffff";
      opaqueContext.fillRect(0, 0, opaqueCanvas.width, opaqueCanvas.height);
      opaqueContext.drawImage(canvas, 0, 0);

      if (index > 0) pdf.addPage("a4", "landscape");
      pdf.addImage(opaqueCanvas.toDataURL("image/png"), "PNG", 0, 0, 297, 210, `history-card-${index}`, "FAST");
      page.remove();
    }

    const fileName = buildPdfFileName(employee);
    if (download) pdf.save(fileName);
    return {
      mode: "report-pdf",
      fileName,
      rowCount: records.length,
      pageCount: pages.length,
      blob: download ? undefined : pdf.output("blob"),
    };
  } finally {
    staging.remove();
  }
}

function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function loadPdfLibraries() {
  if (pdfLibrariesPromise) return pdfLibrariesPromise;

  pdfLibrariesPromise = Promise.all([
    loadScript(JSPDF_URL, () => window.jspdf?.jsPDF),
    loadScript(HTML2CANVAS_URL, () => window.html2canvas),
  ]).then(() => {
    const jsPDF = window.jspdf?.jsPDF;
    const html2canvas = window.html2canvas;
    if (!jsPDF || !html2canvas) throw new Error("PDF 생성 도구를 불러오지 못했습니다.");
    return { jsPDF, html2canvas };
  }).catch((error) => {
    pdfLibrariesPromise = null;
    throw error;
  });

  return pdfLibrariesPromise;
}

function loadScript(src, ready) {
  if (ready()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((script) => script.src === src);
    const script = existing ?? document.createElement("script");
    const onLoad = () => ready() ? resolve() : reject(new Error(`스크립트 초기화 실패: ${src}`));
    const onError = () => reject(new Error(`스크립트 로드 실패: ${src}`));

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

function toPdfRecord(row) {
  const courseName = firstText(row.courseName, row.title, row.trainingName, row.subjectName);
  const subjectName = firstText(row.subjectName, row.subject, row.detailName);
  const hasDistinctSubject = subjectName && normalizeText(subjectName) !== normalizeText(courseName);

  return {
    category: resolveCategory(row),
    courseName: courseName || "-",
    subjectName: hasDistinctSubject ? subjectName : "",
    instructor: firstText(row.instructorName, row.instructor, row.teacherName) || "-",
    hours: formatHours(firstValue(row.hours, row.trainingHours, row.durationHours, row.duration)),
    period: formatPeriod(row.startDate, row.endDate, row.completedAt),
    completedAt: formatDateValue(firstValue(row.completedAt, row.endDate, row.startDate)),
    result: resolveResult(row),
    stage: resolveStage(row),
    note: firstText(row.note, row.remarks, row.comment, row.memo) || "-",
  };
}

function resolveCategory(row) {
  const label = firstText(row.trainingTypeLabel, row.categoryLabel, row.trainingCategory);
  if (label) return label;

  const sectionLabels = {
    job_initial: "직무초기교육",
    job_recurring: "직무보수교육",
    legal: "법정교육",
    online: "온라인교육",
    external: "외부교육",
    other: "기타",
  };
  if (sectionLabels[row.sectionKey]) return sectionLabels[row.sectionKey];

  const type = normalizeText(firstText(row.trainingType, row.type));
  if (type === "job") return "직무교육";
  if (type === "legal") return "법정교육";
  if (type === "online") return "온라인교육";
  if (type === "external") return "외부교육";
  return firstText(row.trainingType, row.type) || "기타";
}

function resolveStage(row) {
  const candidates = [
    row.educationStage,
    row.trainingStage,
    row.courseStage,
    row.subType,
    row.educationType,
    row.initialOrRecurrent,
    row.trainingPhase,
  ].map(normalizeText).filter(Boolean);
  const joined = candidates.join(" ");

  if (/recurrent|recurring|regular|renewal|refresher|retraining|보수|정기|갱신|재교육/.test(joined)) return "보수";
  if (/initial|entry|beginner|초기|입문|신규/.test(joined)) return "초기";
  if (row.isInitial === true) return "초기";
  if (row.isInitial === false) return "보수";
  return "-";
}

function resolveResult(row) {
  const explicit = firstText(row.result, row.trainingResult, row.outcome);
  if (explicit && !/^(initial|recurrent|recurring|초기|보수|정기)$/i.test(explicit)) return explicit;
  const completion = normalizeText(firstText(row.completionStatus, row.status));
  if (/completed|complete|passed|pass|수료|합격/.test(completion)) return "PASS";
  if (/failed|fail|불합격/.test(completion)) return "FAIL";
  return "-";
}

function paginateRecords(records) {
  if (!records.length) return [[]];

  const pages = [];
  let page = [];
  let usedHeight = 0;
  let pageIndex = 0;

  for (const record of records) {
    const limit = pageIndex === 0 ? 385 : 390;
    const estimatedHeight = estimateRowHeight(record);
    if (page.length && usedHeight + estimatedHeight > limit) {
      pages.push(page);
      page = [];
      usedHeight = 0;
      pageIndex += 1;
    }
    page.push(record);
    usedHeight += estimatedHeight;
  }
  if (page.length) pages.push(page);
  return pages;
}

function estimateRowHeight(record) {
  const courseLength = record.courseName.length + record.subjectName.length;
  const noteLength = record.note.length;
  const courseLines = Math.max(1, Math.ceil(courseLength / 25)) + (record.subjectName ? 0.45 : 0);
  const noteLines = Math.max(1, Math.ceil(noteLength / 18));
  return Math.max(31, 17 + Math.max(courseLines, noteLines) * 13);
}

function buildPdfPage({ employee, records, totalRecords, pageNumber, pageCount }) {
  const page = document.createElement("section");
  page.className = "history-card-pdf-page";
  page.innerHTML = `
    <header class="pdf-header">
      <div class="pdf-brand">${PDF_BRAND}</div>
      <div class="pdf-title">${PDF_TITLE}</div>
      <dl class="pdf-meta">
        <div><dt>출력일시</dt><dd>${escapeHtml(formatPrintDate(new Date()))}</dd></div>
        <div><dt>출력대상</dt><dd>${escapeHtml(profileValue(employee.name))} (${escapeHtml(profileValue(employee.empNo))})</dd></div>
        <div><dt>페이지</dt><dd>${pageNumber} / ${pageCount}</dd></div>
      </dl>
    </header>
    ${pageNumber === 1 ? buildProfileSection(employee) : ""}
    <section class="history-section ${pageNumber === 1 ? "" : "continued"}">
      <h2><span></span>${pageNumber === 1 ? "교육이력" : "교육이력 (계속)"}<em>${totalRecords}건</em></h2>
      ${buildHistoryTable(records)}
    </section>
    <footer class="pdf-footer">
      <span>${PDF_BRAND}</span>
      <span>${PDF_TITLE} · ${pageNumber} / ${pageCount}</span>
    </footer>
  `;
  return page;
}

function buildProfileSection(employee) {
  const fields = [
    ["성명", employee.name],
    ["사번", employee.empNo],
    ["생년월일", firstValue(employee.birthDate, employee.birth, employee.birthday)],
    ["입사일", firstValue(employee.hireDate, employee.joinDate, employee.employmentDate, employee.joinedAt)],
    ["입사구분", firstText(employee.entryType, employee.employmentType, employee.careerType)],
    ["직급/직책", firstText(employee.position, employee.jobTitle, employee.title, employee.rank)],
    ["사내 자격", firstText(employee.internalLicense, employee.internalQualification, employee.internalQualifications)],
    ["사외 자격", firstText(employee.externalLicense, employee.externalQualification, employee.externalQualifications)],
  ];

  const cells = fields.map(([label, value], index) => {
    const formatted = index === 2 || index === 3 ? formatDateValue(value) : profileValue(value);
    return `<div class="profile-cell"><span>${label}</span><strong>${escapeHtml(formatted)}</strong></div>`;
  }).join("");

  return `
    <section class="profile-section">
      <h2><span></span>인적사항</h2>
      <div class="profile-grid">${cells}</div>
    </section>
  `;
}

function buildHistoryTable(records) {
  const body = records.length
    ? records.map((record) => `
      <tr>
        <td>${escapeHtml(record.category)}</td>
        <td class="course-cell">
          <strong>${escapeHtml(record.courseName)}</strong>
          ${record.subjectName ? `<small>${escapeHtml(record.subjectName)}</small>` : ""}
        </td>
        <td>${escapeHtml(record.instructor)}</td>
        <td>${escapeHtml(record.hours)}</td>
        <td>${escapeHtml(record.period)}</td>
        <td>${escapeHtml(record.completedAt)}</td>
        <td class="result-cell">${escapeHtml(record.result)}</td>
        <td>${escapeHtml(record.stage)}</td>
        <td class="note-cell">${escapeHtml(record.note)}</td>
      </tr>
    `).join("")
    : `<tr><td class="empty-cell" colspan="9">등록된 교육이력이 없습니다.</td></tr>`;

  return `
    <table class="history-table">
      <colgroup>
        <col style="width:10%"><col style="width:22%"><col style="width:9%">
        <col style="width:8%"><col style="width:13%"><col style="width:10%">
        <col style="width:7%"><col style="width:8%"><col style="width:13%">
      </colgroup>
      <thead><tr>
        <th>교육구분</th><th>교육과정명</th><th>강사</th><th>교육시간</th><th>교육기간</th>
        <th>수료일자</th><th>결과</th><th>초기/보수</th><th>비고</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function pdfStyles() {
  return `
    .history-card-pdf-page,.history-card-pdf-page *{box-sizing:border-box}
    .history-card-pdf-page{position:relative;width:1120px;height:790px;padding:28px 34px 34px;background:#fff;color:#172033;font-family:"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;overflow:hidden}
    .pdf-header{position:relative;height:76px;border-bottom:3px solid #1554a0;display:grid;grid-template-columns:1fr 1.2fr 1fr;align-items:center}
    .pdf-brand{font-size:22px;font-weight:800;letter-spacing:-.3px;color:#123f78;white-space:nowrap}
    .pdf-title{text-align:center;font-size:30px;font-weight:800;letter-spacing:-1px;color:#101827}
    .pdf-meta{margin:0;justify-self:end;font-size:11px;line-height:1.55;min-width:210px}
    .pdf-meta div{display:grid;grid-template-columns:58px 1fr;gap:7px}.pdf-meta dt{font-weight:700;color:#5c687a}.pdf-meta dd{margin:0;color:#202a3b;white-space:nowrap}
    .history-card-pdf-page section h2{height:30px;margin:13px 0 7px;display:flex;align-items:center;gap:8px;font-size:15px;color:#174f91}
    .history-card-pdf-page section h2>span{width:9px;height:16px;background:#1757a4}.history-card-pdf-page section h2 em{margin-left:auto;font-size:11px;font-style:normal;font-weight:600;color:#7b8798}
    .profile-grid{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid #c7d0db;border-left:1px solid #c7d0db;background:#fff}
    .profile-cell{min-height:43px;display:grid;grid-template-columns:83px 1fr;border-right:1px solid #c7d0db;border-bottom:1px solid #c7d0db;align-items:stretch}
    .profile-cell span{display:flex;align-items:center;justify-content:center;padding:6px;background:#eef3f9;color:#3b4a5d;font-size:11px;font-weight:700;text-align:center}
    .profile-cell strong{display:flex;align-items:center;padding:6px 10px;font-size:11px;line-height:1.35;font-weight:500;overflow-wrap:anywhere}
    .history-section.continued h2{margin-top:13px}
    .history-table{width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid #9aabbf}
    .history-table th{height:32px;padding:6px 4px;border:1px solid #3e6fa8;background:#1554a0;color:#fff;font-size:10px;font-weight:700;text-align:center;vertical-align:middle;white-space:nowrap}
    .history-table td{min-height:30px;padding:6px 5px;border:1px solid #cbd3dd;color:#202a38;font-size:9.5px;line-height:1.35;text-align:center;vertical-align:middle;overflow-wrap:anywhere;word-break:keep-all}
    .history-table tbody tr:nth-child(even) td{background:#f8fafc}
    .history-table .course-cell,.history-table .note-cell{text-align:left;word-break:break-word}
    .course-cell strong{display:block;font-weight:650}.course-cell small{display:block;margin-top:3px;padding-left:9px;color:#47709f;font-size:8.7px;line-height:1.3}
    .course-cell small::before{content:"- ";margin-left:-9px}.result-cell{font-weight:750;color:#18843c!important}
    .empty-cell{height:76px!important;color:#7a8797!important;text-align:center!important;background:#fff!important}
    .pdf-footer{position:absolute;left:34px;right:34px;bottom:15px;display:flex;justify-content:space-between;padding-top:7px;border-top:1px solid #d7dde5;color:#8490a0;font-size:8.5px}
  `;
}

function formatPeriod(startValue, endValue, completedValue) {
  const start = formatDateValue(startValue);
  const end = formatDateValue(endValue);
  const completed = formatDateValue(completedValue);
  if (start !== "-" && end !== "-") return start === end ? start : `${start} ~ ${end}`;
  if (start !== "-") return start;
  if (end !== "-") return end;
  return completed;
}

function formatDateValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (value && typeof value === "object" && typeof value.toMillis === "function") value = value.toMillis();
  if (value && typeof value === "object" && Number.isFinite(value.seconds)) value = value.seconds * 1000;

  const raw = String(value).trim();
  const simple = raw.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if (simple) return `${simple[1]}-${String(simple[2]).padStart(2, "0")}-${String(simple[3]).padStart(2, "0")}`;

  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 1e10 ? new Date(numeric) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw || "-";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPrintDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatHours(value) {
  if (value === null || value === undefined || value === "") return "-";
  const text = String(value).trim();
  if (!text) return "-";
  if (/시간|hrs?|hours?/i.test(text)) return text;
  const number = Number(text);
  return Number.isFinite(number) ? `${number}시간` : text;
}

function profileValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "-";
  const text = String(value ?? "").trim();
  return text || "-";
}

function firstValue(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

function firstText(...values) {
  const value = values.find((candidate) => String(candidate ?? "").trim());
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value ?? "-")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildPdfFileName(employee) {
  const safe = (value, fallback) => String(value ?? "").trim().replace(/[\\/:*?"<>|]/g, "_") || fallback;
  return `개인교육이력카드_${safe(employee.name, "직원")}_${safe(employee.empNo, "사번없음")}.pdf`;
}
