import { MusicDirector, MUSIC_STATES } from './Music.js';

/**
 * Fully procedural audio: ambient score, wind, water, footsteps and
 * sci-fi interaction feedback. No audio files, no licensing, no downloads.
 *
 * The score itself lives in Music.js (MusicDirector) and is driven from here so
 * gameplay code only ever talks to AudioEngine.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.masterVolume = 0.8;
    this.musicVolume = 0.55;
    this.restoration = 0;
    this.musicRestoration = 0;
    this.time = 0;
    this.birdTimer = 4;
    this.waterRunning = false;
    this.noteIndex = 0;
    this.duckLevel = 1;
    this.duckUntil = 0;
    this.duckAmount = 1;
    this.moveDuckUntil = 0;
    this.threat = 0;
    this.threatTimer = 6;
    this.envTimer = 7;
    this.surface = 'concrete';
    this.muted = false;
    // Remembered before init() so the score starts in the right mood once the
    // browser allows audio (first pointer interaction).
    this.musicState = MUSIC_STATES.MENU;
    this.music = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0.0001 : this.masterVolume;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.ambienceBus = this.ctx.createGain();
    this.ambienceBus.gain.value = 0.9;
    this.ambienceBus.connect(this.master);

    // One dark convolution space for the whole game; each surface decides how
    // much of itself it sends here, so metal rings and sand stays dry.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.6);
    this.reverbReturn = this.ctx.createGain();
    this.reverbReturn.gain.value = 0.5;
    this.reverb.connect(this.reverbReturn).connect(this.master);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(this.reverb);

    this.noiseBuffer = this._makeNoise(2, 'white');
    this.brownBuffer = this._makeNoise(4, 'brown');

    // Layered, crossfading score (see Music.js). One instance, ever.
    if (!this.music) {
      this.music = new MusicDirector(this.ctx, this.musicBus, this.noiseBuffer);
      this.music.setState(this.musicState);
      this.music.setRestoration(this.musicRestoration);
    }

    this._startHum();
    this._startWind();
    this.ready = true;
  }

  _makeNoise(seconds, type) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = w;
      }
    }
    return buffer;
  }

  setMasterVolume(v) {
    this.masterVolume = v;
    this._applyMasterGain();
  }

  /** Mute switch (no dedicated UI yet; kept for future settings work). */
  setMuted(on) {
    this.muted = !!on;
    this._applyMasterGain();
  }

  _applyMasterGain() {
    if (!this.master) return;
    const level = this.muted ? 0.0001 : this.masterVolume;
    this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicBus) this.musicBus.gain.value = v * this.duckLevel;
  }

  _startWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.brownBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.16;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(filter).connect(gain).connect(this.ambienceBus);
    src.start();
    lfo.start();
    this.windGain = gain;
  }

  startWaterLoop() {
    if (!this.ready || this.waterRunning) return;
    this.waterRunning = true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 0.7;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;
    gain.gain.linearRampToValueAtTime(0.075, this.ctx.currentTime + 2.5);
    src.connect(band).connect(gain).connect(this.sfxBus);
    src.start();
    this.waterGain = gain;
    this.waterSrc = src;
  }

  _note(freq, start, dur, type = 'sine', gain = 0.1, filterFreq = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.06, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (filterFreq) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      osc.connect(f);
      node = f;
    }
    node.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  setRestoration(t) {
    this.restoration = t;
    if (this.music) this.music.setRestoration(t);
  }

  // ---- music direction (single entry points for gameplay code) -----------
  /**
   * Switch the score's base mood: 'menu' | 'intro' | 'exploration' |
   * 'danger' | 'threat' | 'relief' | 'hope' | 'ending' | 'silent'.
   * Safe to call before init(); the mood is applied when audio starts.
   */
  setMusicState(name) {
    this.musicState = name;
    if (this.music) this.music.setState(name);
  }

  /**
   * Danger drives the exploration bed: 0 calm … 1 a Hollowed at arm's length.
   * This raises tension but never starts the urgent chase layer by itself.
   */
  setDanger(level) {
    if (this.music) this.music.setDanger(level);
  }

  /**
   * Urgent layer on/off. Call with true only for a real attack, detection or
   * chase (zombie state === 'chase'), and false once the last hunter gives up.
   */
  setThreatLevel(level, urgent = false) {
    if (!this.music) return;
    this.music.setDanger(level);
    this.music.setUrgent(urgent);
  }

  /** Short warm swell: district restored, checkpoint after a death. */
  relief(seconds = 9) {
    if (this.music) this.music.triggerRelief(seconds);
  }

  /** Pause menu: bow the score down smoothly; resume() fades it back. */
  setMusicPaused(on) {
    if (this.music) this.music.setPaused(on);
  }

  sfx(name, opts = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + (opts.delay || 0);
    const vol = opts.volume ?? 1;
    if (['relayVoice', 'recording', 'activate', 'relay', 'core', 'missionComplete'].includes(name)) {
      this.duckMusic(0.6, 2.2);
    } else if (['pistol', 'hurt', 'zombieAlert', 'missionStart'].includes(name)) {
      this.duckMusic(0.82, 0.7);
    }
    switch (name) {
      case 'jump': {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(520, t + 0.16);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.12 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 0.22);
        break;
      }
      case 'land': {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(600, t);
        f.frequency.exponentialRampToValueAtTime(160, t + 0.18);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.24 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        src.connect(f).connect(g).connect(this.sfxBus);
        src.start(t);
        src.stop(t + 0.24);
        break;
      }
      case 'pickup': {
        this._note(880, 0, 0.22, 'sine', 0.06, 0);
        this._note(1318.5, 0.07, 0.32, 'sine', 0.05, 0);
        break;
      }
      case 'cell': {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._note(f, i * 0.08, 1.1, 'triangle', 0.07, 0));
        break;
      }
      case 'energy': {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(240, t);
        o.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 3200;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + 0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.connect(f).connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 0.75);
        break;
      }
      case 'interact':
        this._note(1200, 0, 0.08, 'square', 0.03, 0);
        break;
      case 'objective':
        this._note(659.25, 0, 0.5, 'sine', 0.07, 0);
        this._note(987.77, 0.14, 0.8, 'sine', 0.06, 0);
        break;
      case 'missionComplete':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this._note(f, i * 0.12, 1.8, 'triangle', 0.08, 0));
        break;
      case 'missionStart': {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(90, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 1.4);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.16, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        o.connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 1.6);
        break;
      }
      case 'activate':
        [330, 440, 554.37, 660].forEach((f, i) => this._note(f, i * 0.06, 1.6, 'triangle', 0.06, 2500));
        break;
      case 'relay':
        [220, 330, 440, 660, 880].forEach((f, i) => this._note(f, i * 0.15, 3.2, 'triangle', 0.055, 3000));
        break;
      case 'rotary':
        break;
      case 'rotate': {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 340;
        f.Q.value = 8;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        src.connect(f).connect(g).connect(this.sfxBus);
        src.start(t);
        src.stop(t + 0.18);
        break;
      }
      case 'repairStart': {
        for (let i = 0; i < 5; i++) this._note(180 + i * 30, i * 0.08, 0.08, 'square', 0.025, 1200);
        break;
      }
      case 'deny': {
        const o = this.ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = 105;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.05, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 0.24);
        break;
      }
      case 'checkpoint':
        this._note(784, 0, 0.25, 'sine', 0.04, 0);
        this._note(1174.7, 0.1, 0.4, 'sine', 0.035, 0);
        break;
      case 'sparkOffer':
        this._note(1046.5, 0, 1.4, 'sine', 0.05, 0);
        this._note(1396.9, 0.12, 1.2, 'sine', 0.04, 0);
        this._note(2093, 0.24, 0.9, 'triangle', 0.02, 0);
        break;
      case 'spark':
        [880, 1174.7, 1567.98, 2093].forEach((f, i) => this._note(f, i * 0.05, 1.8, 'sine', 0.05, 4000));
        break;
      case 'water': {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(2600, t + 0.5);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.1, t + 0.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
        src.connect(f).connect(g).connect(this.sfxBus);
        src.start(t);
        src.stop(t + 1.5);
        break;
      }
      case 'bloom':
        [196, 261.63, 329.63, 392, 523.25].forEach((f, i) => this._note(f, i * 0.09, 2.6, 'sine', 0.07, 3000));
        break;
      case 'core': {
        [65.4, 98, 130.8, 196, 261.63, 392].forEach((f, i) => this._note(f, i * 0.05, 5, 'triangle', 0.09, 1800));
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(60, t);
        o.frequency.exponentialRampToValueAtTime(600, t + 3);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
        o.connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 4.1);
        break;
      }
      case 'pistol': {
        // Layered shot: supersonic crack, muzzle body, chest thump, city tail
        // and the mechanical slide cycle. Slight random pitch per shot.
        const rate = 0.95 + Math.random() * 0.15;

        const crack = this.ctx.createBufferSource();
        crack.buffer = this.noiseBuffer;
        crack.playbackRate.value = 1.7 * rate;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1400;
        const cg = this.ctx.createGain();
        cg.gain.setValueAtTime(0.55 * vol, t);
        cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        crack.connect(hp).connect(cg).connect(this.sfxBus);
        crack.start(t);
        crack.stop(t + 0.09);

        const body = this.ctx.createBufferSource();
        body.buffer = this.brownBuffer;
        body.playbackRate.value = 1.5 * rate;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2400, t);
        lp.frequency.exponentialRampToValueAtTime(320, t + 0.24);
        const bg = this.ctx.createGain();
        bg.gain.setValueAtTime(0.0001, t);
        bg.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.006);
        bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        body.connect(lp).connect(bg).connect(this.sfxBus);
        body.start(t);
        body.stop(t + 0.3);

        const thump = this.ctx.createOscillator();
        thump.type = 'sine';
        thump.frequency.setValueAtTime(140, t);
        thump.frequency.exponentialRampToValueAtTime(42, t + 0.16);
        const tg = this.ctx.createGain();
        tg.gain.setValueAtTime(0.34 * vol, t);
        tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        thump.connect(tg).connect(this.sfxBus);
        thump.start(t);
        thump.stop(t + 0.22);

        // slapback through the ruins
        const tail = this.ctx.createBufferSource();
        tail.buffer = this.noiseBuffer;
        tail.playbackRate.value = 0.8;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900;
        bp.Q.value = 0.6;
        const tgain = this.ctx.createGain();
        tgain.gain.setValueAtTime(0.14 * vol, t);
        tgain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
        const delay = this.ctx.createDelay(0.5);
        delay.delayTime.value = 0.11;
        const fb = this.ctx.createGain();
        fb.gain.value = 0.24;
        delay.connect(fb).connect(delay);
        const wet = this.ctx.createGain();
        wet.gain.value = 0.55;
        tail.connect(bp).connect(tgain).connect(this.sfxBus);
        tgain.connect(delay).connect(wet).connect(this.sfxBus);
        tail.start(t);
        tail.stop(t + 0.8);

        this._note(2200, 0.055, 0.035, 'square', 0.035 * vol, 4000);
        this._note(1500, 0.1, 0.03, 'square', 0.026 * vol, 4000);
        break;
      }
      case 'shell': {
        const o = this.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(2600, t);
        o.frequency.exponentialRampToValueAtTime(1800, t + 0.08);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.045 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 0.1);
        break;
      }
      case 'zombieAlert': {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(110, t);
        o.frequency.linearRampToValueAtTime(150, t + 0.18);
        o.frequency.linearRampToValueAtTime(82, t + 0.7);
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(420, t);
        f.frequency.linearRampToValueAtTime(260, t + 0.7);
        f.Q.value = 3;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.1 * vol, t + 0.14);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
        o.connect(f).connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 0.85);
        break;
      }
      case 'empty': {
        for (let i = 0; i < 2; i++) this._note(320 + i * 90, i * 0.05, 0.03, 'square', 0.02, 1800);
        break;
      }
      case 'punch': {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.playbackRate.value = 0.55;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 500;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.22 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        src.connect(f).connect(g).connect(this.sfxBus);
        src.start(t);
        src.stop(t + 0.15);
        break;
      }
      case 'hurt': {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(190, t);
        o.frequency.exponentialRampToValueAtTime(70, t + 0.3);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 900;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.16 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        o.connect(f).connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 0.36);
        break;
      }
      case 'zombieGrowl': {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(88, t);
        o.frequency.linearRampToValueAtTime(64, t + 0.8);
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(380, t);
        f.frequency.linearRampToValueAtTime(220, t + 0.8);
        f.Q.value = 4;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09 * vol, t + 0.16);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.connect(f).connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 0.95);
        break;
      }
      case 'zombieSwipe': {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.playbackRate.value = 0.8;
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(1500, t);
        f.frequency.exponentialRampToValueAtTime(420, t + 0.2);
        f.Q.value = 1.2;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.12 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        src.connect(f).connect(g).connect(this.sfxBus);
        src.start(t);
        src.stop(t + 0.24);
        break;
      }
      case 'zombieHit': {
        const src = this.ctx.createBufferSource();
        src.buffer = this.brownBuffer;
        src.playbackRate.value = 1.4;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 700;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.24 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        src.connect(f).connect(g).connect(this.sfxBus);
        src.start(t);
        src.stop(t + 0.18);
        break;
      }
      case 'zombieDie': {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(130, t);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.9);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 620;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.13 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
        o.connect(f).connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 1.05);
        break;
      }
      case 'death': {
        [110, 82, 55].forEach((f, i) => this._note(f, i * 0.18, 2.6, 'triangle', 0.07, 700));
        break;
      }
      case 'gunPickup':
        [392, 523.25, 659.25, 784].forEach((f, i) => this._note(f, i * 0.07, 1.1, 'square', 0.045, 2200));
        break;
      case 'ammoPickup':
        this._note(587.33, 0, 0.14, 'square', 0.03, 2600);
        this._note(880, 0.06, 0.2, 'square', 0.026, 2600);
        break;
      case 'ui':
        this._note(660, 0, 0.06, 'sine', 0.025, 0);
        break;
      case 'relayVoice': {
        // Short filtered comms chirps rather than speech synthesis.
        const base = 620 + Math.random() * 260;
        this._note(base, 0, 0.05, 'square', (0.014 * vol), 2400);
        this._note(base * 1.5, 0.055, 0.04, 'sine', (0.01 * vol), 3000);
        break;
      }
      case 'recording': {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1100;
        f.Q.value = 1.8;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.05 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        src.connect(f).connect(g).connect(this.sfxBus);
        src.start(t);
        src.stop(t + 0.95);
        this._note(196, 0.02, 0.6, 'sine', 0.02, 900);
        break;
      }
      case 'intro': {
        // Low cinematic drone under the opening reel.
        const t0 = this.ctx.currentTime;
        [55, 82.41, 110].forEach((fq, i) => {
          const o = this.ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = fq;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.05 - i * 0.012, t0 + 2.5);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 9);
          o.connect(g).connect(this.musicBus);
          o.start(t0);
          o.stop(t0 + 9.2);
        });
        break;
      }
      case 'awaken': {
        [261.63, 329.63, 392, 523.25].forEach((f, i) => this._note(f, i * 0.35, 3.2, 'sine', 0.035, 1800));
        break;
      }
      default:
        break;
    }
  }

  /**
   * A single footfall. `surface` selects the material; volume, speed and pan
   * keep each step slightly different so the walk never sounds mechanical.
   * Old callers passing a number still work.
   */
  footstep(opts = 0.35) {
    if (!this.ready) return;
    const o = typeof opts === 'number' ? { volume: opts } : (opts || {});
    const surface = o.surface || this.surface || 'concrete';
    const speed = o.speed ?? 4.0;
    const weight = Math.min(1, Math.max(0.35, speed / 7.5));
    const vol = (o.volume ?? 0.35) * (0.85 + weight * 0.3);
    const t = this.ctx.currentTime + 0.002;
    const pan = o.pan ?? (Math.random() * 0.5 - 0.25);
    const rate = 0.92 + Math.random() * 0.2;
    const out = this._stepOut(this._surfaceWet(surface), pan);
    this._surfaceStep(surface, t, out, vol, weight, rate);
    if (o.blendSurface && o.blend > 0) {
      // crossing between two surfaces: fade the previous material out under
      // the new one instead of snapping
      const b = Math.min(1, Math.max(0, o.blend));
      this._surfaceStep(o.blendSurface, t + 0.006, out, vol * b * 0.55, weight, rate * 1.05);
    }
    if (speed > 5.6) this.duckMusic(0.93, 0.3);
  }

  _surfaceWet(surface) {
    return { sand: 0.05, mud: 0.05, concrete: 0.22, rubble: 0.17, metal: 0.32, water: 0.13 }[surface] ?? 0.18;
  }

  _surfaceStep(surface, t, out, vol, weight, rate) {
    switch (surface) {
      case 'sand': {
        this._noiseBurst(t, out, { dur: 0.16, freq: 1900, q: 0.7, gain: 0.16 * vol, rate });
        this._noiseBurst(t + 0.02, out, { dur: 0.28, freq: 620, q: 0.6, gain: 0.08 * vol, rate: rate * 0.8 });
        this._toneBurst(t, out, { freq: 96, end: 58, dur: 0.14, gain: 0.045 * vol });
        break;
      }
      case 'mud': {
        this._toneBurst(t, out, { freq: 110, end: 52, dur: 0.2, gain: 0.11 * vol });
        this._noiseBurst(t, out, { dur: 0.22, freq: 340, q: 1.1, gain: 0.13 * vol, rate: rate * 0.7 });
        if (Math.random() < 0.3) {
          this._noiseBurst(t + 0.06, out, { dur: 0.24, freq: 780, q: 5, gain: 0.06 * vol, rate: 0.6 });
          this._toneBurst(t + 0.05, out, { freq: 210, end: 105, dur: 0.12, gain: 0.03 * vol });
        }
        break;
      }
      case 'concrete': {
        this._toneBurst(t, out, { freq: 128 + 30 * weight, end: 60, dur: 0.16, gain: 0.1 * vol });
        this._noiseBurst(t, out, { dur: 0.1, freq: 900, q: 0.9, gain: 0.1 * vol, rate });
        // short urban slapback
        const delay = this.ctx.createDelay(0.3);
        delay.delayTime.value = 0.085;
        const fb = this.ctx.createGain();
        fb.gain.value = 0.18;
        const echo = this.ctx.createGain();
        echo.gain.value = 0.2;
        out.connect(delay);
        delay.connect(fb).connect(delay);
        delay.connect(echo).connect(this.sfxBus);
        this._noiseBurst(t + 0.05, out, { dur: 0.12, freq: 700, gain: 0.045 * vol, rate });
        break;
      }
      case 'rubble': {
        this._toneBurst(t, out, { freq: 150, end: 68, dur: 0.12, gain: 0.095 * vol });
        this._noiseBurst(t, out, { dur: 0.09, freq: 1500, q: 1.4, gain: 0.11 * vol, rate });
        const grit = 2 + ((Math.random() * 3) | 0);
        for (let i = 0; i < grit; i++) {
          this._noiseBurst(t + 0.03 + Math.random() * 0.14, out, {
            dur: 0.04 + Math.random() * 0.06,
            freq: 2200 + Math.random() * 3200,
            q: 2,
            gain: 0.03 * vol,
            rate: 0.8 + Math.random() * 0.5,
          });
        }
        break;
      }
      case 'metal': {
        const base = 520 + Math.random() * 160;
        this._noiseBurst(t, out, { dur: 0.07, freq: 3400, q: 1.1, gain: 0.12 * vol, rate });
        this._toneBurst(t, out, { freq: base, end: base * 0.92, dur: 0.42, gain: 0.05 * vol, type: 'triangle' });
        this._toneBurst(t, out, { freq: base * 2.41, dur: 0.28, gain: 0.026 * vol });
        this._toneBurst(t, out, { freq: base * 3.77, dur: 0.18, gain: 0.016 * vol });
        this._toneBurst(t, out, { freq: 92, end: 55, dur: 0.13, gain: 0.055 * vol });
        break;
      }
      case 'water': {
        this._noiseBurst(t, out, { dur: 0.26, freq: 2600, q: 0.6, gain: 0.12 * vol, rate: rate * 1.2 });
        this._noiseBurst(t + 0.03, out, { dur: 0.18, freq: 900, q: 0.8, gain: 0.07 * vol, rate });
        this._toneBurst(t + 0.02, out, { freq: 620 + Math.random() * 180, end: 1500, dur: 0.09, gain: 0.018 * vol });
        this._toneBurst(t, out, { freq: 140, end: 70, dur: 0.12, gain: 0.05 * vol });
        break;
      }
      default: break;
    }
  }

  jumpSound(surface = 'concrete', volume = 0.5) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.002;
    const out = this._stepOut(0.12, 0);
    this._noiseBurst(t, out, { dur: 0.18, freq: 1200, q: 0.8, gain: 0.055 * volume, rate: 1.1 });
    this._toneBurst(t, out, { freq: 160, end: 88, dur: 0.14, gain: 0.04 * volume });
    if (surface === 'metal') this._toneBurst(t, out, { freq: 640, dur: 0.3, gain: 0.03 * volume, type: 'triangle' });
    if (surface === 'water') this._noiseBurst(t, out, { dur: 0.24, freq: 2400, q: 0.7, gain: 0.06 * volume });
    if (surface === 'sand' || surface === 'mud') this._noiseBurst(t, out, { dur: 0.2, freq: 700, gain: 0.055 * volume, rate: 0.8 });
  }

  landSound(surface = 'concrete', impact = 0.5) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.002;
    const out = this._stepOut(this._surfaceWet(surface), 0);
    const vol = 0.5 + impact * 0.65;
    this._toneBurst(t, out, { freq: 96, end: 40, dur: 0.26, gain: 0.15 * vol });
    this._noiseBurst(t, out, { dur: 0.16, freq: 700, q: 0.7, gain: 0.11 * vol, rate: 0.8 });
    this._surfaceStep(surface, t + 0.01, out, vol * 0.8, 1, 0.9);
  }

  setThreat(level) {
    this.threat = Math.max(0, Math.min(1, level));
  }

  /** Lower the score for dialogue, close movement and key effects. */
  duckMusic(amount = 0.7, seconds = 1.0) {
    this.duckAmount = Math.min(this.duckAmount, amount);
    this.duckUntil = Math.max(this.duckUntil, this.time + seconds);
  }

  _stepOut(reverb, pan) {
    const out = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan || 0));
      out.connect(panner).connect(this.sfxBus);
      if (reverb > 0) {
        const send = this.ctx.createGain();
        send.gain.value = reverb;
        panner.connect(send).connect(this.reverbSend);
      }
    } else {
      out.connect(this.sfxBus);
      if (reverb > 0) {
        const send = this.ctx.createGain();
        send.gain.value = reverb;
        out.connect(send).connect(this.reverbSend);
      }
    }
    return out;
  }

  _noiseBurst(t, out, { dur = 0.16, freq = 900, q = 1.2, type = 'bandpass', gain = 0.2, rate = 1, attack = 0.003 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.04);
  }

  _toneBurst(t, out, { freq = 200, end = 0, dur = 0.2, gain = 0.06, type = 'sine', attack = 0.003 } = {}) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (end) o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.04);
  }

  _makeImpulse(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.14 * w) / 1.14;
        d[i] = last * Math.pow(1 - i / len, 2.4);
      }
    }
    return buf;
  }

  _startHum() {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.003;
    this.humOsc = [];
    for (const [f, a] of [[60, 0.5], [120, 0.3], [180.4, 0.12]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(filter);
      o.start();
      this.humOsc.push(o);
    }
    filter.connect(gain).connect(this.ambienceBus);
    this.humGain = gain;
  }

  _distantMetal() {
    const t = this.ctx.currentTime;
    const out = this._stepOut(0.6, Math.random() * 1.6 - 0.8);
    const base = 300 + Math.random() * 380;
    this._noiseBurst(t, out, { dur: 0.5, freq: 900 + Math.random() * 800, q: 6, gain: 0.012, rate: 0.5 });
    this._toneBurst(t, out, { freq: base, dur: 0.9, gain: 0.007, type: 'triangle' });
  }

  _relayStatic() {
    const out = this._stepOut(0.3, Math.random() * 0.8 - 0.4);
    const t = this.ctx.currentTime;
    this._noiseBurst(t, out, { dur: 0.18, freq: 2400, q: 3, gain: 0.012, rate: 1.4 });
    this._toneBurst(t, out, { freq: 880, dur: 0.06, gain: 0.005, type: 'square' });
  }

  _distantGroan(threat) {
    const t = this.ctx.currentTime;
    const out = this._stepOut(0.75, Math.random() * 1.2 - 0.6);
    const f = 70 + Math.random() * 30;
    this._toneBurst(t, out, { freq: f, end: f * 0.8, dur: 1.6, gain: 0.01 + threat * 0.018, type: 'sawtooth' });
    this._noiseBurst(t, out, { dur: 1.4, freq: 300, q: 1.6, gain: 0.007 + threat * 0.01, rate: 0.5 });
  }

  update(dt, restoration = 0, playerPos = null) {
    if (!this.ready) return;
    this.time += dt;
    this.musicRestoration += (restoration - this.musicRestoration) * Math.min(1, dt * 0.5);

    // ---- music ducking ---------------------------------------------------
    const duckGoal = this.time < this.duckUntil ? this.duckAmount : 1;
    const moveGoal = this.time < this.moveDuckUntil ? 0.9 : 1;
    const goal = Math.min(duckGoal, moveGoal);
    this.duckLevel += (goal - this.duckLevel) * Math.min(1, dt * 4);
    if (this.musicBus) this.musicBus.gain.value = this.musicVolume * this.duckLevel;
    if (this.time >= this.duckUntil) this.duckAmount = 1;

    // ---- electrical hum: audible near powered equipment ------------------
    if (this.humGain) {
      let near = 0;
      if (playerPos) {
        for (const [x, z] of [[0, 0], [86, 0], [-72, 0], [0, 88], [0, -100]]) {
          const d = Math.hypot(playerPos.x - x, playerPos.z - z);
          near = Math.max(near, Math.max(0, 1 - d / 26));
        }
      }
      const humGoal = 0.003 + this.musicRestoration * 0.012 + near * 0.01;
      this.humGain.gain.value += (humGoal - this.humGain.gain.value) * Math.min(1, dt * 1.5);
    }

    // ---- sparse environmental life --------------------------------------
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 10 + Math.random() * 18;
      if (Math.random() < 0.55) this._distantMetal();
      else this._relayStatic();
    }

    // ---- distant threat: muffled groans and shifting weight -------------
    if (this.threat > 0.12) {
      this.threatTimer -= dt;
      if (this.threatTimer <= 0) {
        this.threatTimer = 5 + Math.random() * 8;
        this._distantGroan(this.threat);
      }
    } else {
      this.threatTimer = Math.min(this.threatTimer, 4);
    }

    // ---- original layered score ------------------------------------------
    if (this.music) this.music.update(dt);

    if (this.musicRestoration > 0.55) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 5 + Math.random() * 12;
        const base = 1800 + Math.random() * 1400;
        this._note(base, 0, 0.12, 'sine', 0.016, 0);
        this._note(base * 1.4, 0.13, 0.1, 'sine', 0.012, 0);
        if (Math.random() < 0.5) this._note(base * 1.15, 0.26, 0.09, 'sine', 0.01, 0);
      }
    }
    if (this.windGain) {
      this.windGain.gain.value = 0.15 - this.musicRestoration * 0.06;
    }
    if (this.waterGain) {
      this.waterGain.gain.value = 0.06 + Math.sin(this.time * 0.7) * 0.012;
    }
  }
}
