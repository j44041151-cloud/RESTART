import * as THREE from 'three';
import { FINAL_BROADCAST } from './Story.js';
import { clamp } from '../core/utils.js';

/**
 * The counter-signal ending.
 *
 * A staged, 9-beat cinematic. It never repairs the whole city: the Grid comes
 * back to a fraction of its old strength, a handful of windows warm up, people
 * stand and look at each other, and the rest stay asleep.
 */
export class EndingSequence {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.beats = [];
    this.subject = null;
    this.extra = [];
    this.finished = false;
  }

  start() {
    const g = this.game;
    g.ending = this;
    g.state = 'cinematic';
    g.player.setControl(false);
    g.input.exitLock();
    g.ui.setPrompt(null);
    g.ui.showHUD(false);
    g.ui.setLetterbox(true);
    g.ui.fade(false);
    g.ui.hideDialogue();
    g.cameraRig.startCinematic(new THREE.Vector3(0, 3, -84), {
      radius: 26, height: 12, speed: 0.075, lookHeight: 22,
    });
    g.audio.sfx('core');
    g.audio.setRestoration(0.2);

    // Darkness first: no ambient light, no window glow, low exposure.
    g.sky.setRestoration(0.02, true);
    g.city.setRestoration(0);
    g.renderer.toneMappingExposure = 0.95;

    const core = new THREE.Vector3(0, 2, -88);
    this.subject = g.zombies.nearestTo(core, 80);

    this.queue([
      { t: 0.6, fn: () => g.ui.subtitle('RELAY', 'Counter-signal leaving the Core. Every relay is holding.', 5200) },
      { t: 3.2, fn: () => g.ui.subtitle('RELAY', 'I am reading… nothing. Silence across every district.', 5000) },
      { t: 6.0, fn: () => this._still() },
      { t: 7.4, fn: () => g.ui.subtitle('RELAY', 'One of them stopped moving.', 4600) },
      { t: 11.0, fn: () => this._firstAwake() },
      { t: 12.4, fn: () => g.ui.subtitle('RELAY', 'No — not stopped. Listening.', 5200) },
      { t: 16.4, fn: () => this._recover() },
      { t: 17.8, fn: () => g.ui.subtitle('RELAY', 'It is spreading through the district lines. Slowly. Not all of them are coming back.', 7200) },
      { t: 23.0, fn: () => this._lights(0.18) },
      { t: 24.4, fn: () => g.ui.dialogue([{ speaker: 'GRID', text: FINAL_BROADCAST, ms: 11000 }]) },
      { t: 33.0, fn: () => this._survivors() },
      { t: 34.4, fn: () => g.ui.subtitle('RELAY', 'Faint lights. Windows. Someone is awake up there.', 6400) },
      { t: 39.5, fn: () => this._title() },
    ]);
  }

  queue(list) {
    this.beats = list.map((b) => ({ ...b, done: false }));
  }

  _still() {
    const z = this.subject;
    if (z) z.setStoryState('still');
    this.game.audio.sfx('zombieGrowl', { volume: 0.25, delay: 0.3 });
  }

  _firstAwake() {
    const z = this.subject;
    if (z) z.setStoryState('awake');
  }

  _recover() {
    const g = this.game;
    const list = g.zombies.calmAround(new THREE.Vector3(0, 0, -88), 90, 7, this.subject);
    this.extra = list;
    // A few never wake. The ending is a beginning, not a cure.
    for (const z of list.slice(-2)) z.setStoryState('still');
  }

  _lights(k) {
    const g = this.game;
    g.sky.setRestoration(k);
    g.city.setRestoration(clamp(k * 0.9, 0, 1));
    g.city.wakeLights(0.28);
    g.renderer.toneMappingExposure = 1.0;
    g.audio.setRestoration(0.35);
  }

  _survivors() {
    const g = this.game;
    g.city.wakeLights(0.4);
    g.sky.setRestoration(0.26);
    g.audio.setRestoration(0.45);
    // The awakened drift toward the plaza — a city finding its feet.
    for (const z of this.extra) z.walkTo(new THREE.Vector3(z.position.x * 0.4, 0, -74));
  }

  _title() {
    const g = this.game;
    g.city.wakeLights(0.55);
    g.sky.setRestoration(0.32);
    g.missions.completeObjective('signal');
    g.cameraRig.stopCinematic();
    g.ui.setLetterbox(false);
    g.ui.showEnding({
      energy: g.missions.energy,
      energyMax: g.missions.energyMax,
      sparks: g.missions.sparks,
      time: g.playTime,
    });
    g.state = 'ending';
    g.completed = true;
    this.finished = true;
    g.save();
  }

  update(dt) {
    if (this.finished) return;
    this.t += dt;
    for (const b of this.beats) {
      if (!b.done && this.t >= b.t) {
        b.done = true;
        try {
          b.fn();
        } catch (err) {
          this.game.errors.push(String(err));
        }
      }
    }
    // Keep the camera breathing even during the long broadcast.
    if (this.t > 12) {
      const c = this.game.cameraRig.cinematic;
      if (c) c.height = 12 + Math.sin(this.t * 0.25) * 1.6;
    }
  }
}
