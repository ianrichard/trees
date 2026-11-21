// A scene document → everything the renderer draws.
//
//   [ ...children ]                               shorthand: the ground's children
//   { "ground": { "cover": "grass", "children": { key: child, ... } } }
//
// Children: tree, landform, rock, outcrop, path, house, and two seeded groups that keep configs short:
//   { "use": "woods", "at": [x, z], "params": { "size": [40, 24], "kind": "pine", "density": 1 } }
//   { "use": "rocks", "at": [x, z], "params": { "size": 12, "count": 14, "stone": "granite" } }
// A group expands to ordinary children, seeded by its position, so it is stable and editable like
// any authored list. Woods stay off paths, house footprints, rocks, cliffs and water.

import { rng, seedFromPosition } from './grow.js';
import { KINDS } from './species.js';
import { PLANTS, resolvePlant } from './plants.js';
import { resolveGround, resolvePath, pathNearest, noise } from './ground.js';
import { expandLandscape, TERRAINS } from './landscape.js';
import { growStand } from './ecology.js';

const USES = ['tree', 'landform', 'rock', 'outcrop', 'path', 'house', 'woods', 'rocks', 'plant', 'scrub', 'flora'];
const pair = (v, d) => (Array.isArray(v) ? [v[0] ?? d, v[1] ?? v[0] ?? d] : [v ?? d, v ?? d]);
const round = (v) => Math.round(v * 10) / 10;

export function sceneOf(doc) {
  if (Array.isArray(doc)) return { ground: { children: Object.fromEntries(doc.map((c, i) => [`${c.use ?? 'tree'}-${i + 1}`, c])) } };
  if (doc && doc.use === 'outdoors') return expandLandscape(doc);
  if (doc && doc.use) return { ground: { children: { [doc.use]: doc } } };
  return { ground: { children: {}, ...(doc?.ground ?? {}) } };
}

function inFootprint(x, z, cx, cz, sx, sz, turn) {
  const a = (turn ?? 0) * Math.PI / 180, dx = x - cx, dz = z - cz;
  const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);
  return Math.hypot(lx / (sx / 2), lz / (sz / 2));
}

/** Resolve a document: expand groups, build the ground, list trees. Throws on unknown uses. */
export function resolveScene(doc) {
  const scene = sceneOf(doc);
  const children = scene.ground.children ?? {};
  for (const [key, c] of Object.entries(children)) {
    if (!USES.includes(c.use ?? 'tree')) throw new Error(`"${key}": unknown use "${c.use}". Try ${USES.join(', ')}`);
  }
  const entries = Object.entries(children);
  const paths2d = entries.filter(([, c]) => c.use === 'path').map(([key, c]) => resolvePath({ key, ...c }));
  const houses = entries.filter(([, c]) => c.use === 'house').map(([, c]) => ({ at: c.at ?? [0, 0], size: pair(c.params?.size, 10) }));
  const nearPath = (x, z, pad) => paths2d.some((P) => { const q = pathNearest(P, x, z); return q && q.d < P.half + pad; });
  const nearHouse = (x, z, pad) => houses.some((h) => Math.abs(x - h.at[0]) < h.size[0] / 2 + pad && Math.abs(z - h.at[1]) < h.size[1] / 2 + pad);
  // Foreground objects: anything placed with a position that isn't ground shape or vegetation claims its
  // footprint, so generated trees, plants and rocks stay clear of it. Houses today; any Alian object
  // with an \`at\` and a size tomorrow. Size comes from params.size (a diameter or [x, z]), else 2 m.
  const VEG = new Set(['tree', 'plant', 'woods', 'scrub', 'flora', 'rocks', 'landform', 'path']);
  const claims = entries.filter(([, c]) => c.at && !VEG.has(c.use ?? 'tree')).map(([, c]) => {
    const [sx, sz] = pair(c.params?.size, c.use === 'rock' ? 1.2 : 2);
    return { x: c.at[0], z: c.at[1], r: Math.hypot(sx, sz) / 2 };
  });
  const claimed = (x, z, pad) => claims.some((q) => Math.hypot(x - q.x, z - q.z) < q.r + pad);

  // Rock fields expand first: their rocks raise skirts in the ground.
  const expanded = {};
  for (const [key, c] of entries) {
    if (c.use !== 'rocks') { expanded[key] = c; continue; }
    const p = c.params ?? {}, [cx, cz] = c.at ?? [0, 0], [sx, sz] = pair(p.size, 12);
    const r = rng(Number.isFinite(c.seed) ? c.seed : seedFromPosition(cx, cz));
    const count = p.count ?? Math.round(sx * sz / 12);
    let made = 0;
    for (let i = 0; i < count * 4 && made < count; i++) {
      const x = cx + (r() - 0.5) * sx, z = cz + (r() - 0.5) * sz;
      if (inFootprint(x, z, cx, cz, sx, sz, c.turn) > 1 || nearPath(x, z, 0.8) || nearHouse(x, z, 1.5)) continue;
      const k = (p.scale ?? 1) * (0.5 + Math.pow(r(), 2.2) * 1.6);
      expanded[`${key}/${++made}`] = { use: 'rock', at: [round(x), round(z)], params: { size: round(1.2 * k * 100) / 100, h: round(0.7 * k * 100) / 100 },
        ...(p.stone ? { scope: { stone: { use: p.stone } } } : {}) };
    }
  }
  const full = { ...scene, ground: { ...scene.ground, children: expanded } };
  const ground = resolveGround(full);

  // Trees: authored ones, then woods.
  const trees = [];
  for (const c of Object.values(expanded)) if ((c.use ?? 'tree') === 'tree') trees.push(c);
  for (const [key, c] of entries) {
    if (c.use !== 'woods') continue;
    const p = c.params ?? {}, [cx, cz] = c.at ?? [0, 0], [sx, sz] = pair(p.size, 30);
    const kinds = [].concat(p.kind ?? ['oak', 'maple', 'birch']).filter((k) => KINDS[k]);
    const r = rng(Number.isFinite(c.seed) ? c.seed : seedFromPosition(cx, cz) ^ 0x77);
    // Jittered grid at the crown spacing of the kinds, thinned toward the edge of the footprint.
    const spacing = Math.max(...kinds.map((k) => KINDS[k].width)) * 0.62 / Math.sqrt(p.density ?? 1);
    for (let gx = -sx / 2; gx < sx / 2; gx += spacing) for (let gz = -sz / 2; gz < sz / 2; gz += spacing) {
      const a = (c.turn ?? 0) * Math.PI / 180, ox = gx + (r() - 0.5) * spacing * 0.9, oz = gz + (r() - 0.5) * spacing * 0.9;
      const x = cx + ox * Math.cos(a) - oz * Math.sin(a), z = cz + ox * Math.sin(a) + oz * Math.cos(a);
      const f = inFootprint(x, z, cx, cz, sx, sz, c.turn);
      const kind = kinds[(r() * kinds.length) | 0];
      if (f > 1 || r() < Math.pow(f, 3) * 0.8) continue;
      if (nearPath(x, z, 1.2 + KINDS[kind].width * 0.2) || nearHouse(x, z, 3)) continue;
      const s = ground.surfaceAt(x, z);
      if (s.blocked || s.apron > 0.3) continue;
      const y = ground.heightAt(x, z), e = 1;
      const slope = Math.hypot(ground.heightAt(x + e, z) - ground.heightAt(x - e, z), ground.heightAt(x, z + e) - ground.heightAt(x, z - e)) / 2;
      if (slope > 0.9 || y < ground.farY - 0.4) continue;
      trees.push({ use: 'tree', ...(kind === 'oak' ? {} : { kind }), at: [round(x), round(z)] });
    }
  }
  // Low plants: authored ones, then scrub fields (a seeded scatter, like woods, at plant spacing).
  const plants = [];
  for (const c of Object.values(expanded)) if (c.use === 'plant') plants.push(resolvePlant(c));
  for (const [, c] of entries) {
    if (c.use !== 'scrub') continue;
    const p = c.params ?? {}, [cx, cz] = c.at ?? [0, 0], [sx, sz] = pair(p.size, 30);
    const kinds = [].concat(p.kind ?? ['pricklypear', 'pricklypear', 'yucca', 'agave', 'sotol']).filter((k) => PLANTS[k]);
    const r = rng(Number.isFinite(c.seed) ? c.seed : seedFromPosition(cx, cz) ^ 0x5c5c);
    // Plants per 100 m², in clumps: each seed point drops a few plants close together.
    const count = Math.round(sx * sz / 100 * 2.2 * (p.density ?? 1));
    for (let i = 0; i < count; i++) {
      const hx = (r() - 0.5) * sx, hz = (r() - 0.5) * sz, kind = kinds[(r() * kinds.length) | 0];
      const clump = 1 + Math.floor(r() * 3);
      for (let k = 0; k < clump; k++) {
        const a = (c.turn ?? 0) * Math.PI / 180, ox = hx + (r() - 0.5) * 3, oz = hz + (r() - 0.5) * 3;
        const x = cx + ox * Math.cos(a) - oz * Math.sin(a), z = cz + ox * Math.sin(a) + oz * Math.cos(a);
        const f = inFootprint(x, z, cx, cz, sx, sz, c.turn);
        if (f > 1 || r() < Math.pow(f, 3) * 0.7) continue;
        if (nearPath(x, z, 0.8) || nearHouse(x, z, 2)) continue;
        const s = ground.surfaceAt(x, z);
        if (s.blocked || s.apron > 0.5 || ground.heightAt(x, z) < ground.farY - 0.4) continue;
        if (Math.hypot(ground.heightAt(x + 0.7, z) - ground.heightAt(x - 0.7, z), ground.heightAt(x, z + 0.7) - ground.heightAt(x, z - 0.7)) / 1.4 > 0.8) continue;
        plants.push(resolvePlant({ at: [round(x), round(z)], params: { kind } }));
      }
    }
  }
  // Flora: trees and low plants grow where the finished terrain suits each species.
  for (const [, c] of entries) if (c.use === 'flora') grow(c);
  function grow(c) {
    const p = c.params ?? {}, T = TERRAINS[p.terrain] ?? TERRAINS.meadow, F = T.flora;
    const [cx, cz] = c.at ?? [0, 0], [W, D] = pair(p.size, 220), seed = (p.seed ?? 1) >>> 0;
    const h = ground.heightAt;
    // The landscape's own height range, so "upland" means high for this place.
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) { const y = h(cx + (i / 24 - 0.5) * W, cz + (j / 24 - 0.5) * D); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const span = Math.max(1, hi - lo);
    const band = (v, [a, b]) => (v <= a ? 1 : v >= b ? 0 : 1 - (v - a) / (b - a));
    const inside = (v, [a, b]) => Math.min(1, Math.max(0, Math.min((v - a + 0.12) / 0.12, (b + 0.12 - v) / 0.12)));
    const r = rng(seed ^ 0xf10a);
    const grove = (x, z) => noise(x * 0.022, z * 0.022, seed ^ 0x6a) * 0.65 + noise(x * 0.07, z * 0.07, seed ^ 0x6b) * 0.35;
    const site = (x, z) => {
      const y = h(x, z), e = 1.2;
      const slope = Math.hypot(h(x + e, z) - h(x - e, z), h(x, z + e) - h(x, z - e)) / (2 * e);
      let ring = 0;
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ring += h(x + Math.cos(a) * 9, z + Math.sin(a) * 9); }
      const hollow = (ring / 6 - y);   // + in hollows
      const creek = paths2d.some((P) => P.surface === 1 && P.half > 1 && (pathNearest(P, x, z)?.d ?? 99) < 9);
      return { y, slope, elev: (y - lo) / span, wet: Math.min(1, Math.max(0, hollow / 1.2 + (creek ? 0.7 : 0))), hollow };
    };
    const edge = (x, z) => Math.max(Math.abs(x - cx) / (W / 2), Math.abs(z - cz) / (D / 2));
    // Trees: grown, not scattered (lib/ecology.js). Suitability is this terrain's species preferences,
    // on a 2 m cache since seeds probe the same spots over and over.
    const siteCache = new Map();
    const siteAt = (x, z) => {
      const k = Math.round(x / 2) * 92821 + Math.round(z / 2);
      let q = siteCache.get(k);
      if (!q) siteCache.set(k, (q = site(Math.round(x / 2) * 2, Math.round(z / 2) * 2)));
      return q;
    };
    const defs = Object.fromEntries(F.trees.map((d) => [d.kind, d]));
    const wMax = Math.max(...F.trees.map((d) => d.w));
    const suit = (kind, x, z) => {
      const d = defs[kind], q = siteAt(x, z);
      if (q.slope > 1.15 || q.hollow > 0.9 || q.y < ground.farY - 0.4) return 0;
      if (F.treeline && q.elev > F.treeline && kind !== 'shrub') return 0;
      // Soft edge of the area: stands thin out toward its border.
      const ed = edge(x, z);
      const border = ed > 0.85 ? Math.max(0, 1 - (ed - 0.85) / 0.15) : 1;
      return Math.min(1, d.w / wMax * band(q.slope, d.slope) * inside(q.elev, d.elev) * Math.max(0, 1 + (d.wet ?? 0) * (q.wet - 0.3) * 1.5)) * border;
    };
    const blocked = (x, z) => {
      if (claimed(x, z, 3) || nearPath(x, z, 1.6) || nearHouse(x, z, 3)) return true;
      const s = ground.surfaceAt(x, z);
      return s.blocked || s.apron > 0.3;
    };
    const stand = growStand({ bounds: [cx - W / 2, cz - D / 2, cx + W / 2, cz + D / 2], kinds: F.trees.map((d) => d.kind), suit, blocked,
      density: p.density ?? 1, capacity: W * D / (F.spacing * F.spacing) * (1 - F.groves), seed });
    for (const t of stand) {
      if (t.size < 0.14) continue; // seedlings: below the grass
      trees.push({ use: 'tree', at: [round(t.x), round(t.z)], params: { kind: t.kind, h: round(KINDS[t.kind].height * (0.22 + 0.72 * Math.min(1.2, t.size))) } });
    }
    // Low plants (dry terrains): grown the same way, so they clump and colonise open, bare ground.
    if (F.plants && (p.plants ?? 1) > 0) {
      const P = F.plants;
      const psuit = (kind, x, z) => {
        const q = siteAt(x, z), s2 = ground.surfaceAt(x, z);
        if (q.slope > 0.7 || q.hollow > 0.6 || edge(x, z) > 0.98) return 0;
        // Open, bare ground; not under a tree crown.
        if (trees.some((t) => Math.abs(t.at[0] - x) < 3 && Math.abs(t.at[1] - z) < 3)) return 0;
        return Math.min(1, s2.bare * 1.4);
      };
      const pblocked = (x, z) => {
        if (claimed(x, z, 1.5) || nearPath(x, z, 0.8) || nearHouse(x, z, 2)) return true;
        const s2 = ground.surfaceAt(x, z);
        return s2.blocked || s2.apron > 0.5;
      };
      const colony = growStand({ bounds: [cx - W / 2, cz - D / 2, cx + W / 2, cz + D / 2], kinds: [...new Set(P.kinds)], suit: psuit, blocked: pblocked,
        density: p.plants ?? 1, capacity: W * D / (P.spacing * P.spacing) * P.density * 0.3, generations: 10, seed: seed ^ 0x9a });
      for (const t of colony) if (t.size > 0.2) plants.push(resolvePlant({ at: [round(t.x), round(t.z)], params: { kind: t.kind, h: round(PLANTS[t.kind].height * (0.45 + 0.55 * Math.min(1.1, t.size)) * 100) / 100 } }));
    }
  }
  return { scene: full, ground, trees, plants };
}
