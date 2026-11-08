/**
 * Hermes ↔ Orbit WebSocket Bridge
 * Run from Hermes: `node hermes-bridge.js`
 * Orbit connects to ws://127.0.0.1:8765
 *
 * Protocol:
 *   Orbit → Hermes: { type: 'chat', text: string, sessionId: string }
 *   Hermes → Orbit: { type: 'reply', text: string, sessionId: string }
 *   Hermes → Orbit: { type: 'puppet', action: 'move'|'color'|'sleep'|'wake'|'speak'|'bounce', payload: object }
 *   Orbit → Hermes: { type: 'status', connected: true, version: '1.0' }
 *   Orbit → Hermes: { type: 'nyx:result', action: string, requestId: number, ok: boolean, ... }
 */

const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8765;
const wss = new WebSocket.Server({ port: PORT });

// Log to file
const logFile = path.join(__dirname, 'bridge.log');
function logToFile(msg) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
}
function log(msg) {
  console.log(msg);
  logToFile(msg);
}

// Clear log file on start
fs.writeFileSync(logFile, '');

// Auth token - generated once on bridge startup
const BRIDGE_TOKEN = require('crypto').randomBytes(16).toString('hex');
log(`[Bridge] Auth token generated: ${BRIDGE_TOKEN.substring(0, 8)}...`);

let orbitSocket = null;
let pendingPuppet = new Map(); // requestId -> { ws, resolve, timeout }
let puppetRequestId = 0;
let puppetQueue = []; // queued puppet commands when Orbit not connected

log(`[Bridge] WebSocket server listening on ws://127.0.0.1:${PORT}`);

wss.on('connection', (ws, req) => {
  log('[Bridge] Client connected from', req.socket.remoteAddress);

  ws.on('message', (data) => {
    let msg;
    try { 
      const rawData = data.toString();
      log('[Bridge] Raw data:', rawData.substring(0, 200));
      msg = JSON.parse(rawData); 
    } catch { return; }
    log('[Bridge] Raw message received:', msg.type, msg.action || '', msg.requestId || '');
    handleOrbitMessage(msg, ws);
  });

  ws.on('close', () => {
    log('[Bridge] Client disconnected');
    if (ws === orbitSocket) {
      orbitSocket = null;
    }
  });

  ws.on('error', (e) => log('[Bridge] WS error:', e.message));

  // Send hello with auth token
  ws.send(JSON.stringify({ type: 'hello', version: '1.0', timestamp: Date.now(), token: BRIDGE_TOKEN }));
});

function handleOrbitMessage(msg, clientWs) {
  log('[Bridge] handleOrbitMessage called:', msg.type, msg.action || '');
  // Identify Orbit connection (main.js sends status on connect)
  if (msg.type === 'status' && msg.connected === true) {
    // Verify auth token
    if (msg.token !== BRIDGE_TOKEN) {
      log('[Bridge] Rejected status: invalid token');
      clientWs.send(JSON.stringify({ type: 'error', error: 'Invalid auth token' }));
      clientWs.close();
      return;
    }
    orbitSocket = clientWs;
    log('[Bridge] Orbit identified via status message');
    // Flush queued puppet commands
    if (puppetQueue.length > 0) {
      log('[Bridge] Flushing', puppetQueue.length, 'queued puppet commands');
      for (const { msg, clientWs: qWs } of puppetQueue) {
        const isNyxAction = msg.action.startsWith('nyx:');
        if (isNyxAction) {
          const requestId = ++puppetRequestId;
          pendingPuppet.set(requestId, { ws: qWs, timeout: setTimeout(() => {
            pendingPuppet.delete(requestId);
            qWs.send(JSON.stringify({ type: 'nyx:result', action: msg.action, ok: false, error: 'Timeout' }));
          }, 15000) });
          orbitSocket.send(JSON.stringify({ ...msg, requestId }));
          log('[Bridge] Flushed nyx puppet:', msg.action, 'requestId:', requestId);
        } else {
          // Basic puppet commands are fire-and-forget
          orbitSocket.send(JSON.stringify(msg));
          log('[Bridge] Flushed basic puppet:', msg.action);
        }
      }
      puppetQueue = [];
    }
    return;
  }

  switch (msg.type) {
    case 'chat':
      handleChat(msg);
      break;
    case 'status':
      log('[Bridge] Orbit status:', msg);
      break;
    case 'pong':
      break;
    case 'ping':
      log('[Bridge] Received ping from Orbit');
      if (orbitSocket?.readyState === WebSocket.OPEN) {
        orbitSocket.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      }
      break;
    case 'puppet':
      // Forward puppet commands to Orbit (main.js)
      if (orbitSocket?.readyState === WebSocket.OPEN) {
        // Only track Nyx capability requests (they send responses)
        const isNyxAction = msg.action.startsWith('nyx:');
        if (isNyxAction) {
          const requestId = ++puppetRequestId;
          pendingPuppet.set(requestId, { ws: clientWs, timeout: setTimeout(() => {
            pendingPuppet.delete(requestId);
            clientWs.send(JSON.stringify({ type: 'nyx:result', action: msg.action, ok: false, error: 'Timeout' }));
          }, 15000) });
          orbitSocket.send(JSON.stringify({ ...msg, requestId }));
          log('[Bridge] Forwarded nyx puppet:', msg.action, 'requestId:', requestId, 'pending:', pendingPuppet.size);
        } else {
          // Basic puppet commands are fire-and-forget
          orbitSocket.send(JSON.stringify(msg));
          log('[Bridge] Forwarded basic puppet:', msg.action);
        }
      } else {
        log('[Bridge] Orbit not connected, queueing puppet:', msg.action);
        puppetQueue.push({ msg, clientWs });
        clientWs.send(JSON.stringify({ type: 'nyx:result', action: msg.action, ok: false, error: 'Orbit not connected, queued' }));
      }
      break;
    case 'nyx:result':
      // Result from Orbit - forward to original requester
      if (msg.requestId && pendingPuppet.has(msg.requestId)) {
        const { ws, timeout } = pendingPuppet.get(msg.requestId);
        clearTimeout(timeout);
        pendingPuppet.delete(msg.requestId);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
          log('[Bridge] Forwarded nyx:result to requester:', msg.action, 'pending:', pendingPuppet.size);
        }
      } else {
        log('[Bridge] Nyx result (no requester):', msg.action, 'requestId:', msg.requestId, 'ok:', msg.ok, 'error:', msg.error || '', 'pending:', pendingPuppet.size);
      }
      break;
    default:
      log('[Bridge] Unknown message type:', msg.type);
  }
}

async function handleChat(msg) {
  const { text, sessionId } = msg;
  if (!text || !sessionId) return;

  log(`[Bridge] Chat from Orbit (${sessionId}):`, text);

  // This is where Nyx (me) would process the message
  // For now, return a placeholder - the real integration happens via
  // Hermes sending a 'reply' message back through the bridge
  // We'll store the resolver so Hermes can fulfill it
  
  // Signal Hermes that a chat arrived - in practice Hermes polls or we use IPC
  // For simplicity, we'll auto-reply with a marker that Hermes should replace
  sendToOrbit({
    type: 'reply',
    sessionId,
    text: '[NYX_PENDING]', // Hermes will overwrite this via puppet 'speak'
    meta: { originalQuery: text }
  });
}

// === Puppet API (called by Hermes from terminal) ===

function sendToOrbit(obj) {
  if (orbitSocket?.readyState === WebSocket.OPEN) {
    orbitSocket.send(JSON.stringify(obj));
  } else {
    log('[Bridge] Orbit not connected, queuing:', obj.type);
  }
}

// Expose puppet functions globally for Hermes to call
global.bridgePuppet = {
  move: (dx, dy) => sendToOrbit({ type: 'puppet', action: 'move', payload: { dx, dy } }),
  setColor: (state, hex) => sendToOrbit({ type: 'puppet', action: 'color', payload: { state, hex } }),
  sleep: () => sendToOrbit({ type: 'puppet', action: 'sleep', payload: {} }),
  wake: () => sendToOrbit({ type: 'puppet', action: 'wake', payload: {} }),
  speak: (text) => sendToOrbit({ type: 'puppet', action: 'speak', payload: { text } }),
  bounce: () => sendToOrbit({ type: 'puppet', action: 'bounce', payload: {} }),
  setRoam: (enabled) => sendToOrbit({ type: 'puppet', action: 'roam', payload: { enabled } }),
  getStatus: () => ({ connected: !!orbitSocket, clients: wss.clients.size }),

  // Nyx capabilities (forward to Orbit's IPC)
  nyx: {
    focusedWindow: () => sendToOrbit({ type: 'puppet', action: 'nyx:focusedWindow', payload: {} }),
    listWindows: () => sendToOrbit({ type: 'puppet', action: 'nyx:listWindows', payload: {} }),
    screenshot: (opts = {}) => sendToOrbit({ type: 'puppet', action: 'nyx:screenshot', payload: opts }),
    clipboard: {
      read: (format) => sendToOrbit({ type: 'puppet', action: 'nyx:clipboard:read', payload: { format } }),
      write: (data) => sendToOrbit({ type: 'puppet', action: 'nyx:clipboard:write', payload: data }),
    },
    system: {
      vitals: () => sendToOrbit({ type: 'puppet', action: 'nyx:system:vitals', payload: {} }),
    },
    focusWindow: (windowId) => sendToOrbit({ type: 'puppet', action: 'nyx:focusWindow', payload: { windowId } }),
  },
};

// Heartbeat
setInterval(() => {
  if (orbitSocket?.readyState === WebSocket.OPEN) {
    orbitSocket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
  }
}, 10000);

log('[Bridge] Ready. Puppet API: global.bridgePuppet.{move,setColor,sleep,wake,speak,bounce,setRoam,getStatus}');
log('[Bridge] Example: bridgePuppet.speak("Hello from Nyx")');