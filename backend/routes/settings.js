import express from 'express';
import db from '../database.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

const PUBLIC_KEYS = new Set([
  'site_name', 'site_tagline', 'owner_name',
  'social_instagram', 'social_twitter',
  'hero_image', 'about_image', 'about_text',
  'site_logo',
  'site_name_en', 'site_tagline_en', 'owner_name_en', 'about_text_en'
]);

const ALL_KEYS = new Set([
  'site_name', 'site_tagline', 'owner_name', 'contact_email',
  'social_instagram', 'social_twitter',
  'hero_image', 'about_image', 'about_text',
  'site_logo', 'friend_storage_limit_mb',
  'site_name_en', 'site_tagline_en', 'owner_name_en', 'about_text_en'
]);

// GET /api/settings/public — public readable keys, optional ?lang=en
router.get('/public', async (req, res) => {
  try {
    const { lang } = req.query;
    const rows = await db.prepare(`SELECT key, value FROM settings`).all();
    const result = {};
    for (const row of rows) {
      if (PUBLIC_KEYS.has(row.key)) {
        result[row.key] = row.value;
      }
    }
    // When lang=en, override base keys with _en values (if non-empty)
    if (lang === 'en') {
      const enMappings = [
        ['site_name', 'site_name_en'],
        ['site_tagline', 'site_tagline_en'],
        ['owner_name', 'owner_name_en'],
        ['about_text', 'about_text_en'],
      ];
      for (const [base, en] of enMappings) {
        if (result[en]) result[base] = result[en];
      }
    }
    res.json(result);
  } catch (err) {
    logger.fromError('settings_public_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// GET /api/settings/admin/all — admin
router.get('/admin/all', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const rows = await db.prepare(`SELECT key, value, updated_at FROM settings ORDER BY key`).all();
    const result = {};
    for (const row of rows) {
      result[row.key] = { value: row.value, updated_at: row.updated_at };
    }
    res.json(result);
  } catch (err) {
    logger.fromError('settings_admin_list_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// PUT /api/settings/:key — admin
router.put('/:key', AuthMiddleware.verifyToken, AuthMiddleware.adminOnly, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (!ALL_KEYS.has(key)) {
      return res.status(400).json({ error: `Neznámý klíč nastavení: ${key}` });
    }

    await db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value ?? '');

    logger.info('setting_updated', { key });
    res.json({ message: 'Nastavení uloženo', key, value: value ?? '' });
  } catch (err) {
    logger.fromError('settings_update_error', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

export default router;
