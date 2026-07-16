const PDF_BRAND = "Trinity Air Service";
const PDF_TITLE = "개인 교육이력카드";
const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
const FONTKIT_URL = "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js";
const PDF_FONT_REGULAR_URL = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf";
const PDF_FONT_BOLD_URL = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Bold.ttf";
const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;

const CATEGORY_ORDER = Object.freeze({
  job: 1,
  legal: 2,
  external: 3,
  online: 4,
  other: 5,
});

const OPTIONAL_DETAIL_FIELDS = Object.freeze([
  ["trainingContent", "교육내용"],
  ["location", "교육장소"],
  ["institution", "교육기관"],
  ["method", "교육방식"],
  ["attachmentName", "첨부자료"],
]);

let pdfLibrariesPromise = null;
let pdfFontBytesPromise = null;

export async function createEmployeeHistoryCardPdf({ employee, rows = [], download = true }) {
  if (!employee) throw new Error("다운로드할 직원을 선택해 주세요.");

  const records = rows.filter(Boolean).map((row, index) => toPdfRecord(row, index));
  const report = buildReportModel(records);
  const [{ PDFDocument, rgb, fontkit }, fontBytes] = await Promise.all([
    loadPdfLibraries(),
    loadPdfFontBytes(),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setAuthor(PDF_BRAND);
  pdf.setCreator(PDF_BRAND);
  pdf.setProducer(PDF_BRAND);
  // pdf-lib/fontkit의 CJK 서브셋은 일부 PDF 뷰어에서 글리프 누락을 일으킬 수 있어
  // 정적 TTF 전체를 임베딩한다. 표와 텍스트는 여전히 벡터 객체로 유지된다.
  const regularFont = await pdf.embedFont(fontBytes.regular, { subset: false });
  const boldFont = await pdf.embedFont(fontBytes.bold, { subset: false });
  const pageCount = renderVectorReport({ pdf, regularFont, boldFont, rgb, employee, report });

  const fileName = buildPdfFileName(employee);
  const pdfBytes = await pdf.save({ useObjectStreams: false });
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  if (download) downloadBlob(blob, fileName);
  return {
    mode: "session-group-vector-pdf",
    fileName,
    rowCount: records.length,
    sessionCount: report.sessionCount,
    pageCount,
    blob: download ? undefined : blob,
  };
}

function buildReportModel(records) {
  const categoryMap = new Map();
  records.forEach((record) => {
    if (!categoryMap.has(record.category.key)) {
      categoryMap.set(record.category.key, {
        ...record.category,
        records: [],
        sessionMap: new Map(),
      });
    }
    const category = categoryMap.get(record.category.key);
    category.records.push(record);
    const sessionKey = resolveSessionKey(record);
    if (!category.sessionMap.has(sessionKey)) category.sessionMap.set(sessionKey, []);
    category.sessionMap.get(sessionKey).push(record);
  });

  const categories = [...categoryMap.values()]
    .map((category) => {
      const sessions = [...category.sessionMap.entries()]
        .map(([key, sessionRecords]) => buildSessionGroup(key, category, sessionRecords))
        .sort(compareSessionGroups);
      const latest = [...category.records].sort(compareRecordsByRecent)[0] ?? null;
      return {
        key: category.key,
        label: category.label,
        order: category.order,
        count: category.records.length,
        latestCompletedAt: latest?.completedAt || "-",
        latestResult: latest?.result || "-",
        latestStage: latest?.stage || "-",
        sessions,
      };
    })
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, "ko"));

  return {
    records,
    categories,
    sessionCount: categories.reduce((sum, category) => sum + category.sessions.length, 0),
  };
}

function toPdfRecord(row, originalIndex) {
  const category = resolveCategory(row);
  const courseName = firstText(row.courseName, row.title, row.trainingName, row.subjectName) || "-";
  const subjectName = firstText(row.subjectName, row.subject, row.detailName);
  const itemName = subjectName && normalizeText(subjectName) !== normalizeText(courseName) ? subjectName : courseName;
  const note = firstText(row.note, row.remarks, row.comment, row.memo) || "-";
  const completedRaw = firstValue(row.completedAt, row.endDate, row.startDate);
  return {
    originalIndex,
    category,
    sessionId: firstText(row.sessionId, row.trainingSessionId, row.sourceSessionId, row.session?.id),
    courseName,
    itemName,
    instructor: firstText(row.instructorName, row.instructor, row.teacherName) || "-",
    hours: formatHours(firstValue(row.hours, row.trainingHours, row.durationHours, row.duration)),
    period: formatPeriod(row.startDate, row.endDate, row.completedAt),
    completedAt: formatDateValue(completedRaw),
    completedSort: dateSortValue(completedRaw),
    periodSort: dateSortValue(firstValue(row.endDate, row.startDate, row.completedAt)),
    result: resolveResult(row),
    stage: resolveStage(row),
    note,
    trainingContent: displayText(firstValue(row.trainingContent, row.educationContent, row.detailContent, row.contents, row.content, row.curriculum)),
    location: firstText(row.trainingLocation, row.educationLocation, row.location, row.venue, row.place, row.trainingPlace),
    institution: firstText(row.trainingInstitution, row.educationInstitution, row.institution, row.organization, row.provider),
    method: firstText(row.trainingMethod, row.educationMethod, row.method, row.deliveryMethod),
    attachmentName: attachmentNames(row),
  };
}

function resolveCategory(row) {
  const sectionKey = normalizeText(row.sectionKey);
  const type = normalizeText(firstText(row.trainingType, row.type));
  const label = normalizeText(firstText(row.trainingTypeLabel, row.categoryLabel, row.trainingCategory));
  const combined = `${sectionKey} ${type} ${label}`;

  if (/job_initial|job_recurring|job_recurrent|직무|\bjob\b/.test(combined)) return category("job", "직무교육");
  if (/legal|법정/.test(combined)) return category("legal", "법정교육");
  if (/external|외부/.test(combined)) return category("external", "외부교육");
  if (/online|온라인|e[- ]?learning/.test(combined)) return category("online", "온라인교육");
  return category("other", "기타");
}

function category(key, label) {
  return { key, label, order: CATEGORY_ORDER[key] ?? 99 };
}

function resolveSessionKey(record) {
  if (record.sessionId) return `session:${normalizeKey(record.sessionId)}`;
  return [
    "fallback",
    record.category.key,
    record.period,
    record.completedAt,
    normalizeKey(record.instructor),
    normalizeKey(record.hours),
    normalizeKey(record.result),
    normalizeKey(record.stage),
  ].join("|");
}

function buildSessionGroup(key, categoryInfo, records) {
  const sortedRecords = [...records].sort((left, right) => left.originalIndex - right.originalIndex);
  const representative = [...records].sort(compareRecordsByRecent)[0] ?? records[0];
  const commonNote = commonValue(records, "note", "-");
  const commonDetails = {};
  OPTIONAL_DETAIL_FIELDS.forEach(([field]) => {
    commonDetails[field] = commonValue(records, field, "");
  });

  const itemMap = new Map();
  sortedRecords.forEach((record) => {
    const item = {
      name: record.itemName || record.courseName || "-",
      note: commonNote ? "" : record.note,
      details: {},
    };
    OPTIONAL_DETAIL_FIELDS.forEach(([field]) => {
      if (!commonDetails[field] && record[field]) item.details[field] = record[field];
    });
    const signature = [item.name, item.note, ...OPTIONAL_DETAIL_FIELDS.map(([field]) => item.details[field] || "")]
      .map(normalizeKey)
      .join("|");
    if (!itemMap.has(signature)) itemMap.set(signature, item);
  });

  return {
    key,
    categoryKey: categoryInfo.key,
    categoryLabel: categoryInfo.label,
    title: representative.courseName || representative.itemName || "교육 세션",
    period: representative.period,
    completedAt: representative.completedAt,
    completedSort: representative.completedSort,
    periodSort: representative.periodSort,
    instructor: representative.instructor,
    hours: representative.hours,
    result: representative.result,
    stage: representative.stage,
    note: commonNote || "-",
    commonDetails,
    items: [...itemMap.values()],
    sourceRecordCount: records.length,
    usedExplicitSessionId: key.startsWith("session:"),
  };
}

function compareRecordsByRecent(left, right) {
  return right.completedSort - left.completedSort || right.periodSort - left.periodSort || left.originalIndex - right.originalIndex;
}

function compareSessionGroups(left, right) {
  return right.completedSort - left.completedSort
    || right.periodSort - left.periodSort
    || left.title.localeCompare(right.title, "ko", { numeric: true, sensitivity: "base" });
}

const VECTOR_LAYOUT = Object.freeze({
  marginX: 26,
  contentTop: 76,
  contentBottom: 812,
  sectionHeadingHeight: 22,
  sectionHeadingGap: 5,
  groupGap: 8,
});

function renderVectorReport({ pdf, regularFont, boldFont, rgb, employee, report }) {
  const theme = createVectorTheme(rgb);
  const context = { regularFont, boldFont, theme };
  const pages = [];
  const coverPage = pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  pages.push(coverPage);
  drawCoverPage(coverPage, context, employee, report);

  const state = createDetailPageState(pdf, pages);
  if (!report.categories.length) {
    drawSectionHeading(state.page, context, "교육 이력 상세", state.cursor);
    state.cursor += VECTOR_LAYOUT.sectionHeadingHeight + VECTOR_LAYOUT.sectionHeadingGap;
    drawTextInBox(state.page, "표시할 상세 교육이력이 없습니다.", {
      x: VECTOR_LAYOUT.marginX,
      top: state.cursor,
      width: contentWidth(),
      height: 64,
      font: regularFont,
      size: 9,
      color: theme.muted,
      align: "center",
    });
  } else {
    drawDetailPages(pdf, pages, state, context, report.categories);
  }

  const printedAt = formatPrintDate(new Date());
  pages.forEach((page, index) => {
    drawPageChrome(page, context, employee, printedAt, index + 1, pages.length, index === 0);
  });
  return pages.length;
}

function createVectorTheme(rgb) {
  const fromHex = (hex) => {
    const value = Number.parseInt(hex.replace("#", ""), 16);
    return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
  };
  return {
    navy: fromHex("#123f78"),
    blue: fromHex("#1554a0"),
    dark: fromHex("#172033"),
    text: fromHex("#273449"),
    muted: fromHex("#718096"),
    border: fromHex("#bac7d6"),
    lightBorder: fromHex("#d6dee8"),
    labelFill: fromHex("#eef3f9"),
    headingFill: fromHex("#e7f0fa"),
    alternateFill: fromHex("#f8fafc"),
    green: fromHex("#16813a"),
    white: rgb(1, 1, 1),
  };
}

function contentWidth() {
  return PDF_PAGE_WIDTH - VECTOR_LAYOUT.marginX * 2;
}

function drawCoverPage(page, context, employee, report) {
  let top = VECTOR_LAYOUT.contentTop + 5;
  drawSectionHeading(page, context, "1. 인적사항", top);
  top += VECTOR_LAYOUT.sectionHeadingHeight + 7;

  const profileFields = [
    ["성명", employee.name],
    ["사번", employee.empNo],
    ["생년월일", firstValue(employee.birthDate, employee.birth, employee.birthday), true],
    ["입사일", firstValue(employee.hireDate, employee.joinDate, employee.employmentDate, employee.joinedAt), true],
    ["입사구분", firstText(employee.entryType, employee.employmentType, employee.careerType)],
    ["직급/직책", firstText(employee.position, employee.jobTitle, employee.title, employee.rank)],
    ["사내 자격", firstText(employee.internalLicense, employee.internalQualification, employee.internalQualifications)],
    ["사외 자격", firstText(employee.externalLicense, employee.externalQualification, employee.externalQualifications)],
  ];
  const halfWidth = contentWidth() / 2;
  for (let index = 0; index < profileFields.length; index += 2) {
    const left = profileFields[index];
    const right = profileFields[index + 1];
    const leftValue = left[2] ? formatDateValue(left[1]) : profileValue(left[1]);
    const rightValue = right[2] ? formatDateValue(right[1]) : profileValue(right[1]);
    const rowHeight = Math.max(
      32,
      measureTextBlock(context.regularFont, leftValue, 8.8, halfWidth - 82) + 9,
      measureTextBlock(context.regularFont, rightValue, 8.8, halfWidth - 82) + 9,
    );
    drawLabeledValueCell(page, context, left[0], leftValue, VECTOR_LAYOUT.marginX, top, halfWidth, rowHeight, 70);
    drawLabeledValueCell(page, context, right[0], rightValue, VECTOR_LAYOUT.marginX + halfWidth, top, halfWidth, rowHeight, 70);
    top += rowHeight;
  }

  top += 15;
  drawSectionHeading(page, context, "2. 교육 이력 요약", top, `총 ${report.records.length}건 · ${report.sessionCount}개 세션`);
  top += VECTOR_LAYOUT.sectionHeadingHeight + 7;
  drawSummaryTable(page, context, report, top);
}

function drawSummaryTable(page, context, report, top) {
  const columns = [
    ["교육구분", 0.2],
    ["이수 건수", 0.16],
    ["최근 수료일", 0.22],
    ["최근 결과", 0.19],
    ["최근 초기/보수", 0.23],
  ];
  const tableWidth = contentWidth();
  const headerHeight = 25;
  let x = VECTOR_LAYOUT.marginX;
  columns.forEach(([label, ratio]) => {
    const width = tableWidth * ratio;
    drawTableCell(page, label, {
      x,
      top,
      width,
      height: headerHeight,
      font: context.boldFont,
      size: 8.7,
      color: context.theme.white,
      fill: context.theme.blue,
      border: context.theme.blue,
      align: "center",
    });
    x += width;
  });

  const rows = report.categories.length
    ? report.categories.map((categoryInfo) => [
        categoryInfo.label,
        `${categoryInfo.count}건`,
        categoryInfo.latestCompletedAt,
        categoryInfo.latestResult,
        categoryInfo.latestStage,
      ])
    : [["-", "0건", "-", "-", "-"]];
  rows.forEach((row, rowIndex) => {
    const rowTop = top + headerHeight + rowIndex * 25;
    x = VECTOR_LAYOUT.marginX;
    row.forEach((value, columnIndex) => {
      const width = tableWidth * columns[columnIndex][1];
      drawTableCell(page, value, {
        x,
        top: rowTop,
        width,
        height: 25,
        font: context.regularFont,
        size: 8.8,
        color: context.theme.text,
        fill: rowIndex % 2 ? context.theme.alternateFill : context.theme.white,
        border: context.theme.border,
        align: "center",
      });
      x += width;
    });
  });
}

function createDetailPageState(pdf, pages) {
  const page = pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  pages.push(page);
  return {
    page,
    cursor: VECTOR_LAYOUT.contentTop,
    categoryKey: null,
  };
}

function resetDetailPageState(pdf, pages, state) {
  const page = pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  pages.push(page);
  state.page = page;
  state.cursor = VECTOR_LAYOUT.contentTop;
  state.categoryKey = null;
}

function drawDetailPages(pdf, pages, state, context, categories) {
  categories.forEach((categoryInfo) => {
    categoryInfo.sessions.forEach((group) => {
      const headingSpace = state.categoryKey === categoryInfo.key
        ? 0
        : VECTOR_LAYOUT.sectionHeadingHeight + VECTOR_LAYOUT.sectionHeadingGap;
      const fullHeight = measureSessionGroup(context, group, group.items, false, 0).height;
      const remaining = VECTOR_LAYOUT.contentBottom - state.cursor;
      const freshCapacity = VECTOR_LAYOUT.contentBottom
        - VECTOR_LAYOUT.contentTop
        - VECTOR_LAYOUT.sectionHeadingHeight
        - VECTOR_LAYOUT.sectionHeadingGap;

      if (headingSpace + fullHeight > remaining && fullHeight <= freshCapacity) {
        resetDetailPageState(pdf, pages, state);
      }

      ensureCategoryHeading(state, context, categoryInfo);
      if (fullHeight <= VECTOR_LAYOUT.contentBottom - state.cursor) {
        drawSessionGroup(state.page, context, group, group.items, state.cursor, false, 0);
        state.cursor += fullHeight + VECTOR_LAYOUT.groupGap;
        return;
      }

      let itemOffset = 0;
      const items = group.items.length ? group.items : [null];
      while (itemOffset < items.length) {
        const availableHeight = VECTOR_LAYOUT.contentBottom - state.cursor;
        let takeCount = countItemsThatFit(context, group, items, itemOffset, availableHeight);
        if (takeCount === 0) {
          resetDetailPageState(pdf, pages, state);
          ensureCategoryHeading(state, context, categoryInfo);
          takeCount = countItemsThatFit(
            context,
            group,
            items,
            itemOffset,
            VECTOR_LAYOUT.contentBottom - state.cursor,
          );
        }
        if (takeCount === 0) takeCount = Math.min(2, items.length - itemOffset);
        const fragmentItems = items.slice(itemOffset, itemOffset + takeCount).filter(Boolean);
        const continued = itemOffset > 0;
        const fragmentLayout = measureSessionGroup(context, group, fragmentItems, continued, itemOffset);
        drawSessionGroup(state.page, context, group, fragmentItems, state.cursor, continued, itemOffset);
        state.cursor += fragmentLayout.height + VECTOR_LAYOUT.groupGap;
        itemOffset += takeCount;
        if (itemOffset < items.length) {
          resetDetailPageState(pdf, pages, state);
          ensureCategoryHeading(state, context, categoryInfo);
        }
      }
    });
  });
}

function ensureCategoryHeading(state, context, categoryInfo) {
  if (state.categoryKey === categoryInfo.key) return;
  drawSectionHeading(state.page, context, `${categoryInfo.label} 상세`, state.cursor);
  state.cursor += VECTOR_LAYOUT.sectionHeadingHeight + VECTOR_LAYOUT.sectionHeadingGap;
  state.categoryKey = categoryInfo.key;
}

function countItemsThatFit(context, group, items, offset, maxHeight) {
  const fixedHeight = measureSessionGroup(context, group, [], offset > 0, offset, false).height;
  let height = fixedHeight;
  let count = 0;
  for (let index = offset; index < items.length; index += 2) {
    const pair = items.slice(index, index + 2).filter(Boolean);
    const rowHeight = measureItemRow(context, pair, contentWidth()).height;
    if (count > 0 && height + rowHeight > maxHeight) break;
    if (count === 0 && height + rowHeight > maxHeight) return 0;
    height += rowHeight;
    count += pair.length || 1;
  }
  return count;
}

function measureSessionGroup(context, group, items, continued, itemOffset, includeEmpty = true) {
  const title = `${group.categoryLabel} · ${group.title}${continued ? " (계속)" : ""}`;
  const titleHeight = Math.max(24, measureTextBlock(context.boldFont, title, 11, contentWidth() - 14) + 7);
  const metaRows = buildSessionMetaRows(group).map((row) => ({
    cells: row,
    height: measureMetaRow(context, row, contentWidth()),
  }));
  const itemRows = [];
  for (let index = 0; index < items.length; index += 2) {
    const pair = items.slice(index, index + 2);
    itemRows.push({ items: pair, height: measureItemRow(context, pair, contentWidth()).height });
  }
  if (!itemRows.length && includeEmpty) itemRows.push({ items: [], height: 24 });
  const footerHeight = 13;
  return {
    title,
    titleHeight,
    metaRows,
    itemRows,
    itemOffset,
    footerHeight,
    height: titleHeight
      + metaRows.reduce((sum, row) => sum + row.height, 0)
      + itemRows.reduce((sum, row) => sum + row.height, 0)
      + footerHeight,
  };
}

function buildSessionMetaRows(group) {
  const rows = [
    [
      { label: "교육기간", value: group.period },
      { label: "수료일자", value: group.completedAt },
      { label: "강사", value: group.instructor },
      { label: "교육시간", value: group.hours },
    ],
    [
      { label: "결과", value: group.result, accent: true },
      { label: "구분", value: group.stage },
      { label: "비고", value: group.note, span: 2 },
    ],
  ];
  const optional = OPTIONAL_DETAIL_FIELDS
    .filter(([field]) => group.commonDetails[field])
    .map(([field, label]) => ({ label, value: group.commonDetails[field], span: 2 }));
  for (let index = 0; index < optional.length; index += 2) rows.push(optional.slice(index, index + 2));
  return rows;
}

function measureMetaRow(context, cells, width) {
  const logicalWidth = width / 4;
  return Math.max(23, ...cells.map((cell) => {
    const cellWidth = logicalWidth * (cell.span || 1);
    const labelWidth = cell.span === 2 ? 43 : 35;
    return measureTextBlock(context.regularFont, cell.value, 8.5, cellWidth - labelWidth - 7) + 7;
  }));
}

function measureItemRow(context, items, width) {
  const halfWidth = width / 2;
  return {
    height: Math.max(22, ...items.map((item) => measureItemCell(context, item, halfWidth))),
  };
}

function measureItemCell(context, item, width) {
  if (!item) return 22;
  const contentWidthValue = width - 27;
  const nameLines = wrapPdfText(context.boldFont, item.name || "-", 8.8, contentWidthValue - 7);
  let height = nameLines.length * 10.2;
  const detailLines = itemDetailLines(item);
  detailLines.forEach((line) => {
    height += wrapPdfText(context.regularFont, line, 7.2, contentWidthValue - 7).length * 8.5;
  });
  return Math.max(22, height + 7);
}

function itemDetailLines(item) {
  const lines = OPTIONAL_DETAIL_FIELDS
    .filter(([field]) => item.details?.[field])
    .map(([field, label]) => `${label} ${item.details[field]}`);
  if (item.note && item.note !== "-") lines.push(`비고 ${item.note}`);
  return lines;
}

function drawSessionGroup(page, context, group, items, top, continued, itemOffset) {
  const layout = measureSessionGroup(context, group, items, continued, itemOffset);
  let cursor = top;
  drawRectTop(page, {
    x: VECTOR_LAYOUT.marginX,
    top: cursor,
    width: contentWidth(),
    height: layout.titleHeight,
    fill: context.theme.headingFill,
    border: context.theme.border,
  });
  drawTextInBox(page, layout.title, {
    x: VECTOR_LAYOUT.marginX + 7,
    top: cursor,
    width: contentWidth() - 14,
    height: layout.titleHeight,
    font: context.boldFont,
    size: 11,
    color: context.theme.navy,
  });
  cursor += layout.titleHeight;

  layout.metaRows.forEach((row) => {
    drawMetaRow(page, context, row.cells, cursor, row.height);
    cursor += row.height;
  });

  if (!layout.itemRows.length) {
    drawTableCell(page, "교육과정명이 없습니다.", {
      x: VECTOR_LAYOUT.marginX,
      top: cursor,
      width: contentWidth(),
      height: 24,
      font: context.regularFont,
      size: 8.5,
      color: context.theme.muted,
      fill: context.theme.white,
      border: context.theme.lightBorder,
      align: "center",
    });
    cursor += 24;
  } else {
    layout.itemRows.forEach((row, rowIndex) => {
      drawItemRow(page, context, row.items, cursor, row.height, itemOffset + rowIndex * 2);
      cursor += row.height;
    });
  }

  drawRectTop(page, {
    x: VECTOR_LAYOUT.marginX,
    top: cursor,
    width: contentWidth(),
    height: layout.footerHeight,
    fill: context.theme.white,
    border: context.theme.border,
  });
  const itemEnd = itemOffset + items.length;
  const footerText = group.items.length
    ? `원본 교육이력 ${group.sourceRecordCount}건 · 교육과정 ${Math.min(itemOffset + 1, itemEnd)}-${itemEnd} / ${group.items.length}`
    : `원본 교육이력 ${group.sourceRecordCount}건`;
  drawTextInBox(page, footerText, {
    x: VECTOR_LAYOUT.marginX + 5,
    top: cursor,
    width: contentWidth() - 10,
    height: layout.footerHeight,
    font: context.regularFont,
    size: 6.8,
    color: context.theme.muted,
    align: "right",
  });
  drawRectTop(page, {
    x: VECTOR_LAYOUT.marginX,
    top,
    width: contentWidth(),
    height: layout.height,
    border: context.theme.border,
    borderWidth: 0.8,
  });
  return layout.height;
}

function drawMetaRow(page, context, cells, top, height) {
  const logicalWidth = contentWidth() / 4;
  let logicalIndex = 0;
  cells.forEach((cell) => {
    const span = cell.span || 1;
    const width = logicalWidth * span;
    drawLabeledValueCell(
      page,
      context,
      cell.label,
      cell.value,
      VECTOR_LAYOUT.marginX + logicalIndex * logicalWidth,
      top,
      width,
      height,
      span === 2 ? 43 : 35,
      cell.accent,
    );
    logicalIndex += span;
  });
}

function drawItemRow(page, context, items, top, height, itemOffset) {
  const halfWidth = contentWidth() / 2;
  [0, 1].forEach((column) => {
    const x = VECTOR_LAYOUT.marginX + halfWidth * column;
    const item = items[column];
    drawRectTop(page, {
      x,
      top,
      width: halfWidth,
      height,
      fill: Math.floor(itemOffset / 2) % 2 ? context.theme.alternateFill : context.theme.white,
      border: context.theme.lightBorder,
      borderWidth: 0.55,
    });
    if (!item) return;
    const numberWidth = 20;
    drawTextInBox(page, String(itemOffset + column + 1), {
      x,
      top,
      width: numberWidth,
      height,
      font: context.regularFont,
      size: 7.2,
      color: context.theme.muted,
      align: "center",
    });
    drawLineTop(page, x + numberWidth, top, x + numberWidth, top + height, context.theme.lightBorder, 0.55);
    drawItemContent(page, context, item, x + numberWidth + 4, top, halfWidth - numberWidth - 8, height);
  });
}

function drawItemContent(page, context, item, x, top, width, height) {
  const lines = [];
  wrapPdfText(context.boldFont, item.name || "-", 8.8, width).forEach((text) => {
    lines.push({ text, font: context.boldFont, size: 8.8, lineHeight: 10.2, color: context.theme.dark });
  });
  itemDetailLines(item).forEach((detail) => {
    wrapPdfText(context.regularFont, detail, 7.2, width).forEach((text) => {
      lines.push({ text, font: context.regularFont, size: 7.2, lineHeight: 8.5, color: context.theme.muted });
    });
  });
  drawMixedLinesInBox(page, lines, { x, top, width, height, align: "left" });
}

function drawLabeledValueCell(page, context, label, value, x, top, width, height, labelWidth, accent = false) {
  drawTableCell(page, label, {
    x,
    top,
    width: labelWidth,
    height,
    font: context.boldFont,
    size: 7.5,
    color: context.theme.text,
    fill: context.theme.labelFill,
    border: context.theme.lightBorder,
    align: "center",
  });
  drawTableCell(page, value || "-", {
    x: x + labelWidth,
    top,
    width: width - labelWidth,
    height,
    font: accent ? context.boldFont : context.regularFont,
    size: accent ? 8.8 : 8.5,
    color: accent ? context.theme.green : context.theme.text,
    fill: context.theme.white,
    border: context.theme.lightBorder,
    align: "left",
  });
}

function drawSectionHeading(page, context, label, top, summary = "") {
  drawRectTop(page, {
    x: VECTOR_LAYOUT.marginX,
    top,
    width: 5,
    height: VECTOR_LAYOUT.sectionHeadingHeight,
    fill: context.theme.blue,
  });
  drawTextInBox(page, label, {
    x: VECTOR_LAYOUT.marginX + 10,
    top,
    width: contentWidth() - 10,
    height: VECTOR_LAYOUT.sectionHeadingHeight,
    font: context.boldFont,
    size: 11.5,
    color: context.theme.navy,
  });
  if (summary) {
    drawTextInBox(page, summary, {
      x: VECTOR_LAYOUT.marginX + contentWidth() * 0.55,
      top,
      width: contentWidth() * 0.45,
      height: VECTOR_LAYOUT.sectionHeadingHeight,
      font: context.regularFont,
      size: 7.5,
      color: context.theme.muted,
      align: "right",
    });
  }
}

function drawPageChrome(page, context, employee, printedAt, pageNumber, pageCount, cover) {
  drawTextInBox(page, PDF_BRAND, {
    x: VECTOR_LAYOUT.marginX,
    top: 21,
    width: 165,
    height: 25,
    font: context.boldFont,
    size: cover ? 13.5 : 12,
    color: context.theme.navy,
  });
  drawTextInBox(page, PDF_TITLE, {
    x: 170,
    top: 18,
    width: 250,
    height: 31,
    font: context.boldFont,
    size: cover ? 19 : 15.5,
    color: context.theme.dark,
    align: "center",
  });
  drawTextInBox(page, `출력일시  ${printedAt}\n대상자    ${profileValue(employee.name)} (${profileValue(employee.empNo)})\n페이지    ${pageNumber} / ${pageCount}`, {
    x: 440,
    top: 14,
    width: PDF_PAGE_WIDTH - 440 - VECTOR_LAYOUT.marginX,
    height: 39,
    font: context.regularFont,
    size: 6.1,
    lineHeight: 8.2,
    color: context.theme.text,
  });
  drawLineTop(page, VECTOR_LAYOUT.marginX, 58, PDF_PAGE_WIDTH - VECTOR_LAYOUT.marginX, 58, context.theme.blue, 1.8);
  drawLineTop(page, VECTOR_LAYOUT.marginX, 818, PDF_PAGE_WIDTH - VECTOR_LAYOUT.marginX, 818, context.theme.lightBorder, 0.6);
  drawTextInBox(page, PDF_BRAND, {
    x: VECTOR_LAYOUT.marginX,
    top: 819,
    width: 160,
    height: 13,
    font: context.regularFont,
    size: 5.8,
    color: context.theme.muted,
  });
  drawTextInBox(page, `${PDF_TITLE} · ${pageNumber} / ${pageCount}`, {
    x: PDF_PAGE_WIDTH - 210 - VECTOR_LAYOUT.marginX,
    top: 819,
    width: 210,
    height: 13,
    font: context.regularFont,
    size: 5.8,
    color: context.theme.muted,
    align: "right",
  });
}

function drawTableCell(page, value, options) {
  drawRectTop(page, {
    x: options.x,
    top: options.top,
    width: options.width,
    height: options.height,
    fill: options.fill,
    border: options.border,
    borderWidth: options.borderWidth ?? 0.6,
  });
  drawTextInBox(page, value, options);
}

function drawRectTop(page, { x, top, width, height, fill, border, borderWidth = 0 }) {
  const options = {
    x,
    y: PDF_PAGE_HEIGHT - top - height,
    width,
    height,
  };
  if (fill) options.color = fill;
  if (border) {
    options.borderColor = border;
    options.borderWidth = borderWidth || 0.6;
  }
  page.drawRectangle(options);
}

function drawLineTop(page, x1, top1, x2, top2, color, thickness = 0.6) {
  page.drawLine({
    start: { x: x1, y: PDF_PAGE_HEIGHT - top1 },
    end: { x: x2, y: PDF_PAGE_HEIGHT - top2 },
    color,
    thickness,
  });
}

function drawTextInBox(page, value, {
  x,
  top,
  width,
  height,
  font,
  size,
  color,
  align = "left",
  padding = 3,
  lineHeight = size * 1.22,
}) {
  const lines = wrapPdfText(font, value, size, Math.max(1, width - padding * 2));
  const ascent = font.heightAtSize(size, { descender: false });
  const fullHeight = font.heightAtSize(size, { descender: true });
  const blockHeight = fullHeight + Math.max(0, lines.length - 1) * lineHeight;
  const boxBottom = PDF_PAGE_HEIGHT - top - height;
  const blockTop = boxBottom + (height + blockHeight) / 2;
  const firstBaseline = blockTop - ascent;
  lines.forEach((line, index) => {
    const textWidth = font.widthOfTextAtSize(line, size);
    let textX = x + padding;
    if (align === "center") textX = x + (width - textWidth) / 2;
    if (align === "right") textX = x + width - padding - textWidth;
    page.drawText(line, {
      x: textX,
      y: firstBaseline - index * lineHeight,
      size,
      font,
      color,
    });
  });
}

function drawMixedLinesInBox(page, lines, { x, top, width, height, align = "left" }) {
  if (!lines.length) return;
  const blockHeight = lines.reduce((sum, line) => sum + line.lineHeight, 0);
  const boxBottom = PDF_PAGE_HEIGHT - top - height;
  let lineTop = boxBottom + (height + blockHeight) / 2;
  lines.forEach((line) => {
    const ascent = line.font.heightAtSize(line.size, { descender: false });
    const textWidth = line.font.widthOfTextAtSize(line.text, line.size);
    let textX = x;
    if (align === "center") textX = x + (width - textWidth) / 2;
    if (align === "right") textX = x + width - textWidth;
    page.drawText(line.text, {
      x: textX,
      y: lineTop - ascent,
      size: line.size,
      font: line.font,
      color: line.color,
    });
    lineTop -= line.lineHeight;
  });
}

function measureTextBlock(font, value, size, maxWidth, lineHeight = size * 1.22) {
  const lines = wrapPdfText(font, value, size, Math.max(1, maxWidth));
  return font.heightAtSize(size, { descender: true }) + Math.max(0, lines.length - 1) * lineHeight;
}

function wrapPdfText(font, value, size, maxWidth) {
  const normalized = normalizePdfText(value || "-");
  const output = [];
  normalized.split("\n").forEach((paragraph) => {
    if (!paragraph) {
      output.push("");
      return;
    }
    let line = "";
    let lastBreak = -1;
    for (const character of paragraph) {
      const candidate = line + character;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        if (lastBreak > 0) {
          output.push(line.slice(0, lastBreak).trimEnd());
          line = `${line.slice(lastBreak).trimStart()}${character}`;
        } else {
          output.push(line);
          line = character;
        }
        lastBreak = /\s/.test(line) ? line.length - 1 : -1;
      } else {
        line = candidate;
        if (/\s/.test(character)) lastBreak = line.length - 1;
      }
    }
    output.push(line || "-");
  });
  return output.length ? output : ["-"];
}

function normalizePdfText(value) {
  return String(value ?? "-")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim() || "-";
}

function paginateDetailPages(categories, staging, employee) {
  if (!categories.length) return [];
  const availableHeight = measureDetailAvailableHeight(staging, employee);
  const titleHeightByCategory = new Map();
  const measureCategoryTitle = (categoryInfo) => {
    if (!titleHeightByCategory.has(categoryInfo.key)) {
      titleHeightByCategory.set(categoryInfo.key, measureMarkupHeight(staging, buildCategoryTitle(categoryInfo.label)));
    }
    return titleHeightByCategory.get(categoryInfo.key);
  };
  const measureGroup = (group) => measureMarkupHeight(staging, buildSessionGroupMarkup(group));
  const fragmentsByCategory = categories.map((categoryInfo) => {
    const maxGroupHeight = Math.max(180, availableHeight - measureCategoryTitle(categoryInfo));
    return {
      category: categoryInfo,
      fragments: categoryInfo.sessions.flatMap((group) => splitOversizedGroup(group, maxGroupHeight, measureGroup)),
    };
  });

  const pages = [];
  let currentPage = [];
  let usedHeight = 0;

  const startNewPage = () => {
    if (currentPage.length) pages.push(currentPage);
    currentPage = [];
    usedHeight = 0;
  };

  fragmentsByCategory.forEach(({ category: categoryInfo, fragments }) => {
    fragments.forEach((fragment) => {
      const lastSection = currentPage.at(-1);
      let needsCategoryTitle = !lastSection || lastSection.key !== categoryInfo.key;
      const groupHeight = measureGroup(fragment);
      let requiredHeight = groupHeight + (needsCategoryTitle ? measureCategoryTitle(categoryInfo) : 0);

      if (currentPage.length && usedHeight + requiredHeight > availableHeight) {
        startNewPage();
        needsCategoryTitle = true;
        requiredHeight = groupHeight + measureCategoryTitle(categoryInfo);
      }

      if (needsCategoryTitle) {
        currentPage.push({ key: categoryInfo.key, label: categoryInfo.label, groups: [] });
      }
      currentPage.at(-1).groups.push(fragment);
      usedHeight += requiredHeight;
    });
  });

  startNewPage();
  return pages;
}

function splitOversizedGroup(group, maxHeight, measureGroup) {
  if (measureGroup(group) <= maxHeight || group.items.length <= 1) return [group];
  const fragments = [];
  let currentItems = [];

  group.items.forEach((item) => {
    const candidate = { ...group, items: [...currentItems, item], continued: fragments.length > 0 };
    if (currentItems.length && measureGroup(candidate) > maxHeight) {
      fragments.push({ ...group, items: currentItems, continued: fragments.length > 0 });
      currentItems = [item];
    } else {
      currentItems.push(item);
    }
  });
  if (currentItems.length) fragments.push({ ...group, items: currentItems, continued: fragments.length > 0 });
  return fragments;
}

function measureDetailAvailableHeight(staging, employee) {
  const page = buildPdfPage({
    employee,
    report: { categories: [], records: [], sessionCount: 0 },
    pageModel: { type: "detail", sections: [] },
    pageNumber: 1,
    pageCount: 1,
  });
  staging.appendChild(page);
  const content = page.querySelector(".detail-content");
  const footer = page.querySelector(".pdf-footer");
  const available = Math.max(1, footer.getBoundingClientRect().top - content.getBoundingClientRect().top - 10);
  page.remove();
  return available;
}

function measureMarkupHeight(staging, markup) {
  const wrapper = document.createElement("div");
  wrapper.className = "pdf-measure-root";
  wrapper.innerHTML = markup;
  staging.appendChild(wrapper);
  const element = wrapper.firstElementChild;
  const styles = getComputedStyle(element);
  const height = Math.ceil(element.getBoundingClientRect().height
    + (Number.parseFloat(styles.marginTop) || 0)
    + (Number.parseFloat(styles.marginBottom) || 0)) + 2;
  wrapper.remove();
  return height;
}

function buildPdfPage({ employee, report, pageModel, pageNumber, pageCount }) {
  const page = document.createElement("section");
  page.className = "history-card-pdf-page";
  const isCover = pageModel.type === "cover";
  page.innerHTML = `
    <header class="pdf-header ${isCover ? "cover" : "compact"}">
      <div class="pdf-brand">${PDF_BRAND}</div>
      <div class="pdf-title">${PDF_TITLE}</div>
      <dl class="pdf-meta">
        <div><dt>출력일시</dt><dd>${escapeHtml(formatPrintDate(new Date()))}</dd></div>
        <div><dt>대상자</dt><dd>${escapeHtml(profileValue(employee.name))} (${escapeHtml(profileValue(employee.empNo))})</dd></div>
        <div><dt>페이지</dt><dd>${pageNumber} / ${pageCount}</dd></div>
      </dl>
    </header>
    ${isCover
      ? `<main class="cover-content">${buildProfileSection(employee)}${buildSummarySection(report)}</main>`
      : `<main class="detail-content">${buildDetailSections(pageModel.sections)}</main>`}
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
  return `<section class="profile-section"><h2>1. 인적사항</h2><div class="profile-grid">${cells}</div></section>`;
}

function buildSummarySection(report) {
  const body = report.categories.length
    ? report.categories.map((categoryInfo) => `<tr>
        <td>${escapeHtml(categoryInfo.label)}</td>
        <td>${categoryInfo.count}건</td>
        <td>${escapeHtml(categoryInfo.latestCompletedAt)}</td>
        <td>${escapeHtml(categoryInfo.latestResult)}</td>
        <td>${escapeHtml(categoryInfo.latestStage)}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="empty-cell">등록된 교육이력이 없습니다.</td></tr>`;
  return `<section class="summary-section">
    <h2>2. 교육 이력 요약 <em>총 ${report.records.length}건 · ${report.sessionCount}개 세션</em></h2>
    <table class="summary-table">
      <thead><tr><th>교육구분</th><th>이수 건수</th><th>최근 수료일</th><th>최근 결과</th><th>최근 초기/보수</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

function buildDetailSections(sections) {
  if (!sections?.length) return `<div class="empty-detail">표시할 상세 교육이력이 없습니다.</div>`;
  return sections.map((section) => `
    <section class="category-section">
      ${buildCategoryTitle(section.label)}
      ${section.groups.map(buildSessionGroupMarkup).join("")}
    </section>
  `).join("");
}

function buildCategoryTitle(label) {
  return `<h2 class="category-title">${escapeHtml(label)} 상세</h2>`;
}

function buildSessionGroupMarkup(group) {
  const commonDetails = OPTIONAL_DETAIL_FIELDS
    .filter(([field]) => group.commonDetails[field])
    .map(([field, label]) => `<div><dt>${label}</dt><dd>${escapeHtml(group.commonDetails[field])}</dd></div>`)
    .join("");
  const itemRows = group.items.length
    ? group.items.map((item, index) => {
        const itemDetails = OPTIONAL_DETAIL_FIELDS
          .filter(([field]) => item.details[field])
          .map(([field, label]) => `<small><b>${label}</b> ${escapeHtml(item.details[field])}</small>`)
          .join("");
        const note = item.note && item.note !== "-" ? `<small><b>비고</b> ${escapeHtml(item.note)}</small>` : "";
        return `<div class="session-item"><span class="item-number">${index + 1}</span><div class="item-name">${escapeHtml(item.name)}${itemDetails}${note}</div></div>`;
      }).join("")
    : `<div class="empty-cell">교육과정명이 없습니다.</div>`;

  return `<article class="session-group">
    <h3><span>${escapeHtml(group.categoryLabel)}</span> · ${escapeHtml(group.title)}${group.continued ? " (계속)" : ""}</h3>
    <dl class="session-meta">
      <div><dt>교육기간</dt><dd>${escapeHtml(group.period)}</dd></div>
      <div><dt>수료일자</dt><dd>${escapeHtml(group.completedAt)}</dd></div>
      <div><dt>강사</dt><dd>${escapeHtml(group.instructor)}</dd></div>
      <div><dt>교육시간</dt><dd>${escapeHtml(group.hours)}</dd></div>
      <div><dt>결과</dt><dd class="result-value">${escapeHtml(group.result)}</dd></div>
      <div><dt>구분</dt><dd>${escapeHtml(group.stage)}</dd></div>
      <div class="wide"><dt>비고</dt><dd>${escapeHtml(group.note)}</dd></div>
      ${commonDetails}
    </dl>
    <div class="session-items" role="list" aria-label="교육과정명 목록">${itemRows}</div>
    <p class="session-count">원본 교육이력 ${group.sourceRecordCount}건</p>
  </article>`;
}

function pdfStyles() {
  return `
    .history-card-pdf-page,.history-card-pdf-page *{box-sizing:border-box}
    .history-card-pdf-page{position:relative;width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT}px;padding:30px 32px 42px;background:#fff;color:#172033;font-family:"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;overflow:hidden}
    .pdf-header{position:relative;height:76px;border-bottom:3px solid #1554a0;display:grid;grid-template-columns:1fr 1.25fr 1fr;align-items:center}.pdf-header.compact{height:68px}
    .pdf-brand{font-size:18px;font-weight:800;letter-spacing:-.2px;color:#123f78;white-space:nowrap}.pdf-title{text-align:center;font-size:27px;font-weight:800;letter-spacing:-.8px;color:#101827}.compact .pdf-title{font-size:22px}
    .pdf-meta{margin:0;justify-self:end;font-size:9.5px;line-height:1.5;min-width:180px}.pdf-meta div{display:grid;grid-template-columns:48px 1fr;gap:6px}.pdf-meta dt{font-weight:700;color:#5c687a}.pdf-meta dd{margin:0;color:#202a3b;white-space:nowrap}
    .cover-content h2,.category-title{height:31px;margin:15px 0 7px;padding-left:10px;border-left:7px solid #1757a4;display:flex;align-items:center;font-size:14px;color:#174f91}.cover-content h2 em{margin-left:auto;font-size:9.5px;font-style:normal;font-weight:600;color:#7b8798}
    .profile-grid{display:grid;grid-template-columns:repeat(2,1fr);border-top:1px solid #c7d0db;border-left:1px solid #c7d0db}.profile-cell{min-height:46px;display:grid;grid-template-columns:94px 1fr;border-right:1px solid #c7d0db;border-bottom:1px solid #c7d0db}.profile-cell span{display:flex;align-items:center;justify-content:center;padding:7px;background:#eef3f9;color:#3b4a5d;font-size:10.5px;font-weight:700;text-align:center}.profile-cell strong{display:flex;align-items:center;padding:7px 10px;font-size:10.5px;line-height:1.4;font-weight:500;overflow-wrap:anywhere}
    .summary-table{width:100%;border-collapse:collapse;table-layout:fixed}.summary-table th{padding:7px 5px;border:1px solid #3e6fa8;background:#1554a0;color:#fff;font-size:12px;text-align:center}.summary-table td{height:36px;padding:7px 6px;border:1px solid #cbd3dd;font-size:12px;text-align:center;vertical-align:middle}.summary-table tbody tr:nth-child(even) td{background:#f8fafc}
    .detail-content{padding-top:4px}.category-section{margin:0}.category-title{margin:8px 0 6px;height:27px;font-size:15px}.session-group{margin:0 0 8px;border:1px solid #aebdcd;border-radius:5px;overflow:hidden;break-inside:avoid;page-break-inside:avoid;background:#fff}.session-group h3{margin:0;padding:6px 9px;background:#eaf2fb;border-bottom:1px solid #b7c7d8;color:#153e6d;font-size:15px;line-height:1.25}.session-group h3 span{font-weight:800}
    .session-meta{display:grid;grid-template-columns:repeat(4,1fr);margin:0;border-bottom:1px solid #cbd3dd}.session-meta>div{min-height:24px;display:grid;grid-template-columns:54px 1fr;border-right:1px solid #d7dee7;border-bottom:1px solid #d7dee7}.session-meta>div:nth-child(4n){border-right:0}.session-meta dt{display:flex;align-items:center;justify-content:center;padding:3px;background:#f1f5f9;color:#475569;font-size:10.5px;font-weight:700;text-align:center}.session-meta dd{display:flex;align-items:center;margin:0;padding:3px 5px;font-size:11.5px;line-height:1.2;overflow-wrap:anywhere}.session-meta .wide{grid-column:span 2}.result-value{font-weight:800;color:#16813a}
    .session-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid #3e6fa8;border-left:1px solid #d5dce5;background:#fff}.session-item{min-height:22px;display:grid;grid-template-columns:28px 1fr;align-items:stretch;border-right:1px solid #d5dce5;border-bottom:1px solid #d5dce5;font-size:12px;line-height:1.2}.session-item:nth-child(4n+3),.session-item:nth-child(4n+4){background:#fafbfd}.item-number{display:flex;align-items:center;justify-content:center;border-right:1px solid #d5dce5;color:#526276;font-size:10.5px}.session-items .item-name{display:flex;flex-direction:column;justify-content:center;padding:3px 6px;text-align:left;font-weight:650;overflow-wrap:anywhere}.session-items small{display:block;margin-top:1px;color:#5f6d7d;font-size:9.5px;font-weight:400}.session-items small b{margin-right:4px;color:#365d88}.session-count{margin:0;padding:3px 7px;text-align:right;color:#7b8798;font-size:9.5px}.session-items .empty-cell{grid-column:1/-1;height:auto!important;min-height:34px;display:flex;align-items:center;justify-content:center;border-right:1px solid #d5dce5;border-bottom:1px solid #d5dce5}
    .empty-cell{height:58px!important;color:#7a8797!important;text-align:center!important;background:#fff!important}.empty-detail{margin-top:40px;padding:40px;border:1px dashed #cbd3dd;text-align:center;color:#7a8797;font-size:11px}.pdf-measure-root{position:absolute;left:0;top:0;width:730px;visibility:hidden}.pdf-footer{position:absolute;left:32px;right:32px;bottom:15px;display:flex;justify-content:space-between;padding-top:7px;border-top:1px solid #d7dde5;color:#8490a0;font-size:8.5px}
  `;
}

function resolveStage(row) {
  const candidates = [
    row.stage,
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

function commonValue(records, field, emptyValue) {
  const values = [...new Set(records.map((record) => String(record[field] ?? "").trim()).filter((value) => value && value !== "-"))];
  return values.length === 1 ? values[0] : emptyValue;
}

function attachmentNames(row) {
  const values = [
    row.attachmentFileName,
    row.fileName,
    row.materialFileName,
    row.attachmentName,
    ...(Array.isArray(row.attachments) ? row.attachments : []),
    ...(Array.isArray(row.files) ? row.files : []),
  ];
  const names = values.flatMap((value) => {
    if (!value) return [];
    const raw = typeof value === "object"
      ? firstText(value.fileName, value.name, value.originalName, value.title)
      : String(value);
    if (!raw) return [];
    const withoutQuery = raw.split(/[?#]/)[0];
    const name = withoutQuery.split(/[\\/]/).pop();
    return name ? [decodeSafe(name)] : [];
  });
  return [...new Set(names)].join(", ");
}

function decodeSafe(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function displayText(value) {
  if (Array.isArray(value)) return value.map((item) => displayText(item)).filter(Boolean).join(" · ");
  if (value && typeof value === "object") return firstText(value.text, value.content, value.title, value.name);
  return String(value ?? "").trim();
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateSortValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (value && typeof value === "object" && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value === "object" && Number.isFinite(value.seconds)) return value.seconds * 1000;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 1e10) return numeric;
  const parsed = new Date(String(value).trim()).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPrintDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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

function normalizeKey(value) {
  return normalizeText(value).replace(/[^a-z0-9가-힣]+/g, "");
}

function escapeHtml(value) {
  return String(value ?? "-")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function loadPdfLibraries() {
  if (pdfLibrariesPromise) return pdfLibrariesPromise;
  pdfLibrariesPromise = Promise.all([
    loadScript(PDFLIB_URL, () => window.PDFLib?.PDFDocument),
    loadScript(FONTKIT_URL, () => window.fontkit),
  ]).then(() => {
    const { PDFDocument, rgb } = window.PDFLib || {};
    const fontkit = window.fontkit;
    if (!PDFDocument || !rgb || !fontkit) throw new Error("PDF 생성 도구를 불러오지 못했습니다.");
    return { PDFDocument, rgb, fontkit };
  }).catch((error) => {
    pdfLibrariesPromise = null;
    throw error;
  });
  return pdfLibrariesPromise;
}

function loadPdfFontBytes() {
  if (pdfFontBytesPromise) return pdfFontBytesPromise;
  pdfFontBytesPromise = Promise.all([
    fetchPdfFont(PDF_FONT_REGULAR_URL),
    fetchPdfFont(PDF_FONT_BOLD_URL),
  ]).then(([regular, bold]) => ({ regular, bold })).catch((error) => {
    pdfFontBytesPromise = null;
    throw error;
  });
  return pdfFontBytesPromise;
}

async function fetchPdfFont(url) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`PDF 글꼴을 불러오지 못했습니다. (${response.status})`);
  return response.arrayBuffer();
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

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildPdfFileName(employee) {
  const safe = (value, fallback) => String(value ?? "").trim().replace(/[\\/:*?"<>|]/g, "_") || fallback;
  return `개인교육이력카드_${safe(employee.name, "직원")}_${safe(employee.empNo, "사번없음")}.pdf`;
}
