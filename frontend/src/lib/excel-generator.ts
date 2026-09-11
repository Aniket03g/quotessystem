import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import type { QuoteData, QuoteProduct } from './pdf-generator';

export type { QuoteData } from './pdf-generator';

// The workbook is a working sheet, not the document the customer signs: the
// signed PDF stays the official artifact. So every money and quantity cell is
// written as a real number with a display format, never as pre-formatted text —
// the whole point of getting a quote in Excel is being able to total, filter and
// re-price it at the other end.
const INR = '"₹" #,##,##0.00'; // Indian digit grouping, e.g. ₹ 1,23,456.00

// Column order. Kept close to the PDF's table so the two documents read the
// same way, but Qty/UOM and the discount are split into their own numeric
// columns because a spreadsheet can use them and a PDF cell cannot.
const COLUMNS = [
  { header: 'Sr. No', width: 7, align: 'center' as const },
  { header: 'Product', width: 38, align: 'left' as const },
  { header: 'Brand', width: 14, align: 'left' as const },
  { header: 'Description', width: 48, align: 'left' as const },
  { header: 'Model No', width: 16, align: 'center' as const },
  { header: 'HSN Code', width: 12, align: 'center' as const },
  { header: 'Qty', width: 7, align: 'center' as const },
  { header: 'UOM', width: 9, align: 'center' as const },
  { header: 'Unit Price', width: 15, align: 'right' as const },
  { header: 'Discount', width: 14, align: 'right' as const },
  { header: 'Tax (%)', width: 10, align: 'center' as const },
  { header: 'Amount', width: 17, align: 'right' as const },
  { header: 'Warranty (months)', width: 12, align: 'center' as const },
];
const LAST_COL = COLUMNS.length; // 13 -> M

const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/** Excel keeps unicode happily; only the line endings need normalising. */
function clean(input: string | null | undefined): string {
  if (!input) return '';
  return String(input).replace(/\r\n?/g, '\n').trim();
}

/**
 * Tax as a fraction. Mirrors pdf-generator: the field arrives either as a bare
 * number from the catalog (18) or as a hand-typed label ("GST-18%"), and the
 * first number found in it is the rate.
 */
function taxRateOf(tax: QuoteProduct['tax']): number {
  if (tax == null || tax === '') return 0;
  if (typeof tax === 'number') return (tax as number) / 100;
  const match = String(tax).match(/([0-9.]+)/);
  return match ? parseFloat(match[1]) / 100 : 0;
}

/** "20th Aug 2026" for the validity term, same wording the PDF uses. */
function validityTermOf(validUntil?: string): string {
  if (!validUntil) return 'Quote valid for 20 days';
  const end = new Date(validUntil);
  if (isNaN(end.getTime())) return 'Quote valid for 20 days';
  const day = end.getDate();
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? 'th'
      : day % 10 === 1
        ? 'st'
        : day % 10 === 2
          ? 'nd'
          : day % 10 === 3
            ? 'rd'
            : 'th';
  const month = end.toLocaleDateString('en-GB', { month: 'short' });
  return `Quote valid till ${day}${suffix} ${month} ${end.getFullYear()}`;
}

/** The logo file, looked up in the same three places the PDF generator tries. */
function findLogo(selectedLogo: string): { buffer: Buffer; ext: 'png' | 'jpeg' } | null {
  try {
    const fileName = selectedLogo === 'grove' ? 'grove_logo.png' : 'green-o-care-logo.png';
    const candidates = [
      path.join(process.cwd(), fileName),
      path.join(process.cwd(), 'dist', 'client', fileName),
      path.join(process.cwd(), 'public', fileName),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return {
          buffer: fs.readFileSync(candidate),
          ext: path.extname(fileName).toLowerCase() === '.png' ? 'png' : 'jpeg',
        };
      }
    }
  } catch (error) {
    console.error('[Excel] Logo error:', error);
  }
  return null;
}

export async function generateExcelBuffer(quoteData: QuoteData): Promise<Buffer> {
  const selectedLogo = quoteData.logo || 'greenocare';
  const isGrove = selectedLogo === 'grove';
  const companyName = isGrove ? 'Grove Systems Pvt. Ltd.' : 'GreenOCare Solutions Pvt. Ltd.';

  const workbook = new ExcelJS.Workbook();
  workbook.creator = companyName;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Quotation', {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  const colLetter = (index: number) => sheet.getColumn(index).letter;
  const mergeRow = (row: number, from: number, to: number) =>
    sheet.mergeCells(`${colLetter(from)}${row}:${colLetter(to)}${row}`);

  // -------------------------------------------------------------- letterhead
  // Rows 1-4 are left empty and the logo floats over them; an image in ExcelJS
  // is anchored to the sheet rather than placed in a cell, so the space for it
  // has to be reserved by hand.
  const logo = findLogo(selectedLogo);
  if (logo) {
    const imageId = workbook.addImage({ buffer: logo.buffer as any, extension: logo.ext });
    sheet.addImage(imageId, {
      tl: { col: 0.2, row: 0.2 },
      ext: { width: 220, height: 55 },
    });
  }
  for (let r = 1; r <= 4; r++) sheet.getRow(r).height = 15;

  let cursor = 5;
  const writeLeft = (text: string, style: Partial<ExcelJS.Font> = {}) => {
    const cell = sheet.getCell(cursor, 1);
    cell.value = text;
    cell.font = { name: 'Calibri', size: 11, ...style };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    mergeRow(cursor, 1, 4);
    cursor++;
  };

  writeLeft(companyName, { size: 16, bold: true });
  writeLeft(
    isGrove
      ? 'F-85, Okhla Industrial Estate, Phase-III'
      : 'F-85, Second Floor, Okhla Industrial Estate, Phase-III',
    { size: 10 }
  );
  writeLeft('New Delhi - 110020', { size: 10 });
  writeLeft(`GST No- ${isGrove ? '07AAHCG5253F1ZO' : '07AAECG5147M1ZB'}`, { size: 10 });
  cursor++;

  // ----------------------------------------------------- customer / quote box
  // Two independent columns, exactly as in the PDF: the customer address on the
  // left grows downwards without pushing the quote meta on the right.
  const blockStart = cursor;
  const leftLines: Array<{ text: string; bold?: boolean; size?: number }> = [
    { text: 'Customer Name', bold: true },
    { text: quoteData.account.name || '-' },
  ];
  const { street, city, state, pinCode, country } = quoteData.account;
  const cityLine = [city, state, pinCode].filter(Boolean).join(', ');
  [street, cityLine, country]
    .filter(Boolean)
    .forEach((line) => leftLines.push({ text: String(line), size: 10 }));

  const rightLines: Array<{ text: string; bold?: boolean; size?: number }> = [
    { text: 'Quote', bold: true },
    { text: `Version: ${quoteData.version || '1.0'}` },
    { text: `Date: ${quoteData.date}` },
  ];
  if (quoteData.quoteNumber) rightLines.push({ text: quoteData.quoteNumber });
  if (quoteData.endUser) {
    rightLines.push({ text: 'End User Company', bold: true, size: 10 });
    rightLines.push({ text: quoteData.endUser, size: 10 });
  }
  if (quoteData.endUserLocation) rightLines.push({ text: quoteData.endUserLocation, size: 10 });

  leftLines.forEach((line, i) => {
    const cell = sheet.getCell(blockStart + i, 1);
    cell.value = line.text;
    cell.font = { name: 'Calibri', size: line.size || 11, bold: !!line.bold };
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    mergeRow(blockStart + i, 1, 5);
  });
  rightLines.forEach((line, i) => {
    const cell = sheet.getCell(blockStart + i, LAST_COL - 3);
    cell.value = line.text;
    cell.font = { name: 'Calibri', size: line.size || 11, bold: !!line.bold };
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    mergeRow(blockStart + i, LAST_COL - 3, LAST_COL);
  });

  const subjectRow = blockStart + Math.max(leftLines.length, rightLines.length) + 1;
  const subjectCell = sheet.getCell(subjectRow, 1);
  subjectCell.value = `Subject: ${quoteData.subject || ''}`;
  subjectCell.font = { name: 'Calibri', size: 11, bold: true };
  subjectCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  mergeRow(subjectRow, 1, LAST_COL);

  cursor = subjectRow + 2;

  // ---------------------------------------------------------- products table
  const headerRow = sheet.getRow(cursor);
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { name: 'Calibri', size: 10, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    cell.border = BORDER;
  });
  headerRow.height = 28;
  // Freeze everything above the first product so the table header stays put on
  // a long quote.
  sheet.views = [{ state: 'frozen', ySplit: cursor }];
  cursor++;

  let subtotalBeforeDiscount = 0;
  let totalDiscount = 0;
  let totalTax = 0;

  (quoteData.products || []).forEach((product, index) => {
    const price = product.price || 0;
    const qty = product.quantity || 1;
    const discountPct = product.discount || 0;

    // Same arithmetic as pdf-generator, in the same order: a discount in rupees
    // wins over a percentage, and tax applies after the discount.
    const itemSubtotal = price * qty;
    const discountAmount =
      product.discountRs != null ? product.discountRs : (itemSubtotal * discountPct) / 100;
    const afterDiscount = itemSubtotal - discountAmount;
    const rate = taxRateOf(product.tax);
    const itemTax = afterDiscount * rate;
    const itemTotal = afterDiscount + itemTax;

    subtotalBeforeDiscount += itemSubtotal;
    totalDiscount += discountAmount;
    totalTax += itemTax;

    const row = sheet.getRow(cursor);
    const values: Array<string | number> = [
      index + 1,
      clean(product.name),
      clean(product.brand),
      clean(product.description),
      clean(product.productCode) || '-',
      clean(product.hsnCode) || '-',
      qty,
      clean(product.uom),
      price,
      discountAmount,
      rate * 100,
      itemTotal,
      product.warranty != null ? product.warranty : '-',
    ];
    values.forEach((value, i) => {
      const cell = row.getCell(i + 1);
      cell.value = value as any;
      cell.font = { name: 'Calibri', size: 10, bold: i === 1 };
      cell.alignment = {
        horizontal: COLUMNS[i].align,
        vertical: 'top',
        wrapText: i === 1 || i === 3,
      };
      cell.border = BORDER;
    });
    row.getCell(9).numFmt = INR;
    row.getCell(10).numFmt = INR;
    row.getCell(11).numFmt = '0.##"%"';
    row.getCell(12).numFmt = INR;
    cursor++;
  });

  const grandTotal = subtotalBeforeDiscount - totalDiscount + totalTax;

  // ------------------------------------------------------------------ totals
  cursor++;
  // A "₹ 0.00" discount row reads as a mistake, so it is only shown once
  // something was actually discounted — half a paisa, same threshold as the PDF.
  const showDiscount = totalDiscount >= 0.005;
  const summary: Array<[string, number, boolean]> = [
    ['Sub Total', subtotalBeforeDiscount, false],
    ['Tax', totalTax, false],
    ...(showDiscount
      ? ([['Discount', totalDiscount, false]] as Array<[string, number, boolean]>)
      : []),
    ['Grand Total', grandTotal, true],
  ];
  summary.forEach(([label, amount, bold]) => {
    const labelCell = sheet.getCell(cursor, LAST_COL - 2);
    labelCell.value = label;
    labelCell.font = { name: 'Calibri', size: bold ? 12 : 10, bold };
    labelCell.alignment = { horizontal: 'right' };
    mergeRow(cursor, LAST_COL - 2, LAST_COL - 1);

    const valueCell = sheet.getCell(cursor, LAST_COL);
    valueCell.value = amount;
    valueCell.numFmt = INR;
    valueCell.font = { name: 'Calibri', size: bold ? 12 : 10, bold };
    valueCell.alignment = { horizontal: 'right' };
    if (bold) {
      valueCell.border = {
        top: THIN,
        bottom: { style: 'double', color: { argb: 'FF000000' } },
      };
    }
    cursor++;
  });

  // ------------------------------------------------------------------- terms
  cursor += 2;
  const bankDetails = isGrove
    ? 'Bank Details - Kotak Mahindra Bank, Account No- 5949818822, IFSC Code- KKBK0004651'
    : 'Bank Details - Kotak Mahindra Bank, Account No- 6847253937, IFSC Code- KKBK0004651';
  const orderLine = isGrove
    ? 'Order to be placed on: Grove Systems Pvt. Ltd., F-85, Okhla Industrial Area, Phase III, New Delhi - 110020.'
    : 'Order to be placed on: GreenOCare Solutions Pvt. Ltd., F-85, 2nd Floor, Okhla Industrial Area, Phase III, New Delhi - 110020.';
  const extraTerms = quoteData.extraTerms || '';

  const terms = [
    orderLine,
    `Delivery Terms - ${quoteData.deliveryTerms || ''}`,
    `Payment Terms - ${quoteData.paymentTerms || ''}`,
    ...(extraTerms ? [extraTerms] : []),
    bankDetails,
    validityTermOf(quoteData.validUntil),
  ];

  const termsHeading = sheet.getCell(cursor, 1);
  termsHeading.value = 'Terms and Conditions';
  termsHeading.font = { name: 'Calibri', size: 12, bold: true };
  mergeRow(cursor, 1, LAST_COL);
  cursor++;

  terms.forEach((term, i) => {
    const cell = sheet.getCell(cursor, 1);
    cell.value = `${i + 1}. ${term}`;
    cell.font = { name: 'Calibri', size: 10 };
    cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    mergeRow(cursor, 1, LAST_COL);
    cursor++;
  });

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
