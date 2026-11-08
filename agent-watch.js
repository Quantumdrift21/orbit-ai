// Watching AI coding agents (main process). Claude Code POSTs its hook events straight to
// Orbit's local listener; the other agents run Orbit's bridge script (orbit-hook.ps1) or plugin,
// which forwards their events. This module translates each agent's events into one common shape,
// turns them into short alerts, hides secrets, and builds the hook entries Orbit adds to each
// agent's config. Pure functions (plus editConfig, the one safe way to rewrite an agent's config
// file), tested in test/agent-watch.test.js.
const fs = require('fs');
const path = require('path');

const PORT = 47873; // was 47821 until another app took it; installed hooks move over at startup (main.js)
const URL_PREFIX = `http://127.0.0.1:${PORT}/claude/`;
const AGENT_URL_PREFIX = `http://127.0.0.1:${PORT}/agent/`;
const MCP_URL_PREFIX = `http://127.0.0.1:${PORT}/mcp/`; // Orbit's MCP tools for agents (mcp.js)
const APPROVE_WAIT_SECS = 25; // then the agent's own prompt takes over
// Prompts where a bare "allow" would skip the user's real answer (plan review, a question): Orbit
// only announces these and leaves the answer to the agent's own prompt.
const NEEDS_OWN_ANSWER = new Set(['ExitPlanMode', 'AskUserQuestion']);

// Agents Orbit can watch. `approve`: Orbit can answer the agent's permission requests.
// `flag`: the Orbit setting that turns watching it on.
const AGENTS = {
  claude: { label: 'Claude', name: 'Claude Code', approve: true, flag: 'watchClaude' },
  codex: { label: 'Codex', name: 'Codex', approve: true, flag: 'watchCodex' },
  copilot: { label: 'Copilot', name: 'GitHub Copilot CLI', approve: true, flag: 'watchCopilot' },
  opencode: { label: 'OpenCode', name: 'OpenCode', approve: false, flag: 'watchOpencode' },
  antigravity: { label: 'Antigravity', name: 'Antigravity', approve: false, flag: 'watchAntigravity' },
  hermes: { label: 'Hermes', name: 'Hermes Agent', approve: false, flag: 'watchHermes' },
};

// Claude Code hook events Orbit listens to, with Claude Code's timeout for each (seconds). Orbit
// answers everything but PermissionRequest at once; that one waits for a click (APPROVE_WAIT_SECS).
const HOOK_EVENTS = {
  PermissionRequest: 60,
  Notification: 5,
  Stop: 5,
  StopFailure: 5,
  SubagentStart: 5,
  SubagentStop: 5,
  TaskCompleted: 5,
  PostToolUseFailure: 5,
};

// ---------- secrets ----------
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gi,
  /AIza[\w-]{20,}/gi,
  /sk-[\w-]{16,}/gi,
  /gh[pousr]_\w{20,}/gi,
  /AKIA[0-9A-Z]{16}/gi,
  /xox[abprs]-[\w-]{10,}/gi,
  /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+/g,
  /\b\w*(?:password|passwd|token|secret|api[_ -]?key)\w*\s*[:=]\s*['"]?[^\s'"]+/gi,
];

/** Replace anything that looks like a password, key or token with "[hidden]". */
function hideSecrets(text) {
  let s = String(text ?? '');
  for (const re of SECRET_PATTERNS) s = s.replace(re, '[hidden]');
  // Catch-all for unknown token formats: long runs mixing letters and digits (also hides hashes).
  return s.replace(/[A-Za-z0-9+/_-]{32,}/g, (m) => (/[A-Za-z]/.test(m) && /\d/.test(m) ? '[hidden]' : m));
}

const clip = (s, n) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

const DETAIL_KEYS = ['command', 'file_path', 'url', 'pattern', 'description'];

/** The useful part of a tool call: its command, file or URL (key = which field), else the whole input as JSON. */
function rawDetail(input) {
  input = input && typeof input === 'object' ? input : {};
  const key = DETAIL_KEYS.find((k) => input[k] != null);
  return { key, input, text: String(key ? input[key] : JSON.stringify(input)) };
}

/** A tool call in one secret-filtered line, for history and the spoken summary. */
const toolDetail = (tool, input) => clip(hideSecrets(rawDetail(input).text), 160);

// What fits on the approval card (3 wrapped lines of its monospace text).
const CARD_CHARS = 100;

/**
 * The approval card's text. partial = the card can't show everything the tool would do — cut
 * short, something hidden as a secret, or other fields it doesn't show (a Write's content, an
 * Edit's new text) — so it must not offer Allow (only Deny or answering in the terminal).
 */
function approvalDetail(tool, input) {
  const { key, input: all, text } = rawDetail(input);
  const full = text.replace(/\s+/g, ' ').trim();
  const shown = hideSecrets(full);
  // a description or a number/flag (timeout, run_in_background) can't change what runs
  const unseen = Object.entries(all).some(
    ([k, v]) => k !== key && k !== 'description' && v != null && v !== '' && !['number', 'boolean'].includes(typeof v),
  );
  return { text: clip(shown, CARD_CHARS), partial: unseen || shown !== full || full.length > CARD_CHARS };
}

/** First sentence of the agent's reply, without markdown, for "Claude finished: …". */
function firstSentence(text) {
  const plain = hideSecrets(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = plain.match(/^.*?[.!?](?=\s|$)/);
  return clip(m ? m[0] : plain, 100);
}

// ---------- Claude Code hook entries in ~/.claude/settings.json ----------
// Orbit's own entries on any port, so moving the port removes the old entries instead of leaving them behind
const isOrbitHttp = (h) =>
  h?.type === 'http' && typeof h.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/claude\//.test(h.url);

/** Settings with Orbit's hook entries removed. Everything else, including other hooks, is kept as is. */
function withoutOrbitHooks(settings, isOrbit = isOrbitHttp) {
  const out = { ...settings };
  if (!settings?.hooks || typeof settings.hooks !== 'object') return out;
  const hooks = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    const kept = [];
    for (const g of groups) {
      if (!Array.isArray(g?.hooks) || !g.hooks.some(isOrbit)) kept.push(g);
      else if (g.hooks.some((h) => !isOrbit(h))) kept.push({ ...g, hooks: g.hooks.filter((h) => !isOrbit(h)) });
    }
    if (kept.length) hooks[event] = kept;
  }
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/** Settings with Orbit's hook entries (re)added for `url`. Safe to run again. */
function withOrbitHooks(settings, url) {
  const out = withoutOrbitHooks(settings);
  out.hooks = { ...(out.hooks || {}) };
  for (const [event, timeout] of Object.entries(HOOK_EVENTS)) {
    out.hooks[event] = [...(out.hooks[event] || []), { hooks: [{ type: 'http', url, timeout }] }];
  }
  return out;
}

// ---------- the other agents' configs ----------
// They run Orbit's bridge script: PowerShell reads the event on stdin, POSTs it to Orbit and
// prints Orbit's reply. Paths use forward slashes (Hermes splits commands like a POSIX shell).
const hookCommand = (script, agent, event = '') =>
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script.replace(/\\/g, '/')}" ${agent} ${event}`.trim();
const isOrbitCommand = (h) => typeof h?.command === 'string' && h.command.includes('orbit-hook.ps1');

/** Codex ~/.codex/hooks.json (same layout as Claude Code's hooks). */
const withoutCodexHooks = (cfg) => withoutOrbitHooks(cfg, isOrbitCommand);
function withCodexHooks(cfg, script) {
  const out = withoutCodexHooks(cfg);
  out.hooks = { ...(out.hooks || {}) };
  for (const [event, timeout] of Object.entries({ Stop: 10, PermissionRequest: 60 })) {
    const entry = { type: 'command', command: hookCommand(script, 'codex', event), timeout };
    out.hooks[event] = [...(out.hooks[event] || []), { hooks: [entry] }];
  }
  return out;
}

/** Copilot CLI: Orbit's own file ~/.copilot/hooks/orbit.json. */
function copilotHooksFile(script) {
  const entry = (event, timeoutSec) => [
    { type: 'command', command: hookCommand(script, 'copilot', event), timeoutSec },
  ];
  return {
    version: 1,
    hooks: {
      agentStop: entry('agentStop', 10),
      notification: entry('notification', 10),
      errorOccurred: entry('errorOccurred', 10),
      permissionRequest: entry('permissionRequest', 60),
    },
  };
}

/** Antigravity ~/.gemini/config/hooks.json: one "orbit" entry next to any others. */
const withAntigravityHooks = (cfg, script) => ({
  ...cfg,
  orbit: { Stop: [{ type: 'command', command: hookCommand(script, 'antigravity', 'Stop'), timeout: 10 }] },
});
function withoutAntigravityHooks(cfg) {
  const { orbit, ...rest } = cfg || {};
  return rest;
}

/** OpenCode plugin (Orbit's own file in ~/.config/opencode/plugins): posts events to Orbit. */
const opencodePlugin = (url) => `// Installed by Orbit AI: tells Orbit when OpenCode finishes, errors or needs you.
// Remove it by turning off "OpenCode" in Orbit's Settings (or delete this file).
const URL = ${JSON.stringify(url)};
const WATCH = new Set(["session.idle", "session.error", "permission.asked"]);

export const OrbitPlugin = async ({ directory }) => ({
  event: async ({ event }) => {
    if (!WATCH.has(event?.type)) return;
    try {
      await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: event.type, properties: event.properties, directory }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Orbit isn't running: nothing to do.
    }
  },
});
`;

const HERMES_START = '# --- Orbit AI hooks (managed by Orbit; turn off in Orbit Settings) ---';
const HERMES_END = '# --- end Orbit AI hooks ---';
const HERMES_EVENTS = ['on_session_end', 'pre_approval_request', 'on_human_input_request'];

/** Hermes config.yaml with Orbit's marked hooks block. Refuses if the user already has a hooks: block. */
function withHermesHooks(yaml, script) {
  const text = withoutHermesHooks(yaml);
  if (/^hooks:/m.test(text)) throw new Error("Hermes already has its own hooks: section, so Orbit didn't change it");
  const block = [
    HERMES_START,
    'hooks:',
    ...HERMES_EVENTS.flatMap((e) => [
      `  ${e}:`,
      `    - command: ${JSON.stringify(hookCommand(script, 'hermes', e))}`,
      '      timeout: 10',
    ]),
    HERMES_END,
  ].join('\n');
  return `${text.replace(/\s*$/, '')}\n\n${block}\n`;
}

/** Hermes config.yaml without Orbit's block (unchanged if there is none). */
function withoutHermesHooks(yaml) {
  const s = String(yaml ?? '');
  const a = s.indexOf(HERMES_START);
  const b = s.indexOf(HERMES_END);
  if (a === -1 || b === -1) return s;
  const before = s.slice(0, a).replace(/\s*$/, '');
  const after = s.slice(b + HERMES_END.length).replace(/^\s*/, '');
  return `${before}\n${after ? `\n${after}` : ''}`.replace(/\n+$/, '\n');
}

/**
 * Back up, transform and atomically rewrite an agent's config file. Never overwrites a file it
 * can't read; the first original is kept as <file>.orbit-backup. json = false: plain text.
 */
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
  writeAtomic(file, json ? JSON.stringify(next, null, 2) + '\n' : next);
}

/**
 * Write a copy, then swap it in, so a crash mid-write never leaves a cut-off file. Windows can
 * refuse the swap for a moment while antivirus or the search indexer has the file open: retry.
 */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', text);
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(file + '.tmp', file);
    } catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (i + 1)); // short blocking pause
    }
  }
}

// ---------- approval replies ----------
/**
 * Orbit's reply to a PermissionRequest: allow, deny, or {} = "show the agent's own prompt".
 * message: what the agent reads on a deny (your typed reply from Orbit's chat);
 * updatedInput: replaces the tool's input on an allow (answers to an AskUserQuestion).
 */
function decision(behavior, { message = '', updatedInput = null } = {}) {
  if (behavior !== 'allow' && behavior !== 'deny') return {};
  const d = { behavior };
  if (behavior === 'deny') d.message = message ? `The user replied from Orbit: ${message}` : 'Denied from Orbit';
  if (behavior === 'allow' && updatedInput) d.updatedInput = updatedInput;
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } };
}

/** The approval reply in each agent's own format ({} = let the agent show its normal prompt). */
function reply(agent, behavior, extra = {}) {
  if (agent !== 'copilot') return decision(behavior, extra); // Claude Code and Codex share this shape
  if (behavior !== 'allow' && behavior !== 'deny') return {};
  if (behavior === 'allow') return { behavior };
  return { behavior, message: extra.message ? `The user replied from Orbit: ${extra.message}` : 'Denied from Orbit' };
}

/** An AskUserQuestion answered from Orbit: the original questions plus { question text: chosen label }. */
const answerInput = (toolInput, answers) => ({ ...(toolInput || {}), answers });

/** Stop-hook reply that keeps a working agent going with the messages you typed in Orbit's chat. */
function stopReply(messages) {
  if (!messages?.length) return {};
  const text = messages.map((m) => `- ${m}`).join('\n');
  return {
    decision: 'block',
    reason: `The user sent you ${messages.length > 1 ? 'these messages' : 'this message'} from Orbit (their desktop assistant). Read it and act on it before stopping:\n${text}`,
  };
}

// ---------- transcripts (shown in Orbit's chat window) ----------
const partsText = (content) =>
  typeof content === 'string'
    ? content
    : (Array.isArray(content) ? content : [])
        .filter((c) => ['text', 'input_text', 'output_text'].includes(c?.type))
        .map((c) => c.text)
        .join('\n');

/**
 * The conversation in an agent's local transcript (JSON lines; Claude Code's and Codex's formats),
 * newest last: [{ role: 'user' | 'agent' | 'tool', text }], secret-filtered, at most `max` entries.
 */
function transcriptMessages(text, max = 80) {
  const out = [];
  const push = (role, t) => {
    const s = String(t ?? '').trim();
    if (s) out.push({ role, text: hideSecrets(s.length > 2000 ? s.slice(0, 1999) + '…' : s) });
  };
  for (const line of String(text).split('\n')) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // a cut-off first line from reading only the tail
    }
    if (o.type === 'user' || o.type === 'assistant') {
      // Claude Code
      if (o.isMeta) continue;
      const content = o.message?.content;
      push(o.type === 'user' ? 'user' : 'agent', partsText(content));
      for (const c of Array.isArray(content) ? content : [])
        if (c?.type === 'tool_use') push('tool', `${c.name}: ${clip(rawDetail(c.input).text, 160)}`);
    } else if (o.type === 'response_item') {
      // Codex
      const p = o.payload || {};
      if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant'))
        push(p.role === 'user' ? 'user' : 'agent', partsText(p.content));
      else if (p.type === 'function_call') push('tool', `${p.name}: ${clip(String(p.arguments ?? ''), 160)}`);
    }
  }
  return out.slice(-max);
}

// ---------- each agent's events → one common (Claude-style) event ----------
/**
 * Translate an agent's own hook payload into Orbit's common event, or null to ignore it.
 * `event` is the hook name the bridge was registered for (some agents don't send it).
 */
function normalize(agent, event, p) {
  if (!AGENTS[agent] || !p || typeof p !== 'object') return null;
  const base = (e) => ({
    agent,
    session_id: String(p.session_id ?? p.sessionId ?? p.conversationId ?? 'unknown'),
    cwd: p.cwd ?? p.directory ?? (Array.isArray(p.workspacePaths) ? p.workspacePaths[0] : '') ?? '',
    ...e,
  });
  switch (agent) {
    case 'claude':
    case 'codex': // Codex hooks use Claude Code's event names and fields
      return { ...p, agent };
    case 'copilot':
      switch (event) {
        case 'agentStop':
          return base({ hook_event_name: 'Stop' });
        case 'notification':
          return base({ hook_event_name: 'Notification', notification_type: p.notification_type, message: p.message });
        case 'errorOccurred':
          return base({ hook_event_name: 'StopFailure', error: p.error?.message ?? String(p.error ?? '') });
        case 'permissionRequest':
          return base({
            hook_event_name: 'PermissionRequest',
            tool_name: p.toolName ?? p.tool_name ?? 'a tool',
            tool_input: p.toolArgs ?? p.tool_input ?? {},
          });
        default:
          return null;
      }
    case 'antigravity':
      if (event !== 'Stop' || p.fullyIdle === false) return null; // still has background work
      return base(
        p.terminationReason === 'error' || p.error
          ? { hook_event_name: 'StopFailure', error: p.error || p.terminationReason }
          : { hook_event_name: 'Stop' },
      );
    case 'opencode': {
      const props = p.properties || {};
      const s = { session_id: String(props.sessionID ?? 'unknown') };
      switch (p.type) {
        case 'session.idle':
          return base({ ...s, hook_event_name: 'Stop' });
        case 'session.error':
          return base({
            ...s,
            hook_event_name: 'StopFailure',
            error: props.error?.data?.message ?? props.error?.name ?? '',
          });
        case 'permission.asked':
          return base({
            ...s,
            hook_event_name: 'Notification',
            notification_type: 'permission_prompt',
            message: props.title ?? props.permission ?? '',
          });
        default:
          return null;
      }
    }
    case 'hermes': {
      const x = p.extra || {};
      switch (p.hook_event_name) {
        case 'on_session_end':
          if (x.interrupted) return null;
          if (x.failed) return base({ hook_event_name: 'StopFailure', error: x.turn_exit_reason ?? '' });
          return x.completed === false ? null : base({ hook_event_name: 'Stop' });
        case 'pre_approval_request':
          return base({
            hook_event_name: 'Notification',
            notification_type: 'permission_prompt',
            message: x.description || x.command || '',
          });
        case 'on_human_input_request':
          return base({ hook_event_name: 'Notification', notification_type: 'agent_needs_input', message: '' });
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

// ---------- events → alerts ----------
const NEEDS_INPUT = new Set(['permission_prompt', 'idle_prompt', 'agent_needs_input', 'elicitation_dialog']);
const QUIET_GAP = 20000; // ms between spoken non-urgent alerts (agents, tasks)
const KEEP = 8; // history lines per session
const MAX_SESSIONS = 10;
const SESSION_IDLE = 2 * 3600 * 1000;

class Watch {
  constructor(now = Date.now) {
    this.now = now;
    this.sessions = new Map();
    this.lastQuiet = -Infinity;
  }

  #session(evt, t, who) {
    const id = `${evt.agent || 'claude'}:${evt.session_id || 'unknown'}`;
    for (const [k, s] of this.sessions) if (t - s.seen > SESSION_IDLE) this.sessions.delete(k);
    let s = this.sessions.get(id);
    if (!s) {
      if (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value);
      s = {
        key: id,
        agent: evt.agent || 'claude',
        project: path.basename(String(evt.cwd || '')) || who,
        who,
        history: [],
        fails: [],
        inbox: [], // messages you typed in Orbit's chat, waiting for the agent's next stop
        lastPermission: -Infinity,
      };
      this.sessions.set(id, s);
    }
    s.seen = t;
    if (evt.cwd) s.cwd = String(evt.cwd);
    if (evt.transcript_path) s.transcript = String(evt.transcript_path);
    // working = between your prompt and its stop: a message typed now reaches it when it next stops
    const idle =
      ['Stop', 'StopFailure'].includes(evt.hook_event_name) ||
      (evt.hook_event_name === 'Notification' && evt.notification_type === 'idle_prompt');
    s.working = !idle;
    return s;
  }

  /** A session by key ('claude:<session id>'), or the most recent one. */
  session(key) {
    if (key) return this.sessions.get(key) || null;
    return [...this.sessions.values()].sort((a, b) => b.seen - a.seen)[0] || null;
  }

  /** The most recent session working in `cwd` (for the MCP tools, which only know the folder). */
  sessionAt(cwd) {
    const norm = (p) => path.resolve(String(p || '')).toLowerCase();
    const want = norm(cwd);
    return (
      [...this.sessions.values()].filter((s) => s.cwd && norm(s.cwd) === want).sort((a, b) => b.seen - a.seen)[0] ||
      null
    );
  }

  /** Queue a message you typed for a session; returns false if there's no such session. */
  queueMessage(key, text) {
    const s = this.sessions.get(key);
    const msg = String(text ?? '')
      .trim()
      .slice(0, 2000);
    if (!s || !msg) return false;
    s.inbox.push(msg);
    return true;
  }

  /** Take (and clear) the messages waiting for a session. */
  takeMessages(key) {
    const s = this.sessions.get(key);
    if (!s) return [];
    const m = s.inbox;
    s.inbox = [];
    return m;
  }

  #note(s, text, t) {
    s.history.push({ t, text });
    if (s.history.length > KEEP) s.history.shift();
  }

  /** Turn one common event into an alert {kind, say, caption, project, urgent}, or null to ignore it. */
  add(evt = {}) {
    const t = this.now();
    const who = AGENTS[evt.agent]?.label || 'Claude';
    const s = this.#session(evt, t, who);
    const p = s.project;
    let out;
    switch (evt.hook_event_name) {
      case 'PermissionRequest':
        // The approval card handles it; remember it so the matching notification isn't repeated.
        s.lastPermission = t;
        this.#note(s, `${who} asked to use ${evt.tool_name}: ${toolDetail(evt.tool_name, evt.tool_input)}`, t);
        return null;
      case 'Notification': {
        const type = evt.notification_type;
        if (!NEEDS_INPUT.has(type)) return null;
        if (type === 'permission_prompt' && t - s.lastPermission < 90000) return null;
        if (type === 'idle_prompt' && s.lastKind === 'done') return null;
        out = {
          kind: 'input',
          urgent: true,
          say: `${who} needs you in ${p}`,
          caption: clip(`${who} needs you (${p}): ${hideSecrets(evt.message || '')}`, 120),
        };
        break;
      }
      case 'Stop': {
        if (evt.stop_hook_active) return null;
        const first = firstSentence(evt.last_assistant_message || '');
        const line = first ? `${who} finished in ${p}: ${first}` : `${who} finished in ${p}`;
        out = { kind: 'done', urgent: true, say: line, caption: line };
        break;
      }
      case 'StopFailure':
        out = {
          kind: 'error',
          urgent: true,
          say: `${who} stopped with an error in ${p}`,
          caption: clip(`${who} error (${p}): ${hideSecrets(evt.last_assistant_message || evt.error || '')}`, 120),
        };
        break;
      case 'PostToolUseFailure':
        s.fails = s.fails.filter((x) => t - x < 120000).concat(t);
        this.#note(s, `${evt.tool_name} failed: ${clip(hideSecrets(evt.error || ''), 80)}`, t);
        if (s.fails.length < 3) return null;
        s.fails = [];
        out = {
          kind: 'error',
          urgent: true,
          say: `${who} keeps hitting errors in ${p}`,
          caption: clip(`Several tool errors in ${p}: ${hideSecrets(evt.error || '')}`, 120),
        };
        break;
      case 'SubagentStart':
      case 'SubagentStop': {
        if (!evt.agent_type) return null; // Claude Code's own internal agents
        const started = evt.hook_event_name === 'SubagentStart';
        out = {
          kind: 'agent',
          say: started ? `${who} started the ${evt.agent_type} agent` : `The ${evt.agent_type} agent finished`,
          caption: `${p}: ${evt.agent_type} agent ${started ? 'started' : 'finished'}`,
        };
        break;
      }
      case 'TaskCompleted': {
        const subject = clip(hideSecrets(evt.task_subject || ''), 80);
        out = {
          kind: 'task',
          say: `${who} completed a task`,
          caption: `${p}: task done${subject ? `: ${subject}` : ''}`,
        };
        break;
      }
      default:
        return null;
    }
    if (!out.urgent) {
      if (t - this.lastQuiet < QUIET_GAP) out.say = '';
      else this.lastQuiet = t;
    }
    s.lastKind = out.kind;
    this.#note(s, out.caption, t);
    return {
      kind: out.kind,
      say: out.say,
      caption: out.caption,
      project: p,
      who,
      session: s.key,
      urgent: !!out.urgent,
    };
  }

  /** Recent activity across agents and sessions, newest first, secret-filtered. */
  summary() {
    const t = this.now();
    const ago = (x) => (t - x < 60000 ? 'just now' : `${Math.round((t - x) / 60000)} min ago`);
    const lines = [...this.sessions.values()]
      .sort((a, b) => b.seen - a.seen)
      .map(
        (s) =>
          `${s.who} in ${s.project}: ${s.history
            .slice(-4)
            .map((h) => `${h.text} (${ago(h.t)})`)
            .join('; ')}`,
      );
    return clip(hideSecrets(lines.join('\n') || 'No AI agent activity seen yet.'), 800);
  }
}

module.exports = {
  PORT,
  URL_PREFIX,
  AGENT_URL_PREFIX,
  MCP_URL_PREFIX,
  AGENTS,
  HOOK_EVENTS,
  APPROVE_WAIT_SECS,
  NEEDS_OWN_ANSWER,
  hideSecrets,
  toolDetail,
  approvalDetail,
  withOrbitHooks,
  withoutOrbitHooks,
  withCodexHooks,
  withoutCodexHooks,
  copilotHooksFile,
  withAntigravityHooks,
  withoutAntigravityHooks,
  opencodePlugin,
  withHermesHooks,
  withoutHermesHooks,
  hookCommand,
  editConfig,
  writeAtomic,
  decision,
  reply,
  answerInput,
  stopReply,
  transcriptMessages,
  normalize,
  Watch,
};
