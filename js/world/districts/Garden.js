import * as THREE from 'three';
import { Builder } from '../Builder.js';
import { RelayPylon } from './RelayPylon.js';
import { Pickup } from '../../gameplay/Pickups.js';
import { damp, clamp } from '../../core/utils.js';
import { RESTORER_RECORDING } from '../../story/Story.js';

const LIFT_BOTTOM = 0.25;
const LIFT_TOP = 6.95;
const CYCLE = 14;

export class GardenDistrict {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.builder = new Builder(this.materials, this.colliders);
    this.cells = 0;
    this.liftPowered = false;
    this.bloomOn = false;
    this.relayOn = false;
    this.restored = false;
    this.zone = { x: 0, z: 88, r: 30 };
    this.checkpoint = { name: 'Overgrown Courtyard', position: new THREE.Vector3(0, 0.16, 58), yaw: Math.PI };
    this.time = 0;
    this.cellPickups = [];
    this.liftPhase = 0;
    this.liftY = LIFT_BOTTOM;
    this.liftDelta = 0;
    this.canopyScale = 0.001;
    this.canopyTarget = 0.001;
    this.bloomTimer = 0;
    this.recordingPlayed = false;
    this.cityLightsOn = false;
  }

  build() {
    const b = this.builder;

    // ---- courtyard walls --------------------------------------------
    const wall = (cx, cz, w, d, h = 5.4) => {
      b.block('facadePale', cx, 0, cz, w, h, d, { tile: 8 });
      b.block('concreteDark', cx, h, cz, w + 0.3, 0.35, d + 0.3, { tile: 4, collide: false });
      // broken crenellations
      for (let i = 0; i < 6; i++) {
        b.box('concretePale', cx + (Math.random() - 0.5) * w, h + 0.4, cz + (Math.random() - 0.5) * d,
          1 + Math.random() * 2, 0.4 + Math.random() * 1.2, 1 + Math.random() * 2, { collide: false });
      }
    };
    wall(0, 114.5, 50, 1.4);
    wall(-25, 89, 1.4, 51);
    wall(25, 89, 1.4, 51);
    wall(-15.5, 62, 19, 1.4);
    wall(15.5, 62, 19, 1.4);
    // buttresses
    for (const z of [70, 84, 98, 110]) {
      b.block('concreteDark', -25, 0, z, 2.6, 4.6, 1.8, { tile: 3 });
      b.block('concreteDark', 25, 0, z, 2.6, 4.6, 1.8, { tile: 3 });
    }

    // courtyard soil
    b.plate('ground', 0, 0.06, 88, 46, 48, { tile: 5 });
    for (let i = 0; i < 10; i++) {
      b.plate('concretePale', -20 + i * 4.4, 0.07, 66 + (i % 2) * 2, 3.2, 2.2, { tile: 3, ry: 0.1 });
    }
    // dry flower beds
    for (const [x, z, w, d] of [[-12, 74, 6, 3], [12, 84, 5, 8], [-14, 92, 4, 6], [6, 100, 7, 4]]) {
      b.block('concreteDark', x, 0, z, w, 0.45, d, { tile: 2 });
      b.block('ground', x, 0.43, z, w - 0.4, 0.06, d - 0.4, { collide: false, tile: 1 });
    }

    // ---- central dead tree ------------------------------------------
    this.tree = new THREE.Group();
    this.tree.position.set(0, 0, 92);
    this.scene.add(this.tree);
    b.cylinder('bark', 0, 3.6, 92, 0.7, 1.5, 7.2, { seg: 10, collide: true, tile: 3 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const y = 4.4 + i * 0.4;
      b.strut('bark', new THREE.Vector3(0, y, 92),
        new THREE.Vector3(Math.cos(a) * (2.6 + i * 0.25), y + 2.4, 92 + Math.sin(a) * (2.6 + i * 0.25)), 0.24);
    }
    this.canopy = new THREE.Group();
    this.canopy.position.set(0, 0, 92);
    const canopyMat = new THREE.MeshStandardMaterial({
      map: this.materials.foliage.map, color: 0x5c8a44, roughness: 0.95, metalness: 0, flatShading: true,
    });
    const blobs = [
      [0, 9.6, 0, 3.6], [2.8, 8.4, 1.2, 2.6], [-3.0, 8.6, -1.0, 2.5],
      [1.2, 11.4, -1.4, 2.4], [-1.8, 10.6, 2.0, 2.3], [0.4, 8.2, -3.2, 2.1],
    ];
    for (const [x, y, z, r] of blobs) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), canopyMat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.canopy.add(m);
    }
    this.canopy.scale.setScalar(0.001);
    this.scene.add(this.canopy);

    // ---- greenhouse --------------------------------------------------
    for (const x of [-18, -10]) {
      for (const z of [96, 104]) {
        b.box('metalDark', x, 2, z, 0.14, 4, 0.14, { collide: false });
      }
    }
    const glassMat = this.materials.glass.clone();
    glassMat.transparent = true;
    glassMat.opacity = 0.35;
    for (let i = 0; i < 3; i++) {
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 4.6), glassMat);
      roof.position.set(-14, 4.2 + i * 0.35, 97.5 + i * 2.4);
      roof.rotation.x = -Math.PI / 2 + 0.18;
      this.scene.add(roof);
    }
    for (const z of [96, 104]) {
      b.block('ground', -14, 0, z - 0.2, 8, 0.4, 1.6, { tile: 1 });
    }
    for (let i = 0; i < 4; i++) {
      b.box('concreteDark', -17 + i * 2.2, 0.6, 100, 1.6, 1.2, 1.2, { collide: false });
    }

    // ---- wrecked bus with a cell on the roof ------------------------
    const busX = 16, busZ = 73;
    b.block('tealPaint', busX, 0.35, busZ, 2.8, 2.5, 8.4, { tile: 3 });
    b.block('concreteDark', busX, 0.36, busZ, 2.9, 0.7, 8.3, { tile: 2, collide: false });
    b.block('cream', busX, 2.85, busZ, 2.6, 0.2, 8.2, { tile: 2, collide: false });
    for (let i = 0; i < 4; i++) {
      b.box('glassDark', busX + 1.41, 1.9, busZ - 3 + i * 2, 0.06, 1, 1.5, { collide: false });
      b.box('glassDark', busX - 1.41, 1.9, busZ - 3 + i * 2, 0.06, 1, 1.5, { collide: false });
    }
    this.colliders.add(busX - 1.45, 0, busZ - 4.2, busX + 1.45, 3.05, busZ + 4.2);
    for (const [x, z] of [[-1.4, 2.8], [1.4, 2.8], [-1.4, -2.8], [1.4, -2.8]]) {
      b.cylinder('rubber', busX + x, 0.4, busZ + z, 0.42, 0.42, 0.3, { seg: 10, axis: 'x', collide: false });
    }

    // crate stair up to the bus roof
    for (let i = 0; i < 4; i++) {
      b.block(i % 2 ? 'rustPaint' : 'cream', 12.2, 0, 72 + i * 0.2, 2.0, 0.55 + i * 0.6, 2.0, { tile: 1.6 });
    }

    // ---- ledge with the third cell ----------------------------------
    b.block('concretePale', 20, 2.7, 104, 6.4, 0.6, 5, { tile: 3 });
    b.block('concreteDark', 20, 0, 104, 2, 2.7, 2, { tile: 3, collide: false });
    for (let i = 0; i < 4; i++) {
      b.block(i % 2 ? 'cream' : 'rustPaint', 15.2, 0, 100 + i * 0.2, 1.8, 0.55 + i * 0.6, 1.8, { tile: 1.6 });
    }

    // rubble hiding the second cell
    for (let i = 0; i < 9; i++) {
      b.box('concrete', -16 + (Math.random() - 0.5) * 5, Math.random() * 0.7, 84 + (Math.random() - 0.5) * 5,
        0.6 + Math.random() * 1.8, 0.3 + Math.random() * 1.2, 0.6 + Math.random() * 1.6,
        { ry: Math.random() * 3, collide: false });
    }

    // ---- lift + terrace ---------------------------------------------
    this.liftMesh = new THREE.Mesh(
      new THREE.BoxGeometry(5, 0.4, 5),
      new THREE.MeshStandardMaterial({ color: 0x3a4246, roughness: 0.55, metalness: 0.75 })
    );
    this.liftMesh.position.set(0, LIFT_BOTTOM - 0.2, 105);
    this.liftMesh.castShadow = true;
    this.liftMesh.receiveShadow = true;
    this.scene.add(this.liftMesh);

    this.liftGlowMat = new THREE.MeshBasicMaterial({
      color: 0x63ffa8, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending,
      toneMapped: false, depthWrite: false,
    });
    for (const z of [-2.4, 2.4]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.06, 0.08), this.liftGlowMat);
      strip.position.set(0, 0.21, z);
      this.liftMesh.add(strip);
    }
    this.liftBox = this.colliders.add(-2.5, LIFT_BOTTOM - 0.4, 102.5, 2.5, LIFT_BOTTOM, 107.5, { isGround: true });
    this.liftBox.ref = 'garden_lift';

    // lift guide rails
    for (const [x, z] of [[-2.7, 102.7], [2.7, 102.7], [-2.7, 107.3], [2.7, 107.3]]) {
      b.box('metalDark', x, 3.6, z, 0.16, 7.2, 0.16, { collide: false });
    }

    b.block('concretePale', 0, 6.7, 111.5, 12, 0.5, 6, { tile: 3 });
    b.block('concreteDark', 0, 0, 111.5, 12, 6.7, 1, { tile: 3, collide: false });
    for (const x of [-5.6, 5.6]) {
      b.box('metalDark', x, 7.4, 108.7, 0.08, 1.4, 0.08, { collide: false });
      b.box('metalDark', x, 7.4, 114, 0.08, 1.4, 0.08, { collide: false });
    }
    b.box('metalDark', 0, 8.1, 108.7, 11.2, 0.06, 0.06, { collide: false });

    this.bloomMat = new THREE.MeshStandardMaterial({
      color: 0x04180c, emissive: 0x63ffa8, emissiveIntensity: 0.12, roughness: 0.3, metalness: 0.5,
    });
    const bloomScreen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), this.bloomMat);
    bloomScreen.position.set(0, 8.1, 111.2);
    bloomScreen.rotation.x = -0.35;
    this.scene.add(bloomScreen);
    b.block('metalDark', 0, 7.2, 111.6, 3.2, 1.4, 0.8, { tile: 2 });

    // ---- relay -------------------------------------------------------
    this.relay = new RelayPylon({
      scene: this.scene, vfx: this.vfx, audio: this.audio,
      position: new THREE.Vector3(-18, 0, 98), color: 0x63ffa8,
    });
    this.relay.build(b);
    this.relayPos = this.relay.position;

    // ---- interactables ----------------------------------------------
    this.liftItem = this.interactables.add({
      id: 'garden_lift',
      label: 'Power Courtyard Lift',
      position: new THREE.Vector3(3.6, 0, 104.4),
      radius: 3.2,
      color: 0x63ffa8,
      onInteract: () => this._powerLift(),
    });
    this.bloomItem = this.interactables.add({
      id: 'garden_bloom',
      label: 'Activate Bloom Console',
      position: new THREE.Vector3(0, 7, 110.4),
      radius: 3.4,
      color: 0x63ffa8,
      active: false,
      onInteract: () => this._bloom(),
    });
    this.interactables.setVisible('garden_bloom', false);

    this.relayItem = this.interactables.add({
      id: 'garden_relay',
      label: 'Power Garden Relay',
      position: new THREE.Vector3(-18, 0, 98),
      radius: 3.6,
      color: 0x63ffa8,
      active: false,
      onInteract: () => this._activateRelay(),
    });
    this.interactables.setVisible('garden_relay', false);

    // ---- energy cells ------------------------------------------------
    const cellDefs = [
      { id: 'cell_bus', position: new THREE.Vector3(16, 3.9, 73) },
      { id: 'cell_rubble', position: new THREE.Vector3(-16, 1.0, 84) },
      { id: 'cell_ledge', position: new THREE.Vector3(20, 4.4, 104) },
    ];
    cellDefs.forEach((def) => {
      const p = new Pickup({
        scene: this.scene, position: def.position, color: 0xffb347, kind: 'cell',
        audio: this.audio, vfx: this.vfx,
        onCollect: () => this._onCellCollected(),
      });
      p.id = def.id;
      this.pickups.push(p);
      this.cellPickups.push(p);
    });

    this.builder.build(this.scene, 'garden');
  }

  _onCellCollected() {
    this.cells++;
    this.missions.addEnergy(1);
    if (!this.recordingPlayed) {
      this.recordingPlayed = true;
      this.ui.dialogue(RESTORER_RECORDING);
      this.audio.sfx('recording');
    }
    if (this.missions.index === 3) {
      this.missions.setObjectiveText('cells', `Collect energy cells (${this.cells}/3)`);
    }
    this.vfx.ring(new THREE.Vector3(0, 0.2, 105), { color: 0x63ffa8, radius: 3, life: 1.2 });
    if (this.cells >= 3) {
      this.ui.subtitle('RELAY', 'All three cells. Power the lift — it will carry you to the Bloom Console.', 6500);
      if (this.missions.index === 3) this.missions.completeObjective('cells');
    } else {
      this.ui.toast(`ENERGY CELL ${this.cells}/3`);
    }
  }

  _powerLift() {
    if (this.liftPowered) {
      this.ui.toast('LIFT ONLINE — RIDE IT UP');
      return;
    }
    if (this.cells < 3) {
      this.ui.toast(`THE LIFT NEEDS 3 ENERGY CELLS (${this.cells}/3)`);
      this.audio.sfx('deny');
      this.sparks.struggle('garden_cells', 1);
      return;
    }
    this.liftPowered = true;
    this.liftPhase = 0;
    this.liftGlowMat.opacity = 0.85;
    this.interactables.setDone('garden_lift');
    this.audio.sfx('activate');
    this.vfx.fountain(new THREE.Vector3(0, 1, 105), { count: 50, color: 0x63ffa8, speed: 6, life: 1.4, size: 0.4 });
    this.ui.subtitle('RELAY', 'The lift is climbing. Step onto the platform — it will carry you to the terrace.', 6000);
    this.bloomItem.active = true;
    this.interactables.setVisible('garden_bloom', true);
    this.interactables.setActive('garden_bloom', true);
    if (this.missions.index === 3) this.missions.completeObjective('lift');
  }

  _bloom() {
    if (this.bloomOn) return;
    if (!this.liftPowered) {
      this.ui.toast('THE BLOOM CONSOLE HAS NO POWER');
      this.audio.sfx('deny');
      return;
    }
    this.bloomOn = true;
    this.bloomMat.emissiveIntensity = 2;
    this.canopyTarget = 1;
    this.interactables.setDone('garden_bloom');
    this.audio.sfx('bloom');
    this.vfx.fountain(new THREE.Vector3(0, 8, 111), { count: 90, color: 0x8dffb0, speed: 9, life: 2.2, size: 0.5 });
    this.vegetation.grow('garden');
    this.ui.subtitle('RELAY', 'Look at that. Concrete, meet root. The courtyard is alive.', 7000);
    this.interactables.setVisible('garden_relay', true);
    this.interactables.setActive('garden_relay', true);
    this.relayItem.active = true;
    if (this.missions.index === 3) this.missions.completeObjective('bloom');
  }

  _activateRelay() {
    if (this.relayOn) return;
    if (!this.bloomOn) {
      this.ui.toast('ACTIVATE THE BLOOM CONSOLE FIRST');
      this.audio.sfx('deny');
      return;
    }
    this.relayOn = true;
    this.relay.activate();
    this.interactables.setDone('garden_relay');
    this.ui.subtitle('RELAY', 'Garden District online. Aster is green again.', 5000);
    if (this.missions.index === 3) this.missions.completeObjective('relay');
    this.game?.zombies?.emitNoise(new THREE.Vector3(-18, 0, 98), 34);
    this.restore();
    this.onRestored('garden');
    this.ui.subtitle('RELAY', 'Get up to the rooftop terrace. I want you to see something.', 6200);
  }

  restore(instant = false) {
    if (this.restored) return;
    this.restored = true;
    this.cells = 3;
    this.liftPowered = true;
    this.bloomOn = true;
    this.relayOn = true;
    this.relay.setPowered(true, instant);
    this.liftGlowMat.opacity = 0.85;
    this.bloomMat.emissiveIntensity = 2;
    this.canopyTarget = 1;
    if (instant) this.canopyScale = 1;
    this.cellPickups.forEach((p) => p.setCollected(true));
    this.interactables.setDone('garden_lift');
    this.interactables.setDone('garden_bloom');
    this.interactables.setDone('garden_relay');
    this.vegetation.grow('garden', instant);
    if (!instant) this.audio.sfx('bloom');
  }

  enter() {
    if (this.missions.index === 3 && !this.missions.status.reach) {
      this.missions.completeObjective('reach');
      this.ui.subtitle('RELAY', 'Cells read faintly from the bus roof, the rubble, and the east ledge. Climb carefully.', 7000);
    }
    this.sparks.setActive('garden_cells', true);
    if (this.cells >= 3) this.sparks.setActive('garden_lift', true);
  }

  _syncObjectives(playerPos) {
    if (this.missions.index !== 3) return;
    if (!this.missions.status.reach && playerPos && playerPos.z > 55) this.missions.completeObjective('reach');
    if (this.cells >= 3 && !this.missions.status.cells) this.missions.completeObjective('cells');
    if (this.liftPowered && !this.missions.status.lift) this.missions.completeObjective('lift');
    if (this.bloomOn && !this.missions.status.bloom) this.missions.completeObjective('bloom');
    if (this.relayOn && !this.missions.status.relay) this.missions.completeObjective('relay');
    if (this.relayOn && !this.missions.status.view && playerPos && playerPos.y > 6.4 && playerPos.z > 107) {
      this.missions.completeObjective('view');
      this.cityLightsOn = true;
      this.game?.city?.wakeLights(0.2);
      this.game?.sky?.setRestoration?.(0.24);
      this.ui.subtitle('RELAY', 'Lights. Not the Grid — people. Small ones, far out, but they are answering the relay.', 9000);
    }
  }

  update(dt, playerPos) {
    this.time += dt;

    // lift motion
    this.liftDelta = 0;
    let target = LIFT_BOTTOM;
    if (this.liftPowered) {
      this.liftPhase = (this.liftPhase + dt) % CYCLE;
      const p = this.liftPhase;
      if (p < 1.4) target = LIFT_BOTTOM;
      else if (p < 6.4) target = LIFT_BOTTOM + ((p - 1.4) / 5) * (LIFT_TOP - LIFT_BOTTOM);
      else if (p < 8.6) target = LIFT_TOP;
      else if (p < 13.6) target = LIFT_TOP - ((p - 8.6) / 5) * (LIFT_TOP - LIFT_BOTTOM);
      else target = LIFT_BOTTOM;
    }
    const newY = target;
    this.liftDelta = newY - this.liftY;
    if (Math.abs(this.liftDelta) > 1e-5) {
      this.liftY = newY;
      this.liftMesh.position.y = this.liftY - 0.2;
      this.liftBox.minY = this.liftY - 0.4;
      this.liftBox.maxY = this.liftY;
    }

    // canopy growth
    if (Math.abs(this.canopyScale - this.canopyTarget) > 0.001) {
      this.canopyScale = damp(this.canopyScale, this.canopyTarget, 0.9, dt);
      this.canopy.scale.setScalar(Math.max(0.001, this.canopyScale));
      if (this.canopyScale > this.canopyTarget - 0.005) {
        this.canopyScale = this.canopyTarget;
        this.canopy.scale.setScalar(Math.max(0.001, this.canopyScale));
      }
    }
    if (this.bloomOn && Math.random() < dt * 8) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 14;
      this.vfx.burst(new THREE.Vector3(Math.cos(a) * r, 0.6 + Math.random() * 2.5, 92 + Math.sin(a) * r), {
        count: 1, color: 0xb6ff9a, speed: 0.7, life: 1.8, size: 0.25, gravity: 0.4, up: 1,
      });
    }
    this.bloomTimer += dt;
    if (this.bloomOn) {
      this.bloomMat.emissiveIntensity = 1.6 + Math.sin(this.bloomTimer * 2.2) * 0.3;
    }
    this.relay.update(dt);
    this._syncObjectives(playerPos);
  }

  getState() {
    return {
      cells: this.cellPickups.map((p) => p.collected),
      cellsCount: this.cells,
      liftPowered: this.liftPowered,
      bloomOn: this.bloomOn,
      relayOn: this.relayOn,
      recordingPlayed: this.recordingPlayed,
      cityLightsOn: this.cityLightsOn,
      restored: this.restored,
    };
  }

  setState(s) {
    if (!s) return;
    if (s.restored) {
      this.restore(true);
      return;
    }
    this.recordingPlayed = !!s.recordingPlayed;
    this.cityLightsOn = !!s.cityLightsOn;
    if (s.cells) {
      s.cells.forEach((c, i) => {
        if (c && this.cellPickups[i]) this.cellPickups[i].setCollected(true);
      });
      this.cells = s.cellsCount || s.cells.filter(Boolean).length;
      if (this.cells > 0 && this.missions.index === 3) {
        this.missions.setObjectiveText('cells', `Collect energy cells (${this.cells}/3)`);
      }
    }
    if (s.liftPowered) {
      this.liftPowered = true;
      this.liftGlowMat.opacity = 0.85;
      this.interactables.setDone('garden_lift');
      this.bloomItem.active = true;
      this.interactables.setVisible('garden_bloom', true);
      this.interactables.setActive('garden_bloom', true);
    }
    if (s.bloomOn) {
      this.bloomOn = true;
      this.bloomMat.emissiveIntensity = 1.8;
      this.canopyTarget = 1;
      this.canopyScale = 1;
      this.canopy.scale.setScalar(1);
      this.interactables.setDone('garden_bloom');
      this.vegetation.grow('garden', true);
      this.interactables.setVisible('garden_relay', true);
      this.interactables.setActive('garden_relay', true);
    }
    if (s.relayOn) {
      this.relayOn = true;
      this.relay.setPowered(true, true);
      this.interactables.setDone('garden_relay');
    }
  }
}
