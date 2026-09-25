// YouTube embed caption tests.
//
// The rich-text editor lets authors wrap an embedded YouTube video in a
// <figure class="yt-figure"> holding an optional <figcaption class="yt-caption">.
// The caption is plain text (escaped at insert time), belongs to a single
// video, is editable, and empty captions are normalized away so no empty
// <figure>/<figcaption> element is ever saved. Stored video-less captions keep
// the legacy bare .yt-embed markup, so pre-existing content is untouched.
//
// The editor class (frontend/js/rich-text-editor.js) is shared by texts, blog,
// programming, admin friend posts and the friend portal, so this suite proves
// the flow on regular blog posts (incl. the actual admin editor round-trip)
// and on friend posts (store + public render).
//
// Run locally:   npm run test:ytcaption
// Against prod:  TEST_BASE_URL=https://www.katerina-inachis.cz npm run test:ytcaption
//
// Safety: every created record is deleted in a finally block. All test values
// are prefixed with [QA-YTCAP].

import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@inachis.art';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const MARK = `[QA-YTCAP-${Date.now().toString(36)}]`;
const V1 = 'aaaaaaaaaaa';
const V2 = 'bbbbbbbbbbb';
const CAPTION_A = 'Rozhovor o nové výstavě a její přípravě.';

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

async function http(url, options = {}) {
  const res = await fetch(url, options);
  const ct = res.headers.get('content-type');
  let body;
  try { body = ct && ct.includes('application/json') ? await res.json() : await res.text(); }
  catch { body = await res.text(); }
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
const auth = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

// ── HTML builders (mirror the editor output) ───────────────────
const legacyEmbed = (vid) =>
  `<div class="yt-embed"><iframe src="https://www.youtube-nocookie.com/embed/${vid}" allowfullscreen></iframe></div>`;
const figEmbed = (vid, caption) =>
  `<figure class="yt-figure">${legacyEmbed(vid)}<figcaption class="yt-caption">${caption}</figcaption></figure>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const launchOpts = { headless: true, args: ['--no-sandbox'] };
if (process.env.INACHIS_TEST_CHROME) launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pub = await ctx.newPage();
pub.setDefaultTimeout(45000);

await fetchJson(`${BASE}/api/pages`); // reachability check
let token = await adminLogin();

const createdBlogIds = [];
const createdFriendPostIds = [];
let createdFriendId = null;

try {
  // ── Regular posts (blog) via API ────────────────────────────
  await check('Blog: legacy embed (no caption) is stored as-is and renders without a caption', async () => {
    const t = `${MARK} blog legacy`;
    const r = await fetchJson(`${BASE}/api/blog`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: t, content: `<p>před</p>${legacyEmbed(V1)}<p>po</p>`, is_published: 1,
    }) });
    createdBlogIds.push(r.item.id);
    const pubApi = await fetchJson(`${BASE}/api/blog/${r.item.slug}`);
    assert(pubApi.content.includes('yt-embed') && !pubApi.content.includes('yt-caption'), 'caption markup appeared ghosting');
    await pub.goto(`${BASE}/blog/${r.item.slug}`, { waitUntil: 'load' });
    await pub.waitForFunction(() => !!document.querySelector('.text-content'), null, { timeout: 20000 });
    const state = await pub.evaluate(() => ({
      embeds: document.querySelectorAll('.text-content .yt-embed').length,
      iframes: document.querySelectorAll('.text-content .yt-embed iframe').length,
      captions: document.querySelectorAll('.text-content .yt-caption').length,
    }));
    assert(state.embeds === 1 && state.iframes === 1, `embed/iframe state ${JSON.stringify(state)}`);
    assert(state.captions === 0, `unexpected captions ${state.captions}`);
  });

  await check('Blog: caption renders under the video inside its figure', async () => {
    const t = `${MARK} blog captioned`;
    const r = await fetchJson(`${BASE}/api/blog`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: t, content: `<p>před</p>${figEmbed(V1, esc(CAPTION_A))}<p>po</p>`, is_published: 1,
    }) });
    createdBlogIds.push(r.item.id);
    await pub.goto(`${BASE}/blog/${r.item.slug}`, { waitUntil: 'load' });
    await pub.waitForFunction(() => !!document.querySelector('.text-content .yt-figure'), null, { timeout: 20000 });
    const state = await pub.evaluate(() => {
      const fig = document.querySelector('.text-content .yt-figure');
      const children = fig ? [...fig.children].map((el) => el.className) : [];
      const cap = fig?.querySelector('.yt-caption');
      return { children, captionText: (cap && cap.textContent.trim()) || '', captionCount: document.querySelectorAll('.text-content .yt-caption').length };
    });
    assert(state.captionCount === 1, `caption count ${state.captionCount}`);
    assert(state.children[0] === 'yt-embed' && state.children[state.children.length - 1] === 'yt-caption', `figure children ${JSON.stringify(state.children)}`);
    assert(state.captionText === CAPTION_A, `caption text "${state.captionText}"`);
  });

  await check('Blog: several videos keep their own captions; editing one leaves the other', async () => {
    const t = `${MARK} blog multi`;
    const content = `<p>úvod</p>${figEmbed(V1, esc('Popisek jedna.'))}${figEmbed(V2, esc('Popisek dva — jiný.'))}<p>závěr</p>`;
    const r = await fetchJson(`${BASE}/api/blog`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      title: t, content, is_published: 1,
    }) });
    createdBlogIds.push(r.item.id);
    assert(content.includes('Popisek jedna.') && content.includes('Popisek dva — jiný.'), 'fixture invalid');

    const changed = content.replace(esc('Popisek jedna.'), esc('První popisek přepsán.'));
    const u = await fetchJson(`${BASE}/api/blog/${r.item.id}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({
      title: t, content: changed, is_published: 1,
    }) });
    assert(u.item.content.includes('První popisek přepsán.'), 'caption 1 not updated');
    assert(u.item.content.includes('Popisek dva — jiný.'), 'caption 2 was overwritten');
  });

  // ── Friend posts via API ────────────────────────────────────
  await check('Friend post: captioned embed renders on the public friend page', async () => {
    const fr = await fetchJson(`${BASE}/api/friends`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      name: `${MARK} Přítel`, is_active: 1,
    }) });
    createdFriendId = fr.item.id;
    const fp = await fetchJson(`${BASE}/api/friend-posts`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      friend_id: fr.item.id, title: `${MARK} přítelovo video`, type: 'text',
      content: `<p>od přítele</p>${figEmbed(V1, esc('Video od přátel s popiskem.'))}`, is_published: 1,
    }) });
    createdFriendPostIds.push(fp.item.id);
    await pub.goto(`${BASE}/pratele/${fr.item.slug}/${fp.item.slug}`, { waitUntil: 'load' });
    await pub.waitForFunction(() => !!document.querySelector('.text-content .yt-figure'), null, { timeout: 20000 });
    const cap = await pub.evaluate(() => document.querySelector('.text-content .yt-caption')?.textContent.trim() || '');
    assert(cap === 'Video od přátel s popiskem.', `caption "${cap}"`);
  });

  await check('Friend post: legacy embed renders without a caption and without errors', async () => {
    const fp = await fetchJson(`${BASE}/api/friend-posts`, { method: 'POST', headers: auth(token), body: JSON.stringify({
      friend_id: createdFriendId, title: `${MARK} přítel legacy`, type: 'text',
      content: `<p>text</p>${legacyEmbed(V2)}`, is_published: 1,
    }) });
    createdFriendPostIds.push(fp.item.id);
    const friends = await fetchJson(`${BASE}/api/friends`);
    const friend = friends.find((f) => f.id === createdFriendId);
    await pub.goto(`${BASE}/pratele/${friend.slug}/${fp.item.slug}`, { waitUntil: 'load' });
    await pub.waitForFunction(() => !!document.querySelector('.text-content'), null, { timeout: 20000 });
    const state = await pub.evaluate(() => ({
      embeds: document.querySelectorAll('.text-content .yt-embed').length,
      captions: document.querySelectorAll('.text-content .yt-caption').length,
    }));
    assert(state.embeds === 1 && state.captions === 0, `state ${JSON.stringify(state)}`);
  });

  // ── Admin editor round-trip (regular blog post) ─────────────
  const UI_TITLE = `${MARK} UI video`;
  await check('Editor: inserting a video without a caption keeps the legacy markup', async () => {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'load' });
      await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
      await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const t = document.getElementById('adminPageTitle');
        return t && t.textContent.trim() === 'Přehled';
      }, null, { timeout: 15000 });

      await page.locator('[data-section="blog"]').first().click();
      for (let i = 0; i < 3; i++) {
        try {
          await page.waitForSelector('#blogSection .section-header button', { state: 'visible', timeout: 8000 });
          break;
        } catch { await page.locator('[data-section="blog"]').first().click(); }
      }
      await page.click('#blogSection .section-header button:has-text("Nový záznam")');
      await page.waitForSelector('#blogModalOverlay:not(.hidden)');

      await page.fill('#blogForm input[name="title"]', UI_TITLE);

      // First insert: URL only, no caption → legacy markup.
      await page.evaluate(() => {
        window.__q = ['https://www.youtube.com/watch?v=' + 'aaaaaaaaaaa', null];
        window.prompt = () => (window.__q.length ? window.__q.shift() : null);
        window.alert = () => {};
      });
      await page.evaluate(() => {
        const wrapper = document.querySelector('#blogForm textarea[name="content"]').nextElementSibling;
        const content = wrapper.querySelector('.rte-content');
        content.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(content);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        [...wrapper.querySelectorAll('.rte-toolbar button')].find((b) => b.textContent === 'YouTube').click();
      });
      const html = await page.evaluate(() =>
        document.querySelector('#blogForm textarea[name="content"]').nextElementSibling.querySelector('.rte-content').innerHTML);
      assert(html.includes('yt-embed'), 'no embed inserted');
      assert(!html.includes('yt-figure'), 'figure wrapper appeared for an empty caption');
    } finally {
      await page.close();
    }
  });

  await check('Editor: inserting a video with a caption escapes the caption text', async () => {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'load' });
      await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
      await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const t = document.getElementById('adminPageTitle');
        return t && t.textContent.trim() === 'Přehled';
      }, null, { timeout: 15000 });
      await page.locator('[data-section="blog"]').first().click();
      await page.waitForSelector('#blogSection .section-header button:has-text("Nový záznam")', { state: 'visible', timeout: 15000 });
      await page.click('#blogSection .section-header button:has-text("Nový záznam")');
      await page.waitForSelector('#blogModalOverlay:not(.hidden)');
      await page.fill('#blogForm input[name="title"]', UI_TITLE);

      const RAW_CAPTION = 'Popisek <i>ne</i> & <script>alert(1)</script>';
      await page.evaluate((cap) => {
        window.__q = ['https://youtu.be/' + 'bbbbbbbbbbb', cap];
        window.prompt = () => (window.__q.length ? window.__q.shift() : null);
        window.alert = () => {};
      }, RAW_CAPTION);
      await page.evaluate((cap) => {
        const wrapper = document.querySelector('#blogForm textarea[name="content"]').nextElementSibling;
        const content = wrapper.querySelector('.rte-content');
        content.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(content);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        [...wrapper.querySelectorAll('.rte-toolbar button')].find((b) => b.textContent === 'YouTube').click();
        // store expected escaped caption for later assertion
        window.__escapedCaption = cap.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }, RAW_CAPTION);

      const visual = await page.evaluate(() => {
        const wrapper = document.querySelector('#blogForm textarea[name="content"]').nextElementSibling;
        return {
          html: wrapper.querySelector('.rte-content').innerHTML,
          captionText: wrapper.querySelector('.yt-caption') ? wrapper.querySelector('.yt-caption').textContent : '',
          expected: window.__escapedCaption,
        };
      });
      assert(visual.html.includes('yt-figure'), 'no figure wrapper for a caption');
      assert(visual.captionText === RAW_CAPTION, `caption not rendered as plain text: "${visual.captionText}"`);
      assert(visual.html.includes(visual.expected), `caption was not escaped in saved HTML (expected "${visual.expected}")`);

      await page.click('#blogForm button[type="submit"]');
      await page.waitForFunction(() => {
        const t = document.getElementById('adminToast');
        return t && t.textContent.includes('Záznam vytvořen');
      }, null, { timeout: 15000 });

      const all = await fetchJson(`${BASE}/api/blog/admin/all`, { headers: auth(token) });
      const saved = all.find((b) => b.title === UI_TITLE);
      assert(saved, 'UI-created post missing from admin list');
      createdBlogIds.push(saved.id);
      assert(saved.content.includes('yt-figure'), 'stored content has no figure');
      assert(saved.content.includes(visual.expected), 'stored caption is not escaped');
      await page.close();
    } catch (err) { await page.close(); throw err; }
  });

  await check('Editor: caption is shown when reopening the post', async () => {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'load' });
      await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
      await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const t = document.getElementById('adminPageTitle');
        return t && t.textContent.trim() === 'Přehled';
      }, null, { timeout: 15000 });
      await page.locator('[data-section="blog"]').first().click();
      await page.waitForSelector('#blogTableBody tr', { state: 'visible', timeout: 15000 });
      await page.click(`#blogTableBody tr:has-text("${UI_TITLE}") button:has-text("Upravit")`);
      await page.waitForSelector('#blogModalOverlay:not(.hidden)');
      const src = await page.evaluate(() => {
        const wrapper = document.querySelector('#blogForm textarea[name="content"]').nextElementSibling;
        wrapper.querySelectorAll('.rte-tab')[1].click();
        return wrapper.querySelector('.rte-source').value;
      });
      assert(src.includes('yt-figure'), 'reopened editor lost the figure');
      assert(src.includes('&lt;script&gt;'), 'reopened editor lost the escaped caption');
      await page.close();
    } catch (err) { await page.close(); throw err; }
  });

  await check('Editor: changing the caption persists the new text', async () => {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'load' });
      await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
      await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const t = document.getElementById('adminPageTitle');
        return t && t.textContent.trim() === 'Přehled';
      }, null, { timeout: 15000 });
      await page.locator('[data-section="blog"]').first().click();
      await page.waitForSelector('#blogTableBody tr', { state: 'visible', timeout: 15000 });
      await page.click(`#blogTableBody tr:has-text("${UI_TITLE}") button:has-text("Upravit")`);
      await page.waitForSelector('#blogModalOverlay:not(.hidden)');

      const NEW_CAP = 'Změněný popisek s <b>tučným</b> textem.';
      const escapedNew = esc(NEW_CAP);
      // Replace the stored escaped caption inside the HTML source.
      await page.evaluate(({ newCap }) => {
        const wrapper = document.querySelector('#blogForm textarea[name="content"]').nextElementSibling;
        wrapper.querySelectorAll('.rte-tab')[1].click();
        const old = wrapper.querySelector('.rte-source').value;
        const replaced = old.replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/, `<figcaption class="yt-caption">${newCap}</figcaption>`);
        wrapper.querySelector('.rte-source').value = replaced;
      }, { newCap: escapedNew });
      await page.click('#blogForm button[type="submit"]');
      await page.waitForFunction(() => {
        const t = document.getElementById('adminToast');
        return t && t.textContent.includes('Záznam aktualizován');
      }, null, { timeout: 15000 });

      const all = await fetchJson(`${BASE}/api/blog/admin/all`, { headers: auth(token) });
      const saved = all.find((b) => b.title === UI_TITLE);
      assert(saved.content.includes(escapedNew), 'changed caption not persisted');
      assert(!/alert\(1\)/.test(saved.content), 'old caption still present');
      await page.close();
    } catch (err) { await page.close(); throw err; }
  });

  await check('Editor: clearing the caption leaves no empty figure/caption element', async () => {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'load' });
      await page.evaluate((t) => localStorage.setItem('inachis_token', t), token);
      await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const t = document.getElementById('adminPageTitle');
        return t && t.textContent.trim() === 'Přehled';
      }, null, { timeout: 15000 });
      await page.locator('[data-section="blog"]').first().click();
      await page.waitForSelector('#blogTableBody tr', { state: 'visible', timeout: 15000 });
      await page.click(`#blogTableBody tr:has-text("${UI_TITLE}") button:has-text("Upravit")`);
      await page.waitForSelector('#blogModalOverlay:not(.hidden)');

      await page.evaluate(() => {
        const wrapper = document.querySelector('#blogForm textarea[name="content"]').nextElementSibling;
        wrapper.querySelectorAll('.rte-tab')[1].click();
        const src = wrapper.querySelector('.rte-source');
        const cleaned = src.value.replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/, '');
        src.value = cleaned;
      });
      await page.click('#blogForm button[type="submit"]');
      await page.waitForFunction(() => {
        const t = document.getElementById('adminToast');
        return t && t.textContent.includes('Záznam aktualizován');
      }, null, { timeout: 15000 });

      const all = await fetchJson(`${BASE}/api/blog/admin/all`, { headers: auth(token) });
      const saved = all.find((b) => b.title === UI_TITLE);
      assert(!saved.content.includes('yt-figure'), 'empty figure wrapper was saved');
      assert(!saved.content.includes('yt-caption'), 'empty caption element was saved');
      assert(saved.content.includes('yt-embed'), 'video itself disappeared after caption removal');

      await pub.goto(`${BASE}/blog/${saved.slug}`, { waitUntil: 'load' });
      await pub.waitForFunction(() => !!document.querySelector('.text-content'), null, { timeout: 20000 });
      const captions = await pub.evaluate(() => document.querySelectorAll('.text-content .yt-caption').length);
      assert(captions === 0, `empty caption leaked to public render (${captions})`);
      await page.close();
    } catch (err) { await page.close(); throw err; }
  });
} finally {
  for (const id of createdBlogIds) await http(`${BASE}/api/blog/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  for (const id of createdFriendPostIds) await http(`${BASE}/api/friend-posts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (createdFriendId) await http(`${BASE}/api/friends/${createdFriendId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}