// ── FriendsManager ────────────────────────────────────────────

export class FriendsManager {
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
      const response = await fetch('/api/friends/admin/all', {
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
    const tbody = document.getElementById('friendsTableBody');
    if (!tbody) return;

    if (!this.items.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--ink-dim);padding:2rem">Žádní přátelé</td></tr>`;
      return;
    }

    tbody.innerHTML = this.items.map(f => `
      <tr>
        <td>
          ${f.avatar
            ? `<img src="${escHtml(f.avatar)}" alt="${escHtml(f.name)}" class="table-img">`
            : '<div style="width:40px;height:40px;border-radius:50%;background:var(--violet-pale);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);color:var(--violet-mid)">' + escHtml(f.name.charAt(0)) + '</div>'}
        </td>
        <td class="td-title">
          ${escHtml(f.name)}
          ${f.email ? `<br><span style="font-size:0.75rem;color:var(--ink-dim)">${escHtml(f.email)}</span>` : ''}
        </td>
        <td><code style="font-size:0.78rem;color:var(--ink-dim)">${escHtml(f.slug)}</code></td>
        <td><span class="badge ${f.is_active ? 'badge-active' : 'badge-inactive'}">${f.is_active ? 'Aktivní' : 'Neaktivní'}</span></td>
        <td class="td-actions">
          <button class="btn-admin btn-admin--outline btn-admin--sm" onclick="window.admin.managers.friends.showModal(${f.id})">Upravit</button>
          <button class="btn-admin btn-admin--outline btn-admin--sm" onclick="window.admin.managers.friends.showLoginModal(${f.id})" title="${f.email ? 'Změnit přihlášení' : 'Nastavit přihlášení'}">Přihlášení</button>
          <button class="btn-admin btn-admin--danger btn-admin--sm" onclick="window.admin.managers.friends.deleteItem(${f.id})">Smazat</button>
        </td>
      </tr>`).join('');
  }

  showModal(id = null) {
    const item    = id ? this.items.find(f => f.id === id) : null;
    const overlay = document.getElementById('friendsModalOverlay');
    const titleEl = document.getElementById('friendsModalTitle');
    const form    = document.getElementById('friendsForm');
    if (!overlay || !form) return;

    titleEl.textContent = item ? 'Upravit přítele' : 'Nový přítel';

    form.elements.name.value          = item?.name          || '';
    form.elements.slug.value          = item?.slug          || '';
    form.elements.short_bio.value     = item?.short_bio     || '';
    form.elements.bio.value           = item?.bio           || '';
    form.elements.avatar.value        = item?.avatar        || '';
    form.elements.display_order.value = item?.display_order ?? 0;
    form.elements.is_active.checked   = item?.is_active !== 0;
    form.elements.short_bio_en.value  = item?.short_bio_en || '';
    form.elements.bio_en.value        = item?.bio_en       || '';

    // Reset lang tabs to CZ
    const langTabs = form.querySelectorAll('.lang-tab');
    langTabs.forEach(t => t.classList.toggle('active', t.dataset.langPane === 'cs'));
    form.querySelectorAll('.lang-pane--cs').forEach(el => el.style.display = '');
    form.querySelectorAll('.lang-pane--en').forEach(el => el.style.display = 'none');

    // Auto-slug from name
    const nameInput = form.elements.name;
    const slugInput = form.elements.slug;
    if (!nameInput.dataset.slugBound) {
      nameInput.dataset.slugBound = '1';
      nameInput.addEventListener('input', () => {
        if (!slugInput.dataset.manualSlug) {
          slugInput.value = nameInput.value
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        }
      });
      slugInput.addEventListener('input', () => { slugInput.dataset.manualSlug = '1'; });
    }
    delete slugInput.dataset.manualSlug;

    overlay.classList.remove('hidden');
    form.dataset.editId = id || '';

    form.onsubmit = async (e) => {
      e.preventDefault();
      await this.saveItem(id);
    };
  }

  async saveItem(id) {
    const form = document.getElementById('friendsForm');
    if (!form) return;

    const body = {
      name:          form.elements.name.value.trim(),
      slug:          form.elements.slug.value.trim(),
      short_bio:     form.elements.short_bio.value.trim(),
      bio:           form.elements.bio.value.trim(),
      avatar:        form.elements.avatar.value.trim(),
      display_order: Number(form.elements.display_order.value) || 0,
      is_active:     form.elements.is_active.checked ? 1 : 0,
      short_bio_en:  form.elements.short_bio_en.value.trim(),
      bio_en:        form.elements.bio_en.value.trim(),
    };

    if (!body.name) { this.admin.showNotification('Jméno je povinné', 'error'); return; }

    try {
      const url    = id ? `/api/friends/${id}` : '/api/friends';
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
      this.admin.showNotification(id ? 'Přítel aktualizován' : 'Přítel přidán');
      await this.loadItems();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  async deleteItem(id) {
    if (!confirm('Opravdu smazat tohoto přítele?')) return;
    try {
      const response = await fetch(`/api/friends/${id}`, {
        method: 'DELETE',
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      this.admin.showNotification('Přítel smazán');
      await this.loadItems();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  showLoginModal(id) {
    const friend = this.items.find(f => f.id === id);
    if (!friend) return;

    const overlay = document.getElementById('friendLoginModalOverlay');
    if (!overlay) return;

    document.getElementById('friendLoginModalTitle').textContent =
      friend.email ? `Přihlášení: ${friend.name}` : `Nastavit přihlášení: ${friend.name}`;
    document.getElementById('friendLoginCurrentEmail').textContent =
      friend.email ? `Aktuální email: ${friend.email}` : 'Přihlášení zatím není nastaveno.';

    const form = document.getElementById('friendLoginForm');
    form.elements.login_email.value    = friend.email || '';
    form.elements.login_password.value = '';
    form.elements.login_confirm.value  = '';

    overlay.classList.remove('hidden');

    form.onsubmit = async (e) => {
      e.preventDefault();
      const email    = form.elements.login_email.value.trim();
      const password = form.elements.login_password.value;
      const confirm  = form.elements.login_confirm.value;

      if (!email || !password) {
        this.admin.showNotification('Email a heslo jsou povinné', 'error');
        return;
      }
      if (password !== confirm) {
        this.admin.showNotification('Hesla se neshodují', 'error');
        return;
      }
      if (password.length < 8) {
        this.admin.showNotification('Heslo musí mít alespoň 8 znaků', 'error');
        return;
      }

      try {
        const response = await fetch(`/api/friends/${id}/set-login`, {
          method: 'PUT',
          headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const ct = response.headers.get('content-type');
        if (!response.ok) {
          const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
          throw new Error(err.error || 'Request failed');
        }
        if (!ct?.includes('application/json')) throw new Error('Non-JSON response');

        overlay.classList.add('hidden');
        this.admin.showNotification('Přihlašovací údaje nastaveny');
        await this.loadItems();
      } catch (err) {
        this.admin.showNotification(`Chyba: ${err.message}`, 'error');
      }
    };
  }

  async resetPassword(id) {
    const friend = this.items.find(f => f.id === id);
    if (!friend) return;
    if (!friend.email) {
      this.admin.showNotification('Přítel nemá nastavený email — nejprve nastavte přihlašovací údaje', 'error');
      return;
    }

    const newPassword = prompt(`Nové heslo pro ${friend.name} (min. 8 znaků):`);
    if (!newPassword) return;
    if (newPassword.length < 8) {
      this.admin.showNotification('Heslo musí mít alespoň 8 znaků', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/friends/${id}/reset-password`, {
        method: 'PUT',
        headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword })
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
      this.admin.showNotification('Heslo bylo resetováno');
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  closeModal() {
    document.getElementById('friendsModalOverlay')?.classList.add('hidden');
  }
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
