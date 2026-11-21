import * as THREE from 'three';

/**
 * The Restorer's scavenged sidearm.
 *
 * Built along +Z (muzzle forward) with the grip hanging under the frame, then
 * merged per material so a held pistol costs only a handful of draw calls. The
 * same model is used as the prop lying inside every world cache.
 */

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    steel: new THREE.MeshStandardMaterial({ color: 0x353c44, roughness: 0.4, metalness: 0.92 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x1f242a, roughness: 0.52, metalness: 0.85 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x171b1f, roughness: 0.86, metalness: 0.2 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb8873c, roughness: 0.3, metalness: 0.95 }),
    tritium: new THREE.MeshBasicMaterial({ color: 0xa8ffbf, toneMapped: false }),
    amber: new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }),
  };
  return MATS;
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
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
      io += ia.length;
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = i + vo;
      io += g.attributes.position.count;
    }
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** Collapse the mesh children of one group into a mesh per material. */
function mergeMeshes(group) {
  const buckets = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh) continue;
    child.updateMatrix();
    const geo = child.geometry.clone().applyMatrix4(child.matrix);
    if (!buckets.has(child.material)) buckets.set(child.material, []);
    buckets.get(child.material).push(geo);
    group.remove(child);
    child.geometry.dispose();
  }
  for (const [material, geometries] of buckets) {
    const merged = mergeSimple(geometries);
    geometries.forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

export function createPistol({ scale = 1 } = {}) {
  const M = mats();
  const g = new THREE.Group();

  const box = (w, h, d, material, pos, rot) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    g.add(mesh);
    return mesh;
  };
  const ball = (r, material, pos) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    g.add(mesh);
  };

  // slide + frame
  box(0.046, 0.052, 0.19, M.steel, [0, 0.034, 0.045]);
  box(0.03, 0.012, 0.19, M.steelDark, [0, 0.062, 0.045]);
  box(0.042, 0.044, 0.13, M.steelDark, [0, -0.006, 0.02]);
  box(0.036, 0.02, 0.1, M.polymer, [0, -0.028, 0.03]);

  // grip, magazine and trigger group
  box(0.044, 0.125, 0.058, M.polymer, [0, -0.078, -0.032], [0.22, 0, 0]);
  box(0.05, 0.012, 0.062, M.steelDark, [0, -0.138, -0.047], [0.22, 0, 0]);
  box(0.008, 0.048, 0.009, M.steelDark, [0, -0.046, 0.062]);
  box(0.008, 0.009, 0.05, M.steelDark, [0, -0.068, 0.04]);
  box(0.008, 0.028, 0.01, M.brass, [0, -0.036, 0.045], [0.3, 0, 0]);

  // ejection port, slide serrations
  box(0.006, 0.022, 0.052, M.steelDark, [0.024, 0.044, 0.02]);
  for (let i = 0; i < 5; i++) {
    box(0.05, 0.03, 0.005, M.steelDark, [0, 0.034, -0.03 + i * 0.011]);
  }

  // barrel, compensator, glowing inlay
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), M.steelDark);
  barrel.position.set(0, 0.034, 0.152);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  box(0.05, 0.032, 0.026, M.steel, [0, 0.034, 0.14]);
  box(0.008, 0.006, 0.12, M.amber, [0.026, 0.03, 0.03]);

  // sights with tritium dots
  box(0.006, 0.014, 0.008, M.steelDark, [0, 0.07, 0.12]);
  ball(0.005, M.amber, [0, 0.078, 0.122]);
  box(0.008, 0.012, 0.008, M.steelDark, [-0.017, 0.069, -0.038]);
  box(0.008, 0.012, 0.008, M.steelDark, [0.017, 0.069, -0.038]);
  ball(0.0045, M.tritium, [-0.017, 0.077, -0.037]);
  ball(0.0045, M.tritium, [0.017, 0.077, -0.037]);

  // hammer
  box(0.016, 0.02, 0.012, M.steelDark, [0, 0.045, -0.055], [0.4, 0, 0]);

  mergeMeshes(g);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.034, 0.166);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.scale.setScalar(scale);
  return g;
}
