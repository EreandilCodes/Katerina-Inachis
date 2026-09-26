// E2E tests for the public post layout order:
//   Title → Perex → Image → Main content
//
// Run locally:   npm run test:order
// Against prod:  TEST_BASE_URL=https://www.katerina-inachis.cz npm run test:order
//
// Only clearly marked [QA-ORD] records are created; every QA record, post and
// the throwaway cover-image fixture are removed in the finally block. Real
// posts are only read. The layout change is presentation-only: stored post
// data must be byte-identical before and after rendering (DB integrity test).

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const MARK = '[QA-ORD]';
const TS = String(Date.now());
const QA_CAT     = `${MARK} Cat ${TS}`;
const QA_CAT_SLUG = `qa-order-cat-${TS}`;
const QA_FRIEND  = `${MARK} friend ${TS}`;
const QA_PNG     = `qa-order-${TS}.png`;
const QA_PNG_PATH = path.join('frontend', 'uploads', 'gallery', QA_PNG);
const QA_PNG_URL  = `/uploads/gallery/${QA_PNG}`;

// 1x1 PNG fixture used as a cover image (served locally, removed in cleanup).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

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

async function createPost(type, token, body) {
  return fetchJson(`${BASE}/api/${type}`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
}
async function deletePost(type, token, id) {
  return fetchJson(`${BASE}/api/${type}/${id}`, { method: 'DELETE', headers: auth(token) });
}
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

// Document order of the rendered detail markers: title, excerpt, content perex, cover, content.
async function detailOrder(page) {
  return page.evaluate(() => {
    const sel = '.detail-page .detail-page__inner .detail-title,' +
                '.detail-page .detail-page__inner .detail-excerpt,' +
                '.detail-page .detail-page__inner .detail-perex,' +
                '.detail-page .detail-page__inner .detail-cover,' +
                '.detail-page .detail-page__inner > .text-content';
    return [...document.querySelectorAll(sel)].map((n) => {
      if (n.classList.contains('detail-title')) return 'title';
      if (n.classList.contains('detail-excerpt')) return 'excerpt';
      if (n.classList.contains('detail-perex')) return 'perex';
      if (n.classList.contains('detail-cover')) return 'cover';
      return 'content';
    });
  });
}
async function openPost(page, urlPath) {
  await page.goto(`${BASE}${urlPath}`, { waitUntil: 'load' });
  await waitAppContent(page);
  await waitFor(page, () => !!document.querySelector('.detail-page .detail-title'));
}
const excerptShown = (page, text) =>
  page.evaluate((t) => {
    const el = document.querySelector('.detail-excerpt');
    return !!el && el.textContent.includes(t);
  }, text);
const imageLoaded = (page) =>
  page.evaluate(() => {
    const img = document.querySelector('.detail-cover img');
    return !!img && img.complete && img.naturalWidth > 0;
  });
const hasCover = (page) => page.evaluate(() => !!document.querySelector('.detail-cover'));
const hasExcerpt = (page) => page.evaluate(() => !!document.querySelector('.detail-excerpt'));

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
const narrow = await browser.newPage({ viewport: { width: 375, height: 800 } });
narrow.setDefaultTimeout(45000);

await fetchJson(`${BASE}/api/pages`); // reachability check

let token = await adminLogin();
fs.writeFileSync(QA_PNG_PATH, PNG_1PX);

const qaPostIds = { texts: [], blog: [], programming: [], friend_posts: [] };
const qaFriendIds = [];
let qaCatId = null;

// Case-1 post reused by the existing-published-content + DB-integrity test.
const EX_ROW_KEYS = ['id', 'title', 'slug', 'excerpt', 'content', 'cover_image', 'category',
  'is_published', 'is_featured', 'sort_order', 'published_at', 'created_at'];
let storedBefore = null;
let existingSlug = '';

try {
  qaCatId = (await createPost('categories', token, { name: QA_CAT, slug: QA_CAT_SLUG, page_slug: 'texty', is_visible: 1, sort_order: 0 })).item.id;

  // ── Case 1 — perex + image ────────────────────────────────
  await check('Case 1: title → perex → image → content; image loads, perex label shown', async () => {
    const p = (await createPost('texts', token, {
      title: `${MARK} C1 ${TS}`, category: QA_CAT, excerpt: `${MARK} perex C1`, content: `<p>${MARK} obsah C1</p>`,
      cover_image: QA_PNG_URL, is_published: 1, sort_order: 0,
    })).item;
    qaPostIds.texts.push(p.id);
    await openPost(page, `/texty/${p.slug}`);
    assert(JSON.stringify(await detailOrder(page)) === JSON.stringify(['title', 'excerpt', 'cover', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(page)));
    assert(await excerptShown(page, `${MARK} perex C1`), 'perex text missing above image');
    assert(await imageLoaded(page), 'cover image did not load');
  });

  // ── Case 1b — perex created with the editor's Perex button (leading
  // blockquote in the content) must render between the title and the image ──
  await check('Case 1b: content blockquote perex renders above the cover image', async () => {
    const p = (await createPost('texts', token, {
      title: `${MARK} C1B ${TS}`, category: QA_CAT, excerpt: '',
      content: `<blockquote>${MARK} perex z editoru</blockquote><p>${MARK} obsah C1B</p>`,
      cover_image: QA_PNG_URL, is_published: 1, sort_order: 0,
    })).item;
    qaPostIds.texts.push(p.id);
    await openPost(page, `/texty/${p.slug}`);
    assert(JSON.stringify(await detailOrder(page)) === JSON.stringify(['title', 'perex', 'cover', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(page)));
    const perexShown = await page.evaluate((t) => {
      const el = document.querySelector('.detail-perex');
      return !!el && el.textContent.includes(t) && !!el.querySelector('blockquote');
    }, `${MARK} perex z editoru`);
    assert(perexShown, 'content perex blockquote missing above the image');
    const restText = await page.evaluate(() => document.querySelector('.detail-page__inner > .text-content')?.textContent || '');
    assert(restText.includes(`${MARK} obsah C1B`) && !restText.includes(`${MARK} perex z editoru`),
      'content not split correctly (perex duplicated or lost)');
  });

  // ── Case 2 — perex without image ──────────────────────────
  await check('Case 2: title → perex → content (no cover, no empty image block)', async () => {
    const p = (await createPost('texts', token, {
      title: `${MARK} C2 ${TS}`, category: QA_CAT, excerpt: `${MARK} perex C2`, content: `<p>${MARK} obsah C2</p>`,
      cover_image: '', is_published: 1, sort_order: 0,
    })).item;
    qaPostIds.texts.push(p.id);
    await openPost(page, `/texty/${p.slug}`);
    assert(JSON.stringify(await detailOrder(page)) === JSON.stringify(['title', 'excerpt', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(page)));
    assert(!(await hasCover(page)), 'empty image area rendered for post without image');
  });

  // ── Case 3 — image without perex ──────────────────────────
  await check('Case 3: title → image → content (no perex block)', async () => {
    const p = (await createPost('texts', token, {
      title: `${MARK} C3 ${TS}`, category: QA_CAT, excerpt: '', content: `<p>${MARK} obsah C3</p>`,
      cover_image: QA_PNG_URL, is_published: 1, sort_order: 0,
    })).item;
    qaPostIds.texts.push(p.id);
    await openPost(page, `/texty/${p.slug}`);
    assert(JSON.stringify(await detailOrder(page)) === JSON.stringify(['title', 'cover', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(page)));
    assert(!(await hasExcerpt(page)), 'empty perex container rendered');
  });

  // ── Case 4 — neither ──────────────────────────────────────
  await check('Case 4: title → content (no extra blocks)', async () => {
    const p = (await createPost('texts', token, {
      title: `${MARK} C4 ${TS}`, category: QA_CAT, excerpt: '', content: `<p>${MARK} obsah C4</p>`,
      cover_image: '', is_published: 1, sort_order: 0,
    })).item;
    qaPostIds.texts.push(p.id);
    await openPost(page, `/texty/${p.slug}`);
    assert(JSON.stringify(await detailOrder(page)) === JSON.stringify(['title', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(page)));
    assert(!(await hasCover(page)) && !(await hasExcerpt(page)), 'unexpected block in minimal post');
  });

  // ── Existing published post + DB integrity ────────────────
  await check('Existing published post: renders in new order, refresh + direct URL, DB row byte-identical', async () => {
    const created = (await createPost('texts', token, {
      title: `${MARK} Exist ${TS}`, category: QA_CAT, excerpt: `${MARK} perex exist`, content: `<p>${MARK} obsah exist</p>`,
      cover_image: QA_PNG_URL, is_published: 1, sort_order: 0,
    })).item;
    qaPostIds.texts.push(created.id);
    existingSlug = created.slug;

    // Snapshot of the stored row the moment it is "already published".
    const row = await fetchJson(`${BASE}/api/texts/${created.slug}`, { headers: auth(token) });
    storedBefore = JSON.stringify(EX_ROW_KEYS.map((k) => [k, row[k]]));

    // Render — no edit, no re-save — and assert the published record displays
    // Title → Perex → Image → Content automatically.
    await openPost(page, `/texty/${existingSlug}`);
    assert(JSON.stringify(await detailOrder(page)) === JSON.stringify(['title', 'excerpt', 'cover', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(page)));

    // Browser refresh (SPA remount from the same stored data).
    await page.reload({ waitUntil: 'load' });
    await waitAppContent(page);
    await waitFor(page, () => !!document.querySelector('.detail-page .detail-title'));
    assert(JSON.stringify(await detailOrder(page)) === JSON.stringify(['title', 'excerpt', 'cover', 'content']),
      'order wrong after refresh: ' + JSON.stringify(await detailOrder(page)));

    // Direct-URL load in a fresh context (no SPA client-side state reused).
    const fresh = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await fresh.goto(`${BASE}/texty/${existingSlug}`, { waitUntil: 'load' });
      await waitAppContent(fresh);
      await waitFor(fresh, () => !!document.querySelector('.detail-page .detail-title'));
      assert(JSON.stringify(await detailOrder(fresh)) === JSON.stringify(['title', 'excerpt', 'cover', 'content']),
        'order wrong by direct URL: ' + JSON.stringify(await detailOrder(fresh)));
      assert(await imageLoaded(fresh), 'image did not load by direct URL');
    } finally {
      await fresh.close();
    }

    // DB integrity: the stored record must be byte-identical (presentation only).
    const rowAfter = await fetchJson(`${BASE}/api/texts/${created.slug}`, { headers: auth(token) });
    const storedAfter = JSON.stringify(EX_ROW_KEYS.map((k) => [k, rowAfter[k]]));
    assert(storedAfter === storedBefore, 'stored post row changed during rendering');
  });

  // ── Narrow viewport keeps the order responsive ────────────
  await check('Narrow viewport (375px): order still title → perex → image → content, no broken spacing', async () => {
    await openPost(narrow, `/texty/${existingSlug}`);
    assert(JSON.stringify(await detailOrder(narrow)) === JSON.stringify(['title', 'excerpt', 'cover', 'content']),
      'order wrong on narrow viewport: ' + JSON.stringify(await detailOrder(narrow)));
    const excerptVisible = await narrow.evaluate(() => {
      const el = document.querySelector('.detail-excerpt');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    });
    assert(excerptVisible, 'perex not visible on narrow viewport');
    const noHScroll = await narrow.evaluate(() => document.documentElement.scrollWidth <= document.body.scrollWidth + 1);
    assert(noHScroll, 'horizontal overflow on narrow viewport');
  });

  // ── Shared rule for the other content-post sections ───────
  await check('Blog post (perex + image): title → perex → image → content', async () => {
    const p = (await createPost('blog', token, {
      title: `${MARK} Blog ${TS}`, excerpt: `${MARK} perex blog`, content: `<p>${MARK} obsah blog</p>`,
      cover_image: QA_PNG_URL, is_published: 1, is_featured: 0, sort_order: 0,
    })).item;
    qaPostIds.blog.push(p.id);
    await openPost(page, `/blog/${p.slug}`);
    assert(JSON.stringify(await detailOrder(page)) === JSON.stringify(['title', 'excerpt', 'cover', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(page)));
  });

  await check('Programming post (perex + image): title → perex → image → content', async () => {
    const p = (await createPost('programming', token, {
      title: `${MARK} Prog ${TS}`, excerpt: `${MARK} perex prog`, content: `<p>${MARK} obsah prog</p>`,
      cover_image: QA_PNG_URL, is_published: 1, is_featured: 0, sort_order: 0,
    })).item;
    qaPostIds.programming.push(p.id);
    await openPost(page, `/programovani/${p.slug}`);
    assert(JSON.stringify(await detailOrder(page)) === JSON.stringify(['title', 'excerpt', 'cover', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(page)));
  });

  await check('Friend post (perex + image): title → perex → image → content', async () => {
    const fr = (await createPost('friends', token, { name: QA_FRIEND })).item;
    qaFriendIds.push(fr.id);
    const p = (await createPost('friend-posts', token, {
      friend_id: fr.id, title: `${MARK} Friend ${TS}`, type: 'text', excerpt: `${MARK} perex friend`,
      content: `<p>${MARK} obsah friend</p>`, cover_image: QA_PNG_URL, images_json: '[]', is_published: 1,
    })).item;
    qaPostIds.friend_posts.push(p.id);
    await openPost(page, `/pratele/${fr.slug}/${p.slug}`);
    assert(JSON.stringify(await detailOrder(page)) === JSON.stringify(['title', 'excerpt', 'cover', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(page)));
  });

  // ── Regression touchpoints ────────────────────────────────
  await check('Listing pages still render (texty list + cards) after the change', async () => {
    await page.goto(`${BASE}/texty`, { waitUntil: 'load' });
    await waitAppContent(page);
    await waitFor(page, () => !!document.querySelector('.content-grid .card'));
    const stillListed = await page.evaluate((m) => {
      const card = [...document.querySelectorAll('.card-title')].find((n) => n.textContent.includes(m));
      return !!card;
    }, `${MARK} C1 ${TS}`);
    assert(stillListed, 'QA post missing from texty list');
  });
} finally {
  await ctx.close();
  await narrow.close();
  await browser.close();

  try {
    token = await adminLogin();
    // QA posts (order matters: friend posts reference friends)
    for (const type of ['texts', 'blog', 'programming']) {
      for (const id of qaPostIds[type]) await deletePost(type, token, id).catch(() => {});
    }
    for (const id of qaPostIds.friend_posts) await deletePost('friend-posts', token, id).catch(() => {});
    for (const id of qaFriendIds) await deletePost('friends', token, id).catch(() => {});
    // QA category
    if (qaCatId) await deletePost('categories', token, qaCatId).catch(() => {});
    // throwaway cover fixture
    if (fs.existsSync(QA_PNG_PATH)) fs.unlinkSync(QA_PNG_PATH);

    // verify nothing but QA records remain
    const cats = await fetchJson(`${BASE}/api/categories/admin/all`, { headers: auth(token) });
    const texts = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(token) });
    const blog = await fetchJson(`${BASE}/api/blog/admin/all`, { headers: auth(token) });
    const prog = await fetchJson(`${BASE}/api/programming/admin/all`, { headers: auth(token) });
    const fposts = await fetchJson(`${BASE}/api/friend-posts/admin/all`, { headers: auth(token) });
    const leftovers = [cats, texts, blog, prog, fposts].flat().filter((x) => JSON.stringify(x).includes(MARK));
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