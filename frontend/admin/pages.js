// ── PagesManager ───────────────────────────────────────────────

const PAGE_ROUTES = {
  texty:        '/texty',
  kresba:       '/kresba',
  blog:         '/blog',
  programovani: '/programovani',
  pratele:      '/pratele',
  'o-mne':      '/o-mne',
  kontakt:      '/kontakt',
};

export class PagesManager {
  constructor(auth, admin) {
    this.auth  = auth;
    this.admin = admin;
    this.pages = [];
  }

  async init() {
    await this.loadPages();
  }

  async loadPages() {
    try {
      const response = await fetch('/api/pages', {
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
      this.pages = await response.json();
      this.renderPages();
    } catch (err) {
      this.admin.showNotification(`Chyba načítání stránek: ${err.message}`, 'error');
    }
  }

  renderPages() {
    const form = document.getElementById('pagesForm');
    if (!form) return;

    form.innerHTML = this.pages.map(p => `
      <div class="form-group">
        <label class="form-label" for="page_${escHtml(p.slug)}">
          ${escHtml(p.title || p.slug)}
          <span style="font-weight:400;color:var(--ink-dim);font-size:0.75rem">— /${escHtml(PAGE_ROUTES[p.slug] || p.slug)}</span>
        </label>
        <textarea class="form-textarea" id="page_${escHtml(p.slug)}" name="${escHtml(p.slug)}" rows="3" placeholder="Úvodní text stránky (CZ, nepovinné)">${escHtml(p.intro_text || '')}</textarea>
        <label class="form-label" for="page_${escHtml(p.slug)}_en" style="margin-top:0.75rem">
          EN
          <span style="font-weight:400;color:var(--ink-dim);font-size:0.75rem">— anglická verze úvodního textu</span>
        </label>
        <textarea class="form-textarea" id="page_${escHtml(p.slug)}_en" name="${escHtml(p.slug)}_en" rows="3" placeholder="Page intro text (EN, optional)">${escHtml(p.intro_text_en || '')}</textarea>
      </div>`).join('') +
      `<div style="margin-top:1.5rem">
        <button type="submit" class="btn-admin btn-admin--primary">Uložit vše</button>
      </div>`;

    if (!form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveAll(form);
      });
    }
  }

  async saveAll(form) {
    const promises = this.pages.map(p => {
      const el = form.elements[p.slug];
      const elEn = form.elements[p.slug + '_en'];
      return this.savePage(p.slug, el ? el.value : '', elEn ? elEn.value : '');
    });

    try {
      await Promise.all(promises);
      this.admin.showNotification('Úvodní texty stránek uloženy');
      await this.loadPages();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  async savePage(slug, introText, introTextEn = '') {
    const response = await fetch(`/api/pages/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ intro_text: introText, intro_text_en: introTextEn })
    });
    const ct = response.headers.get('content-type');
    if (!response.ok) {
      const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
      throw new Error(err.error || 'Request failed');
    }
    if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
    return await response.json();
  }
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}