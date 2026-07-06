#!/usr/bin/env node
// `vibeshell` — type it in your editor's integrated terminal to open the
// VibeShell panel in that same editor, scoped to the terminal's folder.
//
// It detects the host editor from the environment the terminal runs in and
// asks it (via its URL handler) to open the panel. Install once (see README),
// then `vibeshell` works in every VS Code / editor terminal.

const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXT_ID = 'vibeshell.vibeshell-vscode';

function buildVsCodeUri(cwd, scheme = 'vscode') {
  return `${scheme}://${EXT_ID}/open?cwd=${encodeURIComponent(cwd)}`;
}

// Which editor owns this terminal? All VS Code forks report TERM_PROGRAM=vscode.
function detectEditor(env) {
  const term = String(env.TERM_PROGRAM || '').toLowerCase();
  if (term.includes('vscode') || env.VSCODE_PID || env.VSCODE_GIT_IPC_HANDLE) return 'vscode';
  if (env.TERMINAL_EMULATOR && /jetbrains/i.test(env.TERMINAL_EMULATOR)) return 'jetbrains';
  return null;
}

// Which VS Code *fork* — each needs its own CLI command and URL scheme. The
// running app leaks its path through the git-askpass/IPC env vars.
function detectVsCodeFork(env) {
  const hint = (
    env.VSCODE_GIT_ASKPASS_NODE || env.VSCODE_GIT_ASKPASS_MAIN ||
    env.VSCODE_IPC_HOOK_CLI || env.TERM_PROGRAM_VERSION || ''
  ).toLowerCase();
  if (hint.includes('cursor')) return { cli: 'cursor', scheme: 'cursor', label: 'Cursor' };
  if (hint.includes('windsurf')) return { cli: 'windsurf', scheme: 'windsurf', label: 'Windsurf' };
  if (hint.includes('codium')) return { cli: 'codium', scheme: 'vscodium', label: 'VSCodium' };
  return { cli: 'code', scheme: 'vscode', label: 'VS Code' };
}

function openVsCode(cwd) {
  const fork = detectVsCodeFork(process.env);
  const uri = buildVsCodeUri(cwd, fork.scheme);
  // The fork's CLI resolves to the running instance inside its own terminal.
  execFile(fork.cli, ['--open-url', uri], { shell: true }, (err) => {
    if (err) {
      console.error(
        `Couldn't reach ${fork.label}. Make sure its \`${fork.cli}\` command is on PATH\n` +
        `(${fork.label} → Command Palette → "Shell Command: Install '${fork.cli}' command in PATH").`
      );
      process.exit(1);
    }
    console.log(`Opening VibeShell in ${fork.label}…`);
  });
}

// Outside an editor terminal, open the desktop app instead — so `vibeshell`
// does something useful from any shell.
function launchDesktop(cwd) {
  const appRoot = path.join(__dirname, '..');
  let electronBin;
  try {
    electronBin = require(path.join(appRoot, 'node_modules', 'electron'));
  } catch {
    console.log('VibeShell: run this inside a VS Code terminal, or start the desktop app.');
    return;
  }
  const child = spawn(electronBin, [appRoot], {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  console.log('Opening the VibeShell desktop app…');
}

// JetBrains IDEs have no URI CLI, so we drop the folder into a trigger file
// the plugin watches. You're inside the editor, so if the panel doesn't open
// we GUIDE you (not silently launch the desktop app, which is confusing here).
function openJetBrains(cwd) {
  const dir = path.join(os.homedir(), '.vibeshell');
  const trigger = path.join(dir, 'ide-open');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(trigger, cwd);
  } catch {
    console.log('VibeShell: could not signal the IDE. Is the plugin installed?');
    return;
  }
  console.log('Opening the VibeShell panel…');
  setTimeout(() => {
    if (fs.existsSync(trigger)) {
      try { fs.unlinkSync(trigger); } catch { /* ignore */ }
      console.log(
        "\nThe panel didn't respond. To finish setup:\n" +
        '  1) run:  npm run vibeshell:android-studio\n' +
        '  2) fully restart the IDE\n' +
        'then type `vibeshell` again. (Or open the "VibeShell" tab in the bottom panel.)'
      );
    }
  }, 3000);
}

function main() {
  const cwd = process.cwd();
  const editor = detectEditor(process.env);

  if (editor === 'vscode') {
    openVsCode(cwd);
  } else if (editor === 'jetbrains') {
    openJetBrains(cwd);
  } else {
    launchDesktop(cwd);
  }
}

if (require.main === module) main();

module.exports = { buildVsCodeUri, detectEditor, detectVsCodeFork };
