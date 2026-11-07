const { app, BrowserWindow, ipcMain, globalShortcut, Menu, safeStorage, screen, session, shell, clipboard, desktopCapturer, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const actions = require('./actions');
const aw = require('./agent-watch');
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

// Hermes bridge WebSocket client
const BRIDGE_URL = 'ws://127.0.0.1:8765';
let bridgeWs = null;
let bridgeReconnectTimer = null;
let bridgeSessionId = 0;

function connectBridge() {
  console.log('[Orbit] connectBridge called');
  if (bridgeWs?.readyState === WebSocket.OPEN) return;
  try {
    console.log('[Orbit] Creating WebSocket connection to:', BRIDGE_URL);
    bridgeWs = new WebSocket(BRIDGE_URL);
    bridgeWs.onopen = () => {
      console.log('[Orbit] Connected to Hermes');
      bridgeWs.send(JSON.stringify({ type: 'status', connected: true, version: '1.0' }));
      if (bridgeReconnectTimer) { clearInterval(bridgeReconnectTimer); bridgeReconnectTimer = null; }
    };
    bridgeWs.onmessage = (ev) => handleBridgeMessage(ev.data);
    bridgeWs.onclose = () => {
      console.log('[Orbit] Disconnected, will retry...');
      bridgeWs = null;
      if (!bridgeReconnectTimer) bridgeReconnectTimer = setInterval(connectBridge, 3000);
    };
    bridgeWs.onerror = (e) => console.error('[Orbit] Error:', e.message);
  } catch (e) {
    console.error('[Orbit] Connection failed:', e.message);
    if (!bridgeReconnectTimer) bridgeReconnectTimer = setInterval(connectBridge, 3000);
  }
}

function handleBridgeMessage(data) {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  switch (msg.type) {
    case 'hello':
      console.log('[Bridge] Hello from Hermes:', msg);
      break;
    case 'puppet':
      handlePuppet(msg);
      break;
    case 'reply':
      orbWin?.webContents.send('hermes:reply', msg);
      break;
    case 'ping':
      bridgeWs?.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      break;
    default:
      console.log('[Bridge] Unknown message:', msg.type);
  }
}

function sendToBridge(obj) {
  if (bridgeWs?.readyState === WebSocket.OPEN) {
    bridgeWs.send(JSON.stringify(obj));
  }
}

function handlePuppet(msg) {
  try {
    const { action, payload, requestId } = msg;
    if (!orbWin || !brain) return;
    console.log('[Puppet] Received:', action, payload, 'requestId:', requestId);
    switch (action) {
      case 'move':
        orbWin.webContents.send('win:move', payload.dx || 0, payload.dy || 0);
        break;
      case 'color':
        orbWin.webContents.send('hermes:setColor', payload.state, payload.hex);
        break;
      case 'sleep':
        brain.sleepNow();
        break;
      case 'wake':
        brain.interact();
        break;
      case 'speak':
        orbWin.webContents.send('hermes:speak', payload.text);
        break;
      case 'bounce':
        orbWin.webContents.send('hermes:bounce');
        break;
      case 'roam':
        brain.setEnabled(payload.enabled !== false);
        break;
      case 'nyx:focusedWindow':
        console.log('[Puppet] Calling nyxFocusedWindow...');
        nyxFocusedWindow().then(r => {
          console.log('[Puppet] focusedWindow result:', r);
          sendToBridge({ type: 'nyx:result', action: 'focusedWindow', requestId, ...r });
        }).catch(e => {
          console.error('[Puppet] focusedWindow error:', e);
          sendToBridge({ type: 'nyx:result', action: 'focusedWindow', requestId, ok: false, error: e.message });
        });
        break;
      case 'nyx:listWindows':
        nyxListWindows().then(r => {
          console.log('[Puppet] listWindows result:', r);
          sendToBridge({ type: 'nyx:result', action: 'listWindows', requestId, ...r });
        }).catch(e => {
          console.error('[Puppet] listWindows error:', e);
          sendToBridge({ type: 'nyx:result', action: 'listWindows', requestId, ok: false, error: e.message });
        });
        break;
      case 'nyx:screenshot':
        nyxScreenshot(payload).then(r => {
          console.log('[Puppet] screenshot result:', r?.ok, r?.error);
          sendToBridge({ type: 'nyx:result', action: 'screenshot', requestId, ...r });
        }).catch(e => {
          console.error('[Puppet] screenshot error:', e);
          sendToBridge({ type: 'nyx:result', action: 'screenshot', requestId, ok: false, error: e.message });
        });
        break;
      case 'nyx:clipboard:read':
        nyxClipboardRead(payload?.format).then(r => {
          console.log('[Puppet] clipboard:read result:', r?.ok, r?.error);
          sendToBridge({ type: 'nyx:result', action: 'clipboard:read', requestId, ...r });
        }).catch(e => {
          console.error('[Puppet] clipboard:read error:', e);
          sendToBridge({ type: 'nyx:result', action: 'clipboard:read', requestId, ok: false, error: e.message });
        });
        break;
      case 'nyx:clipboard:write':
        nyxClipboardWrite(payload).then(r => {
          console.log('[Puppet] clipboard:write result:', r);
          sendToBridge({ type: 'nyx:result', action: 'clipboard:write', requestId, ...r });
        }).catch(e => {
          console.error('[Puppet] clipboard:write error:', e);
          sendToBridge({ type: 'nyx:result', action: 'clipboard:write', requestId, ok: false, error: e.message });
        });
        break;
      case 'nyx:system:vitals':
        nyxSystemVitals().then(r => {
          console.log('[Puppet] system:vitals result:', r?.ok, r?.error);
          sendToBridge({ type: 'nyx:result', action: 'system:vitals', requestId, ...r });
        }).catch(e => {
          console.error('[Puppet] system:vitals error:', e);
          sendToBridge({ type: 'nyx:result', action: 'system:vitals', requestId, ok: false, error: e.message });
        });
        break;
      case 'nyx:focusWindow':
        nyxFocusWindow(payload.windowId).then(r => {
          console.log('[Puppet] focusWindow result:', r);
          sendToBridge({ type: 'nyx:result', action: 'focusWindow', requestId, ...r });
        }).catch(e => {
          console.error('[Puppet] focusWindow error:', e);
          sendToBridge({ type: 'nyx:result', action: 'focusWindow', requestId, ok: false, error: e.message });
        });
        break;
      case 'nyx:ping':
        try {
          const result = { type: 'nyx:result', action: 'ping', requestId, ok: true, pong: true, timestamp: new Date().toISOString() };
          console.log('[Puppet] Sending ping result:', JSON.stringify(result));
          sendToBridge(result);
          console.log('[Puppet] Ping response sent successfully');
        } catch (e) {
          console.error('[Puppet] Ping error:', e);
        }
        break;
    }
  } catch (e) {
    console.error('[Puppet] Unhandled error:', e);
    if (msg.requestId) {
      sendToBridge({ type: 'nyx:result', action: msg.action, requestId: msg.requestId, ok: false, error: e.message });
    }
  }
}

// ---------- Nyx capabilities (direct main process calls) ----------

async function nyxFocusedWindow() {
  try {
    const wins = BrowserWindow.getAllWindows();
    const focused = wins.find(w => w.isFocused()) || wins[0];
    if (!focused || focused.isDestroyed()) return { ok: false, error: 'No window' };
    return {
      ok: true,
      title: focused.getTitle(),
      bounds: focused.getBounds(),
      isFocused: focused.isFocused(),
      isVisible: focused.isVisible(),
      isMinimized: focused.isMinimized(),
      isMaximized: focused.isMaximized(),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function nyxListWindows() {
  try {
    const wins = BrowserWindow.getAllWindows();
    return {
      ok: true,
      windows: wins.filter(w => !w.isDestroyed()).map(w => ({
        id: w.id,
        title: w.getTitle(),
        bounds: w.getBounds(),
        isFocused: w.isFocused(),
        isVisible: w.isVisible(),
        isMinimized: w.isMinimized(),
        isMaximized: w.isMaximized(),
        webContentsId: w.webContents.id,
      })),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function nyxScreenshot(opts = {}) {
  try {
    const { windowId, format = 'png' } = opts;
    let image;
    if (windowId) {
      const win = BrowserWindow.fromId(windowId);
      if (!win || win.isDestroyed()) return { ok: false, error: 'Window not found' };
      image = await win.capturePage();
    } else {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      if (!sources.length) return { ok: false, error: 'No screen source' };
      image = sources[0].thumbnail;
    }
    const data = format === 'png' ? image.toPNG().toString('base64') : image.toJPEG(85).toString('base64');
    return { ok: true, data, format, width: image.getSize().width, height: image.getSize().height };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function nyxClipboardRead(format = 'text') {
  try {
    let data;
    if (format === 'text') data = clipboard.readText();
    else if (format === 'html') data = clipboard.readHTML();
    else if (format === 'rtf') data = clipboard.readRTF();
    else if (format === 'image') {
      const img = clipboard.readImage();
      data = img.isEmpty() ? null : img.toPNG().toString('base64');
    } else data = clipboard.readText();
    return { ok: true, data, format };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function nyxClipboardWrite(data) {
  try {
    if (data.image) {
      const buf = Buffer.from(data.image, 'base64');
      const img = nativeImage.createFromBuffer(buf);
      clipboard.writeImage(img);
    } else if (data.html) {
      clipboard.writeHTML(data.html);
    } else if (data.rtf) {
      clipboard.writeRTF(data.rtf);
    } else if (data.text) {
      clipboard.writeText(data.text);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function nyxSystemVitals() {
  try {
    const os = require('os');
    const cpu = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    let battery = null;
    try {
      const { execSync } = require('child_process');
      const out = execSync('powershell -Command "Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,EstimatedRunTime | ConvertTo-Json"', { encoding: 'utf8' });
      const batteryData = JSON.parse(out);
      battery = { percent: batteryData.EstimatedChargeRemaining, minutesRemaining: batteryData.EstimatedRunTime };
    } catch {}
    return {
      ok: true,
      cpu: { cores: cpu.length, model: cpu[0]?.model, load: cpu.map(c => c.times) },
      memory: { total: totalMem, used: usedMem, free: freeMem, percent: Math.round(usedMem / totalMem * 100) },
      battery,
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function nyxFocusWindow(windowId) {
  try {
    const win = BrowserWindow.fromId(windowId);
    if (!win || win.isDestroyed()) return { ok: false, error: 'Window not found' };
    if (win.isMinimized()) win.restore();
    win.focus();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const DEFAULTS = {
  apiKey: '',
  model: 'gemini-3.8-live',
  voice: 'Puck',
  language: 'auto',
  language2: '',
  micLabel: '',
  speakerLabel: '',
  hotkey: 'Control+Space',
  roam: true,
  detectApps: true,
  skin: 'metallic',
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

ipcMain.handle('config:set', async (_e, cfg) => {
  const before = loadConfig();
  saveConfig(cfg);
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

// Nyx capabilities IPC handlers
ipcMain.handle('nyx:focusedWindow', async () => nyxFocusedWindow());
ipcMain.handle('nyx:listWindows', async () => nyxListWindows());
ipcMain.handle('nyx:screenshot', async (_e, opts) => nyxScreenshot(opts));
ipcMain.handle('nyx:clipboard:read', async (_e, format) => nyxClipboardRead(format));
ipcMain.handle('nyx:clipboard:write', async (_e, data) => nyxClipboardWrite(data));
ipcMain.handle('nyx:system:vitals', async () => nyxSystemVitals());
ipcMain.handle('nyx:focusWindow', async (_e, windowId) => nyxFocusWindow(windowId));

// Chat via Hermes bridge (forward to bridge)
ipcMain.on('chat', (_e, msg) => {
  if (bridgeWs?.readyState === WebSocket.OPEN) {
    bridgeWs.send(JSON.stringify({ type: 'chat', ...msg }));
  }
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

// ---------- AI agent watcher (Claude Code, Codex, Copilot, OpenCode, Antigravity, Hermes) ----------
// Agents send their hook events to a listener on 127.0.0.1: Claude Code directly (http hooks),
// the others through Orbit's bridge script or plugin. Alerts stay on this PC; permission requests
// get Allow/Deny buttons in a small card window, and fall back to the agent's own prompt.
const watch = new aw.Watch();
const pending = new Map(); // approval id → { res, timer, card, agent }
let claudeServer = null;
let approveWin = null;
let approveReady = false;
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
    // /claude/<token> from Claude Code, or /agent/<token>/<agent>/<event> from the bridge or plugin.
    const parts = (req.url || '').split('?')[0].split('/').filter(Boolean);
    let agent = null;
    let hookName = '';
    if (parts[0] === 'claude' && parts[1] === token && parts.length === 2) agent = 'claude';
    else if (parts[0] === 'agent' && parts[1] === token && aw.AGENTS[parts[2]] && parts.length <= 4) {
      [agent, hookName = ''] = [parts[2], parts[3]];
    }
    if (req.method !== 'POST' || !agent) return reply(404);
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
      try {
        evt = aw.normalize(agent, hookName, evt);
        if (!evt) return reply(200);
        if (evt.hook_event_name === 'PermissionRequest' && aw.AGENTS[agent].approve) {
          // Plan reviews and questions need the user's own answer, never a bare "allow".
          if (!aw.NEEDS_OWN_ANSWER.has(evt.tool_name)) return askApproval(evt, res);
          evt = { ...evt, hook_event_name: 'Notification', notification_type: 'permission_prompt' };
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

function askApproval(evt, res) {
  watch.add(evt); // remembered for the summary and to skip the matching notification
  const id = nextApprovalId++;
  const who = aw.AGENTS[evt.agent]?.label || 'Claude';
  const card = {
    id,
    who,
    project: path.basename(String(evt.cwd || '')) || who,
    tool: String(evt.tool_name || 'a tool'),
    detail: aw.toolDetail(evt.tool_name, evt.tool_input),
    until: Date.now() + aw.APPROVE_WAIT_SECS * 1000,
  };
  const timer = setTimeout(() => settleApproval(id, null), aw.APPROVE_WAIT_SECS * 1000);
  pending.set(id, { res, timer, card, agent: evt.agent || 'claude' });
  // Answered in the terminal or the agent stopped: drop the card.
  res.on('close', () => settleApproval(id, null, true));
  brain?.interact();
  brain?.flash('alert', 2);
  orbWin?.webContents.send('claude:event', {
    kind: 'input',
    urgent: true,
    say: `${who} asks to use ${card.tool} in ${card.project}`,
    caption: `${card.project}: ${card.tool} — ${card.detail}`,
    project: card.project,
  });
  showApprovalCards();
}

/** behavior: 'allow' | 'deny' | null (null = let Claude Code show its own prompt). */
function settleApproval(id, behavior, closed = false) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  if (!closed && !p.res.writableEnded) {
    p.res.writeHead(200, { 'Content-Type': 'application/json' });
    p.res.end(JSON.stringify(aw.reply(p.agent, behavior)));
  }
  showApprovalCards();
}

function showApprovalCards() {
  const cards = [...pending.values()].map((p) => p.card);
  if (!cards.length) return approveWin?.isDestroyed() === false && approveWin.hide();
  if (!approveWin || approveWin.isDestroyed()) {
    approveReady = false;
    approveWin = new BrowserWindow({
      width: 320,
      height: 170,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false, // never steal focus (or a stray Enter) from the terminal
      show: false,
      backgroundColor: '#12121a',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    approveWin.setAlwaysOnTop(true, 'floating');
    approveWin.loadFile(path.join(__dirname, 'renderer', 'approve.html'));
    approveWin.webContents.once('did-finish-load', () => {
      approveReady = true;
      showApprovalCards();
    });
    approveWin.on('closed', () => (approveWin = null));
    return;
  }
  if (!approveReady) return;
  // Beside the robot: left of it, or right if there's no room; inside the screen.
  const [ox, oy] = orbWin ? orbWin.getPosition() : [0, 0];
  const wa = screen.getDisplayNearestPoint({ x: ox, y: oy }).workArea;
  const x = ox - 330 >= wa.x ? ox - 330 : Math.min(ox + ORB_SIZE.width + 10, wa.x + wa.width - 320);
  const y = Math.max(wa.y, Math.min(oy, wa.y + wa.height - 170));
  approveWin.setBounds({ x, y, width: 320, height: 170 });
  approveWin.webContents.send('claude:cards', { cards, now: Date.now() });
  if (!approveWin.isVisible()) approveWin.showInactive();
}

// Only the card window can approve: the Gemini (robot) window never can.
ipcMain.on('claude:decide', (e, id, behavior) => {
  if (!approveWin || e.sender !== approveWin.webContents) return;
  if (!['allow', 'deny', 'terminal'].includes(behavior)) return;
  settleApproval(id, behavior === 'terminal' ? null : behavior);
});

ipcMain.handle('claude:status', () => {
  const summary = watch.summary(); // secret-filtered
  appendLog('action', `agent_status → ${summary}`);
  return { ok: true, summary };
});

const claudeSettingsPath = () => path.join(os.homedir(), '.claude', 'settings.json');

/** Add or remove Orbit's hook entries in ~/.claude/settings.json; other settings stay untouched. */
function installClaudeHooks(on) {
  const file = claudeSettingsPath();
  let settings = {};
  if (fs.existsSync(file)) {
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch {
      throw new Error("couldn't read ~/.claude/settings.json, so Orbit left it unchanged");
    }
    if (!fs.existsSync(file + '.orbit-backup')) fs.copyFileSync(file, file + '.orbit-backup'); // keep the original
  } else if (!on) return;
  const next = on ? aw.withOrbitHooks(settings, claudeUrl()) : aw.withoutOrbitHooks(settings);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}

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

/** Back up, transform and atomically rewrite an agent's config file. Never overwrites a file it can't read. */
function editConfig(file, transform, json = true) {
  let text = '';
  if (fs.existsSync(file)) {
    text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    if (!fs.existsSync(file + '.orbit-backup')) fs.copyFileSync(file, file + '.orbit-backup'); // keep the original
  }
  let data = text;
  if (json) {
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`couldn't read ${file}, so Orbit left it unchanged`);
    }
  }
  const next = transform(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', json ? JSON.stringify(next, null, 2) + '\n' : next);
  fs.renameSync(file + '.tmp', file);
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
    editConfig(file, (c) => (on ? add(c, script) : remove(c)), json);
  };
  switch (id) {
    case 'claude':
      return installClaudeHooks(on);
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
    syncListener(); // hooks were installed when each agent was turned on
    if (!cfg.apiKey) openSettings();

    // Connect to Hermes bridge
    connectBridge();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopClaudeServer(); // pending approvals fall back to Claude Code's own prompt
  });
}
