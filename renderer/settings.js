import { LANGUAGES } from './languages.js';

const fields = [
  'apiKey',
  'model',
  'voice',
  'skin',
  'language',
  'language2',
  'detectApps',
  'browserControl',
  'alertVoice',
  'watchClaude',
  'watchCodex',
  'watchCopilot',
  'watchOpencode',
  'watchAntigravity',
  'watchHermes',
  'micLabel',
  'speakerLabel',
  'hotkey',
  'systemPrompt',
];
const $ = (id) => document.getElementById(id);
const read = (el) => (el.type === 'checkbox' ? el.checked : el.value.trim());
const write = (el, v) => (el.type === 'checkbox' ? (el.checked = v !== false) : (el.value = v ?? ''));

// ---------- languages: English name plus the language's own name, e.g. "Tamil — தமிழ்" ----------
for (const [code, name] of LANGUAGES) {
  let native = '';
  try {
    native = new Intl.DisplayNames([code], { type: 'language' }).of(code);
  } catch {
    /* no local name known */
  }
  const label = native && native.toLowerCase() !== name.toLowerCase() ? `${name} — ${native}` : name;
  $('language').add(new Option(label, code));
  $('language2').add(new Option(label, code));
}
$('languageHint').textContent =
  `${LANGUAGES.length} languages. Orbit replies only in the languages you pick here, so if it mishears you ` +
  'as a similar-sounding language it still answers in yours. Auto works for anyone but can be fooled that way.';

// ---------- installed apps ----------
async function showAppsInfo(promise = window.orbit.appsInfo()) {
  const info = await promise;
  $('appsInfo').textContent = info.scanning ? 'Scanning…' : `${info.count} apps found.`;
}
$('rescan').addEventListener('click', (e) => {
  e.preventDefault();
  $('appsInfo').textContent = 'Scanning…';
  showAppsInfo(window.orbit.rescanApps());
});
showAppsInfo();

// ---------- AI agents: mark what each supports, grey out ones that aren't installed ----------
Promise.all([window.orbit.agentsInfo(), window.orbit.getConfig()]).then(([info, cfg]) => {
  for (const a of Object.values(info)) {
    const box = $(a.flag);
    if (!box) continue;
    const note = box.parentElement.querySelector('.hint');
    note.textContent = !a.installed ? '(not installed)' : a.approve ? '(alerts + Allow/Deny)' : '(alerts)';
    if (!a.installed && !cfg[a.flag]) box.disabled = true; // still lets you turn off one that was on
  }
});

// ---------- natural alert voice (Kokoro, voice.js): downloaded only when you click ----------
const voiceHint = $('voiceHint');
const showVoice = ({ downloaded }) => {
  $('voiceDownload').hidden = downloaded;
  if (downloaded) voiceHint.textContent = 'Natural offline voice (Kokoro) is ready for alerts.';
};
window.orbit.voiceStatus().then(showVoice);
window.orbit.onVoiceProgress((p) => (voiceHint.textContent = `Downloading the voice… ${p}%`));
$('voiceDownload').addEventListener('click', async () => {
  $('voiceDownload').disabled = true;
  voiceHint.textContent = 'Downloading the voice…';
  const r = await window.orbit.voiceDownload();
  $('voiceDownload').disabled = false;
  if (r.ok) showVoice({ downloaded: true });
  else voiceHint.textContent = `Download failed: ${r.error}`;
});

// ---------- audio devices ----------
// Devices are saved by name (label) so the choice survives reboots / re-plugging.
async function loadDevices(cfg) {
  try {
    // Labels are only visible after mic permission has been granted once.
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    /* still list what we can */
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const fill = (select, kind, saved) => {
    const names = [
      ...new Set(
        devices
          .filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label)
          .map((d) => d.label),
      ),
    ];
    for (const name of names) select.add(new Option(name, name));
    if (saved && !names.includes(saved)) select.add(new Option(`${saved} (not connected)`, saved));
    select.value = saved || '';
  };
  fill($('micLabel'), 'audioinput', cfg.micLabel);
  fill($('speakerLabel'), 'audiooutput', cfg.speakerLabel);
  return devices;
}

const deviceId = (devices, kind, label) => devices.find((d) => d.kind === kind && d.label === label)?.deviceId;

// Live level meter for the selected mic
let meter = null;
async function startMeter(devices) {
  meter?.stop();
  const label = $('micLabel').value;
  const id = label ? deviceId(devices, 'audioinput', label) : undefined;
  const hint = $('micHint');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true });
  } catch (e) {
    hint.textContent = `Can't open this mic (${e.name}).`;
    hint.className = 'hint bad';
    return;
  }
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  const started = performance.now();
  let raf;
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    $('meterFill').style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 600)}%`;
    if (performance.now() - started > 2500) {
      const silent = peak < 0.0005;
      hint.textContent = silent
        ? 'No sound at all from this mic – it may be a virtual or muted device. Pick another.'
        : 'Speak – the bar should move.';
      hint.className = silent ? 'hint bad' : 'hint';
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
  meter = {
    stop: () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}

async function testSpeaker(devices) {
  const label = $('speakerLabel').value;
  const ctx = new AudioContext();
  const id = label ? deviceId(devices, 'audiooutput', label) : undefined;
  if (id && ctx.setSinkId) await ctx.setSinkId(id).catch(() => {});
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((f, i) => {
    // little C-E-G chime
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0, now + i * 0.12);
    g.gain.linearRampToValueAtTime(0.25, now + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * 0.12);
    o.stop(now + i * 0.12 + 0.55);
  });
  setTimeout(() => ctx.close(), 1200);
}

(async () => {
  const cfg = await window.orbit.getConfig();
  for (const f of fields) if ($(f).tagName !== 'SELECT' || !f.endsWith('Label')) write($(f), cfg[f]);
  const devices = await loadDevices(cfg);
  startMeter(devices);
  $('micLabel').addEventListener('change', () => startMeter(devices));
  $('testSpeaker').addEventListener('click', () => testSpeaker(devices));
})();

// ---------- form ----------
$('reveal').addEventListener('click', () => {
  const k = $('apiKey');
  k.type = k.type === 'password' ? 'text' : 'password';
  $('reveal').textContent = k.type === 'password' ? 'Show' : 'Hide';
});

$('cancel').addEventListener('click', () => window.orbit.closeSettings());
window.addEventListener('beforeunload', () => meter?.stop());

$('save').addEventListener('click', async () => {
  const cfg = {};
  for (const f of fields) cfg[f] = read($(f));
  const msg = $('msg');
  if (!cfg.apiKey) {
    msg.className = 'warn';
    msg.textContent = 'Please paste your API key';
    return;
  }
  const res = await window.orbit.setConfig(cfg);
  // A failed agent install is switched back off: show the boxes as they really are.
  const saved = await window.orbit.getConfig();
  for (const f of fields) if ($(f).type === 'checkbox') write($(f), saved[f]);
  const warn = !res.hotkeyOk
    ? 'Saved, but hotkey is invalid or in use'
    : res.claudeError
      ? `Saved, but watching failed: ${res.claudeError}`
      : '';
  msg.className = warn ? 'warn' : '';
  msg.textContent = warn || 'Saved ✓';
  if (!warn) setTimeout(() => window.orbit.closeSettings(), 700);
});
