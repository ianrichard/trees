import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createForest, resolveTree } from './lib/forest.js';
import { createOutdoors } from './lib/outdoors.js';
import { KINDS, KIND_NAMES } from './lib/species.js';
import { rng } from './lib/grow.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 6000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
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

const views = {
  specimen: { doc: SPECIMEN, eye: [13, 4.2, 15], target: [0, 4.2, 0], reach: 16 },
  grove: { doc: groveDoc(), eye: [26, 9, 46], target: [0, 4, -6], reach: 60 },
};
let view = 'specimen';

/* ---------------------------------------------------------------- editor */

const editor = $('doc');
const status = $('doc-status');

function format(doc) {
  if (doc.length <= 3) return JSON.stringify(doc, null, 2);
  return '[\n' + doc.map((t) => '  ' + JSON.stringify(t)).join(',\n') + '\n]';
}

function apply(doc, { write = true } = {}) {
  try {
    if (!Array.isArray(doc)) doc = [doc];
    const t0 = performance.now();
    const trees = forest.set(doc);
    views[view].doc = doc;
    if (write) editor.value = format(doc);
    status.textContent = `${trees.length} ${trees.length === 1 ? 'tree' : 'trees'} · grown in ${Math.round(performance.now() - t0)} ms`;
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

function edit(fn) {
  const doc = structuredClone(views[view].doc);
  fn(doc[0]);
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
$('reset').addEventListener('click', () => { apply(view === 'specimen' ? [{ use: 'tree' }] : groveDoc()); frame(); });

function syncLevers() {
  const first = views[view].doc[0] ?? { use: 'tree' };
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

/* ---------------------------------------------------------------- views */

function frame() {
  const v = views[view];
  if (view === 'specimen') {
    const t = resolveTree(v.doc[0] ?? {});
    const h = t.height, d = Math.max(h, t.width) * 1.85 + 2;
    camera.position.set(d * 0.62, Math.max(1.4, h * 0.42), d * 0.78);
    controls.target.set(t.x, h * 0.47, t.z);
    outdoors.place(new THREE.Vector3(t.x, 0, t.z), Math.max(h, t.width) * 1.2 + 2);
  } else {
    camera.position.set(...v.eye);
    controls.target.set(...v.target);
    outdoors.place(new THREE.Vector3(0, 0, -10), v.reach);
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
show(location.hash === '#grove' ? 'grove' : 'specimen');
loop();
window.__trees = { forest, outdoors, camera, controls, show, renderer, scene };
