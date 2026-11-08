// Natural offline voice for agent alerts (main process): Kokoro-82M, a small neural text-to-speech
// model (Apache-2.0) run on the CPU with kokoro-js / onnxruntime. The model (~90 MB) is downloaded
// once, only when the user clicks Download in Settings, into Orbit's data folder; after that it
// never goes online (remote models are switched off). Voices ship inside the kokoro-js package.
// Until it's ready, the robot page uses the Windows voice instead.
const fs = require('fs');
const path = require('path');

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = 'q8'; // 8-bit weights: ~90 MB, near full quality
const MAX_CHARS = 400; // alerts are one or two sentences

/** @param {{ cacheDir: string }} opts */
function createVoice({ cacheDir }) {
  let tts = null;
  let loading = null;

  const modelFile = () => path.join(cacheDir, ...MODEL.split('/'), 'onnx', 'model_quantized.onnx');
  const downloaded = () => fs.existsSync(modelFile());

  /** Load the model; allowDownload fetches it from Hugging Face the first time. */
  function load({ allowDownload = false, onProgress = () => {} } = {}) {
    if (tts) return Promise.resolve(tts);
    if (loading) return loading;
    if (!allowDownload && !downloaded()) return Promise.reject(new Error('The natural voice is not downloaded'));
    loading = (async () => {
      const { env } = await import('@huggingface/transformers');
      env.cacheDir = cacheDir;
      // a downloaded model is read as a local one from Orbit's data folder (same folder layout as the
      // cache), so speaking never goes online; only the Settings download may fetch it
      env.localModelPath = cacheDir;
      env.allowLocalModels = !allowDownload;
      env.allowRemoteModels = !!allowDownload;
      const { KokoroTTS } = await import('kokoro-js');
      tts = await KokoroTTS.from_pretrained(MODEL, {
        dtype: DTYPE,
        device: 'cpu',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file?.endsWith('.onnx')) onProgress(Math.round(p.progress));
        },
      });
      env.allowRemoteModels = false;
      return tts;
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  /** Speak `text`: { pcm: Float32Array (24 kHz mono), secs }. Throws if the model isn't ready. */
  async function speak(text, voice = 'af_heart') {
    const model = await load();
    const name = model.voices[voice] ? voice : 'af_heart';
    const audio = await model.generate(String(text).slice(0, MAX_CHARS), { voice: name });
    return { pcm: audio.audio, rate: audio.sampling_rate, secs: audio.audio.length / audio.sampling_rate };
  }

  return { downloaded, load, speak, voices: () => tts?.voices };
}

module.exports = { createVoice, MODEL };
