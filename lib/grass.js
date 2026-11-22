// Ground cover: grass clumps in tiles around the camera.
//
// Tiles are seeded by their coordinates, so the same grass always grows in the same place. Every
// clump scales in from zero with distance in the shader (true 3D distance, so zooming down from
// above brings grass in by the same rule as walking toward it). A tile that arrives late, because a
// fast zoom or pan outran the streaming, also grows in over half a second instead of appearing. Clumps keep the ground's
// up-facing normal, so they light exactly like the grade they grow from.

import { rng } from './grow.js';
import { bleed } from './materials.js';
import { PALETTES, makeGroundShade } from './ground.js';

const TILE = 10;

function grassTexture(THREE) {
  const W = 256, c = document.createElement('canvas'); c.width = c.height = W;
  const g = c.getContext('2d'), r = rng(4242);
  for (let i = 0; i < 110; i++) {
    const x = W * (0.04 + r() * 0.92), h = W * (0.35 + r() * 0.63), lean = (r() - 0.5) * W * 0.3, wBase = W * (0.01 + r() * 0.01);
    // Close to the ground texture's own greens, so a clump reads as more of the same lawn.
    // Lawn greens with measured-like blue (G/B ≈ 2.5 linear), not neon; a few straw blades.
    const k = r(), col = k < 0.15 ? [118, 114, 80] : k < 0.6 ? [80, 93, 60] : [94, 104, 68];
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

export function createGrass(THREE, { uniforms, radius = 40, fadeFrom = 18, density = 3.2, capacity = 24000, lawn = null } = {}) {
  const map = grassTexture(THREE);
  // Balance: blades are rescaled so a clump averages exactly the ground's lawn colour (the ground
  // texture's measured mean), and each clump carries the ground's own shade and normal at its root.
  // Then near grass is the same shade as the ground around it and far grass melts into it with no
  // dark patches: the ground is grass's low-detail version, the way crown impostors are for trees.
  const lawnMean = lawn ?? new THREE.Color(0x616a47);
  const bladeMean = (() => {
    const d = map.image.data, sum = [0, 0, 0]; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { for (let k = 0; k < 3; k++) sum[k] += Math.pow(d[i + k] / 255, 2.2); n++; }
    return sum.map((v) => v / Math.max(1, n));
  })();
  const balance = new THREE.Vector3(lawnMean.r / bladeMean[0], lawnMean.g / bladeMean[1], lawnMean.b / bladeMean[2]);
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  // Stability (what made grass edges vibrate): blades are a few texels wide, so past ~10 m they go
  // sub-pixel. Three things keep them steady:
  //   far blades lose their fast sway (sub-pixel motion every frame reads as shimmer, not wind),
  //   alpha is scaled back up per mip level so thinning blades don't flicker in and out of coverage,
  //   and blades blend toward the lawn colour before they shrink, so what remains has no contrast.
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uFadeFrom: { value: fadeFrom }, uFadeTo: { value: radius - 4 }, uLawn: { value: lawnMean }, uBalance: { value: balance } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind; uniform vec2 uWindDir; uniform float uFadeFrom; uniform float uFadeTo;\nattribute float aBorn; attribute vec3 aNormal;\nvarying float vFar; varying float vEdge;')
      // Light every clump with the ground's normal at its root, so slopes shade grass as they shade ground.
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\ntransformedNormal = normalize(mat3(viewMatrix) * aNormal);')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float d = distance(root, cameraPosition);
  float fade = (1.0 - smoothstep(uFadeFrom, uFadeTo, d)) * smoothstep(0.0, 0.5, uTime - aBorn);
  vFar = smoothstep(uFadeFrom * 0.45, uFadeFrom, d);
  // How face-on this card is to the eye: seen from above, crossed cards go edge-on and read as
  // asterisks, so edge-on cards fade out (the ground under them is the same shade).
  vec3 cardN = normalize(mat3(modelMatrix * instanceMatrix) * vec3(-position.z, 0.0, position.x) + vec3(1e-4, 0.0, 0.0));
  vec3 toEye = normalize(cameraPosition - root);
  // Seen steeply from above, a clump of cards reads as a star; the lawn texture is the better view.
  vEdge = abs(dot(cardN, toEye)) * (1.0 - smoothstep(0.5, 0.82, toEye.y));
  transformed *= fade;
  float calm = 1.0 - smoothstep(6.0, uFadeFrom, d);
  float sway = sin(uTime * 1.7 + dot(root.xz, vec2(0.31, 0.47))) * 0.5 + sin(uTime * 3.1 + root.x * 0.9) * 0.2 * calm;
  transformed.xz += uWindDir * sway * uv.y * uv.y * (0.05 + 0.12 * uWind) * mix(0.3, 1.0, calm);
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLawn, uBalance; varying float vFar; varying float vEdge;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv, 0.5);
  diffuseColor *= sampledDiffuseColor;
  {
    vec2 texel = vMapUv * vec2(textureSize(map, 0));
    vec2 ddx = dFdx(texel), ddy = dFdy(texel);
    float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
    diffuseColor.a *= 1.0 + mip * 0.35;
    diffuseColor.a *= smoothstep(0.08, 0.3, vEdge);
  }
#endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb * uBalance, uLawn * vColor.rgb * diffuse, vFar);`)
      // Double-sided cards flip the normal on back faces, so half of every clump lit from below
      // and read as dark speckle. Both faces keep the ground's up normal.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal); nonPerturbedNormal = normal;');
  };
  mat.customProgramCacheKey = () => 'alian-grass';
  const mesh = new THREE.InstancedMesh(clumpGeometry(THREE), mat, capacity);
  mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
  // Grass writes no depth: screen-space occlusion (N8AO) then can't see 30 cm clumps as occluders,
  // which darkened a metre-wide halo round each one into dark blotches. It still depth-tests, and
  // draws after the opaque scene so ground, trees and rock hide it correctly. Blades are one colour
  // family, so their order among themselves doesn't show; TAA reprojects them with the ground's depth.
  mat.depthWrite = false; mesh.renderOrder = 1;
  mesh.name = 'grass';
  // When each clump's tile arrived (seconds on the shared clock); the shader grows it in from then.
  const born = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(-1e4), 1);
  mesh.geometry.setAttribute('aBorn', born);
  const normals = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.geometry.setAttribute('aNormal', normals);

  let ground = null, shade = makeGroundShade(), centre = null;
  const tiles = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();

  function grow(tx, tz) {
    const key = `${tx},${tz}`;
    const r = rng((tx * 73856093) ^ (tz * 19349663) ^ 0x2a);
    // Dry palettes grow bunchgrass: fewer clumps, so soil shows between them.
    const sparse = PALETTES[ground.cover?.palette]?.sparse ?? 0;
    const n = Math.round(TILE * TILE * density * (1 - sparse * 0.5)), mats = [], cols = [], nors = [];
    for (let i = 0; i < n; i++) {
      const x = (tx + r()) * TILE, z = (tz + r()) * TILE;
      if (!ground.inside(x, z, 0.15)) { r(); r(); r(); r(); continue; }
      const s = ground.surfaceAt(x, z);
      // Bare ground thins grass out over a fringe instead of cutting it at a line.
      if (s.blocked || s.path > 0.15 || r() < s.soil * 1.6 - 0.15) { r(); r(); r(); continue; }
      const y = ground.heightAt(x, z);
      const e2 = 0.5, gx = (ground.heightAt(x + e2, z) - ground.heightAt(x - e2, z)) / (2 * e2), gz = (ground.heightAt(x, z + e2) - ground.heightAt(x, z - e2)) / (2 * e2), slope = Math.hypot(gx, gz);
      if (slope > 1.1 || r() < slope * 0.5) { r(); r(); continue; }
      // Lawn thins in a crown's deep shade, where leaf litter takes over.
      if (r() < (1 - shade.occ(x, z)) * 2.4) { r(); r(); r(); r(); continue; }
      const k = 0.7 + r() * 0.6;
      q.setFromEuler(e.set((r() - 0.5) * 0.2, r() * Math.PI, (r() - 0.5) * 0.2));
      m4.compose(p.set(x, y - 0.02, z), q, sc.set(k, k * (0.8 + r() * 0.5), k));
      mats.push(...m4.elements);
      // The ground's shade here, with a little per-clump variation around it.
      const [sr, sg, sb] = shade(x, z, slope), v = 0.94 + r() * 0.12, hue = (r() - 0.5) * 0.06;
      cols.push(sr * v * (1 + hue), sg * v, sb * v * (1 - hue));
      const nl = Math.hypot(gx, 1, gz);
      nors.push(-gx / nl, 1 / nl, -gz / nl);
    }
    // The first fill after a scene change shows at once (the scene fades in anyway); later tiles grow in.
    const t = { mats: new Float32Array(mats), cols: new Float32Array(cols), nors: new Float32Array(nors), born: tiles.size === 0 ? -1e4 : uniforms.uTime.value };
    tiles.set(key, t);
    return t;
  }

  // Tiles grow at most four per frame, so long walks never hitch; a tile that lands in view grows in.
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
      born.array.fill(t.born, k, k + n);
      normals.array.set(t.nors, k * 3);
      k += n;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    born.needsUpdate = true; normals.needsUpdate = true;
  }

  return {
    mesh,
    /** New ground: forget every tile. `occluders` are the ground's (tree contact shade). */
    setGround(g, { occluders = [] } = {}) {
      ground = g; shade = makeGroundShade(occluders); tiles.clear(); centre = null;
      // Palette: dry cover turns the same blades to straw.
      const tint = PALETTES[g.cover?.palette]?.grass ?? [1, 1, 1];
      mat.color.setRGB(...tint);
    },
    update(camera) {
      if (!ground) return;
      const cx = Math.floor(camera.position.x / TILE), cz = Math.floor(camera.position.z / TILE);
      let changed = false;
      if (!centre || centre[0] !== cx || centre[1] !== cz) {
        centre = [cx, cz]; plan(cx, cz); changed = true;
        // Forget tiles far behind, so memory stays bounded on long walks.
        if (tiles.size > 600) for (const key of tiles.keys()) { const [a, b] = key.split(',').map(Number); if (Math.abs(a - cx) > 10 || Math.abs(b - cz) > 10) tiles.delete(key); }
      }
      // The first fill after a scene change is immediate; after that, four tiles a frame.
      const budget = tiles.size === 0 ? Infinity : 4;
      for (let n = 0; n < budget && pending.length; n++) { const [tx, tz] = pending.shift(); tiles.set(`${tx},${tz}`, grow(tx, tz)); changed = true; }
      if (changed) upload();
    },
    stats: () => mesh.count,
  };
}
