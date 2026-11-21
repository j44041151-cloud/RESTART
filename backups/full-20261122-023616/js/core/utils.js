import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Deterministic PRNG so the city is identical every run. */
export function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        Object.values(m).forEach((v) => {
          if (v && v.isTexture) v.dispose();
        });
        m.dispose();
      });
    }
  });
}

/**
 * Axis aligned box collision world with a coarse XZ spatial grid.
 * Used by the character controller, camera and moving platforms.
 */
export class Colliders {
  constructor(cellSize = 14) {
    this.cellSize = cellSize;
    this.grid = new Map();
    this.boxes = [];
  }

  _key(ix, iz) {
    return ix + '|' + iz;
  }

  add(minX, minY, minZ, maxX, maxY, maxZ, extra = {}) {
    const b = {
      minX, minY, minZ, maxX, maxY, maxZ,
      cast: true, isGround: false, ref: null,
      ...extra,
    };
    this.boxes.push(b);
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs), z1 = Math.floor(maxZ / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) {
          arr = [];
          this.grid.set(k, arr);
        }
        arr.push(b);
      }
    }
    return b;
  }

  addCentered(cx, cy, cz, w, h, d, extra = {}) {
    return this.add(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, extra);
  }

  setBox(b, minX, minY, minZ, maxX, maxY, maxZ) {
    b.minX = minX; b.minY = minY; b.minZ = minZ;
    b.maxX = maxX; b.maxY = maxY; b.maxZ = maxZ;
    // Dynamic boxes live in a single cell is not enough; they rarely move far.
    return b;
  }

  query(x, z, pad = 1) {
    const cs = this.cellSize;
    const out = new Set();
    const x0 = Math.floor((x - pad) / cs), x1 = Math.floor((x + pad) / cs);
    const z0 = Math.floor((z - pad) / cs), z1 = Math.floor((z + pad) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (arr) for (let i = 0; i < arr.length; i++) out.add(arr[i]);
      }
    }
    return out;
  }
}

/** Segment / AABB intersection test, returns t in 0..1 or Infinity. */
export function segmentBox(ox, oy, oz, dx, dy, dz, b, tMax = 1) {
  let tmin = 0, tmax = tMax;
  const axes = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, b.minY, b.maxY],
    [oz, dz, b.minZ, b.maxZ],
  ];
  for (let i = 0; i < 3; i++) {
    const [o, d, mn, mx] = axes[i];
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return Infinity;
    } else {
      let t1 = (mn - o) / d, t2 = (mx - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Simple damage/impact camera shake source. */
export class Shake {
  constructor() {
    this.amp = 0;
    this.time = 0;
    this.offset = new THREE.Vector3();
  }
  add(a) { this.amp = Math.min(0.5, this.amp + a); }
  update(dt) {
    this.time += dt;
    this.amp *= Math.exp(-4.5 * dt);
    const t = this.time * 34;
    this.offset.set(
      Math.sin(t * 1.7) * this.amp,
      Math.cos(t * 2.3) * this.amp,
      Math.sin(t * 1.1) * this.amp * 0.6
    );
    return this.offset;
  }
}
