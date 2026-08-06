// ── JewelryManager ────────────────────────────────────────────

export class JewelryManager {
  constructor(auth, admin) {
    this.auth  = auth;
    this.admin = admin;
    this.items = [];
  }

  async init() {
    await this.loadItems();
  }

  async loadItems() {
    try {
      const response = await fetch('/api/jewelry/admin/all', {
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
      this.items = await response.json();
      this.renderItems();
    } catch (err) {
      this.admin.showNotification(`Chyba načítání: ${err.message}`, 'error');
    }
  }

  renderItems() {
    const tbody = document.getElementById('jewelryTableBody');
    if (!tbody) return;

    if (!this.items.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-dim);padding:2rem">Žádná díla</td></tr>`;
      return;
    }

    tbody.innerHTML = this.items.map(j => `
      <tr>
        <td class="td-title">${escHtml(j.title)}</td>
        <td>${escHtml(j.collection || '—')}</td>
        <td><span class="badge ${j.is_available ? 'badge-available' : 'badge-unavailable'}">${j.is_available ? 'Dostupný' : 'Nedostupný'}</span></td>
        <td>${j.is_featured ? '<span class="badge badge-featured">Vybrané</span>' : '—'}</td>
        <td><span class="badge ${j.is_published ? 'badge-published' : 'badge-draft'}">${j.is_published ? 'Publikovaný' : 'Koncept'}</span></td>
        <td class="td-actions">
          <button class="btn-admin btn-admin--outline btn-admin--sm" onclick="window.admin.managers.jewelry.showModal(${j.id})">Upravit</button>
          <button class="btn-admin btn-admin--danger btn-admin--sm" onclick="window.admin.managers.jewelry.deleteItem(${j.id})">Smazat</button>
        </td>
      </tr>`).join('');
  }

  showModal(id = null) {
    const item    = id ? this.items.find(j => j.id === id) : null;
    const overlay = document.getElementById('jewelryModalOverlay');
    const titleEl = document.getElementById('jewelryModalTitle');
    const form    = document.getElementById('jewelryForm');
    if (!overlay || !form) return;

    titleEl.textContent = item ? 'Upravit dílo' : 'Nové dílo';

    form.elements.title.value        = item?.title        || '';
    form.elements.description.value  = item?.description  || '';
    form.elements.cover_image.value  = item?.cover_image  || '';
    form.elements.images_json.value  = item?.images_json  || '';
    form.elements.collection.value   = item?.collection   || '';
    form.elements.materials.value    = item?.materials    || '';
    form.elements.dimensions.value   = item?.dimensions   || '';
    form.elements.is_available.checked = item?.is_available !== 0;
    form.elements.is_featured.checked  = !!item?.is_featured;
    form.elements.is_published.checked = !!item?.is_published;
    form.elements.title_en.value       = item?.title_en       || '';
    form.elements.description_en.value = item?.description_en || '';

    // Reset lang tabs to CZ
    const langTabs = form.querySelectorAll('.lang-tab');
    langTabs.forEach(t => t.classList.toggle('active', t.dataset.langPane === 'cs'));
    form.querySelectorAll('.lang-pane--cs').forEach(el => el.style.display = '');
    form.querySelectorAll('.lang-pane--en').forEach(el => el.style.display = 'none');

    overlay.classList.remove('hidden');
    form.dataset.editId = id || '';

    form.onsubmit = async (e) => {
      e.preventDefault();
      await this.saveItem(id);
    };
  }

  async saveItem(id) {
    const form = document.getElementById('jewelryForm');
    if (!form) return;

    const body = {
      title:       form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      cover_image: form.elements.cover_image.value.trim(),
      images_json: form.elements.images_json.value.trim(),
      collection:  form.elements.collection.value.trim(),
      materials:   form.elements.materials.value.trim(),
      dimensions:  form.elements.dimensions.value.trim(),
      is_available: form.elements.is_available.checked ? 1 : 0,
      is_featured:  form.elements.is_featured.checked  ? 1 : 0,
      is_published: form.elements.is_published.checked ? 1 : 0,
      title_en:       form.elements.title_en.value.trim(),
      description_en: form.elements.description_en.value.trim(),
    };

    if (!body.title) { this.admin.showNotification('Název je povinný', 'error'); return; }

    try {
      const url    = id ? `/api/jewelry/${id}` : '/api/jewelry';
      const method = id ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!ct?.includes('application/json')) throw new Error('Non-JSON response');

      this.closeModal();
      this.admin.showNotification(id ? 'Dílo aktualizováno' : 'Dílo vytvořeno');
      await this.loadItems();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  async deleteItem(id) {
    if (!confirm('Opravdu smazat toto dílo?')) return;
    try {
      const response = await fetch(`/api/jewelry/${id}`, {
        method: 'DELETE',
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      this.admin.showNotification('Dílo smazáno');
      await this.loadItems();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  closeModal() {
    document.getElementById('jewelryModalOverlay')?.classList.add('hidden');
  }
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
