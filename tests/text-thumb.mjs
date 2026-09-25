// E2E tests for thumbnail serving of listing-card cover images.
//
// Built on the measured /texty bottleneck: card thumbnails (shown ~360px wide)
// were downloading full-size /uploads/gallery originals (multi-MB PNGs).
// Listing cards must now request light WebP variants from /img/gallery, detail
// pages must keep the full original, and the derived thumbnails must never
// touch or shadow the source file.
//
// Run locally:   npm run test:textthumb
//
// Env:
//   ADMIN_EMAIL / ADMIN_PASSWORD   admin credentials (optional, has defaults)
//   INACHIS_TEST_CHROME            path to a chromium binary (optional)
//
// Safety: uses unique `qa-thumb-<ts>-*` filenames/identifiers, deletes its DB
// records and removes its files in a finally block.

import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const LEGACY_DIR = path.join(REPO, 'frontend', 'uploads', 'gallery');

function resolveUploadDir() {
  if (process.env.GALLERY_UPLOAD_DIR) return path.resolve(process.env.GALLERY_UPLOAD_DIR);
  const dbPath = process.env.SQLITE_PATH;
  if (process.env.DB_PROVIDER !== 'postgres' && dbPath && dbPath.startsWith('/data/')) return '/data/uploads/gallery';
  return LEGACY_DIR;
}
// Mirror of backend/routes/images.js resolveThumbsDir() for the disk asserts.
// Only the local default is deterministic here; remote (volume) layouts set it
// to undefined so those asserts are skipped.
function resolveThumbsDir() {
  if (process.env.GALLERY_UPLOAD_DIR) return undefined;
  const dbPath = process.env.SQLITE_PATH;
  if (process.env.DB_PROVIDER !== 'postgres' && dbPath && dbPath.startsWith('/data/')) return undefined;
  return path.join(REPO, 'data-cache', 'thumbs');
}
const UPLOAD_DIR = resolveUploadDir();
const THUMBS_DIR = resolveThumbsDir();
const DISK_ACCESSIBLE = fs.existsSync(UPLOAD_DIR);

const TS = String(Date.now());
const IMG_IDN  = `qa-thumb-${TS}-cover-png`;
const IMG_NAME = `${IMG_IDN}.png`;
const MARK = '[QA-THUMB]';
const QA_TEXT  = `${MARK} text ${TS}`;

const results = [];
function record(ok, name, detail = '') {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function check(name, fn) {
  try { await fn(); record(true, name); }
  catch (err) { record(false, name, err.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const ct = res.headers.get('content-type');
  let body;
  try { body = ct && ct.includes('application/json') ? await res.json() : await res.text(); }
  catch { body = await res.text(); }
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

// 1440×960 raw-noise PNG → a large original the thumb must shrink dramatically.
async function buildNoisePng(w = 1440, h = 960) {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i += 3) {
    px[i] = Math.floor(Math.random() * 256);
    px[i + 1] = Math.floor(Math.random() * 256);
    px[i + 2] = Math.floor(Math.random() * 256);
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

async function waitAppContent(page) {
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    if (!app) return false;
    const html = app.innerHTML.trim();
    return html !== '' && !app.querySelector('.loading-state');
  }, { timeout: 20000 });
}

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

await fetchJson(`${BASE}/api/pages`);
const token = await adminLogin();

const pngBuf = await buildNoisePng();
console.log(`Source PNG: ${pngBuf.length} B`);

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);

let imgId = null;
let imgUrl = '';
let thumbFile = '';
let qaTextId = null;
let qaTextSlug = '';
let originalBytes = null;

try {
  // ── Fixture: upload a cover image, attach to a QA text ───────────
  await check('Fixture: large PNG uploaded via /api/gallery/upload', async () => {
    const fd = new FormData();
    fd.append('files', new Blob([pngBuf], { type: 'image/png' }), IMG_NAME);
    fd.append('title', '[QA-THUMB] cover');
    const upload = await fetchJson(`${BASE}/api/gallery/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const img = upload.images.find((i) => i.identifier === IMG_IDN);
    assert(img, `image ${IMG_IDN} missing from upload response`);
    imgId = img.id;
    imgUrl = img.image_url;
    assert(imgUrl.startsWith('/uploads/gallery/'), `unexpected url: ${imgUrl}`);
    thumbFile = path.basename(imgUrl);
    assert(upload.errors && upload.errors.length === 0, `upload errors: ${JSON.stringify(upload.errors)}`);
  });

  await check('Fixture: QA published text uses the uploaded cover', async () => {
    const t = (await fetchJson(`${BASE}/api/texts`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: QA_TEXT, content: `<p>${MARK} obsah</p>`, excerpt: `${MARK} perex`,
      cover_image: imgUrl, is_published: 1, sort_order: 0,
    }) })).item;
    qaTextId = t.id;
    qaTextSlug = t.slug;
    assert(t.cover_image === imgUrl, 'cover_image not stored as-is');
  });

  // ── Thumbnail endpoint behaviour (raw requests) ───────────────────
  await check('Thumb is image/webp, far smaller than the original, width-limited', async () => {
    const original = await fetch(BASE + imgUrl);
    assert(original.status === 200, `original HTTP ${original.status}`);
    originalBytes = Buffer.from(await original.arrayBuffer());

    const t = await fetch(`${BASE}/img/gallery/${thumbFile}?w=200`);
    assert(t.status === 200, `thumb HTTP ${t.status}`);
    assert((t.headers.get('content-type') || '').includes('image/webp'), `ct ${t.headers.get('content-type')}`);
    const bytes = Buffer.from(await t.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    assert(meta.width === 200, `thumb width ${meta.width} != 200`);
    const ratio = bytes.length / originalBytes.length;
    assert(ratio < 0.25, `thumb ${bytes.length} B not << original ${originalBytes.length} B (ratio ${ratio})`);
  });

  await check('Thumb default width (no ?w=) is ≤800, clamped width never upscales', async () => {
    const d = await fetch(`${BASE}/img/gallery/${thumbFile}`);
    assert(d.status === 200, `default thumb HTTP ${d.status}`);
    const dbytes = Buffer.from(await d.arrayBuffer());
    const dmeta = await sharp(dbytes).metadata();
    assert(dmeta.width <= 800, `default thumb width ${dmeta.width} > 800`);

    const big = await fetch(`${BASE}/img/gallery/${thumbFile}?w=99999`);
    const bbytes = Buffer.from(await big.arrayBuffer());
    const bmeta = await sharp(bbytes).metadata();
    assert(bmeta.width === 1440, `clamped thumb upscaled to ${bmeta.width}`);
  });

  await check('ETag + 304: validated thumbnail returns 304 without body', async () => {
    const first = await fetch(`${BASE}/img/gallery/${thumbFile}?w=200`);
    const etag = first.headers.get('etag');
    assert(etag, 'no ETag header');
    const second = await fetch(`${BASE}/img/gallery/${thumbFile}?w=200`, { headers: { 'If-None-Match': etag } });
    assert(second.status === 304, `second HTTP ${second.status}`);
    assert(second.headers.get('etag') === etag, `etag mismatch on 304: ${second.headers.get('etag')}`);
    assert((await second.arrayBuffer()).byteLength === 0, '304 carried a body');
  });

  await check('Cache-Control present on thumbnails (bounded, with ETag revalidation)', async () => {
    const t = await fetch(`${BASE}/img/gallery/${thumbFile}?w=200`);
    const cc = t.headers.get('cache-control') || '';
    assert(/max-age=\d+/.test(cc), `no max-age in ${cc}`);
    const secs = Number.parseFloat(/max-age=(\d+)/.exec(cc)[1]);
    assert(secs <= 604800, `max-age ${secs} too long (would hold stale forever)`);
    assert(t.headers.get('etag'), 'no etag to revalidate against');
  });

  await check('Invalid / missing files are rejected (400 / 404)', async () => {
    for (const bad of ['evil', '..%2F..%2Fserver.js', 'a%2Fb.png']) {
      const r = await fetch(`${BASE}/img/gallery/${bad}?w=100`);
      assert(r.status === 400, `${bad} -> HTTP ${r.status} (expected 400)`);
    }
    const missing = await fetch(`${BASE}/img/gallery/qa-thumb-does-not-exist.png?w=100`);
    assert(missing.status === 404, `missing -> HTTP ${missing.status} (expected 404)`);
  });

  await check('Original /uploads/gallery file is untouched by thumb generation', async () => {
    const again = await fetch(BASE + imgUrl);
    assert(again.status === 200, `original HTTP ${again.status}`);
    const bytes = Buffer.from(await again.arrayBuffer());
    assert(bytes.equals(originalBytes), `original changed (was ${originalBytes.length} B, now ${bytes.length} B)`);
  });

  await check('Thumbnail cache is outside public static roots (not served, persisted on disk)', async () => {
    // Unknown paths fall through to the SPA catch-all (200 text/html), so the
    // real invariant is that the shadow URL never serves the image back.
    const shadow = await fetch(`${BASE}/uploads/gallery/.thumbs/${thumbFile}-200.webp`);
    const ct = shadow.headers.get('content-type') || '';
    assert(!ct.includes('image/'), `shadow path serves an image: ${ct}`);
    if (DISK_ACCESSIBLE && THUMBS_DIR) {
      const cached = path.join(THUMBS_DIR, `${thumbFile}-200.webp`);
      assert(fs.existsSync(cached), `thumb not cached on disk (${cached})`);
    }
  });

  // ── Frontend behaviour ────────────────────────────────────────────
  await check('/texty list: our card requests a /img/gallery thumbnail, not the original', async () => {
    await page.goto(`${BASE}/texty`, { waitUntil: 'load' });
    await waitAppContent(page);
    await page.waitForFunction((m) => [...document.querySelectorAll('.card')].some((c) => (c.textContent || '').includes(m)), QA_TEXT, { timeout: 20000 });

    const info = await page.evaluate((mark) => {
      const cards = [...document.querySelectorAll('.card')];
      const idx = cards.findIndex((c) => (c.textContent || '').includes(mark));
      const card = cards[idx];
      const img = card?.querySelector('.card-img img');
      return {
        idx,
        src: img?.getAttribute('src') || null,
        loading: img?.getAttribute('loading') || null,
        priority: img?.getAttribute('fetchpriority') || null,
        width: img?.getAttribute('width') || null,
        height: img?.getAttribute('height') || null,
        // Loading policy: the first viewport cards load eagerly, the first
        // has high priority; every /texty card must use a thumbnail URL.
        imgs: [...document.querySelectorAll('.card-img img')].map((el) => ({
          src: el.getAttribute('src') || '',
          loading: el.getAttribute('loading') || '',
          priority: el.getAttribute('fetchpriority') || '',
        })),
      };
    }, QA_TEXT);

    assert(info.src && info.src.startsWith('/img/gallery/'), `card src not a thumbnail: ${info.src}`);
    assert(info.src.includes('?w=800') && !info.src.includes('/uploads/gallery/'), `src not the 800px variant: ${info.src}`);
    assert(info.src.includes(encodeURIComponent(thumbFile)), `src has wrong file: ${info.src}`);
    assert(info.width === '800' && info.height === '533', `intrinsic size hint missing: ${info.width}x${info.height}`);

    for (let i = 0; i < info.imgs.length; i++) {
      const img = info.imgs[i];
      assert(img.src.startsWith('/img/gallery/'), `card ${i} still uses an original cover: ${img.src}`);
      if (i < 4) {
        assert(img.loading === 'eager', `card ${i} in first viewport is lazy (${img.loading})`);
        if (i === 0) assert(img.priority === 'high', `first card not high priority: ${img.priority}`);
      } else {
        assert(img.loading === 'lazy', `card ${i} below fold not lazy: ${img.loading}`);
      }
    }
  });

  await check('Detail page keeps the full-size original cover (no thumbnail regression)', async () => {
    await page.goto(`${BASE}/texty/${qaTextSlug}`, { waitUntil: 'load' });
    await waitAppContent(page);
    await page.waitForFunction(() => !!document.querySelector('.detail-title'), { timeout: 20000 });
    const src = await page.evaluate(() => document.querySelector('.detail-cover img')?.getAttribute('src') || '');
    assert(src === imgUrl, `detail cover switched to ${src}`);
  });
} finally {
  await ctx.close();
  await browser.close();

  try {
    const tk = await adminLogin();
    if (qaTextId) await fetchJson(`${BASE}/api/texts/${qaTextId}`, { method: 'DELETE', headers: auth(tk) }).catch(() => {});
    const sweepTexts = (await fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(tk) })).filter((x) => (x.title || '').includes(MARK));
    for (const x of sweepTexts) await fetchJson(`${BASE}/api/texts/${x.id}`, { method: 'DELETE', headers: auth(tk) }).catch(() => {});
    if (imgId) await fetchJson(`${BASE}/api/gallery/images/${imgId}`, { method: 'DELETE', headers: auth(tk) }).catch(() => {});
    if (DISK_ACCESSIBLE && thumbFile) fs.rmSync(path.join(UPLOAD_DIR, thumbFile), { force: true });
    const sweepImages = (await fetchJson(`${BASE}/api/gallery/images`, { headers: auth(tk) })).filter((x) => (x.identifier || '').includes(IMG_IDN));
    for (const x of sweepImages) await fetchJson(`${BASE}/api/gallery/images/${x.id}`, { method: 'DELETE', headers: auth(tk) }).catch(() => {});
    for (const f of [`${thumbFile}-200.webp`, `${thumbFile}-800.webp`, `${thumbFile}-1600.webp`]) {
      if (DISK_ACCESSIBLE && THUMBS_DIR) fs.rmSync(path.join(THUMBS_DIR, f), { force: true });
    }

    const texts = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(tk) });
    const images = await fetchJson(`${BASE}/api/gallery/images`, { headers: auth(tk) });
    const leftovers = [texts, images].flat().filter((x) => JSON.stringify(x).includes(MARK) || JSON.stringify(x).includes(IMG_IDN));
    if (leftovers.length) console.log(`RESTORE ISSUE: ${leftovers.length} QA records left behind`);
    else console.log('Restored original state: OK');
  } catch (err) {
    console.log(`RESTORE ERROR: ${err.message}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}