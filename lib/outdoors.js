// One coherent outdoor light: a physical sky (Preetham) is the background, the image-based
// ambient light (prefiltered from that same sky), and the fog color; the sun is a shadowing
// directional light along the sky's sun vector. Because ambient, fog and sun come from one
// source, foliage greens and bark pick up the right cool fill and warm key at every hour.

import { PALETTES } from './ground.js';

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

// `offscreen`: the scene renders to a linear target and a later pass tone-maps it (TAA here,
// EffectComposer + OutputPass in Alian). Materials then skip tone mapping, so the fog color must be
// the horizon's scene radiance rather than its on-screen color.
export function createOutdoors(THREE, { renderer, scene, Sky, shadowSize = 2048, offscreen = false }) {
  const sky = new Sky();
  sky.scale.setScalar(4500);
  // The lowest few degrees of sky fade into the fog color, so ground and sky meet without a seam.
  sky.material.uniforms.uHorizon = { value: new THREE.Color() };
  // The sun disc: about twice its true 0.53°, with a soft limb, so it reads on a phone without looking
  // like a cartoon. Same light, same position; only the drawn disc changes.
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace(/const float sunAngularDiameterCos = [0-9.]+;/, 'const float sunAngularDiameterCos = 0.99983;')
    .replace('smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta )', 'smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00006, cosTheta )');
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform vec3 uHorizon;')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( mix( retColor, uHorizon, smoothstep( 0.12, -0.01, direction.y ) ), 1.0 );');
  scene.add(sky);
  const skyU = sky.material.uniforms;
  Object.assign(skyU.turbidity, { value: 3.2 });
  Object.assign(skyU.rayleigh, { value: 1.4 });
  Object.assign(skyU.mieCoefficient, { value: 0.004 });
  Object.assign(skyU.mieDirectionalG, { value: 0.82 });

  const sun = new THREE.DirectionalLight('#fff1dc', 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  sun.shadow.blurSamples = 12;
  scene.add(sun, sun.target);

  const ground = makeGround(THREE);
  scene.add(ground);

  // Haze is opt-in: 0 shows the scene as it is, with nothing hidden in the distance. 1 is the old
  // default (density 0.0036, sky-matched colour). Density is a uniform, so changing it never recompiles.
  const HAZE = 0.0036;
  scene.fog = new THREE.FogExp2('#c9d6dc', 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky(); envSky.scale.setScalar(1000); envScene.add(envSky);
  let envTarget = null;

  // Fog color is read back from the sky itself (a tiny HDR render looking at the horizon, away from
  // the sun), so the ground fades into exactly the sky behind it.
  const probe = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType });
  const probeCam = new THREE.PerspectiveCamera(6, 1, 1, 2000);
  const probePx = new Uint16Array(8 * 8 * 4);
  function horizonColor(target) {
    // Average four headings a little above the horizon; the sun's own glow is left to the sky.
    let r = 0, g = 0, b = 0;
    const prev = renderer.getRenderTarget();
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.4;
      probeCam.position.set(0, 0, 0);
      probeCam.lookAt(Math.cos(a), 0.035, Math.sin(a));
      renderer.setRenderTarget(probe); renderer.render(envScene, probeCam);
      renderer.readRenderTargetPixels(probe, 0, 0, 8, 8, probePx);
      for (let i = 0; i < 64; i++) { r += THREE.DataUtils.fromHalfFloat(probePx[i * 4]); g += THREE.DataUtils.fromHalfFloat(probePx[i * 4 + 1]); b += THREE.DataUtils.fromHalfFloat(probePx[i * 4 + 2]); }
    }
    renderer.setRenderTarget(prev);
    return target.setRGB(r / 256, g / 256, b / 256, THREE.LinearSRGBColorSpace);
  }

  const sunDir = new THREE.Vector3();
  const state = { hour: 15.5, focus: new THREE.Vector3(), reach: 30 };

  /** Hour 6–20. The sun crosses from −x/+z through south-ish to +x/−z; afternoon light rakes the default view. */
  /**
   * `env: false` moves only the sun, its light and the sky (cheap, every frame while the day plays);
   * the ambient prefilter and horizon readback then refresh at the next full call.
   */
  function setHour(hour, { env = true } = {}) {
    state.hour = hour;
    const t = (hour - 6) / 14;
    const elev = Math.sin(Math.PI * clamp01(t)) * 58 - 2;
    const az = THREE.MathUtils.degToRad(-60 + 180 * clamp01(t));
    const e = THREE.MathUtils.degToRad(elev);
    sunDir.set(Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e)).normalize();
    skyU.sunPosition.value.copy(sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = skyU[k].value;
    envSky.material.uniforms.sunPosition.value.copy(sunDir);

    // Sun color and strength: warm and weak near the horizon, white overhead.
    const low = 1 - clamp01(elev / 30);
    const day = clamp01((elev + 3) / 10);
    sun.color.setHSL(0.09 - 0.03 * low, 0.35 + 0.55 * low, 0.94 - 0.2 * low);
    sun.intensity = 3.4 * day * (1 - 0.35 * low);
    renderer.toneMappingExposure = 0.55 + 0.25 * (1 - day);
    if (!env) { place(); return; }
    // Rebuild the ambient light from the sky (cheap: one 256² cubemap prefilter per change).
    if (envTarget) envTarget.dispose();
    envTarget = pmrem.fromScene(envScene, 0);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.55 + 0.25 * day;
    // Fog takes the horizon color so far trees melt into the sky instead of into grey.
    const horizon = horizonColor(sky.material.uniforms.uHorizon.value);
    // three.js mixes fog in after tone mapping and sRGB encoding, so the fog color must be the
    // horizon as it appears on screen, not its scene radiance.
    if (offscreen) scene.fog.color.copy(horizon).multiplyScalar(0.93);
    else displayColor(horizon, renderer.toneMappingExposure, scene.fog.color, renderer.toneMapping === THREE.NeutralToneMapping).multiplyScalar(0.93);
    place();
  }

  /**
   * Keep the shadow frustum around what the camera is looking at. The centre snaps to whole shadow
   * texels in the light's frame, so a moving camera never makes shadow edges crawl.
   */
  const lx = new THREE.Vector3(), ly = new THREE.Vector3(), snapped = new THREE.Vector3();
  function place(focus = state.focus, reach = state.reach) {
    state.focus.copy(focus); state.reach = reach;
    lx.crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
    if (lx.lengthSq() < 1e-6) lx.set(1, 0, 0);
    ly.crossVectors(sunDir, lx).normalize();
    const texel = (2 * reach) / sun.shadow.mapSize.x;
    const a = Math.round(focus.dot(lx) / texel) * texel, b = Math.round(focus.dot(ly) / texel) * texel, c = focus.dot(sunDir);
    snapped.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(sunDir, c);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(sunDir, reach * 3);
    if (sun.shadow.camera.right !== reach) {
      Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: reach * 6 });
      sun.shadow.camera.updateProjectionMatrix();
    }
  }

  /** For foliage transmission: sun direction in view space and its color × strength. */
  function treeLight(uniforms, camera) {
    uniforms.uSunDirView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    uniforms.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity / 3.4);
  }

  /** Swap in a built ground mesh (typed arrays from buildGroundArrays, usually via the worker). */
  function setGround(a) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
    // Grass tiles every 4 m in world space, so it never stretches over a slope's plan size.
    const uv = new Float32Array(a.position.length / 3 * 2);
    for (let i = 0, j = 0; i < a.position.length; i += 3, j += 2) { uv[j] = a.position[i] / 4; uv[j + 1] = a.position[i + 2] / 4; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(a.index, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    ground.geometry.dispose();
    ground.geometry = geo;
    if (a.mask) {
      const u = ground.material.userData.uniforms;
      const t = new THREE.DataTexture(a.mask, a.maskSize[0], a.maskSize[1], THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      t.needsUpdate = true;
      u.uMask.value.dispose();
      u.uMask.value = t;
      u.uMaskBounds.value.set(...a.maskBounds);
    }
    setCover(a.cover);
  }

  /** Palette and far-field share for a resolved cover (from resolveCover). */
  function setCover(cover) {
    if (!cover) return;
    const u = ground.material.userData.uniforms, p = PALETTES[cover.palette] ?? PALETTES.green;
    u.uBare.value = 1 - cover.grass; u.uSparse.value = p.sparse ?? 0; u.uGravel.value.set(...(p.gravel ?? [1, 1, 1]));
    u.uSoilA.value.set(...p.soil[0]); u.uSoilB.value.set(...p.soil[1]);
    ground.material.color.setRGB(...p.grass);
  }

  /** 0 = no haze (default), 1 = the old sky-matched haze. */
  function setHaze(amount) { scene.fog.density = HAZE * Math.max(0, amount); }

  return { sky, sun, ground, setGround, setHour, setHaze, place, treeLight, sunDir, state };
}

/** three.js ACESFilmicToneMapping + sRGB encode, in JS. */
const srgb = (x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

/** Khronos PBR Neutral (three.js NeutralToneMapping) + sRGB encode, in JS. */
function displayColorNeutral(c, exposure, out) {
  let v = [c.r * exposure, c.g * exposure, c.b * exposure];
  const x = Math.min(...v), offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  v = v.map((e) => e - offset);
  const start = 0.76, peak = Math.max(...v);
  if (peak >= start) {
    const d = 1 - start, np = 1 - d * d / (peak + d - start);
    v = v.map((e) => e * np / peak);
    const g = 1 - 1 / (0.15 * (peak - np) + 1);
    v = v.map((e) => e + (np - e) * g);
  }
  const o = v.map((e) => srgb(Math.min(Math.max(e, 0), 1)));
  return out.setRGB(o[0], o[1], o[2], 'srgb-linear');
}

function displayColor(c, exposure, out, neutral = false) {
  if (neutral) return displayColorNeutral(c, exposure, out);
  const k = exposure / 0.6, v = [c.r * k, c.g * k, c.b * k];
  const a = [
    0.59719 * v[0] + 0.35458 * v[1] + 0.04823 * v[2],
    0.07600 * v[0] + 0.90834 * v[1] + 0.01566 * v[2],
    0.02840 * v[0] + 0.13383 * v[1] + 0.83777 * v[2],
  ].map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  const o = [
    1.60475 * a[0] - 0.53108 * a[1] - 0.07367 * a[2],
    -0.10208 * a[0] + 1.10813 * a[1] - 0.00605 * a[2],
    -0.00327 * a[0] - 0.07276 * a[1] + 1.07602 * a[2],
  ].map((x) => Math.min(Math.max(x, 0), 1)).map((x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
  return out.setRGB(o[0], o[1], o[2], 'srgb-linear');
}

/* ---------------------------------------------------------------- ground */

function makeGround(THREE) {
  // Fine grass texture tiled every 4 m, and slow tonal patches baked into vertex colors so the
  // tiling never reads.
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#616a47'; g.fillRect(0, 0, 512, 512);
  let s = 7;
  const r = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 | 0) >>> 0) / 4294967296;
  for (let i = 0; i < 26000; i++) {
    const x = r() * 512, y = r() * 512, l = 3 + r() * 9, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
    const k = r();
    g.strokeStyle = k < 0.1 ? '#8c8460' : k < 0.5 ? '#525d3b' : k < 0.85 ? '#6d774f' : '#838a5f';
    g.globalAlpha = 0.55; g.lineWidth = 1 + r();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    // wrap so the tile is seamless
    if (x > 500 || y > 500) { g.beginPath(); g.moveTo(x - 512 * (x > 500), y - 512 * (y > 500)); g.lineTo(x - 512 * (x > 500) + Math.cos(a) * l, y - 512 * (y > 500) + Math.sin(a) * l); g.stroke(); }
  }
  // The lawn's mean colour (linear), so grass blades can be balanced to average exactly this.
  const px = g.getImageData(0, 0, 512, 512).data, lin = (v) => Math.pow(v / 255, 2.2), sum = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += lin(px[i + k]);
  const lawn = new THREE.Color().setRGB(...sum.map((v) => v / (px.length / 4)), THREE.LinearSRGBColorSpace);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  // A flat placeholder until setGround() hands over the built height-field mesh.
  const geo = new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(12).fill(0.9), 3));
  const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 1, metalness: 0 });
  // Surface mask (R path, G surface kind, B soil) painted per fragment, so path edges stay crisp at
  // any mesh resolution. Surfaces are procedural: dirt, gravel, pavement, flagstone.
  const maskTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  maskTex.needsUpdate = true;
  mat.userData.uniforms = { uMask: { value: maskTex }, uMaskBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
    // Cover: bare share for the far field (past the mask), and the palette's two soil tones.
    uBare: { value: 0 }, uSparse: { value: 0 }, uGravel: { value: new THREE.Vector3(1, 1, 1) }, uSoilA: { value: new THREE.Vector3(0.12, 0.075, 0.035) }, uSoilB: { value: new THREE.Vector3(0.2, 0.13, 0.07) } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uMask; uniform vec4 uMaskBounds; uniform float uBare, uSparse; uniform vec3 uSoilA, uSoilB, uGravel; varying vec3 vGW;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y); }
vec2 gCell(vec2 p) { vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 o = vec2(x, y); vec2 c = o + vec2(gHash(i + o), gHash(i + o + 7.7)) * 0.8 + 0.1;
    float d = length(c - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(d1, d2 - d1); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 muv = (vGW.xz - uMaskBounds.xy) / uMaskBounds.zw;
  bool inMask = muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0;
  vec4 m = inMask ? texture2D(uMask, muv) : vec4(0.0);
  // Past the authored extent the cover keeps its patches (coarser, from noise), so a dry scene
  // doesn't turn into a green carpet at the mask edge.
  if (!inMask && uBare > 0.0) {
    float fn = gNoise(vGW.xz * 0.02) * 0.6 + gNoise(vGW.xz * 0.07) * 0.3 + gNoise(vGW.xz * 0.21) * 0.1;
    m.b = smoothstep(0.62 - uBare * 0.5, 0.7 - uBare * 0.5, fn);
  }
  float n = gNoise(vGW.xz * 3.0), n2 = gNoise(vGW.xz * 0.6);
  int kind = int(m.g * 3.0 + 0.5);
  #define SRGB(c) pow(c, vec3(2.2))
  vec3 surf;
  // Frequency clamp: procedural detail finer than about two pixels fades to its mean, so distant
  // paths read as an even tone instead of sparkling noise (shader aliasing that no MSAA can fix).
  float fw = length(fwidth(vGW.xz));
  #define AAK(f) (1.0 - smoothstep(0.2, 0.55, (f) * fw))
  float fine = mix(0.5, gNoise(vGW.xz * 9.0), AAK(9.0)) * 0.6 + mix(0.5, gNoise(vGW.xz * 23.0), AAK(23.0)) * 0.4;
  if (kind == 0) {
    // Dirt: packed soil with scattered small pebbles.
    vec2 pb = gCell(vGW.xz * 7.0);
    surf = mix(vec3(0.40, 0.31, 0.21), vec3(0.56, 0.46, 0.33), n * 0.5 + n2 * 0.2 + fine * 0.3);
    surf = mix(surf, vec3(0.6, 0.56, 0.5), mix(0.02, smoothstep(0.16, 0.1, pb.x) * step(0.72, gHash(floor(vGW.xz * 7.0))), AAK(40.0)));
    surf = SRGB(surf);
  }
  else if (kind == 1) {
    // Gravel: packed pebbles with dark gaps.
    vec2 pb = gCell(vGW.xz * 13.0);
    surf = mix(vec3(0.5, 0.48, 0.44), vec3(0.72, 0.68, 0.62), mix(0.5, gHash(floor(vGW.xz * 13.0) + 0.3), AAK(13.0))) * (0.88 + 0.18 * fine);
    surf = SRGB(surf * mix(0.55, 1.0, mix(0.8, smoothstep(0.02, 0.12, pb.y), AAK(60.0))));
    surf *= uGravel; // palette: dry country gravel is limestone tan, not blue-grey
  }
  else if (kind == 2) surf = SRGB(vec3(0.44, 0.43, 0.41) * (0.92 + 0.08 * n + 0.07 * fine));
  else { vec2 c = gCell(vGW.xz * 1.6); surf = SRGB(mix(vec3(0.3, 0.28, 0.25), mix(vec3(0.58, 0.55, 0.5), vec3(0.68, 0.62, 0.54), gHash(floor(vGW.xz * 1.6))) * (0.9 + 0.15 * n), smoothstep(0.02, 0.07, c.y))); }
  // Bare soil: two palette tones with grain, sparse pebbles and a faint crack network (caliche),
  // all frequency-clamped. The bare share's soft edge is broken up so patches look grazed, not cut.
  vec2 sc = gCell(vGW.xz * 1.3);
  vec3 soil = mix(uSoilA, uSoilB, clamp(n * 0.55 + fine * 0.45, 0.0, 1.0));
  soil *= mix(1.0, mix(0.78, 1.0, smoothstep(0.0, 0.05, sc.y)), AAK(1.3 * 8.0) * 0.6);
  vec2 sp = gCell(vGW.xz * 6.0);
  soil = mix(soil, soil * 1.35 + 0.02, mix(0.03, smoothstep(0.14, 0.08, sp.x) * step(0.8, gHash(floor(vGW.xz * 6.0))), AAK(30.0)));
  float bare = clamp(m.b + (fine - 0.5) * 0.5 * m.b * (1.0 - m.b) * 4.0, 0.0, 1.0);
  // Dry cover: soil shows between tufts inside grassy areas too (bunchgrass, not lawn).
  bare = max(bare, uSparse * smoothstep(0.35, 0.75, gNoise(vGW.xz * 1.7) * 0.6 + fine * 0.4) * (1.0 - m.r));
  float edge = smoothstep(0.0, 1.0, m.r + (n - 0.5) * 0.35 * (1.0 - m.r));
  diffuseColor.rgb = mix(diffuseColor.rgb, soil * vColor.g / 0.95, bare * 0.95);
  diffuseColor.rgb = mix(diffuseColor.rgb, surf * min(vColor.g * 1.1, 1.0), clamp(edge, 0.0, 1.0));
  // Steep ground: grass gives way to scree and soil, then weathered rock. No bed stripes here: real
  // bedded faces are cliff walls (lib/cliffs.js); a height-field slope is a scree or rocky bank.
  // Steepness comes from the smooth interpolated normal, not per-triangle derivatives, so the mesh's
  // facets never show as tiles.
  {
    vec3 wN = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);
    wN *= sign(wN.y + 1e-4);
    float scree = smoothstep(0.86, 0.7, wN.y) * (1.0 - m.r);
    float rock = smoothstep(0.66, 0.5, wN.y + (gNoise(vGW.xz * 0.35 + vGW.y * 0.2) - 0.5) * 0.12) * (1.0 - m.r);
    if (scree > 0.001) {
      vec2 sc2 = gCell(vGW.xz * 2.2 + vGW.y * 0.7);
      // (sRGB constants through SRGB(): these were once fed in as linear and came out concrete-pale.)
      vec3 talus = mix(uSoilA * 1.3, SRGB(vec3(0.47, 0.43, 0.37)), 0.5) * (0.75 + 0.35 * fine);
      talus = mix(talus, talus * 0.7, smoothstep(0.03, 0.0, sc2.y) * AAK(2.2 * 6.0));
      vec3 stone = SRGB(vec3(0.56, 0.53, 0.47)) * (0.7 + 0.4 * gNoise(vGW.xz * 0.5 + vGW.y * 0.9)) * (0.9 + 0.15 * fine);
      vec3 bank = mix(talus, stone, rock);
      // Grass and soil hold on in patches between the bare rock, more where it is less steep.
      float holds = smoothstep(0.45, 0.7, gNoise(vGW.xz * 0.22 + 3.1) * 0.6 + gNoise(vGW.xz * 0.9) * 0.25 + fine * 0.15) * (1.0 - rock * 0.8);
      diffuseColor.rgb = mix(diffuseColor.rgb, bank * mix(0.75, 1.0, vColor.g), clamp(scree * 0.85 + rock * 0.15, 0.0, 1.0) * (1.0 - holds * 0.85));
    }
  }
}`);
  };
  mat.customProgramCacheKey = () => 'alian-ground';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  mesh.userData.lawn = lawn;
  return mesh;
}
