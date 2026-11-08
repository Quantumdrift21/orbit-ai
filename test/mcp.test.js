// Orbit's MCP server (JSON-RPC handling). Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { handleRpc } = require('../mcp');

const handlers = (answer = 'Postgres', inbox = []) => ({
  asked: [],
  askUser(q) {
    this.asked.push(q);
    return Promise.resolve(answer);
  },
  checkMessages: () => inbox,
});

test('initialize, list tools, ignore notifications, reject junk', async () => {
  const init = await handleRpc(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    handlers(),
  );
  assert.strictEqual(init.result.protocolVersion, '2025-03-26');
  assert.ok(init.result.capabilities.tools);
  const list = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, handlers());
  assert.deepStrictEqual(
    list.result.tools.map((t) => t.name),
    ['ask_user', 'check_messages'],
  );
  assert.strictEqual(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, handlers()), null);
  assert.strictEqual((await handleRpc({ hello: 1 }, handlers())).error.code, -32600);
  assert.strictEqual((await handleRpc({ jsonrpc: '2.0', id: 3, method: 'nope' }, handlers())).error.code, -32601);
});

test('ask_user returns what the user typed, or says nobody answered', async () => {
  const h = handlers();
  const r = await handleRpc(
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'ask_user', arguments: { question: 'Which DB?', cwd: 'C:\\a' } },
    },
    h,
  );
  assert.match(r.result.content[0].text, /Postgres/);
  assert.deepStrictEqual(h.asked, [{ question: 'Which DB?', cwd: 'C:\\a' }]);
  const none = await handleRpc(
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'ask_user', arguments: { question: 'Q', cwd: 'C:\\a' } },
    },
    handlers(null),
  );
  assert.match(none.result.content[0].text, /did not answer/);
});

test('check_messages hands over the inbox', async () => {
  const call = {
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'check_messages', arguments: { cwd: 'C:\\a' } },
  };
  assert.match((await handleRpc(call, handlers('', ['also add tests']))).result.content[0].text, /also add tests/);
  assert.match((await handleRpc(call, handlers('', []))).result.content[0].text, /No new messages/);
});
