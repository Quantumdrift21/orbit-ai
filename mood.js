// Orbit's mood (main process). Events push a few feeling scores up; time pulls them back
// toward calm. Pure functions, so the rules are easy to test (test/mood.test.js).

const MOOD_LABELS = {
  happy: 'Happy 😊',
  excited: 'Excited 🤩',
  calm: 'Calm 😌',
  bored: 'Bored 😐',
  sleepy: 'Sleepy 😴',
  grumpy: 'Grumpy 😤',
};

// How much each event raises a score (0..1). 'dodge' is per second of dodging.
const BUMPS = {
  talk: { happy: 0.15 },
  attention: { happy: 0.08 },
  trick: { excited: 0.5, happy: 0.1 },
  morning: { excited: 0.5 },
  dodge: { grumpy: 0.25 }, // about 2 s of dodging before Orbit turns grumpy
};

// Seconds for a score to fall by half when nothing happens.
const HALF_LIFE = { happy: 600, excited: 120, grumpy: 150 };

// How each mood changes behaviour (multipliers on the daily rhythm in brain.js).
const EFFECTS = {
  excited: { speed: 1.3, trick: 2, nap: 1.5 },
  happy: { speed: 1.1, trick: 1.3, nap: 1.2 },
  calm: { speed: 1, trick: 1, nap: 1 },
  bored: { speed: 0.8, trick: 0.5, nap: 0.8 },
  sleepy: { speed: 0.7, trick: 0, nap: 0.6 },
  grumpy: { speed: 1.1, trick: 0.3, nap: 1 },
};

const BORED_AFTER = 600; // seconds with nobody paying attention

const freshScores = () => ({ happy: 0, excited: 0, grumpy: 0 });

/** Scores after `dt` seconds of fading. */
function decay(scores, dt) {
  const out = {};
  for (const [k, v] of Object.entries(scores)) out[k] = v * Math.pow(0.5, dt / HALF_LIFE[k]);
  return out;
}

/** Scores after an event (`amount` scales it, e.g. seconds of dodging). */
function bump(scores, event, amount = 1) {
  const out = { ...scores };
  for (const [k, v] of Object.entries(BUMPS[event] || {})) out[k] = Math.min(1, (out[k] || 0) + v * amount);
  return out;
}

/** The mood to show. Strong feelings win; otherwise night → sleepy, long idle → bored, else calm. */
function pick(scores, { idleSecs = 0, night = false } = {}) {
  if (scores.grumpy >= 0.5) return 'grumpy';
  if (scores.excited >= 0.4) return 'excited';
  if (scores.happy >= 0.4) return 'happy';
  if (night) return 'sleepy';
  if (idleSecs > BORED_AFTER) return 'bored';
  return 'calm';
}

module.exports = { MOOD_LABELS, EFFECTS, freshScores, decay, bump, pick };
