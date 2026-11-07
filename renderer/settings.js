const fields = ['apiKey', 'model', 'voice', 'language', 'micLabel', 'speakerLabel', 'hotkey', 'systemPrompt'];
const $ = (id) => document.getElementById(id);

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
  for (const f of fields) if ($(f).tagName !== 'SELECT' || !f.endsWith('Label')) $(f).value = cfg[f] ?? '';
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
  for (const f of fields) cfg[f] = $(f).value.trim();
  const msg = $('msg');
  if (!cfg.apiKey) {
    msg.className = 'warn';
    msg.textContent = 'Please paste your API key';
    return;
  }
  const res = await window.orbit.setConfig(cfg);
  msg.className = res.hotkeyOk ? '' : 'warn';
  msg.textContent = res.hotkeyOk ? 'Saved ✓' : 'Saved, but hotkey is invalid or in use';
  if (res.hotkeyOk) setTimeout(() => window.orbit.closeSettings(), 700);
});
