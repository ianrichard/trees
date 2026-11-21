// One line, a whole place:
//
//   { "use": "outdoors" }                                    a meadow, 220 m square
//   { "use": "outdoors", "terrain": "hill-country" }         mesa with a limestone bluff, creek, live oaks, cedar
//   { "use": "outdoors", "terrain": "highlands", "size": [300, 260], "seed": 3, "trees": 0.6, "relief": 1.3 }
//   { "use": "outdoors", "children": { "house": { "use": "house", "at": [0, 0] } } }
//
// `terrain` is an alias for a whole landscape: its landforms, cover and ecology. Everything it makes is
// ordinary children (landforms, paths, rocks, outcrops) plus one `flora` pass, which grows trees and
// low plants where the finished terrain suits each species: by slope, height in the landscape, wetness
// (hollows and creeks) and grove patches. Nothing is random at view time. The same `seed` always
// gives the same place; change it to get another one.
//
// Authored children are foreground objects. They keep their keys and win over generated ones, and
// generated things (trees, plants, rocks) stay clear of every object's footprint.

import { rng } from './grow.js';

/**
 * Species preferences. slope: [ideal max, hard max] (rise/run). elev: [low, high] band in the
 * landscape's own height range (0 lowest, 1 highest). wet: + likes hollows and creeks, − avoids them.
 */
export const TERRAINS = {
  meadow: {
    label: 'Meadow', cover: 'meadow',
    flora: {
      spacing: 6.5, groves: 0.62,
      trees: [
        { kind: 'oak', w: 1, slope: [0.35, 0.8], elev: [0, 0.85] },
        { kind: 'maple', w: 0.8, slope: [0.4, 0.8], elev: [0, 1] },
        { kind: 'birch', w: 0.7, slope: [0.3, 0.7], elev: [0, 0.6], wet: 1 },
        { kind: 'shrub', w: 0.5, slope: [0.6, 1], elev: [0, 1], edge: true },
      ],
    },
  },
  'hill-country': {
    label: 'Hill Country', cover: 'scrub',
    flora: {
      spacing: 7, groves: 0.68, // savanna: mottes and brakes with open ground between
      trees: [
        { kind: 'liveoak', w: 1.2, slope: [0.15, 0.4], elev: [0, 0.45], wet: 0.4 },
        // Ashe juniper takes everything: uplands, slopes and overgrazed flats.
        { kind: 'juniper', w: 0.85, slope: [0.9, 1.1], elev: [0, 1] },
      ],
      plants: { spacing: 3.2, density: 0.55, kinds: ['pricklypear', 'pricklypear', 'yucca', 'agave', 'sotol'] },
    },
  },
  forest: {
    label: 'Forest', cover: 'meadow',
    flora: {
      spacing: 6, groves: 0.15,
      trees: [
        { kind: 'pine', w: 1, slope: [0.7, 1], elev: [0.45, 1] },
        { kind: 'oak', w: 0.9, slope: [0.4, 0.8], elev: [0, 0.7] },
        { kind: 'maple', w: 0.9, slope: [0.45, 0.8], elev: [0.1, 0.8] },
        { kind: 'birch', w: 0.8, slope: [0.3, 0.7], elev: [0, 0.5], wet: 1 },
        { kind: 'shrub', w: 0.35, slope: [0.6, 1], elev: [0, 1], edge: true },
      ],
    },
  },
  highlands: {
    label: 'Highlands', cover: 'grass',
    flora: {
      spacing: 6.5, groves: 0.45, treeline: 0.72,
      trees: [
        { kind: 'pine', w: 1.3, slope: [0.8, 1.1], elev: [0, 1] },
        { kind: 'birch', w: 0.6, slope: [0.3, 0.6], elev: [0, 0.3], wet: 1 },
        { kind: 'shrub', w: 0.5, slope: [0.7, 1.1], elev: [0.5, 1], edge: true },
      ],
    },
  },
};
export const TERRAIN_NAMES = Object.keys(TERRAINS);

const pair = (v, d) => (Array.isArray(v) ? [v[0] ?? d, v[1] ?? v[0] ?? d] : [v ?? d, v ?? d]);
const r1 = (v) => Math.round(v * 10) / 10;

/** Terrain shapers: (rng, area, relief) → children. Coordinates are relative to the area centre. */
const SHAPE = {
  meadow(r, [W, D], k) {
    const out = {};
    const n = 5 + (r() * 3 | 0);
    for (let i = 0; i < n; i++) out[`hill-${i + 1}`] = { use: 'landform', at: [(r() - 0.5) * W * 0.85, (r() - 0.5) * D * 0.85], turn: r1(r() * 180),
      params: { h: r1((1.5 + r() * 4.5) * k), size: [r1(30 + r() * 60), r1(26 + r() * 50)], soft: r1(0.8 + r() * 0.2), vary: 0.3 } };
    if (r() < 0.65) out.pond = { use: 'landform', at: [(r() - 0.5) * W * 0.5, (r() - 0.5) * D * 0.5], params: { h: -1.2, size: [r1(14 + r() * 10), r1(9 + r() * 6)], vary: 0.35 } };
    out.footpath = { use: 'path', params: { surface: 'dirt', width: 1.2 }, points: wander(r, W, D, 5) };
    return out;
  },
  'hill-country'(r, [W, D], k) {
    const out = {}, turn = r1((r() - 0.5) * 30);
    const mw = W * (0.5 + r() * 0.25), md = 38 + r() * 18, mz = -D * 0.22, mh = (8 + r() * 5) * k;
    out.mesa = { use: 'landform', at: [r1((r() - 0.5) * W * 0.2), r1(mz)], turn, params: { h: r1(mh), size: [r1(mw), r1(md)], soft: [0.3, 0.06], top: 'flat' } };
    // The bluff faces the open ground; its talus lies along the foot, and a creek runs in front.
    // The front edge is local (0, +depth/2); landforms rotate local → world by (lx cos − lz sin, lx sin + lz cos).
    const a = turn * Math.PI / 180, ox = -Math.sin(a), oz = Math.cos(a);
    const mx = out.mesa.at[0], fx = mx + ox * (md / 2 + 4), fz = mz + oz * (md / 2 + 4);
    out.talus = { use: 'rocks', at: [r1(fx), r1(fz)], turn, params: { size: [r1(mw * 0.85), 6], count: Math.round(mw / 2.2), stone: 'limestone', scale: 0.9 } };
    const cz = mz + md / 2 + 16 + r() * 10;
    out.creek = { use: 'landform', at: [0, r1(cz)], turn, params: { h: -1.4, size: [r1(W * 1.1), 7], soft: [1, 0.7] } };
    out['creek-bed'] = { use: 'path', params: { surface: 'gravel', width: 3, vary: 0.4, edge: 0.8 },
      points: Array.from({ length: 6 }, (_, i) => { const x = -W * 0.55 + i * W * 0.22; return [r1(x), r1(cz + x * Math.tan(a) + (r() - 0.5) * 6)]; }) };
    const n = 3 + (r() * 3 | 0);
    for (let i = 0; i < n; i++) out[`knoll-${i + 1}`] = { use: 'landform', at: [r1((r() - 0.5) * W * 0.8), r1(cz + 10 + r() * (D / 2 - cz - 10))], params: { h: r1((1.5 + r() * 2.5) * k), size: r1(24 + r() * 26) } };
    if (r() < 0.4) out['mesa-2'] = { use: 'landform', at: [r1((r() < 0.5 ? -1 : 1) * W * 0.38), r1(mz - 10)], turn: r1(turn + 20), params: { h: r1(mh * 0.8), size: [r1(W * 0.3), 34], soft: [0.35, 0.08], top: 'flat' } };
    return out;
  },
  forest(r, [W, D], k) {
    const out = {};
    const n = 6 + (r() * 4 | 0);
    for (let i = 0; i < n; i++) out[`hill-${i + 1}`] = { use: 'landform', at: [r1((r() - 0.5) * W * 0.9), r1((r() - 0.5) * D * 0.9)], turn: r1(r() * 180),
      params: { h: r1((3 + r() * 6) * k), size: [r1(36 + r() * 60), r1(30 + r() * 50)], vary: 0.35 } };
    out.stream = { use: 'landform', at: [0, r1((r() - 0.5) * D * 0.4)], turn: r1((r() - 0.5) * 50), params: { h: -1.6, size: [r1(W * 1.1), 8], soft: [1, 0.8], vary: 0.4 } };
    out.trail = { use: 'path', params: { surface: 'dirt', width: 1.1, vary: 0.3 }, points: wander(r, W, D, 6) };
    return out;
  },
  highlands(r, [W, D], k) {
    const out = {};
    const n = 2 + (r() * 2 | 0);
    for (let i = 0; i < n; i++) {
      const at = [r1((r() - 0.5) * W * 0.6), r1(-D * 0.15 - r() * D * 0.25)], turn = r1((r() - 0.5) * 60);
      // Broad ridges with 30–40° flanks: grassy and wooded, not rock domes.
      out[`ridge-${i + 1}`] = { use: 'landform', at, turn, params: { h: r1((16 + r() * 12) * k), size: [r1(110 + r() * 70), r1(70 + r() * 30)], soft: [1, 0.9], vary: 0.3 } };
      if (i === 0) {
        out.crag = { use: 'outcrop', at: [r1(at[0] + (r() - 0.5) * 30), r1(at[1] + 14)], turn, params: { h: 4, size: [9, 6], strata: 0.25 }, scope: { stone: { use: 'granite' } } };
        out.scree = { use: 'rocks', at: [r1(at[0]), r1(at[1] + 24)], params: { size: [40, 16], count: 30, stone: 'granite', scale: 0.8 } };
      }
    }
    out.tarn = { use: 'landform', at: [r1((r() - 0.5) * W * 0.4), r1(D * 0.15)], params: { h: -1.8, size: [r1(18 + r() * 12), r1(12 + r() * 8)], vary: 0.35 } };
    const m = 3 + (r() * 3 | 0);
    for (let i = 0; i < m; i++) out[`swell-${i + 1}`] = { use: 'landform', at: [r1((r() - 0.5) * W * 0.85), r1(D * (0.05 + r() * 0.4))], params: { h: r1((2 + r() * 4) * k), size: r1(30 + r() * 40) } };
    out.track = { use: 'path', params: { surface: 'gravel', width: 1.4 }, points: wander(r, W, D, 5) };
    return out;
  },
};

/** A meandering line across the area, roughly front to back. */
function wander(r, W, D, n) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([r1((r() - 0.5) * W * 0.5 + (i % 2 ? 8 : -8)), r1(D * 0.48 - i * D * 0.9 / (n - 1))]);
  return pts;
}

/** `{ use: "outdoors", ... }` → an ordinary ground document. */
export function expandLandscape(doc) {
  const name = TERRAINS[doc.terrain] ? doc.terrain : 'meadow';
  const T = TERRAINS[name];
  const size = pair(doc.size, 220), at = doc.at ?? [0, 0], seed = (doc.seed ?? 1) >>> 0;
  const r = rng(Math.imul(seed + 1, 0x9e3779b1) ^ name.length * 7919);
  const shaped = SHAPE[name](r, size, doc.relief ?? 1);
  const children = {};
  for (const [key, c] of Object.entries(shaped)) {
    const move = (p) => [r1(p[0] + at[0]), r1(p[1] + at[1])];
    children[key] = { ...c, ...(c.at ? { at: move(c.at) } : {}), ...(c.points ? { points: c.points.map(move) } : {}) };
  }
  children.flora = { use: 'flora', at, params: { size, terrain: name, density: doc.trees ?? 1, plants: doc.plants ?? 1, seed } };
  // Authored children are foreground: same keys replace generated ones.
  Object.assign(children, doc.children ?? {});
  return { ground: { cover: doc.cover ?? T.cover, margin: 10, children } };
}
