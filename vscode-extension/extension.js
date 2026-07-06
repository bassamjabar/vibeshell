// VibeShell — VS Code extension host.
// Renders the full VibeShell UI as a webview VIEW docked in the bottom panel
// (next to Terminal / Problems / Output). The renderer is the SAME code the
// desktop app uses; only the window.vibeshell bridge differs (webview
// messaging instead of Electron IPC).

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { buildWebviewHtml } = require('./html');
const host = require('./host');

const VIEW_ID = 'vibeshell.view';

// The app root is the extension folder itself when packaged (index.html is
// bundled in) or one level up in the dev repo layout.
function resolveAppRoot(context) {
  const candidates = [
    context.extensionPath,
    path.join(context.extensionPath, '..'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return candidates[1];
}

// Rewrite the app's index.html for the webview: CSP, resource URIs, and the
// injected bridge that provides window.vibeshell.
function buildHtml(webview, appRoot) {
  return buildWebviewHtml({
    indexHtml: fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8'),
    asWebviewUri: (rel) =>
      webview.asWebviewUri(vscode.Uri.file(path.join(appRoot, rel))).toString(),
    cspSource: webview.cspSource,
    nonce: crypto.randomBytes(16).toString('base64'),
    bridgeSrc: fs.readFileSync(path.join(__dirname, 'media', 'bridge.js'), 'utf8'),
  });
}

// Provides the webview that lives in the bottom panel. VS Code resolves it
// the first time the view becomes visible and (with retainContextWhenHidden)
// keeps it alive after that, so the agent session survives hide/show.
class VibeShellViewProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.pendingCwd = null;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const appRoot = resolveAppRoot(this.context);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(appRoot)],
    };
    webviewView.webview.html = buildHtml(webviewView.webview, appRoot);

    const post = (m) => webviewView.webview.postMessage(m);
    const sender = host.makeSender('vibeshell-panel', post);
    webviewView.webview.onDidReceiveMessage((msg) => host.handleMessage(sender, msg, post));
    webviewView.onDidDispose(() => sender.destroy());

    if (this.pendingCwd) {
      const cwd = this.pendingCwd;
      setTimeout(() => post({ __vibe: 'cwd', cwd }), 400);
      this.pendingCwd = null;
    }
  }

  // Reveal the panel view (opening the bottom panel if needed) and, if we
  // were launched on a project folder, hand it to the UI.
  reveal(cwd) {
    if (this.view) {
      this.view.show(true);
      if (cwd) this.view.webview.postMessage({ __vibe: 'cwd', cwd });
    } else {
      this.pendingCwd = cwd || null;
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }
  }
}

function activate(context) {
  // Wire the shared backend to VS Code services (storage + native picker).
  const storageDir = context.globalStorageUri.fsPath;
  try { fs.mkdirSync(storageDir, { recursive: true }); } catch (e) { void e; }
  host.registerBackend({
    userDataPath: storageDir,
    pickFolder: async ({ title, buttonLabel } = {}) => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        title,
        openLabel: buttonLabel,
      });
      return picked && picked.length ? picked[0].fsPath : null;
    },
  });

  const provider = new VibeShellViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const currentCwd = () => {
    const folder = (vscode.workspace.workspaceFolders || [])[0];
    return folder ? folder.uri.fsPath : null;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('vibeshell.open', () => provider.reveal(currentCwd()))
  );

  // Terminal command path: vscode://vibeshell.vibeshell-vscode/open?cwd=...
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uriValue) {
        const params = new URLSearchParams(uriValue.query || '');
        provider.reveal(params.get('cwd') || currentCwd());
      },
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
