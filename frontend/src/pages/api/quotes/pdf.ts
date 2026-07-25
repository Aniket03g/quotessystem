import type { APIRoute } from 'astro';
import { generatePdfBuffer, type QuoteData } from '../../../lib/pdf-generator';
import { signPdfBuffer } from '../../../lib/pdf-signer';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const quoteData: QuoteData = await request.json();
    const rawPdf = generatePdfBuffer(quoteData);
    const pdfBuffer = await signPdfBuffer(rawPdf, {
      companyName:
        quoteData.logo === 'grove'
          ? 'Grove Systems Pvt. Ltd.'
          : 'GreenOCare Solutions Pvt. Ltd.',
      quoteNumber: quoteData.quoteNumber,
    });

    const body = new Uint8Array(pdfBuffer);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="quote-${quoteData.id}.pdf"`,
        'Content-Length': body.length.toString(),
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
