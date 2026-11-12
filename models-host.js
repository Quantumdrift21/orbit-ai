// Hosts the offline models (Kokoro voice, voice.js; Whisper wake word, wake.js) in their own process,
// started by main.js with Electron's utilityProcess. Loading and running them is heavy CPU work that
// would otherwise freeze the main process: hook replies, bubbles and the robot's motion all stalled
// for seconds at a time. Messages: { id, op, args } in → { id, ok, result | error } out, plus
// { event: 'progress', op, value } while a model downloads. handle() is tested in test/models-host.test.js.
const path = require('path');
const { createVoice } = require('./voice');
const { createWake } = require('./wake');

/** Run one request; never throws. */
async function handle(msg, { voice, wake, progress = () => {} }) {
  const { id, op, args = [] } = msg || {};
  try {
    let result;
    switch (op) {
      case 'voice.load':
        await voice.load({ ...(args[0] || {}), onProgress: (p) => progress('voice', p) });
        result = true;
        break;
      case 'voice.speak':
        result = await voice.speak(args[0], args[1]);
        break;
      case 'wake.load':
        await wake.load({ ...(args[0] || {}), onProgress: (p) => progress('wake', p) });
        result = true;
        break;
      case 'wake.hear':
        result = await wake.hear(args[0]);
        break;
      default:
        throw new Error(`Unknown op ${op}`);
    }
    return { id, ok: true, result };
  } catch (e) {
    return {
      id,
      ok: false,
      error: String(e?.message || e)
        .split('\n')[0]
        .slice(0, 200),
    };
  }
}

if (process.parentPort) {
  const cacheDir = process.argv[2] || path.join(process.cwd(), 'models');
  const models = { voice: createVoice({ cacheDir }), wake: createWake({ cacheDir }) };
  const port = process.parentPort;
  models.progress = (op, value) => port.postMessage({ event: 'progress', op, value });
  port.on('message', async (e) => port.postMessage(await handle(e.data, models)));
}

module.exports = { handle };
