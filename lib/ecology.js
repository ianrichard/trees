// Stands grow; they aren't painted. A small individual-based simulation, run once per place:
//
//   founders     a few first trees settle on the best-suited sites
//   dispersal    every mature tree drops seeds at its species' distances (an exponential kernel: most
//                land near the parent, a few travel far, the way jay-cached acorns, wind-blown
//                samaras and bird-carried juniper berries do)
//   clonal       some species also sprout from roots right around themselves (live oak mottes)
//   establish    a seed takes only if the site suits its species and there is light: under a bigger
//                crown only shade-tolerant species get started
//   grow, compete, die   trees grow each generation; overtopped trees grow slowly and often die, so
//                crowded stands thin themselves; old trees die of age
//
// What emerges is what real stands show: clumped groves with soft, uneven edges, many young trees
// and few large ones, old trees at grove centres and saplings at the advancing edge, pioneers in
// the open and tolerant species underneath. It is seeded, so the same place grows the same stand.

import { rng } from './grow.js';

/**
 * Life history per kind. disperse: mean seed distance (m). clonal: [chance per generation, distance].
 * shade: tolerance 0..1. grow: size gained per generation in full light (size 1 = full grown).
 * mature: generations before seeding. life: generations to old age. crown: crown radius at size 1 (m).
 */
export const TRAITS = {
  // One generation is roughly 12–15 years. Sizes reach 1 (full grown) in about 6–9 generations.
  oak: { disperse: 14, shade: 0.45, grow: 0.13, mature: 3, life: 16, seeds: 3, crown: 4.8 },
  maple: { disperse: 24, shade: 0.85, grow: 0.14, mature: 2, life: 12, seeds: 3, crown: 4.2 },
  birch: { disperse: 42, shade: 0.1, grow: 0.24, mature: 1, life: 6, seeds: 5, crown: 2.8 },
  pine: { disperse: 30, shade: 0.25, grow: 0.15, mature: 2, life: 11, seeds: 3, crown: 3 },
  shrub: { disperse: 12, shade: 0.55, grow: 0.4, mature: 1, life: 6, seeds: 8, crown: 1.1, edge: true }, // bird-sown, prolific at edges
  liveoak: { disperse: 9, shade: 0.5, grow: 0.1, mature: 3, life: 22, seeds: 2, crown: 7, clonal: [0.6, 6] },
  // Low plants spread mostly clonally: dropped pads root (prickly pear), offsets ring the parent
  // (agave pups, yucca), so they grow in clumps and colonies.
  pricklypear: { disperse: 8, shade: 0.4, grow: 0.35, mature: 1, life: 12, seeds: 1, crown: 0.8, clonal: [0.8, 1.3] },
  yucca: { disperse: 14, shade: 0.3, grow: 0.3, mature: 2, life: 14, seeds: 1, crown: 0.7, clonal: [0.4, 0.9] },
  agave: { disperse: 20, shade: 0.2, grow: 0.3, mature: 3, life: 10, seeds: 1, crown: 0.8, clonal: [0.7, 1] },
  sotol: { disperse: 12, shade: 0.3, grow: 0.3, mature: 2, life: 14, seeds: 2, crown: 0.75 },
  juniper: { disperse: 30, shade: 0.35, grow: 0.15, mature: 2, life: 10, seeds: 3, crown: 2.3 },
};

/**
 * @param {object} o
 *   bounds [x0, z0, x1, z1]; kinds: list of kinds allowed here;
 *   suit(kind, x, z) → 0..1 site suitability (terrain, wetness, slope; 0 = cannot grow);
 *   blocked(x, z) → true where nothing may grow (objects, paths, rock);
 *   density (1 = natural), generations, seed.
 * @returns [{ kind, x, z, size, age }]
 */
export function growStand({ bounds, kinds, suit, blocked, density = 1, capacity = Infinity, generations = 14, seed = 1 }) {
  const r = rng(seed ^ 0xec01);
  const [x0, z0, x1, z1] = bounds, W = x1 - x0, D = z1 - z0;
  const CELL = 10, grid = new Map();
  const key = (x, z) => Math.floor(x / CELL) * 73856093 ^ Math.floor(z / CELL);
  let trees = [];
  const add = (t) => { trees.push(t); const k = key(t.x, t.z); (grid.get(k) ?? grid.set(k, []).get(k)).push(t); };
  const near = (x, z, rad) => {
    const out = [];
    for (let i = Math.floor((x - rad) / CELL); i <= Math.floor((x + rad) / CELL); i++)
      for (let j = Math.floor((z - rad) / CELL); j <= Math.floor((z + rad) / CELL); j++)
        for (const t of grid.get(i * 73856093 ^ j) ?? []) if (t.alive && (t.x - x) ** 2 + (t.z - z) ** 2 < rad * rad) out.push(t);
    return out;
  };
  const crown = (t) => TRAITS[t.kind].crown * (0.3 + 0.7 * Math.min(1, t.size));
  const inside = (x, z) => x > x0 && x < x1 && z > z0 && z < z1;

  // Light at a point for a newcomer: 1 in the open, falling under and beside bigger crowns.
  const light = (x, z, self) => {
    let l = 1, edge = 0;
    for (const n of near(x, z, 9)) {
      if (n === self) continue;
      const d = Math.hypot(n.x - x, n.z - z), R = crown(n);
      if (d < R * 0.85) l *= 0.25 + 0.15 * (d / R);           // under the crown
      else if (d < R * 1.6) { l *= 0.9; edge = 1; }            // at its edge: partial shade
    }
    return { l, edge };
  };

  // Try to establish one seedling of `kind` at (x, z).
  const establish = (kind, x, z) => {
    if (!inside(x, z) || blocked(x, z)) return false;
    const T = TRAITS[kind], s = suit(kind, x, z);
    if (s <= 0 || r() > s * s * Math.min(1.5, density)) return false;
    // Too close to any trunk: no room.
    for (const n of near(x, z, 2.2)) if (Math.hypot(n.x - x, n.z - z) < 0.9 + crown(n) * 0.25) return false;
    const { l, edge } = light(x, z, null);
    // Shade-tolerant species start under canopy; pioneers need open sky. Edge species like the fringe.
    const p = l + (1 - l) * T.shade * 0.7;
    if (r() > p * (T.edge ? (edge ? 1.6 : 0.55) : 1)) return false;
    add({ kind, x, z, size: 0.08 + r() * 0.06, age: 0, alive: true });
    return true;
  };

  // Founders: sample candidate sites, keep the best-suited, a few per hectare.
  const founders = Math.max(3, Math.round(Math.min(capacity, W * D / 30) / 25 * Math.min(2, density)));
  for (let i = 0, made = 0; i < founders * 30 && made < founders; i++) {
    const x = x0 + r() * W, z = z0 + r() * D, kind = kinds[made % kinds.length]; // every species gets a foothold
    if (establish(kind, x, z)) { const t = trees.at(-1); t.size = 0.5 + r() * 0.5; t.age = 3 + (r() * 6 | 0); made++; }
  }

  // Carrying capacity: how many established trees this land holds (parkland holds few, forest many).
  // Near it, fewer seedlings take, as in a closed stand where only gaps regenerate.
  const cap = Math.min(capacity, W * D / 30) * density;
  for (let g = 0; g < generations; g++) {
    const living = trees.filter((t) => t.alive);
    const room = Math.max(0, 1 - living.length / cap);
    // Reproduce.
    for (const t of living) {
      const T = TRAITS[t.kind];
      if (t.age < T.mature || r() > room * 1.5) continue;
      const n = Math.round(T.seeds * Math.min(1, t.size) * (0.6 + r() * 0.8));
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2, d = -Math.log(1 - r() * 0.999) * T.disperse;
        establish(t.kind, t.x + Math.cos(a) * d, t.z + Math.sin(a) * d);
      }
      if (T.clonal && r() < T.clonal[0]) {
        const a = r() * Math.PI * 2, d = T.clonal[1] * (0.5 + r());
        establish(t.kind, t.x + Math.cos(a) * d, t.z + Math.sin(a) * d);
      }
    }
    // Grow, compete, die.
    for (const t of trees) {
      if (!t.alive) continue;
      const T = TRAITS[t.kind];
      let over = 0;
      for (const n of near(t.x, t.z, 9)) {
        if (n === t || n.size <= t.size) continue;
        const d = Math.hypot(n.x - t.x, n.z - t.z), R = crown(n) + crown(t) * 0.5;
        if (d < R) over += (1 - d / R);
      }
      const lightShare = Math.max(0.05, 1 - over);
      // Growth slows as a tree nears full size (it approaches 1.2 but never quite gets there).
      t.size += T.grow * (lightShare + (1 - lightShare) * T.shade * 0.5) * (0.8 + r() * 0.4) * Math.max(0.05, (1.2 - t.size) / 1.2) * 1.6;
      t.size = Math.min(t.size, 1.25);
      t.age++;
      const die = 0.02 + (1 - lightShare) * (1 - T.shade) * 0.35 + (t.age > T.life ? 0.3 : 0);
      if (r() < die) t.alive = false;
    }
  }
  return trees.filter((t) => t.alive);
}
