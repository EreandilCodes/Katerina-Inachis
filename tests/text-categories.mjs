// E2E tests for the Texty subcategories (Texty → Knihy / Povídky / Básně)
// canonical representation + data-driven public nav + admin management.
//
// Run locally:   npm run test:textsubs
// Against prod:  TEST_BASE_URL=https://www.katerina-inachis.cz npm run test:textsubs
//
// Env:
//   ADMIN_EMAIL / ADMIN_PASSWORD   admin credentials (optional, has defaults)
//   TEST_SERVER_RESTART_CMD        restarts the local server (persistence
//                                  check; omit in production)
//
// Safety: only QA-marked categories/texts are created and deleted on cleanup.
// The three seeded subcategories (Knihy / Povídky / Básně) are only hidden/
// shown temporarily and always restored to visible. Nothing is deleted from
// the seeded set.

import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const RESTART_CMD = process.env.TEST_SERVER_RESTART_CMD || '';

const MARK = '[QA-TEXTCAT]';
const TS = String(Date.now());
const QA_SUB = `${MARK}-sub-${TS}`;
const QA_SUB_SLUG = `qa-sub-${TS}`;
const QA_SUB_AUTO = `${MARK}-auto-${TS}`;
const QA_SUB_AUTO_SLUG = `qa-textcat-auto-${TS}`;
const QA_CAT_RENAME = `${MARK}-ren-${TS}`;
const QA_TEXT_TITLE = `${MARK} text ${TS}`;
const QA_LEGACY_TEXT = `${MARK} legacy ${TS}`;
const QA_LEGACY_CATEGORY = `${MARK}-legacy-cat-${TS}`;

const SUB_SEEDS = [
  ['Knihy', 'knihy', 1],
  ['Povídky', 'povidky', 2],
  ['Básně', 'basne', 3],
];

const createdTextIds = [];

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

const getCats = () => fetchJson(`${BASE}/api/categories/public/all`);
const getCatsPublic = () => fetchJson(`${BASE}/api/categories`);
const getCatsAdmin = (token) => fetchJson(`${BASE}/api/categories/admin/all`, { headers: auth(token) });
const getTextsAdmin = (token) => fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(token) });

async function createCategory(token, body) {
  return fetchJson(`${BASE}/api/categories`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
}

async function createText(token, title, category) {
  const r = await fetchJson(`${BASE}/api/texts`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      title, category, content: `<p>${MARK} content</p>`, excerpt: '', is_published: 1, sort_order: 0,
    }),
  });
  createdTextIds.push(r.item.id);
  return r.item;
}

async function waitFor(page, fn, timeout = 15000) {
  await page.waitForFunction(fn, null, { timeout });
}

async function waitAppContent(page) {
  await waitFor(page, () => {
    const app = document.getElementById('app');
    if (!app) return false;
    const html = app.innerHTML.trim();
    return html !== '' && !app.querySelector('.loading-state');
  }, 20000);
}

async function waitAdminReady(page) {
  await page.waitForFunction(
    () => {
      const title = document.getElementById('adminPageTitle');
      return title && title.textContent.trim() === 'Přehled';
    },
    null,
    { timeout: 30000 }
  );
}

async function gotoAdmin(page, token) {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
  await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
  await waitAdminReady(page);
}

async function waitMenuTables(page) {
  await page.waitForFunction(() => {
    const cats = document.querySelector('#menuCategoriesTable tbody');
    const items = document.querySelector('#menuItemsTable tbody');
    if (!cats || !items) return false;
    return !cats.textContent.includes('Načítám') && !items.textContent.includes('Načítám');
  }, null, { timeout: 30000 });
}

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

const browser = await chromium.launch(launchOpts);
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(45000);

// Public-site context forced to Czech so nav labels are deterministic.
const pubContext = await browser.newContext();
const pubPage = await pubContext.newPage();
await pubPage.addInitScript(() => localStorage.setItem('inachis_lang', 'cs'));
pubPage.setDefaultTimeout(45000);

// Verify server reachable before doing anything destructive.
await fetchJson(`${BASE}/api/pages`);
await fetchJson(`${BASE}/api/categories/public/all`);

let token = null;
try {
  token = await adminLogin();

  // ── A. Canonical representation of the subcategories ────────────────
  await check('A1: Knihy / Povídky / Básně exist exactly once with URL metadata', async () => {
    const cats = await getCats();
    for (const [name, slug, order] of SUB_SEEDS) {
      const byName = cats.filter((c) => c.name === name);
      const bySlug = cats.filter((c) => c.slug === slug);
      assert(byName.length === 1, `expected exactly 1 "${name}", got ${byName.length}`);
      assert(byName[0].slug === slug, `"${name}" slug=${byName[0].slug}`);
      assert(byName[0].page_slug === 'texty', `"${name}" page_slug="${byName[0].page_slug}"`);
      assert(byName[0].is_visible === 1, `"${name}" is_visible=${byName[0].is_visible}`);
      assert(byName[0].sort_order === order, `"${name}" sort_order=${byName[0].sort_order}`);
      assert(bySlug.length === 1, `slug "${slug}" should be unique`);
    }
  });

  await check('A2: all three appear in the public visible list', async () => {
    const pub = await getCatsPublic();
    for (const [name] of SUB_SEEDS) {
      assert(pub.some((c) => c.name === name), `"${name}" missing from /api/categories`);
    }
  });

  await check('A3: texts.category drives the subcategory listing (/texty/povidky)', async () => {
    await createText(token, QA_TEXT_TITLE, 'Povídky');
    const povidky = await fetchJson(`${BASE}/api/texts?category=${encodeURIComponent('Povídky')}`);
    assert(povidky.some((t) => t.title === QA_TEXT_TITLE), 'text missing from ?category=Povídky');
    const basne = await fetchJson(`${BASE}/api/texts?category=${encodeURIComponent('Básně')}`);
    assert(!basne.some((t) => t.title === QA_TEXT_TITLE), 'text leaked into ?category=Básně');

    await pubPage.goto(`${BASE}/texty/povidky`, { waitUntil: 'load' });
    await waitAppContent(pubPage);
    await pubPage.waitForFunction(
      (title) => {
        const app = document.getElementById('app');
        return app && app.textContent.includes(title);
      },
      QA_TEXT_TITLE,
      { timeout: 20000 }
    );
  });

  // ── B. Admin API: slug / page_slug / rename cascade ─────────────────
  await check('B1: create a subcategory under texty with an explicit slug', async () => {
    const r = await createCategory(token, {
      name: QA_SUB, slug: QA_SUB_SLUG, page_slug: 'texty', is_visible: 1, sort_order: 5,
    });
    assert(r.item.slug === QA_SUB_SLUG, `slug="${r.item.slug}"`);
    assert(r.item.page_slug === 'texty', `page_slug="${r.item.page_slug}"`);
    const all = await getCatsAdmin(token);
    assert(all.some((c) => c.slug === QA_SUB_SLUG && c.page_slug === 'texty'), 'category missing from admin/all');
    const pub = await getCats();
    assert(pub.some((c) => c.slug === QA_SUB_SLUG), 'category missing from public/all');
  });

  await check('B2: slug is auto-generated from the name when a parent page is set', async () => {
    const r = await createCategory(token, {
      name: QA_SUB_AUTO, page_slug: 'texty', is_visible: 1, sort_order: 6,
    });
    assert(typeof r.item.slug === 'string' && /^[a-z0-9-]+$/.test(r.item.slug), `bad auto slug="${r.item.slug}"`);
    assert(r.item.slug === QA_SUB_AUTO_SLUG, `unexpected auto slug "${r.item.slug}" (expected "${QA_SUB_AUTO_SLUG}")`);
  });

  await check('B3: invalid slug, duplicate slug and unknown page are rejected', async () => {
    let bad = 0;
    for (const body of [
      { name: `${MARK}-invalid-${TS}`, slug: 'B@D SLUG!', page_slug: 'texty' },
      { name: `${MARK}-dup-${TS}`, slug: 'knihy', page_slug: 'texty' },
      { name: `${MARK}-nopage-${TS}`, slug: 'nopage-slug', page_slug: 'neexistujici-stranka' },
    ]) {
      try {
        await createCategory(token, body);
      } catch (err) {
        if (String(err).includes('HTTP 400')) bad += 1;
      }
    }
    assert(bad === 3, `expected 3 rejections, got ${bad}`);
  });

  await check('B4: slug is immutable, other fields (incl. parent page) edit fine', async () => {
    const all = await getCatsAdmin(token);
    const mine = all.find((c) => c.slug === QA_SUB_SLUG);
    let immutable = false;
    try {
      await fetchJson(`${BASE}/api/categories/${mine.id}`, {
        method: 'PUT', headers: auth(token), body: JSON.stringify({ slug: `${QA_SUB_SLUG}-changed` }),
      });
    } catch (err) {
      immutable = String(err).includes('HTTP 400');
    }
    assert(immutable, 'slug change was not rejected');
    await fetchJson(`${BASE}/api/categories/${mine.id}`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ name: `${QA_SUB}★`, sort_order: 7 }),
    });
    const after = (await getCatsAdmin(token)).find((c) => c.id === mine.id);
    assert(after.name === `${QA_SUB}★`, `rename failed: "${after.name}"`);
    assert(after.slug === QA_SUB_SLUG, 'slug changed on update');
    assert(after.page_slug === 'texty', 'page_slug lost on update');
  });

  await check('B5: renaming a category cascades to texts.category', async () => {
    const cat = await createCategory(token, { name: QA_CAT_RENAME, page_slug: 'texty', is_visible: 1 });
    const catId = cat.item.id;
    const t = await createText(token, `${QA_TEXT_TITLE}-ren`, QA_CAT_RENAME);
    await fetchJson(`${BASE}/api/categories/${catId}`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ name: `${QA_CAT_RENAME}-nove` }),
    });
    const after = (await getTextsAdmin(token)).find((x) => x.id === t.id);
    assert(after.category === `${QA_CAT_RENAME}-nove`, `text.category="${after.category}" (expected renamed)`);
    const listed = await fetchJson(`${BASE}/api/texts?category=${encodeURIComponent(`${QA_CAT_RENAME}-nove`)}`);
    assert(listed.some((x) => x.id === t.id), 'renamed category no longer lists its text');
    // cleanup text (category is cleaned up in finally)
    await fetchJson(`${BASE}/api/texts/${t.id}`, { method: 'DELETE', headers: auth(token) });
    createdTextIds.splice(createdTextIds.indexOf(t.id), 1);
  });

  // ── C. Admin UI ──────────────────────────────────────────────────────
  await check('C1: Přehled groups subcategories under "Texty" with Hlavní + Slug', async () => {
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    const catsText = await page.locator('#menuCategoriesTable tbody').innerText();
    assert(catsText.includes('Texty'), 'missing "Texty" group header');
    const cells = await page.evaluate(() => {
      const tb = document.querySelector('#menuCategoriesTable tbody');
      const row = [...tb.querySelectorAll('tr')].find((r) => r.textContent.includes('Povídky') && r.querySelector('button'));
      return row ? [...row.querySelectorAll('td')].map((td) => td.textContent.trim()) : null;
    });
    assert(!!cells, 'Povídky row not found');
    assert(cells[0].split('\n')[0] === 'Povídky', `col0="${cells[0]}"`);
    assert(cells[0].includes('Stories'), `col0 lacks EN subline: "${cells[0]}"`);
    assert(cells[1] === 'Texty', `col1 (Hlavní)="${cells[1]}"`);
    assert(cells[2].includes('/texty/povidky'), `col2 (Slug)="${cells[2]}"`);
    assert(cells[3] === 'Viditelná', `col3 (Viditelnost)="${cells[3]}"`);
  });

  await check('C2: category modal edits subcategories (slug disabled) and creates under texty', async () => {
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    const all = await getCatsAdmin(token);
    const povidky = all.find((c) => c.slug === 'povidky');
    await page.evaluate((id) => window.admin.managers.menu.openCategoryModal(id), povidky.id);
    const slugInput = page.locator('#categoryForm input[name="slug"]');
    assert(await slugInput.isDisabled(), 'slug should be disabled when editing');
    assert((await slugInput.inputValue()) === 'povidky', `slug value="${await slugInput.inputValue()}"`);
    assert((await page.locator('#categoryForm select[name="page_slug"]').inputValue()) === 'texty', 'page_slug should be texty');

    // Create a new subcategory via the UI: choosing a parent page auto-fills slug.
    await page.evaluate(() => window.admin.managers.menu.openCategoryModal());
    await page.fill('#categoryForm input[name="name"]', `${MARK} PRUBEZNIK ${TS}`);
    await page.selectOption('#categoryForm select[name="page_slug"]', 'texty');
    const autoSlug = (await page.locator('#categoryForm input[name="slug"]').inputValue()).trim();
    assert(autoSlug.length > 0, `auto slug empty (got "${autoSlug}")`);
    await page.click('#categoryForm button[type="submit"]');
    await waitFor(page, () => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('Kategorie vytvořena');
    });
    const after = await getCatsAdmin(token);
    assert(after.some((c) => c.page_slug === 'texty' && c.slug === autoSlug), 'UI-created subcategory missing from API');
  });

  await check('C3: texts form category select lists the subcategories and preserves a legacy value', async () => {
    await gotoAdmin(page, token);
    await page.evaluate(() => window.admin.loadSection('texts'));
    await page.waitForFunction(() => !!document.querySelector('#textsTableBody'));
    // Legacy category must stay selectable even though it is not a category row.
    await createText(token, QA_LEGACY_TEXT, QA_LEGACY_CATEGORY);
    // Re-enter the section so the manager re-reads items (as a fresh visit would).
    await page.evaluate(() => window.admin.managers.texts.loadItems());
    await page.waitForFunction((title) => {
      return [...document.querySelectorAll('#textsTableBody tr')].some((r) => r.textContent.includes(title));
    }, QA_LEGACY_TEXT);
    const legacy = (await getTextsAdmin(token)).find((t) => t.title === QA_LEGACY_TEXT);
    await page.evaluate((id) => window.admin.managers.texts.showModal(id), legacy.id);
    const opts = await page.$$eval('#textsForm select[name="category"] option', (els) => els.map((o) => o.value));
    for (const [name] of SUB_SEEDS) {
      assert(opts.includes(name), `option "${name}" missing from texts select; got [${opts.join(', ')}]`);
    }
    assert(opts.includes(QA_LEGACY_CATEGORY), `legacy category "${QA_LEGACY_CATEGORY}" not preserved`);
    const selVal = await page.locator('#textsForm select[name="category"]').inputValue();
    assert(selVal === QA_LEGACY_CATEGORY, `select value="${selVal}" (should be legacy)`);
  });

  // ── D. Public nav + router are data-driven ──────────────────────────
  await check('D1: desktop dropdown & mobile sub-nav render the three subcategories in order', async () => {
    await pubPage.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(pubPage);
    await waitFor(pubPage, () => {
      const links = document.querySelectorAll('#desktopNav .nav-dropdown a[data-subcat]');
      return links.length >= 3;
    });
    const SEED_HREFS = ['/texty/knihy', '/texty/povidky', '/texty/basne'];
    const hrefs = await pubPage.$$eval('#desktopNav .nav-dropdown a[data-subcat]', (els) => els.map((a) => a.getAttribute('href')));
    const seedHrefs = hrefs.filter((h) => SEED_HREFS.includes(h));
    assert(JSON.stringify(seedHrefs) === JSON.stringify(SEED_HREFS), `seed order wrong in ${JSON.stringify(hrefs)}`);
    const labels = await pubPage.evaluate((hrefsList) => {
      return hrefsList.map((h) => {
        const a = document.querySelector(`#desktopNav .nav-dropdown a[data-subcat][href="${h}"]`);
        return a ? a.textContent.trim() : null;
      });
    }, SEED_HREFS);
    assert(JSON.stringify(labels) === JSON.stringify(['Knihy', 'Povídky', 'Básně']), `desktop labels=${JSON.stringify(labels)}`);
    const mobileHrefs = await pubPage.$$eval('#mobileNav a.nav-mobile-sub[data-subcat]', (els) => els.map((a) => a.getAttribute('href')));
    const mobileSeeds = mobileHrefs.filter((h) => SEED_HREFS.includes(h));
    assert(JSON.stringify(mobileSeeds) === JSON.stringify(SEED_HREFS), `mobile order wrong in ${JSON.stringify(mobileHrefs)}`);
  });

  await check('D2: hiding a subcategory removes its nav link while its URL still works', async () => {
    const mine = (await getCats()).find((c) => c.slug === QA_SUB_SLUG);
    await fetchJson(`${BASE}/api/categories/${mine.id}`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ is_visible: 0 }),
    });
    await pubPage.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(pubPage);
    await pubPage.waitForFunction((slug) => {
      return !document.querySelector(`#desktopNav .nav-dropdown a[data-subcat][href="/texty/${slug}"]`);
    }, QA_SUB_SLUG, { timeout: 20000 });
    const stillThere = await pubPage.evaluate((slug) => {
      return !!document.querySelector(`#desktopNav .nav-dropdown a[data-subcat][href="/texty/${slug}"]`);
    }, QA_SUB_SLUG);
    assert(stillThere === false, 'hidden subcategory still in the dropdown');

    await pubPage.goto(`${BASE}/texty/${QA_SUB_SLUG}`, { waitUntil: 'load' });
    await waitAppContent(pubPage);
    const emptyState = await pubPage.evaluate(() => {
      const app = document.getElementById('app');
      return app ? (!!app.querySelector('.empty-state') || !!app.querySelector('h1, h3')) : false;
    });
    assert(emptyState === true, 'hidden subcategory URL did not render');
    // restore visible
    await fetchJson(`${BASE}/api/categories/${mine.id}`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ is_visible: 1 }),
    });
    await pubPage.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(pubPage);
    await pubPage.waitForFunction((slug) => {
      return !!document.querySelector(`#desktopNav .nav-dropdown a[data-subcat][href="/texty/${slug}"]`);
    }, QA_SUB_SLUG, { timeout: 20000 });
  });

  await check('D3: hiding the texty page hides the whole dropdown (hidden ≠ deleted)', async () => {
    await fetchJson(`${BASE}/api/pages/texty`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ is_visible: 0 }),
    });
    await pubPage.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(pubPage);
    await waitFor(pubPage, () => {
      const wrap = document.querySelector('#desktopNav .nav-item--dropdown');
      return wrap && wrap.classList.contains('nav-hidden');
    });
    // direct URL to the page still works
    await pubPage.goto(`${BASE}/texty`, { waitUntil: 'load' });
    await waitAppContent(pubPage);
    const ok = await pubPage.evaluate(() => {
      const app = document.getElementById('app');
      return app ? app.textContent.length > 0 : false;
    });
    assert(ok === true, '/texty did not render while hidden');
    await fetchJson(`${BASE}/api/pages/texty`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ is_visible: 1 }),
    });
  });

  await check('D4: subcategory labels translate with the language', async () => {
    await pubPage.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(pubPage);
    await pubPage.evaluate(() => window.setLang('en'));
    await waitFor(pubPage, () => {
      const a = document.querySelector('#desktopNav .nav-dropdown a[data-subcat][href="/texty/povidky"]');
      return a && a.textContent.trim() === 'Stories';
    });
    const SEED_HREFS = ['/texty/knihy', '/texty/povidky', '/texty/basne'];
    const enLabels = await pubPage.evaluate((hrefsList) => {
      return hrefsList.map((h) => {
        const a = document.querySelector(`#desktopNav .nav-dropdown a[data-subcat][href="${h}"]`);
        return a ? a.textContent.trim() : null;
      });
    }, SEED_HREFS);
    assert(JSON.stringify(enLabels) === JSON.stringify(['Books', 'Stories', 'Poems']), `en labels=${JSON.stringify(enLabels)}`);
    await pubPage.evaluate(() => window.setLang('cs'));
    await waitFor(pubPage, () => {
      const a = document.querySelector('#desktopNav .nav-dropdown a[data-subcat][href="/texty/povidky"]');
      return a && a.textContent.trim() === 'Povídky';
    });
  });

  // ── E. Server restart persistence (local only) ──────────────────────
  if (RESTART_CMD) {
    await check('E1: seeded + admin-created subcategories survive a restart without duplicates', async () => {
      const { execSync } = await import('node:child_process');
      execSync(RESTART_CMD, { stdio: 'inherit', shell: true });
      let up = false;
      for (let i = 0; i < 40 && !up; i++) {
        await sleep(500);
        try { await getCats(); up = true; } catch { /* retry */ }
      }
      assert(up, 'server did not come back after restart');
      token = await adminLogin();
      const cats = await getCats();
      const seeded = cats.filter((c) => ['knihy', 'povidky', 'basne'].includes(c.slug));
      assert(seeded.length === 3, `after restart got ${seeded.length} seeded subcategories (duplicates?)`);
      assert(cats.some((c) => c.slug === QA_SUB_SLUG), 'QA subcategory lost after restart');
    });
  } else {
    console.log('SKIP  E1 — set TEST_SERVER_RESTART_CMD to test restart persistence');
  }
} finally {
  await browser.close();
  await pubContext.close();

  // ── Restore / clean up whatever happened ────────────────────────────
  try {
    if (token) {
      // Restore the three seeded subcategories to visible (idempotent).
      for (const [, slug] of SUB_SEEDS) {
        try {
          const cats = (await getCatsAdmin(token)).filter((c) => c.slug === slug);
          for (const c of cats) {
            await fetchJson(`${BASE}/api/categories/${c.id}`, {
              method: 'PUT', headers: auth(token), body: JSON.stringify({ is_visible: 1 }),
            });
          }
        } catch { /* already fine */ }
      }
      // Restore the texty page visibility.
      try {
        await fetchJson(`${BASE}/api/pages/texty`, {
          method: 'PUT', headers: auth(token), body: JSON.stringify({ is_visible: 1 }),
        });
      } catch { /* already fine */ }
      // Delete QA texts we created.
      const texts = await getTextsAdmin(token).catch(() => []);
      for (const t of texts) {
        if (t.title && t.title.includes(MARK)) {
          try {
            await fetchJson(`${BASE}/api/texts/${t.id}`, { method: 'DELETE', headers: auth(token) });
          } catch { /* already gone */ }
        }
      }
      createdTextIds.length = 0;
      // Delete QA categories we created.
      const cats = await getCatsAdmin(token).catch(() => []);
      for (const c of cats) {
        if (c.name && c.name.includes(MARK)) {
          try {
            await fetchJson(`${BASE}/api/categories/${c.id}`, { method: 'DELETE', headers: auth(token) });
          } catch { /* already gone */ }
        }
      }
      const remaining = await getCats();
      const seededOk = ['knihy', 'povidky', 'basne'].every((s) => remaining.filter((c) => c.slug === s).length === 1);
      const qaGone = !remaining.some((c) => c.name && c.name.includes(MARK));
      console.log(`Restore check: seeded ${seededOk ? 'OK' : 'FAIL'}; QA categories ${qaGone ? 'removed' : 'STILL PRESENT'}`);
    } else {
      console.log('WARNING: no token, could not clean up — manual restore required');
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