/* =========================================================
   i18n.js — Internationalisation module (CZ / EN)
   ========================================================= */

const translations = {
  cs: {
    // Navigation
    'nav.home': 'Domů',
    'nav.texts': 'Texty',
    'nav.books': 'Knihy',
    'nav.stories': 'Povídky',
    'nav.poems': 'Básně',
    'nav.drawing': 'Kresba a malba',
    'nav.blog': 'Blog',
    'nav.programming': 'Programování',
    'nav.friends': 'Přátelé',
    'nav.about': 'O mně',
    'nav.contact': 'Kontakt',

    // Homepage sections
    'home.explore': 'Prozkoumat tvorbu',
    'home.section.texts': 'Texty',
    'home.section.art': 'Umění',
    'home.section.drawing': 'Kresba a malba',
    'home.section.friends': 'Přátelé',
    'home.section.blog': 'Blog',
    'home.section.programming': 'Programování',
    'home.allProgramming': 'Všechny články',
    'home.friendsSubtitle': 'Tvůrci a lidé, které obdivuji',
    'home.allTexts': 'Všechny texty',
    'home.fullGallery': 'Celá galerie',
    'home.viewAll': 'Vše',
    'home.allFriends': 'Všichni přátelé',
    'home.allPosts': 'Všechny záznamy',
    'home.moreAbout': 'Více o mně',
    'home.letsConnect': 'Pojďme se spojit',
    'home.contactDescription': 'Máte zájem o spolupráci nebo se chcete jen ozvat? Budu ráda za každou zprávu.',
    'home.writeMessage': 'Napsat zprávu',

    // Detail pages — back links
    'back.texts': 'Zpět na texty',
    'back.art': 'Zpět na umění',
    'back.drawing': 'Zpět na kresby a malby',
    'back.blog': 'Zpět na blog',
    'back.programming': 'Zpět na programování',
    'back.friends': 'Zpět na přátele',
    'back.home': 'Zpět domů',
    'back.backTo': 'Zpět na',

    // Empty states
    'empty.texts': 'Žádné texty',
    'empty.textsDesc': 'Zatím nebyly přidány žádné texty.',
    'empty.artworks': 'Žádná díla',
    'empty.blog': 'Žádné záznamy',
    'empty.programming': 'Žádné články',
    'empty.friends': 'Žádní přátelé',
    'empty.posts': 'Žádné příspěvky',
    'empty.category': 'Žádné položky',
    'empty.categoryDesc': 'Zatím nebyly přidány žádné položky v této kategorii.',

    // Content
    'content.unavailable': 'Text není dostupný.',

    // Contact form
    'contact.writeMessage': 'Napsat zprávu',
    'contact.description': 'Zajímá vás spolupráce nebo se chcete jen ozvat? Napište mi.',
    'contact.name': 'Jméno',
    'contact.namePlaceholder': 'Vaše jméno',
    'contact.email': 'E-mail',
    'contact.emailPlaceholder': 'vas@email.cz',
    'contact.subject': 'Předmět',
    'contact.subjectPlaceholder': 'O čem píšete?',
    'contact.message': 'Zpráva',
    'contact.messagePlaceholder': 'Vaše zpráva…',
    'contact.send': 'Odeslat zprávu',
    'contact.sending': 'Odesílám…',
    'contact.success': 'Zpráva byla úspěšně odeslána. Děkuji!',
    'contact.sendError': 'Chyba odeslání',
    'contact.error.name': 'Vyplňte prosím své jméno.',
    'contact.error.nameLong': 'Jméno je příliš dlouhé (max 100 znaků).',
    'contact.error.email': 'Zadejte platný e-mail.',
    'contact.error.message': 'Zpráva je příliš krátká (min 10 znaků).',
    'contact.error.messageLong': 'Zpráva je příliš dlouhá (max 5000 znaků).',

    // Jewelry / detail
    'jewelry.materials': 'Materiály',
    'jewelry.dimensions': 'Rozměry',
    'jewelry.available': 'Dostupné',
    'jewelry.currentlyUnavailable': 'Momentálně nedostupné',

    // Friends
    'friends.posts': 'Příspěvky',

    // Errors
    'loading': 'Načítám…',
    'error.loading': 'Chyba načítání',
    'error.generic': 'Chyba',
    'error.notFound': 'Nenalezeno',
    'error.pageNotFound': 'Stránka nenalezena.',

    // Hero / footer
    'hero.scroll': 'Scroll',
    'footer.description': 'Osobní kreativní platforma — texty, umění, kresba a malba a přátelé.',
    'footer.creation': 'Tvorba',
    'footer.personal': 'Osobní',
    'footer.rights': 'Všechna práva vyhrazena.',
  },

  en: {
    // Navigation
    'nav.home': 'Home',
    'nav.texts': 'Texts',
    'nav.books': 'Books',
    'nav.stories': 'Stories',
    'nav.poems': 'Poems',
    'nav.drawing': 'Drawing & Painting',
    'nav.blog': 'Blog',
    'nav.programming': 'Programming',
    'nav.friends': 'Friends',
    'nav.about': 'About',
    'nav.contact': 'Contact',

    // Homepage sections
    'home.explore': 'Explore work',
    'home.section.texts': 'Texts',
    'home.section.art': 'Art',
    'home.section.drawing': 'Drawing & Painting',
    'home.section.friends': 'Friends',
    'home.section.blog': 'Blog',
    'home.section.programming': 'Programming',
    'home.allProgramming': 'All articles',
    'home.friendsSubtitle': 'Creators and people I admire',
    'home.allTexts': 'All texts',
    'home.fullGallery': 'Full gallery',
    'home.viewAll': 'All',
    'home.allFriends': 'All friends',
    'home.allPosts': 'All entries',
    'home.moreAbout': 'More about me',
    'home.letsConnect': "Let's connect",
    'home.contactDescription': "Interested in collaboration or just want to say hello? I'd love to hear from you.",
    'home.writeMessage': 'Write a message',

    // Detail pages — back links
    'back.texts': 'Back to texts',
    'back.art': 'Back to art',
    'back.drawing': 'Back to drawings & paintings',
    'back.blog': 'Back to blog',
    'back.programming': 'Back to programming',
    'back.friends': 'Back to friends',
    'back.home': 'Back home',
    'back.backTo': 'Back to',

    // Empty states
    'empty.texts': 'No texts',
    'empty.textsDesc': 'No texts have been added yet.',
    'empty.artworks': 'No artworks',
    'empty.blog': 'No entries',
    'empty.programming': 'No articles',
    'empty.friends': 'No friends',
    'empty.posts': 'No posts',
    'empty.category': 'No items',
    'empty.categoryDesc': 'No items have been added in this category yet.',

    // Content
    'content.unavailable': 'Content is not available.',

    // Contact form
    'contact.writeMessage': 'Send a message',
    'contact.description': 'Interested in collaboration or just want to say hi? Write to me.',
    'contact.name': 'Name',
    'contact.namePlaceholder': 'Your name',
    'contact.email': 'Email',
    'contact.emailPlaceholder': 'your@email.com',
    'contact.subject': 'Subject',
    'contact.subjectPlaceholder': 'What are you writing about?',
    'contact.message': 'Message',
    'contact.messagePlaceholder': 'Your message…',
    'contact.send': 'Send message',
    'contact.sending': 'Sending…',
    'contact.success': 'Your message has been sent successfully. Thank you!',
    'contact.sendError': 'Failed to send',
    'contact.error.name': 'Please enter your name.',
    'contact.error.nameLong': 'Name is too long (max 100 characters).',
    'contact.error.email': 'Please enter a valid email address.',
    'contact.error.message': 'Message must be at least 10 characters.',
    'contact.error.messageLong': 'Message is too long (max 5000 characters).',

    // Jewelry / detail
    'jewelry.materials': 'Materials',
    'jewelry.dimensions': 'Dimensions',
    'jewelry.available': 'Available',
    'jewelry.currentlyUnavailable': 'Currently unavailable',

    // Friends
    'friends.posts': 'Posts',

    // Errors
    'loading': 'Loading…',
    'error.loading': 'Loading error',
    'error.generic': 'Error',
    'error.notFound': 'Not found',
    'error.pageNotFound': 'Page not found.',

    // Hero / footer
    'hero.scroll': 'Scroll',
    'footer.description': 'Personal creative platform — texts, art, drawing & painting and friends.',
    'footer.creation': 'Creation',
    'footer.personal': 'Personal',
    'footer.rights': 'All rights reserved.',
  },
};

/* -----------------------------------------------------------
   State
   ----------------------------------------------------------- */

let currentLang = 'cs';

/* -----------------------------------------------------------
   getLang() — resolve current language
   ----------------------------------------------------------- */

function getLang() {
  const stored = localStorage.getItem('inachis_lang');
  if (stored === 'cs' || stored === 'en') {
    currentLang = stored;
    return currentLang;
  }

  const nav = (navigator.language || '').toLowerCase();
  currentLang = (nav.startsWith('cs') || nav.startsWith('sk')) ? 'cs' : 'en';
  return currentLang;
}

/* -----------------------------------------------------------
   setLang(lang) — switch language, persist, notify
   ----------------------------------------------------------- */

function setLang(lang) {
  if (lang !== 'cs' && lang !== 'en') return;
  currentLang = lang;
  localStorage.setItem('inachis_lang', lang);
  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

/* -----------------------------------------------------------
   initLang() — call on page load
   ----------------------------------------------------------- */

function initLang() {
  getLang();
  document.documentElement.lang = currentLang;
}

/* -----------------------------------------------------------
   t(key) — translate; falls back to Czech
   ----------------------------------------------------------- */

function t(key) {
  const dict = translations[currentLang] || translations.cs;
  return dict[key] ?? translations.cs[key] ?? key;
}

/* -----------------------------------------------------------
   Export on window
   ----------------------------------------------------------- */

window.t = t;
window.getLang = getLang;
window.setLang = setLang;
window.initLang = initLang;
