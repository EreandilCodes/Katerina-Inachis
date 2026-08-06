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
import galleryRoutes        from './routes/gallery.js';
import settingsRoutes       from './routes/settings.js';
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

    app.disable('x-powered-by');
    app.use(cors());
    app.use(compression());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // ── Request logging (must be before routes) ───────────────────────────
    app.use(requestLogger);

    // Security headers
    app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      next();
    });

    // Static files
    app.use(express.static(path.join(__dirname, '../frontend')));

    // API Routes
    app.use('/api/auth',           authRoutes);
    app.use('/api/texts',          textsRoutes);
    app.use('/api/artworks',       artworksRoutes);
    app.use('/api/jewelry',        jewelryRoutes);
    app.use('/api/blog',           blogRoutes);
    app.use('/api/programming',    programmingRoutes);
    app.use('/api/friends',        friendsRoutes);
    app.use('/api/friend-posts',   friendPostsRoutes);
    app.use('/api/friend-portal',  friendPortalRouter);
    app.use('/api/gallery',        galleryRoutes);
    app.use('/api/settings',       settingsRoutes);
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
