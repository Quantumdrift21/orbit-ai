// Orbit's autonomous behaviour (main process): roams the screen, dodges a fast-moving mouse,
// lets a slow hand "catch" it, naps when nobody needs it, and follows a daily rhythm.
const { screen } = require('electron');
const moods = require('./mood');

const now = () => performance.now() / 1000;
// Clickable area around the robot's centre (px, half-width / half-height) – body plus arm-orbs.
const HIT = { x: 68, y: 58 };
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function daypart(d = new Date()) {
  const h = d.getHours();
  if (h >= 6 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

// How lively Orbit is at each time of day (seconds / px per second; trick = chance of a stunt
// when it arrives somewhere).
const RHYTHM = {
  morning: { journey: 0.6, speed: 230, rest: [4, 10], sleepAfter: 240, nap: [90, 240], trick: 0.35 },
  afternoon: { journey: 0.45, speed: 190, rest: [6, 16], sleepAfter: 180, nap: [120, 360], trick: 0.25 },
  evening: { journey: 0.3, speed: 150, rest: [8, 22], sleepAfter: 150, nap: [180, 480], trick: 0.15 },
  night: { journey: 0.12, speed: 110, rest: [10, 30], sleepAfter: 60, nap: [900, 3600], trick: 0 },
};

// Flying stunts (seconds). The robot page draws the body's spin from the progress we send it;
// 'loop' also flies the window around a circle so the whole robot does a loop-the-loop.
const STUNT_SECS = { spin: 1.1, flip: 1.0, roll: 1.2, loop: 1.8 };
const STUNTS = Object.keys(STUNT_SECS);
const LOOP_RADIUS = 70; // px
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

class Brain {
  /**
   * @param {Electron.BrowserWindow} win
   * @param {{x:number,y:number}} anchor  robot centre inside the window (px)
   */
  constructor(win, anchor) {
    this.win = win;
    this.anchor = anchor;
    const [x, y] = win.getPosition();
    this.pos = { x, y };
    // setPosition() on scaled displays slowly grows the window (Electron bug) – always
    // move with setBounds() and this fixed size instead.
    const [w, h] = win.getContentSize();
    this.size = { width: w, height: h };
    this.vel = { x: 0, y: 0 };
    this.mode = 'rest';
    this.until = now() + rand(3, 6);
    this.enabled = true;
    this.busy = false; // in a conversation
    this.pausedUntil = 0; // after the user drags it somewhere
    this.lastInteraction = now();
    this.cursorPrev = null;
    this.cursorSpeed = 0;
    this.home = null; // where it naps (last place the user put it)
    this.event = null;
    this.eventUntil = 0;
    this.day = new Date().toDateString();
    this.feelings = moods.freshScores(); // see mood.js
    this.mood = 'calm';
    this.lastT = now();
    this.timer = setInterval(() => this.tick(), 16);
  }

  // ----- inputs from the app -----
  setEnabled(on) {
    this.enabled = on;
    this.syncPos();
  }
  setBusy(on) {
    this.busy = on;
    if (on) {
      this.feel('talk');
      this.interact();
    }
  }
  interact() {
    this.lastInteraction = now();
    this.feel('attention');
    if (this.mode === 'sleep' || this.mode === 'toBed') this.wake();
  }
  onUserMove() {
    this.syncPos();
    this.vel = { x: 0, y: 0 };
    this.pausedUntil = now() + 12;
    this.home = this.center();
    this.lastInteraction = now();
    if (this.mode !== 'rest') {
      this.mode = 'rest';
      this.until = now() + 8;
    }
  }
  sleepNow() {
    this.goToBed();
  }
  wake() {
    this.mode = 'rest';
    this.until = now() + rand(3, 6);
    this.flash('wake', 1.5);
  }
  /**
   * Do a flying stunt: 'spin' | 'flip' | 'roll' | 'loop'. Ignored mid-stunt or while dragged.
   * Only tricks the user asked for excite Orbit; its own random tricks don't, or excitement
   * (which makes tricks more likely) would feed itself.
   */
  stunt(name, byUser = false) {
    if (!STUNTS.includes(name) || this.trick || this.dragging) return;
    if (this.mode === 'sleep' || this.mode === 'toBed') this.wake();
    this.trick = { name, start: now(), dur: STUNT_SECS[name], origin: { ...this.pos } };
    if (byUser) this.feel('trick');
  }
  /** A mood event: 'talk' | 'attention' | 'trick' | 'morning' | 'dodge' (amount = seconds). */
  feel(event, amount = 1) {
    this.feelings = moods.bump(this.feelings, event, amount);
  }
  destroy() {
    clearInterval(this.timer);
  }

  // ----- helpers -----
  syncPos() {
    if (this.win.isDestroyed()) return;
    const [x, y] = this.win.getPosition();
    this.pos = { x, y };
  }
  center() {
    return { x: this.pos.x + this.anchor.x, y: this.pos.y + this.anchor.y };
  }
  workArea() {
    const c = this.center();
    return screen.getDisplayNearestPoint({ x: Math.round(c.x), y: Math.round(c.y) }).workArea;
  }
  flash(event, secs) {
    this.event = event;
    this.eventUntil = now() + secs;
  }

  decide(rhythm) {
    const wa = this.workArea();
    if (Math.random() < rhythm.journey) {
      // a little journey somewhere on screen
      const c = this.center();
      for (let i = 0; i < 8; i++) {
        const tx = rand(wa.x + 90, wa.x + wa.width - 90);
        const ty = rand(wa.y + 90, wa.y + wa.height - 110);
        const d = Math.hypot(tx - c.x, ty - c.y);
        if (d > 180 && d < 900) {
          this.target = { x: tx, y: ty };
          break;
        }
        this.target = { x: tx, y: ty };
      }
      this.speed = rhythm.speed * rand(0.75, 1.25) * moods.EFFECTS[this.mood].speed;
      this.mode = 'journey';
    } else {
      this.mode = 'rest';
      this.until = now() + rand(...rhythm.rest);
    }
  }

  goToBed() {
    const wa = this.workArea();
    this.target = this.home || { x: wa.x + wa.width - 110, y: wa.y + wa.height - 120 };
    this.mode = 'toBed';
  }

  // ----- main loop -----
  tick() {
    if (this.win.isDestroyed()) return this.destroy();
    const t = now();
    const dt = Math.min(0.05, t - this.lastT);
    this.lastT = t;
    if (dt <= 0) return;

    const rhythm = RHYTHM[daypart()];
    const today = new Date().toDateString();
    if (today !== this.day) {
      this.day = today;
      this.flash('wake', 2);
      this.feel('morning');
    } // new day greeting

    // Mood: feelings fade over time, and the mood scales the day's rhythm (mood.js).
    this.feelings = moods.decay(this.feelings, dt);
    this.mood = moods.pick(this.feelings, { idleSecs: t - this.lastInteraction, night: daypart() === 'night' });
    const fx = moods.EFFECTS[this.mood];
    const sleepAfter = rhythm.sleepAfter * fx.nap;

    // cursor speed (smoothed)
    const m = screen.getCursorScreenPoint();
    if (this.cursorPrev) {
      const sp = Math.hypot(m.x - this.cursorPrev.x, m.y - this.cursorPrev.y) / dt;
      this.cursorSpeed = this.cursorSpeed * 0.75 + sp * 0.25;
    }
    this.cursorPrev = m;

    const c = this.center();
    const dx = c.x - m.x;
    const dy = c.y - m.y;
    const dist = Math.hypot(dx, dy) || 1;
    const frozen = !this.enabled || this.busy || t < this.pausedUntil || this.dragging;

    let desired = { x: 0, y: 0 };
    let steer = 2.2;

    let trick = null; // progress sent to the robot page
    if (this.trick && this.dragging) this.trick = null;
    if (this.trick) {
      // A stunt runs even mid-conversation (Gemini can ask for one); nothing else steers meanwhile.
      const p = (t - this.trick.start) / this.trick.dur;
      steer = 6;
      if (p >= 1) {
        this.trick = null;
      } else {
        trick = { name: this.trick.name, p: +p.toFixed(3) };
        if (this.trick.name === 'loop') {
          const a = easeInOut(p) * Math.PI * 2;
          const o = this.trick.origin;
          const gx = o.x + Math.sin(a) * LOOP_RADIUS;
          const gy = o.y - (1 - Math.cos(a)) * LOOP_RADIUS;
          desired = { x: (gx - this.pos.x) / dt, y: (gy - this.pos.y) / dt };
          steer = 1e9; // follow the circle exactly
        }
      }
    } else if (frozen) {
      steer = 6;
      // Roam off but nobody talking/dragging: it can't fly, so it naps (and wakes) in place.
      const parked = !this.enabled && !this.busy && !this.dragging && t >= this.pausedUntil;
      const napDue = this.mode === 'toBed' || (this.mode !== 'sleep' && t - this.lastInteraction > sleepAfter);
      if (parked && napDue) {
        this.mode = 'sleep';
        this.until = t + rand(...rhythm.nap);
      } else if (this.mode === 'journey' || this.mode === 'toBed') {
        this.mode = 'rest';
        this.until = t + 5;
      }
      if (parked && this.mode === 'sleep' && t > this.until && daypart() !== 'night') {
        this.lastInteraction = t;
        this.wake();
      }
    } else {
      if (this.mode !== 'sleep' && this.mode !== 'toBed' && t - this.lastInteraction > sleepAfter) this.goToBed();

      switch (this.mode) {
        case 'rest':
          desired = { x: Math.sin(t * 0.7) * 10, y: Math.sin(t * 1.1) * 7 };
          if (t > this.until) this.decide(rhythm);
          break;
        case 'journey':
        case 'toBed': {
          const tx = this.target.x - c.x;
          const ty = this.target.y - c.y;
          const d = Math.hypot(tx, ty) || 1;
          const sp = (this.mode === 'toBed' ? rhythm.speed * 0.7 : this.speed) * Math.min(1, d / 140);
          desired = { x: (tx / d) * sp, y: (ty / d) * sp };
          const wob = Math.sin(t * 2.3) * 35 * Math.min(1, d / 140); // organic, curvy flight
          desired.x += (-ty / d) * wob;
          desired.y += (tx / d) * wob;
          if (d < 12) {
            if (this.mode === 'toBed') {
              this.mode = 'sleep';
              this.until = t + rand(...rhythm.nap);
            } else {
              this.mode = 'rest';
              this.until = t + rand(...rhythm.rest);
              if (Math.random() < rhythm.trick * fx.trick)
                this.stunt(STUNTS[Math.floor(Math.random() * STUNTS.length)]);
            }
          }
          break;
        }
        case 'sleep':
          desired = { x: 0, y: Math.sin(t * 0.5) * 3 };
          if (t > this.until && daypart() !== 'night') {
            this.lastInteraction = t;
            this.wake();
          }
          break;
      }

      // Mouse: a fast swipe makes it dodge; a slow approach lets you catch it.
      if (this.mode !== 'sleep' && dist < 160) {
        if (this.cursorSpeed > 650) {
          const f = (160 - dist) / 160;
          desired.x += (dx / dist) * 1100 * f;
          desired.y += (dy / dist) * 1100 * f;
          steer = 9;
          this.flash('dodge', 0.9);
          this.feel('dodge', dt);
          if (this.mode === 'rest') this.until = Math.max(this.until, t + 2);
        } else if (dist < 100) {
          desired.x *= 0.1;
          desired.y *= 0.1;
          steer = 5;
        }
      }
    }

    // steer + integrate
    const k = Math.min(1, steer * dt);
    this.vel.x += (desired.x - this.vel.x) * k;
    this.vel.y += (desired.y - this.vel.y) * k;
    if (!this.dragging) {
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;

      // keep the robot body on screen (soft bounce off edges)
      const wa = this.workArea();
      const minX = wa.x + 60 - this.anchor.x;
      const maxX = wa.x + wa.width - 60 - this.anchor.x;
      const minY = wa.y + 60 - this.anchor.y;
      const maxY = wa.y + wa.height - 70 - this.anchor.y;
      if (this.pos.x < minX || this.pos.x > maxX) this.vel.x *= -0.5;
      if (this.pos.y < minY || this.pos.y > maxY) this.vel.y *= -0.5;
      this.pos.x = clamp(this.pos.x, minX, maxX);
      this.pos.y = clamp(this.pos.y, minY, maxY);

      const [wx, wy] = this.win.getPosition();
      const nx = Math.round(this.pos.x);
      const ny = Math.round(this.pos.y);
      if (nx !== wx || ny !== wy) this.win.setBounds({ x: nx, y: ny, ...this.size });
    }

    // Click-through: only the robot itself catches the mouse. Checked here (not on mousemove in
    // the page) because the window often moves under a cursor that is standing still.
    const nc = this.center();
    const hx = (m.x - nc.x) / HIT.x;
    const hy = (m.y - nc.y) / HIT.y;
    const over = this.dragging || hx * hx + hy * hy < 1;
    if (over !== this.over) {
      this.over = over;
      this.win.setIgnoreMouseEvents(!over, { forward: true });
    }

    // tell the robot how it is moving so it can bank, trail its arms, look and pick a face
    if (t > this.eventUntil) this.event = null;
    this.win.webContents.send('motion', {
      vx: Math.round(this.vel.x),
      vy: Math.round(this.vel.y),
      mode: this.mode,
      sleeping: this.mode === 'sleep',
      event: this.event,
      trick,
      mood: this.mood,
      hover: over,
      look: { x: +((m.x - nc.x) / 500).toFixed(3), y: +((m.y - nc.y) / 500).toFixed(3) },
    });
  }
}

module.exports = { Brain, STUNTS };
