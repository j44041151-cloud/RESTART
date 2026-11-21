import * as THREE from 'three';
import { Builder } from './Builder.js';
import { Vegetation } from './Vegetation.js';
import { seeded, rand, pick, clamp } from '../core/utils.js';

const TOWERS = [
  // inner block towers (kept clear of the play corridors)
  { x: 41, z: -41, w: 21, d: 21, h: 46, style: 'facadePale' },
  { x: 58, z: -49, w: 15, d: 17, h: 64, style: 'facadeDark' },
  { x: 40, z: -63, w: 18, d: 13, h: 34, style: 'facade' },
  { x: 61, z: -76, w: 20, d: 16, h: 52, style: 'facadePale' },
  { x: -42, z: -43, w: 23, d: 19, h: 54, style: 'facade' },
  { x: -61, z: -53, w: 14, d: 16, h: 72, style: 'facadeDark' },
  { x: -40, z: -64, w: 16, d: 15, h: 38, style: 'facadePale' },
  { x: -63, z: -78, w: 19, d: 15, h: 46, style: 'facade' },
  { x: 44, z: 43, w: 25, d: 19, h: 40, style: 'facade' },
  { x: 62, z: 52, w: 15, d: 16, h: 58, style: 'facadeDark' },
  { x: 56, z: 30, w: 12, d: 14, h: 26, style: 'facadePale' },
  { x: -47, z: 45, w: 21, d: 21, h: 50, style: 'facadePale' },
  { x: -64, z: 56, w: 15, d: 14, h: 66, style: 'facadeDark' },
  { x: -57, z: 30, w: 11, d: 13, h: 24, style: 'facade' },
  // core district flanking towers
  { x: -33, z: -94, w: 19, d: 20, h: 78, style: 'facadeDark' },
  { x: 34, z: -93, w: 18, d: 21, h: 82, style: 'facadePale' },
  { x: -52, z: -112, w: 22, d: 20, h: 58, style: 'facade' },
  { x: 53, z: -113, w: 20, d: 22, h: 62, style: 'facade' },
  // district backdrops
  { x: 94, z: -50, w: 18, d: 18, h: 36, style: 'facadePale' },
  { x: 96, z: 49, w: 16, d: 20, h: 30, style: 'facade' },
  { x: -100, z: -49, w: 20, d: 18, h: 42, style: 'facade' },
  { x: -102, z: 47, w: 17, d: 17, h: 34, style: 'facadePale' },
  { x: 34, z: 106, w: 20, d: 18, h: 28, style: 'facadePale' },
  { x: -34, z: 107, w: 18, d: 20, h: 32, style: 'facade' },
  { x: 34, z: 82, w: 12, d: 20, h: 22, style: 'facadeDark' },
  { x: -34, z: 82, w: 12, d: 20, h: 24, style: 'facadeDark' },
];

export class City {
  constructor({ scene, colliders, materials, vfx }) {
    this.scene = scene;
    this.colliders = colliders;
    this.materials = materials;
    this.vfx = vfx;
    this.time = 0;
    this.windowMatrices = [];
    this.windowColors = [];
    this.lamps = [];
    this.beacons = [];
    this.signs = [];
    this.restoration = 0;
    this.rnd = seeded(90210);
    this.ruinTops = [];
    this.smokePts = null;
  }

  build() {
    const b = (this.builder = new Builder(this.materials, this.colliders));
    this._ground(b);
    this._districtApproaches(b);
    this._towers(b);
    this._skyline(b);
    this._disaster(b);
    this._props(b);
    this._lamps(b);
    this._vines(b);
    this._treeGraves(b);
    this.builder.build(this.scene, 'city');
    this._windows();
    this._holoSigns();
    this._smoke();

    this.vegetation = new Vegetation(this.scene, this.materials, [
      { name: 'plaza', shape: { type: 'circle', x: 0, z: 0, r: 23 }, grass: 260, bush: 16 },
      { name: 'street', shape: { type: 'rect', x: 0, z: 46, w: 15, d: 26 }, grass: 140, bush: 6 },
      { name: 'solar', shape: { type: 'rect', x: 89, z: 0, w: 32, d: 26 }, y: 3.26, grass: 150, bush: 7 },
      { name: 'water', shape: { type: 'circle', x: -72, z: 0, r: 18 }, grass: 180, bush: 11 },
      { name: 'garden', shape: { type: 'circle', x: 0, z: 88, r: 23 }, grass: 460, bush: 40, canopy: 16 },
    ]);
    return this;
  }

  // ------------------------------------------------------------------
  _ground(b) {
    b.plate('ground', 0, 0, 0, 340, 360, { tile: 7 });
    this.colliders.add(-270, -4, -280, 270, 0, 280, { isGround: true });

    // plaza disc
    const disc = new THREE.CircleGeometry(26, 64);
    const duv = disc.attributes.uv;
    for (let i = 0; i < duv.count; i++) duv.setXY(i, duv.getX(i) * 13, duv.getY(i) * 13);
    disc.rotateX(-Math.PI / 2);
    b.add('concretePale', disc, 0, 0.045, 0);

    // inlaid plaza rings
    for (const [r0, r1] of [[9, 9.4], [16, 16.35], [23, 23.3]]) {
      const ring = new THREE.RingGeometry(r0, r1, 72);
      const uv = ring.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 24, uv.getY(i) * 24);
      ring.rotateX(-Math.PI / 2);
      b.add('concreteDark', ring, 0, 0.06, 0);
    }

    // radial paving lines
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const len = 22;
      b.box('concreteDark', Math.cos(a) * (len / 2 + 3), 0.055, Math.sin(a) * (len / 2 + 3), 0.14, 0.012, len, {
        ry: -a, collide: false,
      });
    }

    // central broken monument
    const mb = 0;
    b.cylinder('concrete', 0, 0.35, -7, 3.4, 3.8, 0.7, { seg: 8, tile: 3 });
    b.cylinder('concretePale', 0, 1.25, -7, 2.1, 2.5, 1.2, { seg: 8, tile: 3 });
    b.cylinder('concrete', 0, 5.2, -7, 0.85, 1.55, 7, { seg: 6, tile: 4, ry: 0.2 });
    b.box('concreteDark', 0.9, 8.4, -7.2, 1.9, 1.1, 1.6, { ry: 0.4, collide: false });
    this.colliders.add(-3, 0, -10.2, 3, 8, -3.8);
    for (let i = 0; i < 7; i++) {
      const a = rand(0, 6.28);
      const d = rand(3, 7);
      b.box('concrete', Math.cos(a) * d + 2, 0.2, -7 + Math.sin(a) * d, rand(0.5, 1.4), rand(0.2, 0.6), rand(0.5, 1.2), {
        ry: rand(0, 3), collide: false,
      });
    }

    // streets -------------------------------------------------------
    b.plate('road', 0, 0.02, -52, 24, 56, { tile: 6 });          // north avenue
    b.plate('road', 48, 0.02, 0, 48, 16, { tile: 6 });            // east road
    b.plate('road', -48, 0.02, 0, 48, 16, { tile: 6 });           // west road
    b.plate('road', 0, 0.02, 48, 18, 48, { tile: 6 });            // south road
    b.plate('road', 0, 0.02, 130, 60, 14, { tile: 6 });           // rear service road
    b.plate('road', 0, 0.02, -128, 80, 16, { tile: 6 });

    // curbs / sidewalks
    const walk = (x, z, w, d) => {
      b.block('concretePale', x, 0, z, w, 0.16, d, { tile: 3 });
    };
    walk(-13.6, -52, 3.4, 56);
    walk(13.6, -52, 3.4, 56);
    walk(48, -9.6, 48, 3.2);
    walk(48, 9.6, 48, 3.2);
    walk(-48, -9.6, 48, 3.2);
    walk(-48, 9.6, 48, 3.2);
    walk(-10.6, 48, 3.2, 48);
    walk(10.6, 48, 3.2, 48);
    // plaza rim curb with gaps for the roads
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const gap = Math.abs(Math.sin(a)) < 0.28 || Math.abs(Math.cos(a)) < 0.22;
      if (gap) continue;
      b.box('concreteDark', Math.cos(a) * 27, 0.09, Math.sin(a) * 27, 6.4, 0.18, 0.7, {
        ry: -a, collide: false,
      });
    }

    // broken road markings
    for (let i = 0; i < 18; i++) {
      b.box('concretePale', 0, 0.035, -28 - i * 3, 0.22, 0.01, 1.5, { collide: false });
    }
    for (let i = 0; i < 8; i++) {
      b.box('concretePale', -20 + i * 3.6, 0.035, 0, 1.6, 0.01, 0.2, { collide: false });
    }

    // scattered asphalt cracks / potholes
    for (let i = 0; i < 22; i++) {
      const x = rand(-80, 90);
      const z = rand(-100, 90);
      if (Math.hypot(x, z) < 28) continue;
      b.plate('asphalt', x, 0.028, z, rand(1.5, 6), rand(1, 4), { tile: 4, ry: rand(0, 3) });
    }

    // ---- the streets were never repaired ---------------------------------
    // buckled slabs, heaved up where the ground shifted
    const slabRows = [
      [-11, 11, -79, -25, 24],
      [25, 69, -7, 7, 14],
      [-69, -25, -7, 7, 14],
      [-8, 8, 26, 70, 18],
    ];
    for (const [x0, x1, z0, z1, n] of slabRows) {
      for (let i = 0; i < n; i++) {
        const h = 0.08 + rand(0, 0.2);
        b.box(rand() > 0.72 ? 'concreteDark' : 'asphalt',
          rand(x0, x1), 0.02 + h / 2, rand(z0, z1),
          rand(1.4, 3.2), h, rand(1, 2.6),
          { ry: rand(-0.5, 0.5), collide: false, tile: 2.4 });
      }
    }
    // gaping cracks
    for (let i = 0; i < 30; i++) {
      const north = i % 2 === 0;
      b.box('charred',
        north ? rand(-11, 11) : rand(-70, 70),
        0.045,
        north ? rand(-78, -25) : rand(-8, 8),
        rand(0.14, 0.34), 0.02, rand(2.4, 8),
        { ry: rand(0, 3), collide: false });
    }
    // burst water main: snapped pipes along the west kerb
    for (let i = 0; i < 8; i++) {
      const z = -34 - i * 6.5;
      b.cylinder('metalDark', -10.8, 0.34 + (i % 2) * 0.1, z, 0.3, 0.3, 4.2,
        { seg: 8, axis: 'z', collide: false, tile: 2, ry: rand(-0.1, 0.1) });
    }
    // weeds pushing through the asphalt
    for (let i = 0; i < 24; i++) {
      const north = i % 3 === 0;
      b.quad('vineDead', north ? rand(-10, 10) : rand(-60, 60), 0.22,
        north ? rand(-76, -26) : rand(-7, 7),
        rand(0.4, 1.1), rand(0.35, 0.9), rand(0, 3.14));
    }
    // sagging overhead cables
    for (const [ax, az, bx, bz] of [[-12.5, -29, -12.9, -41], [13.2, -50, 13.6, -62], [-12.4, 40, -12.8, 52]]) {
      const mid = [(ax + bx) / 2, 5.2, (az + bz) / 2];
      b.strut('metalDark', new THREE.Vector3(ax, 7.4, az), new THREE.Vector3(...mid), 0.025);
      b.strut('metalDark', new THREE.Vector3(...mid), new THREE.Vector3(bx, 6.6, bz), 0.025);
    }
  }

  _districtApproaches(b) {
    // Solar walkway approach: stairs + support columns (walkway itself lives in Solar.js)
    b.block('concreteDark', 31, 0, 0, 4, 0.3, 12, { tile: 3 });
    for (let i = 0; i < 5; i++) {
      b.block('concretePale', 30 + i * 0.9, 0, 0, 0.9, 0.3 + i * 0.45, 11, { tile: 3, collide: true });
    }
    // railings
    for (let i = 0; i < 6; i++) {
      b.box('metalDark', 33, 2.2, -5.6, 0.08, 1.1, 0.08, { collide: false });
      b.box('metalDark', 33, 2.2, 5.6, 0.08, 1.1, 0.08, { collide: false });
    }

    // Water station approach: raised drainage channel + pipes
    b.block('concreteDark', -40, 0, -6, 26, 0.35, 3.2, { tile: 3 });
    b.block('concreteDark', -40, 0, 6, 26, 0.35, 3.2, { tile: 3 });
    for (let i = 0; i < 7; i++) {
      b.cylinder('metalDark', -30 - i * 3.4, 0.7, -8.4, 0.35, 0.35, 1.4, { seg: 8, axis: 'z', collide: false });
    }

    // Courtyard approach: broken gate pylons
    b.block('concretePale', -12, 0, 62, 2.4, 6.5, 2.4, { tile: 3 });
    b.block('concretePale', 12, 0, 62, 2.4, 6.5, 2.4, { tile: 3 });
    b.box('metalDark', 0, 6.2, 62, 22, 0.5, 0.5, { collide: false });
    b.box('concreteDark', 5, 4.4, 62, 8, 0.4, 0.6, { ry: 0.08, collide: false });

    // Core approach: ceremonial colonnade
    for (let i = 0; i < 8; i++) {
      const z = -46 - i * 9;
      b.cylinder('concretePale', -14, 2.5, z, 0.55, 0.7, 5, { seg: 8, tile: 3 });
      b.cylinder('concretePale', 14, 2.5, z, 0.55, 0.7, 5, { seg: 8, tile: 3 });
      b.box('concreteDark', 0, 0.2, z, 30, 0.4, 2.2, { tile: 4, collide: false });
    }
  }

  _towers(b) {
    for (const spec of TOWERS) this._tower(b, spec);
  }

  _tower(b, spec) {
    const rnd = seeded(Math.floor(spec.x * 71 + spec.z * 37 + 13));
    const { x, z, w, d, h, style } = spec;
    const needWindows = Math.hypot(x, z + 20) < 105 || Math.hypot(x, z) < 95;

    // The event left most of the skyline broken: collapsed, gutted, or battered.
    const fate = rnd();
    const collapsed = fate < 0.2;
    const ruined = fate < 0.62;
    const targetH = collapsed ? h * (0.16 + rnd() * 0.16)
      : ruined ? h * (0.5 + rnd() * 0.3) : h;

    b.block('concreteDark', x, 0, z, w + 3.2, 1.1, d + 3.2, { tile: 5, collide: true });
    b.block('concretePale', x, 1.1, z, w + 1.2, 0.35, d + 1.2, { tile: 3, collide: false });

    let y = 1.45;
    let cw = w;
    let cd = d;
    let cx = x;
    let cz = z;
    const segs = 3 + ((rnd() * 3) | 0);
    let remain = targetH;
    for (let s = 0; s < segs; s++) {
      const segH = Math.max(4, (remain / (segs - s)) * (0.82 + rnd() * 0.34));
      const segMat = ruined && rnd() > 0.5 ? 'charred' : style;
      b.block(segMat, cx, y, cz, cw, segH, cd, { tile: 9 });
      if (needWindows && !ruined) this._addWindows(cx, y, cz, cw, segH, cd, rnd);
      // blown-out holes in the shell
      if (ruined && rnd() > 0.4) this._blowout(b, cx, y + segH * (0.3 + rnd() * 0.45), cz, cw, cd, rnd);
      // floor bands, mostly snapped on the upper storeys
      const bands = Math.max(1, Math.floor(segH / 9));
      for (let bb = 1; bb <= bands; bb++) {
        if (ruined && rnd() > 0.65) continue;
        b.box('concreteDark', cx, y + (segH / (bands + 1)) * bb, cz, cw + 0.18, 0.16, cd + 0.18, {
          collide: false, tile: 4,
        });
      }
      y += segH;
      remain -= segH;
      const shrink = 0.8 + rnd() * 0.12;
      cw = Math.max(5.5, cw * shrink);
      cd = Math.max(5.5, cd * shrink);
      if (!collapsed) {
        cx += (rnd() - 0.5) * 2.4;
        cz += (rnd() - 0.5) * 2.4;
      }
    }

    const roofY = Math.min(y, 1.45 + targetH);
    if (!ruined) {
      // damaged crown: broken slabs & exposed structure
      const damage = h > 28 ? 0.5 + rnd() * 0.5 : 0.25;
      const chunks = 3 + ((rnd() * 4) | 0);
      for (let i = 0; i < chunks; i++) {
        const ch = (2 + rnd() * 6) * damage;
        b.box(style, cx + (rnd() - 0.5) * cw * 0.7, y + ch / 2, cz + (rnd() - 0.5) * cd * 0.7,
          cw * (0.18 + rnd() * 0.4), ch, cd * (0.18 + rnd() * 0.4), { ry: rnd() * 1.5, collide: false, tile: 6 });
      }
      for (let i = 0; i < 5; i++) {
        const rx = cx + (rnd() - 0.5) * cw * 0.7;
        const rz = cz + (rnd() - 0.5) * cd * 0.7;
        b.strut('metalDark', new THREE.Vector3(rx, y, rz), new THREE.Vector3(rx + (rnd() - 0.5) * 3, y + 3 + rnd() * 4, rz + (rnd() - 0.5) * 3), 0.06);
      }

      // roof furniture survives only where the roof held
      b.block('metalDark', cx, roofY, cz, cw * 0.55, 1.8, cd * 0.5, { tile: 3, collide: false });
      b.cylinder('metal', cx + cw * 0.25, roofY + 1.6, cz - cd * 0.2, 1.4, 1.5, 2.8, { seg: 10, collide: false });
      b.cylinder('metalDark', cx + cw * 0.25, roofY + 3.1, cz - cd * 0.2, 0.1, 0.1, 1.6, { seg: 5, collide: false });
      if (rnd() > 0.5) {
        b.cylinder('metalDark', cx - cw * 0.22, roofY + 4, cz + cd * 0.1, 0.07, 0.14, 8, { seg: 5, collide: false });
        this.beacons.push({ x: cx - cw * 0.22, y: roofY + 8.2, z: cz + cd * 0.1 });
      }
    } else {
      // gutted crown: splintered walls, exposed floor plates, hanging rebar
      const spikes = 5 + ((rnd() * 5) | 0);
      for (let i = 0; i < spikes; i++) {
        const sh = 1.5 + rnd() * 6;
        b.box(rnd() > 0.4 ? 'charred' : 'concreteDark',
          cx + (rnd() - 0.5) * cw * 0.9, roofY + sh / 2, cz + (rnd() - 0.5) * cd * 0.9,
          cw * (0.1 + rnd() * 0.24), sh, cd * (0.1 + rnd() * 0.24),
          { ry: rnd() * 3, collide: false, tile: 4 });
      }
      for (let i = 0; i < 3; i++) {
        const fy = roofY - 1.4 - rnd() * Math.min(16, targetH * 0.5);
        const pw = cw * (0.4 + rnd() * 0.6);
        const pd = cd * (0.35 + rnd() * 0.6);
        this._slab(b, 'concrete', cx + (rnd() - 0.5) * cw * 0.5, fy, cz + (rnd() - 0.5) * cd * 0.5,
          pw, 0.35, pd, 0, (rnd() - 0.5) * 0.2, 0);
        for (let k = 0; k < 3; k++) {
          const rx = cx + (rnd() - 0.5) * pw;
          const rz2 = cz + (rnd() - 0.5) * pd;
          b.strut('metalDark', new THREE.Vector3(rx, fy, rz2),
            new THREE.Vector3(rx + (rnd() - 0.5) * 0.7, fy - 0.7 - rnd() * 1.7, rz2 + (rnd() - 0.5) * 0.7), 0.035);
        }
      }
      // a whole facade panel peeled off and leaning against the shell
      if (rnd() > 0.4) {
        const side = rnd() > 0.5 ? 1 : -1;
        this._slab(b, 'concreteDark', cx + side * cw * 0.55, roofY - 3.4, cz + (rnd() - 0.5) * cd * 0.5,
          cw * 0.7, 0.45, cd * 0.6, 0, side * (0.45 + rnd() * 0.35), rnd() * 0.6);
      }
      if (collapsed) {
        // pancaked floor plates
        for (let i = 0; i < 4; i++) {
          this._slab(b, rnd() > 0.5 ? 'concrete' : 'concreteDark', cx + (rnd() - 0.5) * cw,
            roofY + 0.5 + i * 0.55 + rnd() * 0.4, cz + (rnd() - 0.5) * cd,
            cw * (0.5 + rnd() * 0.5), 0.4, cd * (0.4 + rnd() * 0.6),
            (rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.25, rnd() * 2);
        }
      }
      if (this.ruinTops.length < 6) this.ruinTops.push({ x: cx, y: roofY + 1.5, z: cz, s: 0.7 + rnd() * 0.6 });
    }

    // rubble skirt - far heavier around the wrecked towers
    const chunks = ruined ? 12 + ((rnd() * 8) | 0) : 6;
    for (let i = 0; i < chunks; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.max(w, d) * (ruined ? 0.75 : 0.55) + rnd() * (ruined ? 7 : 3);
      this._rubbleChunk(b, x + Math.cos(a) * rr, z + Math.sin(a) * rr, 0.4 + rnd() * (ruined ? 2.1 : 1.3));
    }
    if (ruined) {
      for (let i = 0; i < 3; i++) {
        const a = rnd() * Math.PI * 2;
        const rr = Math.max(w, d) * 0.8 + rnd() * 4;
        this._slab(b, 'concreteDark', x + Math.cos(a) * rr, 0.2, z + Math.sin(a) * rr,
          2.6 + rnd() * 4, 0.35 + rnd() * 0.3, 1.8 + rnd() * 3,
          (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, rnd() * 3);
      }
    }
  }

  _addWindows(cx, y, cz, w, h, d, rnd) {
    if (this.windowMatrices.length > 1900) return;
    const floors = Math.max(1, Math.floor((h - 2.4) / 3.4));
    const faces = [
      { axis: 'x', sign: 1, span: d, rot: Math.PI / 2 },
      { axis: 'x', sign: -1, span: d, rot: -Math.PI / 2 },
      { axis: 'z', sign: 1, span: w, rot: 0 },
      { axis: 'z', sign: -1, span: w, rot: Math.PI },
    ];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    for (let f = 0; f < floors; f++) {
      const wy = y + 2.2 + f * 3.4;
      for (const face of faces) {
        const cols = Math.floor((face.span - 2) / 3.1);
        for (let c = 0; c < cols; c++) {
          if (rnd() > 0.4 || this.windowMatrices.length > 1900) continue;
          const off = (c - (cols - 1) / 2) * 3.1;
          if (Math.abs(off) > face.span / 2 - 1) continue;
          if (face.axis === 'x') {
            pos.set(cx + face.sign * (w / 2 + 0.08), wy, cz + off);
          } else {
            pos.set(cx + off, wy, cz + face.sign * (d / 2 + 0.08));
          }
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), face.rot);
          m.compose(pos, q, sc);
          this.windowMatrices.push(m.clone());
          const warm = rnd();
          if (warm > 0.72) this.windowColors.push(new THREE.Color(0x66e6ff));
          else if (warm > 0.58) this.windowColors.push(new THREE.Color(0xffe0a0));
          else this.windowColors.push(new THREE.Color(0xffa64d));
        }
      }
    }
  }

  _windows() {
    if (!this.windowMatrices.length) return;
    const geo = new THREE.PlaneGeometry(1.35, 1.7);
    this.windowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, this.windowMaterial, this.windowMatrices.length);
    for (let i = 0; i < this.windowMatrices.length; i++) {
      mesh.setMatrixAt(i, this.windowMatrices[i]);
      mesh.setColorAt(i, this.windowColors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = 'city_windows';
    this.scene.add(mesh);
    this.windows = mesh;
  }

  _skyline(b) {
    const rnd = seeded(777);
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + rnd() * 0.08;
      const r = 155 + rnd() * 70;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const w = 12 + rnd() * 22;
      const d = 12 + rnd() * 22;
      const h = 26 + rnd() * 84;
      const broken = rnd() > 0.45;
      b.block(broken && rnd() > 0.5 ? 'charred' : (rnd() > 0.5 ? 'facadeDark' : 'facade'),
        x, 0, z, w, h, d, { tile: 12, collide: false });
      if (!broken && rnd() > 0.55) {
        b.block('facadeDark', x + w * 0.2, h, z, w * 0.5, 6 + rnd() * 14, d * 0.5, { tile: 10, collide: false });
      } else if (broken) {
        for (let k = 0; k < 3; k++) {
          b.block('charred', x + (rnd() - 0.5) * w, h, z + (rnd() - 0.5) * d,
            w * 0.18, 2 + rnd() * 10, d * 0.18, { tile: 8, collide: false });
        }
      }
    }
    // distant elevated broken viaduct for scale
    for (let i = 0; i < 12; i++) {
      const x = -120 + i * 21;
      if (i === 7) continue;
      b.block('concreteDark', x, 9, 152, 18, 1.6, 8, { tile: 6, collide: false });
      b.block('concretePale', x, 0, 152, 3.4, 9, 3.4, { tile: 4, collide: false });
    }
  }

  _props(b) {
    const rnd = seeded(3006);
    // abandoned cars
    const carSpots = [
      [5.5, -28, 0.15], [-6, -44, 3.3], [6.5, -66, -0.3], [-4.5, -58, 0.1],
      [5, 33, 0.2], [-5, 42, 3.05], [34, 3.4, 1.6], [-38, -4.2, 1.55],
      [52, -3.4, 1.5], [-62, 4, -1.5], [18, 68, 0.9], [-20, 74, 2.2],
    ];
    for (const [x, z, ry] of carSpots) this._car(b, x, z, ry, pick(['rustPaint', 'tealPaint', 'cream', 'metalDark']));

    // burnt-out wrecks left where they stopped
    for (const [x, z, ry] of [[-6.5, -36, 0.35], [10.5, 40, 2.7], [46, -7, 2.9], [-46, 4.5, 0.2], [24, 33, 1.9]]) {
      this._car(b, x, z, ry, 'charred');
    }
    // scorched asphalt under the fires
    for (const [x, z, r] of [[-6.5, -36, 3.4], [10.5, 40, 3], [46, -7, 2.8], [24, 33, 3.2]]) {
      const disc = new THREE.CircleGeometry(r, 24);
      disc.rotateX(-Math.PI / 2);
      b.add('scorch', disc, x, 0.047, z);
    }

    // jersey barriers along the avenue
    for (let i = 0; i < 6; i++) {
      b.block('concretePale', -10.5, 0, -36 - i * 2.6, 0.7, 1, 2.2, { tile: 2 });
    }
    // industrial crates & barrels near the water approach
    for (let i = 0; i < 5; i++) {
      const x = -34 - i * 2.2;
      const z = 12 + (i % 2) * 3;
      b.block(i % 2 ? 'tealPaint' : 'rustPaint', x, 0, z, 1.6, 1.4, 1.6, { tile: 2 });
      b.box('metalDark', x, 1.42, z, 1.65, 0.08, 1.65, { collide: false });
    }
    for (let i = 0; i < 4; i++) {
      b.cylinder('rustPaint', -28 + i * 1.6, 0.55, 16, 0.42, 0.42, 1.1, { seg: 10, collide: true, tile: 2 });
    }
    // shipping container
    b.block('tealPaint', 23, 0, 17, 7, 2.6, 2.7, { ry: 0.35, tile: 3 });
    for (let i = 0; i < 6; i++) {
      b.box('metalDark', 20.6 + i * 0.9, 1.3, 17.9, 0.08, 2.4, 0.1, { collide: false });
    }
    // benches around plaza
    const benches = [0.6, 1.9, 3.5, 4.7, 5.6];
    for (const a of benches) {
      const r = 13;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      this._bench(b, x, z, -a + Math.PI / 2);
    }
    // planters
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * 19.5;
      const z = Math.sin(a) * 19.5;
      b.block('concreteDark', x, 0, z, 2.6, 0.7, 2.6, { ry: -a, tile: 2 });
      b.block('ground', x, 0.68, z, 2.1, 0.06, 2.1, { collide: false, tile: 1 });
    }
    // tutorial-friendly low crates near start
    b.block('rustPaint', -4, 0, 25, 1.4, 0.7, 1.4, { tile: 1.5 });
    b.block('cream', 4, 0, 22, 1.1, 1, 1.1, { tile: 1.5 });

    // rubble across the city
    for (let i = 0; i < 42; i++) {
      const x = rand(-95, 105);
      const z = rand(-105, 115);
      if (Math.hypot(x, z) < 26) continue;
      if (this._inDistrict(x, z)) continue;
      const count = 4 + ((rnd() * 8) | 0);
      for (let j = 0; j < count; j++) {
        this._rubbleChunk(b, x + (rnd() - 0.5) * 6, z + (rnd() - 0.5) * 6, 0.4 + rnd() * 2.0);
      }
    }
  }

  _inDistrict(x, z) {
    if (x > 66 && x < 108 && Math.abs(z) < 24) return true;
    if (x > -96 && x < -52 && Math.abs(z) < 22) return true;
    if (Math.abs(x) < 28 && z > 60 && z < 120) return true;
    if (Math.abs(x) < 34 && z < -62 && z > -112) return true;
    return false;
  }

  _rubbleChunk(b, x, z, s) {
    const h = s * (0.4 + Math.random() * 0.5);
    const roll = Math.random();
    b.box(roll > 0.72 ? 'charred' : roll > 0.4 ? 'concreteDark' : 'concrete',
      x, h / 2, z, s * (0.6 + Math.random()), h, s * (0.6 + Math.random()), {
        ry: Math.random() * 3, collide: false, tile: 2,
      });
    if (Math.random() > 0.5) {
      b.strut('metalDark',
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.4, z + (Math.random() - 0.5) * 2), 0.025);
    }
    if (Math.random() > 0.78) {
      this._slab(b, 'concreteDark', x + (Math.random() - 0.5) * s, h * 0.5, z + (Math.random() - 0.5) * s,
        s * 1.4, 0.22, s * 0.8, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, Math.random() * 3);
    }
  }

  _car(b, x, z, ry, mat) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const L = (dx, dz) => [x + dx * c - dz * s, z + dx * s + dz * c];
    b.box(mat, x, 0.62, z, 1.95, 0.66, 4.4, { ry, tile: 2.2 });
    const [cabinX, cabinZ] = L(0, -0.15);
    b.box(mat, cabinX, 1.2, cabinZ, 1.72, 0.56, 2.2, { ry, tile: 2 });
    const [gx, gz] = L(0, -0.15);
    b.box(mat === 'charred' ? 'hole' : 'glassDark', gx, 1.24, gz, 1.74, 0.36, 2.02, { ry, collide: false });
    for (const [wx, wz] of [[-0.92, 1.42], [0.92, 1.42], [-0.92, -1.42], [0.92, -1.42]]) {
      const [px, pz] = L(wx, wz);
      if (Math.random() < 0.16) continue;
      b.cylinder('rubber', px, 0.36, pz, 0.36, 0.36, 0.26, { seg: 10, axis: 'x', collide: false, ry });
    }
    b.box('metalDark', x, 0.36, z, 2.0, 0.16, 4.2, { ry, collide: false });
    this.colliders.add(x - 1.3, 0, z - 2.4, x + 1.3, 1.5, z + 2.4);
  }

  _bench(b, x, z, ry) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const L = (dx, dz) => [x + dx * c - dz * s, z + dx * s + dz * c];
    b.block('rustPaint', x, 0.44, z, 2.4, 0.12, 0.6, { ry, tile: 1.5 });
    b.box('rustPaint', ...(() => { const [px, pz] = L(0, -0.32); return [px, 0.75, pz]; })(), 2.4, 0.5, 0.1, { ry, collide: false });
    for (const [dx, dz] of [[-1, 0], [1, 0]]) {
      const [px, pz] = L(dx, 0);
      b.box('metalDark', px, 0.22, pz, 0.08, 0.44, 0.5, { collide: false });
    }
    this.colliders.add(x - 1.3, 0, z - 0.5, x + 1.3, 0.6, z + 0.5);
  }

  _lamps(b) {
    const spots = [
      [8, 18, -0.4], [-8, 18, 0.4], [8, -16, -2.6], [-8, -16, 2.6],
      [15, -34, -1.2], [-15, -40, 1.2], [15, -60, -1.2], [-15, -66, 1.2],
      [28, 7, 1.2], [-28, 7, -1.2], [8, 34, 0.2], [-8, 44, 3.1],
    ];
    spots.forEach(([x, z, ry], i) => {
      // every third post was uprooted by the blast
      if (i % 3 === 1) {
        b.strut('metalDark', new THREE.Vector3(x, 0.15, z), new THREE.Vector3(x + 2.4, 4.6, z + 1.2), 0.075);
        b.box('metalDark', x + 3.1, 0.22, z + 1.5, 1.4, 0.14, 0.42, { ry, collide: false });
        b.box('hole', x + 3.1, 0.31, z + 1.5, 0.5, 0.03, 0.3, { ry, collide: false });
        this._rubbleChunk(b, x + 1.8, z + 0.9, 0.7);
        return;
      }
      b.cylinder('metalDark', x, 3.1, z, 0.07, 0.1, 6.2, { seg: 6, collide: false });
      b.box('metalDark', x - Math.sin(ry) * 0.55, 6.2, z - Math.cos(ry) * 0.55, 1.4, 0.08, 0.08, { ry, collide: false });
      const lx = x - Math.sin(ry) * 1.15;
      const lz = z - Math.cos(ry) * 1.15;
      b.box('metalDark', lx, 6.05, lz, 0.8, 0.16, 0.34, { ry, collide: false });

      const mat = new THREE.MeshBasicMaterial({ color: 0xffc07a, transparent: true, opacity: 0.12, toneMapped: false });
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 0.26), mat);
      bulb.position.set(lx, 5.95, lz);
      bulb.rotation.y = ry;
      this.scene.add(bulb);
      this.lamps.push({ mesh: bulb, mat, x: lx, z: lz });
      if (Math.hypot(x, z) < 24) {
        const light = new THREE.PointLight(0xffb066, 0, 16, 2);
        light.position.set(lx, 5.7, lz);
        this.scene.add(light);
        this.lamps[this.lamps.length - 1].light = light;
      }
    });
    // watch towers / industrial flood lights, half dead
    for (const [x, z] of [[24, -70], [-24, -74], [24, 30], [-24, 28]]) {
      b.block('metalDark', x, 0, z, 0.9, 8, 0.9, { tile: 3 });
      b.box('metalDark', x, 8.1, z, 2.6, 0.5, 1.2, { collide: false });
      const mat = new THREE.MeshBasicMaterial({ color: 0x99e8ff, transparent: true, opacity: 0.05, toneMapped: false });
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.7), mat);
      pane.position.set(x, 8.1, z + 0.65);
      this.scene.add(pane);
      this.lamps.push({ mesh: pane, mat, x, z });
    }
  }

  _vines(b) {
    const rnd = seeded(5150);
    for (const spec of TOWERS) {
      if (rnd() > 0.75) continue;
      const n = 2 + ((rnd() * 4) | 0);
      for (let i = 0; i < n; i++) {
        const face = rnd() > 0.5 ? 1 : -1;
        const w = spec.w;
        const off = (rnd() - 0.5) * (w - 2);
        const hgt = 4 + rnd() * 9;
        const g = new THREE.PlaneGeometry(1.6 + rnd() * 1.8, hgt);
        g.translate(0, hgt / 2, 0);
        b.add('vineDead', g, spec.x + face * (w / 2 + 0.12), 1.4 + rnd() * 5, spec.z + off, face > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
  }

  _treeGraves(b) {
    const rnd = seeded(6060);
    const spots = [
      [-19, 12], [20, -14], [-22, -18], [16, 20], [12, 15], [-14, 30],
      [22, 52], [-24, 58], [30, 66], [-30, 70], [6, 58],
      [-58, 14], [-84, 12], [-60, -13], [-92, -10],
      [76, 14], [96, 16], [80, -14],
      [20, 98], [-20, 100], [8, 112], [-8, 78],
      [-44, -86], [44, -84], [8, -118], [-24, -120],
    ];
    for (const [x, z] of spots) {
      const h = 3.4 + rnd() * 3.4;
      b.cylinder('bark', x, h / 2, z, 0.16, 0.36, h, { seg: 7, collide: false, tile: 2 });
      for (let i = 0; i < 4; i++) {
        const a = rnd() * Math.PI * 2;
        const sy = h * (0.55 + rnd() * 0.4);
        b.strut('bark', new THREE.Vector3(x, sy, z),
          new THREE.Vector3(x + Math.cos(a) * (1 + rnd() * 1.8), sy + 1.4 + rnd() * 1.8, z + Math.sin(a) * (1 + rnd() * 1.8)), 0.09);
      }
    }
  }

  _holoSigns() {
    const makeSign = (text, sub, color) => {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 256;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(4,8,10,1)';
      ctx.fillRect(0, 0, 512, 256);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.strokeRect(8, 8, 496, 240);
      ctx.fillStyle = color;
      ctx.font = 'bold 92px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(text, 256, 130);
      ctx.font = '26px Consolas, monospace';
      ctx.globalAlpha = 0.7;
      ctx.fillText(sub, 256, 185);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.18, toneMapped: false,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(11, 5.5), mat);
      this.scene.add(mesh);
      this.signs.push({ mesh, mat, base: 0.55 });
      return mesh;
    };

    const s1 = makeSign('ASTER', 'CIVIC TRANSIT AUTHORITY', '#ffb347');
    s1.position.set(-23.7, 10.5, -30);
    s1.rotation.y = Math.PI / 2;
    s1.rotation.z = 0.1;
    const s2 = makeSign('SOL', 'DISTRICT 04 · SOLAR', '#5ff2e0');
    s2.position.set(43, 8, 27.5);
    s2.rotation.y = Math.PI;
    s2.rotation.z = -0.07;
    const s3 = makeSign('AQUA', 'WATER RECLAMATION', '#5ff2e0');
    s3.position.set(-43, 9, -27.5);
    s3.rotation.y = 0;
    s3.rotation.z = 0.05;
    // the evacuation notice nobody got to read
    const s4 = makeSign('SHELTER 7', 'EVACUATION ROUTE CLOSED', '#ff5a3c');
    s4.position.set(7.6, 4.4, 24.5);
    s4.rotation.y = -0.18;
    s4.rotation.z = 0.16;
    s4.scale.setScalar(0.42);
  }

  // ------------------------------------------------------------------
  _slab(b, mat, x, y, z, w, h, d, rx = 0, rz = 0, ry = 0, tile = 4) {
    const g = new THREE.BoxGeometry(w, h, d);
    b._scaleBoxUV(g, w, h, d, tile);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    b.add(mat, g, x, y, z);
  }

  _blowout(b, cx, y, cz, cw, cd, rnd) {
    const face = (rnd() * 4) | 0;
    const along = face < 2 ? cd : cw;
    const off = (rnd() - 0.5) * along * 0.55;
    const w = along * (0.25 + rnd() * 0.4);
    const h = 1.8 + rnd() * 4.2;
    if (face < 2) {
      const sign = face === 0 ? 1 : -1;
      b.quad('hole', cx + sign * (cw / 2 + 0.05), y, cz + off, w, h, sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    } else {
      const sign = face === 2 ? 1 : -1;
      b.quad('hole', cx + off, y, cz + sign * (cd / 2 + 0.05), w, h, sign > 0 ? 0 : Math.PI);
    }
  }

  _disaster(b) {
    const rnd = seeded(19999);
    // impact craters on every approach
    this._crater(b, 17, -31, 4.2, rnd);
    this._crater(b, -19, 27, 3.6, rnd);
    this._crater(b, 34, 58, 3.8, rnd);
    this._crater(b, -20, -72, 3.0, rnd);
    this._crater(b, 62, -22, 3.2, rnd);

    // blast scars across the civic plaza
    for (const [x, z, r] of [[16, -16, 3.4], [-17, 12, 2.8]]) {
      const disc = new THREE.CircleGeometry(r, 28);
      disc.rotateX(-Math.PI / 2);
      b.add('scorch', disc, x, 0.066, z);
    }

    // an elevated walkway that came down during the event
    this._collapsedSpan(b, 40, 9.5, rnd);

    // the barricade the city never held
    this._checkpoint(b, 0, 23.5);

    // burnt-out service buses
    this._bus(b, -20, 14, 0.4);
    this._bus(b, 26, -34, 0.05);

    // toppled barriers
    for (let i = 0; i < 16; i++) {
      const x = rand(-60, 65);
      const z = rand(-90, 70);
      if (Math.hypot(x, z) < 10) continue;
      b.box('concretePale', x, 0.4, z, rand(1.5, 2.4), 0.7, 0.45,
        { ry: rand(0, Math.PI), collide: false, tile: 2 });
    }
    // paper drifts over the pavement
    for (let i = 0; i < 80; i++) {
      const x = rand(-60, 60);
      const z = rand(-80, 65);
      if (Math.hypot(x, z) < 12) continue;
      b.plate('paper', x, 0.05, z, rand(0.18, 0.5), rand(0.12, 0.35), { ry: rand(0, 3.14) });
    }
  }

  _crater(b, x, z, r, rnd) {
    // scorched blast bowl
    const disc = new THREE.CircleGeometry(r * 1.05, 40);
    const uv = disc.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 0.4, uv.getY(i) * r * 0.4);
    disc.rotateX(-Math.PI / 2);
    b.add('scorch', disc, x, 0.055, z);
    // buckled rim of concrete thrown outward
    const n = Math.round(10 + r * 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.18;
      const rr = r * (0.88 + rnd() * 0.28);
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      this._slab(b, rnd() > 0.45 ? 'concrete' : 'concreteDark', px,
        0.16 + rnd() * 0.2, pz, 1.1 + rnd() * 2.2, 0.22 + rnd() * 0.24, 0.8 + rnd() * 1.1,
        (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.6, a + Math.PI / 2, 2);
      if (rnd() > 0.6) {
        this._rubbleChunk(b, px + (rnd() - 0.5) * 1.5, pz + (rnd() - 0.5) * 1.5, 0.4 + rnd() * 0.9);
      }
    }
    // exposed rebar in the bowl
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = r * rnd() * 0.6;
      b.strut('metalDark',
        new THREE.Vector3(x + Math.cos(a) * rr, 0.05, z + Math.sin(a) * rr),
        new THREE.Vector3(x + Math.cos(a) * (rr + rnd()), 0.6 + rnd() * 1.8, z + Math.sin(a) * (rr + rnd())), 0.03);
    }
    for (let i = 0; i < 6; i++) {
      this._rubbleChunk(b, x + rand(-r, r), z + rand(-r, r), 0.3 + rand(0, 0.5));
    }
  }

  _collapsedSpan(b, x, z, rnd) {
    // elevated walkway that smashed down through the pavement
    const tilt = 0.62;
    const len = 13;
    this._slab(b, 'concretePale', x, 3.4, z, len, 0.7, 6.4, 0, tilt, 0, 4);
    for (let i = -1; i <= 1; i++) {
      this._slab(b, 'concreteDark', x + i * 3.2 * Math.cos(tilt), 3.4 - i * 3.2 * Math.sin(tilt) - 0.5, z,
        0.7, 0.45, 6.0, 0, tilt, 0, 4);
    }
    // torn end and hanging rebar
    for (let i = 0; i < 8; i++) {
      const bx = x + Math.cos(tilt) * len / 2 + (rnd() - 0.5) * 3;
      const by = 3.4 - Math.sin(tilt) * len / 2 + (rnd() - 0.5) * 1.6;
      b.strut('metalDark', new THREE.Vector3(bx, by, z + (rnd() - 0.5) * 5),
        new THREE.Vector3(bx + (rnd() - 0.5) * 2.4, by - 1 - rnd() * 2.2, z + (rnd() - 0.5) * 5), 0.035);
    }
    // support pier, snapped at the base
    b.block('concreteDark', x + 5.4, 0, z, 2, 7, 2, { tile: 3 });
    b.block('concreteDark', x - 4.2, 0, z - 2.6, 1.5, 2.1, 1.5, { tile: 3, collide: false });
    this._slab(b, 'concreteDark', x - 4.2, 3.9, z - 2.6, 1.3, 2.4, 1.3, 0.5, 0.3, 0.4);
    // rubble field beneath
    for (let i = 0; i < 14; i++) {
      this._rubbleChunk(b, x + (rnd() - 0.5) * 17, z + (rnd() - 0.5) * 8, 0.5 + rnd() * 1.8);
    }
  }

  _checkpoint(b, x, z) {
    // a barricade line that failed: sandbags, gate frame, dead searchlight
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const bx = x + side * 6.4;
        const bz = z + (i - 2) * 0.95;
        for (let r = 0; r < 3; r++) {
          b.box('cream', bx + (Math.random() - 0.5) * 0.12, 0.18 + r * 0.34, bz, 0.82, 0.34, 0.92,
            { ry: 0.05 * r, collide: r === 0, tile: 1.2 });
        }
      }
      for (let i = 0; i < 7; i++) {
        this._rubbleChunk(b, x + side * (8.6 + Math.random() * 3), z + (Math.random() - 0.5) * 7, 0.3 + Math.random() * 0.6);
      }
    }
    b.strut('metalDark', new THREE.Vector3(x - 6.4, 0, z + 0.4), new THREE.Vector3(x - 7.6, 4.6, z + 0.6), 0.1);
    b.strut('metalDark', new THREE.Vector3(x + 6.4, 0, z + 0.4), new THREE.Vector3(x + 6.1, 4.4, z + 0.5), 0.1);
    b.block('metalDark', x - 7.6, 0, z + 3, 0.6, 5.4, 0.6, { tile: 2 });
    b.box('metalDark', x - 7.6, 5.4, z + 3, 1.6, 0.4, 0.7, { collide: false });
    b.block('tealPaint', x + 7.4, 0, z - 3.4, 1.5, 1.2, 1.5, { ry: 0.4, tile: 2 });
    this._slab(b, 'cream', x - 2.4, 0.8, z + 1.5, 2.4, 0.12, 1.1, 0, 0.5, 0.3);
  }

  _bus(b, x, z, ry) {
    b.block('charred', x, 0.5, z, 2.5, 2.35, 9.4, { ry, tile: 3 });
    b.block('metalDark', x, 0, z, 2.1, 0.62, 8.6, { ry, collide: false, tile: 2 });
    // smashed window bands
    b.box('hole', x, 2.35, z, 2.56, 0.72, 7.6, { ry, collide: false });
    b.box('hole', x, 1.5, z, 2.56, 0.48, 6.2, { ry, collide: false });
    // roof torn open at the rear
    b.box('hole', x, 2.87, z - 2.4, 1.9, 0.06, 2.8, { ry, collide: false });
    this._slab(b, 'charred', x + 1.3, 2.4, z - 3.6, 1.8, 0.14, 3.2, 0, 0.9, 0.4);
    for (const [dx, dz] of [[-0.95, 3], [0.95, 3], [-0.95, -3], [0.95, -3]]) {
      if (dx > 0 && dz > 0) continue;
      const px = x + dx * Math.cos(ry) - dz * Math.sin(ry);
      const pz = z + dx * Math.sin(ry) + dz * Math.cos(ry);
      b.cylinder('rubber', px, 0.46, pz, 0.46, 0.46, 0.3, { seg: 8, axis: 'x', collide: false, tile: 1.2, ry });
    }
  }

  _smoke() {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    g.addColorStop(0, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
    const tex = new THREE.CanvasTexture(c);

    const columns = this.ruinTops.slice(0, 5).map((t) => [t.x, t.y, t.z, t.s]);
    columns.push([17, 2, -31, 0.55], [34, 2, 58, 0.6], [26, 3, -34, 0.5]);
    const per = 8;
    const count = columns.length * per;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    this.smokeData = [];
    for (const [sx, sy, sz, ss] of columns) {
      for (let k = 0; k < per; k++) {
        this.smokeData.push({
          x: sx, y: sy, z: sz,
          h: 7 + Math.random() * 4,
          s: ss * (0.8 + Math.random() * 0.6),
          phase: k / per + Math.random() * 0.05,
          drift: 0.6 + Math.random() * 0.9,
        });
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    this.smokeGeo = geo;
    this.smokeMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uColor: { value: new THREE.Color(0x4e473d) } },
      vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (330.0 / max(1.0, -mv.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; varying float vA;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); if (t.a * vA < 0.01) discard;
        gl_FragColor = vec4(uColor, t.a * vA); }`,
      transparent: true,
      depthWrite: false,
    });
    this.smokePts = new THREE.Points(geo, this.smokeMat);
    this.smokePts.frustumCulled = false;
    this.smokePts.renderOrder = 2;
    this.scene.add(this.smokePts);
    this._smokeTick(0);
  }

  _smokeTick(time) {
    if (!this.smokePts) return;
    const pos = this.smokeGeo.attributes.position.array;
    const size = this.smokeGeo.attributes.aSize.array;
    const alpha = this.smokeGeo.attributes.aAlpha.array;
    const fade = 1 - this.restoration * 0.94;
    for (let i = 0; i < this.smokeData.length; i++) {
      const d = this.smokeData[i];
      const life = ((time * 0.055) / d.h + d.phase) % 1;
      pos[i * 3] = d.x + Math.sin(time * 0.2 + i) * 0.8 + life * d.drift * 2.4;
      pos[i * 3 + 1] = d.y + life * d.h * 4.2;
      pos[i * 3 + 2] = d.z + Math.cos(time * 0.16 + i * 0.7) * 0.7 - life * d.drift * 1.1;
      size[i] = (3 + life * 11) * d.s;
      alpha[i] = Math.sin(Math.PI * Math.min(1, life * 1.3)) * 0.34 * fade;
    }
    this.smokeGeo.attributes.position.needsUpdate = true;
    this.smokeGeo.attributes.aSize.needsUpdate = true;
    this.smokeGeo.attributes.aAlpha.needsUpdate = true;
    this.smokePts.visible = this.restoration < 0.99;
  }

  // ------------------------------------------------------------------
  setRestoration(t) {
    this.restoration = clamp(t, 0, 1);
    if (this.windowMaterial) this.windowMaterial.opacity = this.restoration * 0.85;
    for (const lamp of this.lamps) {
      lamp.mat.opacity = 0.1 + this.restoration * 0.9;
      if (lamp.light) lamp.light.intensity = this.restoration * 9;
    }
    for (const s of this.signs) s.mat.opacity = 0.12 + this.restoration * s.base;
    if (this.windows) this.windows.visible = this.restoration > 0.01;
  }

  update(dt, playerPos, camera) {
    this.time += dt;
    // flickering beacons & signs
    const flicker = 0.65 + Math.sin(this.time * 3.1) * 0.2 + Math.sin(this.time * 11.3) * 0.12;
    for (const s of this.signs) {
      s.mat.opacity = (0.1 + this.restoration * s.base) * flicker;
    }
    if (this.vegetation) this.vegetation.update(dt);
    if (this.smokePts) this._smokeTick(this.time);
  }
}
