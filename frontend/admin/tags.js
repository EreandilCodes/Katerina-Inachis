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
    // Suggestion popup — "vybírátko" of existing tags while typing.
    this.popup = null;
    this._suggestList = [];
    this.popup = document.createElement('div');
    this.popup.className = 'tag-suggest';
    this.popup.hidden = true;
    this.inputEl.insertAdjacentElement('afterend', this.popup);
    this._suppressHide = false;
    this.popup.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.tag-suggest__item');
      if (!item) return;
      e.preventDefault(); // keep focus in the input
      this._suppressHide = true;
      this.addByName(item.dataset.name);
      setTimeout(() => { this._suppressHide = false; }, 0);
    });
    this.inputEl.addEventListener('input', () => this.updateSuggest());
    // Load the existing-tag list lazily on first focus — including the "new
    // item" form, so suggestions ("vybírátko") work even before editing.
    this.inputEl.addEventListener('focus', () => {
      if (!this._initPromise) this.init();
      this.updateSuggest();
    });
    this.inputEl.addEventListener('blur', () => {
      setTimeout(() => { if (!this._suppressHide) this.hideSuggest(); }, 150);
    });

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.moveSuggest(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.moveSuggest(-1); return; }
      if (e.key === 'Escape') { this.hideSuggest(); return; }
      const open = this.popup && !this.popup.hidden && this._suggestList.length > 0;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (open) {
          const active = this.popup.querySelector('.suggest-active');
          this.addByName(active ? active.dataset.name : this._suggestList[0].name);
        } else {
          this.addByName(this.inputEl.value);
        }
        return;
      }
      if (e.key === 'Tab' && open) {
        e.preventDefault();
        const active = this.popup.querySelector('.suggest-active');
        this.addByName(active ? active.dataset.name : this._suggestList[0].name);
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
    await this.refreshOptions();
  }

  // Reload the list of all existing tags. Used on init and as a fallback when
  // creating a duplicate is rejected, so a tag that was created in another
  // section's editor (or another manager) after this picker cached its list
  // can still be picked here — tags must be reusable across content items.
  async refreshOptions() {
    const response = await fetch('/api/tags/admin/all', { headers: this.admin.auth.getAuthHeaders() });
    const ct = response.headers.get('content-type');
    if (!response.ok) {
      const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
      throw new Error(err.error || 'Request failed');
    }
    if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
    this.all = await response.json();
    // The list resolved after typing — refresh the open suggestion popup.
    if (document.activeElement === this.inputEl) this.updateSuggest();
  }

  matchByName(name) {
    const clean = String(name || '').trim().toLowerCase();
    return this.all.find((t) => String(t.name).toLowerCase() === clean) || null;
  }

  selectTag(tag) {
    this.selected.set(tag.id, { name: tag.name, slug: tag.slug });
    this.render();
  }

  // ── Suggestion popup (našeptávač) ──────────────────────────
  updateSuggest() {
    if (!this.popup) return;
    const term = (this.inputEl.value || '').trim().toLowerCase();
    const taken = new Set([...this.selected.values()].map((t) => t.name.toLowerCase()));
    this._suggestList = this.all
      .filter((t) => String(t.name).toLowerCase().includes(term) && !taken.has(String(t.name).toLowerCase()))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'cs'))
      .slice(0, 8);
    if (!this._suggestList.length) { this.hideSuggest(); return; }
    this.popup.innerHTML = this._suggestList.map((t, i) => `
      <div class="tag-suggest__item${i === 0 ? ' suggest-active' : ''}" data-name="${escHtml(t.name)}">
        #${escHtml(t.name)}<span class="tag-suggest__badge">/tag/${escHtml(t.slug)}</span>
      </div>`).join('');
    this.popup.hidden = false;
  }

  moveSuggest(delta) {
    if (!this.popup || this.popup.hidden || !this._suggestList.length) return;
    const items = [...this.popup.querySelectorAll('.tag-suggest__item')];
    const cur = items.indexOf(this.popup.querySelector('.suggest-active'));
    const next = cur < 0 ? 0 : (cur + delta + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('suggest-active', i === next));
  }

  hideSuggest() {
    if (this.popup) {
      this.popup.hidden = true;
      this.popup.innerHTML = '';
      this._suggestList = [];
    }
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

    const existing = this.matchByName(clean);
    if (existing) return this.selectTag(existing);

    try {
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: { ...this.admin.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean }),
      });
      if (response.ok) {
        const created = await response.json();
        this.all.push(created.item);
        return this.selectTag(created.item);
      }
      // Creating failed — most likely the tag already exists (created in
      // another section/manager after this picker cached its list). Refresh
      // the options and match again instead of blocking reuse.
      let message = 'Vytvoření štítku selhalo';
      try {
        const ct = response.headers.get('content-type');
        const body = ct?.includes('application/json') ? await response.json() : {};
        message = body.error || message;
      } catch { /* keep default message */ }
      await this.refreshOptions().catch(() => {});
      const retry = this.matchByName(clean);
      if (retry) return this.selectTag(retry);
      this.admin.showNotification(`Chyba: ${message}`, 'error');
      return;
    } catch (err) {
      // Network-level failure — refresh the option list and retry the match
      // once before giving up.
      await this.refreshOptions().catch(() => {});
      const retry = this.matchByName(clean);
      if (retry) return this.selectTag(retry);
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
      return;
    }
  }

  render() {
    if (!this.chipsEl) return;
    if (!this.selected.size) {
      this.chipsEl.innerHTML = `<span class="tag-chips__hint">Zadejte název štítku nebo zvolte ze stávajících.</span>`;
    } else {
      this.chipsEl.innerHTML = [...this.selected.values()]
        .map((t) => `<span class="tag-chip">#${escHtml(t.name)}<button type="button" class="tag-chip__remove" aria-label="Odebrat štítek">×</button></span>`)
        .join('');
    }
    if (this.inputEl) this.inputEl.value = '';
    this.hideSuggest();
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