// The teleport's body effect, frame by frame (robot.js applies it; brain.js gives the progress p so the
// window jump and the picture stay in sync). Pure; tested in test/warp.test.mjs.
//   Orbit: a warp streak — it squeezes thin and long along the jump, vanishes, arrives long and thin from
//   the other side and snaps back with a little bounce.
//   AeroStrike: the jets burst, it leans into the jump and vanishes in a shockwave ring, then reappears
//   blurred along its path and settles.
export const JUMP = 0.5;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const overshoot = (k) => Math.sin(Math.PI * k) * (1 - k) * 0.15;

/**
 * @param {number} p progress 0..1  @param {'orb'|'mech'} form
 * @returns {{stretch:number, squash:number, fade:number, hidden:boolean, throttle:number, ring:number,
 *   blur:number, settle:number}} stretch along the jump / squash across it (scale factors), fade of the
 *   glow (1 = normal), hidden around the jump, jet throttle demand (0.3 = idle), shockwave ring 0..1,
 *   arrival blur 0..1, settle bounce (scale wobble).
 */
export function warpPose(p, form) {
  p = clamp01(p);
  const out = p < JUMP;
  const k = out ? p / JUMP : (p - JUMP) / (1 - JUMP);
  const hidden = Math.abs(p - JUMP) < (form === 'mech' ? 0.04 : 0.03);
  if (form !== 'mech') {
    const e = out ? smooth(0.15, 1, k) : 1 - smooth(0, 0.7, k);
    return {
      stretch: 1 + 3.2 * e,
      squash: 1 - 0.85 * e,
      fade: 1 - 0.6 * e,
      hidden,
      throttle: 0.3 + 0.9 * e,
      ring: 0,
      blur: 0,
      settle: out ? 0 : overshoot(k),
    };
  }
  const e = out ? smooth(0.2, 1, k) : 1 - smooth(0, 0.6, k);
  return {
    stretch: 1 + 1.2 * e,
    squash: 1 - 0.35 * e,
    fade: 1 - 0.8 * (out ? smooth(0.6, 1, k) : 0),
    hidden,
    throttle: 0.3 + 1.1 * (out ? smooth(0, 0.6, k) : 1 - k),
    ring: out ? smooth(0.55, 1, k) : 0,
    blur: out ? 0 : 1 - smooth(0, 0.8, k),
    settle: out ? 0 : overshoot(k),
  };
}
