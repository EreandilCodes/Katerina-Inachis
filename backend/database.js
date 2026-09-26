import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Slugs of the system pages that form the site skeleton. They are seeded on
// every startup (ON CONFLICT DO NOTHING) and can only be hidden, never deleted,
// so an admin can always recover the core menu. User-created pages (not in this
// list) are fully deletable.
export const DEFAULT_PAGE_TITLES = {
  texty:        'Texty',
  kresba:       'Kresba a malba',
  blog:         'Blog',
  programovani: 'Programování',
  pratele:      'Přátelé',
  'o-mne':      'O mně',
  kontakt:      'Kontakt',
};
// English titles for the seeded system pages (bilingual pages; fallback is the
// Czech title above). Extend only with entries present in DEFAULT_PAGE_TITLES.
export const DEFAULT_PAGE_TITLES_EN = {
  texty:        'Texts',
  kresba:       'Drawing and painting',
  blog:         'Blog',
  programovani: 'Programming',
  pratele:      'Friends',
  'o-mne':      'About me',
  kontakt:      'Contact',
};
export const DEFAULT_PAGE_SLUGS = Object.freeze(Object.keys(DEFAULT_PAGE_TITLES));

// ── Mode detection ────────────────────────────────────────────────────────────
const isPostgres = process.env.DB_PROVIDER === 'postgres';

console.log(`🗄️  Database mode: ${isPostgres ? 'PostgreSQL' : 'SQLite'}`);

const pk = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

// ── PostgreSQL wrapper ────────────────────────────────────────────────────────
async function createPgDb() {
  const { default: pg } = await import('pg');
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  pool.on('error', (err) => console.error('PG pool error:', err));

  function convertPlaceholders(sql) {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  }

  // Rows the INSERT...RETURNING trick may NOT be applied to: tables whose
  // primary key is not `id` (e.g. `settings`, keyed by `key`). Appending
  // "RETURNING id" there makes PostgreSQL fail with `column "id" does not
  // exist`, breaking initDatabase()'s settings seed and the admin settings
  // update route. Callers of those statements use `changes`, not
  // `lastInsertRowid`, so skipping RETURNING is behavior-preserving.
  const NO_RETURNING_ID = /\bINSERT\s+INTO\s+settings\b/i;

  return {
    _pool: pool,
    exec: async (sql) => { await pool.query(sql); },
    prepare: (sql) => {
      const isInsert = /^\s*INSERT/i.test(sql);
      const pgSql = convertPlaceholders(sql);
      const pgSqlRun = isInsert && !/RETURNING/i.test(sql) && !NO_RETURNING_ID.test(sql)
        ? pgSql.replace(/;?\s*$/, '') + ' RETURNING id'
        : pgSql;

      return {
        run: async (...params) => {
          const result = await pool.query(pgSqlRun, params);
          return {
            lastInsertRowid: isInsert ? result.rows[0]?.id : undefined,
            changes: result.rowCount
          };
        },
        get: async (...params) => {
          const result = await pool.query(pgSql, params);
          return result.rows[0];
        },
        all: async (...params) => {
          const result = await pool.query(pgSql, params);
          return result.rows;
        }
      };
    }
  };
}

// ── SQLite wrapper ────────────────────────────────────────────────────────────
function createSqliteDb() {
  const dbPath = process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : path.join(__dirname, 'inachis.db');

  // Make sure the target directory exists (e.g. a Railway volume mount at
  // /data). No-op when the directory already exists.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) { console.error('❌ Failed to open SQLite database:', err); throw err; }
    console.log('✅ SQLite database opened:', dbPath);
  });
  sqliteDb.configure('busyTimeout', 30000);

  return {
    exec: (sql) => new Promise((resolve, reject) => {
      sqliteDb.exec(sql, (err) => err ? reject(err) : resolve());
    }),
    prepare: (sql) => {
      const stmt = sqliteDb.prepare(sql);
      return {
        run: (...params) => new Promise((resolve, reject) => {
          stmt.run(...params, function(err) {
            if (err) reject(err);
            else resolve({ lastInsertRowid: this.lastID, changes: this.changes });
          });
        }),
        get: (...params) => new Promise((resolve, reject) => {
          stmt.get(...params, (err, row) => err ? reject(err) : resolve(row));
        }),
        all: (...params) => new Promise((resolve, reject) => {
          stmt.all(...params, (err, rows) => err ? reject(err) : resolve(rows));
        })
      };
    }
  };
}

// ── Export the right driver ───────────────────────────────────────────────────
const db = isPostgres ? await createPgDb() : createSqliteDb();

// ── Schema initialization ─────────────────────────────────────────────────────
export async function initDatabase() {
  console.log('🔄 Starting database initialization...');

  // Users
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            ${pk},
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT DEFAULT 'admin',
      name          TEXT,
      avatar        TEXT,
      bio           TEXT,
      slug          TEXT UNIQUE,
      is_active     INTEGER DEFAULT 1,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ users table ready');

  // Texts
  await db.exec(`
    CREATE TABLE IF NOT EXISTS texts (
      id           ${pk},
      title        TEXT NOT NULL,
      slug         TEXT UNIQUE NOT NULL,
      excerpt      TEXT,
      content      TEXT,
      cover_image  TEXT,
      category     TEXT,
      is_featured  INTEGER DEFAULT 0,
      is_published INTEGER DEFAULT 0,
      published_at TIMESTAMP,
      sort_order   INTEGER DEFAULT 0,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ texts table ready');

  // Artworks
  await db.exec(`
    CREATE TABLE IF NOT EXISTS artworks (
      id           ${pk},
      title        TEXT NOT NULL,
      slug         TEXT UNIQUE NOT NULL,
      description  TEXT,
      images_json  TEXT,
      cover_image  TEXT,
      collection   TEXT,
      medium       TEXT,
      year         TEXT,
      is_featured  INTEGER DEFAULT 0,
      is_published INTEGER DEFAULT 0,
      sort_order   INTEGER DEFAULT 0,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ artworks table ready');

  // Jewelry
  await db.exec(`
    CREATE TABLE IF NOT EXISTS jewelry (
      id           ${pk},
      title        TEXT NOT NULL,
      slug         TEXT UNIQUE NOT NULL,
      description  TEXT,
      images_json  TEXT,
      cover_image  TEXT,
      collection   TEXT,
      materials    TEXT,
      dimensions   TEXT,
      is_available INTEGER DEFAULT 1,
      is_featured  INTEGER DEFAULT 0,
      is_published INTEGER DEFAULT 0,
      sort_order   INTEGER DEFAULT 0,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ jewelry table ready');

  // Blog posts
  await db.exec(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id           ${pk},
      title        TEXT NOT NULL,
      slug         TEXT UNIQUE NOT NULL,
      excerpt      TEXT,
      content      TEXT,
      cover_image  TEXT,
      is_featured  INTEGER DEFAULT 0,
      is_published INTEGER DEFAULT 0,
      published_at TIMESTAMP,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ blog_posts table ready');

  // Programming posts
  await db.exec(`
    CREATE TABLE IF NOT EXISTS programming_posts (
      id           ${pk},
      title        TEXT NOT NULL,
      slug         TEXT UNIQUE NOT NULL,
      excerpt      TEXT,
      content      TEXT,
      cover_image  TEXT,
      is_featured  INTEGER DEFAULT 0,
      is_published INTEGER DEFAULT 0,
      published_at TIMESTAMP,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ programming_posts table ready');

  // Friends
  await db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      id            ${pk},
      name          TEXT NOT NULL,
      slug          TEXT UNIQUE NOT NULL,
      short_bio     TEXT,
      bio           TEXT,
      avatar        TEXT,
      display_order INTEGER DEFAULT 0,
      is_active     INTEGER DEFAULT 1,
      user_id       INTEGER,
      email         TEXT UNIQUE,
      password_hash TEXT,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Migration: add columns if they don't exist yet (existing DB).
  // SQLite does not support UNIQUE in ALTER TABLE; uniqueness is enforced by the CREATE TABLE above for new DBs.
  try { await db.exec('ALTER TABLE friends ADD COLUMN email TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE friends ADD COLUMN password_hash TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE friends ADD COLUMN gallery_folder_id INTEGER'); } catch (_e) {}
  console.log('✅ friends table ready');

  // Friend posts
  await db.exec(`
    CREATE TABLE IF NOT EXISTS friend_posts (
      id           ${pk},
      friend_id    INTEGER NOT NULL,
      title        TEXT NOT NULL,
      slug         TEXT UNIQUE NOT NULL,
      type         TEXT DEFAULT 'text',
      excerpt      TEXT,
      content      TEXT,
      images_json  TEXT,
      cover_image  TEXT,
      is_published INTEGER DEFAULT 0,
      published_at TIMESTAMP,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (friend_id) REFERENCES friends(id)
    )
  `);
  console.log('✅ friend_posts table ready');

  // ── i18n _en column migrations ──────────────────────────────────────────────

  // texts
  try { await db.exec('ALTER TABLE texts ADD COLUMN title_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE texts ADD COLUMN excerpt_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE texts ADD COLUMN content_en TEXT'); } catch (_e) {}

  // blog_posts
  try { await db.exec('ALTER TABLE blog_posts ADD COLUMN title_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE blog_posts ADD COLUMN excerpt_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE blog_posts ADD COLUMN content_en TEXT'); } catch (_e) {}

  // programming_posts
  try { await db.exec('ALTER TABLE programming_posts ADD COLUMN title_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE programming_posts ADD COLUMN excerpt_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE programming_posts ADD COLUMN content_en TEXT'); } catch (_e) {}

  // artworks
  try { await db.exec('ALTER TABLE artworks ADD COLUMN title_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE artworks ADD COLUMN description_en TEXT'); } catch (_e) {}

  // jewelry
  try { await db.exec('ALTER TABLE jewelry ADD COLUMN title_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE jewelry ADD COLUMN description_en TEXT'); } catch (_e) {}

  // friends
  try { await db.exec('ALTER TABLE friends ADD COLUMN short_bio_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE friends ADD COLUMN bio_en TEXT'); } catch (_e) {}

  // friend_posts
  try { await db.exec('ALTER TABLE friend_posts ADD COLUMN title_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE friend_posts ADD COLUMN excerpt_en TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE friend_posts ADD COLUMN content_en TEXT'); } catch (_e) {}

  console.log('✅ i18n _en columns ready');

  // Gallery folders
  await db.exec(`
    CREATE TABLE IF NOT EXISTS gallery_folders (
      id            ${pk},
      name          TEXT NOT NULL,
      slug          TEXT UNIQUE NOT NULL,
      parent_id     INTEGER,
      display_order INTEGER DEFAULT 0,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES gallery_folders(id)
    )
  `);
  console.log('✅ gallery_folders table ready');

  // Gallery images
  await db.exec(`
    CREATE TABLE IF NOT EXISTS gallery_images (
      id              ${pk},
      folder_id       INTEGER,
      image_url       TEXT NOT NULL,
      identifier      TEXT UNIQUE NOT NULL,
      title           TEXT,
      alt_text        TEXT,
      display_order   INTEGER DEFAULT 0,
      file_size_bytes INTEGER DEFAULT 0,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES gallery_folders(id)
    )
  `);
  try { await db.exec('ALTER TABLE gallery_images ADD COLUMN file_size_bytes INTEGER DEFAULT 0'); } catch (_e) {}
  console.log('✅ gallery_images table ready');

  // Inquiries
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id         ${pk},
      name       TEXT,
      email      TEXT,
      subject    TEXT,
      message    TEXT,
      is_read    INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ inquiries table ready');

  // Settings
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const defaultSettings = [
    ['site_name',        'Inachis'],
    ['site_tagline',     'Creative Portfolio'],
    ['owner_name',       ''],
    ['contact_email',    ''],
    ['social_instagram', ''],
    ['social_twitter',   ''],
    ['hero_image',       ''],
    ['about_image',      ''],
    ['about_text',       ''],
    ['friend_storage_limit_mb', '200'],
    ['site_logo', ''],
    ['site_name_en', ''],
    ['site_tagline_en', ''],
    ['owner_name_en', ''],
    ['about_text_en', ''],
  ];

  for (const [key, value] of defaultSettings) {
    await db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`
    ).run(key, value);
  }
  console.log('✅ settings table ready');

  // Pages — public page intro texts
  await db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id            ${pk},
      slug          TEXT UNIQUE NOT NULL,
      title         TEXT NOT NULL DEFAULT '',
      title_en      TEXT NOT NULL DEFAULT '',
      intro_text    TEXT NOT NULL DEFAULT '',
      intro_text_en TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Additive migrations for databases created before the bilingual columns
  // existed (must run BEFORE the seed below, which may reference them).
  try { await db.exec('ALTER TABLE pages ADD COLUMN title_en TEXT NOT NULL DEFAULT \'\''); } catch (_e) {}
  try { await db.exec('ALTER TABLE pages ADD COLUMN intro_text_en TEXT NOT NULL DEFAULT \'\''); } catch (_e) {}

  for (const [slug, title] of Object.entries(DEFAULT_PAGE_TITLES)) {
    await db.prepare(
      `INSERT INTO pages (slug, title, title_en, intro_text) VALUES (?, ?, ?, '') ON CONFLICT (slug) DO NOTHING`
    ).run(slug, title, DEFAULT_PAGE_TITLES_EN[slug] || '');
  }
  // Backfill the English title for rows seeded before title_en existed
  // (additive, idempotent — only touches empty values).
  for (const [slug, titleEn] of Object.entries(DEFAULT_PAGE_TITLES_EN)) {
    await db.prepare(
      `UPDATE pages SET title_en = ? WHERE slug = ? AND (title_en IS NULL OR title_en = '')`
    ).run(titleEn, slug);
  }
  console.log('✅ pages table ready');

  // ── Menu categories (additive, backwards-compatible) ──────────────────────
  // `slug` = URL segment for subcategories (/texty/<slug>); `page_slug` =
  // slug of the parent menu page this category nests under (e.g. 'texty').
  // NULL page_slug = top-level menu grouping category; NULL slug = no URL.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id         ${pk},
      name       TEXT NOT NULL UNIQUE,
      name_en    TEXT NOT NULL DEFAULT '',
      slug       TEXT UNIQUE,
      page_slug  TEXT,
      is_visible INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Additive migrations for databases created before these columns existed
  // (SQLite cannot add a UNIQUE column via ALTER — enforced by the CREATE
  // TABLE above on fresh databases; slug uniqueness is also checked in code).
  try { await db.exec('ALTER TABLE categories ADD COLUMN name_en TEXT NOT NULL DEFAULT \'\''); } catch (_e) {}
  try { await db.exec('ALTER TABLE categories ADD COLUMN slug TEXT'); } catch (_e) {}
  try { await db.exec('ALTER TABLE categories ADD COLUMN page_slug TEXT'); } catch (_e) {}
  console.log('✅ categories table ready');

  // Pages carry menu metadata. Additive columns with safe defaults: existing
  // pages stay visible (is_visible = 1), order 0, no category (category_id NULL).
  try { await db.exec('ALTER TABLE pages ADD COLUMN category_id INTEGER'); } catch (_e) {}
  try { await db.exec('ALTER TABLE pages ADD COLUMN is_visible INTEGER DEFAULT 1'); } catch (_e) {}
  try { await db.exec('ALTER TABLE pages ADD COLUMN sort_order INTEGER DEFAULT 0'); } catch (_e) {}
  console.log('✅ pages menu columns ready');

  // ── Global content tags (additive, backwards-compatible) ────────────────
  // Many-to-many: `tags` (global, cross-category) connects to any image-bearing
  // content item (texts/artworks/jewelry/blog_posts/programming_posts/
  // friend_posts) through `content_tags`. Tags are distinct from menu
  // categories — never children of them — and never store comma-separated
  // strings on the content rows. `name_key` is the case-insensitive uniqueness
  // key ("Příroda" and "příroda" are the same tag); `slug` is the public URL
  // segment (/tag/<slug>) and is immutable after creation so links stay stable.
  // Deleting a tag removes only its `content_tags` associations — content is
  // never cascaded. Existing content starts untagged.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id         ${pk},
      name       TEXT NOT NULL,
      name_en    TEXT NOT NULL DEFAULT '',
      name_key   TEXT NOT NULL UNIQUE,
      slug       TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec('ALTER TABLE tags ADD COLUMN name_en TEXT NOT NULL DEFAULT \'\''); } catch (_e) {}
  await db.exec(`
    CREATE TABLE IF NOT EXISTS content_tags (
      id           ${pk},
      tag_id       INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      content_id   INTEGER NOT NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tag_id, content_type, content_id)
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_content_tags_tag_id ON content_tags(tag_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_content_tags_content ON content_tags(content_type, content_id)');
  console.log('✅ tags + content_tags tables ready');

  // ── Seed the Texty subcategories ──────────────────────────────────────
  // Knihy / Povídky / Básně have always existed as public nav links, SPA
  // routes and `texts.category` values, but were never records in this table.
  // Promoting them here (idempotently — only when neither the slug nor the
  // exact name already exists) lets the admin manage them like any other
  // category without duplicating an existing record the admin may have
  // already created by hand.
  const textSubcategories = [
    ['Knihy',   'Books',   'knihy',   1],
    ['Povídky', 'Stories', 'povidky', 2],
    ['Básně',   'Poems',   'basne',   3],
  ];
  for (const [name, nameEn, slug, sortOrder] of textSubcategories) {
    const existing = await db.prepare(
      'SELECT id FROM categories WHERE slug = ? OR name = ?'
    ).get(slug, name);
    if (!existing) {
      await db.prepare(
        'INSERT INTO categories (name, name_en, slug, page_slug, is_visible, sort_order) VALUES (?, ?, ?, ?, 1, ?)'
      ).run(name, nameEn, slug, 'texty', sortOrder);
    } else if (!existing.name_en) {
      // Backfill English names on categories seeded before the column existed
      // (additive, idempotent — only touches empty values).
      await db.prepare(
        'UPDATE categories SET name_en = ? WHERE id = ? AND (name_en IS NULL OR name_en = \'\')'
      ).run(nameEn, existing.id);
    }
  }
  console.log('✅ text subcategories seeded (Knihy, Povídky, Básně)');

  // Seed admin user
  const passwordHash = bcrypt.hashSync('admin123', 10);
  await db.prepare(
    `INSERT INTO users (email, password_hash, role, name)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (email) DO NOTHING`
  ).run('admin@inachis.art', passwordHash, 'admin', 'Admin');

  console.log('✅ Database initialized');
  console.log('   Admin: admin@inachis.art / admin123');
}

export default db;
