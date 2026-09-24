// ── MenuManager — categories + menu items/pages management (Přehled) ─────
// Manages:
//   - categories (Název / Viditelnost / Akce)
//   - menu items / pages (Název / Kategorie / Viditelnost / Akce)
// Hiding is a visibility state, never a deletion. Hidden items disappear from
// the public navigation but their content stays intact and directly reachable.

export class MenuManager {
  constructor(auth, admin) {
    this.auth = auth;
    this.admin = admin;
    this.categories = [];
    this.pages = [];
    this.editCategoryId = null;
    this.editPage = null;
  }

  async init() {
    try {
      await Promise.all([this.loadCategories(), this.loadPages()]);
      this.render();
    } catch (err) {
      this.admin.showNotification(`Chyba načítání menu: ${err.message}`, 'error');
    }
  }

  async loadCategories() {
    const response = await fetch('/api/categories/admin/all', { headers: this.auth.getAuthHeaders() });
    const ct = response.headers.get('content-type');
    if (!response.ok) {
      const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
      throw new Error(err.error || 'Request failed');
    }
    if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
    this.categories = await response.json();
  }

  async loadPages() {
    const response = await fetch('/api/pages', { headers: this.auth.getAuthHeaders() });
    const ct = response.headers.get('content-type');
    if (!response.ok) {
      const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
      throw new Error(err.error || 'Request failed');
    }
    if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
    this.pages = await response.json();
  }

  categoryName(id) {
    const cat = this.categories.find(c => c.id === id);
    return cat ? cat.name : '';
  }

  render() {
    this.renderCategories();
    this.renderPages();
  }

  renderCategories() {
    const tbody = document.querySelector('#menuCategoriesTable tbody');
    if (!tbody) return;
    if (!this.categories.length) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--ink-dim);padding:2rem">Žádné kategorie — přidejte první.</td></tr>`;
      return;
    }
    tbody.innerHTML = this.categories.map(c => `
      <tr>
        <td class="td-title">${escHtml(c.name)}</td>
        <td><span class="badge ${c.is_visible ? 'badge-published' : 'badge-draft'}">${c.is_visible ? 'Viditelná' : 'Skrytá'}</span></td>
        <td class="td-actions">
          <button class="btn-admin btn-admin--outline btn-admin--sm" onclick="window.admin.managers.menu.openCategoryModal(${c.id})">Upravit</button>
          <button class="btn-admin ${c.is_visible ? 'btn-admin--outline' : 'btn-admin--primary'} btn-admin--sm" onclick="window.admin.managers.menu.toggleCategoryVisibility(${c.id})">${c.is_visible ? 'Skrýt' : 'Zobrazit'}</button>
        </td>
      </tr>`).join('');
  }

  renderPages() {
    const tbody = document.querySelector('#menuItemsTable tbody');
    if (!tbody) return;
    if (!this.pages.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--ink-dim);padding:2rem">Žádné položky.</td></tr>`;
      return;
    }
    const hiddenCat = new Set(this.categories.filter(c => !c.is_visible).map(c => c.id));
    tbody.innerHTML = this.pages.map(p => {
      const catInvisible = p.category_id != null && hiddenCat.has(p.category_id);
      const rowVisible = p.is_visible && !catInvisible;
      return `
      <tr>
        <td class="td-title">
          ${escHtml(p.title || p.slug)}
          <div style="font-weight:400;color:var(--ink-dim);font-size:0.75rem">/${escHtml(p.slug)}</div>
        </td>
        <td>${p.category_id ? `${escHtml(this.categoryName(p.category_id))}${catInvisible ? ' <span class="badge badge-draft">skrytá</span>' : ''}` : '<span style="color:var(--ink-dim)">—</span>'}</td>
        <td><span class="badge ${rowVisible ? 'badge-published' : 'badge-draft'}">${rowVisible ? 'Viditelná' : 'Skrytá'}</span></td>
        <td class="td-actions">
          <button class="btn-admin btn-admin--outline btn-admin--sm" onclick="window.admin.managers.menu.openPageModal(${p.id})">Upravit</button>
          <button class="btn-admin ${rowVisible ? 'btn-admin--outline' : 'btn-admin--primary'} btn-admin--sm" onclick="window.admin.managers.menu.togglePageVisibility(${p.id})">${rowVisible ? 'Skrýt' : 'Zobrazit'}</button>
        </td>
      </tr>`;
    }).join('');
  }

  // ── Categories ─────────────────────────────────────────────

  openCategoryModal(id = null) {
    const item = id ? this.categories.find(c => c.id === id) : null;
    this.editCategoryId = id || null;
    const overlay = document.getElementById('categoryModalOverlay');
    const form = document.getElementById('categoryForm');
    if (!overlay || !form) return;

    document.getElementById('categoryModalTitle').textContent = item ? 'Upravit kategorii' : 'Nová kategorie';
    form.elements.name.value = item?.name || '';
    form.elements.sort_order.value = item?.sort_order ?? 0;
    form.elements.is_visible.checked = item ? !!item.is_visible : true;

    if (!form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveCategory();
      });
    }
    overlay.classList.remove('hidden');
  }

  async saveCategory() {
    const form = document.getElementById('categoryForm');
    if (!form) return;
    const body = {
      name: form.elements.name.value.trim(),
      sort_order: Number(form.elements.sort_order.value) || 0,
      is_visible: form.elements.is_visible.checked ? 1 : 0,
    };
    if (!body.name) {
      this.admin.showNotification('Název kategorie je povinný', 'error');
      return;
    }
    try {
      const url = this.editCategoryId ? `/api/categories/${this.editCategoryId}` : '/api/categories';
      const response = await fetch(url, {
        method: this.editCategoryId ? 'PUT' : 'POST',
        headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!ct?.includes('application/json')) throw new Error('Non-JSON response');

      this.closeCategoryModal();
      this.admin.showNotification(this.editCategoryId ? 'Kategorie uložena' : 'Kategorie vytvořena');
      await this.loadCategories();
      this.render();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  async toggleCategoryVisibility(id) {
    const cat = this.categories.find(c => c.id === id);
    if (!cat) return;
    try {
      const response = await fetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_visible: cat.is_visible ? 0 : 1 }),
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      this.admin.showNotification(cat.is_visible ? 'Kategorie skryta' : 'Kategorie zobrazena');
      await this.loadCategories();
      this.render();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  closeCategoryModal() {
    document.getElementById('categoryModalOverlay')?.classList.add('hidden');
  }

  // ── Menu items / pages ────────────────────────────────────

  openPageModal(id = null) {
    const item = id ? this.pages.find(p => p.id === id) : null;
    this.editPage = item || null;
    const overlay = document.getElementById('menuPageModalOverlay');
    const form = document.getElementById('menuPageForm');
    if (!overlay || !form) return;

    document.getElementById('menuPageModalTitle').textContent = item ? 'Upravit položku menu' : 'Nová položka menu';

    // Category options
    const select = form.elements.category_id;
    select.innerHTML = '<option value="">— bez kategorie —</option>' +
      this.categories.map(c => `<option value="${c.id}">${escHtml(c.name)}${c.is_visible ? '' : ' (skrytá)'}</option>`).join('');

    form.elements.title.value = item?.title || '';
    form.elements.slug.value = item?.slug || '';
    form.elements.slug.disabled = !!item; // slug/URL is fixed after creation
    select.value = item?.category_id ?? '';
    form.elements.sort_order.value = item?.sort_order ?? 0;
    form.elements.is_visible.checked = item ? !!item.is_visible : true;

    if (!form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.savePage();
      });
    }
    overlay.classList.remove('hidden');
  }

  async savePage() {
    const form = document.getElementById('menuPageForm');
    if (!form) return;
    const body = {
      title: form.elements.title.value.trim(),
      category_id: form.elements.category_id.value ? Number(form.elements.category_id.value) : null,
      sort_order: Number(form.elements.sort_order.value) || 0,
      is_visible: form.elements.is_visible.checked ? 1 : 0,
    };
    if (!body.title) {
      this.admin.showNotification('Název je povinný', 'error');
      return;
    }
    try {
      let url, method;
      if (this.editPage) {
        url = `/api/pages/${encodeURIComponent(this.editPage.slug)}`;
        method = 'PUT';
      } else {
        body.slug = form.elements.slug.value.trim().toLowerCase();
        if (!body.slug) {
          this.admin.showNotification('URL je povinná', 'error');
          return;
        }
        url = '/api/pages';
        method = 'POST';
      }
      const response = await fetch(url, {
        method,
        headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!ct?.includes('application/json')) throw new Error('Non-JSON response');

      this.closePageModal();
      this.admin.showNotification(this.editPage ? 'Položka menu uložena' : 'Položka menu vytvořena');
      await this.loadPages();
      this.render();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  async togglePageVisibility(id) {
    const page = this.pages.find(p => p.id === id);
    if (!page) return;
    try {
      const response = await fetch(`/api/pages/${encodeURIComponent(page.slug)}`, {
        method: 'PUT',
        headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_visible: page.is_visible ? 0 : 1 }),
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      this.admin.showNotification(page.is_visible ? 'Položka skryta' : 'Položka zobrazena');
      await this.loadPages();
      this.render();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  closePageModal() {
    document.getElementById('menuPageModalOverlay')?.classList.add('hidden');
  }
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}