// Drive the sidecar over stdio exactly as the JVM plugin will: spawn it,
// send {__vibe:'invoke'} lines, collect {__vibe:'response'|'event'} lines.
//   node jetbrains/sidecar/sidecar.test.js

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const child = spawn(process.execPath, [path.join(__dirname, 'sidecar.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

const pending = new Map();
const events = [];
let ready = false;
let seq = 0;

const rl = readline.createInterface({ input: child.stdout });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.__vibe === 'ready') ready = true;
  else if (msg.__vibe === 'response') {
    const r = pending.get(msg.id);
    if (r) { pending.delete(msg.id); r(msg.result); }
  } else if (msg.__vibe === 'event') events.push(msg);
});

function invoke(channel, ...args) {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ __vibe: 'invoke', id, channel, args }) + '\n');
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, cond) => checks.push({ name, pass: !!cond });

async function main() {
  // Wait for the ready line.
  for (let i = 0; i < 40 && !ready; i += 1) await sleep(50);
  check('sidecar announced ready', ready);

  const tools = await invoke('tools:list');
  check('tools:list over stdio returns 3 tools', Array.isArray(tools) && tools.length === 3);

  // settings round-trip (user scope → ~/.claude/settings.json).
  await invoke('settings:permAdd', 'user', null, 'Bash(echo sidecar:*)');
  const rules = await invoke('settings:permList', null);
  check('permAdd/permList over stdio', rules.some((r) => r.rule === 'Bash(echo sidecar:*)'));
  await invoke('settings:permRemove', 'user', null, 'Bash(echo sidecar:*)');
  const after = await invoke('settings:permList', null);
  check('permRemove over stdio', !after.some((r) => r.rule === 'Bash(echo sidecar:*)'));

  // A live agent session must push events back over stdout.
  await invoke('agent:start', process.cwd(), null, null);
  await sleep(4000);
  check('agent pushed events over stdio', events.some((e) => e.channel === 'agent:event'));
  await invoke('agent:stop');

  const passed = checks.filter((c) => c.pass).length;
  console.log('SIDECAR_TEST ' + JSON.stringify({
    passed, total: checks.length,
    failures: checks.filter((c) => !c.pass).map((c) => c.name),
  }, null, 2));

  child.stdin.end();
  child.kill();
  process.exit(passed === checks.length ? 0 : 2);
}

main().catch((e) => { console.error('SIDECAR_TEST_FAIL:', e.message); child.kill(); process.exit(1); });
