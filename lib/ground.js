// Ground: one height function from authored landforms, and the mesh that shows it.
// Pure data, no THREE, so the mesh builds in a worker.
//
//   "ground": {}                                   flat, grassed, out to the horizon
//   { "use": "landform", "at": [6, -4], "params": { "h": 2.5, "size": 18 } }
//   { "use": "landform", "at": [-8, 10], "turn": 20, "params": { "h": 4, "size": [30, 8], "soft": [1, 0.35] } }
//   { "use": "landform", "at": [3, 6], "params": { "h": -0.8, "size": [7, 5] } }            a hollow
//
// A landform is a footprint extruded to `h` with soft edges: `soft` 0 is a cliff edge, 1 a full
// rounded hill, per axis. Raises combine by smooth maximum and hollows by smooth minimum, so two
// hills merge into a saddle instead of stacking, and authoring order never matters.
// Ground children stand at the grade: their `y` is measured from heightAt(at).

import { rng, seedFromPosition } from './grow.js';

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smoothstep = (t) => t * t * (3 - 2 * t);
const pair = (v, d) => (Array.isArray(v) ? [v[0] ?? d, v[1] ?? v[0] ?? d] : [v ?? d, v ?? d]);

/** Smooth max/min with blend width k (polynomial; exact max beyond k). */
function smax(a, b, k) {
  if (k <= 0) return Math.max(a, b);
  const h = clamp01(0.5 + 0.5 * (a - b) / k);
  return b + (a - b) * h + k * h * (1 - h);
}
const smin = (a, b, k) => -smax(-a, -b, k);

/** Cheap smooth 2D value noise in [-1, 1]. */
function noise2(x, z, seed) {
  const h = (i, j) => {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296 * 2 - 1;
  };
  const xi = Math.floor(x), zi = Math.floor(z), fx = smoothstep(x - xi), fz = smoothstep(z - zi);
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function resolveLandform(entry) {
  const p = entry.params ?? {};
  const [x, z] = entry.at ?? [0, 0];
  const [sx, sz] = pair(p.size, 10);
  const [kx, kz] = pair(p.soft, 1).map(clamp01);
  const seed = Number.isFinite(entry.seed) ? entry.seed >>> 0 : seedFromPosition(x, z);
  const r = rng(seed);
  const turn = (entry.turn ?? 0) * Math.PI / 180;
  return {
    x, z, h: p.h ?? 1, a: Math.max(sx, 0.2) / 2, b: Math.max(sz, 0.2) / 2, kx, kz,
    flat: p.top === 'flat', vary: p.vary ?? 0.15, seed,
    cos: Math.cos(turn), sin: Math.sin(turn),
    // Three low harmonics wobble the footprint so no two hills are clones.
    lobes: [1, 2, 3].map((n) => ({ n: n + 1, a: (0.5 + r()) / (n + 1), p: r() * 6.283 })),
  };
}

/** One landform's height at a world point; 0 outside its footprint. */
export function landformHeight(f, wx, wz) {
  const dx = wx - f.x, dz = wz - f.z;
  const lx = dx * f.cos + dz * f.sin, lz = -dx * f.sin + dz * f.cos;
  const ux = lx / f.a, uz = lz / f.b;
  let r = Math.hypot(ux, uz);
  if (r > 1.6) return 0;
  const ang = Math.atan2(uz, ux);
  let wob = 0;
  for (const l of f.lobes) wob += l.a * Math.sin(ang * l.n + l.p);
  wob += 0.6 * noise2(wx * 0.18, wz * 0.18, f.seed);
  r /= 1 + f.vary * 0.45 * wob;
  if (r >= 1) return 0;
  // Softness blends per axis by direction: a ridge can be steep on its sides and long at its ends.
  const wx2 = ux * ux, wz2 = uz * uz, s = (f.kx * wx2 + f.kz * wz2) / (wx2 + wz2 || 1);
  const r0 = 1 - s;
  const edge = s < 1e-3 ? 1 : 1 - smoothstep(clamp01((r - r0) / s));
  const crown = f.flat ? 1 : 1 - 0.28 * r * r;
  const grain = 1 + f.vary * 0.25 * noise2(wx * 0.35 + 7, wz * 0.35, f.seed ^ 0x9e37);
  return f.h * edge * crown * grain;
}

/**
 * Resolve an authored ground into its height function, extent and far-field height.
 * `scene` is the whole document ({ ground: { cover, children } }).
 */
export function resolveGround(scene = {}) {
  const ground = scene.ground ?? {};
  const children = Object.entries(ground.children ?? {});
  const forms = children.filter(([, c]) => c.use === 'landform').map(([, c]) => resolveLandform(c));

  // Authored detail covers the children plus a margin; beyond it the ground goes to the horizon.
  let minX = -30, maxX = 30, minZ = -30, maxZ = 30;
  for (const [, c] of children) {
    const [x, z] = c.at ?? [0, 0];
    const [sx, sz] = c.use === 'landform' ? pair(c.params?.size, 10) : [12, 12];
    const reach = Math.max(sx, sz) * 0.8;
    minX = Math.min(minX, x - reach); maxX = Math.max(maxX, x + reach);
    minZ = Math.min(minZ, z - reach); maxZ = Math.max(maxZ, z + reach);
  }
  const margin = ground.margin ?? 30;
  const extent = { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
  const blend = 40;

  const local = (x, z) => {
    let up = 0, down = 0;
    for (const f of forms) {
      const v = landformHeight(f, x, z);
      if (v > 0) up = smax(up, v, Math.min(up, v) * 0.6 + 0.05);
      else if (v < 0) down = smin(down, v, Math.min(-down, -v) * 0.6 + 0.05);
    }
    return up + down;
  };

  // The far field is the lowest height along the authored edge, carried out to the horizon. A pond
  // inside the scene is a pond; it does not sink the whole horizon.
  let farY = 0;
  if (forms.length) {
    farY = Infinity;
    const n = 64, { minX: ax, maxX: bx, minZ: az, maxZ: bz } = extent;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      farY = Math.min(farY, local(ax + (bx - ax) * u, az), local(ax + (bx - ax) * u, bz), local(ax, az + (bz - az) * u), local(bx, az + (bz - az) * u));
    }
  }

  const heightAt = (x, z) => {
    const out = Math.max(extent.minX - x, x - extent.maxX, extent.minZ - z, z - extent.maxZ, 0);
    const w = smoothstep(clamp01(out / blend));
    return w >= 1 ? farY : local(x, z) * (1 - w) + farY * w;
  };

  return { heightAt, extent, farY, blend, cover: ground.cover ?? 'grass', landforms: forms.length };
}

/* ---------------------------------------------------------------- mesh */

/**
 * Ground mesh as typed arrays: a fine grid over the authored extent plus its blend band, then
 * flat rings out to the horizon with the same edge resolution (no T-junction cracks).
 * `occluders` [{x, z, r}] darken the grade under crowns, which is the contact shadow.
 */
export function buildGroundArrays(scene, { occluders = [], maxCells = 220, horizon = 4000 } = {}) {
  const g = resolveGround(scene);
  const { extent: e, blend } = g;
  const x0 = e.minX - blend, x1 = e.maxX + blend, z0 = e.minZ - blend, z1 = e.maxZ + blend;
  const span = Math.max(x1 - x0, z1 - z0);
  const cell = Math.max(0.5, span / maxCells);
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
  const pos = [], col = [], idx = [];

  const occ = (x, z) => {
    let k = 1;
    for (const o of occluders) {
      const d = Math.hypot(x - o.x, z - o.z) / o.r;
      if (d < 1) k *= 1 - 0.45 * (1 - smoothstep(d)) ** 1.5;
    }
    return k;
  };
  const vertex = (x, z, y = g.heightAt(x, z)) => {
    const e2 = 0.4;
    const gx = (g.heightAt(x + e2, z) - g.heightAt(x - e2, z)) / (2 * e2);
    const gz = (g.heightAt(x, z + e2) - g.heightAt(x, z - e2)) / (2 * e2);
    const slope = Math.hypot(gx, gz);
    // Steep ground shows soil; slow tonal patches hide the grass texture's tiling.
    const soil = smoothstep(clamp01((slope - 0.7) / 0.7)) * 0.8;
    const tone = 0.9 + 0.12 * noise2(x * 0.04, z * 0.04, 11) + 0.05 * noise2(x * 0.13, z * 0.13, 5);
    const k = occ(x, z) * tone;
    pos.push(x, y, z);
    col.push(k * (0.92 + 0.1 * soil), k * (0.95 - 0.16 * soil), k * (0.86 - 0.16 * soil));
  };

  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) vertex(x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * j / nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }

  // Horizon rings: concentric rectangles, each edge split like the grid edge it meets.
  const ring = (sx0, sx1, sz0, sz1) => {
    const pts = [];
    for (let i = 0; i < nx; i++) pts.push([sx0 + (sx1 - sx0) * i / nx, sz0]);
    for (let j = 0; j < nz; j++) pts.push([sx1, sz0 + (sz1 - sz0) * j / nz]);
    for (let i = nx; i > 0; i--) pts.push([sx0 + (sx1 - sx0) * i / nx, sz1]);
    for (let j = nz; j > 0; j--) pts.push([sx0, sz0 + (sz1 - sz0) * j / nz]);
    return pts;
  };
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  let prev = null;
  for (let k = 0; k < 14 && hx < horizon; k++) {
    const pts = ring(cx - hx, cx + hx, cz - hz, cz + hz);
    const base = pos.length / 3;
    for (const [x, z] of pts) vertex(x, z, k === 0 ? undefined : g.farY);
    if (prev !== null) {
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = prev + i, b = prev + (i + 1) % n, c = base + i, d = base + (i + 1) % n;
        idx.push(a, b, c, b, d, c);
      }
    }
    prev = base;
    hx *= 1.9; hz *= 1.9;
  }

  return {
    position: new Float32Array(pos), color: new Float32Array(col),
    index: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    farY: g.farY, extent: g.extent, cell,
  };
}
