// ============================================================
// Inachis — admin.js
// AdminController — orchestrates all section managers
// ============================================================

import { AuthManager } from './auth.js';
import { TextsManager }       from '../admin/texts.js';
import { ArtworksManager }    from '../admin/artworks.js';
import { JewelryManager }     from '../admin/jewelry.js';
import { BlogManager }        from '../admin/blog.js';
import { ProgrammingManager } from '../admin/programming.js';
import { FriendsManager }     from '../admin/friends.js';
import { FriendPostsManager } from '../admin/friend-posts.js';
import { GalleryManager }     from '../admin/gallery.js';
import { SettingsManager }    from '../admin/settings.js';
import { PagesManager }       from '../admin/pages.js';
import { MenuManager }        from '../admin/menu.js';

const SECTION_TITLES = {
  overview:     'Přehled',
  pages:        'Stránky',
  texts:        'Texty',
  artworks:     'Umění',
  jewelry:      'Šperky',
  blog:         'Blog',
  programming:  'Programování',
  friends:      'Přátelé',
  friendposts:  'Příspěvky přátel',
  gallery:      'Galerie',
  settings:     'Nastavení',
};

class AdminController {
  constructor() {
    this.auth     = new AuthManager();
    this.managers = {};
    this.currentSection = null;
  }

  async init() {
    await this.auth.checkAuth();
    this.setupLogout();
    this.setupNav();
    await this.loadSection('overview');
  }

  setupLogout() {
    document.getElementById('btnLogout')?.addEventListener('click', () => {
      if (confirm('Opravdu se chcete odhlásit?')) {
        this.auth.logout();
      }
    });
  }

  setupNav() {
    document.querySelectorAll('[data-section]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const section = el.dataset.section;
        this.loadSection(section);
      });
    });
  }

  async loadSection(name) {
    this.currentSection = name;
    this.updateNav(name);
    this.updateHeader(name);
    this.showSection(name);

    if (name === 'overview') {
      this.renderOverview();
      this.managers.menu ??= new MenuManager(this.auth, this);
      this.managers.menu.init();
      return;
    }

    try {
      switch (name) {
        case 'pages':
          this.managers.pages ??= new PagesManager(this.auth, this);
          await this.managers.pages.init();
          break;
        case 'texts':
          this.managers.texts ??= new TextsManager(this.auth, this);
          await this.managers.texts.init();
          break;
        case 'artworks':
          this.managers.artworks ??= new ArtworksManager(this.auth, this);
          await this.managers.artworks.init();
          break;
        case 'jewelry':
          this.managers.jewelry ??= new JewelryManager(this.auth, this);
          await this.managers.jewelry.init();
          break;
        case 'blog':
          this.managers.blog ??= new BlogManager(this.auth, this);
          await this.managers.blog.init();
          break;
        case 'programming':
          this.managers.programming ??= new ProgrammingManager(this.auth, this);
          await this.managers.programming.init();
          break;
        case 'friends':
          this.managers.friends ??= new FriendsManager(this.auth, this);
          await this.managers.friends.init();
          break;
        case 'friendposts':
          this.managers.friendposts ??= new FriendPostsManager(this.auth, this);
          await this.managers.friendposts.init();
          break;
        case 'gallery':
          this.managers.gallery ??= new GalleryManager(this.auth, this);
          await this.managers.gallery.init();
          break;
        case 'settings':
          this.managers.settings ??= new SettingsManager(this.auth, this);
          await this.managers.settings.init();
          break;
      }
    } catch (err) {
      this.showNotification(`Chyba načítání: ${err.message}`, 'error');
    }
  }

  updateNav(name) {
    document.querySelectorAll('[data-section]').forEach(el => {
      el.classList.toggle('active', el.dataset.section === name);
    });
  }

  updateHeader(name) {
    const title = document.getElementById('adminPageTitle');
    if (title) title.textContent = SECTION_TITLES[name] || name;
  }

  showSection(name) {
    document.querySelectorAll('.admin-section').forEach(s => {
      s.classList.remove('active');
    });
    const el = document.getElementById(`${name}Section`);
    if (el) el.classList.add('active');
  }

  renderOverview() {
    const el = document.getElementById('overviewSection');
    if (!el) return;
    el.innerHTML = `
      <div style="max-width:960px">
        <div style="max-width:600px">
          <p style="font-family:var(--font-display);font-weight:300;font-size:1.4rem;color:var(--violet);letter-spacing:0.04em;margin-bottom:1rem">
            Vítejte v administraci Inachis.
          </p>
          <p style="font-family:var(--font-body);font-weight:300;color:var(--ink-mid);line-height:1.7">
            Pomocí postranní navigace spravujte obsah svého webu — texty, díla, šperky, blog, přátele a galerii.
          </p>
        </div>

        <div style="margin-top:2.5rem">
          <h3 style="font-family:var(--font-display);font-weight:600;font-size:1.15rem;color:var(--violet);letter-spacing:0.03em">Kategorie a stránky / Menu</h3>
          <p style="font-family:var(--font-body);font-size:0.85rem;color:var(--ink-mid);line-height:1.7;margin-top:0.4rem">
            Spravujte hlavní menu webu. Skryté položky zmizí z veřejné navigace, ale jejich obsah zůstává zachován
            a zůstává dostupný přímou adresou (URL).
          </p>

          <div style="margin-top:2rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;gap:1rem;flex-wrap:wrap">
              <strong style="font-family:var(--font-body);font-size:0.85rem;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-mid)">Kategorie / hlavní sekce</strong>
              <button class="btn-admin btn-admin--primary btn-admin--sm" onclick="window.admin.managers.menu?.openCategoryModal()">+ Přidat kategorii</button>
            </div>
            <table class="admin-table" id="menuCategoriesTable">
              <thead>
                <tr><th>Název</th><th>Viditelnost</th><th class="td-actions">Akce</th></tr>
              </thead>
              <tbody><tr><td colspan="3" style="text-align:center;color:var(--ink-dim);padding:2rem">Načítám…</td></tr></tbody>
            </table>
          </div>

          <div style="margin-top:2.5rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;gap:1rem;flex-wrap:wrap">
              <strong style="font-family:var(--font-body);font-size:0.85rem;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-mid)">Položky menu / stránky</strong>
              <button class="btn-admin btn-admin--primary btn-admin--sm" onclick="window.admin.managers.menu?.openPageModal()">+ Přidat položku menu</button>
            </div>
            <table class="admin-table" id="menuItemsTable">
              <thead>
                <tr><th>Název</th><th>Kategorie</th><th>Viditelnost</th><th class="td-actions">Akce</th></tr>
              </thead>
              <tbody><tr><td colspan="4" style="text-align:center;color:var(--ink-dim);padding:2rem">Načítám…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  showNotification(message, type = 'success') {
    const toast = document.getElementById('adminToast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `admin-toast${type === 'error' ? ' admin-toast--error' : ''}`;
    toast.classList.add('show');

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }
}

// ── Init ──────────────────────────────────────────────────────
const admin = new AdminController();
admin.init().catch(console.error);

// Expose globally for gallery picker
window.admin = admin;
