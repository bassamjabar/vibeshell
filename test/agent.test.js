// Unit tests for main/agent.js (AgentSession): session-id tracking, the
// network-reconnect path, and the permission rules. The Agent SDK is swapped
// for a scripted fake via the require cache, so no CLI or network is needed.
//
// Run:  node test/agent.test.js

const assert = require('assert');
const path = require('path');

/* ---------- Fake Agent SDK, installed before agent.js loads it ---------- */

const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk');

let queryCalls = []; // the options of every query() call, in order
let scripts = [];    // per-call message scripts: [{ msg } | { error }]

function fakeQuery(opts) {
  queryCalls.push(opts);
  const steps = scripts.shift() || [];
  return {
    async *[Symbol.asyncIterator]() {
      for (const step of steps) {
        if (step.error) throw step.error;
        yield step.msg;
      }
      await new Promise(() => {}); // stream stays open, like a live session
    },
    async supportedModels() { return []; },
    async supportedCommands() { return []; },
    async interrupt() {},
    async setPermissionMode() {},
  };
}

require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: { query: fakeQuery },
};

const { AgentSession } = require(path.join(__dirname, '..', 'main', 'agent.js'));

/* ---------- Helpers ---------- */

const checks = [];
const check = (name, cond) => checks.push({ name, pass: !!cond });

function makeSender(events) {
  return {
    isDestroyed: () => false,
    send: (_channel, payload) => events.push(payload),
  };
}

function waitFor(predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

const INIT = {
  type: 'system', subtype: 'init', model: 'claude-sonnet-5', session_id: 'sess-1',
};

/* ---------- Tests ---------- */

async function testReconnect() {
  const events = [];
  queryCalls = [];
  scripts = [
    // First connection: healthy init, then the network drops.
    [{ msg: INIT }, { error: new Error('fetch failed: ECONNRESET') }],
    // Reconnected session: healthy init again.
    [{ msg: INIT }],
  ];
  const session = new AgentSession(makeSender(events), process.cwd(), null, null);

  await waitFor(() => events.some((e) => e.type === 'reconnecting'));
  check('init stores the session id', session.currentSessionId === 'sess-1');
  check('network drop emits reconnecting', true);

  await waitFor(() => events.some((e) => e.type === 'reconnected'), 10000);
  check('a second query is created', queryCalls.length === 2);
  check('the reconnect resumes the SAME session',
    queryCalls[1].options.resume === 'sess-1');
  check('recovery emits reconnected', true);

  await session.close();
}

async function testResumeSeedsSessionId() {
  const events = [];
  queryCalls = [];
  scripts = [[]]; // opens and stays silent
  const session = new AgentSession(makeSender(events), process.cwd(), 'saved-42', null);
  check('a resumed chat can reconnect before any init',
    session.currentSessionId === 'saved-42');
  check('the resume id is passed to the CLI',
    queryCalls[0].options.resume === 'saved-42');
  await session.close();
}

async function testFatalErrorDoesNotReconnect() {
  const events = [];
  queryCalls = [];
  scripts = [[{ msg: INIT }, { error: new Error('something exploded') }]];
  const session = new AgentSession(makeSender(events), process.cwd(), null, null);

  await waitFor(() => events.some((e) => e.type === 'error'));
  const err = events.find((e) => e.type === 'error');
  check('non-network failure surfaces as an error', err && err.code === 'generic');
  check('non-network failure does not reconnect', queryCalls.length === 1);

  await session.close();
}

async function testPermissions() {
  const events = [];
  queryCalls = [];
  scripts = [[]];
  const session = new AgentSession(makeSender(events), process.cwd(), null, null);

  // TodoWrite is the agent's own bookkeeping — always auto-approved.
  const todo = await session.askPermission('TodoWrite', { todos: [] });
  check('TodoWrite is auto-approved', todo.behavior === 'allow');

  // "Always allow" for Bash approves THIS command but is never remembered:
  // a blanket Bash grant would cover every future command.
  const bash = session.askPermission('Bash', { command: 'echo hi' }, { toolUseID: 'p1' });
  session.resolvePermission('p1', { allow: true, always: true });
  check('Bash approval goes through', (await bash).behavior === 'allow');
  check('Bash is never blanket-allowed', !session.alwaysAllow.has('Bash'));

  // "Always allow" for a scoped tool (Edit) IS remembered…
  const edit = session.askPermission('Edit', { file_path: 'a' }, { toolUseID: 'p2' });
  session.resolvePermission('p2', { allow: true, always: true });
  await edit;
  check('Edit "always" is remembered', session.alwaysAllow.has('Edit'));
  // …so the next Edit needs no card at all.
  const edit2 = await session.askPermission('Edit', { file_path: 'b' });
  check('remembered tools skip the card', edit2.behavior === 'allow');

  // Denial.
  const denied = session.askPermission('Bash', { command: 'x' }, { toolUseID: 'p3' });
  session.resolvePermission('p3', { allow: false });
  check('denial goes through', (await denied).behavior === 'deny');

  // Stopping the turn denies everything still waiting.
  const hanging = session.askPermission('Write', { file_path: 'c' }, { toolUseID: 'p4' });
  await session.interruptTurn();
  check('interrupt denies pending approvals', (await hanging).behavior === 'deny');

  // Auto-approve releases pending cards instead of leaving the CLI stuck.
  const stuck = session.askPermission('Write', { file_path: 'd' }, { toolUseID: 'p5' });
  session.setAutoApprove(true);
  check('auto-approve releases pending cards', (await stuck).behavior === 'allow');

  await session.close();
}

/* ---------- Run ---------- */

(async () => {
  await testReconnect();
  await testResumeSeedsSessionId();
  await testFatalErrorDoesNotReconnect();
  await testPermissions();

  const passed = checks.filter((c) => c.pass).length;
  console.log('AGENT_TEST_RESULT ' + JSON.stringify({
    passed,
    total: checks.length,
    failures: checks.filter((c) => !c.pass).map((c) => c.name),
  }, null, 2));
  assert.strictEqual(passed, checks.length);
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
