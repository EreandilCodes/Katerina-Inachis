// ── Global content tags — helper library ─────────────────────────────────
// Normalized many-to-many (tags ↔ content items) shared by routes/tags.js and
// the content routers (texts/artworks/jewelry/blog/programming/friend-posts).
// Tags are global (cross-category) and distinct from menu categories. A tag
// deletion removes only its `content_tags` associations — never content.

import db from './database.js';

export const TAG_CONTENT_TYPES = Object.freeze([
  'text',
  'artwork',
  'jewelry',
  'blog_post',
  'programming_post',
  'friend_post',
]);

// content_type → backing table (trusted constant map, never user input).
const TAG_TABLE_FOR = Object.freeze({
  text:             'texts',
  artwork:          'artworks',
  jewelry:          'jewelry',
  blog_post:        'blog_posts',
  programming_post: 'programming_posts',
  friend_post:      'friend_posts',
});

export function isValidContentType(contentType) {
  return TAG_CONTENT_TYPES.includes(contentType);
}

// Must stay in sync with generateSlug() in the content routes so a tag's
// public URL always matches the client-side normalization.
export function slugifyTag(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Tag rows the given content item is linked to (used by public detail pages
// and by the admin content editors). Empty array for unknown content types.
export async function getTagsForContent(contentType, contentId) {
  if (!isValidContentType(contentType)) return [];
  return db.prepare(`
    SELECT t.id, t.name, t.name_en, t.slug
    FROM tags t
    JOIN content_tags c ON c.tag_id = t.id
    WHERE c.content_type = ? AND c.content_id = ?
    ORDER BY lower(t.name), t.id
  `).all(contentType, contentId);
}

// Replace the full tag set of a content item (transactional per item). tagIds
// that do not exist are rejected instead of silently dropped.
export async function replaceContentTags(contentType, contentId, tagIds) {
  if (!isValidContentType(contentType)) {
    throw new TypeError('Neplatný typ obsahu');
  }
  const ids = Array.isArray(tagIds)
    ? [...new Set(tagIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];

  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await db.prepare(`SELECT id FROM tags WHERE id IN (${placeholders})`).all(...ids);
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) throw new Error('Neexistující štítek');
  }

  await db.prepare(
    'DELETE FROM content_tags WHERE content_type = ? AND content_id = ?'
  ).run(contentType, contentId);

  for (const tagId of ids) {
    await db.prepare(`
      INSERT INTO content_tags (tag_id, content_type, content_id)
      VALUES (?, ?, ?)
      ON CONFLICT (tag_id, content_type, content_id) DO NOTHING
    `).run(tagId, contentType, contentId);
  }

  return getTagsForContent(contentType, contentId);
}

// Remove every association a content item has (called on content deletion so
// the join table never keeps dangling links).
export async function deleteContentTags(contentType, contentId) {
  if (!isValidContentType(contentType)) return;
  await db.prepare(
    'DELETE FROM content_tags WHERE content_type = ? AND content_id = ?'
  ).run(contentType, contentId);
}

// Verify a linked content item actually exists. Used by the assign endpoint so
// the join table never holds a link to a missing row.
export async function contentExists(contentType, contentId) {
  const table = TAG_TABLE_FOR[contentType];
  if (!table) return false;
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(contentId);
  return !!row;
}