// Polite flying (main process, used by brain.js): keep the robot off the text you're typing and away
// from the mouse pointer, but let a still pointer "catch" it. All in screen px (DIP). Pure, tested in
// test/avoid.test.js. The typing information comes from typing-watch.js.

const TYPING_SECS = 3; // after the last key press, it still counts as typing
const BAND_HALF_W = 300; // the typing zone around a caret: this far left and right of it...
const BAND_HALF_H = 90; // ...and this far above and below the line
const FIELD_MAX = { w: 1000, h: 360 }; // a focused field bigger than this (a whole editor) is too vague to avoid
const POINTER_RADIUS = 170; // keeps this far from the pointer while flying
const CATCH_SECS = 0.6; // hold the pointer still on it this long to catch it
const CATCH_SPEED = 40; // px/s: "still"

/**
 * Tells key presses from mouse input: Windows only reports "some input happened", so input while
 * the pointer didn't move counts as a key press.
 */
class TypingDetector {
  constructor() {
    this.lastTick = null;
    this.lastCursor = null;
    this.lastKeyAt = -Infinity;
  }
  /** inputTick: Windows' last-input counter; cursor: {x, y}; now: seconds. Returns typing (bool). */
  update(inputTick, cursor, now) {
    const moved = this.lastCursor && (cursor.x !== this.lastCursor.x || cursor.y !== this.lastCursor.y);
    if (this.lastTick !== null && inputTick !== this.lastTick && !moved) this.lastKeyAt = now;
    this.lastTick = inputTick;
    this.lastCursor = { x: cursor.x, y: cursor.y };
    return this.typing(now);
  }
  typing(now) {
    return now - this.lastKeyAt < TYPING_SECS;
  }
}

/**
 * The screen area to keep clear while typing: a band around the caret, else a small focused text
 * field. Rects are {x, y, w, h}. Returns null when there's nothing specific to avoid.
 */
function typingZone({ caret = null, field = null } = {}) {
  if (caret && caret.h > 0) {
    return {
      x: caret.x - BAND_HALF_W,
      y: caret.y - BAND_HALF_H,
      w: 2 * BAND_HALF_W + caret.w,
      h: caret.h + 2 * BAND_HALF_H,
    };
  }
  if (field && field.w > 0 && field.h > 0 && field.w <= FIELD_MAX.w && field.h <= FIELD_MAX.h) {
    return { x: field.x - 40, y: field.y - 40, w: field.w + 80, h: field.h + 80 };
  }
  return null;
}

/**
 * How far the robot (an ellipse at `center` with half-sizes `radii`) must move to get out of
 * `zone`, along the shortest way out: {x, y} px, or null if it's already clear.
 */
function pushOut(center, radii, zone, margin = 20) {
  if (!zone) return null;
  const left = zone.x - margin - radii.x;
  const right = zone.x + zone.w + margin + radii.x;
  const top = zone.y - margin - radii.y;
  const bottom = zone.y + zone.h + margin + radii.y;
  if (center.x <= left || center.x >= right || center.y <= top || center.y >= bottom) return null;
  const ways = [
    { x: left - center.x, y: 0 },
    { x: right - center.x, y: 0 },
    { x: 0, y: top - center.y },
    { x: 0, y: bottom - center.y },
  ];
  return ways.reduce((a, b) => (Math.hypot(b.x, b.y) < Math.hypot(a.x, a.y) ? b : a));
}

/** Gentle push away from the pointer: 0 at POINTER_RADIUS, 1 on top of it. {x, y} unit-ish, or null. */
function pointerRepel(center, pointer, radius = POINTER_RADIUS) {
  const dx = center.x - pointer.x;
  const dy = center.y - pointer.y;
  const d = Math.hypot(dx, dy);
  if (d >= radius) return null;
  const f = (radius - d) / radius;
  return d < 1e-6 ? { x: 0, y: -f } : { x: (dx / d) * f, y: (dy / d) * f };
}

/** A place worth flying to: not in the typing zone and not next to the pointer. */
function goodSpot(point, { zone = null, pointer = null, radii = { x: 0, y: 0 } } = {}) {
  if (zone && pushOut(point, radii, zone)) return false;
  if (pointer && Math.hypot(point.x - pointer.x, point.y - pointer.y) < POINTER_RADIUS * 1.5) return false;
  return true;
}

/** Holding the pointer still on the robot catches it (it stops avoiding). Returns the new still-time. */
function catchTime(stillSecs, { over, pointerSpeed, dt }) {
  return over && pointerSpeed < CATCH_SPEED ? stillSecs + dt : 0;
}
const isCaught = (stillSecs) => stillSecs >= CATCH_SECS;

module.exports = {
  TYPING_SECS,
  POINTER_RADIUS,
  CATCH_SECS,
  TypingDetector,
  typingZone,
  pushOut,
  pointerRepel,
  goodSpot,
  catchTime,
  isCaught,
};
