import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createForest, resolveTree } from './lib/forest.js';
import { createOutdoors } from './lib/outdoors.js';
import { KINDS, KIND_NAMES } from './lib/species.js';
import { rng } from './lib/grow.js';
import { resolveGround, buildGroundArrays } from './lib/ground.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Same cap as Alian's viewer: retina gets real 2× sampling, which steadies thin foliage most.
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

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
controls.maxDistance = 220;

const outdoors = createOutdoors(THREE, { renderer, scene, Sky, shadowSize: 2048 });

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

/* ---------------------------------------------------------------- documents */

const SPECIMEN = [{ use: 'tree' }];

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

// Rolling ground: a knoll with an oak, a long ridge of pines, a flat terrace, a hollow.
function hillsDoc() {
  const children = {
    knoll: { use: 'landform', at: [10, -8], params: { h: 3.5, size: 30 } },
    ridge: { use: 'landform', at: [-22, -34], turn: 25, params: { h: 9, size: [70, 22], soft: [1, 0.55] } },
    terrace: { use: 'landform', at: [-16, 6], params: { h: 1.6, size: [16, 11], soft: 0.25, top: 'flat' } },
    hollow: { use: 'landform', at: [8, 12], params: { h: -1.4, size: [12, 8] } },
    oak: { use: 'tree', at: [10, -8], height: 11 },
    maple: { use: 'tree', kind: 'maple', at: [-16, 6] },
  };
  const r = rng(77);
  for (let i = 0; i < 46; i++) {
    const t = r() * 2 - 1, a = 25 * Math.PI / 180, along = t * 34, across = (r() - 0.5) * 16;
    children[`pine-${i + 1}`] = { use: 'tree', kind: 'pine', at: [Math.round((-22 + along * Math.cos(a) - across * Math.sin(a)) * 10) / 10, Math.round((-34 + along * Math.sin(a) + across * Math.cos(a)) * 10) / 10] };
  }
  for (let i = 0; i < 10; i++) children[`birch-${i + 1}`] = { use: 'tree', kind: 'birch', at: [Math.round((20 + r() * 14) * 10) / 10, Math.round((4 + r() * 16) * 10) / 10] };
  return { ground: { children } };
}

const views = {
  specimen: { doc: SPECIMEN, eye: [13, 4.2, 15], target: [0, 4.2, 0], reach: 16 },
  grove: { doc: groveDoc(), eye: [26, 9, 46], target: [0, 4, -6], reach: 60 },
  hills: { doc: hillsDoc(), eye: [2, 10, 44], target: [-10, 4, -12], reach: 70 },
};
let view = 'specimen';

/* ---------------------------------------------------------------- editor */

const editor = $('doc');
const status = $('doc-status');

/** Bare JSON shorthand: an array is the ground's children; a single object is one child. */
function sceneOf(doc) {
  if (Array.isArray(doc)) return { ground: { children: Object.fromEntries(doc.map((c, i) => [`${c.use ?? 'item'}-${i + 1}`, c])) } };
  if (doc && doc.use) return { ground: { children: { [doc.use]: doc } } };
  return { ground: { children: {}, ...(doc?.ground ?? {}) } };
}

/** The first child of a kind, as a live reference into the authored doc (for the levers). */
function firstOf(doc, use) {
  if (Array.isArray(doc)) return doc.find((c) => (c.use ?? 'tree') === use);
  return Object.values(doc?.ground?.children ?? {}).find((c) => c.use === use);
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
let groundWorker = null, groundRequest = 0;
try {
  groundWorker = new Worker(new URL('./lib/groundWorker.js', import.meta.url), { type: 'module' });
  groundWorker.onmessage = ({ data }) => { if (data.id === groundRequest) outdoors.setGround(data); };
  // If the worker cannot load here, build the newest request on the main thread instead.
  groundWorker.onerror = () => { groundWorker = null; if (lastGround) outdoors.setGround(buildGroundArrays(lastGround.scene, { occluders: lastGround.occluders })); };
} catch { groundWorker = null; }
let lastGround = null;
function buildGround(scene, occluders) {
  const id = ++groundRequest;
  const plain = JSON.parse(JSON.stringify(scene));
  lastGround = { scene: plain, occluders };
  if (groundWorker) groundWorker.postMessage({ id, scene: plain, occluders });
  else outdoors.setGround(buildGroundArrays(plain, { occluders }));
}

let ground = resolveGround({});
function apply(doc, { write = true } = {}) {
  try {
    const t0 = performance.now();
    const scene = sceneOf(doc);
    ground = resolveGround(scene);
    const kids = Object.values(scene.ground.children ?? {});
    for (const c of kids) if (c.use && !['tree', 'landform'].includes(c.use)) throw new Error(`Unknown use "${c.use}": try tree or landform`);
    const trees = forest.set(kids.filter((c) => (c.use ?? 'tree') === 'tree'), { heightAt: ground.heightAt });
    buildGround(scene, forest.occluders());
    views[view].doc = doc;
    if (write) editor.value = format(doc);
    const hills = ground.landforms ? ` · ${ground.landforms} landform${ground.landforms === 1 ? '' : 's'}` : '';
    status.textContent = `${trees.length} ${trees.length === 1 ? 'tree' : 'trees'}${hills} · ${Math.round(performance.now() - t0)} ms`;
    status.dataset.state = 'ok';
    syncLevers();
  } catch (err) {
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

/* ---------------------------------------------------------------- levers (edit the first tree) */

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
$('reset').addEventListener('click', () => { apply({ specimen: () => [{ use: 'tree' }], grove: groveDoc, hills: hillsDoc }[view]()); frame(); });

/* ---------------------------------------------------------------- hill levers (edit the first landform) */

const hill = (id, fn) => $(id).addEventListener('input', () => edit((f) => { f.params = f.params ?? {}; fn(f.params, +$(id).value); }, 'landform'));
hill('hill-h', (p, v) => { p.h = v; });
hill('hill-sx', (p, v) => { const [, z] = Array.isArray(p.size) ? p.size : [p.size ?? 10, p.size ?? 10]; p.size = [v, z]; });
hill('hill-sz', (p, v) => { const [x] = Array.isArray(p.size) ? p.size : [p.size ?? 10]; p.size = [x, v]; });
hill('hill-kx', (p, v) => { const [, z] = Array.isArray(p.soft) ? p.soft : [p.soft ?? 1, p.soft ?? 1]; p.soft = [v, z]; });
hill('hill-kz', (p, v) => { const [x] = Array.isArray(p.soft) ? p.soft : [p.soft ?? 1]; p.soft = [x, v]; });
$('hill-flat').addEventListener('change', () => edit((f) => { f.params = f.params ?? {}; if ($('hill-flat').checked) f.params.top = 'flat'; else delete f.params.top; }, 'landform'));
$('hill-add').addEventListener('click', () => {
  const doc = structuredClone(views[view].doc), kids = sceneOf(doc).ground.children;
  const n = Object.keys(kids).filter((k) => k.startsWith('hill')).length + 1;
  const a = n * 2.4, d = 18 + n * 4;
  const scene = Array.isArray(doc) ? sceneOf(doc) : doc;
  // New hills go first so the levers edit the one just added.
  scene.ground.children = { [`hill-${n}`]: { use: 'landform', at: [Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)], params: { h: 3, size: 20 } }, ...scene.ground.children };
  apply(scene);
});

function syncLevers() {
  syncHill();
  const first = firstOf(views[view].doc, 'tree') ?? { use: 'tree' };
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

function syncHill() {
  const f = firstOf(views[view].doc, 'landform');
  $('hill-levers').hidden = !f;
  if (!f) return;
  const p = f.params ?? {}, size = Array.isArray(p.size) ? p.size : [p.size ?? 10, p.size ?? 10], soft = Array.isArray(p.soft) ? p.soft : [p.soft ?? 1, p.soft ?? 1];
  const set = (id, v, text) => { $(id).value = v; $(`${id}-out`).textContent = text; };
  set('hill-h', p.h ?? 1, `${(p.h ?? 1).toFixed(1)} m`);
  set('hill-sx', size[0], `${size[0].toFixed(0)} m`);
  set('hill-sz', size[1], `${size[1].toFixed(0)} m`);
  set('hill-kx', soft[0], soft[0] < 0.05 ? 'cliff' : soft[0].toFixed(2));
  set('hill-kz', soft[1], soft[1] < 0.05 ? 'cliff' : soft[1].toFixed(2));
  $('hill-flat').checked = p.top === 'flat';
  const key = Object.entries(sceneOf(views[view].doc).ground.children).find(([, c]) => c === f || JSON.stringify(c) === JSON.stringify(f))?.[0];
  $('hill-name').textContent = key ? `"${key}"` : 'first landform';
}

/* ---------------------------------------------------------------- light and wind */

const hourIn = $('hour'), windIn = $('wind');
const hourText = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
let pendingHour = null;
hourIn.addEventListener('input', () => { pendingHour = +hourIn.value; $('hour-out').textContent = hourText(+hourIn.value); });
windIn.addEventListener('input', () => { forest.uniforms.uWind.value = +windIn.value; $('wind-out').textContent = ['Still', 'Breeze', 'Breeze', 'Windy', 'Gusty'][Math.min(4, Math.floor(+windIn.value * 4))]; });

/* ---------------------------------------------------------------- views */

function frame() {
  const v = views[view];
  if (view === 'specimen') {
    const t = resolveTree(v.doc[0] ?? {});
    const h = t.height, d = Math.max(h, t.width) * 1.85 + 2;
    const gy = ground.heightAt(t.x, t.z);
    camera.position.set(t.x + d * 0.62, gy + Math.max(1.4, h * 0.42), t.z + d * 0.78);
    controls.target.set(t.x, gy + h * 0.47, t.z);
    outdoors.place(new THREE.Vector3(t.x, gy, t.z), Math.max(h, t.width) * 1.2 + 2);
  } else {
    camera.position.set(...v.eye);
    controls.target.set(...v.target);
    outdoors.place(new THREE.Vector3(v.target[0], 0, v.target[2] - 4), v.reach);
  }
  controls.update();
}

function show(next) {
  view = next;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  document.body.dataset.view = view;
  apply(views[view].doc);
  frame();
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
let frames = 0, fpsT = 0, fps = 0;
const statsEl = $('stats');
function loop() {
  resize();
  if (pendingHour !== null) { outdoors.setHour(pendingHour); pendingHour = null; }
  controls.update();
  camera.updateMatrixWorld();
  const t = clock.getElapsedTime();
  forest.update(camera, t);
  outdoors.treeLight(forest.uniforms, camera);
  renderer.render(scene, camera);
  frames++;
  if (t - fpsT > 0.5) {
    fps = frames / (t - fpsT); frames = 0; fpsT = t;
    const s = forest.stats(), info = renderer.info.render;
    statsEl.innerHTML = `<span><b>${s.trees}</b> trees</span><span><b>${(info.triangles / 1000).toFixed(0)}k</b> triangles</span><span><b>${info.calls}</b> draw calls</span><span><b>${Math.round(fps)}</b> fps</span>`;
  }
  requestAnimationFrame(loop);
}

outdoors.setHour(+hourIn.value);
$('hour-out').textContent = hourText(+hourIn.value);
forest.uniforms.uWind.value = +windIn.value;
show(views[location.hash.slice(1)] ? location.hash.slice(1) : 'specimen');
loop();
window.__trees = { forest, outdoors, camera, controls, show, renderer, scene, ground: () => ground };
