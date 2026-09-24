import express from 'express';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';
import {
  TAG_CONTENT_TYPES,
  slugifyTag,
  getTagsForContent,
  replaceContentTags,
  deleteContentTags,
  contentExists,
} from '../tags.js';

const router = express.Router();

// ── Public: all tags (lightweight; item_count = current number of links) ──
router.get('/', async (_req, res) => {
  try {
    const tags = await db.prepare(`
      SELECT t.id, t.name, t.slug, t.created_at, COUNT(ct.id) AS item_count
      FROM tags t
      LEFT JOIN content_tags ct ON ct.tag_id = t.id
      GROUP BY t.id
      ORDER BY lower(t.name), t.id
    `).all();
    res.json(tags);
  } catch (err) {
    logger.fromError('tags_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// ── Admin: all tags with link counts ─────────────────────────────────────
router.get('/admin/all', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (_req, res) => {
  try {
    const tags = await db.prepare(`
      SELECT t.id, t.name, t.slug, t.created_at, COUNT(ct.id) AS item_count
      FROM tags t
      LEFT JOIN content_tags ct ON ct.tag_id = t.id
      GROUP BY t.id
      ORDER BY lower(t.name), t.id
    `).all();
    res.json(tags);
  } catch (err) {
    logger.fromError('tags_admin_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// ── Admin: tags of a single content item (editor chips) ──────────────────
router.get('/admin/by-content', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { content_type, content_id } = req.query;
    if (!TAG_CONTENT_TYPES.includes(content_type)) {
      return res.status(400).json({ error: 'Neplatný typ obsahu' });
    }
    const tags = await getTagsForContent(content_type, Number(content_id));
    res.json(tags);
  } catch (err) {
    logger.fromError('tags_by_content_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// ── Admin: replace the tag set of one content item ────────────────────────
router.post('/admin/assign', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { content_type, content_id, tag_ids } = req.body;
    if (!TAG_CONTENT_TYPES.includes(content_type)) {
      return res.status(400).json({ error: 'Neplatný typ obsahu' });
    }
    const id = Number(content_id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Neplatné ID obsahu' });
    }
    if (!(await contentExists(content_type, id))) {
      return res.status(404).json({ error: 'Obsah neexistuje' });
    }
    const tags = await replaceContentTags(content_type, id, tag_ids || []);
    logger.info('tags_assigned', { content_type, content_id: id, count: tags.length });
    res.json({ message: 'Štítky uloženy', tags });
  } catch (err) {
    logger.fromError('tags_assign_error', err);
    res.status(err.message === 'Neexistující štítek' ? 400 : 500).json({
      error: err.message === 'Neexistující štítek' ? 'Štítek neexistuje' : 'Chyba serveru',
    });
  }
});

// ── Admin: create tag ────────────────────────────────────────────────────
router.post('/', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Název štítku je povinný' });
    }
    const cleanName = String(name).trim();
    const slug = slugifyTag(cleanName);
    if (!slug) return res.status(400).json({ error: 'Z názvu nelze vytvořit URL' });
    if (await db.prepare('SELECT id FROM tags WHERE slug = ?').get(slug)) {
      return res.status(400).json({ error: 'Štítek s tímto názvem (URL) již existuje' });
    }
    if (await db.prepare('SELECT id FROM tags WHERE name_key = ?').get(cleanName.toLowerCase())) {
      return res.status(400).json({ error: 'Štítek s tímto názvem již existuje' });
    }

    const result = await db.prepare(
      'INSERT INTO tags (name, name_key, slug) VALUES (?, ?, ?)'
    ).run(cleanName, cleanName.toLowerCase(), slug);
    const item = await db.prepare('SELECT id, name, slug, created_at FROM tags WHERE id = ?').get(result.lastInsertRowid);
    logger.info('tag_created', { id: result.lastInsertRowid, name: cleanName });
    res.status(201).json({ message: 'Štítek vytvořen', item });
  } catch (err) {
    logger.fromError('tags_create_error', err);
    res.status(err.message?.includes('UNIQUE') ? 400 : 500).json({ error: err.message?.includes('UNIQUE') ? 'Štítek s tímto názvem již existuje' : 'Chyba serveru' });
  }
});

// ── Admin: rename tag (slug / public URL stays immutable) ────────────────
router.put('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Název štítku je povinný' });
    }
    const cleanName = String(name).trim();
    const tag = await db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!tag) return res.status(404).json({ error: 'Štítek nenalezen' });

    const dupSlug = await db.prepare('SELECT id FROM tags WHERE slug = ? AND id <> ?')
      .get(slugifyTag(cleanName), req.params.id);
    if (dupSlug) return res.status(400).json({ error: 'Štítek s tímto názvem (URL) již existuje' });
    const dupName = await db.prepare('SELECT id FROM tags WHERE name_key = ? AND id <> ?')
      .get(cleanName.toLowerCase(), req.params.id);
    if (dupName) return res.status(400).json({ error: 'Štítek s tímto názvem již existuje' });

    await db.prepare('UPDATE tags SET name = ?, name_key = ? WHERE id = ?')
      .run(cleanName, cleanName.toLowerCase(), req.params.id);
    const item = await db.prepare('SELECT id, name, slug, created_at FROM tags WHERE id = ?').get(req.params.id);
    logger.info('tag_updated', { id: req.params.id, name: cleanName });
    res.json({ message: 'Štítek uložen', item });
  } catch (err) {
    logger.fromError('tags_update_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// ── Admin: delete tag (removes links only, content untouched) ────────────
router.delete('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    await db.prepare('DELETE FROM content_tags WHERE tag_id = ?').run(req.params.id);
    const result = await db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Štítek nenalezen' });
    logger.info('tag_deleted', { id: req.params.id });
    res.json({ message: 'Štítek odstraněn' });
  } catch (err) {
    logger.fromError('tags_delete_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// ── Public: tag detail + published items across all content types ────────
// Only published content is listed; drafts and hidden friends' posts never
// surface here. Items carry their public URL + section so the tag page can
// render cross-category links.
router.get('/:slug', async (req, res) => {
  try {
    const lang = req.query.lang === 'en';
    const tag = await db.prepare('SELECT * FROM tags WHERE slug = ?').get(req.params.slug);
    if (!tag) return res.status(404).json({ error: 'Štítek nenalezen' });

    const tc = (t) => (lang ? `COALESCE(NULLIF(${t}.title_en,''), ${t}.title) as title` : `${t}.title as title`);
    const ec = (t) => (lang ? `COALESCE(NULLIF(${t}.excerpt_en,''), ${t}.excerpt) as excerpt` : `${t}.excerpt as excerpt`);

    const [texts, artworks, jewelry, blogPosts, programmingPosts, friendPosts] = await Promise.all([
      db.prepare(`
        SELECT 'text' as content_type, ${tc('x')}, ${ec('x')}, x.cover_image, x.category as sub,
               x.published_at, x.created_at, x.slug as item_slug, NULL as author
        FROM content_tags c
        JOIN tags t ON t.id = c.tag_id
        JOIN texts x ON x.id = c.content_id AND c.content_type = 'text'
        WHERE t.slug = ? AND x.is_published = 1
      `).all(req.params.slug),
      db.prepare(`
        SELECT 'artwork' as content_type, ${tc('x')}, NULL as excerpt, x.cover_image, x.collection as sub,
               NULL as published_at, x.created_at, x.slug as item_slug, NULL as author
        FROM content_tags c
        JOIN tags t ON t.id = c.tag_id
        JOIN artworks x ON x.id = c.content_id AND c.content_type = 'artwork'
        WHERE t.slug = ? AND x.is_published = 1
      `).all(req.params.slug),
      db.prepare(`
        SELECT 'jewelry' as content_type, ${tc('x')}, NULL as excerpt, x.cover_image, x.collection as sub,
               NULL as published_at, x.created_at, x.slug as item_slug, NULL as author
        FROM content_tags c
        JOIN tags t ON t.id = c.tag_id
        JOIN jewelry x ON x.id = c.content_id AND c.content_type = 'jewelry'
        WHERE t.slug = ? AND x.is_published = 1
      `).all(req.params.slug),
      db.prepare(`
        SELECT 'blog_post' as content_type, ${tc('x')}, ${ec('x')}, x.cover_image, NULL as sub,
               x.published_at, x.created_at, x.slug as item_slug, NULL as author
        FROM content_tags c
        JOIN tags t ON t.id = c.tag_id
        JOIN blog_posts x ON x.id = c.content_id AND c.content_type = 'blog_post'
        WHERE t.slug = ? AND x.is_published = 1
      `).all(req.params.slug),
      db.prepare(`
        SELECT 'programming_post' as content_type, ${tc('x')}, ${ec('x')}, x.cover_image, NULL as sub,
               x.published_at, x.created_at, x.slug as item_slug, NULL as author
        FROM content_tags c
        JOIN tags t ON t.id = c.tag_id
        JOIN programming_posts x ON x.id = c.content_id AND c.content_type = 'programming_post'
        WHERE t.slug = ? AND x.is_published = 1
      `).all(req.params.slug),
      db.prepare(`
        SELECT 'friend_post' as content_type, ${tc('x')}, ${ec('x')}, x.cover_image, x.type as sub,
               x.published_at, x.created_at, x.slug as item_slug, f.name as author, f.slug as author_slug
        FROM content_tags c
        JOIN tags t ON t.id = c.tag_id
        JOIN friend_posts x ON x.id = c.content_id AND c.content_type = 'friend_post'
        JOIN friends f ON f.id = x.friend_id
        WHERE t.slug = ? AND x.is_published = 1 AND f.is_active = 1
      `).all(req.params.slug),
    ]);

    const SECTION_FOR = {
      text:             'texty',
      artwork:          'umeni',
      jewelry:          'kresba',
      blog_post:        'blog',
      programming_post: 'programovani',
      friend_post:      'pratele',
    };
    const items = [...texts, ...artworks, ...jewelry, ...blogPosts, ...programmingPosts, ...friendPosts]
      .map((row) => ({
        content_type: row.content_type,
        title: row.title,
        excerpt: row.excerpt,
        cover_image: row.cover_image,
        sub: row.sub,
        author: row.author,
        section: SECTION_FOR[row.content_type],
        url: row.content_type === 'friend_post'
          ? `/pratele/${row.author_slug}/${row.item_slug}`
          : `/${SECTION_FOR[row.content_type]}/${row.item_slug}`,
        published_at: row.published_at,
        created_at: row.created_at,
      }))
      .sort((a, b) => {
        const da = Date.parse(a.published_at || a.created_at) || 0;
        const dbv = Date.parse(b.published_at || b.created_at) || 0;
        return dbv - da;
      });

    res.json({ tag: { id: tag.id, name: tag.name, slug: tag.slug }, items });
  } catch (err) {
    logger.fromError('tags_get_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;