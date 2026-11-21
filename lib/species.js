// Tree kinds. Everything an author does not say comes from here.
// Leaf colours are calibrated, not picked: each kind's mean is a sunlit leaf's linear reflectance
// (R ≈ 650 nm, G ≈ 550 nm, B ≈ 450 nm; broadleaf G ≈ 0.10–0.13, conifers ≈ 0.055), with G/R ≈ 1.8
// and G/B ≈ 2.5 as measured leaves show. The four tones run shade (darker, cooler) to sun (lighter,
// warmer, less saturated). Earlier hand-picked greens had G/B of 5–8, which is what read as neon.
// Lengths are meters at the kind's default height; placed trees scale uniformly to `height`
// and non-uniformly (x/z) to `width`, so one grown skeleton serves every size.

export const KINDS = {
  oak: {
    label: 'Oak',
    sag: 0.09,
    height: 9, width: 9.5,
    form: 'colonize',
    // Crown envelope: a squashed sphere that is fuller on top, set on a short bole.
    crown: { base: 0.2, center: 0.6, rx: 0.5, ry: 0.4, bottomFlatten: 0.6, top: 1.0, lobes: 0.22, clump: 0.65 },
    attractors: 2600, step: 0.3, influence: 2.8, kill: 0.45,
    tropism: [0, 0.12, 0], wander: 0.28, trunkWander: 0.06,
    trunkRadius: 0.32, flare: 0.75, pipe: 2.35, minTwig: 0.009,
    leaf: { size: 0.95, perNode: 2.2, tips: 5, color: ['#374c31', '#3e5536', '#465c3b', '#4e6441'], shape: 'oak', droop: 0.15,
      angle: { mean: 35, sd: 19, gradient: 22, spread: 55 }, shadeGrow: 0.35, tipScale: 0.75, fold: 18 },
    bark: { color: '#7a6a58', tex: 'oak', tile: 1.1 },
    sss: 0.55,
  },
  maple: {
    label: 'Maple',
    sag: 0.05,
    height: 10, width: 8.5,
    form: 'colonize',
    crown: { base: 0.24, center: 0.62, rx: 0.44, ry: 0.4, bottomFlatten: 0.7, top: 1.0, lobes: 0.26, clump: 0.7 },
    attractors: 2600, step: 0.3, influence: 2.6, kill: 0.42,
    tropism: [0, 0.32, 0], wander: 0.22, trunkWander: 0.04,
    trunkRadius: 0.27, flare: 0.55, pipe: 2.4, minTwig: 0.009,
    leaf: { size: 0.9, perNode: 2.0, tips: 5, color: ['#3a5234', '#425c39', '#4a643e', '#526c44'], shape: 'maple', droop: 0.1,
      angle: { mean: 27, sd: 17, gradient: 18, spread: 50 }, shadeGrow: 0.4, tipScale: 0.75, fold: 14 },
    bark: { color: '#6f655c', tex: 'oak', tile: 1.0 },
    sss: 0.65,
  },
  birch: {
    label: 'Birch',
    sag: 0.12,
    height: 12, width: 5.5,
    form: 'colonize',
    crown: { base: 0.3, center: 0.6, rx: 0.24, ry: 0.42, bottomFlatten: 1.0, top: 1.0 },
    attractors: 1800, step: 0.28, influence: 2.2, kill: 0.4,
    tropism: [0, 0.5, 0], wander: 0.18, trunkWander: 0.035,
    trunkRadius: 0.17, flare: 0.25, pipe: 2.2, minTwig: 0.007,
    leaf: { size: 0.78, perNode: 2.3, tips: 4, color: ['#3f5635', '#47603a', '#50693f', '#587146'], shape: 'birch', droop: 0.55,
      angle: { mean: 49, sd: 18, gradient: 20, spread: 60 }, shadeGrow: 0.3, tipScale: 0.8, fold: 16 },
    bark: { color: '#d8d2c4', tex: 'birch', tile: 1.4 },
    sss: 0.8,
  },
  pine: {
    label: 'Pine',
    sag: 0,
    height: 14, width: 6,
    form: 'whorl',
    crown: { base: 0.12, top: 1.0 },
    whorls: 13, perWhorl: 6, trunkRadius: 0.28, flare: 0.5, pipe: 2.4, minTwig: 0.018,
    branchAngle: 76, branchDroop: 0.12, lengthTop: 0.08, lengthBottom: 0.36, wander: 0.1, trunkWander: 0.025,
    leaf: { size: 1.25, perNode: 1.5, tips: 4, alphaTest: 0.3, color: ['#293a29', '#2f412d', '#354731', '#3b4d36'], shape: 'needle', droop: 0.25,
      angle: { mean: 12, sd: 9, gradient: 10, spread: 40 }, shadeGrow: 0.1, tipScale: 0.85, fold: 8 },
    bark: { color: '#7a5a44', tex: 'pine', tile: 1.2 },
    sss: 0.3,
  },
  shrub: {
    label: 'Shrub',
    sag: 0.02,
    height: 1.6, width: 2.2,
    form: 'colonize',
    crown: { base: 0.04, center: 0.52, rx: 0.62, ry: 0.5, bottomFlatten: 0.4, top: 1.0 },
    attractors: 700, step: 0.09, influence: 0.6, kill: 0.14,
    tropism: [0, 0.2, 0], wander: 0.3, trunkWander: 0.2, stems: 5,
    trunkRadius: 0.035, flare: 0.0, pipe: 2.2, minTwig: 0.004,
    leaf: { size: 0.34, perNode: 1.8, tips: 4, color: ['#34492f', '#3b5134', '#425938', '#4a603f'], shape: 'birch', droop: 0.1,
      angle: { mean: 30, sd: 20, gradient: 14, spread: 70 }, shadeGrow: 0.3, tipScale: 0.8, fold: 18 },
    bark: { color: '#5e5048', tex: 'oak', tile: 0.4 },
    sss: 0.5,
  },
  // Texas Hill Country. Both are data only: same growth models, new envelopes and palettes.
  liveoak: {
    // Quercus virginiana: low, very wide, limbs that sweep out and down; small dark evergreen leaves.
    label: 'Live oak',
    sag: 0.2,
    height: 8, width: 15,
    form: 'colonize',
    crown: { base: 0.16, center: 0.55, rx: 0.78, ry: 0.3, bottomFlatten: 0.85, top: 0.92, lobes: 0.28, clump: 0.7 },
    attractors: 3000, step: 0.32, influence: 3.0, kill: 0.48,
    tropism: [0, -0.04, 0], wander: 0.34, trunkWander: 0.12, stems: 2,
    trunkRadius: 0.42, flare: 0.9, pipe: 2.3, minTwig: 0.01,
    leaf: { size: 0.8, perNode: 2.4, tips: 5, color: ['#2d3d29', '#33442d', '#3a4a31', '#405136'], shape: 'birch', droop: 0.1,
      angle: { mean: 30, sd: 18, gradient: 18, spread: 55 }, shadeGrow: 0.3, tipScale: 0.8, fold: 14 },
    bark: { color: '#5c534b', tex: 'oak', tile: 1.0 },
    sss: 0.35,
  },
  juniper: {
    // Ashe juniper ("cedar"): a dense, many-stemmed, blue-green evergreen, often bushy to the ground.
    label: 'Juniper',
    sag: 0.04,
    height: 6, width: 4.6,
    form: 'colonize',
    crown: { base: 0.05, center: 0.5, rx: 0.46, ry: 0.5, bottomFlatten: 0.3, top: 0.75, lobes: 0.3, clump: 0.75 },
    attractors: 1500, step: 0.18, influence: 1.4, kill: 0.26,
    tropism: [0, 0.3, 0], wander: 0.3, trunkWander: 0.18, stems: 3,
    trunkRadius: 0.12, flare: 0.2, pipe: 2.2, minTwig: 0.006,
    leaf: { size: 0.62, perNode: 2.6, tips: 4, alphaTest: 0.32, color: ['#2a382d', '#303e32', '#364436', '#3d4a3c'], shape: 'needle', droop: 0.05,
      angle: { mean: 35, sd: 25, gradient: 10, spread: 80 }, shadeGrow: 0.15, tipScale: 0.85, fold: 10 },
    bark: { color: '#6b5546', tex: 'pine', tile: 0.6 },
    sss: 0.25,
  },
};

export const KIND_NAMES = Object.keys(KINDS);
export const DEFAULT_KIND = 'oak';
/** Distinct skeletons grown per kind. A tree's seed picks one, then varies yaw, lean and size. */
export const VARIANTS = 6;
