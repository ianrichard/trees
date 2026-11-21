// Automatic cameras. Both drive position and look target along precomputed smooth curves at a
// steady speed, and every change of direction is damped, so nothing jumps.
//
//   tour   a drone loop around the scene, high enough to clear the trees under it
//   walk   eye height along a path, at walking pace; it pauses at the end, turns and walks back

const smoothstep = (t) => t * t * (3 - 2 * t);

/** A critically damped follower for a vector (no overshoot, frame-rate independent). */
function damp(cur, goal, rate, dt) { return cur.lerp(goal, 1 - Math.exp(-rate * dt)); }

export function createTour(THREE, { ground, trees }) {
  const e = ground.extent, m = 30;
  const cx = (e.minX + e.maxX) / 2, cz = (e.minZ + e.maxZ) / 2;
  const rx = Math.max(20, (e.maxX - e.minX - 2 * m) * 0.42), rz = Math.max(20, (e.maxZ - e.minZ - 2 * m) * 0.42);
  // The drone must clear the tallest tree within reach of each point.
  const clearance = (x, z) => {
    let top = ground.heightAt(x, z) + 7;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < 12) top = Math.max(top, t.y + t.height + 4);
    return top;
  };
  const eye = [], look = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2, wob = 0.82 + 0.2 * Math.sin(i * 2.3);
    const x = cx + Math.cos(a) * rx * wob, z = cz + Math.sin(a) * rz * wob;
    eye.push(new THREE.Vector3(x, clearance(x, z) + 3 + 4 * (0.5 + 0.5 * Math.sin(i * 1.7)), z));
    const b = a + 0.9, lx = cx + Math.cos(b) * rx * 0.3, lz = cz + Math.sin(b) * rz * 0.3;
    look.push(new THREE.Vector3(lx, ground.heightAt(lx, lz) + 2, lz));
  }
  const eyeCurve = new THREE.CatmullRomCurve3(eye, true, 'centripetal');
  const lookCurve = new THREE.CatmullRomCurve3(look, true, 'centripetal');
  const length = eyeCurve.getLength(), speed = 5; // m/s
  let u = 0;
  const pos = new THREE.Vector3(), tgt = new THREE.Vector3(), goalPos = new THREE.Vector3(), goalTgt = new THREE.Vector3();
  return {
    start(camera, target) { pos.copy(camera.position); tgt.copy(target); u = 0; },
    update(camera, dt) {
      u = (u + dt * speed / length) % 1;
      eyeCurve.getPointAt(u, goalPos); lookCurve.getPointAt(u, goalTgt);
      // Ease in from wherever the camera was; after a few seconds this follows the curve exactly.
      damp(pos, goalPos, 1.2, dt); damp(tgt, goalTgt, 1.5, dt);
      camera.position.copy(pos); camera.lookAt(tgt);
      return tgt;
    },
  };
}

export function createWalk(THREE, { path, ground, eyeHeight = 1.65, speed = 1.35 }) {
  const n = path.xs.length, total = path.total;
  const at = (s, out) => {
    const f = Math.min(Math.max(s / total, 0), 1) * (n - 1), i = Math.min(Math.floor(f), n - 2), t = f - i;
    out.x = path.xs[i] + (path.xs[i + 1] - path.xs[i]) * t;
    out.z = path.zs[i] + (path.zs[i + 1] - path.zs[i]) * t;
    // The leveled path surface is smooth by construction; sample the ground itself to stay exact.
    out.y = ground.heightAt(out.x, out.z);
    return out;
  };
  let s = 0, dir = 1, phase = 'walk', hold = 0, turn = 0;
  const pos = new THREE.Vector3(), tgt = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3();
  const look = new THREE.Vector3(), goal = new THREE.Vector3(), eyeY = { v: 0 };
  return {
    start(camera) {
      s = 0; dir = 1; phase = 'walk';
      at(0, p); pos.set(p.x, p.y + eyeHeight, p.z); eyeY.v = pos.y;
      at(Math.min(total, 6), q); look.set(q.x - p.x, 0, q.z - p.z).normalize();
      camera.position.copy(pos);
    },
    update(camera, dt) {
      if (phase === 'walk') {
        // Ease in and out over the first and last two metres.
        const left = dir > 0 ? total - s : s, done = dir > 0 ? s : total - s;
        const v = speed * Math.max(0.15, Math.min(1, smoothstep(Math.min(1, done / 2) * 0.5 + 0.5), smoothstep(Math.min(1, left / 2))));
        s += dir * v * dt;
        if (left < 0.05) { s = dir > 0 ? total : 0; phase = 'hold'; hold = 1.6; }
      } else if (phase === 'hold') {
        hold -= dt;
        if (hold <= 0) { phase = 'turn'; turn = 0; }
      } else {
        turn += dt / 2.8;
        if (turn >= 1) { dir = -dir; phase = 'walk'; }
      }
      at(s, p);
      // Eye height follows the ground through a low-pass, so no step or seam reaches the camera.
      eyeY.v += (p.y + eyeHeight - eyeY.v) * (1 - Math.exp(-4 * dt));
      pos.set(p.x, eyeY.v, p.z);
      // Look along the path a few metres ahead; during the turn, swing through 180° smoothly.
      at(Math.min(total, Math.max(0, s + dir * 6)), q);
      goal.set(q.x - p.x, 0, q.z - p.z);
      if (goal.lengthSq() < 1e-6) goal.copy(look);
      goal.normalize();
      if (phase === 'turn') {
        const a = Math.atan2(goal.z, goal.x) + Math.PI * smoothstep(Math.min(turn, 1));
        goal.set(Math.cos(a), 0, Math.sin(a));
      }
      if (phase !== 'turn' && turn >= 1) turn = 0;
      damp(look, goal, phase === 'turn' ? 8 : 2.2, dt).normalize();
      // A slight downward glance follows the grade ahead.
      const ahead = (q.y - p.y) / 6;
      tgt.set(pos.x + look.x * 6, pos.y - 0.35 + ahead * 6 * 0.7, pos.z + look.z * 6);
      camera.position.copy(pos); camera.lookAt(tgt);
      return tgt;
    },
  };
}
