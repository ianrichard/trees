// Skeleton → two BufferGeometries per level of detail: bark tubes and foliage cards.
// THREE is injected (as Alian's renderer does), so this file has no import path to manage.

import { KINDS } from './species.js';
import { rng } from './grow.js';

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/**
 * Sky visibility baked per vertex: march from a point toward the sky through the crown's own
 * leaf density (a coarse voxel grid of leaf area) and attenuate Beer–Lambert style. Clumps shade
 * the clumps under them, the interior goes dark, and the outer shell stays bright.
 */
function skyOcclusion(sk, spec) {
  if (sk._occ) return sk._occ;
  const cell = Math.max(0.12, spec.leaf.size * 0.7), inv = 1 / cell;
  const grid = new Map(), key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  const area = spec.leaf.size * spec.leaf.size * 0.5;
  for (const l of sk.leaves) {
    const k = key(Math.floor(l.x * inv), Math.floor(l.y * inv), Math.floor(l.z * inv));
    grid.set(k, (grid.get(k) || 0) + area);
  }
  const [cx, , cz] = sk.crown.center, reach = Math.max(...sk.crown.radius) * 2.2;
  const dirs = [[0, 1, 0], [0.6, 0.8, 0], [-0.6, 0.8, 0], [0, 0.8, 0.6], [0, 0.8, -0.6], [0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]];
  const extinction = 0.9 / (cell * cell);
  const at = (x, y, z) => grid.get(key(Math.floor(x * inv), Math.floor(y * inv), Math.floor(z * inv))) || 0;
  sk._occ = (x, y, z) => {
    let vis = 0, wsum = 0;
    // Tilt the hemisphere outward so edge leaves see the open sky beside the crown.
    let ox = x - cx, oz = z - cz; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
    for (const d of dirs) {
      let dx = d[0] + ox * 0.5, dy = d[1], dz = d[2] + oz * 0.5;
      const m = Math.hypot(dx, dy, dz); dx /= m; dy /= m; dz /= m;
      let tau = 0;
      for (let t = cell; t < reach; t += cell) tau += at(x + dx * t, y + dy * t, z + dz * t);
      const w = 0.5 + dy;
      vis += Math.exp(-tau * extinction * cell) * w; wsum += w;
    }
    return vis / wsum;
  };
  return sk._occ;
}

function crownOcclusion(sk, spec, x, y, z) {
  const vis = skyOcclusion(sk, spec)(x, y, z);
  return { ao: 0.18 + 0.82 * Math.pow(vis, 0.7) };
}

/* ---------------------------------------------------------------- bark */

function barkGeometry(THREE, sk, spec, { minRadius, ringStep, segScale }) {
  const n = sk.count, P = sk.pos, R = sk.radius;
  const kids = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) if (sk.parent[i] >= 0) kids[sk.parent[i]].push(i);
  const main = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = -1;
    for (const c of kids[i]) if (best < 0 || R[c] > R[best]) best = c;
    main[i] = best;
  }
  // Chains follow the thickest child; every other child starts its own chain at its parent.
  const chains = [];
  const starts = [];
  for (let i = 0; i < n; i++) if (sk.parent[i] < 0 || main[sk.parent[i]] !== i) starts.push(i);
  for (const s of starts) {
    if (R[s] < minRadius) continue;
    const pts = [];
    const p = sk.parent[s];
    if (p >= 0) pts.push({ i: p, r: R[s] * 0.95 });
    let k = s, step = 0;
    while (k >= 0 && R[k] >= minRadius * 0.6) {
      if (step++ % ringStep === 0 || main[k] < 0) pts.push({ i: k, r: R[k] });
      k = main[k];
    }
    if (pts.length >= 2) chains.push({ pts, root: p < 0 });
  }

  const pos = [], nor = [], uv = [], col = [], idx = [];
  const tile = spec.bark.tile, flareH = Math.max(spec.trunkRadius * 3.2, 0.25);
  const t = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3(), prevT = new THREE.Vector3();
  const tmp = new THREE.Vector3(), q = new THREE.Quaternion();
  const lobe = rng((sk.count * 2654435761) >>> 0)() * 6.28;

  for (const { pts, root } of chains) {
    const r0 = pts[0].r;
    const seg = Math.max(3, Math.min(12, Math.round((r0 > 0.12 ? 12 : r0 > 0.05 ? 8 : r0 > 0.02 ? 5 : 3) * segScale)));
    const base = pos.length / 3;
    let along = 0;
    // Texture wraps the limb at true scale. Whole repeats on thick limbs keep the seam closed; thin
    // limbs take a fraction of a tile instead of one tile magnified around a twig.
    const wrap = 2 * Math.PI * r0 / tile, around = wrap >= 1 ? Math.round(wrap) : wrap;
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j].i, ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const b = pts[Math.min(j + 1, pts.length - 1)].i, pb = pts[Math.max(j - 1, 0)].i;
      t.set(P[b * 3] - P[pb * 3], P[b * 3 + 1] - P[pb * 3 + 1], P[b * 3 + 2] - P[pb * 3 + 2]).normalize();
      if (j === 0) {
        nrm.set(Math.abs(t.y) > 0.9 ? 1 : 0, Math.abs(t.y) > 0.9 ? 0 : 1, 0).cross(t).normalize();
      } else {
        // Parallel transport keeps rings from twisting along a limb.
        q.setFromUnitVectors(prevT, t); nrm.applyQuaternion(q).normalize();
        along += Math.hypot(ax - P[pts[j - 1].i * 3], ay - P[pts[j - 1].i * 3 + 1], az - P[pts[j - 1].i * 3 + 2]);
      }
      prevT.copy(t);
      bin.crossVectors(t, nrm).normalize();
      let r = pts[j].r;
      if (j === pts.length - 1 && pts.length > 2) r *= 0.5;
      const flare = root ? spec.flare * Math.pow(1 - smooth(0, flareH, ay), 2) : 0;
      const { ao } = crownOcclusion(sk, spec, ax, ay, az);
      const ground = 0.55 + 0.45 * smooth(0, 0.9, ay);
      // Limbs inside the crown sit in its shade: let occlusion take them most of the way down.
      const shade = Math.min(1, (0.2 + 0.8 * ao) * ground);
      for (let s = 0; s <= seg; s++) {
        const th = s / seg * Math.PI * 2, c = Math.cos(th), si = Math.sin(th);
        const rr = r * (1 + flare * (1 + 0.35 * Math.sin(th * 5 + lobe)));
        tmp.copy(nrm).multiplyScalar(c).addScaledVector(bin, si);
        pos.push(ax + tmp.x * rr, ay + tmp.y * rr, az + tmp.z * rr);
        nor.push(tmp.x, tmp.y, tmp.z);
        uv.push(s / seg * around, along / tile);
        col.push(shade, shade, shade);
      }
      if (j > 0) {
        const r1 = base + (j - 1) * (seg + 1), r2 = base + j * (seg + 1);
        for (let s = 0; s < seg; s++) idx.push(r1 + s, r2 + s, r1 + s + 1, r1 + s + 1, r2 + s, r2 + s + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/* ---------------------------------------------------------------- foliage */

function leafGeometry(THREE, sk, spec, { keep, grow: sizeScale }) {
  const L = spec.leaf, [cx, cy, cz] = sk.crown.center, [rx, ry, rz] = sk.crown.radius;
  // Each leaf draws from its own stream, and the far level's keep/skip test uses a separate one,
  // so a leaf kept at far detail has exactly its near twin's angle, tone and fold.
  const base = sk.leaves.length * 7919 + 13;
  let r = rng(base);
  const pos = [], nor = [], uv = [], col = [], tip = [], fc = [], idx = [];
  const up = new THREE.Vector3(), out = new THREE.Vector3(), side = new THREE.Vector3(), face = new THREE.Vector3();
  const tw = new THREE.Vector3(), v = new THREE.Vector3(), cn = new THREE.Vector3();

  const A = L.angle, deg = Math.PI / 180;
  const bottom = cy - ry, span = 2 * ry;
  const gauss = () => { let t = 0; for (let k = 0; k < 4; k++) t += r(); return (t - 2) * 1.732; };
  const n = new THREE.Vector3(), lift = new THREE.Vector3();

  for (let li = 0; li < sk.leaves.length; li++) {
    const leaf = sk.leaves[li];
    if (keep < 1 && rng((base ^ Math.imul(li + 1, 0x9e3779b1)) >>> 0)() > keep) continue;
    r = rng((base + Math.imul(li + 1, 0x85ebca6b)) >>> 0);
    const { ao } = crownOcclusion(sk, spec, leaf.x, leaf.y, leaf.z);
    const shade = 1 - Math.min(1, ao);
    const height = Math.min(1, Math.max(0, (leaf.y - bottom) / span));

    // Leaf inclination (surface angle from horizontal) from the kind's measured distribution.
    // Sun leaves at the top stand steeper; shade leaves low and inside lie flatter.
    const incline = Math.min(85, Math.max(0, A.mean + gauss() * A.sd + (height - 0.5) * A.gradient - shade * A.gradient * 0.5)) * deg;
    // The leaf surface tips toward the open side of the crown, not toward a random heading.
    const outAz = Math.atan2(leaf.z - cz, leaf.x - cx);
    const az = outAz + gauss() * A.spread * deg;
    face.set(Math.sin(incline) * Math.cos(az), Math.cos(incline), Math.sin(incline) * Math.sin(az));

    // Stem-to-tip axis follows the twig, laid into the leaf plane, and droops by kind.
    tw.set(leaf.dx, leaf.dy, leaf.dz).normalize();
    tw.y -= L.droop * (0.4 + r() * 0.6);
    up.copy(tw).addScaledVector(face, -tw.dot(face));
    if (up.lengthSq() < 1e-4) up.set(Math.cos(outAz), 0, Math.sin(outAz)).addScaledVector(face, -face.y * 0);
    up.normalize();
    side.crossVectors(up, face).normalize();
    up.crossVectors(face, side).normalize();

    // Size: shade leaves grow larger (more area per light), new growth at shoot tips is smaller.
    const S = L.size * sizeScale * (0.8 + leaf.seed * 0.4) * (1 + L.shadeGrow * shade) * (leaf.tip ? L.tipScale : 1);

    const tone = 0.82 + r() * 0.3;
    const lit = smooth(-0.2, 1, height) * 0.5 + 0.5 * (1 - shade);
    const half = r() < 0.5 ? 0 : 0.5;
    const fold = (L.fold ?? 20) * deg * (0.6 + r() * 0.8);
    const b = pos.length / 3;
    // A grown far card keeps its near twin's centre, so the crown outline doesn't swell.
    const back = S * 0.12 + (S - S / sizeScale) * 0.5;
    const ox = leaf.x - up.x * back, oy = leaf.y - up.y * back, oz = leaf.z - up.z * back;
    // A spray is cupped along its stem, not a flat plane: the two halves lift by `fold`.
    for (const sy of [0, 1]) for (const sx of [-0.5, 0, 0.5]) {
      const e = Math.abs(sx) * 2;
      lift.copy(face).multiplyScalar(Math.sin(fold) * S * 0.5 * e);
      v.set(ox, oy, oz).addScaledVector(side, sx * S * Math.cos(fold * e)).addScaledVector(up, sy * S).add(lift);
      cn.set((v.x - cx) / (rx * rx), (v.y - cy) / (ry * ry), (v.z - cz) / (rz * rz)).normalize();
      cn.multiplyScalar(0.75).addScaledVector(face, 0.25).normalize();
      pos.push(v.x, v.y, v.z); nor.push(cn.x, cn.y, cn.z);
      uv.push(half + (sx + 0.5) * 0.5, sy);
      const a = ao * (0.85 + 0.15 * lit);
      col.push(a * tone * (0.94 + 0.1 * lit), a * tone, a * tone * (1.04 - 0.12 * lit));
      tip.push(sy);
      // Each half's own surface normal, for the edge-on fade.
      n.copy(face).multiplyScalar(Math.cos(fold * e)).addScaledVector(side, -Math.sign(sx) * Math.sin(fold * e)).normalize();
      fc.push(n.x, n.y, n.z);
    }
    idx.push(b, b + 1, b + 3, b + 3, b + 1, b + 4, b + 1, b + 2, b + 4, b + 4, b + 2, b + 5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(fc, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Two levels of detail. Near: every twig over ~1 cm and every leaf cluster. Far: limbs only and a
 * third of the clusters at a larger size, so the silhouette and coverage stay the same.
 */
export function buildTree(THREE, kind, skeleton) {
  const spec = KINDS[kind];
  const near = {
    bark: barkGeometry(THREE, skeleton, spec, { minRadius: spec.minTwig, ringStep: 1, segScale: 1 }),
    leaf: leafGeometry(THREE, skeleton, spec, { keep: 1, grow: 1 }),
  };
  const far = {
    bark: barkGeometry(THREE, skeleton, spec, { minRadius: spec.trunkRadius * 0.14, ringStep: 2, segScale: 0.5 }),
    leaf: leafGeometry(THREE, skeleton, spec, { keep: 0.45, grow: 1.45 }),
  };
  return { near, far, crown: skeleton.crown, height: skeleton.height };
}

export function triangles(geometry) { return geometry.index ? geometry.index.count / 3 : 0; }
