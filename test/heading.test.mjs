// Turning in flight (renderer/heading.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { attitude, depthScale } from '../renderer/heading.js';

const fly = (state, v, secs, opts, dt = 1 / 60) => {
  let s = state;
  let maxJump = 0;
  for (let t = 0; t < secs; t += dt) {
    const n = attitude(s, v, dt, opts);
    maxJump = Math.max(maxJump, Math.abs(Math.atan2(Math.sin(n.yaw - s.yaw), Math.cos(n.yaw - s.yaw))));
    s = n;
  }
  return { ...s, maxJump };
};
const rest = { yaw: 0, pitch: 0, roll: 0 };
const near = (a, b, eps = 0.05) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < eps;

test('resting it faces you; flying sideways it turns to show its side', () => {
  assert.ok(near(fly(rest, { vx: 5, vy: 3 }, 2).yaw, 0));
  assert.ok(near(fly(rest, { vx: 400, vy: 0 }, 2).yaw, Math.PI / 2));
  assert.ok(near(fly(rest, { vx: -400, vy: 0 }, 2).yaw, -Math.PI / 2));
});

test('flying into the screen it turns its back to you, toward you it faces you', () => {
  assert.ok(near(Math.abs(fly(rest, { vz: 0.8 }, 3).yaw), Math.PI));
  assert.ok(near(fly(rest, { vz: -0.6 }, 3).yaw, 0));
});

test('turns are smooth and rate-limited (a U-turn swings round), and it banks into them', () => {
  const right = fly(rest, { vx: 400 }, 2);
  const uturn = fly(right, { vx: -400 }, 2);
  assert.ok(near(uturn.yaw, -Math.PI / 2));
  assert.ok(uturn.maxJump <= 4.5 / 60 + 1e-9); // never snaps
  const mid = fly(right, { vx: -400 }, 0.2);
  assert.ok(Math.abs(mid.roll) > 0.05); // leaning into the turn
});

test('climbing pitches it up, AeroStrike leans into fast flight; stunts and talking face you', () => {
  assert.ok(fly(rest, { vx: 300, vy: -300 }, 2).pitch < -0.1); // nose up (top away from you)
  assert.ok(fly(rest, { vx: 500 }, 2, { lean: 1 }).pitch > 0.2);
  assert.ok(near(fly(rest, { vx: 500 }, 2, { still: true }).yaw, 0));
});

test('perspective: smaller far away, a bit bigger close up', () => {
  assert.strictEqual(depthScale(0), 1);
  assert.ok(depthScale(1.85) < 0.36 && depthScale(-0.17) > 1.19);
  assert.strictEqual(depthScale(99), depthScale(1.85)); // clamped
});
