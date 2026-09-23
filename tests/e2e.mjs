import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3004';

const VIOLET = 'rgb(58, 31, 90)';
const GOLD = 'rgb(176, 136, 90)';
const SOLID_HEADER_BG = 'rgba(250, 248, 245, 0.95)';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const NAV_TARGETS = [
  '/texty',
  '/kresba',
  '/blog',
  '/programovani',
  '/pratele',
  '/o-mne',
  '/kontakt'
];

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

function pathOf(page) {
  return new URL(page.url()).pathname;
}

async function waitPath(page, target, timeout = 8000) {
  await page.waitForFunction(
    (p) => location.pathname === p,
    target,
    { timeout }
  );
}

async function waitHeroVisible(page) {
  await page.waitForFunction(
    () => {
      const hero = document.getElementById('hero');
      return hero && getComputedStyle(hero).display !== 'none';
    },
    null,
    { timeout: 8000 }
  );
}

async function headerState(page) {
  return page.evaluate(() => {
    const header = document.getElementById('siteHeader');
    const logo = header ? header.querySelector('.site-logo') : null;
    const navLink = document.querySelector('#desktopNav a[href="/o-mne"]');
    const active = document.querySelector('#desktopNav a.active');
    return {
      hasScrolled: header ? header.classList.contains('scrolled') : false,
      headerBg: header ? getComputedStyle(header).backgroundColor : null,
      logoColor: logo ? getComputedStyle(logo).color : null,
      navColor: navLink ? getComputedStyle(navLink).color : null,
      activeColor: active ? getComputedStyle(active).color : null
    };
  });
}

async function heroDisplay(page) {
  return page.evaluate(() => {
    const hero = document.getElementById('hero');
    return hero ? getComputedStyle(hero).display : 'missing';
  });
}

function isWhiteish(color) {
  if (!color) return true;
  const t = color.trim();
  return t === 'rgb(255, 255, 255)' || t.startsWith('rgba(255, 255, 255');
}

async function requireAppContent(page) {
  await page.waitForFunction(
    () => {
      const app = document.getElementById('app');
      if (!app) return false;
      const html = app.innerHTML.trim();
      return html !== '' && !app.querySelector('.loading-state');
    },
    null,
    { timeout: 10000 }
  );
  await page.waitForSelector('#app h1, #app h3', { state: 'visible', timeout: 8000 });
}

async function waitForLegibleHeader(page) {
  await page
    .waitForFunction(
      () => {
        const header = document.getElementById('siteHeader');
        if (!header || !header.classList.contains('scrolled')) return false;
        const bg = getComputedStyle(header).backgroundColor;
        const logo = header.querySelector('.site-logo');
        const logoColor = logo ? getComputedStyle(logo).color : '';
        return bg === 'rgba(250, 248, 245, 0.95)' && logoColor === 'rgb(58, 31, 90)';
      },
      null,
      { timeout: 8000 }
    )
    .catch(() => {});
}

async function goHomeViaLogo(page) {
  if (pathOf(page) === '/') return;
  await page.locator('.site-header .site-logo').first().click();
  await waitPath(page, '/');
  await waitHeroVisible(page);
}

async function assertInternalTheme(page, route) {
  await waitForLegibleHeader(page);

  const hs = await headerState(page);
  assert(hs.hasScrolled, `header missing .scrolled class (got bg=${hs.headerBg}, logo=${hs.logoColor})`);
  assert(hs.headerBg === SOLID_HEADER_BG, `header background should be solid light, got ${hs.headerBg}`);
  assert(hs.logoColor === VIOLET, `logo should be violet, got ${hs.logoColor}`);
  assert(!isWhiteish(hs.navColor), `nav link should not be white over light bg, got ${hs.navColor}`);

  const hero = await heroDisplay(page);
  assert(hero === 'none', `hero should be hidden on ${route}, got display=${hero}`);

  await requireAppContent(page);
  const titleColor = await page
    .locator('#app h1, #app h3')
    .first()
    .evaluate((el) => getComputedStyle(el).color)
    .catch(() => null);
  assert(titleColor && !isWhiteish(titleColor), `page title should be dark, got ${titleColor}`);
}

const launchOpts = {
  headless: true,
  args: ['--no-sandbox']
};
if (process.env.INACHIS_TEST_CHROME) {
  launchOpts.executablePath = process.env.INACHIS_TEST_CHROME;
}

const browser = await chromium.launch(launchOpts);
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(15000);

try {
  // ── A. Navigation: clicking each main-nav link must change the URL and open the real page
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('inachis_lang', 'cs'));
  await page.reload({ waitUntil: 'networkidle' });

  for (const target of NAV_TARGETS) {
    await check(`nav click from homepage → ${target}`, async () => {
      await goHomeViaLogo(page);
      await page.locator(`#desktopNav a[href="${target}"]`).first().click();
      await waitPath(page, target);
      await assertInternalTheme(page, target);
    });
  }

  await check('nav click between internal pages (/texty → /kresba)', async () => {
    await page.goto(BASE + '/texty', { waitUntil: 'load' });
    await waitPath(page, '/texty');
    await page.locator('#desktopNav a[href="/kresba"]').first().click();
    await waitPath(page, '/kresba');
    await assertInternalTheme(page, '/kresba');
  });

  await check('repeated navigation works (same links, multiple rounds)', async () => {
    for (let round = 0; round < 2; round++) {
      await goHomeViaLogo(page);
      for (const target of ['/blog', '/pratele', '/texty']) {
        await page.locator(`#desktopNav a[href="${target}"]`).first().click();
        await waitPath(page, target);
        await requireAppContent(page);
      }
    }
  });

  await check('logo click from internal page returns to homepage', async () => {
    await page.goto(BASE + '/blog', { waitUntil: 'load' });
    await page.locator('.site-header .site-logo').first().click();
    await waitPath(page, '/');
    await waitHeroVisible(page);
  });

  await check('browser back button still works', async () => {
    await page.locator('#desktopNav a[href="/o-mne"]').first().click();
    await waitPath(page, '/o-mne');
    await page.goBack();
    await waitPath(page, '/');
    await waitHeroVisible(page);
  });

  // ── B. Direct URL load of each internal page must render the light, legible header
  for (const route of NAV_TARGETS) {
    await check(`direct load ${route} (HTTP + theme)`, async () => {
      const resp = await page.goto(BASE + route, { waitUntil: 'networkidle' });
      assert(resp && resp.status() === 200, `expected 200, got ${resp ? resp.status() : 'no response'}`);
      await assertInternalTheme(page, route);
      const active = await page
        .locator(`#desktopNav a[href="${route}"]`)
        .first()
        .evaluate((el) => getComputedStyle(el).color)
        .catch(() => null);
      assert(active === GOLD, `active nav link should be gold, got ${active}`);
    });
  }

  // ── C. Regressions
  await check('homepage hero visible and transparent header at top', async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await waitHeroVisible(page);
    const hs = await headerState(page);
    assert(!hs.hasScrolled, 'header should be transparent at homepage top');
    assert(hs.headerBg === TRANSPARENT, `homepage top header bg should be transparent, got ${hs.headerBg}`);
    assert(hs.logoColor === 'rgb(255, 255, 255)', `homepage logo should be white over hero, got ${hs.logoColor}`);
  });

  await check('homepage header becomes legible after scrolling and transparent again at top', async () => {
    await page.evaluate(() => window.scrollTo(0, 500));
    await waitForLegibleHeader(page);
    const hs = await headerState(page);
    assert(hs.hasScrolled, 'header should have .scrolled class after scrolling');
    assert(hs.headerBg === SOLID_HEADER_BG, `scrolled header should be solid light, got ${hs.headerBg}`);
    assert(hs.logoColor === VIOLET, `scrolled logo should be violet, got ${hs.logoColor}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(
      () => {
        const header = document.getElementById('siteHeader');
        return header && !header.classList.contains('scrolled') && getComputedStyle(header).backgroundColor === 'rgba(0, 0, 0, 0)';
      },
      null,
      { timeout: 8000 }
    );
  });

  await check('internal page keeps legible header at scroll top', async () => {
    await page.goto(BASE + '/programovani', { waitUntil: 'networkidle' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertInternalTheme(page, '/programovani');
  });

  await check('/programovani renders its programming list', async () => {
    await page.goto(BASE + '/programovani', { waitUntil: 'networkidle' });
    await requireAppContent(page);
    const bodyText = (await page.locator('#app').innerText()).toLowerCase();
    const marker = await page
      .locator('#app h1, #app h3')
      .first()
      .innerText()
      .catch(() => '');
    assert(
      marker.trim().length > 0,
      'programming page should show a list heading or empty-state heading'
    );
    assert(!bodyText.includes('404'), 'programming page should not be a 404');
  });

  await check('/kontakt renders working contact form', async () => {
    await page.goto(BASE + '/kontakt', { waitUntil: 'networkidle' });
    await page.waitForSelector('#contactForm', { state: 'visible' });
    let inquiryPosts = 0;
    const countPost = (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/inquiries')) inquiryPosts++;
    };
    page.on('request', countPost);
    try {
      await page.click('#contactSubmit');
      const err = await page.locator('#contactResult').innerText();
      assert(err.trim().length > 0, 'empty submit should show a client-side validation error');
      assert(inquiryPosts === 0, `validation error must not POST, saw ${inquiryPosts} request(s)`);
    } finally {
      page.off('request', countPost);
    }
  });

  await check('language toggle EN → CS', async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('#langToggle')
    ]);
    await page.waitForFunction(
      () => document.documentElement.lang === 'en' && document.readyState === 'complete',
      null,
      { timeout: 10000 }
    );
    const aboutText = (
      await page.locator('#desktopNav a[href="/o-mne"]').first().innerText()
    ).trim();
    assert(
      aboutText.toLowerCase() === 'about',
      `EN nav label should be "About", got "${aboutText}"`
    );
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('#langToggle')
    ]);
    await page.waitForFunction(
      () => document.documentElement.lang === 'cs' && document.readyState === 'complete',
      null,
      { timeout: 10000 }
    );
    const aboutCz = (
      await page.locator('#desktopNav a[href="/o-mne"]').first().innerText()
    ).trim();
    assert(
      aboutCz.toLowerCase() === 'o mně',
      `CS nav label should be "O mně", got "${aboutCz}"`
    );
  });

  await check('mobile navigation: hamburger opens menu, link navigates, menu closes', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.click('#navHamburger');
    await page.waitForFunction(
      () => document.getElementById('mobileNav').classList.contains('open'),
      null,
      { timeout: 5000 }
    );
    await page.locator('#mobileNav a[href="/blog"]').first().click();
    await waitPath(page, '/blog');
    await page.waitForFunction(
      () => !document.getElementById('mobileNav').classList.contains('open'),
      null,
      { timeout: 5000 }
    );
    await assertInternalTheme(page, '/blog');
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await check('admin and login pages still serve', async () => {
    for (const p of ['/admin', '/login']) {
      const resp = await page.goto(BASE + p, { waitUntil: 'load' });
      assert(resp && resp.status() === 200, `${p} expected 200, got ${resp ? resp.status() : 'none'}`);
    }
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('Failures:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
