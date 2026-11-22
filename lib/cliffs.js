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

/**
 * Seeded bed sequence from the foot up. Hill Country limestone is bimodal: massive beds 0.9–2.2 m
 * thick, separated by packets of thin platy beds (5–25 cm each) that weather back into deep notches.
 * The notches' shadow lines are most of the look. The top bed is a massive caprock.
 */
function beds(seed, height) {
  const r = rng(seed ^ 0xbed5), out = [];
  const cap = Math.min(height * 0.3, 1.2 + r() * 0.9);
  let y = 0, massive = r() < 0.6;
  while (y < height - cap - 0.15) {
    if (massive) {
      const t = 0.9 + r() * 1.3;
      out.push({ y0: y, y1: Math.min(y + t, height - cap), massive: true, hard: 0.8 + r() * 0.2 });
      y += t;
    } else {
      // A packet of thin plates. Each plate juts or recedes a little, so the notch is stepped.
      const n = 2 + (r() * 4 | 0), deep = 0.45 + r() * 0.7;
      for (let i = 0; i < n && y < height - cap - 0.05; i++) {
        const t = 0.06 + r() * 0.18;
        out.push({ y0: y, y1: Math.min(y + t, height - cap), massive: false, hard: 0.2 + r() * 0.4, deep, plate: (r() - 0.5) * 0.18 });
        y += t;
      }
    }
    massive = !massive || r() < 0.2;
  }
  out.push({ y0: height - cap, y1: height + 0.6, massive: true, hard: 1, cap: true });
  return out;
}

/**
 * Plan-view setbacks: major joints every 8–20 m. Between them a whole section of face has retreated
 * its own amount, so from above the cliff steps in and out instead of following one smooth line.
 */
function sections(seed, length) {
  const r = rng(seed ^ 0x5ec7), out = [];
  for (let s = 0; s < length + 20; s += 8 + r() * 12) out.push({ s, off: -1.1 + r() * 1.4 });
  return out;
}
function sectionOffset(list, s) {
  let i = 0;
  while (i < list.length - 1 && list[i + 1].s < s) i++;
  const a = list[i], b = list[i + 1] ?? a, w = 0.9;
  // Hold each section's offset, and step to the next over about a metre at the major joint.
  const t = clamp01((s - (b.s - w)) / w);
  return a.off + (b.off - a.off) * smooth(t);
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
function faceOffset(u, s, H, bedList, jointList, seed, dipSlope, weathered = false) {
  // Beds dip gently along the face and wave a little.
  const dip = s * dipSlope + noise(s * 0.04, 1.3, seed) * 0.3 + noise(s * 0.13, 2.1, seed) * 0.08;
  const v = u + dip;
  let k = bedList.findIndex((b) => v < b.y1);
  if (k < 0) k = bedList.length - 1;
  const bed = bedList[k], t = clamp01((v - bed.y0) / Math.max(0.03, bed.y1 - bed.y0));
  let j = 0;
  while (j < jointList.length && jointList[j].s < s) j++;
  const left = jointList[j - 1], right = jointList[j];
  const block = left ? left.id + 1 : 0;
  const dj = Math.min(left ? s - left.s : 9, right ? right.s - s : 9);
  const near = left && (!right || s - left.s < right.s - s) ? left : right;
  const bh = hash(block, k, seed);
  if (weathered) {
    let off = 0;
    if (bed.massive) {
      // Solution pockets: scattered round hollows dissolved into massive faces, not slots.
      const pk = noise(s * 1.5, v * 1.5, seed ^ 0x3c) * 0.7 + noise(s * 3.4, v * 3.4, seed ^ 0x3d) * 0.3;
      if (pk > 0.45) off -= Math.min(0.35, (pk - 0.45) * 2.2) * Math.sqrt(Math.sin(Math.PI * t));
    }
    if (bed.cap) off += 0.25 + 0.3 * hash(block, 99, seed);
    const top = u - (H - 0.55);
    if (top > 0) off -= Math.pow(top / 0.55, 2) * 0.9;
    return off + noise(s * 0.45, u * 0.45, seed ^ 0x51) * 0.06 + noise(s * 3.2, u * 3.2, seed ^ 0x77) * 0.03;
  }
  let off;
  if (bed.massive) {
    // Massive bed: a broad, nearly flat face with crisp corners, worn back only over the last few
    // centimetres (a wide rounded bull-nose read as stacked pillows). Each block stands at its own
    // depth and leans a little, so the face jogs in and out along the cliff.
    const edge = Math.min(1, Math.min(t, 1 - t) / 0.06 * (1 + (hash(block, k, seed ^ 0x4e) - 0.5) * 0.8));
    const lean = (hash(block, k, seed ^ 0x2f) - 0.5) * 0.35;
    off = 0.2 + 0.4 * bed.hard * (1 - (1 - edge) * (1 - edge)) + lean * (t - 0.5) + (bh - 0.5) * 0.55;
    // Solution pockets: scattered round hollows dissolved into the face, not slots.
    const pk = noise(s * 1.5, v * 1.5, seed ^ 0x3c) * 0.7 + noise(s * 3.4, v * 3.4, seed ^ 0x3d) * 0.3;
    if (pk > 0.42) off -= Math.min(0.45, (pk - 0.42) * 2.6) * Math.sqrt(Math.sin(Math.PI * t));
    // Massive beds part only along the main joints, as wide rounded clefts.
    if (near && near.full) off -= near.open * 0.9 * Math.exp(-Math.pow(dj / 0.45, 2));
    if (bh < 0.04 && !bed.cap) off -= 0.8; // a block that has fallen out
  } else {
    // Thin plates: the packet sits deep, each plate stepping in or out, broken into small blocks.
    off = -bed.deep + bed.plate + (hash(block * 7 + 3, k, seed) - 0.5) * 0.14;
    if (near) off -= 0.15 * Math.exp(-Math.pow(dj / 0.2, 2));
  }
  // Caprock projects further and rounds back over its top.
  if (bed.cap) off += 0.3 + 0.3 * hash(block, 99, seed);
  const top = u - (H - 0.55);
  if (top > 0) off -= Math.pow(top / 0.55, 2) * 0.9;
  // Grain: weathering at two scales.
  off += noise(s * 0.45, u * 0.45, seed ^ 0x51) * 0.08 + noise(s * 3.2, u * 3.2, seed ^ 0x77) * 0.035;
  return off;
}

/**
 * The face, weathered rather than drawn. A grid over the face (columns along the run, rows up the
 * profile) records how far each cell has retreated into the hill, R, and the process runs for a
 * fixed number of steps:
 *   weathering  each cell retreats at its rock's erodibility: thin platy beds fast, massive beds
 *               slowly, faster near joints where water gets in, slow under the talus at the foot.
 *   shelter     rain falls at about 45°, so a cell recessed under rock above weathers less. Notches
 *               deepen and then self-limit, as real ones do.
 *   collapse    when a block (one bed between two joints) overhangs its support by more than its
 *               thickness and hardness can hold, the whole block falls and the face behind it is
 *               fresh. Blocky steps and ledges emerge instead of being drawn.
 *   rounding    corners soften by slow diffusion, more on soft rock.
 * It also returns what the process leaves on the colour: each cell's exposure age (fresh breaks are
 * cream, old faces weather grey and grow lichen) and drip streaks running down from every lip.
 */
function weatherFace(seed, cols, rows, H, bedList, jointList, dipSlope) {
  const N = cols * rows, R = new Float32Array(N), age = new Float32Array(N), erod = new Float32Array(N);
  const bedOf = new Int16Array(N), key = new Int32Array(N);
  const dyRow = (H + 0.5) / (rows - 1), vAt = (k) => -0.5 + dyRow * k;
  for (let i = 0; i < cols; i++) {
    const s = i * 0.3;
    const dip = s * dipSlope + noise(s * 0.04, 1.3, seed) * 0.3 + noise(s * 0.13, 2.1, seed) * 0.08;
    let j = 0;
    while (j < jointList.length && jointList[j].s < s) j++;
    const left = jointList[j - 1], right = jointList[j], block = left ? left.id + 1 : 0;
    const dl = left ? s - left.s : 9, dr = right ? right.s - s : 9, near = dl < dr ? left : right, dj = Math.min(dl, dr);
    let b = 0;
    for (let k = 0; k < rows; k++) {
      const idx = i * rows + k, v = vAt(k) + dip;
      while (b < bedList.length - 1 && v >= bedList[b].y1) b++;
      while (b > 0 && v < bedList[b].y0) b--;
      const bed = bedList[b];
      let e = bed.massive ? 0.1 + 0.3 * (1 - bed.hard) : 0.8 + 0.9 * (1 - bed.hard);
      e *= 0.7 + 0.6 * hash(block, b, seed);
      if (near) e *= 1 + (near.full ? 2.5 : 1) * near.open * Math.exp(-((dj / 0.4) ** 2));
      if (vAt(k) < 0) e *= 0.25; // below grade, under talus
      erod[idx] = e; bedOf[idx] = b; key[idx] = block * 512 + b;
    }
  }
  const STEPS = 72, dt = 0.03, over = new Map(), support = new Float32Array(N);
  for (let step = 0; step < STEPS; step++) {
    for (let i = 0; i < cols; i++) {
      // Weathering under a 45° rain shelter: shelter is the furthest-out rock above, relaxing one row
      // of retreat per row of height.
      let shelter = -1;
      for (let k = rows - 1; k >= 0; k--) {
        const idx = i * rows + k;
        const recess = shelter < 0 ? 0 : Math.max(0, R[idx] - shelter);
        R[idx] += dt * erod[idx] * Math.exp(-recess / 0.6);
        shelter = shelter < 0 ? R[idx] : Math.min(shelter + dyRow, R[idx]);
        age[idx] += 1;
      }
    }
    if (step % 3 === 2) {
      // Collapse: each block's worst overhang beyond the rock beneath it.
      over.clear();
      for (let i = 0; i < cols; i++) {
        let k0 = 0;
        for (let k = 1; k <= rows; k++) {
          if (k < rows && bedOf[i * rows + k] === bedOf[i * rows + k0]) continue;
          const sup = k0 > 0 ? R[i * rows + k0 - 1] : Infinity;
          for (let q = k0; q < k; q++) {
            support[i * rows + q] = sup;
            if (sup === Infinity) continue;
            const o = sup - R[i * rows + q], kk = key[i * rows + q];
            if (o > (over.get(kk) ?? 0)) over.set(kk, o);
          }
          k0 = k;
        }
      }
      for (let idx = 0; idx < N; idx++) {
        const o = over.get(key[idx]);
        if (!o) continue;
        const bed = bedList[bedOf[idx]], thick = bed.y1 - bed.y0;
        if (o > 0.22 + 0.55 * thick * bed.hard && support[idx] !== Infinity && R[idx] < support[idx] - 0.04) { R[idx] = support[idx] - 0.04; age[idx] = 0; }
      }
    }
    if (step % 2 === 1) {
      // Rounding: corners soften along the profile, more on soft rock.
      for (let i = 0; i < cols; i++) for (let k = 1; k < rows - 1; k++) {
        const idx = i * rows + k, lap = R[idx - 1] + R[idx + 1] - 2 * R[idx];
        R[idx] += 0.18 * Math.min(1, erod[idx] * 1.5) * lap;
      }
    }
  }
  // Drip streaks: water leaving every lip runs down the face below it; the rim drains too. Streaks are
  // narrow, so each column has its own share.
  const streak = new Float32Array(N);
  for (let i = 0; i < cols; i++) {
    const share = Math.max(0, noise(i * 0.3 * 2.2, 7.7, seed ^ 0x5d) - 0.62) * 2.6 + Math.max(0, noise(i * 0.3 * 6.0, 3.3, seed ^ 0x5e) - 0.7) * 2;
    let wet = 0.35;
    for (let k = rows - 1; k >= 0; k--) {
      const idx = i * rows + k;
      if (k < rows - 1) { const lip = R[idx] - R[idx + 1]; if (lip > 0.08) wet += lip * 0.8; }
      wet *= 0.975;
      streak[idx] = Math.min(1, wet * share);
    }
  }
  for (let idx = 0; idx < N; idx++) age[idx] = Math.min(1, age[idx] / STEPS);
  // The whole face retreats as it weathers, but where it stands is the landform's choice. Keep the
  // local relief (notches, ledges, fallen blocks) and most of the large-scale lean goes: each
  // column loses 85% of its 5 m running mean's departure from the column average.
  const win = Math.max(2, Math.round(2.5 / dyRow)), lp = new Float32Array(rows);
  for (let i = 0; i < cols; i++) {
    let mean = 0;
    for (let k = 0; k < rows; k++) {
      let a = 0, n = 0;
      for (let q = Math.max(0, k - win); q <= Math.min(rows - 1, k + win); q++) { a += R[i * rows + q]; n++; }
      lp[k] = a / n; mean += lp[k];
    }
    mean /= rows;
    for (let k = 0; k < rows; k++) R[i * rows + k] -= (lp[k] - mean) * 0.85 + mean;
  }
  return { R, age, streak };
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
  }).filter((r) => r.length * 0.3 > 12); // a real cliff, not a few steep metres (those stood up as chimneys)
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
      const bedList = beds(seed, H), jointList = joints(seed, run.length * 0.3), sectList = sections(seed, run.length * 0.3);
      const list = byStone.get(f.stone) ?? { pos: [], grade: [], ao: [], age: [], streak: [], idx: [] };
      byStone.set(f.stone, list);
      const base = list.pos.length / 3, DY = 0.08; // fine enough for 6 cm plates and crisp notches
      const dipSlope = (rng(seed ^ 0xd1)() - 0.5) * 0.07; // ±2° of dip along the face
      const rowsUp = Math.ceil((H + 1.0) / DY) + 1;
      // Smoothed normals along the run, so the face doesn't zigzag with the trace.
      const wf = weatherFace(seed, run.length, rowsUp, H, bedList, jointList, dipSlope);
      const nrm = run.map((_, i) => {
        let nx = 0, nz = 0;
        for (let d = -4; d <= 4; d++) { const q = run[Math.min(run.length - 1, Math.max(0, i + d))]; nx += q.n[0]; nz += q.n[1]; }
        const m = Math.hypot(nx, nz) || 1; return [nx / m, nz / m];
      });
      for (let i = 0; i < run.length; i++) {
        const p = run[i], [nx, nz] = nrm[i], s = i * 0.3, h = p.topY - p.footY;
        const endFade = smooth(clamp01(Math.min(i, run.length - 1 - i) * 0.3 / 6));
        const hw = h; // full height to the ends: lowering it stretched the lip into a stone ramp
        // The ground mesh is linear over cells of `cell` metres, so its slope can reach up to one cell
        // past the true foot. The wall stands just beyond that, with its base sunk below grade.
        const wallX = p.F[0] + nx * (0.3 + cell), wallZ = p.F[1] + nz * (0.3 + cell);
        // Ends: the face dies into the hillside. Where the run stops, the hill beside it is gentler
        // than the cliff, so a full-height end would stand proud of it as a cut block. Instead each
        // end column's rows go back along the ground profile behind the wall to where the hill
        // covers them, and over the last 6 m the face blends from that buried line to full relief.
        // Buried means below the true surface by enough to clear the ground mesh's linear cells too.
        let buried = null;
        const sink = 0.4 + cell * 0.6;
        if (endFade < 1) {
          const reach = Math.hypot(p.T[0] - wallX, p.T[1] - wallZ) + 4, prof = [];
          for (let d = 0; d <= reach; d += 0.2) prof.push(ground.heightAt(wallX - nx * d, wallZ - nz * d));
          buried = (y) => {
            let j = prof.findIndex((g) => g >= y + sink);
            if (j < 0) j = prof.reduce((m, g, i) => (g > prof[m] ? i : m), 0);
            return [-j * 0.2, Math.min(y, prof[j] - sink)];
          };
        }
        for (let k = 0; k < rowsUp; k++) {
          // Rows span from 0.5 m below the foot to the top; the profile is scaled to this point's height.
          const u = -0.5 + (hw + 0.5) * k / (rowsUp - 1);
          const uu = u * H / Math.max(hw, 0.5);
          const cellI = i * rowsUp + k;
          const raw = 0.45 - wf.R[cellI] + faceOffset(Math.max(0, uu), s, H, bedList, jointList, seed, dipSlope, true);
          let off = raw + sectionOffset(sectList, s), y = p.footY + u;
          if (buried) {
            const [bo, by] = buried(y);
            off = bo + (off - bo) * endFade; y = by + (y - by) * endFade;
          }
          list.pos.push(wallX + nx * off, y, wallZ + nz * off);
          list.grade.push(u);
          // Occlusion: recessed rock (notches, pockets, clefts) gets little sky. Deep is dark.
          list.ao.push(Math.min(1, Math.max(0.3, 0.55 + (raw + 0.6) * 0.6)));
          list.age.push(wf.age[cellI]); list.streak.push(wf.streak[cellI]);
        }
        // Lip: from the rounded top back over the rim to the plateau, just above it.
        // Where the face is fading, the lip starts from the faded top, not the full wall line, or it
        // would fold out past the face as a thin fin.
        const lb = buried ? buried(p.footY + hw)[0] * (1 - endFade) : 0, lx = wallX + nx * lb, lz = wallZ + nz * lb;
        for (const w of [0.45, 1]) {
          const x = lx + (p.T[0] - lx) * w - nx * 0.3 * (1 - w), z = lz + (p.T[1] - lz) * w - nz * 0.3 * (1 - w);
          const ly = p.footY + hw + (h - hw) * w + 0.08 - 0.1 * w, gy = buried ? ground.heightAt(x, z) - sink : ly;
          list.pos.push(x, gy + (ly - gy) * endFade, z);
          list.grade.push(h + 1); list.ao.push(0.95); list.age.push(1); list.streak.push(0);
        }
        // Back skin: straight down from the rim into the hill. Together with the front, the lip and
        // the end caps this closes the cliff into a solid, so no view can see behind or through it.
        list.pos.push(p.T[0], p.footY - 0.8, p.T[1]);
        list.grade.push(-1); list.ao.push(0.4); list.age.push(1); list.streak.push(0);
      }
      const stride = rowsUp + 3;
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
      // End caps: fan each end column's profile from its buried back corner.
      for (const [i, flip] of [[0, outward], [run.length - 1, !outward]]) {
        const c = base + i * stride, bb = c + stride - 1;
        for (let k = 0; k < stride - 2; k++) flip ? list.idx.push(bb, c + k + 1, c + k) : list.idx.push(bb, c + k, c + k + 1);
      }
    }
  }
  const out = [];
  for (const [stone, l] of byStone) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(l.pos, 3));
    g.setAttribute('aGrade', new THREE.Float32BufferAttribute(l.grade, 1));
    // Colour carries the process: r = sky occlusion, g = exposure age (0 fresh break, 1 old face),
    // b = drip streak. The stone shader reads them under STONE_PROCESS.
    g.setAttribute('color', new THREE.Float32BufferAttribute(l.ao.flatMap((a, i) => [a, l.age[i], l.streak[i]]), 3));
    g.setIndex(l.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    out.push({ stone, geometry: g });
  }
  return out;
}
