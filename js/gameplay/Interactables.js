import * as THREE from 'three';
import { getGlowTexture } from '../world/Textures.js';

let uid = 0;

/**
 * World interaction points with floating holographic markers.
 * The manager exposes the nearest actionable point each frame.
 */
export class Interactables {
  constructor({ scene, vfx }) {
    this.scene = scene;
    this.vfx = vfx;
    this.items = [];
    this.time = 0;
    this.nearestItem = null;
    this.group = new THREE.Group();
    this.group.name = 'interactables';
    scene.add(this.group);

    this.geo = {
      ring: new THREE.TorusGeometry(0.52, 0.035, 8, 32),
      ground: new THREE.RingGeometry(0.6, 0.78, 36),
      beam: new THREE.CylinderGeometry(0.012, 0.05, 2.1, 6, 1, true),
      diamond: new THREE.OctahedronGeometry(0.15),
      orb: new THREE.SphereGeometry(0.1, 10, 8),
    };
  }

  add(def) {
    const id = def.id || `int_${++uid}`;
    const color = def.color ?? 0xffb347;
    const group = new THREE.Group();
    group.position.set(def.position.x, def.position.y ?? 0, def.position.z);
    group.rotation.y = def.markerRotation ?? 0;

    const mkMat = (opacity = 0.85) =>
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });

    const ringMat = mkMat(0.9);
    const ring = new THREE.Mesh(this.geo.ring, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);

    const groundMat = mkMat(0.35);
    const ground = new THREE.Mesh(this.geo.ground, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.03;
    group.add(ground);

    const beamMat = mkMat(0.3);
    const beam = new THREE.Mesh(this.geo.beam, beamMat);
    beam.position.y = 1.05;
    group.add(beam);

    const bob = new THREE.Group();
    bob.position.y = 2.2;
    const diamond = new THREE.Mesh(this.geo.diamond, mkMat(1));
    diamond.scale.set(1, 1.6, 1);
    bob.add(diamond);
    group.add(bob);

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(), color, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    sprite.scale.setScalar(1.5);
    sprite.position.y = 2.2;
    group.add(sprite);

    this.group.add(group);

    const item = {
      id,
      label: def.label || 'Interact',
      position: new THREE.Vector3(def.position.x, def.position.y ?? 0, def.position.z),
      radius: def.radius ?? 3.4,
      onInteract: def.onInteract,
      active: def.active !== false,
      done: !!def.done,
      visible: def.visible !== false,
      color,
      group, ring, ground, beam, bob, sprite,
      mats: [ringMat, groundMat, beamMat],
      phase: Math.random() * Math.PI * 2,
      def,
    };
    group.visible = item.visible;
    if (item.done) this._paint(item, 0x63ffa8, 0.5);
    this.items.push(item);
    return item;
  }

  _paint(item, color, opacity) {
    for (const m of item.mats) {
      m.color.setHex(color);
      m.opacity = opacity;
    }
    item.bob.children[0].material.color.setHex(color);
    item.sprite.material.color.setHex(color);
  }

  get(id) {
    return this.items.find((i) => i.id === id);
  }

  setActive(id, active) {
    const it = this.get(id);
    if (!it) return;
    it.active = active;
  }

  setVisible(id, visible) {
    const it = this.get(id);
    if (!it) return;
    it.visible = visible;
    it.group.visible = visible;
  }

  setLabel(id, label) {
    const it = this.get(id);
    if (it) it.label = label;
  }

  setDone(id, done = true) {
    const it = this.get(id);
    if (!it) return;
    it.done = done;
    this._paint(it, 0x63ffa8, 0.45);
    if (it.done) {
      it.ring.material.opacity = 0.18;
      it.ground.material.opacity = 0.12;
      it.beam.material.opacity = 0.1;
      it.bob.visible = false;
      it.sprite.material.opacity = 0.12;
    }
  }

  /** Center of the world for the HUD objective marker. */
  find(pos) {
    let best = null;
    let bestD = Infinity;
    for (const it of this.items) {
      if (!it.active || it.done || !it.visible) continue;
      const d = Math.hypot(pos.x - it.position.x, pos.z - it.position.z);
      if (d < it.radius + 2 && d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  update(dt) {
    this.time += dt;
    for (const it of this.items) {
      if (!it.visible) continue;
      const bobY = 2.2 + Math.sin(this.time * 2 + it.phase) * 0.12;
      it.bob.position.y = bobY;
      it.bob.rotation.y += dt * (it.done ? 0.2 : 1.1);
      it.sprite.position.y = bobY;
      it.ring.rotation.z += dt * 0.8;
      if (!it.done) {
        const pulse = 0.7 + Math.sin(this.time * 3 + it.phase) * 0.25;
        it.ring.material.opacity = 0.55 * pulse + 0.25;
        it.sprite.material.opacity = 0.3 + pulse * 0.25;
      }
    }
  }
}
