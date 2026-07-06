// VibeShell — main process entry point.
// Responsible only for app lifecycle and window creation.
// All feature logic lives in modules under ./main/ so the renderer
// can later be migrated (e.g. to React) without touching this file.

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const registry = require('./main/registry');

// Linux (especially inside a VM/container, or running as root like Kali) can't
// bring up Chromium's GPU sandbox from source — disable both so the window
// opens without the user passing --no-sandbox by hand. (Packaged builds set
// the sandbox up properly; this only bites when running from source.)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  // Some kernels (Kali/Debian in a VM) have a seccomp filter that blocks the
  // syscalls Chromium uses for shared memory (memfd_create/ftruncate), which
  // crashes startup with a misleading "shared memory … No such process".
  app.commandLine.appendSwitch('disable-seccomp-filter-sandbox');
  // VMs/containers often have a missing or mis-permissioned /dev/shm; fall
  // back to /tmp for shared memory so Chromium doesn't crash on startup.
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.disableHardwareAcceleration();
}
const { registerProjectHandlers } = require('./main/projects');
const { registerAgentHandlers } = require('./main/agent');
const { registerToolHandlers } = require('./main/tools');
const { registerAccountHandlers } = require('./main/account');
const { registerChatHandlers } = require('./main/chats');
const { registerSettingsHandlers } = require('./main/settings');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#f7f7f8',
    title: 'VibeShell',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    // Frameless with native window controls: the UI paints its own top bar
    // in the active theme's colors (like the browser apps' PWA installs).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f7f7f8', symbolColor: '#1f1f1f', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Security: the renderer never gets direct Node access.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Links (e.g. in agent replies) open in the real browser — the app window
  // itself must never navigate away from the UI.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  win.loadFile('index.html');
  return win;
}

// "New window" — a fully parallel session (each window owns its own agent).
ipcMain.handle('win:new', () => {
  createWindow();
  return { ok: true };
});

// The renderer re-tints the native window buttons whenever the theme or
// dark mode changes, so the controls always sit on the right background.
ipcMain.handle('win:overlay', (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !opts) return { ok: false };
  try {
    win.setTitleBarOverlay({
      color: String(opts.color || '#f7f7f8'),
      symbolColor: String(opts.symbolColor || '#1f1f1f'),
      height: 40,
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

app.whenReady().then(() => {
  // Electron adapter for the shared handler registry: real IPC + native
  // storage/dialogs. (The VS Code extension host supplies its own adapter.)
  registry.useElectron(ipcMain);
  registry.setServices({
    userDataPath: app.getPath('userData'),
    pickFolder: async ({ title, buttonLabel } = {}) => {
      const result = await dialog.showOpenDialog({
        title,
        buttonLabel,
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    },
  });

  registerProjectHandlers();
  registerAgentHandlers();
  registerToolHandlers();
  registerAccountHandlers();
  registerChatHandlers();
  registerSettingsHandlers();
  createWindow();

  // macOS convention; harmless on Windows.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
