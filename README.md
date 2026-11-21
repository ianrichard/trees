# Alian Trees

Procedural trees for Alian scenes. To author one, write:

```json
{ "use": "tree" }
```

That gives you a 9 m oak. Its shape comes from where it is planted.

## A whole place in one line

```json
{ "use": "outdoors" }
```

That gives you a 220 m meadow: rolling hills, a pond, a footpath, and oak, maple and birch growing in
groves with open grass between. Every field is optional:

| Field | Default | Meaning |
| --- | --- | --- |
| `terrain` | `"meadow"` | `meadow`, `hill-country`, `forest`, `highlands`: an alias for a whole landscape (landforms, cover and ecology) |
| `size` | `220` | Metres, or `[x, z]` |
| `seed` | `1` | Which place. The same seed always gives the same place; a new seed gives another. |
| `trees` | `1` | Tree density: 0 is bare, 2 is twice as wooded |
| `plants` | `1` | Low plant density (dry terrains) |
| `relief` | `1` | Scales every generated height |
| `cover` | the terrain's | Overrides the ground cover |
| `children` | none | Foreground objects. A house, rock or any placed thing keeps its ground clear. Same keys replace generated ones. |

Trees grow where the finished terrain suits each species. Each species has a preferred slope, a band
of height within this landscape (low ground to uplands), and a liking or dislike for wet ground
(hollows and creeks). Grove patches decide where land is wooded and where it's open, and shrubs keep
to the grove edges. A species is picked in proportion to how well the site suits it, so stands mix
where several species fit and stay pure where only one does. Highlands have a treeline. Nothing is
random at view time: it's all seeded.

The terrains:

- **Meadow:** soft hills, a pond and a footpath. Oak and maple, birch by water, shrubs at the edges.
- **Hill Country:** a flat-topped mesa with a bedded limestone bluff, talus, a dry creek and knolls,
  on scrub cover. Live oak mottes on the flats, juniper everywhere, and prickly pear, yucca, agave
  and sotol on open ground.
- **Forest:** rolling hills, a stream and a trail, almost continuously wooded. Pine on uplands, oak
  and maple in between, birch along the stream.
- **Highlands:** big ridges with a granite crag and scree, a tarn and a track. Pine up to a treeline,
  birch in wet hollows, shrubs above.

The one line expands to ordinary children (`lib/landscape.js`), the same as `woods` and `rocks` do,
so anything it makes can be overridden by authoring a child with the same key.

## Authoring

| Field | Default | Meaning |
| --- | --- | --- |
| `kind` | `"oak"` | `oak`, `maple`, `birch`, `pine`, `shrub`, `liveoak`, `juniper` |
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
  - There are two levels of detail. The far level keeps limbs only and 45% of the cards at 1.45× size, about the same leaf area. Each kept card is its near twin (same angle, tone and fold), grown about its own centre, so the crossfade doesn't change the crown.
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
  - Haze is optional and off by default, so nothing in the distance is hidden. The **Haze** lever (`outdoors.setHaze(amount)`) turns it on: its colour is read back from the sky, so the ground melts into the horizon. On screen it is tone-mapped in JavaScript, because three.js applies fog after tone mapping; offscreen pipelines (TAA, Alian's composer) use the raw sky radiance.

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
- **Horizon:** past the authored extent, the ground blends to the lowest height along that edge and runs flat to the horizon (into the sky-matched haze when it is on). A pond does not sink the horizon.
- **Mesh:** a fine grid (at most 220 cells across) plus horizon rings that share its edge resolution, so there are no cracks.
- **Shading:** steep slopes tint toward soil, and tree crowns bake soft occlusion into the grade as their contact shadow.
- **Shorthand:** an array document is still shorthand for the ground's children, so `[{ "use": "tree" }]` works.

## Scenes

`scenes/homestead.json` is 21 lines and almost all defaults. `scenes/ridge.json` is 44 lines and stress-tests every feature. The resolved scenes are:

| Scene | Trees | Rocks | Landforms | Paths | House |
| --- | --- | --- | --- | --- | --- |
| Homestead | 141 | 13 | 3 | 1 | 1 |
| Ridge | 255 | 53 | 9 | 3 | 1 (a walkout on a slope) |
| Texas | live oak mottes, cedar brake | limestone bluff and talus | 4 | 2 (caliche road, dry creek) | 1 |

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
| `plant` | `at` | `params.kind` (`pricklypear`, `yucca`, `agave`, `sotol`), `params.h` |
| `scrub` | `at` | `size`, `kind` (one or a list), `density`, `turn`: a seeded scatter of low plants in clumps |

### Cover

`ground.cover` says what grows on the top face. It is a preset name or a mix of shares:

```json
"cover": "scrub"
"cover": { "use": "scrub", "grass": 0.5, "dirt": 0.45, "gravel": 0.05 }
```

| Preset | Grass | Dirt | Gravel | Palette |
| --- | --- | --- | --- | --- |
| `grass` (default) | 1 | 0 | 0 | green lawn |
| `meadow` | 0.9 | 0.1 | 0 | green |
| `scrub` | 0.5 | 0.46 | 0.04 | dry: straw bunchgrass with soil between tufts, caliche soil, tan gravel |
| `dirt` | 0.1 | 0.85 | 0.05 | dry |

Shares become patches. Ragged noise at 4–12 m is thresholded at its own measured quantiles, so a share of 0.3 really covers about 30% of the ground. Grass clumps thin out over each patch edge instead of stopping at a line. Past the authored extent, the patches continue from the same kind of noise, so a dry place doesn't turn into lawn at the horizon.

### Plants

Two growth forms, and every species is a table entry in `lib/plants.js`:

- **Pads:** jointed flat pads, each sprouting more from its rim, with fruit on some tips (prickly pear).
- **Rosettes:** leaves radiating from one point, upright at the centre and splaying outward, with V-section leaves. Some have a shaggy trunk and a flower stalk (yucca, agave, sotol).

Plants don't sway, so a scene's plants merge into one static mesh: one draw call. Tree kinds `liveoak` and `juniper` are data only (`lib/species.js`), using the same growth models.

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

- **Orbit** is the hand-driven camera. It never goes under or behind the ground: the target stays on the grade, the eye stays clear of the ground near it, and the eye rises until its sight line clears every hill in between.
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

## Colour

Leaf colours are calibrated from measured reflectance, not picked by eye:

- Each kind's mean is a sunlit leaf's linear reflectance at about 650, 550 and 450 nm. Broadleaf
  green is about 0.10–0.13 and conifers about 0.055, with green about 1.8× red and 2.5–2.8× blue
  as measured leaves show. The old hand-picked greens had 5–8× more green than blue, which is
  what read as neon.
- Structured variance:
  - Sun leaves (upper and outer) are lighter, slightly warmer and less saturated.
  - Shade leaves are darker and cooler.
  - New growth at shoot tips is lighter and yellower.
  - Each leaf varies ±15%.
- Undersides are paler and greyer than tops. A card's back face is the leaf's underside.
- Light through backlit leaves is only mildly yellower than reflected light.
- Grass and ground greens follow the same ratios. Bark comes from CC0 photographs.
- Stone: limestone is a weathered buff with dark vertical water streaks below its ledges.

## Rock faces

Where a landform's edge is steep (a drop of at least 2.5 m, steeper than about 55°), `lib/cliffs.js`
builds a wall of bedded rock along the rim. A height field can't hold a vertical or overhanging
face, but a wall offset per vertex can. Its shape follows how sedimentary bluffs weather:

- **Beds:** layers 0.3–1.5 m thick, alternating hard and soft. Hard beds stand proud with flat,
  chipped faces; soft beds weather back into notches, so ledges and small overhangs form. Beds
  wave gently along the face.
- **Joints:** vertical fractures every 1.5–5 m cut the face into blocks. Each block has retreated
  its own amount, joints open into V notches, and now and then a block has fallen out.
- **Caprock:** the top bed is thickest and hardest, so it projects over the rim and rounds back.

Each face is a closed solid: the front, a lip over the rim, a back skin into the hill and end caps,
so no view can see behind or through it. Whole sections of face also step back along major joints
every 8–20 m, so from above the cliff doesn't follow one smooth line. The wall's base sinks below
grade; a `rocks` group at the foot makes the talus. It is seeded from
the landform. `params.face: false` turns it off, and `scope.stone.use` picks the stone.

## Stone detail (hybrid colour and texture)

Stone colour, strata, cracks, stains and moss are procedural, so one stone kind can be retinted. A
photographic or generated detail set adds real grain on top of that without replacing the colour:

- `surfaces/<stone>-albedo.webp`: only its luminance is used, modulating the procedural tone around
  its own mean. Grey or colour both work; aim for a mean brightness near 35%.
- `surfaces/<stone>-normal.webp`: an OpenGL-convention tangent-space normal map.
- Both should be seamless. They are sampled triplanar in world space, so there are no UVs and no
  seams, and repeat every 1.6 m (`detail.scale`).
- `<stone>` is `limestone`, `granite`, `sandstone` or `slate`. A missing file leaves the procedural
  finish, so the lab never breaks.
- In code: `stoneMaterial(THREE, stone, { map, normalMap, scale, mix })`, or `material.setDetail()`
  once textures load.

## Time of day

The bar at the top of the view sets the hour (6:00–20:00). ▶ plays dawn to dusk in 40 s, and
**Face sun** turns the camera toward the sun from where you stand. While the day plays, the sun, its
light and the sky move every frame, and the ambient light refreshes about every 9 game-minutes. The
sun disc is drawn about twice its true 0.53° so it reads on a phone.

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
