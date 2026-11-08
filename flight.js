// AeroStrike's depth flight (main process, used by brain.js): besides moving across the screen it can
// fly into the screen and back out. depth 0 = the screen plane, > 0 = away from you, < 0 = closer.
// The robot page draws it at perspective scale 1 / (1 + depth) (must match renderer/heading.js), so
// the clickable area shrinks and grows with it. Pure, tested in test/flight.test.js.

const NEAR = -0.17; // closest: 1.2× (still fits the AeroStrike window)
const FAR = 1.85; // farthest: 0.35×
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Perspective size at a depth: 1 on the screen plane, smaller further away. */
const depthScale = (depth) => 1 / (1 + clamp(depth, NEAR, FAR));

/**
 * One step of depth flight toward `target`: it accelerates and eases in like the rest of its flight.
 * Returns the new { depth, vz } (vz in depth units per second).
 */
function stepDepth({ depth, vz }, target, dt) {
  const want = clamp((clamp(target, NEAR, FAR) - depth) * 1.6, -0.9, 0.9);
  const v = vz + (want - vz) * Math.min(1, 2.5 * dt);
  return { depth: clamp(depth + v * dt, NEAR, FAR), vz: v };
}

/**
 * The clickable ellipse of a layout at perspective scale s. The robot page scales the robot about
 * its core, which sits at the layout's anchor, so everything else moves toward it.
 */
function scaledHit({ anchor, hit }, s) {
  return {
    x: anchor.x + (hit.x - anchor.x) * s,
    y: anchor.y + (hit.y - anchor.y) * s,
    rx: hit.rx * s,
    ry: hit.ry * s,
  };
}

/** Where a new journey goes in depth: often the screen plane, sometimes far away, now and then close. */
function pickDepth(random = Math.random) {
  const r = random();
  if (r < 0.4) return 0;
  if (r < 0.78) return 0.5 + random() * (FAR - 0.5);
  return NEAR + random() * 0.07;
}

module.exports = { NEAR, FAR, depthScale, stepDepth, scaledHit, pickDepth };
