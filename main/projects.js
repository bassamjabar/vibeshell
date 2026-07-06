// Project selection and "recent projects" persistence.
//
// The user never sees a path prompt or a command: everything goes through
// native dialogs. Recents are stored as JSON in Electron's per-app userData
// folder, so the project folder itself is never polluted.

const registry = require('./registry');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_RECENTS = 8;

// Folders that never belong in an @-mention list.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'target',
]);

// Flat list of relative file paths for the "@" mention palette.
// Depth- and count-limited so a huge repo can't freeze anything.
function listProjectFiles(root) {
  const files = [];
  const walk = (dir, rel, depth) => {
    if (depth > 6 || files.length >= 3000) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (files.length >= 3000) return;
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), relPath, depth + 1);
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  };
  walk(root, '', 0);
  return files;
}

function recentsFilePath() {
  return path.join(registry.userDataPath(), 'recent-projects.json');
}

function readRecents() {
  try {
    const raw = fs.readFileSync(recentsFilePath(), 'utf8');
    const list = JSON.parse(raw.replace(/^﻿/, '')); // tolerate a UTF-8 BOM
    if (!Array.isArray(list)) return [];
    // Silently drop folders that no longer exist (deleted / renamed / on a
    // removable drive) so the user never clicks a dead entry.
    return list.filter(
      (item) => item && typeof item.path === 'string' && fs.existsSync(item.path)
    );
  } catch {
    return [];
  }
}

function writeRecents(list) {
  try {
    fs.writeFileSync(recentsFilePath(), JSON.stringify(list, null, 2), 'utf8');
  } catch {
    // Losing the recents list is annoying but never fatal — don't crash.
  }
}

function addRecent(dir) {
  const project = { path: dir, name: path.basename(dir), openedAt: Date.now() };
  const rest = readRecents().filter((item) => item.path !== dir);
  writeRecents([project, ...rest].slice(0, MAX_RECENTS));
  return project;
}

// Windows forbids <>:"/\|?* and control chars in folder names,
// plus trailing dots/spaces. Spaces and hyphens inside the name are fine.
function sanitizeProjectName(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/[. ]+$/g, '')
    .trim();
}

function registerProjectHandlers() {
  // Let the user pick an existing folder with the native dialog.
  registry.handle('projects:pick', async () => {
    const dir = await registry.pickFolder({
      title: 'Choose your project folder',
      buttonLabel: 'Open this folder',
    });
    if (!dir) return { ok: false, canceled: true };
    return { ok: true, project: addRecent(dir) };
  });

  // Create a brand-new project folder: the user types a name in the app,
  // then picks where to put it with the native dialog.
  registry.handle('projects:create', async (_event, rawName) => {
    const name = sanitizeProjectName(rawName);
    if (!name) {
      return { ok: false, error: 'Please give your project a name.' };
    }

    const location = await registry.pickFolder({
      title: `Choose where to create "${name}"`,
      buttonLabel: 'Create it here',
    });
    if (!location) return { ok: false, canceled: true };

    const dir = path.join(location, name);
    if (fs.existsSync(dir)) {
      return {
        ok: false,
        error: `A folder called "${name}" already exists there. Try another name.`,
      };
    }

    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return { ok: false, error: "Couldn't create the folder. Try a different location." };
    }
    return { ok: true, project: addRecent(dir) };
  });

  // Open a project from the recents list.
  registry.handle('projects:open', async (_event, dir) => {
    if (typeof dir !== 'string' || !fs.existsSync(dir)) {
      return { ok: false, error: "That folder doesn't exist anymore." };
    }
    return { ok: true, project: addRecent(dir) };
  });

  registry.handle('projects:recents', async () => readRecents());

  // File list for the "@" mention palette.
  registry.handle('projects:files', async (_event, dir) => {
    if (typeof dir !== 'string' || !fs.existsSync(dir)) return [];
    return listProjectFiles(dir);
  });

  // "#note" → append a line to CLAUDE.md (project memory, like the CLI).
  // No project open → the user's global ~/.claude/CLAUDE.md.
  registry.handle('projects:addMemory', async (_event, dir, note) => {
    const text = String(note || '').trim();
    if (!text) return { ok: false };
    try {
      const file = dir && fs.existsSync(dir)
        ? path.join(dir, 'CLAUDE.md')
        : path.join(os.homedir(), '.claude', 'CLAUDE.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const heading = fs.existsSync(file) ? '' : '# CLAUDE.md\n\n';
      fs.appendFileSync(file, `${heading}- ${text}\n`, 'utf8');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  registry.handle('projects:removeRecent', async (_event, dir) => {
    writeRecents(readRecents().filter((item) => item.path !== dir));
    return readRecents();
  });
}

module.exports = { registerProjectHandlers };
