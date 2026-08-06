import express from 'express';
import bcrypt from 'bcrypt';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

function generateSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// GET /api/friends — active friends (public), optional ?lang=en
router.get('/', async (req, res) => {
  try {
    const { lang } = req.query;
    const shortBioCol = lang === 'en' ? `COALESCE(NULLIF(short_bio_en,''), short_bio) as short_bio` : 'short_bio';
    const items = await db.prepare(`
      SELECT id, name, slug, ${shortBioCol}, avatar, display_order, created_at
      FROM friends WHERE is_active = 1
      ORDER BY display_order ASC, name ASC
    `).all();
    res.json(items);
  } catch (err) {
    logger.fromError('friends_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/friends/admin/all — admin
router.get('/admin/all', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const items = await db.prepare(`SELECT * FROM friends ORDER BY display_order ASC, name ASC`).all();
    res.json(items);
  } catch (err) {
    logger.fromError('friends_admin_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/friends/:slug — single friend profile (public), optional ?lang=en
router.get('/:slug', async (req, res) => {
  try {
    const { lang } = req.query;
    let selectCols;
    if (lang === 'en') {
      selectCols = `id, name, slug, COALESCE(NULLIF(short_bio_en,''), short_bio) as short_bio, COALESCE(NULLIF(bio_en,''), bio) as bio, avatar, display_order, is_active, user_id, gallery_folder_id, email, created_at`;
    } else {
      selectCols = '*';
    }
    const item = await db.prepare(`SELECT ${selectCols} FROM friends WHERE slug = ? AND is_active = 1`).get(req.params.slug);
    if (!item) return res.status(404).json({ error: 'Přítel nenalezen' });
    res.json(item);
  } catch (err) {
    logger.fromError('friends_get_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// POST /api/friends — admin
router.post('/', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { name, slug: bodySlug, short_bio, bio, avatar, display_order, is_active, user_id, short_bio_en, bio_en } = req.body;
    if (!name) return res.status(400).json({ error: 'Jméno je povinné' });

    const slug = bodySlug ? bodySlug : generateSlug(name);

    const result = await db.prepare(`
      INSERT INTO friends (name, slug, short_bio, bio, avatar, display_order, is_active, user_id, short_bio_en, bio_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, slug, short_bio || null, bio || null, avatar || null,
           display_order || 0, is_active !== false ? 1 : 0, user_id || null,
           short_bio_en || null, bio_en || null);

    const item = await db.prepare('SELECT * FROM friends WHERE id = ?').get(result.lastInsertRowid);
    logger.info('friend_created', { id: result.lastInsertRowid, name });
    res.status(201).json({ message: 'Přítel přidán', item });
  } catch (err) {
    logger.fromError('friends_create_error', err);
    res.status(err.message?.includes('UNIQUE') ? 400 : 500).json({ error: err.message?.includes('UNIQUE') ? 'Slug již existuje' : 'Chyba serveru' });
  }
});

// PUT /api/friends/:id — admin
router.put('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { name, slug: bodySlug, short_bio, bio, avatar, display_order, is_active, user_id, short_bio_en, bio_en } = req.body;
    if (!name) return res.status(400).json({ error: 'Jméno je povinné' });

    const slug = bodySlug ? bodySlug : generateSlug(name);

    await db.prepare(`
      UPDATE friends SET name=?, slug=?, short_bio=?, bio=?, avatar=?, display_order=?, is_active=?, user_id=?, short_bio_en=?, bio_en=?
      WHERE id=?
    `).run(name, slug, short_bio || null, bio || null, avatar || null,
           display_order || 0, is_active !== false ? 1 : 0, user_id || null,
           short_bio_en || null, bio_en || null, req.params.id);

    const item = await db.prepare('SELECT * FROM friends WHERE id = ?').get(req.params.id);
    logger.info('friend_updated', { id: req.params.id });
    res.json({ message: 'Přítel aktualizován', item });
  } catch (err) {
    logger.fromError('friends_update_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// DELETE /api/friends/:id — admin
router.delete('/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    await db.prepare('DELETE FROM friends WHERE id = ?').run(req.params.id);
    logger.info('friend_deleted', { id: req.params.id });
    res.json({ message: 'Přítel smazán' });
  } catch (err) {
    logger.fromError('friends_delete_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// PUT /api/friends/:id/set-login — admin sets friend's login email + password
router.put('/:id/set-login', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email a heslo jsou povinné' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Heslo musí mít alespoň 8 znaků' });
    }

    const friend = await db.prepare('SELECT id FROM friends WHERE id = ?').get(req.params.id);
    if (!friend) return res.status(404).json({ error: 'Přítel nenalezen' });

    const passwordHash = await bcrypt.hash(password, 10);
    await db.prepare('UPDATE friends SET email = ?, password_hash = ? WHERE id = ?')
      .run(email.toLowerCase().trim(), passwordHash, req.params.id);

    // Auto-create gallery folder for friend if they don't have one
    const updatedFriend = await db.prepare('SELECT id, name, slug, gallery_folder_id FROM friends WHERE id = ?').get(req.params.id);
    if (!updatedFriend.gallery_folder_id) {
      let folderSlug = updatedFriend.slug;
      const folderExists = await db.prepare('SELECT id FROM gallery_folders WHERE slug = ?').get(folderSlug);
      if (folderExists) folderSlug = folderSlug + '-friend';

      const folderResult = await db.prepare(
        'INSERT INTO gallery_folders (name, slug, parent_id, display_order) VALUES (?, ?, NULL, 0)'
      ).run(updatedFriend.name, folderSlug);

      await db.prepare('UPDATE friends SET gallery_folder_id = ? WHERE id = ?')
        .run(folderResult.lastInsertRowid, req.params.id);

      logger.info('friend_gallery_folder_created', { friend_id: req.params.id, folder_slug: folderSlug });
    }

    logger.info('friend_login_set', { friend_id: req.params.id, email });
    res.json({ message: 'Přihlašovací údaje nastaveny' });
  } catch (err) {
    logger.fromError('friend_set_login_error', err);
    res.status(err.message?.includes('UNIQUE') ? 400 : 500)
      .json({ error: err.message?.includes('UNIQUE') ? 'Email již používá jiný přítel' : 'Chyba serveru' });
  }
});

// PUT /api/friends/:id/reset-password — admin resets friend's password
router.put('/:id/reset-password', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Heslo je povinné' });
    if (password.length < 8) {
      return res.status(400).json({ error: 'Heslo musí mít alespoň 8 znaků' });
    }

    const friend = await db.prepare('SELECT id, email FROM friends WHERE id = ?').get(req.params.id);
    if (!friend) return res.status(404).json({ error: 'Přítel nenalezen' });
    if (!friend.email) return res.status(400).json({ error: 'Přítel nemá nastavený email' });

    const passwordHash = await bcrypt.hash(password, 10);
    await db.prepare('UPDATE friends SET password_hash = ? WHERE id = ?')
      .run(passwordHash, req.params.id);

    logger.info('friend_password_reset', { friend_id: req.params.id });
    res.json({ message: 'Heslo bylo resetováno' });
  } catch (err) {
    logger.fromError('friend_reset_password_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;
