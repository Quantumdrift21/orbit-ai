// Approval card for Claude Code permission requests. Shows the first waiting request;
// buttons send the decision to the main process (which only accepts it from this window).
const $ = (id) => document.getElementById(id);
const buttons = ['allow', 'deny', 'terminal'].map($);
let card = null;
let clock = 0; // main's clock minus ours, so the countdown matches the real deadline
let shownAt = 0;

function render() {
  if (!card) return;
  const left = Math.max(0, Math.ceil((card.until - (Date.now() + clock)) / 1000));
  $('project').textContent = card.project;
  $('title').textContent = `${card.who || 'Claude'} wants to use ${card.tool}`;
  $('detail').textContent = card.detail;
  // Cut short or partly hidden: it can't be checked here, so only Deny or the terminal.
  $('allow').hidden = !!card.partial;
  $('terminal').textContent = card.partial ? 'Check in terminal' : 'Use terminal';
  $('count').textContent = `${card.of > 1 ? `1 of ${card.of} · ` : ''}${left}s`;
}

window.orbit.onClaudeCards(({ cards, now }) => {
  clock = now - Date.now();
  const first = cards[0];
  if (first && first.id !== card?.id) shownAt = Date.now(); // a new card: ignore clicks for a moment
  card = first ? { ...first, of: cards.length } : null;
  render();
});

for (const b of buttons) {
  b.addEventListener('click', () => {
    // A card that pops up under the mouse must not be approved by accident.
    if (!card || Date.now() - shownAt < 600) return;
    window.orbit.claudeDecide(card.id, b.id);
  });
}

setInterval(render, 500);
