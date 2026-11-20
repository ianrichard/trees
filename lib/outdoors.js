// One coherent outdoor light: a physical sky (Preetham) is the background, the image-based
// ambient light (prefiltered from that same sky), and the fog color; the sun is a shadowing
// directional light along the sky's sun vector. Because ambient, fog and sun come from one
// source, foliage greens and bark pick up the right cool fill and warm key at every hour.

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

export function createOutdoors(THREE, { renderer, scene, Sky, shadowSize = 2048 }) {
  const sky = new Sky();
  sky.scale.setScalar(4500);
  // The lowest few degrees of sky fade into the fog color, so ground and sky meet without a seam.
  sky.material.uniforms.uHorizon = { value: new THREE.Color() };
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

  scene.fog = new THREE.FogExp2('#c9d6dc', 0.0036);

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
  function setHour(hour) {
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
    // Rebuild the ambient light from the sky (cheap: one 256² cubemap prefilter per change).
    if (envTarget) envTarget.dispose();
    envTarget = pmrem.fromScene(envScene, 0);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.55 + 0.25 * day;
    // Fog takes the horizon color so far trees melt into the sky instead of into grey.
    renderer.toneMappingExposure = 0.55 + 0.25 * (1 - day);
    const horizon = horizonColor(sky.material.uniforms.uHorizon.value);
    // three.js mixes fog in after tone mapping and sRGB encoding, so the fog color must be the
    // horizon as it appears on screen, not its scene radiance.
    displayColor(horizon, renderer.toneMappingExposure, scene.fog.color);
    place();
  }

  /** Keep the shadow frustum around what the camera is looking at. */
  function place(focus = state.focus, reach = state.reach) {
    state.focus.copy(focus); state.reach = reach;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir, reach * 3);
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: reach * 6 });
    sun.shadow.camera.updateProjectionMatrix();
  }

  /** For foliage transmission: sun direction in view space and its color × strength. */
  function treeLight(uniforms, camera) {
    uniforms.uSunDirView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    uniforms.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity / 3.4);
  }

  return { sky, sun, ground, setHour, place, treeLight, sunDir, state };
}

/** three.js ACESFilmicToneMapping + sRGB encode, in JS. */
function displayColor(c, exposure, out) {
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
  g.fillStyle = '#626b3b'; g.fillRect(0, 0, 512, 512);
  let s = 7;
  const r = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 | 0) >>> 0) / 4294967296;
  for (let i = 0; i < 26000; i++) {
    const x = r() * 512, y = r() * 512, l = 3 + r() * 9, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
    const k = r();
    g.strokeStyle = k < 0.1 ? '#8f8456' : k < 0.5 ? '#535f2f' : k < 0.85 ? '#6f7a41' : '#858d52';
    g.globalAlpha = 0.55; g.lineWidth = 1 + r();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    // wrap so the tile is seamless
    if (x > 500 || y > 500) { g.beginPath(); g.moveTo(x - 512 * (x > 500), y - 512 * (y > 500)); g.lineTo(x - 512 * (x > 500) + Math.cos(a) * l, y - 512 * (y > 500) + Math.sin(a) * l); g.stroke(); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const size = 9000, seg = 96;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = [], uv = geo.attributes.uv;
  const noise = (x, z) => Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * 0.5 + Math.sin(z * 0.06 + x * 0.02) * 0.3 + Math.sin((x + z) * 0.13) * 0.2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), n = noise(x, z);
    col.push(0.88 + 0.14 * n, 0.9 + 0.1 * n, 0.82 + 0.08 * n);
    uv.setXY(i, x / 4, z / 4);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}
