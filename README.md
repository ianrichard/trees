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

## Ground

`lib/ground.js` is one pure height function. It runs in a worker for the mesh, and on the main thread for placement and the camera.

```json
{ "ground": { "children": {
  "knoll": { "use": "landform", "at": [10, -8], "params": { "h": 3.5, "size": 30 } },
  "ridge": { "use": "landform", "at": [-22, -34], "turn": 25, "params": { "h": 9, "size": [70, 22], "soft": [1, 0.55] } },
  "terrace": { "use": "landform", "at": [-16, 6], "params": { "h": 1.6, "size": [16, 11], "soft": 0.25, "top": "flat" } },
  "hollow": { "use": "landform", "at": [8, 12], "params": { "h": -1.4, "size": [12, 8] } },
  "oak": { "use": "tree", "at": [10, -8] }
} } }
```

- **Landform:** a footprint extruded to `h`, where negative `h` makes a hollow.
  - `soft` sets the edge falloff per axis: 0 is a cliff edge, 1 a rounded hill.
  - `top: "flat"` makes a terrace.
  - `vary` adds seeded wobble, so no two hills are clones.
- **Blending:** raises combine by smooth maximum and hollows by smooth minimum. Overlapping hills make a saddle, and authoring order never matters.
- **Placement:** children stand at the grade, so `y` is relative to the ground under them.
- **Horizon:** past the authored extent, the ground blends to the lowest height along that edge and runs flat to the horizon into the sky-matched fog. A pond does not sink the horizon.
- **Mesh:** a fine grid (at most 220 cells across) plus horizon rings that share its edge resolution, so there are no cracks.
- **Shading:** steep slopes tint toward soil, and tree crowns bake soft occlusion into the grade as their contact shadow.
- **Shorthand:** an array document is still shorthand for the ground's children, so `[{ "use": "tree" }]` works.

## Scenes

`scenes/homestead.json` is 21 lines and almost all defaults. `scenes/ridge.json` is 44 lines and stress-tests every feature. The resolved scenes are:

| Scene | Trees | Rocks | Landforms | Paths | House |
| --- | --- | --- | --- | --- | --- |
| Homestead | 141 | 13 | 3 | 1 | 1 |
| Ridge | 255 | 53 | 9 | 3 | 1 (a walkout on a slope) |

Children of the ground (`lib/scene.js`):

| `use` | Minimum | Options |
| --- | --- | --- |
| `tree` | `at` | `params.kind`, `params.h`, `params.w` (Alian's form; top-level `kind`, `height`, `width` also work), `seed`, `lean`, `yaw` |
| `landform` | `at` | `h`, `size`, `soft`, `top`, `vary`, `turn` |
| `rock`, `outcrop` | `at` | `size`, `h`, `bury`, `strata`, `skirt`, `scope.stone.use` (granite, limestone, sandstone, slate) |
| `path` | `points` | `width`, `vary`, `surface` (dirt, gravel, pavement, flagstone), `edge` |
| `house` | `at` | `size`, `storeys`, `turn`, `reveal`, `grade` (lab stand-in for Alian rooms) |
| `woods` | `at` | `size`, `kind` (one or a list), `density`, `turn`: a seeded stand |
| `rocks` | `at` | `size`, `count`, `stone`, `scale`: a seeded rock field |

Groups expand to ordinary children and are seeded by their position. Woods stay off paths, house footprints, rock bases, steep slopes and ponds.

### Ground and features

- **Rocks** are fractured spheres. Outcrops add strata, with each layer stepped and shifted sideways so ledges overhang.
- **Stone faces are classified in the shader:**
  - tops take moss
  - steep faces show the stone (strata bands, flecks, cracks and bump)
  - the band at grade blends to soil
- **Paths** level the ground across their width and are painted per fragment from a surface mask, so they never z-fight.
- **House pads:**
  - The floor sits at the highest grade under the footprint, plus a reveal.
  - The ground is cut around the house, never filled.
  - The foundation reaches the lowest grade. If more than 1.6 m shows, it becomes a walkout storey with windows, and stairs run from the door down to grade.
- **Grass** grows in seeded 10 m tiles around the camera. Each clump scales in from zero with distance, and tiles build at most two per frame, out of sight.

### Cameras

- **Orbit** is the hand-driven camera.
- **Tour** is a drone loop around the scene that clears the tallest tree under it.
- **Walk the path** is a first-person view at eye height along the first path. It eases in and out, holds at the end, turns and walks back.

Touching the view hands the camera back to Orbit.

### What keeps it from popping

- Trees crossfade between near and far detail over 0.7 s with complementary screen-door dither.
- Grass fades in by distance.
- The shadow frustum snaps to its own texels, and its reach changes in steps.
- Ground and rocks are built once per edit.
- Temporal antialiasing (`lib/taa.js`, the default) jitters the camera by a sub-pixel offset and blends each frame into a reprojected history, so thin blades and leaf edges stop crawling. The **Edges** control switches to plain MSAA for comparison. Measurements and next steps are in [PLAN.md](PLAN.md).
- Grass lights both card faces from above, keeps alpha through its mips, calms its sway with distance and melts into the lawn colour before it shrinks.
- Procedural path and stone detail fades to its mean tone once it is finer than a couple of pixels.
- `__trees.step(dt)` drives exact frames for frame-by-frame pop checks.

## Leaf placement data

Each kind carries a measured leaf inclination distribution (`leaf.angle`). Inclination is the leaf surface's angle from horizontal. All kinds share the same placement rules:

- **Inclination** is sampled around the kind's mean. Sun leaves at the crown top stand steeper (`gradient`), and shade leaves lie flatter.
- **Facing** tilts toward the open side of the crown (`spread` is the azimuth scatter).
- **Size**: shade leaves are larger (`shadeGrow`) and new growth at shoot tips is smaller (`tipScale`).
- **Shape**: each spray is cupped along its stem (`fold`), so it keeps area when seen edge-on.

| Kind | Mean ± sd | Basis |
| --- | --- | --- |
| maple | 27° ± 17 | *Acer platanoides*, planophile (ICP Forests LAI manual; terrestrial-lidar intercomparison, 26.8°) |
| oak | 35° ± 19 | *Quercus petraea* ≈ 25°; *Q. robur* is reported steeper by lidar, so the value splits the difference |
| birch | 49° ± 18 | *Betula pendula*, whole-crown weighted mean (Forests 10:265, 2019) |
| shrub | 30° ± 20 | Planophile default recommended where no measurement exists (Pisek et al. 2013) |
| pine | 12° ± 9 | Flat conifer spray tiers (structural; no leaf angle dataset) |

The full per-species dataset (138 species) is Chianucci et al. 2018, *Annals of Forest Science*, Mendeley Data DOI 10.17632/4rmc7r8zvy.2.

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
