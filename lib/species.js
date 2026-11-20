// Tree kinds. Everything an author does not say comes from here.
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
    leaf: { size: 0.95, perNode: 2.2, tips: 5, color: ['#3f5a27', '#526e30', '#617d39', '#6f8a40'], shape: 'oak', droop: 0.15 },
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
    leaf: { size: 0.9, perNode: 2.0, tips: 5, color: ['#4a6b25', '#5b7d2c', '#6c8c33', '#7f9a3a'], shape: 'maple', droop: 0.1 },
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
    leaf: { size: 0.78, perNode: 2.3, tips: 4, color: ['#5a7a2e', '#6a8a36', '#7b983f', '#8aa547'], shape: 'birch', droop: 0.55 },
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
    leaf: { size: 1.25, perNode: 1.5, tips: 4, alphaTest: 0.3, flat: 0.8, color: ['#26381e', '#2f4424', '#38502b', '#425b31'], shape: 'needle', droop: 0.25 },
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
    leaf: { size: 0.34, perNode: 1.8, tips: 4, color: ['#3c5a2a', '#4b6b31', '#5a7a37', '#678640'], shape: 'birch', droop: 0.1 },
    bark: { color: '#5e5048', tex: 'oak', tile: 0.4 },
    sss: 0.5,
  },
};

export const KIND_NAMES = Object.keys(KINDS);
export const DEFAULT_KIND = 'oak';
/** Distinct skeletons grown per kind. A tree's seed picks one, then varies yaw, lean and size. */
export const VARIANTS = 6;
