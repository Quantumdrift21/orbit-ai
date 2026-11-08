// Follow-through: every joint is its own damped spring, so a sudden move (a dodge, a turn, a stop)
// ripples through the body like a person's instead of moving it as one stiff piece. The body's change
// of velocity kicks each joint (its inertia makes it lag), and each joint is also pulled along by the
// one above it, so the wave travels hips → chest → shoulders → elbows → wrists, and → knees, wings,
// feather tips, antennas: each a moment later, each settling at its own speed. Left and right differ a
// little so the two sides never move as mirror copies.
//
// Each joint has two channels in the robot's own frame (robot.js turns the kick into that frame):
//   x: sideways swing of the joint's tip (+ = toward the robot's +x)
//   z: forward/back swing of the tip (+ = forward, toward you)
// and an angle limit, roughly how far that human joint can go.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// name: [stiffness k (1/s²), damping c (1/s), kick gain (rad/s per px/s), parent, coupling, limit (rad)]
const SPEC = {
  spine: [70, 8, 0.0025, null, 0, 0.3],
  neck: [110, 11, 0.00084, 'spine', -0.7, 0.35], // counter-turns: the head stays level, like ours
  shoulderR: [38, 4.2, 0.0046, 'spine', 1, 1.0],
  shoulderL: [42, 4.6, 0.0042, 'spine', 1, 1.0],
  elbowR: [30, 3.4, 0.0029, 'shoulderR', 0.9, 1.1],
  elbowL: [33, 3.7, 0.0027, 'shoulderL', 0.9, 1.1],
  wristR: [55, 4.4, 0.0017, 'elbowR', 0.8, 0.7],
  wristL: [60, 4.8, 0.0016, 'elbowL', 0.8, 0.7],
  hipR: [34, 4.2, 0.0034, 'spine', 0.8, 0.7],
  hipL: [37, 4.5, 0.0032, 'spine', 0.8, 0.7],
  kneeR: [26, 3.2, 0.0025, 'hipR', 0.9, 0.9],
  kneeL: [29, 3.5, 0.0023, 'hipL', 0.9, 0.9],
  wingR: [22, 2.6, 0.0025, 'spine', 0.6, 0.45],
  wingL: [24, 2.8, 0.0025, 'spine', 0.6, 0.45],
  tipR: [16, 2.1, 0.0013, 'wingR', 1, 0.5],
  tipL: [17, 2.2, 0.0013, 'wingL', 1, 0.5],
  antR: [45, 2.4, 0.0038, 'spine', 1, 0.6], // Orbit's antennas: springy
  antL: [48, 2.6, 0.0038, 'spine', 1, 0.6],
};
export const JOINTS = Object.keys(SPEC); // parents always come before their children

/** All joints at rest. */
export function createJoints() {
  return Object.fromEntries(JOINTS.map((n) => [n, { x: 0, z: 0, vx: 0, vz: 0 }]));
}

/**
 * The body's velocity changed by (dx, dz) px/s in its own frame (sideways, forward): every joint's
 * inertia makes it lag the other way. Big jumps (a teleport, waking up) are capped.
 */
export function kick(j, dx, dz) {
  dx = clamp(dx, -1500, 1500);
  dz = clamp(dz, -1500, 1500);
  for (const n of JOINTS) {
    const g = SPEC[n][2];
    j[n].vx -= dx * g;
    j[n].vz -= dz * g;
  }
}

/** Advance every spring by dt seconds (sub-stepped, so a slow frame can't make it blow up). */
export function step(j, dt) {
  dt = Math.min(dt, 0.1);
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    for (const name of JOINTS) {
      const [k, c, , parent, couple, lim] = SPEC[name];
      const s = j[name];
      const px = parent ? j[parent].x * couple : 0;
      const pz = parent ? j[parent].z * couple : 0;
      s.vx += (-k * (s.x - px) - c * s.vx) * h;
      s.vz += (-k * (s.z - pz) - c * s.vz) * h;
      s.x += s.vx * h;
      s.z += s.vz * h;
      // a joint stops at its limit (and loses the speed that pushed it there)
      if (Math.abs(s.x) > lim) ((s.x = Math.sign(s.x) * lim), (s.vx *= -0.2));
      if (Math.abs(s.z) > lim) ((s.z = Math.sign(s.z) * lim), (s.vz *= -0.2));
    }
  }
  return j;
}

/**
 * Startle reflex, `s` seconds after a dodge began: 0 → 1 in a tenth of a second (hands come up, knees
 * tuck, fingers clench, head ducks), then eases off over the next ~0.85 s. 0 outside that.
 */
export function flinch(s) {
  if (!(s >= 0) || s > 0.95) return 0;
  if (s < 0.1) return Math.sin(((s / 0.1) * Math.PI) / 2);
  return 0.5 * (1 + Math.cos((Math.PI * (s - 0.1)) / 0.85));
}
