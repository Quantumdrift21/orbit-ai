// PC actions Gemini may call. Deliberately limited: apps from a fixed list or the user's own Start
// menu, and http(s) URLs. Nothing the model says is ever passed to a shell: its text only selects
// an entry, and the entry's own target is launched.
const { shell } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const env = process.env;
const firstExisting = (...paths) => paths.find((p) => p && fs.existsSync(p));

const BROWSERS = {
  chrome: () =>
    firstExisting(
      path.join(env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    ),
  edge: () =>
    firstExisting(
      path.join(env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
      path.join(env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    ),
  brave: () =>
    firstExisting(
      path.join(env.ProgramFiles || '', 'BraveSoftware/Brave-Browser/Application/brave.exe'),
      path.join(env.LOCALAPPDATA || '', 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    ),
  firefox: () =>
    firstExisting(
      path.join(env.ProgramFiles || '', 'Mozilla Firefox/firefox.exe'),
      path.join(env['ProgramFiles(x86)'] || '', 'Mozilla Firefox/firefox.exe'),
    ),
};

// name → fixed target for `start` (exe on PATH/App Paths, or a protocol URI)
const APPS = {
  chrome: 'chrome',
  edge: 'msedge',
  brave: 'brave',
  firefox: 'firefox',
  notepad: 'notepad',
  calculator: 'calc',
  'file explorer': 'explorer',
  paint: 'mspaint',
  settings: 'ms-settings:',
  'task manager': 'taskmgr',
  'command prompt': 'cmd',
  powershell: 'powershell',
  terminal: 'wt',
  'vs code': 'code',
  spotify: 'spotify:',
  whatsapp: 'whatsapp:',
  steam: 'steam:',
  'obs studio': 'obs64',
  vlc: 'vlc',
  camera: 'microsoft.windows.camera:',
  photos: 'ms-photos:',
  discord: 'discord:',
  telegram: 'telegram:',
  blender: 'blender',
};

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// ---------- apps found in the user's Start menu ----------
// The list stays on this PC: Gemini only sends the name the user said, and it is matched here.
let installed = []; // [{ name, key, appId }]

// Never offered even if installed: tools that can wipe or reconfigure the PC, and doc/help links.
const SKIP =
  /uninstall|registry editor|powershell|recovery drive|\b(help|readme|read me|documentation|manual|release notes|license|on the web|website)\b/i;

/** Parse `Get-StartApps | ConvertTo-Json` output into launchable, de-duplicated entries. */
function parseStartApps(json) {
  const list = [].concat(JSON.parse(String(json).replace(/^﻿/, '').trim() || '[]'));
  const seen = new Set();
  const out = [];
  for (const { Name, AppID } of list) {
    if (!Name || !AppID || SKIP.test(Name) || /\.(chm|txt|url|pdf|html?)$/i.test(AppID)) continue;
    const key = norm(Name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: Name, key, appId: AppID });
  }
  return out;
}

/** Re-read the Start menu (takes a few seconds). Resolves to the number of apps found. */
function scanStartApps() {
  const cmd =
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress';
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { windowsHide: true, timeout: 30000, maxBuffer: 8 << 20 },
      (err, stdout) => {
        try {
          if (!err) installed = parseStartApps(stdout);
        } catch {
          /* keep the previous list */
        }
        resolve(installed.length);
      },
    );
  });
}

const setInstalledApps = (list) => (installed = list);
const installedCount = () => installed.length;

/** Match what the user said to one app: exact name, else a unique whole-word match. */
function findApp(query) {
  const q = norm(query);
  if (q.length < 2) return { error: 'No app name given' };
  const all = [...Object.keys(APPS).map((k) => ({ name: k, key: norm(k), builtin: true })), ...installed];
  const exact = all.find((a) => a.key === q);
  if (exact) return { app: exact };
  const hits = all.filter((a) => ` ${a.key} `.includes(` ${q} `));
  const starts = hits.filter((a) => a.key.startsWith(q));
  if (hits.length === 1) return { app: hits[0] };
  if (starts.length === 1) return { app: starts[0] };
  if (hits.length)
    return { error: `"${query}" matches several apps`, suggestions: hits.slice(0, 5).map((a) => a.name) };
  const near = all.filter((a) => a.key.startsWith(q.slice(0, 3))).slice(0, 5);
  return { error: `No app called "${query}" is installed`, suggestions: near.map((a) => a.name) };
}

function launch(exe, args = [], verbatim = false) {
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim });
  child.on('error', () => {});
  child.unref();
}

function openApp({ app } = {}) {
  const found = findApp(app);
  if (!found.app) {
    return { ok: false, error: found.error, ...(found.suggestions?.length ? { suggestions: found.suggestions } : {}) };
  }
  if (!found.app.builtin) {
    // Windows' own launcher for Start-menu entries; the ID comes from Windows, never from the model.
    launch('explorer.exe', [`shell:AppsFolder\\${found.app.appId}`]);
    return { ok: true, opened: found.app.name };
  }
  const name = found.app.name;
  if (BROWSERS[name]) {
    const exe = BROWSERS[name]();
    if (exe) {
      launch(exe);
      return { ok: true, opened: name };
    }
    shell.openExternal('https://www.google.com');
    return {
      ok: true,
      opened: 'default browser',
      note: `${name} is not installed, so the default browser was opened instead`,
    };
  }
  // Target is a constant from APPS, never model text.
  launch('cmd.exe', ['/d', '/c', `start "" ${APPS[name]}`], true);
  return { ok: true, opened: name };
}

function openWebsite({ url, browser = 'default' } = {}) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Only http(s) URLs are allowed' };
  const wanted = String(browser).toLowerCase();
  const exe = BROWSERS[wanted]?.();
  if (exe) {
    launch(exe, [u.href]); // no shell: the URL is a single argv entry
    return { ok: true, opened: u.href, browser: wanted };
  }
  shell.openExternal(u.href);
  const result = { ok: true, opened: u.href, browser: 'default' };
  if (BROWSERS[wanted]) result.note = `${wanted} is not installed, so it was opened in the default browser instead`;
  return result;
}

function run(name, args) {
  try {
    if (name === 'open_app') return openApp(args);
    if (name === 'open_website') return openWebsite(args);
    return { ok: false, error: `Unknown action ${name}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { run, scanStartApps, parseStartApps, setInstalledApps, installedCount, findApp };
