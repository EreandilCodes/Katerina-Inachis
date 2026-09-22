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
      <div style="max-width:600px">
        <p style="font-family:var(--font-display);font-weight:300;font-size:1.4rem;color:var(--violet);letter-spacing:0.04em;margin-bottom:1rem">
          Vítejte v administraci Inachis.
        </p>
        <p style="font-family:var(--font-body);font-weight:300;color:var(--ink-mid);line-height:1.7">
          Pomocí postranní navigace spravujte obsah svého webu — texty, díla, šperky, blog, přátele a galerii.
        </p>
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
