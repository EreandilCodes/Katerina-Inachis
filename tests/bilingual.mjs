// E2E tests for bilingual CS/EN fields on Tags, Pages and Categories
// (bilingual.mjs):
//   - Tags: create/update with name_en; public list + tag page localize in EN
//   - Detail tag chips localize (EN uses name_en) without touching slug/URL
//   - Categories: create/update with name_en; public/all returns it; the
//     /texty/<slug> section header and nav dropdown localize in EN (seeded
//     Knihy/Povídky/Básně carry Books/Stories/Poems)
//   - Pages: create + update title_en / intro_text_en; ?lang=en serves the
//     localized intro + title; a user-created page's nav link shows the EN
//     title; pageIntro renders the EN intro on /texty
//   - Everything is QA-marked and fully removed in the finally block (page
//     intros are mutated then restored to their original values)
//
// Run locally:   npm run test:bilingual
// Against prod:  TEST_BASE_URL=https://www.katerina-inachis.cz npm run test:bilingual
//
// Requires a restart of the local server between test suites (login limiter).

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const MARK = '[QA-BILING]';
const TS = String(Date.now());
const QA_TAG      = `${MARK} Cisten ${TS}`;
const QA_TAG_EN   = `English Tag ${TS}`;
const QA_CAT      = `${MARK} Kategorie ${TS}`;
const QA_CAT_EN   = `English Category ${TS}`;
const QA_PAGE     = `qa-biling-${TS}`;
const QA_PAGE_TITLE  = `${MARK} Stránka ${TS}`;
const QA_PAGE_TITLE_EN = `English Page ${TS}`;
const QA_TEXT     = `${MARK} text ${TS}`;
const QA_TEXT_EN  = `English text ${TS}`;
const QA_TEXT_PEREX   = `${MARK} perex`;
const QA_TEXT_PEREX_EN = `English perex`;
const QaPovText   = `${MARK} text v povídkách ${TS}`;

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
const extContent = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent || '', sel);

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const cs = await ctx.newPage(); // Czech (localStorage forced to cs)
const en = await ctx.newPage(); // English (localStorage forced to en)
for (const p of [cs, en]) p.setDefaultTimeout(45000);
await en.addInitScript(() => localStorage.setItem('inachis_lang', 'en'));
await cs.addInitScript(() => localStorage.setItem('inachis_lang', 'cs'));

await fetchJson(`${BASE}/api/pages`); // reachability check
let token = await adminLogin();

const qaTagIds = [];
const qaCatIds = [];
const qaTextIds = [];
let qaTagSlug = '';
let qaCatSlug = '';
let qaTextId = null;
let qaTextSlug = '';
let qaPageSaved = false;

try {
  // ── Tags: name_en CRUD + public localization ──────────────
  await check('Create tag with name_en: 201, both names persisted', async () => {
    const r = await fetchJson(`${BASE}/api/tags`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: QA_TAG, name_en: QA_TAG_EN }) });
    qaTagIds.push(r.item.id);
    qaTagSlug = r.item.slug;
    assert(r.item.name === QA_TAG, `name: ${r.item.name}`);
    assert(r.item.name_en === QA_TAG_EN, `name_en: ${r.item.name_en}`);
  });

  await check('Public tag list: name_en exposed; ?lang=en localizes name', async () => {
    const csList = await fetchJson(`${BASE}/api/tags`);
    const mine = csList.find((x) => x.id === qaTagIds[0]);
    assert(mine && mine.name === QA_TAG && mine.name_en === QA_TAG_EN, `raw: ${JSON.stringify(mine)}`);
    const enList = await fetchJson(`${BASE}/api/tags?lang=en`);
    const mineEn = enList.find((x) => x.id === qaTagIds[0]);
    assert(mineEn && mineEn.name === QA_TAG_EN, `en name: ${mineEn?.name}`);
  });

  await check('Rename updates name_en (clearing works); slug stays immutable; EN re-set for later checks', async () => {
    const r = await fetchJson(`${BASE}/api/tags/${qaTagIds[0]}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ name: QA_TAG, name_en: `${QA_TAG_EN} v2` }) });
    assert(r.item.name_en === `${QA_TAG_EN} v2`, `updated name_en: ${r.item.name_en}`);
    assert(r.item.slug === qaTagSlug, 'slug changed');
    const cleared = await fetchJson(`${BASE}/api/tags/${qaTagIds[0]}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ name: QA_TAG, name_en: '' }) });
    assert(cleared.item.name_en === '', 'name_en not cleared');
    const restored = await fetchJson(`${BASE}/api/tags/${qaTagIds[0]}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ name: QA_TAG, name_en: QA_TAG_EN }) });
    assert(restored.item.name_en === QA_TAG_EN, 'name_en not restored');
  });

  // ── Categories: name_en CRUD + seeded/localized display ──
  await check('Create category with name_en under texty; public/all exposes both', async () => {
    const r = await fetchJson(`${BASE}/api/categories`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: QA_CAT, name_en: QA_CAT_EN, page_slug: 'texty' }) });
    qaCatIds.push(r.item.id);
    qaCatSlug = r.item.slug;
    assert(r.item.name_en === QA_CAT_EN, `name_en: ${r.item.name_en}`);
    const all = await fetchJson(`${BASE}/api/categories/public/all`);
    const mine = all.find((x) => x.id === r.item.id);
    assert(mine && mine.name_en === QA_CAT_EN && mine.name === QA_CAT, `raw: ${JSON.stringify(mine)}`);
    assert(all.some((x) => x.slug === 'povidky' && x.name_en === 'Stories'), 'seeded povidky lacks name_en');
  });

  await check('Category update persists name_en', async () => {
    const r = await fetchJson(`${BASE}/api/categories/${qaCatIds[0]}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ name_en: `${QA_CAT_EN} v2`, name: QA_CAT }) });
    assert(r.item.name_en === `${QA_CAT_EN} v2`, `name_en: ${r.item.name_en}`);
  });

  // ── Pages: title_en + intro_text_en ───────────────────────
  await check('Create page with title_en; ?lang=en serves localized title', async () => {
    const r = await fetchJson(`${BASE}/api/pages`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: QA_PAGE_TITLE, title_en: QA_PAGE_TITLE_EN, slug: QA_PAGE, is_visible: 1, sort_order: 0,
    }) });
    qaPageSaved = true;
    assert(r.item.title_en === QA_PAGE_TITLE_EN, `title_en: ${r.item.title_en}`);
    const csList = await fetchJson(`${BASE}/api/pages`);
    assert(csList.find((p) => p.slug === QA_PAGE)?.title === QA_PAGE_TITLE, 'cs title wrong');
    const enList = await fetchJson(`${BASE}/api/pages?lang=en`);
    assert(enList.find((p) => p.slug === QA_PAGE)?.title === QA_PAGE_TITLE_EN, 'en title not localized');
  });

  await check('User page nav link localizes to title_en in EN, CS title in CS', async () => {
    await cs.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(cs);
    await waitFor(cs, (slug) => !!document.querySelector(`#desktopNav a[data-menu-page][href="/${slug}"]`), QA_PAGE);
    const csTitle = await cs.evaluate((slug) => document.querySelector(`#desktopNav a[data-menu-page][href="/${slug}"]`)?.textContent || '', QA_PAGE);
    assert(csTitle === QA_PAGE_TITLE, `cs nav title: "${csTitle}"`);

    await en.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(en);
    await waitFor(en, (slug) => !!document.querySelector(`#desktopNav a[data-menu-page][href="/${slug}"]`), QA_PAGE);
    const enTitle = await en.evaluate((slug) => document.querySelector(`#desktopNav a[data-menu-page][href="/${slug}"]`)?.textContent || '', QA_PAGE);
    assert(enTitle === QA_PAGE_TITLE_EN, `en nav title: "${enTitle}"`);
  });

  await check('pageIntro renders the EN intro on /texty in EN mode (restored after)', async () => {
    const before = await fetchJson(`${BASE}/api/pages?lang=en`);
    const texty = before.find((p) => p.slug === 'texty');
    const origEn = texty.intro_text_en || '';
    const origCs = (await fetchJson(`${BASE}/api/pages`)).find((p) => p.slug === 'texty').intro_text || '';
    try {
      await fetchJson(`${BASE}/api/pages/texty`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ intro_text: `${MARK} původ`, intro_text_en: QA_TEXT_PEREX_EN }) });
      await en.goto(`${BASE}/texty`, { waitUntil: 'load' });
      await waitAppContent(en);
      await waitFor(en, () => !!document.querySelector('.page-intro'));
      const intro = await extContent(en, '.page-intro');
      assert(intro === QA_TEXT_PEREX_EN, `en intro: "${intro}"`);
      await cs.goto(`${BASE}/texty`, { waitUntil: 'load' });
      await waitAppContent(cs);
      await waitFor(cs, () => !!document.querySelector('.page-intro'));
      const introCs = await extContent(cs, '.page-intro');
      assert(introCs === `${MARK} původ`, `cs intro: "${introCs}"`);
    } finally {
      await fetchJson(`${BASE}/api/pages/texty`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ intro_text: origCs, intro_text_en: origEn }) }).catch(() => {});
    }
  });

  // ── Public: EN category label in nav dropdown + section header ──
  // (Povídky renders its header only while it holds published texts, so a QA
  // text is placed in the seeded Povídky category for this assertion.)
  await check('Seeded povidky: section header + nav dropdown localize (EN Stories / CS Povídky)', async () => {
    const pov = (await fetchJson(`${BASE}/api/texts`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: QaPovText, content: `<p>${MARK} obsah</p>`, excerpt: QA_TEXT_PEREX,
      cover_image: '', category: 'Povídky', is_published: 1, sort_order: 0,
    }) })).item;
    qaTextIds.push(pov.id);
    assert(pov.category === 'Povídky', `pov text category: ${pov.category}`);

    await en.goto(`${BASE}/texty/povidky`, { waitUntil: 'load' });
    await waitAppContent(en);
    await waitFor(en, () => !!document.querySelector('.section-title'));
    assert((await extContent(en, '.section-title')).trim() === 'Stories', `en header: "${await extContent(en, '.section-title')}"`);
    await waitFor(en, () => [...document.querySelectorAll('#desktopNav .nav-dropdown a[data-subcat]')].some((a) => a.textContent === 'Stories'));
    const enDropdown = await en.evaluate(() => [...document.querySelectorAll('#desktopNav .nav-dropdown a[data-subcat]')].map((a) => a.textContent).join('|'));
    assert(enDropdown.includes('Stories'), `en dropdown: "${enDropdown}"`);

    await cs.goto(`${BASE}/texty/povidky`, { waitUntil: 'load' });
    await waitAppContent(cs);
    await waitFor(cs, () => !!document.querySelector('.section-title'));
    assert((await extContent(cs, '.section-title')).trim() === 'Povídky', `cs header: "${await extContent(cs, '.section-title')}"`);
    await waitFor(cs, () => [...document.querySelectorAll('#desktopNav .nav-dropdown a[data-subcat]')].some((a) => a.textContent === 'Povídky'));
    const csDropdown = await cs.evaluate(() => [...document.querySelectorAll('#desktopNav .nav-dropdown a[data-subcat]')].map((a) => a.textContent).join('|'));
    assert(csDropdown.includes('Povídky'), `cs dropdown: "${csDropdown}"`);
  });

  // ── QA content: one text in the QA category, tagged, with a cover-free
  //    perex — used for the QA section header and the tag end-to-end below.
  await check('Fixture: QA text (category = QA category) with EN title/perex', async () => {
    const t = (await fetchJson(`${BASE}/api/texts`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: QA_TEXT, content: `<p>${MARK} obsah</p>`, excerpt: QA_TEXT_PEREX,
      cover_image: '', category: QA_CAT, is_published: 1, sort_order: 0, title_en: QA_TEXT_EN, excerpt_en: QA_TEXT_PEREX_EN,
    }) })).item;
    qaTextIds.push(t.id);
    qaTextId = t.id;
    qaTextSlug = t.slug;
    assert(t.category === QA_CAT, 'QA text category wrong');
  });

  // ── End-to-end: QA category with EN name on its public page ──
  await check('QA category section header: EN shows name_en, CS shows CS name', async () => {
    await en.goto(`${BASE}/texty/${qaCatSlug}`, { waitUntil: 'load' });
    await waitAppContent(en);
    await waitFor(en, () => !!document.querySelector('.section-title'));
    assert((await extContent(en, '.section-title')).trim() === `${QA_CAT_EN} v2`, `en: "${await extContent(en, '.section-title')}"`);
    await cs.goto(`${BASE}/texty/${qaCatSlug}`, { waitUntil: 'load' });
    await waitAppContent(cs);
    await waitFor(cs, () => !!document.querySelector('.section-title'));
    assert((await extContent(cs, '.section-title')).trim() === QA_CAT, `cs: "${await extContent(cs, '.section-title')}"`);
  });

  // ── Tags end-to-end on public details + tag page ──────────
  await check('Detail chips localize name (EN uses name_en, CS the CS name)', async () => {
    await fetchJson(`${BASE}/api/tags/admin/assign`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      content_type: 'text', content_id: qaTextId, tag_ids: [qaTagIds[0]],
    }) });

    // Detail response carries name_en for chips to localize client-side.
    const detailRaw = await fetchJson(`${BASE}/api/texts/${qaTextSlug}`);
    assert(detailRaw.tags[0]?.name_en === QA_TAG_EN, `detail.tags name_en: ${JSON.stringify(detailRaw.tags)}`);

    await en.goto(`${BASE}/texty/${qaTextSlug}`, { waitUntil: 'load' });
    await waitAppContent(en);
    await waitFor(en, () => !!document.querySelector('.detail-tag'));
    assert((await extContent(en, '.detail-tag')).includes(QA_TAG_EN), 'EN chip wrong');

    await cs.goto(`${BASE}/texty/${qaTextSlug}`, { waitUntil: 'load' });
    await waitAppContent(cs);
    await waitFor(cs, () => !!document.querySelector('.detail-tag'));
    assert((await extContent(cs, '.detail-tag')).includes(QA_TAG), 'CS chip wrong');
  });

  await check('Tag page header localizes (EN: name_en; CS: name); URL unchanged', async () => {
    await en.goto(`${BASE}/tag/${qaTagSlug}`, { waitUntil: 'load' });
    await waitAppContent(en);
    await waitFor(en, () => !!document.querySelector('.section-title'));
    assert((await extContent(en, '.section-title')).includes(QA_TAG_EN), `en header: "${await extContent(en, '.section-title')}"`);
    await cs.goto(`${BASE}/tag/${qaTagSlug}`, { waitUntil: 'load' });
    await waitAppContent(cs);
    await waitFor(cs, () => !!document.querySelector('.section-title'));
    assert((await extContent(cs, '.section-title')).includes(QA_TAG), `cs header: "${await extContent(cs, '.section-title')}"`);
    assert((await extContent(cs, '.section-title')).includes('#'), 'no # prefix');
  });
} finally {
  await cs.close();
  await en.close();
  await browser.close();

  try {
    token = await adminLogin();
    if (qaPageSaved) {
      await fetchJson(`${BASE}/api/pages/${QA_PAGE}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    }
    // Sweep QA-marked texts first (a QA category can only be deleted empty).
    const sweepTexts = (await fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(token) })).filter((x) => (x.title || '').includes(MARK));
    for (const x of sweepTexts) await fetchJson(`${BASE}/api/texts/${x.id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    const sweepCats = (await fetchJson(`${BASE}/api/categories/admin/all`, { headers: auth(token) })).filter((x) => (x.name || '').includes(MARK));
    for (const x of sweepCats) await fetchJson(`${BASE}/api/categories/${x.id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    const sweepTags = (await fetchJson(`${BASE}/api/tags/admin/all`, { headers: auth(token) })).filter((x) => (x.name || '').includes(MARK) || (x.name_en || '').includes(MARK));
    for (const x of sweepTags) await fetchJson(`${BASE}/api/tags/${x.id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});

    const texts = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(token) });
    const cats = await fetchJson(`${BASE}/api/categories/admin/all`, { headers: auth(token) });
    const tags = await fetchJson(`${BASE}/api/tags/admin/all`, { headers: auth(token) });
    const pages = await fetchJson(`${BASE}/api/pages`, { headers: auth(token) });
    const leftovers = [texts, cats, tags, pages].flat().filter((x) => JSON.stringify(x).includes(MARK));
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