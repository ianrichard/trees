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
//
// Height is built in role order, never authoring order:
//   1 landforms   2 rock skirts   3 paths (level across their width)   4 house pads (cut to the floor)

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

export const noise = noise2;

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


/* ---------------------------------------------------------------- rocks (their footprint on the ground) */

export const ROCK_DEFAULTS = {
  rock: { size: 1.2, h: 0.7, bury: 0.3, strata: 0, skirt: 0.6, stone: 'granite' },
  outcrop: { size: [5, 2], h: 1.8, bury: 0.5, strata: 0.6, skirt: 0.6, stone: 'limestone' },
};

export function resolveRock(entry) {
  const d = ROCK_DEFAULTS[entry.use], p = { ...d, ...(entry.params ?? {}) };
  const [x, z] = entry.at ?? [0, 0];
  const [sx, sz] = pair(p.size, 1);
  const seed = Number.isFinite(entry.seed) ? entry.seed >>> 0 : seedFromPosition(x, z);
  const r = rng(seed ^ 0x51ed);
  const turn = Number.isFinite(entry.turn) ? entry.turn * Math.PI / 180 : r() * Math.PI * 2;
  // A boulder's footprint varies a little; an outcrop keeps the size it was given.
  const k = entry.params?.size === undefined ? 0.75 + r() * 0.6 : 1;
  return {
    use: entry.use, x, z, sx: sx * k, sz: sz * k, h: p.h * (entry.params?.h === undefined ? 0.8 + r() * 0.5 : 1) * Math.sqrt(k),
    bury: p.bury, strata: p.strata, skirt: p.skirt, seed, turn, cos: Math.cos(turn), sin: Math.sin(turn),
    stone: entry.scope?.stone?.use ?? p.stone, y: 0,
  };
}

/** Normalised ellipse distance from a rock's center (1 at its footprint edge). */
function rockDistance(k, x, z) {
  const dx = x - k.x, dz = z - k.z;
  return Math.hypot((dx * k.cos + dz * k.sin) / (k.sx / 2), (-dx * k.sin + dz * k.cos) / (k.sz / 2));
}

/* ---------------------------------------------------------------- paths */

const SURFACES = ['dirt', 'gravel', 'pavement', 'flagstone'];

export function resolvePath(entry, index) {
  const p = { width: 1.2, vary: 0.15, surface: 'dirt', edge: 0.3, ...entry, ...(entry.params ?? {}) };
  const pts = (p.points ?? []).filter((q) => Array.isArray(q) && q.length >= 2);
  if (pts.length < 2) throw new Error(`Path "${entry.key ?? index}" needs at least two points`);
  // Catmull–Rom through the authored points, sampled every half metre.
  const xs = [], zs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5));
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      xs.push(cr(p0[0], p1[0], p2[0], p3[0])); zs.push(cr(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  xs.push(pts.at(-1)[0]); zs.push(pts.at(-1)[1]);
  const len = [0];
  for (let i = 1; i < xs.length; i++) len.push(len[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  const seed = seedFromPosition(pts[0][0], pts[0][1]);
  const half = p.width / 2, reach = half * (1 + p.vary) + 1.4;
  // Segment hash for nearest-point queries.
  const cell = 4, hash = new Map();
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = Math.floor((Math.min(xs[i], xs[i + 1]) - reach) / cell), x1 = Math.floor((Math.max(xs[i], xs[i + 1]) + reach) / cell);
    const z0 = Math.floor((Math.min(zs[i], zs[i + 1]) - reach) / cell), z1 = Math.floor((Math.max(zs[i], zs[i + 1]) + reach) / cell);
    for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) {
      const key = a * 73856093 ^ b * 19349663;
      let list = hash.get(key); if (!list) hash.set(key, (list = [])); list.push(i);
    }
  }
  const surface = Math.max(0, SURFACES.indexOf(p.surface));
  return { xs, zs, len, half, vary: p.vary, edge: Math.max(0.02, p.edge), surface, seed, cell, hash, reach, profile: null, total: len.at(-1) };
}

/** Distance from (x, z) to a path's centreline and the arc length there, or null if far away. */
export function pathNearest(P, x, z) {
  const list = P.hash.get(Math.floor(x / P.cell) * 73856093 ^ Math.floor(z / P.cell) * 19349663);
  if (!list) return null;
  let best = Infinity, at = 0;
  for (const i of list) {
    const ax = P.xs[i], az = P.zs[i], bx = P.xs[i + 1] - ax, bz = P.zs[i + 1] - az;
    const l2 = bx * bx + bz * bz || 1e-9;
    const t = clamp01(((x - ax) * bx + (z - az) * bz) / l2);
    const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
    if (d < best) { best = d; at = P.len[i] + (P.len[i + 1] - P.len[i]) * t; }
  }
  return best <= P.reach ? { d: best, s: at } : null;
}

function halfWidth(P, s) { return P.half * (1 + P.vary * noise2(s * 0.12, 0.5, P.seed)); }

/** Arc-length → leveled height on the centreline. */
function profileAt(P, s) {
  const f = clamp01(s / (P.total || 1)) * (P.profile.length - 1), i = Math.floor(f);
  const a = P.profile[i], b = P.profile[Math.min(i + 1, P.profile.length - 1)];
  return a + (b - a) * (f - i);
}

/* ---------------------------------------------------------------- houses (pads) */

export function resolveHouse(entry) {
  const p = { size: [10, 7.5], reveal: 0.15, grade: 1.5, ...(entry.params ?? {}) };
  const [x, z] = entry.at ?? [0, 0];
  const [w, d] = pair(p.size, 10);
  const turn = (entry.turn ?? 0) * Math.PI / 180;
  return { x, z, w, d, reveal: p.reveal, grade: p.grade, turn, cos: Math.cos(turn), sin: Math.sin(turn), floor: 0, low: 0, params: p };
}
function houseLocal(H, x, z) {
  const dx = x - H.x, dz = z - H.z;
  return [dx * H.cos + dz * H.sin, -dx * H.sin + dz * H.cos];
}
/** Signed distance to a house footprint (negative inside). */
function houseDistance(H, x, z) {
  const [lx, lz] = houseLocal(H, x, z);
  const qx = Math.abs(lx) - H.w / 2, qz = Math.abs(lz) - H.d / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/* ---------------------------------------------------------------- the ground */

/**
 * Resolve the authored ground: its height function, surface mask, extent and far field.
 * `scene` is the whole document ({ ground: { cover, children } }). Children other than the ones
 * that shape the ground (trees, woods) are ignored here.
 */
export function resolveGround(scene = {}) {
  const ground = scene.ground ?? {};
  const children = Object.entries(ground.children ?? {}).map(([key, c]) => ({ key, ...c }));
  const forms = children.filter((c) => c.use === 'landform').map(resolveLandform);
  const rocks = children.filter((c) => c.use === 'rock' || c.use === 'outcrop').map(resolveRock);
  const paths = children.filter((c) => c.use === 'path').map(resolvePath);
  const houses = children.filter((c) => c.use === 'house').map(resolveHouse);

  // Authored detail covers the children plus a margin; beyond it the ground goes to the horizon.
  let minX = -30, maxX = 30, minZ = -30, maxZ = 30;
  const grow = (x, z, reach) => { minX = Math.min(minX, x - reach); maxX = Math.max(maxX, x + reach); minZ = Math.min(minZ, z - reach); maxZ = Math.max(maxZ, z + reach); };
  for (const c of children) {
    const [x, z] = c.at ?? [0, 0];
    const size = pair(c.params?.size, c.use === 'landform' ? 10 : 12);
    grow(x, z, Math.max(...size) * 0.8);
    for (const q of c.points ?? c.params?.points ?? []) grow(q[0], q[1], 4);
  }
  const margin = ground.margin ?? 30;
  const extent = { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
  const blend = 40;

  // Role 1: landforms.
  const shaped = (x, z) => {
    let up = 0, down = 0;
    for (const f of forms) {
      const v = landformHeight(f, x, z);
      if (v > 0) up = smax(up, v, Math.min(up, v) * 0.6 + 0.05);
      else if (v < 0) down = smin(down, v, Math.min(-down, -v) * 0.6 + 0.05);
    }
    return up + down;
  };
  for (const k of rocks) k.y = shaped(k.x, k.z);
  // Rock hash: a point only ever tests the few rocks whose skirt can reach it.
  const RC = 6, rockHash = new Map();
  for (const k of rocks) {
    const reach = Math.max(k.sx, k.sz) * 0.5 * 1.7;
    for (let a = Math.floor((k.x - reach) / RC); a <= Math.floor((k.x + reach) / RC); a++)
      for (let b = Math.floor((k.z - reach) / RC); b <= Math.floor((k.z + reach) / RC); b++) {
        const key = a * 92821 + b; let l = rockHash.get(key); if (!l) rockHash.set(key, (l = [])); l.push(k);
      }
  }
  const rocksNear = (x, z) => rockHash.get(Math.floor(x / RC) * 92821 + Math.floor(z / RC)) ?? [];
  // Role 2: the ground rises a little to meet each rock's base.
  const skirted = (x, z) => {
    let h = shaped(x, z);
    for (const k of rocksNear(x, z)) {
      const r = rockDistance(k, x, z);
      if (r < 1.6) h += k.skirt * 0.22 * Math.min(k.h, 1.6) * (1 - smoothstep(clamp01((r - 0.6) / 1.0)));
    }
    return h;
  };
  // Role 3: paths level across their width, following a smoothed centreline profile.
  for (const P of paths) {
    const raw = P.xs.map((x, i) => skirted(x, P.zs[i]));
    let prof = raw;
    for (let pass = 0; pass < 3; pass++) {
      prof = prof.map((_, i) => {
        let s = 0, n = 0;
        for (let j = Math.max(0, i - 6); j <= Math.min(prof.length - 1, i + 6); j++) { s += prof[j]; n++; }
        return s / n;
      });
    }
    P.profile = prof;
  }
  const pathed = (x, z) => {
    let h = skirted(x, z);
    for (const P of paths) {
      const q = pathNearest(P, x, z);
      if (!q) continue;
      const hw = halfWidth(P, q.s);
      const w = 1 - smoothstep(clamp01((q.d - hw) / 1.2));
      if (w > 0) h += (profileAt(P, q.s) - 0.03 - h) * w;
    }
    return h;
  };
  // Role 4: a house floor sits at the highest grade under it plus its reveal; the ground is cut
  // down to just below the floor around it, never filled, so downhill the foundation shows.
  for (const H of houses) {
    let hi = -Infinity;
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const lx = (i / 6 - 0.5) * H.w, lz = (j / 6 - 0.5) * H.d;
      hi = Math.max(hi, pathed(H.x + lx * H.cos - lz * H.sin, H.z + lx * H.sin + lz * H.cos));
    }
    H.floor = hi + H.reveal;
  }
  const local = (x, z) => {
    let h = pathed(x, z);
    for (const H of houses) {
      const sd = houseDistance(H, x, z);
      if (sd > H.grade) continue;
      const w = 1 - smoothstep(clamp01(sd / H.grade));
      h += (Math.min(h, H.floor - H.reveal) - h) * w;
    }
    return h;
  };
  for (const H of houses) {
    let lo = Infinity;
    for (let i = 0; i <= 12; i++) for (const side of [0, 1, 2, 3]) {
      const t = i / 12 - 0.5;
      const [lx, lz] = side === 0 ? [t * H.w, -H.d / 2] : side === 1 ? [t * H.w, H.d / 2] : side === 2 ? [-H.w / 2, t * H.d] : [H.w / 2, t * H.d];
      lo = Math.min(lo, local(H.x + lx * H.cos - lz * H.sin, H.z + lx * H.sin + lz * H.cos));
    }
    H.low = lo;
  }

  // The far field is the lowest height along the authored edge, carried out to the horizon. A pond
  // inside the scene is a pond; it does not sink the whole horizon.
  let farY = 0;
  if (forms.length) {
    farY = Infinity;
    const n = 64, { minX: ax, maxX: bx, minZ: az, maxZ: bz } = extent;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      farY = Math.min(farY, shaped(ax + (bx - ax) * u, az), shaped(ax + (bx - ax) * u, bz), shaped(ax, az + (bz - az) * u), shaped(bx, az + (bz - az) * u));
    }
  }

  const outside = (x, z) => smoothstep(clamp01(Math.max(extent.minX - x, x - extent.maxX, extent.minZ - z, z - extent.maxZ, 0) / blend));
  const heightAt = (x, z) => {
    const w = outside(x, z);
    return w >= 1 ? farY : local(x, z) * (1 - w) + farY * w;
  };

  /** Surface mask at a point: path paint weight and surface, soil (rock bases), and blocked (house). */
  const surfaceAt = (x, z) => {
    let path = 0, surface = 0, soil = 0, blocked = false;
    for (const P of paths) {
      const q = pathNearest(P, x, z);
      if (!q) continue;
      const hw = halfWidth(P, q.s) * (1 + 0.12 * noise2(x * 1.7, z * 1.7, P.seed ^ 77));
      const w = 1 - smoothstep(clamp01((q.d - hw + P.edge / 2) / P.edge));
      if (w > path) { path = w; surface = P.surface; }
    }
    for (const k of rocksNear(x, z)) {
      const r = rockDistance(k, x, z);
      if (r < 1.35) soil = Math.max(soil, 1 - smoothstep(clamp01((r - 0.75) / 0.6)));
      if (r < 0.85) blocked = true;
    }
    for (const H of houses) if (houseDistance(H, x, z) < 0.3) blocked = true;
    return { path, surface, soil, blocked };
  };

  return { heightAt, surfaceAt, extent, farY, blend, cover: ground.cover ?? 'grass', landforms: forms.length, rocks, paths, houses };
}

/* ---------------------------------------------------------------- mesh */

/**
 * Ground mesh as typed arrays: a fine grid over the authored extent plus its blend band, then
 * flat rings out to the horizon with the same edge resolution (no T-junction cracks), and a surface
 * mask texture (R path, G surface, B soil) over the authored extent.
 * `occluders` [{x, z, r}] darken the grade under crowns, which is the contact shadow.
 */
export function buildGroundArrays(scene, { occluders = [], maxCells = 220, horizon = 4000, maskSize = 1024 } = {}) {
  const g = resolveGround(scene);
  const { extent: e, blend } = g;
  const x0 = e.minX - blend, x1 = e.maxX + blend, z0 = e.minZ - blend, z1 = e.maxZ + blend;
  const span = Math.max(x1 - x0, z1 - z0);
  const cell = Math.max(0.5, span / maxCells);
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
  const pos = [], col = [], idx = [];

  // Occluder hash so the contact shadow stays cheap with hundreds of trees.
  const oh = new Map(), oc = 8;
  for (const o of occluders) {
    for (let a = Math.floor((o.x - o.r) / oc); a <= Math.floor((o.x + o.r) / oc); a++)
      for (let b = Math.floor((o.z - o.r) / oc); b <= Math.floor((o.z + o.r) / oc); b++) {
        const k = a * 92821 + b; let l = oh.get(k); if (!l) oh.set(k, (l = [])); l.push(o);
      }
  }
  const occ = (x, z) => {
    let k = 1;
    for (const o of oh.get(Math.floor(x / oc) * 92821 + Math.floor(z / oc)) ?? []) {
      const d = Math.hypot(x - o.x, z - o.z) / o.r;
      if (d < 1) k *= 1 - 0.45 * (1 - smoothstep(d)) ** 1.5;
    }
    return k;
  };
  const shade = (x, z, slope) => {
    // Steep ground shows soil; slow tonal patches hide the grass texture's tiling.
    const soil = smoothstep(clamp01((slope - 0.7) / 0.7)) * 0.8;
    const tone = 0.9 + 0.12 * noise2(x * 0.04, z * 0.04, 11) + 0.05 * noise2(x * 0.13, z * 0.13, 5);
    const k = occ(x, z) * tone;
    col.push(k * (0.92 + 0.1 * soil), k * (0.95 - 0.16 * soil), k * (0.86 - 0.16 * soil));
  };

  const hs = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) hs[j * (nx + 1) + i] = g.heightAt(x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * j / nz);
  const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + dx * i, z = z0 + dz * j, k = j * (nx + 1) + i;
    const gx = (hs[j * (nx + 1) + Math.min(i + 1, nx)] - hs[j * (nx + 1) + Math.max(i - 1, 0)]) / (2 * dx);
    const gz = (hs[Math.min(j + 1, nz) * (nx + 1) + i] - hs[Math.max(j - 1, 0) * (nx + 1) + i]) / (2 * dz);
    pos.push(x, hs[k], z);
    shade(x, z, Math.hypot(gx, gz));
  }
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
  let hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, prev = null;
  for (let k = 0; k < 14 && hx < horizon; k++) {
    const pts = ring(cx - hx, cx + hx, cz - hz, cz + hz);
    const base = pos.length / 3;
    for (const [x, z] of pts) { pos.push(x, k === 0 ? g.heightAt(x, z) : g.farY, z); shade(x, z, 0); }
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

  // Surface mask over the authored extent: paths and soil are painted per fragment from this.
  const mw = e.maxX - e.minX, md = e.maxZ - e.minZ;
  const texel = Math.max(0.12, Math.max(mw, md) / maskSize);
  const mx = Math.ceil(mw / texel), mz = Math.ceil(md / texel);
  const mask = new Uint8Array(mx * mz * 4);
  const any = g.paths.length || g.rocks.length;
  if (any) for (let j = 0; j < mz; j++) for (let i = 0; i < mx; i++) {
    const s = g.surfaceAt(e.minX + (i + 0.5) * texel, e.minZ + (j + 0.5) * texel), o = (j * mx + i) * 4;
    mask[o] = s.path * 255; mask[o + 1] = s.surface * 85; mask[o + 2] = s.soil * 255; mask[o + 3] = 255;
  }

  return {
    position: new Float32Array(pos), color: new Float32Array(col),
    index: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    mask, maskSize: [mx, mz], maskBounds: [e.minX, e.minZ, mx * texel, mz * texel],
    farY: g.farY, extent: g.extent, cell,
  };
}
