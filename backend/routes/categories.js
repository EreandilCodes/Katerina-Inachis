import express from 'express';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

const MAX_NAME_LENGTH = 100;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

const CATEGORY_SELECT = 'SELECT id, name, slug, page_slug, is_visible, sort_order FROM categories';

// Group top-level (page_slug NULL) categories first, then children grouped by
// parent page, each ordered by sort_order. Same shape for SQLite and Postgres.
const CATEGORY_ORDER = 'ORDER BY (page_slug IS NULL) DESC, page_slug ASC, sort_order ASC, id ASC';

function normalizeVisibility(value) {
  return value === false || value === 0 || value === '0' ? 0 : 1;
}

function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

// Same normalisation as routes/texts.js generateSlug(): lowercase, strip
// diacritics, collapse to a URL-safe slug.
function generateSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// page_slug must be NULL or reference an existing page (NULL = top-level
// menu grouping category; non-NULL = subcategory of that menu page).
async function normalizePageSlug(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const page = await db.prepare('SELECT slug FROM pages WHERE slug = ?').get(raw);
  return page ? raw : undefined; // undefined marks "unknown page"
}

async function slugTaken(slug, exceptId = null) {
  const row = exceptId
    ? await db.prepare('SELECT id FROM categories WHERE slug = ? AND id != ?').get(slug, exceptId)
    : await db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
  return !!row;
}

// GET /api/categories — public list of visible categories
router.get('/', async (_req, res) => {
  try {
    const rows = await db.prepare(
      `${CATEGORY_SELECT} WHERE is_visible = 1 ${CATEGORY_ORDER}`
    ).all();
    res.json(rows);
  } catch (err) {
    logger.fromError('categories_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/categories/public/all — public list of ALL categories (including
// hidden ones). Hidden ≠ deleted: the public SPA needs hidden subcategories
// to keep resolving their direct URLs (/texty/povidky) while hiding their
// nav entry; visibility flags let the client decide what to render.
router.get('/public/all', async (_req, res) => {
  try {
    const rows = await db.prepare(`${CATEGORY_SELECT} ${CATEGORY_ORDER}`).all();
    res.json(rows);
  } catch (err) {
    logger.fromError('categories_public_all_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/categories/admin/all — admin sees all (incl. hidden)
router.get('/admin/all', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (_req, res) => {
  try {
    const rows = await db.prepare(`${CATEGORY_SELECT} ${CATEGORY_ORDER}`).all();
    res.json(rows);
  } catch (err) {
    logger.fromError('categories_admin_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// POST /api/categories — admin creates a category.
// Optional slug/page_slug define a subcategory that nests under a menu page
// (page_slug) and is reachable via /<page_slug>/<slug>. When page_slug is set
// and no slug is given, the slug is generated from the name.
router.post('/', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Název kategorie je povinný' });
    }
    if (name.trim().length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: `Název kategorie je příliš dlouhý (max ${MAX_NAME_LENGTH} znaků)` });
    }

    const page_slug = await normalizePageSlug(req.body.page_slug);
    if (page_slug === undefined) {
      return res.status(400).json({ error: 'Neznámá hlavní stránka (page_slug)' });
    }

    let slug = typeof req.body.slug === 'string' && req.body.slug.trim()
      ? req.body.slug.trim().toLowerCase()
      : null;
    if (page_slug && !slug) slug = generateSlug(name.trim());
    if (slug !== null && !isValidSlug(slug)) {
      return res.status(400).json({ error: 'Neplatná URL (slug) — použijte malá písmena, číslice a spojovníky' });
    }
    if (slug !== null && (await slugTaken(slug))) {
      return res.status(400).json({ error: 'Kategorie s touto URL (slug) již existuje' });
    }

    const sort_order = Number(req.body.sort_order) || 0;
    const is_visible = normalizeVisibility(req.body.is_visible);

    const result = await db.prepare(
      `INSERT INTO categories (name, slug, page_slug, is_visible, sort_order) VALUES (?, ?, ?, ?, ?)`
    ).run(name.trim(), slug, page_slug, is_visible, sort_order);

    const item = await db.prepare(`${CATEGORY_SELECT} WHERE id = ?`).get(result.lastInsertRowid);
    logger.info('category_created', { id: result.lastInsertRowid, name, slug, page_slug });
    res.status(201).json({ message: 'Kategorie vytvořena', item });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      logger.fromError('categories_create_error_unique', err, { name: req.body?.name, slug: req.body?.slug });
      return res.status(400).json({ error: 'Kategorie s tímto názvem již existuje' });
    }
    logger.fromError('categories_create_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// PUT /api/categories/:id — admin updates a category (name / visibility /
// order / parent page). The slug (URL) is immutable after creation; renaming
// cascades to texts.category so existing content stays associated.
router.put('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Neplatný identifikátor kategorie' });

    const current = await db.prepare(`${CATEGORY_SELECT} WHERE id = ?`).get(id);
    if (!current) return res.status(404).json({ error: 'Kategorie nenalezena' });

    let name = current.name;
    if (req.body && req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
        return res.status(400).json({ error: 'Název kategorie je povinný' });
      }
      if (req.body.name.trim().length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `Název kategorie je příliš dlouhý (max ${MAX_NAME_LENGTH} znaků)` });
      }
      name = req.body.name.trim();
    }

    if (req.body && req.body.slug !== undefined) {
      const slug = typeof req.body.slug === 'string' ? req.body.slug.trim().toLowerCase() : '';
      if (slug !== current.slug) {
        return res.status(400).json({ error: 'URL (slug) kategorie nelze po vytvoření měnit' });
      }
    }

    let page_slug = current.page_slug;
    if (req.body && req.body.page_slug !== undefined) {
      const normalized = await normalizePageSlug(req.body.page_slug);
      if (normalized === undefined) {
        return res.status(400).json({ error: 'Neznámá hlavní stránka (page_slug)' });
      }
      page_slug = normalized;
    }

    const sort_order = req.body && req.body.sort_order !== undefined ? Number(req.body.sort_order) || 0 : current.sort_order;
    const is_visible = req.body && req.body.is_visible !== undefined ? normalizeVisibility(req.body.is_visible) : current.is_visible;

    await db.prepare(
      `UPDATE categories SET name = ?, page_slug = ?, is_visible = ?, sort_order = ? WHERE id = ?`
    ).run(name, page_slug, is_visible, sort_order, id);

    // Keep text associations intact on rename: texts.category stores the
    // category name, so re-point the old name at the new one.
    if (name !== current.name) {
      await db.prepare('UPDATE texts SET category = ? WHERE category = ?').run(name, current.name);
    }

    const item = await db.prepare(`${CATEGORY_SELECT} WHERE id = ?`).get(id);
    logger.info('category_updated', { id, name, page_slug });
    res.json({ message: 'Kategorie uložena', item });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      logger.fromError('categories_update_error_unique', err, { id: req.params.id });
      return res.status(400).json({ error: 'Kategorie s tímto názvem již existuje' });
    }
    logger.fromError('categories_update_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// DELETE /api/categories/:id — admin-only cleanup (not exposed in the UI;
// visibility is the intended way to remove a category from view). Pages that
// referenced the category are detached, not deleted.
router.delete('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Neplatný identifikátor kategorie' });

    const result = await db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Kategorie nenalezena' });

    await db.prepare('UPDATE pages SET category_id = NULL WHERE category_id = ?').run(id);
    logger.info('category_deleted', { id });
    res.json({ message: 'Kategorie odstraněna' });
  } catch (err) {
    logger.fromError('categories_delete_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;
