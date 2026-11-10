// Teleporting (main process, pure): now and then Orbit jumps across the screen instead of flying, and a
// very fast swipe can make it blink away instead of dodging. brain.js runs the mode and moves the window
// in one jump halfway through the effect; the robot page draws the body effect from the brain's progress
// (renderer/warp.js), the laser overlay draws the streak across the desktop. Tested in test/teleport.test.js.
const TELEPORT_SECS = { orb: 0.9, mech: 1.2 };
const SHARE = 0.25; // of long journeys that teleport instead
const MIN_JUMP = 400; // px: no point blinking somewhere close
const ESCAPE_SPEED = 950; // px/s: a swipe this fast may be escaped by teleport
const ESCAPE_CHANCE = 0.5;
const ESCAPE_COOLDOWN = 6; // s
const JUMP = 0.5; // the window jumps at this point of the effect

const margins = (wa) => ({ x0: wa.x + 90, x1: wa.x + wa.width - 90, y0: wa.y + 90, y1: wa.y + wa.height - 110 });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 'out' (the body leaves) for p < JUMP, then 'in' (it arrives); k runs 0..1 inside each phase. */
function teleportPhase(p) {
  p = clamp(p, 0, 1);
  return p < JUMP ? { phase: 'out', k: p / JUMP } : { phase: 'in', k: (p - JUMP) / (1 - JUMP) };
}

/**
 * A spot in the work area at least MIN_JUMP from `center` that passes `goodSpot(point)` (avoid.js: off
 * the text you type and away from the pointer), or null after ten tries.
 */
function pickDestination(wa, center, goodSpot = () => true, rand = Math.random) {
  const m = margins(wa);
  for (let i = 0; i < 10; i++) {
    const p = { x: m.x0 + rand() * (m.x1 - m.x0), y: m.y0 + rand() * (m.y1 - m.y0) };
    if (Math.hypot(p.x - center.x, p.y - center.y) >= MIN_JUMP && goodSpot(p)) return p;
  }
  return null;
}

/** Escape: a spot on the far side from the pointer, MIN_JUMP..MIN_JUMP+500 away, inside the work area. */
function escapeSpot(wa, center, pointer, rand = Math.random) {
  const m = margins(wa);
  let dx = center.x - pointer.x;
  let dy = center.y - pointer.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const far = MIN_JUMP + rand() * 500;
  let p = { x: clamp(center.x + dx * far, m.x0, m.x1), y: clamp(center.y + dy * far, m.y0, m.y1) };
  if (Math.hypot(p.x - center.x, p.y - center.y) < MIN_JUMP) {
    // boxed in at the edge: mirror across the middle of the work area instead
    p = { x: clamp(m.x0 + m.x1 - center.x, m.x0, m.x1), y: clamp(m.y0 + m.y1 - center.y, m.y0, m.y1) };
  }
  return p;
}

/** Should a swipe be escaped by a teleport right now? */
function shouldEscape({ speed, dist, t, lastEscape = -1e9, caught, guard, mode, dragging, rand = Math.random }) {
  if (guard || caught || dragging) return false;
  if (mode === 'sleep' || mode === 'toBed' || mode === 'teleport') return false;
  if (dist >= 160 || speed <= ESCAPE_SPEED) return false;
  if (t - lastEscape < ESCAPE_COOLDOWN) return false;
  return rand() < ESCAPE_CHANCE;
}

module.exports = {
  TELEPORT_SECS,
  SHARE,
  MIN_JUMP,
  JUMP,
  ESCAPE_COOLDOWN,
  teleportPhase,
  pickDestination,
  escapeSpot,
  shouldEscape,
};
