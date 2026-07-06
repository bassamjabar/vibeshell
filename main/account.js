// Anthropic account status, sign-in, and sign-out — no typed commands.
//
// Status and logout are plain CLI calls (`claude auth status --json`,
// `claude auth logout`). Login is interactive (it opens the browser and
// waits), so we launch it in a real terminal window and let the renderer
// poll `auth:status` until the account flips to logged-in.

const registry = require('./registry');
const { exec } = require('child_process');

const CHECK_TIMEOUT = 15000;

function run(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: CHECK_TIMEOUT, windowsHide: true }, (err, stdout) => {
      // Keep stdout even on a non-zero exit: `claude auth status` prints its
      // JSON either way, and logged-out is a non-zero exit on some versions.
      resolve({ failed: !!err, out: String(stdout || '').trim() });
    });
  });
}

async function accountStatus() {
  const { failed, out } = await run('claude auth status --json');

  // Trust the JSON whenever it parses, regardless of the exit code —
  // otherwise a logged-out account looks like "claude isn't installed"
  // and the UI hides the Sign in button entirely.
  try {
    const s = JSON.parse(out);
    return {
      available: true,
      loggedIn: !!s.loggedIn,
      email: s.email || null,
      plan: s.subscriptionType || null,
      method: s.authMethod || null,
    };
  } catch { /* no JSON — fall through to the checks below */ }

  if (!failed) return { available: true, loggedIn: false };

  // The command failed with no usable output. Only report "not available"
  // when the binary truly isn't on PATH; a transient error (timeout, AV
  // scan) must not make the account controls vanish.
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const found = await run(`${locator} claude`);
  return { available: !!found.out, loggedIn: false };
}

function registerAccountHandlers() {
  registry.handle('auth:status', async () => accountStatus());

  registry.handle('auth:logout', async () => {
    await run('claude auth logout');
    return accountStatus();
  });

  // Opens a terminal window running the interactive sign-in (browser flow).
  registry.handle('auth:login', async () => {
    if (process.platform === 'win32') {
      exec('start "Claude sign-in" cmd /k "claude auth login"', { windowsHide: false });
      return { ok: true };
    }
    if (process.platform === 'darwin') {
      exec(`osascript -e 'tell app "Terminal" to do script "claude auth login"' -e 'tell app "Terminal" to activate'`);
      return { ok: true };
    }
    exec('x-terminal-emulator -e claude auth login');
    return { ok: true };
  });
}

module.exports = { registerAccountHandlers };
