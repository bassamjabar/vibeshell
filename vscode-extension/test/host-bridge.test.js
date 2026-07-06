// Host ↔ backend integration test (no VS Code, no Electron).
// Proves the extension host can run the desktop app's feature handlers and
// answer webview messages: register the backend with a temp storage dir and
// a stub folder picker, then drive real {__vibe:'invoke'} messages through
// host.handleMessage and check the responses + a pushed event.
//
// Run:  node vscode-extension/test/host-bridge.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');

// Swap the Agent SDK for a scripted fake BEFORE the host loads the backend,
// so the agent:start check is deterministic (no CLI, no login, no network).
// Resolve the SDK exactly the way the backend the host will load sees it —
// host.js prefers the bundled copy (vscode-extension/main) over ../main.
const MAIN_DIR = fs.existsSync(path.join(__dirname, '..', 'main', 'registry.js'))
  ? path.join(__dirname, '..', 'main')
  : path.join(__dirname, '..', '..', 'main');
const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk', { paths: [MAIN_DIR] });
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: {
    query: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'system', subtype: 'init', model: 'claude-sonnet-5', session_id: 'host-test' };
        await new Promise(() => {}); // stream stays open until agent:stop
      },
      async supportedModels() { return []; },
      async supportedCommands() { return []; },
      async interrupt() {},
    }),
  },
};

const host = require('../host');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeshell-host-'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeshell-proj-'));

host.registerBackend({
  userDataPath: tmp,
  pickFolder: async () => project, // deterministic picker
});

// Collect events the host pushes back (per sender).
const events = [];
const sender = host.makeSender('test-panel', (m) => {
  if (m.__vibe === 'event') events.push(m);
});

// Drive one invoke and await its response.
let seq = 0;
function invoke(channel, ...args) {
  return new Promise((resolve) => {
    const id = ++seq;
    host.handleMessage(sender, { __vibe: 'invoke', id, channel, args }, (m) => {
      if (m.__vibe === 'response' && m.id === id) resolve(m.result);
    });
  });
}

const checks = [];
const check = (name, cond) => checks.push({ name, pass: !!cond });

async function main() {
  // tools:list — runs real detection in a plain node process.
  const tools = await invoke('tools:list');
  check('tools:list returns the catalog', Array.isArray(tools) && tools.length >= 1);
  check('tools:list has claude', tools && tools.some((t) => t.id === 'claude'));

  // settings round-trip against the project's .claude/settings.json.
  await invoke('settings:permAdd', 'project', project, 'Bash(echo hosttest:*)');
  let rules = await invoke('settings:permList', project);
  check('permAdd then permList shows the rule',
    rules.some((r) => r.rule === 'Bash(echo hosttest:*)' && r.scope === 'project'));
  const settingsPath = path.join(project, '.claude', 'settings.json');
  check('settings.json written to disk', fs.existsSync(settingsPath));
  await invoke('settings:permRemove', 'project', project, 'Bash(echo hosttest:*)');
  rules = await invoke('settings:permList', project);
  check('permRemove clears the rule', !rules.some((r) => r.rule === 'Bash(echo hosttest:*)'));

  // MCP round-trip.
  await invoke('settings:mcpAdd', 'project', project, 'hostsrv', { command: 'node server.js --x' });
  const mcp = await invoke('settings:mcpList', project);
  check('mcpAdd then mcpList shows server',
    mcp.some((s) => s.name === 'hostsrv' && s.summary === 'node server.js --x'));

  // projects: pick (uses the stub picker) then recents persistence.
  const picked = await invoke('projects:pick');
  check('projects:pick returns the stubbed folder', picked && picked.ok && picked.project);
  const recents = await invoke('projects:recents');
  check('projects:recents persisted the pick', recents.some((r) => r.path === project));
  check('recent-projects.json in storage dir', fs.existsSync(path.join(tmp, 'recent-projects.json')));

  // chats: save (writes a per-chat feed file) then get.
  await invoke('chats:save', { id: 'host-chat-1', project: null, title: 'Host chat', feed: [{ t: 'user', text: 'hi' }] });
  const got = await invoke('chats:get', 'host-chat-1');
  check('chats:save + get round-trips the feed',
    got && got.title === 'Host chat' && got.feed.length === 1 && got.feed[0].text === 'hi');

  // agent:start must create a session and push events to this sender.
  await invoke('agent:start', project, null, null);
  const gotReady = () => events.some((e) => e.payload && e.payload.type === 'ready');
  const deadline = Date.now() + 5000;
  while (!gotReady() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  check('agent pushed at least one event', events.length > 0);
  check('agent event is agent:event channel', events.some((e) => e.channel === 'agent:event'));
  check('agent init reached the panel', events.some((e) =>
    e.payload && e.payload.type === 'ready' && e.payload.sessionId === 'host-test'));
  await invoke('agent:stop');

  const passed = checks.filter((c) => c.pass).length;
  console.log('HOST_TEST_RESULT ' + JSON.stringify({
    passed, total: checks.length,
    failures: checks.filter((c) => !c.pass).map((c) => c.name),
    checks,
  }, null, 2));

  process.exit(passed === checks.length ? 0 : 2);
}

main().catch((e) => { console.error('HOST_TEST_FAIL:', e.message); process.exit(1); });
