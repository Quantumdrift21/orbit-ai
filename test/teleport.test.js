// Teleport decisions (teleport.js). Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const tp = require('../teleport');

const wa = { x: 1920, y: 0, width: 1920, height: 1040 }; // a second monitor, to catch 0,0 assumptions
const inside = (p) =>
  p.x >= wa.x + 90 && p.x <= wa.x + wa.width - 90 && p.y >= wa.y + 90 && p.y <= wa.y + wa.height - 110;

test('phases: the body leaves until the jump, then arrives', () => {
  assert.deepStrictEqual(tp.teleportPhase(0.2), { phase: 'out', k: 0.4 });
  assert.deepStrictEqual(tp.teleportPhase(0.5), { phase: 'in', k: 0 });
  assert.ok(Math.abs(tp.teleportPhase(0.9).k - 0.8) < 1e-9 && tp.teleportPhase(1).k === 1);
});

test('destinations are far, inside the work area and pass goodSpot; none when nothing passes', () => {
  const c = { x: wa.x + 300, y: 300 };
  let seed = 0.1;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 50; i++) {
    const p = tp.pickDestination(wa, c, () => true, rand);
    assert.ok(p && inside(p) && Math.hypot(p.x - c.x, p.y - c.y) >= tp.MIN_JUMP);
  }
  assert.strictEqual(
    tp.pickDestination(wa, c, () => false, rand),
    null,
  );
});

test('an escape goes to the far side from the pointer; boxed in at an edge it mirrors across', () => {
  const c = { x: wa.x + 900, y: 500 };
  const p = tp.escapeSpot(wa, c, { x: c.x + 100, y: c.y }, () => 0.5); // pointer on the right
  assert.ok(p.x < c.x - tp.MIN_JUMP + 1 && inside(p));
  const edge = { x: wa.x + 95, y: 500 };
  const q = tp.escapeSpot(wa, edge, { x: edge.x + 100, y: edge.y }, () => 0); // would go off the left edge
  assert.ok(inside(q) && Math.hypot(q.x - edge.x, q.y - edge.y) >= tp.MIN_JUMP);
});

test('escapes need a very fast swipe nearby, no guard/catch/drag/sleep, and a cooldown', () => {
  const base = {
    speed: 1000,
    dist: 100,
    t: 10,
    lastEscape: -100,
    caught: false,
    guard: false,
    mode: 'rest',
    dragging: false,
    rand: () => 0.1,
  };
  assert.ok(tp.shouldEscape(base));
  assert.ok(!tp.shouldEscape({ ...base, rand: () => 0.9 })); // the other half of the time: a plain dodge
  for (const bad of [
    { speed: 900 },
    { dist: 200 },
    { guard: true },
    { caught: true },
    { dragging: true },
    { mode: 'sleep' },
    { lastEscape: 8 },
  ])
    assert.ok(!tp.shouldEscape({ ...base, ...bad }), JSON.stringify(bad));
});
