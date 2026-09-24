// E2E tests for safe deletion of Admin categories & pages/menu items (Přehled).
//
// Run locally:   npm run test:delete
// Against prod:  TEST_BASE_URL=https://www.katerina-inachis.cz npm run test:delete
//
// Env:
//   ADMIN_EMAIL / ADMIN_PASSWORD   admin credentials (optional, has defaults)
//
// Safety: only clearly marked [QA-DEL] records are created; every QA record is
// removed in the finally block. Real content (including the seeded Texty
// subcategories and the core pages) is only read, never modified/deleted.
// Deletion is exercised on QA records only.

import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const MARK = '[QA-DEL]';
const TS = String(Date.now());
const QA_CAT_EMPTY   = `${MARK} Cat-empty ${TS}`;      // deleted via API (A1)
const QA_CAT_UI      = `${MARK} Cat-UI ${TS}`;         // confirm/cancel + delete via UI (D1/D2)
const QA_CAT_CONTENT = `${MARK} Cat-content ${TS}`;    // has a text → protected (A3/D4)
const QA_CAT_ASSIGN  = `${MARK} Cat-assigned ${TS}`;   // page assigned → protected (A4)
const QA_TEXT_TITLE  = `${MARK} text ${TS}`;
const QA_PAGE_CLEAN  = `qa-del-clean-${TS}`;           // deleted via API (B1)
const QA_PAGE_ASSIGN = `qa-del-assigned-${TS}`;
const QA_PAGE_CHILD  = `qa-del-child-${TS}`;
const QA_CAT_CHILD   = `${MARK} Child ${TS}`;
const QA_PAGE_UI     = `qa-del-ui-${TS}`;              // deleted via UI (D3)
const QA_PAGE_NAV    = `qa-del-nav-${TS}`;             // nav removal (E1)
const QA_FRIEND      = `${MARK} friend ${TS}`;
const QA_FRIEND_EMAIL = `qa-del-${TS}@inachis.test`;
const QA_FRIEND_PASS  = 'qa-delete-pass-123';

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

const getPages         = () => fetchJson(`${BASE}/api/pages`);
const getCatsPublic    = () => fetchJson(`${BASE}/api/categories`);
const getCatsAdmin     = (token) => fetchJson(`${BASE}/api/categories/admin/all`, { headers: auth(token) });
const getTextsAdmin    = (token) => fetchJson(`${BASE}/api/texts/admin/all`, { headers: auth(token) });

async function createCat(token, body) {
  return fetchJson(`${BASE}/api/categories`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
}
async function createPage(token, body) {
  return fetchJson(`${BASE}/api/pages`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
}
async function createText(token, body) {
  return fetchJson(`${BASE}/api/texts`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
}
async function apiDelete(url, token) {
  const options = token ? { headers: auth(token) } : {};
  const res = await fetch(`${BASE}${url}`, { method: 'DELETE', ...options });
  let body;
  try {
    body = await res.json();
  } catch {
    body = { error: 'non-json' };
  }
  return { status: res.status, body };
}

async function waitFor(page, fn, arg, timeout = 15000) {
  await page.waitForFunction(fn, arg, { timeout });
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
const pubContext = await browser.newContext();
const pubPage = await pubContext.newPage();
pubPage.setDefaultTimeout(45000);

// Verify server reachable before doing anything destructive.
await fetchJson(`${BASE}/api/pages`);

// Snapshot originals so the end of the suite can prove no drift.
const originalPages = await getPages();
const originalCats = await getCatsAdmin(await adminLogin());
console.log(`Snapshot: ${originalPages.length} pages, ${originalCats.length} categories`);

let token = null;
let qaCatUiId = null;      // id of QA_CAT_UI (created in D1, deleted via UI in D2)
const qaTextIds = [];
const qaPageSlugs = new Set();
const qaCatIds = new Set();
const qaFriendIds = new Set();

try {
  token = await adminLogin();

  // ── A. Category DELETE API ─────────────────────────────────
  await check('A1: admin deletes an unused category (200) and it disappears everywhere', async () => {
    const created = await createCat(token, { name: QA_CAT_EMPTY, is_visible: 1, sort_order: 0 });
    qaCatIds.add(created.item.id);
    const r = await apiDelete(`/api/categories/${created.item.id}`, token);
    assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
    qaCatIds.delete(created.item.id); // already gone
    const adminAll = await getCatsAdmin(token);
    assert(!adminAll.some((c) => c.id === created.item.id), 'deleted category still in admin/all');
    const pub = await getCatsPublic();
    assert(!pub.some((c) => c.id === created.item.id), 'deleted category still in public list');
  });

  await check('A2: deleting a nonexistent category returns 404', async () => {
    const r = await apiDelete('/api/categories/99999999', token);
    assert(r.status === 404, `expected 404, got ${r.status}`);
  });

  await check('A3: category with texts cannot be deleted (409) and texts stay intact', async () => {
    const created = await createCat(token, { name: QA_CAT_CONTENT, is_visible: 1 });
    qaCatIds.add(created.item.id);
    const text = await createText(token, {
      title: QA_TEXT_TITLE, category: QA_CAT_CONTENT, content: '<p>neznič mě</p>', is_published: 1,
    });
    qaTextIds.push(text.item.id);
    const r = await apiDelete(`/api/categories/${created.item.id}`, token);
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert(/nelze smazat/.test(r.body.error || ''), `message missing: ${JSON.stringify(r.body)}`);
    assert(/obsahuje \d+ člán/.test(r.body.error || ''), `no článk count in message: ${r.body.error}`);
    const adminAll = await getCatsAdmin(token);
    assert(adminAll.some((c) => c.id === created.item.id), 'protected category was deleted anyway');
    const allTexts = await getTextsAdmin(token);
    const stillThere = allTexts.find((t) => t.id === text.item.id);
    assert(stillThere && stillThere.category === QA_CAT_CONTENT, 'text lost its category');
  });

  await check('A4: category assigned to a menu page cannot be deleted (409), page keeps its assignment', async () => {
    const created = await createCat(token, { name: QA_CAT_ASSIGN, is_visible: 1 });
    qaCatIds.add(created.item.id);
    const pg = await createPage(token, {
      title: `${MARK} Assigned page`, slug: QA_PAGE_ASSIGN, category_id: created.item.id, is_visible: 1,
    });
    qaPageSlugs.add(QA_PAGE_ASSIGN);
    const r = await apiDelete(`/api/categories/${created.item.id}`, token);
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert((r.body.error || '').includes('položce menu') || (r.body.error || '').includes('položkám'), `message: ${r.body.error}`);
    const pages = await getPages();
    const mine = pages.find((p) => p.slug === QA_PAGE_ASSIGN);
    assert(mine && mine.category_id === created.item.id, 'page assignment was detached by blocked delete');
  });

  // ── B. Page DELETE API ────────────────────────────────────
  await check('B1: admin deletes an unused page (200) and it disappears from the list', async () => {
    await createPage(token, { title: `${MARK} Clean page`, slug: QA_PAGE_CLEAN, is_visible: 1 });
    qaPageSlugs.add(QA_PAGE_CLEAN);
    const r = await apiDelete(`/api/pages/${QA_PAGE_CLEAN}`, token);
    assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
    qaPageSlugs.delete(QA_PAGE_CLEAN); // already gone
    const pages = await getPages();
    assert(!pages.some((p) => p.slug === QA_PAGE_CLEAN), 'deleted page still listed');
  });

  await check('B2: deleting a nonexistent page returns 404', async () => {
    const r = await apiDelete('/api/pages/no-such-page-xyz', token);
    assert(r.status === 404, `expected 404, got ${r.status}`);
  });

  await check('B3: system page (kontakt) refuses deletion with 409', async () => {
    const r = await apiDelete('/api/pages/kontakt', token);
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert((r.body.error || '').includes('Systémovou stránku'), `message: ${r.body.error}`);
    const pages = await getPages();
    assert(pages.some((p) => p.slug === 'kontakt'), 'system page was deleted');
    // the whole seeded site skeleton must be intact
    for (const slug of ['texty', 'kresba', 'blog', 'programovani', 'pratele', 'o-mne', 'kontakt']) {
      assert(pages.some((p) => p.slug === slug), `core page ${slug} missing!`);
    }
  });

  await check('B4: page with child subcategories cannot be deleted (409), child stays', async () => {
    await createPage(token, { title: `${MARK} Child page`, slug: QA_PAGE_CHILD, is_visible: 1 });
    qaPageSlugs.add(QA_PAGE_CHILD);
    const child = await createCat(token, {
      name: QA_CAT_CHILD, slug: `qa-del-child-cat-${TS}`, page_slug: QA_PAGE_CHILD, is_visible: 1,
    });
    qaCatIds.add(child.item.id);
    const r = await apiDelete(`/api/pages/${QA_PAGE_CHILD}`, token);
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert((r.body.error || '').includes('podkategori'), `message: ${r.body.error}`);
    const cats = await getCatsAdmin(token);
    assert(cats.some((c) => c.id === child.item.id && c.page_slug === QA_PAGE_CHILD), 'child category was lost');
    assert((await getPages()).some((p) => p.slug === QA_PAGE_CHILD), 'blocked page got deleted');
  });

  // ── C. Authorization ──────────────────────────────────────
  await check('C1: unauthenticated delete returns 401', async () => {
    const r = await apiDelete(`/api/categories/${QA_CAT_CONTENT ? '1' : '1'}`); // any id
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  await check('C2: delete with an invalid token returns 401', async () => {
    const r = await apiDelete('/api/categories/1', 'not-a-real-token');
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  await check('C3: non-admin (friend) token is forbidden (403) for page and category deletes', async () => {
    const fr = await fetchJson(`${BASE}/api/friends`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ name: QA_FRIEND }),
    });
    qaFriendIds.add(fr.item.id);
    await fetchJson(`${BASE}/api/friends/${fr.item.id}/set-login`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ email: QA_FRIEND_EMAIL, password: QA_FRIEND_PASS }),
    });
    const login = await fetchJson(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: QA_FRIEND_EMAIL, password: QA_FRIEND_PASS }),
    });
    assert(login.user.role === 'friend', `expected friend role, got ${login.user.role}`);
    const cat = (await getCatsAdmin(token)).find((c) => c.name === QA_CAT_CONTENT);
    const rc = await apiDelete(`/api/categories/${cat.id}`, login.token);
    assert(rc.status === 403, `expected 403 on category, got ${rc.status}`);
    const rp = await apiDelete('/api/pages/kontakt', login.token);
    assert(rp.status === 403, `expected 403 on page, got ${rp.status}`);
  });

  // ── D. Admin UI ───────────────────────────────────────────
  await check('D1: clicking Smazat opens a confirmation modal that names the item; Zrušit cancels', async () => {
    const created = await createCat(token, { name: QA_CAT_UI, is_visible: 1 });
    qaCatIds.add(created.item.id);
    qaCatUiId = created.item.id;
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    const row = page.locator('#menuCategoriesTable tbody tr', { hasText: QA_CAT_UI });
    await row.locator('button', { hasText: 'Smazat' }).click();
    await waitFor(page, () => !document.getElementById('confirmModalOverlay')?.classList.contains('hidden'));
    const message = await page.locator('#confirmModalMessage').innerText();
    assert(message.includes(QA_CAT_UI), `confirm message does not name the item: "${message}"`);
    const overlayText = await page.locator('#confirmModalOverlay').innerText();
    assert(overlayText.includes('Opravdu chcete smazat'), 'no "Opravdu chcete smazat" prompt');
    assert(overlayText.includes('Zrušit'), 'missing Zrušit button');
    assert(overlayText.includes('Smazat'), 'missing Smazat button');
    // nothing was deleted yet
    assert((await getCatsAdmin(token)).some((c) => c.id === created.item.id), 'item deleted before confirmation');
    await page.locator('#confirmModalOverlay button', { hasText: 'Zrušit' }).click();
    await waitFor(page, () => document.getElementById('confirmModalOverlay')?.classList.contains('hidden'));
    assert((await getCatsAdmin(token)).some((c) => c.id === created.item.id), 'Zrušit still deleted the item');
  });

  await check('D2: confirming deletes the unused category from the UI and from the API', async () => {
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    const row = page.locator('#menuCategoriesTable tbody tr', { hasText: QA_CAT_UI });
    await row.locator('button', { hasText: 'Smazat' }).click();
    await waitFor(page, () => !document.getElementById('confirmModalOverlay')?.classList.contains('hidden'));
    await page.click('#confirmDeleteBtn');
    await waitFor(page, () => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('Kategorie odstraněna');
    });
    assert(!(await getCatsAdmin(token)).some((c) => c.name === QA_CAT_UI), 'category still in API after UI delete');
    if (qaCatUiId) qaCatIds.delete(qaCatUiId);
  });

  await check('D3: confirming deletes an unused page from the UI and from the API', async () => {
    await createPage(token, { title: `${MARK} UI page`, slug: QA_PAGE_UI, is_visible: 1 });
    qaPageSlugs.add(QA_PAGE_UI);
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    const row = page.locator('#menuItemsTable tbody tr', { hasText: QA_PAGE_UI });
    await row.locator('button', { hasText: 'Smazat' }).click();
    await waitFor(page, () => !document.getElementById('confirmModalOverlay')?.classList.contains('hidden'));
    await page.click('#confirmDeleteBtn');
    await waitFor(page, () => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('Stránka odstraněna');
    });
    assert(!(await getPages()).some((p) => p.slug === QA_PAGE_UI), 'page still in API after UI delete');
    qaPageSlugs.delete(QA_PAGE_UI);
  });

  await check('D4: dependency-blocked delete stays visible in the UI with an explanatory error', async () => {
    const cat = (await getCatsAdmin(token)).find((c) => c.name === QA_CAT_CONTENT);
    await gotoAdmin(page, token);
    await waitMenuTables(page);
    const row = page.locator('#menuCategoriesTable tbody tr', { hasText: QA_CAT_CONTENT });
    await row.locator('button', { hasText: 'Smazat' }).click();
    await waitFor(page, () => !document.getElementById('confirmModalOverlay')?.classList.contains('hidden'));
    await page.click('#confirmDeleteBtn');
    await waitFor(page, () => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('nelze smazat');
    });
    // item still present and content untouched
    assert((await getCatsAdmin(token)).some((c) => c.id === cat.id), 'protected category deleted via UI');
    const allTexts = await getTextsAdmin(token);
    assert(allTexts.find((t) => t.title === QA_TEXT_TITLE), 'text disappeared after blocked delete');
  });

  // ── E. Public navigation after deletion ───────────────────
  await check('E1: deleted page link disappears from the public navigation (no dead links)', async () => {
    await createPage(token, { title: `${MARK} Nav page`, slug: QA_PAGE_NAV, is_visible: 1 });
    qaPageSlugs.add(QA_PAGE_NAV);
    // page shows up in the appended nav
    await pubPage.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(pubPage);
    await waitFor(pubPage, (slug) => !!document.querySelector(`#desktopNav a[href="/${slug}"]`), QA_PAGE_NAV);
    // delete it via API as the admin would after completing this flow
    const r = await apiDelete(`/api/pages/${QA_PAGE_NAV}`, token);
    assert(r.status === 200, 'nav test page delete failed');
    qaPageSlugs.delete(QA_PAGE_NAV);
    // after the next sync, the stale appended link must be gone (desktop + mobile)
    await pubPage.goto(`${BASE}/`, { waitUntil: 'load' });
    await waitAppContent(pubPage);
    await waitFor(pubPage, (slug) => {
      return !document.querySelector(`#desktopNav a[href="/${slug}"], #mobileNav a[href="/${slug}"]`);
    }, QA_PAGE_NAV);
    const stillThere = await pubPage.evaluate((slug) => {
      return {
        desktop: !!document.querySelector(`#desktopNav a[href="/${slug}"]`),
        mobile: !!document.querySelector(`#mobileNav a[href="/${slug}"]`),
      };
    }, QA_PAGE_NAV);
    assert(!stillThere.desktop && !stillThere.mobile, `stale nav link remains: ${JSON.stringify(stillThere)}`);
  });

  // ── F. Regression touch points ────────────────────────────
  await check('F1: core state intact — seeds, texts list, pages, categories, gallery, contact', async () => {
    const pub = await getCatsPublic();
    for (const [slug, name] of [['povidky', 'Povídky'], ['knihy', 'Knihy'], ['basne', 'Básně']]) {
      const c = pub.find((x) => x.page_slug === 'texty' && x.slug === slug);
      assert(c && c.name === name, `seeded subcategory ${slug} missing/altered`);
    }
    const pages = await getPages();
    assert(pages.some((p) => p.slug === 'texty') && pages.some((p) => p.slug === 'o-mne'), 'core pages altered');
    const texts = await getTextsAdmin(token);
    assert(Array.isArray(texts), 'texts list broken');
    await fetchJson(`${BASE}/api/gallery/folders`, { headers: auth(token) });
    await fetchJson(`${BASE}/api/settings/public`);
    await fetchJson(`${BASE}/api/friends`);
    await fetchJson(`${BASE}/api/blog`);
    // login round-trip still works after all the account/role handling
    await adminLogin();
  });
} finally {
  await browser.close();
  await pubContext.close();

  // ── Cleanup: remove only QA records, retrying to satisfy dependency order ──
  try {
    if (token) {
      token = await adminLogin();

      const del = async (url) => {
        const r = await fetch(`${BASE}${url}`, { method: 'DELETE', headers: auth(token) });
        return r.status;
      };

      // 1) QA texts first (they block category deletion)
      for (const id of qaTextIds) await del(`/api/texts/${id}`).catch(() => {});
      const allTexts = await getTextsAdmin(token).catch(() => []);
      for (const t of allTexts) {
        if (t.title && t.title.includes(MARK)) await del(`/api/texts/${t.id}`).catch(() => {});
      }

      // 2) QA categories that hang under QA pages (children block page deletion)
      for (const cid of [...qaCatIds]) await del(`/api/categories/${cid}`).catch(() => {});

      // 3) QA pages (their reference categories/children are gone by now)
      for (const slug of [...qaPageSlugs]) await del(`/api/pages/${encodeURIComponent(slug)}`).catch(() => {});

      // 4) any remaining QA categories (now unblocked)
      const cats = await getCatsAdmin(token).catch(() => []);
      for (const c of cats) {
        if (c.name && c.name.includes(MARK)) {
          const r = await del(`/api/categories/${c.id}`);
          qaCatIds.delete(c.id);
          if (r !== 409) continue;
          // a page still references it — drop that QA page first, then retry
          const pages = await getPages().catch(() => []);
          for (const p of pages) {
            if (p.slug.startsWith('qa-del-') && p.category_id === c.id) {
              await del(`/api/pages/${encodeURIComponent(p.slug)}`).catch(() => {});
            }
          }
          await del(`/api/categories/${c.id}`).catch(() => {});
        }
      }

      // 5) QA friend
      for (const id of qaFriendIds) await fetch(`${BASE}/api/friends/${id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});

      // ── Verify restoration: no drift vs the snapshot ──
      const pagesNow = await getPages();
      const slugsNow = pagesNow.map((p) => p.slug).sort();
      const slugsOrig = originalPages.map((p) => p.slug).sort();
      const okSlugs = JSON.stringify(slugsNow) === JSON.stringify(slugsOrig);
      const catsNow = await getCatsAdmin(token);
      const markLeft = [...catsNow, ...(await getTextsAdmin(token).catch(() => []))].some((x) => JSON.stringify(x).includes(MARK));
      const okCats = catsNow.length === originalCats.length && catsNow.every((c) =>
        originalCats.some((o) => o.id === c.id && o.name === c.name && o.is_visible === c.is_visible && o.sort_order === c.sort_order &&
          o.slug === c.slug && o.page_slug === c.page_slug)
      );
      if (okSlugs && okCats && !markLeft) {
        console.log('Restored original state: OK');
      } else {
        console.log(`RESTORE ISSUE: slugs ${okSlugs ? 'OK' : 'MISMATCH'}; cats ${okCats ? 'OK' : 'MISMATCH'}; leftover QA ${markLeft}`);
      }
    } else {
      console.log('WARNING: no token, could not clean up QA records — manual restore required');
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