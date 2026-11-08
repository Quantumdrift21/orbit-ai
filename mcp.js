// Orbit as an MCP server for AI coding agents (pure JSON-RPC handling; main.js serves it on the
// local listener at /mcp/<token>, Claude Code connects over streamable HTTP). Two tools:
//   - ask_user: the agent asks you something through Orbit (spoken, shown beside the robot and in
//     Orbit's chat window with the conversation for context); returns what you type
//   - check_messages: the agent picks up what you typed to it in Orbit's chat while it works
// Tested in test/mcp.test.js.

const PROTOCOL = '2025-06-18';

const CWD = { type: 'string', description: 'Your current working directory (so Orbit knows which session you are)' };
const TOOLS = [
  {
    name: 'ask_user',
    description:
      'Ask the user a question through Orbit, their desktop robot assistant. Orbit speaks it, shows it beside the robot and in its chat window (with this conversation for context), and returns what the user types. Use it when you need a decision or information and the user may not be watching the terminal. Keep the question short and self-contained.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'The question, in one or two sentences' }, cwd: CWD },
      required: ['question', 'cwd'],
    },
  },
  {
    name: 'check_messages',
    description:
      "Get messages the user typed to you in Orbit's chat window while you work. Call it between the steps of a long task, and act on what it returns.",
    inputSchema: { type: 'object', properties: { cwd: CWD }, required: ['cwd'] },
  },
];

const result = (id, r) => ({ jsonrpc: '2.0', id, result: r });
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const text = (t, isError = false) => ({
  content: [{ type: 'text', text: String(t) }],
  ...(isError ? { isError } : {}),
});

/**
 * Handle one JSON-RPC message. Returns the response, or null for a notification (no reply).
 * handlers: { askUser({ question, cwd }) → Promise<string|null>, checkMessages({ cwd }) → string[] }.
 */
async function handleRpc(msg, handlers) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
    return error(msg?.id ?? null, -32600, 'Invalid request');
  if (msg.id === undefined || msg.id === null) return null; // notification, e.g. notifications/initialized
  const { id, method, params = {} } = msg;
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'orbit', version: '1.0.0' },
        instructions:
          "Orbit is the user's desktop assistant. Use ask_user to ask them something when they may be away from the terminal, and check_messages to read what they typed to you in Orbit's chat.",
      });
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: TOOLS });
    case 'tools/call': {
      const args = params.arguments || {};
      const cwd = String(args.cwd || '');
      if (params.name === 'ask_user') {
        const question = String(args.question || '').trim();
        if (!question) return result(id, text('A question is needed', true));
        const answer = await handlers.askUser({ question: question.slice(0, 500), cwd });
        return result(
          id,
          answer
            ? text(`The user answered: ${answer}`)
            : text('The user did not answer in time. Carry on with your best judgment or ask in the terminal.'),
        );
      }
      if (params.name === 'check_messages') {
        const msgs = handlers.checkMessages({ cwd });
        return result(
          id,
          text(msgs.length ? `The user sent you:\n${msgs.map((m) => `- ${m}`).join('\n')}` : 'No new messages.'),
        );
      }
      return error(id, -32602, `Unknown tool ${params.name}`);
    }
    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}

module.exports = { handleRpc, TOOLS, PROTOCOL };
