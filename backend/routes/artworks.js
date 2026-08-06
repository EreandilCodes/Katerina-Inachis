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

// GET /api/artworks — published, optional ?collection=&lang=en
router.get('/', async (req, res) => {
  try {
    const { collection, lang } = req.query;
    const titleCol = lang === 'en' ? `COALESCE(NULLIF(title_en,''), title) as title` : 'title';
    const descCol = lang === 'en' ? `COALESCE(NULLIF(description_en,''), description) as description` : 'description';
    let sql = `SELECT id, ${titleCol}, slug, ${descCol}, cover_image, images_json, collection, medium, year, is_featured, sort_order, created_at
               FROM artworks WHERE is_published = 1`;
    const params = [];
    if (collection) {
      sql += ' AND collection = ?';
      params.push(collection);
    }
    sql += ' ORDER BY sort_order ASC, created_at DESC';
    const items = await db.prepare(sql).all(...params);
    res.json(items);
  } catch (err) {
    logger.fromError('artworks_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/artworks/admin/all — admin
router.get('/admin/all', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const items = await db.prepare(`SELECT * FROM artworks ORDER BY sort_order ASC, created_at DESC`).all();
    res.json(items);
  } catch (err) {
    logger.fromError('artworks_admin_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/artworks/featured — is_featured=1, published, optional ?lang=en
router.get('/featured', async (req, res) => {
  try {
    const { lang } = req.query;
    const titleCol = lang === 'en' ? `COALESCE(NULLIF(title_en,''), title) as title` : 'title';
    const descCol = lang === 'en' ? `COALESCE(NULLIF(description_en,''), description) as description` : 'description';
    const items = await db.prepare(`
      SELECT id, ${titleCol}, slug, ${descCol}, cover_image, collection, medium, year, sort_order, created_at
      FROM artworks WHERE is_featured = 1 AND is_published = 1
      ORDER BY sort_order ASC, created_at DESC
    `).all();
    res.json(items);
  } catch (err) {
    logger.fromError('artworks_featured_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/artworks/:slug — public single, optional ?lang=en
router.get('/:slug', async (req, res) => {
  try {
    const { lang } = req.query;
    let selectCols;
    if (lang === 'en') {
      selectCols = `id, COALESCE(NULLIF(title_en,''), title) as title, slug, COALESCE(NULLIF(description_en,''), description) as description, cover_image, images_json, collection, medium, year, is_featured, is_published, sort_order, created_at`;
    } else {
      selectCols = '*';
    }
    const item = await db.prepare(`SELECT ${selectCols} FROM artworks WHERE slug = ? AND is_published = 1`).get(req.params.slug);
    if (!item) return res.status(404).json({ error: 'Dílo nenalezeno' });
    res.json(item);
  } catch (err) {
    logger.fromError('artworks_get_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// POST /api/artworks — admin
router.post('/', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { title, description, cover_image, images_json, collection, medium, year, is_featured, is_published, sort_order, title_en, description_en } = req.body;
    if (!title) return res.status(400).json({ error: 'Název je povinný' });

    const slug = generateSlug(title);

    const result = await db.prepare(`
      INSERT INTO artworks (title, slug, description, cover_image, images_json, collection, medium, year, is_featured, is_published, sort_order, title_en, description_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, slug, description || null, cover_image || null, images_json || null,
           collection || null, medium || null, year || null,
           is_featured ? 1 : 0, is_published ? 1 : 0, sort_order || 0,
           title_en || null, description_en || null);

    const item = await db.prepare('SELECT * FROM artworks WHERE id = ?').get(result.lastInsertRowid);
    logger.info('artwork_created', { id: result.lastInsertRowid, title });
    res.status(201).json({ message: 'Dílo vytvořeno', item });
  } catch (err) {
    logger.fromError('artworks_create_error', err);
    res.status(err.message?.includes('UNIQUE') ? 400 : 500).json({ error: err.message?.includes('UNIQUE') ? 'Slug již existuje' : 'Chyba serveru' });
  }
});

// PUT /api/artworks/:id — admin
router.put('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { title, description, cover_image, images_json, collection, medium, year, is_featured, is_published, sort_order, title_en, description_en } = req.body;
    if (!title) return res.status(400).json({ error: 'Název je povinný' });

    const slug = generateSlug(title);

    await db.prepare(`
      UPDATE artworks SET title=?, slug=?, description=?, cover_image=?, images_json=?, collection=?,
        medium=?, year=?, is_featured=?, is_published=?, sort_order=?, title_en=?, description_en=?
      WHERE id=?
    `).run(title, slug, description || null, cover_image || null, images_json || null,
           collection || null, medium || null, year || null,
           is_featured ? 1 : 0, is_published ? 1 : 0, sort_order || 0,
           title_en || null, description_en || null, req.params.id);

    const item = await db.prepare('SELECT * FROM artworks WHERE id = ?').get(req.params.id);
    logger.info('artwork_updated', { id: req.params.id });
    res.json({ message: 'Dílo aktualizováno', item });
  } catch (err) {
    logger.fromError('artworks_update_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// DELETE /api/artworks/:id — admin
router.delete('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    await db.prepare('DELETE FROM artworks WHERE id = ?').run(req.params.id);
    logger.info('artwork_deleted', { id: req.params.id });
    res.json({ message: 'Dílo smazáno' });
  } catch (err) {
    logger.fromError('artworks_delete_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;
