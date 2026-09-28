// Gravity Hollow — Graphics section of the Settings panel. Builds the controls
// from gfx.js (presets, categories), applies every change live through
// Renderer.setGraphics and persists it with the other settings. The panel's
// strings are localized (navigator.language); the rest of the game is English.

import { PRESETS, CATEGORIES, presetTier, choosePreset } from './gfx.js';

const STRINGS = {
  'en-US': {
    graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {0})', renderScale: 'Render scale',
    fromPreset: 'From preset ({0})', adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
    postFailed: 'Post-processing is unavailable on this device; effects that need it are off.',
    presets: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
    cats: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade', antialias: 'Anti-aliasing', particles: 'Particles', detail: 'Detail', atmosphere: 'Atmosphere' },
    tiers: { off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed' },
    words: { noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion', bloom: 'bloom', noAa: 'no anti-aliasing', particles: 'particles' },
  },
  'es-419': {
    graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {0})', renderScale: 'Escala de renderizado',
    fromPreset: 'Del ajuste ({0})', adaptive: 'Resolución adaptable', showFps: 'Mostrar FPS',
    postFailed: 'El posprocesamiento no está disponible en este dispositivo; los efectos que lo requieren están desactivados.',
    presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    cats: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing', particles: 'Partículas', detail: 'Detalle', atmosphere: 'Atmósfera' },
    tiers: { off: 'No', on: 'Sí', low: 'Bajo', medium: 'Medio', high: 'Alto', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado' },
    words: { noShadows: 'sin sombras', shadows: 'sombras', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa', bloom: 'resplandor', noAa: 'sin antialiasing', particles: 'partículas' },
  },
  'de-DE': {
    graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {0})', renderScale: 'Renderskalierung',
    fromPreset: 'Aus Voreinstellung ({0})', adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; Effekte, die sie benötigen, sind aus.',
    presets: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra' },
    cats: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Bloom', grade: 'Farbkorrektur', antialias: 'Kantenglättung', particles: 'Partikel', detail: 'Details', atmosphere: 'Atmosphäre' },
    tiers: { off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Einfach', detailed: 'Detailliert' },
    words: { noShadows: 'keine Schatten', shadows: 'Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung', bloom: 'Bloom', noAa: 'keine Kantenglättung', particles: 'Partikel' },
  },
  'fr-FR': {
    graphics: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {0})', renderScale: 'Échelle de rendu',
    fromPreset: 'Selon le préréglage ({0})', adaptive: 'Résolution adaptative', showFps: 'Afficher les IPS',
    postFailed: 'Le post-traitement est indisponible sur cet appareil ; les effets qui en dépendent sont désactivés.',
    presets: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra' },
    cats: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Flou lumineux', grade: 'Étalonnage', antialias: 'Anticrénelage', particles: 'Particules', detail: 'Détails', atmosphere: 'Atmosphère' },
    tiers: { off: 'Non', on: 'Oui', low: 'Bas', medium: 'Moyen', high: 'Élevé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé' },
    words: { noShadows: 'sans ombres', shadows: 'ombres', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète', bloom: 'flou lumineux', noAa: 'sans anticrénelage', particles: 'particules' },
  },
  'pt-BR': {
    graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {0})', renderScale: 'Escala de renderização',
    fromPreset: 'Da predefinição ({0})', adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
    postFailed: 'O pós-processamento não está disponível neste dispositivo; os efeitos que dependem dele estão desligados.',
    presets: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    cats: { shadows: 'Sombras', ao: 'Oclusão de ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Antisserrilhado', particles: 'Partículas', detail: 'Detalhes', atmosphere: 'Atmosfera' },
    tiers: { off: 'Desligado', on: 'Ligado', low: 'Baixo', medium: 'Médio', high: 'Alto', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado' },
    words: { noShadows: 'sem sombras', shadows: 'sombras', ao: 'oclusão de ambiente', aoHigh: 'oclusão de ambiente completa', bloom: 'brilho', noAa: 'sem antisserrilhado', particles: 'partículas' },
  },
  'it-IT': {
    graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {0})', renderScale: 'Scala di rendering',
    fromPreset: 'Dal preset ({0})', adaptive: 'Risoluzione adattiva', showFps: 'Mostra frame rate',
    postFailed: 'La post-elaborazione non è disponibile su questo dispositivo; gli effetti che la richiedono sono disattivati.',
    presets: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra' },
    cats: { shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing', particles: 'Particelle', detail: 'Dettaglio', atmosphere: 'Atmosfera' },
    tiers: { off: 'No', on: 'Sì', low: 'Basso', medium: 'Medio', high: 'Alto', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato' },
    words: { noShadows: 'nessuna ombra', shadows: 'ombre', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa', bloom: 'bagliore', noAa: 'nessun antialiasing', particles: 'particelle' },
  },
};
// Regional variants: spelling / vocabulary differences over the base tables.
STRINGS['en-GB'] = { ...STRINGS['en-US'], cats: { ...STRINGS['en-US'].cats, grade: 'Colour grade' } };
STRINGS['es-ES'] = { ...STRINGS['es-419'], showFps: 'Mostrar FPS', cats: { ...STRINGS['es-419'].cats, antialias: 'Suavizado de bordes' },
  words: { ...STRINGS['es-419'].words, noAa: 'sin suavizado de bordes' } };
STRINGS['fr-CA'] = { ...STRINGS['fr-FR'], showFps: 'Afficher les images par seconde', cats: { ...STRINGS['fr-FR'].cats, bloom: 'Halo lumineux' },
  words: { ...STRINGS['fr-FR'].words, bloom: 'halo lumineux' } };

export const LOCALES = Object.keys(STRINGS);

/** Best supported locale for a list of browser language tags. */
export function pickLocale(langs = []) {
  for (const raw of langs) {
    const tag = String(raw || '');
    const exact = LOCALES.find(l => l.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const [lang, region = ''] = tag.toLowerCase().split('-');
    if (lang === 'en') return ['gb', 'uk', 'ie', 'au', 'nz', 'za', 'in'].includes(region) ? 'en-GB' : 'en-US';
    if (lang === 'es') return region === 'es' ? 'es-ES' : 'es-419';
    if (lang === 'fr') return region === 'ca' ? 'fr-CA' : 'fr-FR';
    if (lang === 'pt') return 'pt-BR';
    if (lang === 'de') return 'de-DE';
    if (lang === 'it') return 'it-IT';
  }
  return 'en-US';
}

export function graphicsStrings(locale) { return STRINGS[locale] ?? STRINGS['en-US']; }

const fmt = (s, v) => s.replace('{0}', v);

/**
 * Build the Graphics controls into `host`.
 * `apply(persist)` pushes settings.graphics to the renderer (and saves when `persist`).
 */
export function bindGraphicsPanel(host, { settings, renderer, apply }) {
  const langs = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  const locale = pickLocale(langs);
  const T = graphicsStrings(locale);
  host.lang = locale;
  if (!settings.graphics || typeof settings.graphics !== 'object') settings.graphics = {};
  const g = () => settings.graphics;
  const legend = host.querySelector('legend');
  if (legend) legend.textContent = T.graphics;

  const body = document.createElement('div');
  body.className = 'gfx-grid';
  body.id = 'gfx-body';
  host.appendChild(body);

  const row = (labelText, control, extra) => {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(span, control);
    if (extra) label.append(extra);
    body.appendChild(label);
    return label;
  };
  const option = (sel, value, text) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = text;
    sel.appendChild(o);
    return o;
  };

  // Quality preset (keeps the legacy #set-quality id)
  const preset = document.createElement('select');
  preset.id = 'set-quality';
  preset.dataset.gfx = 'preset';
  const autoOpt = option(preset, 'auto', fmt(T.auto, T.presets[renderer.detected] ?? renderer.detected));
  for (const p of PRESETS) option(preset, p, T.presets[p]);
  row(T.quality, preset).classList.add('gfx-wide');

  // Render scale 50–200 %
  const scale = document.createElement('input');
  Object.assign(scale, { type: 'range', id: 'gfx-scale', min: '50', max: '200', step: '5' });
  scale.dataset.gfx = 'render_scale';
  const scaleOut = document.createElement('output');
  scaleOut.id = 'gfx-scale-value';
  scaleOut.htmlFor = 'gfx-scale';
  const scaleWrap = document.createElement('span');
  scaleWrap.className = 'gfx-range';
  scaleWrap.append(scale, scaleOut);
  row(T.renderScale, scaleWrap);

  // One select per category; "preset" = follow the preset's own tier.
  const catSelects = {};
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const sel = document.createElement('select');
    sel.id = `gfx-${cat}`;
    sel.dataset.gfx = cat;
    option(sel, 'preset', '');
    for (const t of tiers) option(sel, t, T.tiers[t] ?? t);
    catSelects[cat] = sel;
    row(T.cats[cat], sel);
  }

  const toggle = (id, key, text) => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.dataset.gfx = key;
    const label = document.createElement('label');
    label.className = 'gfx-check';
    const span = document.createElement('span');
    span.textContent = text;
    label.append(cb, span);
    body.appendChild(label);
    return cb;
  };
  const adaptive = toggle('gfx-adaptive', 'adaptive', T.adaptive);
  const fps = toggle('gfx-fps', 'show_fps', T.showFps);

  const summary = document.createElement('p');
  summary.id = 'gfx-summary';
  summary.className = 'dim small gfx-summary';
  summary.setAttribute('aria-live', 'polite');
  const note = document.createElement('p');
  note.id = 'gfx-post-note';
  note.className = 'small gfx-note';
  note.hidden = true;
  note.textContent = T.postFailed;
  host.append(summary, note);

  const sync = () => {
    const s = g();
    const r = renderer.q;
    preset.value = PRESETS.includes(s.preset) ? s.preset : 'auto';
    autoOpt.textContent = fmt(T.auto, T.presets[renderer.detected] ?? renderer.detected);
    const pct = Math.round((Number(s.render_scale) || 1) * 100);
    scale.value = String(pct);
    scaleOut.textContent = `${pct}%`;
    for (const [cat, sel] of Object.entries(catSelects)) {
      sel.options[0].textContent = fmt(T.fromPreset, T.tiers[presetTier(r.preset, cat)] ?? presetTier(r.preset, cat));
      sel.value = CATEGORIES[cat].includes(s[cat]) ? s[cat] : 'preset';
    }
    adaptive.checked = s.adaptive !== false;
    fps.checked = !!s.show_fps;
    refreshSummary();
  };
  const refreshSummary = () => {
    const info = renderer.graphicsInfo(T.words);
    summary.textContent = `${info.gpu} · ${info.summary}`;
    note.hidden = !info.postFailed;
  };
  renderer.onPostFailed = () => { note.hidden = false; };

  const commit = (persist = true) => { apply(persist); sync(); };
  preset.addEventListener('change', () => {
    settings.graphics = choosePreset(g(), preset.value); // a preset clears overrides
    commit();
  });
  scale.addEventListener('input', () => {
    g().render_scale = Number(scale.value) / 100;
    scaleOut.textContent = `${scale.value}%`;
    apply(false);
  });
  scale.addEventListener('change', () => commit());
  for (const [cat, sel] of Object.entries(catSelects)) {
    sel.addEventListener('change', () => {
      if (sel.value === 'preset') delete g()[cat]; else g()[cat] = sel.value;
      commit();
    });
  }
  adaptive.addEventListener('change', () => { g().adaptive = adaptive.checked; commit(); });
  fps.addEventListener('change', () => { g().show_fps = fps.checked; commit(); });

  sync();
  // pixel size / adaptive scale drift while open: refresh the summary line
  setInterval(() => { if (!host.closest('.hidden')) refreshSummary(); }, 1000);
  return { sync };
}
