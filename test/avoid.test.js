// Polite flying: typing detection, the typing zone, pushing out of it, pointer avoidance. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const av = require('../avoid');

test('key presses are input without mouse movement; typing lasts a few seconds', () => {
  const d = new av.TypingDetector();
  assert.strictEqual(d.update(100, { x: 5, y: 5 }, 0), false); // first sample: nothing to compare
  assert.strictEqual(d.update(200, { x: 50, y: 5 }, 0.15), false); // mouse moved: not typing
  assert.strictEqual(d.update(300, { x: 50, y: 5 }, 0.3), true); // input, mouse still: a key
  assert.strictEqual(d.update(300, { x: 50, y: 5 }, 0.3 + av.TYPING_SECS - 0.1), true);
  assert.strictEqual(d.update(300, { x: 50, y: 5 }, 0.3 + av.TYPING_SECS + 0.1), false); // stopped typing
});

test('typing zone: a band around the caret, a small field, or nothing for a whole editor', () => {
  const z = av.typingZone({ caret: { x: 500, y: 400, w: 2, h: 20 } });
  assert.ok(z.x < 500 && z.x + z.w > 502 && z.y < 400 && z.y + z.h > 420);
  assert.ok(z.w >= 600 && z.h < 400); // wide along the line, not the whole screen
  const f = av.typingZone({ field: { x: 100, y: 100, w: 400, h: 40 } });
  assert.ok(f.x < 100 && f.x + f.w > 500);
  assert.strictEqual(av.typingZone({ field: { x: 0, y: 0, w: 1800, h: 900 } }), null);
  assert.strictEqual(av.typingZone({}), null);
});

test('pushOut takes the shortest way out of the zone, and nothing when clear', () => {
  const zone = { x: 400, y: 300, w: 600, h: 100 };
  const radii = { x: 60, y: 50 };
  const v = av.pushOut({ x: 700, y: 310 }, radii, zone); // near the top edge
  assert.strictEqual(v.x, 0);
  assert.ok(v.y < 0); // up is the short way
  const clear = { x: 700, y: 300 - 20 - 50 - 1 };
  assert.strictEqual(av.pushOut(clear, radii, zone), null);
  // after moving by v the robot is clear
  const c = { x: 700 + v.x, y: 310 + v.y - 0.01 };
  assert.strictEqual(av.pushOut(c, radii, zone), null);
});

test('pointer: pushed away, stronger when closer, nothing far away; still pointer catches it', () => {
  const near = av.pointerRepel({ x: 100, y: 100 }, { x: 140, y: 100 });
  const nearer = av.pointerRepel({ x: 100, y: 100 }, { x: 110, y: 100 });
  assert.ok(near.x < 0 && nearer.x < near.x); // away from the pointer, harder when closer
  assert.strictEqual(av.pointerRepel({ x: 0, y: 0 }, { x: 500, y: 0 }), null);
  let still = 0;
  for (let i = 0; i < 5; i++) still = av.catchTime(still, { over: true, pointerSpeed: 10, dt: 0.1 });
  assert.strictEqual(av.isCaught(still), false);
  for (let i = 0; i < 2; i++) still = av.catchTime(still, { over: true, pointerSpeed: 10, dt: 0.1 });
  assert.strictEqual(av.isCaught(still), true);
  assert.strictEqual(av.catchTime(still, { over: true, pointerSpeed: 300, dt: 0.1 }), 0); // a swipe lets go
});

test('goodSpot rejects places in the typing zone or next to the pointer', () => {
  const zone = { x: 0, y: 0, w: 200, h: 100 };
  assert.strictEqual(av.goodSpot({ x: 100, y: 50 }, { zone }), false);
  assert.strictEqual(av.goodSpot({ x: 900, y: 900 }, { zone, pointer: { x: 950, y: 900 } }), false);
  assert.strictEqual(av.goodSpot({ x: 900, y: 900 }, { zone, pointer: { x: 100, y: 100 } }), true);
});
