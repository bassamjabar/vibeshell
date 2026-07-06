// End-to-end smoke test, driven over the Chrome DevTools Protocol.
// Start the app first:  npx electron . --remote-debugging-port=9222
// Then:                 npm run test:e2e
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A throwaway folder plays the "project" for project-scope tests.
const SCRATCH = process.argv[2] ||
  fs.mkdtempSync(path.join(os.tmpdir(), 'vibeshell-test-'));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json/list');
  const page = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  if (!page) throw new Error('VibeShell page target not found');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  await new Promise((r) => { ws.onopen = r; });

  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.result && r.result.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.text + ' :: ' +
        JSON.stringify(r.result.exceptionDetails.exception || {}));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const scratchJs = JSON.stringify(SCRATCH);
  const out = {};

  // --- 1. "!" backend: run a real command ---
  out.runShell = await evaluate(
    `window.vibeshell.tools.runShell(null, 'echo hello-vibeshell')`);

  // --- 2. Standing permission rules (user scope), add → list → remove ---
  out.ruleAdd = await evaluate(
    `window.vibeshell.settings.permAdd('user', null, 'Bash(echo vibetest:*)')`);
  const rules = await evaluate(`window.vibeshell.settings.permList(null)`);
  out.ruleVisible = rules.some((r) => r.rule === 'Bash(echo vibetest:*)');
  await evaluate(
    `window.vibeshell.settings.permRemove('user', null, 'Bash(echo vibetest:*)')`);
  const rulesAfter = await evaluate(`window.vibeshell.settings.permList(null)`);
  out.ruleGone = !rulesAfter.some((r) => r.rule === 'Bash(echo vibetest:*)');

  // --- 3. MCP servers (project scope in the scratch folder) ---
  out.mcpAdd = await evaluate(
    `window.vibeshell.settings.mcpAdd('project', ${scratchJs}, 'testsrv',
       { command: 'npx -y some-mcp-server --flag' })`);
  const mcp = await evaluate(`window.vibeshell.settings.mcpList(${scratchJs})`);
  out.mcpVisible = mcp.some((s) => s.name === 'testsrv' && s.scope === 'project');
  out.mcpSummary = (mcp.find((s) => s.name === 'testsrv') || {}).summary;
  await evaluate(
    `window.vibeshell.settings.mcpRemove('project', ${scratchJs}, 'testsrv')`);
  const mcpAfter = await evaluate(`window.vibeshell.settings.mcpList(${scratchJs})`);
  out.mcpGone = !mcpAfter.some((s) => s.name === 'testsrv');

  // --- 4. Terminal sessions: list + import (home dir sessions) ---
  const external = await evaluate(`window.vibeshell.chats.external(null)`);
  out.externalCount = external.length;
  out.externalSample = external.slice(0, 3).map((s) => s.title);
  if (external.length > 0) {
    out.import = await evaluate(
      `window.vibeshell.chats.import(null, ${JSON.stringify(external[0].id)})
         .then((r) => r ? { title: r.title, entries: r.feed.length } : null)`);
  }

  // --- 5. Settings modal opens and has both tabs ---
  out.modal = await evaluate(`(() => {
    window.openSettingsModal();
    const m = document.querySelector('#modal-settings');
    const visible = !m.classList.contains('hidden');
    const tabs = [document.querySelector('#tab-mcp').textContent,
                  document.querySelector('#tab-rules').textContent];
    m.classList.add('hidden');
    return { visible, tabs };
  })()`);

  // --- 6. Parallel window ---
  await evaluate(`window.vibeshell.win.newWindow()`);
  await new Promise((r) => setTimeout(r, 2500));
  const targetsAfter = await getJson('http://127.0.0.1:9222/json/list');
  out.windowsAfterNew = targetsAfter.filter(
    (t) => t.type === 'page' && /index\.html/.test(t.url)).length;

  // Cleanup: close the window the test opened (keep the original).
  for (const target of targetsAfter) {
    if (target.type === 'page' && /index\.html/.test(target.url) && target.id !== page.id) {
      await new Promise((r) =>
        http.get(`http://127.0.0.1:9222/json/close/${target.id}`, r).on('error', r));
    }
  }

  console.log(JSON.stringify(out, null, 2));
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
