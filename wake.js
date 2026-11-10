// Wake word (main process): "Hey Orbit" heard offline with Whisper tiny.en, a small speech-to-text
// model run on the CPU with @huggingface/transformers (already installed for the alert voice). The model
// (~40 MB) is downloaded once, only when you click Download in Settings; after that nothing goes online.
// The robot page cuts your speech into short clips (renderer/wakeword.js) and only those are transcribed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODEL = 'onnx-community/whisper-tiny.en';
const MAX_SECS = 3;

/** @param {{ cacheDir: string }} opts */
function createWake({ cacheDir }) {
  let asr = null;
  let loading = null;

  const modelFile = () => path.join(cacheDir, ...MODEL.split('/'), 'onnx', 'decoder_model_merged_quantized.onnx');
  const downloaded = () => fs.existsSync(modelFile());

  function load({ allowDownload = false, onProgress = () => {} } = {}) {
    if (asr) return Promise.resolve(asr);
    if (loading) return loading;
    if (!allowDownload && !downloaded()) return Promise.reject(new Error('The wake word model is not downloaded'));
    loading = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = cacheDir;
      env.localModelPath = cacheDir; // a downloaded model is read locally: listening never goes online
      env.allowLocalModels = !allowDownload;
      env.allowRemoteModels = !!allowDownload;
      asr = await pipeline('automatic-speech-recognition', MODEL, {
        dtype: 'q8',
        device: 'cpu',
        session_options: { intraOpNumThreads: Math.min(8, os.cpus().length) },
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file?.endsWith('.onnx')) onProgress(Math.round(p.progress));
        },
      });
      env.allowRemoteModels = false;
      return asr;
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  /** What was said in a short clip of 16 kHz mono audio (Float32Array, at most 3 s). */
  async function hear(pcm) {
    const model = await load();
    const clip = pcm.length > 16000 * MAX_SECS ? pcm.subarray(0, 16000 * MAX_SECS) : pcm;
    const out = await model(clip);
    return String(out?.text || '').trim();
  }

  return { downloaded, load, hear };
}

module.exports = { createWake, MODEL };
