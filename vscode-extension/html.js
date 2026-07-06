// Pure HTML transform: turn the desktop app's index.html into a webview
// document. Kept free of the `vscode` module so it can be unit-tested and
// reused by any webview host — the caller supplies how to resolve asset URIs.

// options:
//   indexHtml   raw contents of the app's index.html
//   asWebviewUri (relPath) => string   resolve a repo-relative asset
//   cspSource   the host's allowed resource origin (for style/img/font)
//   nonce       per-load script nonce
//   bridgeSrc   contents of the window.vibeshell bridge, inlined first
function buildWebviewHtml(options) {
  const { indexHtml, asWebviewUri, cspSource, nonce, bridgeSrc } = options;
  let html = indexHtml;

  const assets = [
    ['href', 'renderer/styles.css'],
    ['href', 'renderer/vendor/hljs-dark.css'],
    ['script', 'renderer/i18n.js'],
    ['script', 'renderer/chat.js'],
    ['script', 'renderer/app.js'],
    ['script', 'renderer/settings.js'],
  ];
  for (const [kind, rel] of assets) {
    const url = asWebviewUri(rel);
    if (kind === 'href') {
      html = html.split(`href="${rel}"`).join(`href="${url}"`);
    } else {
      html = html.split(`src="${rel}"`).join(`nonce="${nonce}" src="${url}"`);
    }
  }

  const csp =
    `default-src 'none'; ` +
    `img-src ${cspSource} data: blob:; ` +
    `style-src ${cspSource} 'unsafe-inline'; ` +
    `font-src ${cspSource}; ` +
    `script-src 'nonce-${nonce}';`;
  html = html.replace(
    /<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/,
    `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
  );

  // The bridge must define window.vibeshell before i18n/chat/app run.
  html = html.replace(
    '</head>',
    `<script nonce="${nonce}">${bridgeSrc}</script>\n</head>`
  );

  return html;
}

module.exports = { buildWebviewHtml };
