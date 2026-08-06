import express from 'express';
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
// Upload setup
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
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error(`Nepodporovaný typ souboru: ${file.mimetype}`));
    }
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new Error(`Nepodporovaná přípona souboru: ${ext || '(žádná)'}`));
    }
    cb(null, true);
  }
});

async function resizeForWeb(buffer, mimetype) {
  if (mimetype === 'image/gif') return buffer;
  try {
    let s = sharp(buffer).resize(2000, 2000, { fit: 'inside', withoutEnlargement: true });
    if (mimetype === 'image/jpeg') s = s.jpeg({ quality: 85 });
    else if (mimetype === 'image/webp') s = s.webp({ quality: 85 });
    else if (mimetype === 'image/png') s = s.png({ compressionLevel: 8 });
    return await s.toBuffer();
  } catch (err) {
    logger.warn('image_resize_failed', { error_message: err.message });
    return buffer;
  }
}

function handleMultipart(req, res, next) {
  upload.array('files', 100)(req, res, (err) => {
    if (!err) return next();
    res.status(400).json({ error: err.message });
  });
}

// ============================================================
// Helpers
// ============================================================

function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60) || 'image';
}

function filenameToIdentifier(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 75) || 'image';
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

function generateSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function validateIdentifier(id) {
  return /^[a-z0-9_-]{1,80}$/.test(id);
}

function handleUniqueError(error, field = 'Hodnota') {
  if (error.message && error.message.includes('UNIQUE')) {
    return `${field} již existuje. Zvolte jiný.`;
  }
  return error.message;
}

// ============================================================
// FOLDERS
// ============================================================

router.get('/folders', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const folders = await db.prepare(`
      SELECT * FROM gallery_folders ORDER BY parent_id ASC, display_order ASC, name ASC
    `).all();
    res.json(folders);
  } catch (err) {
    logger.fromError('gallery_folders_list_error', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/folders', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { name, slug, parent_id, display_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Název je povinný' });
    }

    const finalSlug = slug ? slug.trim() : generateSlug(name.trim());

    if (!finalSlug || !/^[a-z0-9_-]{1,80}$/.test(finalSlug)) {
      return res.status(400).json({ error: 'Slug musí obsahovat pouze malá písmena, číslice, - nebo _ (max 80 znaků)' });
    }

    if (parent_id) {
      const parent = await db.prepare('SELECT id FROM gallery_folders WHERE id = ?').get(parent_id);
      if (!parent) return res.status(400).json({ error: 'Nadřazená složka neexistuje' });
    }

    const result = await db.prepare(`
      INSERT INTO gallery_folders (name, slug, parent_id, display_order)
      VALUES (?, ?, ?, ?)
    `).run(name.trim(), finalSlug, parent_id || null, display_order || 0);

    const folder = await db.prepare('SELECT * FROM gallery_folders WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Složka vytvořena', folder });
  } catch (err) {
    logger.fromError('gallery_folder_create_error', err);
    const msg = handleUniqueError(err, 'Slug složky');
    res.status(err.message?.includes('UNIQUE') ? 400 : 500).json({ error: msg });
  }
});

router.put('/folders/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, slug, parent_id, display_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Název je povinný' });
    }

    const existing = await db.prepare('SELECT * FROM gallery_folders WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Složka nenalezena' });

    const finalSlug = slug ? slug.trim() : generateSlug(name.trim());

    if (!finalSlug || !/^[a-z0-9_-]{1,80}$/.test(finalSlug)) {
      return res.status(400).json({ error: 'Slug musí obsahovat pouze malá písmena, číslice, - nebo _ (max 80 znaků)' });
    }

    if (parent_id && Number(parent_id) === id) {
      return res.status(400).json({ error: 'Složka nemůže být svou vlastní nadřazenou složkou' });
    }

    if (parent_id) {
      const parent = await db.prepare('SELECT id FROM gallery_folders WHERE id = ?').get(parent_id);
      if (!parent) return res.status(400).json({ error: 'Nadřazená složka neexistuje' });
    }

    await db.prepare(`
      UPDATE gallery_folders SET name=?, slug=?, parent_id=?, display_order=?
      WHERE id=?
    `).run(name.trim(), finalSlug, parent_id || null, display_order || 0, id);

    const folder = await db.prepare('SELECT * FROM gallery_folders WHERE id = ?').get(id);
    res.json({ message: 'Složka aktualizována', folder });
  } catch (err) {
    logger.fromError('gallery_folder_update_error', err);
    const msg = handleUniqueError(err, 'Slug složky');
    res.status(err.message?.includes('UNIQUE') ? 400 : 500).json({ error: msg });
  }
});

router.delete('/folders/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const folder = await db.prepare('SELECT * FROM gallery_folders WHERE id = ?').get(id);
    if (!folder) return res.status(404).json({ error: 'Složka nenalezena' });

    const childFolders = await db.prepare('SELECT COUNT(*) as cnt FROM gallery_folders WHERE parent_id = ?').get(id);
    if (childFolders.cnt > 0) {
      return res.status(400).json({
        error: `Složka "${folder.name}" nelze smazat – obsahuje ${childFolders.cnt} podsložek.`
      });
    }

    const images = await db.prepare('SELECT COUNT(*) as cnt FROM gallery_images WHERE folder_id = ?').get(id);
    if (images.cnt > 0) {
      return res.status(400).json({
        error: `Složka "${folder.name}" nelze smazat – obsahuje ${images.cnt} fotek.`
      });
    }

    await db.prepare('DELETE FROM gallery_folders WHERE id = ?').run(id);
    res.json({ message: 'Složka smazána' });
  } catch (err) {
    logger.fromError('gallery_folder_delete_error', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// IMAGES
// ============================================================

router.get('/images', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { folder, search } = req.query;

    let whereClause = '1=1';
    const params = [];

    if (folder !== undefined) {
      if (folder === 'root') {
        whereClause += ' AND folder_id IS NULL';
      } else {
        whereClause += ' AND folder_id = ?';
        params.push(Number(folder));
      }
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      whereClause += ' AND (identifier LIKE ? OR title LIKE ? OR alt_text LIKE ?)';
      params.push(q, q, q);
    }

    const images = await db.prepare(`
      SELECT gi.*, gf.name as folder_name
      FROM gallery_images gi
      LEFT JOIN gallery_folders gf ON gi.folder_id = gf.id
      WHERE ${whereClause}
      ORDER BY gi.display_order ASC, gi.created_at DESC
    `).all(...params);

    res.json(images);
  } catch (err) {
    logger.fromError('gallery_images_list_error', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/images', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { folder_id, image_url, identifier, title, alt_text, display_order } = req.body;

    if (!image_url || !image_url.trim()) {
      return res.status(400).json({ error: 'URL obrázku je povinná' });
    }

    if (!identifier || !identifier.trim()) {
      return res.status(400).json({ error: 'Identifier je povinný' });
    }

    const cleanId = identifier.trim().toLowerCase();
    if (!validateIdentifier(cleanId)) {
      return res.status(400).json({ error: 'Identifier smí obsahovat jen malá písmena, číslice, - nebo _ (max 80 znaků)' });
    }

    if (folder_id) {
      const folder = await db.prepare('SELECT id FROM gallery_folders WHERE id = ?').get(folder_id);
      if (!folder) return res.status(400).json({ error: 'Složka neexistuje' });
    }

    const result = await db.prepare(`
      INSERT INTO gallery_images (folder_id, image_url, identifier, title, alt_text, display_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(folder_id || null, image_url.trim(), cleanId,
           title ? title.trim() : null, alt_text ? alt_text.trim() : null, display_order || 0);

    const image = await db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Fotka přidána', image });
  } catch (err) {
    logger.fromError('gallery_image_create_error', err);
    const msg = handleUniqueError(err, 'Identifier');
    res.status(err.message?.includes('UNIQUE') ? 400 : 500).json({ error: msg });
  }
});

router.put('/images/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { folder_id, image_url, identifier, title, alt_text, display_order } = req.body;

    const existing = await db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Fotka nenalezena' });

    if (!image_url || !image_url.trim()) {
      return res.status(400).json({ error: 'URL obrázku je povinná' });
    }

    if (!identifier || !identifier.trim()) {
      return res.status(400).json({ error: 'Identifier je povinný' });
    }

    const cleanId = identifier.trim().toLowerCase();
    if (!validateIdentifier(cleanId)) {
      return res.status(400).json({ error: 'Identifier smí obsahovat jen malá písmena, číslice, - nebo _ (max 80 znaků)' });
    }

    if (folder_id) {
      const folder = await db.prepare('SELECT id FROM gallery_folders WHERE id = ?').get(folder_id);
      if (!folder) return res.status(400).json({ error: 'Složka neexistuje' });
    }

    await db.prepare(`
      UPDATE gallery_images SET folder_id=?, image_url=?, identifier=?, title=?, alt_text=?, display_order=?
      WHERE id=?
    `).run(folder_id || null, image_url.trim(), cleanId,
           title ? title.trim() : null, alt_text ? alt_text.trim() : null, display_order || 0, id);

    const image = await db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(id);
    res.json({ message: 'Fotka aktualizována', image });
  } catch (err) {
    logger.fromError('gallery_image_update_error', err);
    const msg = handleUniqueError(err, 'Identifier');
    res.status(err.message?.includes('UNIQUE') ? 400 : 500).json({ error: msg });
  }
});

router.delete('/images/:id', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const image = await db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(id);
    if (!image) return res.status(404).json({ error: 'Fotka nenalezena' });

    await db.prepare('DELETE FROM gallery_images WHERE id = ?').run(id);
    res.json({ message: 'Fotka smazána' });
  } catch (err) {
    logger.fromError('gallery_image_delete_error', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// UPLOAD
// ============================================================

router.post('/upload', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, handleMultipart, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Nebyl vybrán žádný soubor' });
    }

    const { folder_id, title, alt_text, display_order } = req.body;

    if (folder_id) {
      const folder = await db.prepare('SELECT id FROM gallery_folders WHERE id = ?').get(folder_id);
      if (!folder) return res.status(400).json({ error: 'Složka neexistuje' });
    }

    const results = [];
    const errors  = [];

    for (const file of req.files) {
      const ext  = path.extname(file.originalname).toLowerCase();
      const base = sanitizeFilename(path.basename(file.originalname, ext));
      const filename   = `${base}-${Date.now()}${ext}`;
      const filepath   = path.join(UPLOAD_DIR, filename);
      const identifier = await uniqueIdentifier(filenameToIdentifier(path.basename(file.originalname, ext)));
      const imageUrl   = `/uploads/gallery/${filename}`;

      try {
        const processedBuf = await resizeForWeb(file.buffer, file.mimetype);
        fs.writeFileSync(filepath, processedBuf);

        const result = await db.prepare(`
          INSERT INTO gallery_images (folder_id, image_url, identifier, title, alt_text, display_order, file_size_bytes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(folder_id || null, imageUrl, identifier,
               title ? title.trim() : null, alt_text ? alt_text.trim() : null, Number(display_order) || 0,
               processedBuf.length);

        const image = await db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(result.lastInsertRowid);
        results.push(image);
      } catch (err) {
        try { fs.unlinkSync(filepath); } catch {}
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
    logger.fromError('gallery_upload_error', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
