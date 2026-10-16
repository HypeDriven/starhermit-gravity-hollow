// Gravity Hollow — DOM shell: screens, HUD, settings, help, toasts, live
// regions. UI state is strictly separate from simulation state.

import { ACHIEVEMENTS } from './session.js';
import { JOURNEY_COUNT } from './content.js';
import { TICK_RATE } from './rules.js';
import { T, N } from './i18n/t.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(app) {
    this.app = app;
    this.screens = ['boot', 'title', 'modes', 'setup', 'journey', 'profile', 'pause', 'results', 'settings', 'help'];
    this.current = 'boot';
    this.returnTo = 'title';
    this.lastFocus = null;
    this._toastCount = 0;
    // Language changes (gh-language) redraw what is on screen: each builder
    // records how to run again, static markup is re-translated by i18n.js.
    this._rebuild = {};
    for (const btn of document.querySelectorAll('[data-back]')) {
      btn.addEventListener('click', () => { app.audio.event('ui_back'); this.back(); });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ['settings', 'help'].includes(this.current)) this.back();
    });
  }

  // ---- screen manager (focus restoration, no traps) ----------------------

  show(name) {
    if (!['settings', 'help'].includes(name)) this.returnTo = name;
    for (const s of this.screens) $(`screen-${s}`)?.classList.toggle('hidden', s !== name);
    if (name === null) for (const s of this.screens) $(`screen-${s}`)?.classList.add('hidden');
    this.lastFocus = document.activeElement;
    this.current = name;
    const panel = name ? $(`screen-${name}`)?.querySelector('.panel') : null;
    const first = panel?.querySelector('button, input, select, [tabindex]');
    // preventScroll + reset: focusing a button low in a tall panel (results on a
    // phone) would otherwise open the screen scrolled past its heading
    if (first) first.focus({ preventScroll: true });
    if (panel) panel.scrollTop = 0;
  }
  overlay(name) { // settings/help over current screen
    this.under = this.current;
    // remember the opener now: `show` overwrites lastFocus on every transition,
    // so by the time `back()` runs it points at a control inside the overlay.
    this.overlayFocus = document.activeElement;
    this.show(name);
  }
  back() {
    const target = this.under && ['settings', 'help'].includes(this.current) ? this.under : 'title';
    const opener = this.overlayFocus;
    this.under = null;
    this.overlayFocus = null;
    if (target === null || target === 'none') this.show(null);
    else this.show(target);
    this.restoreFocus(opener);
  }
  showNone() { this.show(null); }
  restoreFocus(el = this.lastFocus) {
    // never send focus into a hidden screen
    if (el?.focus && el.isConnected && !el.closest?.('.hidden')) { try { el.focus(); } catch {} }
  }

  /** Redraw the visible screen(s), banner and sync line in the current language. */
  relocalize() {
    for (const name of new Set([this.current, this.under, this.returnTo])) if (name) this._rebuild[name]?.();
    if (this._step !== undefined) this.tutorialBanner(this._step, this._skip);
    this.renderSync();
    this._renderBinds?.();
  }

  // ---- feedback ----------------------------------------------------------

  toast(text, ms = 3200) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    $('toasts').appendChild(el);
    this.fitToasts();
    setTimeout(() => { el.remove(); this.fitToasts(); }, ms);
    this.announce(text);
  }
  // While a screen is up the toast stack sits at the top edge and the screens
  // reserve its height (--toast-h, layout px of the equally zoomed stack), so a
  // toast never covers a results heading or button.
  fitToasts() {
    const h = $('toasts').offsetHeight;
    document.documentElement.style.setProperty('--toast-h', h ? `${h + 8}px` : '0px');
  }
  announce(text, assertive = false) {
    if (!text) return;
    $(assertive ? 'sr-assertive' : 'sr-live').textContent = text;
  }
  caption(text) {
    if (!text || !this.app.settings.captions) return;
    const el = $('captions');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this._capT);
    this._capT = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  // ---- title -------------------------------------------------------------

  updateTitle(save) {
    const cleared = Object.keys(save.journey).length;
    $('journey-sub').textContent = `${cleared} / ${JOURNEY_COUNT}`;
    $('profile-sub').textContent = pname(save.profile.name);
    this.renderSync();
  }
  setDailySub(text) { $('daily-sub').textContent = text; }

  // Sync status lives where the profile/save state is shown (title + profile).
  setSyncStatus(status) { this._sync = status; this.renderSync(); }
  renderSync() {
    const status = this._sync ?? (this.app.platform ? 'saving' : 'local');
    const text = T({
      synced: 'Cloud save synced',
      saving: 'Saving to cloud…',
      offline: 'Cloud unreachable — saved on this device',
      local: 'Progress saved on this device',
    }[status] ?? '');
    for (const id of ['sync-status', 'profile-sync']) {
      const el = $(id);
      if (el) el.textContent = text;
    }
  }

  // ---- mode select --------------------------------------------------------

  buildModeCards(modes) {
    this._rebuild.modes = () => this.buildModeCards(modes);
    const host = $('mode-cards');
    host.innerHTML = '';
    for (const m of modes) {
      const b = document.createElement('button');
      b.className = 'mode-card';
      b.innerHTML = `<strong>${m.stage ? stageName(m.stage) : T(m.name)}</strong><small>${T(m.desc)}</small>` +
        (m.badge ? `<span class="badge">${T(m.badge)}</span>` : '');
      b.addEventListener('click', () => { this.app.audio.event('ui_confirm'); m.onPick(); });
      host.appendChild(b);
    }
  }

  // ---- setup ---------------------------------------------------------------

  buildSetup(stage, meta, board) {
    this._rebuild.setup = () => this.buildSetup(stage, meta, board);
    const host = $('setup-body');
    const goals = (stage.goals ?? []).map(g => `<li>${goalText(g)}</li>`).join('') || `<li>${T('Outscore every rival.')}</li>`;
    host.innerHTML = `
      <h3>${escapeHtml(stageName(stage))}</h3>
      <p class="dim">${meta?.description ? T(meta.description) : ''}</p>
      <dl class="breakdown">
        <dt>${T('Duration')}</dt><dd>${fmtTime(stage.durationSec)}</dd>
        <dt>${T('Rivals')}</dt><dd>${(stage.rivals ?? []).length}</dd>
        <dt>${T('Boost')}</dt><dd>${stage.boost === 'off' ? T('disabled') : stage.boost === 'limited' ? T('{n} uses', { n: stage.boostLimit }) : T('enabled')}</dd>
        <dt>${T('Ranked')}</dt><dd>${stage.unrated ? T('No (practice)') : stage.excluded ? T('Excluded from ranking') : T('Yes')}</dd>
        <dt>${T('Undo')}</dt><dd>${stage.undoAllowed ? T('allowed') : T('not allowed')}</dd>
      </dl>
      <h4>${T('Objectives')}</h4><ul>${goals}</ul>` +
      (board?.entries?.length ? `
      <h4>${T('Plaza standings')}</h4>
      <ol class="board">${board.entries.map(e =>
        `<li class="${e.me ? 'me' : ''}">${e.rank}. ${escapeHtml(e.name)} — ${e.score}</li>`).join('')}</ol>
      <p class="dim">${board.me ? T('Your rank: {rank} ({score})', { rank: board.me.rank, score: board.me.score }) : T('Solo scores stay on this device; the platform board is read-only.')}</p>` : '');
  }

  // ---- journey --------------------------------------------------------------

  buildJourney(save, stages, onPick) {
    this._rebuild.journey = () => this.buildJourney(save, stages, onPick);
    const host = $('journey-grid');
    host.innerHTML = '';
    const clearedCount = Object.keys(save.journey).length;
    stages.forEach((s, i) => {
      const rec = save.journey[s.id];
      const locked = i > 0 && !save.journey[stages[i - 1].id] && i > clearedCount;
      const b = document.createElement('button');
      b.className = 'journey-cell' + (locked ? ' locked' : '') + (s.mastery ? ' mastery' : '');
      b.disabled = locked;
      const label = locked ? T('{stage} (locked)', { stage: stageName(s) }) : stageName(s);
      b.setAttribute('aria-label', rec ? T(rec.stars === 1 ? '{stage}, {n} star' : '{stage}, {n} stars', { stage: label, n: rec.stars }) : label);
      b.innerHTML = `${s.mastery ? '★' : s.index}<span class="stars">${'★'.repeat(rec?.stars ?? 0)}</span>`;
      if (!locked) b.addEventListener('click', () => { this.app.audio.event('ui_confirm'); onPick(s); });
      host.appendChild(b);
    });
  }

  // ---- profile / achievements -------------------------------------------------

  buildProfile(save) {
    this._rebuild.profile = () => this.buildProfile(save);
    const hosted = !!this.app.platform?.userId;
    const stats = `
      <dl class="breakdown">
        <dt>${T('Sessions played')}</dt><dd>${save.sessionsPlayed}</dd>
        <dt>${T('Mastery XP')}</dt><dd>${Math.floor(save.masteryXp)}</dd>
        <dt>${T('Journey cleared')}</dt><dd>${Object.keys(save.journey).length} / ${JOURNEY_COUNT}</dd>
        <dt>${T('Days played')}</dt><dd>${(save.playDays ?? []).length}</dd>
      </dl>`;
    if (hosted) {
      // the name comes from the StarHermit account — no local edit on-platform
      $('profile-body').innerHTML = `
        <p><strong>${escapeHtml(save.profile.name)}</strong> <span class="dim">${T('(StarHermit account)')}</span></p>
        <p class="dim" id="profile-sync"></p>
        ${stats}`;
      this.renderSync();
    } else {
      $('profile-body').innerHTML = `
        <p><strong>${escapeHtml(pname(save.profile.name))}</strong> <span class="dim">${T('(guest — progress stored on this device)')}</span></p>
        ${stats}
        <label>${T('Display name')} <input type="text" id="profile-name" value="${escapeHtml(pname(save.profile.name))}" maxlength="20"></label>`;
      $('profile-name').addEventListener('change', (e) => {
        const v = e.target.value.trim().slice(0, 20);
        if (v) { save.profile.name = v; this.app.persistAll(); this.updateTitle(save); }
      });
    }
    const list = $('achievement-list');
    list.innerHTML = '';
    for (const [key, a] of Object.entries(ACHIEVEMENTS)) {
      const got = save.achievements[key];
      const li = document.createElement('li');
      li.className = got ? 'unlocked' : 'locked';
      li.innerHTML = `<strong>${T(a.name)}</strong> — ${T(a.desc)}${got ? ' ✓' : ''}`;
      list.appendChild(li);
    }
  }

  // ---- HUD ----------------------------------------------------------------

  showHud(on) {
    $('hud').classList.toggle('hidden', !on);
    $('action-tray').classList.toggle('hidden', !on);
  }
  setUndoVisible(on) { $('btn-undo').classList.toggle('hidden', !on); }

  updateHud(state, stage, query) {
    const me = state.voids[0];
    const remain = Math.max(0, stage.durationSec - state.tick / TICK_RATE);
    $('hud-timer').textContent = fmtTime(remain);
    $('hud-timer').style.color = remain < 15 ? 'var(--danger)' : '';
    const goals = state.goals.map(g =>
      `<div class="${g.done ? 'goal-done' : ''}">${g.done ? '✓ ' : ''}${goalText(g)}${g.type !== 'survive' ? ` (${Math.min(g.progress, g.target)}/${g.target})` : ''}</div>`).join('');
    $('hud-objective').innerHTML = `<strong>${escapeHtml(stageName(stage))}</strong>`;
    $('hud-goals').innerHTML = goals || `<span class="dim">${T('Outscore every rival')}</span>`;
    let score = `<div>${T('Mass <strong>{mass}</strong> · Collected <strong>{collected}</strong>', { mass: Math.floor(me.mass), collected: me.propMass + me.gemMass + me.rivalMass })}</div>`;
    if (!me.alive) score += `<div class="dim">${T('Respawning…')}</div>`;
    if (query?.moveTicksLeft != null) score += `<div>${T('Moves left {n}s', { n: (query.moveTicksLeft / TICK_RATE).toFixed(0) })}</div>`;
    if (query?.boostsLeft != null) score += `<div>${T('Boosts left {n}', { n: query.boostsLeft })}</div>`;
    $('hud-score').innerHTML = score;
    const ranks = [...state.voids].sort((a, b) =>
      (b.propMass + b.gemMass + b.rivalMass) - (a.propMass + a.gemMass + a.rivalMass));
    $('hud-ranks').innerHTML = ranks.map((v, i) =>
      `${i + 1}. ${v.id === 0 ? '<strong>' : ''}${escapeHtml(pname(v.name))} ${v.propMass + v.gemMass + v.rivalMass}${v.id === 0 ? '</strong>' : ''}${v.alive ? '' : ' ✝'}`).join(' · ');
    this.placeTutorialBanner();
  }

  /** Keep the lesson banner just below whichever HUD cards sit above it (timer,
   *  standings, rails) so it never covers them; it is zoomed by --ui-scale, so
   *  the visual rect is divided back into its own (layout) px. */
  placeTutorialBanner() {
    const el = $('tutorial-banner');
    if (el.classList.contains('hidden') || $('hud').classList.contains('hidden')) return;
    const b = el.getBoundingClientRect();
    let bottom = 0;
    for (const c of $('hud').querySelectorAll('.hud-card, .hud-btn')) {
      const r = c.getBoundingClientRect();
      if (r.height && r.right > b.left && r.left < b.right) bottom = Math.max(bottom, r.bottom);
    }
    const z = window.UIScale?.value || 1;
    el.style.setProperty('--banner-top', `${Math.round(bottom / z) + 8}px`);
  }

  countdown(text) {
    const el = $('countdown');
    if (text == null) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  tutorialBanner(step, onSkip) {
    const el = $('tutorial-banner');
    this._step = step ?? undefined; this._skip = onSkip;
    if (!step) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    $('tutorial-text').textContent = T(step.text);
    $('tutorial-hint').textContent = step.hint ? T(step.hint) : '';
    $('btn-tutorial-skip').onclick = onSkip;
    this.placeTutorialBanner();
  }

  // ---- results --------------------------------------------------------------

  showResults(results, progress, { announce = true } = {}) {
    this._rebuild.results = () => this.showResults(results, progress, { announce: false });
    const { rankings, breakdown, stage, terminalReason, goals } = results;
    const me = rankings.find(r => r.id === 0);
    const won = me?.place === 1;
    $('results-headline').textContent =
      terminalReason === 'lesson_complete' ? T('Lesson complete!') :
      terminalReason === 'moves_exhausted' ? T('Out of moves') :
      won ? T('You rule the plaza!') : placeText(me?.place ?? 0);
    $('results-h').textContent = T('{stage} — Results', { stage: stageName(stage) });
    const art = $('results-art');
    if (art) { // illustration: win/lesson vs defeat; onerror hides it, layout never depends on it
      art.hidden = false;
      art.src = won || terminalReason === 'lesson_complete' ? 'assets/results-win.webp' : 'assets/results-defeat.webp';
    }
    const ol = $('results-standings');
    ol.innerHTML = '';
    for (const r of rankings) {
      const li = document.createElement('li');
      li.className = r.id === 0 ? 'me' : '';
      li.textContent = T(r.deaths ? '{name} — {n} collected, {deaths} ✝' : '{name} — {n} collected', { name: pname(r.name), n: r.massCollected, deaths: r.deaths });
      ol.appendChild(li);
    }
    const bd = $('results-breakdown');
    bd.innerHTML = `
      <dt>${T('Props consumed')}</dt><dd>${breakdown.props}</dd>
      <dt>${T('Gems ({n})', { n: breakdown.gemCount })}</dt><dd>${breakdown.gems}</dd>
      <dt>${T('Rivals ({n})', { n: breakdown.rivalCount })}</dt><dd>${breakdown.rivals}</dd>
      <dt>${T('Survival bonus')}</dt><dd>${breakdown.survivalBonus}</dd>
      <dt>${T('Invalid-action penalty')}</dt><dd>${breakdown.invalidPenalty}</dd>
      <div class="total" style="display:contents"><dt>${T('Total')}</dt><dd>${breakdown.total}</dd></div>`;
    const gl = $('results-goals');
    gl.innerHTML = goals.map(g => `<li class="${g.done ? 'goal-done' : ''}">${g.done ? '✓' : '✗'} ${goalText(g)}</li>`).join('') || '<li>—</li>';
    $('results-progress').textContent = (typeof progress === 'function' ? progress() : progress) ?? '';
    if (!announce) return;
    this.show('results');
    this.announce(T('{headline}. Total score {total}.', { headline: $('results-headline').textContent, total: breakdown.total }), true);
  }

  // ---- settings ------------------------------------------------------------

  bindSettings(settings, onChange) {
    const map = [
      ['set-music', 'music'], ['set-effects', 'effects'], ['set-ambience', 'ambience'], ['set-voice', 'voice'],
      ['set-muted', 'muted', 'checked'], ['set-captions', 'captions', 'checked'],
      ['set-reduced', 'reducedMotion', 'checked'],
      ['set-contrast', 'highContrast', 'checked'], ['set-palette', 'palette'],
      ['set-large-text', 'largeText', 'checked'], ['set-left', 'leftHanded', 'checked'],
      ['set-hold', 'holdBoost', 'checked'], ['set-timing', 'timingAssist', 'checked'],
      ['set-haptics', 'haptics', 'checked'],
    ];
    for (const [id, key, prop] of map) {
      const el = $(id);
      el[prop ?? 'value'] = settings[key];
      el.addEventListener('change', () => {
        settings[key] = prop === 'checked' ? el.checked : (el.type === 'range' ? parseFloat(el.value) : el.value);
        onChange(key);
      });
    }
    this.buildBindEditor(settings, onChange);
  }

  buildBindEditor(settings, onChange) {
    const host = $('bind-editor');
    this._renderBinds = () => { if (!host.classList.contains('hidden')) render(); };
    const render = () => {
      host.innerHTML = '';
      for (const action of ['up', 'down', 'left', 'right', 'boost', 'pause', 'undo', 'hint', 'camera']) {
        const row = document.createElement('div');
        row.className = 'bind-row';
        const keys = keyList(settings.bindings[action], ' / ');
        row.innerHTML = `<span>${T(ACTION_LABELS[action])}</span><span class="dim">${keys}</span>`;
        const btn = document.createElement('button');
        btn.className = 'ghost small';
        btn.textContent = T('Rebind');
        btn.addEventListener('click', () => {
          this._cancelRebind?.();          // only one capture at a time
          btn.textContent = T('Press a key…');
          const h = (e) => {
            // swallow the key completely: it must not also pause, steer or close a panel
            e.preventDefault();
            e.stopPropagation();
            this._cancelRebind();
            if (e.code === 'Escape') { render(); return; } // Escape cancels
            settings.bindings[action] = [e.code];
            onChange('bindings'); render();
          };
          this._cancelRebind = () => {
            document.removeEventListener('keydown', h, true);
            this._cancelRebind = null;
          };
          document.addEventListener('keydown', h, true);
        });
        row.appendChild(btn);
        host.appendChild(row);
      }
    };
    $('btn-rebind').addEventListener('click', () => { host.classList.toggle('hidden'); render(); });
  }

  // ---- help: rule cards from current bindings + representative states -------

  buildHelp(settings) {
    this._rebuild.help = () => this.buildHelp(settings);
    const b = settings.bindings;
    const cards = [
      ['Move', T('Hold {keys} etc., or drag on the plaza. Your hollow follows.', { keys: keyList(b.up) }), 'You can always move while alive and the clock is running.'],
      ['Consume', 'Roll over anything smaller than you — it highlights when edible.', 'Motes first, then chunks, then boulders as you grow.'],
      ['Grow', 'Everything you eat adds mass. Bigger hollow, bigger appetite — but slower.', 'Radius follows the square root of mass.'],
      ['Boost', T('Hold {keys} or the ⚡ button. Boosting spends mass.', { keys: keyList(b.boost) }), 'Disabled in some challenges.'],
      ['Embers', 'Orange embers burn and shrink you. Give them room.', 'They are never edible.'],
      ['Rivals', 'Outweigh a rival by a quarter and you can swallow them.', 'Eaten rivals respawn — and remember you.'],
      ['Scoring', 'Rank by mass collected. Ties break on objectives, clean play, then speed.', 'Results show every component.'],
      ['Pause', T('{keys} pauses. Solo play also pauses when the tab hides.', { keys: keyList(b.pause) }), ''],
      ['Undo', T('In Practice, {keys} steps back to the previous moment.', { keys: keyList(b.undo) }), 'Not available in ranked modes.'],
    ];
    const host = $('help-cards');
    host.innerHTML = '';
    for (const [title, body, note] of cards) {
      const div = document.createElement('div');
      div.className = 'mode-card';
      div.innerHTML = `<strong>${T(title)}</strong><small>${T(body)}</small>${note ? `<small class="dim">${T(note)}</small>` : ''}`;
      host.appendChild(div);
    }
  }
}

// ---- helpers ---------------------------------------------------------------

export function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function goalText(g) {
  switch (g.type) {
    case 'mass': return T('Reach mass {n}', { n: g.target });
    case 'gems': return T(g.target === 1 ? 'Consume {n} gem' : 'Consume {n} gems', { n: g.target });
    case 'score': return T('Collect {n} mass', { n: g.target });
    case 'rivals': return T(g.target > 1 ? 'Swallow {n} rivals' : 'Swallow {n} rival', { n: g.target });
    case 'survive': return T('Finish with zero deaths');
    default: return g.type;
  }
}
/** A stage's display name in the current language (content keeps English ids and names). */
export function stageName(stage) {
  if (!stage) return '';
  switch (stage.kind) {
    case 'journey': return T(stage.mastery ? 'Mastery {n}' : 'Stage {n}', { n: stage.index });
    case 'daily': return T('Daily Hollow — {date}', { date: stage.dateKey });
    case 'practice': return T(PRACTICE_NAMES[stage.id] ?? stage.name);
    case 'hosted': return T('Hosted Table ({n} seats)', { n: (stage.rivals ?? []).length + 1 });
    default: return T(stage.name);
  }
}
const PRACTICE_NAMES = { 'practice-relaxed': N('Practice — Relaxed'), 'practice-standard': N('Practice — Standard'), 'practice-intense': N('Practice — Intense') };
const ACTION_LABELS = { up: N('Up'), down: N('Down'), left: N('Left'), right: N('Right'), boost: N('Boost'), pause: N('Pause'), undo: N('Undo'), hint: N('Hint'), camera: N('Camera') };
/** The default guest name is translated; account and typed names are not. */
export function pname(name) { return name === 'Wanderer' ? T('Wanderer') : String(name ?? ''); }
/** Distinct key names for a binding list (ShiftLeft + ShiftRight read as one "Shift"). */
export function keyList(codes, sep = '/') {
  return [...new Set(codes.map(prettyKey))].join(sep);
}
export function prettyKey(code) {
  return code.replace(/^Key/, '').replace(/^Arrow/, '').replace('ShiftLeft', 'Shift').replace('ShiftRight', 'Shift').replace('Space', 'Space');
}
const PLACES = [N('1st place'), N('2nd place'), N('3rd place')];
function placeText(n) { return T(PLACES[n - 1] ?? N('{n}th place'), { n }); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
