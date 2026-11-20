import * as T from './vendor/three.module.js';

import { growTree, random, shootFrame, shootSample, species } from './growth.js';

const X = new T.Vector3(1, 0, 0);
const Y = new T.Vector3(0, 1, 0);
const Z = new T.Vector3(0, 0, 1);
const CIRCLE = Math.PI * 2;
const RAD = Math.PI / 180;

export const defaults = Object.freeze({ species: 'oak', height: 8, spread: 100, density: 65, seed: 24 });

class GeometryBuilder {
  positions = [];
  colors = [];
  uv = [];
  normals = [];

  triangle(a, b, c, color, uv = [0, 0, 1, 0, 1, 1], normals = []) {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    if (color) this.colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
    this.uv.push(...uv);
    for (const normal of normals) this.normals.push(normal.x, normal.y, normal.z);
  }

  quad(a, b, c, d) {
    this.triangle(a, b, c);
    this.triangle(a, c, d, undefined, [0, 0, 1, 1, 0, 1]);
  }

  finish() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    if (this.colors.length) g.setAttribute('color', new T.Float32BufferAttribute(this.colors, 3));
    if (this.normals.length) g.setAttribute('normal', new T.Float32BufferAttribute(this.normals, 3));
    else g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }
}

function tube(builder, axis, sides, tint, rng) {
  const { nodes, radii } = axis;
  let tangent = nodes[1].clone().sub(nodes[0]).normalize();
  let { side } = shootFrame(tangent);
  const frameRotation = new T.Quaternion();
  const turns = Math.max(1, Math.round(radii[0] * CIRCLE / .92));
  const offset = rng();
  const rings = nodes.map((point, i) => {
    const nextTangent = nodes[Math.min(i + 1, nodes.length - 1)].clone().sub(nodes[Math.max(i - 1, 0)]).normalize();
    side.applyQuaternion(frameRotation.setFromUnitVectors(tangent, nextTangent));
    tangent = nextTangent;
    const up = new T.Vector3().crossVectors(tangent, side).normalize();
    return Array.from({ length: sides }, (_, j) => {
      const theta = CIRCLE * j / sides;
      const normal = side.clone().multiplyScalar(Math.cos(theta)).addScaledVector(up, Math.sin(theta));
      return { point: point.clone().addScaledVector(normal, radii[i]), normal };
    });
  });
  let v0 = rng();
  for (let i = 0; i < rings.length - 1; i++) {
    const v1 = v0 + nodes[i].distanceTo(nodes[i + 1]) * .88;
    const color = tint.clone().multiplyScalar(.86 + .14 * Math.min(1, nodes[i].y / .82));
    for (let j = 0; j < sides; j++) {
      const next = (j + 1) % sides;
      const [a, b, c, d] = [rings[i][j], rings[i][next], rings[i + 1][next], rings[i + 1][j]];
      const u0 = offset + turns * j / sides;
      const u1 = offset + turns * (j + 1) / sides;
      builder.triangle(a.point, b.point, c.point, color, [u0, v0, u1, v0, u1, v1], [a.normal, b.normal, c.normal]);
      builder.triangle(a.point, c.point, d.point, color, [u0, v0, u1, v1, u0, v1], [a.normal, c.normal, d.normal]);
    }
    v0 = v1;
  }
}

const profiles = {
  oak: [[.15, .31], [.24, .22], [.33, .76], [.43, .52], [.55, 1], [.64, .67], [.76, .86], [.88, .51]],
  birch: [[.19, .67], [.38, 1], [.58, .82], [.77, .45]],
};

function blade(builder, base, direction, across, length, kind, color) {
  const normal = new T.Vector3().crossVectors(direction, across).normalize();
  const tip = base.clone().addScaledVector(direction, length).addScaledVector(Y, -length * .17);
  const halfWidth = length * (kind === 'oak' ? .28 : .41);
  const ridge = base.clone().lerp(tip, .50).addScaledVector(normal, length * .063);
  let left = base;
  let right = base;
  const shaded = color.clone().multiplyScalar(.92);
  for (const [position, width] of profiles[kind]) {
    const middle = base.clone().lerp(tip, position);
    const nextLeft = middle.clone().addScaledVector(across, -halfWidth * width);
    const nextRight = middle.clone().addScaledVector(across, halfWidth * width);
    builder.triangle(ridge, left, nextLeft, color);
    builder.triangle(ridge, nextRight, right, shaded);
    left = nextLeft;
    right = nextRight;
  }
  builder.triangle(ridge, left, tip, color);
  builder.triangle(ridge, tip, right, shaded);
}

function leafOnShoot(builder, point, tangent, socket, size, config, kind, color, rng) {
  const outward = socket.clone().addScaledVector(tangent, kind === 'oak' ? .24 : .38);
  outward.y = 0;
  if (outward.lengthSq() < .0001) outward.copy(tangent).setY(0);
  outward.normalize();
  const droop = kind === 'birch' ? .78 : .51;
  const sign = rng() < droop ? -1 : 1;
  const pitch = sign * (config.leafPitch + (rng() - .5) * 31) * RAD;
  const direction = outward.multiplyScalar(Math.cos(pitch)).addScaledVector(Y, Math.sin(pitch)).normalize();
  const across = new T.Vector3().crossVectors(Y, direction).normalize()
    .applyAxisAngle(direction, (rng() - .5) * .48);
  const petiole = size * (kind === 'birch' ? .21 : .17);
  const base = point.clone().addScaledVector(socket, petiole * .62).addScaledVector(direction, petiole * .54);
  builder.triangle(point, base.clone().addScaledVector(across, size * .022), base.clone().addScaledVector(across, -size * .022), color);
  blade(builder, base, direction, across, size, kind, color);
}

function needlesOnShoot(builder, point, tangent, socket, length, color) {
  const across = new T.Vector3().crossVectors(tangent, socket).normalize();
  // A Scots-pine-like fascicle carries two needles at one attachment point.
  for (const spread of [-.22, .26]) {
    const axis = tangent.clone().addScaledVector(socket, 1.15).addScaledVector(across, spread).normalize();
    const mid = point.clone().addScaledVector(axis, length * .52);
    const tip = point.clone().addScaledVector(axis, length).addScaledVector(socket, length * .12);
    const needleWidth = length * .050;
    const left = mid.clone().addScaledVector(across, -needleWidth);
    const right = mid.clone().addScaledVector(across, needleWidth);
    builder.triangle(point, left, right, color);
    builder.triangle(left, tip, right, color);
  }
}

function paintedShoot(config, kind) {
  const image = document.createElement('canvas');
  image.width = image.height = 256;
  const ctx = image.getContext('2d');
  const rng = random(718);
  const pine = kind === 'pine';
  const count = pine ? 31 : 21;
  for (let i = 0; i < count; i++) {
    const f = i / count;
    const a = i * config.divergence;
    const side = Math.cos(a) > 0 ? 1 : -1;
    const scale = (.86 + rng() * .24) * (1.2 - .52 * f);
    const size = (pine ? 38 : kind === 'birch' ? 29 : 34) * scale;
    const half = size * (pine ? .055 : kind === 'birch' ? .38 : .29);
    ctx.save();
    ctx.translate(16 + f * 207, 128 + Math.sin(f * 2) * -7);
    ctx.rotate(side * (.80 + Math.abs(Math.cos(a)) * .59));
    ctx.fillStyle = config.leaves[Math.floor(rng() * config.leaves.length)];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const outline = pine ? [[.56, 1]] : profiles[kind];
    for (const [position, width] of outline) ctx.lineTo(size * position, half * width);
    ctx.lineTo(size, 0);
    for (const [position, width] of [...outline].reverse()) ctx.lineTo(size * position, -half * width);
    ctx.fill();
    ctx.restore();
  }
  return canvasTexture(image);
}

function canvasTexture(image) {
  const texture = new T.CanvasTexture(image);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function card(builder, center, width, height, angle, tilt = 0) {
  const across = new T.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(width / 2);
  const up = new T.Vector3(-Math.sin(angle) * Math.sin(tilt), Math.cos(tilt), Math.cos(angle) * Math.sin(tilt)).multiplyScalar(height / 2);
  builder.quad(
    center.clone().sub(across).sub(up),
    center.clone().add(across).sub(up),
    center.clone().add(across).add(up),
    center.clone().sub(across).add(up)
  );
}

function shootCards(builder, axis, kind, lengthLimit) {
  const { point: start, tangent } = shootSample(axis, 0);
  const end = axis.nodes.at(-1).clone().addScaledVector(tangent, lengthLimit * .6);
  const { side, up } = shootFrame(tangent);
  const extension = lengthLimit * (kind === 'pine' ? 1.34 : 1.12);
  for (const width of [side, up]) {
    const offset = width.multiplyScalar(extension);
    builder.quad(
      start.clone().sub(offset), end.clone().sub(offset),
      end.clone().add(offset), start.clone().add(offset)
    );
  }
}

function model(recipe, mode) {
  const axes = growTree(recipe);
  const config = species[recipe.species];
  const trunk = new GeometryBuilder();
  const blades = new GeometryBuilder();
  const cards = new GeometryBuilder();
  const bark = new T.Color('#ffffff');
  const palette = config.leaves.map(hex => new T.Color(hex));
  const rng = random(recipe.seed ^ 441);
  const frameRotation = new T.Quaternion();
  const pine = recipe.species === 'pine';
  let top = 0;
  for (const axis of axes) {
    const sides = axis.depth === 0 ? 14 : axis.depth === 1 ? 8 : axis.depth === 2 ? 5 : 3;
    tube(trunk, axis, sides, bark, rng);
    top = Math.max(top, ...axis.nodes.map(point => point.y));
    if (!axis.foliage) continue;
    const density = recipe.density / 100;
    const count = pine ? Math.round(5 + density * 13) : Math.round(4 + density * 10);
    const phase = rng() * CIRCLE;
    const matureLength = config.leafLength * (.84 + rng() * .30);
    if (mode === 'hybrid') {
      shootCards(cards, axis, recipe.species, matureLength * (.72 + density * .37));
      continue;
    }
    const { tangent: firstTangent } = shootSample(axis, 0);
    const frame = shootFrame(firstTangent);
    for (let i = 0; i < count; i++) {
      const f = (i + .6) / count;
      const { point, tangent } = shootSample(axis, pine ? .22 + .77 * f : .08 + .91 * f);
      const azimuth = phase + i * config.divergence + (rng() - .5) * .20;
      const socket = frame.side.clone().multiplyScalar(Math.cos(azimuth))
        .addScaledVector(frame.up, Math.sin(azimuth))
        .applyQuaternion(frameRotation.setFromUnitVectors(firstTangent, tangent));
      const shade = .74 + Math.min(1, point.y / 8) * .30 + rng() * .13;
      const color = palette[Math.floor(rng() * palette.length)].clone().multiplyScalar(shade);
      const size = matureLength * (1.19 - .47 * f) * (.84 + rng() * .32);
      if (pine) needlesOnShoot(blades, point, tangent, socket, size, color);
      else leafOnShoot(blades, point, tangent, socket, size, config, recipe.species, color, rng);
    }
  }
  return { trunk: trunk.finish(), foliage: (mode === 'hybrid' ? cards : blades).finish(), referenceHeight: top };
}

export const lighting = () => {
  const ambient = new T.HemisphereLight('#f9ffeb', '#6b755a', 1.65);
  const sun = new T.DirectionalLight('#fff1cf', 2.55);
  sun.position.set(-8, 12, 5);
  return [ambient, sun];
};

const barkImages = new Map();
const barkFiles = Object.fromEntries(Object.keys(species).map(kind => [kind, {
  albedo: `./bark/${kind}-albedo.webp`,
  normal: `./bark/${kind}-normal.webp`,
}]));

export async function loadBarkTextures() {
  await Promise.all(Object.entries(barkFiles).map(async ([kind, files]) => {
    const maps = {};
    await Promise.all(Object.entries(files).map(async ([name, src]) => {
      const image = new Image();
      image.src = src;
      try {
        await image.decode();
        maps[name] = image;
      } catch {
        // The plain material keeps recipes usable if a local asset is missing.
      }
    }));
    barkImages.set(kind, maps);
  }));
}

function repeatMap(image, color) {
  if (!image) return null;
  const map = new T.Texture(image);
  map.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

function leafMaterial(options) {
  const material = new T.MeshLambertMaterial(options);
  material.onBeforeCompile = shader => {
    const lightingChunk = T.ShaderChunk.lights_lambert_pars_fragment.replace(
      'vec3 irradiance = dotNL * directLight.color;',
      `float sunSide = dot(geometryNormal, directLight.direction);
      float throughLeaf = 0.24 * pow(max(-sunSide, 0.0), 0.65);
      float softEdge = 0.13 * pow(1.0 - abs(sunSide), 2.0);
      vec3 irradiance = (vec3(dotNL + softEdge) + throughLeaf * vec3(0.94, 1.0, 0.48)) * directLight.color;`
    );
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_lambert_pars_fragment>', lightingChunk);
  };
  return material;
}

const textured = (map, lit) => {
  const options = { map, side: T.DoubleSide, alphaTest: .48, alphaToCoverage: true };
  return lit ? leafMaterial(options) : new T.MeshBasicMaterial({ ...options, toneMapped: false });
};

export function treeMaterials(kind, mode, barkDetail) {
  const images = barkImages.get(kind);
  const map = barkDetail ? repeatMap(images?.albedo, true) : null;
  const normalMap = map ? repeatMap(images?.normal, false) : null;
  const bark = new T.MeshStandardMaterial({
    color: map ? '#fffdf8' : species[kind].bark, side: T.FrontSide, vertexColors: true,
    map, normalMap, normalScale: new T.Vector2(.53, .53),
    roughness: .94, metalness: 0,
  });
  const leaves = mode === 'hybrid'
    ? textured(paintedShoot(species[kind], kind), true)
    : leafMaterial({ vertexColors: true, side: T.DoubleSide });
  return { bark, leaves };
}

function bake(model, renderer, materials) {
  const offscreen = new T.Scene();
  offscreen.add(...lighting());
  offscreen.add(new T.Mesh(model.trunk, materials.bark), new T.Mesh(model.foliage, materials.leaves));
  const box = model.trunk.boundingBox.clone().union(model.foliage.boundingBox);
  const top = box.max.y + .33;
  const bottom = -.27;
  const center = box.getCenter(new T.Vector3());
  const size = box.getSize(new T.Vector3());
  const halfX = size.x / 2 + .38;
  const halfZ = size.z / 2 + .38;
  const resolution = 512;
  const oldSize = renderer.getSize(new T.Vector2());
  const oldRatio = renderer.getPixelRatio();
  const oldAlpha = renderer.getClearAlpha();
  renderer.setPixelRatio(1);
  renderer.setSize(resolution, resolution, false);
  renderer.setClearAlpha(0);
  const output = [];
  for (const [direction, half, angle] of [[Z, halfX, 0], [X, halfZ, -Math.PI / 2]]) {
    const y = (top + bottom) / 2;
    const camera = new T.OrthographicCamera(-half, half, (top - bottom) / 2, -(top - bottom) / 2, .1, 80);
    const target = new T.Vector3(center.x, y, center.z);
    camera.position.copy(target).addScaledVector(direction, 24);
    camera.lookAt(target);
    renderer.render(offscreen, camera);
    const image = document.createElement('canvas');
    image.width = image.height = resolution;
    image.getContext('2d').drawImage(renderer.domElement, 0, 0);
    const builder = new GeometryBuilder();
    card(builder, target, half * 2, top - bottom, angle);
    output.push({ geometry: builder.finish(), material: textured(canvasTexture(image), false) });
  }
  renderer.setClearAlpha(oldAlpha);
  renderer.setPixelRatio(oldRatio);
  renderer.setSize(oldSize.x, oldSize.y, false);
  return output;
}

export function buildTree(recipe, mode, renderer, materials) {
  const tree = model(recipe, mode);
  const { referenceHeight } = tree;
  if (mode === 'cards') {
    const parts = bake(tree, renderer, materials);
    tree.trunk.dispose();
    tree.foliage.dispose();
    return { referenceHeight, parts };
  }

  return {
    referenceHeight,
    parts: [
      { geometry: tree.trunk, material: materials.bark },
      { geometry: tree.foliage, material: materials.leaves },
    ],
  };
}
