import * as THREE from 'three';
import { formatTime } from '../core/utils.js';
import { SPEAKERS } from '../story/Story.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(camera) {
    this.camera = camera;
    this.subtitleTimer = 0;
    this.subtitles = true;
    this.lineQueue = [];
    this.markerTarget = null;
    this._projected = new THREE.Vector3();
    this.callbacks = {};

    this.el = {
      hud: $('hud'),
      menu: $('menu'),
      loading: $('loading'),
      loadingFill: $('loading-fill'),
      loadingText: $('loading-text'),
      pause: $('pause'),
      settings: $('settings'),
      missionScreen: $('mission-screen'),
      ending: $('ending'),
      fade: $('fade'),
      missionPanel: $('mission-panel'),
      missionIndex: $('mission-index'),
      missionTitle: $('mission-title'),
      objectiveList: $('objective-list'),
      energy: $('stat-energy'),
      energyMax: $('stat-energy-max'),
      sparks: $('stat-sparks'),
      prompt: $('interaction-prompt'),
      promptText: $('interaction-text'),
      healthRow: $('health-row'),
      healthFill: $('health-fill'),
      healthNum: $('health-num'),
      weaponName: $('weapon-name'),
      ammoCount: $('ammo-count'),
      reticle: $('reticle'),
      reticleHint: $('reticle-hint'),
      cacheHint: $('cache-hint'),
      cacheDist: $('cache-dist'),
      cacheArrow: document.querySelector('#cache-hint .cache-arrow'),
      weaponRow: document.querySelector('.weapon-row'),
      hitmarker: $('hitmarker'),
      damageFlash: $('damage-flash'),
      deathScreen: $('death-screen'),
      relayPanel: $('relay-panel'),
      relayText: $('relay-text'),
      relayName: document.querySelector('#relay-panel .relay-name'),
      insightPanel: $('insight-panel'),
      insightBody: document.querySelector('#insight-panel .insight-body'),
      surgePanel: $('insight-active'),
      surgeFill: $('surge-fill'),
      toasts: $('toast-stack'),
      marker: $('objective-marker'),
      markerLabel: $('marker-label'),
      compassNeedle: $('compass-needle'),
      compassDistance: $('compass-distance'),
      mcTitle: $('mc-title'),
      mcCopy: $('mc-copy'),
      mcContinue: $('btn-mc-continue'),
      pauseStats: $('pause-stats'),
      endingStats: $('ending-stats'),
      letterbox: $('letterbox'),
      continueBtn: $('btn-continue'),
      settingsTitle: $('settings-title'),
      controlsList: $('controls-list'),
      chapterCard: $('chapter-card'),
      mcKicker: document.querySelector('#mission-screen .mc-kicker'),
      endingKicker: document.querySelector('#ending .ending-kicker'),
    };

    // settings wiring
    this.settings = { master: 0.8, music: 0.55, sensitivity: 1, quality: 'high', bloom: true, subtitles: true };
    const bindRange = (id, key, fmt, scale = 1) => {
      const input = $(id);
      const val = $(id + '-val');
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        this.settings[key] = v;
        if (val) val.textContent = fmt(v);
        if (this.callbacks.onSettings) this.callbacks.onSettings({ ...this.settings });
      });
      if (val) val.textContent = fmt(parseFloat(input.value));
    };
    bindRange('set-master', 'master', (v) => `${Math.round(v * 100)}%`);
    bindRange('set-music', 'music', (v) => `${Math.round(v * 100)}%`);
    bindRange('set-sens', 'sensitivity', (v) => v.toFixed(1));
    $('set-quality').addEventListener('change', (e) => {
      this.settings.quality = e.target.value;
      if (this.callbacks.onSettings) this.callbacks.onSettings({ ...this.settings });
    });
    $('set-bloom').addEventListener('change', (e) => {
      this.settings.bloom = e.target.checked;
      if (this.callbacks.onSettings) this.callbacks.onSettings({ ...this.settings });
    });
    $('set-subtitles').addEventListener('change', (e) => {
      this.settings.subtitles = e.target.checked;
      this.setSubtitles(this.settings.subtitles);
      if (this.callbacks.onSettings) this.callbacks.onSettings({ ...this.settings });
    });

    const onClick = (id, fn) => $(id).addEventListener('click', () => fn && fn());
    onClick('btn-new', () => this.callbacks.newGame && this.callbacks.newGame());
    onClick('btn-continue', () => this.callbacks.continueGame && this.callbacks.continueGame());
    onClick('btn-settings', () => this.showSettings('settings'));
    onClick('btn-controls', () => this.showSettings('controls'));
    onClick('btn-resume', () => this.callbacks.resume && this.callbacks.resume());
    onClick('btn-pause-settings', () => this.showSettings('settings'));
    onClick('btn-checkpoint', () => this.callbacks.restartCheckpoint && this.callbacks.restartCheckpoint());
    onClick('btn-menu', () => this.callbacks.toMenu && this.callbacks.toMenu());
    onClick('btn-settings-close', () => this.hideSettings());
    this.el.mcContinue.addEventListener('click', () => {
      if (this.callbacks.missionContinue) this.callbacks.missionContinue();
    });
    onClick('btn-ending-menu', () => this.callbacks.endingMenu && this.callbacks.endingMenu());
  }

  setCallbacks(cb) {
    this.callbacks = { ...this.callbacks, ...cb };
  }

  applySettings(settings) {
    this.settings = { ...this.settings, ...settings };
    $('set-master').value = this.settings.master;
    $('set-music').value = this.settings.music;
    $('set-sens').value = this.settings.sensitivity;
    $('set-quality').value = this.settings.quality;
    $('set-bloom').checked = this.settings.bloom;
    $('set-subtitles').checked = this.settings.subtitles !== false;
    $('set-master-val').textContent = `${Math.round(this.settings.master * 100)}%`;
    $('set-music-val').textContent = `${Math.round(this.settings.music * 100)}%`;
    $('set-sens-val').textContent = this.settings.sensitivity.toFixed(1);
  }

  // ------------------------------------------------------------------
  setLoading(p, text) {
    this.el.loadingFill.style.width = `${Math.round(p * 100)}%`;
    if (text) this.el.loadingText.textContent = text;
  }

  hideLoading() {
    this.el.loading.classList.add('hidden');
  }

  showMenu(hasSave) {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.continueBtn.disabled = !hasSave;
  }

  hideMenu() {
    this.el.menu.classList.add('hidden');
  }

  showHUD(v = true) {
    this.el.hud.classList.toggle('hidden', !v);
  }

  setMission(mission, status) {
    this.el.missionIndex.textContent = String(mission.id + 1).padStart(2, '0');
    this.el.missionTitle.textContent = mission.title;
    const firstOpen = mission.objectives.find((o) => !status[o.id]);
    this.el.objectiveList.innerHTML = mission.objectives
      .map((o) => {
        const done = !!status[o.id];
        const active = !done && firstOpen && firstOpen.id === o.id;
        return `<li class="${done ? 'done' : active ? 'active' : ''}">${o.text}</li>`;
      })
      .join('');
  }

  missionBanner(mission) {
    this.toast(`MISSION ${String(mission.id + 1).padStart(2, '0')} — ${mission.title.toUpperCase()}`, 'big');
  }

  _speakerInfo(speaker) {
    const key = String(speaker || 'RELAY').toUpperCase();
    return SPEAKERS[key] || { label: key, sub: 'TRANSMISSION', kind: 'relay' };
  }

  _showDialogueLine(line) {
    const info = this._speakerInfo(line.speaker);
    if (!this.subtitles) {
      this.el.relayPanel.classList.add('hidden');
      return;
    }
    this.el.relayPanel.classList.remove('hidden');
    this.el.relayPanel.dataset.kind = info.kind;
    this.el.relayName.innerHTML = `${info.label} <span>// ${info.sub}</span>`;
    this.el.relayText.textContent = line.text;
    this.subtitleTimer = (line.ms || 6000) / 1000;
    if (this.callbacks.onDialogueLine) this.callbacks.onDialogueLine(info);
  }

  subtitle(speaker, text, ms = 6000) {
    this.lineQueue.length = 0;
    this._showDialogueLine({ speaker, text, ms });
  }

  /** Queue a multi-line conversation (recordings, RELAY, memory fragments). */
  dialogue(lines = []) {
    if (!lines.length) return;
    this.lineQueue = lines.slice();
    this.subtitleTimer = 0;
    this._showDialogueLine(this.lineQueue.shift());
  }

  hideDialogue() {
    this.lineQueue.length = 0;
    this.subtitleTimer = 0;
    this.el.relayPanel.classList.add('hidden');
  }

  setSubtitles(on) {
    this.subtitles = !!on;
    if (!on) this.el.relayPanel.classList.add('hidden');
  }

  showChapterCard(mission) {
    const c = this.el.chapterCard;
    if (!c) return;
    c.querySelector('.cc-num').textContent = `CHAPTER ${String(mission.chapter || mission.id + 1).padStart(2, '0')}`;
    c.querySelector('.cc-title').textContent = mission.title.toUpperCase();
    c.querySelector('.cc-sub').textContent = mission.subtitle || '';
    c.classList.remove('hidden');
    c.classList.remove('on');
    void c.offsetWidth;
    c.classList.add('on');
    clearTimeout(this._chapterT);
    this._chapterT = setTimeout(() => {
      c.classList.remove('on');
      setTimeout(() => c.classList.add('hidden'), 600);
    }, 3200);
  }

  setStats({ energy, energyMax, sparks }) {
    if (energy !== undefined) this.el.energy.textContent = energy;
    if (energyMax !== undefined) this.el.energyMax.textContent = `/ ${energyMax}`;
    if (sparks !== undefined) this.el.sparks.textContent = sparks;
  }

  setHealth(health, max = 100) {
    const ratio = Math.max(0, Math.min(1, health / max));
    if (this.el.healthFill) this.el.healthFill.style.width = `${ratio * 100}%`;
    if (this.el.healthNum) this.el.healthNum.textContent = String(Math.max(0, Math.ceil(health)));
    if (this.el.healthRow) this.el.healthRow.classList.toggle('low', ratio <= 0.3);
  }

  setWeapon(name, ammo) {
    if (this.el.weaponName) this.el.weaponName.textContent = name;
    if (this.el.ammoCount) this.el.ammoCount.textContent = ammo === null || ammo === undefined ? '—' : String(ammo);
  }

  setReticle(armed) {
    if (this.el.reticle) this.el.reticle.classList.toggle('armed', !!armed);
    if (!armed && this.el.reticleHint) this.el.reticleHint.classList.remove('on');
  }

  /** Reticle lock-on + aim zoom state. */
  setAim(locked, distance = 0, aiming = false) {
    const r = this.el.reticle;
    if (!r) return;
    r.classList.toggle('lock', !!locked);
    r.classList.toggle('aiming', !!aiming);
    const hint = this.el.reticleHint;
    if (!hint) return;
    if (locked) {
      const text = `INFECTED · ${Math.max(1, Math.round(distance))} M`;
      if (hint.textContent !== text) hint.textContent = text;
      hint.classList.add('on');
    } else if (hint.classList.contains('on')) {
      hint.classList.remove('on');
    }
  }

  /** Direction and distance to the nearest pistol cache while unarmed. */
  setCacheHint(info) {
    const el = this.el.cacheHint;
    if (!el) return;
    if (!info) {
      el.classList.add('hidden');
      this._cacheKey = '';
      return;
    }
    const key = `${info.distance}|${Math.round(info.angle * 40)}`;
    if (key === this._cacheKey) return;
    this._cacheKey = key;
    el.classList.remove('hidden');
    if (this.el.cacheDist) this.el.cacheDist.textContent = `${info.distance} M`;
    if (this.el.cacheArrow) this.el.cacheArrow.style.transform = `rotate(${info.angle}rad)`;
  }

  weaponFlash() {
    const el = this.el.weaponRow;
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  flashDamage() {
    const el = this.el.damageFlash;
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  hitMarker(kind = 'body') {
    const el = this.el.hitmarker;
    if (!el) return;
    el.classList.toggle('head', kind === 'head');
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  showDeath() {
    if (this.el.deathScreen) this.el.deathScreen.classList.remove('hidden');
  }

  hideDeath() {
    if (this.el.deathScreen) this.el.deathScreen.classList.add('hidden');
  }

  setPrompt(text) {
    if (!text) {
      this.el.prompt.classList.add('hidden');
      return;
    }
    this.el.prompt.classList.remove('hidden');
    this.el.promptText.textContent = text;
  }

  toast(text, variant = '') {
    const div = document.createElement('div');
    div.className = `toast ${variant}`;
    div.textContent = text;
    this.el.toasts.appendChild(div);
    setTimeout(() => div.remove(), 3500);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  showInsight(show, hint) {
    this.el.insightPanel.classList.toggle('hidden', !show);
    if (show && hint) this.el.insightBody.innerHTML = `<b>H</b> — ${hint}`;
  }

  setSurge(on, ratio = 1) {
    this.el.surgePanel.classList.toggle('hidden', !on);
    this.el.surgeFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  showMissionComplete(title, copy, kicker) {
    this.el.mcTitle.textContent = title;
    this.el.mcCopy.textContent = copy;
    if (this.el.mcKicker && kicker) this.el.mcKicker.textContent = kicker;
    this.el.missionScreen.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
  }

  hideMissionComplete() {
    this.el.missionScreen.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
  }

  showPause(stats) {
    this.el.pause.classList.remove('hidden');
    if (stats) {
      this.el.pauseStats.innerHTML = `<span>⚡ ${stats.energy}/${stats.energyMax}</span><span>✦ ${stats.sparks}</span><span>${formatTime(stats.time)}</span>`;
    }
  }

  hidePause() {
    this.el.pause.classList.add('hidden');
  }

  showSettings(mode) {
    this.el.settings.classList.remove('hidden');
    this.el.settingsTitle.textContent = mode === 'controls' ? 'CONTROLS' : 'SETTINGS';
    this.el.controlsList.classList.toggle('hidden', mode !== 'controls');
    if (this.el.pause.classList.contains('hidden')) this.el.settings.classList.add('from-menu');
    else this.el.settings.classList.remove('from-menu');
  }

  hideSettings() {
    this.el.settings.classList.add('hidden');
  }

  showEnding(stats) {
    this.el.ending.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    if (this.el.endingKicker) this.el.endingKicker.textContent = 'THE SIGNAL HAS STOPPED';
    this.el.endingStats.innerHTML = `
      <div><b>${stats.energy}/${stats.energyMax}</b>ENERGY</div>
      <div><b>${stats.sparks}</b>INSIGHTS</div>
      <div><b>${formatTime(stats.time)}</b>RESTORE TIME</div>`;
  }

  setLetterbox(on) {
    this.el.letterbox.classList.toggle('hidden', !on);
    this.el.letterbox.classList.toggle('active', on);
  }

  fade(on, white = false, cb) {
    this.el.fade.classList.toggle('white', white);
    this.el.fade.classList.toggle('on', on);
    if (cb) setTimeout(cb, on ? 480 : 60);
  }

  /** Project the navigation target into screen space + compass. */
  updateNavigation(target, cameraYaw) {
    const marker = this.el.marker;
    if (!target) {
      marker.classList.add('hidden');
      this.el.compassDistance.textContent = '—';
      return;
    }
    const v = this._projected.set(target.x, (target.y || 0) + 2.5, target.z);
    v.project(this.camera);
    const behind = v.z > 1;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    if (behind || x < -40 || x > window.innerWidth + 40) {
      marker.classList.add('hidden');
    } else {
      marker.classList.remove('hidden');
      marker.style.left = `${x}px`;
      marker.style.top = `${y}px`;
    }
    const dx = target.x - this.camera.position.x;
    const dz = target.z - this.camera.position.z;
    const dist = Math.hypot(dx, dz);
    const bearing = Math.atan2(dx, dz);
    const camBearing = cameraYaw + Math.PI;
    let rel = bearing - camBearing;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    this.el.compassNeedle.style.transform = `rotate(${rel}rad)`;
    this.el.compassDistance.textContent = `${Math.round(dist)} M`;
    this.el.markerLabel.textContent = target.label || '';
  }

  update(dt) {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) {
        this.subtitleTimer = 0;
        if (this.lineQueue.length) this._showDialogueLine(this.lineQueue.shift());
        else this.el.relayPanel.classList.add('hidden');
      }
    }
  }
}
