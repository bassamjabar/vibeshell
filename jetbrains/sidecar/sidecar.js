// VibeShell backend sidecar for JVM hosts (JetBrains / Android Studio).
//
// A JetBrains plugin runs on the JVM and can't execute the Node backend
// in-process, so it spawns this sidecar and talks to it over stdio. The
// sidecar reuses the EXACT same backend as the desktop app and the VS Code
// extension (vscode-extension/host.js → main/*), only the transport differs:
//
//   stdin  ← one JSON object per line: {__vibe:'invoke', id, channel, args}
//   stdout → one JSON object per line: {__vibe:'response', id, result}
//                                       {__vibe:'event', channel, payload}
//
// The plugin forwards stdout lines into the JCEF webview (same messages the
// webview bridge already understands) and forwards the webview's invokes to
// stdin. Nothing about the UI or the handlers changes.

const readline = require('readline');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Reuse the shared backend bridge (registry + handlers + sender + dispatch).
const host = require(path.join(__dirname, '..', '..', 'vscode-extension', 'host'));

// Line-framed JSON to stdout. stderr is left for diagnostics only.
function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// Storage lives in a stable per-user folder (the JVM host has no notion of
// Electron userData / extension globalStorage).
const storageDir = path.join(os.homedir(), '.vibeshell');
try { fs.mkdirSync(storageDir, { recursive: true }); } catch (e) { void e; }

host.registerBackend({
  userDataPath: storageDir,
  // Folder picking is driven from the JS side via projects:pick → for JVM we
  // ask the plugin to open its native chooser and feed the path back. Until
  // that round-trip is wired, returning null degrades gracefully.
  pickFolder: async () => null,
});

// One sender for this host; its pushed events stream to stdout.
const sender = host.makeSender('jetbrains-panel', out);

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  host.handleMessage(sender, msg, out);
});

rl.on('close', () => {
  sender.destroy(); // tears down any live agent session
  process.exit(0);
});

// Announce readiness so the plugin knows the backend is up.
out({ __vibe: 'ready' });
