// Contract tests for the pure scene code (no DOM). Written for Vitest, as Alian's are, so they move
// with the code when the lab becomes examples/outdoors/.
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { resolveScene } from '../lib/scene.js';
import { buildGroundArrays, makeGroundShade } from '../lib/ground.js';
import { buildCliffs } from '../lib/cliffs.js';

const scene = (name) => JSON.parse(fs.readFileSync(new URL(`../scenes/${name}.json`, import.meta.url)));
const SCENES = ['homestead', 'ridge', 'texas', 'lot'];

describe('determinism', () => {
  test.each(SCENES)('%s resolves to the same place every time', (name) => {
    const a = resolveScene(scene(name)), b = resolveScene(scene(name));
    expect(a.trees).toEqual(b.trees);
    expect(a.plants).toEqual(b.plants);
    expect(a.ground.rocks.length).toBe(b.ground.rocks.length);
  });
  test('cliff faces are seeded', () => {
    const g = resolveScene(scene('texas')).ground;
    const [a] = buildCliffs(THREE, g), [b] = buildCliffs(THREE, g);
    expect(Array.from(a.geometry.attributes.position.array.slice(0, 3000))).toEqual(Array.from(b.geometry.attributes.position.array.slice(0, 3000)));
  });
});

describe('cliffs', () => {
  const g = resolveScene(scene('texas')).ground;
  const cliffs = buildCliffs(THREE, g);
  test('a hill-country bluff gets a face', () => expect(cliffs.length).toBeGreaterThan(0));
  test('process channels are in range (r occlusion, g age, b streak)', () => {
    const c = cliffs[0].geometry.attributes.color.array;
    for (let i = 0; i < c.length; i++) { expect(c[i]).toBeGreaterThanOrEqual(0); expect(c[i]).toBeLessThanOrEqual(1); }
  });
  test('the face is weathered, not flat: real relief and both fresh and old rock', () => {
    const c = cliffs[0].geometry.attributes.color.array;
    let fresh = 0, old = 0;
    for (let i = 1; i < c.length; i += 3) { if (c[i] < 0.3) fresh++; if (c[i] > 0.7) old++; }
    expect(fresh).toBeGreaterThan(100);
    expect(old).toBeGreaterThan(100);
  });
  test('builds within budget', () => {
    const t0 = performance.now(); buildCliffs(THREE, g);
    expect(performance.now() - t0).toBeLessThan(2500);
  });
});

describe('edges', () => {
  const r = resolveScene(scene('lot')), e = r.ground.extent;
  test('a cut lot keeps only what stands inside its line', () => {
    expect(r.ground.edge).toBe('cut');
    for (const t of r.trees) expect(r.ground.inside(t.at[0], t.at[1])).toBe(true);
    for (const k of r.ground.rocks) expect(r.ground.inside(k.x, k.z)).toBe(true);
  });
  test('a cut lot has walls down to a base and no horizon rings', () => {
    const a = buildGroundArrays(r.scene);
    expect(a.walls).not.toBeNull();
    const p = a.position;
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]).toBeGreaterThanOrEqual(e.minX - 1e-6); expect(p[i]).toBeLessThanOrEqual(e.maxX + 1e-6);
    }
  });
  test('horizon ground has no walls', () => expect(buildGroundArrays(resolveScene(scene('homestead')).scene).walls).toBeNull());
});

describe('ground and grass share one shade', () => {
  test('canopy shade darkens and is exposed for grass thinning', () => {
    const shade = makeGroundShade([{ x: 0, z: 0, r: 5 }]);
    expect(shade.occ(0, 0)).toBeLessThan(0.7);
    expect(shade.occ(20, 20)).toBe(1);
    expect(shade(0, 0, 0)[1]).toBeLessThan(shade(20, 20, 0)[1] + 0.2);
  });
});
