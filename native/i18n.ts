// Localization: the browser build's tables (src/i18n/strings.js and
// strings-content.js, English source strings as the keys, the nine StarHermit
// locales; en-GB, es-ES and fr-CA carry only their differences from en-US,
// es-419 and fr-FR) in the interface language the runtime reports
// (preferences().language: the player's choice in Options › Language, else
// the account's preferred language or the device's). The runtime's Options
// replaced the game's own Language setting (sh-language.js) and the DOM
// observer of src/i18n/i18n.js: every string is drawn through T() each frame,
// so a language change shows on the next frame. globalThis.GHI18N is the
// object src/i18n/t.js reads (the session's and the platform strings' T()).
import { onPreferencesChange, preferences } from "starhermit:engine";
import { loadClassic } from "starhermit:script";
import * as ui from "starhermit:ui";

loadClassic("src/i18n/strings.js");
loadClassic("src/i18n/strings-content.js");

export const LOCALES = ["en-US", "en-GB", "es-419", "es-ES", "de-DE", "fr-FR", "fr-CA", "pt-BR", "it-IT"];
const PARENT: Record<string, string> = { "en-GB": "en-US", "es-ES": "es-419", "fr-CA": "fr-FR" };
const TABLES = (globalThis as unknown as { GH_STRINGS: Record<string, Record<string, string>> }).GH_STRINGS;
const KEYS = TABLES["es-419"] ?? {};
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The shipped locale nearest a BCP 47 tag (en-GB, es-ES and fr-CA by region). */
export function pickLocale(tag: string): string {
  const s = String(tag || "en-US");
  const exact = LOCALES.find((l) => l.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const [lang = "", region = ""] = s.toLowerCase().split("-");
  if (lang === "en") return ["gb", "uk", "ie", "au", "nz", "za", "in"].includes(region) ? "en-GB" : "en-US";
  if (lang === "es") return region === "es" ? "es-ES" : "es-419";
  if (lang === "fr") return region === "ca" ? "fr-CA" : "fr-FR";
  return ({ de: "de-DE", pt: "pt-BR", it: "it-IT" } as Record<string, string>)[lang] ?? "en-US";
}

let locale = "en-US";
type Vars = Record<string, string | number>;
function lookup(key: string): string {
  for (let l: string | undefined = locale; l; l = PARENT[l]) {
    const t = TABLES[l];
    if (t && has(t, key)) return t[key]!;
  }
  return key;
}
/** An English source string in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string {
  let s = lookup(String(key));
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (has(vars, k) ? String(vars[k]) : m));
  return s;
}
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;

(globalThis as unknown as { GHI18N: unknown }).GHI18N = {
  T,
  get lang() { return locale; },
  locales: LOCALES,
  has: (key: string) => has(KEYS, String(key).replace(/\s+/g, " ").trim()),
};

function apply(tag: string): void {
  locale = pickLocale(tag);
  ui.setLanguage(locale);
}
apply(preferences().language);
onPreferencesChange((p) => { if (pickLocale(p.language) !== locale) apply(p.language); });
export function currentLocale(): string { return locale; }
