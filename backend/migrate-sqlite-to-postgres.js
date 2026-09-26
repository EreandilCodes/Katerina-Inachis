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

const SQLITE_SRC = process.env.MIGRATION_SQLITE_SRC || '/data/inachis.db';
const SQLITE_COPY = process.env.MIGRATION_SQLITE_COPY || '/tmp/migrate-inachis.db';
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
    // (The schemas come from SQLite DDL, which has no IF NOT EXISTS — add it,
    // otherwise a re-run crashes with 42P07 instead of upserting.)
    await pool.query(
      createSql.replace(/CREATE TABLE (?!IF NOT EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ')
    );
    console.log('created table', t);

    // Columns (in table order).
    const cols = await srcAll(`PRAGMA table_info(${t})`);
    const colNames = cols.map((c) => c.name);
    // `settings` has no `id` column — its conflict target and update set
    // differ from every id-keyed table.
    const isSettings = t === 'settings';

    // Read the source rows in a deterministic order. gallery_folders has a
    // self-FK — roots (parent_id IS NULL) first, then children.
    let rows;
    if (t === 'gallery_folders') {
      const roots = await srcAll(`SELECT * FROM gallery_folders WHERE parent_id IS NULL ORDER BY id`);
      const children = await srcAll(`SELECT * FROM gallery_folders WHERE parent_id IS NOT NULL ORDER BY id`);
      rows = [...roots, ...children];
    } else if (t === 'settings') {
      // `settings` is keyed by TEXT `key`, not `id` — order by key.
      rows = await srcAll(`SELECT * FROM settings ORDER BY key`);
    } else {
      rows = await srcAll(`SELECT * FROM ${t} ORDER BY id`);
    }

    // Sequence state must be fixed even when the table is empty (rows were
    // deleted over time but sqlite_sequence still holds the high-water mark),
    // so the empty-table bail-out below must not skip it.
    if (rows.length === 0) {
      console.log(`  ${t}: 0 rows (skipping insert)`);
      if (!isSettings) {
        const seq = `${t}_id_seq`;
        const seqRow = await srcGet(`SELECT seq FROM sqlite_sequence WHERE name = ?`, [t]).catch(() => null);
        const maxRow = await srcGet(`SELECT MAX(id) AS m FROM ${t}`);
        const target = Math.max(Number(seqRow?.seq ?? 0), Number(maxRow?.m ?? 0));
        try {
          if (target > 0) {
            await pool.query(`SELECT setval('${seq}', $1, true)`, [target]);
            console.log(`  ${t}: sequence set to ${target} (from sqlite_sequence)`);
          } else {
            await pool.query(`SELECT setval('${seq}', 1, false)`);
          }
        } catch (err) {
          console.log(`  ${t}: sequence reset skipped (${err.message})`);
        }
      }
      continue;
    }
    const conflictCol = isSettings ? 'key' : 'id';
    const updateCols = isSettings
      ? ['value', 'updated_at']
      : colNames.filter((c) => c !== 'id');
    const updateSet = updateCols.map((c) => `${c}=EXCLUDED.${c}`).join(', ');

    // One parameter set per ROW (the original wrapped [rows] in an extra
    // array, emitting a single VALUES group with $1..N placeholders for any
    // row count while binding N*cols values — PostgreSQL rejects that).
    const valuePlaceholders = rows
      .map((_, rowIdx) => {
        const base = rowIdx * colNames.length;
        return '(' + colNames.map((_, c) => `$${base + c + 1}`).join(', ') + ')';
      })
      .join(', ');
    const sql = `INSERT INTO ${t} (${colNames.join(', ')}) VALUES ${valuePlaceholders} ON CONFLICT (${conflictCol}) DO UPDATE SET ${updateSet}`;
    const values = rows.flatMap((r) => colNames.map((c) => r[c] ?? null));

    const start = Date.now();
    await pool.query(sql, values);
    console.log(`  ${t}: ${rows.length} rows inserted (${Date.now() - start}ms)`);

    // Reset the sequence so the next auto-generated id continues after the
    // migrated rows. AUTOINCREMENT never reuses ids, so sqlite_sequence holds
    // the true high-water mark (MAX(id) can be lower after deletions) —
    // prefer it, fall back to MAX(id), and setval to it. `settings` has no
    // id/SERIAL — nothing to reset.
    if (!isSettings) {
      const seq = `${t}_id_seq`;
      const seqRow = await srcGet(`SELECT seq FROM sqlite_sequence WHERE name = ?`, [t]).catch(() => null);
      const maxRow = await srcGet(`SELECT MAX(id) AS m FROM ${t}`);
      const target = Math.max(Number(seqRow?.seq ?? 0), Number(maxRow?.m ?? 0));
      try {
        if (target > 0) {
          await pool.query(`SELECT setval('${seq}', $1, true)`, [target]);
          console.log(`  ${t}: sequence set to ${target}`);
        } else {
          // Table never had rows — leave the fresh sequence at 1.
          await pool.query(`SELECT setval('${seq}', 1, false)`);
        }
      } catch (err) {
        // Sequence may not exist (e.g., if the table has no SERIAL).
        console.log(`  ${t}: sequence reset skipped (${err.message})`);
      }
    }
  }

  // Verify: compare counts with source.
  // (PG numerics come back as strings — compare coerced Numbers, not raw values.)
  console.log('\n=== Verification (source vs migrated) ===');
  let ok = true;
  for (const t of ORDER) {
    const srcCnt = Number((await srcGet(`SELECT COUNT(*) AS c FROM ${t}`)).c);
    const pgRow = await pgGet(`SELECT COUNT(*) AS c FROM ${t}`);
    const pgCnt = Number(pgRow?.c ?? 0);
    const match = srcCnt === pgCnt;
    if (!match) ok = false;
    console.log(`${t}: sqlite=${srcCnt} postgres=${pgCnt} ${match ? 'OK' : 'MISMATCH'}`);
  }
  // Also verify the sqlite_sequence values match (AUTOINCREMENT tracking).
  // SQLite copies created with `cat` keep their sqlite_sequence values, but
  // some builds report them differently — treat "undefined/0" source entries
  // as informational only and rely on the count comparison above for verdict.
  let srcSeq = [];
  try {
    // The column is `seq`, not `value` (SELECT * is unreliable on sqlite_sequence).
    srcSeq = await srcAll(`SELECT name, seq FROM sqlite_sequence ORDER BY name`);
  } catch {
    console.log('\nsqlite_sequence not available in the source copy (no AUTOINCREMENT rows recorded)');
  }
  if (srcSeq.length) {
    console.log('\nsqlite_sequence (last_value reports the last FETCHED value, not setval — informational):');
    for (const s of srcSeq) {
      const seq = `${s.name}_id_seq`;
      const state = await pgGet(
        `SELECT last_value, is_called FROM ${seq}`
      ).catch(() => null);
      const srcVal = Number(s.seq ?? 0);
      if (!state) { console.log(`  ${s.name}: no sequence`); continue; }
      // PG semantics: is_called=false → next nextval() yields last_value (fresh),
      // is_called=true → next nextval() yields last_value+1. Compute the true
      // next id and require next > source seq (ids never reused).
      const next = state.is_called ? Number(state.last_value) + 1 : Number(state.last_value);
      const fine = srcVal === 0 ? true : next > srcVal;
      if (!fine) ok = false;
      console.log(`  ${s.name}: sqlite_seq=${s.seq} next_pg_id=${next} ${fine ? 'OK' : 'BEHIND'}`);
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
