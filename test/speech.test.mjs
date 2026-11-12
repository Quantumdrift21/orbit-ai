// Alert text cut into sentences for the natural voice (renderer/speech.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { speechChunks } from '../renderer/speech.js';

test('sentences come out one by one, long ones are cut, tiny ones are merged, and it is capped', () => {
  assert.deepStrictEqual(speechChunks('Claude is done in OrbitAI. All tests pass! Ready?'), [
    'Claude is done in OrbitAI.',
    'All tests pass! Ready?', // a tiny sentence rides with the one before it
  ]);
  const long =
    'Claude finished the transformation effects, the wake word fix and the models process, and all eighty seven tests pass now.';
  const parts = speechChunks(long);
  assert.ok(parts.length >= 2 && parts.every((p) => p.length <= 90), JSON.stringify(parts));
  assert.strictEqual(parts.join(' ').replace(/,/g, ''), long.replace(/,/g, ''));
  assert.deepStrictEqual(speechChunks('Done. OK.'), ['Done. OK.']);
  assert.deepStrictEqual(speechChunks('   '), []);
  assert.ok(speechChunks('word '.repeat(200)).join(' ').length <= 240);
});
