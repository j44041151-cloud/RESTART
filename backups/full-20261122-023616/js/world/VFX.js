import * as THREE from 'three';
import { getGlowTexture } from './Textures.js';
import { rand } from '../core/utils.js';

const MAX_PARTICLES = 1400;

const particleVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (340.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const particleFrag = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    if (t.a * vAlpha < 0.008) discard;
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  }
`;

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.pool = [];
    this.meshes = [];
    this.ringPool = [];
    this.time = 0;

    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.alphas = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: getGlowTexture() } },
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, r: 1, g: 1, b: 1, grav: 0, drag: 0.9, fadeIn: 0.1 });
    }
    this._initDust();
  }

  _initDust() {
    const count = 420;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rand(-40, 40);
      pos[i * 3 + 1] = rand(0, 22);
      pos[i * 3 + 2] = rand(-40, 40);
      phase[i] = rand(0, 6.28);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.055, color: 0xffe4bd, transparent: true, opacity: 0.35,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.dust.userData.phase = phase;
    this.scene.add(this.dust);
  }

  _spawn() {
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) return this.pool[i];
    }
    return this.pool[0];
  }

  burst(pos, opts = {}) {
    const {
      count = 24, color = 0xffb347, speed = 6, spread = 1,
      life = 1.2, size = 0.5, gravity = -6, drag = 0.92, up = 0.5,
    } = opts;
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const p = this._spawn();
      p.active = true;
      p.x = pos.x + rand(-0.3, 0.3) * spread;
      p.y = pos.y + rand(-0.2, 0.4) * spread;
      p.z = pos.z + rand(-0.3, 0.3) * spread;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(rand(-1, 1));
      const s = speed * rand(0.3, 1);
      p.vx = Math.sin(phi) * Math.cos(theta) * s;
      p.vy = Math.abs(Math.cos(phi)) * s * up + rand(0.5, 2.5);
      p.vz = Math.sin(phi) * Math.sin(theta) * s;
      p.life = 0;
      p.maxLife = life * rand(0.6, 1.3);
      p.size = size * rand(0.5, 1.4);
      p.r = c.r; p.g = c.g; p.b = c.b;
      p.grav = gravity;
      p.drag = drag;
    }
  }

  /** Dense upward spark fountain, used for restorations. */
  fountain(pos, opts = {}) {
    const { count = 60, color = 0xffb347, speed = 9, life = 1.8, size = 0.45 } = opts;
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const p = this._spawn();
      p.active = true;
      const a = Math.random() * Math.PI * 2;
      const r = rand(0, 1.2);
      p.x = pos.x + Math.cos(a) * r;
      p.y = pos.y + rand(0, 0.6);
      p.z = pos.z + Math.sin(a) * r;
      const s = speed * rand(0.35, 1);
      p.vx = Math.cos(a) * s * 0.35;
      p.vy = s;
      p.vz = Math.sin(a) * s * 0.35;
      p.life = 0;
      p.maxLife = life * rand(0.6, 1.2);
      p.size = size * rand(0.5, 1.2);
      p.r = c.r; p.g = c.g; p.b = c.b;
      p.grav = -9;
      p.drag = 0.98;
    }
  }

  ring(pos, opts = {}) {
    const { color = 0xffb347, radius = 1.2, life = 0.9, thickness = 0.06, axis = 'y' } = opts;
    const geo = new THREE.RingGeometry(0.86, 1, 48);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    if (axis === 'y') mesh.rotation.x = -Math.PI / 2;
    mesh.userData = { life: 0, maxLife: life, radius, thickness };
    this.scene.add(mesh);
    this.rings = this.rings || [];
    this.rings.push(mesh);
    return mesh;
  }

  beam(from, to, opts = {}) {
    const { color = 0xffb347, radius = 0.08, opacity = 0.9, pulse = true } = opts;
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, len, 8, 1, true);
    geo.translate(0, len / 2, 0);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.userData.pulse = pulse;
    mesh.userData.baseOpacity = opacity;
    this.scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  remove(obj) {
    if (!obj) return;
    obj.parent && obj.parent.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
    this.meshes = this.meshes.filter((m) => m !== obj);
    if (this.rings) this.rings = this.rings.filter((m) => m !== obj);
  }

  update(dt, camera, restoration = 0) {
    this.time += dt;
    let n = 0;
    const pos = this.positions;
    const col = this.colors;
    const sz = this.sizes;
    const al = this.alphas;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        continue;
      }
      p.vy += p.grav * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.35; p.vx *= 0.7; p.vz *= 0.7; }
      const t = p.life / p.maxLife;
      const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      pos[n * 3] = p.x;
      pos[n * 3 + 1] = p.y;
      pos[n * 3 + 2] = p.z;
      col[n * 3] = p.r;
      col[n * 3 + 1] = p.g;
      col[n * 3 + 2] = p.b;
      sz[n] = p.size * (1 - t * 0.45);
      al[n] = Math.max(0, fade) * 0.95;
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;

    // rings
    if (this.rings) {
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.userData.life += dt;
        const t = r.userData.life / r.userData.maxLife;
        if (t >= 1) {
          this.remove(r);
          continue;
        }
        const s = 0.4 + t * r.userData.radius * 2.4;
        r.scale.setScalar(s);
        r.material.opacity = (1 - t) * 0.8;
      }
    }
    for (const m of this.meshes) {
      if (m.userData.pulse) {
        m.material.opacity = m.userData.baseOpacity * (0.55 + Math.sin(this.time * 5.2) * 0.3);
      }
    }

    // ambient dust follows the player
    if (this.dust && camera) {
      this.dust.position.set(camera.position.x, 0, camera.position.z);
      const arr = this.dust.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] += dt * (0.12 + (i % 7) * 0.02);
        arr[i] += Math.sin(this.time * 0.3 + i) * dt * 0.12;
        if (arr[i + 1] > 24) arr[i + 1] = 0;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
      this.dust.material.opacity = 0.22 + restoration * 0.12;
      this.dust.material.color.setHex(restoration > 0.5 ? 0xd8f3ff : 0xffe4bd);
    }
  }
}
