// Low plants that are not trees: two growth forms, every species is a table entry.
//
//   pads     jointed flat pads, each sprouting more from its rim (prickly pear)
//   rosette  long leaves radiating from one point, upright at the centre and splaying outward
//            (yucca, agave, sotol), optionally on a short trunk and with a flower stalk
//
// Like rocks, a scene's plants merge into one static mesh per material, in world space: they don't
// sway, so instancing buys nothing here and one draw call is cheapest. The seed is the position.

import { rng, seedFromPosition } from './grow.js';

export const PLANTS = {
  pricklypear: {
    label: 'Prickly pear', form: 'pads', height: 1.1, width: 1.6,
    pad: { length: 0.36, width: 0.27, thick: 0.05 }, depth: 4, start: [2, 4], children: [1, 2],
    color: ['#4a6338', '#526b3d', '#5a7240', '#647a47'], fruit: '#6e2440', fruitChance: 0.3,
  },
  yucca: {
    label: 'Yucca', form: 'rosette', height: 1.2, width: 1.3,
    leaves: 70, leaf: { length: 0.75, width: 0.045, stiff: 0.85 }, trunk: [0, 0.6], stalkChance: 0.35, stalk: 1.6,
    color: ['#3f5a34', '#4a6539', '#55703f'], tip: '#8a7a4a', bloom: '#ece6cf',
  },
  agave: {
    label: 'Agave', form: 'rosette', height: 0.9, width: 1.6,
    leaves: 26, leaf: { length: 0.85, width: 0.16, stiff: 0.6 }, trunk: [0, 0], stalkChance: 0,
    color: ['#6f8f8a', '#7a9a92', '#86a39a'], tip: '#4a3a2a',
  },
  sotol: {
    label: 'Sotol', form: 'rosette', height: 1.0, width: 1.5,
    leaves: 140, leaf: { length: 0.9, width: 0.022, stiff: 0.45 }, trunk: [0, 0.2], stalkChance: 0.5, stalk: 2.6,
    color: ['#6a7d4e', '#758853', '#80915a'], tip: '#b0a070', bloom: '#c8b48a',
  },
};
export const PLANT_NAMES = Object.keys(PLANTS);

/** Authored entry → a placed plant. Same rules as trees: the seed is the position. */
export function resolvePlant(entry = {}) {
  const p = entry.params ?? {};
  const kind = PLANTS[p.kind ?? entry.kind] ? (p.kind ?? entry.kind) : 'pricklypear';
  const [x, z] = entry.at ?? [0, 0];
  const seed = Number.isFinite(entry.seed) ? entry.seed >>> 0 : seedFromPosition(x, z) ^ 0x5eed;
  const r = rng(seed);
  const k = PLANTS[kind];
  const scale = (p.h ?? k.height * (0.75 + r() * 0.5)) / k.height;
  return { kind, x, z, seed, scale, yaw: r() * Math.PI * 2 };
}

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); };

function makeSink() {
  const pos = [], nor = [], col = [], idx = [];
  return {
    pos, nor, col, idx,
    vert(p, n, c) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); col.push(c[0], c[1], c[2]); return pos.length / 3 - 1; },
  };
}

// A flattened ellipsoid pad, its base at `o`, growing along `dir` with its face normal `face`.
function pad(sink, o, dir, face, L, W, T, color, shade) {
  const side = [dir[1] * face[2] - dir[2] * face[1], dir[2] * face[0] - dir[0] * face[2], dir[0] * face[1] - dir[1] * face[0]];
  const SU = 8, SV = 6, base = sink.pos.length / 3;
  for (let i = 0; i <= SV; i++) {
    const v = i / SV, th = v * Math.PI; // along the pad, base to tip
    for (let j = 0; j < SU; j++) {
      const ph = j / SU * Math.PI * 2;
      const a = Math.sin(th) * Math.cos(ph), b = Math.sin(th) * Math.sin(ph), c = -Math.cos(th);
      // Pads are fuller toward the tip end: a slight egg shape.
      const fat = 1 + 0.15 * (v - 0.5);
      const lx = a * W * 0.5 * fat, ly = (c + 1) * 0.5 * L, lz = b * T * 0.5 * fat;
      const p = [o[0] + side[0] * lx + dir[0] * ly + face[0] * lz, o[1] + side[1] * lx + dir[1] * ly + face[1] * lz, o[2] + side[2] * lx + dir[2] * ly + face[2] * lz];
      const nx = a / (W * 0.5), ny = c / (L * 0.5), nz = b / (T * 0.5), m = Math.hypot(nx, ny, nz) || 1;
      const n = [(side[0] * nx + dir[0] * ny + face[0] * nz) / m, (side[1] * nx + dir[1] * ny + face[1] * nz) / m, (side[2] * nx + dir[2] * ny + face[2] * nz) / m];
      const rim = 1 - 0.18 * Math.abs(b) ** 6; // pale rims read as the pad's thickness
      sink.vert(p, n, color.map((x) => x * shade * (rim + 0.1 * (1 - v))));
    }
  }
  for (let i = 0; i < SV; i++) for (let j = 0; j < SU; j++) {
    const a = base + i * SU + j, b = base + i * SU + (j + 1) % SU, c = a + SU, d = b + SU;
    sink.idx.push(a, c, b, b, c, d);
  }
}

function blob(sink, o, rad, color) {
  const base = sink.pos.length / 3, S = 5;
  for (let i = 0; i <= S; i++) for (let j = 0; j < S; j++) {
    const th = i / S * Math.PI, ph = j / S * Math.PI * 2, n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    sink.vert([o[0] + n[0] * rad, o[1] + n[1] * rad * 1.3, o[2] + n[2] * rad], n, color);
  }
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
    const a = base + i * S + j, b = base + i * S + (j + 1) % S;
    sink.idx.push(a, a + S, b, b, a + S, b + S);
  }
}

function growPads(sink, P, k, y) {
  const r = rng(P.seed), s = P.scale;
  const colors = k.color.map(hex);
  const fruit = hex(k.fruit);
  const grow = (o, dir, depth, size) => {
    const face0 = [Math.cos(r() * 6.28), 0, Math.sin(r() * 6.28)];
    // Face normal: horizontal-ish and perpendicular to the growth direction.
    let f = [face0[0] - dir[0] * (face0[0] * dir[0] + face0[2] * dir[2]), 0, face0[2] - dir[2] * (face0[0] * dir[0] + face0[2] * dir[2])];
    const fm = Math.hypot(f[0], f[2]) || 1; f = [f[0] / fm, 0, f[2] / fm];
    const L = k.pad.length * s * size, W = k.pad.width * s * size, T = k.pad.thick * s;
    const color = colors[(r() * colors.length) | 0];
    pad(sink, o, dir, f, L, W, T, color, 0.72 + 0.22 * (depth / k.depth));
    const tipAt = (t, sideOff) => {
      const side = [dir[1] * f[2] - dir[2] * f[1], dir[2] * f[0] - dir[0] * f[2], dir[0] * f[1] - dir[1] * f[0]];
      return [o[0] + dir[0] * L * t + side[0] * W * 0.5 * sideOff, o[1] + dir[1] * L * t + side[1] * W * 0.5 * sideOff, o[2] + dir[2] * L * t + side[2] * W * 0.5 * sideOff];
    };
    if (depth >= k.depth) {
      if (r() < k.fruitChance) for (let i = 0; i < 2 + (r() * 3 | 0); i++) blob(sink, tipAt(0.92, (r() - 0.5) * 1.4), 0.028 * s, fruit);
      return;
    }
    const n = k.children[0] + Math.floor(r() * (k.children[1] - k.children[0] + 1));
    for (let i = 0; i < n; i++) {
      const off = (r() - 0.5) * 1.3, base = tipAt(0.85, off);
      // Children lean outward from the parent's edge and up; the pad plane turns a little.
      let d = [dir[0] + (r() - 0.5) * 0.9, dir[1] + 0.25, dir[2] + (r() - 0.5) * 0.9];
      const m = Math.hypot(...d); d = d.map((x) => x / m);
      grow(base, d, depth + 1, size * (0.82 + r() * 0.2));
    }
  };
  const starts = k.start[0] + Math.floor(r() * (k.start[1] - k.start[0] + 1));
  for (let i = 0; i < starts; i++) {
    const a = P.yaw + i / starts * 6.28 + r() * 0.8, rr = 0.12 * s * r();
    const dir = [Math.cos(a) * 0.45, 0.9, Math.sin(a) * 0.45], m = Math.hypot(...dir);
    grow([P.x + Math.cos(a) * rr, y - 0.03, P.z + Math.sin(a) * rr], dir.map((x) => x / m), 1, 1);
  }
}

function growRosette(sink, P, k, y) {
  const r = rng(P.seed), s = P.scale, colors = k.color.map(hex), tip = hex(k.tip);
  const trunkH = (k.trunk[0] + r() * (k.trunk[1] - k.trunk[0])) * s;
  const top = [P.x, y + trunkH, P.z];
  if (trunkH > 0.05) {
    // A shaggy trunk of dead leaves: a tapered column.
    const dead = hex('#7a6a4e'), SEG = 7, base = sink.pos.length / 3, rad = 0.09 * s;
    for (let i = 0; i <= 1; i++) for (let j = 0; j < SEG; j++) {
      const a = j / SEG * 6.28, rr = rad * (i ? 0.85 : 1.1);
      sink.vert([P.x + Math.cos(a) * rr, y - 0.05 + (trunkH + 0.05) * i, P.z + Math.sin(a) * rr], [Math.cos(a), 0, Math.sin(a)], dead.map((c) => c * 0.8));
    }
    for (let j = 0; j < SEG; j++) { const a = base + j, b = base + (j + 1) % SEG; sink.idx.push(a, a + SEG, b, b, a + SEG, b + SEG); }
  }
  const N = Math.round(k.leaves * (0.85 + r() * 0.3)), L0 = k.leaf.length * s, W0 = k.leaf.width * s;
  const golden = 2.39996;
  for (let i = 0; i < N; i++) {
    const t = i / N; // 0 = inner, upright; 1 = outer, splayed
    const az = P.yaw + i * golden + (r() - 0.5) * 0.2;
    const tilt = (0.12 + Math.pow(t, 0.8) * 1.25) * (0.85 + r() * 0.3); // from vertical
    const L = L0 * (0.7 + 0.3 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5)) * (0.85 + r() * 0.3);
    const W = W0 * (0.85 + r() * 0.3);
    const color = colors[(r() * colors.length) | 0], dim = 0.65 + 0.45 * (1 - t) * 0.5 + 0.2 * t;
    const out = [Math.cos(az), 0, Math.sin(az)], side = [-Math.sin(az), 0, Math.cos(az)];
    // Leaf as a V-section strip of 5 rows: base wide, tapering to a point, bending down by (1 - stiff).
    const ROWS = 5, base = sink.pos.length / 3;
    for (let q = 0; q <= ROWS; q++) {
      const u = q / ROWS, bend = tilt + u * u * (1 - k.leaf.stiff) * 1.2;
      const along = [out[0] * Math.sin(bend), Math.cos(bend), out[2] * Math.sin(bend)];
      // Integrate the curve roughly: position is the sum of segment directions.
      const seg = L / ROWS;
      const prev = q === 0 ? [top[0], top[1] + 0.02, top[2]] : sink.pos.slice((base + (q - 1) * 3 + 1) * 3, (base + (q - 1) * 3 + 1) * 3 + 3);
      const c = q === 0 ? prev : [prev[0] + along[0] * seg, prev[1] + along[1] * seg, prev[2] + along[2] * seg];
      const w = W * (q === ROWS ? 0.02 : Math.sin(Math.min(1, (1 - u) * 1.4 + 0.15) * Math.PI * 0.5)) * 0.5;
      // Face normal of the leaf: up-and-out, perpendicular to `along`.
      const fn = [-out[0] * Math.cos(bend), Math.sin(bend), -out[2] * Math.cos(bend)];
      const tone = color.map((x, ci) => (q === ROWS ? tip[ci] : x) * dim * (0.85 + 0.25 * u));
      const keel = 0.25 * w; // the V: centre line sits below the edges
      sink.vert([c[0] - side[0] * w + fn[0] * keel, c[1] + fn[1] * keel, c[2] - side[2] * w + fn[2] * keel], fn, tone);
      sink.vert(c, fn, tone.map((x) => x * 0.92));
      sink.vert([c[0] + side[0] * w + fn[0] * keel, c[1] + fn[1] * keel, c[2] + side[2] * w + fn[2] * keel], fn, tone);
    }
    for (let q = 0; q < ROWS; q++) {
      const a = base + q * 3;
      sink.idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  if (k.stalkChance && r() < k.stalkChance) {
    // Flower stalk: a thin stem and a cluster of pale blooms on its upper third.
    const H = k.stalk * s * (0.8 + r() * 0.4), lean = [(r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.12];
    const stem = hex('#6d6a3e'), bloom = hex(k.bloom);
    const SEG = 5, base = sink.pos.length / 3;
    for (let i = 0; i <= 1; i++) for (let j = 0; j < SEG; j++) {
      const a = j / SEG * 6.28, rr = 0.018 * s * (i ? 0.5 : 1);
      sink.vert([top[0] + lean[0] * H * i + Math.cos(a) * rr, top[1] + H * i, top[2] + lean[2] * H * i + Math.sin(a) * rr], [Math.cos(a), 0, Math.sin(a)], stem);
    }
    for (let j = 0; j < SEG; j++) { const a = base + j, b = base + (j + 1) % SEG; sink.idx.push(a, a + SEG, b, b, a + SEG, b + SEG); }
    for (let i = 0; i < 18; i++) {
      const h = 0.62 + r() * 0.38, a = r() * 6.28, rr = 0.07 * s * (1.2 - h);
      blob(sink, [top[0] + lean[0] * H * h + Math.cos(a) * rr, top[1] + H * h, top[2] + lean[2] * H * h + Math.sin(a) * rr], 0.035 * s, bloom);
    }
  }
}

/** Every placed plant → one merged geometry, in world space, standing on the grade. */
export function buildPlants(THREE, plants, heightAt) {
  const sink = makeSink();
  for (const P of plants) {
    const k = PLANTS[P.kind], y = heightAt(P.x, P.z);
    if (k.form === 'pads') growPads(sink, P, k, y); else growRosette(sink, P, k, y);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(sink.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(sink.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(sink.col, 3));
  g.setIndex(sink.idx); // three picks 32-bit indices when the count needs them
  g.computeBoundingSphere();
  return g;
}

/** One material for every plant: waxy, double-sided (leaves are single sheets). */
export function plantMaterial(THREE) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
}
