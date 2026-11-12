// The models process' request handling (models-host.js). Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { handle } = require('../models-host');

test('requests are answered by id, errors come back as messages, progress is forwarded', async () => {
  const seen = [];
  const models = {
    voice: { load: async (o) => o.onProgress(42), speak: async (t, v) => ({ secs: t.length, voice: v }) },
    wake: { load: async () => {}, hear: async (pcm) => `heard ${pcm.length}` },
    progress: (op, v) => seen.push([op, v]),
  };
  assert.deepStrictEqual(await handle({ id: 1, op: 'voice.speak', args: ['hi', 'af_heart'] }, models), {
    id: 1,
    ok: true,
    result: { secs: 2, voice: 'af_heart' },
  });
  assert.deepStrictEqual(await handle({ id: 2, op: 'wake.hear', args: [new Float32Array(3)] }, models), {
    id: 2,
    ok: true,
    result: 'heard 3',
  });
  assert.deepStrictEqual(await handle({ id: 3, op: 'voice.load', args: [{ allowDownload: true }] }, models), {
    id: 3,
    ok: true,
    result: true,
  });
  assert.deepStrictEqual(seen, [['voice', 42]]);
  const bad = await handle({ id: 4, op: 'nope' }, models);
  assert.ok(!bad.ok && bad.id === 4 && /Unknown op/.test(bad.error));
  const boom = await handle(
    { id: 5, op: 'wake.hear', args: [null] },
    {
      ...models,
      wake: {
        hear: () => {
          throw new Error('x\ny');
        },
      },
    },
  );
  assert.deepStrictEqual(boom, { id: 5, ok: false, error: 'x' });
});
