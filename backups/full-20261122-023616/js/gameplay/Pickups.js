import * as THREE from 'three';
import { getGlowTexture } from '../world/Textures.js';

/**
 * Floating energy motes and mission energy cells.
 * Pickups are collected by proximity - no failure state, ever.
 */
export class Pickup {
  constructor({ scene, position, color = 0xffb347, kind = 'mote', onCollect, audio, vfx, label = 'ENERGY' }) {
    this.scene = scene;
    this.kind = kind;
    this.color = color;
    this.onCollect = onCollect;
    this.audio = audio;
    this.vfx = vfx;
    this.label = label;
    this.collected = false;
    this.time = Math.random() * 10;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a06,
      emissive: color,
      emissiveIntensity: 2.2,
      metalness: 0.4,
      roughness: 0.25,
    });
    const size = kind === 'cell' ? 0.34 : 0.22;
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0), coreMat);
    this.core.scale.y = 1.5;
    this.group.add(this.core);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(), color, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    halo.scale.setScalar(kind === 'cell' ? 2.4 : 1.5);
    this.group.add(halo);
    this.halo = halo;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(kind === 'cell' ? 0.55 : 0.35, 0.018, 6, 28),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    this.group.add(ring);
    this.ring = ring;

    this.light = new THREE.PointLight(color, kind === 'cell' ? 4 : 1.6, 7, 2);
    this.group.add(this.light);
    this.baseY = position.y;
  }

  collect(silent = false) {
    if (this.collected) return false;
    this.collected = true;
    this.group.visible = false;
    this.light.intensity = 0;
    if (!silent) {
      this.vfx.burst(this.group.position, {
        count: 34, color: this.color, speed: 5.5, life: 1.3, size: 0.5, gravity: -2,
      });
      this.vfx.ring(this.group.position, { color: this.color, radius: 2.2, life: 0.9 });
      this.audio.sfx(this.kind === 'cell' ? 'cell' : 'pickup');
      if (this.onCollect) this.onCollect(this);
    }
    return true;
  }

  setCollected(collected) {
    this.collected = collected;
    this.group.visible = !collected;
  }

  update(dt, playerPos) {
    if (this.collected) return;
    this.time += dt;
    this.group.position.y = this.baseY + Math.sin(this.time * 2.2) * 0.14;
    this.core.rotation.y += dt * 1.4;
    this.ring.rotation.z += dt * 0.9;
    this.ring.rotation.x = -Math.PI / 2 + Math.sin(this.time * 1.2) * 0.25;
    this.light.intensity = (this.kind === 'cell' ? 4 : 1.6) * (0.8 + Math.sin(this.time * 3) * 0.2);
    const d = Math.hypot(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z);
    const dy = Math.abs(playerPos.y + 0.9 - this.group.position.y);
    if (d < 1.7 && dy < 2.2) this.collect();
  }
}
