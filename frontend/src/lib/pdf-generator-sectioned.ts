import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'fs';
import path from 'path';

/**
 * Sectioned quote layout — a floor/room-grouped alternative to the flat table in
 * pdf-generator.ts. Modelled on the AV bill-of-materials quotes the team builds
 * in Excel, where ~100 line items only make sense once they're bucketed by which
 * floor and which room they're being installed in.
 *
 * The standard layout is untouched; pick between them per quote. Nothing here is
 * shared with pdf-generator.ts on purpose — the two are free to drift.
 */

export interface SectionedQuoteProduct {
  name: string;
  description?: string;
  /** Brand. Gets its own column here rather than being folded into the description. */
  make?: string;
  /** Model no. Falls back to productCode so existing callers keep working. */
  model?: string;
  productCode?: string;
  quantity?: number;
  price?: number;
  discount?: number;
  discountRs?: number | null;
  /** Tax as a plain number, e.g. 18. Parsed out of `tax` ("GST-18%") when absent. */
  taxPercent?: number;
  tax?: string;
  /** Free-text per-line note, e.g. "1 Display Per Room". */
  remarks?: string;
  /** Text ("3 Years") or a month count, which is rendered as years. */
  warranty?: string | number | null;
  uom?: string;

  // --- grouping ---
  /** Tier 0. Names the alternative this line belongs to, e.g. "Wired Solution". */
  option?: string;
  /** Tier 1 heading, e.g. "1st Floor". */
  floor?: string;
  /** Tier 2 heading, e.g. "Meeting Room 4 PAX - (3 Rooms)". */
  room?: string;
  /** Single-field alternative: "1st Floor > Meeting Room 4 PAX". Used only when floor/room are unset. */
  section?: string;
}

export interface SectionedQuoteData {
  id: number;
  subject: string;
  date: string;
  validUntil?: string;
  version?: string;
  quoteNumber?: string;
  logo?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  extraTerms?: string;
  /** Header metadata block. Falls back to the account name when absent. */
  clientName?: string;
  location?: string;
  submittedBy?: string;
  approvedBy?: string;
  revision?: string;
  endUser?: string;
  endUserLocation?: string;
  /**
   * Option labels in presentation order, e.g. ["Wired Solution","Wireless Solution"].
   * Order cannot be recovered from the line items, and an option nobody has priced
   * yet has no line items at all — so it is carried explicitly or it is lost.
   */
  options?: string[];
  account: {
    name: string;
    street?: string;
    city?: string;
    state?: string;
    pinCode?: string;
    country?: string;
  };
  products: SectionedQuoteProduct[];
}

export interface SectionedPdfOptions {
  /** Print a subtotal row under each room. Off by default — it doubles the row count on dense quotes. */
  roomSubtotals?: boolean;
}

const COLOR_FLOOR_BG: [number, number, number] = [214, 224, 236];
const COLOR_ROOM_BG: [number, number, number] = [238, 242, 247];
const COLOR_SUBTOTAL_BG: [number, number, number] = [248, 248, 248];
const COLOR_TOTAL_BG: [number, number, number] = [226, 232, 240];
const COLOR_LINE: [number, number, number] = [80, 80, 80];
const COLOR_OPTION_BG: [number, number, number] = [31, 55, 90];

function formatINR(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Bare number, for inside the table where a "Rs." on every row is just noise. */
function formatNum(amount: number): string {
  return amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// jsPDF's standard fonts only speak WinAnsi, and product text pasted from supplier
// datasheets is full of smart quotes, unicode dashes and Symbol-font bullets. Left
// alone those render as garbage, and a non-breaking space glued between two words
// makes an unwrappable mega-token that spills past the cell border.
function sanitizePdfText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/[•‣◦⁃∙]/g, '•')
    .replace(/[   -   　]/g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[^\n\x20-\x7E•]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^\s+|\s+$/g, '');
}

function taxRateOf(product: SectionedQuoteProduct): number {
  if (typeof product.taxPercent === 'number') return product.taxPercent;
  const match = product.tax?.match(/([0-9.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

function warrantyLabel(warranty: string | number | null | undefined): string {
  if (warranty == null || warranty === '') return '-';
  if (typeof warranty === 'string') return warranty;
  // Stored in months; the Excel these quotes come from speaks in years.
  if (warranty % 12 === 0) {
    const years = warranty / 12;
    return `${years} ${years === 1 ? 'Year' : 'Years'}`;
  }
  return `${warranty} Months`;
}

interface RoomGroup {
  room: string | null;
  items: SectionedQuoteProduct[];
}
interface FloorGroup {
  floor: string | null;
  rooms: RoomGroup[];
}

/** Banner for lines nobody assigned a floor/room to. */
const UNGROUPED_LABEL = 'Other Items';

/**
 * Bucket products by floor then room, preserving the order the salesperson added
 * them in. Items that share a floor but were added apart still land in the same
 * banner, which is what people expect when they fix an omission later.
 *
 * Unsectioned lines are collected into a single trailing group. They cannot stay
 * in place: a later row re-joins the floor group an earlier row opened, so an
 * unsectioned row sitting between them would be rendered *after* both and read as
 * part of the last room.
 */
function groupProducts(products: SectionedQuoteProduct[]): FloorGroup[] {
  const floors: FloorGroup[] = [];

  for (const product of products) {
    let { floor, room } = product;

    if (!floor && !room && product.section) {
      const parts = product.section.split('>').map((s) => s.trim()).filter(Boolean);
      floor = parts[0];
      room = parts.slice(1).join(' - ') || undefined;
    }

    const floorKey = floor?.trim() || null;
    const roomKey = room?.trim() || null;

    let floorGroup = floors.find((f) => f.floor === floorKey);
    if (!floorGroup) {
      floorGroup = { floor: floorKey, rooms: [] };
      floors.push(floorGroup);
    }

    let roomGroup = floorGroup.rooms.find((r) => r.room === roomKey);
    if (!roomGroup) {
      roomGroup = { room: roomKey, items: [] };
      floorGroup.rooms.push(roomGroup);
    }

    roomGroup.items.push(product);
  }

  const ungroupedIndex = floors.findIndex((f) => f.floor === null);
  if (ungroupedIndex !== -1 && ungroupedIndex !== floors.length - 1) {
    floors.push(floors.splice(ungroupedIndex, 1)[0]);
  }

  return floors;
}

interface OptionGroup {
  /** null on a single-option quote, which renders exactly as it did before options existed. */
  option: string | null;
  products: SectionedQuoteProduct[];
}

/**
 * Split the line items into alternatives. `declared` is the quote's own ordered
 * list of option names, and it wins over anything the line items imply: the
 * salesperson chose that order, and an option they set up but haven't priced yet
 * has no line items to be inferred from.
 *
 * With no options anywhere this returns a single unnamed group, so an ordinary
 * room-wise quote takes exactly the path it took before.
 */
function groupByOption(
  products: SectionedQuoteProduct[],
  declared?: string[],
): OptionGroup[] {
  const labelOf = (p: SectionedQuoteProduct) => p.option?.trim() || null;
  const names: string[] = [];
  const push = (name: string) => {
    if (name && !names.includes(name)) names.push(name);
  };

  (declared || []).forEach((name) => push(String(name).trim()));
  // A line carrying an option the quote never declared still has to be printed
  // somewhere — dropping it would silently delete a priced item.
  products.forEach((p) => {
    const label = labelOf(p);
    if (label) push(label);
  });

  if (names.length === 0) return [{ option: null, products }];

  const groups: OptionGroup[] = names.map((option) => ({ option, products: [] }));
  const orphans: SectionedQuoteProduct[] = [];
  for (const product of products) {
    const label = labelOf(product);
    const group = label ? groups.find((g) => g.option === label) : undefined;
    if (group) group.products.push(product);
    else orphans.push(product);
  }

  // Lines with no option on a quote that has options belong to every alternative
  // equally — common equipment, cabling, installation. Printing them once under
  // the first option is the least surprising of the bad choices, and matches how
  // the unsectioned rows are handled a level down.
  if (orphans.length) groups[0].products.push(...orphans);

  return groups.filter((g) => g.products.length > 0 || (declared || []).includes(g.option!));
}

interface LineMaths {
  qty: number;
  unitPrice: number;
  preTax: number;
  discountAmount: number;
  taxAmount: number;
  postTax: number;
  taxRate: number;
}

function computeLine(product: SectionedQuoteProduct): LineMaths {
  const qty = product.quantity || 0;
  const unitPrice = product.price || 0;
  const gross = unitPrice * qty;
  const discountAmount =
    product.discountRs != null ? product.discountRs : (gross * (product.discount || 0)) / 100;
  const preTax = gross - discountAmount;
  const taxRate = taxRateOf(product);
  const taxAmount = (preTax * taxRate) / 100;
  return { qty, unitPrice, preTax, discountAmount, taxAmount, postTax: preTax + taxAmount, taxRate };
}

/** Per-body-row bookkeeping, so didDrawCell can tell product rows from banners. */
interface RowMeta {
  descriptionLines: string[];
  nameLineCount: number;
  requiredHeight: number;
}

export function generateSectionedPdfBuffer(
  quoteData: SectionedQuoteData,
  options: SectionedPdfOptions = {},
): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;
  const rightX = pageWidth - margin;
  let currentY = margin;

  const selectedLogo = quoteData.logo || 'greenocare';
  const companyName =
    selectedLogo === 'grove' ? 'Grove Systems Pvt. Ltd.' : 'GreenOCare Solutions Pvt. Ltd.';
  const gstNumber = selectedLogo === 'grove' ? '07AAHCG5253F1ZO' : '07AAECG5147M1ZB';

  // ---------------------------------------------------------------- header ---

  // Resolved once. The letterhead is redrawn at the top of every option, so
  // re-reading the file per option would be pure waste.
  const logoAsset = (() => {
    try {
      const logoFileName = selectedLogo === 'grove' ? 'grove_logo.png' : 'green-o-care-logo.png';
      const possiblePaths = [
        path.join(process.cwd(), logoFileName),
        path.join(process.cwd(), 'dist', 'client', logoFileName),
        path.join(process.cwd(), 'public', logoFileName),
      ];
      for (const candidate of possiblePaths) {
        if (!fs.existsSync(candidate)) continue;
        const buffer = fs.readFileSync(candidate);
        const ext = path.extname(logoFileName).toLowerCase();
        return { data: buffer.toString('base64'), format: ext === '.png' ? 'PNG' : 'JPEG', ext, buffer };
      }
    } catch (error) {
      console.error('Logo error:', error);
    }
    return null;
  })();

  const ensureSpace = (needed: number) => {
    if (currentY + needed > pageHeight - 16) {
      doc.addPage();
      currentY = margin;
    }
  };

  /**
   * Letterhead, quote title, optional option banner and the metadata box.
   *
   * Drawn once per option rather than once per document: each option starts its
   * own page, and a customer who prints or forwards only the wireless half must
   * still be looking at something that identifies itself.
   */
  const drawHeader = (optionTitle: string | null) => {
    let logoRenderedHeight = 16;
    if (logoAsset) {
      const LOGO_BOX_W = 90;
      const LOGO_BOX_H = 18;
      const LOGO_PADDING = 3;
      const availableW = LOGO_BOX_W - LOGO_PADDING * 2;
      const availableH = LOGO_BOX_H - LOGO_PADDING * 2;

      let renderW: number;
      let renderH: number;
      if (selectedLogo === 'grove') {
        let imgW = 250;
        let imgH = 89;
        if (logoAsset.ext === '.png' && logoAsset.buffer.length > 24) {
          imgW = logoAsset.buffer.readUInt32BE(16);
          imgH = logoAsset.buffer.readUInt32BE(20);
        }
        const scale = Math.min(availableW / imgW, availableH / imgH);
        renderW = imgW * scale;
        renderH = imgH * scale;
      } else {
        renderW = availableW;
        renderH = renderW / (35 / 8);
      }

      doc.addImage(
        logoAsset.data,
        logoAsset.format,
        margin,
        currentY + (LOGO_BOX_H - renderH) / 2,
        renderW,
        renderH,
      );
      logoRenderedHeight = LOGO_BOX_H;
    }

    // Company block sits opposite the logo.
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(companyName, rightX, currentY + 5, { align: 'right' });

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    const addressLine =
      selectedLogo === 'grove'
        ? 'F-85, Okhla Industrial Area, Phase III'
        : 'F-85, 2nd Floor, Okhla Industrial Area, Phase III';
    doc.text(addressLine, rightX, currentY + 10, { align: 'right' });
    doc.text('New Delhi - 110020', rightX, currentY + 14, { align: 'right' });
    doc.text(`GST No- ${gstNumber}`, rightX, currentY + 18, { align: 'right' });

    currentY += Math.max(logoRenderedHeight, 18) + 6;

    // Quote title
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(sanitizePdfText(quoteData.subject), margin, currentY);
    currentY += 5;

    // Option banner. Deliberately loud: the whole risk of a two-option quote is
    // a reader who doesn't notice which one they're costing.
    if (optionTitle) {
      const bannerH = 8;
      doc.setFillColor(...COLOR_OPTION_BG);
      doc.rect(margin, currentY, usableWidth, bannerH, 'F');
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(sanitizePdfText(optionTitle).toUpperCase(), margin + 3, currentY + bannerH - 2.4);
      doc.setTextColor(0, 0, 0);
      currentY += bannerH + 3;
    }

    // Metadata grid, mirroring the Excel's bordered header box: label/value pairs
    // in two columns. The left column answers "who is this for", so the end user
    // sits directly under the client it was bought through.
    const metaLeft: Array<[string, string]> = [
      ['Client Name', quoteData.clientName || quoteData.account.name],
      ['Location', quoteData.location || [quoteData.account.city, quoteData.account.state].filter(Boolean).join(', ')],
    ];
    // Both optional and usually blank — pushed only when filled, so a quote with
    // no end user keeps the compact three-row box it has always had.
    if (quoteData.endUser) metaLeft.push(['End User', quoteData.endUser]);
    if (quoteData.endUserLocation) metaLeft.push(['End User Location', quoteData.endUserLocation]);
    metaLeft.push(['Submitted By', quoteData.submittedBy || '-']);
    const metaRight: Array<[string, string]> = [
      ['Approved by', quoteData.approvedBy || '-'],
      ['Date', quoteData.date],
      ['Revision', quoteData.revision || quoteData.version || '1'],
    ];
    if (quoteData.quoteNumber) metaRight.push(['Quote No', quoteData.quoteNumber]);

    const metaRows = Math.max(metaLeft.length, metaRight.length);
    const metaRowH = 5.5;
    const metaBoxH = metaRows * metaRowH + 2;
    const halfWidth = usableWidth / 2;

    doc.setDrawColor(...COLOR_LINE);
    doc.setLineWidth(0.3);
    doc.rect(margin, currentY, usableWidth, metaBoxH, 'S');
    doc.line(margin + halfWidth, currentY, margin + halfWidth, currentY + metaBoxH);

    doc.setFontSize(8.5);
    const drawMeta = (pairs: Array<[string, string]>, x: number, maxWidth: number) => {
      let y = currentY + 4.5;
      for (const [label, value] of pairs) {
        doc.setFont('helvetica', 'bold');
        doc.text(`${label}:`, x, y);
        // Measure while the bold face is still active — measuring in normal
        // underestimates, and the longer labels then collide with their value.
        const labelWidth = doc.getTextWidth(`${label}:`) + 2;
        doc.setFont('helvetica', 'normal');
        const text = doc.splitTextToSize(sanitizePdfText(value) || '-', maxWidth - labelWidth)[0] || '-';
        doc.text(text, x + labelWidth, y);
        y += metaRowH;
      }
    };
    drawMeta(metaLeft, margin + 2, halfWidth - 4);
    drawMeta(metaRight, margin + halfWidth + 2, halfWidth - 4);

    currentY += metaBoxH + 4;
  };

  // ----------------------------------------------------------------- table ---

  const COLUMN_COUNT = 11;
  // Column widths below are hand-tuned to sum to exactly the usable width
  // (A4 landscape, 277mm). Change one and change another to compensate.
  const DESC_WIDTH = 79;

  interface OptionTotals {
    preTax: number;
    discount: number;
    tax: number;
    grandTotal: number;
  }

  /**
   * Draws one option's floor/room table and its discount breakdown, and returns
   * what it came to. Totals are per option and never accumulate across them:
   * options are alternatives, so a running total spanning two of them is a
   * number no customer will ever pay.
   */
  const renderOptionTable = (optionProducts: SectionedQuoteProduct[]): OptionTotals => {
    if (optionProducts.length === 0) {
      // A declared option nobody has priced yet. Saying so is better than a
      // table with nothing but a zero in it, and far better than the option
      // silently not appearing at all.
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.text('No items have been added to this option yet.', margin, currentY + 4);
      doc.setFont('helvetica', 'normal');
      currentY += 12;
      return { preTax: 0, discount: 0, tax: 0, grandTotal: 0 };
    }

    const groups = groupProducts(optionProducts);

    const body: any[] = [];
    const rowMeta: Array<RowMeta | null> = [];

    let srNo = 0;
    let subtotalPreTax = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    const bannerRow = (label: string, fill: [number, number, number], fontSize: number) => {
      body.push([
        {
          content: sanitizePdfText(label),
          colSpan: COLUMN_COUNT,
          styles: {
            fillColor: fill,
            textColor: [0, 0, 0] as [number, number, number],
            fontStyle: 'bold' as const,
            fontSize,
            halign: 'center' as const,
            valign: 'middle' as const,
            cellPadding: { top: 1.6, right: 2, bottom: 1.6, left: 2 },
          },
        },
      ]);
      rowMeta.push(null);
    };

    // On a quote where nobody set any section at all, the single unnamed group is
    // the whole document — banner it and you've labelled every line "Other Items".
    const hasNamedSection = groups.some((f) => f.floor);

    for (const floorGroup of groups) {
      if (floorGroup.floor) {
        bannerRow(floorGroup.floor, COLOR_FLOOR_BG, 12);
      } else if (hasNamedSection) {
        // Never leave these unbannered: with nothing above them they read as part
        // of the preceding room.
        bannerRow(UNGROUPED_LABEL, COLOR_FLOOR_BG, 12);
      }

      for (const roomGroup of floorGroup.rooms) {
        if (roomGroup.room) bannerRow(roomGroup.room, COLOR_ROOM_BG, 9.5);

        let roomPreTax = 0;
        let roomPostTax = 0;

        for (const product of roomGroup.items) {
          const line = computeLine(product);
          srNo += 1;
          subtotalPreTax += line.preTax;
          totalDiscount += line.discountAmount;
          totalTax += line.taxAmount;
          roomPreTax += line.preTax;
          roomPostTax += line.postTax;

          // Measure the description cell up front: the name renders bold and the
          // description normal, which autoTable can't express in one cell, so the
          // text is drawn by hand in didDrawCell and the height reserved here.
          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'bold');
          const nameLines: string[] = doc.splitTextToSize(sanitizePdfText(product.name), DESC_WIDTH - 4);
          doc.setFont('helvetica', 'normal');

          const descriptionLines = [...nameLines];
          if (product.description) {
            for (const part of sanitizePdfText(product.description).split('\n')) {
              if (part.trim()) descriptionLines.push(...doc.splitTextToSize(part, DESC_WIDTH - 4));
            }
          }

          rowMeta.push({
            descriptionLines,
            nameLineCount: nameLines.length,
            requiredHeight: descriptionLines.length * 3.4 + 3,
          });

          body.push([
            srNo,
            // Left empty on purpose: the mixed bold/normal text is painted in
            // didDrawCell, and real content here would make autoTable reserve a
            // minimum column width from the longest word, blowing out the layout.
            '',
            sanitizePdfText(product.make) || '-',
            sanitizePdfText(product.model || product.productCode) || '-',
            `${line.qty}${product.uom ? ' ' + product.uom : ''}`,
            formatNum(line.unitPrice),
            formatNum(line.preTax),
            line.taxRate ? `${line.taxRate}%` : '-',
            formatNum(line.postTax),
            sanitizePdfText(product.remarks) || '',
            warrantyLabel(product.warranty),
          ]);
        }

        if (options.roomSubtotals && roomGroup.room && roomGroup.items.length > 1) {
          body.push([
            {
              content: `Subtotal - ${sanitizePdfText(roomGroup.room)}`,
              colSpan: 6,
              styles: { halign: 'right' as const, fontStyle: 'bold' as const, fillColor: COLOR_SUBTOTAL_BG },
            },
            { content: formatNum(roomPreTax), styles: { halign: 'right' as const, fontStyle: 'bold' as const, fillColor: COLOR_SUBTOTAL_BG } },
            { content: '', styles: { fillColor: COLOR_SUBTOTAL_BG } },
            { content: formatNum(roomPostTax), styles: { halign: 'right' as const, fontStyle: 'bold' as const, fillColor: COLOR_SUBTOTAL_BG } },
            { content: '', colSpan: 2, styles: { fillColor: COLOR_SUBTOTAL_BG } },
          ]);
          rowMeta.push(null);
        }
      }
    }

    const grandTotal = subtotalPreTax + totalTax;

    // Excel-style closing row: pre-tax under Total Price, post-tax under Total (incl. Tax).
    body.push([
      {
        content: 'Total Amount',
        colSpan: 6,
        styles: { halign: 'right' as const, fontStyle: 'bold' as const, fontSize: 9, fillColor: COLOR_TOTAL_BG },
      },
      { content: formatNum(subtotalPreTax), styles: { halign: 'right' as const, fontStyle: 'bold' as const, fontSize: 9, fillColor: COLOR_TOTAL_BG } },
      { content: '', styles: { fillColor: COLOR_TOTAL_BG } },
      { content: formatNum(grandTotal), styles: { halign: 'right' as const, fontStyle: 'bold' as const, fontSize: 9, fillColor: COLOR_TOTAL_BG } },
      { content: '', colSpan: 2, styles: { fillColor: COLOR_TOTAL_BG } },
    ]);
    rowMeta.push(null);

    autoTable(doc, {
      startY: currentY,
      head: [[
        'Sr.',
        'Description',
        'Make',
        'Model',
        'Qty',
        'Unit Price',
        'Total Price',
        'Tax',
        'Total (incl. Tax)',
        'Remarks',
        'Warranty',
      ]],
      body,
      theme: 'grid',
      headStyles: {
        fillColor: [230, 230, 230],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        fontSize: 7.5,
        halign: 'center',
        valign: 'middle',
        lineColor: COLOR_LINE,
        lineWidth: 0.25,
      },
      bodyStyles: {
        fontSize: 7.5,
        textColor: [0, 0, 0],
        cellPadding: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 },
        valign: 'middle',
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 9 },
        1: { halign: 'left', cellWidth: DESC_WIDTH, overflow: 'linebreak' },
        2: { halign: 'center', cellWidth: 20 },
        3: { halign: 'center', cellWidth: 26 },
        4: { halign: 'center', cellWidth: 10 },
        5: { halign: 'right', cellWidth: 22 },
        6: { halign: 'right', cellWidth: 26 },
        7: { halign: 'center', cellWidth: 11 },
        8: { halign: 'right', cellWidth: 28 },
        9: { halign: 'left', cellWidth: 30, overflow: 'linebreak' },
        10: { halign: 'center', cellWidth: 16 },
      },
      styles: { lineColor: COLOR_LINE, lineWidth: 0.25 },
      margin: { left: margin, right: margin, bottom: 16 },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const meta = rowMeta[data.row.index];
        if (meta && data.column.index === 1) {
          data.cell.styles.minCellHeight = meta.requiredHeight;
        }
      },
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 1) return;
        const meta = rowMeta[data.row.index];
        if (!meta) return; // banner / subtotal / total row — autoTable already drew it

        const cell = data.cell;

        doc.setFontSize(7.5);
        doc.setTextColor(0, 0, 0);

        const contentX = cell.x + 1.5;
        let textY = cell.y + 3.4;

        doc.setFont('helvetica', 'bold');
        meta.descriptionLines.slice(0, meta.nameLineCount).forEach((line) => {
          if (!line.trim()) return;
          doc.text(line, contentX, textY);
          textY += 3.4;
        });

        doc.setFont('helvetica', 'normal');
        meta.descriptionLines.slice(meta.nameLineCount).forEach((line) => {
          if (!line) return;
          doc.text(line, contentX, textY);
          textY += 3.4;
        });
      },
    });

    currentY = (doc as any).lastAutoTable.finalY + 8;

    // A discount breakdown only earns its space when something was discounted —
    // the in-table Total Amount row already covers the no-discount case.
    if (totalDiscount >= 0.005) {
      ensureSpace(30);
      const labelX = rightX - 70;
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');

      doc.text('Sub Total', labelX, currentY);
      doc.text(formatINR(subtotalPreTax + totalDiscount), rightX, currentY, { align: 'right' });
      currentY += 5;

      doc.text('Discount', labelX, currentY);
      doc.text(`- ${formatINR(totalDiscount)}`, rightX, currentY, { align: 'right' });
      currentY += 5;

      doc.text('Tax', labelX, currentY);
      doc.text(formatINR(totalTax), rightX, currentY, { align: 'right' });
      currentY += 6;

      doc.setLineWidth(0.4);
      doc.line(labelX, currentY, rightX, currentY);
      currentY += 5;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Grand Total', labelX, currentY);
      doc.text(formatINR(grandTotal), rightX, currentY, { align: 'right' });
      currentY += 10;
    }

    return { preTax: subtotalPreTax, discount: totalDiscount, tax: totalTax, grandTotal };
  };

  const optionGroups = groupByOption(quoteData.products, quoteData.options);
  const multiOption = optionGroups.length > 1;

  const rendered: Array<{ title: string; totals: OptionTotals }> = [];
  optionGroups.forEach((group, index) => {
    // Every option after the first starts on a clean page. That is the point of
    // the layout: one alternative per page, never two prices on the same sheet
    // where they can be misread as a running bill.
    if (index > 0) {
      doc.addPage();
      currentY = margin;
    }
    const title = multiOption ? `Option ${index + 1} - ${group.option}` : null;
    drawHeader(title);
    rendered.push({ title: title || '', totals: renderOptionTable(group.products) });
  });

  // -------------------------------------------------------- option summary ---

  // Side-by-side prices, so the reader isn't left flipping between pages to
  // compare — and so the "pick one, they don't add up" rule is stated in words
  // rather than left to be inferred from the layout.
  if (multiOption) {
    ensureSpace(30 + rendered.length * 6);

    doc.setDrawColor(...COLOR_LINE);
    doc.setLineWidth(0.4);
    doc.line(margin, currentY, rightX, currentY);
    currentY += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Option Summary', margin, currentY);
    currentY += 6;

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.text(
      'The options below are alternatives to one another. Only one is to be selected — the prices are not cumulative.',
      margin,
      currentY,
    );
    currentY += 7;

    const labelX = rightX - 100;
    rendered.forEach((entry) => {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(sanitizePdfText(entry.title), labelX, currentY);
      doc.text(formatINR(entry.totals.grandTotal), rightX, currentY, { align: 'right' });
      currentY += 5.5;
    });
    doc.setFont('helvetica', 'normal');
    currentY += 6;
  }

  // ----------------------------------------------------------------- terms ---

  const validityTerm = quoteData.validUntil
    ? `Quote valid until ${quoteData.validUntil}`
    : 'Quote valid for 15 days from the date of issue';

  const orderLine =
    selectedLogo === 'grove'
      ? '1. Order to be placed on: Grove Systems Pvt. Ltd., F-85, Okhla Industrial Area, Phase III, New Delhi - 110020.'
      : '1. Order to be placed on: GreenOCare Solutions Pvt. Ltd., F-85, 2nd Floor, Okhla Industrial Area, Phase III, New Delhi - 110020.';
  const bankLine =
    selectedLogo === 'grove'
      ? 'Bank Details - Kotak Mahindra Bank, Account No- 5949818822, IFSC Code- KKBK0004651'
      : 'Bank Details - Kotak Mahindra Bank, Account No- 6847253937, IFSC Code- KKBK0004651';

  const terms = [orderLine];
  if (quoteData.deliveryTerms) terms.push(`Delivery Terms - ${quoteData.deliveryTerms}`);
  if (quoteData.paymentTerms) terms.push(`Payment Terms - ${quoteData.paymentTerms}`);
  terms.push('Warranty as per OEM.');
  if (quoteData.extraTerms) terms.push(sanitizePdfText(quoteData.extraTerms));
  terms.push(bankLine);
  terms.push(validityTerm);

  ensureSpace(12 + terms.length * 5 + 30);

  doc.setDrawColor(...COLOR_LINE);
  doc.setLineWidth(0.4);
  doc.line(margin, currentY, rightX, currentY);
  currentY += 6;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Terms and Conditions', margin, currentY);
  currentY += 6;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');

  terms.forEach((term, index) => {
    // Number every line except the first, which already carries its own "1.".
    const text = /^\d+\./.test(term) ? term : `${index + 1}. ${term}`;
    const marker = text.match(/^(\d+\.\s*)/);
    const prefix = marker ? marker[1] : '';
    const rest = marker ? text.slice(prefix.length) : text;
    const indent = prefix ? doc.getTextWidth(prefix) : 0;

    // Hang wrapped lines under the text, not under the "N." marker.
    const lines = doc.splitTextToSize(rest, usableWidth - indent - 60);
    if (prefix) doc.text(prefix, margin, currentY);
    doc.text(lines, margin + indent, currentY);
    currentY += lines.length * 4.2 + 1.5;
  });

  // ------------------------------------------------------------- signature ---

  currentY += 6;
  ensureSpace(26);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`For ${companyName}`, rightX - 60, currentY);
  currentY += 18;
  doc.setFont('helvetica', 'normal');
  doc.text('Authorised Signatory', rightX - 60, currentY);

  // Footers last, in one pass, so pages added by hand for the terms and
  // signature blocks get one too — autoTable's didDrawPage only covers its own.
  const footerLeft = `${companyName}${quoteData.quoteNumber ? '  |  ' + quoteData.quoteNumber : ''}`;
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110, 110, 110);
    doc.text(footerLeft, margin, pageHeight - 6);
    doc.text(`Page ${page} of ${pageCount}`, rightX, pageHeight - 6, { align: 'right' });
  }
  doc.setTextColor(0, 0, 0);

  return Buffer.from(doc.output('arraybuffer'));
}
