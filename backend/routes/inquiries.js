import express from 'express';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { isEmailConfigured, sendInquiryEmail, EmailError } from '../services/email.js';

const router = express.Router();

// ── Validation limits ───────────────────────────────────────────────────────────
const NAME_MAX    = 100;
const EMAIL_MAX   = 200;
const SUBJECT_MAX = 200;
const MSG_MIN     = 10;
const MSG_MAX     = 5000;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

function validateInquiry(body) {
  const name    = typeof body.name    === 'string' ? body.name.trim()    : '';
  const email   = typeof body.email   === 'string' ? body.email.trim()   : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (!name)                         return { error: 'Jméno je povinné' };
  if (name.length > NAME_MAX)        return { error: `Jméno je příliš dlouhé (max ${NAME_MAX} znaků)` };
  if (!email)                        return { error: 'E-mail je povinný' };
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return { error: 'Neplatný e-mail' };
  if (subject.length > SUBJECT_MAX)  return { error: `Předmět je příliš dlouhý (max ${SUBJECT_MAX} znaků)` };
  if (!message)                      return { error: 'Zpráva je povinná' };
  if (message.length < MSG_MIN)      return { error: `Zpráva je příliš krátká (min ${MSG_MIN} znaků)` };
  if (message.length > MSG_MAX)      return { error: `Zpráva je příliš dlouhá (max ${MSG_MAX} znaků)` };

  return { name, email, subject, message };
}

// ── Inquiry rate limit: 5 per 5 min / IP ─────────────────────────────────────
const inquiryRateLimits = new Map();
const INQ_MAX    = 5;
const INQ_WINDOW = 5 * 60 * 1000;

function checkInquiryRate(ip) {
  const now   = Date.now();
  const entry = inquiryRateLimits.get(ip);
  if (!entry || now - entry.windowStart > INQ_WINDOW) {
    inquiryRateLimits.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= INQ_MAX) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of inquiryRateLimits.entries()) {
    if (now - entry.windowStart > INQ_WINDOW) inquiryRateLimits.delete(ip);
  }
}, 10 * 60 * 1000);

// POST /api/inquiries — public (with honeypot + time check + rate limit)
router.post('/', async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';

    // Honeypot check (bot filled hidden field)
    if (req.body.website) {
      // Silently return success to fool bots
      logger.warn('inquiry_honeypot_triggered', { ip });
      return res.json({ message: 'Poptávka odeslána' });
    }

    // Time check — form must be loaded at least 2s before submit
    const formLoadedAt = Number(req.body.form_loaded_at);
    if (!formLoadedAt || Date.now() - formLoadedAt < 2000) {
      logger.warn('inquiry_too_fast', { ip });
      return res.status(400).json({ error: 'Příliš rychlé odeslání. Zkuste to znovu.' });
    }

    // Rate limit
    if (!checkInquiryRate(ip)) {
      logger.warn('inquiry_rate_limit', { ip });
      return res.status(429).json({ error: 'Příliš mnoho zpráv. Zkuste to za 5 minut.' });
    }

    // Independent server-side validation
    const v = validateInquiry(req.body);
    if (v.error) {
      return res.status(400).json({ error: v.error });
    }

    // Resolve recipient: CONTACT_EMAIL env var first, then admin "contact_email" setting
    let to = (process.env.CONTACT_EMAIL || '').trim();
    let siteName = 'Kateřina Inachis';
    try {
      const contactRow = await db.prepare(`SELECT value FROM settings WHERE key = 'contact_email'`).get();
      if (!to && contactRow?.value) to = String(contactRow.value).trim();
      const nameRow = await db.prepare(`SELECT value FROM settings WHERE key = 'site_name'`).get();
      if (nameRow?.value) siteName = nameRow.value;
    } catch (err) {
      logger.fromError('inquiry_recipient_lookup_error', err);
    }

    if (!to || !isEmailConfigured()) {
      logger.warn('inquiry_email_not_configured', { ip, hasRecipient: Boolean(to) });
      return res.status(503).json({ error: 'Odesílání zpráv není momentálně dostupné. Zkuste to prosím později.' });
    }

    const subject = `Nová zpráva z webu ${siteName}`;
    const now     = new Date();
    const text = [
      `Nová zpráva z webu ${siteName}`,
      '',
      `Jméno: ${v.name}`,
      `E-mail: ${v.email}`,
      `Předmět: ${v.subject || '(bez předmětu)'}`,
      '',
      v.message,
      '',
      `Odesláno: ${now.toLocaleString('cs-CZ')}`,
    ].join('\n');

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.6">
        <h2 style="color:#4b2e83;font-weight:300">Nová zpráva z webu ${escHtml(siteName)}</h2>
        <table style="border-collapse:collapse">
          <tr><td style="padding:2px 12px 2px 0"><strong>Jméno:</strong></td><td>${escHtml(v.name)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0"><strong>E-mail:</strong></td><td>${escHtml(v.email)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0"><strong>Předmět:</strong></td><td>${escHtml(v.subject || '—')}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #e0d5f0;margin:16px 0">
        <p>${escHtml(v.message).replace(/\n/g, '<br>')}</p>
        <p style="color:#888;font-size:12px">Odesláno: ${escHtml(now.toLocaleString('cs-CZ'))}</p>
      </div>`;

    // Send the real email FIRST — success is only reported after delivery.
    try {
      await sendInquiryEmail({ to, replyTo: v.email, subject, text, html });
    } catch (err) {
      if (err instanceof EmailError && err.code === 'NOT_CONFIGURED') {
        logger.warn('inquiry_email_not_configured', { ip, hasRecipient: Boolean(to) });
        return res.status(503).json({ error: 'Odesílání zpráv není momentálně dostupné. Zkuste to prosím později.' });
      }
      logger.fromError('inquiry_email_send_error', err);
      return res.status(502).json({ error: 'Zprávu se nepodařilo odeslat. Zkuste to prosím později.' });
    }

    // Persist submission for the admin archive after successful delivery.
    try {
      const result = await db.prepare(`
        INSERT INTO inquiries (name, email, subject, message)
        VALUES (?, ?, ?, ?)
      `).run(v.name, v.email, v.subject || null, v.message);

      logger.info('inquiry_created', { id: result.lastInsertRowid, email: v.email });
    } catch (err) {
      logger.fromError('inquiries_create_error', err);
    }

    res.json({ message: 'Zpráva byla úspěšně odeslána.' });
  } catch (err) {
    logger.fromError('inquiries_create_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/inquiries/admin/all — admin
router.get('/admin/all', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const items = await db.prepare(`SELECT * FROM inquiries ORDER BY created_at DESC`).all();
    res.json(items);
  } catch (err) {
    logger.fromError('inquiries_admin_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// PUT /api/inquiries/:id/read — admin
router.put('/:id/read', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    await db.prepare(`UPDATE inquiries SET is_read = 1 WHERE id = ?`).run(req.params.id);
    res.json({ message: 'Označeno jako přečtené' });
  } catch (err) {
    logger.fromError('inquiries_read_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// DELETE /api/inquiries/:id — admin
router.delete('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    await db.prepare('DELETE FROM inquiries WHERE id = ?').run(req.params.id);
    res.json({ message: 'Dotaz smazán' });
  } catch (err) {
    logger.fromError('inquiries_delete_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;
