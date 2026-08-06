// ── TextsManager ──────────────────────────────────────────────

export class TextsManager {
  constructor(auth, admin) {
    this.auth  = auth;
    this.admin = admin;
    this.items = [];
    this.rte   = null;
    this.rteEn = null;
  }

  async init() {
    await this.loadItems();
  }

  async loadItems() {
    try {
      const response = await fetch('/api/texts/admin/all', {
        headers: this.auth.getAuthHeaders()
      });
      const contentType = response.headers.get('content-type');
      if (!response.ok) {
        const err = contentType?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!contentType?.includes('application/json')) throw new Error('Non-JSON response');
      this.items = await response.json();
      this.renderItems();
    } catch (err) {
      this.admin.showNotification(`Chyba načítání textů: ${err.message}`, 'error');
    }
  }

  renderItems() {
    const tbody = document.getElementById('textsTableBody');
    if (!tbody) return;

    if (!this.items.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-dim);padding:2rem">Žádné texty</td></tr>`;
      return;
    }

    tbody.innerHTML = this.items.map(t => `
      <tr>
        <td class="td-title">${escHtml(t.title)}</td>
        <td>${escHtml(t.category || '—')}</td>
        <td><span class="badge ${t.is_published ? 'badge-published' : 'badge-draft'}">${t.is_published ? 'Publikovaný' : 'Koncept'}</span></td>
        <td>${t.is_featured ? '<span class="badge badge-featured">Vybrané</span>' : '—'}</td>
        <td>${fmtDate(t.created_at)}</td>
        <td class="td-actions">
          <button class="btn-admin btn-admin--outline btn-admin--sm" onclick="window.admin.managers.texts.showModal(${t.id})">Upravit</button>
          <button class="btn-admin btn-admin--danger btn-admin--sm" onclick="window.admin.managers.texts.deleteItem(${t.id})">Smazat</button>
        </td>
      </tr>`).join('');
  }

  showModal(id = null) {
    const item = id ? this.items.find(t => t.id === id) : null;
    const overlay = document.getElementById('textsModalOverlay');
    const title   = document.getElementById('textsModalTitle');
    const form    = document.getElementById('textsForm');
    if (!overlay || !form) return;

    title.textContent = item ? 'Upravit text' : 'Nový text';

    form.elements.title.value        = item?.title       || '';
    form.elements.content.value      = item?.content     || '';
    form.elements.cover_image.value  = item?.cover_image || '';
    form.elements.category.value     = item?.category    || '';
    form.elements.sort_order.value   = item?.sort_order  ?? 0;
    form.elements.is_featured.checked  = !!item?.is_featured;
    form.elements.is_published.checked = item ? !!item.is_published : true;
    form.elements.published_at.value = toLocalDatetime(item?.published_at);
    form.elements.title_en.value     = item?.title_en   || '';
    form.elements.content_en.value   = item?.content_en || '';

    // Reset lang tabs to CZ
    const langTabs = form.querySelectorAll('.lang-tab');
    langTabs.forEach(t => t.classList.toggle('active', t.dataset.langPane === 'cs'));
    form.querySelectorAll('.lang-pane--cs').forEach(el => el.style.display = '');
    form.querySelectorAll('.lang-pane--en').forEach(el => el.style.display = 'none');

    overlay.classList.remove('hidden');

    // Init Rich Text Editors
    if (window.RichTextEditor) {
      if (!this.rte) {
        this.rte = new window.RichTextEditor(form.elements.content);
      }
      this.rte.setValue(item?.content || '');

      if (!this.rteEn) {
        this.rteEn = new window.RichTextEditor(form.elements.content_en);
      }
      this.rteEn.setValue(item?.content_en || '');
    }

    if (!form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveItem(id);
      });
    } else {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await this.saveItem(form.dataset.editId ? Number(form.dataset.editId) : null);
      };
    }
    form.dataset.editId = id || '';
  }

  async saveItem(id) {
    const form = document.getElementById('textsForm');
    if (!form) return;

    const body = {
      title:       form.elements.title.value.trim(),
      excerpt:     '',
      content:     this.rte ? this.rte.getValue() : form.elements.content.value.trim(),
      cover_image: form.elements.cover_image.value.trim(),
      category:    form.elements.category.value.trim(),
      sort_order:  Number(form.elements.sort_order.value) || 0,
      is_featured:  form.elements.is_featured.checked  ? 1 : 0,
      is_published: form.elements.is_published.checked ? 1 : 0,
      published_at: form.elements.published_at.value ? new Date(form.elements.published_at.value).toISOString() : null,
      title_en:    form.elements.title_en.value.trim(),
      excerpt_en:  '',
      content_en:  this.rteEn ? this.rteEn.getValue() : form.elements.content_en.value.trim(),
    };

    if (!body.title) { this.admin.showNotification('Název je povinný', 'error'); return; }

    try {
      const url    = id ? `/api/texts/${id}` : '/api/texts';
      const method = id ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const contentType = response.headers.get('content-type');
      if (!response.ok) {
        const err = contentType?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!contentType?.includes('application/json')) throw new Error('Non-JSON response');

      this.closeModal();
      this.admin.showNotification(id ? 'Text aktualizován' : 'Text vytvořen');
      await this.loadItems();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  async deleteItem(id) {
    if (!confirm('Opravdu smazat tento text?')) return;
    try {
      const response = await fetch(`/api/texts/${id}`, {
        method: 'DELETE',
        headers: this.auth.getAuthHeaders()
      });
      const contentType = response.headers.get('content-type');
      if (!response.ok) {
        const err = contentType?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      this.admin.showNotification('Text smazán');
      await this.loadItems();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  closeModal() {
    document.getElementById('textsModalOverlay')?.classList.add('hidden');
  }
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  try { return new Date(dateStr).toLocaleDateString('cs-CZ'); } catch { return dateStr; }
}

function toLocalDatetime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ''; }
}
