// AeroStrike's depth flight (flight.js). Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const fl = require('../flight');
const { LAYOUTS } = require('../form');

test('depth eases toward its target and stays in range', () => {
  let s = { depth: 0, vz: 0 };
  for (let i = 0; i < 600; i++) s = fl.stepDepth(s, 1.5, 1 / 60);
  assert.ok(Math.abs(s.depth - 1.5) < 0.05);
  for (let i = 0; i < 600; i++) s = fl.stepDepth(s, -5, 1 / 60);
  assert.strictEqual(s.depth, fl.NEAR); // never closer than fits the window
  const first = fl.stepDepth({ depth: 0, vz: 0 }, 1.5, 1 / 60);
  assert.ok(first.vz > 0 && first.vz < 0.9); // accelerates, no jump
});

test('the clickable area shrinks toward the core far away and grows close up, inside the window', () => {
  const far = fl.scaledHit(LAYOUTS.mech, fl.depthScale(fl.FAR));
  const near = fl.scaledHit(LAYOUTS.mech, fl.depthScale(fl.NEAR));
  const { anchor, size } = LAYOUTS.mech;
  assert.ok(far.rx < LAYOUTS.mech.hit.rx * 0.4 && Math.abs(far.y - anchor.y) < Math.abs(LAYOUTS.mech.hit.y - anchor.y));
  assert.ok(near.y - near.ry >= 0 && near.y + near.ry <= size.height); // still fits
  assert.ok(near.x - near.rx >= 0 && near.x + near.rx <= size.width);
  assert.deepStrictEqual(fl.scaledHit(LAYOUTS.mech, 1), LAYOUTS.mech.hit);
});

test('journeys pick the screen plane, far away or close', () => {
  const seq =
    (...v) =>
    () =>
      v.shift();
  assert.strictEqual(fl.pickDepth(seq(0.1)), 0);
  assert.ok(fl.pickDepth(seq(0.5, 0.5)) > 0.5);
  assert.ok(fl.pickDepth(seq(0.9, 0.5)) < 0);
});
