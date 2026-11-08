// AeroStrike's stunts, done like a person would. Pure: poses over the stunt's progress p (0..1).
// tuckedFlip() drives the backflip, the barrel roll (a side flip) and the spin (a skater's jump spin);
// mech.js decides what "tuck" means for each (knees to chest, or arms pulled in tight):
//   crouch (knees bend, arms swing back) → jump (legs drive, arms swing up/out) → tuck → open out →
//   land (knees absorb the impact, arms out for balance).
// In the air angular momentum is conserved: L = I·ω stays constant, so when the body tucks and its
// moment of inertia I drops, it spins faster (ω = L / I), and slows again as it opens for the landing.
// superheroLoop() is the loop-the-loop: flying head-first round the circle brain.js flies the window on.
// Tested in test/flip.test.mjs.

const TAKEOFF = 0.24; // feet leave the ground
const LAND = 0.84; // feet touch down
const I_OPEN = 1; // moment of inertia, stretched out
const I_TUCK = 0.38; // ...and tucked into a ball

const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** 0 → 1 between a and b, eased. */
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Tuck over the flight (u = 0 at takeoff, 1 at landing): pull in early, hold, open before landing. */
const tuckAt = (u) => smooth(0.06, 0.28, u) * (1 - smooth(0.66, 0.9, u));

// Rotation so far over the flight: ∫ ω du with ω ∝ 1/I, normalised to one full turn at landing.
const N = 240;
const turned = [0];
for (let i = 1; i <= N; i++) turned.push(turned[i - 1] + 1 / (I_OPEN + (I_TUCK - I_OPEN) * tuckAt((i - 0.5) / N)));
for (let i = 1; i <= N; i++) turned[i] /= turned[N];

/**
 * @returns {{angle:number, lift:number, crouch:number, tuck:number, reach:number}}
 *   angle: backwards rotation so far (radians, one turn = 2π); lift: height of the jump (0..1);
 *   crouch: knee bend on the ground (0..1); tuck: how tightly balled up in the air (0..1);
 *   reach: arm swing, -1 = back (crouch), 1 = overhead (jump), 0.4 = forward (balance on landing).
 */
export function tuckedFlip(p) {
  p = clamp01(p);
  const u = clamp01((p - TAKEOFF) / (LAND - TAKEOFF)); // fraction of the flight
  const k = u * N;
  const i = Math.min(N - 1, Math.floor(k));
  const angle = (turned[i] + (turned[i + 1] - turned[i]) * (k - i)) * 2 * Math.PI;
  const flying = p > TAKEOFF && p < LAND;
  const crouch =
    p <= TAKEOFF
      ? smooth(0, 0.16, p) * (1 - smooth(0.16, TAKEOFF, p)) // load the legs, then drive up
      : p >= LAND
        ? 0.8 * smooth(LAND, LAND + 0.04, p) * (1 - smooth(LAND + 0.06, 1, p)) // absorb the landing
        : 0;
  const reach =
    p <= TAKEOFF
      ? -smooth(0, 0.16, p) + 2 * smooth(0.16, TAKEOFF, p) // swing back, then up overhead
      : p < LAND
        ? 1 - smooth(TAKEOFF, TAKEOFF + 0.08, p) // come down to the shins as the tuck starts
        : 0.4 * smooth(LAND, LAND + 0.05, p) * (1 - smooth(LAND + 0.08, 1, p)); // forward for balance
  return { angle, lift: flying ? 4 * u * (1 - u) : 0, crouch, tuck: flying ? tuckAt(u) : 0, reach };
}

// must match easeInOut in brain.js, which flies the window round the loop
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/**
 * Loop-the-loop like a flying superhero: lean into the flight, then go round head-first (fists
 * forward, legs straight), so the body always points along the circle, and come out upright.
 * @returns {{angle:number, stretch:number}} angle: body turn in the screen plane (radians,
 *   anticlockwise, the way brain.js flies the circle); stretch: how far into the flying pose (0..1).
 */
export function superheroLoop(p) {
  p = clamp01(p);
  const stretch = smooth(0, 0.15, p) * (1 - smooth(0.85, 1, p));
  // the path heads (cos a, sin a) when the window is at angle a, so the head points there: a - 90°
  return { angle: easeInOut(p) * 2 * Math.PI - (stretch * Math.PI) / 2, stretch };
}
