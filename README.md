# Alian Trees

Procedural trees for Alian scenes. To author one, write:

```json
{ "use": "tree" }
```

That gives you a 9 m oak. Its shape comes from where it is planted.

## Authoring

| Field | Default | Meaning |
| --- | --- | --- |
| `kind` | `"oak"` | `oak`, `maple`, `birch`, `pine`, `shrub` |
| `height` | kind default ±10% (seeded) | Meters. The tree scales uniformly. |
| `width` | proportional to height | Crown diameter in meters. Scales x/z only. |
| `at` | `[0, 0]` | Planted position `[x, z]`. This is also the seed. |
| `seed` | from `at` | Manual lever: pins one of 6 grown shapes per kind. |
| `lean`, `yaw` | from seed | Degrees. Manual levers. |

The seed is the position, quantized to centimeters. Moving a tree re-rolls its branching, yaw and lean. Editing anything else keeps them. `seed` pins a shape when you want one tree to stay put while you move it.

## How it works

- **Growth (`lib/grow.js`).** Pure data with no THREE, so it is worker-safe.
  - Broadleaf kinds use space colonization (Runions et al. 2007). Attraction points fill a lobed, clumped crown envelope that is biased toward the shell. Branches compete for those points.
  - Conifers use a monopodial whorl model: a leader with tiers of laterals and flat side sprays.
  - Both then apply the pipe model (`r^p = Σ r_child^p`) for radii, smooth the limbs, add gravity sag, and place leaf-cluster sites on twigs with three or fewer tips.
- **Mesh (`lib/build.js`).**
  - Bark is built from parallel-transport tubes. The root flare has buttress lobes.
  - Foliage uses alpha cards with crown-derived normals.
  - Sky occlusion is baked per vertex by marching through the crown's own leaf density (Beer–Lambert). This shades clumps by the clumps above them.
  - There are two levels of detail. The far level keeps limbs only and 38% of the cards, drawn larger.
- **Materials (`lib/materials.js`).** These are stock `MeshStandardMaterial` with small patches:
  - wind (trunk bend, limb sway and leaf flutter, phased by world position, with shadows following)
  - double-sided crown normals
  - sun transmission through backlit leaves
  - reduced grazing specular
  - mip-aware alpha so distant foliage keeps its coverage
- **Instancing (`lib/forest.js`).**
  - `resolveTree()` fills the defaults. `createForest(THREE).set(entries)` buckets trees into one `InstancedMesh` per (kind, variant, detail).
  - A 232-tree meadow is about 75 draw calls. Each skeleton takes 10–100 ms to grow and is cached.
  - There is a contact-shadow disc per tree.
- **Light (`lib/outdoors.js`).**
  - A Preetham sky is the background. A PMREM prefilter of that same sky gives the ambient light.
  - The sun is a shadowing directional light along the sky's sun vector.
  - The fog color is read back from the sky and tone-mapped in JavaScript, because three.js applies fog after tone mapping. This way the ground melts into the horizon.

Every module takes `THREE` as an argument, as `packages/3d/src/shape/lighting.js` does in Alian.

## Run

```sh
python3 -m http.server 8000
```

Then open `localhost:8000` (or `#grove`). three.js 0.180.0, Alian's version, loads from jsDelivr through the import map.

## Porting into Alian

1. Move `lib/` into `packages/3d/src/trees/`. `grow.js` runs in the existing worker (`roomWorker.js` pattern); `build.js` turns the result into transferable arrays.
2. Add a `tree` library thing whose `kind` is a family choice, the same as `lamp.kind`. Map `height`/`width` to `params.h`/`params.w`. Take the seed from the resolved floor-plane position.
3. Outdoors needs `outdoors.js`'s sky-derived environment instead of `RoomEnvironment`. Interiors keep theirs. The tree materials work under both.

Bark textures are CC0. See [bark/SOURCES.txt](bark/SOURCES.txt).
