// Orbit's mood rules. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { MOOD_LABELS, EFFECTS, freshScores, decay, bump, pick } = require('../mood');

test('every mood has a label and behaviour effects', () => {
  assert.deepStrictEqual(Object.keys(MOOD_LABELS).sort(), Object.keys(EFFECTS).sort());
});

test('events raise scores, capped at 1, and unknown events do nothing', () => {
  let s = freshScores();
  for (let i = 0; i < 20; i++) s = bump(s, 'trick');
  assert.strictEqual(s.excited, 1);
  assert.deepStrictEqual(bump(freshScores(), 'nonsense'), freshScores());
  assert.ok(bump(freshScores(), 'dodge', 0.5).grumpy > 0);
});

test('feelings fade: half gone after one half-life', () => {
  const s = decay({ happy: 0.8, excited: 0, grumpy: 0 }, 600);
  assert.ok(Math.abs(s.happy - 0.4) < 1e-9);
});

test('mood picking: strong feelings first, then night, then boredom, else calm', () => {
  const calm = freshScores();
  assert.strictEqual(pick(calm), 'calm');
  assert.strictEqual(pick(calm, { night: true }), 'sleepy');
  assert.strictEqual(pick(calm, { idleSecs: 900 }), 'bored');
  assert.strictEqual(pick(bump(calm, 'talk', 3)), 'happy');
  assert.strictEqual(pick(bump(calm, 'trick'), { night: true }), 'excited');
  assert.strictEqual(pick({ ...bump(calm, 'trick'), grumpy: 0.6 }), 'grumpy');
});
