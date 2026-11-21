import { INTRO_NARRATION, SPEAKERS } from '../story/Story.js';

const VIDEO_SRC = './assets/videos/restart_intro.mp4';

/**
 * Opening cinematic.
 *
 * Plays assets/videos/restart_intro.mp4 when it exists (fullscreen, narration
 * subtitles, skip). If the file is missing or cannot decode, the same narration
 * is presented as a styled in-engine fallback reel — never a fake video file.
 *
 * Resolves exactly once, whether it played to the end, was skipped, or fell back.
 */
export class IntroCinematic {
  constructor({ audio, subtitles = true, onLine } = {}) {
    this.audio = audio;
    this.subtitles = subtitles;
    this.onLine = onLine;
    this.root = document.getElementById('intro');
    this.video = document.getElementById('intro-video');
    this.fallback = document.getElementById('intro-fallback');
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
    this.mode = 'video';
    this.done = false;
    this.currentCue = -1;
    this.timers = [];
    this.reelTimer = null;
    this.videoPoll = null;

    this._onKey = (e) => {
      if (!this.playing) return;
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.skip();
      }
    };
    this.skipBtn?.addEventListener('click', () => this.skip());
  }

  _later(fn, ms) {
    const id = setTimeout(fn, ms);
    this.timers.push(id);
    return id;
  }

  _clearTimers() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.length = 0;
    if (this.reelTimer) clearInterval(this.reelTimer);
    this.reelTimer = null;
    if (this.videoPoll) clearInterval(this.videoPoll);
    this.videoPoll = null;
  }

  play() {
    return new Promise((resolve) => {
      if (this.playing || this.done) {
        resolve();
        return;
      }
      this.playing = true;
      this.done = false;
      this.onDone = resolve;
      this.root?.classList.remove('hidden');
      this.root?.classList.add('playing');
      document.body.classList.add('cinematic');
      window.addEventListener('keydown', this._onKey);
      this.audio?.sfx('intro');
      if (this.statusEl) this.statusEl.textContent = 'SIGNAL ACQUIRED';

      const video = this.video;
      if (!video) {
        this._startFallback(0);
        return;
      }
      this.mode = 'video';
      this.fallback?.classList.add('hidden');
      video.classList.remove('hidden');
      video.loop = false;
      video.muted = false;
      video.volume = 0.85;

      let settled = false;
      const fallback = (from) => {
        if (settled || !this.playing) return;
        settled = true;
        this._startFallback(from || 0);
      };
      video.onerror = () => fallback(0);
      video.onloadedmetadata = () => {
        if (this.statusEl) this.statusEl.textContent = 'NOW PLAYING · FULLSCREEN';
      };
      video.onended = () => this._finish();
      video.onplay = () => {
        if (this.videoPoll) clearInterval(this.videoPoll);
        this.videoPoll = setInterval(() => this._pollVideo(), 120);
      };

      try {
        video.src = VIDEO_SRC;
        video.load();
      } catch {
        fallback(0);
        return;
      }

      // If the file is absent the error event may be silent for a 404 on some
      // servers; also give up waiting if metadata never arrives.
      this._later(() => {
        if (settled) return;
        if (!video.readyState || video.error) fallback(0);
      }, 1500);

      const attempt = video.play();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(() => {
          // Autoplay refused: show the fallback reel rather than a frozen frame.
          fallback(0);
        });
      }
    });
  }

  _pollVideo() {
    const v = this.video;
    if (!v || !this.playing || this.mode !== 'video') return;
    const t = v.currentTime || 0;
    const dur = v.duration || 58;
    if (this.progressFill) this.progressFill.style.width = `${Math.min(100, (t / dur) * 100)}%`;
    let cue = -1;
    for (let i = 0; i < INTRO_NARRATION.length; i++) {
      if (t >= INTRO_NARRATION[i].cue) cue = i;
    }
    if (cue !== this.currentCue) this._showCue(cue);
  }

  _showCue(index) {
    this.currentCue = index;
    if (!this.subtitles || !this.subtitleEl) {
      if (this.subtitleEl) this.subtitleEl.classList.add('hidden');
      return;
    }
    if (index < 0) {
      this.subtitleEl.classList.add('hidden');
      return;
    }
    const beat = INTRO_NARRATION[index];
    this.subtitleEl.classList.remove('hidden');
    this.subtitleSpeaker.textContent = SPEAKERS.NARRATOR.label;
    this.subtitleText.textContent = beat.line;
    this.onLine?.(beat);
    this.audio?.sfx('relayVoice', { volume: 0.35 });
  }

  _startFallback(fromIndex) {
    this.mode = 'fallback';
    this.currentCue = -1;
    if (this.video) {
      this.video.pause();
      this.video.classList.add('hidden');
      this.video.onerror = null;
      this.video.onended = null;
    }
    if (this.videoPoll) {
      clearInterval(this.videoPoll);
      this.videoPoll = null;
    }
    this.fallback?.classList.remove('hidden');
    if (this.subtitleEl) this.subtitleEl.classList.add('hidden');
    if (this.statusEl) this.statusEl.textContent = 'ARCHIVE REEL · SIGNAL RECONSTRUCTED';
    const beats = INTRO_NARRATION;
    let index = Math.max(0, fromIndex);
    const total = beats.reduce((a, b) => a + b.dur, 0);
    let elapsed = beats.slice(0, index).reduce((a, b) => a + b.dur, 0);

    const show = () => {
      if (!this.playing) return;
      if (index >= beats.length) {
        this._finish();
        return;
      }
      const beat = beats[index];
      if (this.slideKicker) this.slideKicker.textContent = beat.kicker;
      if (this.slideTitle) this.slideTitle.textContent = beat.kicker.split('·')[0].trim();
      if (this.fallbackText) this.fallbackText.textContent = beat.line;
      if (this.subtitleEl) {
        this.subtitleEl.classList.remove('hidden');
        this.subtitleSpeaker.textContent = SPEAKERS.NARRATOR.label;
        this.subtitleText.textContent = beat.line;
      }
      if (this.progressFill) this.progressFill.style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
      this.onLine?.(beat);
      this.audio?.sfx('relayVoice', { volume: 0.28 });
      index += 1;
      elapsed += beat.dur;
      this._later(show, beat.dur);
    };
    show();
  }

  skip() {
    if (this.playing) this._finish();
  }

  _finish() {
    if (!this.playing) return;
    this.playing = false;
    this._clearTimers();
    window.removeEventListener('keydown', this._onKey);
    if (this.video) {
      try {
        this.video.pause();
      } catch {
        /* ignore */
      }
    }
    this.root?.classList.add('hidden');
    this.root?.classList.remove('playing');
    document.body.classList.remove('cinematic');
    const resolve = this.onDone;
    this.onDone = null;
    this.done = true;
    if (resolve) resolve();
  }
}
