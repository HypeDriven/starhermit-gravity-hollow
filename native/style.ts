// The look of the menus, HUD and dialogs: the browser build's styles.css,
// rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start with the theme the runtime's own widgets (checkboxes, selects, text
// fields, dialogs, scroll bars) take. The browser build's body.high-contrast
// palette is a token set here, applied while the runtime's high-contrast
// option is on.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

export const INK = { bg: "#0b100d", panel: "#101814", text: "#e8f0ea", dim: "#9db3a6", accent: "#9fe6a0", danger: "#ff7a5c", focus: "#ffe066", border: "#2c5240" };
type Tokens = Record<string, string | number>;
let base: Tokens = {};
const HIGH_CONTRAST: Tokens = { panel: "#000000f5", "panel-solid": "#000000", text: "#ffffff", dim: "#d0d0d0", accent: "#00ff88", "panel-border": "#ffffff", card: "#000000" };

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Tokens) };
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 24, padding: 8, spacing: 8, radius: 10,
    text: INK.text, muted: INK.dim, panel: INK.panel, control: "#1c2b23", hovered: "#24382d",
    pressed: "#16241d", field: "#14211a", accent: INK.accent, focus: INK.focus, outline: INK.border,
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$text" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    checkbox: {
      text: { color: "$text" }, minHeight: 40,
      parts: { box: { background: "#14211a", border: { width: 2, color: "$panel-border" }, radius: 4 }, mark: { background: "$accent" } },
    },
    select: { text: { color: "$text" }, background: "#14211a", border: { width: 1, color: "$panel-border" }, radius: 8, minHeight: 40 },
    textField: { text: { color: "$text" }, background: "#14211a", border: { width: 1, color: "$panel-border" }, radius: 8, minHeight: 40 },
    dialog: {
      background: "$panel-solid", radius: 14, padding: 22, border: { width: 1, color: "$panel-border" },
      parts: { backdrop: { background: "#050806d1" } },
    },
    scrollArea: { parts: { bar: { background: "$dim", radius: 4 } } },
    tooltip: { background: "$panel-solid", text: { color: "$text" }, radius: 6, padding: 6 },
    // The key art and the results illustrations (decorative: the fallback colour stands while they load).
    ".art-key": { background: [{ image: "assets/key-art.webp", size: "cover", position: { x: 0.5, y: 0.4 } }, "#1c3327"], radius: 10, border: { width: 1, color: "$panel-border" } },
    ".art-win": { background: [{ image: "assets/results-win.webp", size: "cover", position: { x: 0.5, y: 0.6 } }, "#1c3327"], radius: 10, border: { width: 1, color: "$panel-border" } },
    ".art-defeat": { background: [{ image: "assets/results-defeat.webp", size: "cover", position: { x: 0.5, y: 0.6 } }, "#1c3327"], radius: 10, border: { width: 1, color: "$panel-border" } },
  });
}

let hcKey: boolean | null = null;
/** The high-contrast tokens over the sheet's while the runtime's option is on. */
export function applyContrast(highContrast: boolean): void {
  if (hcKey === highContrast) return;
  hcKey = highContrast;
  ui.setTokens(highContrast ? { ...base, ...HIGH_CONTRAST } : base);
}
