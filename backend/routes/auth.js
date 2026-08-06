import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'inachis-dev-secret-change-in-production';

// ── Login rate limit: 10 attempts / 15 min / IP ───────────────────────────
const loginRateLimits = new Map();
const LOGIN_MAX    = 10;
const LOGIN_WINDOW = 15 * 60 * 1000;

function checkLoginRate(ip) {
  const now   = Date.now();
  const entry = loginRateLimits.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW) {
    loginRateLimits.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= LOGIN_MAX) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginRateLimits.entries()) {
    if (now - entry.windowStart > LOGIN_WINDOW) loginRateLimits.delete(ip);
  }
}, 30 * 60 * 1000);

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    if (!checkLoginRate(ip)) {
      logger.warn('login_rate_limit', { ip });
      return res.status(429).json({ error: 'Příliš mnoho pokusů. Zkuste to za 15 minut.' });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email a heslo jsou povinné' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user) {
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        logger.warn('login_failed', { reason: 'wrong_password', user_id: user.id });
        return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      logger.info('login_success', { user_id: user.id, role: user.role });
      return res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
    }

    // Check friends table
    const friend = await db.prepare('SELECT * FROM friends WHERE email = ?').get(email);
    if (friend && friend.password_hash) {
      const match = await bcrypt.compare(password, friend.password_hash);
      if (match) {
        const token = jwt.sign(
          { id: friend.id, email: friend.email, role: 'friend', friendId: friend.id },
          JWT_SECRET,
          { expiresIn: '24h' }
        );
        logger.info('friend_login_success', { friend_id: friend.id });
        return res.json({ token, user: { id: friend.id, email: friend.email, role: 'friend', name: friend.name } });
      }
    }

    // Generic error — don't differentiate between user-not-found and wrong-password
    logger.warn('login_failed', { reason: 'wrong_password', email });
    return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });
  } catch (err) {
    logger.fromError('login_error', err);
    res.status(500).json({ error: 'Chyba serveru. Zkuste to znovu.' });
  }
});

// GET /api/auth/me
router.get('/me', AuthMiddleware.verifyToken, async (req, res) => {
  try {
    if (req.user.role === 'friend') {
      const friend = await db.prepare(
        'SELECT id, name, email, avatar FROM friends WHERE id = ?'
      ).get(req.user.id);
      if (!friend) return res.status(404).json({ error: 'Friend not found' });
      return res.json({ ...friend, role: 'friend' });
    }

    const user = await db.prepare('SELECT id, email, role, name FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    logger.fromError('auth_me_error', err, { user_id: req.user?.id });
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;
