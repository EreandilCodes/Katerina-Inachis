// E2E tests for Gallery upload: server-side image optimization, format
// handling, on-disk consistency, and persistence across a server restart.
//
// Run locally:   npm run test:gallery
//
// Env:
//   ADMIN_EMAIL / ADMIN_PASSWORD   admin credentials (optional, has defaults)
//   INACHIS_TEST_CHROME            path to a chromium binary (optional)
//   TEST_SERVER_RESTART_CMD        restarts the local server (persistence check;
//                                  omit in production)
//
// Safety: uses unique `qa-gallery-<ts>-*` filenames/identifiers, deletes its DB
// records and removes its files in a finally block.

import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const RESTART_CMD = process.env.TEST_SERVER_RESTART_CMD || '';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const LEGACY_DIR = path.join(REPO, 'frontend', 'uploads', 'gallery');

// Mirror the server's upload-dir resolution (see backend/routes/gallery.js).
function resolveUploadDir() {
  if (process.env.GALLERY_UPLOAD_DIR) return path.resolve(process.env.GALLERY_UPLOAD_DIR);
  const dbPath = process.env.SQLITE_PATH;
  if (process.env.DB_PROVIDER !== 'postgres' && dbPath && dbPath.startsWith('/data/')) return '/data/uploads/gallery';
  return LEGACY_DIR;
}
const UPLOAD_DIR = resolveUploadDir();
const DISK_ACCESSIBLE = fs.existsSync(UPLOAD_DIR);

const TS = String(Date.now());
const NOISE_NAME = `qa-gallery-${TS}-noise.jpg`;
const ALPHA_NAME = `qa-gallery-${TS}-alpha.png`;
const ORIENT_NAME = `qa-gallery-${TS}-orient.jpg`;
const NOISE_IDN = `qa-gallery-${TS}-noise`;
const ALPHA_IDN = `qa-gallery-${TS}-alpha`;
const ORIENT_IDN = `qa-gallery-${TS}-orient`;

const results = [];

function record(ok, name, detail = '') {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function check(name, fn) {
  try {
    await fn();
    record(true, name);
  } catch (err) {
    record(false, name, err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const ct = res.headers.get('content-type');
  let body;
  try {
    body = ct && ct.includes('application/json') ? await res.json() : await res.text();
  } catch {
    body = await res.text();
  }
  if (!res.ok) {
    const detail = typeof body === 'object' ? JSON.stringify(body) : String(body).slice(0, 200);
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return body;
}

async function adminLogin() {
  const d = await fetchJson(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  return d.token;
}

const auth = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function waitUp(timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      await fetch(`${BASE}/api/pages`);
      return;
    } catch {
      await sleep(1500);
    }
  }
  throw new Error('server did not come back up');
}

// ── Test image builders ────────────────────────────────────────────────
// 4000×3000 photographic noise JPEG → must shrink to 2000×1500.
async function buildNoiseJpeg(w = 4000, h = 3000, quality = 90) {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i += 3) {
    px[i] = Math.floor(Math.random() * 256);
    px[i + 1] = Math.floor(Math.random() * 256);
    px[i + 2] = Math.floor(Math.random() * 256);
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality }).toBuffer();
}

// 1200×1200 RGBA PNG with a transparent checkerboard → alpha must survive.
async function buildAlphaPng() {
  const size = 1200;
  const px = Buffer.alloc(size * size * 4);
  const step = 40;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const on = Math.floor(x / step) % 2 === Math.floor(y / step) % 2;
      px[idx] = on ? 200 : 40;
      px[idx + 1] = on ? 60 : 180;
      px[idx + 2] = on ? 90 : 60;
      px[idx + 3] = on ? 255 : 0;
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

// 100×200 JPEG explicitly marked EXIF orientation 6 → auto-rotate must swap to 200×100.
async function buildOrientedJpeg() {
  const w = 100, h = 200;
  const px = Buffer.alloc(w * h * 3, 120);
  return sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ── Setup: reachability, login, build artifacts ────────────────────────
await fetchJson(`${BASE}/api/pages`);
const token = await adminLogin();
console.log(`Upload dir: ${UPLOAD_DIR}${DISK_ACCESSIBLE ? '' : ' (not on this runner — disk asserts skipped)'}`);

const noiseBuf = await buildNoiseJpeg();
const alphaBuf = await buildAlphaPng();
const orientBuf = await buildOrientedJpeg();
console.log(`Source sizes -> noise ${noiseBuf.length} B, alpha ${alphaBuf.length} B, orient ${orientBuf.length} B`);

const created = []; // { id, name, identifier }

async function uploadAll() {
  const fd = new FormData();
  fd.append('files', new Blob([noiseBuf], { type: 'image/jpeg' }), NOISE_NAME);
  fd.append('files', new Blob([alphaBuf], { type: 'image/png' }), ALPHA_NAME);
  fd.append('files', new Blob([orientBuf], { type: 'image/jpeg' }), ORIENT_NAME);
  fd.append('title', '[QA-GALLERY] auto-upload');
  // No 'Content-Type' header: fetch must set the multipart boundary itself.
  return fetchJson(`${BASE}/api/gallery/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
}

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;
const browser = await chromium.launch(launchOpts);

try {
  // ── A. Upload: all three images accepted, optimized, consistent ─────
  const upload = await uploadAll();

  await check('A1: upload accepts 3 images and reports 3 saved', async () => {
    assert(upload.images && upload.images.length === 3, `expected 3 images, got ${upload.images?.length}`);
    assert(!upload.errors || upload.errors.length === 0, `upload errors: ${JSON.stringify(upload.errors)}`);
    assert(upload.message.includes('3'), `unexpected message: ${upload.message}`);
  });

  const byIdn = (idn) => upload.images.find((i) => i.identifier === idn);
  const noiseImg = byIdn(NOISE_IDN);
  const alphaImg = byIdn(ALPHA_IDN);
  const orientImg = byIdn(ORIENT_IDN);

  await check('A2: each image got a URL under /uploads/gallery/', async () => {
    for (const img of [noiseImg, alphaImg, orientImg]) {
      assert(img && img.image_url && img.image_url.startsWith('/uploads/gallery/'), `bad url for ${img?.identifier}: ${img?.image_url}`);
      created.push({ id: img.id, name: path.basename(img.image_url), identifier: img.identifier });
    }
  });

  const noiseRecord = upload.images.find((i) => i.identifier === NOISE_IDN);
  await check('A3: oversized photo is downscaled to ≤2000px and smaller', async () => {
    const res = await fetch(BASE + noiseRecord.image_url);
    assert(res.status === 200, `public URL HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    assert(meta.width <= 2000 && meta.height <= 2000, `dims ${meta.width}x${meta.height} exceed 2000`);
    assert(Math.abs(meta.width / meta.height - 4 / 3) < 0.05, `aspect ${meta.width / meta.height} != 4:3`);
    assert(bytes.length > 0 && bytes.length < noiseBuf.length, `optimized ${bytes.length} B not smaller than source ${noiseBuf.length} B`);
  });

  await check('A4: PNG transparency is preserved through optimization', async () => {
    const res = await fetch(BASE + alphaImg.image_url);
    const bytes = Buffer.from(await res.arrayBuffer());
    const info = await sharp(bytes).metadata();
    assert(info.hasAlpha === true, `alpha lost (hasAlpha=${info.hasAlpha})`);
    assert(info.width === 1200 && info.height === 1200, `dims ${info.width}x${info.height} changed (no enlargement expected)`);
  });

  await check('A5: EXIF orientation is auto-rotated (100×200 → 200×100)', async () => {
    const res = await fetch(BASE + orientImg.image_url);
    const bytes = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    assert(meta.width === 200 && meta.height === 100, `orientation not applied: ${meta.width}x${meta.height}`);
  });

  // ── B. DB + on-disk consistency ─────────────────────────────────────
  await check('B1: DB records exist with identifier/file_size_bytes', async () => {
    const list = await fetchJson(`${BASE}/api/gallery/images`, { headers: auth(token) });
    for (const idn of [NOISE_IDN, ALPHA_IDN, ORIENT_IDN]) {
      const row = list.find((r) => r.identifier === idn);
      assert(row, `record ${idn} missing from /api/gallery/images`);
      assert(row.file_size_bytes > 0, `${idn} has file_size_bytes=0`);
    }
  });

  await check('B2: files exist on disk and sizes match DB', async () => {
    if (!DISK_ACCESSIBLE || UPLOAD_DIR.startsWith('/data/')) {
      console.log('SKIP  B2 — upload dir not on this runner');
      return;
    }
    for (const img of created) {
      const fp = path.join(UPLOAD_DIR, img.name);
      assert(fs.existsSync(fp), `file missing on disk: ${img.name}`);
      const list = await fetchJson(`${BASE}/api/gallery/images`, { headers: auth(token) });
      const row = list.find((r) => r.id === img.id);
      assert(row && row.file_size_bytes === fs.statSync(fp).size, `db size ${row?.file_size_bytes} != disk size for ${img.name}`);
    }
  });

  // ── C. Reject non-images ────────────────────────────────────────────
  await check('C1: non-image upload is rejected with 400', async () => {
    const fd = new FormData();
    fd.append('files', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), `qa-gallery-${TS}-bad.txt`);
    let status = 0;
    let body = null;
    try {
      body = await fetchJson(`${BASE}/api/gallery/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
    } catch (err) {
      status = Number(err.message.slice(5, 8));
    }
    assert(status === 400 || (body && body.error), `expected 400, got status=${status} body=${JSON.stringify(body)}`);
  });

  // ── D. Admin UI renders the uploaded image (survives reload) ────────
  await check('D1: admin Gallery row shows the image and survives reload', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'load' });
      await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
      await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => document.getElementById('adminPageTitle') && document.getElementById('adminPageTitle').textContent.trim().length > 0,
        null,
        { timeout: 30000 }
      );
      // Open the Galerie section (admin sections are shown on nav click).
      await page.locator('a[data-section="gallery"]').first().click();
      await page.waitForFunction(
        () => {
          const el = document.getElementById('gallerySection');
          return el && getComputedStyle(el).display !== 'none';
        },
        null,
        { timeout: 15000 }
      );
      await page.fill('#gallerySearchInput', NOISE_IDN);
      await page.waitForFunction(
        (idn) => {
          const tbody = document.getElementById('galleryImagesTableBody');
          return tbody && tbody.textContent.includes(idn);
        },
        NOISE_IDN,
        { timeout: 15000 }
      );
      const imgSrc = await page
        .locator(`#galleryImagesTableBody img[src^="/uploads/gallery/"]`)
        .first()
        .getAttribute('src')
        .catch(() => null);
      // Server appends its own timestamp to the stored filename; match by prefix.
      assert(imgSrc && imgSrc.includes(`qa-gallery-${TS}-noise`), `expected <img> with ${NOISE_IDN}, got ${imgSrc}`);

      await page.reload({ waitUntil: 'load' });
      await page.locator('a[data-section="gallery"]').first().click();
      await page.waitForFunction(
        (idn) => {
          const tbody = document.getElementById('galleryImagesTableBody');
          return tbody && tbody.textContent.includes(idn);
        },
        NOISE_IDN,
        { timeout: 15000 }
      );
      assert(true, 'row still present after reload');
    } finally {
      await page.close();
    }
  });

  // ── E. Persistence across a server restart (local only) ─────────────
  if (RESTART_CMD) {
    let execSync;
    try {
      ({ execSync } = await import('node:child_process'));
    } catch {
      execSync = null;
    }

    await check('E1: gallery images survive a server restart', async () => {
      assert(execSync, 'execSync unavailable');
      execSync(RESTART_CMD, { stdio: 'inherit', shell: true });
      await waitUp();

      const list = await fetchJson(`${BASE}/api/gallery/images`, { headers: auth(token) });
      for (const idn of [NOISE_IDN, ALPHA_IDN, ORIENT_IDN]) {
        assert(list.some((r) => r.identifier === idn), `${idn} lost after restart`);
      }
      const res = await fetch(BASE + noiseImg.image_url);
      assert(res.status === 200, `public URL HTTP ${res.status} after restart`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      assert(meta.width <= 2000, 'image not served after restart');
      if (DISK_ACCESSIBLE && !UPLOAD_DIR.startsWith('/data/')) {
        const fp = path.join(UPLOAD_DIR, path.basename(noiseImg.image_url));
        assert(fs.existsSync(fp), `file missing on disk after restart: ${fp}`);
      }
    });
  } else {
    console.log('SKIP  E1 — set TEST_SERVER_RESTART_CMD to test restart persistence');
  }
} catch (err) {
  console.error(`UNEXPECTED ${err.message}`);
  results.push({ ok: false, name: 'unexpected error', detail: err.message });
} finally {
  const ids = created.map((c) => c.id).filter(Boolean);
  console.log(`Cleanup: deleting gallery records [${ids.join(', ')}], files [${created.map((c) => c.name).join(', ')}]`);
  for (const id of ids) {
    await fetch(`${BASE}/api/gallery/images/${id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
  }
  if (DISK_ACCESSIBLE && !UPLOAD_DIR.startsWith('/data/')) {
    for (const c of created) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, c.name)); } catch {}
    }
  }
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
for (const r of failed) console.log(`FAILED: ${r.name} — ${r.detail}`);
process.exit(failed.length > 0 ? 1 : 0);