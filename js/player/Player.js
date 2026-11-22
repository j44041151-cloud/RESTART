import * as THREE from 'three';
import { Restorer } from './RestorerModel.js';
import { clamp, damp, angleLerp, TAU } from '../core/utils.js';
import { surfaceAt } from '../core/Surfaces.js';

const GRAVITY = 26;
const JUMP_SPEED = 8.9;
const RADIUS = 0.42;
const HEIGHT = 1.78;
const WALK_SPEED = 4.7;
const RUN_SPEED = 7.5;

/** The Restorer: a procedural stylised human with a hand-built rig and
 *  procedural idle/walk/run/jump animation, plus a capsule-vs-AABB controller. */
export class Player {
  constructor({ scene, camera, colliders, input, audio, vfx }) {
    this.scene = scene;
    this.camera = camera;
    this.colliders = colliders;
    this.input = input;
    this.audio = audio;
    this.vfx = vfx;

    this.position = new THREE.Vector3(0, 0.05, 32);
    this.velocity = new THREE.Vector3();
    this.facing = Math.PI;
    this.radius = RADIUS;
    this.height = HEIGHT;
    this.grounded = true;
    this.groundBox = null;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.airJumps = 0;
    this.surge = false;
    this.aiming = false;
    this.aimTargetYaw = Math.PI;
    this.controlEnabled = true;
    this.speed2D = 0;
    this.airBlend = 0;
    this.stepAccum = 0;
    this.stepSide = 1;
    this.surface = 'concrete';
    this.prevSurface = 'concrete';
    this.surfaceBlend = 0;
    this.fallTimer = 0;
    this.onFall = null;
    this.onLand = null;
    this.lastGroundY = 0;

    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    scene.add(this.group);

    this.character = null;
    this.bones = {};
    this.loaded = false;
    // The procedural rig is built facing +Z, matching the controller's facing.
    this.visualYawOffset = 0;

    // simple capsule placeholder until the model arrives
    const placeholder = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.36, 1.0, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.7, metalness: 0.3 })
    );
    placeholder.position.y = 0.9;
    placeholder.castShadow = true;
    this.group.add(placeholder);
    this.placeholder = placeholder;

    this.suitLightMat = new THREE.MeshBasicMaterial({ color: 0x49c8ff, toneMapped: false });
    this.aura = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1.05, 32),
      new THREE.MeshBasicMaterial({
        color: 0x5ff2e0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      })
    );
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.06;
    this.group.add(this.aura);
  }

  async load(onProgress) {
    // The Restorer is generated from procedural geometry, so there is nothing
    // to fetch. The rig, materials and animation system are ready immediately.
    this.character = new Restorer({ accentMaterial: this.suitLightMat });
    this.model = this.character.root;
    this.group.add(this.model);
    this.bones = this.character.bones;

    if (this.placeholder) {
      this.group.remove(this.placeholder);
      this.placeholder.geometry.dispose();
      this.placeholder.material.dispose();
      this.placeholder = null;
    }

    this.loaded = true;
    this.currentActionName = 'idle';
    onProgress?.(1);
  }
  setSurge(on) {
    this.surge = on;
    if (on) this.airJumps = 0;
  }

  setControl(enabled) {
    this.controlEnabled = enabled;
    if (!enabled) this.velocity.x = this.velocity.z = 0;
  }

  /** Shove the controller away from an impact (infected claws, blasts). */
  knockback(dx, dz, force = 3) {
    this.velocity.x += dx * force;
    this.velocity.z += dz * force;
    this.grounded = false;
  }

  teleport(pos, yaw = this.facing) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.facing = yaw;
    this.group.position.copy(pos);
    this.grounded = true;
    this.airJumps = 0;
    this.group.rotation.y = yaw + this.visualYawOffset;
  }

  get eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.5, this.position.z);
  }

  _findGround(x, z, feetY) {
    let best = null;
    let bestTop = -Infinity;
    for (const b of this.colliders.query(x, z, 1.4)) {
      if (x - this.radius * 0.75 >= b.maxX || x + this.radius * 0.75 <= b.minX) continue;
      if (z - this.radius * 0.75 >= b.maxZ || z + this.radius * 0.75 <= b.minZ) continue;
      const top = b.maxY;
      if (top <= feetY + 0.6 && top > bestTop && top >= feetY - 0.9) {
        bestTop = top;
        best = b;
      }
    }
    return best;
  }

  _resolveHorizontal() {
    const r = this.radius;
    for (let pass = 0; pass < 3; pass++) {
      let hit = false;
      for (const b of this.colliders.query(this.position.x, this.position.z, 1.6)) {
        // vertical overlap: ignore things below the knees (handled as steps)
        if (this.position.y + this.height <= b.minY + 0.02) continue;
        if (this.position.y + 0.42 >= b.maxY) continue;
        if (this.position.x + r <= b.minX || this.position.x - r >= b.maxX) continue;
        if (this.position.z + r <= b.minZ || this.position.z - r >= b.maxZ) continue;

        const stepUp = b.maxY - this.position.y;
        if (stepUp > 0 && stepUp <= 0.56 && (this.grounded || this.velocity.y <= 0.1)) {
          // walk up onto low ledges and stairs
          this.position.y = b.maxY;
          if (this.velocity.y < 0) this.velocity.y = 0;
          continue;
        }

        const px1 = b.maxX - (this.position.x - r);
        const px2 = this.position.x + r - b.minX;
        const pz1 = b.maxZ - (this.position.z - r);
        const pz2 = this.position.z + r - b.minZ;
        const min = Math.min(px1, px2, pz1, pz2);
        if (min === px1) this.position.x += px1 + 0.001;
        else if (min === px2) this.position.x -= px2 + 0.001;
        else if (min === pz1) this.position.z += pz1 + 0.001;
        else this.position.z -= pz2 + 0.001;
        hit = true;
      }
      if (!hit) break;
    }
  }

  update(dt) {
    if (!this.loaded) {
      this.group.position.copy(this.position);
      return;
    }
    dt = Math.min(dt, 0.05);

    const input = this.input;
    const cameraYaw = this.cameraRig ? this.cameraRig.yaw : Math.PI;
    const move = this.controlEnabled ? input.moveVector : { x: 0, z: 0 };
    const wantsRun = this.controlEnabled && input.isRunning;
    const surgeMult = this.surge ? 1.16 : 1;
    const aimMult = this.aiming ? 0.58 : 1;
    const maxSpeed = (wantsRun ? RUN_SPEED : WALK_SPEED) * surgeMult * aimMult;

    // camera relative desired direction
    const forward = { x: -Math.sin(cameraYaw), z: -Math.cos(cameraYaw) };
    const right = { x: Math.cos(cameraYaw), z: -Math.sin(cameraYaw) };
    let desiredX = forward.x * -move.z + right.x * move.x;
    let desiredZ = forward.z * -move.z + right.z * move.x;
    const mag = Math.hypot(desiredX, desiredZ);
    if (mag > 0.001) {
      desiredX /= mag;
      desiredZ /= mag;
    }
    const hasInput = mag > 0.001;

    // acceleration
    const accel = (this.grounded ? 38 : 14) * dt;
    if (hasInput) {
      this.velocity.x = damp(this.velocity.x, desiredX * maxSpeed, this.grounded ? 12 : 4, dt);
      this.velocity.z = damp(this.velocity.z, desiredZ * maxSpeed, this.grounded ? 12 : 4, dt);
    } else if (this.grounded) {
      const f = Math.exp(-11 * dt);
      this.velocity.x *= f;
      this.velocity.z *= f;
    } else {
      const f = Math.exp(-0.6 * dt);
      this.velocity.x *= f;
      this.velocity.z *= f;
    }

    // jump input buffering & coyote time
    if (this.controlEnabled && input.wasPressed('Space')) this.jumpBuffer = 0.14;
    this.jumpBuffer -= dt;
    this.coyote -= dt;
    if (this.grounded) {
      this.coyote = 0.12;
      this.airJumps = 0;
    }

    let jumped = false;
    if (this.jumpBuffer > 0 && this.controlEnabled) {
      if (this.grounded || this.coyote > 0) {
        this.velocity.y = JUMP_SPEED * (this.surge ? 1.08 : 1);
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        jumped = true;
        this.audio.jumpSound(this.surface, wantsRun ? 0.6 : 0.45);
        if (this.onNoise) this.onNoise(this.position.clone(), 7);
        this.vfx.burst(new THREE.Vector3(this.position.x, this.position.y + 0.1, this.position.z), {
          count: 8, color: 0xd8c8a8, speed: 1.6, life: 0.6, size: 0.3, gravity: -3, up: 0.6,
        });
      } else if (this.surge && this.airJumps < 1) {
        // Insight Surge grants one extra bounce - the city lifts you
        this.velocity.y = JUMP_SPEED * 0.94;
        this.airJumps = 1;
        this.jumpBuffer = 0;
        jumped = true;
        this.audio.jumpSound(this.surface, 0.55);
        this.vfx.ring(this.position.clone().setY(this.position.y + 0.4), { color: 0x5ff2e0, radius: 2.2, life: 0.7 });
      }
    }
    if (!input.isDown('Space') && this.velocity.y > 2) this.velocity.y -= 30 * dt;

    // gravity
    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -42) this.velocity.y = -42;

    const pos = this.position;
    const prevY = pos.y;
    pos.x += this.velocity.x * dt;
    pos.z += this.velocity.z * dt;
    this._resolveHorizontal();

    pos.y += this.velocity.y * dt;

    // head collision
    for (const b of this.colliders.query(pos.x, pos.z, 1.2)) {
      if (pos.x + this.radius <= b.minX || pos.x - this.radius >= b.maxX) continue;
      if (pos.z + this.radius <= b.minZ || pos.z - this.radius >= b.maxZ) continue;
      if (pos.y + this.height > b.minY && prevY + this.height <= b.minY + 0.05 && pos.y < b.minY) {
        pos.y = b.minY - this.height;
        this.velocity.y = Math.min(0, this.velocity.y);
      }
    }

    const ground = this._findGround(pos.x, pos.z, pos.y);
    const wasGrounded = this.grounded;
    if (ground && pos.y <= ground.maxY + 0.02 && this.velocity.y <= 0) {
      pos.y = ground.maxY;
      if (!wasGrounded && this.velocity.y < -7) {
        const impact = clamp(-this.velocity.y / 40, 0, 1);
        this.audio.landSound(surfaceAt(this.position), impact);
        if (this.onNoise) this.onNoise(this.position.clone(), 8 + impact * 14);
        if (this.onLand) this.onLand(impact);
        this.vfx.burst(pos.clone().setY(pos.y + 0.05), {
          count: 6 + Math.floor(impact * 12), color: 0xcfc2a8, speed: 2 + impact * 2,
          life: 0.7, size: 0.32, gravity: -2, up: 0.5,
        });
      }
      this.velocity.y = 0;
      this.grounded = true;
      this.groundBox = ground;
      this.lastGroundY = pos.y;
    } else {
      this.grounded = false;
      this.groundBox = null;
    }

    if (jumped) this.grounded = false;

    // fell out of the world
    if (pos.y < -14) {
      this.fallTimer += dt;
      if (this.fallTimer > 0.1) {
        this.fallTimer = 0;
        if (this.onFall) this.onFall();
      }
    }

    // facing
    const speed2D = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed2D = speed2D;
    if (this.aiming) {
      // Aiming squares the body up with the reticle, not just the camera yaw.
      const yaw = Number.isFinite(this.aimTargetYaw) ? this.aimTargetYaw : cameraYaw + Math.PI;
      this.facing = angleLerp(this.facing, yaw, 1 - Math.exp(-14 * dt));
    } else if (speed2D > 0.4) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      this.facing = angleLerp(this.facing, target, 1 - Math.exp(-12 * dt));
    }
    this.group.position.copy(pos);
    this.group.rotation.y = this.facing + this.visualYawOffset;

    // ---- surface under the boots -------------------------------------
    if (this.grounded) {
      const surf = surfaceAt(this.position);
      if (surf !== this.surface) {
        this.prevSurface = this.surface;
        this.surface = surf;
        this.surfaceBlend = 0.55;
      }
    }
    this.surfaceBlend = Math.max(0, this.surfaceBlend - dt);

    // ---- procedural animation ----
    this.airBlend = damp(this.airBlend, this.grounded ? 0 : 1, this.grounded ? 12 : 7, dt);
    if (this.character) {
      this.character.animate(dt, {
        speed: speed2D,
        grounded: this.grounded,
        airBlend: this.airBlend,
        vy: this.velocity.y,
        surge: this.surge,
      });
    }
    this.currentActionName = !this.grounded ? 'jump'
      : speed2D < 0.5 ? 'idle'
      : speed2D < WALK_SPEED + 1.1 ? 'walk' : 'run';
    // footsteps
    if (this.grounded && speed2D > 0.6) {
      this.stepAccum += speed2D * dt;
      const stride = (wantsRun ? 2.35 : 1.75) * (0.95 + Math.random() * 0.1);
      if (this.stepAccum > stride) {
        this.stepAccum = 0;
        this.stepSide *= -1;
        this.audio.footstep({
          surface: this.surface,
          blendSurface: this.surfaceBlend > 0.02 ? this.prevSurface : null,
          blend: this.surfaceBlend / 0.55,
          volume: wantsRun ? 0.5 : 0.34,
          speed: speed2D,
          pan: this.stepSide * 0.14,
        });
        if (this.onNoise) this.onNoise(this.position.clone(), wantsRun ? 13 : 5.5);
        if (wantsRun && Math.random() < 0.4) {
          this.vfx.burst(pos.clone().setY(pos.y + 0.06), {
            count: 2, color: 0xbfb4a0, speed: 0.9, life: 0.6, size: 0.2, gravity: 1.2, up: 0.4,
          });
        }
      }
    } else {
      this.stepAccum = Math.max(0, this.stepAccum - dt);
    }

    // surge aura
    const auraTarget = this.surge ? 0.55 : 0;
    this.aura.material.opacity = damp(this.aura.material.opacity, auraTarget, 5, dt);
    this.aura.position.y = 0.05 + Math.sin(performance.now() * 0.004) * 0.03;
    this.aura.rotation.z += dt * 0.6;
    this.suitLightMat.color.setHex(this.surge ? 0x9ff7ff : 0x49c8ff);
  }
}
