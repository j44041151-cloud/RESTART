import * as THREE from 'three';
import { seeded, clamp } from '../core/utils.js';

const cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Tileable-ish fractal value noise, returns Float32Array of 0..1. */
function fbm(size, seed, octaves = 5, baseGrid = 4) {
  const out = new Float32Array(size * size);
  const rnd = seeded(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const g = baseGrid << o;
    const grid = new Float32Array((g + 1) * (g + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * g;
      const y0 = Math.floor(gy);
      const ty = gy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * g;
        const x0 = Math.floor(gx);
        const tx = gx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const i00 = y0 * (g + 1) + x0;
        const a = grid[i00], b = grid[i00 + 1];
        const c = grid[i00 + g + 1], d = grid[i00 + g + 2];
        const v = (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
        out[row + x] += v * amp;
      }
    }
    total += amp;
    amp *= 0.52;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvasFromPixels(size, fn) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const [r, g, b] = fn(x, y, i);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  c._ctx = ctx;
  return c;
}

function normalMapFromHeight(height, size, strength = 2.2) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function drawCracks(ctx, size, seed, count, color, width) {
  const rnd = seeded(seed);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let ang = rnd() * Math.PI * 2;
    ctx.lineWidth = width * (0.4 + rnd());
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 6 + (rnd() * 12) | 0;
    for (let s = 0; s < steps; s++) {
      ang += (rnd() - 0.5) * 1.4;
      x += Math.cos(ang) * (4 + rnd() * 12);
      y += Math.sin(ang) * (4 + rnd() * 12);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function toTexture(canvas, { srgb = false, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const S = 512;

function buildConcrete() {
  const n1 = fbm(S, 11, 5, 3);
  const n2 = fbm(S, 31, 4, 6);
  const n3 = fbm(S, 19, 4, 13);
  const height = new Float32Array(S * S);
  const albedo = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const v = n1[i] * 0.65 + n2[i] * 0.35;
    const stain = Math.pow(clamp((n2[i] - 0.46) * 2.3, 0, 1), 1.7) * 54;
    // spalled patches where the render has been blown off
    const spall = clamp((n3[i] - 0.7) * 6, 0, 1);
    const base = 82 + (v - 0.5) * 56 - spall * 26;
    height[i] = v * 0.7 + n2[i] * 0.3 - spall * 0.3;
    const grit = spall * 18;
    return [
      clamp(base - stain + 5 + grit, 0, 255),
      clamp(base - stain + 2 + grit * 0.6, 0, 255),
      clamp(base - stain - 4, 0, 255),
    ];
  });
  const ctx = albedo._ctx;
  drawCracks(ctx, S, 77, 42, 'rgba(20,19,17,0.62)', 2.1);
  drawCracks(ctx, S, 91, 16, 'rgba(15,14,13,0.5)', 3.4);
  const rnd = seeded(5);
  // soot blooms left by the blast
  for (let i = 0; i < 16; i++) {
    const x = rnd() * S, y = rnd() * S, r = 24 + rnd() * 95;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(22,19,16,${0.1 + rnd() * 0.17})`);
    g.addColorStop(1, 'rgba(22,19,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // long water streaks
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, w = 1 + rnd() * 5, h = 40 + rnd() * 200;
    ctx.fillStyle = `rgba(28,25,21,${0.04 + rnd() * 0.1})`;
    ctx.fillRect(x, rnd() * (S - h), w, h);
  }
  // grime speckles
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S, y = rnd() * S;
    ctx.fillStyle = `rgba(${18 + rnd() * 40},${18 + rnd() * 36},${16 + rnd() * 30},${0.06 + rnd() * 0.14})`;
    ctx.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  const rough = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const v = 180 + n1[i] * 50;
    return [v, v, v];
  });
  return {
    map: toTexture(albedo, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(height, S, 1.7)),
    roughnessMap: toTexture(rough),
  };
}

function buildAsphalt() {
  const n1 = fbm(S, 21, 5, 4);
  const n2 = fbm(S, 43, 3, 14);
  const n3 = fbm(S, 57, 4, 9);
  const height = new Float32Array(S * S);
  const albedo = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const grain = n2[i];
    const hole = clamp((n3[i] - 0.66) * 5, 0, 1);
    const base = 56 + (n1[i] - 0.5) * 24 + (grain > 0.74 ? 20 : 0) - (grain < 0.28 ? 8 : 0) - hole * 22;
    height[i] = n2[i] - hole * 0.6;
    return [base, base + 1, base + 3];
  });
  const ctx = albedo._ctx;
  drawCracks(ctx, S, 12, 30, 'rgba(7,7,9,0.75)', 2.7);
  drawCracks(ctx, S, 55, 44, 'rgba(10,10,12,0.5)', 1.2);
  const rnd = seeded(63);
  // potholes
  for (let i = 0; i < 10; i++) {
    const x = rnd() * S, y = rnd() * S, r = 5 + rnd() * 22;
    ctx.fillStyle = `rgba(5,5,7,${0.5 + rnd() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // patched repairs that have cracked again
  for (let i = 0; i < 6; i++) {
    const x = rnd() * S, y = rnd() * S, w = 60 + rnd() * 140, h = 24 + rnd() * 70;
    ctx.fillStyle = `rgba(56,58,60,${0.2 + rnd() * 0.2})`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(10,10,11,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }
  // faded, broken road paint fragments
  ctx.fillStyle = 'rgba(184,174,146,0.09)';
  for (let i = 0; i < 5; i++) {
    for (let y = 0; y < S; y += 46) ctx.fillRect(i * 108 + 22, y + rnd() * 16, 15, 24);
  }
  const rough = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const v = 200 + n1[i] * 40;
    return [v, v, v];
  });
  return {
    map: toTexture(albedo, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(height, S, 1.1)),
    roughnessMap: toTexture(rough),
  };
}

function buildRustedMetal() {
  const n1 = fbm(S, 61, 5, 5);
  const n2 = fbm(S, 71, 4, 9);
  const rustMask = fbm(S, 83, 4, 3);
  const height = new Float32Array(S * S);
  const albedo = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const rust = rustMask[i];
    const rr = clamp((rust - 0.46) * 3.4, 0, 1);
    const metal = 88 + (n1[i] - 0.5) * 30;
    const r = metal * (1 - rr) + (128 + n2[i] * 52) * rr;
    const g = metal * (1 - rr) + (62 + n2[i] * 34) * rr;
    const b = (metal + 3) * (1 - rr) + (34 + n2[i] * 18) * rr;
    height[i] = n2[i] * (1 - rr) * 0.6 + rr * 0.35;
    return [r, g, b];
  });
  const ctx = albedo._ctx;
  // panel seams and rivets
  ctx.strokeStyle = 'rgba(20,20,22,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, S - 8, S - 8);
  ctx.beginPath();
  ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2);
  ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S);
  ctx.stroke();
  const rnd = seeded(9);
  ctx.fillStyle = 'rgba(30,26,24,0.5)';
  for (let y = 22; y < S; y += 64) for (let x = 22; x < S; x += 64) {
    ctx.beginPath();
    ctx.arc(x + (rnd() - 0.5) * 2, y + (rnd() - 0.5) * 2, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  const rough = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const rr = clamp((rustMask[i] - 0.46) * 3.4, 0, 1);
    const v = 110 + rr * 120 + n2[i] * 30;
    return [v, v, v];
  });
  const metalness = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const rr = clamp((rustMask[i] - 0.46) * 3.4, 0, 1);
    const v = 230 * (1 - rr) + 30 * rr;
    return [v, v, v];
  });
  return {
    map: toTexture(albedo, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(height, S, 1.4)),
    roughnessMap: toTexture(rough),
    metalnessMap: toTexture(metalness),
  };
}

function buildPaintedMetal(seed, hue) {
  const n1 = fbm(S, seed, 4, 7);
  const chips = fbm(S, seed + 5, 3, 12);
  const height = new Float32Array(S * S);
  const albedo = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const chip = clamp((chips[i] - 0.62) * 5, 0, 1);
    const shade = 0.82 + n1[i] * 0.3;
    const [r, g, b] = hue;
    const rr = r * shade * (1 - chip) + 96 * chip;
    const gg = g * shade * (1 - chip) + 88 * chip;
    const bb = b * shade * (1 - chip) + 80 * chip;
    height[i] = chip * 0.5 + n1[i] * 0.5;
    return [rr, gg, bb];
  });
  const ctx = albedo._ctx;
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(2, 2, S - 4, S - 4);
  const rough = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    return [150 + n1[i] * 60, 150 + n1[i] * 60, 150 + n1[i] * 60];
  });
  return {
    map: toTexture(albedo, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(height, S, 1.2)),
    roughnessMap: toTexture(rough),
  };
}

function buildSolar() {
  const cells = 8;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b1420';
  ctx.fillRect(0, 0, S, S);
  const cs = S / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const g = ctx.createLinearGradient(x * cs, y * cs, (x + 1) * cs, (y + 1) * cs);
      g.addColorStop(0, '#173a5e');
      g.addColorStop(0.45, '#0d2138');
      g.addColorStop(1, '#1a4166');
      ctx.fillStyle = g;
      ctx.fillRect(x * cs + 2, y * cs + 2, cs - 4, cs - 4);
      ctx.strokeStyle = 'rgba(140,180,210,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x * cs + 4, y * cs + cs * 0.5);
      ctx.lineTo(x * cs + cs - 4, y * cs + cs * 0.5);
      ctx.moveTo(x * cs + cs * 0.33, y * cs + 4);
      ctx.lineTo(x * cs + cs * 0.33, y * cs + cs - 4);
      ctx.moveTo(x * cs + cs * 0.66, y * cs + 4);
      ctx.lineTo(x * cs + cs * 0.66, y * cs + cs - 4);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgba(190,210,225,0.55)';
  ctx.lineWidth = 4;
  for (let i = 0; i <= cells; i++) {
    ctx.beginPath(); ctx.moveTo(i * cs, 0); ctx.lineTo(i * cs, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cs); ctx.lineTo(S, i * cs); ctx.stroke();
  }
  const height = new Float32Array(S * S);
  const n = fbm(S, 3, 3, 6);
  for (let i = 0; i < height.length; i++) height[i] = n[i] * 0.15;
  return {
    map: toTexture(c, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(height, S, 0.7)),
    roughnessMap: toTexture(canvasFromPixels(S, () => [52, 60, 66])),
    metalnessMap: toTexture(canvasFromPixels(S, () => [170, 170, 170])),
  };
}

function buildGround() {
  const n1 = fbm(S, 101, 5, 4);
  const n2 = fbm(S, 133, 4, 11);
  const height = new Float32Array(S * S);
  const albedo = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const soil = 58 + n1[i] * 40;
    const dry = n2[i];
    const grassTint = dry > 0.66 ? 12 : 0;
    height[i] = n2[i];
    return [
      soil * 0.92 + grassTint,
      soil * 0.88 + grassTint * 1.6,
      soil * 0.78 + grassTint * 0.4,
    ];
  });
  const ctx = albedo._ctx;
  const rnd = seeded(23);
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = `rgba(${40 + rnd() * 40},${50 + rnd() * 45},${30 + rnd() * 25},${0.2 + rnd() * 0.4})`;
    ctx.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 6, 2 + rnd() * 6);
  }
  return {
    map: toTexture(albedo, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(height, S, 1.6)),
    roughnessMap: toTexture(canvasFromPixels(S, (x, y) => {
      const v = 200 + n1[y * S + x] * 45;
      return [v, v, v];
    })),
  };
}

function buildBark() {
  const n1 = fbm(S, 201, 5, 5);
  const n2 = fbm(S, 211, 3, 24);
  const height = new Float32Array(S * S);
  const albedo = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const v = n1[i] * 0.7 + n2[i] * 0.3;
    const streak = Math.abs(Math.sin(x * 0.11 + n1[i] * 7)) * 0.3;
    const base = 62 + v * 58 - streak * 30;
    height[i] = v;
    return [base * 1.02, base * 0.86, base * 0.68];
  });
  return {
    map: toTexture(albedo, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(height, S, 2.6)),
    roughnessMap: toTexture(canvasFromPixels(S, (x, y) => {
      const v = 205 + n1[y * S + x] * 40;
      return [v, v, v];
    })),
  };
}

function buildFoliage() {
  const n1 = fbm(S, 301, 5, 6);
  const n2 = fbm(S, 311, 4, 16);
  const c = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const v = n1[i] * 0.6 + n2[i] * 0.4;
    const b = 40 + v * 105;
    return [b * 0.52, b * 0.96, b * 0.38];
  });
  // leaf veins / darker gaps
  const ctx = c._ctx;
  const rnd = seeded(41);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(10,30,12,${0.1 + rnd() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * S, rnd() * S, 2 + rnd() * 9, 1 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return {
    map: toTexture(c, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(fbm(S, 321, 3, 10), S, 1.2)),
    roughnessMap: toTexture(canvasFromPixels(S, () => [190, 190, 190])),
  };
}

function buildFabric() {
  const n1 = fbm(S, 401, 4, 12);
  const n2 = fbm(S, 411, 2, 64);
  const albedo = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const weave = (Math.sin(x * 0.7) * Math.sin(y * 0.7)) * 4;
    const v = 22 + n1[i] * 12 + weave + n2[i] * 6;
    return [v * 1.15, v * 1.18, v * 1.3];
  });
  return {
    map: toTexture(albedo, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(n1, S, 0.9)),
    roughnessMap: toTexture(canvasFromPixels(S, () => [225, 225, 225])),
  };
}

function buildGlass() {
  const n1 = fbm(S, 501, 4, 5);
  const c = canvasFromPixels(S, (x, y) => {
    const i = y * S + x;
    const v = 10 + n1[i] * 14;
    return [v * 0.9, v * 1.1, v * 1.25];
  });
  const ctx = c._ctx;
  drawCracks(ctx, S, 71, 9, 'rgba(180,210,220,0.16)', 1);
  return {
    map: toTexture(c, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(n1, S, 0.35)),
    roughnessMap: toTexture(canvasFromPixels(S, (x, y) => {
      const v = 22 + n1[y * S + x] * 60;
      return [v, v, v];
    })),
  };
}

function buildWater() {
  const n1 = fbm(S, 601, 4, 7);
  const n2 = fbm(S, 611, 3, 18);
  return {
    map: toTexture(canvasFromPixels(S, (x, y) => {
      const i = y * S + x;
      const v = n1[i] * 0.6 + n2[i] * 0.4;
      return [18 + v * 30, 70 + v * 70, 88 + v * 76];
    }), { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(n1, S, 1.5)),
    roughnessMap: toTexture(canvasFromPixels(S, () => [24, 24, 24])),
  };
}

function buildFacade(seed, baseRGB, opts = {}) {
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const n = fbm(S, seed, 4, 5);
  const n2 = fbm(S, seed + 17, 3, 19);
  const img = ctx.createImageData(S, S);
  const height = new Float32Array(S * S);
  const cols = 4;
  const rows = 5;
  const cw = S / cols;
  const ch = S / rows;
  const brokenAt = opts.broken ?? 0.58;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const v = 0.72 + n[i] * 0.32;
      const grime = Math.pow(clamp((n2[i] - 0.48) * 2.5, 0, 1), 1.8) * 0.5;
      const burn = opts.burn ? Math.pow(clamp((n2[i] - 0.34) * 2.0, 0, 1), 2) * 0.82 : 0;
      const weather = 1 - grime - burn;
      let r = baseRGB[0] * v * weather;
      let g = baseRGB[1] * v * weather;
      let b = baseRGB[2] * v * weather;
      // window recesses - most panes are gone
      const lx = x % cw, ly = y % ch;
      const mx = cw * 0.22, my = ch * 0.2;
      const inWin = lx > mx && lx < cw - mx && ly > my && ly < ch - my;
      if (inWin) {
        const blown = n2[i] > brokenAt;
        if (blown) {
          r = 5; g = 6; b = 7;
        } else {
          const t = (ly - my) / (ch - my * 2);
          const glass = 9 + t * 15 + n2[i] * 9;
          r = glass * 0.8; g = glass; b = glass * 1.2;
        }
        // weathered frame
        if (lx < mx + 2.5 || lx > cw - mx - 2.5 || ly < my + 2 || ly > ch - my - 2) {
          r = 54; g = 53; b = 51;
        }
        height[i] = blown ? 0.03 : 0.16;
      } else {
        height[i] = 0.7;
        // exposed structure where the cladding has come away
        if (n2[i] > 0.8) { r = 56; g = 50; b = 44; }
      }
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // soot plumes licking up from blown-out floors
  const rnd = seeded(seed + 44);
  for (let i = 0; i < 16; i++) {
    const x = rnd() * S, w = 3 + rnd() * 18, h = 30 + rnd() * 160;
    const g2 = ctx.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, 'rgba(13,11,9,0.55)');
    g2.addColorStop(1, 'rgba(13,11,9,0)');
    ctx.save();
    ctx.translate(x, rnd() * S);
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  drawCracks(ctx, S, seed + 3, 16, 'rgba(16,14,12,0.5)', 1.5);
  return {
    map: toTexture(c, { srgb: true }),
    normalMap: toTexture(normalMapFromHeight(height, S, 2.0)),
    roughnessMap: toTexture(canvasFromPixels(S, (x, y) => {
      const v = 170 + n[y * S + x] * 55;
      return [v, v, v];
    })),
  };
}

/**
 * Near-white cloth detail maps. They only modulate a material's base colour,
 * adding weave, seams and grime so clothing reads as fabric instead of plastic.
 */
const clothCache = new Map();

export function getClothTexture(kind = 'jacket') {
  if (clothCache.has(kind)) return clothCache.get(kind);
  const size = 256;
  const seed = kind === 'denim' ? 902 : kind === 'leather' ? 913 : 921;
  const n = fbm(size, seed, 4, 5);
  const c = canvasFromPixels(size, (x, y) => {
    const i = y * size + x;
    const v = n[i];
    let tone = 228 + (v - 0.5) * 46;
    if (kind === 'denim') {
      tone += (Math.sin((x + y) * 0.78) * 0.6 + Math.sin(y * 2.6) * 0.4) * 10;
    } else if (kind === 'leather') {
      tone += (v - 0.5) * 40 + Math.sin(x * 0.21 + y * 0.13) * 4;
    } else {
      tone += Math.sin(x * 1.9) * Math.sin(y * 1.9) * 5 + Math.sin(y * 0.33) * 3;
    }
    tone -= Math.pow(clamp((v - 0.56) * 2.8, 0, 1), 1.5) * 36;
    const r = clamp(tone, 26, 255);
    return [r, clamp(r + 1, 0, 255), clamp(r + (kind === 'denim' ? 7 : 2), 0, 255)];
  });
  const tex = toTexture(c, { srgb: true });
  if (kind === 'denim') tex.repeat.set(3, 5);
  else if (kind === 'leather') tex.repeat.set(2, 2);
  else tex.repeat.set(2.5, 2.5);
  clothCache.set(kind, tex);
  return tex;
}

const builders = {
  concrete: buildConcrete,
  facade: () => buildFacade(801, [98, 94, 87]),
  facadePale: () => buildFacade(811, [128, 117, 99]),
  facadeDark: () => buildFacade(821, [74, 80, 86]),
  charred: () => buildFacade(831, [60, 54, 48], { burn: true, broken: 0.42 }),
  asphalt: buildAsphalt,
  rust: buildRustedMetal,
  cream: () => buildPaintedMetal(701, [206, 198, 176]),
  rustPaint: () => buildPaintedMetal(711, [132, 58, 38]),
  tealPaint: () => buildPaintedMetal(721, [46, 106, 104]),
  solar: buildSolar,
  ground: buildGround,
  bark: buildBark,
  foliage: buildFoliage,
  fabric: buildFabric,
  glass: buildGlass,
  water: buildWater,
};

export function getSurface(name) {
  if (cache.has(name)) return cache.get(name);
  const build = builders[name] || builders.concrete;
  const res = build();
  cache.set(name, res);
  return res;
}

/** Leaf alpha sprite for vines / foliage cards. */
let leafAlpha = null;
export function getLeafAlpha() {
  if (leafAlpha) return leafAlpha;
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const rnd = seeded(88);
  for (let i = 0; i < 46; i++) {
    const x = 30 + rnd() * (size - 60);
    const y = 20 + rnd() * (size - 50);
    const w = 10 + rnd() * 26;
    const h = 6 + rnd() * 16;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, `rgba(${70 + rnd() * 40},${110 + rnd() * 60},${46 + rnd() * 30},1)`);
    g.addColorStop(1, `rgba(${34 + rnd() * 30},${72 + rnd() * 40},${28 + rnd() * 20},0.9)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, rnd() * 3.14, 0, Math.PI * 2);
    ctx.fill();
  }
  leafAlpha = new THREE.CanvasTexture(c);
  leafAlpha.colorSpace = THREE.SRGBColorSpace;
  leafAlpha.needsUpdate = true;
  return leafAlpha;
}

/** Soft radial glow sprite used by particles and markers. */
let glowTex = null;
export function getGlowTexture() {
  if (glowTex) return glowTex;
  const size = 128;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
