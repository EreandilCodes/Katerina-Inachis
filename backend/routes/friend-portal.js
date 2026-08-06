import express from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import sharp from 'sharp';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

// ============================================================
// Gallery upload setup
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../frontend/uploads/gallery');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXT  = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error(`Nepodporovaný typ: ${file.mimetype}`));
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`Nepodporovaná přípona: ${ext || '(žádná)'}`));
    cb(null, true);
  }
});

function handleMultipart(req, res, next) {
  upload.array('files', 20)(req, res, (err) => {
    if (!err) return next();
    res.status(400).json({ error: err.message });
  });
}

async function resizeForWeb(buffer, mimetype) {
  if (mimetype === 'image/gif') return buffer;
  try {
    let s = sharp(buffer).resize(2000, 2000, { fit: 'inside', withoutEnlargement: true });
    if (mimetype === 'image/jpeg') s = s.jpeg({ quality: 85 });
    else if (mimetype === 'image/webp') s = s.webp({ quality: 85 });
    else if (mimetype === 'image/png') s = s.png({ compressionLevel: 8 });
    return await s.toBuffer();
  } catch {
    return buffer;
  }
}

function sanitizeFilename(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 60) || 'image';
}

function filenameToIdentifier(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 75) || 'image';
}

async function uniqueIdentifier(base) {
  let identifier = base;
  let attempt = 1;
  while (true) {
    const row = await db.prepare('SELECT id FROM gallery_images WHERE identifier = ?').get(identifier);
    if (!row) return identifier;
    attempt++;
    identifier = `${base.substring(0, 73)}-${attempt}`;
  }
}

// ============================================================
// Gallery helpers
// ============================================================

async function getFriendFolder(friendId) {
  const friend = await db.prepare('SELECT gallery_folder_id FROM friends WHERE id = ?').get(friendId);
  return friend?.gallery_folder_id || null;
}

async function getFolderUsageBytes(folderId) {
  const row = await db.prepare(
    'SELECT COALESCE(SUM(file_size_bytes), 0) as total FROM gallery_images WHERE folder_id = ?'
  ).get(folderId);
  return row?.total || 0;
}

async function getStorageLimitBytes() {
  const setting = await db.prepare("SELECT value FROM settings WHERE key = 'friend_storage_limit_mb'").get();
  const mb = parseInt(setting?.value || '200', 10);
  return mb * 1024 * 1024;
}

// ============================================================
// Slug generator
// ============================================================

function generateSlug(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// All routes require authenticated friend
router.use(AuthMiddleware.verifyToken, AuthMiddleware.friendOnly);

// GET /api/friend-portal/me — get own profile
router.get('/me', async (req, res) => {
  try {
    const friendId = req.user.friendId || req.user.id;
    const friend = await db.prepare(
      'SELECT id, name, slug, short_bio, bio, avatar, email, display_order, is_active, created_at FROM friends WHERE id = ?'
    ).get(friendId);
    if (!friend) return res.status(404).json({ error: 'Přítel nenalezen' });
    res.json({ ...friend, role: 'friend' });
  } catch (err) {
    logger.fromError('friend_portal_me_error', err, { friend_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// PUT /api/friend-portal/profile — update own avatar only
router.put('/profile', async (req, res) => {
  try {
    const friendId = req.user.friendId || req.user.id;
    const { avatar } = req.body;

    await db.prepare('UPDATE friends SET avatar = ? WHERE id = ?')
      .run(avatar || null, friendId);

    const friend = await db.prepare(
      'SELECT id, name, slug, avatar, email FROM friends WHERE id = ?'
    ).get(friendId);
    logger.info('friend_portal_profile_updated', { friend_id: friendId });
    res.json({ message: 'Profil aktualizován', item: friend });
  } catch (err) {
    logger.fromError('friend_portal_profile_error', err, { friend_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// PUT /api/friend-portal/password — change own password (requires current password)
router.put('/password', async (req, res) => {
  try {
    const friendId = req.user.friendId || req.user.id;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Stávající i nové heslo jsou povinné' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Nové heslo musí mít alespoň 8 znaků' });
    }

    const friend = await db.prepare('SELECT id, password_hash FROM friends WHERE id = ?').get(friendId);
    if (!friend || !friend.password_hash) {
      return res.status(400).json({ error: 'Účet nemá nastavené heslo' });
    }

    const match = await bcrypt.compare(current_password, friend.password_hash);
    if (!match) {
      logger.warn('friend_portal_password_wrong_current', { friend_id: friendId });
      return res.status(401).json({ error: 'Stávající heslo je nesprávné' });
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await db.prepare('UPDATE friends SET password_hash = ? WHERE id = ?').run(newHash, friendId);

    logger.info('friend_portal_password_changed', { friend_id: friendId });
    res.json({ message: 'Heslo bylo změněno' });
  } catch (err) {
    logger.fromError('friend_portal_password_error', err, { friend_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/friend-portal/posts — get own posts
router.get('/posts', async (req, res) => {
  try {
    const friendId = req.user.friendId || req.user.id;
    const items = await db.prepare(`
      SELECT id, friend_id, title, slug, type, excerpt, cover_image, images_json,
             is_published, published_at, created_at
      FROM friend_posts
      WHERE friend_id = ?
      ORDER BY created_at DESC
    `).all(friendId);
    res.json(items);
  } catch (err) {
    logger.fromError('friend_portal_posts_list_error', err, { friend_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// POST /api/friend-portal/posts — create own post
router.post('/posts', async (req, res) => {
  try {
    const friendId = req.user.friendId || req.user.id;
    const { title, type, excerpt, content, cover_image, images_json, is_published } = req.body;

    if (!title) return res.status(400).json({ error: 'Název je povinný' });

    const slug = generateSlug(title) + '-' + Date.now();
    const published_at = is_published ? new Date().toISOString() : null;

    const result = await db.prepare(`
      INSERT INTO friend_posts (friend_id, title, slug, type, excerpt, content, cover_image, images_json, is_published, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      friendId, title, slug, type || 'text', excerpt || null, content || null,
      cover_image || null, images_json || null, is_published ? 1 : 0, published_at
    );

    const item = await db.prepare('SELECT * FROM friend_posts WHERE id = ?').get(result.lastInsertRowid);
    logger.info('friend_portal_post_created', { id: result.lastInsertRowid, friend_id: friendId, title });
    res.status(201).json({ message: 'Příspěvek vytvořen', item });
  } catch (err) {
    logger.fromError('friend_portal_post_create_error', err, { friend_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// PUT /api/friend-portal/posts/:id — edit own post (verify ownership)
router.put('/posts/:id', async (req, res) => {
  try {
    const friendId = req.user.friendId || req.user.id;
    const { title, type, excerpt, content, cover_image, images_json, is_published } = req.body;

    if (!title) return res.status(400).json({ error: 'Název je povinný' });

    const existing = await db.prepare('SELECT id, friend_id FROM friend_posts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Příspěvek nenalezen' });
    if (String(existing.friend_id) !== String(friendId)) {
      return res.status(403).json({ error: 'Nemáte oprávnění upravit tento příspěvek' });
    }

    const slug = generateSlug(title) + '-' + req.params.id;
    const published_at = is_published ? new Date().toISOString() : null;

    await db.prepare(`
      UPDATE friend_posts
      SET title=?, slug=?, type=?, excerpt=?, content=?, cover_image=?, images_json=?, is_published=?, published_at=?
      WHERE id=?
    `).run(
      title, slug, type || 'text', excerpt || null, content || null,
      cover_image || null, images_json || null, is_published ? 1 : 0, published_at, req.params.id
    );

    const item = await db.prepare('SELECT * FROM friend_posts WHERE id = ?').get(req.params.id);
    logger.info('friend_portal_post_updated', { id: req.params.id, friend_id: friendId });
    res.json({ message: 'Příspěvek aktualizován', item });
  } catch (err) {
    logger.fromError('friend_portal_post_update_error', err, { friend_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// DELETE /api/friend-portal/posts/:id — delete own post (verify ownership)
router.delete('/posts/:id', async (req, res) => {
  try {
    const friendId = req.user.friendId || req.user.id;

    const existing = await db.prepare('SELECT id, friend_id FROM friend_posts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Příspěvek nenalezen' });
    if (String(existing.friend_id) !== String(friendId)) {
      return res.status(403).json({ error: 'Nemáte oprávnění smazat tento příspěvek' });
    }

    await db.prepare('DELETE FROM friend_posts WHERE id = ?').run(req.params.id);
    logger.info('friend_portal_post_deleted', { id: req.params.id, friend_id: friendId });
    res.json({ message: 'Příspěvek smazán' });
  } catch (err) {
    logger.fromError('friend_portal_post_delete_error', err, { friend_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// ============================================================
// GALLERY
// ============================================================

// GET /api/friend-portal/gallery/images — own folder images only
router.get('/gallery/images', async (req, res) => {
  try {
    const friendId = req.user.friendId || req.user.id;
    const folderId = await getFriendFolder(friendId);
    if (!folderId) return res.json({ images: [], usage_bytes: 0, limit_bytes: 0 });

    const images = await db.prepare(
      'SELECT * FROM gallery_images WHERE folder_id = ? ORDER BY display_order ASC, created_at DESC'
    ).all(folderId);

    const usage_bytes = await getFolderUsageBytes(folderId);
    const limit_bytes = await getStorageLimitBytes();

    res.json({ images, usage_bytes, limit_bytes });
  } catch (err) {
    logger.fromError('friend_portal_gallery_list_error', err, { friend_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// POST /api/friend-portal/gallery/upload — upload to own folder only
router.post('/gallery/upload', handleMultipart, async (req, res) => {
  try {
    const friendId = req.user.friendId || req.user.id;
    const folderId = await getFriendFolder(friendId);

    if (!folderId) {
      return res.status(400).json({ error: 'Nemáte přiřazenou složku v galerii. Kontaktujte správce.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Nebyl vybrán žádný soubor' });
    }

    const limitBytes = await getStorageLimitBytes();
    let currentUsage = await getFolderUsageBytes(folderId);

    const results = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const processedBuf = await resizeForWeb(file.buffer, file.mimetype);

        if (currentUsage + processedBuf.length > limitBytes) {
          const limitMb = Math.round(limitBytes / 1024 / 1024);
          errors.push({ filename: file.originalname, error: `Limit úložiště (${limitMb} MB) byl překročen` });
          continue;
        }

        const ext = path.extname(file.originalname).toLowerCase();
        const base = sanitizeFilename(path.basename(file.originalname, ext));
        const filename = `${base}-${Date.now()}${ext}`;
        const filepath = path.join(UPLOAD_DIR, filename);
        const identifier = await uniqueIdentifier(filenameToIdentifier(path.basename(file.originalname, ext)));
        const imageUrl = `/uploads/gallery/${filename}`;

        fs.writeFileSync(filepath, processedBuf);
        currentUsage += processedBuf.length;

        const result = await db.prepare(`
          INSERT INTO gallery_images (folder_id, image_url, identifier, title, display_order, file_size_bytes)
          VALUES (?, ?, ?, ?, 0, ?)
        `).run(folderId, imageUrl, identifier, file.originalname, processedBuf.length);

        const image = await db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(result.lastInsertRowid);
        results.push(image);
      } catch (err) {
        errors.push({ filename: file.originalname, error: err.message });
      }
    }

    const status = results.length > 0 ? 201 : 400;
    res.status(status).json({
      message: `Nahráno ${results.length} z ${req.files.length} fotek`,
      images: results,
      errors
    });
  } catch (err) {
    logger.fromError('friend_portal_gallery_upload_error', err, { friend_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// DELETE /api/friend-portal/gallery/images/:id — delete own image
router.delete('/gallery/images/:id', async (req, res) => {
  try {
    const friendId = req.user.friendId || req.user.id;
    const folderId = await getFriendFolder(friendId);

    const image = await db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(req.params.id);
    if (!image) return res.status(404).json({ error: 'Obrázek nenalezen' });
    if (image.folder_id !== folderId) {
      return res.status(403).json({ error: 'Nemáte oprávnění smazat tento obrázek' });
    }

    // Delete physical file if it's a local upload
    if (image.image_url?.startsWith('/uploads/')) {
      try {
        const filepath = path.join(__dirname, '../../frontend', image.image_url);
        fs.unlinkSync(filepath);
      } catch {}
    }

    await db.prepare('DELETE FROM gallery_images WHERE id = ?').run(req.params.id);
    logger.info('friend_portal_gallery_image_deleted', { id: req.params.id, friend_id: friendId });
    res.json({ message: 'Obrázek smazán' });
  } catch (err) {
    logger.fromError('friend_portal_gallery_delete_error', err, { friend_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;
