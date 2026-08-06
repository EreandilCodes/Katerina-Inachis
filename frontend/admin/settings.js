// ── SettingsManager ───────────────────────────────────────────

export class SettingsManager {
  constructor(auth, admin) {
    this.auth  = auth;
    this.admin = admin;
    this.settings = {};
  }

  async init() {
    await this.loadSettings();
  }

  async loadSettings() {
    try {
      const response = await fetch('/api/settings/admin/all', {
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
      this.settings = await response.json();
      this.renderSettings();
    } catch (err) {
      this.admin.showNotification(`Chyba načítání nastavení: ${err.message}`, 'error');
    }
  }

  renderSettings() {
    const form = document.getElementById('settingsForm');
    if (!form) return;

    const FIELDS = [
      { key: 'site_name',        label: 'Název webu',        type: 'text' },
      { key: 'site_name_en',     label: 'Název webu (EN)',   type: 'text' },
      { key: 'site_tagline',     label: 'Podtitul',          type: 'text' },
      { key: 'site_tagline_en',  label: 'Podtitul (EN)',     type: 'text' },
      { key: 'owner_name',       label: 'Jméno autora',      type: 'text' },
      { key: 'owner_name_en',    label: 'Jméno autora (EN)', type: 'text' },
      { key: 'contact_email',    label: 'Kontaktní e-mail',  type: 'email' },
      { key: 'social_instagram', label: 'Instagram URL',     type: 'url' },
      { key: 'social_twitter',   label: 'Twitter URL',       type: 'url' },
      { key: 'site_logo',        label: 'Logo webu',         type: 'image' },
      { key: 'hero_image',       label: 'Hero obrázek',       type: 'image' },
      { key: 'about_image',      label: 'O mně obrázek',      type: 'image' },
      { key: 'about_text',       label: 'Text O mně',        type: 'textarea' },
      { key: 'about_text_en',    label: 'Text O mně (EN)',   type: 'textarea' },
      { key: 'friend_storage_limit_mb', label: 'Limit úložiště přátel (MB)', type: 'text' },
    ];

    form.innerHTML = FIELDS.map(f => `
      <div class="form-group">
        <label class="form-label" for="setting_${f.key}">${escHtml(f.label)}</label>
        ${f.type === 'textarea'
          ? `<textarea class="form-textarea" id="setting_${f.key}" name="${f.key}" rows="4">${escHtml(this.settings[f.key]?.value || '')}</textarea>`
          : f.type === 'image'
            ? `<div class="input-with-btn">
                <input class="form-input" type="text" id="setting_${f.key}" name="${f.key}" value="${escHtml(this.settings[f.key]?.value || '')}" placeholder="https://…">
                <button type="button" class="btn-admin btn-admin--outline btn-admin--sm" onclick="window.admin.managers.gallery?.showGalleryPicker('setting_${f.key}')">Z galerie</button>
              </div>`
            : `<input class="form-input" type="${f.type}" id="setting_${f.key}" name="${f.key}" value="${escHtml(this.settings[f.key]?.value || '')}">`}
      </div>`).join('') +
      `<div style="margin-top:1.5rem">
        <button type="submit" class="btn-admin btn-admin--primary">Uložit vše</button>
      </div>`;

    if (!form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveAll(form, FIELDS);
      });
    }
  }

  async saveAll(form, fields) {
    const promises = fields.map(f => {
      const el = form.elements[f.key];
      const value = el ? el.value : '';
      return this.saveSetting(f.key, value);
    });

    try {
      await Promise.all(promises);
      this.admin.showNotification('Nastavení uloženo');
      await this.loadSettings();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  async saveSetting(key, value) {
    const response = await fetch(`/api/settings/${key}`, {
      method: 'PUT',
      headers: { ...this.auth.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
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
