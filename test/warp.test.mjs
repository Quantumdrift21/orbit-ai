// The teleport body effect (renderer/warp.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { warpPose, JUMP } from '../renderer/warp.js';

test('both forms start and end at their normal shape, are hidden only around the jump, and stretch most near it', () => {
  for (const form of ['orb', 'mech']) {
    for (const p of [0, 1]) {
      const w = warpPose(p, form);
      assert.ok(Math.abs(w.stretch - 1) < 1e-9 && Math.abs(w.squash - 1) < 1e-9 && !w.hidden, `${form} at ${p}`);
    }
    assert.ok(warpPose(JUMP, form).hidden && !warpPose(0.3, form).hidden && !warpPose(0.7, form).hidden);
    assert.ok(warpPose(0.45, form).stretch > warpPose(0.2, form).stretch);
    assert.ok(warpPose(0.55, form).stretch > warpPose(0.9, form).stretch);
  }
});

test('Orbit streaks thin and long; AeroStrike rings out and arrives blurred with its jets bursting', () => {
  const o = warpPose(0.45, 'orb');
  assert.ok(o.stretch > 3.5 && o.squash < 0.3 && o.ring === 0 && o.blur === 0);
  const m = warpPose(0.48, 'mech');
  assert.ok(m.ring > 0.8 && m.throttle > 1.2);
  assert.ok(warpPose(0.55, 'mech').blur > 0.8 && warpPose(0.95, 'mech').blur < 0.05);
  assert.strictEqual(warpPose(0.7, 'mech').ring, 0);
});
