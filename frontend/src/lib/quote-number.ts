import { safeJsonParse } from './api';

/**
 * Quote numbering: GR/2026-27/0001 or GOC/2026-27/0001, sequential per company
 * per financial year (Apr-Mar).
 *
 * Shared by every page that creates a quote. It lives here rather than in the
 * page precisely because two pages issue numbers now — a fix applied to only one
 * of them would hand the same number to two customers.
 */

export function getFinancialYear(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const startYear = month >= 4 ? year : year - 1;
  const endYear = (startYear + 1) % 100;
  return `${startYear}-${endYear.toString().padStart(2, '0')}`;
}

export interface QuoteNumberContext {
  apiBaseUrl: string;
  token: string;
}

export async function getNextQuoteNumber(
  company: string,
  { apiBaseUrl, token }: QuoteNumberContext,
): Promise<string> {
  const prefix = company === 'Grove Systems' ? 'GR' : 'GOC';
  const fy = getFinancialYear();
  const numberPrefix = `${prefix}/${fy}/`;

  const rawWhere = `(Quote Number,like,${numberPrefix}%)`;
  const encodedWhere = encodeURIComponent(rawWhere);
  const response = await fetch(
    `${apiBaseUrl}/proxy/quotes/records?where=${encodedWhere}&limit=1000&fields=Quote Number`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) throw new Error('Failed to fetch existing quote numbers');

  const data = await safeJsonParse(response);
  const existing = data.records || data.list || [];

  // Take the highest sequence actually in use, not the row count. Versions of a
  // quote are separate rows that deliberately share one Quote Number, so counting
  // rows runs ahead of the real numbers and skips a number per version. Counting
  // also moves backwards when a quote is deleted, which would reissue a number
  // that is already on a customer's PDF.
  let maxSeq = 0;
  for (const rec of existing) {
    const quoteNumber = String(rec.fields?.['Quote Number'] ?? rec['Quote Number'] ?? '');
    if (!quoteNumber.startsWith(numberPrefix)) continue;
    const seq = parseInt(quoteNumber.slice(numberPrefix.length), 10);
    if (Number.isFinite(seq)) maxSeq = Math.max(maxSeq, seq);
  }
  const nextSeq = maxSeq + 1;

  return `${numberPrefix}${nextSeq.toString().padStart(4, '0')}`;
}
