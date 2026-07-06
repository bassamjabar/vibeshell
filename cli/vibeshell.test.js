// Unit test for the vibeshell CLI's pure logic (no editor needed).
const assert = require('assert');
const { buildVsCodeUri, detectEditor, detectVsCodeFork } = require('./vibeshell.js');

const checks = [];
const check = (name, cond) => checks.push({ name, pass: !!cond });

// URI construction encodes the cwd.
const uri = buildVsCodeUri('C:\\dev\\my app');
check('uri has the extension id', uri.startsWith('vscode://vibeshell.vibeshell-vscode/open'));
check('uri encodes the cwd', uri.includes('cwd=C%3A%5Cdev%5Cmy%20app'));

// Editor detection from the terminal's environment.
check('detects vscode via TERM_PROGRAM', detectEditor({ TERM_PROGRAM: 'vscode' }) === 'vscode');
check('detects vscode via VSCODE_PID', detectEditor({ VSCODE_PID: '1234' }) === 'vscode');
check('detects jetbrains', detectEditor({ TERMINAL_EMULATOR: 'JetBrains-JediTerm' }) === 'jetbrains');
check('plain shell → null', detectEditor({ TERM_PROGRAM: 'Apple_Terminal' }) === null);
check('empty env → null', detectEditor({}) === null);

// VS Code fork detection (each needs its own CLI + URL scheme).
check('default fork is VS Code',
  detectVsCodeFork({}).cli === 'code' && detectVsCodeFork({}).scheme === 'vscode');
check('detects Cursor', (() => {
  const f = detectVsCodeFork({ VSCODE_GIT_ASKPASS_NODE: 'C:/Users/x/AppData/Local/Programs/cursor/Cursor.exe' });
  return f.cli === 'cursor' && f.scheme === 'cursor';
})());
check('detects VSCodium', (() => {
  const f = detectVsCodeFork({ VSCODE_GIT_ASKPASS_MAIN: '/usr/share/codium/resources/app/x' });
  return f.cli === 'codium' && f.scheme === 'vscodium';
})());
check('detects Windsurf', (() => {
  const f = detectVsCodeFork({ VSCODE_IPC_HOOK_CLI: '/Applications/Windsurf.app/x' });
  return f.cli === 'windsurf' && f.scheme === 'windsurf';
})());
check('Cursor URI uses cursor scheme',
  buildVsCodeUri('/p', 'cursor').startsWith('cursor://vibeshell.vibeshell-vscode/open'));

const passed = checks.filter((c) => c.pass).length;
console.log('CLI_TEST_RESULT ' + JSON.stringify({
  passed, total: checks.length,
  failures: checks.filter((c) => !c.pass).map((c) => c.name),
}, null, 2));
assert.strictEqual(passed, checks.length);
process.exit(0);
