import type { APIRoute } from 'astro';
import { generateExcelBuffer, type QuoteData } from '../../../lib/excel-generator';

export const prerender = false;

// The workbook counterpart to /api/quotes/pdf. It takes the identical payload,
// so the page can hand it exactly what it already built for the PDF. Unlike the
// PDF there is no signing step: an .xlsx cannot carry the same tamper-evident
// signature, so this file is the working copy and the signed PDF stays the
// document of record.
export const POST: APIRoute = async ({ request }) => {
  try {
    const quoteData: QuoteData = await request.json();
    const buffer = await generateExcelBuffer(quoteData);

    const body = new Uint8Array(buffer);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="quote-${quoteData.id}.xlsx"`,
        'Content-Length': body.length.toString(),
      },
    });
  } catch (error) {
    console.error('[Excel Generation Error]', error);
    return new Response(JSON.stringify({ error: 'Failed to generate Excel' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
