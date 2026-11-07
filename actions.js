// PC actions Gemini may call. Deliberately limited: a fixed list of apps and http(s) URLs only,
// and nothing the model says is ever passed to a shell.
const { shell } = require('electron');
const { spawn } = require('child_process');
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
};

// name → fixed target for `start` (exe on PATH/App Paths, or a protocol URI)
const APPS = {
  chrome: 'chrome',
  edge: 'msedge',
  brave: 'brave',
  notepad: 'notepad',
  calculator: 'calc',
  'file explorer': 'explorer',
  paint: 'mspaint',
  settings: 'ms-settings:',
  'task manager': 'taskmgr',
  'command prompt': 'cmd',
  'vs code': 'code',
  spotify: 'spotify:',
  whatsapp: 'whatsapp:',
  steam: 'steam:',
  'obs studio': 'obs64',
  vlc: 'vlc',
  camera: 'microsoft.windows.camera:',
  photos: 'ms-photos:',
};

const APP_NAMES = Object.keys(APPS);

function launch(exe, args = [], verbatim = false) {
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim });
  child.on('error', () => {});
  child.unref();
}

function openApp({ app } = {}) {
  const name = String(app || '')
    .toLowerCase()
    .trim();
  if (!APPS[name]) return { ok: false, error: `Unknown app "${app}". Allowed: ${APP_NAMES.join(', ')}` };
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

module.exports = { run, APP_NAMES };
