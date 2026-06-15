import type { APIRoute } from 'astro';
import { Resend } from 'resend';

export const prerender = false;

interface CredentialsEmailBody {
  type: 'welcome' | 'reset';
  toEmail: string;
  name?: string;
  tempPassword: string;
  siteUrl: string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body: CredentialsEmailBody = await request.json();
    const { type, toEmail, name, tempPassword, siteUrl } = body;

    if (!toEmail || !tempPassword) {
      return new Response(JSON.stringify({ error: 'toEmail and tempPassword are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.EMAIL_FROM_ADMIN || process.env.EMAIL_FROM;

    if (!apiKey || !fromAddress) {
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const resend = new Resend(apiKey);
    const displayName = name || toEmail.split('@')[0];
    const loginUrl = `${siteUrl}/login`;

    const isWelcome = type === 'welcome';

    const subject = isWelcome
      ? 'You\'ve been invited to Grove CRM'
      : 'Your Grove CRM password has been reset';

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
        <div style="background: #1e293b; padding: 28px 32px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #fff; font-size: 1.25rem; font-weight: 700; margin: 0;">
            ${isWelcome ? 'Welcome to Grove CRM' : 'Password Reset'}
          </h1>
        </div>

        <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 32px; border-radius: 0 0 12px 12px;">
          <p style="margin: 0 0 16px; font-size: 0.95rem;">Hi ${displayName},</p>

          <p style="margin: 0 0 24px; font-size: 0.95rem; color: #475569;">
            ${isWelcome
              ? 'An account has been created for you on Grove CRM. Use the credentials below to log in.'
              : 'Your Grove CRM password has been reset by an administrator. Use the credentials below to log in.'}
          </p>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <div style="margin-bottom: 14px;">
              <p style="margin: 0 0 4px; font-size: 0.7rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Email</p>
              <p style="margin: 0; font-size: 0.95rem; font-weight: 500; color: #1e293b;">${toEmail}</p>
            </div>
            <div>
              <p style="margin: 0 0 4px; font-size: 0.7rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Temporary Password</p>
              <code style="display: inline-block; background: #1e293b; color: #e2e8f0; padding: 8px 14px; border-radius: 6px; font-size: 1rem; letter-spacing: 0.05em;">${tempPassword}</code>
            </div>
          </div>

          <a href="${loginUrl}" style="display: inline-block; background: #4f46e5; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 0.9rem; font-weight: 600; margin-bottom: 24px;">
            Log In to Grove CRM →
          </a>

          <div style="background: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 14px 16px; margin-bottom: 0;">
            <p style="margin: 0; font-size: 0.8rem; color: #854d0e;">
              <strong>Important:</strong> You will be required to change this password on first login. Do not share it with anyone.
            </p>
          </div>
        </div>

        <p style="margin: 16px 0 0; font-size: 0.75rem; color: #94a3b8; text-align: center;">
          Grove Systems Pvt. Ltd. &nbsp;·&nbsp; This is an automated message, please do not reply.
        </p>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: fromAddress,
      to: [toEmail],
      subject,
      html: htmlBody,
    });

    if (error) {
      console.error('[Credentials Email Error]', error);
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
    console.error('[Credentials Email Error]', err);
    return new Response(JSON.stringify({ error: 'Failed to send email' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
