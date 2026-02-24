import type { APIRoute } from 'astro';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'fs';
import path from 'path';

export const prerender = false;

const API_BASE_URL = import.meta.env.PUBLIC_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:8080';

interface QuoteData {
  id: number;
  fields: {
    Subject?: string;
    'Quote Date'?: string;
    'Quote Version'?: string;
    'Total Amount'?: number;
    'Valid Until'?: string;
    'Quote Status'?: string;
    Notes?: string;
  };
}

interface AccountData {
  id: number;
  fields: {
    'Account Name'?: string;
    'Billing Street'?: string;
    'Billing City'?: string;
    'Billing State'?: string;
    'Billing Code'?: string;
    'Billing Country'?: string;
    Phone?: string;
  };
}

interface ProductData {
  id: number;
  fields: {
    'Product Name'?: string;
    'Unit Price'?: number;
    'Product Code'?: string;
    Brand?: string;
    HSN?: string;
  };
}

async function fetchQuote(quoteId: string, token: string): Promise<QuoteData | null> {
  const response = await fetch(`${API_BASE_URL}/proxy/quotes/records/${quoteId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) return null;
  return await response.json();
}

async function fetchLinkedAccount(quoteId: string, token: string): Promise<AccountData | null> {
  const response = await fetch(`${API_BASE_URL}/proxy/quotes/links/accounts_copy/${quoteId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.list?.[0] || data[0] || null;
}

async function fetchLinkedProducts(quoteId: string, token: string): Promise<ProductData[]> {
  const response = await fetch(`${API_BASE_URL}/proxy/quotes/links/products/${quoteId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) return [];
  const data = await response.json();
  return data.list || data || [];
}

function formatINR(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Detects the real image format from magic bytes (ignores file extension).
 * Returns 'JPEG' or 'PNG'.
 */
function detectImageFormat(buf: Buffer): 'JPEG' | 'PNG' {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'JPEG';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'PNG';
  return 'JPEG'; // safe fallback
}

/**
 * Returns { width, height } in pixels.
 * Works regardless of file extension by detecting format first.
 */
function getImageDimensions(buf: Buffer): { width: number; height: number } {
  const fmt = detectImageFormat(buf);

  if (fmt === 'PNG') {
    // PNG: width @ bytes 16-19, height @ bytes 20-23
    if (buf.length > 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  }

  if (fmt === 'JPEG') {
    // Scan JPEG markers for SOF0/SOF1/SOF2
    let i = 2;
    while (i + 8 < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7)
      ) {
        return {
          width: buf.readUInt16BE(i + 7),
          height: buf.readUInt16BE(i + 5),
        };
      }
      const segLen = buf.readUInt16BE(i + 2);
      i += 2 + segLen;
    }
  }

  return { width: 250, height: 89 }; // fallback (Green O Care actual size)
}

export const GET: APIRoute = async ({ params, request }) => {
  const quoteId = params.id;
  if (!quoteId) return new Response('Quote ID required', { status: 400 });

  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '') || '';
  if (!token) return new Response('Unauthorized', { status: 401 });

  try {
    const [quote, account, products] = await Promise.all([
      fetchQuote(quoteId, token),
      fetchLinkedAccount(quoteId, token),
      fetchLinkedProducts(quoteId, token)
    ]);

    if (!quote) return new Response('Quote not found', { status: 404 });

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
    const margin = 15;
    const usableWidth = pageWidth - margin * 2; // 180mm
    let currentY = margin;

    // ── LOGO ─────────────────────────────────────────────────────────────────
    const TARGET_LOGO_W = 65; // mm

    try {
      const logoFileName = 'green-o-care-logo.png';
      const possiblePaths = [
        path.join(process.cwd(), logoFileName),
        path.join(process.cwd(), 'dist', 'client', logoFileName),
        path.join(process.cwd(), 'public', logoFileName),
      ];

      let logoPath: string | null = null;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) { logoPath = p; break; }
      }

      if (logoPath) {
        const logoBuffer = fs.readFileSync(logoPath);
        const logoExt = path.extname(logoFileName).toLowerCase();
        const imgFormat = logoExt === '.png' ? 'PNG' : 'JPEG';

        // Fixed logo box dimensions
        const LOGO_BOX_W = 100;
        const LOGO_BOX_H = 20;

        // Get image dimensions from PNG header
        let imgW = 100; // fallback
        let imgH = 100; // fallback
        
        if (logoExt === '.png' && logoBuffer.length > 24) {
          imgW = logoBuffer.readUInt32BE(16);
          imgH = logoBuffer.readUInt32BE(20);
        }

        // Calculate scale to fit inside box
        const scale = Math.min(LOGO_BOX_W / imgW, LOGO_BOX_H / imgH);

        const renderW = imgW * scale;
        const renderH = imgH * scale;

        // Center inside box
        const offsetX = margin + (LOGO_BOX_W - renderW) / 2;
        const offsetY = currentY + (LOGO_BOX_H - renderH) / 2;

        // Draw black border around logo box
        doc.setDrawColor(0, 0, 0); // Black color
        doc.setLineWidth(0.5);
        doc.rect(margin, currentY, LOGO_BOX_W, LOGO_BOX_H, 'S'); // 'S' for stroke (border only)

        doc.addImage(
          logoBuffer.toString('base64'),
          imgFormat,
          offsetX,
          offsetY,
          renderW,
          renderH
        );

        // Move cursor by fixed box height
        currentY += LOGO_BOX_H + 6;
      } else {
        currentY += 26;
      }
    } catch (error) {
      console.error('[PDF API] Logo error:', error);
      currentY += 24;
    }

    // ── COMPANY NAME & ADDRESS ────────────────────────────────────────────────
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('GreenOCare Solutions Pvt. Ltd.', margin, currentY);
    currentY += 7;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text('F-85, Okhla Industrial Estate, Phase-III', margin, currentY);
    currentY += 5;
    doc.text('New Delhi - 110020', margin, currentY);
    currentY += 8;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 8;

    // ── CUSTOMER / QUOTE INFO ─────────────────────────────────────────────────
    doc.setTextColor(0, 0, 0);
    const rightX = pageWidth - margin;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Customer Name', margin, currentY);
    doc.text('Quote', rightX, currentY, { align: 'right' });
    currentY += 6;

    doc.setFont('helvetica', 'normal');
    doc.text(account?.fields['Account Name'] || 'N/A', margin, currentY);
    doc.text(`Version: ${quote.fields['Quote Version'] || '1.0'}`, rightX, currentY, { align: 'right' });
    currentY += 5;
    doc.text(`Date: ${quote.fields['Quote Date'] || 'N/A'}`, rightX, currentY, { align: 'right' });
    currentY += 8;

    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 10;

    // ── ITEMS TABLE ───────────────────────────────────────────────────────────
    let subtotal = 0;
    let totalTax = 0;

    const tableData = products.map((product, index) => {
      const unitPrice = product.fields['Unit Price'] || 0;
      const qty = 1;
      const itemTotal = unitPrice * qty;
      const tax = itemTotal * 0.18;
      const totalWithTax = itemTotal + tax;

      subtotal += itemTotal;
      totalTax += tax;

      let productDetails = product.fields['Product Name'] || 'Unnamed Product';
      if (product.fields['Brand']) productDetails += `\n${product.fields['Brand']}`;
      if (product.fields['HSN']) productDetails += `\nHSN: ${product.fields['HSN']}`;

      return [
        (index + 1).toString(),
        productDetails,
        product.fields['Product Code'] || '-',
        '12',
        formatINR(unitPrice),
        qty.toString(),
        formatINR(tax),
        formatINR(totalWithTax),
      ];
    });

    // Column widths: 10+48+24+20+28+10+22+18 = 180mm
    autoTable(doc, {
      startY: currentY,
      head: [['S.No.', 'Product Details', 'Product Code', 'Warranty (months)', 'Unit Price', 'Qty', 'Tax', 'Total']],
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
        0: { halign: 'center', cellWidth: 10 },
        1: { halign: 'left',   cellWidth: 48 },
        2: { halign: 'center', cellWidth: 24 },
        3: { halign: 'center', cellWidth: 20 },
        4: { halign: 'right',  cellWidth: 28 },
        5: { halign: 'center', cellWidth: 10 },
        6: { halign: 'right',  cellWidth: 22 },
        7: { halign: 'right',  cellWidth: 18 },
      },
      margin: { left: margin, right: margin },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
    });

    currentY = (doc as any).lastAutoTable.finalY + 10;

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    const grandTotal = subtotal + totalTax;
    const summaryLabelX = pageWidth - margin - 95;
    const summaryValueX = pageWidth - margin;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    doc.text('Sub Total', summaryLabelX, currentY);
    doc.text(formatINR(subtotal), summaryValueX, currentY, { align: 'right' });
    currentY += 6;

    doc.text('Tax', summaryLabelX, currentY);
    doc.text(formatINR(totalTax), summaryValueX, currentY, { align: 'right' });
    currentY += 6;

    doc.text('Adjustment', summaryLabelX, currentY);
    doc.text('Rs. 0.00', summaryValueX, currentY, { align: 'right' });
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

    // ── TERMS & CONDITIONS ────────────────────────────────────────────────────
    if (currentY > 250) { doc.addPage(); currentY = margin; }

    doc.setLineWidth(0.5);
    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 8;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Terms and Conditions', margin, currentY);
    currentY += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    const terms = [
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

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="quote-${quoteId}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('[PDF Generation Error]', error);
    return new Response('Failed to generate PDF', { status: 500 });
  }
};