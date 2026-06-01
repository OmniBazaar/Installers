/**
 * Minimal renderer-side translation helper. Loads the active locale's flat
 * dictionary from the bridge and resolves keys with `{{var}}` interpolation.
 * Keeps i18next out of the (un-bundled, sandboxed) renderer — main owns the
 * locale files.
 *
 * @module renderer/t
 */

let dictionary: Record<string, string> = {};

/**
 * Load the active locale dictionary. Call once at page start before {@link t}.
 */
export async function loadTranslations(): Promise<void> {
  dictionary = await window.serviceNode.translations();
}

/**
 * Translate a key, interpolating `{{name}}` placeholders from `vars`. Falls back
 * to the key itself when missing so a missing string is visible, not silent.
 * @param key - Flat dotted translation key.
 * @param vars - Optional interpolation values.
 * @returns The localised string.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let value = dictionary[key] ?? key;
  if (vars !== undefined) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replace(`{{${name}}}`, String(replacement));
    }
  }
  return value;
}

/**
 * Apply translations to all `[data-i18n]` elements (text) and `[data-i18n-ph]`
 * inputs (placeholder) in the document.
 */
export function applyStaticTranslations(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset["i18n"];
    if (key !== undefined) {
      el.textContent = t(key);
    }
  });
  document
    .querySelectorAll<HTMLInputElement>("[data-i18n-ph]")
    .forEach((el) => {
      const key = el.dataset["i18nPh"];
      if (key !== undefined) {
        el.placeholder = t(key);
      }
    });
}
