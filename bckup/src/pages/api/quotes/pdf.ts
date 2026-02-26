import type { APIRoute } from 'astro';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'fs';
import path from 'path';

export const prerender = false;

interface QuoteProduct {
  name: string;
  brand?: string;
  price?: number;
  discount?: number;
  productCode?: string;
  tax?: string;
  hsnCode?: string;
  warranty?: number;
  quantity?: number;
}

interface QuoteData {
  id: number;
  subject: string;
  date: string;
  version?: string;
  total: number;
  account: {
    name: string;
  };
  products: QuoteProduct[];
  logo?: string;
}

// Helper: format Indian currency WITHOUT the ₹ symbol (jsPDF Helvetica can't render it)
function formatINR(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const quoteData: QuoteData = await request.json();

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
    const margin = 15;
    const usableWidth = pageWidth - margin * 2; // 180mm
    let currentY = margin;

    // ── HEADER ──────────────────────────────────────────────────────────────
    const selectedLogo = quoteData.logo || 'greenocare';
    const companyName =
      selectedLogo === 'grove'
        ? 'Grove Systems Pvt. Ltd.'
        : 'GreenOCare Solutions Pvt. Ltd.';

    // Logo
    let logoRenderedHeight = 16; // default fallback spacing
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

        // Logo box dimensions
        const LOGO_BOX_W = 100;
        const LOGO_BOX_H = 20;
        const LOGO_PADDING = 3; // mm padding inside the box

        // Draw black border around logo box
        doc.setDrawColor(255, 255, 255); // Black color
        doc.setLineWidth(0.5);
        doc.rect(margin, currentY, LOGO_BOX_W, LOGO_BOX_H, 'S'); // 'S' for stroke (border only)

        // Calculate available space inside box (with padding)
        const availableW = LOGO_BOX_W - (LOGO_PADDING * 2);
        const availableH = LOGO_BOX_H - (LOGO_PADDING * 2);

        let renderW, renderH;

        if (selectedLogo === 'grove') {
          // Grove logo: read actual dimensions and scale to fit
          let imgW = 250; // fallback
          let imgH = 89; // fallback
          if (logoExt === '.png' && logoBuffer.length > 24) {
            imgW = logoBuffer.readUInt32BE(16);
            imgH = logoBuffer.readUInt32BE(20);
          }

          // Scale to fit inside box while maintaining aspect ratio
          const scaleW = availableW / imgW;
          const scaleH = availableH / imgH;
          const scale = Math.min(scaleW, scaleH);

          renderW = imgW * scale;
          renderH = imgH * scale;
        } else {
          // GreenOCare logo: use full width with fixed aspect ratio
          renderW = availableW;
          const aspectRatio = 100 / 70; // Fixed aspect ratio
          renderH = renderW / aspectRatio;
        }

        // Left align with padding, vertically center
        let offsetX, offsetY;
        if (selectedLogo === 'grove') {
          offsetX = margin + LOGO_PADDING - 4;
          offsetY = currentY + (LOGO_BOX_H - renderH) / 3;
        } else {
          // GreenOCare
          offsetX = margin + LOGO_PADDING - 8;
          offsetY = currentY + (LOGO_BOX_H - renderH) / 3;
        }

        doc.addImage(logoData, imgFormat, offsetX, offsetY, renderW, renderH);
        logoRenderedHeight = LOGO_BOX_H;
      }
    } catch (error) {
      console.error('Logo error:', error);
    }

    // Advance past the logo with a small gap
    currentY += logoRenderedHeight + 5;

    // Company name
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(companyName, margin, currentY);
    currentY += 7;

    // Address
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text('F-85, Okhla Industrial Estate, Phase-III', margin, currentY);
    currentY += 5;
    doc.text('New Delhi - 110020', margin, currentY);
    currentY += 8;

    // Divider
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 8;

    // ── INFO SECTION ────────────────────────────────────────────────────────
    doc.setTextColor(0, 0, 0);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Customer Name', margin, currentY);

    const rightX = pageWidth - margin;
    doc.text('Quote', rightX, currentY, { align: 'right' });

    currentY += 6;
    doc.setFont('helvetica', 'normal');
    doc.text(quoteData.account.name, margin, currentY);
    doc.text(`Version: ${quoteData.version || '1.0'}`, rightX, currentY, {
      align: 'right',
    });
    currentY += 5;
    doc.text(`Date: ${quoteData.date}`, rightX, currentY, { align: 'right' });
    currentY += 8;

    // Divider
    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 10;

    // ── ITEMS TABLE ─────────────────────────────────────────────────────────
    let subtotalBeforeDiscount = 0;
    let totalTax = 0;
    let totalDiscount = 0;

    const tableData = quoteData.products.map((product, index) => {
      const price = product.price || 0;
      const qty = product.quantity || 1;
      const discount = product.discount || 0;

      const itemSubtotal = price * qty;
      const discountAmount = (itemSubtotal * discount) / 100;
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

      let productDetails = product.name;
      if (product.brand) productDetails += `\n${product.brand}`;
      if (product.hsnCode) productDetails += `\nHSN: ${product.hsnCode}`;

      const warrantyMonths = (product.warranty || 1) * 12;
      const taxLabel = product.tax || 'GST-18%';

      return [
        (index + 1).toString(),
        productDetails,
        product.productCode || '-',
        warrantyMonths.toString(),
        formatINR(price),
        qty.toString(),
        `${formatINR(discountAmount)}\n${discount}%`,
        `${formatINR(itemTax)}\n${taxLabel}`,
        formatINR(itemTotal),
      ];
    });

    // Column widths sum to 180mm (usableWidth)
    // S.No(9) + Details(40) + Code(19) + Warranty(22) + UnitPrice(24) + Qty(8) + Discount(20) + Tax(20) + Total(18) = 180
    autoTable(doc, {
      startY: currentY,
      head: [
        [
          'S.No.',
          'Product Details',
          'Product Code',
          'Warranty (months)',
          'Unit Price',
          'Qty',
          'Discount',
          'Tax',
          'Total',
        ],
      ],
      body: tableData,
      theme: 'grid',
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
        valign: 'middle',
      },
      bodyStyles: {
        fontSize: 8,
        cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
        minCellHeight: 12,
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 9 },
        1: { halign: 'left',   cellWidth: 40 },
        2: { halign: 'center', cellWidth: 19 },
        3: { halign: 'center', cellWidth: 22 },
        4: { halign: 'right',  cellWidth: 24 },
        5: { halign: 'center', cellWidth: 8 },
        6: { halign: 'right',  cellWidth: 20 },
        7: { halign: 'right',  cellWidth: 20 },
        8: { halign: 'right',  cellWidth: 18 },
      },
      margin: { left: margin, right: margin },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
    });

    currentY = (doc as any).lastAutoTable.finalY + 10;

    // ── SUMMARY ─────────────────────────────────────────────────────────────
    const grandTotal = subtotalBeforeDiscount - totalDiscount + totalTax;

    const summaryLabelX = pageWidth - margin - 95;
    const summaryValueX = pageWidth - margin;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    doc.text('Sub Total', summaryLabelX, currentY);
    doc.text(formatINR(subtotalBeforeDiscount), summaryValueX, currentY, { align: 'right' });
    currentY += 6;

    doc.text('Tax', summaryLabelX, currentY);
    doc.text(formatINR(totalTax), summaryValueX, currentY, { align: 'right' });
    currentY += 6;

    doc.text('Discount', summaryLabelX, currentY);
    doc.text(formatINR(totalDiscount), summaryValueX, currentY, { align: 'right' });
    currentY += 8;

    doc.setLineWidth(0.5);
    doc.line(summaryLabelX, currentY, summaryValueX, currentY);
    currentY += 6;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Grand Total', summaryLabelX, currentY);
    doc.text(formatINR(grandTotal), summaryValueX, currentY, { align: 'right' });
    currentY += 6;

    doc.setLineWidth(1);
    doc.line(summaryLabelX, currentY, summaryValueX, currentY);
    currentY += 15;

    // ── TERMS & CONDITIONS ───────────────────────────────────────────────────
    if (currentY > 250) {
      doc.addPage();
      currentY = margin;
    }

    doc.setLineWidth(0.5);
    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 8;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Terms and Conditions', margin, currentY);
    currentY += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    const terms =
      selectedLogo === 'grove'
        ? [
            '1. Order to be placed on: Grove Systems Pvt. Ltd., F-85, 2nd Floor, Okhla Industrial Area, Phase III, New Delhi - 110020.',
            '2. Delivery Terms -',
            '3. Payment Terms -',
            '4. Bank Details - Kotak Mahindra Bank, Account No- 5949818822, IFSC Code- KKBK0004651',
            '5. GST No- 07AAHCG5253F1ZO',
          ]
        : [
            '1. Order to be placed on: GreenOCare Solutions Pvt. Ltd., F-85, 2nd Floor, Okhla Industrial Area, Phase III, New Delhi - 110020.',
            '2. Delivery Terms -',
            '3. Payment Terms -',
            '4. Bank Details - Kotak Mahindra Bank, Account No- 6847253937, IFSC Code- KKBK0004651',
            '5. GST No- 07AAECG5147M1ZB',
          ];

    terms.forEach((term) => {
      const lines = doc.splitTextToSize(term, usableWidth);
      doc.text(lines, margin, currentY);
      currentY += lines.length * 5 + 3;
    });

    // ── OUTPUT ───────────────────────────────────────────────────────────────
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="quote-${quoteData.id}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('[PDF Generation Error]', error);
    return new Response(JSON.stringify({ error: 'Failed to generate PDF' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};