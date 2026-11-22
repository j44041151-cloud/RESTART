import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { getClothTexture, getClothNormal, getSkinSurface } from '../world/Textures.js';

const HIP_Y = 0.98;

const lerp = (a, b, t) => a + (b - a) * t;

function std(color, roughness = 0.7, metalness = 0.05) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.85 });
}

function addMesh(parent, geometry, material, pos = [0, 0, 0], rot = null) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function box(parent, material, w, h, d, pos, rot) {
  return addMesh(parent, new THREE.BoxGeometry(w, h, d), material, pos, rot);
}

function cyl(parent, material, rTop, rBottom, h, pos, seg = 12, rot) {
  return addMesh(parent, new THREE.CylinderGeometry(rTop, rBottom, h, seg), material, pos, rot);
}

function ball(parent, material, r, pos, scale, seg = 16) {
  const m = addMesh(parent, new THREE.SphereGeometry(r, seg, Math.max(8, seg >> 1)), material, pos);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  return m;
}

/** Flat glowing triangle emblem (the Restorer's signature mark). */
function triangle(parent, material, size, depth, pos, rot) {
  const s = new THREE.Shape();
  s.moveTo(0, size);
  s.lineTo(-size * 0.9, -size * 0.55);
  s.lineTo(size * 0.9, -size * 0.55);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -depth / 2);
  return addMesh(parent, geo, material, pos, rot);
}

/** Bake same-material meshes into one buffer geometry (position/normal/uv). */
function mergeSimple(geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geometries) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vertexCount * 3);
  const nor = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const idx = new Uint32Array(indexCount);
  let vo = 0;
  let io = 0;
  for (const g of geometries) {
    const p = g.attributes.position;
    pos.set(p.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
      io += ia.length;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
      io += p.count;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * The Restorer - a stylised male protagonist built entirely from procedural
 * three.js geometry. Outfit follows the concept art: stone-grey open tech
 * jacket over a black inner shirt, grey hood and scarf, tan leather harness,
 * glowing cyan triangle core, fingerless gloves, cargo trousers with knee
 * guards, and heavy black boots with cyan emblems.
 *
 * The rig is a hierarchy of pivots (hips > torso > head/arms, hips > legs) so
 * every joint can be posed procedurally. Local +Z is forward.
 */
export class Restorer {
  constructor({ accentMaterial } = {}) {
    this.time = 0;
    this.cycle = 0;

    this.accent = accentMaterial || new THREE.MeshBasicMaterial({ color: 0x49c8ff, toneMapped: false });

    this.mat = {
      skin: std(0xc08a6c, 0.62, 0.02),
      skinShade: std(0xa06c52, 0.68, 0.02),
      stubble: std(0x6f5a4b, 0.9, 0.02),
      lip: std(0x8c5a4c, 0.58, 0.02),
      glint: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.7 }),
      hair: std(0x120e0d, 0.88, 0.04),
      brow: std(0x1a1310, 0.84, 0.02),
      eyeWhite: std(0xd9d5cd, 0.3, 0.05),
      iris: std(0x4a3322, 0.3, 0.08),
      pupil: std(0x05070a, 0.2, 0.02),
      jacket: std(0xb5b0a8, 0.62, 0.08),
      jacketPanel: std(0x9d9891, 0.66, 0.07),
      jacketDark: std(0x3b3f46, 0.6, 0.16),
      sleeve: std(0xa8a39c, 0.66, 0.06),
      sleeveDark: std(0x44484f, 0.62, 0.14),
      cuff: std(0x22252a, 0.6, 0.15),
      inner: std(0x17191c, 0.8, 0.04),
      hood: std(0x8f8c86, 0.78, 0.04),
      hoodShade: std(0x6f6c67, 0.8, 0.04),
      trousers: std(0x2b2d32, 0.82, 0.05),
      trousersDark: std(0x212327, 0.86, 0.04),
      boots: std(0x141619, 0.42, 0.3),
      sole: std(0x0c0e10, 0.9, 0.06),
      bootPlate: std(0x4c525a, 0.5, 0.4),
      glove: std(0x141619, 0.55, 0.2),
      kneePad: std(0x5a6068, 0.62, 0.22),
      leather: std(0xa9763f, 0.68, 0.08),
      leatherDark: std(0x7a552e, 0.74, 0.06),
      metal: std(0xb4bcc4, 0.3, 0.9),
      strap: std(0x191c20, 0.84, 0.08),
      backpack: std(0x2a2d31, 0.76, 0.08),
      tech: std(0x4b5563, 0.32, 0.86),
      techDark: std(0x2a313a, 0.48, 0.72),
    };

    // Woven detail maps keep the outfit from reading as flat plastic.
    const jacketMap = getClothTexture('jacket');
    const denimMap = getClothTexture('denim');
    const leatherMap = getClothTexture('leather');
    for (const key of ['jacket', 'jacketPanel', 'sleeve', 'hood', 'hoodShade']) {
      this.mat[key].map = jacketMap;
      this.mat[key].needsUpdate = true;
    }
    for (const key of ['trousers', 'trousersDark', 'strap', 'backpack']) {
      this.mat[key].map = denimMap;
      this.mat[key].needsUpdate = true;
    }
    for (const key of ['leather', 'leatherDark', 'boots', 'glove']) {
      this.mat[key].map = leatherMap;
      this.mat[key].needsUpdate = true;
    }

    // Pore-level detail on exposed skin and matching normal maps on the
    // fabrics, so close shots read as skin and cloth instead of plastic.
    const skinSurf = getSkinSurface('human');
    for (const key of ['skin', 'skinShade', 'lip', 'stubble']) {
      const m = this.mat[key];
      m.map = skinSurf.map;
      m.normalMap = skinSurf.normalMap;
      m.roughnessMap = skinSurf.roughnessMap;
      m.normalScale.set(0.35, 0.35);
      m.roughness = Math.min(m.roughness, 0.6);
      m.envMapIntensity = 1.0;
      m.needsUpdate = true;
    }
    const clothNormals = {
      jacket: getClothNormal('jacket'),
      denim: getClothNormal('denim'),
      leather: getClothNormal('leather'),
    };
    for (const key of ['jacket', 'jacketPanel', 'sleeve', 'hood', 'hoodShade']) {
      this.mat[key].normalMap = clothNormals.jacket;
      this.mat[key].normalScale.set(0.45, 0.45);
      this.mat[key].needsUpdate = true;
    }
    for (const key of ['trousers', 'trousersDark', 'strap', 'backpack']) {
      this.mat[key].normalMap = clothNormals.denim;
      this.mat[key].normalScale.set(0.4, 0.4);
      this.mat[key].needsUpdate = true;
    }
    for (const key of ['leather', 'leatherDark', 'boots', 'glove']) {
      this.mat[key].normalMap = clothNormals.leather;
      this.mat[key].normalScale.set(0.5, 0.5);
      this.mat[key].needsUpdate = true;
    }
    this.mat.hair.normalMap = clothNormals.jacket;
    this.mat.hair.normalScale.set(0.9, 0.9);
    this.mat.hair.needsUpdate = true;

    // Cosmetic / glow pieces are merged but skip the shadow pass; only the
    // large volumes cast shadows, which keeps the character cheap to render.
    this.noShadowMats = new Set([
      this.accent, this.mat.eyeWhite, this.mat.iris, this.mat.pupil, this.mat.brow,
      this.mat.lip, this.mat.skinShade, this.mat.tech, this.mat.techDark,
      this.mat.leather, this.mat.leatherDark, this.mat.metal, this.mat.glint,
    ]);

    this.root = new THREE.Group();
    this.root.name = 'TheRestorer';
    this.bones = {};

    this._build();
  }

  _build() {
    const M = this.mat;

    // ---------------------------------------------------------------- hips --
    const hips = new THREE.Group();
    hips.position.set(0, HIP_Y, 0);
    this.root.add(hips);
    this.hipGroup = hips;

    cyl(hips, M.trousers, 0.172, 0.158, 0.16, [0, -0.03, 0], 14).scale.z = 0.8;
    // black belt + metal buckle
    const belt = cyl(hips, M.cuff, 0.176, 0.176, 0.062, [0, 0.045, 0], 14);
    belt.scale.z = 0.8;
    box(hips, M.metal, 0.078, 0.052, 0.022, [0, 0.045, 0.133]);
    box(hips, M.cuff, 0.04, 0.024, 0.026, [0, 0.045, 0.145]);
    // tan diagonal sling across the hips
    box(hips, M.leather, 0.055, 0.3, 0.02, [0.0, 0.04, 0.148], [0, 0, 0.62]);
    box(hips, M.metal, 0.045, 0.03, 0.024, [0.085, 0.02, 0.16], [0, 0, 0.62]);
    // tan field pouch on the left hip
    box(hips, M.leather, 0.07, 0.115, 0.055, [-0.158, -0.03, 0.115]);
    box(hips, M.leatherDark, 0.075, 0.03, 0.06, [-0.158, 0.02, 0.115]);
    box(hips, this.accent, 0.008, 0.045, 0.012, [-0.158, -0.035, 0.146]);
    box(hips, M.metal, 0.022, 0.02, 0.012, [-0.158, -0.005, 0.146]);
    box(hips, M.cuff, 0.055, 0.075, 0.04, [0.192, 0.0, 0.06]);

    // ---------------------------------------------------------------- legs --
    const buildLeg = (side) => {
      const sx = side === 'L' ? -1 : 1;
      const thigh = new THREE.Group();
      thigh.position.set(sx * 0.105, -0.02, 0);
      hips.add(thigh);

      cyl(thigh, M.trousers, 0.098, 0.084, 0.44, [0, -0.22, 0], 12);
      // cargo pocket
      box(thigh, M.trousersDark, 0.055, 0.14, 0.115, [sx * 0.072, -0.24, 0.005]);
      box(thigh, M.trousers, 0.06, 0.022, 0.12, [sx * 0.072, -0.168, 0.005]);
      box(thigh, this.accent, 0.006, 0.05, 0.02, [sx * 0.101, -0.24, 0.03]);
      // tan thigh strap + buckle
      const strap = cyl(thigh, M.leather, 0.096, 0.096, 0.032, [0, -0.3, 0], 12);
      strap.scale.z = 0.98;
      box(thigh, M.metal, 0.028, 0.026, 0.014, [sx * 0.052, -0.3, 0.088]);
      cyl(thigh, M.trousersDark, 0.1, 0.098, 0.035, [0, -0.02, 0], 12);

      const knee = new THREE.Group();
      knee.position.set(0, -0.44, 0);
      thigh.add(knee);

      // hard knee guard with cyan emblem
      ball(knee, M.kneePad, 0.075, [0, -0.005, 0.038], [1, 0.95, 0.62], 14);
      box(knee, M.trousersDark, 0.13, 0.028, 0.1, [0, 0.062, 0.02]);
      box(knee, M.trousersDark, 0.12, 0.026, 0.09, [0, -0.072, 0.018]);
      triangle(knee, this.accent, 0.026, 0.006, [0, 0.0, 0.086]);
      cyl(knee, M.trousers, 0.078, 0.058, 0.4, [0, -0.2, 0], 12);
      box(knee, M.trousersDark, 0.012, 0.13, 0.02, [sx * 0.055, -0.2, 0.03]);

      const ankle = new THREE.Group();
      ankle.position.set(0, -0.4, 0);
      knee.add(ankle);

      // heavy boot
      cyl(ankle, M.leatherDark, 0.084, 0.08, 0.04, [0, 0.095, 0.004], 12);
      box(ankle, M.boots, 0.122, 0.17, 0.14, [0, 0.03, 0.004]);
      box(ankle, M.bootPlate, 0.104, 0.12, 0.032, [0, 0.055, 0.078]);
      triangle(ankle, this.accent, 0.03, 0.008, [0, 0.06, 0.098], [0, 0, Math.PI]);
      // glowing laces
      box(ankle, this.accent, 0.052, 0.007, 0.006, [0, -0.005, 0.082]);
      box(ankle, this.accent, 0.05, 0.007, 0.006, [0, -0.035, 0.09]);
      box(ankle, M.boots, 0.118, 0.085, 0.24, [0, -0.06, 0.055]);
      ball(ankle, M.boots, 0.058, [0, -0.066, 0.165], [1.02, 0.64, 0.9], 12);
      box(ankle, M.bootPlate, 0.09, 0.03, 0.06, [0, -0.085, 0.155]);
      box(ankle, M.sole, 0.128, 0.036, 0.258, [0, -0.106, 0.055]);
      box(ankle, this.accent, 0.006, 0.012, 0.17, [sx * 0.066, -0.1, 0.06]);
      box(ankle, M.boots, 0.108, 0.058, 0.07, [0, -0.078, -0.058]);
      box(ankle, M.metal, 0.026, 0.02, 0.014, [sx * 0.062, 0.02, 0.07]);

      return { thigh, knee, ankle };
    };
    const legL = buildLeg('L');
    const legR = buildLeg('R');
    this.thighL = legL.thigh;
    this.thighR = legR.thigh;
    this.kneeL = legL.knee;
    this.kneeR = legR.knee;
    this.ankleL = legL.ankle;
    this.ankleR = legR.ankle;

    // --------------------------------------------------------------- torso --
    const torso = new THREE.Group();
    torso.position.set(0, 0.06, 0);
    hips.add(torso);
    this.torso = torso;

    // light stone-grey jacket shell
    const jacket = cyl(torso, M.jacket, 0.208, 0.17, 0.35, [0, 0.185, 0], 16);
    jacket.scale.z = 0.72;
    ball(torso, M.jacket, 0.2, [0, 0.31, -0.004], [1.06, 0.62, 0.78], 18);
    // black inner shirt, visible through the open jacket
    box(torso, M.inner, 0.16, 0.35, 0.05, [0, 0.22, 0.136]);
    cyl(torso, M.hoodShade, 0.072, 0.082, 0.07, [0, 0.4, 0.03], 12);
    // open front panels + dark trim
    box(torso, M.jacketPanel, 0.115, 0.345, 0.05, [-0.107, 0.225, 0.14], [0, 0.08, 0.03]);
    box(torso, M.jacketPanel, 0.115, 0.345, 0.05, [0.107, 0.225, 0.14], [0, -0.08, -0.03]);
    box(torso, M.cuff, 0.014, 0.32, 0.05, [-0.05, 0.23, 0.166], [0, 0.08, 0.03]);
    box(torso, M.cuff, 0.014, 0.32, 0.05, [0.05, 0.23, 0.166], [0, -0.08, -0.03]);
    box(torso, M.metal, 0.008, 0.28, 0.012, [0.044, 0.23, 0.176], [0, -0.08, -0.03]);
    // glowing chest bars on the shirt
    box(torso, this.accent, 0.01, 0.085, 0.012, [-0.042, 0.265, 0.172]);
    box(torso, this.accent, 0.01, 0.085, 0.012, [0.042, 0.265, 0.172]);
    // waist flap pockets
    box(torso, M.jacket, 0.093, 0.075, 0.028, [-0.11, 0.105, 0.172], [0, 0.1, 0]);
    box(torso, M.jacket, 0.093, 0.075, 0.028, [0.11, 0.105, 0.172], [0, -0.1, 0]);
    box(torso, M.cuff, 0.095, 0.012, 0.03, [-0.11, 0.144, 0.175], [0, 0.1, 0]);
    box(torso, M.cuff, 0.095, 0.012, 0.03, [0.11, 0.144, 0.175], [0, -0.1, 0]);
    box(torso, M.leather, 0.05, 0.06, 0.012, [-0.112, 0.102, 0.18], [0, 0.1, 0]);
    box(torso, M.leather, 0.05, 0.06, 0.012, [0.112, 0.102, 0.18], [0, -0.1, 0]);
    // hem band
    const hem = cyl(torso, M.jacketPanel, 0.174, 0.166, 0.05, [0, 0.02, 0], 16);
    hem.scale.z = 0.72;
    const waistBand = cyl(torso, M.strap, 0.178, 0.176, 0.032, [0, 0.05, 0], 16);
    waistBand.scale.z = 0.74;

    // hood behind the neck + soft scarf around it
    ball(torso, M.hood, 0.11, [0, 0.415, -0.115], [1.45, 0.95, 0.85], 16);
    ball(torso, M.hoodShade, 0.085, [0, 0.455, -0.08], [1.3, 0.55, 0.9], 14);
    const scarf = addMesh(torso, new THREE.TorusGeometry(0.092, 0.038, 8, 18), M.hood, [0, 0.432, 0.01], [Math.PI / 2, 0, 0]);
    scarf.scale.z = 0.9;
    box(torso, M.hood, 0.11, 0.055, 0.035, [0.0, 0.4, 0.105], [0.25, 0, 0]);
    box(torso, M.hoodShade, 0.08, 0.03, 0.02, [0.02, 0.378, 0.117], [0.2, 0, 0.05]);

    // tan shoulder harness
    box(torso, M.leather, 0.052, 0.3, 0.024, [-0.128, 0.28, 0.172], [-0.08, 0.08, -0.04]);
    box(torso, M.leather, 0.052, 0.3, 0.024, [0.128, 0.28, 0.172], [-0.08, -0.08, 0.04]);
    box(torso, M.metal, 0.052, 0.036, 0.03, [-0.128, 0.335, 0.184], [-0.08, 0.08, -0.04]);
    box(torso, M.metal, 0.052, 0.036, 0.03, [0.128, 0.335, 0.184], [-0.08, -0.08, 0.04]);
    box(torso, M.leatherDark, 0.05, 0.045, 0.026, [-0.128, 0.19, 0.182], [-0.08, 0.08, -0.04]);
    box(torso, M.leatherDark, 0.05, 0.045, 0.026, [0.128, 0.19, 0.182], [-0.08, -0.08, 0.04]);

    // ------------------------------------------------------ chest energy core --
    const device = new THREE.Group();
    device.position.set(0, 0.295, 0.168);
    torso.add(device);
    cyl(device, M.techDark, 0.062, 0.062, 0.024, [0, 0, 0.004], 20, [Math.PI / 2, 0, 0]);
    this.ring = addMesh(device, new THREE.TorusGeometry(0.048, 0.005, 8, 24), this.accent, [0, 0, 0.012]);
    this.core = ball(device, this.accent, 0.024, [0, 0, 0.017], null, 14);
    triangle(device, this.accent, 0.052, 0.01, [0, 0.002, 0.021]);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x49c8ff, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.halo = ball(device, haloMat, 0.058, [0, 0, 0.023], null, 14);

    // ------------------------------------------------------------ backpack --
    const pack = new THREE.Group();
    pack.position.set(0, 0.26, -0.145);
    torso.add(pack);
    box(pack, M.backpack, 0.265, 0.3, 0.125, [0, 0, -0.04]);
    box(pack, M.cuff, 0.2, 0.085, 0.11, [0, 0.185, -0.03]);
    box(pack, M.techDark, 0.165, 0.095, 0.095, [0, -0.175, -0.02]);
    box(pack, M.metal, 0.085, 0.026, 0.018, [0, -0.175, 0.033]);
    for (let i = 0; i < 3; i++) {
      box(pack, this.accent, 0.011, 0.09, 0.006, [(i - 1) * 0.062, 0.02, -0.105]);
    }
    box(pack, M.leather, 0.04, 0.22, 0.02, [-0.09, 0.06, -0.1]);
    box(pack, M.leather, 0.04, 0.22, 0.02, [0.09, 0.06, -0.1]);
    cyl(pack, M.metal, 0.008, 0.006, 0.19, [-0.1, 0.27, -0.03], 8, [0, 0, 0.16]);
    ball(pack, this.accent, 0.017, [-0.115, 0.365, -0.03], null, 8);
    // shoulder straps (tan), matched to the harness
    box(torso, M.leather, 0.048, 0.32, 0.024, [-0.118, 0.27, 0.17], [-0.1, 0.05, -0.06]);
    box(torso, M.leather, 0.048, 0.32, 0.024, [0.118, 0.27, 0.17], [-0.1, -0.05, 0.06]);
    box(torso, M.metal, 0.052, 0.026, 0.03, [-0.118, 0.35, 0.182]);
    box(torso, M.metal, 0.052, 0.026, 0.03, [0.118, 0.35, 0.182]);

    // ------------------------------------------------ field kit on the torso --
    // shoulder comms pad with a live status dot
    box(torso, M.jacketDark, 0.075, 0.05, 0.085, [-0.155, 0.395, 0.055], [0.06, 0.12, 0.1]);
    box(torso, M.tech, 0.03, 0.016, 0.03, [-0.168, 0.42, 0.09], [0.06, 0.12, 0.1]);
    box(torso, this.accent, 0.008, 0.008, 0.006, [-0.19, 0.428, 0.093]);
    box(torso, M.metal, 0.006, 0.11, 0.006, [-0.182, 0.47, 0.036], [0, 0, 0.14]);
    // scarf tail draped down the back
    box(torso, M.hoodShade, 0.075, 0.22, 0.03, [0.07, 0.34, -0.155], [0.12, 0, -0.16]);
    box(torso, M.hood, 0.06, 0.09, 0.028, [0.09, 0.235, -0.16], [0.1, 0, -0.26]);
    // chest strap buckle
    box(torso, M.metal, 0.028, 0.03, 0.014, [-0.128, 0.2, 0.19], [-0.08, 0.08, -0.04]);
    // worn scuffs at the jacket hem
    box(torso, M.jacketDark, 0.07, 0.02, 0.012, [0.09, 0.045, 0.16], [0, 0, 0.2]);

    // ---------------------------------------------------------------- arms --
    const buildArm = (side) => {
      const sx = side === 'L' ? -1 : 1;
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * 0.213, 0.36, 0);
      torso.add(shoulder);

      // dark shoulder yoke with cyan triangle patch
      ball(shoulder, M.jacketDark, 0.088, [sx * 0.008, 0.012, 0], [1, 0.82, 0.95], 14);
      triangle(shoulder, this.accent, 0.03, 0.006, [sx * 0.068, -0.05, 0.014], [0, sx * Math.PI / 2, 0]);
      cyl(shoulder, M.sleeve, 0.066, 0.054, 0.28, [0, -0.145, 0], 12);
      ball(shoulder, M.sleeveDark, 0.06, [0, -0.27, 0], [1, 0.85, 1], 12);
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.285, 0);
      shoulder.add(elbow);
      ball(elbow, M.sleeveDark, 0.058, [0, 0.0, -0.004], [1, 0.95, 1], 12);
      cyl(elbow, M.sleeve, 0.055, 0.047, 0.26, [0, -0.13, 0], 12);
      // black cuff
      cyl(elbow, M.cuff, 0.05, 0.05, 0.06, [0, -0.245, 0], 12);
      box(elbow, M.metal, 0.014, 0.012, 0.01, [0, -0.245, 0.05]);

      const hand = new THREE.Group();
      hand.position.set(0, -0.268, 0);
      elbow.add(hand);
      // fingerless glove: black palm/back, bare fingers
      box(hand, M.glove, 0.072, 0.062, 0.052, [0, -0.035, 0.002]);
      box(hand, M.glove, 0.058, 0.05, 0.048, [0, -0.076, 0.004]);
      box(hand, this.accent, 0.048, 0.007, 0.008, [0, -0.05, 0.03]);
      box(hand, M.metal, 0.018, 0.014, 0.008, [0, -0.068, 0.031]);
      // fingers
      for (let i = 0; i < 4; i++) {
        box(hand, M.skin, 0.014, 0.045, 0.024, [(-0.024 + i * 0.016), -0.112, 0.004]);
      }
      box(hand, M.skin, 0.02, 0.04, 0.028, [sx * -0.044, -0.072, 0.012], [0, 0, sx * -0.5]);
      box(hand, M.cuff, 0.078, 0.03, 0.058, [0, 0.0, 0.0]);

      return { shoulder, elbow, hand };
    };
    const armL = buildArm('L');
    const armR = buildArm('R');
    this.shoulderL = armL.shoulder;
    this.shoulderR = armR.shoulder;
    this.elbowL = armL.elbow;
    this.elbowR = armR.elbow;
    this.handL = armL.hand;
    this.handR = armR.hand;

    // ---------------------------------------------------------------- neck --
    cyl(torso, M.skinShade, 0.05, 0.056, 0.1, [0, 0.44, 0.004], 12);

    // ---------------------------------------------------------------- head --
    const head = new THREE.Group();
    head.position.set(0, 0.46, 0.004);
    torso.add(head);
    this.head = head;

    ball(head, M.skin, 0.12, [0, 0.098, 0.006], [0.84, 1.02, 0.95], 20);
    ball(head, M.skin, 0.086, [0, 0.036, 0.022], [0.86, 0.8, 0.9], 16); // jaw
    ball(head, M.skin, 0.03, [0, 0.108, 0.112], [0.55, 0.95, 0.8], 10);
    box(head, M.skin, 0.03, 0.026, 0.036, [0, 0.092, 0.113], [0.12, 0, 0]);
    ball(head, M.skinShade, 0.026, [-0.104, 0.096, -0.004], [0.5, 1, 0.75], 10);
    ball(head, M.skinShade, 0.026, [0.104, 0.096, -0.004], [0.5, 1, 0.75], 10);
    // eyes, set in shallow lids and slightly narrower than the stylised version
    for (const sx of [-1, 1]) {
      ball(head, M.eyeWhite, 0.0138, [sx * 0.039, 0.122, 0.101], [1, 1, 0.6], 12);
      ball(head, M.iris, 0.0082, [sx * 0.039, 0.122, 0.11], [1, 1, 0.7], 10);
      ball(head, M.pupil, 0.0038, [sx * 0.039, 0.122, 0.116], [1, 1, 0.8], 8);
      box(head, M.brow, 0.049, 0.012, 0.018, [sx * 0.041, 0.146, 0.101], [0, sx * -0.1, sx * -0.1]);
      ball(head, M.skinShade, 0.024, [sx * 0.06, 0.09, 0.072], [1, 0.7, 0.5], 8);
      box(head, M.skinShade, 0.036, 0.007, 0.012, [sx * 0.039, 0.113, 0.108], [0, 0, sx * 0.06]);
    }
    // short beard shadow along the jaw and upper lip
    ball(head, M.stubble, 0.026, [0, 0.032, 0.092], [1.25, 0.5, 0.62], 10);
    for (const sx of [-1, 1]) {
      box(head, M.stubble, 0.019, 0.05, 0.02, [sx * 0.07, 0.062, 0.068], [0.12, 0, sx * 0.2]);
      box(head, M.stubble, 0.038, 0.011, 0.012, [sx * 0.03, 0.072, 0.103], [0.1, 0, sx * -0.08]);
    }
    box(head, M.lip, 0.044, 0.008, 0.012, [0, 0.055, 0.104]);
    box(head, M.skinShade, 0.036, 0.006, 0.012, [0, 0.066, 0.101]);
    // eyelids, cheekbones, chin, nostrils and a catchlight in each eye make
    // the face read as a person rather than a mannequin
    for (const sx of [-1, 1]) {
      ball(head, M.skinShade, 0.021, [sx * 0.041, 0.134, 0.102], [1.25, 0.4, 0.55], 10);
      box(head, M.skin, 0.048, 0.008, 0.014, [sx * 0.041, 0.141, 0.108], [0, 0, sx * -0.08]);
      ball(head, M.skin, 0.027, [sx * 0.072, 0.101, 0.076], [0.85, 0.7, 0.7], 10);
      ball(head, M.skin, 0.018, [sx * 0.022, 0.083, 0.109], [1, 0.72, 0.95], 10);
      ball(head, M.brow, 0.0065, [sx * 0.011, 0.079, 0.117], [1, 0.55, 0.55], 8);
      ball(head, M.glint, 0.003, [sx * 0.0425, 0.128, 0.118], [1, 1, 0.6], 6);
    }
    box(head, M.skin, 0.024, 0.05, 0.026, [0, 0.117, 0.107], [0.12, 0, 0]);
    ball(head, M.skin, 0.03, [0, 0.05, 0.097], [1.15, 0.8, 0.9], 12);
    box(head, M.skinShade, 0.03, 0.038, 0.02, [0, 0.06, 0.104], [0.1, 0, 0]);
    ball(head, M.skin, 0.028, [-0.106, 0.106, 0.0], [0.45, 1.0, 0.7], 10);
    ball(head, M.skin, 0.028, [0.106, 0.106, 0.0], [0.45, 1.0, 0.7], 10);

    // voluminous dark wavy hair
    ball(head, M.hair, 0.122, [0, 0.177, -0.014], [1.04, 0.68, 1.04], 20);
    ball(head, M.hair, 0.104, [0, 0.115, -0.066], [1.1, 0.95, 0.82], 16);
    const tufts = [
      [-0.06, 0.218, 0.05, 0.047, 0.11, -0.55],
      [0.0, 0.24, 0.028, 0.052, 0.125, -0.1],
      [0.065, 0.216, 0.045, 0.045, 0.105, 0.6],
      [-0.03, 0.226, -0.062, 0.05, 0.12, -2.7],
      [0.055, 0.218, -0.06, 0.048, 0.115, 2.7],
      [-0.098, 0.18, 0.006, 0.042, 0.095, -1.15],
      [0.098, 0.18, -0.004, 0.042, 0.095, 1.15],
      [-0.07, 0.235, -0.02, 0.04, 0.1, -1.5],
      [0.075, 0.235, 0.0, 0.04, 0.1, 1.5],
    ];
    for (const [x, y, z, r, h, rz] of tufts) {
      addMesh(head, new THREE.ConeGeometry(r, h, 6), M.hair, [x, y, z], [0.22, 0.3, rz]);
    }
    // side-swept fringe
    box(head, M.hair, 0.062, 0.024, 0.082, [-0.052, 0.172, 0.09], [-0.4, 0.2, 0.35]);
    box(head, M.hair, 0.052, 0.022, 0.078, [0.014, 0.181, 0.096], [-0.36, -0.15, -0.08]);
    box(head, M.hair, 0.05, 0.02, 0.072, [0.072, 0.166, 0.08], [-0.42, -0.22, -0.55]);
    box(head, M.hair, 0.04, 0.018, 0.05, [-0.098, 0.15, 0.062], [-0.3, 0.3, 0.7]);
    box(head, M.hair, 0.02, 0.085, 0.05, [-0.106, 0.08, 0.014]);
    box(head, M.hair, 0.02, 0.085, 0.05, [0.106, 0.08, 0.014]);
    ball(head, M.hair, 0.036, [-0.096, 0.205, 0.036], [1, 0.75, 1], 10);
    ball(head, M.hair, 0.034, [0.09, 0.2, 0.05], [1, 0.7, 1], 10);

    // ------------------------------------------------------------- aliases --
    this.bones = {
      Hips: hips, Spine: torso, Spine1: torso, Spine2: torso, Head: head,
      LeftUpLeg: legL.thigh, LeftLeg: legL.knee, LeftFoot: legL.ankle,
      RightUpLeg: legR.thigh, RightLeg: legR.knee, RightFoot: legR.ankle,
      LeftArm: armL.shoulder, LeftForeArm: armL.elbow, LeftHand: armL.hand,
      RightArm: armR.shoulder, RightForeArm: armR.elbow, RightHand: armR.hand,
    };

    // Keep the pulsing glow pieces separate, then merge the rest per joint and
    // material so a ~1.8 m character costs only a few dozen draw calls.
    this.ring.userData.keep = true;
    this.core.userData.keep = true;
    this.halo.userData.keep = true;
    this._mergeStatic(this.root);

    // Plant the boots exactly on the player origin (the idle ankle pose lifts
    // them a couple of centimetres otherwise).
    const bounds = new THREE.Box3().setFromObject(this.root);
    this.root.position.y -= bounds.min.y;
  }

  _mergeStatic(node) {
    const buckets = new Map();
    for (const child of [...node.children]) {
      if (!child.isMesh || child.userData.keep) continue;
      child.updateMatrix();
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrix);
      if (!buckets.has(child.material)) buckets.set(child.material, []);
      buckets.get(child.material).push(geo);
      node.remove(child);
      child.geometry.dispose();
    }
    for (const [material, geometries] of buckets) {
      const merged = mergeSimple(geometries);
      geometries.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, material);
      // Only bulky volumes cast shadows; trims, glow strips and fingers are
      // skipped, which keeps the character's shadow pass cheap.
      merged.computeBoundingSphere();
      mesh.castShadow = !this.noShadowMats.has(material) && merged.boundingSphere.radius > 0.105;
      mesh.receiveShadow = true;
      node.add(mesh);
    }
    for (const child of [...node.children]) {
      if (child.isGroup) this._mergeStatic(child);
    }
  }

  /**
   * Procedural animation. Speeds are in m/s; weights blend between the idle,
   * walk and run cycles, with an airborne overlay driven by airBlend/vy.
   */
  animate(dt, state = {}) {
    dt = Math.min(dt, 0.05);
    const t = (this.time += dt);
    const speed = state.speed || 0;
    const air = clamp(state.airBlend || 0, 0, 1);
    const vy = state.vy || 0;
    const surge = !!state.surge;

    const runT = clamp((speed - 4.9) / 2.4, 0, 1);
    const moveW = clamp(speed / 1.1, 0, 1);
    const idleW = 1 - moveW;

    if (moveW > 0.01) this.cycle += dt * (2.6 + speed * 0.85);
    const swing = Math.sin(this.cycle);
    const swingB = Math.sin(this.cycle + Math.PI);
    const doubleSwing = Math.sin(this.cycle * 2);
    const breathe = Math.sin(t * 1.55);

    // ---- hips / torso: bob, sway and lean ----
    this.hipGroup.position.y = HIP_Y + doubleSwing * (0.008 + 0.026 * runT) * moveW
      - 0.055 * air + breathe * 0.0025 * idleW;
    this.hipGroup.position.x = swing * 0.016 * moveW + Math.sin(t * 0.45) * 0.006 * idleW;
    this.hipGroup.rotation.y = swing * 0.09 * moveW;
    this.hipGroup.rotation.z = -swing * 0.026 * moveW;

    this.torso.rotation.x = 0.015 + (0.05 + 0.1 * runT) * moveW + 0.14 * air + breathe * 0.01 * idleW;
    this.torso.rotation.y = -swing * 0.075 * moveW;
    this.torso.rotation.z = swing * 0.018 * moveW;
    this.torso.position.y = 0.06 + breathe * 0.003 * idleW;

    this.head.rotation.x = -this.torso.rotation.x * 0.55 - 0.06 * air + 0.03 * runT * moveW;
    this.head.rotation.y = Math.sin(t * 0.42) * 0.1 * idleW - swing * 0.03 * moveW;
    this.head.rotation.z = Math.sin(t * 0.31) * 0.015 * idleW;

    // ---- legs ----
    const amp = (0.34 + 0.5 * runT) * moveW;
    const kneeAmp = 0.62 + 0.72 * runT;
    let thighL = -swing * amp;
    let thighR = -swingB * amp;
    let kneeL = Math.max(0, -swing) * kneeAmp * moveW
      + Math.max(0, swing) * 0.14 * moveW + 0.05 * moveW;
    let kneeR = Math.max(0, -swingB) * kneeAmp * moveW
      + Math.max(0, swingB) * 0.14 * moveW + 0.05 * moveW;

    const rise = clamp(vy / 7, 0, 1);
    const fall = clamp(-vy / 9, 0, 1);
    thighL = lerp(thighL, -0.3 - 0.5 * rise + 0.18 * fall, air);
    thighR = lerp(thighR, -0.12 - 0.32 * rise + 0.1 * fall, air);
    kneeL = lerp(kneeL, 0.5 + 0.55 * rise - 0.15 * fall, air);
    kneeR = lerp(kneeR, 0.36 + 0.4 * rise - 0.1 * fall, air);

    this.thighL.rotation.x = thighL;
    this.thighR.rotation.x = thighR;
    this.thighL.rotation.z = -0.02 - 0.05 * air;
    this.thighR.rotation.z = 0.02 + 0.05 * air;
    this.kneeL.rotation.x = Math.max(0, kneeL);
    this.kneeR.rotation.x = Math.max(0, kneeR);
    this.ankleL.rotation.x = -0.25 * thighL - 0.4 * Math.max(0, kneeL) + 0.04;
    this.ankleR.rotation.x = -0.25 * thighR - 0.4 * Math.max(0, kneeR) + 0.04;

    // ---- arms ----
    const armAmp = (0.3 + 0.55 * runT) * moveW;
    this.shoulderL.rotation.x = swing * armAmp - air * (0.55 + 0.35 * rise) + breathe * 0.012 * idleW;
    this.shoulderR.rotation.x = swingB * armAmp - air * (0.55 + 0.35 * rise) + breathe * 0.012 * idleW;
    this.shoulderL.rotation.z = -0.06 - 0.1 * runT * moveW - air * 0.55;
    this.shoulderR.rotation.z = 0.06 + 0.1 * runT * moveW + air * 0.55;
    const elbow = -(0.14 + 0.5 * runT * moveW + 0.5 * air);
    this.elbowL.rotation.x = elbow;
    this.elbowR.rotation.x = elbow;
    this.handL.rotation.z = 0.06;
    this.handR.rotation.z = -0.06;

    // ---- glowing chest core ----
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.4);
    this.halo.material.opacity = 0.16 + 0.14 * pulse + (surge ? 0.12 : 0);
    this.halo.material.color.copy(this.accent.color);
    this.halo.scale.setScalar(1 + 0.06 * pulse + (surge ? 0.08 : 0));
    this.core.scale.setScalar(1 + 0.04 * pulse);
    this.ring.rotation.z += dt * (surge ? 1.6 : 0.5);
  }
}
