// E2E test for the perex-above-image card layout (card-order.mjs).
// Reported issue: in the Texty section (Povídky) the perex rendered under the
// thumbnail. Cards must now lay out Title → Perex → Image → Meta in DOM order
// (same contract as detail pages: Title → Perex → Image → Content). Verified
// on the /texty list, a text subcategory page (/texty/<slug>) and a tag page.
//
// Run locally:   npm run test:cardorder
// Against prod:  TEST_BASE_URL=https://www.katerina-inachis.cz npm run test:cardorder
//
// Only QA-marked records are created; everything is removed in the finally
// block (the QA text is deleted before the QA category -> delete safety).

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const QA_PNG = `qa-card-${Date.now()}.png`;
const QA_PNG_PATH = path.join('frontend', 'uploads', 'gallery', QA_PNG);
const QA_PNG_URL = `/uploads/gallery/${QA_PNG}`;

// 1x1 PNG fixture used as the card cover image (served locally, removed on exit).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const MARK = '[QA-CARD]';
const TS = String(Date.now());
const QA_CAT   = `${MARK} Kategorie ${TS}`;
const QA_TEXT  = `${MARK} text ${TS}`;
const QA_PEREX = `${MARK} perex nad obrázkem`;
const QA_TAG   = `${MARK} tag ${TS}`;

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

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const ct = res.headers.get('content-type');
  let body;
  try { body = ct && ct.includes('application/json') ? await res.json() : await res.text(); }
  catch { body = await res.text(); }
  if (!res.ok) {
    const detail = typeof body === 'object' ? JSON.stringify(body) : String(body).slice(0, 300);
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

async function waitFor(page, fn, arg, timeout = 20000) {
  await page.waitForFunction(fn, arg, { timeout });
}
async function waitAppContent(page) {
  await waitFor(page, () => {
    const app = document.getElementById('app');
    if (!app) return false;
    const html = app.innerHTML.trim();
    return html !== '' && !app.querySelector('.loading-state');
  });
}

// Document order of the anonymised card markers within a card:
//   body (category/title + perex) → image → meta
async function cardSignals(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.card');
    if (!card) return [];
    return [...card.querySelectorAll('.card-body, .card-img, .card-meta, .card-excerpt')]
      .map((n) => {
        if (n.classList.contains('card-excerpt')) return 'excerpt';
        if (n.classList.contains('card-img')) return 'img';
        if (n.classList.contains('card-meta')) return 'meta';
        return 'body';
      });
  });
}

async function open(page, urlPath) {
  await page.goto(`${BASE}${urlPath}`, { waitUntil: 'load' });
  await waitAppContent(page);
  await waitFor(page, () => !!document.querySelector('.card'));
}

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);

await fetchJson(`${BASE}/api/pages`); // reachability check
let token = await adminLogin();
fs.writeFileSync(QA_PNG_PATH, PNG_1PX);

const qaTagIds = [];
let qaCatId = null;
let qaCatSlug = '';
let qaTextId = null;
let qaTextSlug = '';
let qaTagSlug = '';

try {
  // ── Fixtures: QA category (texty sub), QA text, QA tag ─────
  await check('Fixture: QA category created under texty (slug auto) + QA text in it', async () => {
    const c = (await fetchJson(`${BASE}/api/categories`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: QA_CAT, page_slug: 'texty' }) })).item;
    qaCatId = c.id;
    qaCatSlug = c.slug;
    assert(c.slug && c.slug.startsWith('qa-card-'), `slug: ${c.slug}`);
    const t = (await fetchJson(`${BASE}/api/texts`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: QA_TEXT, content: `<p>${MARK} obsah</p>`, excerpt: QA_PEREX,
      cover_image: QA_PNG_URL, category: QA_CAT, is_published: 1, sort_order: 0,
    }) })).item;
    qaTextId = t.id;
    qaTextSlug = t.slug;
    assert(t.category === QA_CAT, 'text category wrong');
  });

  // ── The Povídky-style subcategory list (/texty/<slug>) ─────
  await check('/texty/<subcategory> card order: body → perex → image → meta', async () => {
    await open(page, `/texty/${qaCatSlug}`);
    const signals = await cardSignals(page);
    assert(JSON.stringify(signals) === JSON.stringify(['body', 'excerpt', 'img', 'meta']),
      `order: ${JSON.stringify(signals)}`);
    const excerptText = await page.evaluate(() => document.querySelector('.card-excerpt')?.textContent || '');
    assert(excerptText.includes(MARK), `excerpt: "${excerptText}"`);
    const imgCount = await page.evaluate(() => document.querySelectorAll('.card-img').length);
    assert(imgCount >= 1, `no image in card (found ${imgCount})`);
  });

  // ── The /texty list (same renderer, renderTextCard) ─────────
  await check('/texty list card order: perex above image (covering Texty section)', async () => {
    await open(page, '/texty');
    // Find our QA card specifically (other content may be present).
    const ours = await page.evaluate((m) => {
      const card = [...document.querySelectorAll('.card')].find((c) => (c.textContent || '').includes(m));
      if (!card) return null;
      const seq = [...card.querySelectorAll('.card-body, .card-img, .card-meta, .card-excerpt')]
        .map((n) => n.classList.contains('card-excerpt') ? 'excerpt' : n.classList.contains('card-img') ? 'img' : n.classList.contains('card-meta') ? 'meta' : 'body');
      return seq;
    }, QA_TEXT);
    assert(ours && JSON.stringify(ours) === JSON.stringify(['body', 'excerpt', 'img', 'meta']),
      `order: ${JSON.stringify(ours)}`);
  });

  // ── Tag page cards (same perex-above-image contract) ────────
  await check('Tag page card order: perex above image', async () => {
    const r = (await fetchJson(`${BASE}/api/tags`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: QA_TAG }) })).item;
    qaTagIds.push(r.id);
    qaTagSlug = r.slug;
    await fetchJson(`${BASE}/api/tags/admin/assign`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      content_type: 'text', content_id: qaTextId, tag_ids: [qaTagIds[0]],
    }) });
    await open(page, `/tag/${qaTagSlug}`);
    const signals = await cardSignals(page);
    assert(JSON.stringify(signals) === JSON.stringify(['body', 'excerpt', 'img', 'meta']),
      `order: ${JSON.stringify(signals)}`);
  });

  // ── Detail pages keep the contract (no regression from card change) ──
  await check('Text detail still renders Title → Perex → Image → Content (no tags)', async () => {
    await page.goto(`${BASE}/texty/${qaTextSlug}`, { waitUntil: 'load' });
    await waitAppContent(page);
    await waitFor(page, () => !!document.querySelector('.detail-title'));
    const order = await page.evaluate(() => {
      const root = document.querySelector('.detail-page .detail-page__inner');
      if (!root) return [];
      return [...root.querySelectorAll('.detail-title, .detail-excerpt, .detail-cover, .text-content')]
        .map((n) => n.classList.contains('detail-excerpt') ? 'excerpt' : n.classList.contains('detail-cover') ? 'cover' : n.classList.contains('text-content') ? 'content' : 'title');
    });
    assert(JSON.stringify(order) === JSON.stringify(['title', 'excerpt', 'cover', 'content']),
      `detail order: ${JSON.stringify(order)}`);
  });
} finally {
  await ctx.close();
  await browser.close();

  try {
    token = await adminLogin();
    // The QA text must go before the QA category (categories block deletion
    // only when texts still reference their name).
    if (qaTextId) await fetchJson(`${BASE}/api/texts/${qaTextId}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    const sweepTexts = (await fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(token) })).filter((x) => (x.title || '').includes(MARK));
    for (const x of sweepTexts) await fetchJson(`${BASE}/api/texts/${x.id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    if (qaCatId) await fetchJson(`${BASE}/api/categories/${qaCatId}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    for (const id of qaTagIds) await fetchJson(`${BASE}/api/tags/${id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    const sweepTags = (await fetchJson(`${BASE}/api/tags/admin/all`, { headers: auth(token) })).filter((x) => (x.name || '').includes(MARK));
    for (const x of sweepTags) await fetchJson(`${BASE}/api/tags/${x.id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    if (fs.existsSync(QA_PNG_PATH)) fs.unlinkSync(QA_PNG_PATH);

    const texts = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(token) });
    const cats = await fetchJson(`${BASE}/api/categories/admin/all`, { headers: auth(token) });
    const tags = await fetchJson(`${BASE}/api/tags/admin/all`, { headers: auth(token) });
    const leftovers = [texts, cats, tags].flat().filter((x) => JSON.stringify(x).includes(MARK));
    if (leftovers.length) {
      console.log(`RESTORE ISSUE: ${leftovers.length} QA records left behind`);
    } else {
      console.log('Restored original state: OK');
    }
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