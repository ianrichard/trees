// Bark and foliage materials: stock MeshStandardMaterial plus three small shader patches.
//   wind     trunk bend ∝ height², limb sway ∝ reach², leaf flutter at card tips. Phase comes from
//            the tree's world position, so a grove never moves in lockstep and shadows move with it.
//   crown    foliage keeps its crown normal on both faces (stock double-sided flips it per face).
//   transmit sunlight through leaves when you look toward the sun, scaled by crown occlusion.

import { KINDS } from './species.js';
import { rng } from './grow.js';

/** Shared uniforms: one object for every tree material, updated once per frame. */
export function createTreeUniforms(THREE) {
  return {
    uTime: { value: 0 },
    uWind: { value: 0.5 },
    uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
    uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
  };
}

const WIND = /* glsl */`
  vec3 treeOrigin = modelMatrix[3].xyz;
  #ifdef USE_INSTANCING
    treeOrigin += instanceMatrix[3].xyz;
  #endif
  float ph = dot(treeOrigin.xz, vec2(0.137, 0.173));
  float hN = max(transformed.y, 0.0) / uTreeH;
  float gust = 0.55 + 0.45 * sin(uTime * 0.31 + ph * 0.7) * sin(uTime * 0.17 + ph);
  float sway = 0.55 + 0.35 * sin(uTime * 0.8 + ph) + 0.15 * sin(uTime * 1.9 + ph * 1.7);
  transformed.xz += uWindDir * (sway * gust * uWind * 0.018 * uTreeH * hN * hN);
  float reach = length(transformed.xz) / uTreeR;
  float limb = reach * reach * uWind * gust;
  float wave = sin(uTime * 2.1 + ph + dot(transformed.xz, vec2(0.7, 0.9)) + transformed.y * 0.4);
  transformed.y += wave * limb * 0.025 * uTreeR;
  transformed.xz += uWindDir * wave * limb * 0.012 * uTreeR;
`;

// How squarely a card faces the eye. Edge-on cards smear into streaks, so they fade out.
const FACING = /* glsl */`
  vec4 faceDir = vec4(aFace, 0.0);
  #ifdef USE_INSTANCING
    faceDir = instanceMatrix * faceDir;
  #endif
  vFacing = abs(dot(normalize((modelViewMatrix * faceDir).xyz), normalize(-mvPosition.xyz)));
`;

const FLUTTER = /* glsl */`
  float flutter = sin(uTime * 9.0 + ph * 5.0 + dot(position, vec3(4.1, 3.3, 5.7)));
  transformed += normal * flutter * aTip * (0.025 + 0.05 * uWind) * uLeafSize;
`;

function patch(material, { uniforms, kind, leaf, depth }) {
  const spec = KINDS[kind];
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uTreeH: { value: spec.height }, uTreeR: { value: spec.width * 0.5 },
      uLeafSize: { value: spec.leaf.size }, uTransmit: { value: spec.sss },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uWind; uniform vec2 uWindDir; uniform float uTreeH; uniform float uTreeR; uniform float uLeafSize;
${leaf ? 'attribute float aTip; attribute vec3 aFace; varying float vFacing;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
${WIND}
${leaf ? FLUTTER : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
${leaf ? FACING : ''}`);
    if (leaf) {
      // Mip-aware alpha: distant mips average leaf edges toward transparent, so foliage thins and
      // speckles with distance. Scale alpha back up per mip level to hold coverage.
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFacing;')
        .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
{
  vec2 texel = vMapUv * vec2(textureSize(map, 0));
  vec2 ddx = dFdx(texel), ddy = dFdy(texel);
  float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
  diffuseColor.a *= 1.0 + mip * 0.28;
}
#endif
${depth ? '' : 'diffuseColor.a *= smoothstep(0.06, 0.32, vFacing);'}`);
    }
    if (leaf && !depth) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uSunDirView; uniform vec3 uSunColor; uniform float uTransmit;`)
        // Keep the crown normal on back faces: the canopy should light as one volume.
        .replace('#include <normal_fragment_begin>', THREE_CHUNKS.normal_fragment_begin.replaceAll('normal *= faceDirection;', ''))
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
// Leaves are matte at grazing angles; stock Fresnel turns crown tops white against a bright sky.
reflectedLight.indirectSpecular *= 0.3;
{
  vec3 toEye = normalize(vViewPosition);
  float back = pow(max(dot(-toEye, uSunDirView), 0.0), 5.0);
  float through = max(-dot(normal, uSunDirView), 0.0) * 0.35;
  float occ = vColor.g;
  vec3 tint = diffuseColor.rgb * diffuseColor.rgb * vec3(2.2, 2.6, 0.9);
  reflectedLight.directDiffuse += tint * uSunColor * (back * 0.9 + through) * uTransmit * clamp(occ * occ, 0.0, 1.0);
}`);
    }
  };
  material.customProgramCacheKey = () => `alian-tree-${kind}-${leaf ? 'leaf' : 'bark'}-${depth ? 'd' : 'c'}`;
  return material;
}

let THREE_CHUNKS = null;

/* ---------------------------------------------------------------- leaf textures */

function leafOutline(ctx, shape, L, W, r) {
  ctx.beginPath();
  if (shape === 'maple') {
    // Palmate: five pointed lobes.
    const pts = 60;
    for (let i = 0; i <= pts; i++) {
      const a = i / pts * Math.PI * 2;
      const lobe = Math.pow(Math.abs(Math.cos(a * 2.5)), 3);
      const rr = L * (0.38 + 0.62 * lobe) * (a > Math.PI * 0.75 && a < Math.PI * 1.25 ? 0.4 : 1);
      const x = Math.sin(a) * rr, y = -Math.cos(a) * rr * 0.95 - L * 0.05;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
  } else if (shape === 'oak') {
    // Lobed along the midrib.
    const pts = 40, lobes = 4 + ((r() * 2) | 0);
    const side = (sgn) => {
      for (let i = 0; i <= pts; i++) {
        const t = i / pts, w = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.8) * W * (0.6 + 0.4 * Math.abs(Math.sin(t * Math.PI * lobes)));
        const x = sgn * w, y = -t * L;
        (i || sgn < 0) ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
    };
    side(1);
    for (let i = 40; i >= 0; i--) {
      const t = i / 40, w = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.8) * W * (0.6 + 0.4 * Math.abs(Math.sin(t * Math.PI * lobes)));
      ctx.lineTo(-w, -t * L);
    }
  } else {
    // Ovate with a drawn-out tip and fine teeth (birch, shrub).
    const pts = 46;
    for (let i = 0; i <= pts; i++) {
      const t = i / pts, w = Math.pow(Math.sin(Math.PI * t), 0.9) * Math.pow(1 - t, 0.35) * W * (1 + 0.06 * Math.sin(t * 60));
      i ? ctx.lineTo(w, -t * L) : ctx.moveTo(w, 0);
    }
    for (let i = pts; i >= 0; i--) {
      const t = i / pts, w = Math.pow(Math.sin(Math.PI * t), 0.9) * Math.pow(1 - t, 0.35) * W * (1 + 0.06 * Math.sin(t * 60 + 1));
      ctx.lineTo(-w, -t * L);
    }
  }
  ctx.closePath();
}

function paintCluster(ctx, ox, size, spec, r) {
  const shape = spec.leaf.shape, cols = spec.leaf.color;
  const pick = () => cols[(r() * cols.length) | 0];
  ctx.save();
  ctx.translate(ox + size / 2, size);
  ctx.lineCap = 'round';
  if (shape === 'needle') {
    // A pine spray: a twig with tufts of needles along it.
    const twigs = 3 + ((r() * 2) | 0);
    for (let tw = 0; tw < twigs; tw++) {
      const ang = (tw - (twigs - 1) / 2) * 0.42 + (r() - 0.5) * 0.2;
      const lenT = size * (0.72 + r() * 0.2);
      ctx.save(); ctx.rotate(ang);
      ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = size * 0.014;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -lenT); ctx.stroke();
      for (let k = 0; k < 190; k++) {
        const t = 0.05 + r() * 0.95, y = -t * lenT, a = (r() - 0.5) * 2.6, nl = size * (0.08 + r() * 0.06) * (1.15 - t * 0.45);
        ctx.strokeStyle = shade(pick(), 0.8 + r() * 0.5); ctx.globalAlpha = 1;
        ctx.lineWidth = size * (0.009 + r() * 0.006);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(Math.sin(a) * nl, y - Math.cos(a) * nl * 0.7 - nl * 0.3); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
    return;
  }
  // Broadleaf spray: a short twig with alternate leaves, painted back to front.
  const count = shape === 'maple' ? 9 : shape === 'oak' ? 13 : 17;
  const leafL = size * (shape === 'maple' ? 0.27 : shape === 'oak' ? 0.24 : 0.17);
  ctx.strokeStyle = '#4f4030'; ctx.lineWidth = size * 0.012;
  const twig = [];
  for (let b = 0; b < 3; b++) {
    const ang = (b - 1) * 0.55 + (r() - 0.5) * 0.3, l = size * (0.55 + r() * 0.25);
    twig.push({ ang, l });
    ctx.save(); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(size * 0.03, -l * 0.5, 0, -l); ctx.stroke(); ctx.restore();
  }
  const leaves = [];
  for (let k = 0; k < count; k++) {
    const tw = twig[k % 3], t = 0.25 + r() * 0.75;
    const side = k % 2 ? 1 : -1;
    leaves.push({ tw, t, a: tw.ang + side * (0.5 + r() * 0.7) * (1 - t * 0.5), s: 0.75 + r() * 0.45, depth: r() });
  }
  leaves.sort((a, b) => a.depth - b.depth);
  for (const lf of leaves) {
    const bx = Math.sin(lf.tw.ang) * lf.tw.l * lf.t, by = -Math.cos(lf.tw.ang) * lf.tw.l * lf.t;
    ctx.save();
    ctx.translate(bx, by); ctx.rotate(lf.a);
    const L = leafL * lf.s, W = L * (shape === 'birch' ? 0.42 : 0.38);
    const base = pick(), light = 0.78 + lf.depth * 0.32;
    const g = ctx.createLinearGradient(0, 0, 0, -L);
    g.addColorStop(0, shade(base, light * 0.8));
    g.addColorStop(0.6, shade(base, light));
    g.addColorStop(1, shade(base, light * 1.12));
    ctx.fillStyle = g;
    leafOutline(ctx, shape, L, W, r);
    ctx.fill();
    // Midrib and a couple of veins catch light.
    ctx.strokeStyle = shade(base, light * 1.3); ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(1, size * 0.003);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -L * 0.85); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  ctx.restore();
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Two foliage sprays side by side (cards pick a half), painted once per kind. */
export function leafTexture(THREE, kind, size = 512) {
  const spec = KINDS[kind];
  const canvas = document.createElement('canvas');
  canvas.width = size * 2; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = rng(kind.length * 977 + 3);
  paintCluster(ctx, 0, size, spec, r);
  paintCluster(ctx, size, size, spec, r);
  const tex = new THREE.DataTexture(bleed(ctx.getImageData(0, 0, size * 2, size)), size * 2, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Fill every transparent pixel with the color of its nearest leaf. A canvas stores transparent
 * pixels as black, and filtering and mipmaps pull that black into every leaf edge, which reads as
 * a drawn outline. Returns rows bottom-up, as WebGL expects for v = 0 at the stem.
 */
function bleed(img) {
  const { width: w, height: h, data } = img;
  const n = w * h, rgb = new Float32Array(n * 3), known = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] > 8) {
    known[i] = 1; rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  let frontier = [];
  for (let i = 0; i < n; i++) if (!known[i]) frontier.push(i);
  for (let pass = 0; pass < 48 && frontier.length; pass++) {
    const next = [], fill = [];
    for (const i of frontier) {
      const x = i % w, y = (i / w) | 0;
      let c = 0, a = 0, b = 0, d = 0;
      if (x > 0 && known[i - 1]) { a += rgb[(i - 1) * 3]; b += rgb[(i - 1) * 3 + 1]; d += rgb[(i - 1) * 3 + 2]; c++; }
      if (x < w - 1 && known[i + 1]) { a += rgb[(i + 1) * 3]; b += rgb[(i + 1) * 3 + 1]; d += rgb[(i + 1) * 3 + 2]; c++; }
      if (y > 0 && known[i - w]) { a += rgb[(i - w) * 3]; b += rgb[(i - w) * 3 + 1]; d += rgb[(i - w) * 3 + 2]; c++; }
      if (y < h - 1 && known[i + w]) { a += rgb[(i + w) * 3]; b += rgb[(i + w) * 3 + 1]; d += rgb[(i + w) * 3 + 2]; c++; }
      if (c) fill.push(i, a / c, b / c, d / c); else next.push(i);
    }
    for (let k = 0; k < fill.length; k += 4) {
      const i = fill[k]; known[i] = 1; rgb[i * 3] = fill[k + 1]; rgb[i * 3 + 1] = fill[k + 2]; rgb[i * 3 + 2] = fill[k + 3];
    }
    frontier = next;
  }
  // Anything still unreached takes the mean leaf color.
  let mr = 0, mg = 0, mb = 0, m = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] > 8) { mr += data[i * 4]; mg += data[i * 4 + 1]; mb += data[i * 4 + 2]; m++; }
  m = m || 1;
  const out = new Uint8Array(n * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = ((h - 1 - y) * w + x) * 4;
    out[o] = known[i] ? rgb[i * 3] : mr / m; out[o + 1] = known[i] ? rgb[i * 3 + 1] : mg / m; out[o + 2] = known[i] ? rgb[i * 3 + 2] : mb / m;
    out[o + 3] = data[i * 4 + 3];
  }
  return out;
}

/* ---------------------------------------------------------------- material sets */

/**
 * Materials for one kind. `bark` is optional { map, normalMap } (sRGB albedo + normal); without it the
 * bark is a plain tinted surface, which reads fine past a few meters.
 */
export function treeMaterials(THREE, kind, uniforms, bark = null) {
  THREE_CHUNKS = THREE.ShaderChunk;
  const spec = KINDS[kind];
  const leafMap = leafTexture(THREE, kind);
  const barkMat = patch(new THREE.MeshStandardMaterial({
    color: bark?.map ? new THREE.Color('#ffffff').lerp(new THREE.Color(spec.bark.color), 0.25) : spec.bark.color,
    map: bark?.map ?? null, normalMap: bark?.normalMap ?? null,
    normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95, metalness: 0, vertexColors: true,
  }), { uniforms, kind, leaf: false });
  const leafMat = patch(new THREE.MeshStandardMaterial({
    map: leafMap, alphaTest: spec.leaf.alphaTest ?? 0.45, alphaToCoverage: true, side: THREE.DoubleSide,
    roughness: 0.72, metalness: 0, vertexColors: true,
    color: '#ffffff',
  }), { uniforms, kind, leaf: true });
  const barkDepth = patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), { uniforms, kind, leaf: false, depth: true });
  const leafDepth = patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafMap, alphaTest: spec.leaf.alphaTest ?? 0.45 }), { uniforms, kind, leaf: true, depth: true });
  return { bark: barkMat, leaf: leafMat, barkDepth, leafDepth, leafMap };
}
