import * as THREE from 'three';
import { damp } from '../../core/utils.js';

/** The district relay every district must bring online. */
export class RelayPylon {
  constructor({ scene, vfx, audio, position, color = 0x5ff2e0, baseY = 0 }) {
    this.scene = scene;
    this.vfx = vfx;
    this.audio = audio;
    this.position = position.clone();
    this.color = color;
    this.baseY = baseY;
    this.powered = false;
    this.time = Math.random() * 5;
    this.rings = [];

    const x = position.x;
    const z = position.z;

    this.ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.22, toneMapped: false,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2 - i * 0.18, 0.055, 6, 36), this.ringMat.clone());
      ring.position.set(x, baseY + 1.7 + i * 1.75, z);
      ring.rotation.x = Math.PI / 2;
      scene.add(ring);
      this.rings.push(ring);
    }
    this.orbMat = new THREE.MeshStandardMaterial({
      color: 0x06181a, emissive: color, emissiveIntensity: 0.18, roughness: 0.25, metalness: 0.4,
    });
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 14), this.orbMat);
    this.orb.position.set(x, baseY + 7, z);
    scene.add(this.orb);
    this.light = new THREE.PointLight(color, 0, 24, 2);
    this.light.position.set(x, baseY + 6.8, z);
    scene.add(this.light);
    this.beamMesh = null;
  }

  build(b) {
    const { x, z } = this.position;
    const y = this.baseY;
    b.block('concreteDark', x, y, z, 4.6, 0.4, 4.6, { tile: 2 });
    b.block('concretePale', x, y + 0.4, z, 3.4, 0.3, 3.4, { tile: 2, collide: false });
    b.cylinder('metalDark', x, y + 0.65, z, 1.6, 2.0, 0.5, { seg: 12, collide: false });
    b.cylinder('metal', x, y + 3.9, z, 0.32, 0.9, 6.4, { seg: 10, collide: true });
    for (let i = 0; i < 3; i++) {
      b.cylinder('metalDark', x, y + 1.2 + i * 1.7, z, 1.15 - i * 0.14, 1.15 - i * 0.14, 0.12, { seg: 14, collide: false });
    }
  }

  activate(instant = false) {
    if (this.powered) return;
    this.powered = true;
    this.orbMat.emissiveIntensity = 2.6;
    this.light.intensity = 14;
    this.rings.forEach((r) => (r.material.opacity = 0.92));
    if (!instant) {
      this.vfx.fountain(this.position.clone().setY(this.baseY + 1), {
        count: 110, color: this.color, speed: 11, life: 2.2, size: 0.55,
      });
      this.audio.sfx('relay');
    }
    this.beamMesh = this.vfx.beam(
      new THREE.Vector3(this.position.x, this.baseY + 7, this.position.z),
      new THREE.Vector3(this.position.x, this.baseY + 95, this.position.z),
      { color: this.color, radius: 0.3, opacity: 0.6 }
    );
  }

  setPowered(v, instant = false) {
    if (v) this.activate(instant);
  }

  update(dt, restoration = 0) {
    this.time += dt;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.rotation.z += dt * (this.powered ? 0.5 + i * 0.25 : 0.12);
      r.rotation.x = Math.PI / 2 + Math.sin(this.time * 0.8 + i) * (this.powered ? 0.18 : 0.05);
    }
    this.orb.position.y = this.baseY + 7 + Math.sin(this.time * 1.5) * (this.powered ? 0.14 : 0.05);
    if (this.powered) {
      this.orbMat.emissiveIntensity = 2.2 + Math.sin(this.time * 3) * 0.4;
      this.light.intensity = damp(this.light.intensity, 12, 2, dt);
    }
  }
}
