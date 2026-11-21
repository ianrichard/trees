// Authored trees → instanced meshes.
//
//   { "use": "tree" }                                     an oak, 9 m, everything else from its position
//   { "use": "tree", "kind": "birch", "height": 14 }
//   { "use": "tree", "kind": "pine", "at": [4, -2], "seed": 3, "lean": 6 }   manual levers
//
// A tree's seed is its planted position unless `seed` says otherwise. The seed picks one of
// VARIANTS grown skeletons per kind and sets yaw, lean and a few percent of size, so moving a tree
// re-rolls it and nothing else ever does. Each (kind, variant, detail) is one InstancedMesh, so a
// grove of hundreds costs a few dozen draw calls.

import { KINDS, DEFAULT_KIND, VARIANTS } from './species.js';
import { rng, seedFromPosition, grow } from './grow.js';
import { buildTree, triangles } from './build.js';
import { treeMaterials, createTreeUniforms } from './materials.js';

/** Fill every default an author left out. Pure; the result is what the renderer draws. */
export function resolveTree(given = {}) {
  // Alian's form is params.{kind, h, w}; the lab's older top-level kind/height/width still work.
  const p = given.params ?? {};
  const entry = { ...given, kind: p.kind ?? given.kind, height: p.h ?? given.height, width: p.w ?? given.width };
  const kind = KINDS[entry.kind] ? entry.kind : DEFAULT_KIND;
  const spec = KINDS[kind];
  const [x, z] = entry.at ?? [entry.x ?? 0, entry.z ?? 0];
  const seed = Number.isFinite(entry.seed) ? entry.seed >>> 0 : seedFromPosition(x, z);
  const r = rng(seed ^ 0x5bd1e995);
  const variant = Number.isFinite(entry.seed) ? (entry.seed >>> 0) % VARIANTS : Math.floor(r() * VARIANTS);
  const auto = !Number.isFinite(entry.height);
  const height = auto ? spec.height * (0.9 + r() * 0.2) : entry.height;
  const width = Number.isFinite(entry.width) ? entry.width : spec.width * (height / spec.height) * (0.92 + r() * 0.16);
  const yaw = Number.isFinite(entry.yaw) ? entry.yaw : r() * 360;
  const lean = Number.isFinite(entry.lean) ? entry.lean : r() * 2.5;
  const leanToward = r() * 360;
  return { kind, x, y: entry.y ?? 0, z, seed, variant, height, width, yaw, lean, leanToward };
}

export function createForest(THREE, { barkTextures = {}, uniforms = createTreeUniforms(THREE), lodDistance = 55, castShadow = true } = {}) {
  const group = new THREE.Group();
  group.name = 'trees';
  const assets = new Map();       // `${kind}:${variant}` → built geometry
  const materials = new Map();    // kind → { near, far } material sets
  let buckets = new Map();        // `${kind}:${variant}` → { trees, meshes }
  let trees = [];

  const materialFor = (kind) => {
    if (!materials.has(kind)) materials.set(kind, treeMaterials(THREE, kind, uniforms, barkTextures[KINDS[kind].bark.tex]));
    return materials.get(kind);
  };
  const assetFor = (kind, variant) => {
    const key = `${kind}:${variant}`;
    if (!assets.has(key)) assets.set(key, buildTree(THREE, kind, grow(kind, variant)));
    return assets.get(key);
  };

  function clear() {
    for (const b of buckets.values()) for (const m of b.meshes) { group.remove(m); m.dispose(); }
    buckets = new Map();
  }

  /** Replace the planted trees. Entries are authored JSON; see resolveTree for defaults. */
  function set(entries, { heightAt = () => 0 } = {}) {
    clear();
    trees = entries.map(resolveTree);
    // Ground children stand at the grade: authored y is measured from it.
    for (const t of trees) t.y += heightAt(t.x, t.z);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const t of trees) {
      const spec = KINDS[t.kind], k = t.height / spec.height, kw = t.width / spec.width;
      // Lean tilts about the base, toward a seeded heading; yaw spins the crown.
      const lean = t.lean * Math.PI / 180, toward = t.leanToward * Math.PI / 180;
      q.setFromEuler(e.set(Math.sin(toward) * lean, 0, Math.cos(toward) * lean));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw * Math.PI / 180));
      t.matrix = m.compose(p.set(t.x, t.y, t.z), q, s.set(k * kw, k, k * kw)).clone();
      t.lod = -1;
      t.leafTone = colorOf(t);
      const key = `${t.kind}:${t.variant}`;
      if (!buckets.has(key)) buckets.set(key, { kind: t.kind, variant: t.variant, trees: [], meshes: [] });
      buckets.get(key).trees.push(t);
    }
    for (const b of buckets.values()) {
      const a = assetFor(b.kind, b.variant), mat = materialFor(b.kind), n = b.trees.length;
      b.lods = [[a.near, mat.near], [a.far, mat.far]].map(([lod, m]) => {
        const bark = new THREE.InstancedMesh(lod.bark, m.bark, n);
        const leaf = new THREE.InstancedMesh(lod.leaf, m.leaf, n);
        bark.customDepthMaterial = m.barkDepth; leaf.customDepthMaterial = m.leafDepth;
        // Per-instance fade for the crossfade; each bucket owns its geometry, so it owns this too.
        for (const g of [lod.bark, lod.leaf]) g.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1));
        for (const mesh of [bark, leaf]) {
          mesh.castShadow = castShadow; mesh.receiveShadow = true;
          mesh.count = 0; mesh.frustumCulled = false;
          group.add(mesh); b.meshes.push(mesh);
        }
        leaf.setColorAt(0, new THREE.Color(1, 1, 1));
        return { bark, leaf };
      });
    }
    dirty = true;
    return trees;
  }

  let dirty = true, last = null;
  const cam = new THREE.Vector3(), tp = new THREE.Vector3(), tone = new THREE.Color();
  const FADE = 0.7; // seconds for a detail crossfade
  /** Call once per frame: advances wind and crossfades trees between near and far detail. */
  function update(camera, seconds) {
    uniforms.uTime.value = seconds;
    const dt = last === null ? 0 : Math.min(0.1, Math.max(0, seconds - last));
    last = seconds;
    camera.getWorldPosition(cam);
    for (const t of trees) {
      tp.set(t.x, t.y + t.height * 0.4, t.z);
      const d = tp.distanceTo(cam) / Math.max(0.6, t.height / 10);
      const next = t.lod === 0 ? (d > lodDistance * 1.1 ? 1 : 0) : (d < lodDistance * 0.9 ? 0 : 1);
      if (t.lod === -1) { t.lod = next; t.w = next === 0 ? 1 : 0; dirty = true; continue; }
      t.lod = next;
      const goal = next === 0 ? 1 : 0;
      if (t.w !== goal) { t.w = goal > t.w ? Math.min(goal, t.w + dt / FADE) : Math.max(goal, t.w - dt / FADE); dirty = true; }
    }
    if (!dirty) return;
    dirty = false;
    for (const b of buckets.values()) {
      const counts = [0, 0];
      for (const t of b.trees) {
        // Near draws every tree with w > 0 at fade w; far draws w < 1 at fade 1 − w.
        for (const k of [0, 1]) {
          const fade = k === 0 ? t.w : 1 - t.w;
          if (fade <= 0) continue;
          const lod = b.lods[k], i = counts[k]++;
          lod.bark.setMatrixAt(i, t.matrix); lod.leaf.setMatrixAt(i, t.matrix);
          lod.bark.geometry.attributes.aFade.array[i] = fade; lod.leaf.geometry.attributes.aFade.array[i] = fade;
          // Slight per-tree leaf tone so neighbours of one variant are not twins.
          lod.leaf.setColorAt(i, tone.setRGB(...t.leafTone));
        }
      }
      b.lods.forEach((lod, k) => {
        for (const mesh of [lod.bark, lod.leaf]) {
          mesh.count = counts[k];
          mesh.instanceMatrix.needsUpdate = true;
          mesh.geometry.attributes.aFade.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.visible = counts[k] > 0;
        }
      });
    }
  }

  function colorOf(t) {
    const rr = rng(t.seed * 31 + 7);
    return [0.9 + rr() * 0.18, 0.92 + rr() * 0.14, 0.88 + rr() * 0.16];
  }

  function stats() {
    let tris = 0, calls = 0;
    for (const b of buckets.values()) b.lods.forEach((lod) => {
      for (const mesh of [lod.bark, lod.leaf]) if (mesh.count) { calls++; tris += triangles(mesh.geometry) * mesh.count; }
    });
    return { trees: trees.length, triangles: tris, drawCalls: calls + 1, skeletons: assets.size };
  }

  /** Soft sky occlusion under each crown, for the ground to bake in (its contact shadow). */
  const occluders = () => trees.map((t) => ({ x: t.x, z: t.z, r: t.width * 0.62 }));

  return { group, set, update, stats, occluders, uniforms, trees: () => trees };
}
