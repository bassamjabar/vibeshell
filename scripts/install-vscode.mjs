// One-command install for the VS Code family — VS Code, VSCodium, Cursor,
// Windsurf — with a clean, colored terminal experience. Builds the extension
// once and installs it into every family editor found on this machine.
//   npm run vibeshell:vscode
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { banner, task, ok, info, warn, addCliToPath, checkNode, done, style } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'vscode-extension');

banner('VS Code family setup');
checkNode();

// Build the (self-contained) VSIX once.
task('Preparing the extension', 'npm install --no-fund --no-audit', ext);
task('Bundling the app', 'node scripts/bundle.js', ext);
task('Packaging', 'npx --yes @vscode/vsce package --allow-missing-repository --skip-license', ext);

// VS Code and its forks each ship their own CLI; install into whichever exist.
const FAMILY = [
  { name: 'VS Code', cli: 'code' },
  { name: 'VSCodium', cli: 'codium' },
  { name: 'Cursor', cli: 'cursor' },
  { name: 'Windsurf', cli: 'windsurf' },
];
// The VSIX name follows the extension's package.json version — never hard-code it.
const extVersion = JSON.parse(readFileSync(path.join(ext, 'package.json'), 'utf8')).version;
const vsix = `vibeshell-vscode-${extVersion}.vsix`;
let installed = 0;
for (const editor of FAMILY) {
  if (!onPath(editor.cli)) continue;
  try {
    task(`Installing into ${editor.name}`, `${editor.cli} --install-extension ${vsix} --force`, ext);
    installed += 1;
  } catch {
    warn(`${editor.name} is present but the install command failed.`);
  }
}

if (installed === 0) {
  warn('No VS Code-family editor found on PATH (code / codium / cursor / windsurf).');
  info('Install one, or add its shell command to PATH, then re-run.');
} else {
  addCliToPath(root);
  done(`Installed into ${installed} editor${installed > 1 ? 's' : ''}.`);
  console.log(`  ${style.dim('Reload the editor, then type')} ${style.bold('vibeshell')} ${style.dim('in a terminal.')}\n`);
}

// Is a command resolvable on PATH? (cross-platform)
function onPath(cmd) {
  const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
  try {
    execSync(probe, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
