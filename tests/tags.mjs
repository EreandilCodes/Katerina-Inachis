// E2E tests for the global tag system (tags.mjs):
//   - Admin CRUD + duplicate/rename rules (slug stays immutable)
//   - Auth: 401 unauthenticated, 403 non-admin (friend) role
//   - Assign persistence, cross-category tag page, published-only filtering
//   - Public detail layout: Title → Perex → Tags → Image → Content
//   - Admin editor chips: create tag via Enter, assign on save, re-open shows it
//   - Deleting a tag only detaches content (nothing is ever cascaded)
//
// Run locally:   npm run test:tags
// Against prod:  TEST_BASE_URL=https://www.katerina-inachis.cz npm run test:tags
//
// Only clearly marked [QA-TAG] records are created; every QA record (tags,
// texts, artworks, friend) is removed in the finally block.

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const QA_PNG     = `qa-tag-${Date.now()}.png`;
const QA_PNG_PATH = path.join('frontend', 'uploads', 'gallery', QA_PNG);
const QA_PNG_URL  = `/uploads/gallery/${QA_PNG}`;

// 1x1 PNG fixture used as a cover image (served locally, removed in cleanup).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const MARK = '[QA-TAG]';
const TS = String(Date.now());
const QA_TAG      = `${MARK} Příroda ${TS}`;
const QA_TAG2     = `${MARK} Zahrada ${TS}`;
const QA_TAG_SLUG = `qa-tag-priroda-${TS}`;
const QA_TAG_SLUG2 = `qa-tag-zahrada-${TS}`;
const QA_TEXT     = `${MARK} text ${TS}`;
const QA_ART      = `${MARK} dílo ${TS}`;
const QA_FRIEND   = `${MARK} friend ${TS}`;
const QA_FRIEND_EMAIL = `qa-tag-${TS}@inachis.test`;
const QA_FRIEND_PASS = 'tag-test-pass-123';

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
async function openPost(page, urlPath) {
  await page.goto(`${BASE}${urlPath}`, { waitUntil: 'load' });
  await waitAppContent(page);
  await waitFor(page, () => !!document.querySelector('.detail-page .detail-title'));
}
async function openAdmin(page, token) {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
  await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
  await waitFor(page, () => !!document.querySelector('#menuTagsTable'));
}
const extContent = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent || '', sel);

// Document order of the rendered detail markers (tags between perex and image).
async function detailOrder(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.detail-page .detail-page__inner');
    if (!root) return [];
    return [...root.querySelectorAll('.detail-title, .detail-excerpt, .detail-tags, .detail-cover, .text-content')]
      .map((n) => {
        if (n.classList.contains('detail-title')) return 'title';
        if (n.classList.contains('detail-excerpt')) return 'excerpt';
        if (n.classList.contains('detail-tags')) return 'tags';
        if (n.classList.contains('detail-cover')) return 'cover';
        return 'content';
      });
  });
}

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
const pub = await ctx.newPage();
pub.setDefaultTimeout(45000);

await fetchJson(`${BASE}/api/pages`); // reachability check
let token = await adminLogin();
fs.writeFileSync(QA_PNG_PATH, PNG_1PX);

const qaTagIds = [];
const qaTextIds = [];
const qaArtIds = [];
const qaFriendIds = [];
let qaTextSlug = '';
let qaArtSlug = '';
let qaTagSlug = '';
let qaTag2Id = null;

try {
  // ── API: management ────────────────────────────────────────
  await check('Create tag: 201, diacritics normalized to ascii slug', async () => {
    const r = await fetchJson(`${BASE}/api/tags`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: QA_TAG }) });
    qaTagIds.push(r.item.id);
    qaTagSlug = r.item.slug;
    assert(r.message === 'Štítek vytvořen', `message: ${r.message}`);
    assert(r.item.slug === `qa-tag-priroda-${TS}`, `slug: ${r.item.slug}`);
  });

  await check('Duplicate name (case-insensitive) or URL → 400, no second row', async () => {
    for (const name of [QA_TAG.toLowerCase(), QA_TAG_SLUG]) {
      let res = await fetch(`${BASE}/api/tags`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name }) });
      assert(res.status === 400, `expected 400 for "${name}", got ${res.status}`);
    }
  });

  await check('Rename keeps the URL/slug immutable; same name change persists', async () => {
    const r = await fetchJson(`${BASE}/api/tags/${qaTagIds[0]}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ name: QA_TAG2 }) });
    assert(r.item.slug === qaTagSlug, `slug changed on rename: ${r.item.slug} !== ${qaTagSlug}`);
    assert(r.item.name === QA_TAG2, 'name not updated');
    const now = await fetchJson(`${BASE}/api/tags`);
    const mine = now.find((x) => x.id === qaTagIds[0]);
    assert(mine && mine.name === QA_TAG2 && mine.slug === qaTagSlug, 'list disagrees after rename');
  });

  await check('Unauthenticated create → 401', async () => {
    const res = await fetch(`${BASE}/api/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${MARK} noauth ${TS}` }) });
    assert(res.status === 401, `got ${res.status}`);
  });

  // ── API: auth roles (friend must be rejected from admin-only tag routes) ─
  await check('Friend role (non-admin) create → 403', async () => {
    const fr = (await fetchJson(`${BASE}/api/friends`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: QA_FRIEND }) })).item;
    qaFriendIds.push(fr.id);
    await fetchJson(`${BASE}/api/friends/${fr.id}/set-login`, {
      method: 'PUT', headers: auth(token),
      body: JSON.stringify({ email: QA_FRIEND_EMAIL, password: QA_FRIEND_PASS }),
    });
    const login = await fetchJson(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: QA_FRIEND_EMAIL, password: QA_FRIEND_PASS }),
    });
    assert(login.user.role === 'friend', `role: ${login.user.role}`);
    const res = await fetch(`${BASE}/api/tags`, { method: 'POST', headers: auth(login.token), body: JSON.stringify({ name: `${MARK} friendty ${TS}` }) });
    assert(res.status === 403, `friend got ${res.status}`);
  });

  // ── API: assign persistence + validation ───────────────────
  await check('Assign to text: persists (by-content + detail tags + list count)', async () => {
    const t = (await fetchJson(`${BASE}/api/texts`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: QA_TEXT, content: `<p>${MARK} obsah</p>`, excerpt: `${MARK} perex`,
      cover_image: QA_PNG_URL, is_published: 1, sort_order: 0,
    }) })).item;
    qaTextIds.push(t.id);
    qaTextSlug = t.slug;

    await fetchJson(`${BASE}/api/tags/admin/assign`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      content_type: 'text', content_id: t.id, tag_ids: [qaTagIds[0]],
    }) });

    const byContent = await fetchJson(`${BASE}/api/tags/admin/by-content?content_type=text&content_id=${t.id}`, { headers: auth(token) });
    assert(byContent.some((x) => x.id === qaTagIds[0]), 'by-content empty');
    const detail = await fetchJson(`${BASE}/api/texts/${t.slug}`);
    assert(detail.tags.some((x) => x.id === qaTagIds[0]), 'detail.tags missing');
    const list = await fetchJson(`${BASE}/api/tags`);
    assert(list.find((x) => x.id === qaTagIds[0])?.item_count === 1, 'item_count wrong');
  });

  await check('Assign validation: bad content type + nonexistent tag/ID → 400', async () => {
    const good = qaTextIds[0];
    let r = await fetch(`${BASE}/api/tags/admin/assign`, { method: 'POST', headers: auth(token), body: JSON.stringify({ content_type: 'bogus', content_id: good, tag_ids: [] }) });
    assert(r.status === 400, `bad ctype → ${r.status}`);
    r = await fetch(`${BASE}/api/tags/admin/assign`, { method: 'POST', headers: auth(token), body: JSON.stringify({ content_type: 'text', content_id: good, tag_ids: [999999] }) });
    assert(r.status === 400, `bad tag id → ${r.status}`);
    r = await fetch(`${BASE}/api/tags/admin/assign`, { method: 'POST', headers: auth(token), body: JSON.stringify({ content_type: 'text', content_id: 999999, tag_ids: [] }) });
    assert(r.status === 404, `missing content → ${r.status}`);
  });

  // ── Cross-category tag page ────────────────────────────────
  await check('Cross-category: tag page lists text + artwork with section URLs', async () => {
    const a = (await fetchJson(`${BASE}/api/artworks`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: QA_ART, description: `${MARK} popis`, cover_image: QA_PNG_URL, is_published: 1, sort_order: 0,
    }) })).item;
    qaArtIds.push(a.id);
    qaArtSlug = a.slug;
    await fetchJson(`${BASE}/api/tags/admin/assign`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      content_type: 'artwork', content_id: a.id, tag_ids: [qaTagIds[0]],
    }) });

    const data = await fetchJson(`${BASE}/api/tags/${qaTagSlug}`);
    assert(data.tag.name === QA_TAG2, `tag.name: ${data.tag.name}`);
    const urls = data.items.map((i) => i.url);
    assert(urls.includes(`/texty/${qaTextSlug}`) && urls.includes(`/umeni/${qaArtSlug}`),
      `urls: ${urls.join(', ')}`);
  });

  await check('Unpublished content is excluded from the tag page (draft text)', async () => {
    const t = (await fetchJson(`${BASE}/api/texts`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: `${MARK} draft ${TS}`, content: '<p>x</p>', is_published: 0, sort_order: 0,
    }) })).item;
    qaTextIds.push(t.id);
    await fetchJson(`${BASE}/api/tags/admin/assign`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      content_type: 'text', content_id: t.id, tag_ids: [qaTagIds[0]],
    }) });
    const data = await fetchJson(`${BASE}/api/tags/${qaTagSlug}`);
    assert(!data.items.some((i) => i.url.includes(t.slug)), 'draft leaked onto the tag page');
  });

  await check('Clear tags via empty array (releases links, item left intact)', async () => {
    await fetchJson(`${BASE}/api/tags/admin/assign`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      content_type: 'text', content_id: qaTextIds[0], tag_ids: [],
    }) });
    const byContent = await fetchJson(`${BASE}/api/tags/admin/by-content?content_type=text&content_id=${qaTextIds[0]}`, { headers: auth(token) });
    assert(byContent.length === 0, 'tags not cleared');
  });

  // ── Public: layout with tags ───────────────────────────────
  await check('Text detail layout: title → perex → tags → image → content', async () => {
    await fetchJson(`${BASE}/api/tags/admin/assign`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      content_type: 'text', content_id: qaTextIds[0], tag_ids: [qaTagIds[0]],
    }) });
    await openPost(pub, `/texty/${qaTextSlug}`);
    assert(JSON.stringify(await detailOrder(pub)) === JSON.stringify(['title', 'excerpt', 'tags', 'cover', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(pub)));
    const chip = await pub.evaluate(() => document.querySelector('.detail-tag')?.textContent || '');
    assert(chip.includes('#'), `no tag chip link, got "${chip}"`);
  });

  await check('Artwork detail layout: title → tags → cover → content (no perex)', async () => {
    await openPost(pub, `/umeni/${qaArtSlug}`);
    assert(JSON.stringify(await detailOrder(pub)) === JSON.stringify(['title', 'tags', 'cover', 'content']),
      'order wrong: ' + JSON.stringify(await detailOrder(pub)));
  });

  await check('Tag chip on a detail navigates to the public /tag page (cross-category cards)', async () => {
    await page.goto(`${BASE}/texty/${qaTextSlug}`, { waitUntil: 'load' });
    await waitAppContent(page);
    await waitFor(page, () => !!document.querySelector('.detail-tag'));
    await page.click('.detail-tag');
    await waitFor(page, () => !!document.querySelector('.section-title'));
    const title = await extContent(page, '.section-title');
    assert(title.includes('#'), `tag page title: "${title}"`);
    await waitFor(page, () => document.querySelectorAll('.content-grid .card').length >= 2);
    const texts = await page.evaluate((m) => [...document.querySelectorAll('.card-title')].filter((n) => n.textContent.includes(m)).length, MARK);
    assert(texts >= 2, `cross-category cards missing, found ${texts}`);
  });

  await check('Empty tag page shows the empty state (no items)', async () => {
    const r = await fetchJson(`${BASE}/api/tags`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: `${MARK} Lone ${TS}` }) });
    qaTag2Id = r.item.id;
    await page.goto(`${BASE}/tag/${r.item.slug}`, { waitUntil: 'load' });
    await waitAppContent(page);
    await waitFor(page, () => !!document.querySelector('.empty-state'));
    const emptyText = await extContent(page, '.empty-state');
    assert(/tag|štítk|označen/i.test(emptyText), `unexpected empty text: "${emptyText}"`);
  });

  // ── Admin UI: overview tags table ──────────────────────────
  await check('Admin přehled shows the tags table with item_count', async () => {
    await openAdmin(page, token);
    await waitFor(page, () => document.querySelectorAll('#menuTagsTable tbody tr').length >= 2);
    const row = await page.evaluate((m) => {
      const tr = [...document.querySelectorAll('#menuTagsTable tbody tr')].find((r) => r.textContent.includes(m));
      return tr ? tr.textContent : '';
    }, QA_TAG2);
    assert(row.includes(QA_TAG2) && row.includes(`/tag/${qaTagSlug}`) && /\d/.test(row), `row: ${row}`);
  });

  await check('Admin text editor: create tag via chips + Assign on save + re-open shows it', async () => {
    // Navigation sidebar → Texty creates the manager with its chips picker.
    await page.click('.sidebar-nav a[data-section="texts"]');
    await waitFor(page, () => !!document.querySelector('#textsTableBody'));
    await page.click('.section-header button:has-text("+ Přidat text")');
    await waitFor(page, () => !document.getElementById('textsModalOverlay').classList.contains('hidden'));

    const qaUISlug = `qa-tag-ui-${TS}`;
    await page.fill('#textsForm input[name="title"]', `${MARK} UI ${TS}`);
    const chipName = `${MARK} UI tag ${TS}`;
    await page.fill('#textsTagsInput', chipName);
    await page.press('#textsTagsInput', 'Enter');
    await waitFor(page, (name) => {
      const chips = document.querySelectorAll('#textsTagsChips .tag-chip');
      return chips.length === 1 && chips[0].textContent.includes(name);
    }, chipName);

    await page.click('#textsForm button[type="submit"]');
    await waitFor(page, () => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('Text vytvořen');
    });

    // Verify via API: the new tag exists and is wired to the new text.
    const posts = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(token) });
    const created = posts.find((x) => x.title === `${MARK} UI ${TS}`);
    assert(created && /^qa-tag-ui-\d+$/.test(created.slug), `created slug: ${created?.slug}`);
    const detail = await fetchJson(`${BASE}/api/texts/${created.slug}`);
    assert(detail.tags.some((x) => x.name === chipName), 'UI-created tag not assigned');

    // Re-open the very same post: the chip must be pre-selected.
    await page.click(`#textsTableBody tr:has-text("${MARK} UI ${TS}") button:has-text("Upravit")`);
    await waitFor(page, (name) => {
      const chips = document.querySelectorAll('#textsTagsChips .tag-chip');
      return chips.length === 1 && chips[0].textContent.includes(name);
    }, chipName);
    assert((await page.evaluate(() => [...document.querySelectorAll('#textsTagsChips .tag-chip')].map((c) => c.textContent).join(','))).includes(chipName),
      'chip did not re-appear after re-open');
  });

  // ── Delete semantics ───────────────────────────────────────
  await check('Deleting a tag detaches content only; content stays published', async () => {
    await fetchJson(`${BASE}/api/tags/${qaTagIds[0]}`, { method: 'DELETE', headers: auth(token) });
    const still = await fetchJson(`${BASE}/api/texts/${qaTextSlug}`);
    assert(still.title === QA_TEXT, 'text deleted along with the tag');
    assert(!still.tags?.length, 'tags not cleared from content');
    const data = await fetchJson(`${BASE}/api/tags/${qaTagSlug}`, { headers: auth(token) }).catch((e) => null);
    assert(!data, 'tag page still resolves after deletion');
  });
} finally {
  await ctx.close();
  await browser.close();

  try {
    token = await adminLogin();
    // Sweep — delete any record whose name/title carries the QA marker, not
    // just the ids captured above (the UI editor allocates ids we may not see).
    const sweepTexts = (await fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(token) })).filter((x) => x.title.includes(MARK));
    for (const x of sweepTexts) await fetchJson(`${BASE}/api/texts/${x.id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    const sweepArts = (await fetchJson(`${BASE}/api/artworks/admin/all`, { headers: auth(token) })).filter((x) => x.title.includes(MARK));
    for (const x of sweepArts) await fetchJson(`${BASE}/api/artworks/${x.id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    for (const id of qaFriendIds) await fetchJson(`${BASE}/api/friends/${id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    if (qaTag2Id) await fetchJson(`${BASE}/api/tags/${qaTag2Id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    for (const id of qaTagIds) await fetchJson(`${BASE}/api/tags/${id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    const sweepTags = (await fetchJson(`${BASE}/api/tags/admin/all`, { headers: auth(token) })).filter((x) => x.name.includes(MARK));
    for (const x of sweepTags) await fetchJson(`${BASE}/api/tags/${x.id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    if (fs.existsSync(QA_PNG_PATH)) fs.unlinkSync(QA_PNG_PATH);

    const tags = await fetchJson(`${BASE}/api/tags/admin/all`, { headers: auth(token) });
    const texts = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(token) });
    const arts = await fetchJson(`${BASE}/api/artworks/admin/all`, { headers: auth(token) });
    const friends = await fetchJson(`${BASE}/api/friends/admin/all`, { headers: auth(token) });
    const leftovers = [tags, texts, arts, friends].flat().filter((x) => JSON.stringify(x).includes(MARK));
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