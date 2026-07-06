// Verify the backend-unreachable path: load the REAL bridge, simulate the
// sidecar reporting it died, and confirm the UI shows the banner (not a hang).
//   npx electron vscode-extension/test/backend-error.test.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildWebviewHtml } = require('../html');

const APP_ROOT = path.join(__dirname, '..', '..');

app.whenReady().then(async () => {
  const html = buildWebviewHtml({
    indexHtml: fs.readFileSync(path.join(APP_ROOT, 'index.html'), 'utf8'),
    asWebviewUri: (rel) => rel,
    cspSource: "'self'",
    nonce: 'n0nce',
    // The REAL bridge (no acquireVsCodeApi here → JetBrains-style transport,
    // and __vibeFromJava is defined for the host to call).
    bridgeSrc: fs.readFileSync(path.join(__dirname, '..', 'media', 'bridge.js'), 'utf8'),
  });
  const file = path.join(APP_ROOT, '__backend_test.html');
  fs.writeFileSync(file, html, 'utf8');

  const win = new BrowserWindow({
    show: false, width: 1000, height: 400,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 1200));

  const before = await win.webContents.executeJavaScript(
    `!document.querySelector('#backend-banner').classList.contains('hidden')`);

  // Simulate the sidecar/host reporting failure (what Sidecar.kt sends).
  await win.webContents.executeJavaScript(
    `window.__vibeFromJava(JSON.stringify({ __vibe: 'backend-error' }))`);
  await new Promise((r) => setTimeout(r, 300));

  const after = await win.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('#backend-banner');
    return { visible: !b.classList.contains('hidden'), text: b.textContent };
  })()`);

  const pass = before === false && after.visible === true && after.text.length > 10;
  console.log('BACKEND_ERROR_TEST ' + JSON.stringify({
    bannerHiddenInitially: before === false,
    bannerShownAfterError: after.visible,
    message: after.text,
    PASS: pass,
  }, null, 2));

  try { fs.unlinkSync(file); } catch (e) { void e; }
  app.quit();
  process.exit(pass ? 0 : 2);
});
