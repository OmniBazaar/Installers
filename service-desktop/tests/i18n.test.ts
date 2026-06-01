import { readFileSync } from "fs";
import { join } from "path";
import { loadDictionary, resolveLocale, SUPPORTED_LOCALES } from "../src/i18n";

const LOCALES_DIR = join(__dirname, "..", "locales");

describe("resolveLocale", () => {
  it("narrows region variants to a base locale", () => {
    expect(resolveLocale("fr-CA")).toBe("fr");
    expect(resolveLocale("PT")).toBe("pt");
  });
  it("falls back to English for unsupported or missing locales", () => {
    expect(resolveLocale("xx")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });
});

describe("locale parity (i18n ×10)", () => {
  const englishKeys = Object.keys(
    JSON.parse(
      readFileSync(join(LOCALES_DIR, "en.json"), "utf8"),
    ) as Record<string, string>,
  ).sort();

  it("ships all ten locales", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(10);
  });

  it.each(SUPPORTED_LOCALES)(
    "%s has exactly the English key set with no empty values",
    (locale) => {
      const dict = loadDictionary(LOCALES_DIR, locale);
      expect(Object.keys(dict).sort()).toEqual(englishKeys);
      for (const value of Object.values(dict)) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    },
  );

  it.each(SUPPORTED_LOCALES.filter((l) => l !== "en"))(
    "%s preserves the {{version}} placeholder in updates.available",
    (locale) => {
      const dict = loadDictionary(LOCALES_DIR, locale);
      expect(dict["updates.available"]).toContain("{{version}}");
    },
  );
});
