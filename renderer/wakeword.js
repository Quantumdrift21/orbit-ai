// Wake word (robot page): while Orbit is idle and the wake word is on in Settings, the mic stays open and
// this cuts it into short clips of speech (silence is never sent anywhere). Each clip goes to the
// offline Whisper model in the main process (wake.js); if it starts with "Hey Orbit", Orbit listens.
// Segmenter and isWake are pure (tested in test/wakeword.test.mjs).

const CHUNK = 1600; // 100 ms at 16 kHz (renderer/pcm-worklet.js)
const PRE = 3; // keep 300 ms before the speech starts
const HANG = 4; // 400 ms of quiet ends a clip
const MAX = 25; // clips are at most 2.5 s ("Hey Orbit" takes about one)
const MIN = 3; // ...and at least 300 ms of speech
const PEAK = 0.03; // the loudest 100 ms must reach this: a voice near the mic, not a fan or a keyboard

const level = (pcm) => {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / Math.max(1, pcm.length)) / 32768;
};

/** Cuts 100 ms chunks of 16-bit audio into clips of speech, against the room's own noise level. */
export class Segmenter {
  constructor() {
    this.floor = 0.004; // background noise level, learned as it goes
    this.pre = [];
    this.clip = null;
    this.quiet = 0;
    this.speech = 0;
    this.skip = false; // in the middle of long talk: wait for a pause before listening again
    this.levels = [];
  }

  /** Feed one chunk; returns a finished clip (Int16Array) or null. */
  feed(pcm) {
    const v = level(pcm);
    const loud = v > Math.max(0.015, this.floor * 4);
    if (!loud) this.floor += (Math.min(v, 0.05) - this.floor) * 0.05;
    if (this.skip) {
      this.quiet = loud ? 0 : this.quiet + 1;
      if (this.quiet >= HANG) this.skip = false;
      return null;
    }
    if (!this.clip) {
      this.pre.push(pcm);
      if (this.pre.length > PRE) this.pre.shift();
      if (loud) {
        this.clip = [...this.pre];
        this.pre = [];
        this.quiet = 0;
        this.speech = 1;
        this.levels = [v];
      }
      return null;
    }
    this.clip.push(pcm);
    this.levels.push(v);
    if (loud) {
      this.speech++;
      this.quiet = 0;
    } else this.quiet++;
    if (this.quiet < HANG && this.clip.length < MAX) return null;
    const parts = this.clip;
    // speech is loud and bursty: the peak well above the floor and clearly above the clip's average;
    // steady noise (a fan, traffic) is neither, and never reaches the model
    const peak = Math.max(...this.levels);
    const mean = this.levels.reduce((a, b) => a + b, 0) / this.levels.length;
    const voice = peak >= PEAK && peak > 1.4 * mean;
    const enough = voice && this.speech >= MIN && this.clip.length < MAX; // too long: talking, not a wake word
    this.skip = this.clip.length >= MAX;
    this.quiet = 0;
    this.clip = null;
    if (!enough) return null;
    const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) out.set(p, (o += p.length) - p.length);
    return out;
  }
}

/** True when the words start with the wake word: "Hey Orbit", "Okay Orbit", "Orbit". */
export function isWake(text) {
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  return /^((hey|hi|hello|ok|okay|yo|a) )?(orbit|orbits|orbet|orbid|arbit|or bit)\b/.test(words);
}

export const toFloat = (pcm) => Float32Array.from(pcm, (v) => v / 32768);
export { CHUNK };
