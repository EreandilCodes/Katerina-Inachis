import express from 'express';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

const MAX_NAME_LENGTH = 100;

function normalizeVisibility(value) {
  return value === false || value === 0 || value === '0' ? 0 : 1;
}

// GET /api/categories — public list of visible categories
router.get('/', async (_req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT id, name, is_visible, sort_order FROM categories WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC`
    ).all();
    res.json(rows);
  } catch (err) {
    logger.fromError('categories_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/categories/admin/all — admin sees all (incl. hidden)
router.get('/admin/all', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (_req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT id, name, is_visible, sort_order FROM categories ORDER BY sort_order ASC, id ASC`
    ).all();
    res.json(rows);
  } catch (err) {
    logger.fromError('categories_admin_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// POST /api/categories — admin creates a category
router.post('/', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Název kategorie je povinný' });
    }
    if (name.trim().length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: `Název kategorie je příliš dlouhý (max ${MAX_NAME_LENGTH} znaků)` });
    }

    const sort_order = Number(req.body.sort_order) || 0;
    const is_visible = normalizeVisibility(req.body.is_visible);

    const result = await db.prepare(
      `INSERT INTO categories (name, is_visible, sort_order) VALUES (?, ?, ?)`
    ).run(name.trim(), is_visible, sort_order);

    const item = await db.prepare('SELECT id, name, is_visible, sort_order FROM categories WHERE id = ?').get(result.lastInsertRowid);
    logger.info('category_created', { id: result.lastInsertRowid, name });
    res.status(201).json({ message: 'Kategorie vytvořena', item });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      logger.fromError('categories_create_error_unique', err, { name: req.body?.name });
      return res.status(400).json({ error: 'Kategorie s tímto názvem již existuje' });
    }
    logger.fromError('categories_create_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// PUT /api/categories/:id — admin updates a category (name / visibility / order)
router.put('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Neplatný identifikátor kategorie' });

    const current = await db.prepare('SELECT id, name, is_visible, sort_order FROM categories WHERE id = ?').get(id);
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

    const sort_order = req.body && req.body.sort_order !== undefined ? Number(req.body.sort_order) || 0 : current.sort_order;
    const is_visible = req.body && req.body.is_visible !== undefined ? normalizeVisibility(req.body.is_visible) : current.is_visible;

    await db.prepare(
      `UPDATE categories SET name = ?, is_visible = ?, sort_order = ? WHERE id = ?`
    ).run(name, is_visible, sort_order, id);

    const item = await db.prepare('SELECT id, name, is_visible, sort_order FROM categories WHERE id = ?').get(id);
    logger.info('category_updated', { id, name });
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