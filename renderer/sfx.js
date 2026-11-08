// Transformation sounds, generated live (no audio files): a servo whirr across the whole
// transformation, a clank as each part locks into place, and a power-up (or power-down) at the end.
// Played on Orbit's own audio output, so they come out of the speaker chosen in Settings.

const SECS = 3.2; // must match TRANSFORM_SECS in form.js
// Moments parts lock into place (fractions of the transformation, from mech.js time slots).
const LOCKS = [0.32, 0.42, 0.52, 0.62, 0.66, 0.74, 0.8, 0.9];

function clank(ctx, out, t) {
  // short metallic noise burst through a band-pass filter...
  const len = Math.round(ctx.sampleRate * 0.08);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1600 + Math.random() * 1400;
  bp.Q.value = 3;
  const ng = ctx.createGain();
  ng.gain.value = 0.5;
  noise.connect(bp).connect(ng).connect(out);
  noise.start(t);
  // ...plus a low thump
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.35, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  o.connect(og).connect(out);
  o.start(t);
  o.stop(t + 0.16);
}

function tone(ctx, out, t, from, to, gain, secs) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + secs * 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + secs + 0.05);
}

/** A rush of air: band-passed noise sweeping up then down (a fast limb). */
function whoosh(ctx, out, t, secs, gain) {
  const len = Math.round(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(400, t);
  bp.frequency.exponentialRampToValueAtTime(2200, t + secs * 0.5);
  bp.frequency.exponentialRampToValueAtTime(600, t + secs);
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(out);
  src.start(t);
}

/** Struck armour: a clank plus a short metallic ring (two inharmonic partials). */
function clang(ctx, out, t, gain) {
  clank(ctx, out, t);
  for (const [f, a] of [
    [820, 1],
    [1310, 0.6],
  ]) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * a, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.5);
  }
}

/** Laser: a rising charge whine, then a zap and a crackling hum while the beam is on. */
function laser(ctx, out, t, secs) {
  const charge = ctx.createOscillator();
  charge.type = 'sine';
  charge.frequency.setValueAtTime(180, t);
  charge.frequency.exponentialRampToValueAtTime(1500, t + 0.45 * secs);
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.0001, t);
  cg.gain.exponentialRampToValueAtTime(0.07, t + 0.4 * secs);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.47 * secs);
  charge.connect(cg).connect(out);
  charge.start(t);
  charge.stop(t + 0.5 * secs);

  const fire = t + 0.45 * secs;
  const off = t + 0.78 * secs;
  const zap = ctx.createOscillator();
  zap.type = 'sawtooth';
  zap.frequency.setValueAtTime(2400, fire);
  zap.frequency.exponentialRampToValueAtTime(260, fire + 0.18);
  const zg = ctx.createGain();
  zg.gain.setValueAtTime(0.12, fire);
  zg.gain.exponentialRampToValueAtTime(0.0001, fire + 0.22);
  zap.connect(zg).connect(out);
  zap.start(fire);
  zap.stop(fire + 0.25);

  const hum = ctx.createOscillator();
  hum.type = 'square';
  hum.frequency.value = 96;
  const wob = ctx.createOscillator(); // crackle: fast tremolo
  wob.frequency.value = 38;
  const wg = ctx.createGain();
  wg.gain.value = 0.025;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0.0001, fire);
  hg.gain.exponentialRampToValueAtTime(0.05, fire + 0.03);
  hg.gain.setValueAtTime(0.05, off - 0.08);
  hg.gain.exponentialRampToValueAtTime(0.0001, off);
  wob.connect(wg).connect(hg.gain);
  hum.connect(lp).connect(hg).connect(out);
  hum.start(fire);
  wob.start(fire);
  hum.stop(off + 0.05);
  wob.stop(off + 0.05);
  clank(ctx, out, fire); // the recoil kick through the body
}

/**
 * Sound for a defence move (timings match renderer/defend.js): block = whoosh, then a clang on
 * the forearm; kick = whoosh as the leg snaps out, then a heavy impact; laser = charge, zap, hum.
 */
export function playDefend(ctx, kind, secs) {
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t0 = ctx.currentTime + 0.02;
  const out = ctx.createGain();
  out.gain.value = 0.6;
  out.connect(ctx.destination);
  if (kind === 'block') {
    whoosh(ctx, out, t0, 0.2, 0.35);
    clang(ctx, out, t0 + 0.22 * secs, 0.08);
  } else if (kind === 'kick') {
    whoosh(ctx, out, t0 + 0.28 * secs, 0.22, 0.45);
    clank(ctx, out, t0 + 0.4 * secs);
    tone(ctx, out, t0 + 0.4 * secs, 140, 45, 0.18, 0.3); // heavy thud
  } else if (kind === 'laser') {
    laser(ctx, out, t0, secs);
  }
}

/** Play the transformation: `up` = into AeroStrike, otherwise folding back into Orbit. */
export function playTransform(ctx, up) {
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t0 = ctx.currentTime + 0.05;
  const out = ctx.createGain();
  out.gain.value = 0.55;
  out.connect(ctx.destination);

  // servo whirr: rising when unfolding, falling when folding
  const whirr = ctx.createOscillator();
  whirr.type = 'sawtooth';
  whirr.frequency.setValueAtTime(up ? 90 : 240, t0);
  whirr.frequency.linearRampToValueAtTime(up ? 240 : 80, t0 + SECS - 0.2);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const wg = ctx.createGain();
  wg.gain.setValueAtTime(0, t0);
  wg.gain.linearRampToValueAtTime(0.05, t0 + 0.2);
  wg.gain.setValueAtTime(0.05, t0 + SECS - 0.4);
  wg.gain.linearRampToValueAtTime(0, t0 + SECS - 0.1);
  whirr.connect(lp).connect(wg).connect(out);
  whirr.start(t0);
  whirr.stop(t0 + SECS);

  for (const p of LOCKS) clank(ctx, out, t0 + (up ? p : 1 - p) * SECS);

  const end = t0 + SECS - 0.15;
  if (up) {
    tone(ctx, out, end, 330, 660, 0.09, 0.7); // power-up chord
    tone(ctx, out, end + 0.05, 495, 990, 0.06, 0.7);
  } else {
    tone(ctx, out, end, 660, 220, 0.07, 0.6); // power-down
  }
}
