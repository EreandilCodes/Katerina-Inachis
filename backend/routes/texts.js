import express from 'express';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

// ── Story-aware request body parsing ─────────────────────────────────────
// Literary stories under the "Povídky" category may be very long (a single
// full-length story can exceed Express's default 100kb JSON body limit).
// This router therefore parses its own JSON with a much larger cap for
// request bodies whose `category` is "Povídky"; every other payload keeps the
// previous ~100kb limit. Because this router is mounted before the global
// express.json() parser in server.js, the default parser skips already-parsed
// bodies for these routes.
const STORY_CATEGORY  = 'Povídky';
const STORY_BODY_LIMIT = '30mb';
const DEFAULT_BODY_LIMIT_BYTES = 100 * 1024; // 100kb — unchanged behaviour for everything else

const storyJson = express.json({
  limit: STORY_BODY_LIMIT,
  verify: (req, _res, buf) => {
    let category;
    try {
      category = JSON.parse(buf.toString('utf8')).category;
    } catch {
      return; // JSON syntax errors are reported by body-parser itself
    }
    if (category !== STORY_CATEGORY && buf.length > DEFAULT_BODY_LIMIT_BYTES) {
      const err = new Error('Request entity too large for non-story content');
      err.status = 413;
      err.type = 'entity.too.large';
      err.limit = '100kb';
      throw err;
    }
  },
});

router.use(storyJson);

function generateSlug(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// GET /api/texts — published, optional ?category=&lang=en
router.get('/', async (req, res) => {
  try {
    const { category, lang } = req.query;
    const titleCol = lang === 'en' ? `COALESCE(NULLIF(title_en,''), title) as title` : 'title';
    const excerptCol = lang === 'en' ? `COALESCE(NULLIF(excerpt_en,''), excerpt) as excerpt` : 'excerpt';
    let sql = `SELECT id, ${titleCol}, slug, ${excerptCol}, cover_image, category, is_featured, published_at, sort_order, created_at
               FROM texts WHERE is_published = 1`;
    const params = [];
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY sort_order ASC, published_at DESC, created_at DESC';
    const items = await db.prepare(sql).all(...params);
    res.json(items);
  } catch (err) {
    logger.fromError('texts_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/texts/admin/all — admin
router.get('/admin/all', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const items = await db.prepare(`SELECT * FROM texts ORDER BY sort_order ASC, created_at DESC`).all();
    res.json(items);
  } catch (err) {
    logger.fromError('texts_admin_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/texts/featured — is_featured=1, published, optional ?lang=en
router.get('/featured', async (req, res) => {
  try {
    const { lang } = req.query;
    const titleCol = lang === 'en' ? `COALESCE(NULLIF(title_en,''), title) as title` : 'title';
    const excerptCol = lang === 'en' ? `COALESCE(NULLIF(excerpt_en,''), excerpt) as excerpt` : 'excerpt';
    const items = await db.prepare(`
      SELECT id, ${titleCol}, slug, ${excerptCol}, cover_image, category, published_at, sort_order, created_at
      FROM texts WHERE is_featured = 1 AND is_published = 1
      ORDER BY sort_order ASC, published_at DESC
    `).all();
    res.json(items);
  } catch (err) {
    logger.fromError('texts_featured_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/texts/:slug — public single, optional ?lang=en
router.get('/:slug', async (req, res) => {
  try {
    const { lang } = req.query;
    let selectCols;
    if (lang === 'en') {
      selectCols = `id, COALESCE(NULLIF(title_en,''), title) as title, slug, COALESCE(NULLIF(excerpt_en,''), excerpt) as excerpt, COALESCE(NULLIF(content_en,''), content) as content, cover_image, category, is_featured, is_published, published_at, sort_order, created_at`;
    } else {
      selectCols = '*';
    }
    const item = await db.prepare(`SELECT ${selectCols} FROM texts WHERE slug = ? AND is_published = 1`).get(req.params.slug);
    if (!item) return res.status(404).json({ error: 'Text nenalezen' });
    res.json(item);
  } catch (err) {
    logger.fromError('texts_get_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// POST /api/texts — admin
router.post('/', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { title, excerpt, content, cover_image, category, is_featured, is_published, sort_order, title_en, excerpt_en, content_en, published_at: rawPublishedAt } = req.body;
    if (!title) return res.status(400).json({ error: 'Název je povinný' });

    const slug = generateSlug(title);
    const published_at = rawPublishedAt || (is_published ? new Date().toISOString() : null);

    const result = await db.prepare(`
      INSERT INTO texts (title, slug, excerpt, content, cover_image, category, is_featured, is_published, published_at, sort_order, title_en, excerpt_en, content_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, slug, excerpt || null, content || null, cover_image || null, category || null,
           is_featured ? 1 : 0, is_published ? 1 : 0, published_at, sort_order || 0,
           title_en || null, excerpt_en || null, content_en || null);

    const item = await db.prepare('SELECT * FROM texts WHERE id = ?').get(result.lastInsertRowid);
    logger.info('text_created', { id: result.lastInsertRowid, title });
    res.status(201).json({ message: 'Text vytvořen', item });
  } catch (err) {
    logger.fromError('texts_create_error', err);
    res.status(err.message?.includes('UNIQUE') ? 400 : 500).json({ error: err.message?.includes('UNIQUE') ? 'Slug již existuje' : 'Chyba serveru' });
  }
});

// PUT /api/texts/:id — admin
router.put('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { title, excerpt, content, cover_image, category, is_featured, is_published, sort_order, title_en, excerpt_en, content_en, published_at: rawPublishedAt } = req.body;
    if (!title) return res.status(400).json({ error: 'Název je povinný' });

    const slug = generateSlug(title);
    const published_at = rawPublishedAt || (is_published ? new Date().toISOString() : null);

    await db.prepare(`
      UPDATE texts SET title=?, slug=?, excerpt=?, content=?, cover_image=?, category=?,
        is_featured=?, is_published=?, published_at=?, sort_order=?, title_en=?, excerpt_en=?, content_en=?
      WHERE id=?
    `).run(title, slug, excerpt || null, content || null, cover_image || null, category || null,
           is_featured ? 1 : 0, is_published ? 1 : 0, published_at, sort_order || 0,
           title_en || null, excerpt_en || null, content_en || null, req.params.id);

    const item = await db.prepare('SELECT * FROM texts WHERE id = ?').get(req.params.id);
    logger.info('text_updated', { id: req.params.id });
    res.json({ message: 'Text aktualizován', item });
  } catch (err) {
    logger.fromError('texts_update_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// DELETE /api/texts/:id — admin
router.delete('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    await db.prepare('DELETE FROM texts WHERE id = ?').run(req.params.id);
    logger.info('text_deleted', { id: req.params.id });
    res.json({ message: 'Text smazán' });
  } catch (err) {
    logger.fromError('texts_delete_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;
