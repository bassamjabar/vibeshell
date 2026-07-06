// Faithful webview render test WITHOUT VS Code: generate the webview HTML
// with the real transform, load it in a sandboxed Chromium window (no node,
// like a VS Code webview), and confirm the real renderer mounted.
//
// Run:  npx electron vscode-extension/test/webview-render.test.js

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildWebviewHtml } = require('../html');

const APP_ROOT = path.join(__dirname, '..', '..');

// A minimal stub bridge so the UI can mount without a live extension host.
// (The real media/bridge.js round-trips to the host; that path is covered by
// host-bridge.test.js.) This test only proves the renderer + CSS + CSP.
const STUB_BRIDGE = `
  const R = (v) => Promise.resolve(v);
  const TOOLS = [
    { id:'claude', name:'Claude Code', vendor:'Anthropic', blurb:'', chatReady:true, installed:true, installedVersion:null },
    { id:'codex', name:'Codex CLI', vendor:'OpenAI', blurb:'', chatReady:false, installed:false, installedVersion:null },
    { id:'gemini', name:'Gemini CLI', vendor:'Google', blurb:'', chatReady:false, installed:false, installedVersion:null },
  ];
  const noop = () => {};
  window.vibeshell = {
    win: { setOverlay: noop, newWindow: noop },
    tools: { list: () => R(TOOLS), latest: () => R({}), install: () => R({ok:false}), cancel: noop, runShell: () => R({ok:false,output:''}), onEvent: noop },
    auth: { status: () => R({ available:true, loggedIn:false }), login: () => R({ok:false}), logout: () => R({available:true,loggedIn:false}) },
    projects: { pick:()=>R({ok:false}), create:()=>R({ok:false}), open:()=>R({ok:false}), recents:()=>R([]), files:()=>R([]), addMemory:()=>R({ok:false}), removeRecent:()=>R([]) },
    chats: { list:()=>R([]), get:()=>R(null), save:()=>R({ok:true}), delete:()=>R({ok:true}), makeTitle:()=>R({ok:false}), external:()=>R([]), import:()=>R(null) },
    agent: { start:()=>R({ok:true}), send:()=>R({ok:true}), setModel:noop, setMode:noop, rewind:()=>R({ok:true}), permissions:()=>R([]), revokePermission:()=>R([]), interrupt:noop, setAutoApprove:noop, setEffort:noop, setFastMode:noop, respondPermission:noop, stop:noop, onEvent:noop },
    settings: { mcpList:()=>R([]), mcpAdd:()=>R({ok:false}), mcpRemove:()=>R({ok:true}), permList:()=>R([]), permAdd:()=>R({ok:false}), permRemove:()=>R({ok:true}) },
  };
`;

function generate() {
  const html = buildWebviewHtml({
    indexHtml: fs.readFileSync(path.join(APP_ROOT, 'index.html'), 'utf8'),
    // Same-origin relative paths (the test file sits at the app root).
    asWebviewUri: (rel) => rel,
    cspSource: "'self'",
    nonce: 'testnonce123',
    bridgeSrc: STUB_BRIDGE,
  });
  const out = path.join(APP_ROOT, '__webview_test.html');
  fs.writeFileSync(out, html, 'utf8');
  return out;
}

app.whenReady().then(async () => {
  const file = generate();
  const cspErrors = [];

  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });

  // Capture any CSP violation / console error the renderer emits.
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 || /Content Security Policy|refused|blocked/i.test(message)) {
      cspErrors.push(message);
    }
  });

  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 1500)); // let deferred scripts run

  const result = await win.webContents.executeJavaScript(`(() => ({
    hasVibeshell: typeof window.vibeshell === 'object',
    hasBridgeApiHook: 'win' in (window.vibeshell || {}),
    lang: (window.I18N && window.I18N.lang) || null,
    toolCards: document.querySelectorAll('.tool-card').length,
    toolNames: [...document.querySelectorAll('.tool-name')].map(n => n.textContent),
    homeVisible: !document.querySelector('#screen-home').classList.contains('hidden'),
    styledBg: getComputedStyle(document.body).backgroundColor,
    brand: (document.querySelector('.brand h1') || {}).textContent || null,
  }))()`);

  result.cspErrors = cspErrors;
  result.PASS =
    result.hasVibeshell &&
    result.toolCards === 3 &&
    result.homeVisible &&
    cspErrors.length === 0;

  console.log('VIBE_TEST_RESULT ' + JSON.stringify(result));

  try { fs.unlinkSync(file); } catch (e) { void e; }
  app.quit();
  process.exit(result.PASS ? 0 : 2);
});
