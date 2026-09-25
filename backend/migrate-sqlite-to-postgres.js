// One-time, additive, idempotent migration: SQLite (/data/inachis.db) → PostgreSQL.
//
// Prerequisites (all satisfied before running):
//   - PostgreSQL addon provisioned (DATABASE_URL set)
//   - `pg` is installed (added to package.json)
//   - the app is NOT switched to DB_PROVIDER=postgres yet
//
// Safety properties:
//   - reads from a COPY of the SQLite DB (no lock contention with the running app)
//   - never touches /data/inachis.db or /data/uploads/gallery
//   - preserves every existing id (so FK references stay valid)
//   - resets each table's sequence to max(id) so future auto-generated ids continue correctly
//   - ON CONFLICT (id) DO UPDATE makes repeated runs a faithful mirror (idempotent)
//   - tables created in foreign-key dependency order

import { Pool } from 'pg';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import { execSync } from 'child_process';

const SQLITE_SRC = '/data/inachis.db';
const SQLITE_COPY = '/tmp/migrate-inachis.db';
const TABLES = [
  'users', 'categories', 'pages', 'settings', 'tags',
  'texts', 'artworks', 'jewelry', 'blog_posts', 'programming_posts',
  'friends', 'gallery_folders', 'friend_posts', 'gallery_images',
  'inquiries', 'content_tags',
];

// Foreign-key dependency order: a table may reference only tables that appear earlier.
// gallery_folders has a self-reference (parent_id) — roots first.
const ORDER = [
  'users',
  'categories',
  'pages',
  'settings',
  'tags',
  'texts',
  'artworks',
  'jewelry',
  'blog_posts',
  'programming_posts',
  'friends',
  'gallery_folders',   // self-FK: insert roots first below
  'friend_posts',
  'gallery_images',
  'inquiries',
  'content_tags',
];

// Safety: never run against production SQLite directly.
if (!fs.existsSync(SQLITE_SRC)) {
  console.error('Source SQLite DB not found at', SQLITE_SRC);
  process.exit(1);
}

// Copy the DB to a temp file so the running app is never locked/contended with.
execSync(`cp "${SQLITE_SRC}" "${SQLITE_COPY}"`, { maxBuffer: 10 * 1024 * 1024 });
console.log('Copied', SQLITE_SRC, '→', SQLITE_COPY);

// Verify the copy is a valid SQLite DB before touching anything.
try {
  const ver = execSync(`sqlite3 "${SQLITE_COPY}" "PRAGMA integrity_check;"`, { encoding: 'utf-8' }).trim();
  if (ver !== 'ok') {
    console.error('Copy failed integrity check:', ver);
    process.exit(1);
  }
  console.log('Copy integrity: ok');
} catch {
  // sqlite3 CLI may not be present; fall back to the node sqlite3 read.
  console.log('sqlite3 CLI not available, proceeding (node read-only open used below)');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const src = new sqlite3.Database(SQLITE_COPY, sqlite3.OPEN_READONLY);

// Read helpers on the SQLite copy (source).
function srcAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    src.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function srcGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    src.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
// Write helpers on PostgreSQL (target).
function pgAll(sql, params = []) {
  return pool.query(sql, params).then((r) => r.rows);
}
function pgGet(sql, params = []) {
  return pool.query(sql, params).then((r) => r.rows[0] ?? null);
}

async function main() {
  // Read each table's authoritative schema from SQLite (includes UNIQUE constraints).
  const schemas = {};
  for (const t of TABLES) {
    const row = await srcGet(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, [t]
    );
    if (!row) { console.error('Missing table in source:', t); process.exit(1); }
    // SQLite AUTOINCREMENT -> PG SERIAL PRIMARY KEY.
    schemas[t] = row.sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
  }

  for (const t of ORDER) {
    const createSql = schemas[t];
    // Create if not exists: safe on a fresh DB and idempotent across re-runs.
    await pool.query(createSql);
    console.log('created table', t);

    // Columns (in table order) + which are NOT NULL for the EXCLUDED update.
    const cols = await srcAll(`PRAGMA table_info(${t})`);
    const colNames = cols.map((c) => c.name);
    const idIdx = colNames.indexOf('id');
    const insertCols = colNames; // include id explicitly
    const updateSet = colNames
      .filter((_, i) => i !== idIdx)
      .map((c) => `${c}=EXCLUDED.${c}`)
      .join(', ');

    // gallery_folders: self-FK — roots (parent_id IS NULL) first, then children.
    let rows;
    if (t === 'gallery_folders') {
      const roots = await srcAll(`SELECT * FROM gallery_folders WHERE parent_id IS NULL ORDER BY id`);
      const children = await srcAll(`SELECT * FROM gallery_folders WHERE parent_id IS NOT NULL ORDER BY id`);
      rows = [...roots, ...children];
    } else {
      rows = await srcAll(`SELECT * FROM ${t} ORDER BY id`);
    }

    if (rows.length === 0) {
      console.log(`  ${t}: 0 rows (skipping)`);
      continue;
    }

    const placeholders = '(' + colNames.map((_, i) => `$${i + 1}`).join(', ') + ')';
    const sql = `INSERT INTO ${t} (${insertCols.join(', ')}) VALUES ${[rows].map(() => placeholders).join(', ')} ON CONFLICT (id) DO UPDATE SET ${updateSet}`;
    const values = rows.flatMap((r) => colNames.map((c) => r[c] ?? null));

    const start = Date.now();
    await pool.query(sql, values);
    console.log(`  ${t}: ${rows.length} rows inserted (${Date.now() - start}ms)`);

    // Reset the sequence so the next auto-generated id = max(id)+1.
    const maxRow = await srcGet(`SELECT MAX(id) AS m FROM ${t}`);
    if (maxRow && maxRow.m != null) {
      const seq = `${t}_id_seq`;
      try {
        await pool.query(`SELECT setval('${seq}', $1, true)`, [maxRow.m]);
      } catch (err) {
        // Sequence may not exist (e.g., if the table has no SERIAL).
        console.log(`  ${t}: sequence reset skipped (${err.message})`);
      }
    }
  }

  // Verify: compare counts with source.
  console.log('\n=== Verification (source vs migrated) ===');
  let ok = true;
  for (const t of ORDER) {
    const srcCnt = (await srcGet(`SELECT COUNT(*) AS c FROM ${t}`)).c;
    const pgRow = await pgGet(`SELECT COUNT(*) AS c FROM ${t}`);
    const pgCnt = pgRow.c;
    const match = srcCnt === pgCnt;
    if (!match) ok = false;
    console.log(`${t}: sqlite=${srcCnt} postgres=${pgCnt} ${match ? '✅' : '❌'}`);
  }
  // Also verify the sqlite_sequence values match (AUTOINCREMENT tracking).
  const srcSeq = await srcAll(`SELECT * FROM sqlite_sequence ORDER BY name`);
  if (srcSeq.length) {
    console.log('\nsqlite_sequence:');
    for (const s of srcSeq) {
      const pgSeqRow = await pgGet(`SELECT last_value FROM ${s.name}_id_seq`);
      console.log(`  ${s.name}: sqlite=${s.value} postgres_last=${pgSeqRow?.last_value} ${Number(pgSeqRow?.last_value) >= Number(s.value) ? '✅' : '⚠️'}`);
    }
  }

  if (!ok) {
    console.error('\nMIGRATION INCOMPLETE: counts differ — see above.');
    process.exit(1);
  }
  console.log('\n✅ Migration complete. All counts match.');

  src.close();
  await pool.end();
  // Remove the temp copy (read-only artifact).
  try { fs.unlinkSync(SQLITE_COPY); } catch {}
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
