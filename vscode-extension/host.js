// VibeShell extension host — the VS Code-side backend.
//
// Reuses the desktop app's feature handlers verbatim (../main/*), which after
// the registry refactor no longer depend on Electron. This module supplies
// the platform services (storage path, folder picker) and turns webview
// messages into handler calls, with a per-panel "sender" that pushes events
// back exactly like Electron's webContents does.

const path = require('path');
const fs = require('fs');

// Resolve the backend either from a bundled copy (packaged VSIX) or the repo
// layout one level up (development).
const MAIN_DIR = fs.existsSync(path.join(__dirname, 'main', 'registry.js'))
  ? path.join(__dirname, 'main')
  : path.join(__dirname, '..', 'main');

const registry = require(path.join(MAIN_DIR, 'registry'));
const { registerAgentHandlers } = require(path.join(MAIN_DIR, 'agent'));
const { registerToolHandlers } = require(path.join(MAIN_DIR, 'tools'));
const { registerAccountHandlers } = require(path.join(MAIN_DIR, 'account'));
const { registerChatHandlers } = require(path.join(MAIN_DIR, 'chats'));
const { registerProjectHandlers } = require(path.join(MAIN_DIR, 'projects'));
const { registerSettingsHandlers } = require(path.join(MAIN_DIR, 'settings'));

let registered = false;

// Wire the shared registry to VS Code services and register every handler.
// Idempotent — the handler map is process-global.
function registerBackend(services) {
  if (registered) return;
  registry.setServices(services);
  registerProjectHandlers();
  registerAgentHandlers();
  registerToolHandlers();
  registerAccountHandlers();
  registerChatHandlers();
  registerSettingsHandlers();
  registered = true;
}

// A stand-in for Electron's event.sender: stable id for session keying, an
// event push channel, and destroy notification — the three things the
// feature handlers use.
function makeSender(id, postMessage) {
  const sender = {
    id,
    _destroyed: false,
    _onDestroy: [],
    isDestroyed() { return sender._destroyed; },
    send(channel, payload) {
      if (!sender._destroyed) postMessage({ __vibe: 'event', channel, payload });
    },
    once(eventName, cb) {
      if (eventName === 'destroyed') sender._onDestroy.push(cb);
    },
    destroy() {
      if (sender._destroyed) return;
      sender._destroyed = true;
      for (const cb of sender._onDestroy) cb();
    },
  };
  return sender;
}

// Dispatch one {__vibe:'invoke'} message to its handler and post the result.
async function handleMessage(sender, msg, postMessage) {
  if (!msg || msg.__vibe !== 'invoke') return;
  const handler = registry.get(msg.channel);
  let result = null;
  if (handler) {
    try {
      result = await handler({ sender }, ...(msg.args || []));
    } catch (err) {
      result = null; // handlers already degrade gracefully; never crash the host
      void err;
    }
  }
  postMessage({ __vibe: 'response', id: msg.id, result });
}

module.exports = { registerBackend, makeSender, handleMessage };
