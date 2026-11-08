// Which way the robot faces while it flies (pure, tested in test/heading.test.mjs). robot.js turns a
// group around the whole robot by this every frame.
//   - Resting, talking or doing a stunt it faces you (yaw 0).
//   - Flying, it turns to face where it's going, all the way round: flying sideways shows its side,
//     flying into the screen (AeroStrike) shows its back (yaw ±π). Climbing pitches it up, diving down.
//   - It turns at a limited rate and banks into the turn (roll ∝ turn rate), like a flyer, so a U-turn
//     swings round instead of snapping.
// Coordinates: world x right, y up, z toward you; screen velocity vy is down-positive; vz is depth
// per second (away-positive), worth DEPTH_PX screen pixels for turning purposes.

const DEPTH_PX = 450;
const TURN_RATE = 4.5; // rad/s at most
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Angle difference in -π..π. */
const wrap = (a) => a - TAU * Math.round(a / TAU);

/** Perspective size at a depth (must match flight.js depthScale). */
export const depthScale = (depth = 0) => 1 / (1 + clamp(depth, -0.17, 1.85));

/**
 * One step: state { yaw, pitch, roll } → next, for velocity { vx, vy, vz }. `lean` (0..1) tips the
 * body forward into fast flight (AeroStrike flies superhero-style); `still` forces facing you.
 */
export function attitude(state, { vx = 0, vy = 0, vz = 0 }, dt, { lean = 0, still = false } = {}) {
  const X = vx;
  const Y = -vy;
  const Z = -vz * DEPTH_PX;
  const speed = still ? 0 : Math.hypot(X, Y, Z);
  const w = smooth(70, 230, speed); // how far it turns toward its flight direction
  // target heading: blend "facing you" (0, 1) with the flight direction, then take its angle
  const horiz = Math.hypot(X, Z);
  const hx = (horiz > 1e-6 ? X / horiz : 0) * w;
  const hz = (horiz > 1e-6 ? Z / horiz : 1) * w + (1 - w);
  const target = Math.hypot(hx, hz) < 1e-3 ? state.yaw : Math.atan2(hx, hz);
  const step = clamp(wrap(target - state.yaw) * Math.min(1, 5 * dt), -TURN_RATE * dt, TURN_RATE * dt);
  const yaw = wrap(state.yaw + step);
  const turnRate = dt > 0 ? step / dt : 0;
  // climb/dive, plus leaning into fast flight
  const climb = Math.atan2(Y, Math.max(horiz, 1)) * w;
  const wantPitch = clamp(-climb * 0.6 + lean * smooth(150, 520, speed) * 0.55, -0.9, 0.9);
  const pitch = state.pitch + (wantPitch - state.pitch) * Math.min(1, 4 * dt);
  const wantRoll = clamp(-turnRate * 0.22, -0.75, 0.75) * w;
  const roll = state.roll + (wantRoll - state.roll) * Math.min(1, 5 * dt);
  return { yaw, pitch, roll };
}
