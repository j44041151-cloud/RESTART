import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const NO_SHADOW = new Set(['ground', 'water', 'emissiveAmber', 'emissiveCyan', 'neon', 'marker', 'screen']);

/**
 * Static geometry batcher. Everything added here is merged per material,
 * giving the whole city a handful of draw calls. Anything that animates
 * must be created directly in the scene instead.
 */
export class Builder {
  constructor(materials, colliders) {
    this.materials = materials;
    this.colliders = colliders;
    this.buckets = new Map();
    this.count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  add(matKey, geo, x, y, z, ry = 0) {
    this._p.set(x, y, z);
    this._q.setFromAxisAngle(Y_AXIS, ry);
    this._m.compose(this._p, this._q, this._s);
    geo.applyMatrix4(this._m);
    let arr = this.buckets.get(matKey);
    if (!arr) {
      arr = [];
      this.buckets.set(matKey, arr);
    }
    arr.push(geo);
    this.count++;
  }

  /** Box with explicit center. */
  box(matKey, cx, cy, cz, w, h, d, opts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    this._scaleBoxUV(g, w, h, d, opts.tile ?? 4);
    this.add(matKey, g, cx, cy, cz, opts.ry ?? 0);
    if (opts.collide !== false) {
      const ry = opts.ry ?? 0;
      const c = Math.abs(Math.cos(ry));
      const s = Math.abs(Math.sin(ry));
      const hx = (c * w + s * d) / 2;
      const hz = (s * w + c * d) / 2;
      const box = this.colliders.add(cx - hx, cy - h / 2, cz - hz, cx + hx, cy + h / 2, cz + hz, {
        isGround: !!opts.isGround,
      });
      if (opts.ref) opts.ref.box = box;
      return box;
    }
    return null;
  }

  /** Box specified by its bottom Y - the natural way to build a city. */
  block(matKey, cx, bottom, cz, w, h, d, opts = {}) {
    return this.box(matKey, cx, bottom + h / 2, cz, w, h, d, opts);
  }

  cylinder(matKey, cx, cy, cz, rTop, rBottom, h, opts = {}) {
    const seg = opts.seg ?? 14;
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, opts.openEnded ?? false);
    if (opts.axis === 'x') g.rotateZ(Math.PI / 2);
    else if (opts.axis === 'z') g.rotateX(Math.PI / 2);
    if (!opts.noUV) {
      const uv = g.attributes.uv;
      const circ = Math.PI * (rTop + rBottom);
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * (circ / (opts.tile ?? 3)), uv.getY(i) * (h / (opts.tile ?? 3)));
      }
      uv.needsUpdate = true;
    }
    this.add(matKey, g, cx, cy, cz, opts.ry ?? 0);
    if (opts.collide) {
      const r = Math.max(rTop, rBottom);
      this.colliders.add(cx - r, cy - h / 2, cz - r, cx + r, cy + h / 2, cz + r);
    }
  }

  /** Horizontal quad (ground plate / paving). */
  plate(matKey, cx, cy, cz, w, d, opts = {}) {
    const g = new THREE.PlaneGeometry(w, d, 1, 1);
    const uv = g.attributes.uv;
    const tile = opts.tile ?? 4;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (d / tile));
    g.rotateX(-Math.PI / 2);
    this.add(matKey, g, cx, cy, cz, opts.ry ?? 0);
  }

  /** Vertical quad facing +Z, rotated by ry. */
  quad(matKey, cx, cy, cz, w, h, ry = 0) {
    const g = new THREE.PlaneGeometry(w, h);
    this.add(matKey, g, cx, cy, cz, ry);
  }

  /** Cylinder between two points (pipes, cables, energy conduits). */
  strut(matKey, a, b, radius, opts = {}) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 0.0001) return;
    const g = new THREE.CylinderGeometry(radius, radius, len, opts.seg ?? 6, 1, true);
    const quat = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.clone().normalize());
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const m = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    let arr = this.buckets.get(matKey);
    if (!arr) arr = this.buckets.set(matKey, []).get(matKey);
    arr.push(g);
    this.count++;
  }

  _scaleBoxUV(g, w, h, d, tile) {
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const [du, dv] = dims[f];
      for (let i = 0; i < 4; i++) {
        const idx = f * 4 + i;
        uv.setXY(idx, (uv.getX(idx) * du) / tile, (uv.getY(idx) * dv) / tile);
      }
    }
    uv.needsUpdate = true;
  }

  build(scene, name = 'city') {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, list] of this.buckets) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mat = this.materials[key] || this.materials.concrete;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${name}_${key}`;
      mesh.castShadow = !NO_SHADOW.has(key);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.buckets.clear();
    scene.add(group);
    return group;
  }
}
