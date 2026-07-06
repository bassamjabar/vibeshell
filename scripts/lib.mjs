// Shared helpers for the one-command installers: a small, dependency-free
// terminal UI (colors, clean task lines, a download progress bar) plus PATH
// setup — so installing feels like a polished, professional tool.
import { execSync } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const style = {
  green: c('32'), red: c('31'), yellow: c('33'), cyan: c('36'),
  magenta: c('35'), dim: c('2'), bold: c('1'), gray: c('90'),
};

// A rounded banner in brand color.
export function banner(subtitle) {
  const title = `  VibeShell  ${style.dim('·')}  ${subtitle}  `;
  const width = stripAnsi(title).length;
  const line = '─'.repeat(width);
  console.log('');
  console.log(style.magenta('  ╭' + line + '╮'));
  console.log(style.magenta('  │') + style.bold(title) + style.magenta('│'));
  console.log(style.magenta('  ╰' + line + '╯'));
  console.log('');
}

function stripAnsi(s) {
  return String(s).replace(/\[[0-9;]*m/g, '');
}

// Node.js is required everywhere (installers, extension, sidecar, agent).
// The installer already runs under Node, so this reports the version and
// warns if it's too old to run the agent reliably.
export function checkNode() {
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0], 10);
  if (major < 18) {
    warn(`Node.js ${v} is old — install Node 18+ from nodejs.org for reliable operation.`);
  } else {
    ok(`Node.js ${v}`);
  }
}

export function ok(msg) { console.log(`  ${style.green('✓')} ${msg}`); }
export function info(msg) { console.log(`  ${style.cyan('▸')} ${msg}`); }
export function warn(msg) { console.log(`  ${style.yellow('!')} ${style.yellow(msg)}`); }
export function fail(msg) { console.log(`  ${style.red('✗')} ${style.red(msg)}`); }
export function done(msg) { console.log(`\n  ${style.green('✅')} ${style.bold(msg)}\n`); }
export function note(msg) { console.log(`    ${style.dim(msg)}`); }

// Run a command as a clean task line: "▸ label" while running, rewritten to
// "✓ label" on success. Command output stays hidden unless it fails.
export function task(label, cmd, cwd, env = {}) {
  process.stdout.write(`  ${style.cyan('▸')} ${label}${style.dim(' …')}\n`);
  try {
    execSync(cmd, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
    if (useColor) process.stdout.write('\x1b[1A\x1b[2K'); // rewrite the line
    ok(label);
  } catch (e) {
    if (useColor) process.stdout.write('\x1b[1A\x1b[2K');
    fail(label);
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
    if (out) console.log(style.dim(out.split('\n').slice(-20).join('\n')));
    throw e;
  }
}

// Live progress bar for a download (bytes → colored bar + %).
function drawBar(done, total) {
  const width = 26;
  const ratio = total ? Math.min(1, done / total) : 0;
  const filled = Math.round(ratio * width);
  const bar = style.magenta('█'.repeat(filled)) + style.gray('░'.repeat(width - filled));
  const mb = (n) => (n / 1048576).toFixed(0);
  const pct = String(Math.round(ratio * 100)).padStart(3);
  const size = total ? `${mb(done)} MB / ${mb(total)} MB` : `${mb(done)} MB`;
  process.stdout.write(`\r    ${bar} ${style.bold(pct + '%')}  ${style.dim(size)}   `);
}

// Download a URL to a file, following redirects, with a progress bar.
export function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u, redirects = 0) => {
      https.get(u, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
          res.resume();
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`download failed (HTTP ${res.statusCode})`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        let last = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          const now = Date.now();
          if (useColor && (now - last > 120 || received === total)) {
            drawBar(received, total);
            last = now;
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          if (useColor) process.stdout.write('\n');
          resolve();
        }));
      }).on('error', reject);
    };
    get(url);
  });
}

// Put the repo's cli/ folder on the user PATH so `vibeshell` works anywhere —
// via the Windows user-PATH on Windows, or the shell profile on macOS/Linux.
export function addCliToPath(root) {
  const cliDir = path.join(root, 'cli');
  if (process.platform === 'win32') return addCliToPathWindows(cliDir);
  return addCliToPathPosix(cliDir);
}

function addCliToPathWindows(cliDir) {
  try {
    const cur = execSync(
      'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"',
      { encoding: 'utf8' }
    ).trim();
    if (cur.split(';').some((p) => p.trim().toLowerCase() === cliDir.toLowerCase())) {
      ok('`vibeshell` command already on PATH');
      return;
    }
    const next = cur ? `${cur};${cliDir}` : cliDir;
    execSync(
      'powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable(\'Path\', $env:VIBE_NEWPATH, \'User\')"',
      { env: { ...process.env, VIBE_NEWPATH: next } }
    );
    ok('`vibeshell` command added to PATH');
    note('(open a new terminal for it to take effect)');
  } catch {
    warn(`Couldn't edit PATH — add this folder manually: ${cliDir}`);
  }
}

function addCliToPathPosix(cliDir) {
  // Make the launcher executable, then add a line to the user's shell rc.
  try { fs.chmodSync(path.join(cliDir, 'vibeshell'), 0o755); } catch { /* fine */ }
  const home = process.env.HOME || '';
  const shell = process.env.SHELL || '';
  const rc = shell.includes('zsh') ? '.zshrc' : shell.includes('fish') ? '.config/fish/config.fish' : '.bashrc';
  const rcPath = path.join(home, rc);
  const line = rc.endsWith('config.fish')
    ? `set -gx PATH "${cliDir}" $PATH  # VibeShell`
    : `export PATH="${cliDir}:$PATH"  # VibeShell`;
  try {
    const existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, 'utf8') : '';
    if (existing.includes(cliDir)) {
      ok('`vibeshell` command already on PATH');
      return;
    }
    fs.mkdirSync(path.dirname(rcPath), { recursive: true });
    fs.appendFileSync(rcPath, `\n${line}\n`);
    ok(`\`vibeshell\` command added to PATH (${rc})`);
    note('(open a new terminal for it to take effect)');
  } catch {
    warn(`Couldn't edit ${rc} — add this to your PATH manually: ${cliDir}`);
  }
}
