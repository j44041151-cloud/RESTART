import * as THREE from 'three';
import { seeded, clamp, smoothstep } from '../core/utils.js';
import { getSurface } from './Textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Zone based instanced overgrowth. Each district owns a zone; when the
 * district is restored its plants grow out of the dead ground with a
 * staggered, animated scale-up.
 */
export class Vegetation {
  constructor(scene, materials, zoneDefs) {
    this.scene = scene;
    this.materials = materials;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    scene.add(this.group);
    this.zones = new Map();
    this.rnd = seeded(4242);
    this._dummy = new THREE.Object3D();

    const leafTex = getSurface('foliage');

    const grassBlade = new THREE.PlaneGeometry(1, 1, 1, 1);
    grassBlade.translate(0, 0.5, 0);
    const blade2 = grassBlade.clone();
    blade2.rotateY(Math.PI / 2);
    this.grassGeo = mergeGeometries([grassBlade, blade2]);

    this.grassMat = new THREE.MeshStandardMaterial({
      map: leafTex.map,
      color: 0x8fae6a,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      alphaTest: 0.35,
    });

    this.bushGeo = new THREE.IcosahedronGeometry(0.8, 1);
    this.bushGeo.scale(1.25, 0.75, 1.25);
    this.bushMat = new THREE.MeshStandardMaterial({
      map: leafTex.map, normalMap: leafTex.normalMap,
      color: 0x5f8746, roughness: 1, metalness: 0, flatShading: true,
    });

    const trunk = new THREE.CylinderGeometry(0.11, 0.26, 4.4, 6);
    trunk.translate(0, 2.2, 0);
    const blobs = [];
    const offsets = [
      [0, 4.6, 0, 1.7],
      [1.0, 3.9, 0.45, 1.25],
      [-0.95, 4.1, -0.5, 1.15],
      [0.2, 5.4, -0.25, 1.05],
    ];
    for (const [x, y, z, r] of offsets) {
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.translate(x, y, z);
      blobs.push(g);
    }
    this.canopyGeo = mergeGeometries(blobs);
    this.canopyMat = new THREE.MeshStandardMaterial({
      map: leafTex.map, normalMap: leafTex.normalMap,
      color: 0x4f7a3d, roughness: 0.95, metalness: 0, flatShading: true,
    });

    for (const def of zoneDefs) this._createZone(def);
  }

  _sample(shape) {
    const r = this.rnd;
    if (shape.type === 'circle') {
      const a = r() * Math.PI * 2;
      const rad = Math.sqrt(r()) * shape.r;
      return { x: shape.x + Math.cos(a) * rad, z: shape.z + Math.sin(a) * rad };
    }
    return {
      x: shape.x + (r() - 0.5) * shape.w,
      z: shape.z + (r() - 0.5) * shape.d,
    };
  }

  _createZone(def) {
    const zone = {
      name: def.name,
      progress: 0,
      target: 0,
      grass: null, bush: null, trunk: null, canopy: null,
      grassData: [], bushData: [], treeData: [],
      y: def.y || 0,
    };
    const mk = (geo, mat, data, cast) => {
      if (!data.length) return null;
      const mesh = new THREE.InstancedMesh(geo, mat, data.length);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.count = data.length;
      this.group.add(mesh);
      return mesh;
    };
    const d = this._dummy;
    const setZero = (mesh, count) => {
      if (!mesh) return;
      d.position.set(0, -100, 0);
      d.scale.setScalar(0.001);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, d.matrix);
      mesh.instanceMatrix.needsUpdate = true;
    };

    const r = this.rnd;
    const grassCount = def.grass || 0;
    for (let i = 0; i < grassCount; i++) {
      const p = this._sample(def.shape);
      zone.grassData.push({
        x: p.x, z: p.z, y: zone.y,
        rot: r() * Math.PI * 2,
        sx: 0.55 + r() * 0.85,
        sy: 0.45 + r() * 0.9,
      });
    }
    zone.grass = mk(this.grassGeo, this.grassMat, zone.grassData, false);

    const bushCount = def.bush || 0;
    for (let i = 0; i < bushCount; i++) {
      const p = this._sample(def.shape);
      zone.bushData.push({
        x: p.x, z: p.z, y: zone.y,
        rot: r() * Math.PI * 2,
        s: 0.6 + r() * 1.15,
      });
    }
    zone.bush = mk(this.bushGeo, this.bushMat, zone.bushData, true);

    const treeCount = def.canopy || 0;
    for (let i = 0; i < treeCount; i++) {
      const p = this._sample(def.shape);
      zone.treeData.push({
        x: p.x, z: p.z, y: zone.y,
        rot: r() * Math.PI * 2,
        s: 0.75 + r() * 0.55,
      });
    }
    if (zone.treeData.length) {
      zone.trunk = mk(this._trunkGeo(), this.materials.bark, zone.treeData, true);
      zone.canopy = mk(this.canopyGeo, this.canopyMat, zone.treeData, true);
    }

    setZero(zone.grass, zone.grassData.length);
    setZero(zone.bush, zone.bushData.length);
    setZero(zone.trunk, zone.treeData.length);
    setZero(zone.canopy, zone.treeData.length);

    this.zones.set(def.name, zone);
  }

  _trunkGeo() {
    if (!this._trunk) {
      this._trunk = new THREE.CylinderGeometry(0.11, 0.26, 4.4, 6);
      this._trunk.translate(0, 2.2, 0);
    }
    return this._trunk;
  }

  grow(name, instant = false) {
    const zone = this.zones.get(name);
    if (!zone) return;
    zone.target = 1;
    if (instant) {
      zone.progress = 1;
      this._applyZone(zone);
    }
  }

  /** 0..1 overall garden growth, used for HUD hints. */
  getProgress(name) {
    const z = this.zones.get(name);
    return z ? z.progress : 0;
  }

  _applyZone(zone) {
    const d = this._dummy;
    const p = zone.progress;
    const apply = (mesh, data, scaleFn) => {
      if (!mesh) return;
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        const th = (i / Math.max(1, data.length)) * 0.55;
        const s = smoothstep(th, th + 0.34, p);
        const sc = scaleFn(item) * s;
        d.position.set(item.x, item.y - (1 - s) * 0.15, item.z);
        d.rotation.set(0, item.rot, 0);
        d.scale.setScalar(Math.max(0.0001, sc));
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = p > 0.001;
    };
    apply(zone.grass, zone.grassData, (it) => Math.max(it.sx, it.sy));
    apply(zone.bush, zone.bushData, (it) => it.s);
    apply(zone.trunk, zone.treeData, (it) => it.s);
    apply(zone.canopy, zone.treeData, (it) => it.s);
  }

  update(dt) {
    for (const zone of this.zones.values()) {
      if (Math.abs(zone.progress - zone.target) > 0.0005) {
        zone.progress += (zone.target - zone.progress) * Math.min(1, dt * 1.15);
        if (Math.abs(zone.progress - zone.target) < 0.002) zone.progress = zone.target;
        this._applyZone(zone);
      }
    }
  }
}
