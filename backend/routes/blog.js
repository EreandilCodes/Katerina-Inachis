import express from 'express';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

function generateSlug(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// GET /api/blog — published posts, optional ?lang=en
router.get('/', async (req, res) => {
  try {
    const { lang } = req.query;
    const titleCol = lang === 'en' ? `COALESCE(NULLIF(title_en,''), title) as title` : 'title';
    const excerptCol = lang === 'en' ? `COALESCE(NULLIF(excerpt_en,''), excerpt) as excerpt` : 'excerpt';
    const items = await db.prepare(`
      SELECT id, ${titleCol}, slug, ${excerptCol}, cover_image, is_featured, published_at, created_at
      FROM blog_posts WHERE is_published = 1
      ORDER BY published_at DESC, created_at DESC
    `).all();
    res.json(items);
  } catch (err) {
    logger.fromError('blog_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/blog/admin/all — admin
router.get('/admin/all', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const items = await db.prepare(`SELECT * FROM blog_posts ORDER BY created_at DESC`).all();
    res.json(items);
  } catch (err) {
    logger.fromError('blog_admin_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/blog/featured — is_featured=1, optional ?lang=en
router.get('/featured', async (req, res) => {
  try {
    const { lang } = req.query;
    const titleCol = lang === 'en' ? `COALESCE(NULLIF(title_en,''), title) as title` : 'title';
    const excerptCol = lang === 'en' ? `COALESCE(NULLIF(excerpt_en,''), excerpt) as excerpt` : 'excerpt';
    const items = await db.prepare(`
      SELECT id, ${titleCol}, slug, ${excerptCol}, cover_image, published_at, created_at
      FROM blog_posts WHERE is_featured = 1 AND is_published = 1
      ORDER BY published_at DESC
    `).all();
    res.json(items);
  } catch (err) {
    logger.fromError('blog_featured_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/blog/:slug — public single, optional ?lang=en
router.get('/:slug', async (req, res) => {
  try {
    const { lang } = req.query;
    let selectCols;
    if (lang === 'en') {
      selectCols = `id, COALESCE(NULLIF(title_en,''), title) as title, slug, COALESCE(NULLIF(excerpt_en,''), excerpt) as excerpt, COALESCE(NULLIF(content_en,''), content) as content, cover_image, is_featured, is_published, published_at, created_at`;
    } else {
      selectCols = '*';
    }
    const item = await db.prepare(`SELECT ${selectCols} FROM blog_posts WHERE slug = ? AND is_published = 1`).get(req.params.slug);
    if (!item) return res.status(404).json({ error: 'Příspěvek nenalezen' });
    res.json(item);
  } catch (err) {
    logger.fromError('blog_get_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// POST /api/blog — admin
router.post('/', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { title, excerpt, content, cover_image, is_featured, is_published, title_en, excerpt_en, content_en, published_at: rawPublishedAt } = req.body;
    if (!title) return res.status(400).json({ error: 'Název je povinný' });

    const slug = generateSlug(title);
    const published_at = rawPublishedAt || (is_published ? new Date().toISOString() : null);

    const result = await db.prepare(`
      INSERT INTO blog_posts (title, slug, excerpt, content, cover_image, is_featured, is_published, published_at, title_en, excerpt_en, content_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, slug, excerpt || null, content || null, cover_image || null,
           is_featured ? 1 : 0, is_published ? 1 : 0, published_at,
           title_en || null, excerpt_en || null, content_en || null);

    const item = await db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(result.lastInsertRowid);
    logger.info('blog_post_created', { id: result.lastInsertRowid, title });
    res.status(201).json({ message: 'Příspěvek vytvořen', item });
  } catch (err) {
    logger.fromError('blog_create_error', err);
    res.status(err.message?.includes('UNIQUE') ? 400 : 500).json({ error: err.message?.includes('UNIQUE') ? 'Slug již existuje' : 'Chyba serveru' });
  }
});

// PUT /api/blog/:id — admin
router.put('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { title, excerpt, content, cover_image, is_featured, is_published, title_en, excerpt_en, content_en, published_at: rawPublishedAt } = req.body;
    if (!title) return res.status(400).json({ error: 'Název je povinný' });

    const slug = generateSlug(title);
    const published_at = rawPublishedAt || (is_published ? new Date().toISOString() : null);

    await db.prepare(`
      UPDATE blog_posts SET title=?, slug=?, excerpt=?, content=?, cover_image=?,
        is_featured=?, is_published=?, published_at=?, title_en=?, excerpt_en=?, content_en=?
      WHERE id=?
    `).run(title, slug, excerpt || null, content || null, cover_image || null,
           is_featured ? 1 : 0, is_published ? 1 : 0, published_at,
           title_en || null, excerpt_en || null, content_en || null, req.params.id);

    const item = await db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(req.params.id);
    logger.info('blog_post_updated', { id: req.params.id });
    res.json({ message: 'Příspěvek aktualizován', item });
  } catch (err) {
    logger.fromError('blog_update_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// DELETE /api/blog/:id — admin
router.delete('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    await db.prepare('DELETE FROM blog_posts WHERE id = ?').run(req.params.id);
    logger.info('blog_post_deleted', { id: req.params.id });
    res.json({ message: 'Příspěvek smazán' });
  } catch (err) {
    logger.fromError('blog_delete_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;
