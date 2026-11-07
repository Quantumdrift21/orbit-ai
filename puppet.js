/**
 * Hermes Puppet Client - CLI to control Orbit via the bridge
 * Usage: node puppet.js <command> [args...]
 * Commands:
 *   speak "text"           - Make Orbit say something
 *   move <dx> <dy>         - Move Orbit by pixels
 *   color <state> <hex>    - Change state color (idle, listening, thinking, speaking, error)
 *   sleep                  - Put Orbit to sleep
 *   wake                   - Wake Orbit up
 *   bounce                 - Trigger bounce animation
 *   roam <true|false>      - Enable/disable free roam
 *   status                 - Check bridge connection status
 *   nyx:focusedWindow      - Get focused window info
 *   nyx:listWindows        - List all windows
 *   nyx:screenshot [windowId] - Take screenshot (full screen or window)
 *   nyx:clipboard:read [format] - Read clipboard (text, html, rtf, image)
 *   nyx:clipboard:write --text "..." / --html "..." / --image base64 - Write clipboard
 *   nyx:system:vitals      - Get system vitals (CPU, memory, battery)
 *   nyx:focusWindow <id>   - Focus a window by ID
 */

const WebSocket = require('ws');

const BRIDGE_URL = 'ws://127.0.0.1:8765';
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
Hermes Puppet Client for Orbit AI
Usage: node puppet.js <command> [args...]

Basic:
  speak "text"           - Make Orbit say something
  move <dx> <dy>         - Move Orbit by pixels (e.g., move 100 -50)
  color <state> <hex>    - Change state color (idle, listening, thinking, speaking, error)
  sleep                  - Put Orbit to sleep
  wake                   - Wake Orbit up
  bounce                 - Trigger bounce animation
  roam <true|false>      - Enable/disable free roam
  status                 - Check bridge connection status

Nyx Capabilities (Orbit as eyes/hands):
  nyx:focusedWindow      - Get focused window info
  nyx:listWindows        - List all windows
  nyx:screenshot [windowId] - Take screenshot (full screen or specific window)
  nyx:clipboard:read [format] - Read clipboard (text, html, rtf, image)
  nyx:clipboard:write --text "..." / --html "..." / --image base64 - Write clipboard
  nyx:system:vitals      - Get system vitals (CPU, memory, battery)
  nyx:focusWindow <id>   - Focus a window by ID
`);
  process.exit(1);
}

const command = args[0];

const ws = new WebSocket(BRIDGE_URL);

ws.on('open', () => {
  let payload = {};
  switch (command) {
    case 'speak':
      payload = { action: 'speak', payload: { text: args.slice(1).join(' ') } };
      break;
    case 'move':
      payload = { action: 'move', payload: { dx: parseInt(args[1]) || 0, dy: parseInt(args[2]) || 0 } };
      break;
    case 'color':
      payload = { action: 'color', payload: { state: args[1], hex: args[2] } };
      break;
    case 'sleep':
      payload = { action: 'sleep', payload: {} };
      break;
    case 'wake':
      payload = { action: 'wake', payload: {} };
      break;
    case 'bounce':
      payload = { action: 'bounce', payload: {} };
      break;
    case 'roam':
      payload = { action: 'roam', payload: { enabled: args[1] !== 'false' } };
      break;
    case 'status':
      payload = { action: 'status', payload: {} };
      break;

    // Nyx capabilities
    case 'nyx:focusedWindow':
      payload = { action: 'nyx:focusedWindow', payload: {} };
      break;
    case 'nyx:listWindows':
      payload = { action: 'nyx:listWindows', payload: {} };
      break;
    case 'nyx:screenshot':
      payload = { action: 'nyx:screenshot', payload: { windowId: args[1] ? parseInt(args[1]) : undefined } };
      break;
    case 'nyx:clipboard:read':
      payload = { action: 'nyx:clipboard:read', payload: { format: args[1] || 'text' } };
      break;
    case 'nyx:clipboard:write':
      // Parse --text, --html, --image flags
      let writeData = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--text') writeData.text = args[++i];
        else if (args[i] === '--html') writeData.html = args[++i];
        else if (args[i] === '--image') writeData.image = args[++i];
        else if (args[i] === '--rtf') writeData.rtf = args[++i];
      }
      payload = { action: 'nyx:clipboard:write', payload: writeData };
      break;
    case 'nyx:system:vitals':
      payload = { action: 'nyx:system:vitals', payload: {} };
      break;
    case 'nyx:focusWindow':
      payload = { action: 'nyx:focusWindow', payload: { windowId: parseInt(args[1]) } };
      break;

    default:
      console.error('Unknown command:', command);
      ws.close();
      process.exit(1);
  }

  ws.send(JSON.stringify({ type: 'puppet', ...payload }));
  console.log(`Sent: ${command}`, JSON.stringify(payload.payload || ''));
  
  // Wait a bit for response
  setTimeout(() => { ws.close(); process.exit(0); }, 500);
});

ws.on('error', (e) => {
  console.error('Connection error:', e.message);
  process.exit(1);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data);
    if (msg.type === 'nyx:result') {
      console.log(`\n[Result] ${msg.action}:`, msg.ok ? 'OK' : 'ERROR:', msg.error || '');
      if (msg.data) {
        if (msg.action === 'screenshot') {
          console.log(`  Image: ${msg.format}, ${msg.width}x${msg.height}, ${Math.round(msg.data.length * 0.75)} KB base64`);
        } else if (msg.action === 'clipboard:read' && msg.data) {
          const preview = typeof msg.data === 'string' ? msg.data.slice(0, 200) : '[binary]';
          console.log(`  Data: ${preview}${msg.data.length > 200 ? '...' : ''}`);
        } else {
          console.log('  Data:', JSON.stringify(msg, null, 2).slice(0, 500));
        }
      }
    }
  } catch {}
});

ws.on('close', () => {
  // process.exit(0);
});

setTimeout(() => {
  console.error('Timeout - bridge not responding');
  process.exit(1);
}, 5000);