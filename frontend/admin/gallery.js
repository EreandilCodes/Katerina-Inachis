// ── GalleryManager ────────────────────────────────────────────

export class GalleryManager {
  constructor(auth, admin) {
    this.auth          = auth;
    this.admin         = admin;
    this.folders       = [];
    this.images        = [];
    this.activeFolderId = null; // null = root
    this.searchTimer   = null;
  }

  async init() {
    this.bindEvents();
    await this.loadFolders();
    await this.loadImages();
  }

  bindEvents() {
    const gallerySection = document.getElementById('gallerySection');
    if (!gallerySection || gallerySection.dataset.galleryBound) return;
    gallerySection.dataset.galleryBound = '1';

    // Search
    const searchInput = document.getElementById('gallerySearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.loadImages(), 350);
      });
    }
  }

  // ── Folders ──────────────────────────────────────────────────

  async loadFolders() {
    try {
      const response = await fetch('/api/gallery/folders', {
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
      this.folders = await response.json();
      this.renderFolderTree();
    } catch (err) {
      this.admin.showNotification(`Chyba načítání složek: ${err.message}`, 'error');
    }
  }

  buildFolderTree(parentId = null) {
    return this.folders
      .filter(f => (f.parent_id ?? null) === parentId)
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
  }

  renderFolderTree() {
    const container = document.getElementById('galleryFolderTree');
    if (!container) return;

    const renderNode = (node, depth = 0) => {
      const indent = depth * 16;
      const isActive = this.activeFolderId === node.id;
      const children = this.buildFolderTree(node.id);

      return `
        <button class="folder-item ${isActive ? 'active' : ''}"
          style="padding-left:${1 + indent / 16}rem"
          onclick="window.admin.managers.gallery.selectFolder(${node.id})">
          <span class="folder-icon">📁</span>
          <span>${escHtml(node.name)}</span>
          <span class="folder-actions">
            <button class="btn-admin btn-admin--outline btn-admin--sm" onclick="event.stopPropagation();window.admin.managers.gallery.showFolderModal(${node.id})">✏</button>
            <button class="btn-admin btn-admin--danger btn-admin--sm" onclick="event.stopPropagation();window.admin.managers.gallery.deleteFolder(${node.id})">×</button>
          </span>
        </button>
        ${children.map(c => renderNode(c, depth + 1)).join('')}`;
    };

    const rootActive = this.activeFolderId === null;
    const rootChildren = this.buildFolderTree(null);

    container.innerHTML = `
      <button class="folder-item folder-item--root ${rootActive ? 'active' : ''}"
        onclick="window.admin.managers.gallery.selectFolder(null)">
        <span class="folder-icon">🏠</span>
        <span>Kořen</span>
      </button>
      ${rootChildren.map(f => renderNode(f)).join('')}`;
  }

  selectFolder(folderId) {
    this.activeFolderId = folderId;
    this.renderFolderTree();
    this.loadImages();
  }

  showFolderModal(id = null) {
    const folder  = id ? this.folders.find(f => f.id === id) : null;
    const overlay = document.getElementById('galleryFolderModalOverlay');
    const titleEl = document.getElementById('galleryFolderModalTitle');
    const form    = document.getElementById('galleryFolderForm');
    if (!overlay || !form) return;

    titleEl.textContent = folder ? 'Upravit složku' : 'Nová složka';
    form.elements.folderName.value    = folder?.name    || '';
    form.elements.folderSlug.value    = folder?.slug    || '';
    form.elements.folderOrder.value   = folder?.display_order ?? 0;

    // Build parent select (exclude self + descendants)
    const excludeIds = id ? this.getDescendantIds(id) : [];
    excludeIds.push(id);

    const parentSel = form.elements.folderParent;
    parentSel.innerHTML = '<option value="">— Žádný nadřazený (kořen) —</option>' +
      this.folders
        .filter(f => !excludeIds.includes(f.id))
        .map(f => `<option value="${f.id}" ${folder?.parent_id === f.id ? 'selected' : ''}>${escHtml(f.name)}</option>`)
        .join('');

    // Auto slug
    const nameInp = form.elements.folderName;
    const slugInp = form.elements.folderSlug;
    if (!nameInp.dataset.slugBound) {
      nameInp.dataset.slugBound = '1';
      nameInp.addEventListener('input', () => {
        if (!slugInp.dataset.manual) {
          slugInp.value = nameInp.value.toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
        }
      });
      slugInp.addEventListener('input', () => { slugInp.dataset.manual = '1'; });
    }
    delete slugInp.dataset.manual;

    overlay.classList.remove('hidden');

    form.onsubmit = async (e) => {
      e.preventDefault();
      await this.saveFolder(id);
    };
  }

  getDescendantIds(id) {
    const result = [];
    const queue  = [id];
    while (queue.length) {
      const cur = queue.shift();
      const children = this.folders.filter(f => f.parent_id === cur);
      children.forEach(c => { result.push(c.id); queue.push(c.id); });
    }
    return result;
  }

  async saveFolder(id) {
    const form = document.getElementById('galleryFolderForm');
    if (!form) return;

    const body = {
      name:          form.elements.folderName.value.trim(),
      slug:          form.elements.folderSlug.value.trim(),
      parent_id:     form.elements.folderParent.value ? Number(form.elements.folderParent.value) : null,
      display_order: Number(form.elements.folderOrder.value) || 0,
    };

    if (!body.name) { this.admin.showNotification('Název je povinný', 'error'); return; }

    try {
      const url    = id ? `/api/gallery/folders/${id}` : '/api/gallery/folders';
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

      document.getElementById('galleryFolderModalOverlay')?.classList.add('hidden');
      this.admin.showNotification(id ? 'Složka aktualizována' : 'Složka vytvořena');
      await this.loadFolders();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  async deleteFolder(id) {
    if (!confirm('Opravdu smazat tuto složku?')) return;
    try {
      const response = await fetch(`/api/gallery/folders/${id}`, {
        method: 'DELETE',
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (this.activeFolderId === id) this.activeFolderId = null;
      this.admin.showNotification('Složka smazána');
      await this.loadFolders();
      await this.loadImages();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  // ── Images ───────────────────────────────────────────────────

  async loadImages() {
    const searchInput = document.getElementById('gallerySearchInput');
    const search = searchInput?.value?.trim() || '';

    let url = '/api/gallery/images';
    const params = new URLSearchParams();

    if (this.activeFolderId === null) {
      params.set('folder', 'root');
    } else {
      params.set('folder', this.activeFolderId);
    }

    if (search) params.set('search', search);
    url += '?' + params.toString();

    try {
      const response = await fetch(url, { headers: this.auth.getAuthHeaders() });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
      this.images = await response.json();
      this.renderImages();
    } catch (err) {
      this.admin.showNotification(`Chyba načítání fotek: ${err.message}`, 'error');
    }
  }

  renderImages() {
    const tbody = document.getElementById('galleryImagesTableBody');
    if (!tbody) return;

    if (!this.images.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--ink-dim);padding:2rem">Žádné fotky v této složce</td></tr>`;
      return;
    }

    tbody.innerHTML = this.images.map(img => `
      <tr>
        <td><img src="${escHtml(img.image_url)}" alt="${escHtml(img.title || img.identifier)}" style="width:48px;height:48px;object-fit:cover;border-radius:var(--radius-sm)"></td>
        <td><code style="font-size:0.78rem;color:var(--ink-dim)">${escHtml(img.identifier)}</code></td>
        <td class="td-title">${escHtml(img.title || '—')}</td>
        <td>${escHtml(img.folder_name || 'Kořen')}</td>
        <td class="td-actions">
          <button class="btn-admin btn-admin--outline btn-admin--sm" onclick="window.admin.managers.gallery.showImageModal(${img.id})">Upravit</button>
          <button class="btn-admin btn-admin--danger btn-admin--sm" onclick="window.admin.managers.gallery.deleteImage(${img.id})">Smazat</button>
        </td>
      </tr>`).join('');
  }

  showImageModal(id = null) {
    const image   = id ? this.images.find(i => i.id === id) : null;
    const overlay = document.getElementById('galleryImageModalOverlay');
    const titleEl = document.getElementById('galleryImageModalTitle');
    const form    = document.getElementById('galleryImageForm');
    if (!overlay || !form) return;

    titleEl.textContent = image ? 'Upravit fotku' : 'Nová fotka (URL)';

    form.elements.imageUrl.value        = image?.image_url    || '';
    form.elements.imageIdentifier.value = image?.identifier   || '';
    form.elements.imageTitle.value      = image?.title        || '';
    form.elements.imageAlt.value        = image?.alt_text     || '';
    form.elements.imageOrder.value      = image?.display_order ?? 0;

    const folderSel = form.elements.imageFolder;
    folderSel.innerHTML = '<option value="">— Kořen —</option>' +
      this.folders.map(f => `<option value="${f.id}" ${image?.folder_id === f.id ? 'selected' : ''}>${escHtml(f.name)}</option>`).join('');

    if (!image && this.activeFolderId) {
      folderSel.value = this.activeFolderId;
    }

    overlay.classList.remove('hidden');

    form.onsubmit = async (e) => {
      e.preventDefault();
      await this.saveImage(id);
    };
  }

  async saveImage(id) {
    const form = document.getElementById('galleryImageForm');
    if (!form) return;

    const body = {
      image_url:     form.elements.imageUrl.value.trim(),
      identifier:    form.elements.imageIdentifier.value.trim(),
      title:         form.elements.imageTitle.value.trim(),
      alt_text:      form.elements.imageAlt.value.trim(),
      display_order: Number(form.elements.imageOrder.value) || 0,
      folder_id:     form.elements.imageFolder.value ? Number(form.elements.imageFolder.value) : null,
    };

    if (!body.image_url)  { this.admin.showNotification('URL je povinná', 'error'); return; }
    if (!body.identifier) { this.admin.showNotification('Identifier je povinný', 'error'); return; }

    try {
      const url    = id ? `/api/gallery/images/${id}` : '/api/gallery/images';
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

      document.getElementById('galleryImageModalOverlay')?.classList.add('hidden');
      this.admin.showNotification(id ? 'Fotka aktualizována' : 'Fotka přidána');
      await this.loadImages();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  async deleteImage(id) {
    if (!confirm('Opravdu smazat tuto fotku?')) return;
    try {
      const response = await fetch(`/api/gallery/images/${id}`, {
        method: 'DELETE',
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Request failed');
      }
      this.admin.showNotification('Fotka smazána');
      await this.loadImages();
    } catch (err) {
      this.admin.showNotification(`Chyba: ${err.message}`, 'error');
    }
  }

  // ── Upload ───────────────────────────────────────────────────

  async doUpload(files) {
    if (!files || !files.length) return;

    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    if (this.activeFolderId) {
      formData.append('folder_id', this.activeFolderId);
    }

    try {
      const response = await fetch('/api/gallery/upload', {
        method: 'POST',
        headers: this.auth.getAuthHeaders(),
        body: formData
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) {
        const err = ct?.includes('application/json') ? await response.json() : { error: await response.text() };
        throw new Error(err.error || 'Upload failed');
      }
      if (!ct?.includes('application/json')) throw new Error('Non-JSON response');
      const data = await response.json();
      this.admin.showNotification(data.message || 'Fotky nahrány');
      await this.loadImages();
    } catch (err) {
      this.admin.showNotification(`Chyba uploadu: ${err.message}`, 'error');
    }
  }

  // ── Gallery Picker (for other sections) ──────────────────────

  async showGalleryPicker(targetInputId, multiple = false) {
    const overlay = document.getElementById('galleryPickerModalOverlay');
    if (!overlay) return;

    // Load all images
    try {
      const response = await fetch('/api/gallery/images', {
        headers: this.auth.getAuthHeaders()
      });
      const ct = response.headers.get('content-type');
      if (!response.ok) throw new Error('Load failed');
      if (!ct?.includes('application/json')) throw new Error('Non-JSON');
      const images = await response.json();

      const grid = document.getElementById('galleryPickerGrid');
      if (!grid) return;

      const selected = new Set();

      grid.innerHTML = images.map(img => `
        <div class="gallery-picker-item" data-url="${escHtml(img.image_url)}" data-id="${img.id}">
          <img src="${escHtml(img.image_url)}" alt="${escHtml(img.title || img.identifier)}" loading="lazy">
          <div class="pick-check">✓</div>
        </div>`).join('');

      grid.querySelectorAll('.gallery-picker-item').forEach(item => {
        item.addEventListener('click', () => {
          if (multiple) {
            item.classList.toggle('selected');
            const url = item.dataset.url;
            if (selected.has(url)) selected.delete(url);
            else selected.add(url);
          } else {
            // Single mode: fill target and close
            const targetInput = document.getElementById(targetInputId);
            if (targetInput) targetInput.value = item.dataset.url;
            overlay.classList.add('hidden');
          }
        });
      });

      // Confirm button for multiple
      const confirmBtn = document.getElementById('galleryPickerConfirm');
      if (confirmBtn) {
        confirmBtn.style.display = multiple ? '' : 'none';
        confirmBtn.onclick = () => {
          const targetInput = document.getElementById(targetInputId);
          if (targetInput && selected.size) {
            try {
              const existing = JSON.parse(targetInput.value || '[]');
              targetInput.value = JSON.stringify([...existing, ...selected]);
            } catch {
              targetInput.value = JSON.stringify([...selected]);
            }
          }
          overlay.classList.add('hidden');
        };
      }

      overlay.classList.remove('hidden');
    } catch (err) {
      this.admin.showNotification(`Chyba načítání galerie: ${err.message}`, 'error');
    }
  }
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
