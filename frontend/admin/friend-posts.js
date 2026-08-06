// ── FriendPostsManager ────────────────────────────────────────

export class FriendPostsManager {
  constructor(auth, admin) {
    this.auth    = auth;
    this.admin   = admin;
    this.items   = [];
    this.friends = [];
    this.rte     = null;
    this.rteEn   = null;
  }

  async init() {
    await Promise.all([this.loadFriends(), this.loadItems()]);
  }

  async loadFriends() {
    try {
      const response = await fetch('/api/friends/admin/all', {
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) return;
      if (!ct?.includes('application/json')) return;
      this.friends = await response.json();
    } catch {}
  }

  async loadItems() {
    try {
      const response = await fetch('/api/friend-posts/admin/all', {
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
    const tbody = document.getElementById('friendPostsTableBody');
    if (!tbody) return;

    if (!this.items.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-dim);padding:2rem">Žádné příspěvky</td></tr>`;
      return;
    }

    tbody.innerHTML = this.items.map(p => `
      <tr>
        <td class="td-title">${escHtml(p.title)}</td>
        <td>${escHtml(p.friend_name || '—')}</td>
        <td><span class="badge badge-draft">${escHtml(p.type)}</span></td>
        <td><span class="badge ${p.is_published ? 'badge-published' : 'badge-draft'}">${p.is_published ? 'Pub.' : 'Koncept'}</span></td>
        <td>${fmtDate(p.published_at || p.created_at)}</td>
        <td class="td-actions">
          <button class="btn-admin btn-admin--outline btn-admin--sm" onclick="window.admin.managers.friendposts.showModal(${p.id})">Upravit</button>
          <button class="btn-admin btn-admin--danger btn-admin--sm" onclick="window.admin.managers.friendposts.deleteItem(${p.id})">Smazat</button>
        </td>
      </tr>`).join('');
  }

  showModal(id = null) {
    const item    = id ? this.items.find(p => p.id === id) : null;
    const overlay = document.getElementById('friendPostsModalOverlay');
    const titleEl = document.getElementById('friendPostsModalTitle');
    const form    = document.getElementById('friendPostsForm');
    if (!overlay || !form) return;

    titleEl.textContent = item ? 'Upravit příspěvek' : 'Nový příspěvek';

    // Build friend select
    const friendSelect = form.elements.friend_id;
    if (!friendSelect.dataset.populated || this.friends.length !== friendSelect.options.length - 1) {
      friendSelect.innerHTML = '<option value="">-- Vyberte přítele --</option>' +
        this.friends.map(f => `<option value="${f.id}">${escHtml(f.name)}</option>`).join('');
      friendSelect.dataset.populated = '1';
    }

    form.elements.friend_id.value    = item?.friend_id || '';
    form.elements.title.value        = item?.title       || '';
    form.elements.type.value         = item?.type        || 'text';
    form.elements.content.value      = item?.content     || '';
    form.elements.cover_image.value  = item?.cover_image || '';
    form.elements.images_json.value  = item?.images_json || '';
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
    form.dataset.editId = id || '';

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

    form.onsubmit = async (e) => {
      e.preventDefault();
      await this.saveItem(id);
    };
  }

  async saveItem(id) {
    const form = document.getElementById('friendPostsForm');
    if (!form) return;

    const body = {
      friend_id:   Number(form.elements.friend_id.value),
      title:       form.elements.title.value.trim(),
      type:        form.elements.type.value,
      excerpt:     '',
      content:     this.rte ? this.rte.getValue() : form.elements.content.value.trim(),
      cover_image: form.elements.cover_image.value.trim(),
      images_json: form.elements.images_json.value.trim(),
      is_published: form.elements.is_published.checked ? 1 : 0,
      published_at: form.elements.published_at.value ? new Date(form.elements.published_at.value).toISOString() : null,
      title_en:    form.elements.title_en.value.trim(),
      excerpt_en:  '',
      content_en:  this.rteEn ? this.rteEn.getValue() : form.elements.content_en.value.trim(),
    };

    if (!body.friend_id) { this.admin.showNotification('Přítel je povinný', 'error'); return; }
    if (!body.title)     { this.admin.showNotification('Název je povinný', 'error'); return; }

    try {
      const url    = id ? `/api/friend-posts/${id}` : '/api/friend-posts';
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
      this.admin.showNotification(id ? 'Příspěvek aktualizován' : 'Příspěvek vytvořen');
      await this.loadItems();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  async deleteItem(id) {
    if (!confirm('Opravdu smazat tento příspěvek?')) return;
    try {
      const response = await fetch(`/api/friend-posts/${id}`, {
        method: 'DELETE',
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      this.admin.showNotification('Příspěvek smazán');
      await this.loadItems();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  closeModal() {
    document.getElementById('friendPostsModalOverlay')?.classList.add('hidden');
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
