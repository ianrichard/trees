// Rock faces: where a landform's edge is steep, the height field's slope is replaced on screen by a
// real wall of bedded rock. A height field can't hold a vertical or overhanging face, but a wall
// mesh offset horizontally per vertex can, so ledges and undercuts come for free.
//
// The shape follows how sedimentary bluffs actually weather:
//   beds     horizontal layers 0.3–1.5 m thick, alternating hard and soft. Hard beds stand proud as
//            rounded blocks; soft beds weather back into notches, so ledges and small overhangs form.
//   dip      beds aren't perfectly level: they wave gently along the face.
//   joints   vertical fractures every 1.5–5 m cut the face into columns. Each block (bed × column)
//            has retreated its own amount, joints open into V notches, and now and then a whole
//            block has fallen out, leaving a recess under the bed above it.
//   caprock  the top bed is the thickest and hardest, so it projects over the rim and rounds back.
//   foot     the wall's base sinks below grade, where talus (a rocks group) covers it.
// Everything is seeded from the landform, so the same cliff always comes back.
//
// A landform gets a face automatically where its edge is steep: a drop of at least 2.5 m at a
// slope steeper than about 55°. `params.face: false` turns it off. Its stone is `scope.stone.use`.

import { rng } from './grow.js';
import { noise } from './ground.js';

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const hash = (a, b, seed) => { let n = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ seed; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

/** Seeded bed sequence from the foot up: [{ y0, y1, hard }], the top bed a hard caprock. */
function beds(seed, height) {
  const r = rng(seed ^ 0xbed5), out = [];
  const cap = Math.min(height * 0.3, 1.1 + r() * 0.9);
  let y = 0, hard = r() < 0.5;
  while (y < height - cap - 0.2) {
    // Hard beds are thicker; soft ones are thin partings and shaly layers.
    const t = hard ? 0.55 + r() * 0.95 : 0.25 + r() * 0.45;
    out.push({ y0: y, y1: Math.min(y + t, height - cap), hard: hard ? 0.6 + r() * 0.4 : r() * 0.3 });
    y += t;
    hard = r() < (hard ? 0.35 : 0.8); // mostly alternate, sometimes stack
  }
  out.push({ y0: height - cap, y1: height + 0.6, hard: 1, cap: true });
  return out;
}

/** Joint positions along the face (metres of arc length), seeded. */
function joints(seed, length) {
  const r = rng(seed ^ 0x701e), out = [];
  for (let s = r() * 2; s < length; s += 1.5 + r() * 3.5) out.push({ s, open: 0.35 + r() * 0.75, full: r() < 0.55, id: out.length });
  return out;
}

/**
 * The horizontal offset of the face (metres, + outward) at height u above the foot and arc length
 * s. This is the whole look.
 */
function faceOffset(u, s, H, bedList, jointList, seed) {
  const dip = noise(s * 0.04, 1.3, seed) * 0.35 + noise(s * 0.13, 2.1, seed) * 0.12;
  const v = u + dip;
  let k = bedList.findIndex((b) => v < b.y1);
  if (k < 0) k = bedList.length - 1;
  const bed = bedList[k], t = clamp01((v - bed.y0) / Math.max(0.05, bed.y1 - bed.y0));
  // Column (block) this point is in, and the nearest joint.
  let j = 0;
  while (j < jointList.length && jointList[j].s < s) j++;
  const left = jointList[j - 1], right = jointList[j];
  const block = left ? left.id + 1 : 0;
  const dj = Math.min(left ? s - left.s : 9, right ? right.s - s : 9);
  const near = left && (!right || s - left.s < right.s - s) ? left : right;

  // Bed profile: hard beds bulge as rounded blocks, soft beds notch back.
  // Hard beds: nearly flat faces with chipped, slightly rounded edges, each block tilted a little.
  // Soft beds: a concave notch.
  const tilt = (hash(block, k, seed ^ 0x7) - 0.5) * 0.3;
  let off = bed.hard > 0.5
    ? (bed.hard - 0.5) * 0.7 * Math.pow(Math.sin(Math.PI * t), 0.12) - 0.12 + tilt * (t - 0.5)
    : -0.25 - 0.35 * Math.sin(Math.PI * t) * (1 - bed.hard);
  // Each block retreated its own amount; a few have fallen out entirely.
  const bh = hash(block, k, seed);
  off += (bh - 0.5) * 0.4 * (0.4 + bed.hard);
  if (bh < 0.06 && !bed.cap && bed.hard > 0.5) off -= 0.9;
  // Joints open into V notches, through the bed or the whole face.
  if (near && (near.full || hash(near.id, k, seed ^ 3) < 0.45)) off -= near.open * Math.exp(-Math.pow(dj / 0.32, 2));
  // Caprock projects further and rounds back over its top.
  if (bed.cap) off += 0.35 + 0.25 * hash(block, 99, seed);
  const top = u - (H - 0.55);
  if (top > 0) off -= Math.pow(top / 0.55, 2) * 0.9;
  // Grain: weathering at two scales.
  off += noise(s * 0.45, u * 0.45, seed ^ 0x51) * 0.12 + noise(s * 2.2, u * 2.2, seed ^ 0x77) * 0.06 + noise(s * 5.5, u * 5.5, seed ^ 0x99) * 0.025;
  return off;
}

/** Rim samples where the landform's edge is a cliff: foot and top positions plus outward normal. */
function traceRim(f, heightAt) {
  const N = 900, rows = [];
  const toWorld = (r, th) => {
    const lx = f.a * r * Math.cos(th), lz = f.b * r * Math.sin(th);
    return [f.x + lx * f.cos - lz * f.sin, f.z + lx * f.sin + lz * f.cos];
  };
  for (let i = 0; i < N; i++) {
    const th = i / N * Math.PI * 2;
    // Profile along the ray; the cliff is the steepest stretch, from where the slope steepens past
    // ~20° (top) to where it eases again (foot). Neighbouring hollows and skirts don't matter.
    const prof = [];
    for (let r = 0.5; r < 1.7; r += 0.004) { const [x, z] = toWorld(r, th); prof.push({ r, x, z, h: heightAt(x, z) }); }
    let steepest = 0, gmin = 0;
    const grad = (k) => (prof[k + 1].h - prof[k].h) / (Math.hypot(prof[k + 1].x - prof[k].x, prof[k + 1].z - prof[k].z) || 1e-6);
    for (let k = 0; k < prof.length - 1; k++) { const g = grad(k); if (g < gmin) { gmin = g; steepest = k; } }
    if (gmin > -1.4) { rows.push(null); continue; }
    let kt = steepest, kf = steepest;
    while (kt > 0 && grad(kt - 1) < -0.35) kt--;
    while (kf < prof.length - 2 && grad(kf + 1) < -0.35) kf++;
    kf++;
    const rTop = prof[kt].r, rFoot = prof[kf].r;
    if (prof[kt].h - prof[kf].h < 2.5) { rows.push(null); continue; }
    const T = toWorld(rTop, th), F = toWorld(rFoot, th);
    const run = Math.max(0.05, Math.hypot(F[0] - T[0], F[1] - T[1]));
    rows.push({ T, F, topY: heightAt(T[0], T[1]), footY: heightAt(F[0], F[1]), n: [(F[0] - T[0]) / run, (F[1] - T[1]) / run] });
  }
  // Contiguous runs (wrapping around), each resampled by arc length along the foot line.
  const runs = [];
  let start = rows.findIndex((r) => !r);
  if (start < 0) start = 0;
  let cur = [];
  for (let k = 1; k <= N; k++) {
    const row = rows[(start + k) % N];
    if (row) cur.push(row); else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs.map((run) => {
    const out = [run[0]];
    let acc = 0;
    for (let i = 1; i < run.length; i++) {
      acc += Math.hypot(run[i].F[0] - run[i - 1].F[0], run[i].F[1] - run[i - 1].F[1]);
      if (acc >= 0.3) { out.push(run[i]); acc = 0; }
    }
    return out;
  }).filter((r) => r.length * 0.3 > 3);
}

/** Every cliff face in the scene, as one geometry per stone. */
export function buildCliffs(THREE, ground, { maxCells = 220 } = {}) {
  // Same cell size as buildGroundArrays.
  const e = ground.extent, b = ground.blend;
  const cell = Math.max(0.5, Math.max(e.maxX - e.minX + 2 * b, e.maxZ - e.minZ + 2 * b) / maxCells);
  const byStone = new Map();
  for (const f of ground.forms ?? []) {
    if (f.face === false || f.h < 2.5 || Math.min(f.kx, f.kz) > 0.3) continue;
    const runs = traceRim(f, ground.heightAt);
    for (const [ri, run] of runs.entries()) {
      const seed = (f.seed ^ Math.imul(ri + 1, 0x9e3779b1)) >>> 0;
      const H = run.reduce((m, p) => Math.max(m, p.topY - p.footY), 0);
      const bedList = beds(seed, H), jointList = joints(seed, run.length * 0.3);
      const list = byStone.get(f.stone) ?? { pos: [], grade: [], idx: [] };
      byStone.set(f.stone, list);
      const base = list.pos.length / 3, DY = 0.14;
      const rowsUp = Math.ceil((H + 1.0) / DY) + 1;
      // Smoothed normals along the run, so the face doesn't zigzag with the trace.
      const nrm = run.map((_, i) => {
        let nx = 0, nz = 0;
        for (let d = -4; d <= 4; d++) { const q = run[Math.min(run.length - 1, Math.max(0, i + d))]; nx += q.n[0]; nz += q.n[1]; }
        const m = Math.hypot(nx, nz) || 1; return [nx / m, nz / m];
      });
      for (let i = 0; i < run.length; i++) {
        const p = run[i], [nx, nz] = nrm[i], s = i * 0.3, h = p.topY - p.footY;
        // Near the ends of a run the face tucks into the hill, so no sheet edge shows.
        const endFade = smooth(clamp01(Math.min(i, run.length - 1 - i) * 0.3 / 6));
        // The ground mesh is linear over cells of `cell` metres, so its slope can reach up to one cell
        // past the true foot. The wall stands just beyond that, with its base sunk below grade.
        const wallX = p.F[0] + nx * (0.3 + cell), wallZ = p.F[1] + nz * (0.3 + cell);
        for (let k = 0; k < rowsUp; k++) {
          // Rows span from 0.5 m below the foot to the top; the profile is scaled to this point's height.
          const u = -0.5 + (h + 0.5) * k / (rowsUp - 1);
          const uu = u * H / Math.max(h, 0.5);
          const off = faceOffset(Math.max(0, uu), s, H, bedList, jointList, seed) * endFade - (1 - endFade) * 1.2;
          list.pos.push(wallX + nx * off, p.footY + u, wallZ + nz * off);
          list.grade.push(u);
        }
        // Lip: from the rounded top back over the rim to the plateau, just above it.
        for (const w of [0.45, 1]) {
          const x = wallX + (p.T[0] - wallX) * w - nx * 0.3 * (1 - w), z = wallZ + (p.T[1] - wallZ) * w - nz * 0.3 * (1 - w);
          list.pos.push(x, p.topY + 0.08 - 0.1 * w, z);
          list.grade.push(h + 1);
        }
      }
      const stride = rowsUp + 2;
      // Wind so the face points outward: test one quad's normal against the run's outward normal.
      const P = (v) => list.pos.slice(v * 3, v * 3 + 3);
      const m = Math.floor(run.length / 2), q0 = P(base + m * stride + 2), q1 = P(base + (m + 1) * stride + 2), q2 = P(base + m * stride + 3);
      const e1 = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]], e2 = [q2[0] - q0[0], q2[1] - q0[1], q2[2] - q0[2]];
      const outward = (e1[1] * e2[2] - e1[2] * e2[1]) * nrm[m][0] + (e1[0] * e2[1] - e1[1] * e2[0]) * nrm[m][1] > 0;
      for (let i = 0; i < run.length - 1; i++) for (let k = 0; k < stride - 1; k++) {
        const a = base + i * stride + k, b = a + stride;
        if (outward) list.idx.push(a, b, a + 1, a + 1, b, b + 1);
        else list.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const out = [];
  for (const [stone, l] of byStone) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(l.pos, 3));
    g.setAttribute('aGrade', new THREE.Float32BufferAttribute(l.grade, 1));
    g.setIndex(l.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    out.push({ stone, geometry: g });
  }
  return out;
}
