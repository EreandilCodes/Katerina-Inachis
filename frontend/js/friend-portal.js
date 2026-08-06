import { AuthManager } from '/js/auth.js';

// ── XSS helper ────────────────────────────────────────────────
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const toast = document.getElementById('adminToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `admin-toast admin-toast--${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ── Safe fetch ────────────────────────────────────────────────
async function safeFetch(url, options = {}) {
  const response = await fetch(url, options);
  const ct = response.headers.get('content-type');
  if (!response.ok) {
    const err = ct?.includes('application/json')
      ? await response.json()
      : { error: await response.text() };
    throw new Error(err.error || 'Request failed');
  }
  if (!ct?.includes('application/json')) {
    throw new Error('Server returned non-JSON response');
  }
  return response.json();
}

function toLocalDatetime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ''; }
}

// ── Auth ──────────────────────────────────────────────────────
const auth = new AuthManager();

async function init() {
  const ok = await auth.checkFriendAuth();
  if (!ok) return;

  bindNav();
  bindLogout();
  await loadPosts();
  await loadProfile();
  bindPostModal();
  bindAvatarForm();
  bindPasswordForm();
  bindGalleryPicker();
  bindGalleryUpload();
}

// ── Navigation ────────────────────────────────────────────────
function bindNav() {
  if (document.body.dataset.navBound) return;
  document.body.dataset.navBound = '1';

  const links = document.querySelectorAll('.sidebar-nav a[data-section]');
  const sections = document.querySelectorAll('.admin-section');
  const titleEl = document.getElementById('portalPageTitle');

  const sectionTitles = { posts: 'Moje příspěvky', gallery: 'Má galerie', profile: 'Můj profil' };

  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.dataset.section;
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      sections.forEach(s => s.classList.remove('active'));
      const sec = document.getElementById(target + 'Section');
      if (sec) sec.classList.add('active');
      if (titleEl) titleEl.textContent = sectionTitles[target] || target;
      if (target === 'gallery') loadGallery();
    });
  });
}

function bindLogout() {
  const btn = document.getElementById('btnLogout');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => auth.logout());
  }
}

// ── Posts ──────────────────────────────────────────────────────
let posts = [];
let portalRte = null;
let portalRteEn = null;

async function loadPosts() {
  try {
    posts = await safeFetch('/api/friend-portal/posts', {
      headers: auth.getAuthHeaders()
    });
    renderPosts();
  } catch (err) {
    showToast(`Chyba načítání příspěvků: ${err.message}`, 'error');
  }
}

function renderPosts() {
  const tbody = document.getElementById('postsTableBody');
  if (!tbody) return;

  if (!posts.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--ink-dim);padding:2rem">Žádné příspěvky</td></tr>`;
    return;
  }

  tbody.innerHTML = posts.map(p => `
    <tr>
      <td class="td-title">${escHtml(p.title)}</td>
      <td>${escHtml(p.type || 'text')}</td>
      <td><span class="badge ${p.is_published ? 'badge-active' : 'badge-inactive'}">${p.is_published ? 'Publikován' : 'Koncept'}</span></td>
      <td style="font-size:0.8rem;color:var(--ink-dim)">${p.created_at ? new Date(p.created_at).toLocaleDateString('cs-CZ') : '—'}</td>
      <td class="td-actions">
        <button class="btn-admin btn-admin--outline btn-admin--sm" data-edit-post="${p.id}">Upravit</button>
        <button class="btn-admin btn-admin--danger btn-admin--sm" data-delete-post="${p.id}">Smazat</button>
      </td>
    </tr>`).join('');

  // Bind edit / delete buttons
  tbody.querySelectorAll('[data-edit-post]').forEach(btn => {
    btn.addEventListener('click', () => showPostModal(Number(btn.dataset.editPost)));
  });
  tbody.querySelectorAll('[data-delete-post]').forEach(btn => {
    btn.addEventListener('click', () => deletePost(Number(btn.dataset.deletePost)));
  });
}

// ── Post Modal ────────────────────────────────────────────────
function bindPostModal() {
  const btnNew = document.getElementById('btnNewPost');
  if (btnNew && !btnNew.dataset.bound) {
    btnNew.dataset.bound = '1';
    btnNew.addEventListener('click', () => showPostModal(null));
  }
}

function showPostModal(id = null) {
  const post    = id ? posts.find(p => p.id === id) : null;
  const overlay = document.getElementById('postModalOverlay');
  const titleEl = document.getElementById('postModalTitle');
  const form    = document.getElementById('postForm');
  if (!overlay || !form) return;

  titleEl.textContent = post ? 'Upravit příspěvek' : 'Nový příspěvek';

  form.elements.title.value        = post?.title        || '';
  form.elements.type.value         = post?.type         || 'text';
  form.elements.content.value      = post?.content      || '';
  form.elements.cover_image.value  = post?.cover_image  || '';
  form.elements.images_json.value  = post?.images_json  || '';
  form.elements.is_published.checked = post ? !!post.is_published : true;
  form.elements.published_at.value = toLocalDatetime(post?.published_at);
  if (form.elements.title_en) form.elements.title_en.value = post?.title_en || '';
  if (form.elements.content_en) form.elements.content_en.value = post?.content_en || '';

  // Reset lang tabs to CZ
  const langTabs = form.querySelectorAll('.lang-tab');
  langTabs.forEach(t => t.classList.toggle('active', t.dataset.langPane === 'cs'));
  form.querySelectorAll('.lang-pane--cs').forEach(el => el.style.display = '');
  form.querySelectorAll('.lang-pane--en').forEach(el => el.style.display = 'none');

  overlay.classList.remove('hidden');

  // Init Rich Text Editors
  if (window.RichTextEditor) {
    if (!portalRte) {
      portalRte = new window.RichTextEditor(form.elements.content);
    }
    portalRte.setValue(post?.content || '');

    if (!portalRteEn && form.elements.content_en) {
      portalRteEn = new window.RichTextEditor(form.elements.content_en);
    }
    if (portalRteEn) portalRteEn.setValue(post?.content_en || '');
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    await savePost(id);
  };
}

async function savePost(id) {
  const form = document.getElementById('postForm');
  if (!form) return;

  const body = {
    title:       form.elements.title.value.trim(),
    type:        form.elements.type.value,
    excerpt:     '',
    content:     portalRte ? portalRte.getValue() : form.elements.content.value.trim(),
    cover_image: form.elements.cover_image.value.trim(),
    images_json: form.elements.images_json.value.trim(),
    is_published: form.elements.is_published.checked ? 1 : 0,
    published_at: form.elements.published_at.value ? new Date(form.elements.published_at.value).toISOString() : null,
    title_en:    form.elements.title_en ? form.elements.title_en.value.trim() : '',
    excerpt_en:  '',
    content_en:  portalRteEn ? portalRteEn.getValue() : (form.elements.content_en ? form.elements.content_en.value.trim() : ''),
  };

  if (!body.title) { showToast('Název je povinný', 'error'); return; }

  try {
    const url    = id ? `/api/friend-portal/posts/${id}` : '/api/friend-portal/posts';
    const method = id ? 'PUT' : 'POST';

    await safeFetch(url, {
      method,
      headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    document.getElementById('postModalOverlay').classList.add('hidden');
    showToast(id ? 'Příspěvek aktualizován' : 'Příspěvek vytvořen');
    await loadPosts();
  } catch (err) {
    showToast(`Chyba: ${err.message}`, 'error');
  }
}

async function deletePost(id) {
  if (!confirm('Opravdu smazat tento příspěvek?')) return;
  try {
    await safeFetch(`/api/friend-portal/posts/${id}`, {
      method: 'DELETE',
      headers: auth.getAuthHeaders()
    });
    showToast('Příspěvek smazán');
    await loadPosts();
  } catch (err) {
    showToast(`Chyba: ${err.message}`, 'error');
  }
}

// ── Profile ───────────────────────────────────────────────────
let profileData = null;

async function loadProfile() {
  try {
    profileData = await safeFetch('/api/friend-portal/me', {
      headers: auth.getAuthHeaders()
    });
    renderProfile();
  } catch (err) {
    showToast(`Chyba načítání profilu: ${err.message}`, 'error');
  }
}

function renderProfile() {
  if (!profileData) return;

  const nameEl   = document.getElementById('profileName');
  const emailEl  = document.getElementById('profileEmail');
  const preview  = document.getElementById('profileAvatarPreview');
  const inputEl  = document.getElementById('profileAvatarInput');

  if (nameEl)  nameEl.textContent  = profileData.name  || '';
  if (emailEl) emailEl.textContent = profileData.email || '';

  if (preview) {
    if (profileData.avatar) {
      preview.innerHTML = `<img src="${escHtml(profileData.avatar)}" alt="${escHtml(profileData.name)}" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      preview.textContent = (profileData.name || '?').charAt(0).toUpperCase();
    }
  }

  if (inputEl) inputEl.value = profileData.avatar || '';
}

function bindAvatarForm() {
  const form = document.getElementById('avatarForm');
  if (form && !form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const avatar = form.elements.avatar.value.trim();
      try {
        await safeFetch('/api/friend-portal/profile', {
          method: 'PUT',
          headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar })
        });
        showToast('Avatar uložen');
        await loadProfile();
      } catch (err) {
        showToast(`Chyba: ${err.message}`, 'error');
      }
    });
  }
}

function bindPasswordForm() {
  const form = document.getElementById('passwordForm');
  if (form && !form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const current_password  = form.elements.current_password.value;
      const new_password      = form.elements.new_password.value;
      const confirm_password  = form.elements.confirm_password.value;

      if (new_password !== confirm_password) {
        showToast('Hesla se neshodují', 'error');
        return;
      }
      if (new_password.length < 8) {
        showToast('Heslo musí mít alespoň 8 znaků', 'error');
        return;
      }

      try {
        await safeFetch('/api/friend-portal/password', {
          method: 'PUT',
          headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ current_password, new_password })
        });
        showToast('Heslo bylo změněno');
        form.reset();
      } catch (err) {
        showToast(`Chyba: ${err.message}`, 'error');
      }
    });
  }
}

// ── Gallery ───────────────────────────────────────────────────
let galleryData = { images: [], usage_bytes: 0, limit_bytes: 0 };

async function loadGallery() {
  const grid = document.getElementById('galleryGrid');
  const usageLabel = document.getElementById('galleryUsageLabel');
  const usageFill  = document.getElementById('galleryUsageFill');
  if (!grid) return;

  grid.innerHTML = '<div style="color:var(--ink-dim);font-size:0.85rem">Načítám…</div>';

  try {
    galleryData = await safeFetch('/api/friend-portal/gallery/images', {
      headers: auth.getAuthHeaders()
    });
    renderGallery();
  } catch (err) {
    if (grid) grid.innerHTML = `<div style="color:var(--error);font-size:0.85rem">Chyba: ${escHtml(err.message)}</div>`;
    if (usageLabel) usageLabel.textContent = 'Chyba načítání';
  }
}

function renderGallery() {
  const grid       = document.getElementById('galleryGrid');
  const usageLabel = document.getElementById('galleryUsageLabel');
  const usageFill  = document.getElementById('galleryUsageFill');

  const { images, usage_bytes, limit_bytes } = galleryData;

  // Update usage bar
  if (usageLabel) {
    const usedMb  = (usage_bytes  / 1024 / 1024).toFixed(1);
    const limitMb = (limit_bytes  / 1024 / 1024).toFixed(0);
    usageLabel.textContent = `${usedMb} MB / ${limitMb} MB použito`;
  }
  if (usageFill && limit_bytes > 0) {
    const pct = Math.min(100, Math.round((usage_bytes / limit_bytes) * 100));
    usageFill.style.width = pct + '%';
    usageFill.style.background = pct >= 90 ? 'var(--error, #e53e3e)' : 'var(--violet-mid)';
  }

  if (!grid) return;

  if (!images.length) {
    grid.innerHTML = '<div style="color:var(--ink-dim);font-size:0.85rem">Galerie je prázdná. Nahrajte první fotku.</div>';
    return;
  }

  grid.innerHTML = images.map(img => `
    <div class="gallery-thumb-card" style="position:relative;border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-card)">
      <img src="${escHtml(img.image_url)}" alt="${escHtml(img.title || '')}"
           style="width:100%;aspect-ratio:1;object-fit:cover;display:block;cursor:pointer"
           data-copy-url="${escHtml(img.image_url)}" title="Kliknutím zkopírujete URL">
      <div style="padding:0.4rem 0.5rem;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:0.7rem;color:var(--ink-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px" title="${escHtml(img.title || img.identifier || '')}">
          ${escHtml(img.title || img.identifier || '')}
        </span>
        <button class="btn-admin btn-admin--danger btn-admin--sm" style="padding:0.15rem 0.4rem;font-size:0.7rem"
                data-delete-gallery="${img.id}" title="Smazat">✕</button>
      </div>
    </div>`).join('');

  grid.querySelectorAll('[data-copy-url]').forEach(el => {
    el.addEventListener('click', () => {
      const url = el.dataset.copyUrl;
      navigator.clipboard.writeText(url).then(() => {
        showToast('URL zkopírována do schránky');
      }).catch(() => {
        showToast('Nelze zkopírovat: ' + url, 'error');
      });
    });
  });

  grid.querySelectorAll('[data-delete-gallery]').forEach(btn => {
    btn.addEventListener('click', () => deleteGalleryImage(Number(btn.dataset.deleteGallery)));
  });
}

async function deleteGalleryImage(id) {
  if (!confirm('Opravdu smazat tento obrázek?')) return;
  try {
    await safeFetch(`/api/friend-portal/gallery/images/${id}`, {
      method: 'DELETE',
      headers: auth.getAuthHeaders()
    });
    showToast('Obrázek smazán');
    await loadGallery();
  } catch (err) {
    showToast(`Chyba: ${err.message}`, 'error');
  }
}

function bindGalleryUpload() {
  const input = document.getElementById('galleryUploadInput');
  if (!input || input.dataset.bound) return;
  input.dataset.bound = '1';

  input.addEventListener('change', async () => {
    if (!input.files || !input.files.length) return;

    const progressEl = document.getElementById('galleryUploadProgress');
    if (progressEl) { progressEl.style.display = 'block'; progressEl.textContent = 'Nahrávám…'; }

    const formData = new FormData();
    for (const file of input.files) formData.append('files', file);

    try {
      const response = await fetch('/api/friend-portal/gallery/upload', {
        method: 'POST',
        headers: auth.getAuthHeaders(),
        body: formData
      });
      const ct = response.headers.get('content-type');
      const data = ct?.includes('application/json') ? await response.json() : { error: await response.text() };

      if (!response.ok && !data.images?.length) {
        throw new Error(data.error || 'Nahrání selhalo');
      }

      const errCount = data.errors?.length || 0;
      if (errCount > 0) {
        showToast(`${data.message} (${errCount} chyb)`, 'error');
      } else {
        showToast(data.message || 'Nahráno');
      }

      await loadGallery();
    } catch (err) {
      showToast(`Chyba nahrávání: ${err.message}`, 'error');
    } finally {
      input.value = '';
      if (progressEl) progressEl.style.display = 'none';
    }
  });
}

// ── Gallery Picker ────────────────────────────────────────────
let galleryPickerTargetId = null;
let galleryPickerMulti    = false;
let gallerySelectedUrls   = [];
let galleryImages         = [];

async function openGalleryPicker(targetId, multi = false) {
  galleryPickerTargetId = targetId;
  galleryPickerMulti    = multi;
  gallerySelectedUrls   = [];

  const overlay  = document.getElementById('fpGalleryPickerOverlay');
  const grid     = document.getElementById('fpGalleryPickerGrid');
  const confirmBtn = document.getElementById('fpGalleryPickerConfirm');

  if (!overlay) return;
  overlay.classList.remove('hidden');
  grid.innerHTML = '<div style="color:var(--ink-dim);font-size:0.85rem">Načítám…</div>';
  confirmBtn.classList.add('hidden');

  try {
    const data = await safeFetch('/api/friend-portal/gallery/images', { headers: auth.getAuthHeaders() });
    galleryImages = Array.isArray(data) ? data : (data.images || []);
    renderGalleryPickerGrid();
  } catch (err) {
    grid.innerHTML = `<div style="color:var(--error);font-size:0.85rem">Chyba: ${escHtml(err.message)}</div>`;
  }
}

function renderGalleryPickerGrid() {
  const grid = document.getElementById('fpGalleryPickerGrid');
  const confirmBtn = document.getElementById('fpGalleryPickerConfirm');
  if (!grid) return;

  if (!galleryImages.length) {
    grid.innerHTML = '<div style="color:var(--ink-dim);font-size:0.85rem">Galerie je prázdná</div>';
    return;
  }

  grid.innerHTML = galleryImages.map(img => `
    <div class="gallery-picker-item" data-url="${escHtml(img.image_url)}" title="${escHtml(img.identifier || img.title || '')}">
      <img src="${escHtml(img.image_url)}" alt="${escHtml(img.alt_text || img.title || '')}" loading="lazy">
      <span class="gallery-picker-label">${escHtml(img.identifier || img.title || '')}</span>
    </div>`).join('');

  grid.querySelectorAll('.gallery-picker-item').forEach(item => {
    item.addEventListener('click', () => {
      const url = item.dataset.url;
      if (galleryPickerMulti) {
        const idx = gallerySelectedUrls.indexOf(url);
        if (idx === -1) {
          gallerySelectedUrls.push(url);
          item.classList.add('selected');
        } else {
          gallerySelectedUrls.splice(idx, 1);
          item.classList.remove('selected');
        }
        confirmBtn.classList.toggle('hidden', !gallerySelectedUrls.length);
      } else {
        // Single select — apply immediately
        const targetEl = document.getElementById(galleryPickerTargetId);
        if (targetEl) {
          targetEl.value = url;
          // Trigger input event so preview updates
          targetEl.dispatchEvent(new Event('input'));
        }
        document.getElementById('fpGalleryPickerOverlay').classList.add('hidden');
      }
    });
  });
}

function bindGalleryPicker() {
  if (document.body.dataset.galleryPickerBound) return;
  document.body.dataset.galleryPickerBound = '1';

  document.getElementById('btnPickAvatar')?.addEventListener('click', () => {
    openGalleryPicker('profileAvatarInput', false);
  });

  document.getElementById('btnPickPostCover')?.addEventListener('click', () => {
    openGalleryPicker('fpPortalCoverImage', false);
  });

  document.getElementById('btnPickPostImages')?.addEventListener('click', () => {
    openGalleryPicker('fpPortalImagesJson', true);
  });

  document.getElementById('fpGalleryPickerConfirm')?.addEventListener('click', () => {
    const targetEl = document.getElementById(galleryPickerTargetId);
    if (targetEl && gallerySelectedUrls.length) {
      targetEl.value = JSON.stringify(gallerySelectedUrls);
    }
    document.getElementById('fpGalleryPickerOverlay').classList.add('hidden');
  });

  // Live avatar preview on input change
  document.getElementById('profileAvatarInput')?.addEventListener('input', (e) => {
    const preview = document.getElementById('profileAvatarPreview');
    if (!preview) return;
    const val = e.target.value.trim();
    if (val) {
      preview.innerHTML = `<img src="${escHtml(val)}" alt="preview" style="width:100%;height:100%;object-fit:cover">`;
    } else if (profileData) {
      preview.textContent = (profileData.name || '?').charAt(0).toUpperCase();
    }
  });
}

// ── Start ─────────────────────────────────────────────────────
init();
