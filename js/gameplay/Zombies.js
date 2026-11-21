import * as THREE from 'three';
import { angleLerp, clamp, rand } from '../core/utils.js';

/**
 * The infected of Aster.
 *
 * They shamble through the ruins, drift toward movement and claw at anything
 * that still breathes. They are a distraction while restoring a district, not a
 * gate: they can be outrun, shot, or beaten down with bare hands.
 *
 * Every body is procedural geometry: a hunched, uneven figure with sunken eyes,
 * exposed ribs, torn clothing and wet wounds. Meshes are merged per limb and
 * material so a full horde costs only a dozen draw calls each.
 */

const MAX_ALIVE = 10;
const ROSTER = 12;

const SKINS = [0x8f9a7e, 0x83906f, 0x9aa084, 0x7c8a70, 0x8d9587];
const SHIRTS = [0x4a4a4e, 0x3c4744, 0x5a4a3c, 0x33393f, 0x464a3c, 0x6b5b4a];
const PANTS = [0x2a2f33, 0x32363a, 0x3a332d];
const HAIRS = [0x14100f, 0x241a15, 0x1b1b1c];

// Anchors spread over the plaza edges, four streets, both side districts and
// the core approach. Spawns keep their distance from the player.
const SPOTS = [
  [-18, 18], [17, 15], [-12, -9], [9, -16],
  [-9, -30], [8, -44], [-30, 4], [26, 5],
  [-46, -5], [52, -4], [4, 42], [-8, 55],
  [1, 66], [-18, 86], [-64, 12], [-80, -6],
  [82, -16], [92, 9], [7, -66], [-8, -78],
];

let EYE_MAT = null;

/** Bake same-material meshes into one buffer geometry (position/normal/uv). */
function mergeSimple(geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geometries) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vertexCount * 3);
  const nor = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const idx = new Uint32Array(indexCount);
  let vo = 0;
  let io = 0;
  for (const g of geometries) {
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
      io += ia.length;
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = i + vo;
      io += g.attributes.position.count;
    }
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** Collapse the direct mesh children of one joint into a mesh per material. */
function mergeGroup(group) {
  const buckets = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh) continue;
    child.updateMatrix();
    const geo = child.geometry.clone().applyMatrix4(child.matrix);
    if (!buckets.has(child.material)) buckets.set(child.material, []);
    buckets.get(child.material).push(geo);
    group.remove(child);
    child.geometry.dispose();
  }
  for (const [material, geometries] of buckets) {
    const merged = mergeSimple(geometries);
    geometries.forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = merged.boundingSphere.radius > 0.09;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

class Zombie {
  constructor(system, spot, index) {
    this.system = system;
    this.audio = system.audio;
    this.index = index;
    this.home = new THREE.Vector3(spot[0], 0, spot[1]);
    this.position = new THREE.Vector3();
    this.maxHealth = 100;
    this.health = 100;
    this.heightScale = rand(0.94, 1.09);
    this.speed = rand(1.35, 2.1) * (1.12 - this.heightScale * 0.14);
    this.damage = 11;
    this.dead = false;
    this.deathT = 0;
    this.respawnAt = 0;
    this.stun = 0;
    this.flash = 0;
    this.highlight = false;
    this.highlightAmt = 0;
    this.winding = false;
    this.windT = 0;
    this.attackCd = 0;
    this.kvx = 0;
    this.kvz = 0;
    this.vy = 0;
    this.t = rand(0, 6);
    this.growlTimer = rand(2, 8);
    this.facing = rand(-Math.PI, Math.PI);
    this.yawTarget = this.facing;
    this.wander = new THREE.Vector2(this.home.x, this.home.z);
    this.wanderTimer = 0;
    this.alerted = false;
    this.hitMeshes = [];
    this.limp = rand(0.35, 1);
    this.reachBias = rand(-0.18, 0.18);
    this.bodyBaseY = 0.92;

    // ---- environmental awareness -------------------------------------
    // The Hollowed hunt by disturbance, not by a magic aggro radius. Sound and
    // movement put them into investigate/search; sight is a narrow cone.
    this.state = 'wander';
    this.hearTarget = null;
    this.searchPoint = new THREE.Vector3();
    this.searchTimer = 0;
    this.lastSeen = new THREE.Vector3();
    this.sightRange = rand(14, 20);
    this.hearing = rand(17, 27);
    this.patience = rand(4.5, 8);
    this.story = null;
    this.storyT = 0;
    this.storyTarget = null;

    this._build();
    this.respawn(true);
  }

  _build() {
    const s = this.heightScale;
    const skinMat = new THREE.MeshStandardMaterial({
      color: SKINS[this.index % SKINS.length], roughness: 0.93, metalness: 0.02,
    });
    const shirtMat = new THREE.MeshStandardMaterial({
      color: SHIRTS[this.index % SHIRTS.length], roughness: 0.96, metalness: 0.02,
    });
    const pantMat = new THREE.MeshStandardMaterial({
      color: PANTS[this.index % PANTS.length], roughness: 0.97, metalness: 0.02,
    });
    const hairMat = new THREE.MeshStandardMaterial({
      color: HAIRS[this.index % HAIRS.length], roughness: 0.99, metalness: 0.01,
    });
    const bloodMat = new THREE.MeshStandardMaterial({
      color: 0x4a0f0c, roughness: 0.44, metalness: 0.08,
    });
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0xd6cbb0, roughness: 0.72, metalness: 0.02,
    });
    if (!EYE_MAT) EYE_MAT = new THREE.MeshBasicMaterial({ color: 0xb9ff8d, toneMapped: false });
    this.skinMat = skinMat;
    this.shirtMat = shirtMat;

    const root = new THREE.Group();
    root.scale.setScalar(s);
    this.root = root;

    const body = new THREE.Group();
    body.position.y = this.bodyBaseY;
    root.add(body);
    this.body = body;

    // ------------------------------------------------------------- torso --
    const torso = new THREE.Group();
    body.add(torso);
    const cyl = (parent, mat, rt, rb, h, y, z = 0, seg = 10) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
      m.position.set(0, y, z);
      parent.add(m);
      return m;
    };
    const ball = (parent, mat, r, x, y, z, sx = 1, sy = 1, sz = 1, seg = 12) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(7, seg >> 1)), mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      parent.add(m);
      return m;
    };
    const box = (parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    };

    cyl(torso, shirtMat, 0.185, 0.155, 0.28, 0.2, 0, 12);
    cyl(torso, shirtMat, 0.215, 0.185, 0.3, 0.44, 0.005, 12);
    ball(torso, shirtMat, 0.098, -0.215, 0.55, 0, 1, 0.85, 0.95);
    ball(torso, shirtMat, 0.098, 0.215, 0.55, 0, 1, 0.85, 0.95);
    cyl(torso, skinMat, 0.05, 0.058, 0.14, 0.64, 0.01, 8);

    // torn shirt: a gash showing the belly, ragged hem and shoulder
    ball(torso, skinMat, 0.105, 0.03, 0.19, 0.1, 1.15, 0.95, 0.45);
    box(torso, shirtMat, 0.16, 0.05, 0.03, 0.02, 0.07, 0.15, 0, 0, 0.08);
    box(torso, shirtMat, 0.13, 0.09, 0.03, -0.07, 0.03, 0.14, 0.1, 0, -0.22);
    box(torso, shirtMat, 0.1, 0.07, 0.03, 0.11, 0.05, -0.12, -0.1, 0, 0.3);
    box(torso, shirtMat, 0.09, 0.06, 0.025, -0.17, 0.44, 0.09, 0, 0.4, 0.2);
    // exposed ribs
    for (let i = 0; i < 3; i++) {
      box(torso, boneMat, 0.13, 0.014, 0.035, -0.04, 0.31 + i * 0.045, 0.125, 0, 0, 0.12);
    }
    // wet wounds
    ball(torso, bloodMat, 0.075, 0.075, 0.33, 0.135, 1.4, 0.75, 0.4);
    ball(torso, bloodMat, 0.055, -0.1, 0.16, 0.115, 1.2, 0.9, 0.4);
    ball(torso, bloodMat, 0.04, 0.13, 0.47, 0.11, 1, 1.5, 0.5);
    mergeGroup(torso);
    this._mark(torso, 'body');
    this.torso = torso;

    // -------------------------------------------------------------- head --
    const head = new THREE.Group();
    head.position.set(0, 0.6, 0.02);
    body.add(head);
    this.head = head;

    ball(head, skinMat, 0.125, 0, 0.12, 0, 0.9, 1.06, 0.96, 16);
    box(head, skinMat, 0.16, 0.032, 0.05, 0, 0.163, 0.088, 0.15, 0, 0);
    ball(head, skinMat, 0.05, -0.062, 0.075, 0.06, 1, 0.9, 0.7, 10);
    ball(head, skinMat, 0.05, 0.062, 0.075, 0.06, 1, 0.9, 0.7, 10);
    box(head, skinMat, 0.032, 0.06, 0.05, 0, 0.1, 0.112, 0.3, 0, 0);
    ball(head, skinMat, 0.032, -0.112, 0.11, 0, 0.45, 1, 0.7, 8);
    ball(head, skinMat, 0.032, 0.112, 0.11, 0, 0.45, 1, 0.7, 8);
    // sunken sockets, glowing eyes, dark maw
    ball(head, hairMat, 0.048, -0.052, 0.134, 0.082, 1, 0.85, 0.5, 10);
    ball(head, hairMat, 0.048, 0.052, 0.134, 0.082, 1, 0.85, 0.5, 10);
    ball(head, EYE_MAT, 0.018, -0.052, 0.131, 0.106, 1, 1, 1, 8);
    ball(head, EYE_MAT, 0.018, 0.052, 0.131, 0.106, 1, 1, 1, 8);
    box(head, hairMat, 0.075, 0.028, 0.04, 0, 0.048, 0.1, 0.1, 0, 0);
    // blood running from the mouth
    box(head, bloodMat, 0.028, 0.09, 0.012, 0.028, 0.005, 0.112, 0, 0, 0.12);
    box(head, bloodMat, 0.016, 0.055, 0.012, -0.02, 0.02, 0.11, 0, 0, -0.06);
    // matted hair
    ball(head, hairMat, 0.122, 0, 0.196, -0.018, 1.02, 0.62, 1.02, 14);
    ball(head, hairMat, 0.105, 0, 0.135, -0.08, 1.05, 0.95, 0.8, 12);
    ball(head, hairMat, 0.04, -0.1, 0.2, 0.045, 1, 0.7, 1, 8);
    ball(head, hairMat, 0.036, 0.09, 0.195, 0.05, 1, 0.65, 1, 8);
    const tuft = (x, y, z, r, h, rz) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), hairMat);
      m.position.set(x, y, z);
      m.rotation.set(0.2, 0.3, rz);
      head.add(m);
    };
    tuft(-0.06, 0.235, 0.03, 0.04, 0.11, -0.6);
    tuft(0.02, 0.25, 0.0, 0.038, 0.12, 0.1);
    tuft(0.075, 0.23, -0.05, 0.034, 0.1, 1.4);
    mergeGroup(head);
    this._mark(head, 'head');

    // jaw on its own pivot so it can hang and snap
    const jaw = new THREE.Group();
    jaw.position.set(0, 0.052, 0.02);
    head.add(jaw);
    this.jaw = jaw;
    ball(jaw, skinMat, 0.072, 0, -0.028, 0.03, 0.92, 0.6, 0.95, 12);
    box(jaw, skinMat, 0.075, 0.03, 0.06, 0, -0.052, 0.036);
    mergeGroup(jaw);
    this._mark(jaw, 'head');

    // -------------------------------------------------------------- arms --
    this.arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.235, 0.53, 0);
      body.add(arm);
      cyl(arm, shirtMat, 0.078, 0.058, 0.26, -0.13, 0, 8);
      ball(arm, shirtMat, 0.085, 0, -0.005, 0, 1, 0.9, 0.95, 10);
      cyl(arm, skinMat, 0.054, 0.042, 0.27, -0.39, 0, 8);
      cyl(arm, shirtMat, 0.05, 0.05, 0.055, -0.515, 0, 8);
      ball(arm, skinMat, 0.056, 0, -0.565, 0.008, 0.9, 1.05, 0.72, 10);
      for (let f = 0; f < 3; f++) {
        box(arm, skinMat, 0.015, 0.075, 0.018, -0.026 + f * 0.026, -0.625, 0.012, 0.15, 0, (f - 1) * 0.12);
      }
      mergeGroup(arm);
      this._mark(arm, 'limb');
      this.arms.push(arm);
    }

    // -------------------------------------------------------------- legs --
    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.125, this.bodyBaseY, 0);
      root.add(leg);
      cyl(leg, pantMat, 0.1, 0.082, 0.44, -0.22, 0, 10);
      ball(leg, pantMat, 0.086, 0, -0.445, 0.005, 1, 0.85, 1, 8);
      cyl(leg, pantMat, 0.076, 0.058, 0.42, -0.655, 0, 8);
      ball(leg, pantMat, 0.06, 0, -0.865, 0, 1, 0.8, 1, 8);
      box(leg, pantMat, 0.118, 0.085, 0.235, 0, -0.875, 0.06);
      box(leg, pantMat, 0.126, 0.028, 0.25, 0, -0.912, 0.062);
      mergeGroup(leg);
      this._mark(leg, 'limb');
      this.legs.push(leg);
    }

    // blood pool left where the body fell
    const decal = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 16),
      new THREE.MeshBasicMaterial({
        color: 0x3a0c08, transparent: true, opacity: 0.62, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false,
      })
    );
    decal.rotation.x = -Math.PI / 2;
    decal.scale.set(1, 0.72, 1);
    decal.visible = false;
    this.system.group.add(decal);
    this.decal = decal;

    this.aimPoints = [
      { y: (this.bodyBaseY + 0.6 + 0.13) * s, part: 'head' },
      { y: (this.bodyBaseY + 0.34) * s, part: 'body' },
    ];

    this.system.group.add(root);
    this.group = root;
  }

  _mark(group, part) {
    group.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.zombie = this;
      o.userData.part = part;
      this.hitMeshes.push(o);
    });
  }

  respawn(instant = false) {
    const system = this.system;
    let spot = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = rand(0, Math.PI * 2);
      const r = attempt === 0 ? 0 : rand(1.5, 6);
      const x = this.home.x + Math.cos(a) * r;
      const z = this.home.z + Math.sin(a) * r;
      const y = system.groundY(x, z, 6);
      if (y === null) continue;
      if (system.blocked(x, z, y, 0.36)) continue;
      if (!instant && system.player && system.player.position.distanceToSquared(new THREE.Vector3(x, y, z)) < 16 * 16) continue;
      spot = { x, y, z };
      break;
    }
    if (!spot) {
      spot = { x: this.home.x, y: system.groundY(this.home.x, this.home.z, 6) ?? 0, z: this.home.z };
    }
    this.position.set(spot.x, spot.y, spot.z);
    this.group.position.copy(this.position);
    this.health = this.maxHealth;
    this.dead = false;
    this.deathT = 0;
    this.stun = 0;
    this.flash = 0;
    this.highlight = false;
    this.highlightAmt = 0;
    this.winding = false;
    this.windT = 0;
    this.alerted = false;
    this.attackCd = rand(0, 0.6);
    this.kvx = this.kvz = this.vy = 0;
    this.wanderTimer = rand(1, 5);
    this.wander.set(this.position.x + rand(-5, 5), this.position.z + rand(-5, 5));
    this.state = 'wander';
    this.hearTarget = null;
    this.searchTimer = 0;
    this.story = null;
    this.storyT = 0;
    this.storyTarget = null;
    this.facing = rand(-Math.PI, Math.PI);
    this.yawTarget = this.facing;
    this.group.rotation.set(0, this.facing, 0);
    this.group.visible = true;
    this.body.position.set(0, this.bodyBaseY, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.scale.setScalar(1);
    this.head.rotation.set(0, 0, 0);
    this.jaw.rotation.x = -0.12;
    for (const arm of this.arms) arm.rotation.set(-0.9, 0, 0);
    for (const leg of this.legs) leg.rotation.set(0, 0, 0);
    if (this.decal) this.decal.visible = false;
    this.skinMat.emissiveIntensity = 0;
    this.shirtMat.emissiveIntensity = 0;
  }

  hurt(amount, dirX = 0, dirZ = 0, part = 'body') {
    if (this.dead) return false;
    this.health -= amount;
    this.flash = 0.22;
    this.stun = Math.max(this.stun, 0.24);
    this.kvx += dirX * 3.2;
    this.kvz += dirZ * 3.2;
    this.alerted = true;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathT = 0;
      this.winding = false;
      this.respawnAt = this.system.time + rand(16, 26);
      this.decal.position.set(this.position.x, this.position.y + 0.015, this.position.z);
      this.decal.visible = true;
      this.audio.sfx('zombieDie');
      this.system.vfx.burst(this.position.clone().setY(this.position.y + 1.1), {
        count: 22, color: 0x5c1d18, speed: 3.2, life: 1.1, size: 0.34, gravity: -8, up: 0.7,
      });
      this.system.vfx.ring(this.position.clone().setY(this.position.y + 0.08), {
        color: 0x7a2b1e, radius: 1.8, life: 0.8,
      });
      if (this.system.onKilled) this.system.onKilled(this);
      return true;
    }
    this.audio.sfx('zombieHit', { volume: part === 'head' ? 1.15 : 0.9 });
    this.system.vfx.burst(this.position.clone().setY(this.position.y + (part === 'head' ? 1.62 : 1.15)), {
      count: 8, color: 0x6a1f1f, speed: 2.4, life: 0.7, size: 0.28, gravity: -7, up: 0.6,
    });
    return false;
  }

  /** A noise pulled their attention: walk to it, then search. */
  hear(pos, strength = 1) {
    if (this.dead || this.story || this.stun > 0) return;
    if (this.state === 'chase') return;
    const d = Math.hypot(pos.x - this.position.x, pos.z - this.position.z);
    if (d > this.hearing * (0.75 + strength * 0.35)) return;
    this.hearTarget = new THREE.Vector3(pos.x, this.position.y, pos.z);
    this.state = 'investigate';
    if (this.state !== 'chase' && Math.random() < 0.55) {
      this.audio.sfx('zombieAlert', { volume: clamp(1 - d / 45, 0.1, 0.7) });
    }
  }

  /** True when the player is inside the vision cone with a clear line. */
  _canSee(playerPos) {
    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.2) return true;
    if (d > this.sightRange) return false;
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    const dot = (dx * fx + dz * fz) / (d || 1);
    if (dot < 0.12) return false;
    const from = new THREE.Vector3(this.position.x, this.position.y + 1.55, this.position.z);
    const to = new THREE.Vector3(playerPos.x, playerPos.y + 1.2, playerPos.z);
    return this.system.lineOfSight(from, to);
  }

  setStoryState(state) {
    this.story = state;
    this.storyT = 0;
    this.winding = false;
    this.stun = 0;
    this.state = 'wander';
    if (state !== 'awake') this.storyTarget = null;
  }

  walkTo(target) {
    if (this.story === 'awake') this.storyTarget = target.clone();
  }

  /** Ending pose: stillness, then the slow return of a person. */
  _storyPose(dt) {
    this.storyT += dt;
    const still = this.story === 'still';
    const k = 1 - Math.exp(-2.2 * dt);
    const walk = this.story === 'awake' && this.storyTarget;
    let moving = 0;

    if (walk) {
      const dx = this.storyTarget.x - this.position.x;
      const dz = this.storyTarget.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.9) {
        moving = 1;
        this._move(dt, (dx / d) * 0.85, (dz / d) * 0.85);
        this.yawTarget = Math.atan2(dx, dz);
      }
    } else if (this.story === 'awake') {
      this.yawTarget = this.facing + Math.sin(this.storyT * 0.4) * 0.6 * dt * 4;
    }

    const g = this.system.groundY(this.position.x, this.position.z, this.position.y + 0.7, 0.8);
    if (g !== null) this.position.y += (g - this.position.y) * Math.min(1, dt * 8);
    this.facing = angleLerp(this.facing, this.yawTarget, 1 - Math.exp(-3 * dt));
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    this.body.rotation.x += ((still ? 0.3 : 0.05) - this.body.rotation.x) * k;
    this.body.rotation.z += (0 - this.body.rotation.z) * k;
    this.body.position.y += (this.bodyBaseY - this.body.position.y) * k;
    this.body.position.z += (0 - this.body.position.z) * k;
    this.head.rotation.x += ((still ? 0.45 : -0.05) - this.head.rotation.x) * k;
    this.head.rotation.z += ((still ? 0.14 : 0.02) - this.head.rotation.z) * k;
    this.head.rotation.y += (Math.sin(this.storyT * 0.5) * (still ? 0.02 : 0.26) - this.head.rotation.y) * k;
    this.jaw.rotation.x += ((still ? -0.04 : -0.16) - this.jaw.rotation.x) * k;

    const armTarget = still ? -0.05 : 0.04;
    this.arms[0].rotation.x += (armTarget - this.arms[0].rotation.x) * k;
    this.arms[1].rotation.x += (armTarget - this.arms[1].rotation.x) * k;
    this.arms[0].rotation.z += (still ? 0.02 : -0.08 - this.arms[0].rotation.z) * k;
    this.arms[1].rotation.z += (still ? -0.02 : 0.08 - this.arms[1].rotation.z) * k;

    if (moving) {
      const gait = Math.sin(this.storyT * 4.4);
      this.legs[0].rotation.x = gait * 0.3;
      this.legs[1].rotation.x = -gait * 0.3;
      this.arms[0].rotation.x = -0.05 - gait * 0.16;
      this.arms[1].rotation.x = -0.05 + gait * 0.16;
    } else {
      this.legs[0].rotation.x += (0 - this.legs[0].rotation.x) * k;
      this.legs[1].rotation.x += (0 - this.legs[1].rotation.x) * k;
      this.legs[0].rotation.z += (0 - this.legs[0].rotation.z) * k;
      this.legs[1].rotation.z += (0 - this.legs[1].rotation.z) * k;
    }
    this.skinMat.emissiveIntensity = 0;
    this.shirtMat.emissiveIntensity = 0;
  }

  _move(dt, vx, vz) {
    const system = this.system;
    const stepX = (vx + this.kvx) * dt;
    const stepZ = (vz + this.kvz) * dt;
    const nx = this.position.x + stepX;
    if (!system.blocked(nx, this.position.z, this.position.y, 0.34)) this.position.x = nx;
    const nz = this.position.z + stepZ;
    if (!system.blocked(this.position.x, nz, this.position.y, 0.34)) this.position.z = nz;
  }

  update(dt, playerPos, playerAlive) {
    const system = this.system;
    this.t += dt;
    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const dy = playerPos.y - this.position.y;

    if (this.dead) {
      this.deathT += dt;
      const k = clamp(this.deathT / 0.85, 0, 1);
      const e = 1 - Math.pow(1 - k, 2.2);
      this.body.rotation.x = 0.16 + e * 1.35;
      this.body.position.y = this.bodyBaseY - e * 0.62;
      this.body.position.z = e * 0.22;
      this.body.scale.y = 1 - e * 0.2;
      this.head.rotation.z = 0.2 + e * 0.7;
      this.jaw.rotation.x = -0.45;
      this.legs[0].rotation.x = e * 1.15;
      this.legs[1].rotation.x = e * 0.45;
      this.legs[0].rotation.z = -e * 0.32;
      this.legs[1].rotation.z = e * 0.24;
      this.arms[0].rotation.x = -0.9 + e * 0.6;
      this.arms[1].rotation.x = -0.9 + e * 0.4;
      if (this.deathT > 1.5) {
        this.group.position.y = this.position.y - (this.deathT - 1.5) * 0.9;
      }
      if (this.deathT > 2.5) this.group.visible = false;
      if (system.time >= this.respawnAt) this.respawn(false);
      return;
    }

    if (this.story) {
      this._storyPose(dt);
      return;
    }

    // ---- hit flash / aim highlight ------------------------------------
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt);
      const k = this.flash / 0.22;
      this.skinMat.emissive.setHex(0x8c2a1e);
      this.skinMat.emissiveIntensity = k * 2.4;
      this.shirtMat.emissive.setHex(0x5c1a12);
      this.shirtMat.emissiveIntensity = k * 1.7;
    } else {
      this.highlightAmt += ((this.highlight ? 1 : 0) - this.highlightAmt) * (1 - Math.exp(-12 * dt));
      if (this.highlightAmt > 0.01) {
        this.skinMat.emissive.setHex(0xffb347);
        this.skinMat.emissiveIntensity = this.highlightAmt * 0.5;
        this.shirtMat.emissive.setHex(0xffb347);
        this.shirtMat.emissiveIntensity = this.highlightAmt * 0.3;
      } else if (this.skinMat.emissiveIntensity !== 0) {
        this.skinMat.emissiveIntensity = 0;
        this.shirtMat.emissiveIntensity = 0;
      }
    }

    if (this.stun > 0) this.stun -= dt;
    this.attackCd = Math.max(0, this.attackCd - dt);

    // ---- perception: narrow sight cone + remembered disturbances -------
    const canSee = playerAlive && this.stun <= 0 && Math.abs(dy) < 4.6 && this._canSee(playerPos);
    if (canSee) {
      if (this.state !== 'chase') {
        this.state = 'chase';
        this.audio.sfx('zombieAlert', { volume: clamp(1 - dist / 34, 0.18, 1) });
      }
      this.lastSeen.copy(playerPos);
      this.searchTimer = this.patience;
      this.alerted = true;
    } else {
      this.alerted = this.state === 'chase';
      if (this.state === 'chase') {
        this.state = 'search';
        this.searchTimer = this.patience;
        this.searchPoint.copy(this.lastSeen);
      }
    }

    let vx = 0;
    let vz = 0;
    let moving = 0;
    let tx = 0;
    let tz = 0;
    let speedMul = 0;

    if (this.stun <= 0) {
      switch (this.state) {
        case 'chase': {
          tx = playerPos.x;
          tz = playerPos.z;
          speedMul = 1;
          if (dist > 1.35 && !this.winding) moving = 1;
          this.yawTarget = Math.atan2(dx, dz);
          if (dist > 34) {
            this.state = 'search';
            this.searchTimer = this.patience;
            this.searchPoint.copy(playerPos);
          }
          this.growlTimer -= dt;
          if (this.growlTimer <= 0 && dist < 24) {
            this.growlTimer = rand(4, 9);
            this.audio.sfx('zombieGrowl', { volume: clamp(1 - dist / 32, 0.12, 1) });
          }
          if (dist < 2.0 && Math.abs(dy) < 1.5 && this.attackCd <= 0 && !this.winding) {
            this.winding = true;
            this.windT = 0;
          }
          break;
        }
        case 'investigate': {
          if (!this.hearTarget) {
            this.state = 'search';
            this.searchTimer = this.patience;
            this.searchPoint.copy(this.position);
            break;
          }
          tx = this.hearTarget.x;
          tz = this.hearTarget.z;
          speedMul = 1.1;
          const hd = Math.hypot(tx - this.position.x, tz - this.position.z);
          if (hd > 1.5) moving = 1;
          else {
            this.state = 'search';
            this.searchTimer = this.patience;
            this.searchPoint.copy(this.hearTarget);
          }
          break;
        }
        case 'search': {
          this.searchTimer -= dt;
          const hd = Math.hypot(this.searchPoint.x - this.position.x, this.searchPoint.z - this.position.z);
          if (hd < 2.1) {
            // Arrived at the disturbance: stop and sweep the head around.
            this.searchTimer -= dt * 1.6;
            this.yawTarget = this.facing + Math.sin(this.t * 1.4) * 1.3;
          } else {
            tx = this.searchPoint.x;
            tz = this.searchPoint.z;
            speedMul = 0.7;
            moving = 1;
          }
          if (this.searchTimer <= 0) {
            this.state = 'return';
            this.hearTarget = null;
          }
          break;
        }
        case 'return': {
          tx = this.home.x;
          tz = this.home.z;
          speedMul = 0.6;
          const hd = Math.hypot(tx - this.position.x, tz - this.position.z);
          if (hd > 2.4) moving = 1;
          else {
            this.state = 'wander';
            this.wanderTimer = rand(1, 3);
          }
          break;
        }
        default: {
          this.wanderTimer -= dt;
          if (this.wanderTimer <= 0) {
            this.wanderTimer = rand(3.5, 8);
            const a = rand(0, Math.PI * 2);
            const r = rand(2, 7);
            this.wander.set(this.home.x + Math.cos(a) * r, this.home.z + Math.sin(a) * r);
          }
          tx = this.wander.x;
          tz = this.wander.y;
          speedMul = 0.6;
          if (Math.hypot(tx - this.position.x, tz - this.position.z) > 1.0) moving = 0.55;
        }
      }

      if (moving > 0 && speedMul > 0) {
        const ddx = tx - this.position.x;
        const ddz = tz - this.position.z;
        const dd = Math.hypot(ddx, ddz) || 1;
        vx = (ddx / dd) * this.speed * speedMul;
        vz = (ddz / dd) * this.speed * speedMul;
        if (this.state !== 'search') this.yawTarget = Math.atan2(ddx, ddz);
      }
    }

    const aware = this.state === 'chase';
    if (!aware && dist > 2.4) this.winding = false;
    // attack wind-up: rear back, then swipe
    if (this.winding) {
      this.windT += dt;
      if (this.windT > 0.42) {
        this.winding = false;
        this.attackCd = 1.25;
        if (playerAlive && dist < 2.35 && Math.abs(dy) < 1.6) {
          if (this.system.onAttackPlayer) this.system.onAttackPlayer(this.damage, this);
          this.audio.sfx('zombieSwipe');
        }
      }
    }

    this._move(dt, vx, vz);
    this.kvx *= Math.exp(-6 * dt);
    this.kvz *= Math.exp(-6 * dt);

    // vertical: settle onto the highest floor below the feet
    const ground = system.groundY(this.position.x, this.position.z, this.position.y + 0.6, 0.7);
    if (ground !== null && this.position.y <= ground + 0.05 && this.vy <= 0) {
      this.position.y = ground;
      this.vy = 0;
    } else {
      this.vy -= 24 * dt;
      this.position.y = Math.max(-4, this.position.y + this.vy * dt);
      if (ground !== null && this.position.y < ground) {
        this.position.y = ground;
        this.vy = 0;
      }
    }

    this.facing = angleLerp(this.facing, this.yawTarget, 1 - Math.exp(-6 * dt));
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    // ---- procedural shamble -------------------------------------------
    const stride = moving > 0.8 ? this.speed * 2.35 : 2.5;
    const gait = Math.sin(this.t * stride);
    const step = Math.abs(Math.cos(this.t * stride));
    const moveW = clamp(moving, 0, 1);
    // the limp makes one side of the body lag, so the walk never looks mirrored
    const lag = Math.sin(this.t * stride - 0.6) * this.limp;

    this.body.position.y = this.bodyBaseY + step * (0.03 + moveW * 0.03) - 0.015;
    this.body.position.z = 0;
    this.body.rotation.x = 0.15 + moveW * 0.07 + (this.winding ? 0.2 : 0);
    this.body.rotation.y = gait * 0.05 * moveW;
    this.body.rotation.z = Math.sin(this.t * 1.25) * 0.045 + lag * 0.035 * moveW;

    this.head.rotation.x = -0.16 - this.body.rotation.x * 0.55 + Math.sin(this.t * 0.9) * 0.05;
    this.head.rotation.y = Math.sin(this.t * 0.63) * 0.2;
    this.head.rotation.z = 0.18 + Math.sin(this.t * 0.44) * 0.07;
    this.jaw.rotation.x = -0.12 - Math.max(0, Math.sin(this.t * 2.1)) * 0.3 - (this.winding ? 0.18 : 0);

    const reach = aware ? -1.28 + this.reachBias : -0.62 + this.reachBias;
    const swipe = this.winding ? reach - 0.55 - Math.sin(clamp(this.windT / 0.42, 0, 1) * Math.PI) * 0.3 : reach;
    this.arms[0].rotation.x = swipe + gait * 0.12 * moveW;
    this.arms[1].rotation.x = swipe - this.limp * 0.16 - gait * 0.1 * moveW;
    this.arms[0].rotation.z = -0.14 + Math.sin(this.t * 1.1) * 0.05;
    this.arms[1].rotation.z = 0.14 - Math.sin(this.t * 1.1 + 0.6) * 0.05;
    this.arms[0].rotation.y = 0.1;
    this.arms[1].rotation.y = -0.1;

    this.legs[0].rotation.x = gait * 0.44 * moveW;
    this.legs[1].rotation.x = -gait * 0.44 * moveW * (1 - this.limp * 0.45);
    this.legs[0].rotation.z = -0.03;
    this.legs[1].rotation.z = 0.05 + this.limp * 0.04;
  }
}

export class ZombieSystem {
  constructor({ scene, colliders, player, audio, vfx, ui }) {
    this.scene = scene;
    this.colliders = colliders;
    this.player = player;
    this.audio = audio;
    this.vfx = vfx;
    this.ui = ui;
    this.time = 0;
    this.group = new THREE.Group();
    this.group.name = 'infected';
    scene.add(this.group);
    this.onAttackPlayer = null;
    this.onKilled = null;
    this.zombies = [];

    const roster = Math.min(ROSTER, Math.max(MAX_ALIVE, SPOTS.length));
    for (let i = 0; i < roster; i++) {
      this.zombies.push(new Zombie(this, SPOTS[i % SPOTS.length], i));
    }
    this.reset();
  }

  /** Highest floor at or below feetY + tolerance. */
  groundY(x, z, from = 6, tolerance = 0.7) {
    let best = null;
    for (const b of this.colliders.query(x, z, 0.9)) {
      if (x < b.minX - 0.05 || x > b.maxX + 0.05) continue;
      if (z < b.minZ - 0.05 || z > b.maxZ + 0.05) continue;
      const top = b.maxY;
      if (top > from + tolerance) continue;
      if (top < from - 6) continue;
      if (best === null || top > best) best = top;
    }
    return best;
  }

  /** Is the capsule blocked at this spot? Used for spawns and movement. */
  blocked(x, z, y, radius = 0.34) {
    for (const b of this.colliders.query(x, z, 1.0)) {
      if (b.isGround) continue;
      if (b.maxY <= y + 0.45) continue; // low enough to step onto
      if (b.minY >= y + 1.7) continue; // overhead
      if (x + radius <= b.minX || x - radius >= b.maxX) continue;
      if (z + radius <= b.minZ || z - radius >= b.maxZ) continue;
      return true;
    }
    return false;
  }

  reset() {
    this.time = 0;
    const player = this.player;
    for (const z of this.zombies) {
      z.respawnAt = 0;
      z.respawn(true);
      // Keep the opening plaza readable: nothing within 18 m of the spawn.
      if (player && Math.hypot(z.position.x - player.position.x, z.position.z - player.position.z) < 18) {
        z.group.visible = false;
        z.position.y = -6;
        z.dead = true;
        z.deathT = 3;
        z.respawnAt = this.time + rand(4, 12);
      }
    }
  }

  targets() {
    const out = [];
    for (const z of this.zombies) {
      if (z.dead || !z.group.visible) continue;
      for (const m of z.hitMeshes) out.push(m);
    }
    return out;
  }

  /** Push the horde out of a checkpoint so a respawn is not an instant death. */
  scatter(center, radius = 14) {
    for (const z of this.zombies) {
      if (z.dead || !z.group.visible) continue;
      const dx = z.position.x - center.x;
      const dz = z.position.z - center.z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const a = d < 0.01 ? rand(0, Math.PI * 2) : Math.atan2(dz, dx);
      const nx = center.x + Math.cos(a) * (radius + 2);
      const nz = center.z + Math.sin(a) * (radius + 2);
      const y = this.groundY(nx, nz, center.y + 2);
      if (y === null) {
        z.group.visible = false;
        z.dead = true;
        z.deathT = 3;
        z.respawnAt = this.time + rand(6, 12);
        continue;
      }
      z.position.set(nx, y, nz);
      z.group.position.copy(z.position);
    }
  }

  /** Sample the line between two points; true when no geometry blocks it. */
  lineOfSight(from, to) {
    const steps = 6;
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      const x = from.x + (to.x - from.x) * k;
      const y = from.y + (to.y - from.y) * k;
      const z = from.z + (to.z - from.z) * k;
      for (const b of this.colliders.query(x, z, 0.3)) {
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        if (y > b.minY + 0.05 && y < b.maxY - 0.02) return false;
      }
    }
    return true;
  }

  /**
   * A disturbance in the world (footsteps, a gunshot, a relay switching on).
   * Every Hollowed within its own hearing range investigates.
   */
  emitNoise(pos, radius = 18) {
    if (!pos) return;
    for (const z of this.zombies) {
      if (z.dead || !z.group.visible) continue;
      const d = Math.hypot(z.position.x - pos.x, z.position.z - pos.z);
      if (d > radius) continue;
      z.hear(pos, clamp(1 - d / radius, 0.1, 1));
    }
  }

  /** Pull a few bodies toward a location (relay activation, escape beats). */
  surgeAt(center, count = 3, spread = 9) {
    const list = this.zombies
      .filter((z) => !z.dead && z.group.visible)
      .sort((a, b) => b.position.distanceToSquared(center) - a.position.distanceToSquared(center))
      .slice(0, count);
    for (let i = 0; i < list.length; i++) {
      const z = list[i];
      const a = rand(0, Math.PI * 2);
      const r = spread * (0.45 + i * 0.18);
      const x = center.x + Math.cos(a) * r;
      const zz = center.z + Math.sin(a) * r;
      const y = this.groundY(x, zz, center.y + 6);
      if (y === null || this.blocked(x, zz, y)) continue;
      z.story = null;
      z.position.set(x, y, zz);
      z.group.position.copy(z.position);
      z.hear(center, 1);
    }
    return list.length;
  }

  nearestTo(pos, radius = 80) {
    let best = null;
    let bestD = radius;
    for (const z of this.zombies) {
      if (z.dead || !z.group.visible) continue;
      const d = Math.hypot(z.position.x - pos.x, z.position.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  /** Ending: a handful of Hollowed stand up and become people again. */
  calmAround(center, radius = 60, count = 6, exclude = null) {
    const list = this.zombies
      .filter((z) => !z.dead && z.group.visible && z !== exclude)
      .sort((a, b) => a.position.distanceToSquared(center) - b.position.distanceToSquared(center))
      .slice(0, count);
    for (const z of list) z.setStoryState('awake');
    return list;
  }

  nearest(pos, radius = 60) {
    let best = null;
    let bestD = radius;
    for (const z of this.zombies) {
      if (z.dead || !z.group.visible) continue;
      const d = Math.hypot(z.position.x - pos.x, z.position.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  stats() {
    return {
      total: this.zombies.length,
      alive: this.zombies.filter((z) => !z.dead && z.group.visible).length,
      dead: this.zombies.filter((z) => z.dead).length,
      health: this.zombies.map((z) => Math.round(z.health)),
    };
  }

  update(dt, playerPos, playerAlive = true) {
    this.time += dt;
    for (const z of this.zombies) z.update(dt, playerPos, playerAlive);
    // Never let the horde stand inside the player (or the camera).
    for (const z of this.zombies) {
      if (z.dead || !z.group.visible) continue;
      const dx = z.position.x - playerPos.x;
      const dz = z.position.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.95 && d > 0.001) {
        const push = 0.95 - d;
        z.position.x += (dx / d) * push;
        z.position.z += (dz / d) * push;
        z.group.position.copy(z.position);
      }
    }
    // keep them from stacking into one silhouette
    for (let i = 0; i < this.zombies.length; i++) {
      const a = this.zombies[i];
      if (a.dead || !a.group.visible) continue;
      for (let j = i + 1; j < this.zombies.length; j++) {
        const b = this.zombies[j];
        if (b.dead || !b.group.visible) continue;
        if (Math.abs(a.position.y - b.position.y) > 1.2) continue;
        let dx = a.position.x - b.position.x;
        let dz = a.position.z - b.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 1.05 || d < 0.0001) continue;
        const push = (1.05 - d) * 0.45;
        dx /= d;
        dz /= d;
        if (!this.blocked(a.position.x + dx * push, a.position.z + dz * push, a.position.y)) {
          a.position.x += dx * push;
          a.position.z += dz * push;
          a.group.position.copy(a.position);
        }
        if (!this.blocked(b.position.x - dx * push, b.position.z - dz * push, b.position.y)) {
          b.position.x -= dx * push;
          b.position.z -= dz * push;
          b.group.position.copy(b.position);
        }
      }
    }
  }
}
