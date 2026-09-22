import express from 'express';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

const ALLOWED_SLUGS = new Set([
  'texty', 'kresba', 'blog', 'programovani', 'pratele', 'o-mne', 'kontakt'
]);

const MAX_INTRO_LENGTH = 20000;

// GET /api/pages — public list of page intro texts
router.get('/', async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT slug, title, intro_text FROM pages ORDER BY id`
    ).all();
    res.json(rows);
  } catch (err) {
    logger.fromError('pages_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/pages/:slug — public single page intro text
router.get('/:slug', async (req, res) => {
  try {
    const page = await db.prepare(
      `SELECT slug, title, intro_text FROM pages WHERE slug = ?`
    ).get(req.params.slug);
    if (!page) return res.status(404).json({ error: 'Stránka nenalezena' });
    res.json(page);
  } catch (err) {
    logger.fromError('pages_get_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// PUT /api/pages/:slug — admin updates page intro text
router.put('/:slug', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { slug } = req.params;
    const { intro_text } = req.body;

    if (!ALLOWED_SLUGS.has(slug)) {
      return res.status(400).json({ error: `Neznámý identifikátor stránky: ${slug}` });
    }
    if (typeof intro_text !== 'string') {
      return res.status(400).json({ error: 'Chybí text úvodu' });
    }
    if (intro_text.length > MAX_INTRO_LENGTH) {
      return res.status(400).json({ error: `Text úvodu je příliš dlouhý (max ${MAX_INTRO_LENGTH} znaků)` });
    }

    const result = await db.prepare(`
      UPDATE pages SET intro_text = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?
    `).run(intro_text, slug);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Stránka nenalezena' });
    }

    logger.info('page_intro_updated', { slug });
    res.json({ message: 'Úvodní text uložen', slug, intro_text });
  } catch (err) {
    logger.fromError('pages_update_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;