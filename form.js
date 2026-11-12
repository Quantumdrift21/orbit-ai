// Orbit's two forms (small Orbit, AeroStrike mech) and their window layouts, in px.
// anchor = the robot's centre inside the window; hit = the clickable ellipse around the robot.
// The window grows before Orbit transforms, so the mech has room; it keeps the robot on the
// same spot on screen (moveFor). Pure, tested in test/form.test.js.
const TRANSFORM_SECS = 4.4; // eight staged steps (renderer/mech.js STEPS); sfx.js SECS must match

const LAYOUTS = {
  orb: { size: { width: 200, height: 230 }, anchor: { x: 100, y: 84 }, hit: { x: 100, y: 84, rx: 68, ry: 58 } },
  // bigger window, robot still drawn at Orbit's size (renderer/robot.js scales its camera to match)
  // AeroStrike is drawn to fit the window height (renderer/robot.js), so this size sets how big it looks on screen
  grown: { size: { width: 240, height: 280 }, anchor: { x: 120, y: 102 }, hit: { x: 120, y: 102, rx: 68, ry: 58 } },
  mech: { size: { width: 240, height: 280 }, anchor: { x: 120, y: 102 }, hit: { x: 120, y: 137, rx: 75, ry: 100 } },
};

/** Window position after switching layouts so the robot stays on the same spot on screen. */
const moveFor = (pos, from, to) => ({
  x: pos.x + from.anchor.x - to.anchor.x,
  y: pos.y + from.anchor.y - to.anchor.y,
});

module.exports = { TRANSFORM_SECS, LAYOUTS, moveFor };
