import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createForest, resolveTree } from './lib/forest.js';
import { createOutdoors } from './lib/outdoors.js';
import { KINDS, KIND_NAMES } from './lib/species.js';
import { rng } from './lib/grow.js';
import { buildGroundArrays } from './lib/ground.js';
import { resolveScene, sceneOf } from './lib/scene.js';
import { buildRocks, stoneMaterial } from './lib/rocks.js';
import { buildHouse } from './lib/house.js';
import { createGrass } from './lib/grass.js';
import { createTour, createWalk } from './lib/explore.js';
import { createTemporalAA } from './lib/taa.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
// Lab A/B levers: the Edges buttons (remembered per browser) or ?aa=taa|msaa&grass=stable|legacy.
const LAB_DEFAULTS = { aa: 'taa', grass: 'stable' };
const query = new URLSearchParams(location.search);
const remembered = (() => { try { return JSON.parse(localStorage.getItem('trees-lab') ?? '{}'); } catch { return {}; } })();
const lab = { get: (k) => query.get(k) ?? remembered[k] ?? LAB_DEFAULTS[k] };
for (const b of document.querySelectorAll('[data-lab]')) {
  b.setAttribute('aria-pressed', String(lab.get(b.dataset.lab) === b.dataset.value));
  b.addEventListener('click', () => {
    try { localStorage.setItem('trees-lab', JSON.stringify({ ...remembered, [b.dataset.lab]: b.dataset.value })); } catch {}
    if (query.has(b.dataset.lab)) { query.set(b.dataset.lab, b.dataset.value); location.search = query.toString(); } else location.reload();
  });
}
const useTAA = lab.get('aa') === 'taa';
// With TAA the canvas only receives a full-screen quad, so canvas MSAA would be wasted.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !useTAA, powerPreference: 'high-performance' });
// Same cap as Alian's viewer: retina gets real 2× sampling, which steadies thin foliage most.
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false; // one frame may be several renders (TAA); stats count them all

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 6000);
const controls = new OrbitControls(camera, canvas);
// Light damping: the view follows the hand and settles in a few frames instead of drifting.
controls.enableDamping = true;
controls.dampingFactor = 0.22;
controls.rotateSpeed = 0.8;
controls.zoomSpeed = 1.4;
controls.zoomToCursor = true;
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 2;
controls.maxDistance = 260;

const outdoors = createOutdoors(THREE, { renderer, scene, Sky, shadowSize: 2048, offscreen: useTAA });
const taa = useTAA ? createTemporalAA(THREE, renderer) : null;

/* ---------------------------------------------------------------- bark textures (optional) */
const loader = new THREE.TextureLoader();
const barkTextures = {};
for (const name of ['oak', 'birch', 'pine']) {
  const map = loader.load(`bark/${name}-albedo.webp`);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = loader.load(`bark/${name}-normal.webp`);
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  barkTextures[name] = { map, normalMap };
}

const forest = createForest(THREE, { barkTextures });
scene.add(forest.group);
const grass = createGrass(THREE, { uniforms: forest.uniforms, stable: lab.get('grass') !== 'legacy' });
scene.add(grass.mesh);
const features = new THREE.Group();
scene.add(features);
const stones = new Map();
const stoneFor = (kind) => { if (!stones.has(kind)) stones.set(kind, stoneMaterial(THREE, kind)); return stones.get(kind); };

/* ---------------------------------------------------------------- documents */

function groveDoc() {
  // A meadow: a birch stand, a pine edge behind, oaks and maples in the open, shrubs at the margins.
  const r = rng(20261120), out = [];
  const round = (v) => Math.round(v * 10) / 10;
  const put = (kind, x, z, extra = {}) => {
    for (const t of out) if (Math.hypot(t.at[0] - x, t.at[1] - z) < (kind === 'shrub' ? 2.2 : 4.5)) return;
    out.push({ use: 'tree', ...(kind === 'oak' ? {} : { kind }), at: [round(x), round(z)], ...extra });
  };
  put('oak', 0, 0, { height: 11 });
  for (let i = 0; i < 70; i++) { const a = r() * 6.28, d = 8 + r() * 26; put('birch', 30 + Math.cos(a) * d * 0.7, -10 + Math.sin(a) * d * 0.6); }
  for (let i = 0; i < 160; i++) put('pine', -110 + r() * 220, -48 - r() * 60);
  for (let i = 0; i < 26; i++) put(r() < 0.5 ? 'oak' : 'maple', -60 + r() * 75, -38 + r() * 55);
  for (let i = 0; i < 80; i++) { const a = r() * 6.28, d = 14 + r() * 40; put('shrub', Math.cos(a) * d, Math.sin(a) * d * 0.7 - 6); }
  return out;
}

const fresh = {
  specimen: async () => [{ use: 'tree' }],
  grove: async () => groveDoc(),
  homestead: async () => (await fetch('scenes/homestead.json')).json(),
  ridge: async () => (await fetch('scenes/ridge.json')).json(),
};
const views = {
  specimen: { doc: null, eye: [13, 4.2, 15], target: [0, 4.2, 0] },
  grove: { doc: null, eye: [26, 9, 46], target: [0, 4, -6] },
  homestead: { doc: null, eye: [24, 8, 30], target: [-2, 2.5, -8] },
  ridge: { doc: null, eye: [64, 20, 54], target: [4, 5, -14] },
};
let view = 'homestead';

/* ---------------------------------------------------------------- editor */

const editor = $('doc');
const status = $('doc-status');

/** The first child of a kind, as a live reference into the authored doc (for the levers). */
function firstOf(doc, use) {
  if (Array.isArray(doc)) return doc.find((c) => (c.use ?? 'tree') === use);
  return Object.values(doc?.ground?.children ?? {}).find((c) => (c.use ?? 'tree') === use);
}

function format(doc) {
  if (Array.isArray(doc)) {
    if (doc.length <= 3) return JSON.stringify(doc, null, 2);
    return '[\n' + doc.map((t) => '  ' + JSON.stringify(t)).join(',\n') + '\n]';
  }
  const { children = {}, ...rest } = doc.ground ?? {};
  const head = Object.entries(rest).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const kids = Object.entries(children).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n  "ground": {\n${head.join('\n')}${head.length ? '\n' : ''}    "children": {\n${kids.join(',\n')}\n    }\n  }\n}`;
}

// The ground mesh builds in a worker; the newest request wins.
let groundWorker = null, groundRequest = 0, lastGround = null;
try {
  groundWorker = new Worker(new URL('./lib/groundWorker.js', import.meta.url), { type: 'module' });
  groundWorker.onmessage = ({ data }) => { if (data.id === groundRequest) outdoors.setGround(data); };
  // If the worker cannot load here, build the newest request on the main thread instead.
  groundWorker.onerror = () => { groundWorker = null; if (lastGround) outdoors.setGround(buildGroundArrays(lastGround.scene, { occluders: lastGround.occluders })); };
} catch { groundWorker = null; }
function buildGround(full, occluders) {
  const id = ++groundRequest;
  const plain = JSON.parse(JSON.stringify(full));
  lastGround = { scene: plain, occluders };
  if (groundWorker) groundWorker.postMessage({ id, scene: plain, occluders });
  else outdoors.setGround(buildGroundArrays(plain, { occluders }));
}

let ground = null;
function apply(doc, { write = true } = {}) {
  try {
    const t0 = performance.now();
    const resolved = resolveScene(doc);
    ground = resolved.ground;
    const trees = forest.set(resolved.trees, { heightAt: ground.heightAt });
    // Rocks (one merged mesh per stone) and houses.
    for (const c of [...features.children]) { features.remove(c); c.traverse((o) => o.geometry?.dispose()); }
    for (const { stone, geometry } of buildRocks(THREE, ground.rocks, ground.heightAt)) {
      const m = new THREE.Mesh(geometry, stoneFor(stone));
      m.castShadow = m.receiveShadow = true;
      features.add(m);
    }
    for (const H of ground.houses) features.add(buildHouse(THREE, H, ground.heightAt));
    grass.setGround(ground);
    buildGround(resolved.scene, forest.occluders());
    // Compile every shader variant now (far-detail trees included), so the first tree to change
    // detail mid-walk doesn't stall a frame compiling its program.
    const hidden = [];
    forest.group.traverse((o) => { if (o.isMesh && !o.visible) { o.visible = true; hidden.push(o); } });
    renderer.compile(scene, camera);
    for (const o of hidden) o.visible = false;
    views[view].doc = doc;
    if (write) editor.value = format(doc);
    const bits = [`${trees.length} trees`];
    if (ground.rocks.length) bits.push(`${ground.rocks.length} rocks`);
    if (ground.landforms) bits.push(`${ground.landforms} landforms`);
    if (ground.paths.length) bits.push(`${ground.paths.length} path${ground.paths.length > 1 ? 's' : ''}`);
    status.textContent = `${bits.join(' · ')} · ${Math.round(performance.now() - t0)} ms`;
    status.dataset.state = 'ok';
    $('mode-walk').disabled = !ground.paths.length;
    if (mode === 'walk' && !ground.paths.length) setMode('orbit');
    else if (mode !== 'orbit') setMode(mode);
    syncLevers();
  } catch (err) {
    console.error(err);
    status.textContent = err.message;
    status.dataset.state = 'error';
  }
}

let typing = 0;
editor.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(() => {
    try { apply(JSON.parse(editor.value), { write: false }); }
    catch (err) { status.textContent = `JSON: ${err.message}`; status.dataset.state = 'error'; }
  }, 350);
});

/* ---------------------------------------------------------------- levers */

const kindRow = $('kinds');
for (const k of KIND_NAMES) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = KINDS[k].label; b.dataset.kind = k;
  b.addEventListener('click', () => edit((t) => { if (k === 'oak') delete t.kind; else t.kind = k; delete t.height; delete t.width; }));
  kindRow.append(b);
}
const heightIn = $('height'), widthIn = $('width'), seedIn = $('seed'), seedAuto = $('seed-auto');

function edit(fn, use = 'tree') {
  const doc = structuredClone(views[view].doc);
  const target = firstOf(doc, use);
  if (!target) return;
  fn(target);
  apply(doc);
  if (view === 'specimen') frame();
}

heightIn.addEventListener('input', () => edit((t) => { t.height = +heightIn.value; delete t.width; }));
widthIn.addEventListener('input', () => edit((t) => { t.width = +widthIn.value; }));
seedIn.addEventListener('input', () => edit((t) => { t.seed = +seedIn.value; }));
seedAuto.addEventListener('change', () => edit((t) => { if (seedAuto.checked) delete t.seed; else t.seed = resolveTree(t).variant; }));
$('move').addEventListener('click', () => edit((t) => {
  // Planting somewhere else re-rolls the tree; nothing else ever does.
  const [x, z] = t.at ?? [0, 0];
  t.at = [Math.round((x + 3.7) * 10) / 10, z];
  delete t.seed;
}));
$('reset').addEventListener('click', async () => { apply(await fresh[view]()); frame(); });

const hill = (id, fn) => $(id).addEventListener('input', () => edit((f) => { f.params = f.params ?? {}; fn(f.params, +$(id).value); }, 'landform'));
hill('hill-h', (p, v) => { p.h = v; });
hill('hill-sx', (p, v) => { const [, z] = Array.isArray(p.size) ? p.size : [p.size ?? 10, p.size ?? 10]; p.size = [v, z]; });
hill('hill-sz', (p, v) => { const [x] = Array.isArray(p.size) ? p.size : [p.size ?? 10]; p.size = [x, v]; });
hill('hill-kx', (p, v) => { const [, z] = Array.isArray(p.soft) ? p.soft : [p.soft ?? 1, p.soft ?? 1]; p.soft = [v, z]; });
hill('hill-kz', (p, v) => { const [x] = Array.isArray(p.soft) ? p.soft : [p.soft ?? 1]; p.soft = [x, v]; });
$('hill-flat').addEventListener('change', () => edit((f) => { f.params = f.params ?? {}; if ($('hill-flat').checked) f.params.top = 'flat'; else delete f.params.top; }, 'landform'));
$('hill-add').addEventListener('click', () => {
  const s = sceneOf(structuredClone(views[view].doc)), kids = s.ground.children;
  const n = Object.keys(kids).filter((k) => k.startsWith('hill')).length + 1;
  const a = n * 2.4, d = 18 + n * 4;
  // New hills go first so the levers edit the one just added.
  s.ground.children = { [`hill-${n}`]: { use: 'landform', at: [Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)], params: { h: 3, size: 20 } }, ...kids };
  apply(s);
});

function syncLevers() {
  const f = firstOf(views[view].doc, 'landform');
  $('hill-levers').hidden = !f;
  if (f) {
    const p = f.params ?? {}, size = Array.isArray(p.size) ? p.size : [p.size ?? 10, p.size ?? 10], soft = Array.isArray(p.soft) ? p.soft : [p.soft ?? 1, p.soft ?? 1];
    const set = (id, v, text) => { $(id).value = v; $(`${id}-out`).textContent = text; };
    set('hill-h', p.h ?? 1, `${(p.h ?? 1).toFixed(1)} m`);
    set('hill-sx', size[0], `${size[0].toFixed(0)} m`);
    set('hill-sz', size[1], `${size[1].toFixed(0)} m`);
    set('hill-kx', soft[0], soft[0] < 0.05 ? 'cliff' : soft[0].toFixed(2));
    set('hill-kz', soft[1], soft[1] < 0.05 ? 'cliff' : soft[1].toFixed(2));
    $('hill-flat').checked = p.top === 'flat';
    const key = Object.entries(sceneOf(views[view].doc).ground.children).find(([, c]) => JSON.stringify(c) === JSON.stringify(f))?.[0];
    $('hill-name').textContent = key ? `"${key}"` : '';
  }
  const first = firstOf(views[view].doc, 'tree');
  $('tree-levers').hidden = !first;
  if (!first) return;
  const t = resolveTree(first);
  for (const b of kindRow.children) b.setAttribute('aria-pressed', String(b.dataset.kind === t.kind));
  const spec = KINDS[t.kind];
  heightIn.min = Math.max(0.6, spec.height * 0.4).toFixed(1); heightIn.max = (spec.height * 1.6).toFixed(1); heightIn.step = spec.height < 3 ? 0.1 : 0.5;
  heightIn.value = t.height; $('height-out').textContent = `${t.height.toFixed(1)} m${Number.isFinite(first.height) ? '' : ' · default'}`;
  widthIn.min = (t.height * spec.width / spec.height * 0.6).toFixed(1); widthIn.max = (t.height * spec.width / spec.height * 1.5).toFixed(1); widthIn.step = 0.1;
  widthIn.value = t.width; $('width-out').textContent = `${t.width.toFixed(1)} m${Number.isFinite(first.width) ? '' : ' · default'}`;
  seedAuto.checked = !Number.isFinite(first.seed);
  seedIn.disabled = seedAuto.checked;
  seedIn.value = t.variant;
  $('seed-out').textContent = seedAuto.checked ? `from position (${(first.at ?? [0, 0]).join(', ')})` : `variant ${t.variant}`;
}

/* ---------------------------------------------------------------- light and wind */

const hourIn = $('hour'), windIn = $('wind');
const hourText = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
let pendingHour = null;
hourIn.addEventListener('input', () => { pendingHour = +hourIn.value; $('hour-out').textContent = hourText(+hourIn.value); });
windIn.addEventListener('input', () => { forest.uniforms.uWind.value = +windIn.value; $('wind-out').textContent = ['Still', 'Breeze', 'Breeze', 'Windy', 'Gusty'][Math.min(4, Math.floor(+windIn.value * 4))]; });

/* ---------------------------------------------------------------- camera modes */

let mode = 'orbit', driver = null;
const lookAt = new THREE.Vector3();
function pressModes() { for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); }
function setMode(next) {
  mode = next;
  pressModes();
  controls.enabled = mode === 'orbit';
  camera.fov = mode === 'walk' ? 58 : 42; camera.updateProjectionMatrix();
  if (mode === 'tour') { driver = createTour(THREE, { ground, trees: forest.trees() }); driver.start(camera, lookAt); }
  else if (mode === 'walk') { driver = createWalk(THREE, { path: ground.paths[0], ground }); driver.start(camera); }
  else driver = null;
}
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
// Touching the scene during a tour or walk hands the camera back, looking where it was looking.
canvas.addEventListener('pointerdown', () => {
  if (mode === 'orbit') return;
  controls.target.copy(lookAt);
  setMode('orbit');
});

/* ---------------------------------------------------------------- views */

function frame() {
  const v = views[view];
  if (view === 'specimen') {
    const t = resolveTree(firstOf(v.doc, 'tree') ?? {});
    const h = t.height, d = Math.max(h, t.width) * 1.85 + 2;
    const gy = ground.heightAt(t.x, t.z);
    camera.position.set(t.x + d * 0.62, gy + Math.max(1.4, h * 0.42), t.z + d * 0.78);
    controls.target.set(t.x, gy + h * 0.47, t.z);
  } else {
    camera.position.set(...v.eye);
    controls.target.set(...v.target);
  }
  controls.update();
  lookAt.copy(controls.target);
}

async function show(next) {
  view = next;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  document.body.dataset.view = view;
  if (!views[view].doc) views[view].doc = await fresh[view]();
  if (mode !== 'orbit') { mode = 'orbit'; driver = null; controls.enabled = true; camera.fov = 42; camera.updateProjectionMatrix(); pressModes(); }
  apply(views[view].doc);
  frame();
  taa?.reset();
}
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => show(b.dataset.view));

/* ---------------------------------------------------------------- loop */

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
}

const clock = new THREE.Clock();
let frames = 0, fpsT = 0, fps = 0, prev = 0, worst = 0;
const statsEl = $('stats'), fwd = new THREE.Vector3(), focus = new THREE.Vector3();
let fixed = null; // set by __trees.step(): a script drives frames at an exact dt (pop checks)
function loop() {
  if (fixed) return;
  const t = clock.getElapsedTime();
  tick(t, Math.min(0.05, t - prev));
  requestAnimationFrame(loop);
}
function tick(t, dt) {
  resize();
  worst = Math.max(worst, t - prev);
  prev = t;
  if (pendingHour !== null) { outdoors.setHour(pendingHour); pendingHour = null; }
  if (driver) lookAt.copy(driver.update(camera, dt));
  else { controls.update(); lookAt.copy(controls.target); }
  camera.updateMatrixWorld();
  // Shadows cover what is in front of the camera. The reach moves in steps and the centre snaps to
  // shadow texels, so shadows never breathe or crawl while the camera moves.
  camera.getWorldDirection(fwd);
  const dist = mode === 'walk' ? 18 : camera.position.distanceTo(lookAt);
  const reach = Math.min(110, Math.max(20, Math.pow(1.4, Math.ceil(Math.log(dist * 0.9 + 10) / Math.log(1.4)))));
  focus.copy(mode === 'walk' ? camera.position : lookAt);
  if (mode === 'walk') focus.addScaledVector(fwd.setY(0).normalize(), reach * 0.55);
  if (ground) focus.y = ground.heightAt(focus.x, focus.z);
  outdoors.place(focus, reach);
  forest.update(camera, t);
  grass.update(camera);
  outdoors.treeLight(forest.uniforms, camera);
  renderer.info.reset();
  if (taa) { forest.uniforms.uDitherShift.value = (forest.uniforms.uDitherShift.value + 0.618034) % 1; taa.render(scene, camera); }
  else renderer.render(scene, camera);
  frames++;
  if (t - fpsT > 0.5) {
    fps = frames / (t - fpsT); frames = 0; fpsT = t;
    const s = forest.stats(), info = renderer.info.render;
    statsEl.innerHTML = `<span><b>${s.trees}</b> trees</span><span><b>${(grass.stats() / 1000).toFixed(1)}k</b> grass</span><span><b>${(info.triangles / 1000).toFixed(0)}k</b> tris</span><span><b>${info.calls}</b> calls</span><span><b>${Math.round(fps)}</b> fps · worst ${Math.round(worst * 1000)} ms</span>`;
    worst = 0;
  }
}

outdoors.setHour(+hourIn.value);
$('hour-out').textContent = hourText(+hourIn.value);
forest.uniforms.uWind.value = +windIn.value;
const start = location.hash.slice(1);
await show(views[start] ? start : 'homestead');
loop();
window.__trees = {
  forest, outdoors, camera, controls, show, setMode, renderer, scene, grass, ground: () => ground,
  /** Stop the clock and render one frame dt seconds later (for frame-by-frame checks). */
  step(dt) { fixed = fixed ?? { t: prev }; fixed.t += dt; tick(fixed.t, dt); },
};
