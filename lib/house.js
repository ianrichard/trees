// A lab stand-in for an Alian building: walls, a gable roof, door and windows, on a foundation.
// It proves the ground rule, not architecture: the floor sits at the highest grade under the
// footprint plus a reveal (ground.js role 4), and the foundation runs down to the lowest grade, so
// on a slope the downhill side shows a walkout wall and nothing is ever buried.
//
//   { "use": "house", "at": [0, -6], "turn": 15 }                  10 × 7.5 m, one storey
//   { "use": "house", "at": [0, -6], "params": { "size": [12, 8], "storeys": 2 } }

export function buildHouse(THREE, H, heightAt = () => H.floor - H.reveal) {
  const p = H.params, storeys = p.storeys ?? 1, wallH = 2.8 * storeys, pitch = p.pitch ?? 0.62;
  const w = H.w, d = H.d, t = 0.25;
  const g = new THREE.Group();
  g.position.set(H.x, H.floor, H.z);
  g.rotation.y = -H.turn;

  const mat = (color, rough = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
  const plaster = mat(p.wall ?? '#e4ddcf'), concrete = mat('#8d8a84', 0.95), roof = mat(p.roof ?? '#3d3f44', 0.8),
    trim = mat('#f3f0e8', 0.6), glass = mat('#2a3640', 0.08, { metalness: 0.2, envMapIntensity: 1.4 }), door = mat(p.door ?? '#4a3426', 0.7);
  const box = (sx, sy, sz, m, x, y, z) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b;
  };

  // Foundation: from just under the floor to below the lowest grade. Where more than a storey's
  // worth shows downhill it is a walkout: plastered like the walls, with basement windows.
  const drop = H.floor - H.low + 0.4, exposed = H.floor - H.low;
  box(w + 0.06, drop, d + 0.06, exposed > 1.6 ? plaster : concrete, 0, -drop / 2, 0);
  if (exposed > 1.6) box(w + 0.1, 0.12, d + 0.1, trim, 0, -0.08, 0);
  // Walls and floor slab.
  box(w, 0.2, d, concrete, 0, -0.1, 0);
  box(w, wallH, t, plaster, 0, wallH / 2, d / 2 - t / 2);
  box(w, wallH, t, plaster, 0, wallH / 2, -d / 2 + t / 2);
  box(t, wallH, d - 2 * t, plaster, w / 2 - t / 2, wallH / 2, 0);
  box(t, wallH, d - 2 * t, plaster, -w / 2 + t / 2, wallH / 2, 0);

  // Gable ends and roof planes (ridge along x).
  const rise = (d / 2) * pitch;
  const gable = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, rise)]);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: t, bevelEnabled: false }), plaster);
    m.rotation.y = Math.PI / 2; m.position.set(sx * (w / 2) - (sx > 0 ? t : 0), wallH, 0);
    m.castShadow = m.receiveShadow = true; g.add(m);
  }
  const slope = Math.hypot(d / 2, rise), over = 0.45, rt = 0.18;
  for (const sz of [-1, 1]) {
    const r = box(w + 2 * over, rt, slope + over, roof, 0, 0, 0);
    r.rotation.x = sz * Math.atan2(rise, d / 2);
    r.position.set(0, wallH + rise / 2 + rt / 2 - over * Math.sin(Math.atan2(rise, d / 2)) / 2, sz * (d / 4 + over / 2 * Math.cos(Math.atan2(rise, d / 2))));
  }
  // Chimney.
  box(0.6, rise + 1.2, 0.6, concrete, w * 0.28, wallH + (rise + 1.2) / 2 - 0.2, -d * 0.15);

  // Door on the front (+z), windows around.
  const front = d / 2 + 0.01;
  box(1.0, 2.15, 0.06, door, -w * 0.18, 1.075, front);
  box(1.16, 0.08, 0.1, trim, -w * 0.18, 2.19, front);
  const windowAt = (x, y, z, ry, ww = 1.3, wh = 1.35) => {
    const f = new THREE.Group();
    const add = (sx, sy, sz, m, px, py, pz) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(px, py, pz); b.castShadow = true; f.add(b); };
    add(ww, wh, 0.04, glass, 0, 0, 0);
    add(ww + 0.12, 0.08, 0.1, trim, 0, wh / 2, 0.02); add(ww + 0.12, 0.08, 0.14, trim, 0, -wh / 2, 0.04);
    add(0.08, wh, 0.1, trim, -ww / 2, 0, 0.02); add(0.08, wh, 0.1, trim, ww / 2, 0, 0.02); add(0.05, wh, 0.06, trim, 0, 0, 0.02);
    f.position.set(x, y, z); f.rotation.y = ry; g.add(f);
  };
  for (let s = 0; s < storeys; s++) {
    const y = 1.45 + s * 2.8;
    windowAt(w * 0.18, y, front, 0); if (s > 0) windowAt(-w * 0.18, y, front, 0);
    windowAt(-w * 0.25, y, -front, Math.PI); windowAt(w * 0.2, y, -front, Math.PI);
    windowAt(w / 2 + 0.01, y, 0, Math.PI / 2, 1.1); windowAt(-w / 2 - 0.01, y, 0, -Math.PI / 2, 1.1);
  }
  // Steps from the door down to the grade in front of it, however far that is.
  const world = (lx, lz) => [H.x + lx * H.cos - lz * H.sin, H.z + lx * H.sin + lz * H.cos];
  const dx = -w * 0.18;
  const tread = 0.18, run = 0.3;
  let steps = 1;
  for (let k = 0; k < 40; k++) {
    // The stair's foot moves out as it grows; settle the count against the grade there.
    const [fx, fz] = world(dx, front + steps * run + 0.3);
    const need = Math.max(1, Math.ceil((H.floor - heightAt(fx, fz)) / tread));
    if (need === steps) break;
    steps = need;
  }
  for (let k = 0; k < steps; k++) {
    const top = -k * tread, depth = (k + 1) * run;
    box(1.4, tread, run + 0.02, concrete, dx, top - tread / 2, front + depth - run / 2);
    // Each tread is a solid block down to its own grade, so nothing floats.
    const [sx, sz] = world(dx, front + depth - run / 2), under = top - tread - (heightAt(sx, sz) - H.floor);
    if (under > 0.02) box(1.4, under + 0.1, run + 0.02, concrete, dx, top - tread - under / 2, front + depth - run / 2);
  }
  // Walkout openings on the downhill faces of an exposed foundation.
  if (exposed > 1.6) {
    for (const [lx, lz, ry] of [[w * 0.2, front, 0], [-w * 0.25, -front, Math.PI], [w / 2 + 0.01, 0, Math.PI / 2], [-w / 2 - 0.01, 0, -Math.PI / 2]]) {
      const [gx, gz] = world(lx * 0.98, lz * 0.98);
      const shows = H.floor - heightAt(gx, gz);
      if (shows > 1.9) windowAt(lx, -shows / 2 - 0.1 + 0.25, lz, ry, 1.2, Math.min(1.2, shows - 0.9));
    }
  }
  return g;
}
