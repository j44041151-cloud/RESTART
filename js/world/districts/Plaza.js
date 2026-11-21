import * as THREE from 'three';
import { Builder } from '../Builder.js';
import { damp } from '../../core/utils.js';
import { PLAZA_RECORDING } from '../../story/Story.js';

export class PlazaDistrict {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.builder = new Builder(this.materials, this.colliders);
    this.restored = false;
    this.reached = false;
    this.meetTimer = -1;
    this.jumped = false;
    this.terminalOn = false;
    this.recordingPlayed = false;
    this.recTimer = 0;
    this.time = 0;
    this.zone = { x: 0, z: 12, r: 26 };
    this.checkpoint = { name: 'Arrival Plaza', position: new THREE.Vector3(0, 0.16, 30), yaw: Math.PI };
  }

  build() {
    const b = this.builder;

    // tutorial barricade - a low wall you can comfortably jump
    b.block('concretePale', 7, 0, 3, 5.4, 1.0, 0.9, { tile: 2 });
    b.block('concreteDark', 7, 1.0, 3, 5.6, 0.16, 1.05, { tile: 2, collide: false });
    // warning stripes
    this.stripeMat = new THREE.MeshStandardMaterial({
      color: 0x2a2410, emissive: 0xffb347, emissiveIntensity: 0.25, roughness: 0.8, metalness: 0.1,
    });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.62, 0.03), this.stripeMat);
      s.position.set(4.8 + i * 0.88, 0.5, 3.47);
      s.rotation.z = 0.5;
      this.scene.add(s);
    }

    // plaza terminal kiosk
    const tx = -9, tz = -5;
    b.block('metalDark', tx, 0, tz, 2.4, 1.1, 1.6, { tile: 2 });
    b.block('concretePale', tx, 0, tz, 3, 0.2, 2.2, { tile: 2, collide: false });
    b.block('metalDark', tx, 1.1, tz, 0.6, 1.5, 0.4, { tile: 2, collide: false });
    b.block('concreteDark', tx, 2.6, tz, 2.8, 0.25, 1.9, { tile: 2, collide: false });
    this.terminalMat = new THREE.MeshStandardMaterial({
      color: 0x05100f, emissive: 0x2bd8c8, emissiveIntensity: 0.15, roughness: 0.25, metalness: 0.5,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.2), this.terminalMat);
    screen.position.set(tx, 1.9, tz + 0.8);
    screen.rotation.x = -0.35;
    this.scene.add(screen);
    this.terminalScreen = screen;
    b.box('metalDark', tx, 1.15, tz + 0.55, 2.2, 0.1, 0.5, { collide: false });

    // objective marker hologram
    this.marker = new THREE.Group();
    this.marker.position.set(0, 0, 7);
    this.markerSpin = new THREE.Mesh(
      new THREE.TorusGeometry(1.3, 0.05, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.7, toneMapped: false, blending: THREE.AdditiveBlending })
    );
    this.markerSpin.rotation.x = -Math.PI / 2;
    this.markerSpin.position.y = 0.15;
    this.marker.add(this.markerSpin);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1.2, 4.4, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb347, transparent: true, opacity: 0.09, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    pillar.position.y = 2.2;
    this.marker.add(pillar);
    this.markerPillar = pillar;
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.035, 6, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.5, toneMapped: false, blending: THREE.AdditiveBlending })
    );
    ring2.position.y = 1.4;
    this.marker.add(ring2);
    this.markerRing2 = ring2;
    this.scene.add(this.marker);

    // restored monument halo
    this.halo = new THREE.Mesh(
      new THREE.TorusGeometry(3.6, 0.08, 8, 64),
      new THREE.MeshBasicMaterial({
        color: 0x9fe8ff, transparent: true, opacity: 0, toneMapped: false,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.position.set(0, 0.75, -7);
    this.scene.add(this.halo);
    this.haloRing2 = this.halo.clone();
    this.haloRing2.material = this.halo.material.clone();
    this.haloRing2.scale.setScalar(1.6);
    this.haloRing2.position.y = 3.2;
    this.scene.add(this.haloRing2);

    // props around the plaza
    b.block('rustPaint', 12, 0, 18, 2.2, 1.2, 1.2, { tile: 2 });
    b.block('cream', 10.4, 0, 18.6, 1.2, 0.7, 1.2, { tile: 1.6 });
    b.block('metalDark', -15, 0, 12, 1.6, 2.4, 1.6, { tile: 2 });
    b.cylinder('rustPaint', -16.5, 0.55, 9.5, 0.45, 0.45, 1.1, { seg: 10, collide: true, tile: 2 });

    this.terminalItem = this.interactables.add({
      id: 'plaza_terminal',
      label: 'Activate Plaza Terminal',
      position: new THREE.Vector3(tx, 0, tz + 1.6),
      radius: 3,
      color: 0xffb347,
      active: false,
      onInteract: () => this._activateTerminal(),
    });
    this.interactables.setVisible('plaza_terminal', false);

    this.builder.build(this.scene, 'plaza');
  }

  _activateTerminal() {
    if (this.terminalOn) return;
    if (!this.jumped) {
      this.ui.toast('THE TERMINAL IS STILL LOCKED');
      this.audio.sfx('deny');
      return;
    }
    this.terminalOn = true;
    this.interactables.setDone('plaza_terminal');
    this.terminalMat.emissiveIntensity = 1.5;
    this.audio.sfx('activate');
    this.vfx.fountain(new THREE.Vector3(-9, 1.4, -4), { count: 60, color: 0x5ff2e0, speed: 7, life: 1.6, size: 0.45 });
    this.restore();
    if (this.missions.index === 0) this.missions.completeObjective('terminal');
    this.onRestored('plaza');
    this.game?.zombies?.emitNoise(new THREE.Vector3(-9, 0, -5), 34);
    this.recTimer = 2.0;
  }

  _playEmergencyRecording() {
    if (this.recordingPlayed) return;
    this.recordingPlayed = true;
    this.ui.dialogue(PLAZA_RECORDING);
    this.audio.sfx('recording');
    // The recording is loud. It carries past the plaza edges.
    this.game?.zombies?.emitNoise(new THREE.Vector3(-9, 0, -5), 40);
    this.vfx.ring(new THREE.Vector3(-9, 1.5, -4), { color: 0x5ff2e0, radius: 9, life: 1.8 });
    this.game?.zombies?.surgeAt(new THREE.Vector3(-6, 0, -20), 2, 6);
    this.recDoneTimer = 9.5;
  }

  restore(instant = false) {
    if (this.restored) return;
    this.restored = true;
    this.terminalOn = true;
    this.terminalMat.emissiveIntensity = 1.5;
    this.interactables.setDone('plaza_terminal');
    this.halo.material.opacity = 0.55;
    this.haloRing2.material.opacity = 0.4;
    this.marker.visible = false;
    this.vegetation.grow('plaza', instant);
  }

  enter() {}

  _syncObjectives() {
    if (this.missions.index !== 0) return;
    if (this.reached && !this.missions.status.reach) this.missions.completeObjective('reach');
    if (this.jumped && !this.missions.status.jump) this.missions.completeObjective('jump');
    if (this.terminalOn && !this.missions.status.terminal) this.missions.completeObjective('terminal');
  }

  update(dt, playerPos) {
    this.time += dt;
    this.markerSpin.rotation.z += dt * 0.7;
    this.markerRing2.position.y = 1.4 + Math.sin(this.time * 1.6) * 0.14;
    this.markerPillar.material.opacity = 0.06 + Math.sin(this.time * 2.2) * 0.03 + 0.03;
    this.halo.rotation.z += dt * 0.35;
    this.haloRing2.rotation.z -= dt * 0.25;

    if (this.missions.index === 0) {
      if (!this.reached) {
        const d = Math.hypot(playerPos.x - 0, playerPos.z - 7);
        if (d < 4.6) {
          this.reached = true;
          this.missions.completeObjective('reach');
          this.ui.subtitle('RELAY', 'You made it. I am RELAY — I kept the lights of my own little shell on, waiting for someone like you.', 8000);
          this.meetTimer = 2.2;
        }
      }
      if (this.meetTimer > 0) {
        this.meetTimer -= dt;
        if (this.meetTimer <= 0) {
          this.missions.completeObjective('relay');
          this.ui.subtitle('RELAY', 'The barricade ahead is low. Run with Shift, then jump with Space. Learning is the whole game.', 7500);
        }
      }
      if (this.reached && !this.jumped) {
        const d = Math.hypot(playerPos.x - 7, playerPos.z - 3);
        if (d < 4.6 && playerPos.y > 0.45) {
          this.jumped = true;
          this.missions.completeObjective('jump');
          this.audio.sfx('objective');
          this.vfx.burst(new THREE.Vector3(7, 1.4, 3), { count: 14, color: 0xffb347, speed: 3, life: 0.8, size: 0.3 });
          this.ui.subtitle('RELAY', 'Clean leap. That terminal over there is yours — press E beside it.', 6000);
          this.terminalItem.active = true;
          this.interactables.setActive('plaza_terminal', true);
          this.interactables.setVisible('plaza_terminal', true);
        }
      }
    }
    if (this.recTimer > 0) {
      this.recTimer -= dt;
      if (this.recTimer <= 0) {
        this.recTimer = 0;
        this._playEmergencyRecording();
      }
    }
    if (this.recDoneTimer > 0) {
      this.recDoneTimer -= dt;
      if (this.recDoneTimer <= 0) {
        this.recDoneTimer = 0;
        if (this.missions.index === 0) this.missions.completeObjective('recording');
        this.ui.subtitle('RELAY', 'Movement in the fog. They heard the recording. Stay low, Restorer — we do not fight our way through this city.', 8600);
      }
    }
    this._syncObjectives();
  }

  getState() {
    return {
      restored: this.restored, jumped: this.jumped, terminalOn: this.terminalOn,
      reached: this.reached, recordingPlayed: this.recordingPlayed,
    };
  }

  setState(s) {
    if (!s) return;
    this.reached = !!s.reached || !!s.restored;
    this.jumped = !!s.jumped || !!s.restored;
    if (s.restored) {
      this.restore(true);
      return;
    }
    if (this.jumped) {
      this.terminalItem.active = true;
      this.interactables.setActive('plaza_terminal', true);
      this.interactables.setVisible('plaza_terminal', true);
    }
    this.recordingPlayed = !!s.recordingPlayed;
  }
}
