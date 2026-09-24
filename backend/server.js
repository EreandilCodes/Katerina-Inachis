import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initDatabase } from './database.js';
import { logger } from './logger.js';
import { requestLogger } from './middleware/request-logger.js';

import authRoutes           from './routes/auth.js';
import textsRoutes          from './routes/texts.js';
import artworksRoutes       from './routes/artworks.js';
import jewelryRoutes        from './routes/jewelry.js';
import blogRoutes           from './routes/blog.js';
import programmingRoutes    from './routes/programming.js';
import friendsRoutes        from './routes/friends.js';
import friendPostsRoutes    from './routes/friend-posts.js';
import friendPortalRouter   from './routes/friend-portal.js';
import galleryRoutes, { GALLERY_UPLOAD_DIR, reconcileLegacyGalleryFiles } from './routes/gallery.js';
import settingsRoutes       from './routes/settings.js';
import pagesRoutes          from './routes/pages.js';
import categoriesRoutes     from './routes/categories.js';
import inquiriesRoutes      from './routes/inquiries.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3004;

logger.info('server_starting', { service: 'inachis', port: PORT });

const initWithTimeout = Promise.race([
  initDatabase(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Database initialization timeout')), 35000)
  )
]);

initWithTimeout
  .catch(err => {
    logger.warn('db_init_failed', { error_message: err.message });
  })
  .finally(() => {
    if (!process.env.JWT_SECRET) {
      logger.warn('jwt_secret_missing', {
        message: 'JWT_SECRET not set — using insecure default. Set a strong secret before deploying.',
      });
    }

    // Best-effort: copy any Gallery files that exist only in the legacy
    // container dir into the persistent upload dir (never destructive).
    reconcileLegacyGalleryFiles();

    app.disable('x-powered-by');
    app.use(cors());
    app.use(compression());

    // ── Request logging (before body parsing, so parse errors are logged) ──
    app.use(requestLogger);

    // Security headers
    app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      next();
    });

    // Static files
    // Gallery uploads are served first from the persistent volume dir so that
    // images survive deploy cycles (the generic frontend static mount below
    // would otherwise prefer/collide with files in the ephemeral container).
    app.use('/uploads/gallery', express.static(GALLERY_UPLOAD_DIR));
    app.use(express.static(path.join(__dirname, '../frontend')));

    // ── API Routes ─────────────────────────────────────────────────────────
    // Texty is mounted BEFORE the default JSON parser: the texts router parses
    // its own request bodies so literary story (Povídky) bodies are not limited
    // to the global 100kb. Every other API keeps the default 100kb body limit.
    app.use('/api/texts', textsRoutes);

    app.use(express.json({ limit: '100kb' }));
    app.use(express.urlencoded({ extended: true }));

    app.use('/api/auth',           authRoutes);
    app.use('/api/artworks',       artworksRoutes);
    app.use('/api/jewelry',        jewelryRoutes);
    app.use('/api/blog',           blogRoutes);
    app.use('/api/programming',    programmingRoutes);
    app.use('/api/friends',        friendsRoutes);
    app.use('/api/friend-posts',   friendPostsRoutes);
    app.use('/api/friend-portal',  friendPortalRouter);
    app.use('/api/gallery',        galleryRoutes);
    app.use('/api/settings',       settingsRoutes);
    app.use('/api/pages',          pagesRoutes);
    app.use('/api/categories',     categoriesRoutes);
    app.use('/api/inquiries',      inquiriesRoutes);

    // Admin panel
    app.get('/admin', (_req, res) => {
      res.sendFile(path.join(__dirname, '../frontend/admin.html'));
    });

    // Friend portal
    app.get('/friend-portal', (_req, res) => {
      res.sendFile(path.join(__dirname, '../frontend/friend-portal.html'));
    });

    // Login page
    app.get('/login', (_req, res) => {
      res.sendFile(path.join(__dirname, '../frontend/login.html'));
    });

    // Public SPA — catch-all
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, '../frontend/index.html'));
    });

    // ── Global error handler (must be last) ───────────────────────────────
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
      // Surface body-size limits as a real 413 instead of a generic 500.
      if (err?.type === 'entity.too.large' || err?.status === 413) {
        logger.fromError('request_too_large', err, { method: req.method, path: req.path });
        return res.status(413).json({ error: 'Požadavek je příliš velký' });
      }
      logger.fromError('unhandled_request_error', err, { method: req.method, path: req.path });
      res.status(500).json({ error: 'Chyba serveru' });
    });

    const server = app.listen(PORT, () => {
      logger.info('server_ready', { port: PORT, admin: `http://localhost:${PORT}/admin` });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.fatal('port_in_use', { port: PORT });
        process.exit(1);
      } else {
        logger.fromError('server_error', err);
        throw err;
      }
    });

    process.on('unhandledRejection', (reason) => {
      logger.fromError('unhandled_rejection', reason instanceof Error ? reason : new Error(String(reason)));
    });

    process.on('uncaughtException', (err) => {
      logger.fromError('uncaught_exception', err);
      process.exit(1);
    });
  });
