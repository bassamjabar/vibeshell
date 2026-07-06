// Launch Electron with the flags Chromium must see at NATIVE startup (before
// main.js runs). On Linux — especially Kali/Debian in a VM — the seccomp
// filter blocks the syscalls Chromium uses for shared memory, so the flag has
// to be on the real command line, not app.commandLine.appendSwitch().
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron'); // resolves to the electron binary path

const args = ['.'];
if (process.platform === 'linux') {
  args.push(
    '--no-sandbox',
    '--disable-seccomp-filter-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  );
}

const child = spawn(electron, args, { stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 0));
