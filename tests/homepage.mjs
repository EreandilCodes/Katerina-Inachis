// E2E tests for the homepage "newest content" horizontal tile rows.
//
// Run locally:   npm run test:homepage
//
// Env:
//   ADMIN_EMAIL / ADMIN_PASSWORD   admin credentials (optional, has defaults)
//   INACHIS_TEST_CHROME            path to a chromium binary (optional)
//
// Safety: creates its own [QA-HOME] items (unique slugs `qa-home-<ts>-*`) and
// deletes them in a finally block, so it runs safely against any environment.
// The suite seeds 5 items per section to prove the "newest 4" cut-off, leaves
// two sections empty to prove empty sections do not break the homepage, and
// asserts the remaining homepage structure is untouched.

import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const MARK = '[QA-HOME]';
const TS = String(Date.now());
const SLUG = (kind, n) => `qa-home-${TS}-${kind}${n}`;
const TITLE = (kind, n) => `${MARK} ${kind}${n}`;

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

async function createText(token, n, publishedAt) {
  return fetchJson(`${BASE}/api/texts`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      title: TITLE('T', n),
      slug: SLUG('t', n),
      excerpt: `${MARK} excerpt ${n}`,
      content: `${MARK} content ${n}`,
      category: 'Povídky',
      is_published: 1,
      published_at: publishedAt.toISOString(),
    }),
  });
}

async function createArtwork(token, n) {
  // Artwork list ordering is (sort_order ASC, created_at DESC); caller sleeps
  // between creates so created_at is strictly increasing.
  return fetchJson(`${BASE}/api/artworks`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ title: TITLE('A', n), slug: SLUG('a', n), is_published: 1 }),
  });
}

async function createBlog(token, n, publishedAt) {
  return fetchJson(`${BASE}/api/blog`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      title: TITLE('B', n),
      slug: SLUG('b', n),
      excerpt: `${MARK} excerpt ${n}`,
      content: `${MARK} content ${n}`,
      is_published: 1,
      published_at: publishedAt.toISOString(),
    }),
  });
}

const created = { texts: [], artworks: [], blogs: [] };

// ── Setup: reachability, login, seed [QA-HOME] content ───────────────
await fetchJson(`${BASE}/api/pages`);
const token = await adminLogin();
console.log(`Seeding 5 texts + 5 artworks + 5 blog posts with prefix ${SLUG('t', 1)}..`);

const base = Date.now() - 900000;
for (let n = 1; n <= 5; n++) {
  const t = await createText(token, n, new Date(base + n * 120000));
  created.texts.push(t.id ?? t.item?.id);
  const b = await createBlog(token, n, new Date(base + n * 120000));
  created.blogs.push(b.id ?? b.item?.id);
  await sleep(50);
}

// Artworks order by created_at DESC → create with gaps so it is deterministic.
for (let n = 1; n <= 5; n++) {
  const a = await createArtwork(token, n);
  created.artworks.push(a.id ?? a.item?.id);
  await sleep(1150);
}

// Live API orderings used for assertions (source of truth at run time).
const [liveTexts, liveArtworks, liveBlog] = await Promise.all([
  fetchJson(`${BASE}/api/texts`),
  fetchJson(`${BASE}/api/artworks`),
  fetchJson(`${BASE}/api/blog`),
]);

const MARK_P = `${MARK} `;
const oursTexts = liveTexts.filter((x) => x.title && x.title.startsWith(MARK_P));
const oursArt = liveArtworks.filter((x) => x.title && x.title.startsWith(MARK_P));
const oursBlog = liveBlog.filter((x) => x.title && x.title.startsWith(MARK_P));
const expectedTexts = oursTexts.slice(0, 4);
const expectedArt = oursArt.slice(0, 4);
const expectedBlog = oursBlog.slice(0, 4);

console.log(
  `Expected text tiles: ${expectedTexts.map((x) => x.title).join(' | ')}\n` +
  `Expected art tiles:  ${expectedArt.map((x) => x.title).join(' | ')}\n` +
  `Expected blog tiles: ${expectedBlog.map((x) => x.title).join(' | ')}`
);

// ── Browser ───────────────────────────────────────────────────────────
const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

const browser = await chromium.launch(launchOpts);
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(20000);

async function waitHome() {
  await page.waitForFunction(
    () => {
      const app = document.getElementById('app');
      if (!app) return false;
      const html = app.innerHTML.trim();
      return html !== '' && !app.querySelector('.loading-state');
    },
    null,
    { timeout: 20000 }
  );
  await page.waitForSelector('#hero', { state: 'visible', timeout: 10000 });
}

async function sectionCards(sectionId) {
  return page.evaluate((sid) => {
    const section = document.getElementById(sid);
    if (!section) return null;
    const row = section.querySelector('.scroll-row');
    if (!row) return null;
    return {
      count: row.children.length,
      texts: Array.from(row.children).map((c) => (c.textContent || '').trim()),
      overflowX: getComputedStyle(row).overflowX,
      hasScroll: row.scrollWidth > row.clientWidth + 1,
    };
  }, sectionId);
}

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('inachis_lang', 'cs'));
  await page.reload({ waitUntil: 'networkidle' });
  await waitHome();

  // ── A. Text section: newest-4, correct order, oldest excluded ───────
  await check('texts section shows newest 4 of 5', async () => {
    const data = await sectionCards('section-texts');
    assert(data, 'texts section or .scroll-row missing');
    assert(data.count === 4, `expected 4 tiles, got ${data.count}`);
    assert(data.overflowX === 'auto', `scroll row should overflow-x auto, got ${data.overflowX}`);
    assert(data.hasScroll, 'scroll row should be horizontally scrollable on desktop');
    for (const t of expectedTexts) {
      assert(data.texts.some((tc) => tc.includes(t.title)), `tile missing: ${t.title}`);
    }
    const oldest = oursTexts[oursTexts.length - 1].title;
    assert(!data.texts.some((tc) => tc.includes(oldest)), `oldest tile should be cut off: ${oldest}`);
    // Newest first within the section.
    assert(data.texts[0].includes(expectedTexts[0].title), `first tile should be ${expectedTexts[0].title}`);
  });

  // ── B. Blog section ─────────────────────────────────────────────────
  await check('blog section shows newest 4 of 5', async () => {
    const data = await sectionCards('section-blog');
    assert(data, 'blog section or .scroll-row missing');
    assert(data.count === 4, `expected 4 tiles, got ${data.count}`);
    for (const b of expectedBlog) {
      assert(data.texts.some((tc) => tc.includes(b.title)), `tile missing: ${b.title}`);
    }
    const oldest = oursBlog[oursBlog.length - 1].title;
    assert(!data.texts.some((tc) => tc.includes(oldest)), `oldest blog tile should be cut off: ${oldest}`);
    assert(data.texts[0].includes(expectedBlog[0].title), `first blog tile should be ${expectedBlog[0].title}`);
  });

  // ── C. Art section (gallery-item tiles in a scroll row) ──────────────
  await check('artworks section shows newest 4 of 5', async () => {
    const data = await sectionCards('section-art');
    assert(data, 'art section or .scroll-row missing');
    assert(data.count === 4, `expected 4 tiles, got ${data.count}`);
    assert(data.hasScroll, 'art scroll row should be horizontally scrollable');
    for (const a of expectedArt) {
      assert(data.texts.some((tc) => tc.includes(a.title)), `tile missing: ${a.title}`);
    }
    const oldest = oursArt[oursArt.length - 1].title;
    assert(!data.texts.some((tc) => tc.includes(oldest)), `oldest art tile should be cut off: ${oldest}`);
  });

  // ── D. Empty sections must not break the homepage ──────────────────
  await check('empty sections are omitted and homepage intact', async () => {
    const absent = await page.evaluate(() => ({
      drawing: !!document.getElementById('section-drawing'),
      programming: !!document.getElementById('section-programming'),
      friends: !!document.getElementById('section-friends'),
      contact: !!document.getElementById('section-contact'),
      about: !!document.getElementById('section-about'),
      hero: !!document.getElementById('hero'),
      nav: !!document.querySelector('#desktopNav a[href="/texty"]'),
      heroTitle: (document.getElementById('heroTitle') || {}).textContent || '',
    }));
    assert(!absent.drawing, 'empty jewelry section rendered');
    assert(!absent.programming, 'empty programming section rendered');
    assert(absent.contact, 'contact section missing');
    assert(absent.hero, 'hero missing');
    assert(absent.nav, 'nav missing');
    assert(absent.heroTitle.length > 0, 'hero title empty');
  });

  // ── E. Mobile viewport: section scrolls horizontally, page scrolls vertically
  await check('mobile scroll-row works and page scrolls vertically', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    await waitHome();
    const data = await page.evaluate(() => {
      const row = document.querySelector('#section-texts .scroll-row');
      if (!row) return null;
      const cards = Array.from(row.children);
      return {
        hasScroll: row.scrollWidth > row.clientWidth + 1,
        overflowX: getComputedStyle(row).overflowX,
        cardWidth: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
        pageScrolls: document.body.scrollHeight > window.innerHeight,
      };
    });
    assert(data, 'texts scroll-row missing on mobile');
    assert(data.hasScroll, 'scroll row should be scrollable on mobile');
    assert(data.overflowX === 'auto', `overflow should be auto, got ${data.overflowX}`);
    assert(data.cardWidth > 0 && data.cardWidth < 390, `card width ${data.cardWidth} should be < viewport (scroll affordance)`);
    assert(data.pageScrolls, 'page should still scroll vertically');
  });

  // ── F. Restore desktop viewport & re-verify a round-trip nav still works ──
  await check('navigation from homepage still works after changes', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.evaluate(() => localStorage.setItem('inachis_lang', 'cs'));
    await page.reload({ waitUntil: 'load' });
    await waitHome();
    await page.locator('#desktopNav a[href="/texty"]').first().click();
    await page.waitForFunction(() => location.pathname === '/texty', null, { timeout: 10000 });
    await page.waitForSelector('#app .content-grid, #app .scroll-row', { state: 'visible', timeout: 10000 });
  });
} catch (err) {
  console.error(`UNEXPECTED ${err.message}`);
  results.push({ ok: false, name: 'unexpected error', detail: err.message });
} finally {
  const idsStr =
    [...created.texts.map((id) => ['texts', id]), ...created.artworks.map((id) => ['artworks', id]), ...created.blogs.map((id) => ['blog', id])]
      .map(([kind, id]) => `${kind}:${id}`)
      .join(', ');
  console.log(`Cleanup: deleting ${idsStr}`);

  for (const [kind, endpoint] of [['texts', '/api/texts'], ['artworks', '/api/artworks'], ['blogs', '/api/blog']]) {
    for (const id of created[kind]) {
      await fetch(`${BASE}${endpoint}/${id}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    }
  }

  await browser.close();
}

// ── Summary ───────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
for (const r of failed) console.log(`FAILED: ${r.name} — ${r.detail}`);
process.exit(failed.length > 0 ? 1 : 0);