import * as THREE from 'three';
import { Builder } from '../Builder.js';
import { RelayPylon } from './RelayPylon.js';
import { damp, clamp } from '../../core/utils.js';

const CORRECT = [2, 1, 3];
const DIR_NAMES = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

export class WaterDistrict {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.builder = new Builder(this.materials, this.colliders);
    this.nodes = [];
    this.pumpOn = false;
    this.relayOn = false;
    this.restored = false;
    this.zone = { x: -72, z: 0, r: 24 };
    this.checkpoint = { name: 'Water Station', position: new THREE.Vector3(-56, 0.16, 0), yaw: -Math.PI / 2 };
    this.time = 0;
    this.jetTimer = 0;
    this.blend = 0;
    this.correctCount = 0;
  }

  build() {
    const b = this.builder;

    // ---- reclamation station building -------------------------------
    b.block('facadePale', -93, 0, -10, 14, 12, 20, { tile: 9 });
    b.block('concreteDark', -93, 12, -10, 14.6, 0.6, 20.6, { tile: 5, collide: false });
    b.block('facadePale', -93, 12.6, -14, 8, 5, 8, { tile: 8 });
    b.cylinder('metal', -93, 19.4, -14, 2.1, 2.4, 3.2, { seg: 14, collide: false });
    b.cylinder('metalDark', -93, 21.4, -14, 0.2, 0.3, 1.2, { seg: 6, collide: false });
    // station windows
    this.stationMat = new THREE.MeshStandardMaterial({
      color: 0x051012, emissive: 0x49d7e8, emissiveIntensity: 0.05, roughness: 0.3, metalness: 0.5,
    });
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.8), this.stationMat);
      w.position.set(-85.9, 5 + i * 2.6, -10);
      w.rotation.y = Math.PI / 2;
      this.scene.add(w);
    }
    // entry arch
    b.block('metalDark', -86, 0, -18, 1, 5.4, 1, { tile: 2 });
    b.block('metalDark', -86, 0, -2, 1, 5.4, 1, { tile: 2 });
    b.block('metalDark', -86, 5.2, -10, 1.2, 0.5, 17, { collide: false, tile: 2 });

    // ---- fountain ----------------------------------------------------
    const R = 7.2;
    b.cylinder('concretePale', -72, 0.45, 0, R, R + 0.3, 0.9, { seg: 40, collide: false, openEnded: true, tile: 3 });
    const rim = new THREE.RingGeometry(R - 0.5, R + 0.5, 48);
    rim.rotateX(-Math.PI / 2);
    b.add('concretePale', rim, -72, 0.9, 0);
    const inner = new THREE.RingGeometry(R - 0.5, R - 0.35, 48);
    inner.rotateX(-Math.PI / 2);
    b.add('concreteDark', inner, -72, 0.88, 0);
    // basin floor
    b.plate('concreteDark', -72, 0.06, 0, 13.4, 13.4, { tile: 4 });
    // circular collision ring (12 chunks)
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.colliders.add(
        -72 + Math.cos(a) * R - 0.7, 0, Math.sin(a) * R - 0.7,
        -72 + Math.cos(a) * R + 0.7, 0.95, Math.sin(a) * R + 0.7
      );
    }
    // central tiers
    b.cylinder('concretePale', -72, 0.55, 0, 2.0, 2.4, 1.1, { seg: 20, collide: false });
    b.cylinder('concretePale', -72, 1.4, 0, 2.8, 2.0, 0.35, { seg: 20, collide: false });
    b.cylinder('concreteDark', -72, 2.4, 0, 0.5, 0.8, 1.7, { seg: 10, collide: false });
    b.cylinder('concretePale', -72, 3.3, 0, 1.3, 0.5, 0.3, { seg: 14, collide: false });

    // animated water disc
    this.waterMat = this.materials.water.clone();
    this.waterMat.transparent = true;
    this.waterMat.opacity = 0.0;
    this.water = new THREE.Mesh(new THREE.CircleGeometry(R - 0.45, 48), this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(-72, 0.62, 0);
    this.water.scale.setScalar(0.02);
    this.scene.add(this.water);

    this.jetMat = new THREE.MeshBasicMaterial({
      color: 0xbfe9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    });
    this.jet = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.3, 3.4, 10, 1, true), this.jetMat);
    this.jet.position.set(-72, 3.2, 0);
    this.scene.add(this.jet);
    this.fountainLight = new THREE.PointLight(0x9fe8ff, 0, 22, 2);
    this.fountainLight.position.set(-72, 3.6, 0);
    this.scene.add(this.fountainLight);

    // dry puddles & cracked drains
    for (const [x, z, s] of [[-80, 9, 3.4], [-64, -9, 2.6], [-86, 12, 2.2], [-58, 8, 1.8]]) {
      b.plate('water', x, 0.03, z, s, s * 0.7, { tile: 3, ry: Math.random() * 3 });
    }

    // ---- conduit nodes ----------------------------------------------
    const nodePos = [[-72, -13], [-84, 5], [-60, 5]];
    nodePos.forEach(([x, z], i) => this._createNode(b, x, z, i));

    // cable runs between nodes and pump
    for (const [x, z] of nodePos) {
      b.strut('metalDark', new THREE.Vector3(x, 0.2, z), new THREE.Vector3(x, 0.2, z - 6), 0.1);
      b.box('metalDark', x, 0.18, z - 3, 0.3, 0.36, 6, { collide: false });
    }

    // ---- pump housing ------------------------------------------------
    const px = -72, pz = -19;
    b.block('metalDark', px, 0, pz, 5, 2.6, 3.4, { tile: 3 });
    b.block('concreteDark', px, 0, pz, 6, 0.3, 4.4, { tile: 3 });
    b.cylinder('metal', px - 1.8, 2.6, pz, 0.55, 0.7, 2.4, { seg: 12, collide: false });
    b.cylinder('metal', px + 1.8, 2.6, pz, 0.55, 0.7, 2.4, { seg: 12, collide: false });
    b.strut('metalDark', new THREE.Vector3(px - 1.8, 4.9, pz), new THREE.Vector3(px + 1.8, 4.9, pz), 0.16);
    b.strut('metalDark', new THREE.Vector3(px, 2.2, pz + 1.7), new THREE.Vector3(px, 2.2, pz + 6.4), 0.35);

    this.pumpMat = new THREE.MeshStandardMaterial({
      color: 0x05100f, emissive: 0x49d7e8, emissiveIntensity: 0.05, roughness: 0.25, metalness: 0.5,
    });
    const pumpScreen = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.2), this.pumpMat);
    pumpScreen.position.set(px, 1.8, pz + 1.74);
    pumpScreen.rotation.y = 0;
    this.scene.add(pumpScreen);

    // ---- relay -------------------------------------------------------
    this.relay = new RelayPylon({
      scene: this.scene, vfx: this.vfx, audio: this.audio,
      position: new THREE.Vector3(-88, 0, 14), color: 0x5ff2e0,
    });
    this.relay.build(b);
    this.relayPos = this.relay.position;

    // ---- interactables ----------------------------------------------
    this.nodes.forEach((node, i) => {
      node.item = this.interactables.add({
        id: `water_node_${i}`,
        label: 'Rotate Conduit Node',
        position: new THREE.Vector3(node.x, 1.6, node.z),
        radius: 3.2,
        color: 0x5ff2e0,
        onInteract: () => this._rotateNode(node),
      });
    });

    this.pumpItem = this.interactables.add({
      id: 'water_pump',
      label: 'Engage Reclamation Pump',
      position: new THREE.Vector3(px, 0, pz + 2.4),
      radius: 3.6,
      color: 0x5ff2e0,
      active: false,
      onInteract: () => this._activatePump(),
    });
    this.interactables.setVisible('water_pump', false);

    this.relayItem = this.interactables.add({
      id: 'water_relay',
      label: 'Power Aqua Relay',
      position: new THREE.Vector3(-88, 0, 14),
      radius: 3.6,
      color: 0x5ff2e0,
      active: false,
      onInteract: () => this._activateRelay(),
    });
    this.interactables.setVisible('water_relay', false);

    this.builder.build(this.scene, 'water');
  }

  _createNode(b, x, z, i) {
    b.cylinder('concreteDark', x, 0.2, z, 1.25, 1.45, 0.4, { seg: 14, collide: true });
    b.cylinder('concretePale', x, 0.55, z, 1.05, 1.15, 0.5, { seg: 14, collide: true });
    b.cylinder('metalDark', x, 1.05, z, 0.84, 0.94, 0.5, { seg: 12, collide: true });
    b.cylinder('metal', x, 1.35, z, 0.72, 0.78, 0.14, { seg: 12, collide: false });

    const group = new THREE.Group();
    group.position.set(x, 1.62, z);
    this.scene.add(group);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x0a2226, emissive: 0x2a6d74, emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.7,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.1, 10, 28), ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    const armMat = new THREE.MeshStandardMaterial({
      color: 0x0a2226, emissive: 0x5ff2e0, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.6,
    });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.62), armMat);
    arm.position.z = -0.36;
    group.add(arm);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), armMat);
    head.position.z = -0.72;
    head.rotation.x = -Math.PI / 2;
    group.add(head);

    // painted target arrow on the pedestal (a subtle diegetic clue)
    const paint = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x8fd8d8, transparent: true, opacity: 0.18, toneMapped: false })
    );
    paint.rotation.x = -Math.PI / 2;
    paint.position.set(0, 0.4, 0);
    paint.rotation.z = -(CORRECT[i] / 4) * Math.PI * 2;
    group.add(paint);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x5ff2e0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    glow.scale.setScalar(3.6);
    glow.position.set(x, 2.4, z);
    this.scene.add(glow);

    this.nodes.push({
      x, z, index: i, rot: 0, correct: CORRECT[i],
      group, ring, ringMat, armMat, head, glow,
      solved: false, item: null, beam: null, anim: 0, targetRot: 0,
    });

    this.colliders.add(x - 1.3, 0, z - 1.3, x + 1.3, 1.6, z + 1.3);
  }

  _rotateNode(node) {
    if (this.pumpOn) return;
    node.rot = (node.rot + 1) % 4;
    node.targetRot = (node.rot / 4) * Math.PI * 2;
    this.audio.sfx('rotate');
    this.vfx.burst(new THREE.Vector3(node.x, 1.8, node.z), {
      count: 8, color: 0x5ff2e0, speed: 2.2, life: 0.6, size: 0.22, gravity: 1,
    });
    const solved = node.rot === node.correct;
    if (solved && !node.solved) {
      node.solved = true;
      node.ringMat.emissive.setHex(0x63ffa8);
      node.armMat.emissive.setHex(0x63ffa8);
      node.glow.material.color.setHex(0x63ffa8);
      node.glow.material.opacity = 0.35;
      this.vfx.fountain(new THREE.Vector3(node.x, 1.9, node.z), {
        count: 34, color: 0x63ffa8, speed: 5.5, life: 1.2, size: 0.34,
      });
      this.audio.sfx('energy');
      node.beam = this.vfx.beam(
        new THREE.Vector3(node.x, 1.65, node.z),
        new THREE.Vector3(-72, 1.8, -17),
        { color: 0x63ffa8, radius: 0.03, opacity: 0.45 }
      );
    } else if (!solved && node.solved) {
      node.solved = false;
      node.ringMat.emissive.setHex(0x2a6d74);
      node.armMat.emissive.setHex(0x5ff2e0);
      node.glow.material.opacity = 0;
      this.vfx.remove(node.beam);
      node.beam = null;
    }
    this.correctCount = this.nodes.filter((n) => n.solved).length;
    if (this.missions.index === 2) {
      this.missions.setObjectiveText('nodes', `Align the conduit nodes (${this.correctCount}/3)`);
    }
    if (!solved) {
      this.audio.sfx('deny');
      this.sparks.struggle('water_nodes', 1);
    }
    if (this.correctCount === 3) this._solved();
  }

  _solved() {
    if (this.pumpOn) return;
    this.ui.subtitle('RELAY', 'Flow restored to the pump housing. Engage it — carefully.', 5500);
    this.pumpItem.active = true;
    this.interactables.setActive('water_pump', true);
    this.interactables.setVisible('water_pump', true);
    if (this.missions.index === 2) this.missions.completeObjective('nodes');
    this.vfx.ring(new THREE.Vector3(-72, 0.1, -14), { color: 0x63ffa8, radius: 8, life: 1.6 });
    this.audio.sfx('activate');
  }

  _activatePump() {
    if (this.pumpOn) return;
    if (this.correctCount < 3) {
      this.ui.toast('THE CONDUITS ARE NOT ALIGNED');
      this.audio.sfx('deny');
      return;
    }
    this.pumpOn = true;
    this.interactables.setDone('water_pump');
    this.pumpMat.emissiveIntensity = 1.5;
    this.stationMat.emissiveIntensity = 0.9;
    this.audio.sfx('water');
    this.audio.startWaterLoop();
    this.vfx.fountain(new THREE.Vector3(-72, 1.4, 0), { count: 90, color: 0xbfe9ff, speed: 8, life: 2, size: 0.5 });
    this.ui.subtitle('RELAY', 'Water. Actual, moving, alive water. The fountain is remembering itself.', 6500);
    this.vegetation.grow('water');
    this.interactables.setVisible('water_relay', true);
    this.interactables.setActive('water_relay', true);
    this.relayItem.active = true;
    if (this.missions.index === 2) this.missions.completeObjective('pump');
  }

  _activateRelay() {
    if (this.relayOn) return;
    if (!this.pumpOn) {
      this.ui.toast('ENGAGE THE PUMP FIRST');
      this.audio.sfx('deny');
      return;
    }
    this.relayOn = true;
    this.relay.activate();
    this.interactables.setDone('water_relay');
    this.ui.subtitle('RELAY', 'Aqua District online. The city is learning to breathe again.', 6000);
    if (this.missions.index === 2) this.missions.completeObjective('relay');
    this.restore();
    this.onRestored('water');
  }

  restore(instant = false) {
    if (this.restored) return;
    this.restored = true;
    this.pumpOn = true;
    this.relayOn = true;
    this.pumpMat.emissiveIntensity = 1.5;
    this.stationMat.emissiveIntensity = 0.9;
    this.relay.setPowered(true, instant);
    this.interactables.setDone('water_pump');
    this.interactables.setDone('water_relay');
    this.nodes.forEach((n) => {
      n.solved = true;
      n.rot = n.correct;
      n.targetRot = (n.rot / 4) * Math.PI * 2;
      n.ringMat.emissive.setHex(0x63ffa8);
      n.armMat.emissive.setHex(0x63ffa8);
      n.glow.material.color.setHex(0x63ffa8);
      n.glow.material.opacity = 0.35;
      this.interactables.setDone(n.item.id);
    });
    this.correctCount = 3;
    this.waterMat.opacity = 0.82;
    this.water.scale.setScalar(1);
    this.jetMat.opacity = 0.55;
    this.fountainLight.intensity = 10;
    this.vegetation.grow('water', instant);
    if (!instant) this.audio.startWaterLoop();
  }

  enter() {
    if (this.missions.index === 2 && !this.missions.status.reach) {
      this.missions.completeObjective('reach');
      this.ui.subtitle('RELAY', 'Three conduit nodes, one pump. Turn each node until its arrow feeds the fountain.', 7000);
    }
    this.sparks.setActive('water_nodes', true);
  }

  _syncObjectives(playerPos) {
    if (this.missions.index !== 2) return;
    if (!this.missions.status.reach && playerPos && playerPos.x < -50) this.missions.completeObjective('reach');
    if (this.correctCount === 3 && !this.missions.status.nodes) this.missions.completeObjective('nodes');
    if (this.pumpOn && !this.missions.status.pump) this.missions.completeObjective('pump');
    if (this.relayOn && !this.missions.status.relay) this.missions.completeObjective('relay');
  }

  update(dt, playerPos) {
    this.time += dt;
    for (const n of this.nodes) {
      n.group.rotation.y = damp(n.group.rotation.y, n.targetRot, 7, dt);
      if (n.solved) {
        n.ringMat.emissiveIntensity = 0.9 + Math.sin(this.time * 3 + n.index) * 0.25;
        n.glow.material.opacity = 0.3 + Math.sin(this.time * 2.4 + n.index) * 0.12;
      }
    }
    if (this.pumpOn) {
      this.blend = Math.min(1, this.blend + dt * 0.8);
      this.waterMat.opacity = 0.82 * this.blend;
      this.water.scale.setScalar(0.02 + this.blend * 0.98);
      this.jetMat.opacity = 0.5 * this.blend;
      this.fountainLight.intensity = 10 * this.blend;
      this.waterMat.map.offset.y += dt * 0.05;
      if (this.waterMat.normalMap) this.waterMat.normalMap.offset.x += dt * 0.03;
      this.jetTimer += dt;
      if (this.jetTimer > 0.06) {
        this.jetTimer = 0;
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          this.vfx.burst(new THREE.Vector3(-72 + Math.cos(a) * 0.3, 4.6, Math.sin(a) * 0.3), {
            count: 2, color: 0xbfe9ff, speed: 1.8, life: 1.3, size: 0.3, gravity: -9, up: 1,
          });
        }
      }
    }
    this.relay.update(dt);
    this._syncObjectives(playerPos);
  }

  getState() {
    return {
      rotations: this.nodes.map((n) => n.rot),
      pumpOn: this.pumpOn,
      relayOn: this.relayOn,
      restored: this.restored,
    };
  }

  setState(s) {
    if (!s) return;
    if (s.restored) {
      this.restore(true);
      return;
    }
    if (s.rotations) {
      this.nodes.forEach((n, i) => {
        n.rot = s.rotations[i] ?? 0;
        n.targetRot = (n.rot / 4) * Math.PI * 2;
        n.group.rotation.y = n.targetRot;
        if (n.rot === n.correct) {
          n.solved = true;
          n.ringMat.emissive.setHex(0x63ffa8);
          n.armMat.emissive.setHex(0x63ffa8);
          n.glow.material.opacity = 0.35;
          this.interactables.setDone(n.item.id);
          n.beam = this.vfx.beam(
            new THREE.Vector3(n.x, 1.65, n.z),
            new THREE.Vector3(-72, 1.8, -17),
            { color: 0x63ffa8, radius: 0.03, opacity: 0.45 }
          );
        }
      });
      this.correctCount = this.nodes.filter((n) => n.solved).length;
      if (this.correctCount > 0 && this.missions.index === 2) {
        this.missions.setObjectiveText('nodes', `Align the conduit nodes (${this.correctCount}/3)`);
      }
    }
    if (s.pumpOn) {
      this.pumpOn = true;
      this.pumpMat.emissiveIntensity = 1.5;
      this.interactables.setDone('water_pump');
      this.waterMat.opacity = 0.82;
      this.water.scale.setScalar(1);
      this.jetMat.opacity = 0.5;
      this.fountainLight.intensity = 10;
      this.blend = 1;
      this.interactables.setVisible('water_relay', true);
      this.interactables.setActive('water_relay', true);
      this.vegetation.grow('water', true);
    }
    if (s.relayOn) {
      this.relayOn = true;
      this.relay.setPowered(true, true);
      this.interactables.setDone('water_relay');
    }
  }
}
