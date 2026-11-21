// Ground cover: grass clumps in tiles around the camera.
//
// Tiles are seeded by their coordinates, so the same grass always grows in the same place. Every
// clump scales in from zero with distance in the shader, and tiles are only added or dropped where
// that scale is already zero, so walking never shows grass popping in. Clumps keep the ground's
// up-facing normal, so they light exactly like the grade they grow from.

import { rng } from './grow.js';
import { bleed } from './materials.js';

const TILE = 10;

function grassTexture(THREE) {
  const W = 256, c = document.createElement('canvas'); c.width = c.height = W;
  const g = c.getContext('2d'), r = rng(4242);
  for (let i = 0; i < 110; i++) {
    const x = W * (0.04 + r() * 0.92), h = W * (0.35 + r() * 0.63), lean = (r() - 0.5) * W * 0.3, wBase = W * (0.01 + r() * 0.01);
    // Close to the ground texture's own greens, so a clump reads as more of the same lawn.
    const k = r(), col = k < 0.15 ? [120, 116, 70] : k < 0.6 ? [84, 95, 48] : [98, 107, 56];
    const grad = g.createLinearGradient(0, W, 0, W - h);
    grad.addColorStop(0, `rgb(${col.map((v) => v * 0.7 | 0)})`);
    grad.addColorStop(1, `rgb(${col.map((v) => Math.min(255, v * 1.12) | 0)})`);
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(x - wBase, W);
    g.quadraticCurveTo(x - wBase * 0.4 + lean * 0.3, W - h * 0.6, x + lean, W - h);
    g.quadraticCurveTo(x + wBase * 0.4 + lean * 0.3, W - h * 0.6, x + wBase, W);
    g.fill();
  }
  const tex = new THREE.DataTexture(bleed(g.getImageData(0, 0, W, W)), W, W, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function clumpGeometry(THREE) {
  // Three crossed cards, 0.5 m wide and 0.3 m tall, with upward normals.
  const pos = [], uv = [], nor = [], idx = [];
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI / 3, cx = Math.cos(a) * 0.25, cz = Math.sin(a) * 0.25, b = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      pos.push((u * 2 - 1) * cx, v * 0.3, (u * 2 - 1) * cz); uv.push(u, v); nor.push(0, 1, 0);
    }
    idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function createGrass(THREE, { uniforms, radius = 40, fadeFrom = 18, density = 3.2, capacity = 24000, stable = true } = {}) {
  const map = grassTexture(THREE);
  // Lawn colour that far blades melt into: the ground texture's base green under its vertex tone.
  // (THREE.Color already converts hex from sRGB to the linear working space.)
  const lawn = new THREE.Color(0x626b3b).multiplyScalar(0.9);
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  // Stability (what made grass edges vibrate): blades are a few texels wide, so past ~10 m they go
  // sub-pixel. Three things keep them steady:
  //   far blades lose their fast sway (sub-pixel motion every frame reads as shimmer, not wind),
  //   alpha is scaled back up per mip level so thinning blades don't flicker in and out of coverage,
  //   and blades blend toward the lawn colour before they shrink, so what remains has no contrast.
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uFadeFrom: { value: fadeFrom }, uFadeTo: { value: radius - 4 }, uLawn: { value: lawn } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind; uniform vec2 uWindDir; uniform float uFadeFrom; uniform float uFadeTo;\nvarying float vFar;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float d = distance(root.xz, cameraPosition.xz);
  float fade = 1.0 - smoothstep(uFadeFrom, uFadeTo, d);
  vFar = smoothstep(uFadeFrom * 0.45, uFadeFrom, d);
  transformed *= fade;
  float calm = 1.0 - smoothstep(6.0, uFadeFrom, d);
  float sway = sin(uTime * 1.7 + dot(root.xz, vec2(0.31, 0.47))) * 0.5 + sin(uTime * 3.1 + root.x * 0.9) * 0.2 * calm;
  transformed.xz += uWindDir * sway * uv.y * uv.y * (0.05 + 0.12 * uWind) * mix(0.3, 1.0, calm);
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLawn; varying float vFar;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv, 0.5);
  diffuseColor *= sampledDiffuseColor;
  {
    vec2 texel = vMapUv * vec2(textureSize(map, 0));
    vec2 ddx = dFdx(texel), ddy = dFdy(texel);
    float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
    diffuseColor.a *= 1.0 + mip * 0.35;
  }
#endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, uLawn, vFar * 0.75);`)
      // Double-sided cards flip the normal on back faces, so half of every clump lit from below
      // and read as dark speckle. Both faces keep the ground's up normal.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal); nonPerturbedNormal = normal;');
  };
  if (!stable) mat.onBeforeCompile = legacy(uniforms, fadeFrom, radius);
  mat.customProgramCacheKey = () => (stable ? 'alian-grass-stable' : 'alian-grass');
  const mesh = new THREE.InstancedMesh(clumpGeometry(THREE), mat, capacity);
  mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.name = 'grass';

  let ground = null, centre = null;
  const tiles = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();

  function grow(tx, tz) {
    const key = `${tx},${tz}`;
    const r = rng((tx * 73856093) ^ (tz * 19349663) ^ 0x2a);
    const n = Math.round(TILE * TILE * density), mats = [], cols = [];
    for (let i = 0; i < n; i++) {
      const x = (tx + r()) * TILE, z = (tz + r()) * TILE;
      const s = ground.surfaceAt(x, z);
      if (s.blocked || s.path > 0.15 || s.soil > 0.45) { r(); r(); r(); continue; }
      const y = ground.heightAt(x, z);
      const e2 = 0.5, slope = Math.hypot(ground.heightAt(x + e2, z) - ground.heightAt(x - e2, z), ground.heightAt(x, z + e2) - ground.heightAt(x, z - e2)) / (2 * e2);
      if (slope > 1.1 || r() < slope * 0.5) { r(); r(); continue; }
      const k = 0.7 + r() * 0.6;
      q.setFromEuler(e.set((r() - 0.5) * 0.2, r() * Math.PI, (r() - 0.5) * 0.2));
      m4.compose(p.set(x, y - 0.02, z), q, sc.set(k, k * (0.8 + r() * 0.5), k));
      mats.push(...m4.elements);
      c.setRGB(0.88 + r() * 0.2, 0.9 + r() * 0.16, 0.86 + r() * 0.16);
      cols.push(c.r, c.g, c.b);
    }
    const t = { mats: new Float32Array(mats), cols: new Float32Array(cols) };
    tiles.set(key, t);
    return t;
  }

  // Tiles grow at most two per frame, and only where the fade already hides them, so long walks
  // never hitch and nothing appears in view.
  let wanted = [], pending = [];
  function plan(cx, cz) {
    const R = Math.ceil(radius / TILE);
    wanted = []; pending = [];
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      // Distance between the camera's tile and this one: any point of either.
      const dx = Math.max(0, Math.abs(i) - 1) * TILE, dz = Math.max(0, Math.abs(j) - 1) * TILE;
      if (Math.hypot(dx, dz) > radius) continue;
      const key = `${cx + i},${cz + j}`;
      wanted.push(key);
      if (!tiles.has(key)) pending.push([cx + i, cz + j, Math.hypot(i, j)]);
    }
    pending.sort((a, b) => a[2] - b[2]);
  }
  function upload() {
    let k = 0;
    for (const key of wanted) {
      const t = tiles.get(key);
      if (!t) continue;
      const n = t.cols.length / 3;
      if (k + n > capacity) break;
      mesh.instanceMatrix.array.set(t.mats, k * 16);
      if (!mesh.instanceColor) mesh.setColorAt(0, c.setRGB(1, 1, 1));
      mesh.instanceColor.array.set(t.cols, k * 3);
      k += n;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    mesh,
    /** New ground: forget every tile. */
    setGround(g) { ground = g; tiles.clear(); centre = null; },
    update(camera) {
      if (!ground) return;
      const cx = Math.floor(camera.position.x / TILE), cz = Math.floor(camera.position.z / TILE);
      let changed = false;
      if (!centre || centre[0] !== cx || centre[1] !== cz) {
        centre = [cx, cz]; plan(cx, cz); changed = true;
        // Forget tiles far behind, so memory stays bounded on long walks.
        if (tiles.size > 600) for (const key of tiles.keys()) { const [a, b] = key.split(',').map(Number); if (Math.abs(a - cx) > 10 || Math.abs(b - cz) > 10) tiles.delete(key); }
      }
      // The first fill after a scene change is immediate; after that, two tiles a frame.
      const budget = tiles.size === 0 ? Infinity : 2;
      for (let n = 0; n < budget && pending.length; n++) { const [tx, tz] = pending.shift(); tiles.set(`${tx},${tz}`, grow(tx, tz)); changed = true; }
      if (changed) upload();
    },
    stats: () => mesh.count,
  };
}

// The pre-stability shader, kept only so the lab can A/B it (?grass=legacy). Delete with the toggle.
function legacy(uniforms, fadeFrom, radius) {
  return (shader) => {
    Object.assign(shader.uniforms, uniforms, { uFadeFrom: { value: fadeFrom }, uFadeTo: { value: radius - 4 } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind; uniform vec2 uWindDir; uniform float uFadeFrom; uniform float uFadeTo;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float fade = 1.0 - smoothstep(uFadeFrom, uFadeTo, distance(root.xz, cameraPosition.xz));
  transformed *= fade;
  float sway = sin(uTime * 1.7 + dot(root.xz, vec2(0.31, 0.47))) * 0.5 + sin(uTime * 3.1 + root.x * 0.9) * 0.2;
  transformed.xz += uWindDir * sway * uv.y * uv.y * (0.05 + 0.12 * uWind);
}`);
  };
}
