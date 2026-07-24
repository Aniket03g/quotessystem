import type { APIRoute } from 'astro';
import { Resend } from 'resend';

export const prerender = false;

interface AnnouncementBody {
  subject: string;
  message: string;
  siteUrl?: string;
}

interface JWTPayload {
  role?: string;
  email?: string;
  exp?: number;
}

interface UserListItem {
  email: string;
  role: string;
}

const API_BASE_URL =
  process.env.PUBLIC_API_BASE_URL || 'http://localhost:8082';

// Resend accepts up to 50 recipients per send; keep BCC batches under that.
const BATCH_SIZE = 45;

function decodePayload(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const json = Buffer.from(parts[1], 'base64').toString('utf-8');
    return JSON.parse(json) as JWTPayload;
  } catch {
    return null;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      return json({ error: 'Authentication required' }, 401);
    }

    // 1. Super-admin gate. The signature is trusted implicitly by the proxy
    //    call below (a forged/edited token fails the users fetch), so an
    //    ordinary admin cannot escalate: their honest payload says "admin".
    const claims = decodePayload(token);
    if (!claims || claims.role !== 'super_admin') {
      return json({ error: 'Super admin access required' }, 403);
    }

    const body: AnnouncementBody = await request.json();
    const subject = (body.subject || '').trim();
    const message = (body.message || '').trim();

    if (!subject || !message) {
      return json({ error: 'subject and message are required' }, 400);
    }

    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.EMAIL_FROM_ADMIN || process.env.EMAIL_FROM;
    if (!apiKey || !fromAddress) {
      return json({ error: 'Email service not configured' }, 500);
    }

    // 2. Fetch the recipient list from the proxy using the caller's token.
    //    This validates the JWT signature server-side (proxy enforces it).
    const usersRes = await fetch(`${API_BASE_URL}/api/admin/users`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (usersRes.status === 401 || usersRes.status === 403) {
      return json({ error: 'Not authorized to read users' }, 403);
    }
    if (!usersRes.ok) {
      return json({ error: 'Failed to load recipient list' }, 502);
    }

    const usersData = (await usersRes.json()) as { users?: UserListItem[] };
    const recipients = Array.from(
      new Set(
        (usersData.users || [])
          .map((u) => (u.email || '').trim().toLowerCase())
          .filter((e) => e.includes('@'))
      )
    );

    if (recipients.length === 0) {
      return json({ error: 'No recipients found' }, 400);
    }

    const resend = new Resend(apiKey);
    const htmlBody = buildHtml(subject, message);
    // Plain-text fallback so text-only clients aren't blank.
    const textBody = `${subject}\n\n${message}\n\n— Grove Systems Pvt. Ltd.`;

    let sent = 0;
    const failedBatches: string[] = [];

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      const { error } = await resend.emails.send({
        from: fromAddress,
        // Everyone goes in BCC so recipients never see each other's address.
        to: [fromAddress],
        bcc: batch,
        subject,
        html: htmlBody,
        text: textBody,
      });

      if (error) {
        console.error('[Announcement Email Error]', error);
        failedBatches.push(...batch);
      } else {
        sent += batch.length;
      }
    }

    // Record an audit log entry in the proxy. Uses the caller's token, so the
    // proxy stamps sender_email from the trusted JWT. Best-effort: a logging
    // failure must not fail an announcement that already went out.
    try {
      await fetch(`${API_BASE_URL}/api/admin/announcements`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject,
          message,
          recipient_count: recipients.length,
          sent_count: sent,
          failed_count: failedBatches.length,
        }),
      });
    } catch (logErr) {
      console.error('[Announcement Log Error]', logErr);
    }

    return json(
      {
        success: failedBatches.length === 0,
        sent,
        failed: failedBatches.length,
        totalRecipients: recipients.length,
      },
      failedBatches.length > 0 && sent === 0 ? 500 : 200
    );
  } catch (err) {
    console.error('[Announcement Email Error]', err);
    return json({ error: 'Failed to send announcement' }, 500);
  }
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildHtml(subject: string, message: string): string {
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br/>');
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
      <div style="background: #1e293b; padding: 28px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #fff; font-size: 1.25rem; font-weight: 700; margin: 0;">
          ${safeSubject}
        </h1>
      </div>
      <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 32px; border-radius: 0 0 12px 12px;">
        <div style="margin: 0; font-size: 0.95rem; color: #334155; line-height: 1.6;">
          ${safeMessage}
        </div>
      </div>
      <p style="margin: 16px 0 0; font-size: 0.75rem; color: #94a3b8; text-align: center;">
        Grove Systems Pvt. Ltd. &nbsp;·&nbsp; This is an automated announcement, please do not reply.
      </p>
    </div>
  `;
}
