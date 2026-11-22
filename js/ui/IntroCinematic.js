import { INTRO_NARRATION, SPEAKERS } from '../story/Story.js';

const VIDEO_SRC = './assets/videos/restart_intro.mp4';
// Narration subtitle cues are authored in seconds against a ~55s reel; if the
// supplied video is longer or shorter the cue times are scaled to fit it.
// (beat.dur is in milliseconds — see the fallback reel — so it is converted.)
const NARRATION_BASE = Math.max(
  1,
  INTRO_NARRATION.reduce((end, beat) => Math.max(end, (beat.cue || 0) + (beat.dur || 0) / 1000), 0)
);
const FADE_MS = 520;

/**
 * Opening cinematic.
 *
 * Plays assets/videos/restart_intro.mp4 full-screen at its original aspect
 * ratio, with a loading indicator, a SKIP INTRO button, and a Play Cinematic
 * button when the browser blocks autoplay with sound.
 *
 * Resolves exactly once with 'ended' | 'skipped' | 'unavailable'. A missing or
 * undecodable file skips the cinematic instead of stalling the game.
 */
export class IntroCinematic {
  constructor({ audio, subtitles = true, onLine } = {}) {
    this.audio = audio;
    this.subtitles = subtitles;
    this.onLine = onLine;

    this.root = document.getElementById('intro');
    this.video = document.getElementById('intro-video');
    this.fallback = document.getElementById('intro-fallback');
    this.loadingEl = document.getElementById('intro-loading');
    this.loadingText = document.getElementById('intro-loading-text');
    this.playBtn = document.getElementById('btn-intro-play');
    this.subtitleEl = document.getElementById('intro-subtitle');
    this.subtitleText = document.getElementById('intro-subtitle-text');
    this.subtitleSpeaker = document.querySelector('#intro-subtitle .intro-speaker');
    this.progressFill = document.getElementById('intro-progress-fill');
    this.skipBtn = document.getElementById('btn-intro-skip');
    this.slideKicker = document.getElementById('intro-slide-kicker');
    this.slideTitle = document.getElementById('intro-slide-title');
    this.fallbackText = document.getElementById('intro-fallback-text');
    this.statusEl = document.getElementById('intro-status');

    this.playing = false;
    this.finishing = false;
    this.mode = 'video';
    this.result = 'ended';
    this.currentCue = -1;
    this.cueScale = 1;
    this.timers = [];
    this.poll = null;
    this.onDone = null;

    this._onKey = (e) => {
      if (!this.playing) return;
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        this.skip();
      }
    };
    this.skipBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.skip();
    });
    this.playBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._resumeFromGesture();
    });
  }

  // ---- small helpers ------------------------------------------------
  _later(fn, ms) {
    const id = setTimeout(fn, ms);
    this.timers.push(id);
    return id;
  }

  _clearTimers() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.length = 0;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  _setLoading(on, text) {
    if (this.loadingEl) this.loadingEl.classList.toggle('hidden', !on);
    if (text && this.loadingText) this.loadingText.textContent = text;
  }

  _status(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  // ---- playback -----------------------------------------------------
  play() {
    return new Promise((resolve) => {
      if (this.playing) {
        resolve('busy');
        return;
      }
      this.playing = true;
      this.finishing = false;
      this.result = 'ended';
      this.currentCue = -1;
      this.cueScale = 1;
      this.onDone = resolve;

      this.root?.classList.remove('hidden');
      this.root?.classList.remove('intro-leaving');
      document.body.classList.add('cinematic');
      window.addEventListener('keydown', this._onKey);

      this._setLoading(true, 'LOADING CINEMATIC…');
      this.skipBtn?.classList.add('hidden');
      this.playBtn?.classList.add('hidden');
      this.subtitleEl?.classList.add('hidden');
      this.fallback?.classList.add('hidden');
      if (this.progressFill) this.progressFill.style.width = '0%';
      this._status('SIGNAL ACQUIRED');

      this._armVideo();
    });
  }

  async _armVideo() {
    const video = this.video;
    if (!video) {
      this._unavailable();
      return;
    }
    this.mode = 'video';
    this.blocked = false;
    video.classList.remove('hidden');
    video.loop = false;
    video.muted = false;
    video.volume = 0.9;
    video.playsInline = true;
    video.onerror = () => this._unavailable();
    video.onended = () => this._finish('ended');

    const present = await this._probe();
    if (!this.playing) return;
    if (!present) {
      this._unavailable();
      return;
    }

    video.onloadedmetadata = () => {
      const d = video.duration;
      if (Number.isFinite(d) && d > 5) this.cueScale = d / NARRATION_BASE;
      this._setLoading(false);
      if (!this.blocked) this._status('NOW PLAYING');
    };

    try {
      video.src = VIDEO_SRC;
      video.load();
    } catch {
      this._unavailable();
      return;
    }

    // No watchdog here on purpose: a large cinematic can take a long time to
    // buffer while the 3D scene is initialising. Real failures arrive through
    // the error event or a rejected play() promise.
    this._attemptPlay();
  }

  /**
   * Some static servers answer missing .mp4 requests with an HTML page, which
   * the video element reports late. A HEAD probe lets us skip cleanly and fast.
   * Returns true when in doubt (file:// or odd servers) and lets the video
   * error path decide.
   */
  async _probe() {
    try {
      const res = await fetch(VIDEO_SRC, { method: 'HEAD' });
      if (res.ok) {
        const type = (res.headers.get('content-type') || '').toLowerCase();
        return !type.includes('text/html');
      }
      if (res.status === 404 || res.status === 410 || res.status === 403) return false;
      return true;
    } catch {
      return true;
    }
  }

  _attemptPlay() {
    const video = this.video;
    if (!video || !this.playing) return;
    let attempt;
    try {
      attempt = video.play();
    } catch {
      this._blocked();
      return;
    }
    if (attempt && typeof attempt.then === 'function') {
      attempt
        .then(() => this._onPlaying())
        .catch((err) => {
          const v = this.video;
          const unsupported = (err && err.name === 'NotSupportedError') || (v && v.error);
          if (unsupported) this._unavailable();
          else this._blocked();
        });
    } else {
      this._onPlaying();
    }
  }

  _onPlaying() {
    if (!this.playing) return;
    this.blocked = false;
    this._setLoading(false);
    this.statusEl?.classList.remove('hidden');
    this._status('NOW PLAYING');
    this.skipBtn?.classList.remove('hidden');
    this.playBtn?.classList.add('hidden');
    if (this.poll) clearInterval(this.poll);
    this.poll = setInterval(() => this._poll(), 100);
    this._poll();
  }

  /** Browser refused unmuted autoplay: wait for the player's gesture. */
  _blocked() {
    if (!this.playing) return;
    this.blocked = true;
    this._setLoading(false);
    const video = this.video;
    if (video) {
      try {
        video.pause();
      } catch {
        /* ignore */
      }
    }
    this._status('AUTOPLAY BLOCKED');
    this.skipBtn?.classList.remove('hidden');
    this.playBtn?.classList.remove('hidden');
  }

  /** Play Cinematic / tap-for-sound: user gesture allows audio. */
  _resumeFromGesture() {
    if (!this.playing) return;
    const video = this.video;
    if (!video) {
      this._unavailable();
      return;
    }
    this.playBtn?.classList.add('hidden');
    this._setLoading(true, 'STARTING TRANSMISSION…');
    this._status('AUDIO ENABLED');
    video.muted = false;
    video.volume = 0.9;
    let attempt;
    try {
      attempt = video.play();
    } catch {
      this._playMuted();
      return;
    }
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(() => this._onPlaying()).catch(() => this._playMuted());
    } else {
      this._onPlaying();
    }
  }

  /** Even a gesture failed to start with sound: continue muted, never stall. */
  _playMuted() {
    const video = this.video;
    if (!video) {
      this._unavailable();
      return;
    }
    video.muted = true;
    const attempt = video.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt
        .then(() => {
          this._onPlaying();
          this._status('PLAYING MUTED');
        })
        .catch(() => this._unavailable());
    } else {
      this._onPlaying();
      this._status('PLAYING MUTED');
    }
  }

  _poll() {
    const v = this.video;
    if (!v || !this.playing || this.mode !== 'video') return;
    const t = v.currentTime || 0;
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    if (this.progressFill) {
      this.progressFill.style.width = dur ? `${Math.min(100, (t / dur) * 100)}%` : '0%';
    }
    let cue = -1;
    for (let i = 0; i < INTRO_NARRATION.length; i++) {
      if (t >= (INTRO_NARRATION[i].cue || 0) * this.cueScale) cue = i;
    }
    if (cue !== this.currentCue) this._showCue(cue);
  }

  _showCue(index) {
    this.currentCue = index;
    if (!this.subtitles || !this.subtitleEl) {
      this.subtitleEl?.classList.add('hidden');
      return;
    }
    if (index < 0) {
      this.subtitleEl.classList.add('hidden');
      return;
    }
    const beat = INTRO_NARRATION[index];
    this.subtitleEl.classList.remove('hidden');
    if (this.subtitleSpeaker) this.subtitleSpeaker.textContent = SPEAKERS.NARRATOR.label;
    if (this.subtitleText) this.subtitleText.textContent = beat.line;
    this.onLine?.(beat);
  }

  // ---- failure / end ------------------------------------------------
  _unavailable() {
    if (!this.playing || this.finishing) return;
    this.mode = 'unavailable';
    this._clearTimers();
    if (this.video) {
      try {
        this.video.pause();
      } catch {
        /* ignore */
      }
      this.video.classList.add('hidden');
      this.video.onerror = null;
      this.video.onended = null;
    }
    this._setLoading(false);
    this.skipBtn?.classList.add('hidden');
    this.playBtn?.classList.add('hidden');
    this.subtitleEl?.classList.add('hidden');
    this._status('NO SIGNAL');
    this.fallback?.classList.remove('hidden');
    if (this.slideKicker) this.slideKicker.textContent = 'TRANSMISSION LOST';
    if (this.slideTitle) this.slideTitle.textContent = 'CINEMATIC UNAVAILABLE';
    if (this.fallbackText) {
      this.fallbackText.textContent =
        'The opening transmission could not be loaded. Continuing to the main menu.';
    }
    if (this.progressFill) this.progressFill.style.width = '100%';
    this._later(() => this._finish('unavailable'), 1800);
  }

  skip() {
    this._finish('skipped');
  }

  _finish(result = 'ended') {
    if (!this.playing || this.finishing) return;
    this.finishing = true;
    this.playing = false;
    this.result = result;
    this._clearTimers();
    window.removeEventListener('keydown', this._onKey);
    if (this.video) {
      try {
        this.video.pause();
      } catch {
        /* ignore */
      }
    }
    this.skipBtn?.classList.add('hidden');
    this.playBtn?.classList.add('hidden');
    this._setLoading(false);
    this.root?.classList.add('intro-leaving');
    document.body.classList.remove('cinematic');
    this._later(() => {
      this.root?.classList.add('hidden');
      this.root?.classList.remove('intro-leaving');
      this.done = true;
      const resolve = this.onDone;
      this.onDone = null;
      this.finishing = false;
      if (resolve) resolve(result);
    }, FADE_MS);
  }
}
