// A jet engine's flame and exhaust (renderer). The physics (spool lag, drag, buoyancy) is in
// jetPhysics.js; this file draws it:
//   - flame: two nested cones from the nozzle, a short blue-white core inside a longer orange plume,
//     with scrolling turbulence, flicker and shock diamonds (bright bands whose spacing grows with
//     throttle), soft at the edges and the tip
//   - exhaust: soft particles in world space that leave the nozzle, cool from yellow to orange to
//     grey smoke, grow, drift up and trail behind as the window flies
// Normal alpha blending (not the additive glow blend) so it shows over the transparent window.
import * as THREE from './vendor/three.module.min.js';
import { createExhaust, stepExhaust } from './jetPhysics.js';

const FLAME_VERT = /* glsl */ `
  varying float vL;   // 0 at the nozzle, 1 at the tip
  varying float vA;   // angle around the axis
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vL = -position.y;
    vA = atan(position.z, position.x);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;

const FLAME_FRAG = /* glsl */ `
  uniform float uTime, uThrottle, uPop, uDiamonds, uOpacity;
  uniform vec3 uHot, uCool;
  varying float vL;
  varying float vA;
  varying vec3 vN;
  varying vec3 vV;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float edge = pow(abs(dot(normalize(vN), normalize(vV))), 0.8);       // soft silhouette
    float n = noise(vec2(vA * 3.0, vL * 6.0 - uTime * 14.0)) * 0.6
            + noise(vec2(vA * 7.0, vL * 15.0 - uTime * 27.0)) * 0.4;      // turbulence streaming out
    float fade = pow(clamp(1.0 - vL, 0.0, 1.0), 1.4);
    float spacing = 3.0 / max(0.45, uThrottle);                           // more thrust, longer cells
    float diamonds = pow(0.5 + 0.5 * cos(vL * 6.2831 * spacing), 10.0) * (1.0 - vL) * uDiamonds;
    float heat = clamp(1.0 - vL * 1.3 + (n - 0.5) * 0.35, 0.0, 1.0);
    vec3 col = mix(uCool, uHot, heat) + diamonds * vec3(0.95, 0.97, 1.0);
    float burn = 0.45 + 0.55 * clamp(uThrottle, 0.0, 1.3);                // even idling, it clearly burns
    float a = 1.7 * edge * fade * (0.55 + 0.45 * n) * burn * (1.0 + uPop * 0.7) + diamonds * 0.6 * edge;
    gl_FragColor = vec4(col * (1.0 + uPop * 0.5), clamp(a * uOpacity, 0.0, 1.0));
  }`;

const SMOKE_VERT = /* glsl */ `
  attribute float aAge;   // 0..1 of its life; >= 1 is dead
  attribute float aSize;
  uniform float uScale;   // px per world unit at distance 1
  varying float vT;
  void main() {
    vT = aAge;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aAge >= 1.0 ? 0.0 : aSize * (1.0 + 2.6 * aAge) * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const SMOKE_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vT;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float soft = pow(1.0 - d, 1.6);
    vec3 hot = vec3(1.0, 0.88, 0.55), warm = vec3(1.0, 0.42, 0.12), smoke = vec3(0.36, 0.36, 0.4);
    vec3 col = vT < 0.15 ? mix(hot, warm, vT / 0.15) : mix(warm, smoke, clamp((vT - 0.15) / 0.35, 0.0, 1.0));
    float a = soft * pow(1.0 - vT, 1.3) * (vT < 0.3 ? 0.85 : 0.4);
    gl_FragColor = vec4(col, a * uOpacity);
  }`;

function flameCone(radiusTip, hot, cool, diamonds, order) {
  const geo = new THREE.CylinderGeometry(1, radiusTip, 1, 28, 24, true);
  geo.translate(0, -0.5, 0); // nozzle at y = 0, tip at y = -1
  const mat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uThrottle: { value: 0 },
      uPop: { value: 0 },
      uDiamonds: { value: diamonds },
      uOpacity: { value: 1 },
      uHot: { value: new THREE.Color(hot) },
      uCool: { value: new THREE.Color(cool) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = order;
  m.frustumCulled = false;
  return m;
}

/**
 * One engine. `flame` goes at the nozzle exit, pointing down its local -Y; `smoke` must be added to
 * the scene (world space). Call update() every frame.
 */
export function createJet({ radius = 0.2, length = 1.4, particles = 120, exhaust = {} } = {}) {
  const flame = new THREE.Group();
  const plume = flameCone(0.22, 0xffc070, 0xff4a14, 0.35, 10);
  const core = flameCone(0.08, 0xf2f6ff, 0x5a8cff, 1, 11);
  flame.add(plume, core);

  const ex = createExhaust(particles);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(ex.pos, 3).setUsage(THREE.DynamicDrawUsage));
  const ages = new Float32Array(particles).fill(1);
  geo.setAttribute('aAge', new THREE.BufferAttribute(ages, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(ex.size, 1).setUsage(THREE.DynamicDrawUsage));
  const smoke = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: { uScale: { value: 400 }, uOpacity: { value: 1 } },
      transparent: true,
      depthWrite: false,
    }),
  );
  smoke.frustumCulled = false;
  smoke.renderOrder = 9;

  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const wscale = new THREE.Vector3();
  const q = new THREE.Quaternion();

  /**
   * throttle/pop: engine state (jetPhysics.spool); opacity: 0 hides it (folded away);
   * shift: world movement under the camera this frame [x, y, z]; pxScale: px per world unit at 1.
   */
  function update(dt, t, { throttle, pop = 0, opacity = 1, shift = [0, 0, 0], pxScale = 400 }) {
    const on = opacity > 0.01;
    flame.visible = on;
    if (on) {
      const flick = 1 + 0.07 * Math.sin(t * 43) + 0.05 * Math.sin(t * 71 + 1.3);
      const len = length * (0.35 + 0.75 * Math.min(1.4, throttle)) * flick;
      const wid = radius * (0.85 + 0.2 * Math.min(1.4, throttle));
      plume.scale.set(wid, len, wid);
      core.scale.set(wid * 0.55, len * 0.45, wid * 0.55);
      for (const m of [plume, core]) {
        const u = m.material.uniforms;
        u.uTime.value = t;
        u.uThrottle.value = throttle;
        u.uPop.value = pop;
        u.uOpacity.value = opacity;
      }
    }
    // exhaust from the nozzle, along the flame's axis, in world space
    flame.getWorldPosition(origin);
    dir.set(0, -1, 0).applyQuaternion(flame.getWorldQuaternion(q)).normalize();
    origin.addScaledVector(dir, length * 0.3 * flame.getWorldScale(wscale).y);
    stepExhaust(ex, dt, {
      ...exhaust,
      throttle: on ? throttle : 0,
      origin: [origin.x, origin.y, origin.z],
      dir: [dir.x, dir.y, dir.z],
      shift,
    });
    for (let i = 0; i < particles; i++) ages[i] = Math.min(1, ex.age[i] / ex.life[i]);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAge.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    smoke.material.uniforms.uScale.value = pxScale;
    smoke.material.uniforms.uOpacity.value = Math.max(opacity, 0.001);
  }

  return { flame, smoke, update };
}
