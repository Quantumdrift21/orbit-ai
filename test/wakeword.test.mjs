// Wake word clip cutting and matching (renderer/wakeword.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { Segmenter, isWake, CHUNK } from '../renderer/wakeword.js';

const tone = (amp) => Int16Array.from({ length: CHUNK }, (_, i) => Math.round(amp * 32767 * Math.sin(i / 3)));
const run = (seg, pattern) => pattern.flatMap(([amp, n]) => Array.from({ length: n }, () => seg.feed(tone(amp))));

test('a short burst of speech after quiet becomes one clip, with a little lead-in', () => {
  const seg = new Segmenter();
  const out = run(seg, [
    [0.002, 20],
    [0.2, 8],
    [0.002, 6],
  ]).filter(Boolean);
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].length >= CHUNK * (8 + 3) && out[0].length <= CHUNK * (3 + 8 + 4));
});

test('silence, a click and long talking make no clip', () => {
  const seg = new Segmenter();
  assert.strictEqual(run(seg, [[0.002, 50]]).filter(Boolean).length, 0);
  assert.strictEqual(
    run(seg, [
      [0.3, 1],
      [0.002, 10],
    ]).filter(Boolean).length,
    0,
  ); // too short
  assert.strictEqual(
    run(seg, [
      [0.2, 40],
      [0.002, 10],
    ]).filter(Boolean).length,
    0,
  ); // too long
});

test('the wake word is matched at the start, in the ways Whisper writes it', () => {
  for (const t of ['Hey Orbit.', 'hey, orbit!', 'Okay Orbit', 'Orbit?', 'Hey or bit', ' Hi Orbits'])
    assert.ok(isWake(t), t);
  for (const t of ['', 'Hey there', 'the satellite went into orbit', 'Hey Siri', 'orbital']) assert.ok(!isWake(t), t);
});
