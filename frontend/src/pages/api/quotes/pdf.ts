import type { APIRoute } from 'astro';
import { generatePdfBuffer, type QuoteData } from '../../../lib/pdf-generator';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const quoteData: QuoteData = await request.json();
    const pdfBuffer = generatePdfBuffer(quoteData);

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
