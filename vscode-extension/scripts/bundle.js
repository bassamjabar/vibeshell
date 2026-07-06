// Copy the app's UI + backend into the extension so the packaged VSIX is
// self-contained (no ../ references at runtime). Run before `vsce package`.

const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..');
const APP = path.join(EXT, '..');

function copyDir(src, dest, skip = () => false) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to, skip);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

// index.html
fs.copyFileSync(path.join(APP, 'index.html'), path.join(EXT, 'index.html'));

// renderer/ (the whole UI)
rmrf(path.join(EXT, 'renderer'));
copyDir(path.join(APP, 'renderer'), path.join(EXT, 'renderer'));

// main/ (the backend — minus nothing; all of it is transport-agnostic now)
rmrf(path.join(EXT, 'main'));
copyDir(path.join(APP, 'main'), path.join(EXT, 'main'));

console.log('Bundled index.html + renderer/ + main/ into the extension.');
