import * as THREE from 'three';
import { getGlowTexture } from '../world/Textures.js';
import { clamp, rand, segmentBox } from '../core/utils.js';
import { createPistol } from './GunModel.js';

/**
 * Vitals and the Restorer's two answers to the infected:
 *
 *  - a scavenged pistol, fed by ammo crates hidden along the routes;
 *  - bare hands, which never run out.
 *
 * Holding the right mouse button raises the pistol over the shoulder, slows the
 * look, tightens the spread and lights the reticle up when an infected is under
 * it. Left click fires while held, or swings a punch when the magazine is dry.
 * Going down returns the player to the last checkpoint with nothing lost.
 */

const MAX_HEALTH = 100;
const REGEN_DELAY = 7;
const REGEN_RATE = 5;
const INVULN = 0.55;
const FIRE_RATE = 0.19;
const PUNCH_RATE = 0.5;
const BULLET_DAMAGE = 34;
const HEADSHOT_MULT = 2.6;
const PUNCH_DAMAGE = 26;
const AMMO_MAX = 60;
const AMMO_BOX = 10;
const GUN_AMMO = 15;
const PICKUP_RADIUS = 2.2;

// gun caches: plaza, solar walkway and water station
const GUNS = [
  { id: 'gun_plaza', position: [4.5, 1.15, 26] },
  { id: 'gun_solar', position: [37, 3.25, 0] },
  { id: 'gun_water', position: [-56, 1.15, 0] },
];

// ammo along every route
const AMMO = [
  { id: 'ammo_plaza_w', position: [-8.5, 1.1, 13] },
  { id: 'ammo_plaza_e', position: [13.5, 1.1, 9] },
  { id: 'ammo_north', position: [0, 1.1, -36] },
  { id: 'ammo_east', position: [30, 1.1, 3] },
  { id: 'ammo_west', position: [-32, 1.1, -3] },
  { id: 'ammo_solar', position: [46, 3.15, 0] },
  { id: 'ammo_deck', position: [86, 4.2, 0] },
  { id: 'ammo_south', position: [-4, 1.1, 52] },
  { id: 'ammo_core', position: [0, 1.1, -66] },
  { id: 'ammo_water', position: [-66, 1.1, 14] },
];

let sharedMats = null;
function mats() {
  if (sharedMats) return sharedMats;
  sharedMats = {
    crate: new THREE.MeshStandardMaterial({ color: 0x3e4434, roughness: 0.78, metalness: 0.3 }),
    crateLid: new THREE.MeshStandardMaterial({
      color: 0x2a2e26, emissive: 0xffb347, emissiveIntensity: 0.9, roughness: 0.55, metalness: 0.3,
    }),
    caseShell: new THREE.MeshStandardMaterial({ color: 0x2c3237, roughness: 0.52, metalness: 0.72 }),
    caseRim: new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.72, metalness: 0.5 }),
    foam: new THREE.MeshStandardMaterial({ color: 0x1b2024, roughness: 0.98, metalness: 0.02 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd8a24a, roughness: 0.3, metalness: 0.9 }),
  };
  return sharedMats;
}

const labelCache = new Map();
function labelTexture(text, color) {
  const key = text + '|' + color;
  if (labelCache.has(key)) return labelCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px Consolas, ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = '#f4fbfc';
  ctx.fillText(text, 128, 28);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(54, 51);
  ctx.lineTo(202, 51);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  labelCache.set(key, tex);
  return tex;
}

/** A glow-lit world pickup: an open pistol cache, or an ammo can. */
class CombatPickup {
  constructor({ scene, position, kind, color, onCollect, transient = false }) {
    this.kind = kind;
    this.color = color;
    this.onCollect = onCollect;
    this.transient = transient;
    this.collected = false;
    this.time = rand(0, 10);
    this.phase = rand(0, Math.PI * 2);

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.scale.setScalar(transient ? 0.72 : 1);
    scene.add(this.group);
    const M = mats();

    if (kind === 'pistol') {
      // A hard case, hinged open, with the pistol bedded in foam.
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.09, 0.38), M.caseShell);
      base.position.y = 0.045;
      this.group.add(base);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.4), M.caseRim);
      rim.position.y = 0.1;
      this.group.add(rim);
      const foam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.035, 0.3), M.foam);
      foam.position.y = 0.115;
      this.group.add(foam);

      const pistol = createPistol({ scale: 1.1 });
      pistol.position.set(0, 0.15, 0.02);
      pistol.rotation.set(0, 0.1, Math.PI / 2);
      this.group.add(pistol);

      const hinge = new THREE.Group();
      hinge.position.set(0, 0.1, -0.19);
      hinge.rotation.x = -1.22;
      this.group.add(hinge);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.035, 0.4), M.caseShell);
      lid.position.set(0, 0, 0.2);
      hinge.add(lid);
      const lidPad = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.32), M.foam);
      lidPad.position.set(0, -0.026, 0.2);
      hinge.add(lidPad);
      // latches + amber inlay so the case reads at a distance
      for (const x of [-0.22, 0.22]) {
        const latch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.05), M.brass);
        latch.position.set(x, 0.125, 0.17);
        this.group.add(latch);
      }
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.012, 0.02),
        new THREE.MeshBasicMaterial({ color, toneMapped: false })
      );
      strip.position.set(0, 0.13, 0.2);
      this.group.add(strip);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.24, 0.28), M.crate);
      box.position.y = 0.12;
      this.group.add(box);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 0.3), M.crateLid);
      lid.position.y = 0.255;
      this.group.add(lid);
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.05, 0.02),
        new THREE.MeshBasicMaterial({ color, toneMapped: false })
      );
      band.position.set(0, 0.13, 0.145);
      this.group.add(band);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), M.caseRim);
      handle.position.set(0, 0.28, 0);
      handle.rotation.y = Math.PI / 2;
      this.group.add(handle);
      for (const x of [-0.1, 0.1]) {
        const round = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.12, 6), M.brass);
        round.position.set(x, 0.305, 0);
        this.group.add(round);
      }
    }

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(), color, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    halo.scale.setScalar(kind === 'pistol' ? 2.4 : 1.6);
    halo.position.y = kind === 'pistol' ? 0.35 : 0.2;
    this.group.add(halo);
    this.halo = halo;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(kind === 'pistol' ? 0.56 : 0.38, 0.016, 6, 32),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.015;
    this.group.add(ring);
    this.ring = ring;

    if (!transient) {
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.2, 2.6, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        })
      );
      beacon.position.y = 1.25;
      this.group.add(beacon);
      this.beacon = beacon;
    }

    // Floating label so the cache is readable from across the plaza.
    if (!transient) {
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: labelTexture(kind === 'pistol' ? 'PISTOL' : 'AMMO', '#' + color.toString(16).padStart(6, '0')),
          transparent: true, depthWrite: false, toneMapped: false,
        })
      );
      label.scale.set(1.5, 0.375, 1);
      label.position.y = kind === 'pistol' ? 1.25 : 1.0;
      this.group.add(label);
      this.label = label;
      this.labelBaseY = label.position.y;
    }

    // Only the pistol caches carry a real light; ammo crates rely on their
    // emissive trim and halo so the scene's light count stays sane.
    if (kind === 'pistol') {
      this.light = new THREE.PointLight(color, 2.6, 7, 2);
      this.light.position.y = 0.5;
      this.group.add(this.light);
    }
    this.baseY = position.y;
  }

  collect(silent = false) {
    if (this.collected) return false;
    this.collected = true;
    this.group.visible = false;
    if (!silent && this.onCollect) this.onCollect(this);
    return true;
  }

  setCollected(collected) {
    this.collected = collected;
    this.group.visible = !collected;
  }

  dispose() {
    this.group.parent && this.group.parent.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }

  update(dt, playerPos) {
    if (this.collected) return;
    this.time += dt;
    this.ring.rotation.z += dt * 0.7;
    this.ring.scale.setScalar(1 + Math.sin(this.time * 2.4) * 0.08);
    this.halo.material.opacity = 0.55 + Math.sin(this.time * 2.8) * 0.18;
    if (this.label) {
      this.label.position.y = this.labelBaseY + Math.sin(this.time * 1.6 + this.phase) * 0.05;
      this.label.material.opacity = 0.78 + Math.sin(this.time * 2.2 + this.phase) * 0.14;
    }
    if (this.light) this.light.intensity = 2.6 * (0.82 + Math.sin(this.time * 3.1) * 0.18);
    if (this.beacon) this.beacon.material.opacity = 0.06 + Math.sin(this.time * 1.7) * 0.025;

    const d = Math.hypot(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z);
    if (d < PICKUP_RADIUS && Math.abs(playerPos.y + 0.9 - this.group.position.y) < 2.6) this.collect();
  }
}

export class Combat {
  constructor({ scene, camera, colliders, player, ui, audio, vfx, shake, zombies }) {
    this.scene = scene;
    this.camera = camera;
    this.colliders = colliders;
    this.player = player;
    this.ui = ui;
    this.audio = audio;
    this.vfx = vfx;
    this.shake = shake;
    this.zombies = zombies;
    this.onDeath = null;

    this.maxHealth = MAX_HEALTH;
    this.health = MAX_HEALTH;
    this.alive = true;
    this.hasGun = false;
    this.ammo = 0;
    this.attackCd = 0;
    this.hurtCd = 0;
    this.regenTimer = 0;
    this.emptyWarned = false;
    this.time = 0;
    this.downTime = 0;

    this.aimHeld = false;
    this.fireHeld = false;
    this.aiming = false;
    this.aimBlend = 0;
    this.armBlend = 0;
    this.armRecoil = 0;
    this.lock = null;
    this.scanTimer = 0;
    this.flashT = 0;
    this.weaponModel = null;
    this._cacheKey = '';

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 80;
    this.center = new THREE.Vector2(0, 0);
    this._shootNdc = new THREE.Vector2();
    this._scanFwd = new THREE.Vector3();
    this._scanPt = new THREE.Vector3();
    this._scanDir = new THREE.Vector3();
    this._scanNdc = new THREE.Vector3();
    this._scanEye = new THREE.Vector3();
    this._aimDir = new THREE.Vector3();
    this.aimYaw = Math.PI;
    this._muzzle = new THREE.Vector3();
    this._shotDir = new THREE.Vector3();
    this._impact = new THREE.Vector3();
    this.tracers = [];
    this.drops = [];
    this.pickups = [];
    this._lastHud = {};

    this.muzzle = new THREE.PointLight(0xffd9a0, 0, 9, 2);
    scene.add(this.muzzle);

    // Rail laser: a thin beam plus an impact dot that shows exactly where the
    // pistol is pointing while aiming. Turns aim from guesswork into feedback.
    const laserGeo = new THREE.CylinderGeometry(0.007, 0.007, 1, 6, 1, true);
    laserGeo.translate(0, 0.5, 0);
    this.laser = new THREE.Mesh(
      laserGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff6a4a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      })
    );
    this.laser.visible = false;
    scene.add(this.laser);
    this.laserDot = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(), color: 0xff7a55, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    this.laserDot.scale.setScalar(0.22);
    this.laserDot.visible = false;
    scene.add(this.laserDot);
    this._laserDir = new THREE.Vector3();
    this._laserEnd = new THREE.Vector3();
    this._laserSeg = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this.flashSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(), color: 0xffe2b0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false,
      })
    );
    this.flashSprite.scale.setScalar(1.1);
    scene.add(this.flashSprite);

    this._buildPickups();
    this._syncHud(true);
  }

  _buildPickups() {
    for (const def of GUNS) {
      const pos = new THREE.Vector3(...def.position);
      const p = new CombatPickup({
        scene: this.scene,
        position: new THREE.Vector3(pos.x, this._groundAt(pos.x, pos.z, pos.y), pos.z),
        kind: 'pistol',
        color: 0xffb347,
        onCollect: () => this._onGunFound(),
      });
      p.id = def.id;
      this.pickups.push(p);
    }
    for (const def of AMMO) {
      const pos = new THREE.Vector3(...def.position);
      const p = new CombatPickup({
        scene: this.scene,
        position: new THREE.Vector3(pos.x, this._groundAt(pos.x, pos.z, pos.y), pos.z),
        kind: 'ammo',
        color: 0xffd08a,
        onCollect: () => this._onAmmoFound(),
      });
      p.id = def.id;
      this.pickups.push(p);
    }
  }

  /** Highest floor at or below the authored pickup height. */
  _groundAt(x, z, y) {
    let best = null;
    for (const b of this.colliders.query(x, z, 0.7)) {
      if (x < b.minX - 0.05 || x > b.maxX + 0.05) continue;
      if (z < b.minZ - 0.05 || z > b.maxZ + 0.05) continue;
      if (b.maxY > y + 0.9) continue;
      if (best === null || b.maxY > best) best = b.maxY;
    }
    return best === null ? y : Math.min(y, best);
  }

  setZombies(zombies) {
    this.zombies = zombies;
  }

  /** Full reset for a new run. */
  reset() {
    this.health = MAX_HEALTH;
    this.alive = true;
    this.hasGun = false;
    this.ammo = 0;
    this.attackCd = 0;
    this.hurtCd = 0;
    this.regenTimer = 0;
    this.downTime = 0;
    this.emptyWarned = false;
    this.aiming = false;
    this.aimHeld = false;
    this.fireHeld = false;
    this.aimBlend = 0;
    this.armBlend = 0;
    this.armRecoil = 0;
    this.lock = null;
    this._cacheKey = '';
    this.flashT = 0;
    this.flashSprite.material.opacity = 0;
    if (this.weaponModel) this.weaponModel.visible = false;
    this.laser.visible = false;
    this.laserDot.visible = false;
    for (const p of this.pickups) p.setCollected(false);
    for (const d of this.drops) d.dispose();
    this.drops.length = 0;
    this._clearTracers();
    this.ui.setWeapon('FISTS', null);
    this.ui.setReticle(false);
    this.ui.setAim(false, 0, false);
    this.ui.setCacheHint(null);
    this._syncHud(true);
  }

  restore(data) {
    this.reset();
    if (!data) return;
    this.health = clamp(data.health ?? MAX_HEALTH, 1, MAX_HEALTH);
    this.alive = true;
    this.hasGun = !!data.hasGun;
    this.ammo = clamp(data.ammo || 0, 0, AMMO_MAX);
    const taken = new Set(data.taken || []);
    for (const p of this.pickups) {
      if (taken.has(p.id)) p.setCollected(true);
    }
    this.ui.setWeapon(this.hasGun ? 'PISTOL' : 'FISTS', this.hasGun ? this.ammo : null);
    this.ui.setReticle(this.hasGun);
    this._syncHud(true);
  }

  toJSON() {
    return {
      health: Math.round(this.health),
      hasGun: this.hasGun,
      ammo: this.ammo,
      taken: this.pickups.filter((p) => p.collected).map((p) => p.id),
    };
  }

  giveGun(ammo = GUN_AMMO) {
    this.hasGun = true;
    this.ammo = clamp(this.ammo + ammo, 0, AMMO_MAX);
    this.ui.setWeapon('PISTOL', this.ammo);
    this.ui.setReticle(true);
    this.ui.weaponFlash();
    this._syncHud(true);
  }

  heal(amount) {
    this.health = clamp(this.health + amount, 0, MAX_HEALTH);
    this._syncHud(true);
  }

  revive() {
    this.health = MAX_HEALTH;
    this.alive = true;
    this.hurtCd = 0;
    this.regenTimer = 0;
    this.downTime = 0;
    this._syncHud(true);
  }

  /** The pistol can only be raised while it has rounds in it. */
  canAim() {
    return this.alive && this.hasGun && this.ammo > 0;
  }

  /** Called before the player updates so movement/facing can react to aiming. */
  refreshAim() {
    this.aiming = this.aimHeld && this.canAim();
    if (this.aiming) {
      // Turn the body toward the point under the reticle, roughly 20 m out,
      // so the pistol barrels toward what the crosshair covers.
      this.camera.getWorldDirection(this._aimDir);
      const px = this.camera.position.x + this._aimDir.x * 24;
      const pz = this.camera.position.z + this._aimDir.z * 24;
      this.aimYaw = Math.atan2(px - this.player.position.x, pz - this.player.position.z);
    }
    return this.aiming;
  }

  _onGunFound() {
    const first = !this.hasGun;
    this.giveGun(GUN_AMMO);
    this.audio.sfx('gunPickup');
    this.vfx.fountain(this.player.position.clone().setY(this.player.position.y + 1), {
      count: 30, color: 0xffd08a, speed: 4.5, life: 1.2, size: 0.32,
    });
    this.ui.toast(first ? 'PISTOL ACQUIRED — HOLD RIGHT CLICK TO AIM' : `PISTOL +${GUN_AMMO} AMMO`, 'cyan');
  }

  _onAmmoFound() {
    this.ammo = clamp(this.ammo + AMMO_BOX, 0, AMMO_MAX);
    this.emptyWarned = false;
    this.audio.sfx('ammoPickup');
    this.vfx.burst(this.player.position.clone().setY(this.player.position.y + 1.1), {
      count: 16, color: 0xffd08a, speed: 2.6, life: 0.8, size: 0.26, gravity: -3,
    });
    this.ui.toast(`AMMO +${AMMO_BOX} — ${this.ammo}/${AMMO_MAX}`);
    this._syncHud(true);
  }

  dropAmmo(position) {
    if (this.drops.length >= 5) {
      const old = this.drops.shift();
      old.dispose();
    }
    const drop = new CombatPickup({
      scene: this.scene,
      position: new THREE.Vector3(position.x, position.y + 0.05, position.z),
      kind: 'ammo',
      color: 0xffd08a,
      transient: true,
      onCollect: () => {
        this.ammo = clamp(this.ammo + 6, 0, AMMO_MAX);
        this.emptyWarned = false;
        this.audio.sfx('ammoPickup');
        this.ui.toast(`AMMO +6 — ${this.ammo}/${AMMO_MAX}`);
        this._syncHud(true);
      },
    });
    drop.life = 45;
    this.drops.push(drop);
  }

  // ------------------------------------------------------------- weapons --
  _attachWeapon() {
    const hand = this.player.character && this.player.character.handR;
    if (!hand || this.weaponModel) return;
    const pistol = createPistol({ scale: 1 });
    // The hand's local -Y points along the fingers, so stand the grip down
    // along +Z and let the barrel follow the arm.
    pistol.position.set(0, -0.13, 0.012);
    pistol.rotation.set(Math.PI / 2, 0, 0);
    pistol.visible = false;
    hand.add(pistol);
    this.weaponModel = pistol;
  }

  /** Blend the right arm up into a two-handed firing pose. */
  _poseArms(dt) {
    const ch = this.player.character;
    if (!ch) return;
    const target = this.hasGun && this.alive ? 1 : 0;
    this.armBlend += (target - this.armBlend) * (1 - Math.exp(-11 * dt));
    const k = clamp(this.armBlend, 0, 1);
    if (this.weaponModel) this.weaponModel.visible = this.hasGun && this.alive && k > 0.05;
    if (k < 0.01) return;

    const blend = (joint, axis, value) => {
      joint.rotation[axis] += (value - joint.rotation[axis]) * k;
    };
    const kick = this.armRecoil * 0.55;
    const aimK = this.aimBlend;

    blend(ch.shoulderR, 'x', -1.52 - aimK * 0.1 - kick);
    blend(ch.shoulderR, 'y', -0.26);
    blend(ch.shoulderR, 'z', 0.12 - aimK * 0.06);
    blend(ch.elbowR, 'x', -0.1);
    blend(ch.handR, 'x', -0.06);
    blend(ch.handR, 'z', 0.02);

    blend(ch.shoulderL, 'x', -1.16 - aimK * 0.08);
    blend(ch.shoulderL, 'y', 0.56);
    blend(ch.shoulderL, 'z', -0.42);
    blend(ch.elbowL, 'x', -1.02);
  }

  attack() {
    if (!this.alive || this.attackCd > 0) return;
    if (this.hasGun && this.ammo > 0) {
      this.shoot();
      return;
    }
    if (this.hasGun && !this.emptyWarned) {
      this.emptyWarned = true;
      this.audio.sfx('empty');
      this.ui.toast('MAGAZINE EMPTY — FIGHT WITH YOUR HANDS', 'red');
    }
    this.punch();
  }

  _muzzlePosition() {
    if (this.weaponModel && this.weaponModel.visible) {
      const m = this.weaponModel.userData.muzzle;
      if (m) {
        m.getWorldPosition(this._muzzle);
        return this._muzzle;
      }
    }
    const p = this.player.position;
    const f = this.player.facing;
    return this._muzzle.set(
      p.x + Math.sin(f) * 0.55 + Math.cos(f) * 0.22,
      p.y + 1.4,
      p.z + Math.cos(f) * 0.55 - Math.sin(f) * 0.22
    );
  }

  shoot() {
    this.attackCd = FIRE_RATE;
    this.ammo--;
    this.audio.sfx('pistol', { volume: rand(0.92, 1.05) });
    this.audio.sfx('shell', { delay: 0.12 + rand(0, 0.05), volume: 0.5 });

    const aimed = this.aimBlend > 0.5;
    this.shake.add(aimed ? 0.1 : 0.16);
    this.armRecoil = 1;
    this.player.cameraRig?.addRecoil(aimed ? 0.026 : 0.045, rand(-0.006, 0.006));

    const from = this._muzzlePosition().clone();
    this._scanEye.set(this.player.position.x, this.player.position.y + 1.45, this.player.position.z);
    this._muzzleFlash(from);

    const spread = aimed ? 0.0055 : 0.026;
    this._shootNdc.set(rand(-spread, spread), rand(-spread, spread));
    this.raycaster.setFromCamera(this._shootNdc, this.camera);
    const targets = this.zombies ? this.zombies.targets() : [];
    const hits = targets.length ? this.raycaster.intersectObjects(targets, false) : [];

    let hit = null;
    for (const h of hits) {
      const z = h.object.userData.zombie;
      if (!z || z.dead) continue;
      if (this._rayBlocked(this._scanEye, h.point)) continue;
      hit = { zombie: z, point: h.point, part: h.object.userData.part || 'body' };
      break;
    }
    // A third-person camera sits above and behind the shoulder: if the exact
    // centre ray misses, take whatever the reticle is actually covering.
    if (!hit) hit = this._aimScan(aimed ? 0.08 : 0.12);

    this._impact.copy(from);
    if (hit) {
      const headshot = hit.part === 'head';
      const damage = headshot ? BULLET_DAMAGE * HEADSHOT_MULT : BULLET_DAMAGE;
      const dir = this._shotDir.copy(hit.point).sub(from).setY(0);
      if (dir.lengthSq() < 0.0001) dir.set(Math.sin(this.player.facing), 0, Math.cos(this.player.facing));
      dir.normalize();
      const killed = hit.zombie.hurt(damage, dir.x, dir.z, hit.part);
      this._impact.copy(hit.point);
      this.ui.hitMarker(headshot ? 'head' : 'body');
      this.vfx.burst(hit.point, {
        count: headshot ? 18 : 12,
        color: killed ? 0x8a2a1e : 0x6a1f1f,
        speed: headshot ? 4.2 : 3.2,
        life: 0.7, size: 0.27, gravity: -8, up: 0.7,
      });
      if (killed) this.ui.toast(headshot ? 'HEADSHOT — INFECTED DOWN' : 'INFECTED DOWN', 'cyan');
      else if (headshot) this.audio.sfx('zombieHit', { volume: 1.1 });
    } else {
      const dir = this._shotDir;
      this.camera.getWorldDirection(dir);
      this._impact.copy(this.camera.position).addScaledVector(dir, 42);
      this.vfx.burst(this._impact, {
        count: 6, color: 0xcfc2a8, speed: 1.8, life: 0.55, size: 0.22, gravity: -3,
      });
    }
    this._tracer(from, this._impact);

    if (this.ammo <= 0) {
      this.emptyWarned = true;
      this.aiming = false;
      this.ui.toast('MAGAZINE EMPTY — LEFT CLICK TO PUNCH', 'red');
      this.ui.setWeapon('FISTS', null);
      this.ui.setReticle(false);
      this.ui.setAim(false, 0, false);
    }
    this._syncHud(true);
  }

  _muzzleFlash(from) {
    this.muzzle.position.copy(from);
    this.muzzle.intensity = 14;
    this.flashSprite.position.copy(from);
    this.flashSprite.material.rotation = rand(0, Math.PI * 2);
    this.flashSprite.scale.setScalar(rand(0.85, 1.35));
    this.flashSprite.material.opacity = 1;
    this.flashT = 0.055;

    // smoke wisp + ejected brass
    this.vfx.burst(from, {
      count: 3, color: 0xbdb6a6, speed: 1.4, life: 0.8, size: 0.32, gravity: 1.4, up: 0.9,
    });
    const side = this.player.facing + Math.PI / 2;
    this.vfx.burst(
      new THREE.Vector3(from.x + Math.cos(side) * 0.1, from.y, from.z - Math.sin(side) * 0.1),
      { count: 1, color: 0xe0b264, speed: 2.6, life: 1.1, size: 0.11, gravity: -15, up: 0.9 }
    );
  }

  punch() {
    this.attackCd = PUNCH_RATE;
    this.audio.sfx('punch');
    this.shake.add(0.035);
    const p = this.player.position;
    const f = this.player.facing;
    const fx = Math.sin(f);
    const fz = Math.cos(f);
    const target = this.zombies ? this.zombies.nearest(p, 2.6) : null;
    let connected = false;
    if (target) {
      const dx = target.position.x - p.x;
      const dz = target.position.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot > 0.1 && Math.abs(target.position.y - p.y) < 1.6) {
        const killed = target.hurt(PUNCH_DAMAGE, dx / d, dz / d, 'body');
        this.ui.hitMarker('body');
        this.vfx.burst(new THREE.Vector3(target.position.x, target.position.y + 1.2, target.position.z), {
          count: 10, color: killed ? 0x8a2a1e : 0x6a1f1f, speed: 2.6, life: 0.6, size: 0.26, gravity: -6, up: 0.6,
        });
        if (killed) this.ui.toast('INFECTED DOWN', 'cyan');
        connected = true;
      }
    }
    if (!connected) {
      this.vfx.burst(new THREE.Vector3(p.x + fx * 1.1, p.y + 1.25, p.z + fz * 1.1), {
        count: 5, color: 0xbfb4a0, speed: 1.2, life: 0.35, size: 0.18, gravity: 1,
      });
    }
  }

  /** Nearest solid surface along a ray, so the laser stops on cover. */
  _nearestWall(origin, dir, maxDist) {
    let best = maxDist;
    const dx = dir.x * maxDist;
    const dy = dir.y * maxDist;
    const dz = dir.z * maxDist;
    const cx = origin.x + dx * 0.5;
    const cz = origin.z + dz * 0.5;
    const pad = Math.hypot(dx, dz) * 0.5 + 1;
    for (const b of this.colliders.query(cx, cz, pad)) {
      if (!b.cast) continue;
      if (origin.x > b.minX && origin.x < b.maxX &&
          origin.y > b.minY && origin.y < b.maxY &&
          origin.z > b.minZ && origin.z < b.maxZ) continue;
      const t = segmentBox(origin.x, origin.y, origin.z, dx, dy, dz, b, 1);
      if (t < 1 && t * maxDist < best) best = t * maxDist;
    }
    return best;
  }

  _updateLaser() {
    const active = this.canAim() && this.aimBlend > 0.1;
    if (!active) {
      if (this.laser.visible) {
        this.laser.visible = false;
        this.laserDot.visible = false;
      }
      return;
    }
    const cam = this.camera;
    const dir = cam.getWorldDirection(this._laserDir);
    const maxDist = 32;
    let dist = this._nearestWall(cam.position, dir, maxDist);

    const targets = this.zombies ? this.zombies.targets() : [];
    if (targets.length) {
      this.raycaster.set(cam.position, dir);
      const hits = this.raycaster.intersectObjects(targets, false);
      if (hits.length && hits[0].distance < dist) dist = hits[0].distance;
    }

    const from = this._muzzlePosition().clone();
    const end = this._laserEnd.copy(cam.position).addScaledVector(dir, dist);
    const seg = this._laserSeg.copy(end).sub(from);
    const len = Math.max(0.2, seg.length());
    this.laser.visible = true;
    this.laser.position.copy(from);
    this.laser.quaternion.setFromUnitVectors(this._up, seg.normalize());
    this.laser.scale.set(1, len, 1);
    this.laser.material.opacity = 0.16 + this.aimBlend * 0.24;
    this.laserDot.visible = true;
    this.laserDot.position.copy(end);
    this.laserDot.material.opacity = 0.55 + this.aimBlend * 0.35;
  }

  /** What the reticle is covering, within a tight cone around screen centre. */
  _aimScan(cone) {
    if (!this.zombies) return null;
    const cam = this.camera;
    const fwd = this._scanFwd;
    cam.getWorldDirection(fwd);
    this._scanEye.set(this.player.position.x, this.player.position.y + 1.45, this.player.position.z);
    let best = null;
    let bestScore = cone;
    for (const z of this.zombies.zombies) {
      if (z.dead || !z.group.visible) continue;
      if (cam.position.distanceTo(z.position) > 50) continue;
      const points = z.aimPoints || [{ y: 1.2, part: 'body' }];
      for (const p of points) {
        const pt = this._scanPt.set(z.position.x, z.position.y + p.y, z.position.z);
        const dir = this._scanDir.copy(pt).sub(cam.position);
        const dist = dir.length();
        if (dist < 0.6) continue;
        dir.multiplyScalar(1 / dist);
        if (dir.dot(fwd) < 0.4) continue;
        this._scanNdc.copy(pt).project(cam);
        if (this._scanNdc.z > 1 || this._scanNdc.z < -1) continue;
        const score = Math.hypot(this._scanNdc.x, this._scanNdc.y * 1.06)
          - (p.part === 'head' ? 0.012 : 0);
        if (score > bestScore) continue;
        // Check cover from the Restorer's eyes, not the chase camera, which can
        // clip into a wall and would otherwise veto every shot.
        if (this._rayBlocked(this._scanEye, pt)) continue;
        bestScore = score;
        best = { zombie: z, point: pt.clone(), part: p.part };
      }
    }
    return best;
  }

  _tracer(from, to) {
    const mesh = this.vfx.beam(from, to, { color: 0xfff2c8, radius: 0.012, opacity: 0.85, pulse: false });
    this.tracers.push({ mesh, life: 0.06 });
  }

  _clearTracers() {
    for (const t of this.tracers) this.vfx.remove(t.mesh);
    this.tracers.length = 0;
  }

  _rayBlocked(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const cx = (from.x + to.x) * 0.5;
    const cz = (from.z + to.z) * 0.5;
    const pad = Math.hypot(dx, dz) * 0.5 + 1;
    for (const b of this.colliders.query(cx, cz, pad)) {
      if (!b.cast) continue;
      // A box the segment starts inside is the camera clipping into geometry,
      // not cover in front of the shot.
      if (from.x > b.minX && from.x < b.maxX &&
          from.y > b.minY && from.y < b.maxY &&
          from.z > b.minZ && from.z < b.maxZ) continue;
      const t = segmentBox(from.x, from.y, from.z, dx, dy, dz, b, 0.985);
      if (t < 0.985) return true;
    }
    return false;
  }

  hurt(amount, source) {
    if (!this.alive || this.hurtCd > 0 || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtCd = INVULN;
    this.regenTimer = 0;
    this.ui.flashDamage();
    this.ui.setHealth(this.health, this.maxHealth);
    this.audio.sfx('hurt');
    this.shake.add(0.16);

    if (source) {
      const dx = this.player.position.x - source.position.x;
      const dz = this.player.position.z - source.position.z;
      const d = Math.hypot(dx, dz) || 1;
      this.player.knockback(dx / d, dz / d, 3.4);
    }

    if (this.health <= 0) {
      this.alive = false;
      this.aiming = false;
      this.hurtCd = 0;
      this.ui.setWeapon('FISTS', null);
      this.ui.setReticle(false);
      this.ui.setAim(false, 0, false);
      this.ui.setCacheHint(null);
      if (this.weaponModel) this.weaponModel.visible = false;
      this.laser.visible = false;
      this.laserDot.visible = false;
      if (this.onDeath) this.onDeath();
    }
  }

  /** HUD tracker that points at the nearest cache while the Restorer is unarmed. */
  _updateCacheHint() {
    if (this.hasGun || !this.alive) {
      if (this._cacheKey) {
        this._cacheKey = '';
        this.ui.setCacheHint(null);
      }
      return;
    }
    let best = null;
    let bestD = Infinity;
    for (const p of this.pickups) {
      if (p.kind !== 'pistol' || p.collected) continue;
      const d = Math.hypot(p.group.position.x - this.player.position.x, p.group.position.z - this.player.position.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best || bestD > 95) {
      if (this._cacheKey) {
        this._cacheKey = '';
        this.ui.setCacheHint(null);
      }
      return;
    }
    const dx = best.group.position.x - this.player.position.x;
    const dz = best.group.position.z - this.player.position.z;
    const bearing = Math.atan2(dx, dz);
    const camBearing = (this.player.cameraRig ? this.player.cameraRig.yaw : 0) + Math.PI;
    let rel = bearing - camBearing;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const key = Math.round(bestD) + '|' + rel.toFixed(2);
    if (key === this._cacheKey) return;
    this._cacheKey = key;
    this.ui.setCacheHint({ distance: Math.round(bestD), angle: rel });
  }

  update(dt) {
    this.time += dt;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.hurtCd = Math.max(0, this.hurtCd - dt);
    this.regenTimer += dt;
    this.aimBlend += ((this.aiming ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-10 * dt));
    this.armRecoil = Math.max(0, this.armRecoil - dt * 6);

    if (this.alive && this.health < this.maxHealth && this.regenTimer > REGEN_DELAY) {
      this.health = Math.min(this.maxHealth, this.health + REGEN_RATE * dt);
      this.ui.setHealth(this.health, this.maxHealth);
      this._syncHud();
    }

    if (!this.weaponModel) this._attachWeapon();
    this._poseArms(dt);
    this._updateLaser();

    if (this.fireHeld) this.attack();

    // reticle lock feedback
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.07;
      this.lock = this.canAim() ? this._aimScan(this.aimBlend > 0.5 ? 0.085 : 0.13) : null;
      const dist = this.lock ? this.camera.position.distanceTo(this.lock.zombie.position) : 0;
      this.ui.setAim(!!this.lock, dist, this.aiming);
      const lockZ = this.lock ? this.lock.zombie : null;
      for (const z of this.zombies.zombies) z.highlight = z === lockZ;
    }

    this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 160);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashSprite.material.opacity = Math.max(0, this.flashT / 0.055);
    } else if (this.flashSprite.material.opacity !== 0) {
      this.flashSprite.material.opacity = 0;
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.06) * 0.85;
      if (t.life <= 0) {
        this.vfx.remove(t.mesh);
        this.tracers.splice(i, 1);
      }
    }

    for (const p of this.pickups) p.update(dt, this.player.position);
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.update(dt, this.player.position);
      d.life -= dt;
      if (!d.collected && d.life < 6) {
        d.group.visible = Math.floor(d.life * 4) % 2 === 0;
      }
      if (d.collected || d.life <= 0) {
        d.dispose();
        this.drops.splice(i, 1);
      }
    }

    this._updateCacheHint();
    this._syncHud();
  }

  _syncHud(force = false) {
    const hp = Math.round(this.health);
    if (force || this._lastHud.health !== hp) {
      this._lastHud.health = hp;
      this.ui.setHealth(this.health, this.maxHealth);
    }
    const gun = this.hasGun && this.ammo > 0;
    const ammo = gun ? this.ammo : null;
    if (force || this._lastHud.gun !== gun || this._lastHud.ammo !== ammo) {
      this._lastHud.gun = gun;
      this._lastHud.ammo = ammo;
      this.ui.setWeapon(gun ? 'PISTOL' : 'FISTS', ammo);
      this.ui.setReticle(gun);
    }
  }
}
