// Claude Code configuration GUI — MCP servers and permanent permission
// rules. The terminal manages these through interactive dialogs (/mcp,
// /permissions) that can't run through the SDK; we simply edit the same
// files directly, which is all those dialogs do anyway:
//
//   MCP servers   project scope → <project>/.mcp.json      (mcpServers)
//                 user scope    → ~/.claude.json           (mcpServers)
//   Allow rules   project scope → <project>/.claude/settings.json
//                 user scope    → ~/.claude/settings.json  (permissions.allow)
//
// Changes take effect on NEW sessions (the CLI reads config at startup).

const registry = require('./registry');
const fs = require('fs');
const os = require('os');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Preserve everything else in the file — these files hold plenty of other
// state (especially ~/.claude.json), so read-modify-write, never replace.
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// Load a config file for editing. A missing file is a fresh {}, but a file
// that EXISTS yet doesn't parse must abort the edit: writing "{} + our one
// key" over ~/.claude.json would wipe all the other state it holds.
function readForEdit(file) {
  if (!fs.existsSync(file)) return {};
  const data = readJson(file);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

function mcpFile(scope, projectDir) {
  return scope === 'project'
    ? path.join(projectDir, '.mcp.json')
    : path.join(os.homedir(), '.claude.json');
}

function settingsFile(scope, projectDir) {
  return scope === 'project'
    ? path.join(projectDir, '.claude', 'settings.json')
    : path.join(os.homedir(), '.claude', 'settings.json');
}

// One-line summary of a server config for the list row.
function mcpSummary(config) {
  if (!config) return '';
  if (config.url) return String(config.url);
  const args = Array.isArray(config.args) ? config.args.join(' ') : '';
  return `${config.command || ''} ${args}`.trim();
}

function listMcp(scope, projectDir) {
  const data = readJson(mcpFile(scope, projectDir));
  const servers = (data && data.mcpServers) || {};
  return Object.entries(servers).map(([name, config]) => ({
    name,
    scope,
    summary: mcpSummary(config),
  }));
}

function listRules(scope, projectDir) {
  const data = readJson(settingsFile(scope, projectDir));
  const allow = data && data.permissions && data.permissions.allow;
  return (Array.isArray(allow) ? allow : []).map((rule) => ({
    rule: String(rule),
    scope,
  }));
}

function registerSettingsHandlers() {
  // Every MCP server visible to this project, both scopes merged.
  registry.handle('settings:mcpList', async (_event, projectDir) => {
    const items = listMcp('user', null);
    if (projectDir && fs.existsSync(String(projectDir))) {
      items.push(...listMcp('project', String(projectDir)));
    }
    return items;
  });

  // spec: { url } for remote servers, or { command } (one line, split into
  // command + args) for local stdio servers.
  registry.handle('settings:mcpAdd', async (_event, scope, projectDir, name, spec) => {
    const cleanName = String(name || '').trim();
    if (!/^[\w-]+$/.test(cleanName)) return { ok: false, error: 'bad-name' };
    if (scope === 'project' && !(projectDir && fs.existsSync(String(projectDir)))) {
      return { ok: false, error: 'no-project' };
    }

    let config;
    if (spec && spec.url) {
      config = { type: 'http', url: String(spec.url).trim() };
    } else if (spec && spec.command) {
      const parts = String(spec.command).trim().split(/\s+/);
      config = { command: parts[0], args: parts.slice(1) };
    } else {
      return { ok: false, error: 'bad-spec' };
    }

    try {
      const file = mcpFile(scope, String(projectDir || ''));
      const data = readForEdit(file);
      if (data === null) return { ok: false, error: 'file-unreadable' };
      data.mcpServers = data.mcpServers || {};
      data.mcpServers[cleanName] = config;
      writeJson(file, data);
      return { ok: true };
    } catch {
      return { ok: false, error: 'write-failed' };
    }
  });

  registry.handle('settings:mcpRemove', async (_event, scope, projectDir, name) => {
    try {
      const file = mcpFile(scope, String(projectDir || ''));
      const data = readForEdit(file);
      if (data && data.mcpServers) {
        delete data.mcpServers[String(name)];
        writeJson(file, data);
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Standing allow rules (permissions.allow), both scopes merged.
  registry.handle('settings:permList', async (_event, projectDir) => {
    const items = listRules('user', null);
    if (projectDir && fs.existsSync(String(projectDir))) {
      items.push(...listRules('project', String(projectDir)));
    }
    return items;
  });

  registry.handle('settings:permAdd', async (_event, scope, projectDir, rule) => {
    const cleanRule = String(rule || '').trim();
    if (!cleanRule) return { ok: false, error: 'bad-rule' };
    if (scope === 'project' && !(projectDir && fs.existsSync(String(projectDir)))) {
      return { ok: false, error: 'no-project' };
    }
    try {
      const file = settingsFile(scope, String(projectDir || ''));
      const data = readForEdit(file);
      if (data === null) return { ok: false, error: 'file-unreadable' };
      data.permissions = data.permissions || {};
      const allow = Array.isArray(data.permissions.allow) ? data.permissions.allow : [];
      if (!allow.includes(cleanRule)) allow.push(cleanRule);
      data.permissions.allow = allow;
      writeJson(file, data);
      return { ok: true };
    } catch {
      return { ok: false, error: 'write-failed' };
    }
  });

  registry.handle('settings:permRemove', async (_event, scope, projectDir, rule) => {
    try {
      const file = settingsFile(scope, String(projectDir || ''));
      const data = readForEdit(file);
      if (data && data.permissions && Array.isArray(data.permissions.allow)) {
        data.permissions.allow = data.permissions.allow.filter(
          (r) => String(r) !== String(rule)
        );
        // Leave no empty husks behind.
        if (data.permissions.allow.length === 0) delete data.permissions.allow;
        if (Object.keys(data.permissions).length === 0) delete data.permissions;
        writeJson(file, data);
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

module.exports = { registerSettingsHandlers };
