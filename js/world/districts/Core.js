import * as THREE from 'three';
import { Builder } from '../Builder.js';
import { clamp } from '../../core/utils.js';
import { CORE_RECORDING } from '../../story/Story.js';

export class CoreDistrict {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.builder = new Builder(this.materials, this.colliders);
    this.relays = 0;
    this.coreOn = false;
    this.restored = false;
    this.zone = { x: 0, z: -84, r: 22 };
    this.checkpoint = { name: 'Restart Core', position: new THREE.Vector3(0, 0.16, -62), yaw: Math.PI };
    this.time = 0;
    this.districtLights = [];
    this.beams = [];
    this.relayPositions = [];
    this.pylonItems = [];
    this.sequenceNames = ['SOLAR', 'AQUA', 'GARDEN'];
    this.sequenceOrder = ['SOLAR', 'GARDEN', 'AQUA'];
    this.sequenceIndex = 0;
    this.sequenceDone = false;
    this.recordPlayed = false;
    this.recordTimer = 0;
    this.reachTriggered = false;
  }

  build() {
    const b = this.builder;
    const CZ = -88;

    // dais steps
    b.block('concreteDark', 0, 0, -74.5, 26, 0.5, 3, { tile: 4 });
    b.block('concretePale', 0, 0.5, -76.5, 24, 0.5, 3, { tile: 3 });
    b.block('concreteDark', 0, 1, -78.5, 22, 0.5, 3, { tile: 4 });
    b.block('concreteDark', 0, 0.75, CZ, 34, 1.5, 34, { tile: 8 });
    b.block('concretePale', 0, 2.24, CZ, 33, 0.06, 33, { tile: 5, collide: false });
    // inlay rings on the dais
    for (const [r0, r1] of [[11, 11.4], [15, 15.3]]) {
      const ring = new THREE.RingGeometry(r0, r1, 64);
      ring.rotateX(-Math.PI / 2);
      b.add('concretePale', ring, 0, 2.32, CZ);
    }
    for (let i = 0; i < 6; i++) {
      b.block('concretePale', Math.cos((i / 6) * Math.PI * 2) * 16, 2.3, CZ + Math.sin((i / 6) * Math.PI * 2) * 16, 2.4, 0.18, 2.4, { collide: false });
    }

    // central spire
    b.cylinder('concreteDark', 0, 3.1, CZ, 3.6, 4.4, 1.6, { seg: 24, collide: true, tile: 4 });
    b.cylinder('metalDark', 0, 18, CZ, 1.0, 2.4, 27, { seg: 16, collide: true, tile: 5 });
    b.cylinder('metal', 0, 31.5, CZ, 0.35, 1.0, 2.4, { seg: 12, collide: false, tile: 3 });

    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x7fe7ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending,
      toneMapped: false, depthWrite: false,
    });
    this.rings = [];
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.2 - i * 0.7, 0.12, 8, 60), this.ringMat.clone());
      ring.position.set(0, 8 + i * 5.4, CZ);
      ring.rotation.x = Math.PI / 2 + 0.1 * i;
      this.scene.add(ring);
      this.rings.push(ring);
    }
    this.orbMat = new THREE.MeshStandardMaterial({
      color: 0x06181a, emissive: 0x7fe7ff, emissiveIntensity: 0.2, roughness: 0.2, metalness: 0.3,
    });
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 2), this.orbMat);
    this.orb.position.set(0, 34, CZ);
    this.scene.add(this.orb);
    this.orbLight = new THREE.PointLight(0x7fe7ff, 2, 40, 2);
    this.orbLight.position.set(0, 30, CZ);
    this.scene.add(this.orbLight);

    // console
    b.block('metalDark', 0, 2.3, -73.5, 4.4, 1.2, 2.4, { tile: 2 });
    b.block('concretePale', 0, 2.3, -73.5, 5.4, 0.3, 3.4, { tile: 2, collide: false });
    this.consoleMat = new THREE.MeshStandardMaterial({
      color: 0x05100f, emissive: 0x2bd8c8, emissiveIntensity: 0.1, roughness: 0.2, metalness: 0.5,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.4), this.consoleMat);
    screen.position.set(0, 3.4, -72.2);
    screen.rotation.x = -0.55;
    this.scene.add(screen);
    this.consoleScreen = screen;

    // three district indicator pylons
    const colors = [0x5ff2e0, 0x63ffa8, 0xffb347];
    const names = this.sequenceNames;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
      const x = Math.cos(a) * 12;
      const z = CZ + Math.sin(a) * 12;
      b.cylinder('metalDark', x, 4, z, 0.45, 0.9, 4, { seg: 8, collide: true });
      const mat = new THREE.MeshStandardMaterial({
        color: 0x081012, emissive: colors[i], emissiveIntensity: 0.08, roughness: 0.4, metalness: 0.4,
      });
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), mat);
      crystal.position.set(x, 6.6, z);
      this.scene.add(crystal);
      const light = new THREE.PointLight(colors[i], 0, 12, 2);
      light.position.set(x, 6.8, z);
      this.scene.add(light);
      this.districtLights.push({ crystal, mat, light, on: false, name: names[i] });
      this.pylonItems.push(this.interactables.add({
        id: `core_pylon_${i}`,
        label: `Synchronize ${names[i]} Pylon`,
        position: new THREE.Vector3(x, 2.3, z),
        radius: 3.6,
        color: colors[i],
        active: false,
        onInteract: () => this._syncPylon(i),
      }));
      this.interactables.setVisible(`core_pylon_${i}`, false);
    }

    // core pillars / floodlights
    for (const [x, z] of [[-16, -100], [16, -100], [-16, -76], [16, -76]]) {
      b.cylinder('metalDark', x, 7, z, 0.35, 0.55, 14, { seg: 8, collide: false });
      const mat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.1, toneMapped: false });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), mat);
      lamp.position.set(x, 14.2, z);
      this.scene.add(lamp);
      this.districtLights.push({ mat, light: null, on: false, deco: true });
    }

    // service structures
    b.block('metalDark', -24, 0, -108, 6, 4, 8, { tile: 4 });
    b.block('metalDark', 24, 0, -108, 6, 4, 8, { tile: 4 });
    for (let i = 0; i < 5; i++) {
      b.cylinder('metal', -26 + i * 13, 0.6, -104, 0.5, 0.5, 1.2, { seg: 10, axis: 'z', collide: false });
    }

    this.coreItem = this.interactables.add({
      id: 'core_console',
      label: 'Activate the Restart Core',
      position: new THREE.Vector3(0, 2.3, -71.5),
      radius: 4,
      color: 0x7fe7ff,
      onInteract: () => this._activate(),
    });
    this.interactables.setVisible('core_console', false);
    this.interactables.setActive('core_console', false);

    this.builder.build(this.scene, 'core');
  }

  setRelayPositions(positions) {
    this.relayPositions = positions;
  }

  setRelays(count, instant = false) {
    const prev = this.relays;
    this.relays = count;
    for (let i = 0; i < this.districtLights.length; i++) {
      const d = this.districtLights[i];
      if (d.deco) {
        if (count > 0) {
          d.mat.opacity = 0.15 + count * 0.25;
          d.on = true;
        }
        continue;
      }
      if (i < count) {
        d.mat.emissiveIntensity = 2;
        if (d.light) d.light.intensity = 6;
        d.crystal.scale.setScalar(1.2);
        d.on = true;
        if (!instant && i >= prev) {
          this.vfx.fountain(d.crystal.position.clone(), { count: 30, color: 0x9fe8ff, speed: 5, life: 1.3, size: 0.35 });
        }
      }
    }
    // energy beams from the districts into the core
    if (!instant && count > this.beams.length && this.relayPositions.length) {
      const idx = this.beams.length;
      const p = this.relayPositions[idx];
      if (p) {
        const beam = this.vfx.beam(
          new THREE.Vector3(p.x, 1, p.z),
          new THREE.Vector3(0, 34, -88),
          { color: 0x7fe7ff, radius: 0.14, opacity: 0.45 }
        );
        this.beams.push(beam);
        this.audio.sfx('energy');
      }
    }
    if (count >= 3) {
      this.interactables.setVisible('core_console', true);
      this.interactables.setActive('core_console', true);
      this.consoleMat.emissiveIntensity = 0.8;
    }
  }

  _syncPylon(i) {
    if (this.sequenceDone) return;
    if (this.relays < 3) {
      this.ui.toast('ALL THREE DISTRICT RELAYS MUST BE ONLINE');
      this.audio.sfx('deny');
      return;
    }
    const name = this.sequenceNames[i];
    const expected = this.sequenceOrder[this.sequenceIndex];
    if (name !== expected) {
      this.sequenceIndex = 0;
      this._resetPylons();
      this.audio.sfx('deny');
      this.ui.toast('SEQUENCE REJECTED — SYNC IN THE ORDER RELAY GAVE YOU', 'red');
      this.missions.setObjectiveText('sequence', 'Synchronize the relay pylons (0/3)');
      return;
    }
    this.sequenceIndex += 1;
    const d = this.districtLights[i];
    if (d) {
      d.mat.emissiveIntensity = 3.2;
      if (d.light) d.light.intensity = 11;
      d.crystal.scale.setScalar(1.5);
    }
    this.audio.sfx('energy');
    this.vfx.fountain(this.districtLights[i]?.crystal?.position.clone() || new THREE.Vector3(0, 6, -88), {
      count: 26, color: 0x9fe8ff, speed: 5, life: 1.3, size: 0.32,
    });
    this.missions.setObjectiveText('sequence', `Synchronize the relay pylons (${this.sequenceIndex}/3)`);
    if (this.sequenceIndex >= 3) {
      this.sequenceDone = true;
      this.missions.completeObjective('sequence');
      this.consoleMat.emissiveIntensity = 2.2;
      this.interactables.setLabel('core_console', 'Activate the Restart Core');
      this.ui.subtitle('RELAY', 'All three pylons are in phase. The prototype in your chest is synchronizing with the Core. The console is yours, Restorer.', 8200);
      this.game?.zombies?.emitNoise(new THREE.Vector3(0, 0, -88), 30);
    } else {
      this.ui.subtitle('RELAY', `${name} synchronized. Next: ${this.sequenceOrder[this.sequenceIndex]}.`, 4600);
    }
  }

  _resetPylons() {
    for (let i = 0; i < this.districtLights.length; i++) {
      const d = this.districtLights[i];
      if (!d || d.deco) continue;
      d.mat.emissiveIntensity = i < this.relays ? 2 : 0.35;
      if (d.light) d.light.intensity = i < this.relays ? 6 : 0;
      d.crystal.scale.setScalar(1.2);
    }
  }

  _activate() {
    if (this.coreOn) return;
    if (this.relays < 3) {
      this.ui.toast('THE CORE IS STARVED — RESTORE ALL THREE DISTRICTS');
      this.audio.sfx('deny');
      return;
    }
    if (!this.sequenceDone) {
      this.ui.toast('SYNCHRONIZE THE THREE RELAY PYLONS FIRST');
      this.audio.sfx('deny');
      return;
    }
    this.coreOn = true;
    this.interactables.setDone('core_console');
    this.audio.sfx('core');
    this.vfx.fountain(new THREE.Vector3(0, 3, -84), { count: 160, color: 0x9fe8ff, speed: 14, life: 2.6, size: 0.6 });
    this.ui.subtitle('RELAY', 'Restart sequence engaged. Hold on, Restorer. This is what a bounce back feels like.', 6400);
    if (this.missions.index === 4) this.missions.completeObjective('core');
    if (this.onCoreActivated) this.onCoreActivated();
  }

  restore(instant = false) {
    this.restored = true;
    this.coreOn = true;
    this.sequenceDone = true;
    this.sequenceIndex = 3;
    this.orbMat.emissiveIntensity = 3;
    this.orbLight.intensity = 24;
    this.consoleMat.emissiveIntensity = 2;
    for (const r of this.rings) r.material.opacity = 0.95;
    for (const d of this.districtLights) {
      if (!d.deco) {
        d.mat.emissiveIntensity = 2.4;
        if (d.light) d.light.intensity = 9;
        d.crystal.scale.setScalar(1.25);
      } else {
        d.mat.opacity = 0.9;
      }
    }
  }

  enter() {
    if (this.missions.index === 4) {
      this.ui.subtitle('RELAY', this.relays >= 3
        ? 'All three relays are feeding the Core. The console is yours.'
        : 'The Core needs all three district relays. They stand beside each restored district.', 7000);
      if (!this.recordPlayed) {
        this.recordPlayed = true;
        this.recordTimer = 3.2;
        this.game?.zombies?.emitNoise(new THREE.Vector3(0, 0, -80), 26);
      }
    }
  }

  _syncObjectives(playerPos) {
    if (this.missions.index !== 4) return;
    if (!this.missions.status.reach && playerPos && playerPos.z < -58) {
      this.missions.completeObjective('reach');
      this.ui.subtitle('RELAY', 'The Core. It has been waiting for you longer than I have.', 5600);
    }
    if (this.relays >= 3 && !this.missions.status.relays) {
      this.missions.completeObjective('relays');
      this.ui.subtitle('RELAY', 'Three relays online. Sync the pylons in the order I give you: SOLAR, then GARDEN, then AQUA.', 9600);
      for (let i = 0; i < 3; i++) {
        this.interactables.setVisible(`core_pylon_${i}`, true);
        this.interactables.setActive(`core_pylon_${i}`, true);
      }
    }
    if (this.sequenceDone && !this.missions.status.sequence) this.missions.completeObjective('sequence');
    if (this.coreOn && !this.missions.status.core) this.missions.completeObjective('core');
  }

  update(dt, playerPos) {
    this.time += dt;
    if (this.recordTimer > 0) {
      this.recordTimer -= dt;
      if (this.recordTimer <= 0) {
        this.recordTimer = 0;
        this.ui.dialogue(CORE_RECORDING);
        this.audio.sfx('recording');
      }
    }
    this._syncObjectives(playerPos);
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.rotation.z += dt * (this.coreOn ? 1.6 : 0.25 + i * 0.1);
      r.rotation.y += dt * (this.coreOn ? 0.9 : 0.15);
      if (this.coreOn) r.material.opacity = 0.7 + Math.sin(this.time * 2 + i) * 0.2;
    }
    this.orb.rotation.y += dt * (this.coreOn ? 1.2 : 0.3);
    this.orb.rotation.x += dt * (this.coreOn ? 0.4 : 0.1);
    this.orb.position.y = 34 + Math.sin(this.time * 1.2) * 0.3;
    this.orbMat.emissiveIntensity = this.coreOn ? 2.6 + Math.sin(this.time * 4) * 0.5 : 0.35;
    this.orbLight.intensity = this.coreOn ? 22 : 6;
    for (const d of this.districtLights) {
      if (d.crystal && d.on) {
        d.crystal.rotation.y += dt * 0.8;
        d.crystal.position.y = 6.6 + Math.sin(this.time * 1.5 + d.crystal.position.x) * 0.16;
      }
    }
    if (this.coreOn && Math.random() < dt * 20) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 8;
      this.vfx.burst(new THREE.Vector3(Math.cos(a) * r, 4 + Math.random() * 20, -88 + Math.sin(a) * r), {
        count: 2, color: 0x9fe8ff, speed: 2.2, life: 1.4, size: 0.3, gravity: 1.6, up: 1,
      });
    }
  }

  getState() {
    return {
      coreOn: this.coreOn, restored: this.restored,
      sequenceDone: this.sequenceDone, sequenceIndex: this.sequenceIndex,
      recordPlayed: this.recordPlayed,
    };
  }

  setState(s) {
    if (!s) return;
    this.setRelays(this.relays, true);
    this.sequenceDone = !!s.sequenceDone;
    this.sequenceIndex = s.sequenceIndex || (this.sequenceDone ? 3 : 0);
    this.recordPlayed = !!s.recordPlayed;
    if (this.sequenceDone) {
      for (let i = 0; i < 3; i++) {
        this.interactables.setVisible(`core_pylon_${i}`, true);
        this.interactables.setActive(`core_pylon_${i}`, true);
        this.interactables.setDone(`core_pylon_${i}`);
      }
    } else {
      this._resetPylons();
    }
    if (s.coreOn) {
      this.coreOn = true;
      this.interactables.setDone('core_console');
      this.restore(true);
    }
  }
}
