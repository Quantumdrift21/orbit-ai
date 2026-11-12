// The ambush decision (ambush.js). Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { createAmbush, ambushStep, COOLDOWN } = require('../ambush');

const rand = () => 3; // a 3 s wait
const run = (s, steps) => steps.map(([t, dist, speed, guard = true]) => ambushStep(s, { dist, speed, t, guard, rand }));

test('come close, back off and hold still for the wait: it fires once, then cools down', () => {
  const s = createAmbush();
  const fired = run(s, [
    [0, 100, 50], // the attack
    [1, 500, 30], // backed off, still
    [2, 500, 30],
    [3.5, 500, 30],
    [4.2, 500, 30], // 3.2 s after settling: fire
    [4.5, 500, 30],
    [9, 100, 50], // comes again
    [10, 500, 30],
    [14, 500, 30], // waited, but still cooling down
  ]);
  assert.deepStrictEqual(fired, [false, false, false, false, true, false, false, false, false]);
  const later = run(s, [
    [10 + COOLDOWN, 100, 50],
    [11 + COOLDOWN, 500, 30],
    [15 + COOLDOWN, 500, 30],
  ]);
  assert.deepStrictEqual(later, [false, false, true]);
});

test('no ambush without an approach, while the pointer moves, off guard, or long after', () => {
  assert.ok(
    !run(createAmbush(), [
      [0, 500, 30],
      [10, 500, 30],
    ]).some(Boolean),
  );
  const s = createAmbush();
  assert.ok(
    !run(s, [
      [0, 100, 50],
      [1, 500, 400],
      [2, 500, 400],
      [6, 500, 400],
    ]).some(Boolean),
  ); // never settles
  assert.ok(
    !run(createAmbush(), [
      [0, 100, 50],
      [1, 500, 30, false],
      [6, 500, 30, false],
    ]).some(Boolean),
  );
  assert.ok(
    !run(createAmbush(), [
      [0, 100, 50],
      [20, 500, 30],
      [25, 500, 30],
    ]).some(Boolean),
  ); // forgotten
});
