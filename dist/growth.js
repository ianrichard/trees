import * as T from './vendor/three.module.js';

const UP = new T.Vector3(0, 1, 0);
const FORWARD = new T.Vector3(0, 0, 1);
const TURN = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const degrees = value => value * Math.PI / 180;

export const species = {
  oak: {
    trunkLength: 6.95, trunkRadius: .30, leaders: 10, crownBase: .31,
    bark: '#75614a', leaves: ['#405c2a', '#507235', '#627d3e', '#6f8a45'],
    leafLength: .19, leafPitch: 25, divergence: TURN * 2 / 5,
  },
  birch: {
    trunkLength: 7.55, trunkRadius: .18, leaders: 13, crownBase: .28,
    bark: '#c0b9a6', leaves: ['#557533', '#678842', '#789646', '#829b50'],
    leafLength: .115, leafPitch: 49, divergence: GOLDEN_ANGLE,
  },
  pine: {
    trunkLength: 7.85, trunkRadius: .24, whorls: 6, crownBase: .25,
    bark: '#71513d', leaves: ['#35523a', '#416447', '#4c7350', '#57805a'],
    leafLength: .105, divergence: GOLDEN_ANGLE,
  },
};

export function random(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const jitter = (rng, range) => (rng() - .5) * 2 * range;

export function shootFrame(tangent) {
  const side = new T.Vector3().crossVectors(Math.abs(tangent.y) > .95 ? FORWARD : UP, tangent).normalize();
  const up = new T.Vector3().crossVectors(tangent, side);
  return { side, up };
}

export function shootSample(axis, fraction) {
  const index = Math.min(axis.nodes.length - 2, Math.floor(fraction * (axis.nodes.length - 1)));
  const start = axis.nodes[index];
  const end = axis.nodes[index + 1];
  return {
    point: start.clone().lerp(end, fraction * (axis.nodes.length - 1) - index),
    tangent: end.clone().sub(start).normalize(),
  };
}

function branchDirection(tangent, azimuth, inclination) {
  const { side, up } = shootFrame(tangent);
  return tangent.clone().multiplyScalar(Math.cos(inclination))
    .addScaledVector(side, Math.sin(inclination) * Math.cos(azimuth))
    .addScaledVector(up, Math.sin(inclination) * Math.sin(azimuth)).normalize();
}

function extendAxis(start, initialDirection, length, segments, turn, bend, rng) {
  const direction = initialDirection.clone();
  const { side } = shootFrame(direction);
  const sweep = jitter(rng, segments > 20 ? .17 : .52);
  const phase = rng() * TURN;
  const nodes = [start.clone()];
  for (let i = 1; i <= segments; i++) {
    const age = i / segments;
    direction.addScaledVector(UP, (turn + bend * age * age) / segments)
      .addScaledVector(side, (sweep + .19 * Math.cos(phase + age * Math.PI * 1.7)) / segments).normalize();
    nodes.push(nodes.at(-1).clone().addScaledVector(direction, length / segments));
  }
  return { nodes, branches: [], foliage: false };
}

function ramify(parent, fraction, azimuth, inclination, length, segments, turn, bend, rng) {
  const node = Math.max(1, Math.min(parent.nodes.length - 1, Math.round(fraction * (parent.nodes.length - 1))));
  const { point, tangent } = shootSample(parent, node / (parent.nodes.length - 1));
  const direction = branchDirection(tangent, azimuth, degrees(inclination));
  const child = extendAxis(point, direction, length, segments, turn, bend, rng);
  parent.branches.push({ node, child });
  return child;
}

function branchTaper(axis) {
  const supportedArea = new Float32Array(axis.nodes.length);
  for (const { node, child } of axis.branches) supportedArea[node] += branchTaper(child);
  let area = axis.foliage ? 1.15 : .10;
  const areas = new Float32Array(axis.nodes.length);
  for (let i = areas.length - 1; i >= 0; i--) {
    areas[i] = area + supportedArea[i];
    area = areas[i] * 1.024;
  }
  axis.areas = areas;
  return areas[0];
}

function growTwigs(branch, length, pine, birch, rng) {
  const count = 2 + (rng() < .60 ? 1 : 0);
  const phase = rng() > .5 ? 0 : Math.PI;
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / count;
    const angle = phase + (pine ? i * Math.PI : i * GOLDEN_ANGLE) + jitter(rng, .29);
    const pitch = pine ? 41 : birch ? 40 : 39;
    const twigLength = length * (1.08 - .36 * t) * (.76 + rng() * .45);
    const twig = ramify(branch, .30 + .62 * t, angle, pitch + jitter(rng, 15), twigLength, 3,
      pine ? .27 : .50, birch ? -.95 : -.22, rng);
    twig.foliage = true;
  }
  const tip = ramify(branch, 1, rng() * TURN, 6 + rng() * 9, length * .69, 3, .27, birch ? -.7 : -.14, rng);
  tip.foliage = true;
}

function scaffold(main, attachment, angle, length, slope, kind, rng) {
  const pine = kind === 'pine';
  const birch = kind === 'birch';
  const limb = ramify(main, attachment, angle, slope, length, 12,
    pine ? -.23 : birch ? .15 : .24, pine ? .95 : birch ? -1.16 : .38, rng);
  const branches = (pine ? 3 : 4) + Math.floor(rng() * 2);
  const phase = rng() * TURN;
  for (let i = 0; i < branches; i++) {
    const t = i / (branches - 1);
    const origin = .28 + .67 * t + jitter(rng, .026);
    const twoRanks = i % 2 ? Math.PI : 0;
    const azimuth = pine ? twoRanks + jitter(rng, .32)
      : birch ? phase + i * GOLDEN_ANGLE + jitter(rng, .35)
      : twoRanks + Math.cos(twoRanks) * (.38 + jitter(rng, .51));
    const fork = !pine && !birch && i === branches - 2 && rng() > .38;
    const inclination = (pine ? 46 : birch ? 50 : fork ? 29 : 51) + jitter(rng, 15);
    const reach = length * (fork ? .49 : .42) * (1.16 - t * .50) * (.75 + rng() * .47);
    const lateral = ramify(limb, origin, azimuth, inclination, reach, 7,
      pine ? .23 : birch ? .20 : .51, pine ? .42 : birch ? -1.03 : -.15, rng);
    growTwigs(lateral, Math.min(pine ? .59 : birch ? .54 : .63, reach * .59 + .17), pine, birch, rng);
  }
  growTwigs(limb, pine ? .47 : .49, pine, birch, rng);
}

export function growTree(recipe) {
  const config = species[recipe.species];
  const rng = random(recipe.seed);
  const pine = recipe.species === 'pine';
  const birch = recipe.species === 'birch';
  const heading = rng() * TURN;
  const leaderTilt = pine ? .02 : birch ? .13 : .105;
  const main = extendAxis(new T.Vector3(), new T.Vector3(Math.cos(heading) * leaderTilt, 1, Math.sin(heading) * leaderTilt).normalize(),
    config.trunkLength, 32, pine ? .95 : .67, 0, rng);

  if (pine) {
    for (let i = 0; i < config.whorls; i++) {
      const age = i / (config.whorls - 1);
      const attachment = config.crownBase + .67 * age + jitter(rng, .022);
      const count = 3 + Math.floor(rng() * 3);
      const rotation = rng() * TURN;
      for (let j = 0; j < count; j++) {
        if (i < 2 && count > 3 && rng() < .12) continue;
        const azimuth = rotation + j / count * TURN + jitter(rng, .28);
        const length = (2.84 * Math.pow(1 - age, .84) + .52) * (.78 + rng() * .31);
        scaffold(main, attachment, azimuth, length, 75 - age * 17 + jitter(rng, 11), recipe.species, rng);
      }
    }
  } else {
    // Sample bud order, then let buds fail to develop into major limbs.
    let bud = 0;
    for (let i = 0; i < config.leaders; i++) {
      bud += 1 + (rng() < .38 ? 1 : 0);
      const age = i / (config.leaders - 1);
      const attachment = config.crownBase + .61 * age + jitter(rng, .022);
      const azimuth = heading + bud * config.divergence + jitter(rng, .43);
      const envelope = Math.pow(Math.sin(Math.PI * (.19 + .75 * age)), .74);
      const length = (birch ? 2.43 : 4.36) * envelope * (.79 + rng() * .36) + .23;
      const inclination = (birch ? 55 : 76) - age * (birch ? 20 : 26) + jitter(rng, birch ? 11 : 15);
      scaffold(main, attachment, azimuth, length, inclination, recipe.species, rng);
    }
  }
  growTwigs(main, pine ? .36 : .43, pine, birch, rng);
  const area = branchTaper(main);
  const axes = [];
  const spread = recipe.spread / 100;
  function collect(axis, depth) {
    for (const point of axis.nodes) {
      point.x *= spread;
      point.z *= spread;
    }
    const tip = axis.nodes.length - 1;
    const terminalFork = axis.branches.some(({ node }) => node === tip);
    axis.radii = Array.from(axis.areas, (supported, i) => {
      const flare = depth === 0 ? 1 + .58 * Math.exp(-i * .66) : 1;
      const taper = i === tip && !terminalFork ? .33 : axis.foliage ? 1 - .34 * i / tip : 1;
      return config.trunkRadius * Math.sqrt(supported / area) * flare * taper;
    });
    axis.depth = depth;
    axes.push(axis);
    for (const { child } of axis.branches) collect(child, depth + 1);
  }
  collect(main, 0);
  return axes;
}
