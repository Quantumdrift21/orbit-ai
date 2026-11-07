// Orbit's 3D robot companion — "Modern Premium": brushed silver body, black glass face,
// glowing accent that changes with state. Same interface as the old Orb class:
//   new Robot(canvas); robot.setState(s); robot.levelSource = () => 0..1;
// plus robot.setLook(nx, ny), robot.bounce(), robot.nudge(dx, dy) for interaction.
import * as THREE from './vendor/three.module.min.js';

const STATE_COLORS = {
  idle: '#38d9ff',
  listening: '#3dffa8',
  thinking: '#a77bff',
  speaking: '#ffcf9e',
  error: '#ff4d5e',
};

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- procedural textures ----------
function canvasTexture(w, h, draw, srgb = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Horizontal streaks → brushed-metal roughness.
const brushedRoughness = () =>
  canvasTexture(1024, 512, (g, w, h) => {
    g.fillStyle = 'rgb(120,120,120)';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = Math.random() < 0.5 ? 70 : 190;
      g.fillStyle = `rgba(${v},${v},${v},${rand(0.04, 0.18)})`;
      g.fillRect(rand(-200, w), rand(0, h), rand(60, 400), rand(0.6, 1.6));
    }
  });

// Panel seams, vents and rivets (white = surface, dark = engraved). Used as bump + AO.
// Sphere UVs: u=0.25 faces the camera, v=0 is the top.
const panelDetail = () =>
  canvasTexture(2048, 1024, (g, w, h) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a3a3a';
    g.lineWidth = 5;
    const hline = (v) => {
      g.beginPath();
      g.moveTo(0, v * h);
      g.lineTo(w, v * h);
      g.stroke();
    };
    const vline = (u, v0, v1) => {
      g.beginPath();
      g.moveTo(u * w, v0 * h);
      g.lineTo(u * w, v1 * h);
      g.stroke();
    };
    hline(0.2);
    hline(0.79);
    for (const u of [0.02, 0.48, 0.62, 0.88]) vline(u, 0.2, 0.79);
    vline(0.25, 0, 0.2);
    vline(0.75, 0, 0.2);
    // rivets along the seams
    g.fillStyle = '#5a5a5a';
    for (let u = 0.01; u < 1; u += 0.03) {
      for (const v of [0.215, 0.775]) {
        g.beginPath();
        g.arc(u * w, v * h, 5, 0, TAU);
        g.fill();
      }
    }
    // top vents (front-top of the head)
    g.fillStyle = '#444';
    for (let i = 0; i < 7; i++) g.fillRect(w * (0.205 + i * 0.013), h * 0.1, w * 0.006, h * 0.06);
    for (let i = 0; i < 7; i++) g.fillRect(w * (0.705 + i * 0.013), h * 0.1, w * 0.006, h * 0.06);
  });

// Gaussian falloff (no visible edge) so the glow reads as light, not a disc.
const glowSprite = () =>
  canvasTexture(
    256,
    256,
    (g, w) => {
      const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      for (let i = 0; i <= 16; i++) {
        const d = i / 16;
        const a = Math.exp(-d * d * 7) * (1 - d); // reaches exactly 0 at the rim
        r.addColorStop(d, `rgba(255,255,255,${a.toFixed(4)})`);
      }
      g.fillStyle = r;
      g.fillRect(0, 0, w, w);
    },
    true,
  );

// Pure light: adds colour but never writes alpha, so it brightens whatever is behind the
// transparent window instead of laying a semi-opaque disc over it.
const lightBlend = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};

// ---------- skins ----------
// Leather: pebbled grain plus stitches beside the panel seams (bump: white = raised).
const leatherBump = () =>
  canvasTexture(2048, 1024, (g, w, h) => {
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) {
      const v = Math.random() < 0.55 ? 235 : 120;
      g.fillStyle = `rgba(${v},${v},${v},${rand(0.25, 0.6)})`;
      g.beginPath();
      g.ellipse(rand(0, w), rand(0, h), rand(3, 9), rand(2, 7), rand(0, 3), 0, TAU);
      g.fill();
    }
    for (const v of [0.2, 0.79]) {
      g.fillStyle = '#555';
      g.fillRect(0, v * h - 3, w, 6);
      g.fillStyle = '#fff';
      for (let u = 0; u < w; u += 22) {
        g.fillRect(u, v * h - 16, 12, 4);
        g.fillRect(u, v * h + 12, 12, 4);
      }
    }
  });

// Saddle-brown leather colour with cream thread on the stitches.
const leatherColor = () =>
  canvasTexture(
    2048,
    1024,
    (g, w, h) => {
      g.fillStyle = '#6a361b';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,18,6' : '140,82,45'},${rand(0.08, 0.2)})`;
        g.beginPath();
        g.ellipse(rand(0, w), rand(0, h), rand(4, 14), rand(3, 10), rand(0, 3), 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ecd7a8';
      for (const v of [0.2, 0.79]) {
        for (let u = 0; u < w; u += 22) {
          g.fillRect(u, v * h - 16, 12, 4);
          g.fillRect(u, v * h + 12, 12, 4);
        }
      }
    },
    true,
  );

// Holographic rainbow, repeated round the body so the front shows every colour.
const rainbow = () => {
  const t = canvasTexture(
    1024,
    256,
    (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      const stops = ['#ff3df2', '#7b5cff', '#2ee6ff', '#3dffa8', '#fff23d', '#ff8a3d', '#ff3df2'];
      stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      const v = g.createLinearGradient(0, 0, 0, h);
      v.addColorStop(0, 'rgba(255,255,255,0.35)');
      v.addColorStop(0.5, 'rgba(255,255,255,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = v;
      g.fillRect(0, 0, w, h);
    },
    true,
  );
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
};

// Made on first use, so unused skins cost nothing at startup.
const SKIN_TEXTURES = { brushed: brushedRoughness, detail: panelDetail, leatherBump, leatherColor, rainbow };

// Every skin is a few settings on the two shared materials: the shell (body, dials, arm-orbs)
// and the trim (bezel, antennas, rods). Strings name a texture above; anything unset uses BASE.
const BASE_SHELL = {
  color: 0xd2d6dd,
  map: null,
  metalness: 1,
  roughness: 0.42,
  roughnessMap: 'brushed',
  bumpMap: 'detail',
  bumpScale: 1.2,
  clearcoat: 0.35,
  clearcoatRoughness: 0.25,
  sheen: 0,
  iridescence: 0,
  envMapIntensity: 1,
};
const BASE_TRIM = {
  color: 0x2b2e34,
  metalness: 0.85,
  roughness: 0.32,
  clearcoat: 0.4,
  clearcoatRoughness: 0.3,
  iridescence: 0,
};
const SKINS = {
  metallic: { shell: {}, trim: {} },
  leather: {
    shell: {
      color: 0xffffff,
      map: 'leatherColor',
      metalness: 0,
      roughness: 0.5,
      roughnessMap: null,
      bumpMap: 'leatherBump',
      bumpScale: 2.2,
      clearcoat: 0.35,
      clearcoatRoughness: 0.4,
    },
    trim: { color: 0xc49a55, metalness: 1, roughness: 0.35 },
  },
  matte: {
    shell: {
      color: 0xefebe4,
      metalness: 0,
      roughness: 0.92,
      roughnessMap: null,
      bumpScale: 0.6,
      clearcoat: 0,
      envMapIntensity: 1.3,
    },
    trim: { color: 0x34373c, metalness: 0, roughness: 0.9, clearcoat: 0 },
  },
  velvet: {
    shell: {
      color: 0x2c0848,
      metalness: 0,
      roughness: 1,
      roughnessMap: null,
      bumpScale: 0.4,
      clearcoat: 0,
      sheen: 1,
      sheenColor: 0xff8fe3,
      sheenRoughness: 0.5,
      envMapIntensity: 0.7,
    },
    trim: { color: 0xd9aa4a, metalness: 1, roughness: 0.28 },
  },
  crazy: {
    shell: {
      color: 0xffffff,
      map: 'rainbow',
      metalness: 0.6,
      roughness: 0.18,
      roughnessMap: null,
      iridescence: 1,
      iridescenceIOR: 1.9,
      iridescenceThicknessRange: [150, 900],
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    },
    trim: { color: 0xf4f6fa, metalness: 1, roughness: 0.05, iridescence: 1, iridescenceIOR: 2.2 },
  },
};
export const SKIN_NAMES = Object.keys(SKINS);

function applyLook(m, look, cache) {
  for (const [k, v] of Object.entries(look)) {
    if (k === 'color' || k === 'sheenColor') m[k].set(v);
    else if (typeof v === 'string') m[k] = cache[v] ||= SKIN_TEXTURES[v]();
    else m[k] = v;
  }
  m.needsUpdate = true; // maps / sheen / iridescence change the shader
}

// Soft studio environment for reflections (no external HDR file needed).
function studioEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  s.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(12, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x6b7079, side: THREE.BackSide }),
    ),
  );
  const panel = (w, h, pos, intensity, color = 0xffffff) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(7, 2.2, [0, 5.5, 1.5], 4); // big top softbox
  panel(2.5, 5, [-5.5, 1, 2.5], 2.6); // key left
  panel(1.6, 5, [5.5, 0.5, -1], 1.6); // fill right
  panel(6, 1, [0, -5.5, 1], 0.35); // floor bounce
  panel(3, 3, [0, 1, -5.8], 1.4, 0xa9e6ff); // cool back rim
  panel(9, 6, [0, 0.5, 5.8], 1.15); // broad front fill (behind the camera)
  panel(9, 1.2, [0, -2.2, 5.6], 0.25); // darker band → horizon line in reflections
  const tex = pm.fromScene(s, 0.035).texture;
  pm.dispose();
  return tex;
}

// ---------- the robot ----------
export class Robot {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'idle';
    this.levelSource = () => 0;
    this.level = 0;
    this.t = 0;
    this.last = performance.now();

    // life
    this.accent = new THREE.Color(STATE_COLORS.idle);
    this.look = { x: 0, y: 0 };
    this.lookTarget = { x: 0, y: 0 };
    this.lastCursor = -1e9;
    this.nextWander = 0;
    this.nextFrame = 0; // frame cap (see #frame)
    this.blink = { next: rand(1.5, 4), until: 0 };
    this.squash = { x: 0, v: 0 };
    this.arm = { x: 0, v: 0 };
    this.happyUntil = 0;
    this.errorAt = -10;
    this.motion = { vx: 0, vy: 0, sleeping: false, event: null };

    this.#setupRenderer();
    this.#buildRobot();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    requestAnimationFrame(this.#frame);
  }

  // ----- public API -----
  setState(s) {
    const next = STATE_COLORS[s] ? s : 'idle';
    if (this.state === 'speaking' && next === 'idle') this.happyUntil = this.t + 1.8;
    if (next === 'error') this.errorAt = this.t;
    this.state = next;
  }

  /** Cursor position relative to the robot, roughly -1..1 (x right, y down). */
  setLook(nx, ny) {
    const moved = Math.abs(nx - this.lookTarget.x) + Math.abs(ny - this.lookTarget.y) > 0.01;
    if (!moved) return;
    this.lookTarget.x = clamp(nx, -1.2, 1.2);
    this.lookTarget.y = clamp(ny, -1, 1);
    this.lastCursor = this.t;
  }

  bounce() {
    this.squash.v -= 2.6;
    if (this.state === 'idle') this.happyUntil = this.t + 1.2;
  }

  /**
   * Flight info from the roaming brain: velocity (px/s), sleeping, events ('dodge' | 'wake'),
   * and trick: { name: 'spin' | 'flip' | 'roll' | 'loop', p: 0..1 } while a stunt is running.
   */
  setMotion(m) {
    if (m.event === 'wake' && this.motion.event !== 'wake') this.happyUntil = this.t + 1.6;
    if (m.event === 'dodge' && this.motion.event !== 'dodge') this.squash.v -= 1.5;
    this.motion = m;
  }

  /** Change the robot's look: 'metallic' | 'leather' | 'matte' | 'velvet' | 'crazy' (unknown → metallic). */
  setSkin(name) {
    const skin = SKINS[name] ? name : 'metallic';
    if (skin === this.skin) return;
    this.skin = skin;
    applyLook(this.shell, { ...BASE_SHELL, ...SKINS[skin].shell }, this.skinTextures);
    applyLook(this.trim, { ...BASE_TRIM, ...SKINS[skin].trim }, this.skinTextures);
  }

  /** Window was dragged by (dx, dy) px – let the arms swing. */
  nudge(dx, dy) {
    this.arm.v += clamp(dx * 0.02 + dy * 0.01, -1.5, 1.5);
  }

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ----- setup -----
  #setupRenderer() {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.environment = studioEnvironment(r);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    // Robot sits in the upper part of the window; captions/status live below it.
    this.camera.position.set(0, -0.55, 7.6);
    this.camera.lookAt(0, -0.55, 0);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-3, 4, 5);
    const rim = new THREE.DirectionalLight(0xbfe9ff, 1.2);
    rim.position.set(3, 2, -4);
    this.faceLight = new THREE.PointLight(this.accent, 1.2, 4, 2);
    this.faceLight.position.set(0, 0, 1.7);
    this.scene.add(key, rim, this.faceLight);
  }

  #buildRobot() {
    const glowTex = glowSprite();
    // Shell and trim are shared by every part, so a skin only restyles these two (see setSkin).
    this.skinTextures = { detail: panelDetail() };
    const silver = (this.shell = new THREE.MeshPhysicalMaterial({
      aoMap: this.skinTextures.detail,
      aoMapIntensity: 0.9,
    }));
    const graphite = (this.trim = new THREE.MeshPhysicalMaterial());
    this.setSkin('metallic');
    this.glowMats = []; // everything tinted with the accent colour
    const glowMat = (intensity) => {
      const m = new THREE.MeshStandardMaterial({
        color: 0x111111,
        emissive: this.accent.clone(),
        emissiveIntensity: intensity,
      });
      m.userData.base = intensity;
      this.glowMats.push(m);
      return m;
    };
    this.sprites = [];
    const sprite = (scale, opacity) => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: this.accent.clone(),
          transparent: true,
          opacity,
          depthWrite: false,
          ...lightBlend,
        }),
      );
      s.scale.setScalar(scale);
      s.userData.base = opacity;
      this.sprites.push(s);
      return s;
    };

    this.root = new THREE.Group(); // floats / bobs
    this.root.scale.setScalar(0.6); // miniature
    this.head = new THREE.Group(); // looks, leans, breathes
    this.root.add(this.head);
    this.scene.add(this.root);

    // halo behind the body
    this.halo = sprite(3.6, 0.12);
    this.halo.position.set(0, 0, -1.4);
    this.root.add(this.halo);

    // body
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), silver);
    this.head.add(body);

    // face: bezel + glass screen (spherical caps facing +z)
    const fw = 1.5,
      fh = 1.04,
      fc = Math.PI / 2 + 0.03;
    const cap = (r, w, h) => new THREE.SphereGeometry(r, 64, 48, Math.PI / 2 - w / 2, w, fc - h / 2, h);
    this.head.add(new THREE.Mesh(cap(1.012, fw + 0.14, fh + 0.14), graphite));

    this.faceCanvas = document.createElement('canvas');
    // Half-resolution face: plenty for a miniature robot and ~4x cheaper to redraw.
    this.faceCanvas.width = 256;
    this.faceCanvas.height = 178;
    this.fctx = this.faceCanvas.getContext('2d');
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      cap(1.022, fw, fh),
      new THREE.MeshPhysicalMaterial({
        color: 0x04060a,
        metalness: 0,
        roughness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        emissive: 0xffffff,
        emissiveMap: this.faceTex,
        emissiveIntensity: 1.7,
      }),
    );
    this.head.add(screen);

    // ear dials (with spinning knurled ring + glow ring)
    this.spinners = [];
    for (const side of [-1, 1]) {
      const dial = new THREE.Group();
      dial.position.set(side * 0.93, 0, 0);
      dial.rotation.z = (-side * Math.PI) / 2;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.16, 64), graphite);
      base.position.y = 0.06;
      const spinner = new THREE.Group();
      spinner.position.y = 0.17;
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.29, 0.09, 64), silver);
      spinner.add(disk);
      for (let i = 0; i < 18; i++) {
        const notch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.095, 0.05), graphite);
        const a = (i / 18) * TAU;
        notch.position.set(Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28);
        notch.rotation.y = -a;
        spinner.add(notch);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.016, 12, 64), glowMat(2.2));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.05;
      spinner.add(ring);
      dial.add(base, spinner);
      this.spinners.push(spinner);
      this.head.add(dial);
    }

    // antennas with glowing tips
    this.antennas = [];
    for (const side of [-1, 1]) {
      const ant = new THREE.Group();
      ant.position.set(side * 0.42, 0.82, -0.08);
      ant.rotation.z = -side * 0.34;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.032, 0.62, 16), graphite);
      rod.position.y = 0.31;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 16), glowMat(3));
      tip.position.y = 0.64;
      const tipGlow = sprite(0.42, 0.6);
      tipGlow.position.y = 0.64;
      ant.add(rod, tip, tipGlow);
      ant.userData.side = side;
      this.antennas.push(ant);
      this.head.add(ant);
    }

    // floating arm-orbs on rods
    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.12, -0.05, 0);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.4, 12), graphite);
      rod.rotation.z = Math.PI / 2;
      rod.position.x = side * 0.2;
      const joint = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 14), graphite);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 40, 28), silver);
      orb.position.x = side * 0.52;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 8, 48), glowMat(1.6));
      band.position.x = side * 0.52;
      band.rotation.y = Math.PI / 2;
      pivot.add(rod, joint, orb, band);
      pivot.userData.side = side;
      this.arms.push(pivot);
      this.head.add(pivot);
    }

    // hover base: neck + ring of glowing beads + downward glow
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.2, 48), graphite);
    neck.position.y = -1.0;
    this.head.add(neck);
    this.beads = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), glowMat(2));
      bead.position.set(Math.cos(a) * 0.33, -1.1, Math.sin(a) * 0.33);
      this.beads.push(bead);
      this.head.add(bead);
    }
    this.thruster = sprite(1.2, 0.4);
    this.thruster.position.set(0, -1.22, 0.15);
    this.head.add(this.thruster);
  }

  // ----- face -----
  #faceMode() {
    if (this.state === 'error') return 'error';
    if (this.state === 'thinking') return 'thinking';
    if (this.state === 'listening') return 'listening';
    if (this.state === 'speaking') return 'speaking';
    if (this.motion.trick) return 'happy';
    if (this.motion.event === 'dodge') return 'surprised';
    if (this.t < this.happyUntil) return 'happy';
    if (this.motion.sleeping) return 'sleepy';
    return 'idle';
  }

  #drawFace(open) {
    const g = this.fctx;
    // Draw in 512-wide design units; the transform maps them onto the half-size canvas.
    const W = 512;
    const H = 356;
    g.setTransform(this.faceCanvas.width / W, 0, 0, this.faceCanvas.height / H, 0, 0);
    const c = '#' + this.accent.getHexString();
    const t = this.t;
    const lvl = this.level;
    const mode = this.#faceMode();

    g.shadowBlur = 0;
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    // faint scanlines make it read as a screen
    g.globalAlpha = 0.06;
    g.fillStyle = c;
    for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
    g.globalAlpha = 1;

    g.shadowColor = c;
    g.shadowBlur = 13; // in canvas pixels (not scaled by the transform)
    g.fillStyle = c;
    g.strokeStyle = c;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    const lx = this.look.x * 40;
    const ly = this.look.y * 24;
    const eyes = [W * 0.34 + lx, W * 0.66 + lx];
    const ey = H * 0.42 + ly;

    for (const [i, ex] of eyes.entries()) {
      g.beginPath();
      if (mode === 'happy') {
        g.lineWidth = 15;
        g.arc(ex, ey + 16, 28, Math.PI * 1.15, Math.PI * 1.85);
        g.stroke();
      } else if (mode === 'thinking') {
        g.lineWidth = 13;
        const a = t * 5 + i * Math.PI;
        g.arc(ex, ey, 26, a, a + Math.PI * 1.25);
        g.stroke();
      } else if (mode === 'error') {
        g.lineWidth = 14;
        g.moveTo(ex - 22, ey - 22);
        g.lineTo(ex + 22, ey + 22);
        g.moveTo(ex + 22, ey - 22);
        g.lineTo(ex - 22, ey + 22);
        g.stroke();
      } else if (mode === 'sleepy') {
        g.lineWidth = 11;
        g.arc(ex, ey - 6, 26, Math.PI * 0.2, Math.PI * 0.8);
        g.stroke();
      } else if (mode === 'surprised') {
        g.lineWidth = 11;
        g.arc(ex, ey, 34, 0, TAU);
        g.stroke();
        g.beginPath();
        g.arc(ex, ey, 11, 0, TAU);
        g.fill();
      } else {
        const big = mode === 'listening' ? 1.15 : 1;
        const w = 58 * big;
        const h = Math.max(7, 80 * big * open);
        g.roundRect(ex - w / 2, ey - h / 2, w, h, Math.min(w, h) / 2);
        g.fill();
        if (h > 30) {
          // catch-light
          g.save();
          g.shadowBlur = 0;
          g.globalAlpha = 0.55;
          g.fillStyle = '#fff';
          g.beginPath();
          g.ellipse(ex - w * 0.18, ey - h * 0.22, 7, 10, -0.4, 0, TAU);
          g.fill();
          g.restore();
        }
      }
    }

    // mouth
    const mx = W / 2 + lx * 0.6;
    const my = H * 0.74 + ly * 0.6;
    g.beginPath();
    if (mode === 'speaking') {
      const h = 10 + lvl * 52;
      const w = 66 - lvl * 18;
      g.roundRect(mx - w / 2, my - h / 2, w, h, Math.min(w, h) / 2);
      g.fill();
    } else if (mode === 'listening') {
      for (let i = 0; i < 7; i++) {
        const h = 8 + lvl * 64 * (0.45 + 0.55 * Math.abs(Math.sin(t * 13 + i * 1.7)));
        g.roundRect(mx - 66 + i * 22 - 5, my - h / 2, 10, h, 5);
      }
      g.fill();
    } else if (mode === 'thinking') {
      for (let i = 0; i < 3; i++) {
        g.moveTo(mx - 26 + i * 26 + 8, my);
        g.arc(mx - 26 + i * 26, my, 6 + 3 * Math.sin(t * 6 - i * 0.9), 0, TAU);
      }
      g.fill();
    } else if (mode === 'error') {
      g.lineWidth = 9;
      g.moveTo(mx - 36, my);
      for (let i = 1; i <= 6; i++) g.lineTo(mx - 36 + i * 12, my + (i % 2 ? -8 : 8));
      g.stroke();
    } else if (mode === 'surprised') {
      g.lineWidth = 9;
      g.arc(mx, my, 14, 0, TAU);
      g.stroke();
    } else if (mode === 'sleepy') {
      g.lineWidth = 7;
      g.arc(mx, my, 9, 0, TAU);
      g.stroke();
      g.font = 'bold 40px Segoe UI, sans-serif';
      g.globalAlpha = 1 - ((t * 0.5) % 1);
      g.fillText('z', W * 0.78, H * 0.3 - ((t * 0.5) % 1) * 40);
      g.globalAlpha = 1;
    } else {
      const happy = mode === 'happy';
      g.lineWidth = happy ? 12 : 9;
      g.arc(mx, my - (happy ? 26 : 20), happy ? 38 : 28, Math.PI * 0.22, Math.PI * 0.78);
      g.stroke();
    }
    this.faceTex.needsUpdate = true;
  }

  // ----- animation loop -----
  // The loop always reschedules itself first, so one bad frame can never freeze the robot.
  // Frame cap: full 60 fps only while flying or talking; 30 when idle, 12 asleep (saves CPU/battery).
  #frame = (now) => {
    requestAnimationFrame(this.#frame);
    if (now < this.nextFrame) return;
    const m = this.motion;
    const fps =
      m.sleeping && this.state === 'idle'
        ? 12
        : this.state !== 'idle' || m.trick || Math.abs(m.vx) + Math.abs(m.vy) > 40
          ? 60
          : 30;
    this.nextFrame = now + 1000 / fps - 4;
    try {
      this.#step(now);
    } catch (e) {
      console.error('robot frame error', e);
    }
  };

  #step(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const t = this.t;
    const st = this.state;

    // audio level (fast attack, slow release)
    let raw = 0;
    try {
      raw = clamp(this.levelSource() || 0, 0, 1);
    } catch {
      /* source not ready yet */
    }
    this.level = raw > this.level ? lerp(this.level, raw, 0.55) : lerp(this.level, raw, 0.1);
    const lvl = this.level;
    const sleepy = this.#faceMode() === 'sleepy';

    // accent colour → all glowing parts
    // Crazy skin: the rainbow slides round the body and the idle glow cycles through colours.
    const crazy = this.skin === 'crazy';
    if (crazy) this.shell.map.offset.x = (t * 0.015) % 1;
    const glow = new THREE.Color(STATE_COLORS[st]);
    if (crazy && st === 'idle') glow.setHSL((t * 0.06) % 1, 0.95, 0.62);
    this.accent.lerp(glow, 0.07);
    const pulse = st === 'idle' ? 0.85 + 0.15 * Math.sin(t * 1.4) : 1 + lvl * 0.8;
    for (const m of this.glowMats) {
      m.emissive.copy(this.accent);
      m.emissiveIntensity = m.userData.base * pulse * (sleepy ? 0.5 : 1);
    }
    for (const s of this.sprites) {
      s.material.color.copy(this.accent);
      s.material.opacity = s.userData.base * pulse * (sleepy ? 0.5 : 1);
    }
    this.faceLight.color.copy(this.accent);
    this.faceLight.intensity = 1.0 + lvl * 1.5;

    // gaze: follow cursor, otherwise look around on its own
    if (t - this.lastCursor > 4 && t > this.nextWander) {
      this.lookTarget.x = rand(-0.45, 0.45);
      this.lookTarget.y = rand(-0.25, 0.3);
      this.nextWander = t + rand(1.8, 4.5);
    }
    const focus = st === 'listening' || st === 'speaking';
    let tx = focus ? this.lookTarget.x * 0.3 : this.lookTarget.x;
    let ty = focus ? this.lookTarget.y * 0.3 : this.lookTarget.y;
    // while flying, look where it's going
    const mv = this.motion;
    const speed = Math.hypot(mv.vx, mv.vy);
    if (speed > 50 && !focus) {
      tx = clamp(mv.vx / 260, -1, 1) * 0.9;
      ty = clamp(mv.vy / 260, -1, 1) * 0.5;
    }
    this.look.x = lerp(this.look.x, tx, 0.08);
    this.look.y = lerp(this.look.y, ty, 0.08);

    // breathing: slower inhale, longer exhale, slower when sleepy
    const period = sleepy ? 7 : st === 'thinking' ? 3 : 4.6;
    const p = (t % period) / period;
    const breath = p < 0.42 ? Math.sin(((p / 0.42) * Math.PI) / 2) : Math.cos((((p - 0.42) / 0.58) * Math.PI) / 2);

    // squash spring (click bounce)
    const s = this.squash;
    s.v += (-90 * s.x - 9 * s.v) * dt;
    s.x += s.v * dt;
    const k = 1 + breath * 0.018 + (st === 'listening' ? 0.04 : 0) + lvl * 0.03;
    this.head.scale.set(k * (1 - s.x * 0.5), k * (1 + s.x), k * (1 - s.x * 0.5));

    // pose
    const shake = t - this.errorAt < 0.7 ? Math.sin(t * 40) * 0.12 * (1 - (t - this.errorAt) / 0.7) : 0;
    const lean = st === 'listening' ? 0.16 : sleepy ? 0.14 : 0;
    const nod = st === 'speaking' ? lvl * 0.1 : 0;
    this.head.rotation.y = lerp(this.head.rotation.y, this.look.x * 0.55, 0.1) + shake;
    // flight: bank into turns, dip forward with speed
    const bank = clamp(-mv.vx / 650, -0.45, 0.45);
    const dive = clamp(mv.vy / 1100, -0.2, 0.25) + Math.min(0.15, speed / 1800);
    this.head.rotation.x = lerp(this.head.rotation.x, this.look.y * 0.32 + lean + nod + dive, 0.1);
    this.head.rotation.z = lerp(
      this.head.rotation.z,
      (st === 'thinking' ? 0.14 : 0) + Math.sin(t * 0.5) * 0.04 + bank,
      0.08,
    );
    this.root.position.y = Math.sin(t * 1.15) * 0.06 + breath * 0.03 + (sleepy ? -0.05 : 0);

    // stunts: the whole body turns around its centre, with a little hop
    const tr = mv.trick;
    if (tr) {
      const e = tr.p < 0.5 ? 4 * tr.p ** 3 : 1 - (-2 * tr.p + 2) ** 3 / 2;
      const hop = Math.sin(Math.PI * tr.p);
      this.root.rotation.set(
        tr.name === 'flip' || tr.name === 'loop' ? -e * TAU : 0,
        tr.name === 'spin' ? e * TAU : 0,
        tr.name === 'roll' ? -e * TAU : 0,
      );
      this.root.position.y += hop * (tr.name === 'loop' ? 0 : 0.28);
    } else {
      this.root.rotation.set(0, 0, 0);
    }

    // arms: spring sway + gentle float
    const a = this.arm;
    a.v += (-28 * a.x - 3.2 * a.v) * dt;
    a.x += a.v * dt;
    for (const arm of this.arms) {
      const side = arm.userData.side;
      const lift = st === 'listening' ? 0.25 : st === 'speaking' ? lvl * 0.35 : 0;
      const trail = clamp(mv.vx / 900, -0.5, 0.5) + clamp(-mv.vy / 1200, -0.3, 0.3) * side;
      arm.rotation.z = -side * (0.42 - lift + Math.sin(t * 1.3 + side) * 0.05) + a.x * 0.6 + trail;
      arm.rotation.y = Math.sin(t * 0.9 + side * 2) * 0.12;
    }

    // antennas perk up when listening, wobble with bounce/drag
    for (const ant of this.antennas) {
      const side = ant.userData.side;
      const perk = st === 'listening' ? 0.12 : sleepy ? -0.2 : 0;
      ant.rotation.z = -side * (0.34 - perk) + s.x * side * 0.6 + a.x * 0.25 + Math.sin(t * 2.1 + side) * 0.03;
    }

    // ear dials spin (fast while thinking)
    const spin = st === 'thinking' ? 4 : st === 'speaking' ? 1 + lvl * 3 : 0.3;
    this.spinners.forEach((sp, i) => {
      sp.rotation.y += dt * spin * (i ? 1 : -1);
    });

    // hover beads: travelling wave of light
    this.beads.forEach((b, i) => {
      b.material.emissiveIntensity =
        b.material.userData.base * (0.45 + 0.75 * Math.max(0, Math.sin(t * 3 - i * 0.55))) * pulse;
    });
    this.thruster.material.opacity =
      (0.3 + breath * 0.15 + lvl * 0.25) * (sleepy ? 0.5 : 1) * (1 + Math.min(1.5, speed / 200) + (tr ? 1.2 : 0));
    this.halo.material.opacity = (0.09 + breath * 0.05 + lvl * 0.1) * (sleepy ? 0.5 : 1);

    // blinking (with occasional double-blink)
    let open = 1;
    if (t > this.blink.next) {
      this.blink.until = t + 0.13;
      this.blink.next = t + (Math.random() < 0.2 ? 0.25 : rand(2.2, 6));
    }
    if (t < this.blink.until) open = 0.08;

    this.#drawFace(open);
    this.renderer.render(this.scene, this.camera);
  }
}
