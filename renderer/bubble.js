// Subtitle bubble for agent alerts: shows what the alert voice says, word by word, timed to the
// speech. The main process places this window beside the robot and hides it when the speech ends.
// For a request that needs your answer it also carries the buttons: Allow / Deny (a permission),
// the answers (a question), Reply (an agent asking over MCP), and Chat (the conversation, to read
// the context and type a reply). Main only accepts answers from this window and the chat.
const $ = (id) => document.getElementById(id);
const ACCENTS = {
  done: '61, 255, 168',
  input: '255, 196, 77',
  error: '255, 77, 94',
  agent: '56, 217, 255',
  task: '167, 123, 255',
};
let shown = ''; // what's on screen, so a repeat of the same bubble doesn't replay its entrance
let req = null;
let armedAt = 0; // a bubble that appears under your mouse can't be clicked by accident
let clock = null;

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', () => {
    if (Date.now() - armedAt < 600) return;
    onClick();
  });
  return b;
}

function actions(b) {
  const box = $('actions');
  box.textContent = '';
  const decide = (behavior, extra) => window.orbit.claudeDecide(req.id, behavior, extra);
  if (req?.kind === 'permission' || req?.kind === 'confirm') {
    if (!req.partial) box.append(button('Allow', 'allow', () => decide('allow')));
    box.append(button('Deny', 'deny', () => decide('deny')));
  } else if (req?.kind === 'question' && req.options?.length) {
    for (const label of req.options.slice(0, 4))
      box.append(button(label, '', () => decide('allow', { answers: { [req.question]: label } })));
  }
  if (req ? req.chat : b.session)
    box.append(button(req?.kind === 'ask' ? 'Reply ›' : 'Chat ›', 'chat', () => window.orbit.openChat(b.session)));
}

function tick() {
  $('count').textContent = req
    ? `${req.of > 1 ? `1 of ${req.of} · ` : ''}${Math.max(0, Math.ceil((req.until - Date.now()) / 1000))}s`
    : '';
}

window.orbit.onBubble((b) => {
  const bubble = $('bubble');
  if (!b) {
    shown = '';
    req = null;
    clearInterval(clock);
    return bubble.classList.remove('show');
  }
  req = b.request ? { ...b.request, of: b.of || 1, question: b.request.question } : null;
  document.documentElement.style.setProperty('--accent', ACCENTS[b.kind] || ACCENTS.agent);
  $('stage').className = `stage ${b.side === 'right' ? 'right' : 'left'}`;
  $('who').textContent = b.who || 'Agent';
  $('project').textContent = b.project || '';
  $('detail').hidden = !req?.detail || req.kind === 'question' || req.kind === 'ask';
  $('detail').textContent = req?.detail || '';
  actions(b);
  clearInterval(clock);
  if (req) clock = setInterval(tick, 500);
  tick();
  const key = `${b.text}|${req?.id ?? ''}`;
  if (key === shown) return; // same bubble (the voice caught up): just refresh the buttons
  shown = key;
  armedAt = Date.now();
  const words = String(b.text).split(/(\s+)/).filter(Boolean);
  const spoken = words.filter((w) => w.trim()).length || 1;
  const step = Math.max(0.06, Math.min(0.45, (Number(b.secs) || spoken * 0.38) / spoken)); // seconds per word
  const text = $('text');
  text.textContent = '';
  let i = 0;
  for (const w of words) {
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = w;
    if (w.trim()) span.style.animationDelay = `${(i++ * step).toFixed(2)}s`;
    text.append(span);
  }
  bubble.classList.remove('show');
  void bubble.offsetWidth; // restart the entrance
  bubble.classList.add('show');
});

// Clicks land on the bubble only while the mouse is over it; elsewhere they go to the desktop.
$('bubble').addEventListener('mouseenter', () => window.orbit.bubbleHover(true));
$('bubble').addEventListener('mouseleave', () => window.orbit.bubbleHover(false));
