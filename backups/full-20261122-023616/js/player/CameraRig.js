import * as THREE from 'three';
import { clamp, damp, lerp, segmentBox } from '../core/utils.js';

/** Cinematic third-person orbit camera with wall collision + FOV kick.
 *  Right-click aiming swings it over the shoulder, tightens the lens and
 *  slows the look sensitivity so the reticle actually settles on a target. */
export class CameraRig {
  constructor(camera, colliders) {
    this.camera = camera;
    this.colliders = colliders;
    this.yaw = 0;
    this.pitch = 0.16;
    this.distance = 5.4;
    this.aimDistance = 3.5;
    this.currentDistance = 5.4;
    this.pivot = new THREE.Vector3();
    this.pivotTarget = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.baseFov = 62;
    this.fov = 62;
    this.aim = 0;
    this.kickPitch = 0;
    this.kickYaw = 0;
    this.cinematic = null;
    this.cinTime = 0;
    this.initialized = false;
    this.shakeOffset = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
  }

  /** Weapon kick: raises the point of aim for a few frames. */
  addRecoil(pitch = 0.03, yaw = 0) {
    this.kickPitch = Math.min(0.2, this.kickPitch + pitch);
    this.kickYaw = clamp(this.kickYaw + yaw, -0.05, 0.05);
  }

  update(dt, focus, input, opts = {}) {
    const { running = false, speed = 0, shake = null, paused = false, aiming = false } = opts;
    if (!paused && input) {
      const { dx, dy } = input.consumeMouse();
      const focusScale = 1 - this.aim * 0.4;
      this.yaw -= dx * focusScale;
      this.pitch = clamp(this.pitch + dy * focusScale, -0.45, 1.05);
    }

    this.aim = damp(this.aim, aiming ? 1 : 0, aiming ? 9 : 6, dt);
    this.kickPitch = damp(this.kickPitch, 0, 9, dt);
    this.kickYaw = damp(this.kickYaw, 0, 9, dt);

    // A small over-the-shoulder offset clears the Restorer's body without
    // pushing the aim axis far off the line the character is facing.
    const shoulder = this.aim * 0.12;
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    this.pivotTarget.copy(focus);
    this.pivotTarget.y += 1.5 + this.aim * 0.06;
    this.pivotTarget.x += rightX * shoulder;
    this.pivotTarget.z += rightZ * shoulder;
    if (!this.initialized) {
      this.pivot.copy(this.pivotTarget);
      this.initialized = true;
    } else {
      this.pivot.x = damp(this.pivot.x, this.pivotTarget.x, 14, dt);
      this.pivot.y = damp(this.pivot.y, this.pivotTarget.y, 9, dt);
      this.pivot.z = damp(this.pivot.z, this.pivotTarget.z, 14, dt);
    }

    if (this.cinematic) {
      this._updateCinematic(dt);
      return;
    }

    const yaw = this.yaw + this.kickYaw;
    const pitch = clamp(this.pitch - this.kickPitch, -0.55, 1.1);
    const cosP = Math.cos(pitch);
    const dir = this._tmpDir.set(
      Math.sin(yaw) * cosP,
      Math.sin(pitch),
      Math.cos(yaw) * cosP
    ).normalize();

    const wanted = lerp(this.distance, this.aimDistance, this.aim) *
      (running && this.aim < 0.5 ? 1.06 : 1);
    const camPos = this.desired.copy(this.pivot).addScaledVector(dir, wanted);

    // camera collision: pull in when a wall is between pivot and camera
    let minT = 1;
    const ox = this.pivot.x, oy = this.pivot.y, oz = this.pivot.z;
    const dx = camPos.x - ox, dy = camPos.y - oy, dz = camPos.z - oz;
    for (const b of this.colliders.query(this.pivot.x, this.pivot.z, wanted + 2)) {
      if (b.minY > this.pivot.y + 1.2 && b.minY > camPos.y) continue;
      const t = segmentBox(ox, oy, oz, dx, dy, dz, b, 1);
      if (t < minT) minT = t;
    }
    const safeDist = Math.max(1.2, Math.min(wanted, wanted * minT - 0.35));
    this.currentDistance = damp(this.currentDistance, safeDist, minT < 1 ? 22 : 7, dt);
    camPos.copy(this.pivot).addScaledVector(dir, this.currentDistance);
    camPos.y += 0.15;

    this.camera.position.x = damp(this.camera.position.x, camPos.x, 26, dt);
    this.camera.position.y = damp(this.camera.position.y, camPos.y, 22, dt);
    this.camera.position.z = damp(this.camera.position.z, camPos.z, 26, dt);

    if (shake) this.camera.position.add(shake);

    // While aiming, look at a point a few metres ahead at shoulder height.
    // Looking straight at the pivot aims the centre ray steeply downward, so
    // the crosshair would rest at knee height on anything past a few metres.
    this.lookAt.copy(this.pivot);
    this.lookAt.y += 0.1;
    if (this.aim > 0.001) {
      this.lookAt.x -= Math.sin(this.yaw) * 3.5 * this.aim;
      this.lookAt.z -= Math.cos(this.yaw) * 3.5 * this.aim;
    }
    this.camera.lookAt(this.lookAt);

    const targetFov = this.baseFov + (running ? 8 : 0) + Math.min(4, speed * 0.3) - this.aim * 11;
    this.fov = damp(this.fov, targetFov, 6, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  startCinematic(target, { radius = 14, height = 8, speed = 0.25, angle = 0, lookHeight = 3 } = {}) {
    this.cinematic = {
      target: target.clone(),
      radius, height, speed, angle, lookHeight,
      blend: 0,
      fromPos: this.camera.position.clone(),
    };
    this.cinTime = 0;
  }

  stopCinematic() {
    this.cinematic = null;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  _updateCinematic(dt) {
    this.cinTime += dt;
    const c = this.cinematic;
    c.angle += dt * c.speed;
    c.blend = Math.min(1, c.blend + dt * 0.7);
    const orbit = new THREE.Vector3(
      c.target.x + Math.cos(c.angle) * c.radius,
      c.target.y + c.height + Math.sin(this.cinTime * 0.4) * 1.2,
      c.target.z + Math.sin(c.angle) * c.radius
    );
    this.camera.position.lerpVectors(c.fromPos, orbit, c.blend);
    this.camera.position.y = damp(this.camera.position.y, orbit.y, 2, dt);
    this.lookAt.set(c.target.x, c.target.y + c.lookHeight, c.target.z);
    this.camera.lookAt(this.lookAt);
    this.fov = damp(this.fov, 48, 1.5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
