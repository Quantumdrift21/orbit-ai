// Flow: Orbit's second character (tools/flow.py models it). A chibi genie-scholar as the small form and
// the mage it transforms into as the big form, both loaded from glTF with named pivots that match the
// joints in joints.js, so the same follow-through physics, flight and transform driver move it. Only the
// look is Flow's own: everything OG does with its body (taunts, flips, defence, warp) is still to come.
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import genieModel from './models/flow-genie.glb.js';
import mageModel from './models/flow-mage.glb.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
// Each form's scale in the robot's units (Orbit's body has radius 1) and the height of its centre.
const FIT = { genie: { s: 0.62, y: 0.3 }, mage: { s: 1.25, y: -1.3 } };

/**
 * kit.glowMat(intensity) makes a material tinted with the robot's accent colour (robot.js keeps it in step).
 * Returns { group, setMorph(p), update(t, dt, ctx) } like mech.js, with both forms inside `group`.
 */
export function buildFlow(kit) {
  const group = new THREE.Group();
  group.name = 'flow';
  const forms = {};
  const loader = new GLTFLoader();
  for (const [name, model] of [
    ['genie', genieModel],
    ['mage', mageModel],
  ]) {
    const holder = new THREE.Group();
    holder.scale.setScalar(FIT[name].s);
    holder.position.y = FIT[name].y;
    holder.visible = false;
    group.add(holder);
    const f = (forms[name] = { holder, node: () => null });
    try {
      const bytes = Uint8Array.from(atob(model), (c) => c.charCodeAt(0)).buffer;
      loader.parse(
        bytes,
        '',
        (gltf) => {
          const glow = kit.glowMat(1.1);
          glow.color.set(0x0a1a33);
          glow.transparent = true;
          glow.opacity = 0.6;
          glow.depthWrite = false;
          gltf.scene.traverse((o) => {
            if (!o.isMesh) return;
            if (o.material.name.replace(/\.\d+$/, '') === 'glow') o.material = glow;
            o.frustumCulled = false; // skinned smoke and cloth move outside their rest bounds
          });
          holder.add(gltf.scene);
          f.glow = glow;
          const byName = {};
          gltf.scene.traverse((o) => {
            if (o.name) byName[o.name] = o;
          });
          f.node = (n) => byName[n] ?? null;
          for (const o of Object.values(byName)) o.userData.rest = o.rotation.clone();
        },
        (e) => console.error('flow model', name, e),
      );
    } catch (e) {
      console.error('flow model', name, e);
    }
  }

  // Transform: the body spins up and shrinks into a swirl of glowing motes, which spread into a cloud
  // and then gather into the other form, which grows out of them (the brain drives 0..1; 1.2 s or so).
  const MOTES = 140;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(MOTES * 3);
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteSeed = Array.from({ length: MOTES }, (_, i) => ({
    a: (i / MOTES) * Math.PI * 2 * 7.3, // a loose spiral
    y: -1.6 + (i / MOTES) * 3.4,
    r: 0.3 + (0.7 * ((i * 7919) % 97)) / 97,
    w: 0.6 + ((i * 104729) % 53) / 53,
  }));
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({
      color: 0x6ec1ff,
      size: 0.09,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  motes.visible = false;
  motes.frustumCulled = false;
  group.add(motes);
  let morph = 0;
  let spin = 0;
  /** 0 = genie, 1 = mage (the brain's transform progress); the swap happens in the middle. */
  function setMorph(p) {
    morph = clamp01(p);
    forms.genie.holder.visible = morph < 0.5;
    forms.mage.holder.visible = morph >= 0.5;
    // how far into the dissolve we are: 0 at rest, 1 at the midpoint, on either side
    const mid = Math.max(0, 1 - Math.abs(morph - 0.5) / 0.3);
    const dissolve = mid ** 1.5;
    for (const n of Object.keys(forms)) {
      const h = forms[n].holder;
      h.scale.set(FIT[n].s * (1 - 0.9 * dissolve), FIT[n].s * (1 - 0.6 * dissolve), FIT[n].s * (1 - 0.9 * dissolve));
      h.rotation.y = spin * dissolve;
    }
    motes.visible = mid > 0.02;
    motes.material.opacity = Math.min(1, mid * 2.5);
    motes.material.size = 0.06 + 0.1 * dissolve;
  }

  /**
   * Idle life and follow-through, after setMorph each frame. ctx: lookX/lookY (smoothed gaze), level
   * (voice 0..1), state, sleepy, breath (-1..1), joints (joints.js springs), flinch (startle 0..1).
   */
  function update(
    t,
    dt,
    { lookX = 0, lookY = 0, level = 0, state = 'idle', sleepy = false, breath = 0, joints: J = null, flinch = 0 } = {},
  ) {
    const form = morph < 0.5 ? forms.genie : forms.mage;
    const mage = form === forms.mage;
    const n = form.node;
    const rest = (o) => o.rotation.copy(o.userData.rest ?? o.rotation);
    const talk = state === 'speaking' ? level : 0;
    const listen = state === 'listening' ? 1 : 0;
    const sp = J?.spine ?? { x: 0, z: 0 };

    // transform motes: a spiral that winds up as the body dissolves and spreads out at the midpoint
    if (motes.visible) {
      spin += dt * 9;
      const mid = Math.max(0, 1 - Math.abs(morph - 0.5) / 0.3);
      const spread = 0.35 + 1.6 * mid ** 2;
      for (let i = 0; i < MOTES; i++) {
        const m = moteSeed[i];
        const a = m.a + spin * m.w;
        const r = m.r * spread;
        motePos[i * 3] = Math.cos(a) * r;
        motePos[i * 3 + 1] = m.y * (0.4 + 0.6 * mid) + Math.sin(spin * 2 + m.a) * 0.15 * mid;
        motePos[i * 3 + 2] = Math.sin(a) * r;
      }
      moteGeo.attributes.position.needsUpdate = true;
      motes.material.color.copy(forms.genie.glow?.emissive ?? motes.material.color);
    } else spin = 0;

    // face: blink, brows, and a mouth that opens to the voice (the smile shows when it's quiet)
    const blink = (t % 3.7 < 0.13 ? 0.1 : 1) * (sleepy ? 0.45 : 1);
    for (const s of ['R', 'L']) {
      const eye = n('eye' + s);
      const brow = n('brow' + s);
      if (eye) eye.scale.set(1, blink, 1);
      if (brow) {
        rest(brow);
        brow.position.y =
          (brow.userData.restY ??= brow.position.y) +
          (state === 'thinking' && s === 'L' ? 0.06 : 0) -
          (sleepy ? 0.04 : 0) +
          listen * 0.03;
        brow.rotation.z += state === 'thinking' && s === 'L' ? 0.15 : 0;
      }
    }
    const smile = n('smile');
    const mouth = n('mouth');
    if (smile && mouth) {
      const talking = state === 'speaking';
      smile.visible = !talking;
      mouth.visible = talking || state === 'listening' || state === 'error';
      const open = talking ? 0.3 + 1.6 * level : state === 'error' ? 0.5 : 0.35;
      mouth.scale.set(talking ? 1 - 0.3 * level : 0.6, open, 1);
    }

    const neck = n('neck');
    if (neck) {
      rest(neck);
      neck.rotation.y += lookX * 0.5;
      neck.rotation.x += lookY * 0.3 + (sleepy ? 0.25 : 0) + (state === 'thinking' ? -0.08 : 0) + talk * 0.08;
      neck.rotation.z += (state === 'thinking' ? 0.14 : 0) + (J ? -J.neck.x : 0) + Math.sin(t * 0.7) * 0.02;
      if (J) neck.rotation.x += J.neck.z + 0.3 * flinch;
    }
    const spine = n('spine');
    if (spine) {
      rest(spine);
      spine.rotation.x += breath * 0.02 + (sleepy ? 0.12 : 0);
    }
    // arms: open, palms up, floating a little; raised when listening or talking; thrown up when startled
    for (const [side, s] of [
      [-1, 'R'],
      [1, 'L'],
    ]) {
      const sh = n('shoulder' + s);
      const el = n('elbow' + s);
      const wr = n('wrist' + s);
      if (!sh || !el) continue;
      rest(sh);
      rest(el);
      const out = (mage ? 0.55 : 0.8) + 0.25 * listen + 0.3 * talk + Math.sin(t * 1.1 + side) * 0.05 + 0.6 * flinch;
      const bendF =
        (mage ? -1.05 : -1.2) - 0.3 * listen - 0.5 * talk - 0.8 * flinch + Math.sin(t * 0.9 + side * 2) * 0.04;
      sh.rotation.z += side * out;
      sh.rotation.x += -0.1 - breath * 0.03;
      el.rotation.x += bendF;
      if (sleepy) {
        sh.rotation.z -= side * 0.5;
        el.rotation.x += 0.6;
      }
      if (J) {
        const shj = J['shoulder' + s];
        const elj = J['elbow' + s];
        const wrj = J['wrist' + s];
        sh.rotation.z += shj.x + sp.x;
        sh.rotation.x -= shj.z + sp.z;
        el.rotation.x -= Math.max(-0.05, elj.z - shj.z) + 0.3 * Math.abs(elj.x - shj.x);
        el.rotation.z += (elj.x - shj.x) * 0.4;
        if (wr) {
          rest(wr);
          wr.rotation.x += -(wrj.z - elj.z) - 0.2 * flinch;
          wr.rotation.z += wrj.x - elj.x;
        }
      }
    }
    if (mage) {
      // legs dangle a little as it floats; cape swings with the wing springs
      for (const [side, s] of [
        [-1, 'R'],
        [1, 'L'],
      ]) {
        const hp = n('hip' + s);
        const kn = n('knee' + s);
        if (hp) {
          rest(hp);
          hp.rotation.x += Math.sin(t * 0.8 + side) * 0.04 - 0.05 + (sleepy ? 0.4 : 0);
          if (J) {
            hp.rotation.z += J['hip' + s].x + sp.x;
            hp.rotation.x -= J['hip' + s].z + sp.z + 0.55 * flinch;
          }
        }
        if (kn) {
          rest(kn);
          kn.rotation.x +=
            0.08 + (sleepy ? 0.5 : 0) + (J ? Math.max(-0.05, J['hip' + s].z - J['knee' + s].z) + 0.9 * flinch : 0);
        }
        const wg = n('wing' + s);
        const wg1 = n('wing' + s + '1');
        if (wg && J) {
          rest(wg);
          wg.rotation.x += J['wing' + s].z * 0.8 + Math.sin(t * 0.6 + side) * 0.02;
          wg.rotation.z -= side * J['wing' + s].x * 0.5;
          if (wg1) {
            rest(wg1);
            wg1.rotation.x += (J['tip' + s].z - J['wing' + s].z) * 0.8;
            wg1.rotation.z -= side * (J['tip' + s].x - J['wing' + s].x) * 0.6;
          }
        }
      }
      const cape = n('cape');
      const cape1 = n('cape1');
      if (cape && J) {
        rest(cape);
        cape.rotation.x += (J.wingR.z + J.wingL.z) * 0.4 + Math.sin(t * 0.5) * 0.02;
        if (cape1) {
          rest(cape1);
          cape1.rotation.x += (J.tipR.z + J.tipL.z - J.wingR.z - J.wingL.z) * 0.4;
        }
      }
    } else {
      // the smoke tail waves: a slow curl of its own plus the leg springs' lag down its length
      const wave = Math.sin(t * 1.3);
      const tails = ['tail0', 'tail1', 'tail2'].map(n);
      const lag = J ? [(J.hipR.z + J.hipL.z) / 2, (J.kneeR.z + J.kneeL.z) / 2, (J.tipR.z + J.tipL.z) / 2] : [0, 0, 0];
      const lagX = J ? [(J.hipR.x + J.hipL.x) / 2, (J.kneeR.x + J.kneeL.x) / 2, (J.tipR.x + J.tipL.x) / 2] : [0, 0, 0];
      tails.forEach((b, i) => {
        if (!b) return;
        rest(b);
        b.rotation.x += wave * 0.08 * (i + 1) + lag[i] * 1.2 + (i ? lag[i] - lag[i - 1] : 0);
        b.rotation.z += Math.cos(t * 0.9 + i) * 0.06 * (i + 1) - lagX[i] * 1.2 - (i ? lagX[i] - lagX[i - 1] : 0);
      });
    }
  }

  return { group, setMorph, update };
}
