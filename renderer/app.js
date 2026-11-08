import { Robot, SKIN_NAMES } from './robot.js';
import { Mic, Player } from './audio.js';
import { GeminiLive } from './gemini.js';
import { languageRule } from './languages.js';
import { playTransform, playDefend } from './sfx.js';
import { DEFENCES, DEFENCE_SECS } from './defend.js';

const canvas = document.getElementById('orb');
const statusEl = document.getElementById('status');
const captionEl = document.getElementById('caption');

const orb = new Robot(canvas);
const mic = new Mic();
const player = new Player();

let cfg = await window.orbit.getConfig();
let live = null;
let state = 'idle';
let busy = false;
let turnDone = false;
let replyText = '';
let userText = '';
let silenceTimer = null;
let thinkTimer = null;
let captionTimer = null;

const UNCLEAR_RULE =
  'If the user audio is silent, noisy or unclear, just say briefly that you could not hear them and ask them to repeat.';

const TRICKS = { spin: 'spin around', flip: 'backflip', roll: 'barrel roll', loop: 'loop-the-loop' };

// Orbit's mood (sent by the brain) colours its tone for the conversation it starts in.
let mood = 'calm';
const MOOD_LINES = {
  happy: 'MOOD: You are in a happy, cheerful mood right now; let it show warmly.',
  excited: 'MOOD: You are excited and full of energy right now; be lively, but still brief.',
  bored: 'MOOD: You were a bit bored before the user spoke; be glad of the company and playful about it.',
  sleepy: 'MOOD: You are a little sleepy right now; be gentle and calm, maybe a tiny yawn.',
  grumpy:
    'MOOD: You are mildly grumpy because the user kept swiping the mouse at you. Be playfully cheeky about it in ' +
    'one short line, never rude, and still help fully.',
};

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'open_app',
        description:
          "Open an app installed on the user's Windows PC, by the name the user said (e.g. Spotify, Blender, " +
          'Calculator). If the result has "suggestions", ask the user which one they meant.',
        parameters: {
          type: 'OBJECT',
          properties: { app: { type: 'STRING', description: 'App name as the user said it' } },
          required: ['app'],
        },
      },
      {
        name: 'do_trick',
        description:
          'Make your little robot body do a flying stunt, when the user asks for a trick, spin, flip or loop, ' +
          'or to celebrate. Say something playful while doing it.',
        parameters: {
          type: 'OBJECT',
          properties: {
            trick: {
              type: 'STRING',
              enum: Object.keys(TRICKS),
              description: Object.entries(TRICKS)
                .map(([k, v]) => `${k} = ${v}`)
                .join(', '),
            },
          },
          required: ['trick'],
        },
      },
      {
        name: 'transform',
        description:
          'Transform your robot body: into AeroStrike, an aerial combat mech with wings ("transform", "suit up", ' +
          '"battle mode"), or back into small Orbit ("fold back", "go small").',
        parameters: {
          type: 'OBJECT',
          properties: { form: { type: 'STRING', enum: ['aerostrike', 'orbit'] } },
          required: ['form'],
        },
      },
      {
        name: 'defence_mode',
        description:
          'Turn AeroStrike defence mode on or off ("defence mode", "guard yourself", "defend", "stand down"). ' +
          'On: you transform into AeroStrike if needed, take a fighting stance and fend off every mouse click ' +
          'with a block, a kick or a red laser from your core. The user right-clicks you to turn it off.',
        parameters: {
          type: 'OBJECT',
          properties: { on: { type: 'BOOLEAN' } },
          required: ['on'],
        },
      },
      {
        name: 'change_skin',
        description:
          "Change your robot body's skin when the user asks: metallic (brushed silver), leather (stitched brown), " +
          'matte (soft vinyl), velvet (purple with gold) or crazy (holographic rainbow).',
        parameters: {
          type: 'OBJECT',
          properties: { skin: { type: 'STRING', enum: SKIN_NAMES } },
          required: ['skin'],
        },
      },
      {
        name: 'open_website',
        description:
          'Open a web page in a browser. For "open YouTube" use https://www.youtube.com; for searches use ' +
          'https://www.google.com/search?q=<query> or https://www.youtube.com/results?search_query=<query>.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'Full http(s) URL' },
            browser: {
              type: 'STRING',
              enum: ['default', 'chrome', 'edge', 'brave'],
              description: 'Browser the user asked for, else default',
            },
          },
          required: ['url'],
        },
      },
    ],
  },
];

const ACTION_RULE =
  'PC ACTIONS: You can open apps (open_app) and websites (open_website), do flying tricks (do_trick), transform into AeroStrike (transform), switch defence mode (defence_mode) and ' +
  'change your skin (change_skin). ' +
  'Only say something was opened after the tool returns ok:true; if it fails, say so. ' +
  'If the result has a "note", tell the user that note briefly. ' +
  'You cannot do any other actions on the PC (no typing, clicking, files, or settings changes) – say so honestly if asked.';

// Only offered when Orbit watches at least one AI agent. Gemini can read a filtered summary on
// request, but can never approve or deny an agent's requests (only the card's buttons can).
const AGENT_FLAGS = ['watchClaude', 'watchCodex', 'watchCopilot', 'watchOpencode', 'watchAntigravity', 'watchHermes'];
const watchingAgents = () => AGENT_FLAGS.some((f) => cfg[f]);
const AGENT_TOOL = {
  name: 'agent_status',
  description:
    'Only when the user asks what their AI coding agents (Claude Code, Codex, Copilot, OpenCode, Antigravity, ' +
    'Hermes) are doing or whether they finished: returns a short summary of recent activity on this PC.',
  parameters: { type: 'OBJECT', properties: {} },
};
const AGENT_RULE =
  'AI AGENTS: Use agent_status when asked about Claude Code or other coding agents. You cannot approve or deny ' +
  "their requests; tell the user to click Allow or Deny on Orbit's card.";

const sessionConfig = () => ({
  ...cfg,
  tools: watchingAgents() ? [{ functionDeclarations: [...TOOLS[0].functionDeclarations, AGENT_TOOL] }] : TOOLS,
  systemPrompt:
    `${cfg.systemPrompt}\n\n${languageRule(cfg.language, cfg.language2)}\n${UNCLEAR_RULE}\n\n${ACTION_RULE}` +
    (MOOD_LINES[mood] ? `\n\n${MOOD_LINES[mood]}` : '') +
    (watchingAgents() ? `\n\n${AGENT_RULE}` : ''),
});

// ---------- Claude Code alerts: caption + Windows' offline voice (nothing goes to Google) ----------
const claudeQueue = [];
let claudeCaptionTimer = null;
const localVoice = () => {
  const voices = speechSynthesis.getVoices().filter((v) => v.localService);
  return voices.find((v) => /^en/i.test(v.lang)) || voices[0];
};
speechSynthesis.getVoices(); // starts loading the voice list

function sayLocally(text) {
  if (!text) return;
  if (state !== 'idle') {
    // Never talk over a Gemini conversation; play it once Orbit is idle again.
    if (claudeQueue.length < 5) claudeQueue.push(text);
    return;
  }
  const voice = localVoice();
  if (!voice) {
    // Windows voices may still be loading on the first alert: try once more when they arrive.
    if (!speechSynthesis.getVoices().length)
      speechSynthesis.addEventListener('voiceschanged', () => sayLocally(text), { once: true });
    return; // no offline voice installed: the caption is enough
  }
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

window.orbit.onClaudeEvent((r) => {
  if (state === 'idle') {
    // Show the start of the alert ("Claude error (project): …"); showCaption keeps the end, for live speech.
    clearTimeout(captionTimer);
    captionEl.textContent = r.caption.length > 90 ? r.caption.slice(0, 89) + '…' : r.caption;
    captionEl.classList.add('show');
    clearTimeout(claudeCaptionTimer);
    claudeCaptionTimer = setTimeout(() => captionEl.classList.remove('show'), 6000);
  }
  sayLocally(r.say);
});

const prettyKey = (k) => (k || '').replace(/Control|CommandOrControl/g, 'Ctrl');
const labels = () => ({
  idle: cfg.apiKey ? `Click or press ${prettyKey(cfg.hotkey)}` : 'Right-click → Settings to add API key',
  listening: 'Listening… pause to send',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
});

function setState(s, text) {
  state = s;
  orb.setState(s);
  window.orbit.reportState(s); // pauses roaming while talking
  statusEl.textContent = text ?? labels()[s] ?? '';
  statusEl.classList.toggle('error', s === 'error');
  statusEl.classList.toggle('show', s !== 'idle'); // idle hint only on hover
  clearTimeout(thinkTimer);
  if (s === 'thinking') {
    thinkTimer = setTimeout(() => {
      if (state === 'thinking') showError('No response – try again');
    }, 20000);
  }
  if (s === 'idle') {
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => captionEl.classList.remove('show'), 4000);
    while (claudeQueue.length) sayLocally(claudeQueue.shift()); // alerts held during the conversation
  }
}

function showError(message) {
  player.stop();
  mic.stop();
  setState('error', message);
  setTimeout(() => {
    if (state === 'error') setState('idle');
  }, 3500);
}

function showCaption(text) {
  clearTimeout(captionTimer);
  clearTimeout(claudeCaptionTimer); // an older alert timer must not hide this caption
  const t = text.trim();
  captionEl.textContent = t.length > 90 ? '…' + t.slice(-90) : t;
  captionEl.classList.toggle('show', !!t);
}

orb.levelSource = () => (state === 'listening' ? mic.level() : state === 'speaking' ? player.level() : 0);

function maybeFinish() {
  if (turnDone && !player.playing && (state === 'speaking' || state === 'thinking')) setState('idle');
}
player.onIdle = maybeFinish;

async function ensureLive() {
  if (live?.ready) return live;
  setState('thinking', 'Connecting…');
  const session = new GeminiLive(sessionConfig(), {
    onAudio: (pcm) => {
      if (state !== 'thinking' && state !== 'speaking') return; // stale audio after an interrupt
      if (state !== 'speaking') setState('speaking');
      player.play(pcm);
    },
    onInputText: (t) => {
      // Show what Gemini actually heard, until its reply starts.
      userText += t;
      if (!replyText) showCaption(`You: ${userText}`);
    },
    onOutputText: (t) => {
      if (state === 'listening') return;
      replyText += t;
      showCaption(replyText);
    },
    onToolCall: async (calls) => {
      turnDone = false;
      const tricksOnly = calls.every((fc) =>
        ['do_trick', 'change_skin', 'transform', 'defence_mode'].includes(fc.name),
      );
      const label = calls.every((fc) => fc.name === 'agent_status') ? 'Checking agents…' : 'Opening…';
      if (state !== 'speaking') setState('thinking', tricksOnly ? 'Showing off…' : label);
      const responses = [];
      for (const fc of calls) {
        let result;
        if (fc.name === 'do_trick') {
          const trick = TRICKS[fc.args?.trick] ? fc.args.trick : 'spin';
          window.orbit.stunt(trick);
          result = { ok: true, did: TRICKS[trick] };
        } else if (fc.name === 'transform') {
          const form = fc.args?.form === 'orbit' ? 'orb' : 'mech';
          window.orbit.transform(form);
          result = { ok: true, form: form === 'mech' ? 'AeroStrike' : 'Orbit' };
        } else if (fc.name === 'defence_mode') {
          const on = fc.args?.on !== false;
          window.orbit.setDefence(on);
          result = { ok: true, defence: on ? 'on' : 'off' };
        } else if (fc.name === 'agent_status') {
          result = watchingAgents() ? await window.orbit.claudeStatus() : { ok: false, error: 'Not watching' };
        } else if (fc.name === 'change_skin') {
          const skin = SKIN_NAMES.includes(fc.args?.skin) ? fc.args.skin : null;
          if (skin) window.orbit.setSkin(skin);
          result = skin ? { ok: true, skin } : { ok: false, error: `Skins: ${SKIN_NAMES.join(', ')}` };
        } else {
          result = await window.orbit.runAction(fc.name, fc.args || {});
        }
        responses.push({ id: fc.id, name: fc.name, response: result });
      }
      session.sendToolResponse(responses);
    },
    onTurnComplete: () => {
      window.orbit.logChat('You', userText);
      window.orbit.logChat('Orbit', replyText);
      userText = '';
      replyText = '';
      turnDone = true;
      maybeFinish();
    },
    onInterrupted: () => player.stop(),
    onClose: (reason) => {
      live = null;
      if (state !== 'idle') showError(reason);
    },
  });
  try {
    await session.connect();
  } catch (e) {
    live = null;
    throw e;
  }
  live = session;
  return live;
}

async function startListening() {
  try {
    player.stop();
    speechSynthesis.cancel(); // stop any Claude alert so the mic doesn't hear Orbit
    const l = await ensureLive();
    turnDone = false;
    replyText = '';
    userText = '';
    showCaption('');
    setState('listening', 'Starting mic…'); // drops any stale reply audio from here on
    l.startTurn();
    await mic.start((buf) => l.sendAudio(buf), cfg.micLabel);
    setState('listening');
    watchListening();
    // A virtual mic (e.g. Camo with no phone connected) delivers pure silence.
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (state === 'listening' && mic.peak < 30) {
        live?.close();
        live = null;
        showError(`No sound from "${mic.label}" – right-click → Settings → Microphone`);
      }
    }, 2500);
  } catch (e) {
    const msg = e?.name === 'NotAllowedError' ? 'Microphone blocked' : e?.message || 'Could not start';
    showError(msg.length > 60 ? msg.slice(0, 57) + '…' : msg);
  }
}

// Listening ends by itself, so a stray click or hotkey can't leave the mic open (holding back
// agent alerts): after a short pause once you've spoken it sends; if it hears nothing it cancels.
const SPEECH_LEVEL = 0.1; // mic.level(): normal speech ~0.1-0.4, room noise ~0.01-0.04
const PAUSE_MS = 3000;
const NOTHING_MS = 12000;
const MAX_MS = 60000;
let listenWatch = null;

function watchListening() {
  clearInterval(listenWatch);
  const started = Date.now();
  let spoke = false;
  let lastVoice = started;
  listenWatch = setInterval(() => {
    if (state !== 'listening') return clearInterval(listenWatch);
    const now = Date.now();
    if (mic.level() > SPEECH_LEVEL) {
      spoke = true;
      lastVoice = now;
    }
    const done = spoke ? now - lastVoice > PAUSE_MS || now - started > MAX_MS : now - started > NOTHING_MS;
    if (!done) return;
    clearInterval(listenWatch);
    if (spoke)
      toggle(); // sends what was heard, like a click
    else cancelListening();
  }, 200);
}

/** Stop listening without sending anything (nothing was said). */
async function cancelListening() {
  if (busy || state !== 'listening') return;
  busy = true;
  try {
    clearTimeout(silenceTimer);
    await mic.stop();
    live?.close(); // drops the half-started turn
    live = null;
    showCaption("Didn't hear anything");
    setState('idle');
  } finally {
    busy = false;
  }
}

async function stopListening() {
  clearInterval(listenWatch);
  clearTimeout(silenceTimer);
  turnDone = false;
  setState('thinking');
  await mic.stop(); // flushes the final audio chunk first
  live?.endTurn();
}

async function toggle() {
  if (busy) return;
  if (!cfg.apiKey) {
    window.orbit.openSettings();
    return;
  }
  // busy covers both directions: stopping waits ~60 ms for the mic flush, and a click in that
  // gap must not start a turn that the old stop would then end.
  busy = true;
  try {
    if (state === 'listening') {
      await stopListening();
    } else {
      await startListening(); // also interrupts Orbit if it is thinking/speaking
    }
  } finally {
    busy = false;
  }
}

// ---------- click to talk, drag to move, right-click for menu ----------
// (The main process makes everything except the robot click-through.)
// Defence mode (AeroStrike only): left clicks don't get through — it fends each one off with a
// random move (block, kick or core laser); a right-click turns defence off again.
let press = null;
let guarding = false; // from the brain's motion updates

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (guarding) {
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = 1 - ((e.clientY - r.top) / r.height) * 2;
    const kind = DEFENCES[Math.floor(Math.random() * DEFENCES.length)];
    if (orb.defend(kind, nx, ny)) playDefend(player.ctx, kind, DEFENCE_SECS[kind]);
    window.orbit.interact();
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  press = { x: e.screenX, y: e.screenY, lastX: e.screenX, lastY: e.screenY, dragging: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!press) return;
  if (!press.dragging && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) {
    press.dragging = true;
    window.orbit.setDragging(true); // roaming brain hands over control
  }
  if (press.dragging) {
    window.orbit.moveBy(e.screenX - press.lastX, e.screenY - press.lastY);
    orb.nudge(e.screenX - press.lastX, e.screenY - press.lastY);
    press.lastX = e.screenX;
    press.lastY = e.screenY;
  }
});
canvas.addEventListener('pointerup', () => {
  if (!press) return;
  const wasDrag = press.dragging;
  press = null;
  window.orbit.interact(); // wakes it up / resets the nap timer
  if (wasDrag) {
    window.orbit.setDragging(false);
  } else {
    orb.bounce();
    toggle();
  }
});

// The roaming brain (main process) reports flight, sleep, mouse position and hover.
let lastEvent = null;
window.orbit.onMotion((m) => {
  // Transformation sounds start with the brain's one-off morph event.
  if (m.event !== lastEvent && (m.event === 'morph:up' || m.event === 'morph:down')) {
    playTransform(player.ctx, m.event === 'morph:up');
  }
  lastEvent = m.event;
  guarding = !!m.defence && m.form > 0.9;
  mood = m.mood || 'calm';
  orb.setMotion(m);
  orb.setLook(m.look.x, m.look.y);
  canvas.classList.toggle('hot', m.hover);
  statusEl.classList.toggle('hover', m.hover);
});
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (guarding) {
    guarding = false; // stand down at once; the brain confirms on its next update
    window.orbit.setDefence(false);
    window.orbit.interact();
    showCaption('Defence off');
    captionTimer = setTimeout(() => captionEl.classList.remove('show'), 2500);
    return;
  }
  window.orbit.showMenu();
});

window.orbit.onToggle(() => {
  window.orbit.interact();
  toggle();
});
player.setOutput(cfg.speakerLabel);
orb.setSkin(cfg.skin);
window.orbit.onSkin((skin) => {
  cfg.skin = skin;
  orb.setSkin(skin);
});

window.orbit.onConfigChanged(async () => {
  cfg = await window.orbit.getConfig();
  player.setOutput(cfg.speakerLabel);
  orb.setSkin(cfg.skin);
  live?.close();
  live = null;
  if (state === 'idle' || state === 'error') setState('idle');
});

const markSize = () => document.body.classList.toggle('big', window.innerHeight > 300);
window.addEventListener('resize', markSize);
markSize();
setState('idle');
