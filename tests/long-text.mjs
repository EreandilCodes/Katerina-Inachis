// E2E tests for very long literary texts ("Povídky" category).
//
// Motivation: Express's default 100kb JSON body limit rejected a real ~26-page
// story, and the catch-all error handler masked it as a generic 500. The fix
// gives the /api/texts router a 30mb body cap for Povídky content while every
// other payload keeps the old limit. This suite proves a ~26-page story saves
// intact, that non-Povídky large bodies are still rejected, that a normal
// amount of content elsewhere still works, and that the admin UI round-trips
// the full text.
//
// Run locally:   npm run test:longtext
// Against prod:  TEST_BASE_URL=https://www.katerina-inachis.cz npm run test:longtext
//
// Env:
//   ADMIN_EMAIL / ADMIN_PASSWORD   admin credentials (optional, has defaults)
//   TEST_SERVER_RESTART_CMD        shell command that restarts the local server;
//                                  enables the restart-persistence check
//
// Safety: every created record is deleted in a finally block and the only page
// intro touched is snapshotted and restored, so this is safe against
// production. Test values are prefixed with [QA-LONGTEXT].

import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const LOCAL = BASE.includes('localhost') || BASE.includes('127.0.0.1');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const RESTART_CMD = process.env.TEST_SERVER_RESTART_CMD || '';

const MARK = `[QA-LONGTEXT-${Date.now().toString(36)}]`;
const PAGES = 26;          // a ~26-page story
const PAGE_CHARS = 5200;   // conservative chars per page
const TARGET_CHARS = PAGES * PAGE_CHARS; // ~135 200 chars → >100kb JSON body

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

async function http(url, options = {}) {
  const res = await fetch(url, options);
  const ct = res.headers.get('content-type');
  let body;
  try {
    body = ct && ct.includes('application/json') ? await res.json() : await res.text();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

async function fetchJson(url, options = {}) {
  const { status, body } = await http(url, options);
  if (status < 200 || status >= 300) {
    const detail = typeof body === 'object' ? JSON.stringify(body) : String(body).slice(0, 200);
    throw new Error(`HTTP ${status}: ${detail}`);
  }
  return body;
}

async function adminLogin() {
  const { body } = await http(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  return body.token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function adminOpenTexts(page) {
  await page.locator('[data-section="texts"]').first().click();
  // Retry: a click that lands before the controller binds listeners is a no-op.
  for (let i = 0; i < 3; i++) {
    try {
      await page.waitForSelector('#textsSection .section-header button', { state: 'visible', timeout: 8000 });
      return;
    } catch {
      await page.locator('[data-section="texts"]').first().click();
    }
  }
  throw new Error('admin texts section did not render');
}

// ── Deterministic ~26-page story ─────────────────────────────────────────

function sentence(i) {
  return `Odstavec číslo ${i + 1}. Vyprávění pokračuje o místě, kde se potkávají ti, kdo hledají dávný, téměř zapomenutý příběh plný ticha, hvězd a podzimního listí. Tolikrát se řeklo „správně“ a přesto — cesta vedla dál.`;
}

function buildContent(end = 'KONEC') {
  const paras = [];
  let total = 0;
  let i = 0;
  while (total < TARGET_CHARS) {
    const p = `<p>${sentence(i)}</p>`;
    paras.push(p);
    total += p.length;
    i++;
  }
  const mid = Math.floor(paras.length / 2);
  paras[0] = `<p>${MARK} START: ${sentence(0)} Tady příběh začíná.</p>`;
  paras[mid] = `<p>${MARK} STŘED: ${sentence(mid)} Tady přichází hlavní zvrat.</p>`;
  paras[paras.length - 1] = `<p>${MARK} ${end}: ${sentence(paras.length - 1)} Úplný konec příběhu „s tečkou“. — Hotovo.</p>`;
  return paras.join('');
}

async function longStoryPayload(category, content, title, token) {
  const payload = {
    title,
    excerpt: '',
    content,
    cover_image: '',
    category,
    sort_order: 0,
    is_featured: 0,
    is_published: 1,
    published_at: new Date().toISOString(),
    title_en: '',
    excerpt_en: '',
    content_en: '',
  };
  return JSON.stringify(payload);
}

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

const browser = await chromium.launch(launchOpts);
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(15000);

const markers = { start: `${MARK} START:`, middle: `${MARK} STŘED:`, end: `${MARK} KONEC:` };
const contentA = buildContent('KONEC');
const contentB = buildContent('EPILOG');
const bodyA = await longStoryPayload('Povídky', contentA, `${MARK} Dlouhá povídka`, null);

const parasA = (contentA.match(/<p>/g) || []).length;
console.log(`Long story: ${PAGES} pages × ${PAGE_CHARS} chars ≈ ${contentA.length.toLocaleString('cs-CZ')} chars, JSON body ${(Buffer.byteLength(bodyA) / 1024).toFixed(0)} KiB (must be >100 KiB to reproduce the bug)`);

let token = null;
const createdTextIds = [];
let blogPostId = null;
let originalTextyIntro = null;

try {
  // Make sure we restore the page intro we touch.
  originalTextyIntro = (await fetchJson(`${BASE}/api/pages`)).find((p) => p.slug === 'texty')?.intro_text || '';

  token = await adminLogin();

  // ── A. Save a ~26-page Povídky story via API ──────────────────
  await check('A1: POST 26-page Povídky story returns 201 and stores it', async () => {
    const r = await http(`${BASE}/api/texts`, {
      method: 'POST',
      headers: authHeaders(token),
      body: bodyA,
    });
    assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`);
    assert(Buffer.byteLength(bodyA) > 101 * 1024, `body ${Buffer.byteLength(bodyA)} bytes is not above the old 100 KiB limit`);
    createdTextIds.push(r.body.item.id);
  });

  await check('A2: stored content is byte-identical, no truncation (admin readback)', async () => {
    const all = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) });
    const item = all.find((t) => t.id === createdTextIds[0]);
    assert(item, 'story not found in admin list');
    assert(item.category === 'Povídky', `category "${item.category}"`);
    assert(item.title === `${MARK} Dlouhá povídka`, `title mismatch: "${item.title}"`);
    assert(item.content === contentA, 'stored content differs from submitted (length/bytes)');
  });

  await check('A3: start/middle/end markers in correct order, exact slices', async () => {
    const all = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) });
    const item = all.find((t) => t.id === createdTextIds[0]);
    const c = item.content;
    const s = c.indexOf(markers.start);
    assert(s !== -1, 'missing START marker');
    const m = c.indexOf(markers.middle);
    assert(m !== -1, 'missing STŘED marker');
    const e = c.indexOf(markers.end);
    assert(e !== -1, 'missing KONEC marker');
    assert(s < m && m < e, `order broken: ${s} < ${m} < ${e}`);
    assert(c.slice(s, s + markers.start.length) === markers.start, 'START slice mismatch');
    assert(c.slice(m, m + markers.middle.length) === markers.middle, 'STŘED slice mismatch');
    assert(c.slice(e, e + markers.end.length) === markers.end, 'KONEC slice mismatch');
  });

  await check('A4: paragraph count and Czech/Unicode characters intact', async () => {
    const all = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) });
    const item = all.find((t) => t.id === createdTextIds[0]);
    const storedParas = (item.content.match(/<p>/g) || []).length;
    assert(storedParas === parasA, `paragraph count ${storedParas} != ${parasA}`);
    assert(item.content.length === contentA.length, `length ${item.content.length} != ${contentA.length}`);
    assert(item.content.includes('řeklo „správně“'), 'missing Czech quotes „…“');
    assert(item.content.includes('—'), 'missing em dash');
    assert(item.content.includes('č'), 'missing Czech diacritics');
  });

  // ── B. Public readback ─────────────────────────────────────────
  await check('B1: public GET /api/texts/:slug returns the full, exact story', async () => {
    const all = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) });
    const item = all.find((t) => t.id === createdTextIds[0]);
    const pub = await fetchJson(`${BASE}/api/texts/${encodeURIComponent(item.slug)}`);
    assert(pub.content === contentA, 'public content differs from submitted');
    assert(pub.category === 'Povídky', `public category "${pub.category}"`);
  });

  await check('B2: public list includes the long story', async () => {
    const all = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) });
    const item = all.find((t) => t.id === createdTextIds[0]);
    const list = await fetchJson(`${BASE}/api/texts`);
    assert(list.some((l) => l.slug === item.slug), 'slug missing from public list');
  });

  // ── C. Update a long story ─────────────────────────────────────
  await check('C1: PUT a second long content on the same story, exact round-trip', async () => {
    const id = createdTextIds[0];
    const bodyB = await longStoryPayload('Povídky', contentB, `${MARK} Dlouhá povídka druhá`, token);
    const r = await http(`${BASE}/api/texts/${id}`, { method: 'PUT', headers: authHeaders(token), body: bodyB });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body.item.content === contentB, 'updated content differs after PUT');
    assert(Buffer.byteLength(bodyB) > 101 * 1024, 'updated body no longer above 100 KiB');
    const again = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) });
    const item = again.find((t) => t.id === id);
    assert(item.content === contentB, 'admin readback after PUT differs');
    assert(item.title === `${MARK} Dlouhá povídka druhá`, 'title update not saved');
  });

  // ── D. Non-Povídky large bodies must still be rejected ─────────
  for (const category of ['Knihy', 'Básně', '']) {
    await check(`D1: large ${category || '(empty category)'} body is rejected with a real 413`, async () => {
      const title = `${MARK} Reject test ${category || 'empty'}`;
      const payload = await longStoryPayload(category, contentA, title, token);
      const r = await http(`${BASE}/api/texts`, { method: 'POST', headers: authHeaders(token), body: payload });
      assert(r.status === 413, `expected 413, got ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`);
      assert(String(r.body.error) === 'Požadavek je příliš velký', `message "${r.body.error}"`);
      const all = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) });
      assert(!all.some((t) => t.title === title), `${category} oversized text was saved!`);
    });
  }

  await check('D2: non-texts route (pages intro) still enforces 100 KiB via the global parser', async () => {
    const big = `<p>${sentence(0)}</p>`.repeat(Math.ceil(TARGET_CHARS / sentence(0).length + 3));
    const r = await http(`${BASE}/api/pages/texty`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ intro_text: big }),
    });
    assert(r.status === 413, `expected 413, got ${r.status}`);
    assert(String(r.body.error) === 'Požadavek je příliš velký', `message "${r.body.error}"`);
    const intro = (await fetchJson(`${BASE}/api/pages`)).find((p) => p.slug === 'texty')?.intro_text || '';
    assert(intro === originalTextyIntro, 'page intro was modified by a rejected oversized request');
  });

  // ── E. Normal content everywhere still works ───────────────────
  await check('E1: small texts still save in all categories, including Povídky', async () => {
    for (const category of ['Povídky', 'Knihy', 'Básně']) {
      const small = `<p>${MARK} Krátký text kategorie ${category}.</p>`;
      const payload = await longStoryPayload(category, small, `${MARK} Malý ${category}`, token);
      const r = await http(`${BASE}/api/texts`, { method: 'POST', headers: authHeaders(token), body: payload });
      assert(r.status === 201, `${category}: expected 201, got ${r.status}`);
      createdTextIds.push(r.body.item.id);
    }
  });

  await check('E2: blog posts are unaffected (normal-size create + public readback)', async () => {
    const title = `${MARK} Blogový příspěvek`;
    const r = await http(`${BASE}/api/blog`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title, content: `<p>${MARK} Obsah blogu.</p>`, excerpt: '', is_published: 1, is_featured: 0, cover_image: '', sort_order: 0 }),
    });
    assert(r.status === 201, `expected 201, got ${r.status}`);
    blogPostId = r.body.item.id;
    const pub = await fetchJson(`${BASE}/api/blog/${encodeURIComponent(r.body.item.slug)}`);
    assert(pub.title === title, 'blog title mismatch on public readback');
  });

  await check('E3: small page-intro PUT still works (exact round-trip)', async () => {
    const val = `${MARK} Úvodní věta pro test.`;
    const r = await http(`${BASE}/api/pages/texty`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ intro_text: val }),
    });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const intro = (await fetchJson(`${BASE}/api/pages`)).find((p) => p.slug === 'texty')?.intro_text || '';
    assert(intro === val, `intro "${intro}" != "${val}"`);
  });

  await check('E4: public APIs (settings, pages list) still healthy', async () => {
    const s = await http(`${BASE}/api/settings/public`);
    assert(s.status === 200 && s.body && typeof s.body === 'object' && !Array.isArray(s.body) && !s.body.error, `settings/public: ${s.status}`);
    const p = await http(`${BASE}/api/pages`);
    assert(p.status === 200 && Array.isArray(p.body), `pages: ${p.status}`);
  });

  if (LOCAL) {
    await check('E5: contact form body is not wrongly limited (real validation runs, not 413)', async () => {
      const r = await http(`${BASE}/api/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'QA Test', email: 'qa@example.com', message: `${MARK} kontaktní zpráva` }),
      });
      assert(r.status !== 413, 'contact form hit the 413 body limit');
      assert(r.status === 400 || r.status === 422 || r.status === 503, `unexpected status ${r.status}`);
    });
  }

  // ── F. Admin UI round-trip of a long story ─────────────────────
  await check('F1: admin UI saves a 26-page Povídky via the HTML tab and shows it on reopen', async () => {
    const title = `${MARK} Povídka přes UI`;
    const uiContent = buildContent('UI-KONEC');

    await page.goto(`${BASE}/login`, { waitUntil: 'load' });
    await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
    await page.goto(`${BASE}/admin`, { waitUntil: 'load' });

    await page.waitForFunction(() => {
      const t = document.getElementById('adminPageTitle');
      return t && t.textContent.trim() === 'Přehled';
    }, null, { timeout: 15000 });

    await adminOpenTexts(page);
    await page.click('#textsSection .section-header button:has-text("Přidat text")');
    await page.waitForSelector('#textsModalOverlay:not(.hidden)');

    await page.fill('#textsForm input[name="title"]', title);
    await page.selectOption('#textsForm select[name="category"]', 'Povídky');

    // Switch the content editor to the HTML tab and paste the long story source.
    await page.evaluate((html) => {
      const ta = document.querySelector('#textsForm textarea[name="content"]');
      const wrapper = ta.nextElementSibling;
      wrapper.querySelectorAll('.rte-tab')[1].click(); // HTML tab → getValue() reads .rte-source
      wrapper.querySelector('.rte-source').value = html;
      ta.value = html;
    }, uiContent);

    await page.click('#textsForm button[type="submit"]');
    await page.waitForFunction(() => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('Text vytvořen');
    }, null, { timeout: 15000 });

    // API readback must match exactly.
    const all = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) });
    const saved = all.find((t) => t.title === title);
    assert(saved, 'UI-created story missing from admin list');
    assert(saved.content === uiContent, 'stored content differs from what the HTML tab submitted');
    assert(saved.category === 'Povídky', `category "${saved.category}"`);
    createdTextIds.push(saved.id);

    // Reopen → the editor must show the full text again.
    await page.click(`#textsTableBody tr:has-text("${title}") button:has-text("Upravit")`);
    await page.waitForSelector('#textsModalOverlay:not(.hidden)');
    const editorVal = await page.evaluate(() => {
      const ta = document.querySelector('#textsForm textarea[name="content"]');
      const wrapper = ta.nextElementSibling;
      wrapper.querySelectorAll('.rte-tab')[1].click();
      return wrapper.querySelector('.rte-source').value;
    });
    assert(editorVal === uiContent, 'editor reopened with different content (truncated?)');
    await page.click('#textsModalOverlay button:has-text("Zrušit")');

    // Delete via the UI and confirm it is gone.
    page.once('dialog', (d) => d.accept());
    await page.click(`#textsTableBody tr:has-text("${title}") button:has-text("Smazat")`);
    await page.waitForFunction(() => {
      const t = document.getElementById('adminToast');
      return t && t.textContent.includes('Text smazán');
    }, null, { timeout: 15000 });
    const after = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) });
    assert(!after.some((t) => t.title === title), 'UI-deleted story still present');
  });

  // ── G. Restart persistence (local only) ────────────────────────
  if (RESTART_CMD) {
    await check('G1: a long Povídky story survives a server restart byte-for-byte', async () => {
      const title = `${MARK} Přežije restart`;
      const payload = await longStoryPayload('Povídky', contentA, title, token);
      const r = await http(`${BASE}/api/texts`, { method: 'POST', headers: authHeaders(token), body: payload });
      assert(r.status === 201, `expected 201, got ${r.status}`);
      createdTextIds.push(r.body.item.id);

      const { execSync } = await import('node:child_process');
      execSync(RESTART_CMD, { stdio: 'inherit', shell: true });

      let up = false;
      for (let i = 0; i < 40 && !up; i++) {
        await sleep(500);
        try {
          const p = await http(`${BASE}/api/pages`);
          up = p.status === 200;
        } catch { /* not up yet */ }
      }
      assert(up, 'server did not come back after restart');

      token = await adminLogin();
      const all = await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) });
      const item = all.find((t) => t.id === r.body.item.id);
      assert(item, 'story missing after restart');
      assert(item.content === contentA, 'content corrupted/truncated after restart');
      assert(item.title === title, 'title changed after restart');
    });
  } else {
    console.log('SKIP  G1 — set TEST_SERVER_RESTART_CMD to test restart persistence');
  }
} finally {
  await browser.close();

  // ── Restore everything, whatever happened ──────────────────────
  try {
    if (token) {
      for (const id of createdTextIds) {
        try {
          await http(`${BASE}/api/texts/${id}`, { method: 'DELETE', headers: authHeaders(token) });
        } catch { /* already gone */ }
      }
      if (blogPostId) {
        try {
          await http(`${BASE}/api/blog/${blogPostId}`, { method: 'DELETE', headers: authHeaders(token) });
        } catch { /* already gone */ }
      }
      if (originalTextyIntro !== null) {
        await http(`${BASE}/api/pages/texty`, {
          method: 'PUT',
          headers: authHeaders(token),
          body: JSON.stringify({ intro_text: originalTextyIntro }),
        });
        const intro = (await fetchJson(`${BASE}/api/pages`)).find((p) => p.slug === 'texty')?.intro_text || '';
        if (intro === originalTextyIntro) console.log('Restored original texty intro: OK');
        else console.log(`RESTORE FAILED: texty intro = "${intro}"`);
      }
      const orphans = (await fetchJson(`${BASE}/api/texts/admin/all`, { headers: authHeaders(token) })).filter((t) => t.title.includes(MARK));
      if (orphans.length) console.log(`RESTORE WARNING: ${orphans.length} leftover QA texts (ids ${orphans.map((o) => o.id).join(',')})`);
      else console.log('Restored texts/blog: OK');
    } else {
      console.log('WARNING: no token, could not clean up QA data');
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