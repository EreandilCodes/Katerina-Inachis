import express from 'express';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

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

    const { name, email, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Jméno, email a zpráva jsou povinné' });
    }

    const result = await db.prepare(`
      INSERT INTO inquiries (name, email, subject, message)
      VALUES (?, ?, ?, ?)
    `).run(name, email, subject || null, message);

    logger.info('inquiry_created', { id: result.lastInsertRowid, email });
    res.json({ message: 'Zpráva odeslána. Ozvu se co nejdříve.' });
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
