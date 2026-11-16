// Fonts only one look needs in one language, loaded once they are needed. Gaegu, the journal look's handwriting for
// English (journal-look.css: `[data-look='journal'][lang='en']`), comes with 178 font faces (most for Korean): kept out
// of the main stylesheet, the others parse less CSS and keep fewer font faces in memory. Its files load on first use
// either way (font-display: swap), so the look is the same.

let gaegu: Promise<unknown> | null = null;

function check(root: HTMLElement) {
  if (gaegu || root.dataset.look !== 'journal' || !root.lang.startsWith('en')) return;
  gaegu = Promise.all([import('@fontsource/gaegu/400.css'), import('@fontsource/gaegu/700.css')]).catch(() => { gaegu = null; });
}

/** Watches the look and the language (settings.ts applyTheme, i18n.ts setLanguage) and loads what they need. */
export function installLookFonts(root: HTMLElement = document.documentElement) {
  check(root);
  new MutationObserver(() => check(root)).observe(root, { attributes: true, attributeFilter: ['data-look', 'lang'] });
}
