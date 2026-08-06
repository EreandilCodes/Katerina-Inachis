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

// GET /api/friend-posts — all published (public, optional ?friend_id=&lang=en)
router.get('/', async (req, res) => {
  try {
    const { friend_id, lang } = req.query;
    const titleCol = lang === 'en' ? `COALESCE(NULLIF(fp.title_en,''), fp.title) as title` : 'fp.title';
    const excerptCol = lang === 'en' ? `COALESCE(NULLIF(fp.excerpt_en,''), fp.excerpt) as excerpt` : 'fp.excerpt';
    let sql = `
      SELECT fp.id, fp.friend_id, ${titleCol}, fp.slug, fp.type, ${excerptCol}, fp.cover_image,
             fp.images_json, fp.published_at, fp.created_at, f.name as friend_name, f.slug as friend_slug
      FROM friend_posts fp
      JOIN friends f ON fp.friend_id = f.id
      WHERE fp.is_published = 1 AND f.is_active = 1
    `;
    const params = [];
    if (friend_id) {
      sql += ' AND fp.friend_id = ?';
      params.push(friend_id);
    }
    sql += ' ORDER BY fp.published_at DESC, fp.created_at DESC';
    const items = await db.prepare(sql).all(...params);
    res.json(items);
  } catch (err) {
    logger.fromError('friend_posts_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/friend-posts/admin/all — admin
router.get('/admin/all', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const items = await db.prepare(`
      SELECT fp.*, f.name as friend_name, f.slug as friend_slug
      FROM friend_posts fp
      JOIN friends f ON fp.friend_id = f.id
      ORDER BY fp.created_at DESC
    `).all();
    res.json(items);
  } catch (err) {
    logger.fromError('friend_posts_admin_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/friend-posts/by-friend/:friendSlug — published posts for one friend, optional ?lang=en
router.get('/by-friend/:friendSlug', async (req, res) => {
  try {
    const { lang } = req.query;
    const friend = await db.prepare(`SELECT * FROM friends WHERE slug = ? AND is_active = 1`).get(req.params.friendSlug);
    if (!friend) return res.status(404).json({ error: 'Přítel nenalezen' });

    const titleCol = lang === 'en' ? `COALESCE(NULLIF(title_en,''), title) as title` : 'title';
    const excerptCol = lang === 'en' ? `COALESCE(NULLIF(excerpt_en,''), excerpt) as excerpt` : 'excerpt';
    const items = await db.prepare(`
      SELECT id, friend_id, ${titleCol}, slug, type, ${excerptCol}, cover_image, images_json, published_at, created_at
      FROM friend_posts WHERE friend_id = ? AND is_published = 1
      ORDER BY published_at DESC, created_at DESC
    `).all(friend.id);
    res.json({ friend, posts: items });
  } catch (err) {
    logger.fromError('friend_posts_by_friend_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/friend-posts/:slug — single post (public), optional ?lang=en
router.get('/:slug', async (req, res) => {
  try {
    const { lang } = req.query;
    let selectCols;
    if (lang === 'en') {
      selectCols = `fp.id, fp.friend_id, COALESCE(NULLIF(fp.title_en,''), fp.title) as title, fp.slug, fp.type, COALESCE(NULLIF(fp.excerpt_en,''), fp.excerpt) as excerpt, COALESCE(NULLIF(fp.content_en,''), fp.content) as content, fp.cover_image, fp.images_json, fp.is_published, fp.published_at, fp.created_at, f.name as friend_name, f.slug as friend_slug, f.avatar as friend_avatar`;
    } else {
      selectCols = `fp.*, f.name as friend_name, f.slug as friend_slug, f.avatar as friend_avatar`;
    }
    const item = await db.prepare(`
      SELECT ${selectCols}
      FROM friend_posts fp
      JOIN friends f ON fp.friend_id = f.id
      WHERE fp.slug = ? AND fp.is_published = 1 AND f.is_active = 1
    `).get(req.params.slug);
    if (!item) return res.status(404).json({ error: 'Příspěvek nenalezen' });
    res.json(item);
  } catch (err) {
    logger.fromError('friend_posts_get_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// POST /api/friend-posts — admin
router.post('/', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { friend_id, title, type, excerpt, content, cover_image, images_json, is_published, title_en, excerpt_en, content_en, published_at: rawPublishedAt } = req.body;
    if (!friend_id) return res.status(400).json({ error: 'Přítel je povinný' });
    if (!title) return res.status(400).json({ error: 'Název je povinný' });

    const friend = await db.prepare('SELECT id FROM friends WHERE id = ?').get(friend_id);
    if (!friend) return res.status(400).json({ error: 'Přítel neexistuje' });

    const slug = generateSlug(title);
    const published_at = rawPublishedAt || (is_published ? new Date().toISOString() : null);

    const result = await db.prepare(`
      INSERT INTO friend_posts (friend_id, title, slug, type, excerpt, content, cover_image, images_json, is_published, published_at, title_en, excerpt_en, content_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(friend_id, title, slug, type || 'text', excerpt || null, content || null,
           cover_image || null, images_json || null, is_published ? 1 : 0, published_at,
           title_en || null, excerpt_en || null, content_en || null);

    const item = await db.prepare('SELECT * FROM friend_posts WHERE id = ?').get(result.lastInsertRowid);
    logger.info('friend_post_created', { id: result.lastInsertRowid, title });
    res.status(201).json({ message: 'Příspěvek vytvořen', item });
  } catch (err) {
    logger.fromError('friend_posts_create_error', err);
    res.status(err.message?.includes('UNIQUE') ? 400 : 500).json({ error: err.message?.includes('UNIQUE') ? 'Slug již existuje' : 'Chyba serveru' });
  }
});

// PUT /api/friend-posts/:id — admin
router.put('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { friend_id, title, type, excerpt, content, cover_image, images_json, is_published, title_en, excerpt_en, content_en, published_at: rawPublishedAt } = req.body;
    if (!friend_id) return res.status(400).json({ error: 'Přítel je povinný' });
    if (!title) return res.status(400).json({ error: 'Název je povinný' });

    const slug = generateSlug(title);
    const published_at = rawPublishedAt || (is_published ? new Date().toISOString() : null);

    await db.prepare(`
      UPDATE friend_posts SET friend_id=?, title=?, slug=?, type=?, excerpt=?, content=?,
        cover_image=?, images_json=?, is_published=?, published_at=?, title_en=?, excerpt_en=?, content_en=?
      WHERE id=?
    `).run(friend_id, title, slug, type || 'text', excerpt || null, content || null,
           cover_image || null, images_json || null, is_published ? 1 : 0, published_at,
           title_en || null, excerpt_en || null, content_en || null, req.params.id);

    const item = await db.prepare('SELECT * FROM friend_posts WHERE id = ?').get(req.params.id);
    logger.info('friend_post_updated', { id: req.params.id });
    res.json({ message: 'Příspěvek aktualizován', item });
  } catch (err) {
    logger.fromError('friend_posts_update_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// DELETE /api/friend-posts/:id — admin
router.delete('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    await db.prepare('DELETE FROM friend_posts WHERE id = ?').run(req.params.id);
    logger.info('friend_post_deleted', { id: req.params.id });
    res.json({ message: 'Příspěvek smazán' });
  } catch (err) {
    logger.fromError('friend_posts_delete_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;
