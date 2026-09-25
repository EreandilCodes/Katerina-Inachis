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
      this.content.innerHTML = html;
      this.textarea.value = html;

      this.tabVisual.classList.add('active');
      this.tabHTML.classList.remove('active');
      this.toolbar.style.display = '';
      this.content.style.display = '';
      this.source.style.display = 'none';
    } else {
      // Visual → HTML: read from contenteditable into source
      const html = this._normalizeYtCaptions(this.content.innerHTML);
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
      ? '<figure class="yt-figure">' + embed + '<figcaption class="yt-caption">' + this._escapeHtml(trimmed) + '</figcaption></figure><p><br></p>'
      : embed + '<p><br></p>';

    document.execCommand('insertHTML', false, html);
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
    const html = this.content.innerHTML;
    this.textarea.value = html;
    // Keep source in sync so switching to HTML tab always shows current content
    this.source.value = html;
  }

  getValue() {
    if (this.mode === 'html') {
      return this._normalizeYtCaptions(this.source.value);
    }
    return this._normalizeYtCaptions(this.content.innerHTML);
  }

  setValue(html) {
    this.content.innerHTML = html;
    this.source.value = html;
    this.textarea.value = html;
  }
}

window.RichTextEditor = RichTextEditor;
