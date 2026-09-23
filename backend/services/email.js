import { logger } from '../logger.js';

// Real email delivery via Resend HTTPS API (works on Railway Free/Hobby plans,
// which restrict outbound SMTP). Uses Node's built-in fetch — no extra dependency.
// The endpoint can be overridden for tests via RESEND_API_ENDPOINT.
const RESEND_ENDPOINT = process.env.RESEND_API_ENDPOINT || 'https://api.resend.com/emails';

export function getEmailConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY || '',
    from:   process.env.EMAIL_FROM || '',
  };
}

export function isEmailConfigured() {
  const { apiKey, from } = getEmailConfig();
  return Boolean(apiKey && from);
}

export class EmailError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EmailError';
    this.code = code; // 'NOT_CONFIGURED' | 'PROVIDER'
  }
}

/**
 * Sends a transactional email through Resend.
 * Throws EmailError('NOT_CONFIGURED') or EmailError('PROVIDER') — never exposes
 * credentials or internal provider details.
 */
export async function sendInquiryEmail({ to, replyTo, subject, html, text }) {
  const { apiKey, from } = getEmailConfig();

  if (!to) {
    throw new EmailError('NOT_CONFIGURED', 'Recipient (CONTACT_EMAIL or contact_email setting) not configured');
  }
  if (!from) {
    throw new EmailError('NOT_CONFIGURED', 'Sender (EMAIL_FROM) not configured');
  }
  if (!apiKey) {
    throw new EmailError('NOT_CONFIGURED', 'Email provider API key not configured');
  }

  const body = { from, to: [to], reply_to: replyTo, subject, text, html };

  let response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logger.fromError('email_send_network_error', err);
    throw new EmailError('PROVIDER', 'Email provider unreachable');
  }

  if (!response.ok) {
    // Log an excerpt of the provider message for diagnostics. Never the API key.
    const detail = await response.text().catch(() => '');
    logger.warn('email_send_provider_error', { status: response.status, detail: detail.slice(0, 300) });
    throw new EmailError('PROVIDER', `Email provider returned status ${response.status}`);
  }

  logger.info('email_sent', { to, subject });
  return response;
}