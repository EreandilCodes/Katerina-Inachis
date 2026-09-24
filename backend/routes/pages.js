import express from 'express';
import db, { DEFAULT_PAGE_SLUGS } from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

const MAX_INTRO_LENGTH = 20000;
const MAX_TITLE_LENGTH = 200;

// Czech plural: 1 → one, 2–4 → few, 5+ → many.
function pluralCs(n, one, few, many) {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

const PAGE_SELECT = `
  SELECT p.id, p.slug, p.title, p.intro_text, p.is_visible, p.sort_order, p.category_id,
         c.name AS category_name, COALESCE(c.is_visible, 1) AS category_is_visible
  FROM pages p
  LEFT JOIN categories c ON c.id = p.category_id
`;

function normalizeVisibility(value) {
  return value === false || value === 0 || value === '0' ? 0 : 1;
}

function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug);
}

// GET /api/pages — public list (intro texts + menu metadata; visibility is
// respected by the public navigation, hidden pages stay directly accessible)
router.get('/', async (_req, res) => {
  try {
    const rows = await db.prepare(`${PAGE_SELECT} ORDER BY p.id`).all();
    res.json(rows);
  } catch (err) {
    logger.fromError('pages_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/pages/:slug — public single page
router.get('/:slug', async (req, res) => {
  try {
    const page = await db.prepare(`${PAGE_SELECT} WHERE p.slug = ?`).get(req.params.slug);
    if (!page) return res.status(404).json({ error: 'Stránka nenalezena' });
    res.json(page);
  } catch (err) {
    logger.fromError('pages_get_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// POST /api/pages — admin creates a new menu item / page.
// Slug is the URL path (first segment, e.g. "umeni"); the existing router
// decides what a path renders. Visibility controls the public navigation only.
router.post('/', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { title, slug, category_id, sort_order, is_visible } = req.body || {};

    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Název stránky je povinný' });
    }
    if (title.trim().length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `Název stránky je příliš dlouhý (max ${MAX_TITLE_LENGTH} znaků)` });
    }
    if (typeof slug !== 'string' || !isValidSlug(slug)) {
      return res.status(400).json({ error: 'Neplatná URL (použijte malá písmena, číslice a spojovníky)' });
    }

    let catId = null;
    if (category_id !== undefined && category_id !== null && category_id !== '') {
      catId = Number(category_id) || null;
      const cat = catId ? await db.prepare('SELECT id FROM categories WHERE id = ?').get(catId) : null;
      if (!cat) return res.status(400).json({ error: 'Neznámá kategorie' });
    }

    const result = await db.prepare(`
      INSERT INTO pages (slug, title, intro_text, category_id, is_visible, sort_order)
      VALUES (?, ?, '', ?, ?, ?)
    `).run(slug, title.trim(), catId, normalizeVisibility(is_visible), Number(sort_order) || 0);

    const item = await db.prepare(`${PAGE_SELECT} WHERE p.id = ?`).get(result.lastInsertRowid);
    logger.info('page_created', { id: result.lastInsertRowid, slug, title });
    res.status(201).json({ message: 'Stránka vytvořena', item });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      logger.fromError('pages_create_error_unique', err, { slug: req.body?.slug });
      return res.status(400).json({ error: 'Stránka s touto URL již existuje' });
    }
    logger.fromError('pages_create_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// PUT /api/pages/:slug — admin updates a page (intro text + menu metadata).
// Backwards compatible: sending only { intro_text } behaves exactly as before.
router.put('/:slug', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { slug } = req.params;
    const body = req.body || {};

    const current = await db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
    if (!current) {
      return res.status(400).json({ error: `Neznámý identifikátor stránky: ${slug}` });
    }

    let introText = current.intro_text;
    if (body.intro_text !== undefined) {
      if (typeof body.intro_text !== 'string') {
        return res.status(400).json({ error: 'Chybí text úvodu' });
      }
      if (body.intro_text.length > MAX_INTRO_LENGTH) {
        return res.status(400).json({ error: `Text úvodu je příliš dlouhý (max ${MAX_INTRO_LENGTH} znaků)` });
      }
      introText = body.intro_text;
    }

    let title = current.title;
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return res.status(400).json({ error: 'Název stránky je povinný' });
      }
      if (body.title.trim().length > MAX_TITLE_LENGTH) {
        return res.status(400).json({ error: `Název stránky je příliš dlouhý (max ${MAX_TITLE_LENGTH} znaků)` });
      }
      title = body.title.trim();
    }

    let catId = current.category_id;
    if (body.category_id !== undefined) {
      catId = body.category_id === null || body.category_id === '' ? null : (Number(body.category_id) || null);
      if (catId) {
        const cat = await db.prepare('SELECT id FROM categories WHERE id = ?').get(catId);
        if (!cat) return res.status(400).json({ error: 'Neznámá kategorie' });
      }
    }

    const is_visible = body.is_visible !== undefined ? normalizeVisibility(body.is_visible) : current.is_visible;
    const sort_order = body.sort_order !== undefined ? Number(body.sort_order) || 0 : current.sort_order;

    await db.prepare(`
      UPDATE pages SET intro_text = ?, title = ?, category_id = ?, is_visible = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE slug = ?
    `).run(introText, title, catId, is_visible, sort_order, slug);

    const item = await db.prepare(`${PAGE_SELECT} WHERE p.slug = ?`).get(slug);
    logger.info('page_updated', { slug });
    res.json({ message: 'Úvodní text uložen', slug, ...(item ? { item } : {}) });
  } catch (err) {
    logger.fromError('pages_update_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// DELETE /api/pages/:slug — admin-only permanent deletion.
// Two dependency rules keep the public navigation and admin UI consistent:
//   1. System pages (the seeded site skeleton, DEFAULT_PAGE_SLUGS) can only be
//      hidden — they are recreated on every startup anyway, so deleting them
//      would silently resurrect empty on the next deploy.
//   2. A page that still has subcategories (categories.page_slug) is blocked —
//      no child category may be left pointing at a parent page that is gone.
// There is no ON DELETE CASCADE anywhere: deleting a page removes only the page
// row itself (slug, title, intro_text, menu metadata). Content that references
// it (subcategories) blocks the deletion instead of being silently deleted.
router.delete('/:slug', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { slug } = req.params;

    const page = await db.prepare('SELECT id, slug, title FROM pages WHERE slug = ?').get(slug);
    if (!page) return res.status(404).json({ error: 'Stránka nenalezena' });

    if (DEFAULT_PAGE_SLUGS.includes(slug)) {
      return res.status(409).json({ error: 'Systémovou stránku nelze smazat — lze ji pouze skrýt.' });
    }

    const childCount = (await db.prepare('SELECT COUNT(*) AS n FROM categories WHERE page_slug = ?').get(slug))?.n || 0;
    if (childCount > 0) {
      return res.status(409).json({
        error: `Tuto stránku nelze smazat, protože obsahuje ${childCount} ${pluralCs(childCount, 'podkategorii', 'podkategorie', 'podkategorií')}. Nejprve je přesuňte nebo odstraňte.`,
      });
    }

    await db.prepare('DELETE FROM pages WHERE id = ?').run(page.id);
    logger.info('page_deleted', { slug });
    res.json({ message: 'Stránka odstraněna' });
  } catch (err) {
    logger.fromError('pages_delete_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;