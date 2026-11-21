# Trees lab: remaining work

Status, 2026-11-21. The goal is simple SDUI scene composition (a short JSON list gives a believable
outdoor place) that looks great and runs well on phones. The lab is close. This file lists what is
left, the POCs still worth running, and what makes the move into Alian a copy-paste job.

## Edge shimmer (done)

The grass and every thin edge vibrated because of sub-pixel detail. MSAA only antialiases one frame,
so anything thinner than a pixel still flickers from frame to frame as the view moves. The lab never
had more than canvas MSAA. Alian's "smooth pixels" is FXAA, which has the same one-frame limit.

Measured with a headless harness: a slow pan, scored by the frame-to-frame second difference of
luminance. "Hot" means the pixels that flicker visibly.

| View | Baseline | Cheap fixes (MSAA) | TAA (with the cheap fixes) |
| --- | --- | --- | --- |
| Eye level in grass, lower half of the screen | 29.9% hot | 27.4% | **1.0%** |
| One tree | 5.3% hot | 4.5% | **0.04%** |

- **TAA (`lib/taa.js`) is the fix.** Smooth on the latest iPhone Pro (Ian). The camera jitters by a sub-pixel Halton offset each frame.
  History is reprojected from depth, Catmull-Rom filtered, and variance-clipped in YCoCg. It is now
  the lab default; the Edges control switches back to MSAA.
  - Cost: the scene draws once into a half-float target with no MSAA, then two full-screen passes.
    In software GL it was cheaper than MSAA. Older-iPad cost is not checked yet.
- **Cheap fixes** (kept, since they help under either mode):
  - Grass back faces light like the front. They were lit from below, which made dark speckle.
  - Mip-aware alpha on grass.
  - Far grass loses its fast sway and blends to the lawn colour before it shrinks.
  - Path and rock procedural detail fades to its mean once it is finer than a couple of pixels.
- **Crossfade dither** steps every frame under TAA, so LOD crossfades integrate into a real blend.

## Haze is off by default

Haze used to hide distant detail. It is now an opt-in lever (0 = off, the default; 1 = the old
density). Whatever looks wrong without it gets fixed at its cause, not covered up.

What shows without haze (Ridge, drone view): past the authored extent the ground is one flat,
uniform green that meets the sky in a ruler-straight line. Homestead holds up because its own
trees and rise fill the horizon. The fix belongs in the far field itself: low-frequency tone and
colour variation, a distant ring of soft landforms or tree-line silhouettes so the horizon isn't
straight, and aerial perspective (a physically small, distance-based desaturation, not a fog wall).
That is item 5 under "What is left to prove".

## Where we are (2026-11-21, evening)

The lab composes a believable place from about 20 lines of JSON, holds steady at the edges, and
reads as real light. Fixed in this pass, from Ian's review:

- **Rocks showed their insides.** The triangles were wound inside-out, so normals faced in and the
  front faces were culled. Fixed in `rocks.js`.
- **Hills popped on load.** Trees and rocks were placed on the real heights before the worker's
  ground mesh arrived. A new scene now stays hidden until its ground is in, then fades in over
  0.35 s, with no loading text.
- **The detail switch looked like different leaves.** It was: the far level's skip test drew from
  the same random stream as each leaf's angle, tone and fold, so every kept leaf after the first
  skip came out different. Each leaf now has its own stream, so a far leaf is its near twin. Far
  cards also grew outward from their stems, which swelled the crown; they now grow about their own
  centre. The far level keeps 45% of the leaves at 1.45×, about equal leaf area (before: 38% at
  1.5×, which looked sparse and dark).
- **Tone mapping is Khronos PBR Neutral** (Rendering → Tone toggles ACES and AgX). ACES yellowed
  foliage and bleached the sky to white. Neutral gives a blue sky and truer greens at the same
  exposure. It was the cheapest realism win available: one line.

## Performance

Ian, 2026-11-21: great on the latest iPhone Pro. Still to check: an older iPad, which has a bigger
screen and less GPU. If it chokes, the cuts live in the runtime as one generic quality ladder, not
in scenes. Authors never see it, so it is not an existential risk. Cheapest first:

1. TAA at 0.75 render scale, upsampled in the resolve.
2. Shadow map 2048 → 1024, and a shorter shadow reach.
3. Grass radius and density.
4. Tree near-detail distance, so more trees draw at far detail.
5. Fewer far-detail leaf cards.

Pick the step from a measured frame time (the `timing.js` pattern), not from the device name.

## What is left to prove

The bet is that new kinds of place are data, not code. In order:

1. **Ground-aware camera (about an hour).** The eye stays a minimum height above the ground under
   it and just ahead of it, and the orbit target lifts if the eye would end up inside a slope, so
   orbiting a hill never goes under or behind the scene. Alian's navigation needs the same rule
   (focus a tree, then step Up to the ground).
2. **Imperfect ground: photo textures plus a cover mix.**
   - Real CC0 dirt, gravel and rock textures replace the canvas-drawn ones (brief S1 in Alian's
     `3d-outdoors.md`).
   - `cover` becomes a mix with patchy noise, for example `{ "dirt": 0.6, "grass": 0.3,
     "gravel": 0.1 }`. Grass scatters only where grass cover wins.
   - Texture versus 3D: anything that breaks the silhouette or casts a visible shadow at viewing
     distance is 3D (cactus, boulders, near grass clumps). Anything flatter than about 5 cm, or
     smaller than a pixel, is texture (gravel, pebbles, cracked caliche, litter, far grass).
     3D fades into texture with distance, as grass already does.
3. **Texas: a new landscape as data.** Two new plant shapes:
   - ribbed, jointed solids for cactus
   - rosettes for yucca, agave and grass tufts

   After those, a species is a table entry. Done when a Hill Country scene is about 40 lines of
   species and cover definitions plus a 20-line scene, with no other engine change.
4. **Limestone cliffs.** Ground is a height map and can't overhang, so bluffs are outcrops at
   landscape scale: stepped ledges, an undercut base, and a talus apron blending into the grade.
   This tests rock texture density at 30 m, rock detail levels, and the strata shader at that size.
5. **Far field without haze**, and **clear air** as the Haze lever's low end (see above).
6. **Wind motion vectors**, for sharper moving leaves under TAA.

## Port work (with the Alian move)

1. **Composer pass shape.** Wrap `TemporalResolveShader` as an `EffectComposer` pass that reads
   N8AO's beauty depth. It replaces FXAA, and the beauty target can drop its MSAA samples. TAA also
   denoises AO.
2. **Per-instance ghosting and selection** for instanced trees. Alian's `visibility.js` fades
   meshes, but trees are one draw per kind and variant, so this needs an instance attribute.
3. **Composition sugar.** Covers and presets (`"cover": "meadow"`, a `woods` mix per region) so a
   good-looking place stays under 20 lines. `homestead.json` is the bar: 21 lines.

## Copy-paste readiness for the Alian move

What already holds:

- Every module takes `THREE` as an argument and has no build step (the `lighting.js` pattern).
- Growth and ground are pure data and worker-safe.
- `lib/taa.js` exports its resolve shader separately from the lab's standalone driver.

What to fix before the move:

| # | Friction | State |
| --- | --- | --- |
| 1 | Tree grammar: Alian puts `kind`, `h`, `w` in `params` | Done: `resolveTree` reads `params.{kind,h,w}`; the old top-level form still works |
| 2 | Fog colour space: the lab mixed a tone-mapped fog colour, which is wrong in any offscreen pipeline (TAA here, EffectComposer and OutputPass in Alian) | Done: `createOutdoors({ offscreen: true })` uses scene radiance |
| 3 | Two grass implementations: this lab's `grass.js`, and `examples/dynamic-hill` `grass.js`, `turf.js` and `moss.js`. The C8e brief says to move dynamic-hill's. | **Decision for Ian:** port this one (tiled, seeded, exclusion-aware, steady), and retire dynamic-hill's after matched captures |
| 4 | The anti-aliasing owner in Alian is FXAA (`shape/antialiasing.js`) | Swap in the TAA pass behind the same `antialiasing` setting; the Preferences checkbox becomes "Smooth edges" |
| 5 | `house` is a lab stand-in | Stays lab-only; Alian rooms replace it (C8f) |
| 6 | `woods` and `rocks` groups expand in `scene.js` | They become library assets that expand at resolve time, with the same seeded output |
| 7 | Sky-derived environment versus `RoomEnvironment` | Outdoor scenes opt in per scene (already in C8a) |

The lab's `demo.js` is the only file that should not move. It is the page shell, and Alian's viewer
replaces it.
