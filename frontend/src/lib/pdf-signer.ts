import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { P12Signer } from '@signpdf/signer-p12';
import { SignPdf } from '@signpdf/signpdf';

// Tamper-evidence for shared quote PDFs.
//
// After jsPDF builds the document we apply a cryptographic digital signature.
// Any later edit — even a single character — invalidates the signature, and
// Adobe Reader (and most PDF viewers) show the recipient a warning banner:
// "The document has been altered or corrupted since it was signed."
//
// The certificate is a self-signed .p12. Self-signed still gives full
// tamper-DETECTION; the only thing it lacks is the green "trusted identity"
// badge, which requires a cert from a public CA (e.g. eMudhra / Sectigo).
// Upgrading later is a pure file swap — drop the CA-issued .p12 in place and
// point PDF_SIGNING_P12 at it. No code change.
//
// Design rule: signing must NEVER break quote delivery. If the cert is missing
// or anything throws, we log and return the original unsigned PDF so the user
// still gets their quote.

// The signer identity shown in the PDF's signature panel. The .p12 subject is
// fixed at generation time; this only affects the visible "Name"/"Reason" text.
export interface SignOptions {
  companyName?: string;
  quoteNumber?: string;
}

// Resolve the .p12 once per process. `undefined` = not yet looked up,
// `null` = looked up and absent (so we stop hitting the filesystem every call).
let cachedP12: Buffer | null | undefined;

function loadP12(): Buffer | null {
  if (cachedP12 !== undefined) return cachedP12;

  const candidates = [
    process.env.PDF_SIGNING_P12, // explicit override (prod / Docker)
    path.join(process.cwd(), 'certs', 'grove-signing.p12'),
    path.join(process.cwd(), 'frontend', 'certs', 'grove-signing.p12'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        cachedP12 = fs.readFileSync(p);
        return cachedP12;
      }
    } catch {
      /* keep trying the next candidate */
    }
  }

  console.warn(
    '[PDF Signing] No signing certificate found; delivering UNSIGNED PDF. ' +
      'Set PDF_SIGNING_P12 or place certs/grove-signing.p12 to enable tamper-evidence.',
  );
  cachedP12 = null;
  return null;
}

/**
 * Digitally sign a PDF buffer. Returns the signed PDF, or the original
 * buffer unchanged if signing is unavailable or fails.
 */
export async function signPdfBuffer(
  pdf: Buffer,
  opts: SignOptions = {},
): Promise<Buffer> {
  const p12 = loadP12();
  if (!p12) return pdf;

  const company = opts.companyName || 'Grove Systems Pvt. Ltd.';
  const reason = opts.quoteNumber
    ? `Official quotation ${opts.quoteNumber} issued by ${company}`
    : `Official quotation issued by ${company}`;

  try {
    // 1. Load the jsPDF output into pdf-lib and inject a signature placeholder.
    const pdfDoc = await PDFDocument.load(new Uint8Array(pdf));
    pdflibAddPlaceholder({
      pdfDoc,
      reason,
      contactInfo: 'sales@grovesystems.in',
      name: company,
      location: 'New Delhi, India',
    });

    // Object streams must stay off so signpdf can find the placeholder and
    // compute a correct ByteRange over the raw bytes.
    const withPlaceholder = Buffer.from(
      await pdfDoc.save({ useObjectStreams: false }),
    );

    // 2. Fill the placeholder with a real signature over the document bytes.
    const signer = new P12Signer(p12, {
      passphrase: process.env.PDF_SIGNING_P12_PASS || '',
    });
    const signed = await new SignPdf().sign(withPlaceholder, signer);
    return signed;
  } catch (err) {
    console.error('[PDF Signing] Failed to sign, delivering unsigned PDF:', err);
    return pdf;
  }
}
