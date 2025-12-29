import type { APIRoute } from 'astro';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export const prerender = false;

const API_BASE_URL = 'http://localhost:8080';

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

// Fetch quote details from proxy
async function fetchQuote(quoteId: string, token: string): Promise<QuoteData | null> {
  const response = await fetch(`${API_BASE_URL}/proxy/quotes/records/${quoteId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!response.ok) return null;
  return await response.json();
}

// Fetch linked account
async function fetchLinkedAccount(quoteId: string, token: string): Promise<AccountData | null> {
  const response = await fetch(`${API_BASE_URL}/proxy/quotes/links/accounts_copy/${quoteId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!response.ok) return null;
  const data = await response.json();
  return data.list?.[0] || data[0] || null;
}

// Fetch linked products
async function fetchLinkedProducts(quoteId: string, token: string): Promise<ProductData[]> {
  const response = await fetch(`${API_BASE_URL}/proxy/quotes/links/products/${quoteId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!response.ok) return [];
  const data = await response.json();
  return data.list || data || [];
}

export const GET: APIRoute = async ({ params, request }) => {
  const quoteId = params.id;
  
  if (!quoteId) {
    return new Response('Quote ID required', { status: 400 });
  }

  // Extract token from Authorization header
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '') || '';
  
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // Fetch all required data
    const [quote, account, products] = await Promise.all([
      fetchQuote(quoteId, token),
      fetchLinkedAccount(quoteId, token),
      fetchLinkedProducts(quoteId, token)
    ]);

    if (!quote) {
      return new Response('Quote not found', { status: 404 });
    }

    // Create PDF document
    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 50,
      bufferPages: true
    });

    // Buffer to collect PDF data
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    
    const pdfPromise = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // --- PDF CONTENT GENERATION ---

    // Logo (if exists)
    try {
      const logoFileName = 'green-o-care-logo.png';
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
        doc.image(logoPath, 50, 50, { width: 100 });
        doc.moveDown(2);
      } else {
        console.error('Logo not found in any of these paths:', possiblePaths);
      }
    } catch (error) {
      console.error('Logo error:', error);
    }

    // Company Header
    doc.fontSize(24)
       .fillColor('#2563eb')
       .text('GreenOCare Solutions Pvt. Ltd.', { align: 'left' });
    
    doc.fontSize(9)
       .fillColor('#64748b')
       .text('F-85, Okhla Industrial Estate, Phase-III', { align: 'left' })
       .text('New Delhi - 110020', { align: 'left' });
    
    doc.moveDown(1.5);
    
    // Horizontal line
    doc.strokeColor('#e2e8f0')
       .lineWidth(1)
       .moveTo(50, doc.y)
       .lineTo(545, doc.y)
       .stroke();
    
    doc.moveDown(1);

    // Quote Header Section
    const startY = doc.y;
    doc.fontSize(11)
       .fillColor('#334155')
       .text('Customer Name', 50, startY);
    
    doc.fontSize(11)
       .fillColor('#0f172a')
       .font('Helvetica-Bold')
       .text(account?.fields['Account Name'] || 'N/A', 50, startY + 15);
    
    // Quote info on right
    doc.fontSize(11)
       .fillColor('#334155')
       .font('Helvetica')
       .text('Quote', 450, startY, { align: 'right' });
    
    doc.fontSize(10)
       .fillColor('#0f172a')
       .text(`Version: ${quote.fields['Quote Version'] || '1.0'}`, 450, startY + 15, { align: 'right' })
       .text(`Date: ${quote.fields['Quote Date'] || 'N/A'}`, 450, startY + 30, { align: 'right' });
    
    doc.moveDown(3);
    
    // Another horizontal line
    doc.strokeColor('#e2e8f0')
       .lineWidth(1)
       .moveTo(50, doc.y)
       .lineTo(545, doc.y)
       .stroke();
    
    doc.moveDown(1.5);

    // Products Table Header
    const tableTop = doc.y;
    const col1X = 50;
    const col2X = 250;
    const col3X = 320;
    const col4X = 380;
    const col5X = 440;
    const col6X = 495;
    
    doc.fontSize(9)
       .fillColor('#475569')
       .font('Helvetica-Bold');
    
    doc.text('S.No.', col1X, tableTop);
    doc.text('Product Details', col2X, tableTop);
    doc.text('Model/Part Code', col3X, tableTop);
    doc.text('Warranty (yrs)', col4X, tableTop);
    doc.text('Unit Price', col5X, tableTop);
    doc.text('Qty', col6X, tableTop);
    doc.text('Tax', col6X + 25, tableTop);
    doc.text('Total', col6X + 60, tableTop);
    
    doc.moveDown(0.5);
    
    // Table header underline
    doc.strokeColor('#cbd5e1')
       .lineWidth(0.5)
       .moveTo(50, doc.y)
       .lineTo(545, doc.y)
       .stroke();
    
    doc.moveDown(0.5);

    // Products rows
    let subtotal = 0;
    let totalTax = 0;
    
    products.forEach((product, index) => {
      const rowY = doc.y;
      const unitPrice = product.fields['Unit Price'] || 0;
      const qty = 1; // Default quantity
      const itemTotal = unitPrice * qty;
      const tax = itemTotal * 0.18; // 18% GST
      const totalWithTax = itemTotal + tax;
      
      subtotal += itemTotal;
      totalTax += tax;
      
      doc.fontSize(9)
         .fillColor('#334155')
         .font('Helvetica');
      
      doc.text((index + 1).toString(), col1X, rowY);
      
      // Product name (with wrapping)
      const productName = product.fields['Product Name'] || 'Unnamed Product';
      const brand = product.fields['Brand'] || '';
      const hsn = product.fields['HSN'] || '';
      
      doc.text(productName, col2X, rowY, { width: 65 });
      if (brand || hsn) {
        doc.fontSize(8)
           .fillColor('#64748b')
           .text(`${brand ? brand : ''}${hsn ? ' HSN: ' + hsn : ''}`, col2X, doc.y);
      }
      
      const afterProductY = doc.y;
      
      doc.fontSize(9)
         .fillColor('#334155');
      doc.text(product.fields['Product Code'] || '-', col3X, rowY);
      doc.text('1', col4X, rowY);
      doc.text(`Rs. ${unitPrice.toLocaleString('en-IN')}`, col5X, rowY);
      doc.text(qty.toString(), col6X, rowY);
      doc.text(`Rs. ${tax.toFixed(2)}`, col6X + 25, rowY, { width: 30 });
      doc.text(`Rs. ${totalWithTax.toFixed(2)}`, col6X + 60, rowY);
      
      // Move to next row
      doc.y = Math.max(afterProductY, rowY + 40);
    });
    
    doc.moveDown(1);

    // Totals section
    const totalsX = 400;
    const grandTotal = subtotal + totalTax;
    
    doc.fontSize(10)
       .fillColor('#334155')
       .font('Helvetica');
    
    doc.text('Sub Total', totalsX, doc.y, { align: 'right', width: 90 });
    doc.text(`Rs. ${subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, totalsX + 95, doc.y - 12, { align: 'right' });
    
    doc.moveDown(0.5);
    doc.text('Tax', totalsX, doc.y, { align: 'right', width: 90 });
    doc.text(`Rs. ${totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, totalsX + 95, doc.y - 12, { align: 'right' });
    
    doc.moveDown(0.5);
    doc.text('Adjustment', totalsX, doc.y, { align: 'right', width: 90 });
    doc.text('Rs. 0.00', totalsX + 95, doc.y - 12, { align: 'right' });
    
    doc.moveDown(1);
    
    // Grand Total line
    doc.strokeColor('#1e293b')
       .lineWidth(1)
       .moveTo(totalsX, doc.y)
       .lineTo(545, doc.y)
       .stroke();
    
    doc.moveDown(0.5);
    
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .fillColor('#0f172a');
    doc.text('Grand Total', totalsX, doc.y, { align: 'right', width: 90 });
    doc.text(`Rs. ${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, totalsX + 95, doc.y - 14, { align: 'right' });
    
    doc.moveDown(1);
    
    // Final line
    doc.strokeColor('#1e293b')
       .lineWidth(2)
       .moveTo(totalsX, doc.y)
       .lineTo(545, doc.y)
       .stroke();
    
    doc.moveDown(2);

    // Terms and Conditions
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .fillColor('#0f172a')
       .text('Terms and Conditions', 50, doc.y);
    
    doc.moveDown(0.5);
    
    doc.fontSize(9)
       .font('Helvetica')
       .fillColor('#334155');
    
    const terms = [
      `1. Order to be placed on: GreenOCare Solutions Pvt. Ltd., F-85, 2nd Floor, Okhla Industrial Area, Phase III, New Delhi - 110020.`,
      `2. Delivery Terms –`,
      `3. Payment Terms –`,
      `4. Bank Details – Kotak Mahindra Bank, Account No- 6847253937, IFSC Code- KKBK0004651`,
      `5. GST No- 07AAECG5147M1ZB`
    ];
    
    terms.forEach(term => {
      doc.text(term, 50, doc.y, { width: 495 });
      doc.moveDown(0.3);
    });

    // Finalize PDF
    doc.end();

    // Wait for PDF generation to complete
    const pdfBuffer = await pdfPromise;

    // Return PDF as response
    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="quote-${quoteId}.pdf"`,
        'Content-Length': pdfBuffer.length.toString()
      }
    });

  } catch (error) {
    console.error('[PDF Generation Error]', error);
    return new Response('Failed to generate PDF', { status: 500 });
  }
};
