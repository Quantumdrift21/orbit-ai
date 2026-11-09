// AeroStrike's postures, as additive joint angles (radians) on top of its pose; mech.js applies them.
//   stance(t)        relaxed standing: weight on one leg, the other knee soft, hip and shoulders tilted
//                    against each other, arms loose; the weight moves from leg to leg now and then
//   taunt(kind, p)   a short show of attitude, p = 0..1:
//                    'beckon' (come on: one palm up, fingers curl twice, other fist on the hip, chin up),
//                    'flex' (double biceps), 'cross' (arms crossed, head shaking: not impressed)
//   sleep(t)         asleep in mid-air: slumped forward, chin down, arms folded, knees drawn up and
//                    crossed, wings folded down, slow breathing
// Arms and legs are [right, left] (index 0 is the robot's right, like mech.js). Signs follow mech.js:
// arm x < 0 swings forward/up, arm z > 0 moves the hand toward +x; fore < 0 bends the elbow; knee > 0
// bends it; leg x < 0 lifts the thigh forward; head x > 0 drops the chin; root x > 0 leans forward.
// Pure; tested in test/postures.test.mjs.

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const TAUNTS = { beckon: 2.6, flex: 2.2, cross: 2.6 }; // seconds

const limb = () => ({ x: 0, z: 0, fore: 0, foreZ: 0, grip: null });
/** A neutral posture (nothing added). */
export function zero() {
  return {
    arms: [limb(), limb()],
    legs: [
      { x: 0, z: 0, knee: 0 },
      { x: 0, z: 0, knee: 0 },
    ],
    head: { x: 0, y: 0, z: 0 },
    root: { x: 0, y: 0, z: 0 },
    wings: { x: 0, z: 0 },
  };
}

/** Which leg carries the weight: -1 = right, 1 = left; holds a side for a while, then shifts over. */
export const weightAt = (t) => Math.max(-1, Math.min(1, 1.7 * Math.sin((2 * Math.PI * t) / 19)));

export function stance(t) {
  const P = zero();
  const w = weightAt(t);
  P.root.z = -0.045 * w; // the hip drops on the free side
  P.head.z = 0.05 * w; // the head stays over the standing foot
  P.legs.forEach((l, i) => {
    const side = i === 0 ? -1 : 1;
    const free = clamp01(-w * side); // this leg is the free one
    l.x = -0.12 * free;
    l.knee = 0.06 + 0.3 * free;
    l.z = side * 0.06 * free;
  });
  P.arms.forEach((a, i) => {
    const side = i === 0 ? -1 : 1;
    a.z = side * 0.12; // hang a little away from the body
    a.x = -0.06 + 0.04 * Math.sin(t * 0.6 + i);
    a.fore = -0.28;
  });
  return P;
}

export function taunt(kind, p) {
  const P = zero();
  const e = smooth(0, 0.16, p) * (1 - smooth(0.84, 1, p)); // into the pose and back out
  if (kind === 'beckon') {
    // left arm forward, palm up; fingers curl in twice; right fist on the hip; chin up, leaning back
    const L = P.arms[1];
    L.x = -1.15 * e;
    L.fore = -0.9 * e;
    L.foreZ = -0.6 * e;
    const curl = Math.max(0, Math.sin(Math.PI * 2 * smooth(0.3, 0.8, p) * 2));
    L.grip = 0.15 + 0.75 * curl * e;
    const R = P.arms[0];
    R.z = -0.75 * e; // elbow out...
    R.fore = -1.55 * e; // ...hand back to the hip
    R.x = 0.15 * e;
    R.grip = e > 0.3 ? 1 : null;
    P.head.x = -0.22 * e;
    P.head.z = 0.12 * e;
    P.root.x = -0.1 * e;
  } else if (kind === 'flex') {
    // double biceps: arms out to the sides, forearms straight up, fists; a little bounce
    const pump = 0.12 * Math.sin(Math.PI * 2 * smooth(0.25, 0.85, p) * 2) * e;
    P.arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      a.z = side * 1.35 * e;
      a.x = -0.15 * e;
      a.fore = -(1.9 + pump) * e;
      a.foreZ = side * 0.2 * e;
      a.grip = e > 0.2 ? 1 : null;
    });
    P.head.y = 0.35 * Math.sin(Math.PI * smooth(0.2, 0.8, p)) * e;
    P.root.y = 0.04 * Math.abs(Math.sin(Math.PI * 4 * p)) * e;
    P.wings.z = 0.25 * e; // wings flare up
  } else if (kind === 'cross') {
    // arms folded across the chest, weight back on one leg, head shaking slowly
    P.arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      a.x = -0.55 * e;
      a.z = -side * 0.3 * e;
      a.fore = -1.75 * e;
      a.foreZ = -side * 0.45 * e;
      a.grip = e > 0.3 ? 0.7 : null;
    });
    P.head.y = 0.28 * Math.sin(Math.PI * 2 * smooth(0.25, 0.85, p) * 1.5) * e;
    P.head.x = -0.1 * e;
    P.legs[1].x = -0.18 * e;
    P.legs[1].knee = 0.35 * e;
  }
  return P;
}

export function sleep(t) {
  const P = zero();
  const breath = Math.sin(t * 0.9); // slow, deep
  P.root.x = 0.22 + 0.02 * breath;
  P.root.y = 0.03 * breath;
  P.head.x = 0.45;
  P.head.z = 0.18;
  P.arms.forEach((a, i) => {
    const side = i === 0 ? -1 : 1;
    a.x = -0.5 - 0.03 * breath;
    a.z = -side * 0.28;
    a.fore = -1.7;
    a.foreZ = -side * 0.5;
    a.grip = 0.45;
  });
  P.legs[0].x = -0.75;
  P.legs[0].knee = 1.35;
  P.legs[0].z = 0.14; // crossed over at the ankles
  P.legs[1].x = -0.55;
  P.legs[1].knee = 1.05;
  P.legs[1].z = -0.06;
  P.wings.x = -0.4;
  P.wings.z = -0.5;
  return P;
}

/** a + b * k, joint by joint (grip: the larger one wins). */
export function blend(a, b, k) {
  if (k <= 0) return a;
  const add = (o, q) => {
    for (const key in q) {
      if (key === 'grip') {
        if (q.grip != null && k > 0.3) o.grip = Math.max(o.grip ?? 0, q.grip);
      } else if (typeof q[key] === 'number') o[key] += q[key] * k;
    }
  };
  a.arms.forEach((x, i) => add(x, b.arms[i]));
  a.legs.forEach((x, i) => add(x, b.legs[i]));
  add(a.head, b.head);
  add(a.root, b.root);
  add(a.wings, b.wings);
  return a;
}
