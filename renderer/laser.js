// The ambush laser (a full-screen, click-through overlay window; main.js shows it for one shot):
// a targeting reticle closes on the pointer while the core charges, then a thick beam with a white-hot
// core and a wide red glow crosses the screen, splashes at the pointer with sparks, and fades.
// Timing matches the laser pose in defend.js (charge until ~0.65 s, beam 0.65–1.2 s, over by 1.5 s).
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let shot = null; // { x0, y0, x1, y1, start }
const sparks = [];

const fit = () => {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};
addEventListener('resize', fit);
fit();

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function draw(now) {
  requestAnimationFrame(draw);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  if (!shot) return;
  const s = (now - shot.start) / 1000;
  if (shot.kind === 'streak') {
    if (s > shot.secs) shot = null;
    else drawStreak(s);
    return;
  }
  if (s > 1.6) {
    shot = null;
    sparks.length = 0;
    return;
  }
  const { x0, y0, x1, y1 } = shot;
  const charge = smooth(0.1, 0.6, s) * (1 - smooth(0.62, 0.7, s));
  const beam = smooth(0.62, 0.68, s) * (1 - smooth(1.1, 1.25, s));
  const flicker = 1 + 0.15 * Math.sin(s * 95) + 0.07 * Math.sin(s * 37);

  // reticle closing on the pointer while it charges
  if (charge > 0.01) {
    const r = 70 - 50 * charge;
    ctx.save();
    ctx.globalAlpha = 0.9 * charge;
    ctx.strokeStyle = '#ff2a1a';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ff2a1a';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x1, y1, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + s * 1.5;
      ctx.beginPath();
      ctx.moveTo(x1 + Math.cos(a) * (r + 4), y1 + Math.sin(a) * (r + 4));
      ctx.lineTo(x1 + Math.cos(a) * (r + 16), y1 + Math.sin(a) * (r + 16));
      ctx.stroke();
    }
    ctx.restore();
  }

  if (beam > 0.01) {
    const w = beam * flicker;
    ctx.save();
    ctx.lineCap = 'round';
    // wide soft glow, mid glow, hot core
    for (const [width, color, alpha, blur] of [
      [46, '#ff1a10', 0.18, 40],
      [22, '#ff3a26', 0.45, 24],
      [10, '#ff8c6a', 0.85, 10],
      [4, '#fff2ea', 1, 0],
    ]) {
      ctx.globalAlpha = alpha * Math.min(1, beam * 1.3);
      ctx.strokeStyle = color;
      ctx.lineWidth = width * w;
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    // splash at the pointer
    const g = ctx.createRadialGradient(x1, y1, 0, x1, y1, 90 * w);
    g.addColorStop(0, 'rgba(255,245,235,1)');
    g.addColorStop(0.25, 'rgba(255,90,60,0.8)');
    g.addColorStop(1, 'rgba(255,30,20,0)');
    ctx.globalAlpha = beam;
    ctx.shadowBlur = 0;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x1, y1, 90 * w, 0, Math.PI * 2);
    ctx.fill();
    // sparks flying off the impact
    if (sparks.length < 60 && beam > 0.5)
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 120 + Math.random() * 380;
        sparks.push({ x: x1, y: y1, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 0.5 + Math.random() * 0.5 });
      }
    ctx.restore();
  }
  // sparks live on a little after the beam
  ctx.save();
  for (const p of sparks) {
    p.life -= 1 / 60;
    p.vy += 900 / 60;
    p.x += p.vx / 60;
    p.y += p.vy / 60;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = '#ffb48a';
    ctx.fillRect(p.x, p.y, 3, 3);
  }
  ctx.restore();
  for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
}
requestAnimationFrame(draw);

/**
 * The teleport streak: a bright head races from where the robot was to where it lands (the window jumps
 * halfway through the effect), with a fading tail. Orbit's is a thin cyan-white warp line; AeroStrike's a
 * wider orange trail with afterimages, the "blur" of something heavy arriving fast.
 */
function drawStreak(s) {
  const { x0, y0, x1, y1, form, secs } = shot;
  const q = s / secs;
  const u = smooth(0.35, 0.65, q); // head position along the path, around the window jump
  if (u <= 0 || q > 0.82) return;
  const fade = 1 - smooth(0.64, 0.82, q);
  const hx = x0 + (x1 - x0) * u;
  const hy = y0 + (y1 - y0) * u;
  const tail = Math.max(0, u - 0.3);
  const tx = x0 + (x1 - x0) * tail;
  const ty = y0 + (y1 - y0) * tail;
  const mech = form === 'mech';
  const layers = mech
    ? [
        [30, '#ff8a3c', 0.18, 34],
        [14, '#ffb070', 0.5, 18],
        [5, '#fff4e6', 1, 0],
      ]
    : [
        [22, '#38d9ff', 0.2, 30],
        [9, '#7fe9ff', 0.6, 14],
        [3, '#ffffff', 1, 0],
      ];
  ctx.save();
  ctx.lineCap = 'round';
  for (const [w, color, a, blur] of layers) {
    ctx.globalAlpha = a * fade;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  }
  if (mech) {
    // afterimages beside the trail
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffd2a8';
    ctx.lineWidth = 6;
    for (const off of [-16, 16]) {
      ctx.globalAlpha = 0.25 * fade;
      ctx.beginPath();
      ctx.moveTo(tx + nx * off, ty + ny * off);
      ctx.lineTo(hx + nx * off * 0.4, hy + ny * off * 0.4);
      ctx.stroke();
    }
  }
  ctx.restore();
}

window.orbit.onAmbush((b) => {
  shot = { ...b, start: performance.now() };
});
