// AeroStrike's defence moves, done like a person would. Pure: poses over a move's progress p (0..1).
// robot.js moves the whole body (lean, recoil, turning to face the threat) and the laser beam;
// mech.js bends the limbs. Every move follows the same human pattern:
//   startle (a flinch: shoulders up, chin down) → the move, fast like a muscle snap → the impact
//   pushes the body back (a damped spring: it rocks and settles) → recover into a guard.
// Balance: when a limb swings out, the torso leans the other way so the centre of mass stays over
// the feet (m_leg · x_leg = m_body · x_body). Tested in test/defend.test.mjs.

/** How long each move lasts, in seconds. */
export const DEFENCE_SECS = { block: 0.95, kick: 1.15, laser: 1.5 };
export const DEFENCES = Object.keys(DEFENCE_SECS);

const LEG_SHARE = 0.35; // a leg's mass relative to the rest of the body: how far the torso counter-leans

const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** 0 → 1 between a and b, eased. */
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Rises over [a, b], falls over [c, d]. */
const bump = (a, b, c, d, x) => smooth(a, b, x) * (1 - smooth(c, d, x));

/**
 * Body response to a hit at time `s` seconds ago: an under-damped spring (rocks back, swings
 * forward less, settles), peak about 1. ω = stiffness (rad/s), ζ = damping ratio.
 */
export function recoilSpring(s, w = 20, z = 0.32) {
  if (s <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  const peak = Math.atan(Math.sqrt(1 - z * z) / z) / wd; // time of the first maximum
  const norm = Math.exp(-z * w * peak) * Math.sin(wd * peak);
  return (Math.exp(-z * w * s) * Math.sin(wd * s)) / norm;
}

const REST = {
  flinch: 0, // startle: shoulders up, chin down
  guard: 0, // blocking arm: forearm raised across the face
  guardOff: 0, // the other arm, half up
  hip: 0, // kicking leg: hip flexion (thigh forward and out)
  knee: 0, // kicking leg: knee bend
  stance: 0, // standing leg / both legs: knee bend that keeps balance
  crouch: 0, // both legs: braced low
  open: 0, // arms open out of the way of the chest core
  lean: 0, // torso lean back (radians, + = away from the threat)
  recoil: 0, // impact push-back, signed (rocks back then forward)
  charge: 0, // laser charging in the core (0..1)
  beam: 0, // laser firing (0..1)
};

/**
 * Pose for a defence move.
 * @param {'block'|'kick'|'laser'} kind
 * @param {number} p progress 0..1
 * @returns {typeof REST & {kind: string}}
 */
export function defencePose(kind, p) {
  p = clamp01(p);
  const secs = DEFENCE_SECS[kind] ?? 1;
  const flinch = bump(0, 0.05, 0.08, 0.2, p);
  const settle = 1 - smooth(0.85, 1, p); // everything is back at rest by the end
  const hitAt = (at, w, z) => recoilSpring((p - at) * secs, w, z) * settle;
  const pose = { ...REST, kind, flinch };

  if (kind === 'block') {
    // arm snaps up across the face, takes the hit, holds, then lowers
    pose.guard = bump(0.04, 0.2, 0.7, 0.95, p);
    pose.guardOff = 0.45 * pose.guard;
    pose.recoil = 0.6 * hitAt(0.22, 22, 0.35);
    pose.stance = 0.35 * pose.guard; // knees give a little to absorb it
    pose.lean = 0.06 * pose.guard;
  } else if (kind === 'kick') {
    // weight onto the standing leg, chamber the knee, snap it out, pull it back, set it down
    const chamber = bump(0.12, 0.3, 0.68, 0.88, p);
    const extend = bump(0.3, 0.4, 0.5, 0.64, p);
    pose.hip = chamber;
    pose.knee = chamber * (1 - extend); // bent when chambered, straight at full extension
    pose.stance = 0.4 * bump(0.04, 0.16, 0.8, 0.95, p);
    pose.guard = 0.55 * bump(0.05, 0.2, 0.75, 0.95, p); // hands stay up to protect the head
    pose.guardOff = pose.guard;
    pose.lean = LEG_SHARE * (pose.hip + 0.6 * extend); // counter-balance the leg's weight
    pose.recoil = 0.35 * hitAt(0.4, 18, 0.4);
  } else if (kind === 'laser') {
    // brace low with the arms open, the core charges, fires a beam, the beam pushes it back
    pose.crouch = 0.6 * bump(0, 0.2, 0.82, 1, p);
    pose.open = bump(0.05, 0.25, 0.8, 0.98, p);
    pose.charge = smooth(0.08, 0.45, p) ** 2 * (1 - smooth(0.78, 1, p));
    pose.beam = bump(0.43, 0.47, 0.72, 0.8, p);
    pose.lean = 0.12 * pose.beam; // steady push while firing
    pose.recoil = 0.5 * hitAt(0.45, 16, 0.3);
  }
  return pose;
}
