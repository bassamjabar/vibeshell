// Render assets/icon.svg → assets/icon.png with a TRANSPARENT background, so the
// rounded-tile corners stay clear instead of showing an ugly white square on
// dark backgrounds (GitHub, editors). Uses Electron (already a dependency) to
// draw the SVG onto a canvas and export PNG with a real alpha channel.
//
//   node_modules/.bin/electron scripts/render-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
}

const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');
const targets = [['icon.png', 512]]; // add [name, size] pairs here for more sizes

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 600, height: 600 });
  await win.loadURL('data:text/html,<body style="margin:0"></body>');

  for (const [name, size] of targets) {
    const js = `new Promise((resolve, reject) => {
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)});
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = ${size}; c.height = ${size};
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, ${size}, ${size});      // keep it transparent
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('SVG failed to load'));
      img.src = url;
    })`;
    const dataUrl = await win.webContents.executeJavaScript(js);
    fs.writeFileSync(path.join(root, 'assets', name), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`wrote assets/${name} (${size}x${size}, transparent)`);
  }

  app.quit();
});
