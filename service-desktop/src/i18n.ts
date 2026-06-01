/**
 * Main-process i18n for operator-facing strings (tray, dialogs). Uses plain
 * i18next (the Wallet convention) with the ten OmniBazaar locales bundled as
 * JSON. Locale resolution falls back to English for any unsupported system
 * locale. The renderer initialises its own i18next instance from the same files.
 *
 * @module i18n
 */

import i18next, { type i18n as I18nInstance } from "i18next";
import { readFileSync } from "fs";
import { join } from "path";

/** The ten supported locales (matches WebApp/Wallet). */
export const SUPPORTED_LOCALES = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "zh",
  "ja",
  "ko",
  "ru",
] as const;

/** A supported locale code. */
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Narrow an arbitrary locale string (e.g. "fr-CA") to a supported locale,
 * falling back to English.
 * @param raw - A BCP-47-ish locale string.
 * @returns A supported locale code.
 */
export function resolveLocale(raw: string | undefined): SupportedLocale {
  const base = (raw ?? "en").slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(base)
    ? (base as SupportedLocale)
    : "en";
}

/**
 * Initialise the main-process i18next instance from the bundled locale files.
 * @param localesDir - Absolute path to the directory containing `<lang>.json`.
 * @param locale - System locale (e.g. `app.getLocale()`).
 * @returns The initialised i18next instance (its `t` is used for tray strings).
 */
export async function initI18n(
  localesDir: string,
  locale: string,
): Promise<I18nInstance> {
  const resolved = resolveLocale(locale);
  const resources: Record<string, { translation: Record<string, unknown> }> =
    {};
  for (const lang of SUPPORTED_LOCALES) {
    const file = join(localesDir, `${lang}.json`);
    resources[lang] = {
      translation: JSON.parse(readFileSync(file, "utf8")) as Record<
        string,
        unknown
      >,
    };
  }
  await i18next.init({
    lng: resolved,
    fallbackLng: "en",
    resources,
    // Locale files use flat dotted keys ("tray.status.running"), not nested
    // objects, so the renderer can consume the same dictionary directly.
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });
  return i18next;
}

/**
 * Load a single locale's flat dictionary for the renderer (which has no Node
 * access). Falls back to English for any missing key at lookup time in the
 * renderer's own `t`.
 * @param localesDir - Directory containing `<lang>.json`.
 * @param locale - System locale.
 * @returns The resolved locale's flat key→string dictionary.
 */
export function loadDictionary(
  localesDir: string,
  locale: string,
): Record<string, string> {
  const resolved = resolveLocale(locale);
  return JSON.parse(
    readFileSync(join(localesDir, `${resolved}.json`), "utf8"),
  ) as Record<string, string>;
}
