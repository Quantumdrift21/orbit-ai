// Orbit's two forms (small Orbit, AeroStrike mech) and their window layouts, in px.
// anchor = the robot's centre inside the window; hit = the clickable ellipse around the robot.
// The window grows before Orbit transforms, so the mech has room; it keeps the robot on the
// same spot on screen (moveFor). Pure, tested in test/form.test.js.
const TRANSFORM_SECS = 3.2;

const LAYOUTS = {
  orb: { size: { width: 200, height: 230 }, anchor: { x: 100, y: 84 }, hit: { x: 100, y: 84, rx: 68, ry: 58 } },
  // bigger window, robot still drawn at Orbit's size (renderer/robot.js scales its camera to match)
  grown: { size: { width: 360, height: 420 }, anchor: { x: 180, y: 153 }, hit: { x: 180, y: 153, rx: 68, ry: 58 } },
  mech: { size: { width: 360, height: 420 }, anchor: { x: 180, y: 153 }, hit: { x: 180, y: 205, rx: 112, ry: 150 } },
};

/** Window position after switching layouts so the robot stays on the same spot on screen. */
const moveFor = (pos, from, to) => ({
  x: pos.x + from.anchor.x - to.anchor.x,
  y: pos.y + from.anchor.y - to.anchor.y,
});

module.exports = { TRANSFORM_SECS, LAYOUTS, moveFor };
