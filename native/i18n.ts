// Localization: assets/strings.json, English source strings as the keys, the nine
// StarHermit locales (en-GB, es-ES and fr-CA carry only their differences), on the
// engine's string tables, which follow the runtime's interface language (the
// player's choice in Options › Language, else the account's preferred language or
// the device's) along their locale chains. Account lines are its `starhermit.*`.
// globalThis.GHI18N is the object src/i18n/t.js reads (the session's T()).
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

type Vars = Record<string, string | number>;
/** An English source string in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return strings.t(String(key), vars ?? undefined); }
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;

(globalThis as unknown as { GHI18N: unknown }).GHI18N = {
  T,
  get lang() { return strings.locale; },
  has: (key: string) => strings.has(String(key).replace(/\s+/g, " ").trim()),
};
export function currentLocale(): string { return strings.locale; }
