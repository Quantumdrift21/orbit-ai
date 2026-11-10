// Jet engine physics (pure, tested in test/jet.test.mjs): how hard the engine burns and how its exhaust
// moves. renderer/jet.js draws the flame and the exhaust particles from these numbers.
//   - Throttle follows the demand with a first-order lag (an engine takes time to spool up and down),
//     and cutting it quickly gives a short "pop" (unburnt fuel flaring in the nozzle).
//   - Exhaust: each particle leaves the nozzle along the jet axis with some spread, then slows by
//     quadratic air drag (dv/dt = -k|v|v), rises because the gas is hot (buoyancy) and cools/grows
//     until its life runs out. Spawn rate is proportional to throttle.

export const SPOOL_SECS = 0.3; // spool-up/down time constant
const POP_DROP = 0.25; // a throttle cut this sudden pops
const POP_DECAY = 8; // 1/s

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * How hard the engine needs to burn: hovering, plus flying fast, plus climbing (vy < 0 is up on
 * screen), plus bursts on a stunt's jump and a defence recoil, plus
 * speeding up (`accel` px/s², braking lowers it) and turning hard (`turn` rad/s). 0..1.4 (above 1 = afterburner).
 */
export function thrustDemand({ speed = 0, vy = 0, lift = 0, recoil = 0, idle = 0.3, accel = 0, turn = 0 } = {}) {
  return clamp(
    idle +
      clamp(accel / 1500, -0.6, 1) * 0.3 + // flare speeding up, ease off coasting/braking
      Math.min(1, Math.abs(turn) / 3) * 0.15 + // hard turns burn more
      Math.min(1, speed / 600) * 0.5 +
      Math.min(1, Math.max(0, -vy) / 500) * 0.35 +
      lift * 0.8 +
      Math.abs(recoil) * 0.4,
    0,
    1.4,
  );
}

/** One engine step: { throttle, pop } → next, toward `demand`, over dt seconds. */
export function spool(engine, demand, dt) {
  const k = 1 - Math.exp(-dt / SPOOL_SECS);
  const throttle = engine.throttle + (demand - engine.throttle) * k;
  let pop = engine.pop * Math.exp(-dt * POP_DECAY);
  if (engine.throttle - demand > POP_DROP) pop = Math.max(pop, 1);
  return { throttle, pop };
}

/** A pool of `n` exhaust particles (struct of arrays, reused: no garbage while flying). */
export function createExhaust(n) {
  return {
    n,
    pos: new Float32Array(n * 3),
    vel: new Float32Array(n * 3),
    age: new Float32Array(n).fill(1),
    life: new Float32Array(n).fill(1), // age >= life: dead
    size: new Float32Array(n),
    next: 0, // ring index for the next spawn
    acc: 0, // fractional particles owed
  };
}

/**
 * Advance the exhaust by dt.
 * origin/dir: nozzle exit and unit exhaust direction (world); shift: how far the world moved under
 * the camera this frame (the window flew), so particles stay put on the desktop and trail behind.
 */
export function stepExhaust(ex, dt, opts) {
  const {
    throttle = 0,
    origin = [0, 0, 0],
    dir = [0, -1, 0],
    shift = [0, 0, 0],
    speed = 5, // exit speed at full throttle (world units/s)
    rate = 90, // particles/s at full throttle
    spread = 0.25,
    drag = 0.9,
    buoyancy = 1.1,
    lifeMin = 0.5,
    lifeMax = 1.2,
    size = 0.18,
    random = Math.random,
  } = opts;
  const { pos, vel, age, life } = ex;

  // move what's alive
  for (let i = 0; i < ex.n; i++) {
    if (age[i] >= life[i]) continue;
    age[i] += dt;
    const j = i * 3;
    const vx = vel[j];
    const vy = vel[j + 1];
    const vz = vel[j + 2];
    const s = Math.hypot(vx, vy, vz);
    const damp = 1 / (1 + drag * s * dt); // quadratic drag, unconditionally stable
    vel[j] = vx * damp;
    vel[j + 1] = vy * damp + buoyancy * dt;
    vel[j + 2] = vz * damp;
    pos[j] += vel[j] * dt + shift[0];
    pos[j + 1] += vel[j + 1] * dt + shift[1];
    pos[j + 2] += vel[j + 2] * dt + shift[2];
  }

  // spawn new ones at the nozzle
  ex.acc += Math.max(0, throttle) * rate * dt;
  while (ex.acc >= 1) {
    ex.acc -= 1;
    const i = ex.next;
    ex.next = (ex.next + 1) % ex.n;
    const j = i * 3;
    const v = speed * (0.6 + 0.4 * Math.min(1.4, throttle)) * (0.8 + 0.4 * random());
    vel[j] = (dir[0] + (random() - 0.5) * spread) * v;
    vel[j + 1] = (dir[1] + (random() - 0.5) * spread) * v;
    vel[j + 2] = (dir[2] + (random() - 0.5) * spread) * v;
    pos[j] = origin[0];
    pos[j + 1] = origin[1];
    pos[j + 2] = origin[2];
    age[i] = 0;
    life[i] = lifeMin + (lifeMax - lifeMin) * random();
    ex.size[i] = size * (0.7 + 0.6 * random());
  }
  return ex;
}

/** How many particles are alive (for tests and to skip drawing an idle engine). */
export const aliveCount = (ex) => {
  let n = 0;
  for (let i = 0; i < ex.n; i++) if (ex.age[i] < ex.life[i]) n++;
  return n;
};
