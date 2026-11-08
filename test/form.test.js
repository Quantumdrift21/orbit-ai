// Window layouts for Orbit's two forms. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { LAYOUTS, moveFor } = require('../form');

test('growing and shrinking keeps the robot on the same spot on screen', () => {
  const pos = { x: 1200, y: 600 };
  const grown = moveFor(pos, LAYOUTS.orb, LAYOUTS.grown);
  assert.deepStrictEqual(
    { x: grown.x + LAYOUTS.grown.anchor.x, y: grown.y + LAYOUTS.grown.anchor.y },
    { x: pos.x + LAYOUTS.orb.anchor.x, y: pos.y + LAYOUTS.orb.anchor.y },
  );
  assert.deepStrictEqual(moveFor(grown, LAYOUTS.grown, LAYOUTS.orb), pos); // and back again
});

test('the grown window draws Orbit at the same size (anchor scales with the window)', () => {
  const k = LAYOUTS.grown.size.height / LAYOUTS.orb.size.height;
  assert.ok(Math.abs(LAYOUTS.grown.anchor.y - LAYOUTS.orb.anchor.y * k) < 1);
  assert.strictEqual(LAYOUTS.grown.anchor.x, LAYOUTS.grown.size.width / 2);
});

test('the mech is clickable over its whole body, inside the window', () => {
  const { size, hit } = LAYOUTS.mech;
  assert.ok(hit.rx > LAYOUTS.orb.hit.rx && hit.ry > LAYOUTS.orb.hit.ry);
  assert.ok(hit.x - hit.rx >= 0 && hit.x + hit.rx <= size.width);
  assert.ok(hit.y - hit.ry >= 0 && hit.y + hit.ry <= size.height);
});
