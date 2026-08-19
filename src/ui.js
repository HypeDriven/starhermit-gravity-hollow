// Gravity Hollow — DOM shell: screens, HUD, settings, help, toasts, live
// regions. UI state is strictly separate from simulation state.

import { ACHIEVEMENTS } from './session.js';
import { JOURNEY_COUNT } from './content.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(app) {
    this.app = app;
    this.screens = ['boot', 'title', 'modes', 'setup', 'journey', 'profile', 'pause', 'results', 'settings', 'help'];
    this.current = 'boot';
    this.returnTo = 'title';
    this.lastFocus = null;
    this._toastCount = 0;
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
    if (first) first.focus();
  }
  overlay(name) { // settings/help over current screen
    this.under = this.current;
    this.show(name);
  }
  back() {
    const target = this.under && ['settings', 'help'].includes(this.current) ? this.under : 'title';
    this.under = null;
    if (target === null || target === 'none') this.show(null);
    else this.show(target);
    this.restoreFocus();
  }
  showNone() { this.show(null); }
  restoreFocus() { if (this.lastFocus?.focus) { try { this.lastFocus.focus(); } catch {} } }

  // ---- feedback ----------------------------------------------------------

  toast(text, ms = 3200) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
    this.announce(text);
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
    $('profile-sub').textContent = save.profile.name;
  }
  setDailySub(text) { $('daily-sub').textContent = text; }

  // ---- mode select --------------------------------------------------------

  buildModeCards(modes) {
    const host = $('mode-cards');
    host.innerHTML = '';
    for (const m of modes) {
      const b = document.createElement('button');
      b.className = 'mode-card';
      b.innerHTML = `<strong>${m.name}</strong><small>${m.desc}</small>` +
        (m.badge ? `<span class="badge">${m.badge}</span>` : '');
      b.addEventListener('click', () => { this.app.audio.event('ui_confirm'); m.onPick(); });
      host.appendChild(b);
    }
  }

  // ---- setup ---------------------------------------------------------------

  buildSetup(stage, meta) {
    const host = $('setup-body');
    const goals = (stage.goals ?? []).map(g => `<li>${goalText(g)}</li>`).join('') || '<li>Outscore every rival.</li>';
    host.innerHTML = `
      <h3>${stage.name}</h3>
      <p class="dim">${meta?.description ?? ''}</p>
      <dl class="breakdown">
        <dt>Duration</dt><dd>${fmtTime(stage.durationSec)}</dd>
        <dt>Rivals</dt><dd>${(stage.rivals ?? []).length}</dd>
        <dt>Boost</dt><dd>${stage.boost === 'off' ? 'disabled' : stage.boost === 'limited' ? `${stage.boostLimit} uses` : 'enabled'}</dd>
        <dt>Ranked</dt><dd>${stage.unrated ? 'No (practice)' : stage.excluded ? 'Excluded from ranking' : 'Yes'}</dd>
        <dt>Undo</dt><dd>${stage.undoAllowed ? 'allowed' : 'not allowed'}</dd>
      </dl>
      <h4>Objectives</h4><ul>${goals}</ul>`;
  }

  // ---- journey --------------------------------------------------------------

  buildJourney(save, stages, onPick) {
    const host = $('journey-grid');
    host.innerHTML = '';
    const clearedCount = Object.keys(save.journey).length;
    stages.forEach((s, i) => {
      const rec = save.journey[s.id];
      const locked = i > 0 && !save.journey[stages[i - 1].id] && i > clearedCount;
      const b = document.createElement('button');
      b.className = 'journey-cell' + (locked ? ' locked' : '') + (s.mastery ? ' mastery' : '');
      b.disabled = locked;
      b.setAttribute('aria-label', `${s.name}${locked ? ' (locked)' : ''}${rec ? `, ${rec.stars} stars` : ''}`);
      b.innerHTML = `${s.mastery ? '★' : s.index}<span class="stars">${'★'.repeat(rec?.stars ?? 0)}</span>`;
      if (!locked) b.addEventListener('click', () => { this.app.audio.event('ui_confirm'); onPick(s); });
      host.appendChild(b);
    });
  }

  // ---- profile / achievements -------------------------------------------------

  buildProfile(save) {
    $('profile-body').innerHTML = `
      <p><strong>${escapeHtml(save.profile.name)}</strong> ${save.profile.guest ? '<span class="dim">(guest — progress stored on this device)</span>' : ''}</p>
      <dl class="breakdown">
        <dt>Sessions played</dt><dd>${save.sessionsPlayed}</dd>
        <dt>Mastery XP</dt><dd>${Math.floor(save.masteryXp)}</dd>
        <dt>Journey cleared</dt><dd>${Object.keys(save.journey).length} / ${JOURNEY_COUNT}</dd>
        <dt>Days played</dt><dd>${(save.playDays ?? []).length}</dd>
      </dl>
      <label>Display name <input type="text" id="profile-name" value="${escapeHtml(save.profile.name)}" maxlength="20"></label>`;
    $('profile-name').addEventListener('change', (e) => {
      const v = e.target.value.trim().slice(0, 20);
      if (v) { save.profile.name = v; this.app.persistAll(); this.updateTitle(save); }
    });
    const list = $('achievement-list');
    list.innerHTML = '';
    for (const [key, a] of Object.entries(ACHIEVEMENTS)) {
      const got = save.achievements[key];
      const li = document.createElement('li');
      li.className = got ? 'unlocked' : 'locked';
      li.innerHTML = `<strong>${a.name}</strong> — ${a.desc}${got ? ' ✓' : ''}`;
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
    const remain = Math.max(0, stage.durationSec - state.tick / 30);
    $('hud-timer').textContent = fmtTime(remain);
    $('hud-timer').style.color = remain < 15 ? 'var(--danger)' : '';
    const goals = state.goals.map(g =>
      `<div class="${g.done ? 'goal-done' : ''}">${g.done ? '✓ ' : ''}${goalText(g)}${g.type !== 'survive' ? ` (${Math.min(g.progress, g.target)}/${g.target})` : ''}</div>`).join('');
    $('hud-objective').innerHTML = `<strong>${escapeHtml(stage.name)}</strong>`;
    $('hud-goals').innerHTML = goals || '<span class="dim">Outscore every rival</span>';
    let score = `<div>Mass <strong>${Math.floor(me.mass)}</strong> · Collected <strong>${me.propMass + me.gemMass + me.rivalMass}</strong></div>`;
    if (!me.alive) score += `<div class="dim">Respawning…</div>`;
    if (query?.moveTicksLeft != null) score += `<div>Moves left ${(query.moveTicksLeft / 30).toFixed(0)}s</div>`;
    if (query?.boostsLeft != null) score += `<div>Boosts left ${query.boostsLeft}</div>`;
    $('hud-score').innerHTML = score;
    const ranks = [...state.voids].sort((a, b) =>
      (b.propMass + b.gemMass + b.rivalMass) - (a.propMass + a.gemMass + a.rivalMass));
    $('hud-ranks').innerHTML = ranks.map((v, i) =>
      `${i + 1}. ${v.id === 0 ? '<strong>' : ''}${escapeHtml(v.name)} ${v.propMass + v.gemMass + v.rivalMass}${v.id === 0 ? '</strong>' : ''}${v.alive ? '' : ' ✝'}`).join(' · ');
  }

  countdown(text) {
    const el = $('countdown');
    if (text == null) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  tutorialBanner(step, onSkip) {
    const el = $('tutorial-banner');
    if (!step) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    $('tutorial-text').textContent = step.text;
    $('tutorial-hint').textContent = step.hint ?? '';
    $('btn-tutorial-skip').onclick = onSkip;
  }

  // ---- results --------------------------------------------------------------

  showResults(results, progress) {
    const { rankings, breakdown, stage, terminalReason, goals } = results;
    const me = rankings.find(r => r.id === 0);
    const won = me?.place === 1;
    $('results-headline').textContent =
      terminalReason === 'lesson_complete' ? 'Lesson complete!' :
      terminalReason === 'moves_exhausted' ? 'Out of moves' :
      won ? 'You rule the plaza!' : `${ordinal(me?.place ?? 0)} place`;
    $('results-h').textContent = `${stage.name} — Results`;
    const ol = $('results-standings');
    ol.innerHTML = '';
    for (const r of rankings) {
      const li = document.createElement('li');
      li.className = r.id === 0 ? 'me' : '';
      li.textContent = `${r.name} — ${r.massCollected} collected${r.deaths ? `, ${r.deaths} ✝` : ''}`;
      ol.appendChild(li);
    }
    const bd = $('results-breakdown');
    bd.innerHTML = `
      <dt>Props consumed</dt><dd>${breakdown.props}</dd>
      <dt>Gems (${breakdown.gemCount})</dt><dd>${breakdown.gems}</dd>
      <dt>Rivals (${breakdown.rivalCount})</dt><dd>${breakdown.rivals}</dd>
      <dt>Survival bonus</dt><dd>${breakdown.survivalBonus}</dd>
      <dt>Invalid-action penalty</dt><dd>${breakdown.invalidPenalty}</dd>
      <div class="total" style="display:contents"><dt>Total</dt><dd>${breakdown.total}</dd></div>`;
    const gl = $('results-goals');
    gl.innerHTML = goals.map(g => `<li class="${g.done ? 'goal-done' : ''}">${g.done ? '✓' : '✗'} ${goalText(g)}</li>`).join('') || '<li>—</li>';
    $('results-progress').textContent = progress ?? '';
    this.show('results');
    this.announce(`${$('results-headline').textContent}. Total score ${breakdown.total}.`, true);
  }

  // ---- settings ------------------------------------------------------------

  bindSettings(settings, onChange) {
    const map = [
      ['set-music', 'music'], ['set-effects', 'effects'], ['set-ambience', 'ambience'], ['set-voice', 'voice'],
      ['set-muted', 'muted', 'checked'], ['set-captions', 'captions', 'checked'],
      ['set-quality', 'quality'], ['set-reduced', 'reducedMotion', 'checked'],
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
    const render = () => {
      host.innerHTML = '';
      for (const action of ['up', 'down', 'left', 'right', 'boost', 'pause', 'undo', 'hint', 'camera']) {
        const row = document.createElement('div');
        row.className = 'bind-row';
        const keys = settings.bindings[action].map(prettyKey).join(' / ');
        row.innerHTML = `<span>${action}</span><span class="dim">${keys}</span>`;
        const btn = document.createElement('button');
        btn.className = 'ghost small';
        btn.textContent = 'rebind';
        btn.addEventListener('click', () => {
          btn.textContent = 'press a key…';
          const h = (e) => {
            e.preventDefault();
            settings.bindings[action] = [e.code];
            document.removeEventListener('keydown', h, true);
            onChange('bindings'); render();
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
    const b = settings.bindings;
    const cards = [
      ['Move', `Hold ${b.up.map(prettyKey).join('/')} etc., or drag on the plaza. Your hollow follows.`, 'You can always move while alive and the clock is running.'],
      ['Consume', 'Roll over anything smaller than you — it highlights when edible.', 'Motes first, then chunks, then boulders as you grow.'],
      ['Grow', 'Everything you eat adds mass. Bigger hollow, bigger appetite — but slower.', 'Radius follows the square root of mass.'],
      ['Boost', `Hold ${b.boost.map(prettyKey).join('/')} or the ⚡ button. Boosting spends mass.`, 'Disabled in some challenges.'],
      ['Embers', 'Orange embers burn and shrink you. Give them room.', 'They are never edible.'],
      ['Rivals', 'Outweigh a rival by a quarter and you can swallow them.', 'Eaten rivals respawn — and remember you.'],
      ['Scoring', 'Rank by mass collected. Ties break on objectives, clean play, then speed.', 'Results show every component.'],
      ['Pause', `${b.pause.map(prettyKey).join('/')} pauses. Solo play also pauses when the tab hides.`, ''],
      ['Undo', `In Practice, ${b.undo.map(prettyKey).join('/')} steps back to the previous moment.`, 'Not available in ranked modes.'],
    ];
    const host = $('help-cards');
    host.innerHTML = '';
    for (const [title, body, note] of cards) {
      const div = document.createElement('div');
      div.className = 'mode-card';
      div.innerHTML = `<strong>${title}</strong><small>${typeof body === 'string' ? body : ''}</small>${note ? `<small class="dim">${note}</small>` : ''}`;
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
    case 'mass': return `Reach mass ${g.target}`;
    case 'gems': return `Consume ${g.target} gems`;
    case 'score': return `Collect ${g.target} mass`;
    case 'rivals': return `Swallow ${g.target} rival${g.target > 1 ? 's' : ''}`;
    case 'survive': return 'Finish with zero deaths';
    default: return g.type;
  }
}
export function prettyKey(code) {
  return code.replace(/^Key/, '').replace(/^Arrow/, '').replace('ShiftLeft', 'Shift').replace('ShiftRight', 'Shift').replace('Space', 'Space');
}
function ordinal(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
