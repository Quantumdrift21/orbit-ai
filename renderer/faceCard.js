// Cards on Orbit's face screen (and AeroStrike's chest screen): an agent's icon, an emoji and a little
// text, e.g. when Claude finishes or Codex hits an error, or when you ask Orbit to show something.
// cardFor() and customCard() are pure (tested in test/faceCard.test.mjs); drawCard() paints the face.
// The agent icons are Orbit's own simple drawings in each app's colours, not the apps' logos.

const TAU = Math.PI * 2;

// What each alert kind shows (agent-watch.js kinds)
const KINDS = {
  done: { emoji: '✅', text: 'Done' },
  error: { emoji: '❌', text: 'Error' },
  input: { emoji: '✋', text: 'Needs you' },
  agent: { emoji: '🤖', text: 'Agent' },
  task: { emoji: '📋', text: 'Task' },
};
export const ICONS = ['claude', 'codex', 'antigravity', 'copilot', 'opencode', 'hermes'];

/** The card for an agent alert ({ who: 'Claude', kind: 'done', project }), or null if there's nothing to show. */
export function cardFor(alert) {
  const k = KINDS[alert?.kind];
  if (!k) return null;
  const key = String(alert.who || '').toLowerCase();
  return {
    icon: ICONS.includes(key) ? key : null,
    letter: key ? key[0].toUpperCase() : '',
    emoji: k.emoji,
    text: k.text,
    sub: String(alert.project || '').slice(0, 40),
  };
}

/** A card you asked for by voice: any text (up to 60 characters) and/or one emoji. */
export function customCard({ text = '', emoji = '' } = {}) {
  const t = String(text).replace(/\s+/g, ' ').trim().slice(0, 60);
  const e = [...String(emoji).trim()].slice(0, 4).join(''); // one emoji can be several code points
  return t || e ? { icon: null, letter: '', emoji: e, text: t, sub: '' } : null;
}

// ---------- drawing (design units: a 512 x 356 screen) ----------
function icon(g, name, letter, x, y, r) {
  g.save();
  g.translate(x, y);
  g.shadowBlur = 10;
  if (name === 'claude') {
    // a warm sunburst of rounded rays
    g.shadowColor = g.strokeStyle = '#e07a52';
    g.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.13;
      const len = r * (i % 3 === 0 ? 0.98 : i % 3 === 1 ? 0.78 : 0.88);
      g.lineWidth = r * 0.17;
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.16, Math.sin(a) * r * 0.16);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      g.stroke();
    }
  } else if (name === 'codex') {
    // a terminal tile with a prompt and a cursor
    g.shadowColor = '#9fe8d4';
    g.fillStyle = '#e9f6f2';
    g.beginPath();
    g.roundRect(-r, -r * 0.8, r * 2, r * 1.6, r * 0.32);
    g.fill();
    g.strokeStyle = '#11151c';
    g.lineWidth = r * 0.17;
    g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(-r * 0.55, -r * 0.32);
    g.lineTo(-r * 0.12, 0);
    g.lineTo(-r * 0.55, r * 0.32);
    g.moveTo(r * 0.08, r * 0.36);
    g.lineTo(r * 0.55, r * 0.36);
    g.stroke();
  } else if (name === 'antigravity') {
    // a rising arrow through a tilted orbit, blue to violet
    const grad = g.createLinearGradient(-r, r, r, -r);
    grad.addColorStop(0, '#3d8bff');
    grad.addColorStop(1, '#b06bff');
    g.shadowColor = '#7d7bff';
    g.strokeStyle = grad;
    g.lineWidth = r * 0.13;
    g.beginPath();
    g.ellipse(0, r * 0.15, r * 0.95, r * 0.36, -0.35, 0, TAU);
    g.stroke();
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r * 0.5, -r * 0.25);
    g.lineTo(r * 0.17, -r * 0.25);
    g.lineTo(r * 0.17, r * 0.75);
    g.lineTo(-r * 0.17, r * 0.75);
    g.lineTo(-r * 0.17, -r * 0.25);
    g.lineTo(-r * 0.5, -r * 0.25);
    g.closePath();
    g.fill();
  } else if (name === 'copilot') {
    // a pilot's visor with two eyes
    g.shadowColor = g.fillStyle = '#c9d1d9';
    g.beginPath();
    g.roundRect(-r, -r * 0.55, r * 2, r * 1.1, r * 0.5);
    g.fill();
    g.fillStyle = '#11151c';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(s * r * 0.42, 0, r * 0.2, r * 0.26, 0, 0, TAU);
      g.fill();
    }
  } else if (name === 'opencode') {
    // curly braces
    g.shadowColor = g.fillStyle = '#f0f0f0';
    g.font = `bold ${r * 1.5}px Consolas, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('{ }', 0, r * 0.05);
  } else if (name === 'hermes') {
    // a winged messenger's feather
    g.shadowColor = g.fillStyle = '#f4c95d';
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.ellipse(-r * 0.1 + i * r * 0.18, -r * 0.1 - i * r * 0.18, r * (0.85 - i * 0.14), r * 0.2, -0.75, 0, TAU);
      g.fill();
    }
  } else {
    g.shadowColor = g.fillStyle = '#d8e2f0';
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    g.fillStyle = '#11151c';
    g.font = `bold ${r * 1.1}px Segoe UI, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter || '?', 0, r * 0.06);
  }
  g.restore();
}

/** Text in one line, shrunk to fit, or scrolling sideways if it still doesn't. */
function line(g, text, y, size, color, t, W) {
  g.font = `600 ${size}px Segoe UI, sans-serif`;
  let w = g.measureText(text).width;
  if (w > W - 40 && size > 30) {
    size = Math.max(30, Math.floor((size * (W - 40)) / w));
    g.font = `600 ${size}px Segoe UI, sans-serif`;
    w = g.measureText(text).width;
  }
  g.fillStyle = color;
  g.textBaseline = 'middle';
  if (w <= W - 40) {
    g.textAlign = 'center';
    g.fillText(text, W / 2, y);
    return;
  }
  const gap = 80;
  const x = 20 - ((t * 70) % (w + gap));
  g.textAlign = 'left';
  g.fillText(text, x, y);
  g.fillText(text, x + w + gap, y);
}

/**
 * Paint `card` on the face canvas context `g` (already scaled to 512 x 356 design units).
 * `age` = seconds since it appeared (for the pop-in), `accent` = the screen's glow colour.
 */
export function drawCard(g, card, age, accent, W = 512, H = 356) {
  const pop = Math.min(1, age / 0.25);
  const s = 0.85 + 0.15 * (1 - (1 - pop) ** 3);
  g.save();
  g.globalAlpha = pop;
  g.translate(W / 2, H / 2);
  g.scale(s, s);
  g.translate(-W / 2, -H / 2);
  const hasText = !!(card.text || card.sub);
  const top = hasText ? H * 0.36 : H / 2;
  const both = card.icon || card.letter;
  if (both) icon(g, card.icon, card.letter, card.emoji ? W * 0.3 : W / 2, top, hasText ? 66 : 90);
  if (card.emoji) {
    g.shadowBlur = 0;
    g.font = `${hasText ? 112 : 170}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(card.emoji, both ? W * 0.7 : W / 2, top + 6);
  }
  g.shadowColor = accent;
  g.shadowBlur = 12;
  if (card.text && !card.emoji && !both) {
    line(g, card.text, H / 2, 74, accent, age, W); // text only: big
  } else {
    if (card.text) line(g, card.text, card.sub ? H * 0.72 : H * 0.78, 58, accent, age, W);
    if (card.sub) line(g, card.sub, H * 0.89, 34, '#c8d4e6', age, W);
  }
  g.restore();
}
