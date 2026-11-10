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
const MAX_DT = 1 / 20;
// flight feel (tune here): springs as natural frequency (rad/s) and damping ratio (<1 overshoots)
const PITCH_W = 6;
const PITCH_Z = 0.6;
const ROLL_W = 7;
const ROLL_Z = 0.5;
const ACC_REF = 1500; // px/s² that counts as a hard push
const ACC_PITCH = 0.22; // rad of nose-down at a hard push (nose-up braking)
const SLIP_ROLL = 0.15; // rad of side-slip bank at a hard sideways push
const ACC_SMOOTH = 10; // 1/s low-pass on acceleration (window motion is jittery)

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
 * One step: state { yaw, pitch, roll, ... } → next (also carries spring rates, last velocity and the
 * smoothed accelerations `accel` forward, `lat` sideways, `ay` screen-down, plus `turn` rad/s), for velocity { vx, vy, vz }. `lean` (0..1) tips the
 * body forward into fast flight (AeroStrike flies superhero-style); `still` forces facing you.
 */
export function attitude(state, { vx = 0, vy = 0, vz = 0 }, dt, { lean = 0, still = false } = {}) {
  const d = Math.min(dt, MAX_DT); // a frame spike must not kick the springs
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
  const turn = dt > 0 ? step / dt : 0;
  // acceleration from the last velocity (an old-shape state has none: no kick), low-passed
  const px = state.vx ?? vx;
  const py = state.vy ?? vy;
  const pz = state.vz ?? vz;
  const aX = d > 0 ? (vx - px) / d : 0;
  const aY = d > 0 ? (vy - py) / d : 0; // screen, down-positive
  const aZ = d > 0 ? (-(vz - pz) * DEPTH_PX) / d : 0;
  const prevSpeed = Math.hypot(px, -py, -pz * DEPTH_PX);
  const fwd = d > 0 && !still ? (speed - prevSpeed) / d : 0; // speeding up > 0, braking < 0
  const side = still ? 0 : aX * Math.cos(yaw) - aZ * Math.sin(yaw); // along the body's right
  const f = Math.min(1, ACC_SMOOTH * d);
  const accel = (state.accel ?? 0) + (fwd - (state.accel ?? 0)) * f;
  const lat = (state.lat ?? 0) + (side - (state.lat ?? 0)) * f;
  const ay = (state.ay ?? 0) + (aY - (state.ay ?? 0)) * f;
  // climb/dive, leaning into fast flight, nose down speeding up and up braking
  const climb = Math.atan2(Y, Math.max(horiz, 1)) * w;
  const wantPitch = clamp(
    -climb * 0.6 + lean * smooth(150, 520, speed) * 0.55 + clamp(accel / ACC_REF, -1, 1) * ACC_PITCH,
    -0.9,
    0.9,
  );
  // bank into the turn plus a little side-slip, on damped springs (overshoot, then settle)
  const wantRoll = clamp(-turn * 0.22 * w - clamp(lat / ACC_REF, -1, 1) * SLIP_ROLL, -0.75, 0.75);
  let pr =
    (state.pr ?? 0) + (PITCH_W * PITCH_W * (wantPitch - state.pitch) - 2 * PITCH_Z * PITCH_W * (state.pr ?? 0)) * d;
  let rr = (state.rr ?? 0) + (ROLL_W * ROLL_W * (wantRoll - state.roll) - 2 * ROLL_Z * ROLL_W * (state.rr ?? 0)) * d;
  const pitch = clamp(state.pitch + pr * d, -0.9, 0.9);
  const roll = clamp(state.roll + rr * d, -0.75, 0.75);
  if (pitch !== state.pitch + pr * d) pr = 0;
  if (roll !== state.roll + rr * d) rr = 0;
  return { yaw, pitch, roll, pr, rr, vx, vy, vz, accel, lat, ay, turn };
}
