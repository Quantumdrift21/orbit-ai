const {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  safeStorage,
  screen,
  session,
  shell,
  utilityProcess,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const actions = require('./actions');
const aw = require('./agent-watch');
const { startTypingWatch } = require('./typing-watch');
const { createBrowser } = require('./browser');
const { createVoice } = require('./voice');
const { createWake } = require('./wake');
const { handleRpc } = require('./mcp');
const { Brain, STUNTS } = require('./brain');
const { MOOD_LABELS } = require('./mood');

const STUNT_LABELS = { spin: 'Spin', flip: 'Backflip', roll: 'Barrel roll', loop: 'Loop-the-loop' };
// Must match SKIN_NAMES in renderer/robot.js.
const SKIN_LABELS = {
  metallic: 'Metallic',
  leather: 'Leather',
  matte: 'Matte',
  velvet: 'Velvet',
  crazy: 'Crazy (holographic)',
};
// Must match CHARACTER_NAMES in renderer/robot.js.
const CHARACTER_LABELS = { og: 'OG (Orbit and AeroStrike)', flow: 'Flow (genie and mage)' };

// Let the orb play Gemini's audio without needing a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Windows can wrongly treat a transparent always-on-top window as "hidden" and pause its
// animation loop – keep rendering no matter what.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const ORB_SIZE = { width: 200, height: 230 };
const ANCHOR = { x: 100, y: 84 }; // robot centre inside the orb window
let brain = null;

const DEFAULTS = {
  apiKey: '',
  model: 'gemini-3.8-live',
  voice: 'Puck',
  language: 'auto', // main language: 'auto' or a code from renderer/languages.js
  language2: '', // optional second language the user also speaks
  micLabel: '', // '' = Windows default
  speakerLabel: '', // '' = Windows default
  hotkey: 'Control+Space',
  activation: 'key', // start talking with: 'key' (hotkey or click), 'wake' ("Hey Orbit" or click) or 'both'
  roam: true, // fly around the screen on its own
  detectApps: true, // let voice open any app from the Start menu (list stays on this PC)
  skin: 'metallic',
  character: 'og', // 'og' (Orbit and AeroStrike) or 'flow' (the genie and the mage)
  browserControl: false, // let Gemini drive a separate Orbit browser window (browser.js)
  alertVoice: 'af_heart', // Kokoro voice for agent alerts (voice.js), used once the model is downloaded
  dictation: true, // Gemini may type what you dictate (corrected English, or a summary) into your focused text box
  teleport: true, // now and then it teleports instead of flying, and may blink away from a fast swipe
  faceAlerts: true, // agent alerts also show on Orbit's face: the agent's icon, an emoji and a word
  // Watch AI coding agents (see agent-watch.js): alerts, and approve buttons where the agent allows.
  watchClaude: false,
  watchCodex: false,
  watchCopilot: false,
  watchOpencode: false,
  watchAntigravity: false,
  watchHermes: false,
  systemPrompt:
    "You are Orbit, a friendly, upbeat voice assistant living on the user's Windows desktop. " +
    'Keep answers short and conversational (1-3 sentences) unless the user asks for detail.',
};

let orbWin = null;
let settingsWin = null;

// ---------- config (API key encrypted with Windows DPAPI via safeStorage) ----------
const configPath = () => path.join(app.getPath('userData'), 'config.json');

/** The file as stored ({} on first run): the key still encrypted, no defaults filled in. */
function readStored() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {}; // first run
  }
}

function loadConfig() {
  const raw = readStored();
  let apiKey = '';
  try {
    if (raw.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
      apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyEnc, 'base64'));
    } else if (raw.apiKey) {
      apiKey = raw.apiKey;
    }
  } catch {
    apiKey = '';
  }
  if (raw.language === 'en+ta') Object.assign(raw, { language: 'ta', language2: raw.language2 || 'en' }); // older setting
  const { apiKeyEnc, ...rest } = raw;
  return { ...DEFAULTS, ...rest, apiKey: apiKey || process.env.GEMINI_API_KEY || '' };
}

function saveConfig(cfg) {
  // Start from the stored file, so fields Settings doesn't show (e.g. micLabel) are kept and the
  // stored key is left exactly as it is unless a new one is given: a save never drops a key it
  // couldn't decrypt this time.
  const { apiKey, ...rest } = cfg;
  const out = { ...readStored(), ...rest };
  if (apiKey !== undefined) {
    delete out.apiKey;
    delete out.apiKeyEnc;
    // a key from GEMINI_API_KEY stays there: storing it would hide a later change of the variable
    if (apiKey && apiKey !== process.env.GEMINI_API_KEY) {
      if (safeStorage.isEncryptionAvailable()) out.apiKeyEnc = safeStorage.encryptString(apiKey).toString('base64');
      else out.apiKey = apiKey;
    }
  }
  aw.writeAtomic(configPath(), JSON.stringify(out, null, 2)); // a crash mid-write can't cut the file short
}

function registerHotkey(accel) {
  globalShortcut.unregisterAll();
  if (loadConfig().activation === 'wake') return true; // wake word only: no hotkey
  try {
    return globalShortcut.register(accel, () => orbWin?.webContents.send('orb:toggle'));
  } catch {
    return false;
  }
}

// Where you're typing, so the roaming robot stays out of the way (only needed while it roams).
let stopTypingWatch = null;
function syncTypingWatch() {
  const want = !!brain?.enabled;
  if (want && !stopTypingWatch) stopTypingWatch = startTypingWatch((zone) => brain?.setTypingZone(zone));
  else if (!want && stopTypingWatch) {
    stopTypingWatch();
    stopTypingWatch = null;
  }
}

// ---------- windows ----------
function createOrbWindow() {
  const size = ORB_SIZE;
  const { workArea } = screen.getPrimaryDisplay();
  orbWin = new BrowserWindow({
    ...size,
    x: workArea.x + workArea.width - size.width - 24,
    y: workArea.y + workArea.height - size.height - 24,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    title: 'Orbit AI',
    skipTaskbar: true,
    focusable: false, // clicking the robot never steals focus: what you dictate lands in your text box
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep animating while other windows have focus
    },
  });
  orbWin.setAlwaysOnTop(true, 'floating');
  orbWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // The brain moves the window, decides click-through and tells the robot where the mouse is.
  brain = new Brain(orbWin, ANCHOR);
  brain.onTeleport = (b) => showLaser({ ...b, kind: 'streak' }); // the streak across the desktop
  brain.onAmbush = (b) => {
    showLaser(b);
    // the robot poses and aims its core the same way (direction only; the overlay draws the beam)
    const dx = b.x1 - b.x0;
    const dy = b.y1 - b.y0;
    const n = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
    orbWin?.webContents.send('ambush', { nx: dx / n, ny: -dy / n });
  };
  brain.setEnabled(loadConfig().roam !== false);
  brain.teleportEnabled = loadConfig().teleport !== false;
  syncTypingWatch();

  orbWin.on('closed', () => {
    brain?.destroy();
    brain = null;
    orbWin = null;
    app.quit();
  });
}

function openSettings() {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 860,
    resizable: true,
    autoHideMenuBar: true,
    title: 'Orbit AI – Settings',
    backgroundColor: '#12121a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

// ---------- IPC ----------
ipcMain.handle('config:get', () => loadConfig());

ipcMain.handle('config:set', async (_e, cfg) => {
  const before = loadConfig();
  saveConfig(cfg);
  if (brain) brain.teleportEnabled = cfg.teleport !== false;
  if (cfg.detectApps === false) actions.setInstalledApps([]);
  else if (before.detectApps === false) scanApps();
  // Install or remove hooks for each AI agent whose checkbox changed.
  const errors = [];
  const turnedOn = [];
  for (const [id, a] of Object.entries(aw.AGENTS)) {
    if (cfg[a.flag] === undefined || !!cfg[a.flag] === !!before[a.flag]) continue;
    try {
      installAgentHooks(id, !!cfg[a.flag]);
      if (cfg[a.flag]) turnedOn.push(id);
      saveConfig({ hooksPort: aw.PORT }); // the hooks now point at this port
    } catch (e) {
      errors.push(`${a.name}: ${e.message}`);
      saveConfig({ [a.flag]: !!before[a.flag] }); // keep the setting true to what's installed
    }
  }
  const listenerError = await syncListener();
  if (listenerError) {
    // Without Orbit's listener, the new hooks would send events to whatever owns the port: undo them.
    errors.push(listenerError);
    for (const id of turnedOn) {
      try {
        installAgentHooks(id, false);
      } catch {
        /* reported below via the flag staying on */
      }
      saveConfig({ [aw.AGENTS[id].flag]: false });
    }
  }
  const claudeError = errors.join('; ');
  const hotkeyOk = registerHotkey(cfg.hotkey || DEFAULTS.hotkey);
  orbWin?.webContents.send('config:changed');
  return { ok: true, hotkeyOk, claudeError };
});

ipcMain.on('win:move', (_e, dx, dy) => {
  if (!orbWin) return;
  const [x, y] = orbWin.getPosition();
  orbWin.setBounds({ x: Math.round(x + dx), y: Math.round(y + dy), ...(brain?.size || ORB_SIZE) }); // grows as AeroStrike
  brain?.onUserMove();
});
ipcMain.on('orb:drag', (_e, dragging) => {
  if (!brain) return;
  brain.dragging = !!dragging;
  brain.onUserMove();
});
ipcMain.on('orb:state', (_e, state) => brain?.setBusy(state !== 'idle' && state !== 'error'));
ipcMain.on('orb:interact', () => brain?.interact());

// Browser control (browser.js): only when turned on in Settings, and only from the robot window.
const browser = createBrowser({
  profileDir: path.join(app.getPath('userData'), 'browser-profile'),
  confirm: (card) => askConfirm(card),
});
ipcMain.handle('browser:run', async (e, name, args) => {
  if (!orbWin || e.sender !== orbWin.webContents) return { ok: false, error: 'Not allowed' };
  if (!loadConfig().browserControl) return { ok: false, error: 'Browser control is off in Settings' };
  const result = await browser.run(name, args);
  const shown = name === 'browser_type' ? { ...args, text: '…' } : args; // typed text stays out of the log
  appendLog('action', `${name} ${JSON.stringify(shown)} → ${result.ok ? 'ok' : result.error}`);
  return result;
});

// The offline models run in their own process (models-host.js): loading or running Kokoro or Whisper in
// this process froze it for seconds (hook replies, bubbles and the robot's motion all stalled). voice.js
// and wake.js here are only used for their cheap downloaded() checks.
const modelsDir = path.join(app.getPath('userData'), 'models');
const modelHost = (() => {
  let child = null;
  let nextId = 1;
  const waiting = new Map();
  const onProgress = { voice: null, wake: null };
  const start = () => {
    child = utilityProcess.fork(path.join(__dirname, 'models-host.js'), [modelsDir], { serviceName: 'Orbit models' });
    child.on('message', (m) => {
      if (m?.event === 'progress') return onProgress[m.op]?.(m.value);
      const w = waiting.get(m?.id);
      if (!w) return;
      waiting.delete(m.id);
      m.ok ? w.resolve(m.result) : w.reject(new Error(m.error));
    });
    child.on('exit', () => {
      child = null;
      for (const w of waiting.values()) w.reject(new Error('The models process stopped'));
      waiting.clear();
    });
  };
  /** Ask the host to run `op` with `args`; resolves with its result. */
  const call = (op, ...args) =>
    new Promise((resolve, reject) => {
      if (!child) start();
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      child.postMessage({ id, op, args });
    });
  return { call, onProgress };
})();

// Natural alert voice (voice.js): downloaded from Settings only; spoken for the robot window.
const voice = createVoice({ cacheDir: modelsDir });
ipcMain.handle('voice:status', () => ({ downloaded: voice.downloaded() }));
ipcMain.handle('voice:download', async (e) => {
  if (!settingsWin || e.sender !== settingsWin.webContents) return { ok: false, error: 'Not allowed' };
  try {
    modelHost.onProgress.voice = (p) => settingsWin?.webContents.send('voice:progress', p);
    await modelHost.call('voice.load', { allowDownload: true });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err)
        .split('\n')[0]
        .slice(0, 160),
    };
  }
});
ipcMain.handle('voice:speak', async (e, text) => {
  if (!orbWin || e.sender !== orbWin.webContents || !voice.downloaded()) return null;
  try {
    const t0 = Date.now();
    const out = await modelHost.call('voice.speak', text, loadConfig().alertVoice);
    console.log(
      `[${new Date().toISOString().slice(11, 23)}] voice: ${String(text).length} chars synthesized in ${Date.now() - t0} ms`,
    );
    return out;
  } catch (err) {
    console.error('voice', err);
    return null; // the robot page falls back to the Windows voice
  }
});

// Wake word (wake.js): the model is downloaded from Settings only; clips come from the robot window.
const wake = createWake({ cacheDir: modelsDir });
ipcMain.handle('wake:status', () => ({ downloaded: wake.downloaded() }));
ipcMain.handle('wake:download', async (e) => {
  if (!settingsWin || e.sender !== settingsWin.webContents) return { ok: false, error: 'Not allowed' };
  try {
    modelHost.onProgress.wake = (p) => settingsWin?.webContents.send('wake:progress', p);
    await modelHost.call('wake.load', { allowDownload: true });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err)
        .split('\n')[0]
        .slice(0, 160),
    };
  }
});
ipcMain.handle('wake:hear', async (e, pcm) => {
  if (!orbWin || e.sender !== orbWin.webContents || !wake.downloaded()) return '';
  if (!(pcm instanceof Float32Array) || pcm.length > 16000 * 3) return '';
  const t0 = Date.now();
  try {
    const heard = await modelHost.call('wake.hear', pcm);
    console.log(`wake: ${(pcm.length / 16000).toFixed(1)} s clip -> "${heard}" (${Date.now() - t0} ms)`);
    return heard;
  } catch (err) {
    console.error('wake', err);
    return '';
  }
});
// Load the model ahead of the first "Hey Orbit" (a few seconds), so that one isn't missed.
app.whenReady().then(() => {
  const { activation } = loadConfig();
  if ((activation === 'wake' || activation === 'both') && wake.downloaded())
    modelHost.call('wake.load').catch((e) => console.error('wake', e));
});

// The overlay: a click-through window over the robot's display draws the ambush beam from its core to
// your pointer, or the teleport streak (renderer/laser.*); shown for one shot, hidden again right after.
let laserWin = null;
let laserHide = null;
function showLaser({ x0, y0, x1, y1, kind = 'laser', form = 'orb', secs = 1.5 }) {
  const { bounds } = screen.getDisplayNearestPoint({ x: Math.round(x0), y: Math.round(y0) });
  if (!laserWin || laserWin.isDestroyed()) {
    laserWin = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    laserWin.setIgnoreMouseEvents(true);
    laserWin.setAlwaysOnTop(true, 'screen-saver');
    laserWin.loadFile(path.join(__dirname, 'renderer', 'laser.html'));
  }
  laserWin.setBounds(bounds);
  const send = () =>
    laserWin.webContents.send('ambush', {
      kind,
      form,
      secs,
      x0: x0 - bounds.x,
      y0: y0 - bounds.y,
      x1: x1 - bounds.x,
      y1: y1 - bounds.y,
    });
  if (laserWin.webContents.isLoading()) laserWin.webContents.once('did-finish-load', send);
  else send();
  laserWin.showInactive();
  clearTimeout(laserHide);
  laserHide = setTimeout(() => laserWin?.hide(), secs * 1000 + 400);
}

// Dictation: Gemini's type_text tool pastes clean English into whatever text box has the focus
// (Settings: dictation). The clipboard is used for the paste and put back as it was.
ipcMain.handle('type:text', async (e, text) => {
  if (!orbWin || e.sender !== orbWin.webContents) return { ok: false, error: 'Not allowed' };
  if (loadConfig().dictation === false) return { ok: false, error: 'Dictation is off in Settings' };
  const line = String(text ?? '').slice(0, 2000);
  if (!line.trim()) return { ok: false, error: 'Nothing to type' };
  const before = clipboard.readText();
  clipboard.writeText(line);
  const ps = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')";
  await new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      stdio: 'ignore',
    });
    p.on('exit', resolve);
    p.on('error', resolve);
  });
  setTimeout(() => {
    if (clipboard.readText() === line) clipboard.writeText(before);
  }, 700);
  return { ok: true, typed: line.length };
});

// Subtitle bubble beside the robot for what the alert voice says (renderer/bubble.*): never
// focused and click-through, except over its buttons (Allow / Deny / Chat, for requests that need
// your answer); follows the robot while it's showing. A waiting request always wins the bubble.
let bubbleWin = null;
let bubbleTimer = null;
let bubbleSide = 'left';
let bubbleRequest = null; // id of the request the bubble shows
let bubbleHovered = false;
let bubbleHideWanted = false;
const BUBBLE = { width: 360, height: 220 };
function placeBubble() {
  if (!bubbleWin || bubbleWin.isDestroyed() || !brain) return;
  const c = brain.center();
  const wa = screen.getDisplayNearestPoint({ x: Math.round(c.x), y: Math.round(c.y) }).workArea;
  const reach = brain.layout.hit.rx + 6;
  bubbleSide = c.x - reach - BUBBLE.width >= wa.x ? 'left' : 'right'; // bubble on the robot's left if it fits
  const x = bubbleSide === 'left' ? c.x - reach - BUBBLE.width : c.x + reach;
  const y = Math.max(wa.y, Math.min(c.y - 70, wa.y + wa.height - BUBBLE.height));
  bubbleWin.setBounds({ x: Math.round(x), y: Math.round(y), ...BUBBLE });
}
function showBubble(b) {
  const first = [...pending.values()][0];
  if (first) b = { ...bubbleFor(first.card), of: pending.size, secs: b.request ? b.secs : undefined };
  bubbleRequest = first ? first.card.id : null;
  bubbleHideWanted = false;
  if (!bubbleWin || bubbleWin.isDestroyed()) {
    bubbleWin = new BrowserWindow({
      ...BUBBLE,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    bubbleWin.setIgnoreMouseEvents(true, { forward: true }); // the page still sees hover, to catch its buttons
    bubbleWin.setAlwaysOnTop(true, 'floating');
    bubbleWin.loadFile(path.join(__dirname, 'renderer', 'bubble.html'));
    bubbleWin.on('closed', () => {
      bubbleWin = null;
      bubbleHovered = false;
    });
    bubbleWin.webContents.once('did-finish-load', () => showBubble(b));
    return;
  }
  placeBubble();
  bubbleWin.webContents.send('bubble', { ...b, side: bubbleSide });
  if (!bubbleWin.isVisible()) bubbleWin.showInactive();
  clearInterval(bubbleTimer);
  bubbleTimer = setInterval(placeBubble, 33); // keep up with the flying robot
}
function hideBubble() {
  if (pending.size) return; // a request stays until it's answered or times out
  if (bubbleHovered) return void (bubbleHideWanted = true); // not from under your mouse
  clearInterval(bubbleTimer);
  bubbleTimer = null;
  bubbleRequest = null;
  bubbleWin?.webContents.send('bubble', null); // fades out, then:
  setTimeout(() => {
    if (!bubbleTimer && bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
  }, 400);
}
ipcMain.on('bubble:show', (e, b) => {
  console.log(
    `[${new Date().toISOString().slice(11, 23)}] bubble ${b?.kind ?? ''} ${String(b?.text ?? '').length} chars`,
  );
  if (orbWin && e.sender === orbWin.webContents && b && typeof b.text === 'string') showBubble(b);
});
ipcMain.on('bubble:hide', (e) => {
  if (orbWin && e.sender === orbWin.webContents) hideBubble();
});
// Over the bubble's buttons it takes clicks; everywhere else clicks go through to what's below.
ipcMain.on('bubble:hover', (e, on) => {
  if (!bubbleWin || e.sender !== bubbleWin.webContents) return;
  bubbleHovered = !!on;
  bubbleWin.setIgnoreMouseEvents(!on, { forward: true });
  if (!on && bubbleHideWanted) hideBubble();
});

// ---------- agent chat window (renderer/chat.*): the conversation, and your reply ----------
// History comes from the agent's own transcript file, read only while this window is open and only
// on this PC (secrets hidden). Replies: answer a waiting request (Allow / Deny with your message /
// pick an answer), or, while the agent works, a message it gets when it next stops (Stop hook) or
// checks Orbit (MCP check_messages).
let chatWin = null;
let chatSession = null; // 'agent:session id' shown in the chat
let chatTimer = null;
const transcriptCache = new Map(); // file → { mtimeMs, messages }

/** The last part of an agent's transcript as chat messages ([] if it can't be read). */
function readTranscript(file) {
  try {
    const f = path.resolve(String(file || ''));
    // only a transcript (.jsonl) in your own profile: hook events can't point Orbit at other files
    if (!f.toLowerCase().startsWith(os.homedir().toLowerCase() + path.sep) || !/\.jsonl$/i.test(f)) return [];
    const st = fs.statSync(f);
    const hit = transcriptCache.get(f);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.messages;
    const size = Math.min(st.size, 768 * 1024); // the newest part is enough to scroll back through
    const fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, st.size - size);
    fs.closeSync(fd);
    const messages = aw.transcriptMessages(buf.toString('utf8'), 120);
    transcriptCache.set(f, { mtimeMs: st.mtimeMs, messages });
    return messages;
  } catch {
    return [];
  }
}

/** What the chat needs to know about a waiting request (the whole input, secrets hidden). */
const chatCard = (c) => ({
  id: c.id,
  kind: c.kind,
  who: c.who,
  tool: c.tool,
  full: c.full ?? c.detail,
  secret: !!c.secret,
  questions: c.questions,
  until: c.until,
});

function refreshChat() {
  if (!chatWin || chatWin.isDestroyed()) return;
  const s = watch.session(chatSession);
  const waiting = [...pending.values()].map((p) => p.card).filter((c) => c.kind !== 'confirm');
  const req = waiting.find((c) => c.session && c.session === chatSession) || (!s ? waiting[0] : null);
  chatWin.webContents.send('chat', {
    session: s && {
      key: s.key,
      who: s.who,
      project: s.project,
      working: !!s.working,
      waiting: s.inbox.length,
      hasTranscript: !!s.transcript,
    },
    sessions: [...watch.sessions.values()].map((x) => ({ key: x.key, who: x.who, project: x.project })),
    messages: s?.transcript ? readTranscript(s.transcript) : [],
    request: req ? chatCard(req) : null,
    now: Date.now(),
  });
}

/** Opening the chat on a waiting request gives you longer to answer (the agent waits up to 60 s). */
function extendRequests(session) {
  for (const [id, p] of pending) {
    if (p.card.session !== session || !p.res) continue;
    const until = p.card.started + (aw.HOOK_EVENTS.PermissionRequest - 5) * 1000; // just inside its hook timeout
    if (until <= p.card.until) continue;
    clearTimeout(p.timer);
    p.card.until = until;
    p.timer = setTimeout(() => settleApproval(id, null), until - Date.now());
  }
}

function openChat(session) {
  chatSession = (typeof session === 'string' && watch.session(session)?.key) || watch.session()?.key || null;
  extendRequests(chatSession);
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.show();
    chatWin.focus();
    refreshChat();
    refreshRequests();
    return;
  }
  const c = brain?.center() ?? { x: 600, y: 400 };
  const wa = screen.getDisplayNearestPoint({ x: Math.round(c.x), y: Math.round(c.y) }).workArea;
  const size = { width: 420, height: 600 };
  chatWin = new BrowserWindow({
    ...size,
    x: Math.round(Math.max(wa.x, Math.min(c.x - size.width - 90, wa.x + wa.width - size.width))),
    y: Math.round(Math.max(wa.y, Math.min(c.y - 260, wa.y + wa.height - size.height))),
    minWidth: 340,
    minHeight: 380,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0d0e17',
    title: 'Orbit – agent chat',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  chatWin.setAlwaysOnTop(true, 'floating');
  chatWin.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
  chatWin.webContents.once('did-finish-load', refreshChat);
  chatTimer = setInterval(refreshChat, 2000); // the transcript grows while the agent works
  chatWin.on('closed', () => {
    clearInterval(chatTimer);
    chatWin = null;
    transcriptCache.clear();
  });
}
ipcMain.on('chat:open', (e, session) => {
  const from = [orbWin, bubbleWin, chatWin].filter(Boolean).map((w) => w.webContents);
  if (from.includes(e.sender)) openChat(session);
});
ipcMain.on('chat:close', (e) => {
  if (chatWin && e.sender === chatWin.webContents) chatWin.close();
});
// A message for a working agent: it gets it when it next stops, or checks Orbit over MCP.
ipcMain.handle('chat:send', (e, session, text) => {
  if (!chatWin || e.sender !== chatWin.webContents) return { ok: false };
  const ok = watch.queueMessage(String(session), text);
  refreshChat();
  return { ok };
});

ipcMain.handle('action:run', (_e, name, args) => {
  const result = actions.run(name, args);
  appendLog('action', `${name} ${JSON.stringify(args)} → ${JSON.stringify(result)}`);
  return result;
});

// Installed-app detection runs in the background (Get-StartApps takes a few seconds).
let appScan = null;
function scanApps() {
  appScan = actions.scanStartApps().finally(() => (appScan = null));
  return appScan;
}
ipcMain.handle('apps:info', () => ({ count: actions.installedCount(), scanning: !!appScan }));
ipcMain.handle('apps:rescan', async () => ({ count: await (appScan || scanApps()) }));

ipcMain.on('orb:stunt', (_e, name) => brain?.stunt(name, true));
ipcMain.on('orb:transform', (_e, form) => brain?.transform(form === 'orb' || form === 'mech' ? form : undefined, true));
ipcMain.on('orb:defence', (_e, on) => brain?.setDefence(on === true));

// Skin changes (menu or voice) are saved and sent straight to the robot, without the
// config:changed reload, so a conversation in progress isn't cut off.
function setSkin(name) {
  if (!SKIN_LABELS[name]) return;
  saveConfig({ skin: name });
  orbWin?.webContents.send('orb:skin', name);
}
ipcMain.on('orb:setSkin', (_e, name) => setSkin(name));
// Character changes go the same way: saved, then sent straight to the robot, which swaps bodies live.
function setCharacter(name) {
  if (!CHARACTER_LABELS[name]) return;
  saveConfig({ character: name });
  orbWin?.webContents.send('orb:character', name);
}
ipcMain.on('orb:setCharacter', (_e, name) => setCharacter(name));

// ---------- AI agent watcher (Claude Code, Codex, Copilot, OpenCode, Antigravity, Hermes) ----------
// Agents send their hook events to a listener on 127.0.0.1: Claude Code directly (http hooks),
// the others through Orbit's bridge script or plugin. Alerts stay on this PC; permission requests
// get Allow/Deny buttons in a small card window, and fall back to the agent's own prompt.
const watch = new aw.Watch();
const pending = new Map(); // approval id → { res, timer, card, agent }
let claudeServer = null;
let nextApprovalId = 1;

function claudeToken() {
  let { claudeToken: token } = loadConfig();
  if (!token) {
    token = crypto.randomBytes(16).toString('hex');
    saveConfig({ claudeToken: token });
  }
  return token;
}
const claudeUrl = () => aw.URL_PREFIX + claudeToken();
const bridgePath = () => path.join(app.getPath('userData'), 'orbit-hook.ps1');

/** The bridge script other agents run: forwards one event to Orbit and prints Orbit's reply. */
function writeBridge() {
  const url = aw.AGENT_URL_PREFIX + claudeToken();
  const script = `# Orbit AI hook bridge (written by Orbit; rewritten when you change watched agents).
# An AI agent runs this with its hook event on stdin; it forwards the event to Orbit on this PC
# (127.0.0.1 only) and prints Orbit's reply, e.g. an Allow/Deny decision. If Orbit isn't running
# it prints nothing, so the agent simply carries on.
param([string]$Agent = '', [string]$Event = '')
try {
  # Raw UTF-8 streams: works even when the agent starts this without a console window.
  $body = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.Encoding]::UTF8).ReadToEnd()
  if (-not $body) { $body = '{}' }
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $r = Invoke-WebRequest -Uri ('${url}/' + $Agent + '/' + $Event) -Method Post -Body $bytes -ContentType 'application/json' -UseBasicParsing -TimeoutSec 40
  # Decode the reply bytes ourselves: .Content can be a byte array depending on the response type.
  $out = $r.RawContentStream.ToArray()
  if ($out.Length -gt 2) { $o = [Console]::OpenStandardOutput(); $o.Write($out, 0, $out.Length); $o.Flush() }
} catch { }
exit 0
`;
  fs.mkdirSync(path.dirname(bridgePath()), { recursive: true });
  fs.writeFileSync(bridgePath(), '﻿' + script); // BOM so Windows PowerShell 5.1 reads it as UTF-8
}

function startClaudeServer() {
  if (claudeServer) return Promise.resolve('');
  const token = claudeToken();
  const server = http.createServer((req, res) => {
    const reply = (code, body = {}) => {
      if (res.writableEnded) return;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // /claude/<token> from Claude Code, /agent/<token>/<agent>/<event> from the bridge or plugin,
    // /mcp/<token> for Orbit's MCP tools (ask_user, check_messages; mcp.js).
    const parts = (req.url || '').split('?')[0].split('/').filter(Boolean);
    let agent = null;
    let hookName = '';
    const isMcp = parts[0] === 'mcp' && parts[1] === token && parts.length === 2;
    if (parts[0] === 'claude' && parts[1] === token && parts.length === 2) agent = 'claude';
    else if (parts[0] === 'agent' && parts[1] === token && aw.AGENTS[parts[2]] && parts.length <= 4) {
      [agent, hookName = ''] = [parts[2], parts[3]];
    }
    if (isMcp && req.method !== 'POST') return reply(405); // no server-initiated stream
    if (req.method !== 'POST' || (!agent && !isMcp)) return reply(404);
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return reply(403);
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reply(413);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let evt;
      try {
        evt = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(400);
      }
      if (isMcp) {
        handleRpc(evt, mcpHandlers).then(
          (out) => (out ? reply(200, out) : (res.writeHead(202), res.end())),
          () => reply(500),
        );
        return;
      }
      try {
        evt = aw.normalize(agent, hookName, evt);
        if (!evt) return reply(200);
        if (evt.hook_event_name === 'PermissionRequest' && aw.AGENTS[agent].approve) {
          // A question gets answered from Orbit's bubble or chat (Claude Code takes the answers);
          // a plan review still needs the user's own careful answer in the terminal.
          if (evt.tool_name === 'AskUserQuestion' && agent === 'claude') return askApproval(evt, res, true);
          if (!aw.NEEDS_OWN_ANSWER.has(evt.tool_name)) return askApproval(evt, res);
          evt = { ...evt, hook_event_name: 'Notification', notification_type: 'permission_prompt' };
        }
        if (evt.hook_event_name === 'Stop' && (agent === 'claude' || agent === 'codex')) {
          // Messages you typed in Orbit's chat while it worked: hand them over so it carries on.
          const key = `${agent}:${evt.session_id || 'unknown'}`;
          const msgs = watch.takeMessages(key);
          if (msgs.length) {
            reply(200, aw.stopReply(msgs));
            watch.add(evt);
            const s = watch.session(key);
            if (s) s.working = true; // it continues with your message
            refreshChat();
            return;
          }
        }
        reply(200); // answer at once so the agent never waits on Orbit
        onClaudeEvent(evt);
      } catch (e) {
        console.error('agent event', e);
        reply(200); // an odd event must never leave the agent waiting
      }
    });
  });
  return new Promise((resolve) => {
    server.once('error', (e) => {
      resolve(e.code === 'EADDRINUSE' ? `port ${aw.PORT} is used by another program` : e.message);
    });
    server.listen(aw.PORT, '127.0.0.1', () => {
      claudeServer = server;
      resolve('');
    });
  });
}

function stopClaudeServer() {
  for (const id of [...pending.keys()]) settleApproval(id, null);
  claudeServer?.close();
  claudeServer = null;
}

function onClaudeEvent(evt) {
  console.log(
    `[${new Date().toISOString().slice(11, 23)}] hook event ${evt.agent ?? 'claude'} ${evt.hook_event_name ?? ''}`,
  );
  const r = watch.add(evt);
  if (!r || !orbWin) return;
  if (brain) {
    if (brain.mode === 'sleep' && !r.urgent) r.say = ''; // don't wake it for agents and tasks
    if (r.kind === 'input' || r.kind === 'error') {
      brain.interact();
      brain.flash('alert', 2);
    } else if (r.kind === 'done') {
      brain.feel('claude');
      brain.flash('wake', 1.5);
    }
  }
  orbWin.webContents.send('claude:event', r);
}

// ---------- requests that need your answer: shown in the subtitle bubble and the chat window ----------
// pending: id → { card, timer, agent, res (an agent's waiting HTTP request) | resolve (Orbit's own) }.
// Kinds: 'permission' (Allow / Deny, or Deny with your message), 'question' (an agent's
// AskUserQuestion: pick an option or type an answer), 'ask' (MCP ask_user: type an answer),
// 'confirm' (browser control's risky steps: Allow / Deny).

function addRequest(card, wait, { res = null, resolve = null, agent = 'orbit' } = {}) {
  const id = nextApprovalId++;
  card.id = id;
  card.started = Date.now();
  card.until = card.started + wait * 1000;
  const timer = setTimeout(() => settleApproval(id, null), wait * 1000);
  pending.set(id, { card, timer, agent, res, resolve });
  if (res) res.on('close', () => settleApproval(id, null, true)); // answered in the terminal, or it stopped
  brain?.interact();
  brain?.flash('alert', 2);
  refreshRequests();
  return id;
}

function askApproval(evt, res, isQuestion = false) {
  watch.add(evt); // remembered for the summary, the chat, and to skip the matching notification
  const who = aw.AGENTS[evt.agent]?.label || 'Claude';
  const input = evt.tool_input && typeof evt.tool_input === 'object' ? evt.tool_input : {};
  const { text, partial } = aw.approvalDetail(evt.tool_name, input);
  const full = JSON.stringify(input, null, 2);
  const card = {
    kind: isQuestion ? 'question' : 'permission',
    who,
    project: path.basename(String(evt.cwd || '')) || who,
    session: `${evt.agent || 'claude'}:${evt.session_id || 'unknown'}`,
    tool: String(evt.tool_name || 'a tool'),
    detail: text,
    partial, // the bubble can't show all of it: Allow only from the chat (enforced in claude:decide)
    full: aw.hideSecrets(full), // the whole input, for the chat window
    secret: aw.hideSecrets(full) !== full, // something hidden: Allow only in the agent's own prompt
    questions: isQuestion && Array.isArray(input.questions) ? input.questions : null,
    input,
  };
  card.say = isQuestion
    ? `${who} asks: ${String(card.questions?.[0]?.question || 'a question').slice(0, 140)}`
    : `${who} asks to use ${card.tool} in ${card.project}`;
  addRequest(card, aw.APPROVE_WAIT_SECS, { res, agent: evt.agent || 'claude' });
  orbWin?.webContents.send('claude:event', {
    kind: 'input',
    urgent: true,
    say: card.say,
    caption: `${card.project}: ${card.tool} — ${card.detail}`,
    project: card.project,
    who,
    session: card.session,
    request: card.id,
  });
}

/**
 * Orbit's own confirm card (browser control's risky steps), in the bubble like agent requests.
 * Resolves 'allow', 'deny' or null (no answer in time). Only the bubble's buttons answer it.
 */
function askConfirm({ detail, site }) {
  return new Promise((resolve) => {
    const card = {
      kind: 'confirm',
      who: 'Orbit',
      project: String(site || 'the browser'),
      tool: 'the browser',
      detail: String(detail).slice(0, 100),
      say: `Orbit wants to ${String(detail).slice(0, 80)}`,
    };
    addRequest(card, aw.APPROVE_WAIT_SECS, { resolve: (b) => resolve(b) });
  });
}

const MCP_ASK_SECS = 10 * 60; // an agent asking through MCP waits up to 10 minutes for your answer

/** The tools AI agents call on Orbit's MCP server (mcp.js). */
const mcpHandlers = {
  askUser: ({ question, cwd }) =>
    new Promise((resolve) => {
      const s = watch.sessionAt(cwd);
      const who = s?.who || 'Claude';
      const card = {
        kind: 'ask',
        who,
        project: s?.project || path.basename(cwd) || who,
        session: s?.key || null,
        tool: 'a question',
        detail: aw.hideSecrets(question),
        say: `${who} asks: ${aw.hideSecrets(question).slice(0, 140)}`,
      };
      const id = addRequest(card, MCP_ASK_SECS, { resolve: (b, extra) => resolve(b ? extra?.message || null : null) });
      orbWin?.webContents.send('claude:event', {
        kind: 'input',
        urgent: true,
        say: card.say,
        caption: card.say,
        project: card.project,
        who,
        session: card.session,
        request: id,
      });
    }),
  checkMessages: ({ cwd }) => {
    const s = watch.sessionAt(cwd);
    const msgs = s ? watch.takeMessages(s.key) : [];
    if (msgs.length) refreshChat();
    return msgs;
  },
};

/** behavior: 'allow' | 'deny' | null (null = no answer: the agent shows its own prompt). */
function settleApproval(id, behavior, closed = false, extra = {}) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  if (p.resolve) p.resolve(behavior, extra);
  else if (!closed && !p.res.writableEnded) {
    p.res.writeHead(200, { 'Content-Type': 'application/json' });
    p.res.end(JSON.stringify(aw.reply(p.agent, behavior, extra)));
  }
  refreshRequests();
}

/** The oldest waiting request goes in the bubble (with "1 of N"); the chat shows its session's. */
function refreshRequests() {
  const first = [...pending.values()][0];
  if (first) showBubble({ ...bubbleFor(first.card), of: pending.size });
  else if (bubbleRequest) {
    bubbleRequest = null;
    hideBubble();
  }
  refreshChat();
}

/** What the bubble shows for a request (never the whole input: that's the chat's job). */
const bubbleFor = (c) => ({
  text: c.say,
  kind: 'input',
  who: c.who,
  project: c.project,
  session: c.session,
  request: {
    id: c.id,
    kind: c.kind,
    detail: c.detail,
    partial: !!c.partial,
    question: c.questions?.[0]?.question,
    options:
      c.questions?.length === 1 && !c.questions[0].multiSelect ? c.questions[0].options?.map((o) => o.label) : null,
    until: c.until,
    chat: c.kind !== 'confirm',
  },
});

// Only the bubble and the chat window can answer: the Gemini (robot) window never can.
// extra: { message } (deny with your reply, or the answer to an ask) | { answers } (a question).
ipcMain.on('claude:decide', (e, id, behavior, extra = {}) => {
  const fromBubble = bubbleWin && e.sender === bubbleWin.webContents;
  const fromChat = chatWin && e.sender === chatWin.webContents;
  if (!fromBubble && !fromChat) return;
  if (!['allow', 'deny', 'terminal'].includes(behavior)) return;
  const p = pending.get(id);
  if (!p) return;
  const c = p.card;
  // never approve what wasn't shown: the bubble shows a part, the chat all (secrets stay hidden)
  if (behavior === 'allow' && c.kind === 'permission' && (c.secret || (fromBubble && c.partial))) return;
  const message = String(extra?.message ?? '')
    .trim()
    .slice(0, 2000);
  if (c.kind === 'question' && behavior === 'allow') {
    const answers = {};
    for (const [q, a] of Object.entries(extra?.answers || {})) if (a) answers[String(q)] = String(a).slice(0, 500);
    if (!Object.keys(answers).length) return;
    return settleApproval(id, 'allow', false, { updatedInput: aw.answerInput(c.input, answers) });
  }
  if (c.kind === 'ask') return settleApproval(id, message ? 'allow' : null, false, { message });
  settleApproval(id, behavior === 'terminal' ? null : behavior, false, behavior === 'deny' ? { message } : {});
});

ipcMain.handle('claude:status', () => {
  const summary = watch.summary(); // secret-filtered
  appendLog('action', `agent_status → ${summary}`);
  return { ok: true, summary };
});

const claudeSettingsPath = () => path.join(os.homedir(), '.claude', 'settings.json');

const home = (...p) => path.join(os.homedir(), ...p);
const hermesHome = () =>
  [process.env.HERMES_HOME, path.join(process.env.LOCALAPPDATA || '', 'hermes'), home('.hermes')].find(
    (d) => d && fs.existsSync(path.join(d, 'config.yaml')),
  );

// Where each agent keeps its settings: the agent counts as installed when this exists.
const agentDir = (id) =>
  ({
    claude: home('.claude'),
    codex: home('.codex'),
    copilot: home('.copilot'),
    opencode: home('.config', 'opencode'),
    antigravity: home('.gemini', 'config'),
    hermes: hermesHome(),
  })[id];

/**
 * Add (or remove) Orbit's MCP server in Claude Code's user settings, through Claude Code's own CLI
 * (it owns ~/.claude.json, which it rewrites constantly). Best effort: without the CLI, the hooks
 * still work and only ask_user / check_messages are missing.
 */
function registerClaudeMcp(on) {
  const run = (args) =>
    new Promise((done) => {
      const p = spawn('claude', args, { shell: true, windowsHide: true, stdio: 'ignore' });
      p.on('error', () => done(false));
      p.on('exit', (code) => done(code === 0));
    });
  // the arguments are fixed words plus Orbit's own local URL (a hex token): nothing from outside
  run(['mcp', 'remove', '--scope', 'user', 'orbit'])
    .then((removed) =>
      on
        ? run(['mcp', 'add', '--transport', 'http', '--scope', 'user', 'orbit', aw.MCP_URL_PREFIX + claudeToken()])
        : removed,
    )
    .then((ok) => {
      if (on ? ok : true) saveConfig({ claudeMcp: on }); // remembered so it isn't redone every start
    });
}

/** Add or remove Orbit's hooks for one agent, touching only Orbit's own entries. */
function installAgentHooks(id, on) {
  const script = bridgePath();
  if (on && id !== 'claude' && id !== 'opencode') writeBridge();
  const ownFile = (file, content) => {
    if (!on) return fs.rmSync(file, { force: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const shared = (file, add, remove, json = true) => {
    if (!on && !fs.existsSync(file)) return;
    aw.editConfig(file, (c) => (on ? add(c, script) : remove(c)), json);
  };
  switch (id) {
    case 'claude': // Claude Code posts straight to Orbit's URL, no bridge script
      registerClaudeMcp(on);
      return shared(claudeSettingsPath(), (c) => aw.withOrbitHooks(c, claudeUrl()), aw.withoutOrbitHooks);
    case 'codex':
      return shared(home('.codex', 'hooks.json'), aw.withCodexHooks, aw.withoutCodexHooks);
    case 'antigravity':
      return shared(home('.gemini', 'config', 'hooks.json'), aw.withAntigravityHooks, aw.withoutAntigravityHooks);
    case 'copilot':
      return ownFile(
        home('.copilot', 'hooks', 'orbit.json'),
        JSON.stringify(aw.copilotHooksFile(script), null, 2) + '\n',
      );
    case 'opencode':
      return ownFile(
        home('.config', 'opencode', 'plugins', 'orbit.js'),
        aw.opencodePlugin(`${aw.AGENT_URL_PREFIX}${claudeToken()}/opencode`),
      );
    case 'hermes': {
      const dir = hermesHome();
      if (!dir) {
        if (!on) return; // nothing to remove
        throw new Error("couldn't find Hermes' config.yaml");
      }
      return shared(path.join(dir, 'config.yaml'), aw.withHermesHooks, aw.withoutHermesHooks, false);
    }
  }
}

/** Watching any agent needs the listener; none needs it closed. Returns an error message or ''. */
async function syncListener() {
  const cfg = loadConfig();
  if (Object.values(aw.AGENTS).some((a) => cfg[a.flag])) return startClaudeServer();
  stopClaudeServer();
  return '';
}

ipcMain.handle('agents:info', () =>
  Object.fromEntries(
    Object.entries(aw.AGENTS).map(([id, a]) => {
      const dir = agentDir(id);
      return [id, { name: a.name, flag: a.flag, approve: a.approve, installed: !!dir && fs.existsSync(dir) }];
    }),
  ),
);

// ---------- chat logs: userData/logs/YYYY-MM-DD.txt ----------
const logsDir = () => path.join(app.getPath('userData'), 'logs');
function appendLog(role, text) {
  if (!text) return;
  const now = new Date();
  const day = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const time = now.toLocaleTimeString('en-GB');
  fs.mkdirSync(logsDir(), { recursive: true });
  fs.appendFileSync(path.join(logsDir(), `${day}.txt`), `[${time}] ${role}: ${String(text).trim()}\n`);
}
ipcMain.on('log:append', (_e, role, text) => appendLog(role, text));

ipcMain.on('settings:open', () => openSettings());
ipcMain.on('settings:close', () => settingsWin?.close());

ipcMain.on('menu:show', () => {
  Menu.buildFromTemplate([
    { label: `Mood: ${MOOD_LABELS[brain?.mood] || MOOD_LABELS.calm}`, enabled: false },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    {
      label: 'Agent chat…',
      visible: Object.values(aw.AGENTS).some((a) => loadConfig()[a.flag]),
      click: () => openChat(),
    },
    {
      label: 'Open chat logs',
      click: () => {
        fs.mkdirSync(logsDir(), { recursive: true });
        shell.openPath(logsDir());
      },
    },
    { type: 'separator' },
    {
      label: 'Free roam (fly around)',
      type: 'checkbox',
      checked: brain?.enabled ?? true,
      click: (item) => {
        brain?.setEnabled(item.checked);
        syncTypingWatch();
        saveConfig({ roam: item.checked });
      },
    },
    brain?.mode === 'sleep'
      ? { label: 'Wake up', click: () => brain?.interact() }
      : { label: 'Take a nap', click: () => brain?.sleepNow() },
    {
      label: brain?.form === 'mech' ? 'Fold back to Orbit' : 'Transform to AeroStrike',
      enabled: !brain?.morph,
      click: () => brain?.transform(undefined, true),
    },
    {
      label: 'Defence mode (AeroStrike)',
      type: 'checkbox',
      checked: brain?.defence ?? false,
      click: (item) => brain?.setDefence(item.checked),
    },
    {
      label: 'Do a trick',
      submenu: STUNTS.map((s) => ({ label: STUNT_LABELS[s], click: () => brain?.stunt(s, true) })),
    },
    {
      label: 'Skin',
      submenu: Object.entries(SKIN_LABELS).map(([name, label]) => ({
        label,
        type: 'radio',
        checked: loadConfig().skin === name,
        click: () => setSkin(name),
      })),
    },
    {
      label: 'Character',
      submenu: Object.entries(CHARACTER_LABELS).map(([name, label]) => ({
        label,
        type: 'radio',
        checked: (loadConfig().character ?? 'og') === name,
        click: () => setCharacter(name),
      })),
    },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: orbWin?.isAlwaysOnTop() ?? true,
      click: (item) => orbWin?.setAlwaysOnTop(item.checked, 'floating'),
    },
    { type: 'separator' },
    { label: 'Quit Orbit', click: () => app.quit() },
  ]).popup({ window: orbWin });
});

// ---------- app lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => orbWin?.show());

  app.whenReady().then(() => {
    // Allow microphone access for our own pages only.
    const AUDIO_PERMS = ['media', 'speaker-selection'];
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(AUDIO_PERMS.includes(permission) && wc.getURL().startsWith('file://'));
    });
    session.defaultSession.setPermissionCheckHandler(
      (wc, permission) => AUDIO_PERMS.includes(permission) && !!wc?.getURL().startsWith('file://'),
    );

    const cfg = loadConfig();
    if (cfg.detectApps !== false) scanApps();
    createOrbWindow();
    registerHotkey(cfg.hotkey);
    // Hooks point at Orbit's port: when the port changed (another app took the old one), rewrite
    // each watched agent's entries once (Orbit's own entries are recognised on any port).
    if ((cfg.hooksPort ?? 47821) !== aw.PORT) {
      for (const [id, a] of Object.entries(aw.AGENTS)) {
        if (!cfg[a.flag]) continue;
        try {
          installAgentHooks(id, true); // Claude Code: also re-adds the MCP server with the new URL
        } catch (e) {
          console.error(`moving ${a.name}'s hooks`, e);
        }
      }
      saveConfig({ hooksPort: aw.PORT });
    } else if (cfg.watchClaude && !cfg.claudeMcp) registerClaudeMcp(true); // watching from before the MCP tools
    syncListener().then((err) => {
      if (err) console.error('agent listener:', err); // e.g. another program has the port
    });
    if (!cfg.apiKey) openSettings();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopTypingWatch?.();
    browser.close();
    stopClaudeServer(); // pending approvals fall back to Claude Code's own prompt
  });
}
