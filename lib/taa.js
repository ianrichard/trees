// Temporal antialiasing: the camera is jittered by a sub-pixel Halton offset every frame, and each
// frame blends into a reprojected history. Over 8–16 frames every pixel integrates many sample
// positions, so thin blades, leaf edges, silhouettes and procedural detail stop crawling as the view
// moves — the thing MSAA and FXAA cannot do, because they only see one frame.
//
// Reprojection uses depth and the camera's previous view-projection (camera motion only; no motion
// vectors). Wind-animated foliage has no velocity, so its history is clipped to the current
// neighbourhood (variance clipping in YCoCg), which trades a little stability on moving leaves for
// zero ghosting.
//
// Cost: the scene draws once into a linear half-float target (no MSAA needed), plus one resolve and
// one output pass. Usage: const taa = createTemporalAA(THREE, renderer); taa.render(scene, camera).
// `draw(target)` replaces the plain scene draw (it renders the jittered frame into `target` and
// returns the depth texture to reproject with); the lab uses it to put N8AO in front of the resolve.
// The resolve shader is exported separately so Alian can wrap it as an EffectComposer pass after
// its N8AO beauty pass (which already has the depth texture).

const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const JITTER = Array.from({ length: 16 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const TemporalResolveShader = {
  uniforms: {
    tCurrent: { value: null }, tHistory: { value: null }, tDepth: { value: null },
    uInvViewProj: { value: null }, uPrevViewProj: { value: null },
    uTexel: { value: null }, uBlend: { value: 0.1 }, uReset: { value: 1 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
precision highp float;
uniform sampler2D tCurrent, tHistory, tDepth;
uniform mat4 uInvViewProj, uPrevViewProj;
uniform vec2 uTexel; uniform float uBlend, uReset;
varying vec2 vUv;
vec3 toY(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromY(vec3 y) { return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
// Compress HDR before filtering so a bright sky pixel can't dominate (Karis), expand after.
vec3 tm(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 itm(vec3 c) { return c / max(1e-4, 1.0 - max(c.r, max(c.g, c.b))); }
// 5-tap Catmull-Rom history fetch: bilinear history blurs a little more every frame.
vec3 history(vec2 uv) {
  vec2 size = 1.0 / uTexel, p = uv * size - 0.5, f = fract(p), t1 = floor(p) + 0.5;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, t0 = (t1 - 1.0) * uTexel, t3 = (t1 + 2.0) * uTexel, t12 = (t1 + w2 / w12) * uTexel;
  vec3 c = texture2D(tHistory, vec2(t12.x, t0.y)).rgb * w12.x * w0.y
         + texture2D(tHistory, vec2(t0.x, t12.y)).rgb * w0.x * w12.y
         + texture2D(tHistory, t12).rgb * w12.x * w12.y
         + texture2D(tHistory, vec2(t3.x, t12.y)).rgb * w3.x * w12.y
         + texture2D(tHistory, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(c / wsum, 0.0);
}
void main() {
  // The current frame is used as jittered: that jitter is what integrates into supersampling.
  vec2 uv = vUv;
  vec3 m1 = vec3(0.0), m2 = vec3(0.0), cur = vec3(0.0);
  float closest = 1.0; vec2 cuv = vUv;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)) * uTexel;
    vec3 s = toY(tm(texture2D(tCurrent, uv + o).rgb));
    if (x == 0 && y == 0) cur = s;
    m1 += s; m2 += s * s;
    float d = texture2D(tDepth, vUv + o).x;
    if (d < closest) { closest = d; cuv = vUv + o; }
  }
  if (uReset > 0.5) { gl_FragColor = vec4(itm(fromY(cur)), 1.0); return; }
  // Reproject the nearest depth in the neighbourhood, so silhouettes carry their own history.
  vec4 ndc = vec4(cuv * 2.0 - 1.0, closest * 2.0 - 1.0, 1.0);
  vec4 world = uInvViewProj * ndc; world /= world.w;
  vec4 prev = uPrevViewProj * world;
  vec2 puv = prev.xy / prev.w * 0.5 + 0.5 + (vUv - cuv);
  if (any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) { gl_FragColor = vec4(itm(fromY(cur)), 1.0); return; }
  vec3 h = toY(tm(history(puv)));
  // Variance clip: history outside the current neighbourhood's colour box is pulled back into it.
  vec3 mu = m1 / 9.0, sigma = sqrt(max(m2 / 9.0 - mu * mu, 0.0)) * 1.1;
  vec3 lo = mu - sigma, hi = mu + sigma, c = 0.5 * (hi + lo), e = 0.5 * (hi - lo) + 1e-4;
  vec3 v = h - c, a = abs(v / e); float k = max(a.x, max(a.y, a.z));
  if (k > 1.0) h = c + v / k;
  // Faster convergence where the camera moved more (less blur on fast pans).
  float moved = length((puv - vUv) / uTexel);
  float blend = clamp(uBlend + moved * 0.01, uBlend, 0.35);
  gl_FragColor = vec4(itm(fromY(mix(h, cur, blend))), 1.0);
}`,
};

// Output: an optional night grade, then tone mapping and sRGB. At night the eye loses colour and
// shifts blue (the Purkinje shift), so moonlit scenes read as night rather than as a dim day.
const OutputShader = {
  uniforms: { tColor: { value: null }, uNight: { value: 0 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */`uniform sampler2D tColor; uniform float uNight; varying vec2 vUv;
void main() { vec3 c = texture2D(tColor, vUv).rgb;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, y * vec3(0.72, 0.86, 1.18), 0.6 * uNight);
  gl_FragColor = vec4(c, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
};

export function createTemporalAA(THREE, renderer, { samples = 0, draw = null, resize = null } = {}) {
  const make = (depth) => {
    const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: depth ? samples : 0, depthBuffer: depth });
    if (depth) t.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    return t;
  };
  const current = make(true);
  let read = make(false), write = make(false);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const resolve = new THREE.ShaderMaterial({ ...TemporalResolveShader, uniforms: THREE.UniformsUtils.clone(TemporalResolveShader.uniforms), depthTest: false, depthWrite: false });
  const output = new THREE.ShaderMaterial({ ...OutputShader, uniforms: THREE.UniformsUtils.clone(OutputShader.uniforms), depthTest: false, depthWrite: false });
  const u = resolve.uniforms;
  u.uInvViewProj.value = new THREE.Matrix4(); u.uPrevViewProj.value = new THREE.Matrix4();
  u.uTexel.value = new THREE.Vector2();
  const viewProj = new THREE.Matrix4(), size = new THREE.Vector2();
  let frame = 0, reset = true;

  function setSize(w, h) {
    current.setSize(w, h); read.setSize(w, h); write.setSize(w, h);
    u.uTexel.value.set(1 / w, 1 / h); reset = true;
    resize?.(w, h);
  }

  function render(scene, camera) {
    renderer.getDrawingBufferSize(size);
    if (size.x !== current.width || size.y !== current.height) setSize(size.x, size.y);
    // Unjittered matrices for reprojection.
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uInvViewProj.value.copy(viewProj).invert();
    const [jx, jy] = JITTER[frame++ % JITTER.length];
    camera.setViewOffset(size.x, size.y, jx, jy, size.x, size.y);
    let depth = current.depthTexture;
    if (draw) depth = draw(current);
    else { renderer.setRenderTarget(current); renderer.render(scene, camera); }
    camera.clearViewOffset();

    u.tCurrent.value = current.texture; u.tDepth.value = depth; u.tHistory.value = read.texture;
    u.uReset.value = reset ? 1 : 0; reset = false;
    quad.material = resolve;
    renderer.setRenderTarget(write); renderer.render(quad, ortho);
    u.uPrevViewProj.value.copy(viewProj);

    quad.material = output; output.uniforms.tColor.value = write.texture;
    renderer.setRenderTarget(null); renderer.render(quad, ortho);
    [read, write] = [write, read];
  }

  return {
    render, setSize,
    /** Night grade, 0 (day) to 1 (full night). */
    setNight(n) { output.uniforms.uNight.value = n; },
    /** Drop history (scene swap, camera cut). */
    reset() { reset = true; },
    dispose() { for (const t of [current, read, write]) t.dispose(); resolve.dispose(); output.dispose(); quad.geometry.dispose(); },
  };
}
