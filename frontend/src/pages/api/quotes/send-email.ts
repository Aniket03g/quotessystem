import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { generatePdfBuffer, type QuoteData } from '../../../lib/pdf-generator';
import {
  generateSectionedPdfBuffer,
  type SectionedQuoteData,
} from '../../../lib/pdf-generator-sectioned';
import { signPdfBuffer } from '../../../lib/pdf-signer';

export const prerender = false;

interface SendEmailBody extends QuoteData {
  toEmail: string;
  emailSubject: string;
  note?: string;
  senderEmail?: string;
  /**
   * Attach the floor/room-grouped PDF instead of the flat one. Set by the quote
   * page for room-wise quotes, where the flat layout throws away the very
   * structure the quote was built around. Absent means the standard PDF, so
   * every existing caller keeps the document it has always sent.
   */
  sectioned?: boolean;
  /** Only read when `sectioned`; mirrors /api/quotes/pdf-sectioned. */
  roomSubtotals?: boolean;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body: SendEmailBody = await request.json();
    const { toEmail, emailSubject, note, senderEmail, sectioned, roomSubtotals, ...quoteData } = body;

    if (!toEmail) {
      return new Response(JSON.stringify({ error: 'toEmail is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.EMAIL_FROM;

    if (!apiKey || !fromAddress) {
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rawPdf = sectioned
      ? generateSectionedPdfBuffer(quoteData as unknown as SectionedQuoteData, {
          roomSubtotals: roomSubtotals !== false, // default on, same as the download route
        })
      : generatePdfBuffer(quoteData as QuoteData);
    const pdfBuffer = await signPdfBuffer(rawPdf, {
      companyName:
        quoteData.logo === 'grove'
          ? 'Grove Systems Pvt. Ltd.'
          : 'GreenOCare Solutions Pvt. Ltd.',
      quoteNumber: quoteData.quoteNumber,
    });

    const resend = new Resend(apiKey);

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <p>Dear ${quoteData.account?.name || 'Customer'},</p>
        <p>Please find attached your quotation <strong>${quoteData.subject}</strong> (Version ${quoteData.version || '1.0'}).</p>
        <p>If you have any questions, please feel free to reach out to us.</p>
        ${note ? `<p>${note.replace(/\n/g, '<br/>')}</p>` : ''}
        <p>Best regards,<br/>
        ${quoteData.logo === 'grove' ? 'Grove Systems Pvt. Ltd.' : 'GreenOCare Solutions Pvt. Ltd.'}</p>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: senderEmail || fromAddress,
      to: [toEmail],
      subject: emailSubject || `Quotation: ${quoteData.subject}`,
      html: htmlBody,
      attachments: [
        {
          filename: `quote-${quoteData.id}${sectioned ? '-room-wise' : ''}.pdf`,
          content: pdfBuffer,
        },
      ],
    });

    if (error) {
      console.error('[Send Email Error]', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Send Email Error]', err);
    return new Response(JSON.stringify({ error: 'Failed to send email' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
