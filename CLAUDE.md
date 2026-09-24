# CLAUDE.md — Inachis

## Project
Inachis — premium personal creative platform.
Personal website for showcasing texts, artworks, jewelry, blog, and a friends network.

## Commands

```bash
npm install              # Install dependencies
npm start                # Production: node backend/server.js
npm run dev              # Development with nodemon
npm run test:homepage    # Homepage newest-tile rows (tests/homepage.mjs)
npm run test:gallery     # Gallery optimization + persistence (tests/gallery.mjs)
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
    ├── pages.js          Public page intro texts (Přehled → Stránky)
    ├── inquiries.js      Contact form: validation → email via Resend → DB archive
    └── services/
        └── email.js      Real email delivery via Resend HTTPS API (fetch, no SDK)
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

GET    /api/pages
GET    /api/pages/:slug
PUT    /api/pages/:slug                            # admin

POST   /api/inquiries                              # public; validates → sends real email (Resend) → archives to DB
GET    /api/inquiries/admin/all                    # admin
PUT    /api/inquiries/:id/read                     # admin
DELETE /api/inquiries/:id                          # admin
```

### Contact email environment variables

- `RESEND_API_KEY` — required; Resend API key (secret, Railway variable).
- `EMAIL_FROM` — required; sender address/domain verified with Resend.
- `CONTACT_EMAIL` — optional; recipient override. Falls back to the admin
  `contact_email` setting when unset.
- `RESEND_API_ENDPOINT` — optional; overrides the Resend endpoint (test seam only).

If required config is missing, `POST /api/inquiries` returns 503 with a safe generic
message; it never reports success without the provider confirming delivery.

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

## Gallery Upload Storage (persistent)

Uploaded Gallery images are optimized with sharp and stored on the **persistent
volume**, not in Git and not in the ephemeral container filesystem.

- Upload dir resolution (`backend/routes/gallery.js` `resolveUploadDir()`):
  `GALLERY_UPLOAD_DIR` env → else `/data/uploads/gallery` when `SQLITE_PATH`
  starts with `/data/` (Railway volume) → else `frontend/uploads/gallery`
  (local dev default, gitignored). On a Postgres deployment there is no
  `SQLITE_PATH`, so set `GALLERY_UPLOAD_DIR` explicitly.
- `backend/server.js` serves `GALLERY_UPLOAD_DIR` at `/uploads/gallery/<file>`
  (mounted before the generic `express.static(frontend)`).
- `image_url` is always stored as `/uploads/gallery/<filename>` — DB format is
  unchanged, no migration, no path rewrites.
- Upload flow: build buffer → sharp-optimize → write file → verify size on disk
  → insert DB record → on DB error unlink the orphan file.
- Optimization: auto-orient (EXIF), resize to ≤2000px (`fit: inside`,
  `withoutEnlargement`), JPEG q85 flattened onto white, WebP q85 (alpha kept),
  PNG `compressionLevel: 9` (alpha kept), animated GIF passthrough. Max upload
  50MB, MIME allowlist jpeg/png/webp/gif.
- Startup `reconcileLegacyGalleryFiles()` (called from `server.js` finally
  block) is a non-destructive safety net: it copies any DB-referenced file found
  only in the legacy container dir into the persistent dir and logs records that
  are missing in BOTH locations.

## Texty subcategories (data-driven)

Knihy / Povídky / Básně are real rows in the `categories` table: `slug`
(`knihy`/`povidky`/`basne`) is the URL segment and `page_slug='texty'` nests
them under the Texty menu page. They are seeded idempotently on startup
(`backend/database.js`) and managed from Admin → Přehled like any category.

- Public nav, `/texty/<slug>` routing and the admin menus are **all
  data-driven** — nothing about these three names is hardcoded in frontend.
  Public data comes from `GET /api/categories/public/all` (includes hidden
  subcategories; hidden ≠ deleted, direct URLs still resolve).
- `/texty/povidky` lists texts whose `texts.category` equals the category
  `name`; `/texty/<other>` falls back to a text detail slug.
- `categories.slug` is immutable after creation; renaming a category cascades
  to `texts.category`. `generateSlug()` normalises names to slugs client- and
  server-side (must stay in sync with the one in `routes/texts.js`).
- i18n keys are `nav.knihy` / `nav.povidky` / `nav.basne` (the old
  `nav.books/stories/poems` keys no longer exist and must not be reintroduced).

## Homepage newest-tile rows

`frontend/js/public.js` `renderHomepage()` loads the **list** endpoints
(`/api/texts|artworks|jewelry|blog|programming`) and renders the newest 4 items
of each content section in a horizontally scrollable `.scroll-row` (CSS in
`public.css`: flex, `overflow-x: auto`, scroll-snap, `width: min(280px, 78vw)`
tiles). Empty sections are omitted; the friends/about/contact sections are
unchanged. Because slugs are server-derived via `generateSlug(title)`, QA/test
suites match the seeded items by title prefix, not by slug.

## Safe deletion (categories & pages) — Admin Přehled

`DELETE /api/categories/:id` and `DELETE /api/pages/:slug` (admin-only) are the
delete actions behind the Smazat button in Admin → Přehled (Kategorie a stránky).

- Deletion is **not a cascade** and must never be turned into one. A record is
  only deleted once nothing references it; otherwise the endpoint returns
  `409` with a Czech explanation and the frontend keeps the row visible (toast
  shows the reason; `#confirmModalOverlay` in `frontend/admin.html`, logic in
  `frontend/admin/menu.js` `deleteConfirmed`). There is no
  `ON DELETE CASCADE` in the schema.
- Category delete is blocked while any `texts.category` equals the category
  `name`, or any `pages.category_id` references it (move/remove that content
  first). Pages are detached on category RENAME only (that cascades `category`
  name → kept texts), never on delete.
- Page delete is blocked for the seeded system skeleton
  (`DEFAULT_PAGE_SLUGS` in `backend/database.js` → `texty`, `kresba`, `blog`,
  `programovani`, `pratele`, `o-mne`, `kontakt`) since those rows are recreated
  on every startup — they can only be hidden, not deleted. It is also blocked
  while any `categories.page_slug` child subcategory references the page.
- Hiding is the non-destructive way to remove something from the public
  navigation. Hidden ≠ deleted (hidden subcategories like `/texty/knihy` still
  resolve).
- `frontend/js/public.js` `syncPublicNav()` removes stale `data-menu-page`
  links whose page no longer exists, so the public nav never points at a
  deleted page.

## Global content tags

Tags are **global and cross-category** (unlike menu categories): one tag can be
attached to any mix of texts, artworks, jewelry, blog, programming posts and
friend posts. They are managed from Admin → Přehled → "Štítky (tagy)" and
assigned from each editor's tag-chips input (`*TagsChips`/`*TagsInput` in
`frontend/admin.html`, `TagPicker` in `frontend/admin/tags.js`).

- Enforced on the tagged item's public detail: tags render between the perex and
  the cover image (texts/blog/programming/friend posts:
  `Title → Perex → Tags → Image → Content`; artworks/jewelry have no perex:
  `Title → Tags → Image → Content`). Never move the `.detail-tags` block.
- Public tag pages live at `/tag/<slug>` (`frontend/js/public.js`
  `renderTagPage()`, `TAG_SECTION_KEYS` maps a content type to its public
  section URL). Each tagged item is listed once per section, in published-only
  order. A tag with no visible items renders the `.empty-state`.
- `tags.slug` is **immutable** after creation (renaming changes only `name`).
  `slugifyTag()` (backend `routes/tags.js`) produces lowercased ASCII slugs;
  case-insensitive duplicates are rejected with 400 (Czech message):
  "Štítek s tímto názvem (URL) již existuje".
- All tag admin routes are admin-only
  (`POST/PUT/DELETE /api/tags`, `GET /api/tags/admin/all`,
  `POST /api/tags/admin/assign`, `GET /api/tags/admin/by-content`); the public
  list is `GET /api/tags` and the page is `GET /api/tags/:slug`.
- Assignment writes to `content_tags` (join table). Content **POST/PUT**
  responses are `{ message, item }`; editors capture `result?.item?.id` and call
  `tagPicker.assign(type, savedId)` in `saveItem` — a tag failure must never
  break the content save (wrapped in try/catch that only toasts the error).
- Deleting a tag **never cascades**: it only removes the `content_tags` rows;
  content stays fully intact. Deleting content cleans up its join rows.
  `artworks`/`jewelry` have no `published_at` column, so their tag-detail
  queries select `NULL as published_at` explicitly.
- i18n keys: `empty.tags` / `empty.tagsDesc` (cs + en); tag-page section labels
  reuse the existing nav keys.

## Known Rules

1. ALL routes use `logger` — no console.log in backend
2. ALL routes use `{ AuthMiddleware }` named import
3. `generateSlug()` in every route that needs it
4. Safe Fetch Pattern on ALL admin JS fetch calls
5. `esc()` helper in public.js on ALL user content in innerHTML
6. Gallery upload uses multer.memoryStorage() + sharp; files go to the
   persistent volume dir (see Gallery Upload Storage above)
7. Port 3004
8. DB file: `backend/inachis.db`
9. `"type": "module"` in package.json
10. `dataset.bound` guard on event listeners that run multiple times
