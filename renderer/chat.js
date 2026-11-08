// Agent chat window: the conversation from the agent's own transcript (main reads it, secrets
// hidden), what it's waiting for, and your reply. What "Send" does depends on the moment:
//   - a permission request: Deny, with your message as what the agent should do instead
//   - a question: your own answer (or click one of its options)
//   - an agent asking over MCP: your answer
//   - otherwise, while it works: a message it gets when it next stops or checks Orbit
const $ = (id) => document.getElementById(id);
let data = null;
let shownCount = -1;
let requestId = null;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (label, cls, onClick) => {
  const b = el('button', `act ${cls || ''}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};
const decide = (behavior, extra) => window.orbit.claudeDecide(data.request.id, behavior, extra);

function renderLog() {
  const log = $('log');
  const msgs = data.messages || [];
  if (msgs.length === shownCount) return; // nothing new: keep your scroll position
  // stay at the newest message unless you've scrolled up to read (a new conversation starts at the end)
  const atBottom = shownCount < 0 || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  shownCount = msgs.length;
  log.textContent = '';
  if (!msgs.length) {
    log.append(
      el(
        'div',
        'empty',
        data.session?.hasTranscript
          ? 'No messages yet.'
          : 'This agent doesn’t share its conversation with Orbit. You can still answer its requests here.',
      ),
    );
    return;
  }
  for (const m of msgs) log.append(el('div', `msg ${m.role}`, m.text));
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function renderRequest() {
  const box = $('request');
  const r = data.request;
  box.hidden = !r;
  if (!r) return void (requestId = null);
  if (r.id === requestId) return void tick(); // same request: just the countdown
  requestId = r.id;
  box.textContent = '';
  const title = el('h3');
  title.append(
    el('b', '', r.kind === 'question' || r.kind === 'ask' ? `${r.who} asks you` : `${r.who} wants to use ${r.tool}`),
  );
  title.append(el('span', '', '')); // countdown
  box.append(title);
  if (r.kind === 'permission') {
    box.append(el('pre', '', r.full));
    const row = el('div', 'row');
    if (!r.secret) row.append(button('Allow', 'allow', () => decide('allow')));
    row.append(button('Deny', 'deny', () => decide('deny')));
    box.append(row);
    if (r.secret)
      box.append(el('div', 'note', 'Part of this is hidden (a key or password), so allow it in the terminal.'));
  } else if (r.kind === 'question') {
    for (const q of r.questions || []) {
      box.append(el('div', '', q.question));
      const row = el('div', 'row');
      row.style.margin = '6px 0 8px';
      for (const o of q.options || [])
        row.append(button(o.label, '', () => decide('allow', { answers: { [q.question]: o.label } })));
      box.append(row);
    }
  } else if (r.kind === 'ask') {
    box.append(el('div', '', r.full));
  }
  tick();
}

function tick() {
  const r = data?.request;
  const span = $('request').querySelector('h3 span');
  if (r && span) span.textContent = `${Math.max(0, Math.ceil((r.until - Date.now()) / 1000))}s`;
}

function renderComposer() {
  const r = data.request;
  const s = data.session;
  const who = r?.who || s?.who || 'the agent';
  let placeholder;
  let hint;
  let enabled = true;
  if (r?.kind === 'permission') {
    placeholder = `Or tell ${who} what to do instead…`;
    hint = 'Sending denies this request with your message, and the agent carries on with it.';
  } else if (r?.kind === 'question') {
    placeholder = 'Or type your own answer…';
    hint = 'Your answer goes straight back to the agent.';
  } else if (r?.kind === 'ask') {
    placeholder = 'Your answer…';
    hint = 'Your answer goes straight back to the agent.';
  } else if (s?.working) {
    placeholder = `Message ${who}…`;
    hint = s.waiting
      ? `${s.waiting} message${s.waiting > 1 ? 's' : ''} waiting: ${who} gets ${s.waiting > 1 ? 'them' : 'it'} when it next pauses.`
      : `${who} is working: it gets your message when it next pauses or checks Orbit.`;
  } else {
    enabled = false;
    placeholder = s ? `${who} is waiting in its terminal` : 'No agent conversation yet';
    hint = s
      ? 'Orbit can pass messages only while the agent works or when it asks you. Reply in its terminal for now.'
      : '';
  }
  $('input').placeholder = placeholder;
  $('input').disabled = !enabled;
  $('send').disabled = !enabled;
  $('hint').textContent = hint;
}

window.orbit.onChat((d) => {
  const sessionChanged = d.session?.key !== data?.session?.key;
  data = d;
  if (sessionChanged) shownCount = -1;
  $('who').textContent = d.request?.who || d.session?.who || 'Agent';
  $('project').textContent = d.session?.project || '';
  $('status').textContent = d.request ? 'needs you' : d.session?.working ? 'working' : d.session ? 'waiting' : '';
  const sel = $('sessions');
  sel.hidden = (d.sessions || []).length < 2;
  sel.textContent = '';
  for (const s of d.sessions || []) {
    const o = el('option', '', `${s.who} · ${s.project}`);
    o.value = s.key;
    o.selected = s.key === d.session?.key;
    sel.append(o);
  }
  renderLog();
  renderRequest();
  renderComposer();
});

async function send() {
  const text = $('input').value.trim();
  if (!text || !data) return;
  const r = data.request;
  if (r?.kind === 'permission') decide('deny', { message: text });
  else if (r?.kind === 'question') {
    const q = r.questions?.[0]?.question;
    if (q) decide('allow', { answers: { [q]: text } });
  } else if (r?.kind === 'ask') decide('allow', { message: text });
  else if (data.session?.working) await window.orbit.chatSend(data.session.key, text);
  else return;
  $('input').value = '';
  $('input').style.height = '';
}

$('send').addEventListener('click', send);
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$('input').addEventListener('input', (e) => {
  e.target.style.height = '';
  e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
});
$('sessions').addEventListener('change', (e) => window.orbit.openChat(e.target.value));
$('close').addEventListener('click', () => window.orbit.closeChat());
setInterval(tick, 500);
