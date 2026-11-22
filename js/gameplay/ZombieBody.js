import * as THREE from 'three';
import { rand } from '../core/utils.js';
import { getClothTexture, getSkinSurface } from '../world/Textures.js';

/**
 * Bodies for the Hollowed.
 *
 * Reference: emaciated, mostly undressed human corpses — ash-pale, jaundiced
 * and bruised skin, bare ribcages, sunken faces, patchy scalp hair, tattered
 * underwear or jeans, exposed muscle and clustered tumours. Everything is
 * procedural geometry merged down to a handful of draw calls per body.
 *
 * Local +Z is forward, the hips sit at z.bodyBaseY, and the limbs hang along
 * -Y so the procedural shamble in Zombies.js can drive them unchanged.
 */

const EYE_MAT = new THREE.MeshStandardMaterial({
  color: 0xd9d3c1, roughness: 0.3, metalness: 0.0,
});
const PUPIL_MAT = new THREE.MeshStandardMaterial({
  color: 0x100e0c, roughness: 0.3, metalness: 0.0,
});
const MOUTH_MAT = new THREE.MeshStandardMaterial({
  color: 0x170a08, roughness: 0.9, metalness: 0.0,
});
const NAIL_MAT = new THREE.MeshStandardMaterial({
  color: 0x3e3327, roughness: 0.62, metalness: 0.0,
});
const BONE_MAT = new THREE.MeshStandardMaterial({
  color: 0xd8cfb8, roughness: 0.6, metalness: 0.02,
});
const HAIR_MAT = new THREE.MeshStandardMaterial({
  color: 0x1c1614, roughness: 0.95, metalness: 0.0,
});
const BLOOD_MAT = new THREE.MeshStandardMaterial({
  color: 0x4a0d0a, roughness: 0.32, metalness: 0.06,
});

const SKIN_TINTS = [0xc6c7b8, 0xb0b9a6, 0xc4b99d, 0xb4a59d, 0xa5a69b];
const CLOTH_TINTS = [0x9c9585, 0x6f736f, 0x4d5153, 0x8a8273];

export function buildZombieBody(z, mergeGroup) {
  const s = z.heightScale;
  const variant = z.index % 5;
  const goreLevel = [0, 2, 1, 2, 1][variant];
  const skinSurf = getSkinSurface('necro', variant);
  const goreSurf = getSkinSurface('gore');
  const clothMap = getClothTexture('denim');

  const skinMat = new THREE.MeshStandardMaterial({
    color: SKIN_TINTS[variant],
    map: skinSurf.map,
    normalMap: skinSurf.normalMap,
    roughnessMap: skinSurf.roughnessMap,
    roughness: 1,
    metalness: 0.0,
    envMapIntensity: 0.5,
  });
  skinMat.normalScale.set(1.15, 1.15);

  // Recessed areas (eye sockets, sunken belly, hollow cheeks) — same skin,
  // just darker so the hollows read at gameplay distance.
  const recessMat = new THREE.MeshStandardMaterial({
    color: 0x7f7464,
    map: skinSurf.map,
    normalMap: skinSurf.normalMap,
    roughnessMap: skinSurf.roughnessMap,
    roughness: 1,
    metalness: 0.0,
    envMapIntensity: 0.35,
  });

  const goreMat = new THREE.MeshStandardMaterial({
    color: 0xb06f5e,
    map: goreSurf.map,
    normalMap: goreSurf.normalMap,
    roughnessMap: goreSurf.roughnessMap,
    roughness: 1,
    metalness: 0.04,
    envMapIntensity: 0.7,
  });

  const clothMat = new THREE.MeshStandardMaterial({
    color: CLOTH_TINTS[(z.index >> 1) % CLOTH_TINTS.length],
    map: clothMap,
    roughness: 0.96,
    metalness: 0.02,
  });

  z.skinMat = skinMat;
  z.shirtMat = clothMat;

  const root = new THREE.Group();
  root.scale.setScalar(s);
  z.root = root;

  const body = new THREE.Group();
  body.position.y = z.bodyBaseY;
  root.add(body);
  z.body = body;

  const add = (parent, geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };
  const cyl = (parent, mat, rt, rb, h, y, zz = 0, seg = 12, flatten = 1) => {
    const m = add(parent, new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(0, y, zz);
    m.scale.z = flatten;
    return m;
  };
  const ball = (parent, mat, r, x, y, zz, sx = 1, sy = 1, sz = 1, seg = 12) => {
    const m = add(parent, new THREE.SphereGeometry(r, seg, Math.max(7, seg >> 1)), mat);
    m.position.set(x, y, zz);
    m.scale.set(sx, sy, sz);
    return m;
  };
  const box = (parent, mat, w, h, d, x, y, zz, rx = 0, ry = 0, rz = 0) => {
    const m = add(parent, new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, zz);
    m.rotation.set(rx, ry, rz);
    return m;
  };

  // ------------------------------------------------------------- torso ----
  const torso = new THREE.Group();
  body.add(torso);
  z.torso = torso;

  // narrow pelvis, pinched waist, flared ribcage
  cyl(torso, skinMat, 0.146, 0.128, 0.155, -0.012, 0.008, 16, 0.78);
  cyl(torso, skinMat, 0.13, 0.116, 0.17, 0.115, 0.007, 14, 0.72);
  cyl(torso, skinMat, 0.181, 0.131, 0.255, 0.355, 0.004, 18, 0.74);
  // sunken gut: dark hollow beneath the ribs
  ball(torso, recessMat, 0.062, 0, 0.145, 0.083, 1.55, 1.15, 0.28, 12);
  // pectorals and shoulder caps
  ball(torso, skinMat, 0.058, -0.062, 0.452, 0.071, 1.2, 0.8, 0.55, 12);
  ball(torso, skinMat, 0.058, 0.062, 0.452, 0.071, 1.2, 0.8, 0.55, 12);
  ball(torso, skinMat, 0.071, -0.183, 0.512, 0, 1, 0.88, 0.92, 14);
  ball(torso, skinMat, 0.071, 0.183, 0.512, 0, 1, 0.88, 0.92, 14);
  // collar bones, sternum and individual ribs
  box(torso, skinMat, 0.118, 0.015, 0.022, -0.064, 0.497, 0.078, 0, 0.1, -0.26);
  box(torso, skinMat, 0.118, 0.015, 0.022, 0.064, 0.497, 0.078, 0, -0.1, 0.26);
  box(torso, skinMat, 0.021, 0.16, 0.024, 0, 0.372, 0.114, 0, 0, 0);
  for (let i = 0; i < 5; i++) {
    const y = 0.292 + i * 0.036;
    const spread = 0.012 * i;
    box(torso, skinMat, 0.082, 0.011, 0.018, -0.055, y, 0.103 - spread, 0, 0, -0.16);
    box(torso, skinMat, 0.082, 0.011, 0.018, 0.055, y, 0.103 - spread, 0, 0, 0.16);
  }
  // knobbly spine
  for (let i = 0; i < 6; i++) {
    ball(torso, skinMat, 0.017, 0, 0.12 + i * 0.072, -0.104, 1.5, 1, 1, 8);
  }
  // hip bones and neck
  ball(torso, skinMat, 0.043, -0.113, 0.03, 0.078, 1, 0.5, 0.75, 10);
  ball(torso, skinMat, 0.043, 0.113, 0.03, 0.078, 1, 0.5, 0.75, 10);
  cyl(torso, skinMat, 0.039, 0.052, 0.12, 0.6, 0.012, 10, 0.92);
  ball(torso, skinMat, 0.052, 0, 0.545, -0.004, 1.25, 0.8, 0.9, 12);

  // ---- flayed chest, clustered tumours and running blood ----
  if (goreLevel > 0) {
    ball(torso, goreMat, 0.088, 0.058, 0.44, 0.081, 1.45, 0.96, 0.42, 16);
    ball(torso, goreMat, 0.062, 0.012, 0.305, 0.099, 1.25, 1.4, 0.34, 14);
    const tumours = goreLevel === 2 ? 9 : 4;
    for (let i = 0; i < tumours; i++) {
      const a = rand(0, Math.PI * 2);
      const rr = rand(0.016, 0.041);
      ball(
        torso, i % 3 === 0 ? goreMat : skinMat, rr,
        0.06 + Math.cos(a) * rand(0.015, 0.072),
        0.435 + Math.sin(a) * rand(0.02, 0.1),
        0.118 + rand(-0.008, 0.03),
        1, 1, 0.85, 8
      );
    }
    ball(torso, BLOOD_MAT, 0.02, 0.05, 0.35, 0.115, 1.6, 1.1, 0.5, 8);
    box(torso, BLOOD_MAT, 0.018, 0.09, 0.012, 0.062, 0.32, 0.113, 0.05, 0, 0.1);
  }
  if (goreLevel === 2) {
    ball(torso, goreMat, 0.072, -0.122, 0.25, 0.055, 0.55, 1.35, 0.8, 14);
    box(torso, BLOOD_MAT, 0.016, 0.11, 0.012, -0.14, 0.18, 0.088, 0, 0, -0.12);
    ball(torso, BLOOD_MAT, 0.014, -0.145, 0.12, 0.086, 1, 1.6, 0.5, 8);
  }

  // ---- tattered shorts over the hips ----
  cyl(torso, clothMat, 0.144, 0.14, 0.155, -0.022, 0.006, 16, 0.8);
  box(torso, clothMat, 0.05, 0.06, 0.03, -0.11, -0.115, 0.062, 0, 0, 0.3);
  box(torso, clothMat, 0.04, 0.075, 0.028, 0.118, -0.11, -0.03, 0.1, 0, -0.35);
  box(torso, clothMat, 0.02, 0.055, 0.026, 0.02, -0.12, 0.105, 0, 0, 0.2);

  mergeGroup(torso);
  z._mark(torso, 'body');

  // -------------------------------------------------------------- head ----
  const head = new THREE.Group();
  head.position.set(0, 0.605, 0.015);
  body.add(head);
  z.head = head;

  // skull, face plate and brow
  ball(head, skinMat, 0.107, 0, 0.126, -0.004, 0.94, 1.06, 0.98, 20);
  ball(head, skinMat, 0.077, 0, 0.086, 0.055, 0.96, 0.88, 0.78, 16);
  box(head, skinMat, 0.132, 0.025, 0.032, 0, 0.158, 0.084, 0.14, 0, 0);
  // cheekbones, hollow cheeks and temples
  ball(head, skinMat, 0.034, -0.063, 0.113, 0.062, 1, 0.55, 0.72, 10);
  ball(head, skinMat, 0.034, 0.063, 0.113, 0.062, 1, 0.55, 0.72, 10);
  ball(head, recessMat, 0.038, -0.064, 0.074, 0.054, 0.9, 1.05, 0.42, 10);
  ball(head, recessMat, 0.038, 0.064, 0.074, 0.054, 0.9, 1.05, 0.42, 10);
  ball(head, recessMat, 0.03, -0.093, 0.142, 0.013, 0.7, 0.9, 0.9, 8);
  ball(head, recessMat, 0.03, 0.093, 0.142, 0.013, 0.7, 0.9, 0.9, 8);
  // sunken sockets with dead, cloudy eyes
  for (const sx of [-1, 1]) {
    ball(head, recessMat, 0.039, sx * 0.043, 0.128, 0.075, 1, 0.85, 0.5, 12);
    ball(head, EYE_MAT, 0.0135, sx * 0.043, 0.127, 0.095, 1, 1, 0.55, 10);
    ball(head, PUPIL_MAT, 0.0052, sx * 0.043, 0.126, 0.104, 1, 1, 0.55, 8);
    box(head, HAIR_MAT, 0.05, 0.008, 0.014, sx * 0.043, 0.142, 0.094, 0, 0, sx * -0.1);
  }
  // nose with a collapsed bridge
  box(head, skinMat, 0.018, 0.052, 0.028, 0, 0.117, 0.098, 0.12, 0, 0);
  ball(head, skinMat, 0.02, 0, 0.093, 0.108, 1.15, 0.78, 0.9, 10);
  ball(head, MOUTH_MAT, 0.008, -0.012, 0.088, 0.106, 1, 1, 0.7, 8);
  ball(head, MOUTH_MAT, 0.008, 0.012, 0.088, 0.106, 1, 1, 0.7, 8);
  // mouth: dark cavity, exposed upper teeth
  box(head, MOUTH_MAT, 0.054, 0.026, 0.02, 0, 0.064, 0.093, 0.1, 0, 0);
  for (let t = 0; t < 5; t++) {
    box(head, BONE_MAT, 0.009, 0.013, 0.008, -0.02 + t * 0.01, 0.075, 0.104, 0.1, 0, 0);
  }
  // ears
  ball(head, skinMat, 0.029, -0.104, 0.108, 0.0, 0.4, 1, 0.65, 10);
  ball(head, skinMat, 0.029, 0.104, 0.108, 0.0, 0.4, 1, 0.65, 10);
  // blood running from the mouth and a head wound on the worst cases
  box(head, BLOOD_MAT, 0.02, 0.07, 0.01, 0.02, 0.02, 0.107, 0, 0, 0.14);
  box(head, BLOOD_MAT, 0.012, 0.04, 0.01, -0.016, 0.036, 0.104, 0, 0, -0.08);
  if (goreLevel === 2) {
    ball(head, goreMat, 0.038, 0.072, 0.18, 0.058, 1, 0.8, 0.7, 12);
    box(head, BLOOD_MAT, 0.014, 0.1, 0.012, 0.086, 0.1, 0.055, 0.1, 0, 0.12);
  }
  // patchy scalp: bald, stubbled or a few surviving wisps
  if (variant === 1 || variant === 3) {
    for (let i = 0; i < 7; i++) {
      const a = rand(-Math.PI, Math.PI);
      ball(head, HAIR_MAT, rand(0.022, 0.038), Math.sin(a) * 0.082, 0.175 + rand(-0.02, 0.03), Math.cos(a) * 0.072 - 0.01, 0.75, 0.3, 0.75, 8);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const a = rand(-2.4, 2.4);
      const m = add(head, new THREE.ConeGeometry(rand(0.012, 0.02), rand(0.06, 0.11), 5), HAIR_MAT);
      m.position.set(Math.sin(a) * 0.07, 0.205, Math.cos(a) * 0.05 - 0.02);
      m.rotation.set(rand(-0.4, 0.2), rand(0, 3), rand(-0.8, 0.8));
    }
  }
  mergeGroup(head);
  z._mark(head, 'head');

  // jaw on its own pivot so it can hang slack and snap
  const jaw = new THREE.Group();
  jaw.position.set(0, 0.056, 0.02);
  head.add(jaw);
  z.jaw = jaw;
  ball(jaw, skinMat, 0.05, 0, -0.03, 0.042, 1.05, 0.7, 0.95, 12);
  box(jaw, skinMat, 0.062, 0.026, 0.045, 0, -0.005, 0.055, 0.12, 0, 0);
  box(jaw, MOUTH_MAT, 0.05, 0.016, 0.02, 0, 0.008, 0.052, 0.1, 0, 0);
  for (let t = 0; t < 5; t++) {
    box(jaw, BONE_MAT, 0.008, 0.011, 0.008, -0.018 + t * 0.009, 0.014, 0.064, 0.1, 0, 0);
  }
  mergeGroup(jaw);
  z._mark(jaw, 'head');

  // -------------------------------------------------------------- arms ----
  z.arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.196, 0.515, 0);
    body.add(arm);
    ball(arm, skinMat, 0.057, side * 0.005, 0.002, 0, 1, 1, 0.94, 12);
    cyl(arm, skinMat, 0.048, 0.037, 0.26, -0.146, 0, 10, 0.95);
    ball(arm, skinMat, 0.039, 0, -0.282, 0, 1, 1, 1, 10);
    cyl(arm, skinMat, 0.037, 0.027, 0.24, -0.404, 0, 10, 0.95);
    ball(arm, skinMat, 0.027, 0, -0.524, 0.004, 0.9, 0.9, 0.8, 8);
    // long bony hand, fingers and dark nails
    box(arm, skinMat, 0.055, 0.072, 0.026, 0, -0.573, 0.006);
    for (let f = 0; f < 4; f++) {
      const fx = -0.021 + f * 0.0135;
      box(arm, skinMat, 0.011, 0.052, 0.014, fx, -0.629, 0.012, 0.14, 0, (f - 1.5) * 0.05);
      box(arm, NAIL_MAT, 0.009, 0.012, 0.01, fx, -0.655, 0.016);
    }
    box(arm, skinMat, 0.014, 0.042, 0.016, side * 0.034, -0.585, 0.016, 0.2, 0, side * -0.6);
    box(arm, NAIL_MAT, 0.011, 0.011, 0.01, side * 0.042, -0.607, 0.019);
    if (goreLevel === 2 && side === 1) {
      ball(arm, goreMat, 0.04, 0, -0.19, 0.02, 1, 1.6, 0.7, 10);
      box(arm, BLOOD_MAT, 0.012, 0.07, 0.01, 0.02, -0.24, 0.032, 0.08, 0, 0);
    }
    mergeGroup(arm);
    z._mark(arm, 'limb');
    z.arms.push(arm);
  }

  // -------------------------------------------------------------- legs ----
  z.legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.108, z.bodyBaseY, 0);
    root.add(leg);

    // ragged shorts leg
    cyl(leg, clothMat, 0.092, 0.088, 0.17, -0.078, 0, 10, 0.92);
    box(leg, clothMat, 0.025, 0.065, 0.03, side * 0.07, -0.2, 0.02, 0, 0, side * 0.25);
    box(leg, clothMat, 0.018, 0.045, 0.028, -side * 0.045, -0.205, -0.035, 0, 0, side * -0.3);

    // bare thigh
    cyl(leg, skinMat, 0.079, 0.06, 0.26, -0.29, 0, 10, 0.95);
    if (goreLevel > 0 && side === -1) {
      ball(leg, goreMat, 0.05, 0.03, -0.3, 0.05, 0.8, 1.5, 0.7, 10);
    }

    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    leg.add(knee);
    ball(knee, skinMat, 0.061, 0, 0.0, 0.007, 1, 0.92, 1, 10);
    cyl(knee, skinMat, 0.059, 0.041, 0.38, -0.2, 0, 10, 0.95);

    const ankle = new THREE.Group();
    ankle.position.set(0, -0.4, 0);
    knee.add(ankle);
    cyl(ankle, skinMat, 0.044, 0.041, 0.06, -0.014, 0, 8, 0.95);
    ball(ankle, skinMat, 0.043, 0, -0.044, -0.028, 1, 0.7, 1, 8);
    box(ankle, skinMat, 0.08, 0.05, 0.17, 0, -0.055, 0.055);
    for (let t = 0; t < 5; t++) {
      box(ankle, skinMat, 0.0145, 0.026, 0.034, -0.028 + t * 0.014, -0.062, 0.148);
      box(ankle, NAIL_MAT, 0.012, 0.008, 0.012, -0.028 + t * 0.014, -0.073, 0.16);
    }
    box(ankle, recessMat, 0.078, 0.012, 0.17, 0, -0.078, 0.055);

    mergeGroup(ankle);
    mergeGroup(knee);
    mergeGroup(leg);
    z._mark(leg, 'limb');
    z.legs.push(leg);
  }

  // blood pool left where the body fell
  const decal = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 16),
    new THREE.MeshBasicMaterial({
      color: 0x3a0c08, transparent: true, opacity: 0.62, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false,
    })
  );
  decal.rotation.x = -Math.PI / 2;
  decal.scale.set(1, 0.72, 1);
  decal.visible = false;
  z.system.group.add(decal);
  z.decal = decal;

  z.aimPoints = [
    { y: (z.bodyBaseY + 0.605 + 0.13) * s, part: 'head' },
    { y: (z.bodyBaseY + 0.34) * s, part: 'body' },
  ];

  z.system.group.add(root);
  z.group = root;
}
