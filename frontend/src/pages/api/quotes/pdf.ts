import type { APIRoute } from 'astro';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export const prerender = false;

interface QuoteProduct {
  name: string;
  brand?: string;
  price?: number;
  productCode?: string;
  tax?: string;
  hsnCode?: string;
  warranty?: number;
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const quoteData: QuoteData = await request.json();

    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 50,
      bufferPages: true
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    
    const pdfPromise = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // === HEADER SECTION ===
    
    // Determine selected logo and company details
    const selectedLogo = quoteData.logo || 'greenocare';
    const companyName = selectedLogo === 'grove' ? 'Grove Systems Pvt. Ltd.' : 'GreenOCare Solutions Pvt. Ltd.';
    
    // Logo
    try {
      const logoFileName = selectedLogo === 'grove' ? 'grove_logo.png' : 'green-o-care-logo.png';
      
      // Try multiple paths
      const possiblePaths = [
        path.join(process.cwd(), logoFileName),
        path.join(process.cwd(), 'dist', 'client', logoFileName),
        path.join(process.cwd(), 'public', logoFileName)
      ];
      
      let logoPath = null;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          logoPath = p;
          break;
        }
      }
      
      if (logoPath) {
        doc.image(logoPath, 50, 35, { width: 130 });
      } else {
        console.error('Logo not found in any of these paths:', possiblePaths);
      }
    } catch (error) {
      console.error('Logo error:', error);
    }
    
    // Company Name
    doc.fontSize(20)
       .font('Helvetica-Bold')
       .fillColor('#000000')
       .text(companyName, 50, 120);
    
    // Company Address
    doc.fontSize(10)
       .font('Helvetica')
       .fillColor('#505050')
       .text('F-85, Okhla Industrial Estate, Phase-III', 50, 147)
       .text('New Delhi - 110020', 50, 161);
    
    // Header bottom border
    doc.strokeColor('#000000')
       .lineWidth(2)
       .moveTo(50, 180)
       .lineTo(545, 180)
       .stroke();
    
    // === INFO SECTION ===
    
    const infoY = 200;
    
    // Customer Name (left)
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .fillColor('#000000')
       .text('Customer Name', 50, infoY);
    
    doc.fontSize(11)
       .font('Helvetica')
       .text(quoteData.account.name, 50, infoY + 18);
    
    // Quote Info (right)
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('Quote', 495, infoY, { align: 'right', width: 50 });
    
    doc.fontSize(11)
       .font('Helvetica')
       .text(`Version: ${quoteData.version || '1.0'}`, 400, infoY + 18, { align: 'right', width: 145 })
       .text(`Date: ${quoteData.date}`, 400, infoY + 33, { align: 'right', width: 145 });
    
    // Info section bottom border
    doc.strokeColor('#000000')
       .lineWidth(2)
       .moveTo(50, infoY + 55)
       .lineTo(545, infoY + 55)
       .stroke();
    
    // === ITEMS TABLE ===
    
    const tableTop = infoY + 80;
    const pageWidth = 545 - 50; // 495px
    
    // Column widths - balanced to fit all headers properly
    const colWidths = {
      sno: pageWidth * 0.05,        // 5%
      product: pageWidth * 0.21,     // 21%
      model: pageWidth * 0.12,       // 12% - wider for "Model/Part Code"
      warranty: pageWidth * 0.11,    // 11% - fits "Warranty (yrs)"
      unitPrice: pageWidth * 0.15,   // 15%
      qty: pageWidth * 0.06,         // 6%
      tax: pageWidth * 0.13,         // 13%
      total: pageWidth * 0.17        // 17%
    };
    
    // Column X positions
    const cols = {
      sno: 50,
      product: 50 + colWidths.sno,
      model: 50 + colWidths.sno + colWidths.product,
      warranty: 50 + colWidths.sno + colWidths.product + colWidths.model,
      unitPrice: 50 + colWidths.sno + colWidths.product + colWidths.model + colWidths.warranty,
      qty: 50 + colWidths.sno + colWidths.product + colWidths.model + colWidths.warranty + colWidths.unitPrice,
      tax: 50 + colWidths.sno + colWidths.product + colWidths.model + colWidths.warranty + colWidths.unitPrice + colWidths.qty,
      total: 50 + colWidths.sno + colWidths.product + colWidths.model + colWidths.warranty + colWidths.unitPrice + colWidths.qty + colWidths.tax,
      end: 545
    };
    
    const headerHeight = 38; // Back to normal height for single-line headers
    
    // Table header background
    doc.rect(50, tableTop, pageWidth, headerHeight)
       .fillAndStroke('#f0f0f0', '#000000');
    
    // Header text - all on one line, same alignment
    doc.fontSize(9)
       .fillColor('#000000')
       .font('Helvetica-Bold');
    
    const headerTextY = tableTop + 14;
    doc.text('S.No.', cols.sno + 4, headerTextY, { width: colWidths.sno - 8, align: 'center' });
    doc.text('Product Details', cols.product + 4, headerTextY, { width: colWidths.product - 8, align: 'left' });
    doc.text('Product Code', cols.model + 4, headerTextY, { width: colWidths.model - 8, align: 'center' });
    doc.text('Warranty (yrs)', cols.warranty + 4, headerTextY, { width: colWidths.warranty - 8, align: 'center' });
    doc.text('Unit Price', cols.unitPrice + 4, headerTextY, { width: colWidths.unitPrice - 8, align: 'center' });
    doc.text('Qty', cols.qty + 4, headerTextY, { width: colWidths.qty - 8, align: 'center' });
    doc.text('Tax', cols.tax + 4, headerTextY, { width: colWidths.tax - 8, align: 'center' });
    doc.text('Total', cols.total + 4, headerTextY, { width: colWidths.total - 8, align: 'center' });
    
    // Draw header vertical lines
    Object.values(cols).forEach(x => {
      doc.strokeColor('#000000').lineWidth(1);
      doc.moveTo(x, tableTop).lineTo(x, tableTop + headerHeight).stroke();
    });
    
    // Table rows
    let currentY = tableTop + headerHeight;
    let subtotal = 0;
    let totalTax = 0;
    
    quoteData.products.forEach((product, index) => {
      const price = product.price || 0;
      const qty = 1;
      const itemSubtotal = price * qty;
      
      // Extract tax rate
      let taxRate = 0.18;
      if (product.tax) {
        const taxMatch = product.tax.match(/([0-9.]+)\s*%/);
        if (taxMatch) {
          taxRate = parseFloat(taxMatch[1]) / 100;
        }
      }
      
      const itemTax = itemSubtotal * taxRate;
      const itemTotal = itemSubtotal + itemTax;
      
      subtotal += itemSubtotal;
      totalTax += itemTax;
      
      const rowHeight = 50; // Increased slightly for better spacing
      
      // Draw row background
      doc.rect(50, currentY, pageWidth, rowHeight)
         .fillAndStroke('#ffffff', '#000000');
      
      const cellPadding = 10;
      const textY = currentY + cellPadding;
      
      // S.No
      doc.fontSize(9)
         .fillColor('#000000')
         .font('Helvetica');
      doc.text((index + 1).toString(), cols.sno + 4, textY + 8, { width: colWidths.sno - 8, align: 'center' });
      
      // Product Details
      doc.fontSize(10)
         .font('Helvetica-Bold');
      let productY = textY;
      doc.text(product.name, cols.product + 4, productY, { width: colWidths.product - 8 });
      productY += doc.heightOfString(product.name, { width: colWidths.product - 8 }) + 1;
      
      // Brand (if exists)
      if (product.brand) {
        doc.fontSize(9)
           .font('Helvetica');
        doc.text(product.brand, cols.product + 4, productY, { width: colWidths.product - 8 });
        productY += doc.heightOfString(product.brand, { width: colWidths.product - 8 }) + 1;
      }
      
      // HSN Code
      doc.fontSize(9)
         .fillColor('#646464');
      const hsnText = product.hsnCode ? product.hsnCode : 'N/A';
      doc.text(hsnText, cols.product + 4, productY, { width: colWidths.product - 8 });
      
      // Product Code - centered
      doc.fontSize(9)
         .fillColor('#000000')
         .font('Helvetica');
      const productCodeText = product.productCode || '-';
      doc.text(productCodeText, cols.model + 4, textY + 8, { width: colWidths.model - 8, align: 'center' });
      
      // Warranty - centered (all numbers at same Y position)
      doc.fontSize(10)
         .fillColor('#000000')
         .font('Helvetica');
      doc.text((product.warranty || 1).toString(), cols.warranty + 4, textY + 8, { width: colWidths.warranty - 8, align: 'center' });
      
      // Unit Price - right aligned (same Y as other numbers)
      doc.fontSize(10)
         .fillColor('#000000')
         .font('Helvetica');
      const priceText = `Rs. ${price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      doc.text(priceText, cols.unitPrice + 4, textY + 8, { width: colWidths.unitPrice - 8, align: 'right' });
      
      // Qty - centered (same Y as other numbers)
      doc.fontSize(10).fillColor('#000000').font('Helvetica');
      doc.text(qty.toString(), cols.qty + 4, textY + 8, { width: colWidths.qty - 8, align: 'center' });
      
      // Tax (amount and rate) - ALIGNED with Unit Price and Total
      doc.fontSize(10).fillColor('#000000').font('Helvetica');
      const taxAmountText = `Rs. ${itemTax.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      doc.text(taxAmountText, cols.tax + 4, textY + 8, { width: colWidths.tax - 8, align: 'right' });
      
      doc.fontSize(8).fillColor('#505050');
      let taxRateText = product.tax || 'GST-18.0%';
      // Ensure tax rate has % symbol
      if (taxRateText && !taxRateText.includes('%')) {
        taxRateText = `${taxRateText}%`;
      }
      doc.text(taxRateText, cols.tax + 4, textY + 22, { width: colWidths.tax - 8, align: 'right' });
      
      // Total - aligned with Warranty, Unit Price, Qty
      doc.fontSize(10).fillColor('#000000').font('Helvetica');
      const totalText = `Rs. ${itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      doc.text(totalText, cols.total + 4, textY + 8, { width: colWidths.total - 8, align: 'right' });
      
      // Draw row vertical lines
      Object.values(cols).forEach(x => {
        doc.strokeColor('#000000').lineWidth(1);
        doc.moveTo(x, currentY).lineTo(x, currentY + rowHeight).stroke();
      });
      
      currentY += rowHeight;
    });
    
    // === SUMMARY SECTION ===
    
    const summaryX = 280;
    const summaryLabelX = summaryX;
    const summaryLabelWidth = 130;
    
    let summaryY = currentY + 20;
    const grandTotal = subtotal + totalTax;
    
    doc.fontSize(10)
       .fillColor('#000000')
       .font('Helvetica');
    
    // Helper function to right-align text at page edge
    const rightAlignText = (text: string, x: number, y: number, fontSize: number) => {
      doc.fontSize(fontSize).font('Helvetica');
      const textWidth = doc.widthOfString(text);
      doc.text(text, x - textWidth, y, { lineBreak: false });
    };
    
    // Sub Total
    doc.text('Sub Total', summaryLabelX, summaryY, { width: summaryLabelWidth, align: 'left' });
    const subTotalText = `Rs. ${subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    rightAlignText(subTotalText, 545, summaryY, 10);
    summaryY += 20;
    
    // Tax
    doc.text('Tax', summaryLabelX, summaryY, { width: summaryLabelWidth, align: 'left' });
    const taxText = `Rs. ${totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    rightAlignText(taxText, 545, summaryY, 10);
    summaryY += 20;
    
    // Adjustment
    doc.text('Adjustment', summaryLabelX, summaryY, { width: summaryLabelWidth, align: 'left' });
    rightAlignText('Rs. 0.00', 545, summaryY, 10);
    summaryY += 25;
    
    // Grand Total border
    doc.strokeColor('#000000')
       .lineWidth(1)
       .moveTo(summaryX, summaryY)
       .lineTo(545, summaryY)
       .stroke();
    
    summaryY += 12;
    
    // Grand Total
    const grandTotalY = summaryY;
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('Grand Total', summaryLabelX, grandTotalY, { lineBreak: false });
    
    const grandTotalAmount = `Rs. ${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const amountWidth = doc.widthOfString(grandTotalAmount);
    const amountX = 545 - amountWidth;
    doc.text(grandTotalAmount, amountX, grandTotalY, { lineBreak: false });
    
    summaryY += 22;
    
    // Bottom border
    doc.strokeColor('#000000')
       .lineWidth(3)
       .moveTo(summaryX, summaryY)
       .lineTo(545, summaryY)
       .stroke();
    
    // === TERMS & CONDITIONS ===
    
    summaryY += 30;
    
    // Check if we have enough space left on the current page
    // A4 page height is ~841 points, bottom margin 50 → safe limit around 750
    if (summaryY > 750) {
      doc.addPage();
      summaryY = 50;
    }
    
    // Top border
    doc.strokeColor('#000000')
       .lineWidth(2)
       .moveTo(50, summaryY)
       .lineTo(545, summaryY)
       .stroke();
    
    summaryY += 15;
    
    // Title
    doc.fontSize(13)
       .font('Helvetica-Bold')
       .fillColor('#000000')
       .text('Terms and Conditions', 50, summaryY);
    
    summaryY += 22;
    
    // Terms list
    doc.fontSize(10)
       .font('Helvetica')
       .fillColor('#000000');
    
    // Select terms based on logo (use selectedLogo from header section)
    const terms = selectedLogo === 'grove' 
      ? [
          '1. Order to be placed on: Grove Systems Pvt. Ltd., F-85, 2nd Floor, Okhla Industrial Area, Phase III, New Delhi - 110020.',
          '2. Delivery Terms –',
          '3. Payment Terms –',
          '4. Bank Details – Kotak Mahindra Bank, Account No- 5949818822, IFSC Code- KKBK0004651',
          '5. GST No- 07AAHCG5253F1ZO'
        ]
      : [
          '1. Order to be placed on: GreenOCare Solutions Pvt. Ltd., F-85, 2nd Floor, Okhla Industrial Area, Phase III, New Delhi - 110020.',
          '2. Delivery Terms –',
          '3. Payment Terms –',
          '4. Bank Details – Kotak Mahindra Bank, Account No- 6847253937, IFSC Code- KKBK0004651',
          '5. GST No- 07AAECG5147M1ZB'
        ];
    
    terms.forEach((term, index) => {
      // Check if we need a page break for very long content
      if (summaryY > 780) {
        doc.addPage();
        summaryY = 50;
      }
      
      const termHeight = doc.heightOfString(term, { width: 495, lineGap: 2 });
      doc.text(term, 50, summaryY, { width: 495, lineGap: 2, continued: false });
      summaryY += termHeight + 8;
    });

    doc.end();

    const pdfBuffer = await pdfPromise;

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="quote-${quoteData.id}.pdf"`,
        'Content-Length': pdfBuffer.length.toString()
      }
    });

  } catch (error) {
    console.error('[PDF Generation Error]', error);
    return new Response(JSON.stringify({ error: 'Failed to generate PDF' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};