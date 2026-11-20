import * as T from './vendor/three.module.js';
import { random } from './growth.js';
import { buildTree, defaults, lighting, loadBarkTextures, treeMaterials } from './tree.js';

const $ = id => document.getElementById(id);
const modes = {
  mesh: 'Individual modeled leaves hold their shape as you orbit. Bark texture is optional, and the canopy uses geometry throughout.',
  hybrid: 'The trunk and branches keep their shape as you orbit. Small foliage cards add detail with fewer triangles, at the cost of texture memory and alpha-tested pixels.',
  cards: 'Two crossed planes show baked views of the tree. They have the lowest triangle count, but can look flat or split at grazing angles, especially up close.',
};
const controls = { height: $('height'), spread: $('spread'), density: $('density') };
const view = new URLSearchParams(location.search);
const recipe = { ...defaults };
if (['oak', 'birch', 'pine'].includes(view.get('species'))) recipe.species = view.get('species');
for (const [key, input] of Object.entries(controls)) {
  const n = Number(view.get(key));
  if (view.has(key) && Number.isFinite(n) && n >= Number(input.min) && n <= Number(input.max)) {
    input.value = String(n);
    recipe[key] = Number(input.value);
  }
}
const seed = Number(view.get('seed'));
if (view.has('seed') && Number.isSafeInteger(seed) && seed >= 1 && seed <= 0x7fffffff) recipe.seed = seed;
let mode = Object.hasOwn(modes, view.get('mode')) ? view.get('mode') : 'mesh';
let count = [1, 36, 144].includes(Number(view.get('trees'))) ? Number(view.get('trees')) : 1;
let barkDetail = view.get('bark') !== '0';
let sunShadows = view.get('shadows') !== '0';
let orbit = Number.isFinite(Number(view.get('orbit'))) && view.has('orbit') ? Number(view.get('orbit')) % 360 * Math.PI / 180 : .53;
const viewPitch = Number(view.get('pitch'));
let pitch = view.has('pitch') && Number.isFinite(viewPitch) ? Math.max(0, Math.min(1.33, viewPitch)) : (count === 1 ? .25 : .61);
let distance = Math.max(3.5, Math.min(320, Number(view.get('distance')) || baseDistance()));
const focus = new T.Vector3();
const integer = new Intl.NumberFormat();
let noticeTimer;

function message(text) {
  $('notice').textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 2200);
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) {
      window.prompt('Copy to clipboard', text);
      return;
    }
  }
  message(label);
}

function refreshLabels() {
  $('species').value = recipe.species;
  $('height-value').value = recipe.height.toFixed(1) + ' m';
  $('spread-value').value = recipe.spread + '%';
  $('density-value').value = recipe.density + '%';
  $('seed-value').value = recipe.seed;
  $('tradeoff').textContent = modes[mode];
  $('bark').checked = barkDetail;
  $('sun').checked = sunShadows;
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  for (const button of document.querySelectorAll('[data-scene]')) button.setAttribute('aria-pressed', String(Number(button.dataset.scene) === count));
}

function baseDistance() {
  if (count === 1) return recipe.height * 1.85;
  return Math.sqrt(count) * recipe.height * 1.05;
}

function resetView() {
  orbit = .53;
  pitch = count === 1 ? .25 : .61;
  distance = baseDistance();
  updateCamera();
}

function share() {
  const url = new URL(location.href);
  url.search = new URLSearchParams({
    ...recipe, mode, bark: Number(barkDetail), shadows: Number(sunShadows), trees: count, orbit: (orbit * 180 / Math.PI).toFixed(2),
    pitch: pitch.toFixed(4), distance: distance.toFixed(2),
  });
  copy(url.href, 'View link copied');
}

let renderer;
let ready = false;
try {
  renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
} catch {
  $('render-error').hidden = false;
}
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(40, 1, .1, 650);
const trees = new T.Group();
scene.add(trees);
const [ambient, sun] = lighting();
const sunDirection = sun.position.clone().normalize();
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.bias = -.00023;
sun.shadow.normalBias = .016;
scene.add(ambient, sun);
const groundGeometry = new T.PlaneGeometry(700, 700).rotateX(-Math.PI / 2);
const plane = new T.Mesh(groundGeometry, new T.MeshBasicMaterial({ color: '#d9dfc7', toneMapped: false }));
plane.position.y = -.025;
scene.add(plane);
const sunShadow = new T.Mesh(groundGeometry, new T.ShadowMaterial({ color: '#34422e', opacity: .33, depthWrite: false }));
sunShadow.position.y = -.021;
sunShadow.receiveShadow = true;
scene.add(sunShadow);
scene.fog = new T.FogExp2('#dbe4d6', .01);

const shadowMaterial = new T.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { tint: { value: new T.Color('#455639') } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
    }
  `,
  fragmentShader: `
    uniform vec3 tint;
    varying vec2 vUv;
    void main() {
      vec2 point = (vUv - 0.5) * 2.;
      float broad = (1. - smoothstep(0.08, 1., length(point))) * .075;
      float contact = (1. - smoothstep(.01, .47, length(vec2((point.x + .2) * 1.4, point.y)))) * .21;
      gl_FragColor = vec4(tint, broad + contact);
      #include <colorspace_fragment>
    }
  `,
});
const shadowGeometry = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const groundGrid = new T.GridHelper(280, 140, '#aebba5', '#b6c2ad');
groundGrid.material.transparent = true;
groundGrid.material.opacity = .36;
groundGrid.material.depthWrite = false;
groundGrid.position.y = -.011;
scene.add(groundGrid);
let shadow;
let variants = [];
let treeStyle;
let pendingRecipe = null;
let fpsStart = 0;
let frames = 0;

function updateCamera() {
  const compact = Math.min(1, camera.aspect / .88);
  const z = distance / compact;
  focus.set(0, count === 1 ? recipe.height * .51 : recipe.height * .30, 0);
  camera.position.set(
    focus.x + Math.sin(orbit) * Math.cos(pitch) * z,
    focus.y + Math.sin(pitch) * z,
    focus.z + Math.cos(orbit) * Math.cos(pitch) * z
  );
  camera.lookAt(focus);
}

function resize() {
  if (!renderer) return;
  const { clientWidth: width, clientHeight: height } = $('canvas-host');
  if (!width || !height) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  updateCamera();
}

const materialTextures = material => [material.map, material.normalMap].filter(Boolean);

function rebuildTrees(variantCount) {
  const oldMaterials = new Set(Object.values(treeStyle ?? {}));
  for (const variant of variants) {
    for (const { geometry, material } of variant.parts) {
      geometry.dispose();
      oldMaterials.add(material);
    }
  }
  const oldMaps = new Set([...oldMaterials].flatMap(materialTextures));
  for (const map of oldMaps) map.dispose();
  for (const material of oldMaterials) material.dispose();
  treeStyle = treeMaterials(recipe.species, mode, barkDetail);
  const variation = random(recipe.seed ^ 971);
  variants = Array.from({ length: variantCount }, (_, i) => {
    const individual = i === 0 ? recipe : {
      ...recipe,
      seed: 1 + Math.floor(variation() * 0x7ffffffe),
      spread: recipe.spread * (.86 + variation() * .28),
      density: Math.min(100, recipe.density * (.87 + variation() * .26)),
    };
    return buildTree(individual, mode, renderer, treeStyle);
  });
  if (mode === 'cards') {
    for (const texture of materialTextures(treeStyle.bark)) texture.dispose();
    treeStyle.bark.dispose();
    treeStyle.leaves.dispose();
    treeStyle = null;
  }
}

function updateShadows() {
  if (!renderer) return;
  sun.castShadow = sunShadows;
  sunShadow.visible = sunShadows;
  if (!sunShadows) return;
  const width = recipe.height * (count === 1 ? 1.22 : .58 * Math.sqrt(count) + 1.3);
  const camera = sun.shadow.camera;
  sun.position.copy(sunDirection).multiplyScalar(width * 2.2);
  camera.left = camera.bottom = -width;
  camera.right = camera.top = width;
  camera.near = Math.max(.1, width * .8);
  camera.far = width * 3.8;
  camera.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
}

function measureScene() {
  const textures = new Set(variants.flatMap(variant => variant.parts.flatMap(part => materialTextures(part.material))));
  let bytes = 0;
  for (const { image } of textures) {
    let { width, height } = image;
    while (true) {
      bytes += width * height * 4;
      if (width === 1 && height === 1) break;
      width = Math.max(1, width >> 1);
      height = Math.max(1, height >> 1);
    }
  }
  $('texture').textContent = bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(2) + ' MiB' : Math.round(bytes / 1024) + ' KiB';
  renderer.render(scene, camera);
  $('triangles').textContent = integer.format(renderer.info.render.triangles);
  $('calls').textContent = integer.format(renderer.info.render.calls);
  fpsStart = 0;
  frames = 0;
  $('fps').textContent = '—';
}

function placeTrees(rebuildGeometry) {
  if (!ready) return;
  const variantCount = count === 1 ? 1 : 4;
  for (const mesh of [...trees.children]) {
    trees.remove(mesh);
    mesh.dispose();
  }
  if (rebuildGeometry || variants.length !== variantCount) rebuildTrees(variantCount);
  if (shadow) {
    scene.remove(shadow);
    shadow.dispose();
  }
  shadow = new T.InstancedMesh(shadowGeometry, shadowMaterial, count);
  shadow.renderOrder = 1;
  scene.add(shadow);

  const columns = Math.sqrt(count);
  const spacing = recipe.height * .82;
  const rng = random(625);
  const obj = new T.Object3D();
  const placements = Array.from({ length: variantCount }, () => []);
  for (let i = 0; i < count; i++) {
    const variety = count === 1 ? 0 : Math.floor(rng() * variantCount);
    const x = (i % columns - (columns - 1) / 2) * spacing;
    const z = (Math.floor(i / columns) - (columns - 1) / 2) * spacing;
    const height = count === 1 ? 1 : .73 + rng() * .47;
    const scale = recipe.height * height / variants[variety].referenceHeight;
    const jitter = count === 1 ? 0 : spacing * .55;
    obj.position.set(x + (rng() - .5) * jitter, 0, z + (rng() - .5) * jitter);
    obj.rotation.y = count === 1 ? 0 : rng() * Math.PI * 2;
    obj.scale.setScalar(scale);
    obj.updateMatrix();
    placements[variety].push({
      matrix: obj.matrix.clone(),
      color: new T.Color().setScalar(count === 1 ? 1 : .83 + rng() * .22),
    });
    obj.position.add(new T.Vector3(scale * .34, 0, -.13 * scale));
    obj.rotation.y = -.42;
    obj.scale.set((4.7 + recipe.spread * .025) * scale, 1, (2.8 + recipe.spread * .021) * scale);
    obj.updateMatrix();
    shadow.setMatrixAt(i, obj.matrix);
  }
  for (const [i, variant] of variants.entries()) {
    if (placements[i].length === 0) continue;
    for (const { geometry, material } of variant.parts) {
      const mesh = new T.InstancedMesh(geometry, material, placements[i].length);
      mesh.castShadow = true;
      mesh.receiveShadow = material === treeStyle?.bark;
      placements[i].forEach(({ matrix, color }, index) => {
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, color);
      });
      trees.add(mesh);
    }
  }
  updateCamera();
  updateShadows();
  measureScene();
}

function repaintRecipe() {
  refreshLabels();
  clearTimeout(pendingRecipe);
  pendingRecipe = setTimeout(() => {
    pendingRecipe = null;
    placeTrees(true);
  }, 75);
}

function zoom(factor) {
  distance = Math.max(3.5, Math.min(320, distance * factor));
  updateCamera();
}

function activateCanvas() {
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Tree viewport. Arrow keys orbit, plus and minus zoom, Home resets the view.');
  $('canvas-host').append(canvas);
  const fingers = new Map();
  const separation = () => {
    const [a, b] = fingers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const setPitch = value => { pitch = Math.max(0, Math.min(1.33, value)); };
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  canvas.addEventListener('pointermove', event => {
    const point = fingers.get(event.pointerId);
    if (!point) return;
    const previousDistance = fingers.size === 2 ? separation() : 0;
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.size === 2) {
      const nextDistance = separation();
      if (nextDistance > 0 && previousDistance > 0) zoom(previousDistance / nextDistance);
      return;
    }
    orbit -= (event.clientX - point.x) * .008;
    setPitch(pitch + (event.clientY - point.y) * .006);
    updateCamera();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(event, e => fingers.delete(e.pointerId));
  }
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const delta = Math.max(-120, Math.min(120, event.deltaY));
    zoom(Math.exp(delta * .003));
  }, { passive: false });
  canvas.addEventListener('keydown', event => {
    switch (event.key) {
      case 'ArrowLeft': orbit += .12; break;
      case 'ArrowRight': orbit -= .12; break;
      case 'ArrowUp': setPitch(pitch + .10); break;
      case 'ArrowDown': setPitch(pitch - .10); break;
      case '+': case '=': zoom(.82); break;
      case '-': zoom(1.22); break;
      case 'Home': resetView(); break;
      default: return;
    }
    event.preventDefault();
    updateCamera();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    $('render-error').textContent = 'The 3D connection was interrupted. The browser will try to restore it.';
    $('render-error').hidden = false;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    $('render-error').hidden = true;
    resize();
    placeTrees(true);
  });
  new ResizeObserver(resize).observe($('canvas-host'));
}

for (const [key, input] of Object.entries(controls)) {
  input.addEventListener('input', () => {
    const heightBefore = recipe.height;
    recipe[key] = Number(input.value);
    if (key === 'height') distance = Math.max(3.5, Math.min(320, distance * recipe.height / heightBefore));
    repaintRecipe();
  });
}
$('species').addEventListener('change', event => { recipe.species = event.target.value; repaintRecipe(); });
$('variation').addEventListener('click', () => {
  recipe.seed = recipe.seed >= 0x7fffffff ? 1 : recipe.seed + 1;
  repaintRecipe();
});
$('reset').addEventListener('click', () => {
  Object.assign(recipe, defaults);
  for (const [key, input] of Object.entries(controls)) input.value = recipe[key];
  resetView();
  repaintRecipe();
});
for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    if (mode === button.dataset.mode) return;
    mode = button.dataset.mode;
    repaintRecipe();
  });
}
for (const button of document.querySelectorAll('[data-scene]')) {
  button.addEventListener('click', () => {
    const next = Number(button.dataset.scene);
    if (next === count) return;
    count = next;
    refreshLabels();
    resetView();
    if (pendingRecipe === null) placeTrees(false);
  });
}
$('bark').addEventListener('change', event => { barkDetail = event.target.checked; repaintRecipe(); });
$('sun').addEventListener('change', event => {
  sunShadows = event.target.checked;
  if (ready) {
    updateShadows();
    measureScene();
  }
});
$('home').addEventListener('click', resetView);
$('zoom-out').addEventListener('click', () => zoom(1.22));
$('zoom-in').addEventListener('click', () => zoom(.82));
$('copy').addEventListener('click', () => copy(JSON.stringify(recipe, null, 2), 'Tree recipe copied'));
$('share').addEventListener('click', share);
refreshLabels();
if (renderer) {
  await loadBarkTextures();
  ready = true;
  activateCanvas();
  resize();
  placeTrees(true);
  renderer.setAnimationLoop(time => {
    if (document.hidden || renderer.getContext().isContextLost()) {
      fpsStart = 0;
      frames = 0;
      return;
    }
    renderer.render(scene, camera);
    if (!fpsStart) fpsStart = time;
    frames++;
    const elapsed = time - fpsStart;
    if (elapsed > 550) {
      $('fps').textContent = Math.round((frames - 1) * 1000 / elapsed).toString();
      fpsStart = time;
      frames = 1;
    }
  });
}
