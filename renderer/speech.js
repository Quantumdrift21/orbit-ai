// Cuts an alert into sentences for the natural voice (voice.js synthesizes about 2x slower than real
// time on a laptop CPU, so a whole alert would take 10–20 s before a word is heard): the first sentence
// is short and plays while the next one is still being made. Pure; tested in test/speech.test.mjs.

/**
 * Sentences of `text`, each at most `max` characters (long ones are cut at a comma or a word), tiny
 * fragments joined to their neighbour, the whole thing capped at `total` characters.
 */
export function speechChunks(text, { max = 90, total = 240 } = {}) {
  const clean = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, total);
  if (!clean) return [];
  const out = [];
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    let s = sentence;
    while (s.length > max) {
      let cut = s.lastIndexOf(', ', max);
      if (cut < max * 0.4) cut = s.lastIndexOf(' ', max);
      if (cut < max * 0.4) cut = max;
      out.push(s.slice(0, cut + (s[cut] === ',' ? 1 : 0)).trim());
      s = s.slice(cut).replace(/^,?\s*/, '');
    }
    if (s) out.push(s);
  }
  // a fragment of a few characters ("OK.") rides with the one before it
  const merged = [];
  for (const s of out) {
    if (merged.length && s.length < 12 && merged[merged.length - 1].length + s.length + 1 <= max)
      merged[merged.length - 1] += ' ' + s;
    else merged.push(s);
  }
  return merged;
}
