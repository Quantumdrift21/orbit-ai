// AeroStrike's backflip / barrel roll physics. Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { tuckedFlip, superheroLoop } from '../renderer/flip.js';

const at = (p) => tuckedFlip(p);

test('one full backwards turn, only while in the air, never turning back', () => {
  assert.strictEqual(at(0).angle, 0);
  assert.strictEqual(at(0.2).angle, 0); // still crouching on the ground
  assert.ok(Math.abs(at(1).angle - 2 * Math.PI) < 1e-9);
  let last = 0;
  for (let p = 0; p <= 1; p += 0.01) {
    assert.ok(at(p).angle >= last - 1e-12);
    last = at(p).angle;
  }
});

test('spins faster tucked than stretched out (angular momentum is conserved)', () => {
  const rate = (p) => (at(p + 0.005).angle - at(p).angle) / 0.005;
  assert.ok(at(0.54).tuck > 0.95 && at(0.26).tuck < 0.2);
  assert.ok(rate(0.54) > 2 * rate(0.25));
});

test('crouches before the jump, lands with bent knees, leaves the ground only in between', () => {
  assert.ok(at(0.15).crouch > 0.5 && at(0.15).lift === 0);
  assert.ok(at(0.54).lift > 0.9 && at(0.54).crouch === 0);
  assert.ok(at(0.9).crouch > 0.4 && at(0.9).lift === 0);
  assert.strictEqual(at(1).crouch, 0);
  assert.ok(at(0.23).reach > 0.8); // arms swing up overhead to start the jump
});

test('loop: upright at both ends, head pointing along the circle in the middle', () => {
  assert.strictEqual(superheroLoop(0).angle, 0);
  assert.ok(Math.abs(superheroLoop(1).angle - 2 * Math.PI) < 1e-9); // one full turn, upright again
  // halfway the window is at the top of the circle, flying left: head points left (+90°... -90° + 180°)
  const mid = superheroLoop(0.5);
  assert.strictEqual(mid.stretch, 1);
  assert.ok(Math.abs(mid.angle - Math.PI / 2) < 1e-9);
});
