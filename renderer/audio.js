// Microphone capture (16 kHz PCM) and speaker playback (24 kHz PCM) with level meters.

// Virtual/loopback devices that usually deliver silence unless their app is running.
const VIRTUAL_MIC = /camo|virtual|vb-audio|voicemeeter|cable output|obs|nvidia broadcast|steam streaming|sunshine/i;

function rms(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.min(1, Math.sqrt(sum / buf.length) * 4);
}

export class Mic {
  constructor() {
    this.ctx = null;
  }

  /** @param {string} [deviceLabel] mic name chosen in Settings; empty = Windows default */
  async start(onChunk, deviceLabel) {
    const audio = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(
      (d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications',
    );
    let match = deviceLabel && inputs.find((d) => d.label === deviceLabel);
    if (!match) {
      // Chosen mic not connected (or none chosen): don't fall back to a virtual mic that sends silence.
      const def = devices.find((d) => d.kind === 'audioinput' && d.deviceId === 'default');
      if (!def || VIRTUAL_MIC.test(def.label)) match = inputs.find((d) => !VIRTUAL_MIC.test(d.label));
    }
    if (match) audio.deviceId = { exact: match.deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    this.label = this.stream.getAudioTracks()[0]?.label || 'microphone';
    this.peak = 0; // loudest sample this turn (int16), used to detect a silent mic
    this.ctx = new AudioContext({ sampleRate: 16000 });
    await this.ctx.audioWorklet.addModule('pcm-worklet.js');
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture');
    this.node.port.onmessage = (e) => {
      const pcm = new Int16Array(e.data);
      for (let i = 0; i < pcm.length; i++) {
        const v = pcm[i] < 0 ? -pcm[i] : pcm[i];
        if (v > this.peak) this.peak = v;
      }
      onChunk(e.data);
    };
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buf = new Float32Array(this.analyser.fftSize);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(this.analyser);
    src.connect(this.node);
    this.node.connect(mute).connect(this.ctx.destination); // keeps the worklet running
  }

  level() {
    // analyser is created a moment after ctx (worklet loading) – don't read it before then
    return this.ctx && this.analyser ? rms(this.analyser, this.buf) : 0;
  }

  /** Sends the last partial chunk, then releases the mic. */
  async stop() {
    if (this.node && this.ctx) {
      this.node.port.postMessage('flush');
      await new Promise((r) => setTimeout(r, 60));
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.node) this.node.port.onmessage = null;
    this.node = null;
    this.analyser = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

export class Player {
  constructor() {
    this.ctx = new AudioContext({ sampleRate: 24000 });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.analyser.connect(this.ctx.destination);
    this.sources = new Set();
    this.next = 0;
    this.onIdle = null;
  }

  /** Route Orbit's voice to a speaker by name ('' = Windows default). */
  async setOutput(label) {
    if (!this.ctx.setSinkId) return;
    let id = '';
    if (label) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      id = devices.find((d) => d.kind === 'audiooutput' && d.label === label)?.deviceId || '';
    }
    try {
      await this.ctx.setSinkId(id);
    } catch {
      /* keep current output */
    }
  }

  get playing() {
    return this.sources.size > 0;
  }

  play(int16) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const f = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f[i] = int16[i] / 32768;
    const buffer = this.ctx.createBuffer(1, f.length, 24000);
    buffer.copyToChannel(f, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser);
    const now = this.ctx.currentTime;
    if (this.next < now + 0.04) this.next = now + 0.04;
    src.start(this.next);
    this.next += buffer.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) this.onIdle?.();
    };
  }

  stop() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.next = 0;
  }

  level() {
    return this.playing ? rms(this.analyser, this.buf) : 0;
  }
}
