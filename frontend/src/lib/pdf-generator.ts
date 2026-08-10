import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'fs';
import path from 'path';

export interface QuoteProduct {
  name: string;
  brand?: string;
  description?: string;
  price?: number;
  discount?: number;
  discountRs?: number | null;
  productCode?: string;
  tax?: string;
  hsnCode?: string;
  warranty?: number | null;
  quantity?: number;
  uom?: string;
}

export interface QuoteData {
  id: number;
  subject: string;
  date: string;
  validUntil?: string;
  version?: string;
  total: number;
  logo?: string;
  quoteNumber?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  extraTerms?: string;
  endUser?: string;
  endUserLocation?: string;
  account: {
    name: string;
    street?: string;
    city?: string;
    state?: string;
    pinCode?: string;
    country?: string;
  };
  products: QuoteProduct[];
}

function formatINR(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// jsPDF's standard fonts only speak WinAnsi. Product text copy-pasted from
// supplier datasheets often carries characters outside that set — a stray
// U+00A0/U+00FF, smart quotes, unicode dashes/spaces. Left alone they render as
// garbage (e.g. an "ÿ" between words) and, worse, an exotic non-space glued
// between two words makes an unbreakable mega-token that jsPDF can neither wrap
// nor space correctly, so the line spills past the cell border. Normalise the
// common offenders to their ASCII equivalents, keep the bullet we rely on, and
// turn anything else non-printable into a plain space so wrapping still works.
function sanitizePdfText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/[•‣◦⁃∙]/g, '•') // normalise bullets to •
    .replace(/[   -   　]/g, ' ') // unicode spaces
    .replace(/[​-‍﻿]/g, '') // zero-width characters
    .replace(/[^\n\x20-\x7E•]/g, ' ') // anything else non-WinAnsi -> space
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n') // drop trailing spaces on each line
    .replace(/^\s+|\s+$/g, ''); // strip leading/trailing blank lines & spaces
}

export function generatePdfBuffer(quoteData: QuoteData): Buffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const usableWidth = pageWidth - margin * 2;
  let currentY = margin;

  const selectedLogo = quoteData.logo || 'greenocare';
  const deliveryTerms: string = quoteData.deliveryTerms || '';
  const paymentTerms: string = quoteData.paymentTerms || '';
  const extraTerms: string = quoteData.extraTerms || '';

  // Validity term: show the actual "Valid Until" date chosen on the create-quote
  // form. Falls back to the historical "20 days" wording when the date is missing
  // or unparseable.
  const validUntilDate = (() => {
    if (!quoteData.validUntil) return null;
    const end = new Date(quoteData.validUntil);
    if (isNaN(end.getTime())) return null;
    const day = end.getDate();
    // 11th/12th/13th are special-cased; otherwise the last digit drives the suffix.
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
    return `${day}${suffix} ${month} ${end.getFullYear()}`;
  })();
  const validityTerm = validUntilDate
    ? `Quote valid till ${validUntilDate}`
    : 'Quote valid for 20 days';
  const companyName =
    selectedLogo === 'grove'
      ? 'Grove Systems Pvt. Ltd.'
      : 'GreenOCare Solutions Pvt. Ltd.';

  // Logo
  let logoRenderedHeight = 16;
  try {
    const logoFileName =
      selectedLogo === 'grove' ? 'grove_logo.png' : 'green-o-care-logo.png';
    const possiblePaths = [
      path.join(process.cwd(), logoFileName),
      path.join(process.cwd(), 'dist', 'client', logoFileName),
      path.join(process.cwd(), 'public', logoFileName),
    ];

    let logoPath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        logoPath = p;
        break;
      }
    }

    if (logoPath) {
      const logoBuffer = fs.readFileSync(logoPath);
      const logoData = logoBuffer.toString('base64');
      const logoExt = path.extname(logoFileName).toLowerCase();
      const imgFormat = logoExt === '.png' ? 'PNG' : 'JPEG';

      const LOGO_BOX_W = 100;
      const LOGO_BOX_H = 20;
      const LOGO_PADDING = 3;

      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(0.5);
      doc.rect(margin, currentY, LOGO_BOX_W, LOGO_BOX_H, 'S');

      const availableW = LOGO_BOX_W - LOGO_PADDING * 2;
      const availableH = LOGO_BOX_H - LOGO_PADDING * 2;

      let renderW, renderH;

      if (selectedLogo === 'grove') {
        let imgW = 250;
        let imgH = 89;
        if (logoExt === '.png' && logoBuffer.length > 24) {
          imgW = logoBuffer.readUInt32BE(16);
          imgH = logoBuffer.readUInt32BE(20);
        }
        const scaleW = availableW / imgW;
        const scaleH = availableH / imgH;
        const scale = Math.min(scaleW, scaleH);
        renderW = imgW * scale;
        renderH = imgH * scale;
      } else {
        renderW = availableW;
        const aspectRatio = 35 / 8;
        renderH = renderW / aspectRatio;
      }

      let offsetX, offsetY;
      if (selectedLogo === 'grove') {
        offsetX = margin + LOGO_PADDING - 4;
        offsetY = currentY + (LOGO_BOX_H - renderH) / 3;
      } else {
        offsetX = margin + LOGO_PADDING - 3;
        offsetY = currentY + (LOGO_BOX_H - renderH) - 2;
      }

      doc.addImage(logoData, imgFormat, offsetX, offsetY, renderW, renderH);
      logoRenderedHeight = LOGO_BOX_H;
    }
  } catch (error) {
    console.error('Logo error:', error);
  }

  currentY += logoRenderedHeight + 5;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(companyName, margin, currentY);
  currentY += 7;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  const addressLine1 =
    selectedLogo === 'greenocare'
      ? 'F-85, Second Floor, Okhla Industrial Estate, Phase-III'
      : 'F-85, Okhla Industrial Estate, Phase-III';
  doc.text(addressLine1, margin, currentY);
  currentY += 5;
  doc.text('New Delhi - 110020', margin, currentY);
  currentY += 5;
  const gstNumber = selectedLogo === 'grove' ? '07AAHCG5253F1ZO' : '07AAECG5147M1ZB';
  doc.text(`GST No- ${gstNumber}`, margin, currentY);
  currentY += 8;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 8;

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');

  doc.text('Customer Name', margin, currentY);

  const rightX = pageWidth - margin;
  doc.text('Quote', rightX, currentY, { align: 'right' });

  currentY += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(quoteData.account.name, margin, currentY);
  doc.text(`Version: ${quoteData.version || '1.0'}`, rightX, currentY, { align: 'right' });

  // The two columns advance independently from here. They previously shared one
  // cursor, so every line added on the right (Date, Quote No) pushed the
  // customer address further from the account name it belongs under.
  let leftY = currentY;
  let rightY = currentY;

  rightY += 5;
  doc.text(`Date: ${quoteData.date}`, rightX, rightY, { align: 'right' });

  if (quoteData.quoteNumber) {
    rightY += 5;
    doc.text(quoteData.quoteNumber, rightX, rightY, { align: 'right' });
  }

  // End user: a bold heading with its value beneath, then the location as an
  // unlabelled continuation. Set smaller than the rest of the column so it reads
  // as secondary detail. Nothing is drawn when the values are empty, so an
  // unfilled end user leaves no gap at all.
  if (quoteData.endUser || quoteData.endUserLocation) {
    doc.setFontSize(9);
    rightY += 2;
    // 68mm is the clear width to the right of the address column
    const drawRight = (text: string) => {
      doc.splitTextToSize(text, 68).forEach((wrapped: string) => {
        rightY += 4.5;
        doc.text(wrapped, rightX, rightY, { align: 'right' });
      });
    };

    if (quoteData.endUser) {
      doc.setFont('helvetica', 'bold');
      drawRight('End User Company');
      doc.setFont('helvetica', 'normal');
      drawRight(quoteData.endUser);
    }
    if (quoteData.endUserLocation) {
      drawRight(quoteData.endUserLocation);
    }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
  }

  // Address is set a notch smaller (9pt) than the account name it sits under.
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  const { street, city, state, pinCode, country } = quoteData.account;
  const maxAddressWidth = rightX - margin - 70; // keep clear of the Version/Date/Quote No column on the right
  const cityLine = [city, state, pinCode].filter(Boolean).join(', ');
  const addressLines = [street, cityLine, country].filter(Boolean) as string[];
  leftY += 5; // single step down from the account name to the first address line
  addressLines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, maxAddressWidth);
    doc.text(wrapped, margin, leftY);
    leftY += 4.5 * wrapped.length;
  });
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);

  currentY = Math.max(leftY, rightY) + 4;
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 10;

  let subtotalBeforeDiscount = 0;
  let totalTax = 0;
  let totalDiscount = 0;

  const nameLineCounts: number[] = [];
  const requiredCellHeights: number[] = [];

  const tableData = quoteData.products.map((product, index) => {
    const price = product.price || 0;
    const qty = product.quantity || 1;
    const discount = product.discount || 0;

    const itemSubtotal = price * qty;
    const discountAmount = product.discountRs != null ? product.discountRs : (itemSubtotal * discount) / 100;
    const afterDiscount = itemSubtotal - discountAmount;

    let taxRate = 0;
    if (product.tax && typeof product.tax === 'string') {
      const taxMatch = product.tax.match(/([0-9.]+)/);
      if (taxMatch) taxRate = parseFloat(taxMatch[1]) / 100;
    } else if (typeof product.tax === 'number') {
      taxRate = (product.tax as number) / 100;
    }

    const itemTax = afterDiscount * taxRate;
    const itemTotal = afterDiscount + itemTax;

    subtotalBeforeDiscount += itemSubtotal;
    totalDiscount += discountAmount;
    totalTax += itemTax;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const boldNameLines: string[] = doc.splitTextToSize(sanitizePdfText(product.name), 49);
    nameLineCounts.push(boldNameLines.length);
    doc.setFont('helvetica', 'normal');

    const allDisplayLines: string[] = [...boldNameLines];
    if (product.brand) {
      allDisplayLines.push(...doc.splitTextToSize(`Brand: ${sanitizePdfText(product.brand)}`, 49));
    }
    if (product.description) {
      const descParts = sanitizePdfText(product.description as string).split('\n');
      for (const part of descParts) {
        if (part.trim()) allDisplayLines.push(...doc.splitTextToSize(part, 49));
      }
    }

    requiredCellHeights.push(allDisplayLines.length * 4 + 3);

    const productDetails = allDisplayLines.join('\n');
    const warrantyDisplay = product.warranty != null ? product.warranty.toString() : '-';
    const taxLabel = product.tax || 'GST-18%';

    // Column order must match `head` and `columnStyles` below.
    return [
      (index + 1).toString(),
      productDetails,
      product.productCode || '-',
      `${qty}${product.uom ? ' ' + product.uom : ''}`,
      price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      taxLabel,
      itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      warrantyDisplay,
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: [['Sr. No', 'Product Details', 'Model No', 'Qty/UOM', 'Unit Price (Rs.)', 'Tax(%)', 'Total (Rs.)', 'Warranty (months)']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.3,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [0, 0, 0],
      cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
      minCellHeight: 12,
    },
    // Each column keeps the width and alignment it had before the reorder, so
    // the row still totals 180mm and nothing reflows.
    columnStyles: {
      0: { halign: 'center', cellWidth: 9 },  // Sr. No
      1: { halign: 'left',   cellWidth: 53, overflow: 'linebreak' }, // Product Details
      2: { halign: 'center', cellWidth: 18 }, // Model No
      3: { halign: 'center', cellWidth: 16 }, // Qty/UOM
      4: { halign: 'right',  cellWidth: 24 }, // Unit Price
      5: { halign: 'center', cellWidth: 14 }, // Tax
      6: { halign: 'right',  cellWidth: 28 }, // Total
      7: { halign: 'center', cellWidth: 18 }, // Warranty
    },
    styles: { lineColor: [0, 0, 0], lineWidth: 0.3 },
    margin: { left: margin, right: margin },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    didParseCell: (data) => {
      if (data.column.index === 1 && data.section === 'body') {
        const required = requiredCellHeights[data.row.index];
        if (required !== undefined) data.cell.styles.minCellHeight = required;
      }
    },
    didDrawCell: (data) => {
      if (data.column.index === 1 && data.section === 'body') {
        const cell = data.cell;
        const rawText = cell.raw as string;
        if (!rawText) return;

        const contentX = cell.x + 2;

        doc.setFillColor(255, 255, 255);
        doc.rect(cell.x + 0.5, cell.y + 0.5, cell.width - 1, cell.height - 1, 'F');

        doc.setFontSize(8);
        doc.setTextColor(0, 0, 0);

        const fontMm = doc.internal.getFontSize() / doc.internal.scaleFactor;
        let textY = cell.y + 2 + fontMm * (2 - 1.15);

        const lines = rawText.split('\n');
        const nameLineCount = nameLineCounts[data.row.index] ?? 1;

        doc.setFont('helvetica', 'bold');
        lines.slice(0, nameLineCount).forEach((line: string) => {
          if (!line.trim()) return; // a stray blank line must not push the name down
          doc.text(line, contentX, textY);
          textY += 4;
        });

        doc.setFont('helvetica', 'normal');
        lines.slice(nameLineCount).forEach((line: string) => {
          if (!line) return;
          doc.text(line, contentX, textY);
          textY += 4;
        });
      }
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 10;

  const grandTotal = subtotalBeforeDiscount - totalDiscount + totalTax;
  const summaryLabelX = pageWidth - margin - 95;
  const summaryValueX = pageWidth - margin;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  doc.text('Sub Total', summaryLabelX, currentY);
  doc.text(formatINR(subtotalBeforeDiscount), summaryValueX, currentY, { align: 'right' });
  currentY += 6;

  doc.text('Tax', summaryLabelX, currentY);
  doc.text(formatINR(totalTax), summaryValueX, currentY, { align: 'right' });
  currentY += 6;

  // Only show the discount line when something was actually discounted — a
  // "Rs. 0.00" row reads as a mistake. Threshold is half a paisa so values that
  // round away to nothing don't produce an empty-looking row either.
  if (totalDiscount >= 0.005) {
    doc.text('Discount', summaryLabelX, currentY);
    doc.text(formatINR(totalDiscount), summaryValueX, currentY, { align: 'right' });
    currentY += 6;
  }
  currentY += 2; // gap before the rule above Grand Total

  doc.setLineWidth(0.5);
  doc.line(summaryLabelX, currentY, summaryValueX, currentY);
  currentY += 6;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Grand Total', summaryLabelX, currentY);
  doc.text(formatINR(grandTotal), summaryValueX, currentY, { align: 'right' });
  currentY += 6;

  doc.setLineWidth(1);
  doc.line(summaryLabelX, currentY, summaryValueX, currentY);
  currentY += 15;

  if (currentY > 250) {
    doc.addPage();
    currentY = margin;
  }

  doc.setLineWidth(0.5);
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 8;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Terms and Conditions', margin, currentY);
  currentY += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const terms =
    selectedLogo === 'grove'
      ? [
          '1. Order to be placed on: Grove Systems Pvt. Ltd., F-85, Okhla Industrial Area, Phase III, New Delhi - 110020.',
          `2. Delivery Terms - ${deliveryTerms}`,
          `3. Payment Terms - ${paymentTerms}`,
          ...(extraTerms ? [`4. ${extraTerms}`, '5. Bank Details - Kotak Mahindra Bank, Account No- 5949818822, IFSC Code- KKBK0004651', `6. ${validityTerm}`] : ['4. Bank Details - Kotak Mahindra Bank, Account No- 5949818822, IFSC Code- KKBK0004651', `5. ${validityTerm}`]),
        ]
      : [
          '1. Order to be placed on: GreenOCare Solutions Pvt. Ltd., F-85, 2nd Floor, Okhla Industrial Area, Phase III, New Delhi - 110020.',
          `2. Delivery Terms - ${deliveryTerms}`,
          `3. Payment Terms - ${paymentTerms}`,
          ...(extraTerms ? [`4. ${extraTerms}`, '5. Bank Details - Kotak Mahindra Bank, Account No- 6847253937, IFSC Code- KKBK0004651', `6. ${validityTerm}`] : ['4. Bank Details - Kotak Mahindra Bank, Account No- 6847253937, IFSC Code- KKBK0004651', `5. ${validityTerm}`]),
        ];

  terms.forEach((term) => {
    // Hang the wrapped lines under the text, not under the "N." marker, so a
    // continuation (e.g. the address spilling onto a second line) lines up with
    // the first word rather than sitting beneath the number.
    const marker = term.match(/^(\d+\.\s+)/);
    const prefix = marker ? marker[1] : '';
    const body = marker ? term.slice(prefix.length) : term;
    const indent = prefix ? doc.getTextWidth(prefix) : 0;

    const lines = doc.splitTextToSize(body, usableWidth - indent);
    if (prefix) doc.text(prefix, margin, currentY);
    doc.text(lines, margin + indent, currentY);
    currentY += lines.length * 5 + 3;
  });

  return Buffer.from(doc.output('arraybuffer'));
}
