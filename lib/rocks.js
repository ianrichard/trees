// Rocks and outcrops: solid features sunk into the ground, with stone finishes per face.
//
//   { "use": "rock", "at": [1, 1] }                                       a granite boulder
//   { "use": "outcrop", "at": [-2, 4], "params": { "h": 1.8, "size": [5, 2] },
//     "scope": { "stone": { "use": "limestone" } } }                      a layered ledge
//
// Shape: a sphere fractured by seeded plane cuts (broken faces, not blobs), roughened with ridged
// noise; outcrops add strata, layers stepped and shifted so ledges overhang. Faces are classified in
// the shader from geometry: tops (within ~35° of up) take moss/grass, steep faces show the stone,
// the band at grade blends to soil. The finish is procedural (colour, strata, cracks, bump), so it
// needs no UVs and no image; detail images can be layered on later through the same material.

import { rng } from './grow.js';
import { noise } from './ground.js';

const v3 = (x, y, z) => [x, y, z];

export const STONES = {
  // stain: warm iron-oxide patches. shape: how a loose boulder of this stone breaks
  //   cuts = number of fracture planes [min, max], depth = how far in they cut (lower = blockier),
  //   flat = how much the top is flattened (bedded stones break into slabs).
  granite: { color: '#8c8a84', dark: '#5e5c58', fleck: 0.55, bands: 0.0, moss: 0.45, rough: 0.9, stain: 0.15,
    shape: { cuts: [4, 6], depth: [0.62, 0.85], flat: 0.55 } },
  // Hill Country limestone: cream to pale grey with ochre staining, from the reference photos.
  // Photo: Poly Haven "Marble Cliff 04" (a weathered sedimentary face, 12.6 m across), close to true scale.
  limestone: { color: '#c2b8a0', dark: '#8f8470', fleck: 0.12, bands: 0.35, moss: 0.3, rough: 0.95, stain: 0.5,
    shape: { cuts: [9, 13], depth: [0.42, 0.62], flat: 0.35 }, detail: { scale: 8, mix: 0.7, chroma: 0.5 } },
  sandstone: { color: '#b98a5e', dark: '#8a5f3c', fleck: 0.2, bands: 0.8, moss: 0.25, rough: 0.95, stain: 0.35,
    shape: { cuts: [6, 9], depth: [0.5, 0.75], flat: 0.45 } },
  slate: { color: '#5f6366', dark: '#3e4246', fleck: 0.1, bands: 0.35, moss: 0.3, rough: 0.8, stain: 0.05,
    shape: { cuts: [9, 12], depth: [0.4, 0.6], flat: 0.25 } },
};

function rockPositions(k, detail) {
  // Icosphere.
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [v3(-1, t, 0), v3(1, t, 0), v3(-1, -t, 0), v3(1, -t, 0), v3(0, -1, t), v3(0, 1, t), v3(0, -1, -t), v3(0, 1, -t), v3(t, 0, -1), v3(t, 0, 1), v3(-t, 0, -1), v3(-t, 0, 1)]
    .map(([x, y, z]) => { const m = Math.hypot(x, y, z); return [x / m, y / m, z / m]; });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const cache = new Map(), next = [];
    const mid = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (cache.has(key)) return cache.get(key);
      const [ax, ay, az] = verts[a], [bx, by, bz] = verts[b];
      const m = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2], l = Math.hypot(...m);
      verts.push([m[0] / l, m[1] / l, m[2] / l]);
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = next;
  }

  const r = rng(k.seed);
  // Fracture planes: each cut flattens everything beyond it, which reads as a broken face.
  // Each stone breaks its own way: limestone into blocky slabs, granite into rounded masses.
  const sh = (STONES[k.stone] ?? STONES.granite).shape;
  const cuts = Array.from({ length: k.use === 'outcrop' ? 7 : sh.cuts[0] + ((r() * (sh.cuts[1] - sh.cuts[0] + 1)) | 0) }, () => {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    return { n: [s * Math.cos(a), u * 0.8, s * Math.sin(a)], d: sh.depth[0] + r() * (sh.depth[1] - sh.depth[0]) };
  });
  const layers = k.strata > 0 ? Math.max(2, Math.round(k.h / 0.45)) : 0;
  const shifts = Array.from({ length: layers + 2 }, () => [(r() - 0.5) * 0.14, (r() - 0.5) * 0.14]);
  const H = k.h / (1 - k.bury); // full height, buried part included
  const out = [];
  for (const [x, y, z] of verts) {
    let px = x, py = y, pz = z;
    // Ridged roughness before the cuts so the broken faces stay planar-ish.
    const rough = 1 + 0.16 * (1 - Math.abs(noise(x * 2.2 + 3, z * 2.2 + y * 1.7, k.seed))) + 0.07 * noise(x * 6 + y * 3, z * 6, k.seed ^ 9);
    px *= rough; py *= rough; pz *= rough;
    for (const c of cuts) {
      const dd = px * c.n[0] + py * c.n[1] + pz * c.n[2] - c.d;
      if (dd > 0) { px -= c.n[0] * dd * 0.92; py -= c.n[1] * dd * 0.92; pz -= c.n[2] * dd * 0.92; }
    }
    // Flatten the top a little: weathered rock is lower and broader than a ball.
    if (py > 0.35) py = 0.35 + (py - 0.35) * sh.flat;
    let wy = (py * 0.5 + 0.5); // 0 bottom … 1 top
    let sx = 1, sz = 1;
    if (layers) {
      // Strata: snap height toward layer steps and shift each layer sideways, so ledges overhang.
      const f = wy * layers, i = Math.floor(f), frac = f - i;
      const stepped = (i + Math.pow(frac, 1 + 5 * k.strata)) / layers;
      wy = wy + (stepped - wy) * k.strata;
      const sh = shifts[Math.max(0, Math.min(i, layers))];
      px += sh[0] * k.strata; pz += sh[1] * k.strata;
      const tier = 1 - 0.12 * k.strata * (i / layers);
      sx = tier; sz = tier;
    }
    const lx = px * k.sx / 2 * sx, lz = pz * k.sz / 2 * sz;
    out.push(
      k.x + lx * k.cos - lz * k.sin,
      k.y - k.bury * H + wy * H,
      k.z + lx * k.sin + lz * k.cos,
    );
  }
  return { position: out, faces };
}

/** One merged geometry per stone kind, in world space. `grade` per vertex is height above ground. */
export function buildRocks(THREE, rocks, heightAt) {
  const byStone = new Map();
  for (const k of rocks) {
    const list = byStone.get(k.stone) ?? []; list.push(k); byStone.set(k.stone, list);
  }
  const out = [];
  for (const [stone, list] of byStone) {
    const pos = [], grade = [], idx = [];
    for (const k of list) {
      const big = Math.max(k.sx, k.sz, k.h);
      const { position, faces } = rockPositions(k, big > 3 ? 5 : big > 1.2 ? 4 : 3);
      const base = pos.length / 3;
      for (let i = 0; i < position.length; i += 3) {
        pos.push(position[i], position[i + 1], position[i + 2]);
        grade.push(position[i + 1] - heightAt(position[i], position[i + 2]));
      }
      // Icosphere faces are counter-clockwise from outside: keep that order so normals face out.
      for (const [a, b, c] of faces) idx.push(base + a, base + b, base + c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aGrade', new THREE.Float32BufferAttribute(grade, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    out.push({ stone: STONES[stone] ? stone : 'granite', geometry: g });
  }
  return out;
}

const STONE_GLSL = /* glsl */`
float sHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1,0,0)), f.x), mix(sHash(i + vec3(0,1,0)), sHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0,0,1)), sHash(i + vec3(1,0,1)), f.x), mix(sHash(i + vec3(0,1,1)), sHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float sFbm(vec3 p) { return sNoise(p) * 0.55 + sNoise(p * 2.1) * 0.27 + sNoise(p * 4.3) * 0.13 + sNoise(p * 9.1) * 0.05; }
`;

/** Stone material for one kind. Moss and soil colours follow the ground's grass and soil. */
//
// Hybrid finish: an optional photographic set gives the stone its real surface, and the procedural
// layers (strata, stains, soil on ledges, moss, occlusion) stay on top. `detail.map` is read relative
// to its own mean, so the photo brings real grain, pitting and staining while the stone kind (and any
// concept retint) keeps its overall brightness. `mix` is how much the photo replaces the procedural
// base; `chroma` blends from the stone's tint (0) to the photo's own hues (1).
// `detail.normalMap`
// perturbs the surface. Both are sampled triplanar in world space (no UVs, no seams) every `detail.scale`
// metres. Call setDetail() later to add a set once its textures load.
export function stoneMaterial(THREE, stone, detail = null) {
  const s = STONES[stone] ?? STONES.granite;
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: s.rough, metalness: 0 });
  const du = { uDetailMap: { value: null }, uDetailNormal: { value: null }, uDetailScale: { value: 1.6 }, uDetailMix: { value: 0.7 },
    uDetailChroma: { value: 0 }, uDetailMean: { value: new THREE.Vector3(0.35, 0.35, 0.35) } };
  m.setDetail = (given) => {
    if (!given?.map && !given?.normalMap) return;
    const d = { ...s.detail, ...given };
    du.uDetailMap.value = d.map ?? null; du.uDetailNormal.value = d.normalMap ?? null;
    du.uDetailScale.value = d.scale ?? 1.6; du.uDetailMix.value = d.mix ?? 0.7; du.uDetailChroma.value = d.chroma ?? 0;
    if (d.mean) du.uDetailMean.value.set(...d.mean);
    m.defines = { ...(m.defines ?? {}), ...(d.map ? { STONE_DETAIL_MAP: '' } : {}), ...(d.normalMap ? { STONE_DETAIL_NORMAL: '' } : {}) };
    m.needsUpdate = true;
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, du, {
      uStone: { value: new THREE.Color(s.color) }, uDark: { value: new THREE.Color(s.dark) },
      uMoss: { value: new THREE.Color('#4c5a2a') }, uSoil: { value: new THREE.Color('#4a3d2c') },
      uFleck: { value: s.fleck }, uBands: { value: s.bands }, uMossAmt: { value: s.moss }, uStain: { value: s.stain ?? 0 },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGrade; varying float vGrade; varying vec3 vStoneW; varying vec3 vStoneN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrade = aGrade; vStoneW = (modelMatrix * vec4(position, 1.0)).xyz; vStoneN = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uDetailMap, uDetailNormal; uniform float uDetailScale, uDetailMix, uDetailChroma; uniform vec3 uDetailMean;
// Triplanar weights from the world normal, sharpened so faces don't smear between projections.
vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(8.0)); return w / (w.x + w.y + w.z); }
vec4 triSample(sampler2D t, vec3 p, vec3 n) { vec3 w = triW(n); p /= uDetailScale;
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }
uniform vec3 uStone; uniform vec3 uDark; uniform vec3 uMoss; uniform vec3 uSoil; uniform float uFleck; uniform float uBands; uniform float uMossAmt; uniform float uStain;
varying float vGrade; varying vec3 vStoneW; varying vec3 vStoneN;
${STONE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 w = vStoneW;
  float big = sFbm(w * 0.7), fine = sFbm(w * 5.0);
  // Strata: wavy horizontal bands, the sedimentary signature.
  float band = sin(w.y * 9.0 + big * 5.0) * 0.5 + 0.5;
  vec3 col = mix(uDark, uStone, clamp(0.35 + big * 0.7 + (band - 0.5) * uBands * 0.6, 0.0, 1.0));
  // Flecks (granite crystals) and a few dark cracks.
  // Frequency clamp: flecks and crack lines finer than a couple of pixels fade to their mean tone,
  // so distant stone doesn't sparkle as the view moves.
  float sfw = length(fwidth(w));
  float fl = step(1.0 - uFleck * 0.35, sHash(floor(w * 38.0))) * (1.0 - smoothstep(0.2, 0.55, 38.0 * sfw));
  col = mix(col, col * mix(0.55, 1.35, sHash(floor(w * 38.0) + 3.1)), fl);
  float cn = abs(sFbm(w * 1.6 + 4.0) - 0.5), cw = max(0.035, fwidth(cn) * 1.5);
  float crack = smoothstep(cw, 0.0, cn) * (0.035 / cw);
  col *= 1.0 - crack * 0.15;
  #ifdef STONE_DETAIL_MAP
  {
    // The photo is grain on top of the stone's own tones: its brightness relative to its mean
    // modulates them, and a little of its hue variation (relative chromaticity, clamped) tints them.
    vec3 dt = triSample(uDetailMap, vStoneW, vStoneN).rgb;
    const vec3 L = vec3(0.2126, 0.7152, 0.0722);
    float lr = dot(dt, L) / max(dot(uDetailMean, L), 1e-3);
    vec3 hue = clamp((dt / max(dot(dt, L), 1e-3)) / (uDetailMean / max(dot(uDetailMean, L), 1e-3)), vec3(0.85), vec3(1.15));
    col *= mix(1.0, lr, uDetailMix) * mix(vec3(1.0), hue, uDetailChroma);
  }
  #endif
  #ifdef STONE_PROCESS
  {
    // Tones from the face's history (cliffs.js weatherFace): fresh breaks are cream to buff, old
    // faces weather to grey and carry lichen (dark grey crusts, a few orange spots), and drip
    // streaks of dark cyanobacteria run down from every lip.
    float old = smoothstep(0.15, 0.85, vColor.g);
    vec3 tone = mix(vec3(0.60, 0.50, 0.35), vec3(0.40, 0.37, 0.32), old);
    col *= tone / max(uStone, vec3(1e-3));
    float lich = smoothstep(0.55, 0.75, sFbm(w * 2.6 + 13.0)) * old;
    col = mix(col, col * vec3(0.42, 0.42, 0.40), lich * 0.7);
    float orange = smoothstep(0.78, 0.86, sFbm(w * 7.0 + 31.0)) * old;
    col = mix(col, vec3(0.62, 0.30, 0.08), orange * 0.55);
    float vert = 1.0 - smoothstep(0.35, 0.7, abs(vStoneN.y));
    float st = vColor.b * (0.6 + 0.4 * sNoise(vec3((w.x + w.z) * 3.0, w.y * 0.25, 5.0)));
    col = mix(col, col * vec3(0.38, 0.38, 0.39), clamp(st * vert, 0.0, 0.6));
  }
  // Flat tops of a bluff hold soil and grass in every joint, so only the rim edge reads as bare rock.
  {
    float flatTop = smoothstep(0.6, 0.9, vStoneN.y);
    float holds = smoothstep(0.35, 0.6, sFbm(w * 0.9 + 17.0) + 0.15);
    col = mix(col, mix(uSoil, uMoss, 0.55) * (0.8 + fine * 0.4), flatTop * holds * 0.85);
  }
  #else
  // Water stains: dark vertical streaks on steep faces (weathering runs down from ledges).
  float vert = 1.0 - smoothstep(0.25, 0.6, abs(vStoneN.y));
  float streak = sNoise(vec3(w.x * 1.7 + w.z * 1.7, w.y * 0.12, 3.0)) * 0.7 + sNoise(vec3(w.x * 5.0 + w.z * 5.0, w.y * 0.3, 7.0)) * 0.3;
  col *= 1.0 - vert * smoothstep(0.45, 0.8, streak) * 0.38;
  #endif
  // Faces from geometry: tops take moss, the band at grade blends to soil.
  // Ledge and boulder tops collect soil and dust, so they never read as bare stone lit by the blue sky.
  col = mix(col, uSoil * (0.85 + fine * 0.3), smoothstep(0.55, 0.85, vStoneN.y) * smoothstep(0.3, 0.6, sFbm(w * 1.3 + 2.0)) * 0.6);
  float top = smoothstep(0.62, 0.9, vStoneN.y) * smoothstep(0.35, 0.7, sFbm(w * 2.2 + 9.0)) * uMossAmt * 1.6;
  col = mix(col, uMoss * (0.8 + fine * 0.4), clamp(top, 0.0, 0.9));
  float base = 1.0 - smoothstep(0.0, 0.22, vGrade + (fine - 0.5) * 0.12);
  col = mix(col, uSoil, base * 0.85);
  // Occlusion: undersides and the grade line are darker.
  col *= mix(0.62, 1.0, smoothstep(-0.6, 0.4, vStoneN.y)) * mix(0.55, 1.0, smoothstep(0.0, 0.35, vGrade));
  // Iron staining: soft warm ochre patches, strongest on steep faces below ledges.
  float stain = smoothstep(0.45, 0.8, sFbm(w * 0.35 + 21.0)) * uStain;
  col = mix(col, col * vec3(1.08, 0.86, 0.6), stain * (0.5 + 0.5 * (1.0 - abs(vStoneN.y))));
  // Occlusion baked by the form (cliff notches, pockets, clefts), when the mesh carries it.
  #ifdef USE_COLOR
  // Recesses go warm and dark (dust, damp, shade), not just dim, and they lose the sky's blue fill below.
  col = mix(col * vec3(0.58, 0.53, 0.47), col, smoothstep(0.3, 1.0, vColor.r));
  #endif
  diffuseColor.rgb = col;
}`)
      // Vertex colour is data here (r occlusion, g age, b streak), so only occlusion multiplies.
      .replace('#include <color_fragment>', '#ifdef USE_COLOR\n  diffuseColor.rgb *= vColor.r;\n#endif')
      // Stone is matte: the stock environment specular on smooth normals read as metal.
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectSpecular *= 0.35;
#ifdef USE_COLOR
// Sky fill reaches into a notch only as far as the notch is open.
reflectedLight.indirectDiffuse *= mix(0.25, 1.0, smoothstep(0.3, 1.0, vColor.r));
#endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // Bump from the same noise (surface-gradient method), so the light catches grain and cracks.
  float bfw = length(fwidth(vStoneW));
  float hB = sFbm(vStoneW * 5.0) * 0.6 * (1.0 - smoothstep(0.15, 0.5, 5.0 * bfw)) + sFbm(vStoneW * 1.6) * 0.4;
  vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
  float dhdx = dFdx(hB), dhdy = dFdy(hB);
  vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  normal = normalize(abs(det) * normal - grad * 0.06);
  #ifdef STONE_DETAIL_NORMAL
  {
    // Whiteout-blended triplanar normal: each projection's tangent-space normal is swizzled into world
    // space, then into view space, and tilts the surface by its xy.
    vec3 w = triW(vStoneN), p = vStoneW / uDetailScale;
    vec3 tx = texture2D(uDetailNormal, p.zy).xyz * 2.0 - 1.0, ty = texture2D(uDetailNormal, p.xz).xyz * 2.0 - 1.0, tz = texture2D(uDetailNormal, p.xy).xyz * 2.0 - 1.0;
    vec3 wn = vec3(0.0, tx.y, tx.x) * w.x + vec3(ty.x, 0.0, ty.y) * w.y + vec3(tz.x, tz.y, 0.0) * w.z;
    normal = normalize(normal + mat3(viewMatrix) * wn * 0.8);
  }
  #endif
}`);
  };
  m.customProgramCacheKey = () => `alian-stone-${stone}-${du.uDetailMap.value ? 'm' : ''}${du.uDetailNormal.value ? 'n' : ''}`;
  if (detail) m.setDetail(detail);
  return m;
}
