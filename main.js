const { app, BrowserWindow, ipcMain, globalShortcut, Menu, safeStorage, screen, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const actions = require('./actions');
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
  roam: true, // fly around the screen on its own
  detectApps: true, // let voice open any app from the Start menu (list stays on this PC)
  skin: 'metallic',
  systemPrompt:
    "You are Orbit, a friendly, upbeat voice assistant living on the user's Windows desktop. " +
    'Keep answers short and conversational (1-3 sentences) unless the user asks for detail.',
};

let orbWin = null;
let settingsWin = null;

// ---------- config (API key encrypted with Windows DPAPI via safeStorage) ----------
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    /* first run */
  }
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
  const out = { ...loadConfig(), ...cfg }; // keep fields Settings doesn't show (e.g. micLabel)
  if (out.apiKey && safeStorage.isEncryptionAvailable()) {
    out.apiKeyEnc = safeStorage.encryptString(out.apiKey).toString('base64');
    delete out.apiKey;
  }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(out, null, 2));
}

function registerHotkey(accel) {
  globalShortcut.unregisterAll();
  try {
    return globalShortcut.register(accel, () => orbWin?.webContents.send('orb:toggle'));
  } catch {
    return false;
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
  brain.setEnabled(loadConfig().roam !== false);

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

ipcMain.handle('config:set', (_e, cfg) => {
  const wasDetecting = loadConfig().detectApps !== false;
  saveConfig(cfg);
  if (cfg.detectApps === false) actions.setInstalledApps([]);
  else if (!wasDetecting) scanApps();
  const hotkeyOk = registerHotkey(cfg.hotkey || DEFAULTS.hotkey);
  orbWin?.webContents.send('config:changed');
  return { ok: true, hotkeyOk };
});

ipcMain.on('win:move', (_e, dx, dy) => {
  if (!orbWin) return;
  const [x, y] = orbWin.getPosition();
  orbWin.setBounds({ x: Math.round(x + dx), y: Math.round(y + dy), ...ORB_SIZE });
  brain?.onUserMove();
});
ipcMain.on('orb:drag', (_e, dragging) => {
  if (!brain) return;
  brain.dragging = !!dragging;
  brain.onUserMove();
});
ipcMain.on('orb:state', (_e, state) => brain?.setBusy(state !== 'idle' && state !== 'error'));
ipcMain.on('orb:interact', () => brain?.interact());

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

// Skin changes (menu or voice) are saved and sent straight to the robot, without the
// config:changed reload, so a conversation in progress isn't cut off.
function setSkin(name) {
  if (!SKIN_LABELS[name]) return;
  saveConfig({ skin: name });
  orbWin?.webContents.send('orb:skin', name);
}
ipcMain.on('orb:setSkin', (_e, name) => setSkin(name));

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
        saveConfig({ roam: item.checked });
      },
    },
    brain?.mode === 'sleep'
      ? { label: 'Wake up', click: () => brain?.interact() }
      : { label: 'Take a nap', click: () => brain?.sleepNow() },
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
    if (!cfg.apiKey) openSettings();
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
}
