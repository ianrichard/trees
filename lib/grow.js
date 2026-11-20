// Tree skeletons. Pure data, no THREE, so this can run in a worker.
//
// Broadleaf kinds use space colonization (Runions, Lane & Prusinkiewicz 2007): attraction points
// fill a crown envelope and branches compete for them, which is what gives real crowns their
// uneven, self-avoiding limbs. Conifers use a monopodial whorl model (a leader with tiers of
// laterals), which space colonization cannot produce. Both finish with the pipe model
// (da Vinci / Shinozaki: r_parent^p = Σ r_child^p) for radii, a gravity sag for limbs, and
// leaf-cluster sites on the thin twigs.

import { KINDS } from './species.js';

/** mulberry32: small, fast, good enough for geometry. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable seed from a planted position, quantized to centimeters so float noise never reseeds a tree. */
export function seedFromPosition(x, z) {
  let h = Math.imul(Math.round(x * 100) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 100) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const len = (x, y, z) => Math.hypot(x, y, z) || 1e-9;

function randomUnit(r) {
  const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return [s * Math.cos(a), u, s * Math.sin(a)];
}

/** Uniform 3D grid of point indices for radius queries. */
class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(x, y, z) { const c = this.cell; return `${Math.floor(x / c)},${Math.floor(y / c)},${Math.floor(z / c)}`; }
  add(i, x, y, z) { const k = this.key(x, y, z); let b = this.map.get(k); if (!b) this.map.set(k, (b = [])); b.push(i); }
  near(x, y, z, fn) {
    const c = this.cell, cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const b = this.map.get(`${cx + i},${cy + j},${cz + k}`);
      if (b) for (const n of b) fn(n);
    }
  }
}

class Skeleton {
  constructor() { this.x = []; this.y = []; this.z = []; this.parent = []; this.kids = []; }
  add(x, y, z, parent) {
    const i = this.x.length;
    this.x.push(x); this.y.push(y); this.z.push(z); this.parent.push(parent); this.kids.push(0);
    if (parent >= 0) this.kids[parent]++;
    return i;
  }
  get count() { return this.x.length; }
}

/* ---------------------------------------------------------------- broadleaf: space colonization */

function crownPoints(spec, H, r) {
  const c = spec.crown, pts = [];
  // Low-frequency lobes make the silhouette asymmetric instead of a perfect ellipsoid.
  const lobes = Array.from({ length: 5 }, () => ({ d: randomUnit(r), a: (0.4 + r() * 0.6) * (c.lobes ?? 0.2) }));
  const shape = (v) => {
    let m = 1;
    for (const l of lobes) { const d = Math.max(0, v[0] * l.d[0] + v[1] * l.d[1] + v[2] * l.d[2]); m += l.a * (2.2 * d * d * d * d - 0.35); }
    return m;
  };
  // Clumps: real crowns are masses of foliage around a few big limbs, not a uniform cloud.
  const clumps = Array.from({ length: 16 }, () => {
    const v = randomUnit(r), k = 0.45 + 0.5 * Math.pow(r(), 0.5);
    return [v[0] * k, v[1] * k, v[2] * k];
  });
  let guard = 0;
  while (pts.length < spec.attractors && guard++ < spec.attractors * 40) {
    let v;
    if (r() < (c.clump ?? 0.55)) {
      const cl = clumps[(r() * clumps.length) | 0], j = randomUnit(r), s = 0.34 * Math.cbrt(r());
      v = [cl[0] + j[0] * s, cl[1] + j[1] * s, cl[2] + j[2] * s];
    } else {
      // Biased toward the shell: leaves live where the light is.
      const d = randomUnit(r), k = Math.pow(r(), 0.22);
      v = [d[0] * k, d[1] * k, d[2] * k];
    }
    const m = len(v[0], v[1], v[2]);
    if (m > shape(v.map(q => q / m))) continue;
    const vy = v[1] < 0 ? v[1] * c.bottomFlatten : v[1];
    const y = (c.center + vy * c.ry) * H;
    if (y < c.base * H + 0.3 || y > c.top * H) continue;
    pts.push([v[0] * c.rx * H, y, v[2] * c.rx * H]);
  }
  return pts;
}

function colonize(spec, H, r) {
  const sk = new Skeleton(), D = spec.step, di = spec.influence, dk = spec.kill;
  const att = crownPoints(spec, H, r);
  const alive = new Uint8Array(att.length).fill(1);
  const nearest = new Int32Array(att.length).fill(-1);
  const nearD = new Float32Array(att.length).fill(Infinity);
  const ag = new Grid(di);
  att.forEach((p, i) => ag.add(i, p[0], p[1], p[2]));

  // Trunk(s): straight-ish leaders that rise until the crown can pull on them.
  const stems = spec.stems || 1, fresh = [];
  for (let s = 0; s < stems; s++) {
    const a = r() * Math.PI * 2, off = stems > 1 ? 0.04 + r() * 0.06 : 0;
    let i = sk.add(Math.cos(a) * off, 0, Math.sin(a) * off, -1);
    fresh.push(i);
    let dir = stems > 1 ? [Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45] : [0, 1, 0];
    let lean = randomUnit(r);
    for (let k = 0; k < 200; k++) {
      const w = spec.trunkWander;
      dir = [dir[0] + lean[0] * w * 0.3 + (r() - 0.5) * w, 1, dir[2] + lean[2] * w * 0.3 + (r() - 0.5) * w];
      const m = len(...dir);
      const x = sk.x[i] + dir[0] / m * D, y = sk.y[i] + dir[1] / m * D, z = sk.z[i] + dir[2] / m * D;
      i = sk.add(x, y, z, i); fresh.push(i);
      let reached = false;
      ag.near(x, y, z, a2 => { if (!reached) { const p = att[a2]; reached = len(p[0] - x, p[1] - y, p[2] - z) < di * 0.9; } });
      if (reached && y > spec.crown.base * H) break;
    }
  }

  const sum = new Map();
  for (let iter = 0; iter < 260 && fresh.length; iter++) {
    // Update each live attractor's nearest node using only the nodes added last round.
    for (const n of fresh) {
      const x = sk.x[n], y = sk.y[n], z = sk.z[n];
      ag.near(x, y, z, a => {
        if (!alive[a]) return;
        const p = att[a], d = len(p[0] - x, p[1] - y, p[2] - z);
        if (d < dk) { alive[a] = 0; return; }
        if (d < di && d < nearD[a]) { nearD[a] = d; nearest[a] = n; }
      });
    }
    fresh.length = 0;
    sum.clear();
    for (let a = 0; a < att.length; a++) {
      if (!alive[a] || nearest[a] < 0) continue;
      const n = nearest[a], p = att[a];
      const dx = p[0] - sk.x[n], dy = p[1] - sk.y[n], dz = p[2] - sk.z[n], m = len(dx, dy, dz);
      let s = sum.get(n); if (!s) sum.set(n, (s = [0, 0, 0, 0]));
      s[0] += dx / m; s[1] += dy / m; s[2] += dz / m; s[3]++;
    }
    for (const [n, s] of sum) {
      if (sk.kids[n] >= 4) continue;
      const m = len(s[0], s[1], s[2]), wv = randomUnit(r), w = spec.wander, t = spec.tropism;
      let dx = s[0] / m + t[0] + wv[0] * w, dy = s[1] / m + t[1] + wv[1] * w, dz = s[2] / m + t[2] + wv[2] * w;
      const q = len(dx, dy, dz);
      const step = D * (0.8 + r() * 0.4);
      fresh.push(sk.add(sk.x[n] + dx / q * step, sk.y[n] + dy / q * step, sk.z[n] + dz / q * step, n));
    }
  }
  return sk;
}

/* ---------------------------------------------------------------- conifer: whorls on a leader */

function whorled(spec, H, r) {
  const sk = new Skeleton(), base = spec.crown.base * H, golden = Math.PI * (3 - Math.sqrt(5));
  const trunk = [];
  let i = sk.add(0, 0, 0, -1); trunk.push(i);
  const seg = H / 40;
  let wx = 0, wz = 0;
  for (let k = 1; k <= 40; k++) {
    wx += (r() - 0.5) * spec.trunkWander; wz += (r() - 0.5) * spec.trunkWander;
    i = sk.add(wx * k * seg * 0.15, k * seg, wz * k * seg * 0.15, i); trunk.push(i);
  }
  let az = r() * Math.PI * 2;
  for (let w = 0; w < spec.whorls; w++) {
    const t = w / (spec.whorls - 1);
    const h = base + (H * 0.97 - base) * Math.pow(t, 0.92) + (r() - 0.5) * seg;
    const ti = trunk[Math.min(40, Math.max(1, Math.round(h / seg)))];
    const L = H * (spec.lengthBottom + (spec.lengthTop - spec.lengthBottom) * t) * (0.85 + r() * 0.3);
    const count = Math.max(2, spec.perWhorl - (t > 0.8 ? 2 : 0) + ((r() * 2) | 0) - 1);
    for (let b = 0; b < count; b++) {
      az += golden + (r() - 0.5) * 0.5;
      // Lower tiers spread flatter and sag; top tiers point up.
      const elev = (90 - spec.branchAngle + t * 28 + (r() - 0.5) * 10) * Math.PI / 180;
      let dx = Math.cos(az) * Math.cos(elev), dy = Math.sin(elev), dz = Math.sin(az) * Math.cos(elev);
      const steps = Math.max(3, Math.round(L / 0.3));
      let p = ti, px = sk.x[ti], py = sk.y[ti], pz = sk.z[ti];
      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        dy -= spec.branchDroop * (1 - t) * 0.22 * (f < 0.75 ? 1 : -1.2);
        const wv = randomUnit(r);
        dx += wv[0] * spec.wander; dz += wv[2] * spec.wander;
        const m = len(dx, dy, dz); dx /= m; dy /= m; dz /= m;
        const sl = L / steps;
        px += dx * sl; py += dy * sl; pz += dz * sl;
        p = sk.add(px, py, pz, p);
        // Side shoots in the branch plane make the flat sprays of a conifer tier.
        if (f > 0.15 && f < 0.92 && r() < 0.85) {
          for (const side of [-1, 1]) {
            if (r() < 0.25) continue;
            const sx = -dz * side, sz = dx * side;
            const sLen = L * (1 - f) * (0.35 + r() * 0.25);
            let q = p, qx = px, qy = py, qz = pz;
            const n = Math.max(1, Math.round(sLen / 0.25));
            for (let u = 1; u <= n; u++) {
              qx += (sx * 0.75 + dx * 0.45) * sLen / n;
              qy += (dy * 0.3 - 0.06 * (1 - t)) * sLen / n;
              qz += (sz * 0.75 + dz * 0.45) * sLen / n;
              q = sk.add(qx, qy, qz, q);
            }
          }
        }
      }
    }
  }
  return sk;
}

/* ---------------------------------------------------------------- shared finishing */

function finish(sk, spec, H, r) {
  const n = sk.count, P = spec.pipe;
  // Smooth single-child runs so limbs curve instead of kinking at every step.
  for (let pass = 0; pass < 2; pass++) {
    const firstKid = new Int32Array(n).fill(-1);
    for (let i = 1; i < n; i++) if (sk.parent[i] >= 0 && firstKid[sk.parent[i]] < 0) firstKid[sk.parent[i]] = i;
    for (let i = 1; i < n; i++) {
      const p = sk.parent[i], c = firstKid[i];
      if (p < 0 || c < 0 || sk.kids[i] !== 1) continue;
      sk.x[i] = sk.x[i] * 0.5 + (sk.x[p] + sk.x[c]) * 0.25;
      sk.y[i] = sk.y[i] * 0.5 + (sk.y[p] + sk.y[c]) * 0.25;
      sk.z[i] = sk.z[i] * 0.5 + (sk.z[p] + sk.z[c]) * 0.25;
    }
  }
  // Pipe model: children always follow parents in index order, so one reverse pass sums them.
  const acc = new Float64Array(n), radius = new Float32Array(n), tips = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const rr = sk.kids[i] === 0 ? 1 : Math.pow(acc[i], 1 / P);
    if (sk.kids[i] === 0) tips[i] = 1;
    radius[i] = rr;
    if (sk.parent[i] >= 0) { acc[sk.parent[i]] += Math.pow(rr, P); tips[sk.parent[i]] += tips[i]; }
  }
  let base = 0;
  for (let i = 0; i < n; i++) if (sk.parent[i] < 0) base = Math.max(base, radius[i]);
  const scale = spec.trunkRadius / base;
  for (let i = 0; i < n; i++) radius[i] = Math.max(radius[i] * scale, spec.minTwig * 0.6);

  // Gravity: thin, long limbs sag by an amount that accumulates toward the tip.
  if (spec.sag !== 0) {
    const sag = new Float32Array(n), k = spec.sag ?? 0.05;
    for (let i = 0; i < n; i++) {
      const p = sk.parent[i];
      if (p < 0) continue;
      const h = Math.hypot(sk.x[i] - sk.x[p], sk.z[i] - sk.z[p]);
      sag[i] = sag[p] + k * h * Math.sqrt(spec.trunkRadius * 0.25 / radius[i]) * 0.35;
    }
    for (let i = 0; i < n; i++) sk.y[i] -= sag[i];
  }

  // Leaf-cluster sites along thin twigs, oriented by the twig direction.
  const leaves = [], L = spec.leaf;
  for (let i = 0; i < n; i++) {
    const p = sk.parent[i];
    if (p < 0 || tips[i] > L.tips) continue;
    if (sk.y[i] < spec.crown.base * H * 0.9) continue;
    let count = L.perNode * (sk.kids[i] === 0 ? 1.4 : 1);
    while (count > 0) {
      if (count < 1 && r() > count) break;
      count--;
      const t = r();
      leaves.push({
        x: sk.x[p] + (sk.x[i] - sk.x[p]) * t, y: sk.y[p] + (sk.y[i] - sk.y[p]) * t, z: sk.z[p] + (sk.z[i] - sk.z[p]) * t,
        dx: sk.x[i] - sk.x[p], dy: sk.y[i] - sk.y[p], dz: sk.z[i] - sk.z[p],
        seed: r(),
      });
    }
  }
  // Crown center and radii (for foliage normals and occlusion), measured from the leaves.
  let cx = 0, cy = 0, cz = 0;
  for (const l of leaves) { cx += l.x; cy += l.y; cz += l.z; }
  cx /= leaves.length || 1; cy /= leaves.length || 1; cz /= leaves.length || 1;
  let rx = 0, ry = 0, rz = 0;
  for (const l of leaves) { rx = Math.max(rx, Math.abs(l.x - cx)); ry = Math.max(ry, Math.abs(l.y - cy)); rz = Math.max(rz, Math.abs(l.z - cz)); }

  return {
    count: n,
    pos: Float32Array.from({ length: n * 3 }, (_, k) => [sk.x, sk.y, sk.z][k % 3][(k / 3) | 0]),
    parent: Int32Array.from(sk.parent), kids: Int32Array.from(sk.kids), radius, tips, leaves,
    crown: { center: [cx, cy, cz], radius: [Math.max(rx, 0.3), Math.max(ry, 0.3), Math.max(rz, 0.3)] },
    height: H,
  };
}

/** Grow one skeleton of a kind. `variant` is any integer; the same pair always grows the same tree. */
export function grow(kind, variant = 0) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`Unknown tree kind "${kind}"`);
  const r = rng(0x9e3779b1 ^ Math.imul(variant + 1, 0x85ebca6b) ^ [...kind].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261));
  const H = spec.height;
  const sk = spec.form === 'whorl' ? whorled(spec, H, r) : colonize(spec, H, r);
  return finish(sk, spec, H, r);
}
