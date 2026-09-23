// E2E tests for admin "Stránky" page intros.
//
// Run locally:   npm run test:intros
// Against prod:  TEST_BASE_URL=https://www.katerina-inachis.cz npm run test:intros
//
// Env:
//   ADMIN_EMAIL / ADMIN_PASSWORD   admin credentials (optional, has defaults)
//   TEST_SERVER_RESTART_CMD        shell command that restarts the local server;
//                                  enables the restart-persistence check. Omit
//                                  in production (deploy persistence is verified
//                                  via Railway separately).
//
// Safety: the suite snapshots every page's original intro_text at startup and
// restores all of them in a finally block, so it is safe to run against
// production. Test values are prefixed with [QA-TEST].

import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const RESTART_CMD = process.env.TEST_SERVER_RESTART_CMD || '';

const SLUGS = ['texty', 'kresba', 'blog', 'programovani', 'pratele', 'o-mne', 'kontakt'];
const MARK = '[QA-TEST]';

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

async function getPages() {
  return fetchJson(`${BASE}/api/pages`);
}

async function getIntro(slug) {
  const pages = await getPages();
  const p = pages.find((x) => x.slug === slug);
  return p ? p.intro_text || '' : '';
}

async function putIntro(slug, intro, token) {
  await fetchJson(`${BASE}/api/pages/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intro_text: intro }),
  });
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

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
  await page.waitForSelector('#app h1', { state: 'visible', timeout: 8000 });
}

async function waitAdminReady(page) {
  // Wait until the AdminController finished init (overview rendered, nav listeners
  // bound) so a click on [data-section] is guaranteed to be handled.
  await page.waitForFunction(
    () => {
      const title = document.getElementById('adminPageTitle');
      return title && title.textContent.trim() === 'Přehled';
    },
    null,
    { timeout: 15000 }
  );
}

async function adminOpenPages(page) {
  await waitAdminReady(page);
  await page.locator('[data-section="pages"]').first().click();
  // Retry: a click that lands before the controller binds listeners is a no-op.
  for (let i = 0; i < 3; i++) {
    try {
      await page.waitForSelector('#pagesForm textarea', { state: 'visible', timeout: 8000 });
      return;
    } catch {
      await page.locator('[data-section="pages"]').first().click();
    }
  }
  throw new Error('admin pages section did not render its textareas');
}

async function publicIntroState(page, slug) {
  const intro = await getIntro(slug);
  const state = await page.evaluate(() => {
    const h1 = document.querySelector('#app .section-title');
    const introEl = document.querySelector('#app .page-intro');
    const content = document.querySelector('#app .content-grid, #app .jewelry-grid, #app .friend-grid, #app .empty-state');
    return {
      h1Text: h1 ? h1.textContent.trim() : null,
      introText: introEl ? introEl.textContent : null,
      introInHeader: !!introEl && !!introEl.closest('.section-header'),
      orderOk: !content ? null :
        !!h1 && !!introEl && !!introEl.closest('.section-header') &&
        (h1.compareDocumentPosition(introEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
        (introEl.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      hasContent: !!content,
      contentClass: content ? content.className : null,
    };
  });
  return { ...state, intro, normIntroText: intro ? norm(intro) : '' };
}

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

const browser = await chromium.launch(launchOpts);
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(15000);

// Verify server is reachable before doing anything destructive.
await fetchJson(`${BASE}/api/pages`);

// Snapshot originals so tests are restorable against any environment.

const original = {};
for (const slug of SLUGS) original[slug] = await getIntro(slug);
console.log(`Snapshot: ${SLUGS.length} pages (e.g. texty="${original.texty}")`);

let token = null;
try {
  token = await adminLogin();

  // ── A. Save via API → persists exactly, all slugs ──────────────
  await check('A1: save intro for all 7 slugs via API and verify each persists', async () => {
    for (const [i, slug] of SLUGS.entries()) {
      const val = `${MARK} intro ${i} for ${slug}`;
      await putIntro(slug, val, token);
      const got = await getIntro(slug);
      assert(got === val, `${slug}: expected "${val}" got "${got}"`);
    }
  });

  await check('A2: exact round-trip with diacritics and newlines', async () => {
    const val = `Úvodní věta.\nDruhý řádek: čeština, interpunkce — a znaky „uvozovky". ${MARK}fi`;
    await putIntro('texty', val, token);
    const got = await getIntro('texty');
    assert(got === val, `expected exact string, got ${JSON.stringify(got)}`);
  });

  // ── B. Admin UI: form submit + refresh persistence ─────────────
  await check('B1: admin UI saves via the form and value survives a full reload', async () => {
    const val = `${MARK} UI-saved intro`;
    // Land on /login first, then inject the token and go to /admin — avoids the
    // unauthenticated redirect race entirely.
    await page.goto(`${BASE}/login`, { waitUntil: 'load' });
    await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
    await page.goto(`${BASE}/admin`, { waitUntil: 'load' });

    await adminOpenPages(page);
    await page.fill('#page_kontakt', val);
    await page.click('#pagesForm button[type="submit"]');
    await waitFor(page, () => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('uložen');
    });

    const viaApi = await getIntro('kontakt');
    assert(viaApi === val, `API readback "${viaApi}" != "${val}"`);

    await page.reload({ waitUntil: 'load' });
    await adminOpenPages(page);
    const uiVal = await page.inputValue('#page_kontakt');
    assert(uiVal === val, `UI after reload "${uiVal}" != "${val}"`);
  });

  // ── C. Auth cycle: logout, re-login via UI, value persists ─────
  await check('C1: after clear-token + UI login the saved value still shows', async () => {
    const val = `${MARK} after re-login`;
    await putIntro('blog', val, token);
    await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
    await waitAdminReady(page);
    await page.evaluate(() => localStorage.removeItem('inachis_token'));
    await page.goto(`${BASE}/login`, { waitUntil: 'load' });

    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    const nav = page.waitForURL(/\/admin/, { timeout: 15000 });
    await page.click('#loginBtn');
    await nav;

    await adminOpenPages(page);
    const uiVal = await page.inputValue('#page_blog');
    assert(uiVal === val, `UI shows "${uiVal}" after re-login, expected "${val}"`);
    assert((await getIntro('blog')) === val, 'API disagrees after re-login');
  });

  // ── D. Public rendering: title → intro → content/empty-state ───
  await check('D1: public page renders saved intro under the title, above content', async () => {
    const val = `Vítejte u mých textů.\nNávštěvníci si zaslouží pěkný úvod. ${MARK}D1`;
    await putIntro('texty', val, token);
    await page.goto(`${BASE}/texty`, { waitUntil: 'load' });
    await waitAppContent(page);

    const s = await publicIntroState(page, 'texty');
    assert(!!s.h1Text, 'missing .section-title heading');
    assert(!!s.introInHeader, 'page-intro should be inside .section-header');
    assert(norm(s.introText) === s.normIntroText, `intro mismatch: "${s.introText}" vs "${val}"`);
    assert(s.orderOk === true, `order title→intro→content not satisfied`);
    assert(s.hasContent, 'content region (.grid or .empty-state) should be present after the intro');
  });

  await check('D2: empty intro renders no .page-intro block (but page still shows a title)', async () => {
    await putIntro('kresba', '', token);
    await page.goto(`${BASE}/kresba`, { waitUntil: 'load' });
    await waitAppContent(page);
    const state = await page.evaluate(() => ({
      h1: !!document.querySelector('#app .section-title'),
      intro: !!document.querySelector('#app .page-intro'),
      content: !!document.querySelector('#app .content-grid, #app .jewelry-grid, #app .friend-grid, #app .empty-state'),
    }));
    assert(state.h1, 'missing title heading');
    assert(!state.intro, 'unexpected .page-intro for empty intro');
    assert(state.content, 'content region should still render');
  });

  // ── E. Isolation between pages ─────────────────────────────────
  await check('E1: page intros are independent (texty vs o-mne)', async () => {
    await putIntro('texty', `${MARK} E-texty`, token);
    await putIntro('o-mne', `${MARK} E-o-mne`, token);

    await page.goto(`${BASE}/texty`, { waitUntil: 'load' });
    await waitAppContent(page);
    const t1 = await publicIntroState(page, 'texty');
    assert((t1.introText || '').includes('[QA-TEST] E-texty'), 'texty page should show its own intro');

    await page.goto(`${BASE}/o-mne`, { waitUntil: 'load' });
    await waitAppContent(page);
    const o1 = await publicIntroState(page, 'o-mne');
    assert((o1.introText || '').includes('[QA-TEST] E-o-mne'), 'o-mne page should show its own intro');

    // Re-saving texty must not touch o-mne
    await putIntro('texty', `${MARK} E-texty-updated`, token);
    const oStill = await getIntro('o-mne');
    assert(oStill === `${MARK} E-o-mne`, `o-mne changed to "${oStill}" after only texty was saved`);
  });

  // ── F. Server restart persistence (local only) ─────────────────
  if (RESTART_CMD) {
    await check('F1: intros survive a server restart', async () => {
      const val = `${MARK} survives-restart`;
      await putIntro('pratele', val, token);

      const { execSync } = await import('node:child_process');
      execSync(RESTART_CMD, { stdio: 'inherit', shell: true });

      // Wait for the server to come back up.
      let up = false;
      for (let i = 0; i < 40 && !up; i++) {
        await sleep(500);
        try {
          await getPages();
          up = true;
        } catch { /* not up yet */ }
      }
      assert(up, 'server did not come back after restart');

      token = await adminLogin();
      const got = await getIntro('pratele');
      assert(got === val, `intro after restart "${got}" != "${val}"`);
    });
  } else {
    console.log('SKIP  F1 — set TEST_SERVER_RESTART_CMD to test restart persistence');
  }
} finally {
  await browser.close();

  // ── Restore original intros exactly, whatever happened ─────────
  try {
    if (token) {
      for (const slug of SLUGS) {
        await putIntro(slug, original[slug], token);
      }
      const mismatches = [];
      for (const slug of SLUGS) {
        const got = await getIntro(slug);
        if (got !== original[slug]) mismatches.push(`${slug}:"${got}" != "${original[slug]}"`);
      }
      if (mismatches.length) {
        console.log(`RESTORE FAILED: ${mismatches.join('; ')}`);
      } else {
        console.log('Restored all original page intros: OK');
      }
    } else {
      console.log('WARNING: no token, could not restore intros — manual restore required');
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