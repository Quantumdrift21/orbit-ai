// AeroStrike's ambush (defence mode): after you've come at it and backed off, it waits a few quiet
// seconds, then fires a long laser across the screen at your mouse pointer, when you least expect it.
// Pure decision logic for brain.js; tested in test/ambush.test.js.
const NEAR = 170; // px: an approach (an attack) counts from here
const AWAY = 320; // px: ...and backing off from here
const REMEMBER = 12; // s: an approach is forgotten after this
const SLOW = 150; // px/s: the pointer has settled
const COOLDOWN = 25; // s between ambushes

/** Fresh state. */
const createAmbush = () => ({ nearAt: -1e9, awayAt: 0, wait: 0, next: 0 });

/**
 * One tick. dist = pointer distance from the robot's centre (px), speed = pointer speed (px/s),
 * t = seconds, rand(a, b) = a random wait. Returns true when it should fire now.
 */
function ambushStep(s, { dist, speed, t, guard, rand = (a, b) => a + Math.random() * (b - a) }) {
  if (!guard) {
    s.awayAt = 0;
    return false;
  }
  if (dist < NEAR) s.nearAt = t;
  const remembered = t - s.nearAt < REMEMBER;
  const settledAway = dist > AWAY && speed < SLOW;
  if (!remembered || !settledAway) {
    s.awayAt = 0; // still close, or moving: keep watching
    return false;
  }
  if (!s.awayAt) {
    s.awayAt = t;
    s.wait = rand(2, 5);
    return false;
  }
  if (t - s.awayAt < s.wait || t < s.next) return false;
  s.next = t + COOLDOWN;
  s.nearAt = -1e9; // one ambush per approach
  s.awayAt = 0;
  return true;
}

module.exports = { createAmbush, ambushStep, NEAR, AWAY, COOLDOWN };
