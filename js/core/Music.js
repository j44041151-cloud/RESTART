/**
 * MusicDirector — the original procedural score for RE:START.
 *
 * Everything here is synthesised at runtime with WebAudio; no files, no
 * samples, no third-party music. The score is built from six independently
 * faded stems so moods can crossfade instead of restarting:
 *
 *   amb      cold low drones and distant signal tones (loneliness)
 *   tension  slow sub pulse + dissonant unease (suspicion, danger)
 *   threat   driving percussion + pulsing bass (active chase / attack)
 *   hope     warm major pads that grow with restoration
 *   melody   a simple, restrained melodic line (late game / ending)
 *   relief   a one-shot warm swell after danger or a restored district
 *
 * One director instance lives inside AudioEngine. It never schedules the same
 * stem twice, keeps its own timers, and disposes all voices cleanly.
 */

export const MUSIC_STATES = Object.freeze({
  SILENT: 'silent',
  MENU: 'menu',
  INTRO: 'intro',
  EXPLORATION: 'exploration',
  DANGER: 'danger',
  THREAT: 'threat',
  RELIEF: 'relief',
  HOPE: 'hope',
  ENDING: 'ending',
});

const STATES = Object.values(MUSIC_STATES);
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const rand = (a, b) => a + Math.random() * (b - a);

// A minor for the dead city; A major / F#m / D / E for the rebuilding.
const AMBIENT_ROOTS = [55, 82.41, 110, 130.81];
const HOPE_CHORDS = [
  [110, 164.81, 220, 277.18], // A major
  [92.5, 138.59, 185, 233.08], // F# minor
  [73.42, 110, 146.83, 185], // D major
  [82.41, 123.47, 164.81, 207.65], // E major
];
const MELODY_LINE = [659.25, 554.37, 493.88, 440, 493.88, 554.37];

export class MusicDirector {
  constructor(ctx, destination, noiseBuffer) {
    this.ctx = ctx;
    this.destination = destination;
    this.noiseBuffer = noiseBuffer;

    // --- state -----------------------------------------------------
    this.state = MUSIC_STATES.MENU;
    this.danger = 0;
    this.urgent = false;
    this.restoration = 0;
    this.paused = false;
    this.reliefUntil = 0;
    this.time = 0;

    // --- scheduling ------------------------------------------------
    this.timers = { amb: 0, tension: 0, threat: 0, hope: 0, melody: 0 };
    this.hopeChord = 0;
    this.melodyStep = 0;
    this.threatStep = 0;
    this.voices = new Set();
    this.disposed = false;

    this.gains = {};
    for (const name of ['amb', 'tension', 'threat', 'hope', 'melody', 'relief']) {
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.connect(this.destination);
      this.gains[name] = g;
    }
  }

  // ------------------------------------------------------------------
  // Public controls (the only ways the game changes the score)
  // ------------------------------------------------------------------

  setState(name) {
    if (!STATES.includes(name)) return;
    this.state = name;
  }

  /** 0 = calm, 1 = a Hollowed is almost on top of the player. */
  setDanger(level) {
    this.danger = clamp01(level);
  }

  /**
   * True only while a real chase / attack is happening. Ordinary walking near
   * a distant zombie raises danger, never the urgent layer.
   */
  setUrgent(on) {
    this.urgent = !!on;
  }

  setRestoration(t) {
    this.restoration = clamp01(t);
  }

  setPaused(on) {
    this.paused = !!on;
  }

  /** A short, earned warm swell: district restored, checkpoint after death. */
  triggerRelief(seconds = 9) {
    this.reliefUntil = Math.max(this.reliefUntil, this.time + seconds);
    if (this.ctx.state !== 'running') return;
    // One swell per trigger so repeated calls cannot stack copies.
    AMBIENT_ROOTS.concat([220, 277.18]).forEach((f, i) => {
      this._voice('relief', f, {
        dur: 9,
        type: 'triangle',
        gain: 0.05 - i * 0.005,
        attack: 2.6,
        filter: 1500,
      });
    });
    this._voice('relief', 880, { dur: 3.6, type: 'sine', gain: 0.013, attack: 0.5, filter: 3200 });
  }

  // ------------------------------------------------------------------
  // Mood resolution + gain crossfades
  // ------------------------------------------------------------------

  /** Danger and chases escalate exploration on their own; explicit moods win. */
  _effectiveState() {
    if (this.state !== MUSIC_STATES.EXPLORATION && this.state !== MUSIC_STATES.DANGER) return this.state;
    if (this.urgent) return MUSIC_STATES.THREAT;
    if (this.danger >= 0.42) return MUSIC_STATES.DANGER;
    return MUSIC_STATES.EXPLORATION;
  }

  _targetsFor(state) {
    const rest = this.restoration;
    switch (state) {
      case MUSIC_STATES.MENU:
        // Isolated and uneasy: low bed, almost no movement, no melody.
        return { amb: 0.55, tension: 0.06, threat: 0, hope: 0, melody: 0 };
      case MUSIC_STATES.INTRO:
        return { amb: 0.6, tension: 0.12, threat: 0, hope: 0, melody: 0 };
      case MUSIC_STATES.DANGER:
        return { amb: 0.42, tension: 0.5 + this.danger * 0.3, threat: 0, hope: rest * 0.15, melody: 0 };
      case MUSIC_STATES.THREAT:
        return { amb: 0.28, tension: 0.62, threat: 1, hope: 0, melody: 0 };
      case MUSIC_STATES.RELIEF:
        return { amb: 0.45, tension: 0.05, threat: 0, hope: 0.5 + rest * 0.2, melody: 0.25 };
      case MUSIC_STATES.HOPE:
        return { amb: 0.42, tension: 0.05, threat: 0, hope: 0.75, melody: 1 };
      case MUSIC_STATES.ENDING:
        return { amb: 0.5, tension: 0.03, threat: 0, hope: 0.9, melody: 0.95 };
      case MUSIC_STATES.SILENT:
        return { amb: 0, tension: 0, threat: 0, hope: 0, melody: 0 };
      case MUSIC_STATES.EXPLORATION:
      default:
        return {
          amb: 0.5,
          tension: 0.06 + this.danger * 0.5,
          threat: 0,
          hope: rest * 0.4,
          melody: Math.max(0, rest - 0.5) * 1.6,
        };
    }
  }

  _ramp(param, value, seconds) {
    const t = this.ctx.currentTime;
    param.setTargetAtTime(Math.max(0.0001, value), t, Math.max(0.08, seconds / 3));
  }

  update(dt) {
    if (this.disposed) return;
    this.time += dt;
    const state = this._effectiveState();
    const target = this._targetsFor(state);
    const relief = this.time < this.reliefUntil;
    // Paused: everything bows out gently, nothing is torn down.
    const factor = this.paused ? 0.3 : 1;

    this._ramp(this.gains.amb.gain, target.amb * factor, 2.4);
    this._ramp(this.gains.tension.gain, target.tension * factor * (relief ? 0.4 : 1), 1.8);
    this._ramp(this.gains.threat.gain, target.threat * factor, state === MUSIC_STATES.THREAT ? 1.1 : 1.8);
    this._ramp(this.gains.hope.gain, target.hope * factor, 3);
    this._ramp(this.gains.melody.gain, target.melody * factor, 3.4);
    this._ramp(this.gains.relief.gain, relief ? factor : 0, relief ? 2.2 : 3.4);

    if (this.paused || state === MUSIC_STATES.SILENT) return;
    if (this.ctx.state !== 'running') return;

    this._scheduleAmbient(dt);
    if (this.gains.tension.gain.value > 0.015) this._scheduleTension(dt);
    if (this.gains.threat.gain.value > 0.02) this._scheduleThreat(dt);
    if (this.gains.hope.gain.value > 0.015) this._scheduleHope(dt);
    if (this.gains.melody.gain.value > 0.02) this._scheduleMelody(dt);
  }

  // ------------------------------------------------------------------
  // Stems
  // ------------------------------------------------------------------

  _scheduleAmbient(dt) {
    this.timers.amb -= dt;
    if (this.timers.amb > 0) return;
    this.timers.amb = rand(8.5, 12.5);
    AMBIENT_ROOTS.forEach((f, i) => {
      this._voice('amb', f, {
        dur: rand(11, 15),
        type: i === 0 ? 'sine' : 'triangle',
        gain: 0.05 - i * 0.006,
        attack: rand(2.5, 4.5),
        filter: 520,
      });
      // slight detune keeps the bed moving without sounding like a loop
      this._voice('amb', f * 1.004, {
        dur: rand(10, 14),
        type: 'sine',
        gain: 0.013,
        attack: 3.5,
        filter: 900,
      });
    });
    if (Math.random() < 0.6) {
      const tone = [880, 987.77, 1174.66][Math.floor(Math.random() * 3)];
      this._voice('amb', tone, { dur: 3.4, type: 'sine', gain: 0.011, attack: 0.05, filter: 2400 });
    }
    if (Math.random() < 0.45) {
      this._noise('amb', { dur: 5.5, freq: 380, q: 0.6, gain: 0.026, attack: 2.4 });
    }
  }

  _scheduleTension(dt) {
    this.timers.tension -= dt;
    if (this.timers.tension > 0) return;
    this.timers.tension = rand(2.5, 3.3) - this.danger * 0.6;
    // slow heartbeat under the ambience
    this._voice('tension', 55, { dur: 1.1, gain: 0.1, attack: 0.02, filter: 160, slide: 42 });
    // tritone-ish unease, only really audible when danger is up
    this._voice('tension', 58.27, { dur: 1.8, gain: 0.03, attack: 0.4, filter: 300 });
    if (this.danger > 0.5) this._noise('tension', { dur: 1.8, freq: 240, q: 0.9, gain: 0.018, attack: 0.5 });
  }

  _scheduleThreat(dt) {
    this.timers.threat -= dt;
    if (this.timers.threat > 0) return;
    // 128 BPM, 8th notes — urgent but readable, never a wall of noise
    this.timers.threat = 60 / 128 / 2;
    const step = this.threatStep++;
    if (step % 8 === 0 || step % 8 === 6) {
      this._voice('threat', 96, { dur: 0.3, gain: 0.15, attack: 0.004, slide: 38 });
    }
    if (step % 8 === 4) this._noise('threat', { dur: 0.16, freq: 1900, q: 1.1, gain: 0.08, attack: 0.004 });
    this._noise('threat', { dur: 0.05, freq: 6200, q: 1.6, gain: 0.022, attack: 0.002 });
    // pulsing low synth ostinato
    const bass = step % 16 < 8 ? 55 : 65.41;
    this._voice('threat', bass, { dur: 0.24, type: 'sawtooth', gain: 0.055, attack: 0.01, filter: 320 });
    if (step % 32 === 0) {
      this._voice('threat', 220, { dur: 0.9, type: 'triangle', gain: 0.03, attack: 0.05, filter: 1200 });
    }
  }

  _scheduleHope(dt) {
    this.timers.hope -= dt;
    if (this.timers.hope > 0) return;
    this.timers.hope = rand(7, 8.5);
    const chord = HOPE_CHORDS[this.hopeChord++ % HOPE_CHORDS.length];
    chord.forEach((f, i) => {
      this._voice('hope', f, {
        dur: rand(7.5, 9),
        type: 'triangle',
        gain: 0.028 + i * 0.003,
        attack: 2.2,
        filter: 1200,
      });
    });
    this._voice('hope', chord[2] * 2, { dur: 6, type: 'sine', gain: 0.011, attack: 1.5, filter: 3000 });
  }

  _scheduleMelody(dt) {
    this.timers.melody -= dt;
    if (this.timers.melody > 0) return;
    this.timers.melody = rand(3.6, 5.2);
    const f = MELODY_LINE[this.melodyStep++ % MELODY_LINE.length];
    this._voice('melody', f, { dur: 2.6, type: 'sine', gain: 0.045, attack: 0.35, filter: 2600 });
    if (this.melodyStep % 4 === 0) {
      this._voice('melody', f / 2, { dur: 3.2, type: 'triangle', gain: 0.018, attack: 0.8, filter: 1200 });
    }
  }

  // ------------------------------------------------------------------
  // Voice helpers — every node stops itself and drops out of the voice set.
  // ------------------------------------------------------------------

  _voice(layer, freq, { dur = 4, type = 'sine', gain = 0.05, attack = 0.4, filter = 0, slide = 0 } = {}) {
    const bus = this.gains[layer];
    if (!bus || this.ctx.state !== 'running') return null;
    const t = this.ctx.currentTime + 0.01;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur * 0.65);
    let node = osc;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      osc.connect(f);
      node = f;
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.max(0.02, attack));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.02);
    node.connect(g).connect(bus);
    const voice = { osc, gain: g };
    this.voices.add(voice);
    osc.onended = () => {
      this.voices.delete(voice);
      try {
        g.disconnect();
      } catch {
        /* already gone */
      }
    };
    osc.start(t);
    osc.stop(t + dur + 0.1);
    return voice;
  }

  _noise(layer, { dur = 0.2, freq = 2000, q = 1, gain = 0.05, attack = 0.005 } = {}) {
    const bus = this.gains[layer];
    if (!bus || !this.noiseBuffer || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.01;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Stop every scheduled voice and tear the stem buses down. */
  dispose() {
    this.disposed = true;
    for (const voice of this.voices) {
      try {
        voice.osc.stop();
      } catch {
        /* already stopped */
      }
      try {
        voice.gain.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.voices.clear();
    for (const g of Object.values(this.gains)) {
      try {
        g.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.timers = { amb: 0, tension: 0, threat: 0, hope: 0, melody: 0 };
  }
}
