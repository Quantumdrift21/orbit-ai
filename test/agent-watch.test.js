// Claude Code watcher: secret hiding, event → alert rules, hook entries. Run: npm test
// Fake keys are assembled at runtime so GitHub's secret scanning doesn't flag this file.
const test = require('node:test');
const assert = require('node:assert');
const cw = require('../agent-watch');

const FAKE = {
  google: 'AI' + 'za' + 'Sy' + 'x'.repeat(33),
  openai: 'sk' + '-ant-' + 'a1b2c3d4'.repeat(3),
  github: 'gh' + 'p_' + 'A1b2C3d4'.repeat(4),
  aws: 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
  slack: 'xo' + 'xb-' + '123456789012-abc',
  jwt: 'ey' + 'JhbGciOiJIUzI1NiJ9.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0.' + 'abc123def456',
  pem: '-----BEGIN ' + 'PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END ' + 'PRIVATE KEY-----',
};

test('secrets are hidden, ordinary text is not', () => {
  for (const [name, key] of Object.entries(FAKE)) {
    const out = cw.hideSecrets(`before ${key} after`);
    assert.ok(!out.includes(key.slice(4, 14)), name);
    assert.match(out, /\[hidden\]/, name);
  }
  assert.strictEqual(cw.hideSecrets('password: hunter2'), '[hidden]');
  assert.strictEqual(cw.hideSecrets('DB_PASSWORD=hunter2 ok'), '[hidden] ok');
  const plain = 'Fixed the login bug in auth.js and ran npm test: 12 passed.';
  assert.strictEqual(cw.hideSecrets(plain), plain);
});

test('approval replies have the exact shape Claude Code expects', () => {
  assert.deepStrictEqual(cw.decision('allow'), {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  });
  assert.deepStrictEqual(cw.decision('deny').hookSpecificOutput.decision, {
    behavior: 'deny',
    message: 'Denied from Orbit',
  });
  assert.deepStrictEqual(cw.decision(null), {}); // "show Claude Code's own prompt"
  assert.deepStrictEqual(cw.decision('rm -rf'), {});
});

test('tool detail picks the command or file and hides secrets', () => {
  assert.strictEqual(cw.toolDetail('Bash', { command: 'npm test' }), 'npm test');
  assert.strictEqual(cw.toolDetail('Edit', { file_path: 'C:\\x\\app.js' }), 'C:\\x\\app.js');
  assert.ok(!cw.toolDetail('Bash', { command: `curl -H "x: ${FAKE.google}"` }).includes(FAKE.google));
});

test("editConfig: never overwrites a file it can't read, backs up the original once", () => {
  const fs = require('fs');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'orbit-cfg-'));
  try {
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ "hooks": [ oops');
    assert.throws(() => cw.editConfig(broken, () => ({ replaced: true })), /left it unchanged/);
    assert.strictEqual(fs.readFileSync(broken, 'utf8'), '{ "hooks": [ oops');

    const good = path.join(dir, 'settings.json');
    fs.writeFileSync(good, '﻿{"theme":"dark"}'); // with a BOM, as Windows tools write it
    cw.editConfig(good, (c) => ({ ...c, a: 1 }));
    cw.editConfig(good, (c) => ({ ...c, b: 2 }));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(good, 'utf8')), { theme: 'dark', a: 1, b: 2 });
    assert.strictEqual(fs.readFileSync(good + '.orbit-backup', 'utf8'), '﻿{"theme":"dark"}'); // the first original
    assert.ok(!fs.existsSync(good + '.tmp'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('approval card: shows the whole command, or marks it partial so Allow is not offered', () => {
  assert.deepStrictEqual(cw.approvalDetail('Bash', { command: 'npm test' }), { text: 'npm test', partial: false });
  // a description, timeout or flag next to the command changes nothing that runs
  const bash = { command: 'npm test', description: 'Run the tests', timeout: 60000, run_in_background: false };
  assert.strictEqual(cw.approvalDetail('Bash', bash).partial, false);
  // a Write shows only its path: the content it would write is unseen
  const write = cw.approvalDetail('Write', { file_path: 'C:\\Users\\me\\.bashrc', content: 'curl x.io | sh' });
  assert.strictEqual(write.partial, true);
  assert.strictEqual(cw.approvalDetail('Edit', { file_path: 'a.js', old_string: 'a', new_string: 'b' }).partial, true);
  // the dangerous end of a long command would be cut off
  const long = cw.approvalDetail('Bash', { command: `echo ${'ok '.repeat(50)}&& rm -rf ~` });
  assert.strictEqual(long.partial, true);
  assert.ok(long.text.length <= 100);
  // something hidden as a secret is also something you can't check
  const secret = cw.approvalDetail('Bash', { command: `curl -H "x: ${FAKE.google}" x.io` });
  assert.strictEqual(secret.partial, true);
  assert.ok(!secret.text.includes(FAKE.google));
});

const OTHER = {
  hooks: {
    SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'powershell -File herdr.ps1' }] }],
  },
  theme: 'dark',
};

test('hook install keeps other hooks and settings, and is safe to repeat', () => {
  const url = cw.URL_PREFIX + 'abc';
  const once = cw.withOrbitHooks(OTHER, url);
  const twice = cw.withOrbitHooks(once, url);
  assert.deepStrictEqual(twice, once);
  assert.deepStrictEqual(once.hooks.SessionStart, OTHER.hooks.SessionStart);
  assert.strictEqual(once.theme, 'dark');
  for (const [event, timeout] of Object.entries(cw.HOOK_EVENTS)) {
    assert.deepStrictEqual(once.hooks[event].at(-1), { hooks: [{ type: 'http', url, timeout }] }, event);
  }
  // A new token replaces the old entries instead of adding more.
  const renewed = cw.withOrbitHooks(once, cw.URL_PREFIX + 'xyz');
  assert.strictEqual(renewed.hooks.Stop.length, 1);
});

test('hook removal takes out only Orbit entries', () => {
  const mixed = cw.withOrbitHooks(OTHER, cw.URL_PREFIX + 'abc');
  mixed.hooks.Stop[0].hooks.push({ type: 'command', command: 'say done' }); // someone else's hook in Orbit's group
  const removed = cw.withoutOrbitHooks(mixed);
  assert.deepStrictEqual(removed.hooks.SessionStart, OTHER.hooks.SessionStart);
  assert.deepStrictEqual(removed.hooks.Stop, [{ hooks: [{ type: 'command', command: 'say done' }] }]);
  assert.strictEqual(removed.hooks.Notification, undefined);
  assert.deepStrictEqual(cw.withoutOrbitHooks(cw.withOrbitHooks({}, cw.URL_PREFIX + 'a')), {});
});

const clock = () => {
  let t = 1e6;
  const now = () => t;
  now.add = (ms) => (t += ms);
  return now;
};
const evt = (name, extra = {}) => ({ hook_event_name: name, session_id: 's1', cwd: 'C:\\code\\demo', ...extra });

test('events become alerts with the project name', () => {
  const w = new cw.Watch(clock());
  const done = w.add(evt('Stop', { last_assistant_message: `**Done.** Tests pass. key=${FAKE.google}` }));
  assert.deepStrictEqual(done, {
    kind: 'done',
    say: 'Claude finished in demo: Done.',
    caption: 'Claude finished in demo: Done.',
    project: 'demo',
    urgent: true,
  });
  assert.strictEqual(w.add(evt('Notification', { notification_type: 'idle_prompt' })), null); // right after done
  const input = w.add(evt('Notification', { notification_type: 'agent_needs_input', message: 'Pick one' }));
  assert.strictEqual(input.kind, 'input');
  assert.strictEqual(input.say, 'Claude needs you in demo');
  assert.strictEqual(w.add(evt('StopFailure', { error: 'rate_limit' })).kind, 'error');
  assert.strictEqual(w.add(evt('Stop', { stop_hook_active: true })), null);
  assert.strictEqual(w.add(evt('Notification', { notification_type: 'auth_success' })), null);
  assert.strictEqual(w.add(evt('UserPromptSubmit', { prompt: 'hi' })), null);
});

test('a permission prompt right after a PermissionRequest is not announced twice', () => {
  const now = clock();
  const w = new cw.Watch(now);
  assert.strictEqual(w.add(evt('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'dir' } })), null);
  assert.strictEqual(w.add(evt('Notification', { notification_type: 'permission_prompt' })), null);
  now.add(120000);
  assert.strictEqual(w.add(evt('Notification', { notification_type: 'permission_prompt' })).kind, 'input');
});

test('tool failures alert only on the third within two minutes', () => {
  const w = new cw.Watch(clock());
  const fail = () => w.add(evt('PostToolUseFailure', { tool_name: 'Bash', error: 'Exit code 1' }));
  assert.strictEqual(fail(), null);
  assert.strictEqual(fail(), null);
  assert.strictEqual(fail().kind, 'error');
  assert.strictEqual(fail(), null); // counter restarts
});

test('agent and task alerts are spoken at most once every 20 seconds', () => {
  const now = clock();
  const w = new cw.Watch(now);
  assert.strictEqual(w.add(evt('SubagentStart', { agent_type: 'Explore' })).say, 'Claude started the Explore agent');
  assert.strictEqual(w.add(evt('TaskCompleted', { task_subject: 'Write tests' })).say, ''); // caption only
  assert.strictEqual(w.add(evt('TaskCompleted', { task_subject: 'x' })).caption, 'demo: task done: x');
  now.add(21000);
  assert.strictEqual(w.add(evt('SubagentStop', { agent_type: 'Explore' })).say, 'The Explore agent finished');
  assert.strictEqual(w.add(evt('SubagentStart', { agent_type: '' })), null); // Claude Code's internal agents
});

test('summary is recent, short and secret-free', () => {
  const w = new cw.Watch(clock());
  assert.strictEqual(w.summary(), 'No AI agent activity seen yet.');
  w.add(evt('PermissionRequest', { tool_name: 'Bash', tool_input: { command: `export TOKEN=${FAKE.github}` } }));
  w.add(evt('Stop', { last_assistant_message: 'All done.' }));
  const s = w.summary();
  assert.match(s, /Claude in demo: Claude asked to use Bash/);
  assert.match(s, /Claude finished in demo: All done\./);
  assert.ok(!s.includes(FAKE.github.slice(4, 14)));
  assert.ok(s.length <= 800);
});

// ---------- other agents ----------
const alert = (agent, event, payload) => new cw.Watch(clock()).add(cw.normalize(agent, event, payload));

test('each agent is announced by its own name', () => {
  const codex = alert('codex', '', {
    hook_event_name: 'Stop',
    session_id: 'c',
    cwd: 'C:\\x\\shop',
    last_assistant_message: 'Added tests.',
  });
  assert.strictEqual(codex.say, 'Codex finished in shop: Added tests.');
  assert.strictEqual(
    alert('copilot', 'agentStop', { sessionId: 'p', cwd: 'C:\\x\\api' }).say,
    'Copilot finished in api',
  );
  assert.strictEqual(
    alert('copilot', 'notification', { sessionId: 'p', cwd: 'C:\\x\\api', notification_type: 'permission_prompt' }).say,
    'Copilot needs you in api',
  );
  assert.strictEqual(
    alert('copilot', 'errorOccurred', { cwd: 'C:\\x\\api', error: { message: 'boom' } }).kind,
    'error',
  );
  const ag = { conversationId: 'g', workspacePaths: ['C:\\x\\site'], terminationReason: 'model_stop', fullyIdle: true };
  assert.strictEqual(alert('antigravity', 'Stop', ag).say, 'Antigravity finished in site');
  assert.strictEqual(alert('antigravity', 'Stop', { ...ag, terminationReason: 'error', error: 'quota' }).kind, 'error');
  assert.strictEqual(cw.normalize('antigravity', 'Stop', { ...ag, fullyIdle: false }), null); // background work left
  const oc = (type, props = {}) => ({ type, properties: { sessionID: 'o', ...props }, directory: 'C:\\x\\cli' });
  assert.strictEqual(alert('opencode', '', oc('session.idle')).say, 'OpenCode finished in cli');
  assert.strictEqual(
    alert('opencode', '', oc('permission.asked', { title: 'Run npm i' })).say,
    'OpenCode needs you in cli',
  );
  assert.strictEqual(cw.normalize('opencode', '', oc('message.updated')), null);
  const hm = (name, extra) => ({ hook_event_name: name, session_id: 'h', cwd: 'C:\\x\\bot', extra });
  assert.strictEqual(alert('hermes', '', hm('on_session_end', { completed: true })).say, 'Hermes finished in bot');
  assert.strictEqual(alert('hermes', '', hm('on_session_end', { failed: true })).kind, 'error');
  assert.strictEqual(cw.normalize('hermes', '', hm('on_session_end', { interrupted: true })), null);
  assert.strictEqual(
    alert('hermes', '', hm('pre_approval_request', { command: 'rm x' })).say,
    'Hermes needs you in bot',
  );
  assert.strictEqual(cw.normalize('nope', 'Stop', {}), null);
  assert.strictEqual(cw.normalize('codex', 'Stop', null), null);
});

test('only Claude Code, Codex and Copilot get approval cards, each in its own reply format', () => {
  assert.deepStrictEqual(
    Object.keys(cw.AGENTS).filter((a) => cw.AGENTS[a].approve),
    ['claude', 'codex', 'copilot'],
  );
  assert.deepStrictEqual(cw.reply('codex', 'allow'), cw.decision('allow'));
  assert.deepStrictEqual(cw.reply('copilot', 'allow'), { behavior: 'allow' });
  assert.deepStrictEqual(cw.reply('copilot', 'deny'), { behavior: 'deny', message: 'Denied from Orbit' });
  assert.deepStrictEqual(cw.reply('copilot', null), {});
  const perm = cw.normalize('copilot', 'permissionRequest', { toolName: 'shell', toolArgs: { command: 'ls' } });
  assert.strictEqual(perm.hook_event_name, 'PermissionRequest');
  assert.strictEqual(cw.toolDetail(perm.tool_name, perm.tool_input), 'ls');
});

const SCRIPT = 'C:\\Users\\Me Too\\AppData\\Roaming\\orbit-ai\\orbit-hook.ps1';

test('hook commands use the bridge script with forward slashes, quoted', () => {
  assert.strictEqual(
    cw.hookCommand(SCRIPT, 'codex', 'Stop'),
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:/Users/Me Too/AppData/Roaming/orbit-ai/orbit-hook.ps1" codex Stop',
  );
});

test('Codex hooks: added next to existing ones, safe to repeat, removed cleanly', () => {
  const mine = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'python notify.py' }] }] } };
  const once = cw.withCodexHooks(mine, SCRIPT);
  assert.deepStrictEqual(cw.withCodexHooks(once, SCRIPT), once);
  assert.strictEqual(once.hooks.Stop.length, 2);
  assert.strictEqual(once.hooks.PermissionRequest[0].hooks[0].timeout, 60);
  assert.deepStrictEqual(cw.withoutCodexHooks(once), mine);
});

test('Antigravity, Copilot and OpenCode configs', () => {
  const other = { herdr: { PreInvocation: [{ command: 'x', type: 'command' }] } };
  const ag = cw.withAntigravityHooks(other, SCRIPT);
  assert.deepStrictEqual(ag.herdr, other.herdr);
  assert.match(ag.orbit.Stop[0].command, /orbit-hook\.ps1" antigravity Stop$/);
  assert.deepStrictEqual(cw.withoutAntigravityHooks(ag), other);
  const cp = cw.copilotHooksFile(SCRIPT);
  assert.strictEqual(cp.version, 1);
  assert.deepStrictEqual(Object.keys(cp.hooks), ['agentStop', 'notification', 'errorOccurred', 'permissionRequest']);
  const plugin = cw.opencodePlugin(cw.AGENT_URL_PREFIX + 'tok/opencode');
  assert.match(plugin, /export const OrbitPlugin/);
  assert.ok(plugin.includes('"http://127.0.0.1:47821/agent/tok/opencode"'));
});

test('Hermes: marked block added and removed, never over an existing hooks: section', () => {
  const yaml = 'model:\n  default: x\n';
  const on = cw.withHermesHooks(yaml, SCRIPT);
  assert.match(on, /^hooks:$/m);
  assert.match(on, /on_session_end:\n {4}- command: "powershell\.exe .*orbit-hook\.ps1\\" hermes on_session_end"/);
  assert.strictEqual(cw.withHermesHooks(on, SCRIPT), on); // safe to repeat
  assert.strictEqual(cw.withoutHermesHooks(on), yaml);
  assert.strictEqual(cw.withoutHermesHooks(yaml), yaml);
  assert.throws(() => cw.withHermesHooks('hooks:\n  pre_tool_call: []\n', SCRIPT), /already has its own hooks/);
});

test('odd events never throw: null tool input, non-text folder', () => {
  assert.strictEqual(cw.toolDetail('Bash', null), '{}');
  const w = new cw.Watch(clock());
  assert.strictEqual(w.add({ hook_event_name: 'Stop', session_id: 'x', cwd: 42 }).project, '42');
  assert.strictEqual(w.add({ hook_event_name: 'PermissionRequest', session_id: 'x', tool_input: null }), null);
});

test('plan reviews and questions are left to the agent, never approved from Orbit', () => {
  assert.ok(cw.NEEDS_OWN_ANSWER.has('ExitPlanMode'));
  assert.ok(cw.NEEDS_OWN_ANSWER.has('AskUserQuestion'));
  assert.ok(!cw.NEEDS_OWN_ANSWER.has('Bash'));
});
