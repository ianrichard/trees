# Trees lab: remaining work

Status, 2026-11-21. The goal is simple SDUI scene composition (a short JSON list gives a believable
outdoor place) that looks great and runs well on phones. The lab is close. This file lists what is
left, the POCs still worth running, and what makes the move into Alian a copy-paste job.

## Edge shimmer (done as POCs; needs a phone check)

The grass and every thin edge vibrated because of sub-pixel detail. MSAA only antialiases one frame,
so anything thinner than a pixel still flickers from frame to frame as the view moves. The lab never
had more than canvas MSAA. Alian's "smooth pixels" is FXAA, which has the same one-frame limit.

Measured with a headless harness: a slow pan, scored by the frame-to-frame second difference of
luminance. "Hot" means the pixels that flicker visibly.

| View | Baseline | Cheap fixes (MSAA) | TAA (with the cheap fixes) |
| --- | --- | --- | --- |
| Eye level in grass, lower half of the screen | 29.9% hot | 27.4% | **1.0%** |
| One tree | 5.3% hot | 4.5% | **0.04%** |

- **TAA (`lib/taa.js`) is the fix.** The camera jitters by a sub-pixel Halton offset each frame.
  History is reprojected from depth, Catmull-Rom filtered, and variance-clipped in YCoCg. It is now
  the lab default; the Edges control switches back to MSAA.
  - Cost: the scene draws once into a half-float target with no MSAA, then two full-screen passes.
    In software GL it was cheaper than MSAA. **Real-phone cost is not measured yet.**
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
That is POC 4 below.

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

## Low-effort, high-impact next steps (recommended order)

1. **Phone check (Ian, 2 minutes).** Open the lab on an iPhone and read the fps chip in Homestead,
   with TAA and then MSAA. That decides whether TAA ships as the default or needs the 0.75
   render-scale trick first.
2. **Clear air (an hour).** Real clear-day aerial perspective: a slight blue shift and loss of
   contrast with distance, about 10% at 1 km. It is not a fog wall, and it separates the tree
   layers in depth. It goes in as the Haze lever's low end, for Ian to judge against Off.
3. **Far field (half a day).** See "Haze is off by default" above. It is the one thing that still
   looks synthetic from the drone view.
4. **Wind motion vectors (half a day).** Sharper moving leaves under TAA.

Then the Alian move (below). Composition sugar and per-instance ghosting follow it, because they
depend on Alian's library and navigation.

## POCs to run next (in order)

1. **Phone budget for TAA.** Run the lab on iPhone at 390 px with `dynamic-hill/timing.js`, TAA
   versus MSAA. Then try TAA at 0.75 render scale with the upsample in the resolve. TAA usually
   makes a lower resolution look better than full-resolution MSAA, which is the perf headroom.
2. **Wind motion vectors.** Wind is a pure function of time, so the vertex shader can compute last
   frame's position (`uTime - dt`) and write true velocity. That removes the remaining softness on
   moving leaves without per-object history buffers.
3. **Composer pass shape.** Wrap `TemporalResolveShader` as an `EffectComposer` pass that reads
   N8AO's beauty depth. It replaces FXAA, and the beauty target can drop its MSAA samples. TAA also
   denoises AO.
4. **Far field without haze.** Past the authored extent: tone variation, a non-straight horizon
   (distant soft landforms or tree lines), and a grass-like response past the grass radius so its
   edge never reads as a ring from the drone view.
5. **Per-instance ghosting and selection** for instanced trees. Alian's `visibility.js` fades
   meshes, but trees are one draw per kind and variant, so this needs an instance attribute.
6. **Composition sugar.** Covers and presets (`"cover": "meadow"`, a `woods` mix per region) so a
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
