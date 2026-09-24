// E2E tests for admin category & menu-item management (Přehled → Menu).
//
// Run locally:   npm run test:menu
// Against prod:  TEST_BASE_URL=https://www.katerina-inachis.cz npm run test:menu
//
// Env:
//   ADMIN_EMAIL / ADMIN_PASSWORD   admin credentials (optional, has defaults)
//   TEST_SERVER_RESTART_CMD        restarts the local server (restart-persistence
//                                  check; omit in production)
//
// Safety: the suite snapshots every page's menu metadata + intro_text and every
// category at startup and restores everything in a finally block, so it is safe
// against production. QA values use the [QA-MENU] marker, QA categories/pages
// are deleted on cleanup.

import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const RESTART_CMD = process.env.TEST_SERVER_RESTART_CMD || '';

const SLUGS = ['texty', 'kresba', 'blog', 'programovani', 'pratele', 'o-mne', 'kontakt'];
const MARK = '[QA-MENU]';
const TS = String(Date.now());
const QA_CATEGORY = `${MARK} Kategorie ${TS}`;
const QA_CATEGORY2 = `${MARK} Kategorie2 ${TS}`;
const QA_PAGE_SLUG = `qa-menu-${TS}`;
const QA_PAGE_TITLE = `${MARK} Stránka ${TS}`;

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

const getPages = () => fetchJson(`${BASE}/api/pages`);
const getCategoriesPublic = () => fetchJson(`${BASE}/api/categories`);
const getCategoriesAdmin = (token) => fetchJson(`${BASE}/api/categories/admin/all`, { headers: auth(token) });

async function createCategory(token, name) {
  return fetchJson(`${BASE}/api/categories`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ name, is_visible: 1, sort_order: 0 }),
  });
}

async function createPage(token, body) {
  return fetchJson(`${BASE}/api/pages`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(body),
  });
}

async function waitFor(page, fn, timeout = 10000) {
  await page.waitForFunction(fn, null, { timeout });
}

async function waitAppContent(page) {
  await waitFor(page, () => {
    const app = document.getElementById('app');
    if (!app) return false;
    const html = app.innerHTML.trim();
    return html !== '' && !app.querySelector('.loading-state');
  });
}

async function waitAdminReady(page) {
  await page.waitForFunction(
    () => {
      const title = document.getElementById('adminPageTitle');
      return title && title.textContent.trim() === 'Přehled';
    },
    null,
    { timeout: 15000 }
  );
}

async function gotoAdmin(page, token) {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
  await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
  await waitAdminReady(page);
}

async function waitMenuTables(page) {
  await waitFor(page, () => {
    const cats = document.querySelector('#menuCategoriesTable tbody');
    const items = document.querySelector('#menuItemsTable tbody');
    if (!cats || !items) return false;
    return !cats.textContent.includes('Načítám') && !items.textContent.includes('Načítám');
  });
}

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

const browser = await chromium.launch(launchOpts);
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(20000);

// Verify server reachable before doing anything destructive.
await fetchJson(`${BASE}/api/pages`);

// Snapshot originals so the suite is restorable against any environment.
const originalPages = await getPages();
const originalCats = await fetchJson(`${BASE}/api/categories/admin/all`, { headers: auth(await adminLogin()) });
console.log(`Snapshot: ${originalPages.length} pages (${originalPages.map((p) => p.slug).join(', ')}), ${originalCats.length} categories`);

let token = null;
try {
  token = await adminLogin();

  // ── A. Category API CRUD ─────────────────────────────────────
  await check('A1: admin creates a category, visible in admin & public lists', async () => {
    const r = await createCategory(token, QA_CATEGORY);
    const cats = await getCategoriesAdmin(token);
    const mine = cats.find((c) => c.name === QA_CATEGORY);
    assert(!!mine, 'category not in admin/all');
    assert(mine.is_visible === 1, `expected visible, got is_visible=${mine.is_visible}`);
    assert(!r.item || r.item.name === QA_CATEGORY, 'created item name mismatch');
    const pub = await getCategoriesPublic();
    assert(pub.some((c) => c.name === QA_CATEGORY), 'visible category missing from public list');
  });

  await check('A2: duplicate category name is rejected (400)', async () => {
    let rejected = false;
    try {
      await createCategory(token, QA_CATEGORY);
    } catch (err) {
      rejected = String(err).includes('HTTP 400');
    }
    assert(rejected, 'expected HTTP 400 for duplicate category name');
  });

  await check('A3: category rename + reorder persists', async () => {
    const cats = await getCategoriesAdmin(token);
    const mine = cats.find((c) => c.name === QA_CATEGORY);
    await fetchJson(`${BASE}/api/categories/${mine.id}`, {
      method: 'PUT',
      headers: auth(token),
      body: JSON.stringify({ name: `${QA_CATEGORY}★`, sort_order: 9 }),
    });
    const after = await getCategoriesAdmin(token);
    const updated = after.find((c) => c.id === mine.id);
    assert(updated.name === `${QA_CATEGORY}★`, `rename failed: "${updated?.name}"`);
    assert(updated.sort_order === 9, `sort_order failed: ${updated?.sort_order}`);
    // back to clean state
    await fetchJson(`${BASE}/api/categories/${mine.id}`, {
      method: 'PUT',
      headers: auth(token),
      body: JSON.stringify({ name: QA_CATEGORY, sort_order: 0 }),
    });
  });

  await check('A4: hidden category leaves the public list but stays in admin/all', async () => {
    const cats = await getCategoriesAdmin(token);
    const mine = cats.find((c) => c.name === QA_CATEGORY);
    await fetchJson(`${BASE}/api/categories/${mine.id}`, {
      method: 'PUT',
      headers: auth(token),
      body: JSON.stringify({ is_visible: 0 }),
    });
    const pub = await getCategoriesPublic();
    assert(!pub.some((c) => c.id === mine.id), 'hidden category still in public list');
    const adminAll = await getCategoriesAdmin(token);
    const hidden = adminAll.find((c) => c.id === mine.id);
    assert(hidden && hidden.is_visible === 0, 'admin/all should still list the hidden category');
    // restore visible
    await fetchJson(`${BASE}/api/categories/${mine.id}`, {
      method: 'PUT',
      headers: auth(token),
      body: JSON.stringify({ is_visible: 1 }),
    });
  });

  // ── B. Menu item / page API CRUD ─────────────────────────────
  await check('B1: admin creates a menu page under a category', async () => {
    const cats = await getCategoriesAdmin(token);
    const cat = cats.find((c) => c.name === QA_CATEGORY);
    const r = await createPage(token, {
      title: QA_PAGE_TITLE, slug: QA_PAGE_SLUG, category_id: cat.id, is_visible: 1, sort_order: 3,
    });
    const pages = await getPages();
    const mine = pages.find((p) => p.slug === QA_PAGE_SLUG);
    assert(!!mine, 'new page missing from /api/pages');
    assert(mine.category_id === cat.id, `category_id=${mine.category_id}`);
    assert(mine.category_name === QA_CATEGORY, `category_name="${mine.category_name}"`);
    assert(mine.category_is_visible === 1, `category_is_visible=${mine.category_is_visible}`);
    assert(mine.sort_order === 3, `sort_order=${mine.sort_order}`);
    assert(mine.is_visible === 1, `is_visible=${mine.is_visible}`);
  });

  await check('B2: invalid slug, duplicate slug, unknown category are rejected', async () => {
    let bad = 0;
    for (const body of [
      { title: 'x', slug: 'B@D SLUG!' },
      { title: 'x', slug: QA_PAGE_SLUG },
      { title: 'x', slug: 'ok-slug', category_id: 999999 },
    ]) {
      try {
        await createPage(token, body);
      } catch (err) {
        if (String(err).includes('HTTP 400')) bad += 1;
      }
    }
    assert(bad === 3, `expected 3 rejections, got ${bad}`);
  });

  await check('B3: PUT updates menu fields and intro-only PUT stays compatible', async () => {
    const put = (body) => fetchJson(`${BASE}/api/pages/${QA_PAGE_SLUG}`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify(body),
    });
    await put({ title: `${QA_PAGE_TITLE}★`, sort_order: 7, is_visible: 0 });
    let mine = (await getPages()).find((p) => p.slug === QA_PAGE_SLUG);
    assert(mine.title === `${QA_PAGE_TITLE}★`, `title="${mine.title}"`);
    assert(mine.sort_order === 7, `sort_order=${mine.sort_order}`);
    assert(mine.is_visible === 0, `is_visible=${mine.is_visible}`);

    // Pure intro_text PUT (legacy call) must not clobber menu fields
    await put({ intro_text: `${MARK} intro` });
    mine = (await getPages()).find((p) => p.slug === QA_PAGE_SLUG);
    assert(mine.intro_text === `${MARK} intro`, `intro_text="${mine.intro_text}"`);
    assert(mine.is_visible === 0, 'intro-only PUT clobbered is_visible');
    assert(mine.sort_order === 7, 'intro-only PUT clobbered sort_order');
    assert(mine.title === `${QA_PAGE_TITLE}★`, 'intro-only PUT clobbered title');
  });

  await check('B4: hidden page stays directly reachable via API', async () => {
    const single = await fetchJson(`${BASE}/api/pages/${QA_PAGE_SLUG}`);
    assert(single.slug === QA_PAGE_SLUG, 'hidden page not reachable by slug');
    // make page visible again for UI tests
    await fetchJson(`${BASE}/api/pages/${QA_PAGE_SLUG}`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ is_visible: 1, title: QA_PAGE_TITLE, sort_order: 0 }),
    });
  });

  await check('B5: page without category gets category_is_visible=1 (NULL treated as visible)', async () => {
    const catless = await createPage(token, { title: `${MARK} nocat`, slug: `${QA_PAGE_SLUG}-nocat`, is_visible: 1 });
    const mine = (await getPages()).find((p) => p.slug === `${QA_PAGE_SLUG}-nocat`);
    assert(mine.category_id === null, `category_id=${mine.category_id}`);
    assert(mine.category_is_visible === 1, `category_is_visible=${mine.category_is_visible}`);
  });

  // ── C. Admin UI (Přehled → menu tables + modals) ─────────────
  await check('C1: overview renders category & page tables with QA entries', async () => {
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    const catsText = await page.locator('#menuCategoriesTable tbody').innerText();
    assert(catsText.includes(QA_CATEGORY), 'QA category missing from categories table');
    const itemsText = await page.locator('#menuItemsTable tbody').innerText();
    assert(itemsText.includes(QA_PAGE_TITLE), 'QA page missing from menu items table');
    assert(itemsText.includes(QA_CATEGORY), 'page row should show its category name');
  });

  await check('C2: toggle visibility via UI button updates badge and survives reload', async () => {
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    const row = page.locator('#menuItemsTable tbody tr', { hasText: QA_PAGE_TITLE });
    await row.locator('button', { hasText: 'Skrýt' }).click();
    await waitFor(page, () => {
      const tr = [...document.querySelectorAll('#menuItemsTable tbody tr')].find((r) => r.textContent.includes('[QA-MENU] Stránka'));
      return tr && tr.textContent.includes('Skrytá');
    });
    let mine = (await getPages()).find((p) => p.slug === QA_PAGE_SLUG);
    assert(mine.is_visible === 0, `expected hidden after toggle, got is_visible=${mine.is_visible}`);

    await page.reload({ waitUntil: 'load' });
    await waitAdminReady(page);
    await waitMenuTables(page);
    const badge = await page.locator('#menuItemsTable tbody tr', { hasText: QA_PAGE_TITLE }).locator('.badge').first().innerText();
    assert(badge.trim() === 'Skrytá', `badge after reload="${badge.trim()}"`);

    // restore visible
    await page.locator('#menuItemsTable tbody tr', { hasText: QA_PAGE_TITLE }).locator('button', { hasText: 'Zobrazit' }).click();
    await waitFor(page, () => {
      const tr = [...document.querySelectorAll('#menuItemsTable tbody tr')].find((r) => r.textContent.includes('[QA-MENU] Stránka'));
      return tr && tr.textContent.includes('Viditelná');
    });
  });

  await check('C3: create a category via the admin modal', async () => {
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    await page.evaluate(() => window.admin.managers.menu.openCategoryModal());
    await page.fill('#categoryForm input[name="name"]', QA_CATEGORY2);
    await page.click('#categoryForm button[type="submit"]');
    await waitFor(page, () => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('Kategorie vytvořena');
    });
    const catsText = await page.locator('#menuCategoriesTable tbody').innerText();
    assert(catsText.includes(QA_CATEGORY2), 'new category not shown after modal create');
  });

  await check('C4: create a menu page via the admin modal (with category)', async () => {
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    await page.evaluate(() => window.admin.managers.menu.openPageModal());
    await page.fill('#menuPageForm input[name="title"]', `${MARK} UI stránka`);
    await page.fill('#menuPageForm input[name="slug"]', `${QA_PAGE_SLUG}-ui`);
    await page.selectOption('#menuPageForm select[name="category_id"]', { label: QA_CATEGORY2 });
    await page.click('#menuPageForm button[type="submit"]');
    await waitFor(page, () => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('Položka menu vytvořena');
    });
    const itemsText = await page.locator('#menuItemsTable tbody').innerText();
    assert(itemsText.includes(`${MARK} UI stránka`), 'new UI page not shown');
    const mine = (await getPages()).find((p) => p.slug === `${QA_PAGE_SLUG}-ui`);
    const cats = await getCategoriesAdmin(token);
    const cat = cats.find((c) => c.name === QA_CATEGORY2);
    assert(mine && mine.category_id === cat.id, 'UI-created page category mismatch');
  });

  await check('C5: editing a page title via modal persists', async () => {
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    const row = page.locator('#menuItemsTable tbody tr', { hasText: QA_PAGE_TITLE });
    await row.locator('button', { hasText: 'Upravit' }).click();
    await page.fill('#menuPageForm input[name="title"]', `${QA_PAGE_TITLE}-edited`);
    const slugInput = page.locator('#menuPageForm input[name="slug"]');
    assert(await slugInput.isDisabled(), 'slug input should be disabled when editing');
    await page.click('#menuPageForm button[type="submit"]');
    await waitFor(page, () => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('Položka menu uložena');
    });
    let mine = (await getPages()).find((p) => p.slug === QA_PAGE_SLUG);
    assert(mine.title === `${QA_PAGE_TITLE}-edited`, `title="${mine.title}"`);
    // revert title for later assertions
    await fetchJson(`${BASE}/api/pages/${QA_PAGE_SLUG}`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ title: QA_PAGE_TITLE }),
    });
  });

  // ── D. Public navigation respects visibility ────────────────
  await check('D1: hidden page link disappears from desktop, mobile & footer nav', async () => {
    await fetchJson(`${BASE}/api/pages/kontakt`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ is_visible: 0 }),
    });
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(page);
    await waitFor(page, () => !!document.querySelector('#desktopNav a[href="/kontakt"].nav-hidden'));
    const hiddenDesktop = await page.evaluate(() => {
      const a = document.querySelector('#desktopNav a[href="/kontakt"]');
      return a ? a.classList.contains('nav-hidden') : null;
    });
    const hiddenFooter = await page.evaluate(() => {
      const a = document.querySelector('.site-footer a[href="/kontakt"]');
      return a ? a.classList.contains('nav-hidden') : null;
    });
    const visibleAbout = await page.evaluate(() => {
      const a = document.querySelector('#desktopNav a[href="/o-mne"]');
      return a ? !a.classList.contains('nav-hidden') : null;
    });
    assert(hiddenDesktop === true, `kontakt desktop link not hidden: ${hiddenDesktop}`);
    assert(hiddenFooter === true, `kontakt footer link not hidden: ${hiddenFooter}`);
    assert(visibleAbout === true, 'visible page (o-mne) got hidden');
  });

  await check('D2: page in a hidden category is absent from the public nav', async () => {
    const cats = await getCategoriesAdmin(token);
    const cat = cats.find((c) => c.name === QA_CATEGORY2);
    assert(!!cat, 'QA_CATEGORY2 missing');
    await fetchJson(`${BASE}/api/categories/${cat.id}`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ is_visible: 0 }),
    });
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(page);
    // Page in a hidden category must not appear in the nav at all.
    const present = await page.evaluate((slug) => {
      return !!document.querySelector(`#desktopNav a[href="/${slug}"]`);
    }, `${QA_PAGE_SLUG}-ui`);
    assert(present === false, 'page in hidden category leaked into the nav');
    // Its direct URL is still reachable (hidden ≠ deleted)
    await page.goto(`${BASE}/${QA_PAGE_SLUG}-ui`, { waitUntil: 'load' });
    await waitAppContent(page);
    const okRoute = await page.evaluate(() => {
      const h = document.querySelector('#app h1, #app h3, #app .section-title');
      return h ? h.textContent.trim() : '';
    });
    assert(okRoute.length > 0, 'hidden-category page route rendered nothing');
    // an unrelated visible page must stay visible
    const st2 = await page.evaluate(() => {
      const a = document.querySelector('.site-footer a[href="/o-mne"]');
      return !a.classList.contains('nav-hidden');
    });
    assert(st2 === true, 'unrelated page got hidden by the category hide');
  });

  await check('D3: hidden page direct URL still loads its content', async () => {
    await page.goto(`${BASE}/kontakt`, { waitUntil: 'load' });
    await waitAppContent(page);
    const h1 = await page.locator('#app h1').first().innerText();
    assert(h1 && h1.trim().length > 0, 'hidden kontakt page rendered no heading');
  });

  await check('D4: newly created visible page is appended to desktop & mobile nav', async () => {
    await createPage(token, { title: 'Umění', slug: 'umeni', is_visible: 1, sort_order: 0 });
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(page);
    await waitFor(page, () => !!document.querySelector('#desktopNav a[href="/umeni"]'));
    const appendedDesktop = await page.evaluate(() => {
      const a = document.querySelector('#desktopNav a[href="/umeni"]');
      return a && !a.classList.contains('nav-hidden') && !a.dataset.i18n;
    });
    const appendedMobile = await page.evaluate(() => {
      const a = document.querySelector('#mobileNav a[href="/umeni"]');
      return a && !a.classList.contains('nav-hidden');
    });
    assert(appendedDesktop === true, 'umeni not appended to desktop nav');
    assert(appendedMobile === true, 'umeni not appended to mobile nav');
    // Its route still works (router supports /umeni)
    await page.goto(`${BASE}/umeni`, { waitUntil: 'load' });
    await waitAppContent(page);
    await waitFor(page, () => !!document.querySelector('#app h1, #app h3'));
    const headingText = await page.locator('#app h1, #app h3').first().innerText();
    assert(headingText && headingText.trim().length > 0, 'umeni route rendered nothing');
  });

  await check('D5: visible page link remains shown when a hidden one is removed', async () => {
    // kontakt is currently hidden from D1; ensure texty stays visible
    const st = await page.evaluate(() => {
      const a = document.querySelector('#desktopNav a[href="/texty"]');
      return a ? !a.classList.contains('nav-hidden') : null;
    });
    assert(st === true, 'texty link unexpectedly hidden');
  });

  // ── E. Server restart persistence (local only) ───────────────
  if (RESTART_CMD) {
    await check('E1: category & page survive a server restart', async () => {
      const { execSync } = await import('node:child_process');
      execSync(RESTART_CMD, { stdio: 'inherit', shell: true });
      let up = false;
      for (let i = 0; i < 40 && !up; i++) {
        await sleep(500);
        try { await getPages(); up = true; } catch { /* retry */ }
      }
      assert(up, 'server did not come back after restart');
      token = await adminLogin();
      const cats = await getCategoriesAdmin(token);
      assert(cats.some((c) => c.name === QA_CATEGORY), 'category lost after restart');
      const pages = await getPages();
      assert(pages.some((p) => p.slug === QA_PAGE_SLUG), 'page lost after restart');
    });
  } else {
    console.log('SKIP  E1 — set TEST_SERVER_RESTART_CMD to test restart persistence');
  }
} finally {
  await browser.close();

  // ── Restore original state, whatever happened ─────────────────
  try {
    if (token) {
      // Delete QA pages, restore original menu metadata + intros for the 7 pages
      const currentPages = await getPages();
      for (const p of currentPages) {
        if (p.slug.startsWith('qa-menu') || p.slug === 'umeni') {
          try {
            await fetchJson(`${BASE}/api/pages/${encodeURIComponent(p.slug)}`, {
              method: 'DELETE', headers: auth(token),
            });
          } catch { /* already gone */ }
        }
      }
      await fetchJson(`${BASE}/api/auth/login`, {}).catch(() => {});
      token = await adminLogin();
      for (const original of originalPages) {
        await fetchJson(`${BASE}/api/pages/${encodeURIComponent(original.slug)}`, {
          method: 'PUT',
          headers: auth(token),
          body: JSON.stringify({
            title: original.title,
            intro_text: original.intro_text || '',
            category_id: original.category_id,
            is_visible: original.is_visible,
            sort_order: original.sort_order,
          }),
        });
      }
      // Delete QA categories, then restore any other categories to snapshot
      const cats = await getCategoriesAdmin(token);
      for (const c of cats) {
        if (c.name.startsWith(MARK)) {
          try {
            await fetchJson(`${BASE}/api/categories/${c.id}`, { method: 'DELETE', headers: auth(token) });
          } catch { /* already gone */ }
        }
      }

      // Verify restoration
      const pagesNow = await getPages();
      const slugsNow = pagesNow.map((p) => p.slug).sort();
      const slugsOrig = originalPages.map((p) => p.slug).sort();
      const okSlugs = JSON.stringify(slugsNow) === JSON.stringify(slugsOrig);
      const catsNow = await getCategoriesAdmin(token);
      const catsOk = catsNow.every((c) => originalCats.some((o) => o.id === c.id && o.name === c.name && o.is_visible === c.is_visible && o.sort_order === c.sort_order));
      if (okSlugs && catsOk) {
        console.log('Restored original menu state: OK');
      } else {
        console.log(`RESTORE ISSUE: slugs ${okSlugs ? 'OK' : 'MISMATCH'}${!okSlugs ? ` (${slugsNow.join(',')})` : ''}; categories ${catsOk ? 'OK' : 'MISMATCH'}`);
      }
    } else {
      console.log('WARNING: no token, could not restore menu state — manual restore required');
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