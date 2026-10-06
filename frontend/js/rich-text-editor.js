/**
 * RichTextEditor — custom WYSIWYG editor for Inachis admin panel.
 * Self-contained, no external dependencies.
 */
class RichTextEditor {
  constructor(textarea) {
    this.textarea = textarea;
    this.mode = 'visual';
    this._build();
    this._bindEvents();
  }

  // ── Build DOM ──────────────────────────────────────────────

  _build() {
    // Wrapper
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'rte-wrapper';

    // Tab bar
    this.tabs = document.createElement('div');
    this.tabs.className = 'rte-tabs';

    this.tabVisual = this._createTab('Vizu\u00e1ln\u00ed', true);
    this.tabHTML = this._createTab('HTML', false);
    this.tabs.appendChild(this.tabVisual);
    this.tabs.appendChild(this.tabHTML);

    // Toolbar
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'rte-toolbar';

    const buttons = [
      { label: 'H1',       action: () => this._formatBlock('h1') },
      { label: 'H2',       action: () => this._formatBlock('h2') },
      { label: 'H3',       action: () => this._formatBlock('h3') },
      { label: 'B',        action: () => document.execCommand('bold') },
      { label: 'I',        action: () => document.execCommand('italic') },
      { label: 'U',        action: () => document.execCommand('underline') },
      { label: 'Perex',    action: () => this._formatBlock('blockquote') },
      { label: 'UL',       action: () => document.execCommand('insertUnorderedList') },
      { label: 'OL',       action: () => document.execCommand('insertOrderedList') },
      { label: 'Link',     action: () => this._insertLink() },
      { label: 'YouTube',  action: () => this._insertYouTube() },
    ];

    buttons.forEach(({ label, action }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        action();
        this._syncToTextarea();
      });
      this.toolbar.appendChild(btn);
    });

    // Contenteditable area
    this.content = document.createElement('div');
    this.content.className = 'rte-content';
    this.content.contentEditable = 'true';
    this.content.innerHTML = this.textarea.value || '';

    // Source textarea (for HTML tab)
    this.source = document.createElement('textarea');
    this.source.className = 'rte-source';
    this.source.style.display = 'none';

    // Hide original textarea
    this.textarea.style.display = 'none';

    // Assemble
    this.wrapper.appendChild(this.tabs);
    this.wrapper.appendChild(this.toolbar);
    this.wrapper.appendChild(this.content);
    this.wrapper.appendChild(this.source);

    // Insert wrapper right after the original textarea
    this.textarea.parentNode.insertBefore(this.wrapper, this.textarea.nextSibling);
  }

  _createTab(label, active) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'rte-tab' + (active ? ' active' : '');
    tab.textContent = label;
    return tab;
  }

  // ── Events ─────────────────────────────────────────────────

  _bindEvents() {
    // Sync contenteditable → hidden textarea on every input
    this.content.addEventListener('input', () => this._syncToTextarea());

    // Clean document styling out of pasted HTML before it is inserted
    this.content.addEventListener('paste', (e) => this._handlePaste(e));

    // Tab switching
    this.tabVisual.addEventListener('click', () => this._switchTab('visual'));
    this.tabHTML.addEventListener('click', () => this._switchTab('html'));

    // Sync source textarea changes back when typing in HTML mode
    this.source.addEventListener('input', () => {
      this.textarea.value = this.source.value;
    });
  }

  _switchTab(mode) {
    this.mode = mode;

    if (mode === 'visual') {
      // HTML → Visual: push source value into contenteditable
      const html = this.source.value;
      this.textarea.value = html;
      // Live YouTube iframes make the contenteditable hard to edit (the iframe
      // swallows clicks/keyboard, Enter around it misbehaves, and the player
      // reserves a big empty area) — render lightweight previews instead.
      this.content.innerHTML = this._previewsForEditing(html);

      this.tabVisual.classList.add('active');
      this.tabHTML.classList.remove('active');
      this.toolbar.style.display = '';
      this.content.style.display = '';
      this.source.style.display = 'none';
    } else {
      // Visual → HTML: read from contenteditable into source
      const html = this._normalizeYtCaptions(this._restoreEmbeds(this.content.innerHTML));
      // Clean up browser-generated empty content
      const cleaned = (html === '<br>' || html === '<br/>') ? '' : html;
      this.source.value = cleaned;
      this.textarea.value = cleaned;

      this.tabHTML.classList.add('active');
      this.tabVisual.classList.remove('active');
      this.toolbar.style.display = 'none';
      this.content.style.display = 'none';
      this.source.style.display = '';
    }
  }

  // ── Paste sanitising ───────────────────────────────────────

  _handlePaste(e) {
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;

    const html = cd.getData('text/html');
    const clean = html
      ? this._sanitizePastedHtml(html)
      : this._escapeHtml(cd.getData('text/plain')).replace(/\r\n|\r|\n/g, '<br>');

    // Nothing usable (e.g. an image-only paste) — leave it to the browser.
    if (!clean) return;

    e.preventDefault();
    document.execCommand('insertHTML', false, clean);
    this._syncToTextarea();
  }

  // Word and Google Docs wrap every paragraph in the document's own inline
  // styling: font-size:11pt, their font-family, a tight line-height, their
  // colours. Those attributes reach the stored story and then outrank every
  // rule in public.css, so a published body text stays at 14.7px however
  // large the site's type scale grows. Dropping them here stops new pastes
  // from carrying the problem; the .text-content guard in public.css covers
  // the stories that were pasted before this handler existed.
  // Structure survives untouched — paragraphs, headings, lists, links,
  // bold/italic/underline, images and the editor's own .yt-embed markup.
  // Classes are deliberately kept: they are how the embeds and captions are
  // recognised, and document classes (MsoNormal, google-docs-guard) match
  // no rule on the public site anyway.
  _sanitizePastedHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.body;
    if (!body) return '';

    // Document chrome and Office <style> blocks — never story text.
    body
      .querySelectorAll('style, script, meta, link, title, noscript, object, applet, form, input, button, select, textarea')
      .forEach((el) => el.remove());

    body.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();

      // Office/Docs wrapper elements (o:p, w:sdt, mso-*) and <font> —
      // unwrapped so the text they hold is kept.
      //
      // Same for an inline element wrapped around whole blocks: Google Docs
      // encloses the entire paste in <b style="font-weight:normal">, i.e.
      // "not bold". Once the style attribute goes, that <b> would silently
      // bold the whole story, so the wrapper has to go with it.
      const isWrapper = tag.includes(':') || tag === 'font' ||
        (/^(b|strong|i|em|u|s|strike|small|span)$/.test(tag) &&
          Array.from(el.children).some((child) =>
            /^(p|div|h[1-6]|ul|ol|blockquote|table|hr|figure|section|article)$/.test(child.tagName.toLowerCase())));
      if (isWrapper) {
        el.replaceWith(...Array.from(el.childNodes));
        return;
      }

      // Presentation belongs to the source document, not to the site: the
      // article is laid out by public.css alone.
      ['style', 'id', 'face', 'size', 'color', 'bgcolor', 'align', 'lang', 'dir'].forEach((attr) => {
        if (el.hasAttribute(attr)) el.removeAttribute(attr);
      });
    });

    return body.innerHTML;
  }

  // ── Toolbar actions ────────────────────────────────────────

  _formatBlock(tag) {
    document.execCommand('formatBlock', false, '<' + tag + '>');
  }

  _insertLink() {
    const url = prompt('URL odkazu:');
    if (url) {
      document.execCommand('createLink', false, url);
    }
  }

  _insertYouTube() {
    const url = prompt('YouTube URL:');
    if (!url) return;

    const videoId = this._parseYouTubeId(url);
    if (!videoId) {
      alert('Nepoda\u0159ilo se rozpoznat YouTube video ID.');
      return;
    }

    // Optional caption that belongs to this video only. Plain text: any HTML
    // in it is escaped so it can never inject markup on its own.
    const caption = prompt('Popisek k videu (nepovinn\u00fd):');
    const embed =
      '<div class="yt-embed">' +
        '<iframe src="https://www.youtube-nocookie.com/embed/' + videoId + '" allowfullscreen></iframe>' +
      '</div>';

    // With a caption the video is wrapped in a <figure>; without one the legacy
    // bare .yt-embed markup is kept so older stored content stays consistent.
    const trimmed = caption && caption.trim();
    const html = trimmed
      ? '<figure class="yt-figure">' + embed + '<figcaption class="yt-caption">' + this._escapeHtml(trimmed) + '</figcaption></figure>'
      : embed;

    // Insert the embed (stored markup is unchanged) and then an empty paragraph.
    // execCommand('insertHTML') would leave the caret inside/next to the embed
    // div, where Enter does nothing and the author gets "stuck" — so the caret
    // is moved into that paragraph explicitly: the author can immediately keep
    // writing and formatting below the video.
    document.execCommand('insertHTML', false, html + '<p><br></p>');
    // Swap the freshly inserted live iframe for the editing preview right away,
    // so the embed never behaves like a live player while editing.
    this.content.innerHTML = this._previewsForEditing(this.content.innerHTML);
    this._placeCaretAfterYouTube();
  }

  // Put the caret into the first empty paragraph right after the freshly
  // inserted YouTube embed, so the author can keep typing immediately.
  _placeCaretAfterYouTube() {
    const editable = this.content;
    const sel = window.getSelection();
    const range = document.createRange();
    const yt = editable.querySelector('.rte-yt-preview:last-of-type') ||
               editable.querySelector('.yt-embed:last-of-type');
    // Walk forward from the embed: skip the caption inside a figure wrapper
    // and land in the paragraph AFTER the whole video block (or append one).
    if (yt) {
      const wrapper = yt.closest('figure') || yt;
      let node = wrapper.nextElementSibling;
      let p = null;
      while (node && node.tagName !== 'P') node = node.nextElementSibling;
      if (!node) {
        // No paragraph after the video yet — create one and keep the caret in it.
        p = document.createElement('p');
        p.appendChild(document.createElement('br'));
        wrapper.parentNode.insertBefore(p, wrapper.nextSibling);
      } else {
        p = node;
      }
      range.setStart(p, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    // Fallback: caret at the very end of the editable area.
    range.selectNodeContents(editable);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ── YouTube editing previews ───────────────────────────────

  // Replace live YouTube embeds with editable previews inside the
  // contenteditable. The stored markup (div.yt-embed > iframe, optionally in
  // figure.yt-figure) is preserved exactly — the preview carries the original
  // iframe in a data attribute and is swapped back on save/tab switch.
  _previewsForEditing(html) {
    if (typeof html !== 'string' || html.indexOf('yt-embed') === -1) return html;

    const container = document.createElement('div');
    container.innerHTML = html;

    container.querySelectorAll('.yt-embed iframe').forEach((iframe) => {
      const embed = iframe.closest('.yt-embed');
      const videoId = this._parseYouTubeId(iframe.getAttribute('src') || '');
      const preview = document.createElement('div');
      preview.className = 'rte-yt-preview';
      preview.setAttribute('contenteditable', 'false');
      preview.dataset.ytEmbed = embed.outerHTML;
      preview.innerHTML =
        '<span class="rte-yt-badge">YouTube</span>' +
        (videoId
          ? '<img class="rte-yt-thumb" src="https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg" alt="">'
          : '') +
        '<span class="rte-yt-note">Video — text upravte vedle náhledu</span>';
      embed.replaceWith(preview);
    });

    return container.innerHTML;
  }

  // Transparently swap editing previews back to the real embed markup.
  _restoreEmbeds(html) {
    if (typeof html !== 'string' || html.indexOf('rte-yt-preview') === -1) return html;

    const container = document.createElement('div');
    container.innerHTML = html;

    container.querySelectorAll('.rte-yt-preview').forEach((preview) => {
      const embed = preview.dataset.ytEmbed;
      if (embed) preview.replaceWith(...Array.from(new DOMParser().parseFromString(embed, 'text/html').body.childNodes));
      else preview.remove(); // corrupted preview — drop it instead of saving junk
    });

    return container.innerHTML;
  }

  // ── YouTube caption helpers ────────────────────────────────

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Removes figure.yt-figure wrappers whose caption is empty (e.g. when the
  // author deletes all caption text) so no stray empty <figcaption>/<figure>
  // element is ever saved. Output stays backward compatible: a caption-less
  // video becomes the legacy bare .yt-embed markup.
  _normalizeYtCaptions(html) {
    if (typeof html !== 'string' || html.indexOf('yt-figure') === -1) return html;

    const container = document.createElement('div');
    container.innerHTML = html;

    const emptyFigures = [];
    container.querySelectorAll('figure.yt-figure').forEach((fig) => {
      const caption = fig.querySelector('.yt-caption');
      if (!caption || caption.textContent.trim() === '') emptyFigures.push(fig);
    });
    emptyFigures.forEach((fig) => fig.replaceWith(...Array.from(fig.childNodes)));

    return container.innerHTML;
  }

  _parseYouTubeId(url) {
    // youtube.com/watch?v=VIDEO_ID
    let match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    // youtu.be/VIDEO_ID
    match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    // youtube.com/embed/VIDEO_ID
    match = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    // youtube-nocookie.com/embed/VIDEO_ID
    match = url.match(/youtube-nocookie\.com\/embed\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    return null;
  }

  // ── Sync & Public API ──────────────────────────────────────

  _syncToTextarea() {
    const html = this._restoreEmbeds(this.content.innerHTML);
    this.textarea.value = html;
    // Keep source in sync so switching to HTML tab always shows current content
    this.source.value = html;
  }

  getValue() {
    if (this.mode === 'html') {
      return this._normalizeYtCaptions(this.source.value);
    }
    return this._normalizeYtCaptions(this._restoreEmbeds(this.content.innerHTML));
  }

  setValue(html) {
    this.content.innerHTML = this._previewsForEditing(html || '');
    this.source.value = html || '';
    this.textarea.value = html || '';
  }
}

window.RichTextEditor = RichTextEditor;
