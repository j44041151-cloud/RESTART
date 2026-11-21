import * as THREE from 'three';
import { Builder } from '../Builder.js';
import { damp, clamp } from '../../core/utils.js';

export const SOLAR_DECK_Y = 3.2;

export class SolarDistrict {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.builder = new Builder(this.materials, this.colliders);
    this.arrays = [];
    this.repaired = 0;
    this.inverterOn = false;
    this.relayOn = false;
    this.restored = false;
    this.zone = { x: 36, z: 0, r: 9 };
    this.checkpoint = { name: 'Solar Walkway', position: new THREE.Vector3(36, SOLAR_DECK_Y, 0), yaw: Math.PI / 2 };
    this.time = 0;
    this.sparkTimer = 0;
    this.coolTimer = 0;
    this._beams = [];
  }

  build() {
    const b = this.builder;
    const DY = SOLAR_DECK_Y;

    const platform = (cx, cz, w, d, topY) => {
      b.block('concreteDark', cx, topY - 0.55, cz, w, 0.55, d, { tile: 4 });
      b.block('concretePale', cx, topY - 0.06, cz, w, 0.06, d, { tile: 3, collide: false });
      for (const [ox, oz] of [[-w / 2 + 0.6, -d / 2 + 0.6], [w / 2 - 0.6, -d / 2 + 0.6], [-w / 2 + 0.6, d / 2 - 0.6], [w / 2 - 0.6, d / 2 - 0.6]]) {
        b.cylinder('metalDark', cx + ox, (topY - 0.55) / 2, cz + oz, 0.2, 0.3, Math.max(0.5, topY - 0.55), { seg: 8, collide: false });
      }
      // broken edges
      const rnd = Math.random;
      for (let i = 0; i < 4; i++) {
        b.box('concreteDark', cx + (rnd() - 0.5) * w, topY + 0.01, cz + (rnd() - 0.5) * d, 0.4 + rnd() * 0.9, 0.12, 0.3 + rnd() * 0.8, {
          ry: rnd() * 3, collide: false,
        });
      }
    };

    platform(37, 0, 6, 10, 2.1);
    platform(46, 0, 6, 10, 2.1);
    platform(55, 0, 6, 10, 2.1);
    platform(64.5, 0, 7, 10, 2.1);
    // stairs from platform D up to the deck (0.37 m risers)
    for (let i = 0; i < 3; i++) {
      b.block('concretePale', 65.4 + i * 0.85, 2.1, 0, 0.9, 0.37 * (i + 1), 8, { tile: 3 });
    }

    // main deck
    b.block('concreteDark', 86, DY - 0.7, 0, 36, 0.7, 44, { tile: 6 });
    b.block('concretePale', 86, DY - 0.08, 0, 36, 0.08, 44, { tile: 4, collide: false });
    for (let i = 0; i < 6; i++) {
      const x = 70 + i * 7;
      for (const z of [-20, 20]) {
        b.cylinder('metalDark', x, (DY - 0.7) / 2, z, 0.3, 0.4, DY - 0.7, { seg: 8, collide: false });
      }
    }
    // deck railings (broken in places)
    for (const z of [-21.4, 21.4]) {
      for (let i = 0; i < 20; i++) {
        if (i % 7 === 3) continue;
        const x = 69 + i * 1.8;
        b.box('metalDark', x, DY + 0.55, z, 0.07, 1.1, 0.07, { collide: false });
      }
      for (let i = 0; i < 5; i++) {
        if (i === 2) continue;
        b.box('metalDark', 74 + i * 6, DY + 1.05, z, 5.2, 0.06, 0.06, { collide: false });
      }
    }
    // walkway railings
    for (const [cx, w] of [[37, 6], [46, 6], [55, 6], [64.5, 7]]) {
      for (const z of [-4.9, 4.9]) {
        b.box('metalDark', cx, 2.1 + 0.5, z, 0.06, 1, 0.06, { collide: false });
        b.box('metalDark', cx, 2.1 + 1.0, z, w, 0.05, 0.05, { collide: false });
      }
    }

    // deck props: crates, cable drums, industrial boxes
    b.block('rustPaint', 82, DY, -17, 2.2, 1.6, 2.2, { tile: 2 });
    b.block('cream', 79.5, DY, -17.5, 1.6, 1.1, 1.6, { tile: 2 });
    b.cylinder('rustPaint', 92, DY + 0.7, -16, 1.1, 1.1, 0.5, { seg: 16, collide: true, axis: 'z' });
    b.block('metalDark', 96, DY, 18, 3, 2.2, 2, { tile: 3 });
    b.block('metalDark', 72, DY, 17, 2.6, 1.8, 2.4, { tile: 3 });

    // planter boxes for later growth
    for (const [x, z] of [[73, -5], [84, 4], [93, -12], [99, 6], [76, 12]]) {
      b.block('concreteDark', x, DY, z, 2.4, 0.5, 2.4, { tile: 2 });
      b.block('ground', x, DY + 0.45, z, 2.0, 0.08, 2.0, { collide: false, tile: 1 });
    }

    // ---------------- solar arrays ------------------------------------
    const positions = [[78, -11], [89, 8], [98, -5]];
    positions.forEach(([x, z], i) => this._createArray(b, x, z, i));

    // ---------------- inverter ----------------------------------------
    const ix = 73.5, iz = 12.5;
    b.block('metalDark', ix, DY, iz, 3.4, 3, 2.4, { tile: 2.4 });
    b.block('concreteDark', ix, DY, iz, 4.2, 0.25, 3.2, { tile: 2 });
    this.screenMat = new THREE.MeshStandardMaterial({
      color: 0x05100f, emissive: 0x2bd8c8, emissiveIntensity: 0.08, roughness: 0.25, metalness: 0.5,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.3), this.screenMat);
    screen.position.set(ix, DY + 1.9, iz - 1.24);
    screen.rotation.y = Math.PI;
    this.scene.add(screen);
    this.screen = screen;

    this.inverterRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.05, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0x5ff2e0, transparent: true, opacity: 0.15, toneMapped: false, blending: THREE.AdditiveBlending })
    );
    this.inverterRing.position.set(ix, DY + 1.6, iz);
    this.inverterRing.rotation.y = Math.PI / 2;
    this.scene.add(this.inverterRing);

    // ---------------- relay pylon -------------------------------------
    this._createRelay(b, 99.5, 16.5, DY);

    // interactables
    this.arrays.forEach((arr, i) => {
      arr.item = this.interactables.add({
        id: `solar_array_${i}`,
        label: 'Repair Solar Array',
        position: new THREE.Vector3(arr.x, DY + 0.4, arr.z),
        radius: 4.4,
        color: 0xffb347,
        onInteract: () => this._repairArray(arr),
      });
    });

    this.inverterItem = this.interactables.add({
      id: 'solar_inverter',
      label: 'Activate Solar Inverter',
      position: new THREE.Vector3(ix, DY, iz - 2),
      radius: 3.4,
      color: 0x5ff2e0,
      active: false,
      onInteract: () => this._activateInverter(),
    });
    this.interactables.setVisible('solar_inverter', false);

    this.relayItem = this.interactables.add({
      id: 'solar_relay',
      label: 'Power Solar Relay',
      position: new THREE.Vector3(99.5, DY, 16.5),
      radius: 3.6,
      color: 0x5ff2e0,
      active: false,
      onInteract: () => this._activateRelay(),
    });
    this.interactables.setVisible('solar_relay', false);

    this.deckLight = new THREE.PointLight(0xffc46b, 0, 34, 2);
    this.deckLight.position.set(88, DY + 6, 2);
    this.scene.add(this.deckLight);

    this.builder.build(this.scene, 'solar');
  }

  _createArray(b, x, z, index) {
    const DY = SOLAR_DECK_Y;
    // frame legs
    for (const [ox, oz] of [[-2.6, -1.2], [2.6, -1.2], [-2.6, 1.2], [2.6, 1.2]]) {
      b.cylinder('metalDark', x + ox, DY + 0.45, z + oz, 0.12, 0.16, 0.9, { seg: 6, collide: false });
    }
    b.block('metalDark', x, DY + 0.75, z, 6.4, 0.16, 3.0, { collide: true, tile: 2 });

    const mat = this.materials.solar.clone();
    mat.emissive = new THREE.Color(0x1a4c7a);
    mat.emissiveIntensity = 0;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.14, 3.0), mat);
    panel.position.set(x, DY + 1.0, z);
    panel.rotation.x = index === 1 ? 0.18 : -0.2;
    panel.rotation.z = 0.12 + index * 0.09;
    panel.castShadow = true;
    panel.receiveShadow = true;
    this.scene.add(panel);

    const stripMat = new THREE.MeshBasicMaterial({
      color: 0x7fe7ff, transparent: true, opacity: 0, toneMapped: false,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (const off of [-1.4, 1.4]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.03, 0.06), stripMat);
      strip.position.set(0, 0.09, off);
      panel.add(strip);
    }
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x7fe7ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    glow.scale.setScalar(7);
    glow.position.set(x, DY + 1.4, z);
    this.scene.add(glow);

    // broken shards lying nearby
    b.box('metalDark', x + 3.4, DY + 0.1, z + 1.8, 1.6, 0.1, 1.1, { ry: 0.8, collide: false });

    this.arrays.push({
      x, z, panel, mat, stripMat, glow, index,
      repaired: false,
      repairing: false,
      t: 0,
      item: null,
      startRotX: panel.rotation.x,
      startRotZ: panel.rotation.z,
      targetRotX: -0.55 - index * 0.04,
      targetRotZ: 0,
    });
  }

  _createRelay(b, x, z, baseY) {
    b.block('concreteDark', x, baseY - 0.15, z, 4.2, 0.4, 4.2, { tile: 2 });
    b.cylinder('metalDark', x, baseY + 0.3, z, 1.5, 1.9, 0.5, { seg: 12, collide: false });
    b.cylinder('metal', x, baseY + 3.4, z, 0.35, 0.85, 6.2, { seg: 10, collide: true });

    const ringMat = new THREE.MeshBasicMaterial({ color: 0x5ff2e0, transparent: true, opacity: 0.25, toneMapped: false, blending: THREE.AdditiveBlending });
    this.relayRings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15 - i * 0.16, 0.06, 6, 32), ringMat.clone());
      ring.position.set(x, baseY + 1.6 + i * 1.7, z);
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
      this.relayRings.push(ring);
    }
    this.relayOrbMat = new THREE.MeshStandardMaterial({
      color: 0x06181a, emissive: 0x5ff2e0, emissiveIntensity: 0.15, roughness: 0.25, metalness: 0.4,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), this.relayOrbMat);
    orb.position.set(x, baseY + 6.8, z);
    this.scene.add(orb);
    this.relayOrb = orb;
    this.relayLight = new THREE.PointLight(0x5ff2e0, 0, 20, 2);
    this.relayLight.position.set(x, baseY + 6.8, z);
    this.scene.add(this.relayLight);
    this.relayPos = new THREE.Vector3(x, baseY, z);
  }

  _repairArray(arr) {
    if (arr.repaired || arr.repairing) return;
    arr.repairing = true;
    arr.t = 0;
    this.audio.sfx('repairStart');
    this.vfx.burst(new THREE.Vector3(arr.x, SOLAR_DECK_Y + 1, arr.z), {
      count: 22, color: 0xffd08a, speed: 4, life: 1.1, size: 0.35,
    });
    this.missions.setObjectiveText('arrays', `Repairing solar array… (${this.repaired}/3)`);
  }

  _finishRepair(arr) {
    arr.repaired = true;
    arr.repairing = false;
    this.repaired++;
    this.vfx.fountain(new THREE.Vector3(arr.x, SOLAR_DECK_Y + 1.2, arr.z), {
      count: 54, color: 0x7fe7ff, speed: 7, life: 1.5, size: 0.42,
    });
    this.vfx.ring(new THREE.Vector3(arr.x, SOLAR_DECK_Y + 0.2, arr.z), { color: 0x7fe7ff, radius: 4.5, life: 1.2 });
    this.audio.sfx('energy');
    this.interactables.setDone(arr.item.id);
    if (this.missions.index === 1) {
      this.missions.setObjectiveText('arrays', `Repair the solar arrays (${this.repaired}/3)`);
    }
    this._createArrayBeam(arr);
    if (this.repaired >= 3) {
      this.inverterItem.active = true;
      this.interactables.setActive('solar_inverter', true);
      this.interactables.setVisible('solar_inverter', true);
      this.ui.subtitle('RELAY', 'All three arrays are angled into the light. The inverter is waiting for you.', 6000);
      if (this.missions.index === 1) this.missions.completeObjective('arrays');
    }
  }

  _createArrayBeam(arr) {
    const from = new THREE.Vector3(arr.x, SOLAR_DECK_Y + 1.2, arr.z);
    const to = new THREE.Vector3(73.5, SOLAR_DECK_Y + 1.8, 13.2);
    const beam = this.vfx.beam(from, to, { color: 0x7fe7ff, radius: 0.035, opacity: 0.5 });
    this._beams.push(beam);
  }

  _activateInverter() {
    if (this.inverterOn) return;
    if (this.repaired < 3) {
      this.ui.toast('THE INVERTER NEEDS ALL THREE ARRAYS');
      this.audio.sfx('deny');
      return;
    }
    this.inverterOn = true;
    this.interactables.setDone('solar_inverter');
    this.screenMat.emissiveIntensity = 1.4;
    this.vfx.fountain(new THREE.Vector3(73.5, SOLAR_DECK_Y + 1.6, 13), {
      count: 70, color: 0x5ff2e0, speed: 9, life: 1.8, size: 0.5,
    });
    this.vfx.ring(new THREE.Vector3(73.5, SOLAR_DECK_Y + 0.1, 13), { color: 0x5ff2e0, radius: 6, life: 1.4 });
    this.audio.sfx('activate');
    this.ui.subtitle('RELAY', 'The inverter is awake. One more step — the district relay.', 5500);
    this.interactables.setVisible('solar_relay', true);
    this.interactables.setActive('solar_relay', true);
    this.relayItem.active = true;
    this._beams.push(this.vfx.beam(
      new THREE.Vector3(73.5, SOLAR_DECK_Y + 2.2, 13),
      new THREE.Vector3(99.5, SOLAR_DECK_Y + 3, 16.5),
      { color: 0x5ff2e0, radius: 0.05, opacity: 0.55 }
    ));
    if (this.missions.index === 1) this.missions.completeObjective('inverter');
  }

  _activateRelay() {
    if (this.relayOn) return;
    if (!this.inverterOn) {
      this.ui.toast('POWER THE INVERTER FIRST');
      this.audio.sfx('deny');
      return;
    }
    this.relayOn = true;
    this.interactables.setDone('solar_relay');
    this.audio.sfx('relay');
    this.relayOrbMat.emissiveIntensity = 2.4;
    this.relayLight.intensity = 12;
    for (const r of this.relayRings) r.material.opacity = 0.9;
    this.vfx.fountain(this.relayPos.clone().setY(SOLAR_DECK_Y + 1), {
      count: 100, color: 0x5ff2e0, speed: 11, life: 2.2, size: 0.55,
    });
    this.vfx.beam(
      new THREE.Vector3(99.5, SOLAR_DECK_Y + 7, 16.5),
      new THREE.Vector3(99.5, SOLAR_DECK_Y + 90, 16.5),
      { color: 0x5ff2e0, radius: 0.35, opacity: 0.7 }
    );
    this.ui.subtitle('RELAY', 'Solar District online. Aster just remembered the sun.', 6500);
    if (this.missions.index === 1) this.missions.completeObjective('relay');
    this.restore();
    this.onRestored('solar');
  }

  restore(instant = false) {
    if (this.restored) return;
    this.restored = true;
    this.inverterOn = true;
    this.relayOn = true;
    this.repaired = 3;
    for (const a of this.arrays) {
      a.repaired = true;
      a.repairing = false;
      a.mat.emissiveIntensity = 1.2;
      a.stripMat.opacity = 0.9;
      a.panel.rotation.x = a.targetRotX;
      a.panel.rotation.z = 0;
      this.interactables.setDone(a.item.id);
      this._createArrayBeam(a);
    }
    this.screenMat.emissiveIntensity = 1.4;
    this.relayOrbMat.emissiveIntensity = 2.4;
    this.relayLight.intensity = 12;
    for (const r of this.relayRings) r.material.opacity = 0.9;
    this.interactables.setDone('solar_inverter');
    this.interactables.setDone('solar_relay');
    this.deckLight.intensity = 16;
    this.deckLight.visible = true;
    this.vegetation.grow('solar', instant);
  }

  _syncObjectives(playerPos) {
    if (this.missions.index !== 1) return;
    if (!this.missions.status.reach && playerPos && playerPos.x > 33) this.missions.completeObjective('reach');
    if (this.repaired >= 3 && !this.missions.status.arrays) this.missions.completeObjective('arrays');
    if (this.inverterOn && !this.missions.status.inverter) this.missions.completeObjective('inverter');
    if (this.relayOn && !this.missions.status.relay) this.missions.completeObjective('relay');
  }

  enter() {
    if (this.missions.index === 1 && !this.missions.status.reach) {
      this.missions.completeObjective('reach');
      this.ui.subtitle('RELAY', 'Careful on the gaps. The old crews used to run at them. So can you — hold Shift.', 6500);
    }
    this.sparks.setActive('solar_jump', true);
  }

  update(dt, playerPos) {
    this.time += dt;
    for (const a of this.arrays) {
      if (a.repairing) {
        a.t += dt;
        const k = clamp(a.t / 1.5, 0, 1);
        a.panel.rotation.x = damp(a.panel.rotation.x, a.targetRotX, 3.5, dt);
        a.panel.rotation.z = damp(a.panel.rotation.z, a.targetRotZ, 3.5, dt);
        a.mat.emissiveIntensity = k * 0.5;
        a.stripMat.opacity = k * 0.5;
        if (k >= 1) this._finishRepair(a);
      } else if (a.repaired) {
        a.panel.rotation.x = damp(a.panel.rotation.x, a.targetRotX, 2.5, dt);
        a.panel.rotation.z = damp(a.panel.rotation.z, a.targetRotZ, 2.5, dt);
        a.mat.emissiveIntensity = 1.0 + Math.sin(this.time * 2 + a.index) * 0.25;
        a.stripMat.opacity = 0.7 + Math.sin(this.time * 3 + a.index) * 0.25;
        a.glow.material.opacity = 0.35 + Math.sin(this.time * 2.5 + a.index) * 0.15;
      }
    }
    if (this.inverterOn) {
      this.inverterRing.rotation.z += dt * 0.8;
      this.inverterRing.material.opacity = 0.4 + Math.sin(this.time * 4) * 0.2;
      if (Math.random() < dt * 3) {
        this.vfx.burst(new THREE.Vector3(73.5, SOLAR_DECK_Y + 3.1, 12.5), {
          count: 2, color: 0x9ff6ff, speed: 2, life: 0.4, size: 0.18, gravity: -4,
        });
      }
    }
    if (this.relayOn) {
      for (let i = 0; i < this.relayRings.length; i++) {
        const r = this.relayRings[i];
        r.rotation.z += dt * (0.4 + i * 0.2);
        r.rotation.x = Math.PI / 2 + Math.sin(this.time * 0.7 + i) * 0.16;
      }
      this.relayOrb.position.y = SOLAR_DECK_Y + 6.8 + Math.sin(this.time * 1.6) * 0.12;
      if (this.restored && Math.random() < dt * 6) {
        const x = 74 + Math.random() * 26;
        const z = -18 + Math.random() * 36;
        this.vfx.burst(new THREE.Vector3(x, SOLAR_DECK_Y + 1.5 + Math.random() * 4, z), {
          count: 1, color: 0x9fe8ff, speed: 0.8, life: 1.6, size: 0.22, gravity: 0.3, up: 1,
        });
      }
    }
    if (this.deckLight.intensity > 0 && !this.restored) this.deckLight.intensity = damp(this.deckLight.intensity, 0, 2, dt);
    this._syncObjectives(playerPos);
  }

  getState() {
    return {
      repaired: this.repaired,
      panels: this.arrays.map((a) => a.repaired),
      inverterOn: this.inverterOn,
      relayOn: this.relayOn,
      restored: this.restored,
    };
  }

  setState(s, instant = true) {
    if (!s) return;
    this.repaired = s.repaired || 0;
    this.inverterOn = !!s.inverterOn;
    this.relayOn = !!s.relayOn;
    if (s.restored) {
      this.restore(instant);
      return;
    }
    const flags = s.panels || this.arrays.map((_, i) => i < this.repaired);
    this.arrays.forEach((a, i) => {
      if (flags[i]) {
        a.repaired = true;
        a.mat.emissiveIntensity = 1.1;
        a.stripMat.opacity = 0.8;
        a.panel.rotation.x = a.targetRotX;
        a.panel.rotation.z = 0;
        this.interactables.setDone(a.item.id);
        this._createArrayBeam(a);
      }
    });
    this.repaired = flags.filter(Boolean).length;
    if (this.repaired > 0 && this.missions.index === 1) {
      this.missions.setObjectiveText('arrays', `Repair the solar arrays (${this.repaired}/3)`);
    }
    if (this.inverterOn) {
      this.screenMat.emissiveIntensity = 1.4;
      this.interactables.setDone('solar_inverter');
      this.interactables.setVisible('solar_relay', true);
      this.interactables.setActive('solar_relay', true);
    }
    if (this.repaired >= 3) {
      this.interactables.setVisible('solar_inverter', true);
      this.interactables.setActive('solar_inverter', true);
    }
  }
}
