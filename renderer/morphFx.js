// Energy effects for the transformation (robot.js drives them with the morph progress, 0 = Orbit,
// 1 = AeroStrike, either direction): a flash at the core and a shockwave ring as it starts, a glowing
// cocoon that swells round the body while the parts first unfold (so they seem to form out of light),
// sparks spiralling in, and a scan line sweeping down as the armour locks on. Everything uses normal
// alpha blending: additive glow is invisible over the transparent window (see CLAUDE.md).
// fxLevels() is pure (tested in test/postures.test.mjs); createMorphFx() builds the meshes.
import * as THREE from './vendor/three.module.min.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 0 → 1 → 0: rises from a to the peak, falls back by b. */
const bump = (x, a, peak, b) => smooth(a, peak, x) * (1 - smooth(peak, b, x));

/** How strong each effect is at morph progress f (0..1). All are 0 when it isn't transforming. */
export function fxLevels(f) {
  if (!(f > 0.001 && f < 0.999)) return { flash: 0, ring: 0, ringR: 0, cocoon: 0, sparks: 0, scan: 0, scanY: 0 };
  return {
    flash: bump(f, 0, 0.04, 0.16), // a burst of light from the core
    ring: 1 - smooth(0.02, 0.3, f), // shockwave: fades as it grows
    ringR: 0.4 + 7 * smooth(0, 0.3, f),
    cocoon: bump(f, 0.01, 0.2, 0.62), // hides the first unfolding, gone once the parts lock
    sparks: bump(f, 0.02, 0.3, 0.9),
    scan: bump(f, 0.25, 0.4, 0.8),
    scanY: 2.6 - 7 * smooth(0.25, 0.8, f), // head to feet (mech units)
  };
}

const glowMaterial = (frag, extra = {}) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vP;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vUv = uv; vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha; uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vP;
      void main() { ${frag} }`,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    ...extra,
  });

export function createMorphFx() {
  const group = new THREE.Group();
  group.position.y = -0.8; // the mech's middle (mech units; the robot's root scales it)

  // cocoon: bright rim, softly see-through middle, energy bands rippling up it
  const cocoon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    glowMaterial(`
      float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
      float bands = 0.6 + 0.4 * sin(vP.y * 14.0 - uTime * 9.0);
      vec3 col = mix(uColor, vec3(1.0), rim * 0.6);
      gl_FragColor = vec4(col, uAlpha * (0.32 + 0.68 * rim) * bands);`),
  );
  cocoon.scale.set(2.6, 3.6, 2.3);

  // shockwave ring in the screen plane
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 96),
    glowMaterial(`gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.5), uAlpha);`, { side: THREE.DoubleSide }),
  );

  // flash: a soft disc of light at the core, always facing the camera
  const flash = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    glowMaterial(`
      float d = length(vUv - 0.5) * 2.0;
      gl_FragColor = vec4(mix(vec3(1.0), uColor, d), uAlpha * pow(max(0.0, 1.0 - d), 2.0));`),
  );

  // scan line: a thin glowing disc sweeping down the body
  const scan = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 64),
    glowMaterial(
      `float d = length(vUv - 0.5) * 2.0;
       float edge = smoothstep(0.7, 1.0, d) * (1.0 - smoothstep(0.96, 1.0, d));
       gl_FragColor = vec4(mix(uColor, vec3(1.0), edge), uAlpha * (0.12 + 0.88 * edge));`,
      { side: THREE.DoubleSide },
    ),
  );
  scan.rotation.x = -Math.PI / 2;

  // sparks spiralling round the body
  const N = 140;
  const seeds = Array.from({ length: N }, (_, i) => ({
    a: (i / N) * Math.PI * 2 * 7,
    y: (((i * 37) % N) / N) * 7 - 3.5,
    r: 2.2 + ((i * 53) % 10) / 10,
    s: 1.5 + ((i * 29) % 10) / 6,
  }));
  const pos = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uSize: { value: 60 } },
    vertexShader: `
      uniform float uSize;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        gl_FragColor = vec4(mix(vec3(1.0), uColor, d), uAlpha * (1.0 - d));
      }`,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const sparks = new THREE.Points(geo, sparkMat);
  sparks.frustumCulled = false;

  for (const m of [cocoon, scan, sparks, ring, flash]) m.renderOrder = 2; // drawn over the robot
  group.add(cocoon, scan, sparks, ring, flash);
  ring.position.y = flash.position.y = 0.8; // the chest core
  group.visible = false;

  /** f = morph progress, t = time (s), accent = THREE.Color, camera: the flat effects face it. */
  function update(f, t, accent, camera) {
    const L = fxLevels(f);
    group.visible = L.cocoon + L.ring + L.flash + L.sparks + L.scan > 0.002;
    if (!group.visible) return;
    for (const m of [cocoon, ring, flash, scan, sparks]) {
      m.material.uniforms.uColor.value.copy(accent);
      if (m.material.uniforms.uTime) m.material.uniforms.uTime.value = t;
    }
    cocoon.material.uniforms.uAlpha.value = 0.85 * L.cocoon;
    cocoon.visible = L.cocoon > 0.002;
    const swell = 0.75 + 0.25 * L.cocoon + 0.03 * Math.sin(t * 17);
    cocoon.scale.set(2.6 * swell, 3.6 * swell, 2.3 * swell);
    ring.material.uniforms.uAlpha.value = 0.8 * L.ring;
    ring.visible = L.ring > 0.002;
    ring.scale.setScalar(L.ringR);
    flash.material.uniforms.uAlpha.value = L.flash;
    flash.visible = L.flash > 0.002;
    flash.scale.setScalar(0.5 + 2.5 * L.flash);
    scan.material.uniforms.uAlpha.value = 0.75 * L.scan;
    scan.visible = L.scan > 0.002;
    scan.position.y = L.scanY;
    sparkMat.uniforms.uAlpha.value = L.sparks;
    sparks.visible = L.sparks > 0.002;
    // the spirals tighten onto the body as it forms
    const pull = 1 - 0.55 * smooth(0.1, 0.8, f);
    seeds.forEach((p, i) => {
      const a = p.a + t * p.s;
      pos[i * 3] = Math.cos(a) * p.r * pull;
      pos[i * 3 + 1] = p.y + Math.sin(t * 2 + i) * 0.2;
      pos[i * 3 + 2] = Math.sin(a) * p.r * pull * 0.8;
    });
    geo.attributes.position.needsUpdate = true;
    if (camera) {
      const q = group.parent ? group.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : null;
      for (const m of [ring, flash]) {
        m.quaternion.copy(camera.quaternion);
        if (q) m.quaternion.premultiply(q);
      }
    }
  }

  return { group, update };
}
