import type { APIRoute } from 'astro';
import {
  generateSectionedPdfBuffer,
  type SectionedQuoteData,
} from '../../../lib/pdf-generator-sectioned';
import { signPdfBuffer } from '../../../lib/pdf-signer';

export const prerender = false;

/**
 * Floor/room-grouped quote PDF. Deliberately a separate route from
 * /api/quotes/pdf rather than a flag on it, so the standard quote PDF path is
 * untouched by anything that happens here.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const quoteData: SectionedQuoteData = body;
    const roomSubtotals = body.roomSubtotals !== false; // default on

    const rawPdf = generateSectionedPdfBuffer(quoteData, { roomSubtotals });
    const pdfBuffer = await signPdfBuffer(rawPdf, {
      companyName:
        quoteData.logo === 'grove'
          ? 'Grove Systems Pvt. Ltd.'
          : 'GreenOCare Solutions Pvt. Ltd.',
      quoteNumber: quoteData.quoteNumber,
    });

    const out = new Uint8Array(pdfBuffer);
    return new Response(out, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="quote-${quoteData.id}-sectioned.pdf"`,
        'Content-Length': out.length.toString(),
      },
    });
  } catch (error) {
    console.error('[Sectioned PDF Generation Error]', error);
    return new Response(JSON.stringify({ error: 'Failed to generate sectioned PDF' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
