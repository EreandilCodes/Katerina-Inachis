# CLAUDE.md — Inachis

## Project
Inachis — premium personal creative platform.
Personal website for showcasing texts, artworks, jewelry, blog, and a friends network.

## Commands

```bash
npm install              # Install dependencies
npm start                # Production: node backend/server.js
npm run dev              # Development with nodemon
```

**Access Points:**
- Public web:  http://localhost:3004/
- Admin panel: http://localhost:3004/admin
- Login:       http://localhost:3004/login
- Default Admin: admin@inachis.art / admin123

**Port:** 3004

---

## Architecture

Built on Eolite/KanjoWin architecture:
- `database.js` → SQLite/Postgres dual wrapper, `db.prepare().run/get/all`
- `middleware/auth.js` → Named export `{ AuthMiddleware }`, `verifyToken` + `adminOnly`
- `logger.js` → Structured logging (KanjoWin copy)
- `middleware/request-logger.js` → Per-request logging with AsyncLocalStorage (KanjoWin copy)
- Admin manager pattern → Class-based with init/loadItems/renderItems/showModal/saveItem/deleteItem
- Safe Fetch Pattern on ALL frontend fetch calls
- `esc(str)` XSS protection on ALL user content in innerHTML

---

## Backend

```
backend/
├── server.js             Express entry point, port 3004
├── database.js           SQLite init (same dual wrapper as Eolite)
├── logger.js             Structured logger (copy from KanjoWin)
├── middleware/
│   ├── auth.js           JWT verify + adminOnly (named export)
│   └── request-logger.js Per-request logger (copy from KanjoWin)
└── routes/
    ├── auth.js           POST /login, GET /me, PUT /password, rate limiting
    ├── texts.js          Texts/essays CRUD
    ├── artworks.js       Artworks CRUD
    ├── jewelry.js        Jewelry CRUD
    ├── blog.js           Blog posts CRUD
    ├── friends.js        Friends CRUD
    ├── friend-posts.js   Friend posts CRUD
    ├── gallery.js        Gallery folders + images + upload
    ├── settings.js       Site settings key-value
    └── inquiries.js      Contact form submissions
```

### Critical import pattern
```javascript
// ✅ CORRECT – named export
import { AuthMiddleware } from '../middleware/auth.js';

// ❌ WRONG
import AuthMiddleware from '../middleware/auth.js';
```

---

## Database Schema

### Tables
- `users` — admin + friends (role: admin|friend|viewer)
- `texts` — literary texts/essays
- `artworks` — visual art pieces
- `jewelry` — jewelry items
- `blog_posts` — blog
- `friends` — friend profiles
- `friend_posts` — posts by friends
- `gallery_folders` — gallery folders (adjacency list)
- `gallery_images` — gallery images with identifiers
- `inquiries` — contact form submissions
- `settings` — key-value site settings

---

## API Routes

```
POST   /api/auth/login                          # rate limited
GET    /api/auth/me
PUT    /api/auth/password                        # admin changes own password (rate limited)

GET    /api/texts                               # published
GET    /api/texts/admin/all                     # admin
GET    /api/texts/featured                      # is_featured=1
GET    /api/texts/:slug                         # public single
POST   /api/texts                               # admin
PUT    /api/texts/:id                           # admin
DELETE /api/texts/:id                           # admin

GET    /api/artworks
GET    /api/artworks/admin/all
GET    /api/artworks/featured
GET    /api/artworks/:slug
POST   /api/artworks
PUT    /api/artworks/:id
DELETE /api/artworks/:id

GET    /api/jewelry
GET    /api/jewelry/admin/all
GET    /api/jewelry/featured
GET    /api/jewelry/:slug
POST   /api/jewelry
PUT    /api/jewelry/:id
DELETE /api/jewelry/:id

GET    /api/blog
GET    /api/blog/admin/all
GET    /api/blog/featured
GET    /api/blog/:slug
POST   /api/blog
PUT    /api/blog/:id
DELETE /api/blog/:id

GET    /api/friends
GET    /api/friends/admin/all
GET    /api/friends/:slug
POST   /api/friends
PUT    /api/friends/:id
DELETE /api/friends/:id

GET    /api/friend-posts
GET    /api/friend-posts/admin/all
GET    /api/friend-posts/by-friend/:friendSlug
GET    /api/friend-posts/:slug
POST   /api/friend-posts
PUT    /api/friend-posts/:id
DELETE /api/friend-posts/:id

GET    /api/gallery/folders
POST   /api/gallery/folders
PUT    /api/gallery/folders/:id
DELETE /api/gallery/folders/:id
GET    /api/gallery/images
POST   /api/gallery/images
PUT    /api/gallery/images/:id
DELETE /api/gallery/images/:id
POST   /api/gallery/upload

GET    /api/settings/public
GET    /api/settings/admin/all
PUT    /api/settings/:key

POST   /api/inquiries
GET    /api/inquiries/admin/all
PUT    /api/inquiries/:id/read
DELETE /api/inquiries/:id
```

---

## SPA Routes (public)

| Path | View |
|------|------|
| `/` | Homepage |
| `/texty` | Texts list |
| `/texty/:slug` | Text detail |
| `/umeni` | Artworks gallery |
| `/umeni/:slug` | Artwork detail |
| `/sperky` | Jewelry grid |
| `/sperky/:slug` | Jewelry detail |
| `/blog` | Blog list |
| `/blog/:slug` | Blog post |
| `/pratele` | Friends index |
| `/pratele/:friendSlug` | Friend page |
| `/pratele/:friendSlug/:postSlug` | Friend post detail |
| `/o-mne` | About page |
| `/kontakt` | Contact form |

---

## Safe Fetch Pattern (MANDATORY)

```javascript
const response = await fetch(url, options);
const contentType = response.headers.get('content-type');

if (!response.ok) {
  const err = contentType?.includes('application/json')
    ? await response.json()
    : { error: await response.text() };
  throw new Error(err.error || 'Request failed');
}

if (!contentType?.includes('application/json')) {
  throw new Error('Server returned non-JSON response');
}

const data = await response.json();
```

---

## Admin Manager Pattern

```javascript
class XManager {
  constructor(auth) { this.auth = auth; this.items = []; }
  async init() { await this.loadItems(); this.bindEvents(); }
  async loadItems() { /* Safe Fetch Pattern */ }
  renderItems() { /* innerHTML into tbody */ }
  showModal(item = null) { /* fill form, set onsubmit */ }
  async saveItem() { /* POST or PUT */ }
  async deleteItem(id) { /* confirm + DELETE */ }
}
```

---

## Known Rules

1. ALL routes use `logger` — no console.log in backend
2. ALL routes use `{ AuthMiddleware }` named import
3. `generateSlug()` in every route that needs it
4. Safe Fetch Pattern on ALL admin JS fetch calls
5. `esc()` helper in public.js on ALL user content in innerHTML
6. Gallery upload uses multer.memoryStorage() + sharp
7. Port 3004
8. DB file: `backend/inachis.db`
9. `"type": "module"` in package.json
10. `dataset.bound` guard on event listeners that run multiple times
