// Per-joint follow-through (renderer/joints.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { createJoints, kick, step, flinch, JOINTS } from '../renderer/joints.js';

// a dodge: the body speeds up to 800 px/s sideways over 0.15 s, then holds that speed
function dodge(secs) {
  const j = createJoints();
  const peak = {};
  const at = {};
  for (let t = 0, i = 0; t < secs; t += 1 / 60, i++) {
    if (i < 9) kick(j, 800 / 9, 0);
    step(j, 1 / 60);
    for (const n of JOINTS)
      if (Math.abs(j[n].x) > (peak[n] ?? 0)) {
        peak[n] = Math.abs(j[n].x);
        at[n] = t;
      }
  }
  return { j, peak, at };
}

test('a dodge swings the limbs the other way, within human limits, and they settle', () => {
  const { j, peak } = dodge(6);
  for (const n of ['shoulderR', 'elbowR', 'hipL', 'kneeL', 'wingR']) {
    assert.ok(peak[n] > 0.15, `${n} moves (${peak[n]})`);
    assert.ok(peak[n] <= 1.1);
  }
  for (const n of JOINTS) assert.ok(Math.abs(j[n].x) < 0.01 && Math.abs(j[n].vx) < 0.05, `${n} settles`);
  const first = dodge(0.2).j;
  assert.ok(first.shoulderR.x < 0); // moving right, the arm trails left
});

test('the motion travels down each limb: hand after elbow after shoulder, sides not mirrored', () => {
  const { at } = dodge(3);
  assert.ok(at.elbowR > at.shoulderR && at.wristR > at.elbowR);
  assert.ok(at.kneeL > at.hipL && at.tipR > at.wingR);
  const j = createJoints();
  kick(j, 300, 0);
  for (let i = 0; i < 20; i++) step(j, 1 / 60);
  assert.notStrictEqual(j.shoulderR.x.toFixed(4), j.shoulderL.x.toFixed(4));
});

test('a slow frame stays stable; a startle flinch rises fast and fades', () => {
  const j = createJoints();
  kick(j, 1500, 1500);
  for (let i = 0; i < 40; i++) step(j, 0.25);
  for (const n of JOINTS) assert.ok(Number.isFinite(j[n].x) && Math.abs(j[n].x) < 0.05);
  assert.strictEqual(flinch(-1), 0);
  assert.ok(flinch(0.1) > 0.99 && flinch(0.5) > 0.2 && flinch(0.5) < 0.9);
  assert.strictEqual(flinch(1), 0);
});
