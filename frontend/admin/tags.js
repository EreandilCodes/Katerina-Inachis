// ── TagsManager — global tags management (Admin → Přehled) ────────────────
// Tags are global and cross-category (distinct from menu categories). They are
// managed right below the menu block in the overview. Deleting a tag only
// removes its links (content is never touched, nothing cascades).

export class TagsManager {
  constructor(auth, admin) {
    this.auth = auth;
    this.admin = admin;
    this.tags = [];
    this.editId = null;
  }

  async init() {
    try {
      await this.loadTags();
      this.render();
    } catch (err) {
      this.admin.showNotification(`Chyba načítání štítků: ${err.message}`, 'error');
    }
  }

  async loadTags() {
    const response = await fetch('/api/tags/admin/all', { headers: this.auth.getAuthHeaders() });
    const ct = response.headers.get('content-type');
    if (!response.ok) {
      const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
      throw new Error(err.error || 'Request failed');
    }
    if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
    this.tags = await response.json();
  }

  render() {
    const tbody = document.querySelector('#menuTagsTable tbody');
    if (!tbody) return;
    if (!this.tags.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--ink-dim);padding:2rem">Žádné štítky — přidejte první.</td></tr>`;
      return;
    }
    tbody.innerHTML = this.tags.map((t) => `
      <tr>
        <td class="td-title">
          ${escHtml(t.name)}
          ${t.name_en ? `<br><span style="font-size:0.75rem;color:var(--ink-dim)">${escHtml(t.name_en)}</span>` : ''}
        </td>
        <td><code class="category-slug">/tag/${escHtml(t.slug)}</code></td>
        <td>${t.item_count}</td>
        <td class="td-actions">
          <button class="btn-admin btn-admin--outline btn-admin--sm" onclick="window.admin.managers.tags?.openTagModal(${t.id})">Upravit</button>
          <button class="btn-admin btn-admin--danger btn-admin--sm" onclick="window.admin.managers.tags?.handleDeleteTag(${t.id})">Smazat</button>
        </td>
      </tr>`).join('');
  }

  // ── Modal ────────────────────────────────────────────────

  openTagModal(id = null) {
    const item = id ? this.tags.find((t) => t.id === id) : null;
    this.editId = id || null;
    const overlay = document.getElementById('tagModalOverlay');
    const form = document.getElementById('tagForm');
    if (!overlay || !form) return;

    document.getElementById('tagModalTitle').textContent = item ? 'Upravit štítek' : 'Nový štítek';
    form.elements.name.value = item?.name || '';
    form.elements.name_en.value = item?.name_en || '';
    const preview = document.getElementById('tagSlugPreview');
    if (preview) preview.textContent = '/tag/' + (item?.slug || slugify(form.elements.name.value.trim() || '…'));

    if (!form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveTag();
      });
      form.elements.name.addEventListener('input', () => {
        if (this.editId) return; // URL is immutable after creation
        const previewEl = document.getElementById('tagSlugPreview');
        if (previewEl) previewEl.textContent = '/tag/' + slugify(form.elements.name.value.trim() || '…');
      });
    }
    form.elements.name.focus?.();
    overlay.classList.remove('hidden');
  }

  async saveTag() {
    const form = document.getElementById('tagForm');
    if (!form) return;
    const body = { name: form.elements.name.value.trim(), name_en: form.elements.name_en.value.trim() };
    if (!body.name) {
      this.admin.showNotification('Název štítku je povinný', 'error');
      return;
    }
    try {
      const response = await fetch(this.editId ? `/api/tags/${this.editId}` : '/api/tags', {
        method: this.editId ? 'PUT' : 'POST',
        headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      this.closeTagModal();
      this.admin.showNotification(this.editId ? 'Štítek uložen' : 'Štítek vytvořen');
      await this.loadTags();
      this.render();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  closeTagModal() {
    document.getElementById('tagModalOverlay')?.classList.add('hidden');
  }

  // ── Deletion (associations only — content is never cascaded) ───────────
  handleDeleteTag(id) {
    const tag = this.tags.find((t) => t.id === id);
    if (!tag) return;
    // Reuses the shared confirm modal (its buttons live in admin.html).
    this.admin.managers.menu?.openConfirm(
      'Smazat štítek',
      [`Opravdu chcete smazat štítek „${tag.name}“ (/${tag.slug})?`,
        tag.item_count
          ? `Je k němu přiřazeno ${tag.item_count} položek — zůstanou zachovány, pouze se odpojí.`
          : 'Žádný obsah tím nebude smazán.'],
      () => this.deleteTag(id)
    );
  }

  async deleteTag(id) {
    const response = await fetch(`/api/tags/${id}`, { method: 'DELETE', headers: this.auth.getAuthHeaders() });
    const ct = response.headers.get('content-type');
    const body = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
    if (!response.ok) throw new Error(body.error || 'Request failed');
    this.admin.showNotification('Štítek odstraněn');
    await this.loadTags();
    this.render();
  }
}

// ── TagPicker — chip multi-select used inside the six content editors ─────
// Wires into a per-form chips container + free-text input. Enter selects an
// existing tag (by name, case-insensitive) or creates a new one on the fly.
// The picked set is persisted with the content item via /api/tags/admin/assign.

export class TagPicker {
  constructor(admin, chipsId, inputId) {
    this.admin = admin;
    this.chipsId = chipsId;
    this.inputId = inputId;
    this.selected = new Map(); // id → { name, slug }
    this.all = [];
    this._initPromise = null;

    this.chipsEl = document.getElementById(chipsId);
    this.inputEl = document.getElementById(inputId);
    if (!this.chipsEl || !this.inputEl) {
      console.warn(`TagPicker: missing #${chipsId} or #${inputId} in admin.html`);
      return;
    }
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.addByName(this.inputEl.value);
      }
    });
    this.chipsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.tag-chip__remove');
      if (!btn) return;
      const index = [...this.chipsEl.querySelectorAll('.tag-chip')].indexOf(btn.closest('.tag-chip'));
      if (index >= 0) {
        const id = this.getTagIds()[index];
        if (id !== undefined) this.selected.delete(id);
        this.render();
      }
    });
  }

  async init() {
    if (!this._initPromise) {
      this._initPromise = this.loadOptionsFuture().catch((err) => {
        this.admin.showNotification(`Chyba načítání štítků: ${err.message}`, 'error');
        this.all = [];
      });
    }
    await this._initPromise;
  }

  async loadOptionsFuture() {
    const response = await fetch('/api/tags/admin/all', { headers: this.admin.auth.getAuthHeaders() });
    const ct = response.headers.get('content-type');
    if (!response.ok) {
      const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
      throw new Error(err.error || 'Request failed');
    }
    if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
    this.all = await response.json();
  }

  reset() {
    this.selected.clear();
    this.render();
  }

  async loadFor(contentType, contentId) {
    await this.init();
    this.selected.clear();
    try {
      const response = await fetch(
        `/api/tags/admin/by-content?content_type=${encodeURIComponent(contentType)}&content_id=${contentId}`,
        { headers: this.admin.auth.getAuthHeaders() }
      );
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      const tags = ct?.includes('application/json') ? await response.json() : [];
      for (const t of tags) this.selected.set(t.id, { name: t.name, slug: t.slug });
    } catch (err) {
      this.admin.showNotification(`Chyba načítání štítků: ${err.message}`, 'error');
    }
    this.render();
  }

  getTagIds() {
    return [...this.selected.keys()];
  }

  async assign(contentType, contentId) {
    const response = await fetch('/api/tags/admin/assign', {
      method: 'POST',
      headers: { ...this.admin.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content_type: contentType,
        content_id: contentId,
        tag_ids: this.getTagIds(), // empty array clears stale links
      }),
    });
    const ct = response.headers.get('content-type');
    if (!response.ok) {
      const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
      throw new Error(err.error || 'Request failed');
    }
  }

  async addByName(name) {
    const clean = String(name || '').trim();
    if (!clean) return;
    const match = this.all.find((t) => t.name.toLowerCase() === clean.toLowerCase());
    if (match) {
      this.selected.set(match.id, { name: match.name, slug: match.slug });
    } else {
      try {
        const response = await fetch('/api/tags', {
          method: 'POST',
          headers: { ...this.admin.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: clean }),
        });
        const ct = response.headers.get('content-type');
        if (!response.ok) {
          const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
          throw new Error(err.error || 'Request failed');
        }
        if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
        const created = await response.json();
        this.all.push(created.item);
        this.selected.set(created.item.id, { name: created.item.name, slug: created.item.slug });
      } catch (err) {
        this.admin.showNotification(`Chyba: ${err.message}`, 'error');
        return;
      }
    }
    this.render();
  }

  render() {
    if (!this.chipsEl) return;
    if (!this.selected.size) {
      this.chipsEl.innerHTML = `<span class="tag-chips__hint">Zadejte název štítku a stiskněte Enter.</span>`;
    } else {
      this.chipsEl.innerHTML = [...this.selected.values()]
        .map((t) => `<span class="tag-chip">#${escHtml(t.name)}<button type="button" class="tag-chip__remove" aria-label="Odebrat štítek">×</button></span>`)
        .join('');
    }
    if (this.inputEl) this.inputEl.value = '';
  }
}

export function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}