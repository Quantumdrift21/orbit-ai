// Orbit's 3D robot companion — "Modern Premium": brushed silver body, black glass face,
// glowing accent that changes with state. Same interface as the old Orb class:
//   new Robot(canvas); robot.setState(s); robot.levelSource = () => 0..1;
// plus robot.setLook(nx, ny), robot.bounce(), robot.nudge(dx, dy) for interaction.
import * as THREE from './vendor/three.module.min.js';
import { buildMech } from './mech.js';
import { tuckedFlip, superheroLoop } from './flip.js';
import { defencePose, DEFENCE_SECS } from './defend.js';
import { createJet } from './jet.js';
import { spool, thrustDemand } from './jetPhysics.js';
import { attitude, depthScale } from './heading.js';
import { createJoints, kick, step, flinch } from './joints.js';
import { drawCard } from './faceCard.js';
import { createMorphFx } from './morphFx.js';
import { zero, stance, taunt, sleep, blend, TAUNTS } from './postures.js';

/** AeroStrike's pose for a running stunt: its body motion here, its limbs in mech.js. */
const stuntPose = (tr) =>
  tr.name === 'loop' ? { style: 'loop', ...superheroLoop(tr.p) } : { style: tr.name, ...tuckedFlip(tr.p) };

const STATE_COLORS = {
  idle: '#ff2e88',      // hot pink
  listening: '#00ffff', // cyan
  thinking: '#ff00ff',  // magenta
  speaking: '#ff6b00',  // orange
  error: '#ff0044',     // red-pink
};

// Moods (from the brain, see mood.js): resting face, idle glow tint and how fast it bobs.
// Calm uses the normal idle face, colour and speed.
const MOOD_FACES = { happy: 'smile', excited: 'excited', bored: 'bored', sleepy: 'drowsy', grumpy: 'grumpy' };
const MOOD_TINT = { happy: '#ffd66b', excited: '#ff5cf0', bored: '#7f9bb3', sleepy: '#6c7cff', grumpy: '#ff7a4d' };
const MOOD_BOB = { happy: 1.4, excited: 2, bored: 0.6, sleepy: 0.5, grumpy: 1.6 };

const DEFENCE_RED = new THREE.Color('#ff2414');

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
  color: 0x1a1c20,      // dark gunmetal
  map: null,
  metalness: 1,
  roughness: 0.15,      // very shiny
  roughnessMap: 'brushed',
  bumpMap: 'detail',
  bumpScale: 1.2,
  clearcoat: 0.5,
  clearcoatRoughness: 0.1,
  sheen: 0,
  iridescence: 0.3,
  envMapIntensity: 1.2,
};
const BASE_TRIM = {
  color: 0x0a0b0d,      // almost black
  metalness: 1,
  roughness: 0.1,
  clearcoat: 0.6,
  clearcoatRoughness: 0.08,
  iridescence: 0.5,
  iridescenceIOR: 2.0,
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
    this.card = null; // on the face screen: { card, start, until } (faceCard.js)
    this.tauntS = null; // AeroStrike showing attitude: { kind, start } (postures.js)
    this.nextTaunt = rand(45, 90);
    this.standS = 0; // relaxed standing stance, eased in when it hovers still
    this.sleepS = 0; // AeroStrike's sleeping posture, eased
    this.squash = { x: 0, v: 0 };
    this.arm = { x: 0, v: 0 };
    this.joints = createJoints(); // every joint's own follow-through spring (joints.js)
    this.dodgeAt = -10;
    this.happyUntil = 0;
    this.errorAt = -10;
    this.motion = { vx: 0, vy: 0, sleeping: false, event: null };
    this.def = null; // running defence move: { kind, side, start, nx, ny }
    this.guardS = 0; // fighting stance, eased in and out while defence mode is on

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
    if (m.event === 'dodge' && this.motion.event !== 'dodge') {
      this.squash.v -= 1.5;
      this.dodgeAt = this.t; // startle reflex (joints.js flinch)
    }
    // a change of speed kicks every joint, turned into the robot's own frame: flying side-on, a jerk
    // across the screen swings the limbs forward or back; facing you, it swings them sideways
    const dvx = (m.vx ?? 0) - (this.motion.vx ?? 0);
    const yaw = this.attitude?.yaw ?? 0;
    if (dvx) kick(this.joints, dvx * Math.cos(yaw), dvx * Math.sin(yaw));
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

  /**
   * AeroStrike fends off a click: 'block' | 'kick' | 'laser', at canvas position (nx, ny) in -1..1
   * (x right, y up). Returns false if it's mid-move (the first half of one can't be interrupted).
   */
  defend(kind, nx, ny) {
    if (!DEFENCE_SECS[kind]) return false;
    const d = this.def;
    if (d && (this.t - d.start) / DEFENCE_SECS[d.kind] < 0.55) return false;
    this.def = { kind, side: nx < 0 ? -1 : 1, start: this.t, nx: clamp(nx, -1, 1), ny: clamp(ny, -1, 1) };
    this.setLook(nx, -ny); // eyes on the threat
    return true;
  }

  /** Show a card (faceCard.js: icon, emoji, text) on the face screen for `secs`; null clears it. */
  showCard(card, secs = 6) {
    this.card = card ? { card, start: this.t, until: this.t + secs } : null;
  }

  /** AeroStrike taunts: 'beckon' | 'flex' | 'cross' (random if not given). False while it's busy. */
  taunt(kind) {
    if (!TAUNTS[kind]) kind = Object.keys(TAUNTS)[Math.floor(Math.random() * 3)];
    if (this.tauntS || this.def || this.motion.trick) return false;
    this.tauntS = { kind, start: this.t };
    return true;
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
    
    // Cyberpunk rim lights - magenta and cyan
    const rim1 = new THREE.DirectionalLight(0xff00ff, 1.8);
    rim1.position.set(4, 1, -3);
    const rim2 = new THREE.DirectionalLight(0x00ffff, 1.5);
    rim2.position.set(-4, 1, -3);
    const rim3 = new THREE.DirectionalLight(0xff2e88, 1.2);
    rim3.position.set(0, -3, -4);
    
    this.faceLight = new THREE.PointLight(this.accent, 1.2, 4, 2);
    this.faceLight.position.set(0, 0, 1.7);
    this.scene.add(key, rim1, rim2, rim3, this.faceLight);
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
        color: 0x080808,
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
    // turns the whole robot toward where it flies and scales it with depth (heading.js)
    this.flight = new THREE.Group();
    this.flight.rotation.order = 'YXZ'; // heading, then pitch, then bank — like a flyer
    this.flight.add(this.root);
    this.scene.add(this.flight);
    this.attitude = { yaw: 0, pitch: 0, roll: 0 };

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
        color: 0x000000,
        metalness: 0,
        roughness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        emissive: 0xffffff,
        emissiveMap: this.faceTex,
        emissiveIntensity: 2.0,
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
    // a small jet engine under Orbit (renderer/jet.js); its exhaust lives in the scene so it trails
    this.jet = createJet({ radius: 0.2, length: 1.6, particles: 90, exhaust: { speed: 4, size: 0.16 } });
    this.jet.flame.position.set(0, -1.18, 0);
    this.head.add(this.jet.flame);
    this.scene.add(this.jet.smoke);

    // AeroStrike, folded away until Orbit transforms (see mech.js)
    this.mech = buildMech({ shell: silver, trim: graphite, glowMat, sprite });
    this.root.add(this.mech.group);
    this.morphFx = createMorphFx(); // flash, shockwave, energy cocoon, sparks, scan line while transforming
    this.root.add(this.morphFx.group);
    for (const j of this.mech.jets) this.scene.add(j.smoke);

    // red laser from the chest core: a white-hot core line inside a red glow, a flare at the core
    // and a splash where it hits. Normal blending (writes alpha) so it shows over the desktop.
    const beamMat = (color, opacity) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
    const flare = (scale) => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xff2a1a,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      s.userData.scale = scale;
      return s;
    };
    const tube = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    this.laser = new THREE.Group();
    this.laser.userData.inner = new THREE.Mesh(tube, beamMat(0xffe2d6, 0.95));
    this.laser.userData.outer = new THREE.Mesh(tube, beamMat(0xff1a10, 0.35));
    this.laser.userData.muzzle = flare(1.1);
    this.laser.userData.splash = flare(0.9);
    this.laser.add(this.laser.userData.inner, this.laser.userData.outer);
    this.scene.add(this.laser, this.laser.userData.muzzle, this.laser.userData.splash);
    this.laser.visible = false;
    this.laser.userData.muzzle.visible = false;
    this.laser.userData.splash.visible = false;
  }

  /** Aim the laser from the chest core at canvas point (nx, ny); power 0 hides it. */
  #aimLaser(power, charge, nx, ny, t) {
    const { inner, outer, muzzle, splash } = this.laser.userData;
    const core = this.head.getWorldPosition(new THREE.Vector3());
    // the core glows red before it fires
    muzzle.visible = charge > 0.01;
    muzzle.position.copy(core).add(new THREE.Vector3(0, 0, 0.45));
    muzzle.scale.setScalar(muzzle.userData.scale * (0.4 + 0.8 * charge + 0.5 * power) * (1 + 0.1 * Math.sin(t * 60)));
    muzzle.material.opacity = Math.min(1, 0.3 + charge);
    this.laser.visible = splash.visible = power > 0.01;
    if (!this.laser.visible) return;
    // target: where the click's ray from the camera crosses a plane in front of the robot
    const ray = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const planeZ = 2.2;
    const end = this.camera.position.clone().add(ray.multiplyScalar((planeZ - this.camera.position.z) / ray.z));
    const start = core.clone().add(new THREE.Vector3(0, 0, 0.35));
    const dir = end.clone().sub(start);
    const len = dir.length();
    this.laser.position.copy(start).add(end).multiplyScalar(0.5);
    this.laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const flicker = 1 + 0.18 * Math.sin(t * 95) + 0.08 * Math.sin(t * 37);
    inner.scale.set(0.035 * power * flicker, len, 0.035 * power * flicker);
    outer.scale.set(0.11 * power * flicker, len, 0.11 * power * flicker);
    outer.material.opacity = 0.35 * power;
    splash.position.copy(end);
    splash.scale.setScalar(splash.userData.scale * power * flicker);
    splash.material.opacity = power;
  }

  // ----- face -----
  #faceMode() {
    if (this.state === 'error') return 'error';
    if (this.state === 'thinking') return 'thinking';
    if (this.state === 'listening') return 'listening';
    if (this.state === 'speaking') return 'speaking';
    if (this.motion.trick) return 'happy';
    if (this.motion.event === 'dodge' || this.motion.event === 'alert') return 'surprised';
    if (this.t < this.happyUntil) return 'happy';
    if (this.motion.sleeping) return 'sleepy';
    return MOOD_FACES[this.motion.mood] || 'idle';
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
    // a card (agent alert, or something you asked it to show) takes over the screen for a moment
    if (this.card && t > this.card.until) this.card = null;
    if (this.card) {
      drawCard(g, this.card.card, t - this.card.start, c, W, H);
      this.faceTex.needsUpdate = true;
      return;
    }
    g.fillStyle = c;
    g.strokeStyle = c;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // AeroStrike: the mech has its own head, so the chest screen turns into a power core (no second face)
    const form = this.motion.form ?? 0;
    if (form > 0.4) {
      const cx = W / 2;
      const cy = H / 2;
      g.globalAlpha = Math.min(1, (form - 0.4) / 0.2);
      g.lineWidth = 10;
      g.beginPath();
      g.arc(cx, cy, 120, 0, TAU);
      g.stroke();
      g.lineWidth = 14; // spinning segmented ring
      for (let i = 0; i < 6; i++) {
        const a = t * 1.5 + (i * TAU) / 6;
        g.beginPath();
        g.arc(cx, cy, 88, a, a + 0.7);
        g.stroke();
      }
      // core pulses, brighter when talking; asleep it glows dim and slow, with drifting z's
      const asleep = this.motion.sleeping;
      g.globalAlpha *= asleep ? 0.35 + 0.2 * Math.sin(t * 0.9) : Math.min(1, 0.75 + 0.25 * Math.sin(t * 3) + lvl * 0.4);
      if (asleep) {
        g.save();
        g.font = 'bold 54px Segoe UI, sans-serif';
        for (let i = 0; i < 2; i++) {
          const k = (t * 0.4 + i * 0.5) % 1;
          g.globalAlpha = 0.9 * (1 - k);
          g.fillText('z', cx + 70 + k * 60, cy - 60 - k * 70);
        }
        g.restore();
      }
      g.beginPath();
      g.arc(cx, cy, 44, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      this.faceTex.needsUpdate = true;
      return;
    }

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
        // Open eyes. Moods change their size and how far the lids are down.
        const big = mode === 'listening' ? 1.15 : mode === 'excited' ? 1.2 : 1;
        const lid = mode === 'bored' ? 0.4 : mode === 'drowsy' ? 0.3 : mode === 'grumpy' ? 0.6 : 1;
        const w = 58 * big;
        const h = Math.max(7, 80 * big * open * lid);
        const y = ey + (1 - lid) * 18; // lowered lids sit lower
        g.roundRect(ex - w / 2, y - h / 2, w, h, Math.min(w, h) / 2);
        g.fill();
        if (h > 30) {
          // catch-light
          g.save();
          g.shadowBlur = 0;
          g.globalAlpha = 0.55;
          g.fillStyle = '#fff';
          g.beginPath();
          g.ellipse(ex - w * 0.18, y - h * 0.22, 7, 10, -0.4, 0, TAU);
          g.fill();
          g.restore();
        }
        if (mode === 'grumpy') {
          // brow slanting down toward the nose
          const s = i ? -1 : 1;
          g.beginPath();
          g.lineWidth = 10;
          g.moveTo(ex - 32 * s, ey - 30);
          g.lineTo(ex + 28 * s, ey - 12);
          g.stroke();
        } else if (mode === 'excited') {
          // twinkling four-point sparkle by each eye
          const r = 9 + 4 * Math.sin(t * 6 + i * 2);
          const sx = ex + w * 0.5;
          const sy = y - h * 0.5;
          g.beginPath();
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * TAU;
            const rr = k % 2 ? r * 0.3 : r;
            g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
          }
          g.closePath();
          g.fill();
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
    } else if (mode === 'excited') {
      // open grin
      g.arc(mx, my - 14, 32, Math.PI * 0.08, Math.PI * 0.92);
      g.closePath();
      g.fill();
    } else if (mode === 'bored') {
      g.lineWidth = 9;
      g.moveTo(mx - 24, my);
      g.lineTo(mx + 24, my);
      g.stroke();
    } else if (mode === 'grumpy') {
      g.lineWidth = 9;
      g.arc(mx, my + 24, 26, Math.PI * 1.22, Math.PI * 1.78);
      g.stroke();
    } else if (mode === 'drowsy') {
      g.lineWidth = 7;
      g.arc(mx, my, 8, 0, TAU);
      g.stroke();
    } else {
      const happy = mode === 'happy' || mode === 'smile';
      g.lineWidth = happy ? 12 : 9;
      g.arc(mx, my - (happy ? 26 : 20), happy ? 38 : 28, Math.PI * 0.22, Math.PI * 0.78);
      g.stroke();
    }
    this.faceTex.needsUpdate = true;
  }

  // ----- animation loop -----
  // The loop always reschedules itself first, so one bad frame can never freeze the robot.
  // Frame cap: full 60 fps only while flying, talking or limbs swing; 30 when idle, 12 asleep (saves CPU/battery).
  #frame = (now) => {
    requestAnimationFrame(this.#frame);
    if (now < this.nextFrame) return;
    const m = this.motion;
    const fps =
      m.sleeping && this.state === 'idle'
        ? 12
        : this.state !== 'idle' ||
            m.trick ||
            this.def || // defence moves are fast: springs and laser flicker need every frame
            this.tauntS ||
            (m.form > 0 && m.form < 1) ||
            Math.abs(m.vx) + Math.abs(m.vy) > 40 ||
            Math.abs(this.joints.shoulderR.vx) + Math.abs(this.joints.wingR.vx) > 0.05 // limbs still swinging
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
    // Never negative: a frame's timestamp can be earlier than the moment the robot was built.
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
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

    // defence (AeroStrike only): a fighting stance while the mode is on, and the move it's doing
    const mechP = clamp(this.motion.form ?? 0, 0, 1);
    this.guardS = lerp(this.guardS, this.motion.defence && mechP > 0.9 ? 1 : 0, 1 - Math.exp(-dt * 5));
    let def = null;
    if (this.def) {
      const dp = (t - this.def.start) / DEFENCE_SECS[this.def.kind];
      if (dp >= 1 || mechP < 0.5) {
        this.def = null;
        if (mechP > 0.9 && Math.random() < 0.35) this.nextTaunt = t + 0.4; // sometimes a taunt after a fend-off
      } else def = { ...defencePose(this.def.kind, dp), side: this.def.side };
    }
    const red = def ? Math.max(def.charge, def.beam) : 0; // the core glows red as the laser charges

    // accent colour → all glowing parts
    // Crazy skin: the rainbow slides round the body and the idle glow cycles through colours.
    const crazy = this.skin === 'crazy';
    if (crazy) this.shell.map.offset.x = (t * 0.015) % 1;
    const glow = new THREE.Color(STATE_COLORS[st]);
    if (crazy && st === 'idle') glow.setHSL((t * 0.06) % 1, 0.95, 0.62);
    else if (st === 'idle' && MOOD_TINT[this.motion.mood])
      glow.lerp(new THREE.Color(MOOD_TINT[this.motion.mood]), 0.45);
    this.baseAccent ??= this.accent.clone();
    this.baseAccent.lerp(glow, 0.07);
    // on guard the glow runs a little hot; charging the laser turns it fully red
    this.accent.copy(this.baseAccent).lerp(DEFENCE_RED, Math.max(0.3 * this.guardS, red));
    const pulse = (st === 'idle' ? 0.85 + 0.15 * Math.sin(t * 1.4) : 1 + lvl * 0.8) * (1 + 1.4 * red);
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
    // AeroStrike: 0 = Orbit, 1 = transformed (progress from the brain); Orbit's body is the chest core
    const form = clamp(mv.form ?? 0, 0, 1);
    const k = (1 + breath * 0.018 + (st === 'listening' ? 0.04 : 0) + lvl * 0.03) * (1 - 0.08 * form);
    this.head.scale.set(k * (1 - s.x * 0.5), k * (1 + s.x), k * (1 - s.x * 0.5));

    // pose
    const shake = t - this.errorAt < 0.7 ? Math.sin(t * 40) * 0.12 * (1 - (t - this.errorAt) / 0.7) : 0;
    const lean = st === 'listening' ? 0.16 : sleepy ? 0.14 : 0;
    const nod = st === 'speaking' ? lvl * 0.1 : 0;
    // as a chest core it barely turns: the mech's own head does the looking
    this.head.rotation.y = lerp(this.head.rotation.y, this.look.x * 0.55 * (1 - 0.8 * form), 0.1) + shake;
    // flight: bank into turns, dip forward with speed
    const dive = clamp(mv.vy / 1100, -0.2, 0.25) + Math.min(0.15, speed / 1800);
    this.head.rotation.x = lerp(this.head.rotation.x, this.look.y * 0.32 + lean + nod + dive, 0.1);
    this.head.rotation.z = lerp(
      this.head.rotation.z,
      (st === 'thinking' ? 0.14 : 0) + Math.sin(t * 0.5) * 0.04, // banking is the flight group's job (heading.js)
      0.08,
    );
    // bob: a running phase, so a mood change alters the speed without a jump
    this.bobPhase = (this.bobPhase || 0) + dt * 1.15 * (MOOD_BOB[mv.mood] || 1);
    this.root.position.y = Math.sin(this.bobPhase) * 0.06 + breath * 0.03 + (sleepy ? -0.05 : 0);

    // stunts: the whole body turns around its centre, with a little hop
    const tr = mv.trick;
    // AeroStrike does its stunts like a person (renderer/flip.js; mech.js poses the limbs):
    // flip = backflip, roll = side flip, spin = a skater's jump spin, loop = superhero loop
    const pose = tr && form > 0.5 ? stuntPose(tr) : null;
    this.root.position.x = 0;
    this.root.position.z = 0;
    // the loop rolls about the body's own long axis (y first), then turns round the circle (z)
    this.root.rotation.order = pose?.style === 'loop' ? 'ZYX' : 'XYZ';
    if (pose) {
      // turn about the waist (the centre of mass), jump, and dip on crouch and landing
      const cy = -0.55; // waist height in the parent's units (root is scaled 0.6)
      const a = pose.angle;
      const [rx, ry, rz] = { flip: [-a, 0, 0], roll: [0, 0, -a], spin: [0, a, 0], loop: [0, 0, a] }[pose.style];
      this.root.rotation.set(rx, ry + (pose.bank ?? 0), rz);
      const tilt = rx || rz; // spins about the upright axis need no correction
      this.root.position.y += (pose.lift ?? 0) * 0.5 - (pose.crouch ?? 0) * 0.3 + cy - cy * Math.cos(tilt);
      this.root.position.x = rz ? cy * Math.sin(rz) : 0;
      this.root.position.z = rx ? -cy * Math.sin(rx) : 0;
    } else if (tr) {
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
    // follow-through: the body sways from its own spring, every limb lags on its own (joints.js)
    const J = step(this.joints, dt);
    const startle = flinch(this.t - this.dodgeAt);
    this.root.rotation.z -= J.spine.x;
    this.root.rotation.x += J.spine.z + 0.12 * startle * (1 - form);
    // flight attitude: face where it flies, all the way round (its back when AeroStrike flies into the
    // screen), bank into turns, lean into speed; face you for stunts, defence, talking and naps.
    // AeroStrike also flies into and out of the screen: perspective scale from the brain's depth.
    // AeroStrike's postures (postures.js): a relaxed stance when it hovers still, a taunt now and then,
    // and its own sleeping pose (it naps as AeroStrike too)
    const mech = clamp((form - 0.5) / 0.4, 0, 1);
    const ease = 1 - Math.exp(-dt * 3);
    this.sleepS = lerp(this.sleepS, mv.sleeping && form > 0.9 ? 1 : 0, ease * 0.6);
    if (this.tauntS && (t - this.tauntS.start > TAUNTS[this.tauntS.kind] || form < 0.9 || def || tr || mv.sleeping))
      this.tauntS = null;
    const calm = !tr && !def && this.guardS < 0.05 && speed < 60 && !mv.sleeping && !this.tauntS;
    this.standS = lerp(this.standS, calm ? 1 : 0, ease);
    if (calm && form > 0.95 && st === 'idle' && this.standS > 0.9 && t > this.nextTaunt) {
      this.taunt();
      this.nextTaunt = t + rand(45, 90);
    }
    let posture = null;
    if (mech > 0) {
      posture = blend(zero(), stance(t), this.standS * (1 - this.sleepS));
      if (this.tauntS) blend(posture, taunt(this.tauntS.kind, (t - this.tauntS.start) / TAUNTS[this.tauntS.kind]), 1);
      blend(posture, sleep(t), this.sleepS);
      if (mech < 1) posture = blend(zero(), posture, mech);
      this.root.rotation.x += posture.root.x;
      this.root.rotation.z += posture.root.z;
      this.root.position.y += posture.root.y;
    }
    const still = !!tr || !!def || this.guardS > 0.5 || st !== 'idle' || sleepy || !!this.tauntS;
    this.attitude = attitude(this.attitude, mv, dt, { lean: form, still });
    this.flight.rotation.set(this.attitude.pitch, this.attitude.yaw, this.attitude.roll);
    this.flight.scale.setScalar(depthScale(mv.depth)); // the brain only flies AeroStrike in depth
    this.renderer.toneMappingExposure = 1.05 - 0.22 * Math.min(1, Math.max(0, mv.depth ?? 0)); // distance haze
    // defence: a bladed stance on guard; in a move it turns to face the click, leans away from
    // the swinging leg / the hit, is pushed back by the impact and drops its weight to brace
    if (def || this.guardS > 0.001) {
      const g = this.guardS;
      const engage = def ? Math.max(def.guard, def.hip, def.open, def.flinch) : 0;
      this.root.rotation.y += (def?.side ?? 0) * 0.45 * engage + 0.18 * g;
      this.root.rotation.x -= (def ? def.lean + 0.22 * def.recoil : 0) - 0.05 * g;
      this.root.position.z -= def ? 0.12 * def.recoil : 0;
      this.root.position.y -= 0.04 * g + (def ? 0.22 * def.crouch + 0.06 * def.stance : 0);
    }

    // arms: spring sway + gentle float (folded away into the shoulders as Orbit transforms)
    const a = this.arm;
    a.v += (-28 * a.x - 3.2 * a.v) * dt;
    a.x += a.v * dt;
    const armsIn = 1 - clamp((form - 0.04) / 0.16, 0, 1);
    for (const arm of this.arms) {
      arm.scale.setScalar(Math.max(0.001, armsIn));
      arm.visible = armsIn > 0;
      const side = arm.userData.side;
      const lift = st === 'listening' ? 0.25 : st === 'speaking' ? lvl * 0.35 : 0;
      const trail = clamp(mv.vx / 900, -0.5, 0.5) + clamp(-mv.vy / 1200, -0.3, 0.3) * side;
      const sh = J[side < 0 ? 'shoulderR' : 'shoulderL'];
      // its own lag on top; a startled Orbit throws its arms up
      arm.rotation.z =
        -side * (0.42 - lift - 0.9 * startle + Math.sin(t * 1.3 + side) * 0.05) + a.x * 0.6 + trail + sh.x * 0.5;
      arm.rotation.y = Math.sin(t * 0.9 + side * 2) * 0.12 - side * sh.z;
    }

    // antennas perk up when listening, wobble with bounce/drag
    // ...and climb onto the mech's head as it rises out of the chest
    const antUp = clamp((form - 0.55) / 0.25, 0, 1);
    for (const ant of this.antennas) {
      const side = ant.userData.side;
      ant.userData.home ??= ant.position.clone();
      const home = ant.userData.home;
      ant.position.set(lerp(home.x, side * 0.3, antUp), lerp(home.y, 2.4, antUp), lerp(home.z, -0.05, antUp));
      const perk = st === 'listening' ? 0.12 : sleepy ? -0.2 : 0;
      const aj = J[side < 0 ? 'antR' : 'antL'];
      ant.rotation.z =
        -side * (0.34 - perk + 0.3 * startle) + s.x * side * 0.6 + a.x * 0.25 + Math.sin(t * 2.1 + side) * 0.03 - aj.x;
      ant.rotation.x = aj.z - 0.4 * startle; // swept back by the flinch
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
    // AeroStrike parts unfold, then live on top of that pose
    this.mech.setMorph(form);
    this.morphFx.update(form, t, this.accent, this.camera);
    this.mech.update(t, dt, {
      lookX: this.look.x,
      lookY: this.look.y,
      vx: mv.vx,
      vy: mv.vy,
      level: lvl,
      pose,
      guard: this.guardS,
      def,
      posture,
      joints: J,
      flinch: startle,
    });

    // camera: Orbit keeps its on-screen size in any window; the mech is framed whole as it grows
    const h = this.canvas.clientHeight || 230;
    const zoom = form < 0.5 ? 4 * form ** 3 : 1 - (-2 * form + 2) ** 3 / 2;
    const camY = lerp(-0.55 * (h / 230), -1.0, zoom);
    this.camera.position.set(0, camY, lerp(7.6 * (h / 230), 14, zoom));
    this.camera.lookAt(0, camY, 0);

    // jet engines (jetPhysics.js): the throttle spools toward what the flight needs; the exhaust is
    // moved back by the window's own motion, so it stays on the desktop and trails behind
    const fovT = Math.tan((this.camera.fov * Math.PI) / 360);
    const perPx = (2 * this.camera.position.z * fovT) / h; // world units per screen px at the robot
    const lift = (pose?.lift ?? 0) + (tr && !pose ? 0.5 * Math.sin(Math.PI * tr.p) : 0);
    this.engine = spool(
      this.engine ?? { throttle: 0.3, pop: 0 },
      thrustDemand({ speed, vy: mv.vy, lift, recoil: def?.recoil ?? 0, idle: sleepy ? 0.15 : 0.3 }),
      dt,
    );
    const engine = {
      ...this.engine,
      shift: [-(mv.vx || 0) * dt * perPx, (mv.vy || 0) * dt * perPx, 0],
      pxScale: (h * this.renderer.getPixelRatio()) / (2 * fovT),
    };
    this.jet.update(dt, t, { ...engine, opacity: (1 - form) * (sleepy ? 0.6 : 1) }); // the mech uses its own
    const packOut = clamp((form - 0.6) / 0.3, 0, 1); // backpack deployed
    for (const j of this.mech.jets) j.update(dt, t, { ...engine, opacity: packOut });
    this.halo.material.opacity = (0.09 + breath * 0.05 + lvl * 0.1) * (sleepy ? 0.5 : 1);

    // blinking (with occasional double-blink)
    let open = 1;
    if (t > this.blink.next) {
      this.blink.until = t + 0.13;
      this.blink.next = t + (Math.random() < 0.2 ? 0.25 : rand(2.2, 6));
    }
    if (t < this.blink.until) open = 0.08;

    this.#drawFace(open);
    if (def || this.laser.visible || this.laser.userData.muzzle.visible) {
      // the laser needs this frame's core position (render() would only update it afterwards)
      this.scene.updateMatrixWorld();
      this.camera.updateMatrixWorld();
      this.#aimLaser(def?.beam ?? 0, def?.charge ?? 0, this.def?.nx ?? 0, this.def?.ny ?? 0, t);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
