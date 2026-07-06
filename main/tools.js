// AI tool catalog — detection, install, and update.
//
// Each supported CLI tool is described once in TOOLS. The renderer never
// runs a command itself: it asks "what's installed?" and clicks Install /
// Update; everything executes here, and install progress streams back to
// the UI as 'tools:event' messages.

const registry = require('./registry');
const { exec, spawn } = require('child_process');

const CHECK_TIMEOUT = 30000; // cold starts + antivirus scans can be slow

const TOOLS = [
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    blurb: "Anthropic's coding agent — fully supported in VibeShell.",
    pkg: '@anthropic-ai/claude-code',
    bin: 'claude',
    chatReady: true,
  },
];

// Run a short read-only command; resolve with its stdout, or null on any
// failure (not installed, no npm, timeout, …). Never rejects.
function run(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: CHECK_TIMEOUT, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim());
    });
  });
}

// "1.0.35 (Claude Code)" → "1.0.35"
function parseVersion(text) {
  const match = String(text || '').match(/\d+\.\d+\.\d+/);
  return match ? match[0] : null;
}

async function installedVersion(tool) {
  return parseVersion(await run(`${tool.bin} --version`));
}

// Two-step detection so an installed tool NEVER shows an Install button:
// 1. run `<bin> --version` (slow but gives the version);
// 2. if that fails (timeout, crashed CLI, …) just look for the binary on
//    PATH — instant, and proves the tool is there even without a version.
async function detect(tool) {
  const out = await run(`${tool.bin} --version`);
  if (out !== null) return { installed: true, version: parseVersion(out) };
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const found = await run(`${locator} ${tool.bin}`);
  return { installed: !!(found && found.trim()), version: null };
}

function publicInfo(tool) {
  const { id, name, vendor, blurb, chatReady } = tool;
  return { id, name, vendor, blurb, chatReady };
}

// toolId → { child, canceled } for installs that are currently running.
const activeInstalls = new Map();

function killTree(child) {
  if (process.platform === 'win32') {
    // shell:true means the direct child is cmd.exe — kill the whole tree.
    exec(`taskkill /pid ${child.pid} /T /F`, { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

// How to run a global install per OS. Windows writes to the user's own dir
// (no elevation). macOS/Linux need admin, so we pop a GRAPHICAL password
// prompt (osascript / pkexec) — a plain button click can't gain root, and
// silently failing is what confused users. Returns spawn(cmd, args, opts) args.
function installSpawn(pkg) {
  const npmArgs = ['install', '-g', `${pkg}@latest`, '--no-fund', '--no-audit'];
  if (process.platform === 'win32') {
    return ['npm', npmArgs, { shell: true, windowsHide: true }]; // shell resolves npm.cmd
  }
  if (process.platform === 'darwin') {
    const inner = `export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH; npm ${npmArgs.join(' ')}`;
    return ['osascript', ['-e', `do shell script "${inner}" with administrator privileges`], {}];
  }
  return ['pkexec', ['npm', ...npmArgs], {}]; // Linux: polkit graphical auth dialog
}

function registerToolHandlers() {
  // Fast pass: which tools are installed, and at what version?
  registry.handle('tools:list', async () => {
    return Promise.all(
      TOOLS.map(async (tool) => {
        const status = await detect(tool);
        return {
          ...publicInfo(tool),
          installed: status.installed,
          installedVersion: status.version,
        };
      })
    );
  });

  // Slow pass (needs the network): newest published version of each tool.
  // Returns { toolId: "1.2.3" | null }.
  registry.handle('tools:latest', async () => {
    const entries = await Promise.all(
      TOOLS.map(async (tool) => [
        tool.id,
        parseVersion(await run(`npm view ${tool.pkg} version`)),
      ])
    );
    return Object.fromEntries(entries);
  });

  // Install and update are the same command: npm always fetches the latest.
  registry.handle('tools:install', (event, toolId) => {
    const tool = TOOLS.find((t) => t.id === toolId);
    if (!tool) return { ok: false, error: 'Unknown tool.' };
    if (activeInstalls.has(toolId)) return { ok: false, error: 'Already installing.' };

    return new Promise((resolve) => {
      const child = spawn(...installSpawn(tool.pkg));
      const entry = { child, canceled: false };
      activeInstalls.set(toolId, entry);

      const progress = (chunk) => {
        const line = String(chunk)
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .pop();
        if (line && !event.sender.isDestroyed()) {
          event.sender.send('tools:event', { toolId, line });
        }
      };
      child.stdout.on('data', progress);
      child.stderr.on('data', progress);

      child.on('error', () => {
        activeInstalls.delete(toolId);
        resolve({
          ok: false,
          error: process.platform === 'win32'
            ? 'npm was not found. Install Node.js first (nodejs.org), then try again.'
            : `Couldn't run the installer. In a terminal run:\n  sudo npm install -g ${tool.pkg}\nthen click Open.`,
        });
      });

      child.on('close', async (code) => {
        activeInstalls.delete(toolId);
        if (entry.canceled) {
          resolve({ ok: false, canceled: true });
          return;
        }
        if (code !== 0) {
          // A global npm install writes to a system folder. On Windows that's
          // the user's own dir (no admin needed); on macOS/Linux it needs
          // root, so a plain click fails — tell the user the exact command.
          const needsAdmin = process.platform !== 'win32';
          resolve({
            ok: false,
            error: needsAdmin
              ? `Installing needs admin rights. In a terminal run:\n  sudo npm install -g ${tool.pkg}\nthen come back and click Open.`
              : `The install didn't finish (npm exit code ${code}). Check your internet connection and try again.`,
          });
          return;
        }
        resolve({ ok: true, version: await installedVersion(tool) });
      });
    });
  });

  // "!" mode — the user runs a shell command themselves, in the project
  // folder. The output shows in the chat and rides along as context with
  // their next message (like bash mode in the terminal).
  registry.handle('tools:runShell', (_event, dir, command) => {
    const cmd = String(command || '').trim();
    if (!cmd) return { ok: false, output: '' };
    const cwd = typeof dir === 'string' && dir ? dir : undefined;
    return new Promise((resolve) => {
      exec(
        cmd,
        { cwd, timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          let output = `${String(stdout || '')}${stderr ? `\n${String(stderr)}` : ''}`.trim();
          if (output.length > 8000) output = `${output.slice(0, 8000)}\n… (truncated)`;
          if (err && err.killed) output = `${output}\n(timed out after 120s)`.trim();
          resolve({ ok: !err, output });
        }
      );
    });
  });

  // Stop a running install: the close handler above reports it as canceled.
  registry.handle('tools:cancel', (_event, toolId) => {
    const entry = activeInstalls.get(toolId);
    if (!entry) return { ok: false };
    entry.canceled = true;
    killTree(entry.child);
    return { ok: true };
  });
}

module.exports = { registerToolHandlers };
