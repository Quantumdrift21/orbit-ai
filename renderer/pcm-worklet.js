// Converts mic audio (Float32 @ 16 kHz) into 100 ms chunks of 16-bit PCM for Gemini.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1600; // 100 ms at 16 kHz
    this.buf = new Int16Array(this.size);
    this.i = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush' && this.i > 0) {
        const tail = this.buf.slice(0, this.i);
        this.port.postMessage(tail.buffer, [tail.buffer]);
        this.i = 0;
      }
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let k = 0; k < ch.length; k++) {
        const s = Math.max(-1, Math.min(1, ch[k]));
        this.buf[this.i++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.i === this.size) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(this.size);
          this.i = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
