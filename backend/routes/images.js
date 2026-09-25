import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import sharp from 'sharp';
import { GALLERY_UPLOAD_DIR } from './gallery.js';
import { logger } from '../logger.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// Thumbnail serving
// ============================================================
// Listing cards render small thumbnails but cover URLs point at the full-size
// /uploads/gallery originals (multi-MB PNGs). This route serves lightweight
// WebP resizes on demand: GET /img/gallery/<file>?w=<width>.
//
// - The original is never touched; a derived <file>-<w>.webp is cached on
//   disk in a directory that is deliberately OUTSIDE every public static root
//   (never under the /uploads/gallery mount nor the frontend dir), so the
//   cache can never be browsed or shadow a source file.
// - The cached thumb is regenerated whenever the source file is newer, so a
//   replaced image never stays stale beyond normal cache expiry.
// - ETag is derived from the source stat + width, enabling cheap 304s; clients
//   cache for a day and revalidate afterwards (no forever-stale content).

const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp|gif|avif)$/i;
const MIN_WIDTH = 64;
const MAX_WIDTH = 1600;
const DEFAULT_WIDTH = 800;
const CACHE_MAX_AGE = 86400; // seconds; ETag revalidation keeps updates correct

// Cache directory resolution mirrors resolveUploadDir() so that thumbnails
// persist on the same volume as the source files on Railway, while staying
// unreachable over HTTP (the sibling of the upload dir / /data are not served
// and the local default lives at the repo root, never inside frontend/).
function resolveThumbsDir() {
  if (process.env.GALLERY_UPLOAD_DIR) {
    return path.join(path.resolve(process.env.GALLERY_UPLOAD_DIR), '..', 'thumbs-cache');
  }
  const dbPath = process.env.SQLITE_PATH;
  if (process.env.DB_PROVIDER !== 'postgres' && dbPath && dbPath.startsWith('/data/')) {
    return '/data/thumbs-cache';
  }
  return path.join(__dirname, '../../data-cache', 'thumbs');
}

const THUMBS_DIR = resolveThumbsDir();

fs.mkdirSync(THUMBS_DIR, { recursive: true });

function parseWidth(raw) {
  const w = Number.parseInt(raw, 10);
  if (!Number.isFinite(w) || w <= 0) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

async function fileStat(filePath) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}

router.get('/:file', async (req, res) => {
  const file = req.params.file;
  if (!FILE_RE.test(file)) {
    return res.status(400).json({ error: 'Neplatný název souboru' });
  }
  const uploadRoot = path.resolve(GALLERY_UPLOAD_DIR);
  const sourcePath = path.join(uploadRoot, file);
  if (!sourcePath.startsWith(uploadRoot + path.sep)) {
    return res.status(400).json({ error: 'Nepřístupný soubor' });
  }

  const width = parseWidth(req.query.w);
  const thumbPath = path.join(THUMBS_DIR, `${file}-${width}.webp`);

  const srcStat = await fileStat(sourcePath);
  if (!srcStat || !srcStat.isFile()) {
    return res.status(404).json({ error: 'Soubor nebyl nalezen' });
  }

  const etag = `"${srcStat.size.toString(16)}-${Math.round(srcStat.mtimeMs).toString(16)}-${width.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.setHeader('ETag', etag);
    return res.status(304).end();
  }

  try {
    let thumbStat = await fileStat(thumbPath);
    if (!thumbStat || thumbStat.mtimeMs < srcStat.mtimeMs) {
      const tmpPath = path.join(THUMBS_DIR, `.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}.webp`);
      try {
        await sharp(sourcePath, { failOn: 'none' })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(tmpPath);
        await fsp.rename(tmpPath, thumbPath);
      } catch (err) {
        await fsp.unlink(tmpPath).catch(() => {});
        throw err;
      }
      thumbStat = await fsp.stat(thumbPath);
    }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);
    fs.createReadStream(thumbPath)
      .on('error', (err) => {
        logger.fromError('thumbnail_stream_error', err, { file, width });
        if (!res.headersSent) res.status(500).json({ error: 'Chyba serveru' });
      })
      .pipe(res);
  } catch (err) {
    logger.fromError('thumbnail_generation_failed', err, { file, width });
    if (!res.headersSent) res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;