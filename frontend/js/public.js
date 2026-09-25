// ============================================================
// Inachis — public.js
// Full SPA with router, all public sections
// ============================================================

// ── XSS protection ───────────────────────────────────────────
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Date formatter ────────────────────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return '';
  try {
    const locale = (window.getLang && window.getLang() === 'en') ? 'en-US' : 'cs-CZ';
    return new Date(dateStr).toLocaleDateString(locale, {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

// ── i18n helpers ────────────────────────────────────────────────
function langParam() {
  const lang = window.getLang ? window.getLang() : 'cs';
  return lang === 'en' ? '?lang=en' : '';
}

function updateStaticI18n() {
  const t = window.t;
  if (!t) return;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  const toggle = document.getElementById('langToggle');
  if (toggle) {
    const lang = window.getLang ? window.getLang() : 'cs';
    toggle.textContent = lang === 'cs' ? 'EN' : 'CZ';
  }
}

// Localized display label for a category record. In EN mode the admin-provided
// English name (categories.name_en) wins when set; otherwise the i18n nav key
// (nav.<slug>); the raw CS name is the final fallback (and always used in CZ
// mode, matching the pre-bilingual behaviour).
function categoryLabel(cat, i) {
  if (!cat || typeof cat !== 'object') return '';
  const tFn = i || window.t || (k => k);
  const en = window.getLang ? window.getLang() === 'en' : false;
  if (en && cat.name_en && cat.name_en.trim()) return cat.name_en.trim();
  const key = `nav.${cat.slug}`;
  const translated = tFn(key);
  return translated !== key && translated !== undefined ? translated : (cat.name || cat.slug || '');
}

// ── Safe Fetch ────────────────────────────────────────────────
async function safeFetch(url) {
  const response = await fetch(url);
  const contentType = response.headers.get('content-type');

  if (!response.ok) {
    const err = contentType?.includes('application/json')
      ? await response.json()
      : { error: await response.text() };
    throw new Error(err.error || 'Request failed');
  }

  if (!contentType?.includes('application/json')) {
    throw new Error('Server returned non-JSON response');
  }

  return await response.json();
}

// ── Page intro text (admin "Stránky") ───────────────────────────
// Fetched fresh on every render so a value saved in the admin panel is
// reflected immediately — a cached list could show a stale (empty) intro for
// the rest of the tab's life and a single failed fetch would poison it for good.
async function pageIntro(slug) {
  let list = [];
  try {
    list = await safeFetch('/api/pages' + langParam());
  } catch {
    list = [];
  }
  const page = list.find(p => p.slug === slug);
  const intro = page ? page.intro_text || '' : '';
  return intro ? `<p class="page-intro">${esc(intro)}</p>` : '';
}

// ============================================================
// Router
// ============================================================
const app = {
  currentPath: null,

  navigate(path) {
    if (path === this.currentPath) return;
    history.pushState(null, '', path);
    this.route(path);
  },

  route(path) {
    this.currentPath = path;
    this.updateNav(path);

    // Show hero only on homepage
    const isHome = (path === '/' || path === '');
    const hero = document.getElementById('hero');
    if (hero) hero.style.display = isHome ? '' : 'none';

    // Internal pages have no dark hero behind the fixed header, so the header
    // must stay in its legible (light-background) state instead of the
    // transparent white-on-dark state that is only valid over the hero.
    const headerEl = document.getElementById('siteHeader');
    if (headerEl) headerEl.classList.toggle('scrolled', !isHome || window.scrollY > 20);

    const segments = path.split('/').filter(Boolean);
    const [s0, s1, s2] = segments;

    if (!s0) return this.renderHomepage();

    switch (s0) {
      case 'texty':
        if (!s1)             return this.renderTextsList();
        return this.renderTextRoute(s1);
      case 'umeni':
        return s1 ? this.renderArtworkDetail(s1) : this.renderArtworksList();
      case 'kresba':
        return s1 ? this.renderJewelryDetail(s1) : this.renderJewelryList();
      case 'blog':
        return s1 ? this.renderBlogPost(s1) : this.renderBlogList();
      case 'programovani':
        return s1 ? this.renderProgrammingPost(s1) : this.renderProgrammingList();
      case 'pratele':
        if (s1 && s2) return this.renderFriendPost(s1, s2);
        if (s1) return this.renderFriendPage(s1);
        return this.renderFriendsIndex();
      case 'o-mne':
        return this.renderAbout();
      case 'kontakt':
        return this.renderContact();
      case 'tag':
        return s1 ? this.renderTagPage(s1) : this.render404();
      default:
        return this.render404();
    }
  },

  updateNav(path) {
    document.querySelectorAll('.nav-menu a, .nav-mobile a, .nav-dropdown a').forEach(a => {
      const href = a.getAttribute('href') || '';
      const active = href !== '/'
        ? path === href || path.startsWith(href + '/')
        : path === '/';
      a.classList.toggle('active', active);
    });
    // Mark parent Texty link active for any /texty/* path
    document.querySelectorAll('.nav-item--dropdown > a').forEach(a => {
      if (a.getAttribute('href') === '/texty' && path.startsWith('/texty')) {
        a.classList.add('active');
      }
    });
  },

  setContent(html) {
    document.getElementById('app').innerHTML = html;
  },

  showLoading() {
    const t = window.t;
    this.setContent(`<div class="loading-state">${t ? t('loading') : 'Načítám…'}</div>`);
  }
};

// ── Nav intercept ─────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) return;
  if (a.hasAttribute('target')) return;
  e.preventDefault();
  // Close mobile nav
  document.getElementById('mobileNav')?.classList.remove('open');
  app.navigate(href);
});

window.addEventListener('popstate', () => app.route(location.pathname));

// ── Hamburger ─────────────────────────────────────────────────
document.getElementById('navHamburger')?.addEventListener('click', () => {
  document.getElementById('mobileNav')?.classList.toggle('open');
});

// ── Header scroll ─────────────────────────────────────────────
const header = document.getElementById('siteHeader');
window.addEventListener('scroll', () => {
  const atHome = (app.currentPath === '/' || app.currentPath === '');
  // Internal pages have no dark hero behind the header, so they always use the
  // legible (scrolled) header; only the homepage relies on scroll position.
  header?.classList.toggle('scrolled', !atHome || window.scrollY > 20);
}, { passive: true });

// ============================================================
// Homepage
// ============================================================
async function renderHomepage() {
  app.showLoading();
  try {
    const lp = langParam();
    const [settings, textsList, artworksList, jewelryList, friends, blogList, programmingList] = await Promise.allSettled([
      safeFetch('/api/settings/public' + lp),
      safeFetch('/api/texts' + lp),
      safeFetch('/api/artworks' + lp),
      safeFetch('/api/jewelry' + lp),
      safeFetch('/api/friends' + lp),
      safeFetch('/api/blog' + lp),
      safeFetch('/api/programming' + lp)
    ]);

    const s     = settings.value     || {};
    // Newest items, up to 4 per content section.
    const MAX_ROWS = 4;
    const texts  = (textsList.value  || []).slice(0, MAX_ROWS);
    const arts   = (artworksList.value || []).slice(0, MAX_ROWS);
    const jewels = (jewelryList.value  || []).slice(0, MAX_ROWS);
    const frds   = (friends.value    || []).slice(0, 4);
    const blogs  = (blogList.value    || []).slice(0, MAX_ROWS);
    const progs  = (programmingList.value || []).slice(0, MAX_ROWS);

    // Update hero
    const heroBg = document.getElementById('heroBg');
    if (heroBg && s.hero_image) {
      heroBg.style.backgroundImage = `url('${esc(s.hero_image)}')`;
    }
    const heroTitle = document.getElementById('heroTitle');
    if (heroTitle) heroTitle.textContent = s.site_name || 'Kateřina Inachis';
    const heroSubtitle = document.getElementById('heroSubtitle');
    if (heroSubtitle) heroSubtitle.textContent = s.site_tagline || '';

    const i = window.t || (k => k);
    const html = `
      ${texts.length ? `
      <section id="section-texts" class="section section--alt">
        <div class="section-inner">
          <div class="section-header">
            <h2 class="section-title">${i('home.section.texts')}</h2>
            <hr class="ornament-line">
          </div>
          <div class="scroll-row">
            ${texts.map(t => renderTextCard(t)).join('')}
          </div>
          <div style="text-align:center;margin-top:2.5rem">
            <a href="/texty" class="btn btn-ghost">${i('home.allTexts')}</a>
          </div>
        </div>
      </section>` : ''}

      ${arts.length ? `
      <section id="section-art" class="section">
        <div class="section-inner">
          <div class="section-header">
            <h2 class="section-title">${i('home.section.art')}</h2>
            <hr class="ornament-line">
          </div>
          <div class="scroll-row">
            ${arts.map(a => renderArtworkGalleryItem(a)).join('')}
          </div>
          <div style="text-align:center;margin-top:2.5rem">
            <a href="/umeni" class="btn btn-ghost">${i('home.fullGallery')}</a>
          </div>
        </div>
      </section>` : ''}

      ${jewels.length ? `
      <section id="section-drawing" class="section section--dark">
        <div class="section-inner">
          <div class="section-header">
            <h2 class="section-title">${i('home.section.drawing')}</h2>
            <hr class="ornament-line">
          </div>
          <div class="scroll-row">
            ${jewels.map(j => renderJewelryItem(j)).join('')}
          </div>
          <div style="text-align:center;margin-top:2.5rem">
            <a href="/kresba" class="btn btn-ghost">${i('home.viewAll')}</a>
          </div>
        </div>
      </section>` : ''}

      ${frds.length ? `
      <section id="section-friends" class="section section--alt">
        <div class="section-inner">
          <div class="section-header">
            <h2 class="section-title">${i('home.section.friends')}</h2>
            <hr class="ornament-line">
            <p class="section-subtitle">${i('home.friendsSubtitle')}</p>
          </div>
          <div class="friend-grid">
            ${frds.map(f => renderFriendCard(f)).join('')}
          </div>
          <div style="text-align:center;margin-top:2.5rem">
            <a href="/pratele" class="btn btn-ghost">${i('home.allFriends')}</a>
          </div>
        </div>
      </section>` : ''}

      ${blogs.length ? `
      <section id="section-blog" class="section">
        <div class="section-inner">
          <div class="section-header">
            <h2 class="section-title">${i('home.section.blog')}</h2>
            <hr class="ornament-line">
          </div>
          <div class="scroll-row">
            ${blogs.map(b => renderBlogCard(b)).join('')}
          </div>
          <div style="text-align:center;margin-top:2.5rem">
            <a href="/blog" class="btn btn-ghost">${i('home.allPosts')}</a>
          </div>
        </div>
      </section>` : ''}

      ${progs.length ? `
      <section id="section-programming" class="section section--alt">
        <div class="section-inner">
          <div class="section-header">
            <h2 class="section-title">${i('home.section.programming')}</h2>
            <hr class="ornament-line">
          </div>
          <div class="scroll-row">
            ${progs.map(b => renderProgrammingCard(b)).join('')}
          </div>
          <div style="text-align:center;margin-top:2.5rem">
            <a href="/programovani" class="btn btn-ghost">${i('home.allProgramming')}</a>
          </div>
        </div>
      </section>` : ''}

      ${s.about_text ? `
      <section id="section-about" class="section section--alt">
        <div class="section-inner">
          <div class="about-split">
            ${s.about_image ? `
            <div class="about-image">
              <img src="${esc(s.about_image)}" alt="${esc(s.owner_name || i('nav.about'))}">
            </div>` : ''}
            <div class="about-text">
              <span class="category-label">${i('nav.about')}</span>
              <h2 class="section-title" style="text-align:left;margin-top:0.5rem">${esc(s.owner_name || '')}</h2>
              <hr class="ornament-line ornament-line--left">
              <p style="font-family:var(--font-body);font-weight:300;color:var(--ink-mid);line-height:1.75;margin-bottom:1.5rem">${esc(s.about_text)}</p>
              <a href="/o-mne" class="btn btn-ghost">${i('home.moreAbout')}</a>
            </div>
          </div>
        </div>
      </section>` : ''}

      <section id="section-contact" class="section">
        <div class="section-inner">
          <div class="contact-section" style="text-align:center">
            <span class="category-label">${i('nav.contact')}</span>
            <h2 class="section-title" style="margin-top:0.5rem">${i('home.letsConnect')}</h2>
            <hr class="ornament-line">
            <p style="font-family:var(--font-body);font-weight:300;color:var(--ink-mid);margin-bottom:2rem;max-width:480px;margin-left:auto;margin-right:auto">
              ${i('home.contactDescription')}
            </p>
            <a href="/kontakt" class="btn btn-primary" data-navigate="1">${i('home.writeMessage')}</a>
          </div>
        </div>
      </section>
    `;

    app.setContent(html);
  } catch (err) {
    const i = window.t || (k => k);
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.loading')}</h3><p>${esc(err.message)}</p></div></div></div>`);
  }
}

// ============================================================
// Card renderers
// ============================================================

// Thumbnail URL for a gallery cover image. Listing card grids request a small
// WebP variant via /img/gallery instead of downloading the full-size original
// served at /uploads/gallery. Anything that is not a /uploads/gallery URL is
// returned unchanged, so other image sources (external URLs, non-gallery
// files) keep their current behaviour.
function thumbUrl(src, w = 800) {
  if (!src) return src;
  const m = /^\/uploads\/gallery\/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp|gif|avif))$/.exec(src);
  if (!m) return src;
  return `/img/gallery/${encodeURIComponent(m[1])}?w=${w}`;
}

// Shared listing-card image markup. The card image box reserves its 3/2 aspect
// ratio in CSS, so the width/height attrs only add an intrinsic-size hint (no
// layout shift). The first cards of a real list load eagerly (they are the
// viewport/LCP candidates) and the very first one gets fetchpriority="high";
// everything below the fold stays lazy.
function cardImgHtml(src, alt, opts = {}) {
  const w = opts.w || 800;
  const h = Math.round((w * 2) / 3);
  const loading = opts.eager ? 'eager' : 'lazy';
  const fp = opts.priority ? ' fetchpriority="high"' : '';
  return `<div class="card-img"><img src="${esc(thumbUrl(src, w))}" alt="${esc(alt)}" width="${w}" height="${h}" loading="${loading}"${fp}></div>`;
}

// Loading plan for a listing grid: the first 4 cards sit in the initial
// viewport and load eagerly, everything below stays lazy. Only genuine lists
// pass an index — homepage tiles call the card renderers without one and keep
// lazy (the hero is the homepage LCP).
function cardLoading(index) {
  return typeof index === 'number' && index < 4
    ? { eager: true, priority: index === 0 }
    : {};
}

function renderTextCard(t, index) {
  return `
    <div class="card" onclick="app.navigate('/texty/${esc(t.slug)}')">
      <div class="card-body">
        ${t.category ? `<span class="card-category">${esc(t.category)}</span>` : ''}
        <h3 class="card-title">${esc(t.title)}</h3>
        ${t.excerpt ? `<p class="card-excerpt">${esc(t.excerpt)}</p>` : ''}
      </div>
      ${t.cover_image ? cardImgHtml(t.cover_image, t.title, cardLoading(index)) : ''}
      <div class="card-meta">${fmtDate(t.published_at || t.created_at)}</div>
    </div>`;
}

function renderArtworkGalleryItem(a) {
  return `
    <div class="gallery-item" onclick="app.navigate('/umeni/${esc(a.slug)}')">
      ${a.cover_image ? `<img src="${esc(a.cover_image)}" alt="${esc(a.title)}" loading="lazy">` : '<div style="width:100%;height:100%;background:var(--bg-section)"></div>'}
      <div class="gallery-item__overlay">
        <div>
          ${a.collection ? `<div style="font-family:var(--font-display);font-style:italic;font-size:0.72rem;color:var(--gold);letter-spacing:0.1em">${esc(a.collection)}</div>` : ''}
          <div class="gallery-item__title">${esc(a.title)}</div>
        </div>
      </div>
    </div>`;
}

function renderJewelryItem(j) {
  return `
    <div class="jewelry-item" onclick="app.navigate('/kresba/${esc(j.slug)}')">
      <div class="jewelry-item__img">
        ${j.cover_image ? `<img src="${esc(j.cover_image)}" alt="${esc(j.title)}" loading="lazy">` : ''}
      </div>
      <div class="jewelry-item__body">
        ${j.collection ? `<span class="jewelry-item__collection">${esc(j.collection)}</span>` : ''}
        <div class="jewelry-item__title">${esc(j.title)}</div>
        ${j.materials ? `<div class="jewelry-item__materials">${esc(j.materials)}</div>` : ''}
        <span class="jewelry-badge ${j.is_available ? 'jewelry-badge--available' : 'jewelry-badge--unavailable'}">
          ${j.is_available ? (window.t ? window.t('jewelry.available') : 'Dostupné') : (window.t ? window.t('jewelry.unavailable') : 'Nedostupné')}
        </span>
      </div>
    </div>`;
}

function renderFriendCard(f) {
  const initials = esc(f.name).split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  return `
    <div class="friend-card" onclick="app.navigate('/pratele/${esc(f.slug)}')">
      ${f.avatar
        ? `<img src="${esc(f.avatar)}" alt="${esc(f.name)}" class="friend-avatar" loading="lazy">`
        : `<div class="friend-avatar-placeholder">${initials}</div>`}
      <div class="friend-name">${esc(f.name)}</div>
      ${f.short_bio ? `<div class="friend-bio">${esc(f.short_bio)}</div>` : ''}
    </div>`;
}

function renderBlogCard(b, index) {
  return `
    <div class="card" onclick="app.navigate('/blog/${esc(b.slug)}')">
      <div class="card-body">
        <span class="card-category">Blog</span>
        <h3 class="card-title">${esc(b.title)}</h3>
        ${b.excerpt ? `<p class="card-excerpt">${esc(b.excerpt)}</p>` : ''}
      </div>
      ${b.cover_image ? cardImgHtml(b.cover_image, b.title, cardLoading(index)) : ''}
      <div class="card-meta">${fmtDate(b.published_at || b.created_at)}</div>
    </div>`;
}

function renderProgrammingCard(b, index) {
  const i = window.t || (k => k);
  return `
    <div class="card" onclick="app.navigate('/programovani/${esc(b.slug)}')">
      <div class="card-body">
        <span class="card-category">${i('nav.programming')}</span>
        <h3 class="card-title">${esc(b.title)}</h3>
        ${b.excerpt ? `<p class="card-excerpt">${esc(b.excerpt)}</p>` : ''}
      </div>
      ${b.cover_image ? cardImgHtml(b.cover_image, b.title, cardLoading(index)) : ''}
      <div class="card-meta">${fmtDate(b.published_at || b.created_at)}</div>
    </div>`;
}

// ============================================================
// Texts section
// ============================================================
async function renderTextsList() {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const items = await safeFetch('/api/texts' + langParam());
    const intro = await pageIntro('texty');
    app.setContent(`
      <section class="section">
        <div class="section-inner">
          <div class="section-header">
            <h1 class="section-title">${i('nav.texts')}</h1>
            <hr class="ornament-line">
            ${intro}
          </div>
          ${items.length
            ? `<div class="content-grid content-grid--3">${items.map((t, i) => renderTextCard(t, i)).join('')}</div>`
            : `<div class="empty-state"><h3>${i('empty.texts')}</h3><p>${i('empty.textsDesc')}</p></div>`}
        </div>
      </section>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.generic')}</h3><p>${esc(err.message)}</p></div></div></div>`);
  }
}

async function renderTextsFiltered(category, label) {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const catParam = `category=${encodeURIComponent(category)}`;
    const lp = langParam();
    const url = lp ? `/api/texts${lp}&${catParam}` : `/api/texts?${catParam}`;
    const items = await safeFetch(url);
    if (!items.length) {
      return app.setContent(`
        <div class="detail-page">
          <div class="detail-page__inner">
            <a href="/texty" class="back-link">${i('back.texts')}</a>
            <div class="empty-state"><h3>${i('empty.category', { label: esc(label) })}</h3><p>${i('empty.categoryDesc')}</p></div>
          </div>
        </div>`);
    }
    app.setContent(`
      <section class="section">
        <div class="section-inner">
          <div class="section-header">
            <h1 class="section-title">${esc(label)}</h1>
            <hr class="ornament-line">
          </div>
          <div class="content-grid content-grid--3">
            ${items.map((t, i) => renderTextCard(t, i)).join('')}
          </div>
        </div>
      </section>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.generic')}</h3><p>${esc(err.message)}</p></div></div></div>`);
  }
}

// /texty/<s1> may be a subcategory (data-driven — any category seeded or
// created in admin with page_slug 'texty' and a slug) or a text detail slug.
// Hidden subcategories still resolve here (hidden ≠ deleted, direct URLs stay
// reachable) but are pulled from the nav by syncPublicNav.
async function renderTextRoute(s1) {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const cats = await safeFetch('/api/categories/public/all');
    const cat = cats.find(c => c.page_slug === 'texty' && c.slug === s1);
    if (cat) {
      const label = categoryLabel(cat, i);
      return renderTextsFiltered(cat.name, label);
    }
  } catch { /* fall through to the text detail lookup */ }
  return renderTextDetail(s1);
}

// Perex (excerpt) renders above the cover image in every post detail:
// Title → Perex → Image → Main content. An empty excerpt renders nothing, so
// posts without a perex keep Title → Image → Content with no empty block.
function detailExcerptHtml(excerpt) {
  return excerpt ? `<p class="detail-excerpt">${esc(excerpt)}</p>` : '';
}

// Tags render between the perex and the cover image (Title → Perex → Tags →
// Image → Content) so they are attached to the post but never split the
// headline from its image. Artworks and jewelry have no perex, so there the
// order is Title → Tags → Image → Content. Each tag links to its public
// cross-category page /tag/<slug>.
function detailTagsHtml(tags) {
  const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!list.length) return '';
  const en = window.getLang ? window.getLang() === 'en' : false;
  const chip = (tg) => en && tg.name_en && tg.name_en.trim() ? tg.name_en : (tg.name || '');
  return `<div class="detail-tags">${list.map(tg => `<a class="detail-tag" href="/tag/${esc(tg.slug)}">#${esc(chip(tg))}</a>`).join('')}</div>`;
}

async function renderTextDetail(slug) {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const t = await safeFetch(`/api/texts/${encodeURIComponent(slug)}` + langParam());
    app.setContent(`
      <div class="detail-page">
        <div class="detail-page__inner">
          <a href="/texty" class="back-link">${i('back.texts')}</a>
          <div class="detail-header">
            ${t.category ? `<span class="detail-category">${esc(t.category)}</span>` : ''}
            <h1 class="detail-title">${esc(t.title)}</h1>
            <hr class="ornament-line">
            <div class="detail-meta">${fmtDate(t.published_at || t.created_at)}</div>
          </div>
          ${detailExcerptHtml(t.excerpt)}
          ${detailTagsHtml(t.tags)}
          ${t.cover_image ? `<div class="detail-cover"><img src="${esc(t.cover_image)}" alt="${esc(t.title)}"></div>` : ''}
          <div class="text-content">${t.content || '<p>' + i('content.unavailable') + '</p>'}</div>
        </div>
      </div>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.notFound')}</h3><p>${esc(err.message)}</p></div></div></div>`);
  }
}

// ============================================================
// Artworks section
// ============================================================
async function renderArtworksList() {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const items = await safeFetch('/api/artworks' + langParam());
    if (!items.length) {
      return app.setContent(`<div class="detail-page"><div class="detail-page__inner"><div class="empty-state"><h3>${i('empty.artworks')}</h3></div></div></div>`);
    }
    app.setContent(`
      <section class="section">
        <div class="section-inner">
          <div class="section-header">
            <h1 class="section-title">${i('home.section.art')}</h1>
            <hr class="ornament-line">
          </div>
          <div class="gallery-grid">
            ${items.map(a => renderArtworkGalleryItem(a)).join('')}
          </div>
        </div>
      </section>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.generic')}</h3><p>${esc(err.message)}</p></div></div></div>`);
  }
}

async function renderArtworkDetail(slug) {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const a = await safeFetch(`/api/artworks/${encodeURIComponent(slug)}` + langParam());
    let images = [];
    try { images = JSON.parse(a.images_json || '[]'); } catch {}

    app.setContent(`
      <div class="detail-page">
        <div class="detail-page__inner">
          <a href="/umeni" class="back-link">${i('back.art')}</a>
          <div class="detail-header">
            ${a.collection ? `<span class="detail-category">${esc(a.collection)}</span>` : ''}
            <h1 class="detail-title">${esc(a.title)}</h1>
            <hr class="ornament-line">
            ${a.medium || a.year ? `<div class="detail-meta">${[a.medium, a.year].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
          </div>
          ${detailTagsHtml(a.tags)}
          ${a.cover_image ? `<div class="detail-cover"><img src="${esc(a.cover_image)}" alt="${esc(a.title)}"></div>` : ''}
          ${a.description ? `<div class="text-content"><p>${esc(a.description)}</p></div>` : ''}
          ${images.length > 1 ? `
          <div class="carousel" style="margin-top:3rem;max-width:900px;margin-left:auto;margin-right:auto">
            <div class="carousel-track">
              ${images.map(img => `<div class="carousel-slide"><img src="${esc(img)}" alt="${esc(a.title)}" loading="lazy"></div>`).join('')}
            </div>
          </div>` : ''}
        </div>
      </div>
      <div class="lightbox-overlay hidden" id="lightbox" onclick="closeLightbox()">
        <span class="lightbox-close" onclick="closeLightbox()">×</span>
        <img class="lightbox-img" id="lightboxImg" src="" alt="">
      </div>`);
    if (window.initCarousels) window.initCarousels();
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.notFound')}</h3><p>${esc(err.message)}</p></div></div></div>`);
  }
}

// ============================================================
// Jewelry section
// ============================================================
async function renderJewelryList() {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const items = await safeFetch('/api/jewelry' + langParam());
    const intro = await pageIntro('kresba');
    app.setContent(`
      <section class="section">
        <div class="section-inner">
          <div class="section-header">
            <h1 class="section-title">${i('nav.drawing')}</h1>
            <hr class="ornament-line">
            ${intro}
          </div>
          ${items.length
            ? `<div class="jewelry-grid">${items.map(j => renderJewelryItem(j)).join('')}</div>`
            : `<div class="empty-state"><h3>${i('empty.artworks')}</h3></div>`}
        </div>
      </section>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.generic')}</h3><p>${esc(err.message)}</p></div></div></div>`);
  }
}

async function renderJewelryDetail(slug) {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const j = await safeFetch(`/api/jewelry/${encodeURIComponent(slug)}` + langParam());
    let images = [];
    try { images = JSON.parse(j.images_json || '[]'); } catch {}

    app.setContent(`
      <div class="detail-page">
        <div class="detail-page__inner">
          <a href="/kresba" class="back-link">${i('back.drawing')}</a>
          <div class="detail-header">
            ${j.collection ? `<span class="detail-category">${esc(j.collection)}</span>` : ''}
            <h1 class="detail-title">${esc(j.title)}</h1>
            <hr class="ornament-line">
          </div>
          ${detailTagsHtml(j.tags)}
          ${j.cover_image ? `<div class="detail-cover" style="max-width:600px;aspect-ratio:1"><img src="${esc(j.cover_image)}" alt="${esc(j.title)}"></div>` : ''}
          <div class="text-content" style="margin-top:2rem">
            ${j.description ? `<p>${esc(j.description)}</p>` : ''}
            ${j.materials ? `<p><strong>${i('jewelry.materials')}:</strong> ${esc(j.materials)}</p>` : ''}
            ${j.dimensions ? `<p><strong>${i('jewelry.dimensions')}:</strong> ${esc(j.dimensions)}</p>` : ''}
            <span class="jewelry-badge ${j.is_available ? 'jewelry-badge--available' : 'jewelry-badge--unavailable'}">
              ${j.is_available ? i('jewelry.available') : i('jewelry.currentlyUnavailable')}
            </span>
          </div>
          ${images.length > 1 ? `
          <div class="carousel" style="margin-top:3rem;max-width:600px;margin-left:auto;margin-right:auto">
            <div class="carousel-track">
              ${images.map(img => `<div class="carousel-slide"><img src="${esc(img)}" alt="${esc(j.title)}" loading="lazy"></div>`).join('')}
            </div>
          </div>` : ''}
        </div>
      </div>
      <div class="lightbox-overlay hidden" id="lightbox" onclick="closeLightbox()">
        <span class="lightbox-close">×</span>
        <img class="lightbox-img" id="lightboxImg" src="" alt="">
      </div>`);
    if (window.initCarousels) window.initCarousels();
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.notFound')}</h3></div></div></div>`);
  }
}

// ============================================================
// Blog section
// ============================================================
async function renderBlogList() {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const items = await safeFetch('/api/blog' + langParam());
    const intro = await pageIntro('blog');
    app.setContent(`
      <section class="section">
        <div class="section-inner">
          <div class="section-header">
            <h1 class="section-title">${i('nav.blog')}</h1>
            <hr class="ornament-line">
            ${intro}
          </div>
          ${items.length
            ? `<div class="content-grid content-grid--3">${items.map((b, i) => renderBlogCard(b, i)).join('')}</div>`
            : `<div class="empty-state"><h3>${i('empty.blog')}</h3></div>`}
        </div>
      </section>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.generic')}</h3></div></div></div>`);
  }
}

async function renderBlogPost(slug) {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const b = await safeFetch(`/api/blog/${encodeURIComponent(slug)}` + langParam());
    app.setContent(`
      <div class="detail-page">
        <div class="detail-page__inner">
          <a href="/blog" class="back-link">${i('back.blog')}</a>
          <div class="detail-header">
            <span class="detail-category">${i('nav.blog')}</span>
            <h1 class="detail-title">${esc(b.title)}</h1>
            <hr class="ornament-line">
            <div class="detail-meta">${fmtDate(b.published_at || b.created_at)}</div>
          </div>
          ${detailExcerptHtml(b.excerpt)}
          ${detailTagsHtml(b.tags)}
          ${b.cover_image ? `<div class="detail-cover"><img src="${esc(b.cover_image)}" alt="${esc(b.title)}"></div>` : ''}
          <div class="text-content">${b.content || '<p>' + i('content.unavailable') + '</p>'}</div>
        </div>
      </div>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.notFound')}</h3></div></div></div>`);
  }
}

// ============================================================
// Programming section
// ============================================================
async function renderProgrammingList() {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const items = await safeFetch('/api/programming' + langParam());
    const intro = await pageIntro('programovani');
    app.setContent(`
      <section class="section">
        <div class="section-inner">
          <div class="section-header">
            <h1 class="section-title">${i('nav.programming')}</h1>
            <hr class="ornament-line">
            ${intro}
          </div>
          ${items.length
            ? `<div class="content-grid content-grid--3">${items.map((b, i) => renderProgrammingCard(b, i)).join('')}</div>`
            : `<div class="empty-state"><h3>${i('empty.programming')}</h3></div>`}
        </div>
      </section>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.generic')}</h3></div></div></div>`);
  }
}

async function renderProgrammingPost(slug) {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const b = await safeFetch(`/api/programming/${encodeURIComponent(slug)}` + langParam());
    app.setContent(`
      <div class="detail-page">
        <div class="detail-page__inner">
          <a href="/programovani" class="back-link">${i('back.programming')}</a>
          <div class="detail-header">
            <span class="detail-category">${i('nav.programming')}</span>
            <h1 class="detail-title">${esc(b.title)}</h1>
            <hr class="ornament-line">
            <div class="detail-meta">${fmtDate(b.published_at || b.created_at)}</div>
          </div>
          ${detailExcerptHtml(b.excerpt)}
          ${detailTagsHtml(b.tags)}
          ${b.cover_image ? `<div class="detail-cover"><img src="${esc(b.cover_image)}" alt="${esc(b.title)}"></div>` : ''}
          <div class="text-content">${b.content || '<p>' + i('content.unavailable') + '</p>'}</div>
        </div>
      </div>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.notFound')}</h3></div></div></div>`);
  }
}

// ============================================================
// Friends section
// ============================================================
async function renderFriendsIndex() {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const items = await safeFetch('/api/friends' + langParam());
    const intro = await pageIntro('pratele');
    app.setContent(`
      <section class="section">
        <div class="section-inner">
          <div class="section-header">
            <h1 class="section-title">${i('nav.friends')}</h1>
            <hr class="ornament-line">
            ${intro}
            <p class="section-subtitle">${i('home.friendsSubtitle')}</p>
          </div>
          ${items.length
            ? `<div class="friend-grid">${items.map(f => renderFriendCard(f)).join('')}</div>`
            : `<div class="empty-state"><h3>${i('empty.friends')}</h3></div>`}
        </div>
      </section>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.generic')}</h3></div></div></div>`);
  }
}

async function renderFriendPage(friendSlug) {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const { friend, posts } = await safeFetch(`/api/friend-posts/by-friend/${encodeURIComponent(friendSlug)}` + langParam());
    const initials = esc(friend.name).split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    app.setContent(`
      <div class="detail-page">
        <div class="detail-page__inner">
          <a href="/pratele" class="back-link">${i('back.friends')}</a>
          <div class="detail-header" style="display:flex;align-items:center;gap:2rem;text-align:left;justify-content:flex-start;margin-bottom:3rem">
            ${friend.avatar
              ? `<img src="${esc(friend.avatar)}" alt="${esc(friend.name)}" style="width:96px;height:96px;border-radius:50%;object-fit:cover">`
              : `<div class="friend-avatar-placeholder" style="width:96px;height:96px;font-size:2.2rem">${initials}</div>`}
            <div>
              <h1 class="detail-title" style="font-size:clamp(1.8rem,5vw,3rem)">${esc(friend.name)}</h1>
              ${friend.short_bio ? `<p style="font-family:var(--font-body);font-weight:300;color:var(--ink-mid);margin-top:0.5rem">${esc(friend.short_bio)}</p>` : ''}
            </div>
          </div>
          ${friend.bio ? `<div class="text-content" style="margin-bottom:3rem"><p>${esc(friend.bio)}</p></div>` : ''}
          ${posts.length ? `
          <h2 class="section-title" style="font-size:clamp(1.5rem,3vw,2.2rem);margin-bottom:2rem">${i('friends.posts')}</h2>
          <div class="content-grid content-grid--3">
            ${posts.map((p, i) => `
              <div class="card" onclick="app.navigate('/pratele/${esc(friendSlug)}/${esc(p.slug)}')">
                <div class="card-body">
                  <span class="card-category">${esc(p.type)}</span>
                  <h3 class="card-title">${esc(p.title)}</h3>
                  ${p.excerpt ? `<p class="card-excerpt">${esc(p.excerpt)}</p>` : ''}
                </div>
                ${p.cover_image ? cardImgHtml(p.cover_image, p.title, cardLoading(i)) : ''}
                <div class="card-meta">${fmtDate(p.published_at || p.created_at)}</div>
              </div>`).join('')}
          </div>` : `<div class="empty-state"><h3>${i('empty.posts')}</h3></div>`}
        </div>
      </div>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.notFound')}</h3></div></div></div>`);
  }
}

async function renderFriendPost(friendSlug, postSlug) {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const post = await safeFetch(`/api/friend-posts/${encodeURIComponent(postSlug)}` + langParam());
    let images = [];
    try { images = JSON.parse(post.images_json || '[]'); } catch {}

    app.setContent(`
      <div class="detail-page">
        <div class="detail-page__inner">
          <a href="/pratele/${esc(friendSlug)}" class="back-link">${i('back.backTo')} ${esc(post.friend_name)}</a>
          <div class="detail-header">
            <span class="detail-category">${esc(post.friend_name)} · ${esc(post.type)}</span>
            <h1 class="detail-title">${esc(post.title)}</h1>
            <hr class="ornament-line">
            <div class="detail-meta">${fmtDate(post.published_at || post.created_at)}</div>
          </div>
          ${detailExcerptHtml(post.excerpt)}
          ${detailTagsHtml(post.tags)}
          ${post.cover_image ? `<div class="detail-cover"><img src="${esc(post.cover_image)}" alt="${esc(post.title)}"></div>` : ''}
          ${post.content ? `<div class="text-content">${post.content}</div>` : ''}
          ${images.length > 1 ? `
          <div class="carousel" style="margin-top:3rem;max-width:900px;margin-left:auto;margin-right:auto">
            <div class="carousel-track">
              ${images.map(img => `<div class="carousel-slide"><img src="${esc(img)}" alt="${esc(post.title)}" loading="lazy"></div>`).join('')}
            </div>
          </div>` : images.length === 1 ? `
          <div style="margin-top:3rem;max-width:900px;margin-left:auto;margin-right:auto">
            <img src="${esc(images[0])}" alt="${esc(post.title)}" style="width:100%;border-radius:var(--radius)">
          </div>` : ''}
        </div>
      </div>`);
    // Init carousels after content is set
    if (window.initCarousels) window.initCarousels();
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.notFound')}</h3></div></div></div>`);
  }
}

// ============================================================
// Tags (global, cross-category)
// ============================================================
// A tag page lists published items from every content section (texts, art,
// jewelry, blog, programming, friends' posts). The backend already filters to
// published-only content and provides each item's public URL + section label.
const TAG_SECTION_KEYS = {
  texty:        'nav.texts',
  umeni:        'home.section.art',
  kresba:       'nav.drawing',
  blog:         'nav.blog',
  programovani: 'nav.programming',
  pratele:      'nav.friends',
};

function tagItemLabel(item) {
  if (item.content_type === 'friend_post' && item.author) return item.author;
  const key = TAG_SECTION_KEYS[item.section];
  const label = key && window.t ? window.t(key) : '';
  return label && label !== key ? label : (item.section || '');
}

async function renderTagPage(slug) {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const data = await safeFetch(`/api/tags/${encodeURIComponent(slug)}` + langParam());
    app.setContent(`
      <section class="section">
        <div class="section-inner">
          <div class="section-header">
            <h1 class="section-title">#${esc(data.tag.name)}</h1>
            <hr class="ornament-line">
          </div>
          ${data.items.length
            ? `<div class="content-grid content-grid--3">${data.items.map((item, i) => `
              <div class="card" onclick="app.navigate('${esc(item.url)}')">
                <div class="card-body">
                  <span class="card-category">${esc(tagItemLabel(item))}</span>
                  <h3 class="card-title">${esc(item.title)}</h3>
                  ${item.excerpt ? `<p class="card-excerpt">${esc(item.excerpt)}</p>` : ''}
                </div>
                ${item.cover_image ? cardImgHtml(item.cover_image, item.title, cardLoading(i)) : ''}
                <div class="card-meta">${fmtDate(item.published_at || item.created_at)}</div>
              </div>`).join('')}</div>`
            : `<div class="empty-state"><h3>${i('empty.tags')}</h3><p>${i('empty.tagsDesc')}</p></div>`}
        </div>
      </section>`);
  } catch (err) {
    app.setContent(`<div class="section"><div class="section-inner"><div class="empty-state"><h3>${i('error.notFound')}</h3><p>${esc(err.message)}</p></div></div></div>`);
  }
}

// ============================================================
// About page
// ============================================================
async function renderAbout() {
  app.showLoading();
  const i = window.t || (k => k);
  try {
    const s = await safeFetch('/api/settings/public' + langParam());
    const intro = await pageIntro('o-mne');
    app.setContent(`
      <div class="detail-page">
        <div class="detail-page__inner">
          <div class="about-split" style="padding-top:2rem">
            ${s.about_image ? `
            <div class="about-image">
              <img src="${esc(s.about_image)}" alt="${esc(s.owner_name || i('nav.about'))}">
            </div>` : ''}
            <div class="about-text">
              <span class="detail-category">${i('nav.about')}</span>
              <h1 class="detail-title" style="font-size:clamp(2rem,5vw,3.5rem)">${esc(s.owner_name || i('nav.about'))}</h1>
              <hr class="ornament-line ornament-line--left">
              ${intro}
              ${s.about_text ? `<div class="text-content"><p>${esc(s.about_text)}</p></div>` : ''}
              ${s.social_instagram || s.social_twitter ? `
              <div class="footer-social" style="margin-top:2rem">
                ${s.social_instagram ? `<a href="${esc(s.social_instagram)}" target="_blank" rel="noopener" aria-label="Instagram">IG</a>` : ''}
                ${s.social_twitter ? `<a href="${esc(s.social_twitter)}" target="_blank" rel="noopener" aria-label="Twitter">TW</a>` : ''}
              </div>` : ''}
            </div>
          </div>
        </div>
      </div>`);
  } catch {
    app.setContent(`<div class="detail-page"><div class="detail-page__inner"><div class="empty-state"><h3>${i('nav.about')}</h3></div></div></div>`);
  }
}

// ============================================================
// Contact page
// ============================================================
async function renderContact() {
  app.showLoading();
  const i = window.t || (k => k);
  const formLoadedAt = Date.now();
  let intro = '';
  try {
    intro = (await pageIntro('kontakt')) || '';
  } catch {
    intro = '';
  }
  app.setContent(`
    <div class="detail-page">
      <div class="detail-page__inner">
        <div class="contact-section">
          <span class="detail-category">${i('nav.contact')}</span>
          <h1 class="detail-title" style="font-size:clamp(2rem,5vw,3.5rem)">${i('contact.writeMessage')}</h1>
          <hr class="ornament-line">
          ${intro}
          <p style="font-family:var(--font-body);font-weight:300;color:var(--ink-mid);margin-bottom:2.5rem">
            ${i('contact.description')}
          </p>
          <div id="contactResult"></div>
          <form id="contactForm" novalidate>
            <input type="text" name="website" style="position:absolute;left:-9999px;opacity:0;height:0" tabindex="-1" autocomplete="off">
            <div class="form-group">
              <label class="form-label" for="cName">${i('contact.name')}</label>
              <input class="form-input" type="text" id="cName" name="name" required maxlength="100" placeholder="${i('contact.namePlaceholder')}">
            </div>
            <div class="form-group">
              <label class="form-label" for="cEmail">${i('contact.email')}</label>
              <input class="form-input" type="email" id="cEmail" name="email" required maxlength="200" placeholder="${i('contact.emailPlaceholder')}">
            </div>
            <div class="form-group">
              <label class="form-label" for="cSubject">${i('contact.subject')}</label>
              <input class="form-input" type="text" id="cSubject" name="subject" maxlength="200" placeholder="${i('contact.subjectPlaceholder')}">
            </div>
            <div class="form-group">
              <label class="form-label" for="cMessage">${i('contact.message')}</label>
              <textarea class="form-textarea" id="cMessage" name="message" required maxlength="5000" placeholder="${i('contact.messagePlaceholder')}"></textarea>
            </div>
            <button class="btn btn-primary" type="submit" id="contactSubmit">${i('contact.send')}</button>
          </form>
        </div>
      </div>
    </div>`);

  const form = document.getElementById('contactForm');
  if (!form) return;

  let sending = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('contactSubmit');
    const resultEl = document.getElementById('contactResult');
    if (sending) return;

    const name    = form.elements.name.value.trim();
    const email   = form.elements.email.value.trim();
    const message = form.elements.message.value.trim();
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!name)                         return showContactError(resultEl, i('contact.error.name'));
    if (name.length > 100)             return showContactError(resultEl, i('contact.error.nameLong'));
    if (!email || !EMAIL_RE.test(email)) return showContactError(resultEl, i('contact.error.email'));
    if (!message || message.length < 10) return showContactError(resultEl, i('contact.error.message'));
    if (message.length > 5000)         return showContactError(resultEl, i('contact.error.messageLong'));

    sending = true;
    btn.disabled = true;
    btn.textContent = i('contact.sending');
    resultEl.innerHTML = '';

    try {
      const body = {
        name,
        email,
        subject:        form.elements.subject?.value?.trim() || '',
        message,
        website:        form.elements.website?.value || '',
        form_loaded_at: formLoadedAt,
      };

      const response = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const contentType = response.headers.get('content-type');

      if (!response.ok) {
        const err = contentType?.includes('application/json')
          ? await response.json()
          : { error: await response.text() };
        throw new Error(err.error || i('contact.sendError'));
      }

      resultEl.innerHTML = `<div class="form-success">${i('contact.success')}</div>`;
      form.reset();
    } catch (err) {
      showContactError(resultEl, err.message || i('contact.sendError'));
    } finally {
      sending = false;
      btn.disabled = false;
      btn.textContent = i('contact.send');
    }
  });
}

function showContactError(resultEl, message) {
  if (!resultEl) return;
  resultEl.innerHTML = `<div class="form-error">${esc(message)}</div>`;
}

// ============================================================
// 404
// ============================================================
function render404() {
  const i = window.t || (k => k);
  app.setContent(`
    <div class="detail-page">
      <div class="detail-page__inner" style="text-align:center">
        <h1 class="detail-title" style="color:var(--ink-dim)">404</h1>
        <p style="font-family:var(--font-body);color:var(--ink-mid)">${i('error.pageNotFound')}</p>
        <div style="margin-top:2rem"><a href="/" class="btn btn-ghost">${i('back.home')}</a></div>
      </div>
    </div>`);
}

// ============================================================
// Menu sync — respect category/page visibility in public nav
// ============================================================
// Hidden items are not rendered in public navigation while their
// content stays intact and reachable via direct URL.
async function syncPublicNav() {
  try {
    const response = await fetch('/api/pages');
    const contentType = response.headers.get('content-type');
    if (!response.ok) {
      const err = contentType?.includes('application/json') ? await response.json() : { error: await response.text() };
      throw new Error(err.error || 'Request failed');
    }
    if (!contentType?.includes('application/json')) throw new Error('Server returned non-JSON response');
    const pages = await response.json();
    if (!Array.isArray(pages) || !pages.length) return;

    const knownSlugs = new Set(pages.map(p => p.slug));
    const visibleSlugs = new Set(
      pages.filter(p => p.is_visible && Number(p.category_is_visible) !== 0).map(p => p.slug)
    );

    // Drop menu links we appended earlier whose page no longer exists (the
    // admin deleted it) — the navigation must never point at a dead destination.
    document.querySelectorAll(
      '#desktopNav a[data-menu-page], #mobileNav a[data-menu-page]'
    ).forEach(a => {
      const first = (a.getAttribute('href') || '').split('/').filter(Boolean)[0];
      if (first && !knownSlugs.has(first)) a.remove();
    });

    // Hide any nav link whose first path segment maps to a hidden page or a
    // hidden category (applies to the static menu AND to appended items).
    document.querySelectorAll(
      '#desktopNav > a, #desktopNav .nav-item--dropdown > a, .nav-mobile a[href], .site-footer a[href], .site-footer__inner a[href]'
    ).forEach(a => {
      const first = (a.getAttribute('href') || '').split('/').filter(Boolean)[0];
      if (!first || !knownSlugs.has(first)) return;
      a.classList.toggle('nav-hidden', !visibleSlugs.has(first));
    });
    // Desktop dropdown wrapper follows its parent heading
    const dropdown = document.querySelector('#desktopNav .nav-item--dropdown');
    if (dropdown) dropdown.classList.toggle('nav-hidden', !visibleSlugs.has('texty'));

    // Append newly visible menu pages (e.g. a page created via the admin) to
    // desktop + mobile navigation, ordered by sort_order.
    const additions = pages
      .filter(p => visibleSlugs.has(p.slug))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id - b.id));

    const desktopNav = document.getElementById('desktopNav');
    const mobileNav = document.getElementById('mobileNav');
    const navEn = window.getLang ? window.getLang() === 'en' : false;
    additions.forEach(p => {
      const csTitle = (p.title && p.title.trim()) ? p.title.trim() : '';
      const enTitle = (p.title_en && p.title_en.trim()) ? p.title_en.trim() : '';
      const title = (navEn ? (enTitle || csTitle) : csTitle) || p.slug;
      const existsDesktop = desktopNav && desktopNav.querySelector(`a[href="/${p.slug}"]`);
      if (!existsDesktop) {
        const link = document.createElement('a');
        link.href = `/${p.slug}`;
        link.textContent = title;
        link.dataset.menuPage = '1';
        desktopNav?.appendChild(link);
      }
      const existsMobile = mobileNav && mobileNav.querySelector(`a[href="/${p.slug}"]`);
      if (!existsMobile) {
        const link = document.createElement('a');
        link.href = `/${p.slug}`;
        link.textContent = title;
        link.dataset.menuPage = '1';
        mobileNav?.appendChild(link);
      }
    });

    // ── Texty subcategories (data-driven) ────────────────────────────
    // Built from /api/categories/public/all: any visible category with a
    // page_slug becomes a dropdown entry under its parent menu page. Hidden
    // subcategories are simply not rendered (their URLs still work via the
    // router). Links are rebuilt on every sync so renamed/hidden/new ones are
    // reflected and stale ones are removed.
    let categories = [];
    try {
      const cResp = await fetch('/api/categories/public/all');
      const cCt = cResp.headers.get('content-type');
      if (cResp.ok && cCt?.includes('application/json')) categories = await cResp.json();
    } catch { /* non-fatal */ }

    const tFn = window.t || (k => k);
    const children = (categories || [])
      .filter(c => c.page_slug && c.is_visible)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id - b.id));
    const subLabel = (c) => categoryLabel(c, tFn);

    document.querySelectorAll('#desktopNav .nav-dropdown a[data-subcat]').forEach(n => n.remove());
    document.querySelectorAll('#mobileNav a.nav-mobile-sub[data-subcat]').forEach(n => n.remove());

    const subDropdown = document.querySelector('#desktopNav .nav-dropdown');
    if (subDropdown) {
      for (const c of children) {
        const link = document.createElement('a');
        link.href = `/${c.page_slug}/${c.slug}`;
        link.textContent = subLabel(c);
        link.dataset.subcat = '1';
        subDropdown.appendChild(link);
      }
      // Avoid an empty popup when the parent page has no visible subcategories.
      subDropdown.classList.toggle('nav-hidden', children.length === 0);
    }

    const textsAnchor = mobileNav && mobileNav.querySelector('a[href="/texty"]');
    if (textsAnchor) {
      let ref = textsAnchor;
      for (const c of children) {
        const link = document.createElement('a');
        link.href = `/${c.page_slug}/${c.slug}`;
        link.textContent = subLabel(c);
        link.dataset.subcat = '1';
        link.className = 'nav-mobile-sub';
        ref.after(link);
        ref = link;
      }
    }
  } catch {
    // Non-fatal: keep the static menu as-is when the sync fails
  }
}

// ============================================================
// Lightbox
// ============================================================
function openLightbox(src, alt) {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  if (lb && img) {
    img.src = src;
    img.alt = alt || '';
    lb.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) {
    lb.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// Expose globally for onclick handlers
Object.assign(window, { app, openLightbox, closeLightbox, syncPublicNav, updateStaticI18n, renderHomepage, renderTextsList, renderTextsFiltered, renderTextRoute, renderTextDetail,
  renderArtworksList, renderArtworkDetail, renderJewelryList, renderJewelryDetail,
  renderBlogList, renderBlogPost, renderProgrammingList, renderProgrammingPost,
  renderFriendsIndex, renderFriendPage, renderFriendPost,
  renderAbout, renderContact, renderTagPage });

// Attach router methods to app
Object.assign(app, { renderHomepage, renderTextsList, renderTextsFiltered, renderTextRoute, renderTextDetail,
  renderArtworksList, renderArtworkDetail, renderJewelryList, renderJewelryDetail,
  renderBlogList, renderBlogPost, renderProgrammingList, renderProgrammingPost,
  renderFriendsIndex, renderFriendPage, renderFriendPost,
  renderAbout, renderContact, render404, renderTagPage });

// ── Init ──────────────────────────────────────────────────────
if (window.initLang) window.initLang();
updateStaticI18n();

window.addEventListener('langchange', () => {
  updateStaticI18n();
  syncPublicNav();
  app.route(location.pathname);
});

app.route(location.pathname);

// Apply menu visibility to the public navigation (non-fatal)
syncPublicNav();
