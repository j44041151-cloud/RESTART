/**
 * INSIGHT SPARKS
 * The signature mechanic: when the player struggles, RELAY offers a hint
 * plus a temporary assist. Progress is never removed - setbacks only add
 * knowledge. Sparks are the game's expression of "bounce back".
 */
export class InsightSystem {
  constructor({ ui, audio, missions, player, vfx }) {
    this.ui = ui;
    this.audio = audio;
    this.missions = missions;
    this.player = player;
    this.vfx = vfx;
    this.challenges = new Map();
    this.readyId = null;
    this.activeId = null;
    this.assistTime = 0;
    this.assistDuration = 26;
    this.auraTimer = 0;
    this.timeSinceStart = 0;
    this.lastObjectiveTime = 0;
    this.genericOffered = false;
  }

  register(id, { hint, assistLabel = 'Insight Surge' }) {
    this.challenges.set(id, {
      id, hint, assistLabel,
      struggles: 0,
      activeTime: 0,
      active: false,
      offered: false,
      used: false,
      cooldown: 0,
      required: 2,
    });
  }

  setActive(id, active) {
    const c = this.challenges.get(id);
    if (!c) return;
    c.active = active;
    if (!active) c.activeTime = 0;
  }

  /** A fall, a wrong answer, a long detour - setbacks feed insight. */
  struggle(id, amount = 1) {
    const c = this.challenges.get(id);
    if (!c) return;
    if (c.used || this.readyId) {
      // Still track, but do not stack prompts.
      c.struggles += amount;
      return;
    }
    c.struggles += amount;
    if (c.struggles >= c.required) this._offer(c);
  }

  _offer(c) {
    if (this.readyId || c.used) return;
    c.offered = true;
    this.readyId = c.id;
    this.ui.showInsight(true, c.hint);
    this.audio.sfx('sparkOffer');
  }

  /** Called by the H key. */
  activate() {
    if (!this.readyId) {
      // Even without an offer, give a gentle nudge after repeated presses?
      this.ui.toast('NO INSIGHT SPARK READY — KEEP EXPLORING');
      return false;
    }
    const c = this.challenges.get(this.readyId);
    if (!c) return false;
    c.used = true;
    c.offered = false;
    this.readyId = null;
    this.activeId = c.id;
    this.assistTime = this.assistDuration;
    this.missions.addSpark(1);
    this.ui.showInsight(false);
    this.ui.toast(`INSIGHT SPARK — ${c.assistLabel.toUpperCase()}`, 'cyan');
    this.ui.subtitle('RELAY', c.hint, 9000);
    this.audio.sfx('spark');
    this.player.setSurge(true);
    this.ui.setSurge(true, 1);
    this.vfx.fountain(this.player.position.clone().setY(this.player.position.y + 0.2), {
      count: 40, color: 0x5ff2e0, speed: 7, life: 1.4, size: 0.4,
    });
    return true;
  }

  get isSurged() {
    return this.assistTime > 0;
  }

  update(dt, missionHint) {
    this.timeSinceStart += dt;

    for (const c of this.challenges.values()) {
      if (c.active && !c.used) {
        c.activeTime += dt;
        // 40 seconds of visible struggle is enough; hint arrives.
        if (c.activeTime > 40 && !c.offered) this._offer(c);
      }
    }

    if (this.assistTime > 0) {
      this.assistTime -= dt;
      this.ui.setSurge(true, this.assistTime / this.assistDuration);
      this.auraTimer += dt;
      if (this.auraTimer > 0.12) {
        this.auraTimer = 0;
        const p = this.player.position;
        this.vfx.burst({ x: p.x, y: p.y + 0.5, z: p.z }, {
          count: 2, color: 0x5ff2e0, speed: 1.4, life: 0.9, size: 0.28, gravity: 0.4, up: 1,
        });
      }
      if (this.assistTime <= 0) {
        this.assistTime = 0;
        this.player.setSurge(false);
        this.ui.setSurge(false, 0);
        this.ui.toast('INSIGHT SURGE FADED — THE SKILL REMAINS', 'cyan');
      }
    }

    // Generic safety net: if the player has been in one mission a long time
    // and nothing is offered, RELAY speaks up once per mission.
    if (!this.readyId && !this.isSurged && missionHint && this.timeSinceStart - this.lastObjectiveTime > 150 && !this.genericOffered) {
      this.genericOffered = true;
      this.readyId = '__generic__';
      this.challenges.set('__generic__', {
        id: '__generic__', hint: missionHint, assistLabel: 'Insight Surge',
        struggles: 0, activeTime: 0, active: false, offered: true, used: false,
      });
      this.ui.showInsight(true, missionHint);
      this.audio.sfx('sparkOffer');
    }
  }

  /** Reset the "stuck" clock whenever an objective is completed. */
  noteProgress() {
    this.lastObjectiveTime = this.timeSinceStart;
    this.genericOffered = false;
  }

  toJSON() {
    return {
      sparksReady: this.readyId,
      used: [...this.challenges.values()].filter((c) => c.used).map((c) => c.id),
    };
  }
}
