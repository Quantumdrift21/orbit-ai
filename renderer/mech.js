// AeroStrike: the aerial combat mech Orbit transforms into. Built from the robot's own shared
// materials (so skins and state colours apply), in the robot's space: Orbit's round body becomes
// the chest core, the orb's face stays as the chest display, and every other part unfolds from a
// stowed pose with its own timing, overshoots a little and "locks" into place (setMorph, 0..1).
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import model from './models/aerostrike.glb.js';
import { createJet } from './jet.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
// Overshoot then settle: reads as a mechanical part locking into place.
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
// Legs are drawn 1.35x the size they're modelled at, so they're in proportion to the big upper body.
const LEG_SCALE = 1.35;
// wing feathers: [length, width, fan-out angle]; tools/aerostrike.py models the same six (<wing>F0..F5)
const FEATHERS = [
  [2.6, 0.44, -0.3],
  [2.4, 0.42, -0.45],
  [2.2, 0.4, -0.6],
  [2.0, 0.38, -0.74],
  [1.8, 0.36, -0.88],
  [1.6, 0.34, -1.02],
];
// finger curl per phalanx (knuckle, middle, tip) at a full fist; the little finger curls a bit more
const CURL = [1.35, 1.7, 1.1];

/** Rounded, bevelled hard-surface panel centred on its origin. */
function panel(w, h, d, r = 0.08) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const bevel = Math.min(0.05, d / 3);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.01, d - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.center();
  return g;
}

/** Tapered blade (wing segment / feather): long panel narrowing to a point, starting at x = 0. */
function blade(len, width, thick) {
  const s = new THREE.Shape();
  s.moveTo(0, -width / 2);
  s.lineTo(len * 0.82, -width * 0.32);
  s.lineTo(len, 0);
  s.lineTo(len * 0.82, width * 0.42);
  s.lineTo(0, width / 2);
  s.lineTo(-width * 0.15, 0);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: thick,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    bevelSegments: 2,
  });
  g.translate(0, 0, -thick / 2);
  return g;
}

/**
 * @param {{shell, trim, glowMat:(n:number)=>THREE.Material, sprite:(s:number,o:number)=>THREE.Sprite}} kit
 */
export function buildMech(kit) {
  const { shell, trim, glowMat, sprite } = kit;
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x05070c, roughness: 0.08, clearcoat: 1, metalness: 0.2 });
  // vents, faceplates and gaps between armour (the reference sheet's dark accent, #2B3038)
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2027, roughness: 0.55, metalness: 0.6 });
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  const sphere = (r) => new THREE.SphereGeometry(r, 40, 28);
  const cyl = (r1, r2, h, n = 40) => new THREE.CylinderGeometry(r1, r2, h, n);

  const group = new THREE.Group();
  group.visible = false;
  const parts = []; // { obj, from:{p,r,s}, to:{p,r,s}, t0, t1 }
  /** Register a part at its deployed pose; `from` gives its stowed pose and `t` its time slot. */
  const part = (obj, t, from = {}) => {
    group.add(obj);
    const to = { p: obj.position.toArray(), r: [obj.rotation.x, obj.rotation.y, obj.rotation.z], s: obj.scale.x };
    const p = from.p ?? to.p.map((v) => v * 0.15); // by default it comes out of the chest
    parts.push({ obj, to, from: { p, r: from.r ?? to.r, s: from.s ?? 0.05 }, t0: t[0], t1: t[1] });
    return obj;
  };

  /** A named, empty pivot group; the Blender module of the same name fills it (see the end of this file). */
  const pivot = (name, x, y, z, ...fallback) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    g.add(...fallback);
    return g;
  };

  // ---------- torso: frame and layered armour around Orbit's round body (the chest core) ----------
  part(pivot('frame', 0, 0, 0), [0.04, 0.26], { p: [0, 0, 0], s: 0.6 }); // core bezel, back spine, belly plate
  for (const side of [-1, 1]) {
    const slab = mesh(panel(0.9, 1.3, 0.5, 0.24), shell, side * 0.05, 0.05, -0.1);
    slab.rotation.y = side * 0.72;
    const plate = pivot(side < 0 ? 'chestR' : 'chestL', side * 0.95, 0.15, -0.2, slab);
    part(plate, [0.08, 0.32], { p: [side * 0.3, 0.2, -0.4], r: [0, side * 1.8, 0] });
  }
  part(pivot('collar', 0, 1.02, -0.08, mesh(cyl(0.62, 0.78, 0.32), trim)), [0.1, 0.3], { p: [0, 0.5, -0.1] });
  // segmented abdomen
  [
    [-1.12, 1.2],
    [-1.4, 1.05],
    [-1.66, 0.92],
  ].forEach(([y, w], i) => {
    const rib = pivot('rib' + i, 0, y, -0.05, mesh(panel(w, 0.24, 0.72, 0.1), trim));
    part(rib, [0.12 + i * 0.04, 0.36 + i * 0.04], { p: [0, -0.9, -0.1], r: [1.4, 0, 0] });
  });
  const pelvis = pivot('pelvis', 0, -2.02, -0.05, mesh(panel(1.75, 0.5, 0.9, 0.2), trim));
  part(pelvis, [0.16, 0.42], { p: [0, -1.0, -0.1], r: [-1.2, 0, 0] });

  // ---------- head: helmet, glass visor with glowing eyes, comms discs; rises out of the chest ----------
  const head = new THREE.Group();
  head.position.set(0, 1.88, -0.02);
  /** Place a child on the head's surface, turned to face outwards (yaw), with an extra tilt. */
  const onHead = (obj, x, y, z, tilt = 0, roll = 0) => {
    obj.position.set(x, y, z);
    obj.rotation.set(tilt, Math.atan2(x, z), roll);
    head.add(obj);
    return obj;
  };
  const cranium = mesh(sphere(0.6), shell);
  cranium.scale.set(0.94, 1, 1.02);
  head.add(cranium);
  // crest: a fin running over the top from the brow to the back
  const crest = mesh(new THREE.TorusGeometry(0.6, 0.045, 6, 40, Math.PI * 0.82), shell);
  crest.rotation.set(0, Math.PI / 2, Math.PI * 0.08);
  crest.scale.set(1, 1.04, 1.6);
  head.add(crest);
  // dark faceplate with the glass visor across it
  const face = mesh(
    new THREE.SphereGeometry(0.606, 40, 20, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.36, Math.PI * 0.34),
    dark,
  );
  face.scale.set(0.94, 1, 1.02);
  const visor = mesh(
    new THREE.SphereGeometry(0.612, 40, 12, Math.PI * 0.26, Math.PI * 0.48, Math.PI * 0.4, Math.PI * 0.12),
    glass,
  );
  visor.scale.set(0.94, 1, 1.02);
  head.add(face, visor);
  for (const side of [-1, 1]) {
    // V-shaped brow armour meeting over the nose
    onHead(mesh(panel(0.36, 0.13, 0.08, 0.04), shell), side * 0.17, 0.25, 0.55, -0.35, side * 0.32);
    // angled eye slits on the visor
    onHead(mesh(panel(0.2, 0.055, 0.03, 0.02), glowMat(3.2)), side * 0.17, 0.1, 0.6, -0.1, side * 0.18);
    // cheek guards and jaw
    onHead(mesh(panel(0.2, 0.3, 0.08, 0.06), shell), side * 0.38, -0.2, 0.44, 0.25, side * -0.18);
    // comms "ears": housing, cap and glowing ring
    const comms = mesh(cyl(0.21, 0.24, 0.16), trim, side * 0.6, -0.02, -0.02);
    comms.rotation.z = Math.PI / 2;
    const out = -side; // rotation.z = 90° turns the cylinder's +y into -x
    const cap = mesh(cyl(0.15, 0.17, 0.06), shell, 0, out * 0.1, 0);
    const ring = mesh(new THREE.TorusGeometry(0.175, 0.02, 8, 40), glowMat(2.2), 0, out * 0.085, 0);
    ring.rotation.x = Math.PI / 2;
    const dot = mesh(cyl(0.05, 0.05, 0.02, 20), glowMat(2.6), 0, out * 0.135, 0);
    comms.add(cap, ring, dot);
    head.add(comms);
    // antenna sockets (Orbit's own antennas move up into these)
    const socket = mesh(cyl(0.05, 0.075, 0.1, 16), trim, side * 0.3, 0.52, -0.05);
    socket.rotation.z = -side * 0.5;
    head.add(socket);
  }
  // jaw guard with vent slits
  const jaw = onHead(mesh(panel(0.36, 0.2, 0.1, 0.06), trim), 0, -0.34, 0.47, 0.5);
  for (let i = -1; i <= 1; i++) jaw.add(mesh(panel(0.06, 0.12, 0.04, 0.02), dark, i * 0.1, 0, 0.05));
  // rear cooling vents
  for (let i = 0; i < 4; i++)
    onHead(mesh(panel(0.3 - i * 0.03, 0.03, 0.05, 0.015), trim), 0, 0.14 - i * 0.075, -0.6, -0.15);
  // neck gimbal
  head.add(mesh(cyl(0.18, 0.24, 0.45), trim, 0, -0.62, 0));
  const gimbal = mesh(new THREE.TorusGeometry(0.24, 0.04, 8, 32), shell, 0, -0.55, 0);
  gimbal.rotation.x = Math.PI / 2;
  const neckGlow = mesh(new THREE.TorusGeometry(0.2, 0.015, 6, 32), glowMat(2), 0, -0.72, 0);
  neckGlow.rotation.x = Math.PI / 2;
  head.add(gimbal, neckGlow);
  head.name = 'head';
  part(head, [0.55, 0.8], { p: [0, 0.2, -0.1], s: 0.2 });

  // ---------- shoulders: armour + glowing turbine ----------
  const turbines = [];
  for (const side of [-1, 1]) {
    const sh = new THREE.Group();
    sh.name = side < 0 ? 'shoulderR' : 'shoulderL';
    sh.position.set(side * 1.72, 0.82, -0.05);
    const pad = mesh(sphere(0.56), shell);
    pad.scale.set(1.05, 0.82, 1);
    const ring = mesh(cyl(0.44, 0.44, 0.22, 48), trim, side * 0.36, 0.05, 0.12);
    ring.rotation.z = Math.PI / 2;
    const fan = new THREE.Group();
    fan.position.set(side * 0.48, 0.05, 0.12);
    for (let i = 0; i < 10; i++) {
      const b = mesh(panel(0.05, 0.3, 0.02, 0.01), shell);
      b.position.set(0, Math.cos((i / 10) * TAU) * 0.18, Math.sin((i / 10) * TAU) * 0.18);
      b.rotation.x = (i / 10) * TAU;
      b.rotation.y = 0.5;
      fan.add(b);
    }
    const glowRing = mesh(new THREE.TorusGeometry(0.36, 0.03, 10, 48), glowMat(2.4), side * 0.48, 0.05, 0.12);
    glowRing.rotation.y = Math.PI / 2;
    const flare = sprite(1.1, 0.45);
    flare.userData.keep = true; // stays when the Blender model fills the part
    flare.position.set(side * 0.56, 0.05, 0.12);
    sh.add(pad, ring, fan, glowRing, flare);
    sh.userData.fan = fan; // the Blender model's own fan (<name>Fan) takes over when it loads
    turbines.push(sh);
    part(sh, [0.42, 0.66], { p: [side * 0.9, 0.3, 0], s: 0.3, r: [0, 0, side * 1.6] });
  }

  // ---------- arms: swing down from the shoulders and extend; human hands ----------
  const arms = [];
  const joints = []; // elbow and knee groups, filled from the model like the parts
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = side < 0 ? 'armR' : 'armL';
    arm.position.set(side * 1.78, 0.5, 0);
    const upper = mesh(new THREE.CapsuleGeometry(0.28, 0.6, 8, 20), trim, 0, -0.45, 0);
    const elbow = mesh(sphere(0.21), trim, 0, -0.98, 0);
    // everything below the elbow bends as one (the backflip tuck); the model fills it as fore<R|L>
    const lower = pivot(side < 0 ? 'foreR' : 'foreL', 0, -0.98, 0);
    lower.userData.keep = true; // survives the arm being filled from the model
    const fore = mesh(panel(0.66, 1.05, 0.64, 0.18), shell, 0, -0.57, 0.02);
    fore.add(mesh(panel(0.07, 0.62, 0.06, 0.03), glowMat(1.8), side * 0.34, 0, 0));
    // the hand bends at the wrist on its own; the model fills it as hand<R|L> with jointed fingers
    const hand = pivot(side < 0 ? 'handR' : 'handL', 0, -1.12, 0.04);
    hand.userData.keep = true; // survives the forearm being filled from the model
    hand.add(mesh(panel(0.42, 0.3, 0.3, 0.1), trim, 0, -0.12, 0));
    for (let i = 0; i < 4; i++) {
      const f = mesh(new THREE.CapsuleGeometry(0.045, 0.24 - Math.abs(i - 1.5) * 0.04, 6, 12), shell);
      f.position.set(side * (0.15 - i * 0.1), -0.42, 0.02);
      hand.add(f);
    }
    const thumb = mesh(new THREE.CapsuleGeometry(0.05, 0.2, 6, 12), shell, side * 0.25, -0.24, 0.08);
    thumb.rotation.z = side * 0.6;
    hand.add(thumb);
    hand.userData.fingers = []; // [finger][phalanx], from the model (index, middle, ring, little, thumb)
    lower.add(fore, hand);
    arm.add(upper, elbow, lower);
    arm.userData.fore = lower;
    arm.userData.hand = hand;
    joints.push(lower, hand);
    arm.rotation.z = side * 0.08;
    arms.push(arm);
    part(arm, [0.34, 0.62], { p: [side * 1.2, 0.6, 0], r: [0, 0, side * 2.6], s: 0.25 });
  }
  // retractable blade on the right forearm (modelled in Blender only); slides out of its rail last
  const sword = pivot('blade', -0.42, -0.17, 0);
  sword.userData.keep = true; // survives the forearm being filled from the model
  arms[0].userData.fore.add(sword);
  joints.push(sword);

  // ---------- legs: unfold down from the pelvis; clawed feet ----------
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = side < 0 ? 'legR' : 'legL';
    leg.position.set(side * 0.6, -2.2, 0);
    leg.add(mesh(sphere(0.26), trim));
    leg.add(mesh(new THREE.CapsuleGeometry(0.35, 0.56, 8, 20), trim, 0, -0.62, 0));
    leg.add(mesh(panel(0.5, 0.62, 0.2, 0.14), shell, 0, -0.6, 0.3)); // thigh armour
    // everything below the knee bends as one; the model fills it as shin<R|L>
    const lower = pivot(side < 0 ? 'shinR' : 'shinL', 0, -1.2, 0);
    lower.userData.keep = true;
    const knee = mesh(sphere(0.26), trim, 0, 0, 0.02);
    knee.add(mesh(panel(0.42, 0.42, 0.16, 0.12), shell, 0, 0.02, 0.24));
    const shin = mesh(panel(0.74, 1.0, 0.76, 0.2), shell, 0, -0.6, 0);
    shin.add(mesh(panel(0.08, 0.55, 0.06, 0.03), glowMat(1.8), 0, 0.02, 0.39));
    const ankle = mesh(sphere(0.17), trim, 0, -1.12, 0);
    const foot = new THREE.Group();
    foot.position.set(0, -1.32, 0.12);
    foot.add(mesh(panel(0.62, 0.24, 0.86, 0.08), trim));
    for (let i = 0; i < 3; i++) {
      const toe = mesh(new THREE.ConeGeometry(0.07, 0.34, 12), shell, (i - 1) * 0.17, -0.04, 0.5);
      toe.rotation.x = Math.PI / 2;
      foot.add(toe);
    }
    const heel = mesh(new THREE.ConeGeometry(0.07, 0.26, 12), shell, 0, -0.04, -0.46);
    heel.rotation.x = -Math.PI / 2;
    foot.add(heel);
    lower.add(knee, shin, ankle, foot);
    leg.add(lower);
    leg.userData.shin = lower;
    joints.push(lower);
    legs.push(leg);
    leg.scale.setScalar(LEG_SCALE); // deployed size (part() reads it); knees and feet scale with it
    part(leg, [0.22, 0.52], { p: [side * 0.3, -1.4, -0.2], r: [-2.4, 0, 0], s: 0.3 });
  }

  // ---------- backpack with twin thrusters ----------
  const pack = new THREE.Group();
  pack.name = 'pack';
  pack.position.set(0, 0.05, -1.02);
  pack.add(mesh(panel(1.25, 1.3, 0.62, 0.2), trim));
  const jets = []; // twin jet engines (renderer/jet.js): flame at each nozzle, exhaust in the scene
  for (const side of [-1, 1]) {
    const nozzle = mesh(cyl(0.2, 0.26, 0.42), shell, side * 0.36, -0.82, -0.08);
    const ring = mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 32), glowMat(2.6), 0, -0.21, 0);
    ring.rotation.x = Math.PI / 2;
    nozzle.add(ring);
    const jet = createJet({ radius: 0.22, length: 2.4, exhaust: { speed: 5.5, size: 0.24 } });
    jet.flame.userData.keep = true; // survives the Blender model swap
    jet.flame.position.set(side * 0.36, -1.03, -0.08); // nozzle exit
    jet.flame.rotation.z = side * 0.42; // splayed outward: the plumes clear the legs
    jets.push(jet);
    pack.add(nozzle, jet.flame);
  }
  part(pack, [0.5, 0.74], { p: [0, 0, -0.4], r: [0.9, 0, 0] });

  // ---------- wings: fold out from the back, then the feathers fan open ----------
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.name = side < 0 ? 'wingR' : 'wingL';
    wing.position.set(side * 0.7, 1.05, -1.0);
    const hub = mesh(cyl(0.32, 0.32, 0.2, 40), trim);
    hub.rotation.x = Math.PI / 2;
    const hubRing = mesh(new THREE.TorusGeometry(0.24, 0.03, 8, 40), glowMat(2.4), 0, 0.11, 0);
    hubRing.rotation.x = Math.PI / 2;
    hub.add(hubRing);
    const main = mesh(blade(3.1, 0.6, 0.12), shell);
    main.add(mesh(panel(2.0, 0.05, 0.04, 0.02), glowMat(1.8), 1.25, 0.1, 0.07));
    const feathers = [];
    // six feathers in two overlapping layers, fanning over the same span the wing always had
    FEATHERS.forEach(([len, w, open], i) => {
      const f = mesh(blade(len, w, 0.07), i % 2 ? trim : shell, 0.12, -0.1, -0.05 - (i % 2) * 0.07 - i * 0.012);
      f.userData.open = open;
      feathers.push(f);
      wing.add(f);
    });
    wing.add(hub, main);
    wing.userData.feathers = feathers;
    // deployed: pointing up and out (the left wing is the right one turned around)
    wing.rotation.set(0, side === 1 ? 0 : Math.PI, 0.78);
    wings.push(wing);
    part(wing, [0.62, 0.9], { p: [side * 0.3, 0.2, -0.9], r: [0, side === 1 ? 0 : Math.PI, -1.35], s: 0.35 });
  }

  // ---------- morph and life ----------
  /** 0 = folded away inside Orbit, 1 = AeroStrike. Each part follows its own time slot. */
  function setMorph(p) {
    group.visible = p > 0.001;
    if (!group.visible) return;
    for (const pt of parts) {
      const q = clamp01((p - pt.t0) / (pt.t1 - pt.t0));
      const e = easeOutBack(q);
      pt.obj.visible = q > 0;
      pt.obj.position.set(...pt.from.p.map((v, i) => lerp(v, pt.to.p[i], e)));
      pt.obj.rotation.set(...pt.from.r.map((v, i) => lerp(v, pt.to.r[i], e)));
      pt.obj.scale.setScalar(Math.max(0.001, lerp(pt.from.s, pt.to.s, Math.min(1, e))));
    }
    // feathers fan open last
    const fan = easeOutBack(clamp01((p - 0.82) / 0.16));
    for (const w of wings) for (const f of w.userData.feathers) f.rotation.z = f.userData.open * fan;
    const out = easeOutBack(clamp01((p - 0.86) / 0.12));
    sword.visible = out > 0.01;
    sword.scale.set(1, Math.max(0.01, out), 1); // grows down from its root
  }

  /**
   * Idle life, added on top of the pose setMorph just set (call it after setMorph each frame):
   * turbines spin, the head looks around (look is already smoothed), limbs trail when flying.
   */
  function update(
    t,
    dt,
    {
      lookX = 0,
      lookY = 0,
      vx = 0,
      vy = 0,
      level = 0,
      pose = null,
      guard = 0,
      def = null,
      joints: J = null,
      flinch = 0,
      posture = null,
    } = {},
  ) {
    if (!group.visible) return;
    for (const sh of turbines) sh.userData.fan.rotation.x += dt * (4 + Math.hypot(vx, vy) / 60);
    head.rotation.y += lookX * 0.6;
    head.rotation.x += lookY * 0.3;
    const trail = Math.max(-0.5, Math.min(0.5, vx / 900));
    arms.forEach((a, i) => {
      a.rotation.x += Math.sin(t * 1.3 + i) * 0.05 - Math.max(-0.4, Math.min(0.4, vy / 1200)) + level * 0.2;
    });
    legs.forEach((l, i) => {
      l.rotation.x += Math.sin(t * 1.1 + i * 2) * 0.04 + Math.abs(trail) * 0.4;
      l.rotation.z += -trail * 0.3;
    });
    for (const w of wings) w.rotation.x += Math.sin(t * 2.2) * 0.05;
    // stunts done like a person (renderer/flip.js; robot.js turns the whole body):
    // - flip/roll: crouch, arms swing back then up (overhead for a backflip, out to the sides for a
    //   side flip), then tuck — hips bring the knees to the chest, knees fold, hands wrap the shins,
    //   chin down — open out, land soft
    // - spin: a skater's jump spin — arms thrown wide, then pulled in tight in front of the chest with
    //   the legs together (spinning faster), opened to slow down, land soft
    // - loop: a superhero loop — one fist punches ahead and the other follows a beat later (bent at
    //   first), legs trail with a flutter, back arches and head looks into the turn, wings swept back
    const {
      style,
      tuck = 0,
      crouch = 0,
      reach = 0,
      stretch = 0,
      lead = 0,
      follow: after = 0,
      arch = 0,
      flutter = 0,
    } = pose ?? {};
    const looping = style === 'loop';
    const ball = style === 'flip' || style === 'roll'; // tuck = knees to chest
    const skater = style === 'spin'; // tuck = arms in tight, legs together
    legs.forEach((l, i) => {
      const side = i === 0 ? -1 : 1;
      l.rotation.x -= (ball ? 2.1 * tuck : 0) + 0.75 * crouch - 0.15 * stretch - 0.3 * arch;
      if (skater) l.rotation.z -= side * 0.12 * tuck;
      const kick = looping ? (i === 0 ? 1 : -1) * 0.22 * flutter : 0; // legs flutter against each other
      l.userData.shin.rotation.x =
        (ball ? 2.4 : 0.15) * tuck + 1.5 * crouch + ((i === 0 ? 0.8 : 0.15) + kick) * stretch;
    });
    arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      const up = Math.max(0, reach);
      if (style === 'flip') a.rotation.x -= 2.9 * up;
      else a.rotation.z += side * (skater ? 1.3 : 2.6) * up;
      const punch = looping ? (i === 1 ? lead : after) : stretch; // the left fist leads the loop
      a.rotation.x -= 0.7 * Math.min(0, reach) + (skater ? 1.3 : 0.55) * tuck + 2.9 * punch;
      a.rotation.z -= side * ((skater ? 0.3 : 0.5) * tuck + 0.15 * punch); // hands in
      const bent = looping ? 0.9 * Math.max(0, stretch - after) : 0; // the following arm straightens late
      a.userData.fore.rotation.x = -(skater ? 1.2 : 0.45) * tuck - 0.3 * crouch - bent;
    });
    head.rotation.x += (ball ? 0.4 : 0) * tuck - 0.3 * stretch - 0.25 * arch;
    for (const w of wings) {
      w.rotation.x -= 0.5 * tuck + 0.55 * stretch; // wings sweep back, out of the way
      w.rotation.z -= 0.3 * arch;
    }
    defend(t, guard, def);
    follow(J, flinch);
    if (posture) hold(posture);
    // hands: relaxed and a little curled at rest (like ours), fists on guard, in a block, wrapping the
    // shins in a tuck and leading a superhero loop; open in the laser brace; a quick clench on a flinch
    const d = def ?? {};
    arms.forEach((a, i) => {
      const near = d.side < 0 ? i === 0 : i === 1;
      const fist = Math.max(guard, (near ? d.guard : d.guardOff) ?? 0, ball ? tuck : 0, stretch, flinch * 0.8);
      const own = posture?.arms[i].grip; // a posture's own hand shape (open palm, folded arms, asleep)
      const grip =
        (own != null && fist < 0.3 ? own : clamp01(0.28 + 0.72 * fist - 0.3 * (d.open ?? 0))) +
        Math.sin(t * 0.7 + i * 2) * 0.03;
      a.userData.hand.userData.fingers.forEach((segs, f) => {
        const curl = f === 4 ? grip * 0.55 : grip * (1 + 0.06 * f);
        segs.forEach((o, k) =>
          o.quaternion.copy(o.userData.rest).multiply(bend.setFromAxisAngle(X_AXIS, -curl * CURL[k])),
        );
      });
    });
  }

  /** A posture from renderer/postures.js (stance, taunt, sleep): added on top of everything else. */
  function hold(P) {
    arms.forEach((a, i) => {
      const A = P.arms[i];
      a.rotation.x += A.x;
      a.rotation.z += A.z;
      a.userData.fore.rotation.x += A.fore;
      a.userData.fore.rotation.z += A.foreZ;
    });
    legs.forEach((l, i) => {
      const L = P.legs[i];
      l.rotation.x += L.x;
      l.rotation.z += L.z;
      l.userData.shin.rotation.x += L.knee;
    });
    head.rotation.x += P.head.x;
    head.rotation.y += P.head.y;
    head.rotation.z += P.head.z;
    for (const w of wings) {
      w.rotation.x += P.wings.x;
      w.rotation.z += P.wings.z;
    }
  }

  const bend = new THREE.Quaternion();
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  /**
   * Follow-through (renderer/joints.js gives each joint's lag): every limb segment moves on its own,
   * relative to the one it hangs from, so a dodge ripples down the body instead of moving it stiffly.
   * Elbows and knees only bend the way ours do. `flinch` 0..1 is the startle reflex of a dodge:
   * hands come up in front of the face, knees tuck, chin drops.
   */
  function follow(J, flinch) {
    if (!J) return;
    const sp = J.spine; // robot.js leans the whole body with it; limbs here move relative to that
    head.rotation.z -= J.neck.x;
    head.rotation.x += J.neck.z + 0.3 * flinch;
    arms.forEach((a, i) => {
      const s = i === 0 ? 'R' : 'L';
      const side = i === 0 ? -1 : 1;
      const sh = J['shoulder' + s];
      const el = J['elbow' + s];
      const wr = J['wrist' + s];
      a.rotation.z += sh.x + sp.x - side * 0.25 * flinch;
      a.rotation.x -= sh.z + sp.z + 1.1 * flinch;
      const fore = a.userData.fore;
      fore.rotation.x -= Math.max(-0.05, el.z - sh.z) + 0.3 * Math.abs(el.x - sh.x) + 1.5 * flinch;
      fore.rotation.z = (el.x - sh.x) * 0.4;
      const hand = a.userData.hand;
      hand.rotation.x = -(wr.z - el.z) - 0.2 * flinch;
      hand.rotation.z = wr.x - el.x;
    });
    legs.forEach((l, i) => {
      const s = i === 0 ? 'R' : 'L';
      const hp = J['hip' + s];
      const kn = J['knee' + s];
      l.rotation.z += hp.x + sp.x;
      l.rotation.x -= hp.z + sp.z + 0.55 * flinch;
      l.userData.shin.rotation.x += Math.max(-0.05, hp.z - kn.z) + 0.25 * Math.abs(kn.x - hp.x) + 0.9 * flinch;
    });
    wings.forEach((w, i) => {
      const s = i === 0 ? 'R' : 'L';
      const side = i === 0 ? -1 : 1;
      const wg = J['wing' + s];
      const tip = J['tip' + s];
      w.rotation.x += wg.z - 0.3 * flinch; // flinch: wings fold in
      w.rotation.z -= side * wg.x * 0.8;
      // each layer of feathers lags a little more than the one in front of it: a ripple out to the tips
      const n = w.userData.feathers.length;
      w.userData.feathers.forEach((f, k) => {
        const lag = (k + 1) / n;
        f.rotation.z -= side * (tip.x - wg.x) * lag;
        f.rotation.y = (tip.z - wg.z) * lag * 0.6;
      });
    });
  }

  /**
   * Defence (renderer/defend.js gives the numbers, robot.js turns the body to face the threat):
   * - guard 0..1: a fighter's stance while defence mode is on — fists up by the chin, elbows in,
   *   the leading leg forward, knees soft, chin down, small weight shifts
   * - def: a move against a click on side `side` (-1 = its right, the screen's left; arms[0]/legs[0]):
   *   block = that forearm snaps up across the face; kick = that knee chambers then snaps out
   *   sideways toward the click while the other knee bends to balance; laser = brace low, arms open
   *   so the chest core is clear
   */
  function defend(t, guard, def) {
    if (guard < 0.001 && !def) return;
    const d = def ?? {};
    const near = d.side < 0 ? 0 : 1; // limbs on the side the click came from
    const shift = Math.sin(t * 2.4) * 0.04 * guard; // a fighter never stands quite still
    arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      const g = i === near ? (d.guard ?? 0) : (d.guardOff ?? 0);
      const up = Math.max(guard, g);
      // guard: upper arm ~50° forward, elbow ~85° (fists by the chin); block: elbow up near
      // shoulder height and the forearm upright, turned in across the face
      a.rotation.x -= 0.85 * up + 0.45 * g + 0.3 * (d.flinch ?? 0) - 0.3 * (d.open ?? 0);
      a.rotation.z -= side * (0.28 * up + 0.35 * g);
      a.rotation.z += side * 0.75 * (d.open ?? 0);
      a.userData.fore.rotation.x -= (1.5 * up + 0.1 * g) * (1 - (d.open ?? 0)); // open: arms straight out
    });
    legs.forEach((l, i) => {
      const side = i === 0 ? -1 : 1;
      const kicking = i === near;
      const lead = i === 1 ? 1 : -1; // left leg forward in the stance
      l.rotation.x -= guard * 0.22 * lead + 0.75 * (d.crouch ?? 0) + shift;
      l.userData.shin.rotation.x += guard * 0.3 + 1.5 * (d.crouch ?? 0);
      if (kicking) {
        l.rotation.x -= 1.45 * (d.hip ?? 0);
        l.rotation.z += side * 0.55 * (d.hip ?? 0); // out toward the click
        l.userData.shin.rotation.x += 2.1 * (d.knee ?? 0);
      } else {
        l.rotation.x -= 0.25 * (d.stance ?? 0); // standing leg: hip and knee bend together
        l.userData.shin.rotation.x += 0.55 * (d.stance ?? 0);
      }
    });
    head.rotation.x += 0.1 * guard + 0.3 * (d.flinch ?? 0) - 0.15 * (d.beam ?? 0);
    for (const w of wings) w.rotation.x -= 0.25 * guard + 0.3 * (d.flinch ?? 0); // tucked back, out of reach
  }

  // ---------- detailed modules modelled in Blender (tools/aerostrike.py) ----------
  // Each named module in the model replaces the built-in shapes of the part with the same name;
  // the part keeps its pivot, timing and animation. If the model can't load, the built-in shapes stay.
  const mats = { shell, trim, dark, glass, glow: glowMat(2.6) };
  try {
    const bytes = Uint8Array.from(atob(model), (c) => c.charCodeAt(0)).buffer;
    new GLTFLoader().parse(
      bytes,
      '',
      (gltf) => {
        gltf.scene.traverse((o) => {
          if (o.isMesh) o.material = mats[o.material.name.replace(/\.\d+$/, '')] ?? shell;
        });
        for (const obj of [...parts.map((pt) => pt.obj), ...joints]) {
          const src = obj.name && gltf.scene.getObjectByName(obj.name);
          if (!src) continue;
          obj.remove(...obj.children.filter((c) => !c.userData.keep));
          obj.add(...src.children);
          obj.userData.fan = obj.getObjectByName(obj.name + 'Fan') ?? obj.userData.fan;
          // wings: the model's feathers (<name>F0..F5) take over, with the same fan-out angles
          obj.userData.feathers = obj.userData.feathers?.map((old, i) => {
            const f = obj.getObjectByName(obj.name + 'F' + i);
            if (!f) return old;
            f.userData.open = old.userData.open;
            return f;
          });
        }
        // hands: phalanges hand<R|L>F<finger><joint> (0 = index … 3 = little, 4 = thumb), chained in the model
        for (const a of arms) {
          const hand = a.userData.hand;
          hand.userData.fingers = [0, 1, 2, 3, 4]
            .map((f) => [0, 1, 2].map((k) => hand.getObjectByName(`${hand.name}F${f}${k}`)).filter(Boolean))
            .filter((segs) => segs.length);
          for (const segs of hand.userData.fingers) for (const o of segs) o.userData.rest = o.quaternion.clone();
        }
      },
      (e) => console.warn('AeroStrike model failed to load, using the built-in shapes', e),
    );
  } catch (e) {
    console.warn('AeroStrike model failed to load, using the built-in shapes', e);
  }

  return { group, setMorph, update, jets };
}
