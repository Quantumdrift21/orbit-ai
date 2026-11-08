// AeroStrike's postures (renderer/postures.js), face cards (renderer/faceCard.js) and the loop
// (renderer/flip.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { stance, taunt, sleep, zero, blend, weightAt, TAUNTS } from '../renderer/postures.js';
import { cardFor, customCard } from '../renderer/faceCard.js';
import { superheroLoop } from '../renderer/flip.js';
import { fxLevels } from '../renderer/morphFx.js';

const joints = (P) => [
  ...P.arms.flatMap((a) => [a.x, a.z, a.fore, a.foreZ]),
  ...P.legs.flatMap((l) => [l.x, l.z, l.knee]),
  ...Object.values(P.head),
  ...Object.values(P.root),
  ...Object.values(P.wings),
];

test('standing: weight on one leg, the free knee soft, and it shifts over time without jumps', () => {
  assert.ok(Math.abs(weightAt(19 / 4)) === 1 && Math.abs(weightAt((3 * 19) / 4)) === 1);
  const right = stance(19 * 0.75); // weight on the right (-1): the left knee is the bent one
  assert.ok(right.legs[1].knee > right.legs[0].knee + 0.2);
  let prev = joints(stance(0));
  for (let t = 1 / 30; t < 40; t += 1 / 30) {
    const cur = joints(stance(t));
    cur.forEach((v, i) => assert.ok(Math.abs(v - prev[i]) < 0.02, `stance jumps at ${t}`));
    prev = cur;
  }
});

test('taunts start and end at rest, stay in human range, and the beckon fingers curl', () => {
  for (const kind of Object.keys(TAUNTS)) {
    for (const p of [0, 1])
      assert.ok(
        joints(taunt(kind, p)).every((v) => Math.abs(v) < 1e-9),
        `${kind} at ${p}`,
      );
    for (let p = 0; p <= 1; p += 0.01) assert.ok(joints(taunt(kind, p)).every((v) => Math.abs(v) <= 2.2));
  }
  const grips = [];
  for (let p = 0.3; p < 0.8; p += 0.01) grips.push(taunt('beckon', p).arms[1].grip);
  assert.ok(Math.max(...grips) > 0.7 && Math.min(...grips) < 0.3); // curls in and opens again
  assert.ok(taunt('flex', 0.5).arms.every((a) => a.fore < -1.5)); // forearms up
});

test('asleep: chin down, arms folded, knees up; blend scales a posture in', () => {
  const s = sleep(3);
  assert.ok(s.head.x > 0.3 && s.arms.every((a) => a.fore < -1.4) && s.legs.every((l) => l.knee > 0.9));
  const half = blend(zero(), s, 0.5);
  assert.ok(Math.abs(half.head.x - s.head.x / 2) < 1e-9);
  assert.strictEqual(blend(zero(), s, 0).head.x, 0);
});

test('face cards: agent icon, emoji and word for alerts; custom text and emoji are trimmed', () => {
  assert.deepStrictEqual(cardFor({ who: 'Claude', kind: 'done', project: 'OrbitAI' }), {
    icon: 'claude',
    letter: 'C',
    emoji: '✅',
    text: 'Done',
    sub: 'OrbitAI',
  });
  assert.strictEqual(cardFor({ who: 'Codex', kind: 'error' }).emoji, '❌');
  assert.strictEqual(cardFor({ who: 'Antigravity', kind: 'input' }).icon, 'antigravity');
  assert.strictEqual(cardFor({ who: 'Gemini CLI', kind: 'done' }).icon, null); // falls back to a letter
  assert.strictEqual(cardFor({ who: 'Claude', kind: 'nope' }), null);
  assert.strictEqual(customCard({ text: 'x'.repeat(100) }).text.length, 60);
  assert.strictEqual(customCard({ emoji: '❤️' }).emoji, '❤️');
  assert.strictEqual(customCard({}), null);
});

test('the loop: the lead arm reaches before the other, the back arches mid-loop, all calm at the ends', () => {
  const a = superheroLoop(0.1);
  assert.ok(a.lead > a.follow + 0.3);
  assert.ok(superheroLoop(0.5).arch > 0.9);
  for (const p of [0, 1]) {
    const e = superheroLoop(p);
    assert.ok(e.stretch === 0 && e.lead === 0 && e.follow === 0 && Math.abs(e.bank) < 1e-9);
  }
});

test('transformation effects: off when not transforming, the cocoon covers the first unfolding', () => {
  for (const f of [0, 1]) assert.ok(Object.values(fxLevels(f)).every((v) => v === 0));
  assert.ok(fxLevels(0.04).flash > 0.9); // the burst comes first
  assert.ok(fxLevels(0.2).cocoon > 0.95); // fully round the body while the parts first pop out
  assert.ok(fxLevels(0.7).cocoon < 0.1 && fxLevels(0.7).scanY < fxLevels(0.3).scanY); // gone; scan moves down
});
