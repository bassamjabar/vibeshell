// Saved conversations — persistence for the sidebar "Chats" list.
//
// Each record: { id (CLI session id), project (path or null for general
// chat), title, titled (AI-generated?), updatedAt, feed (serialized render
// events) }. Stored as one JSON file in userData; capped so it can never
// grow unbounded.

const registry = require('./registry');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { query } = require('@anthropic-ai/claude-agent-sdk');
const { renderMarkdown } = require('./markdown');

const MAX_CHATS = 60;

// Storage layout: chats.json is a small metadata index; each conversation's
// feed lives in its own file under chat-feeds/. Saving during streaming
// then rewrites one chat, not the entire history.

function chatsFile() {
  return path.join(registry.userDataPath(), 'chats.json');
}

function feedsDir() {
  const dir = path.join(registry.userDataPath(), 'chat-feeds');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  return dir;
}

function feedFile(id) {
  return path.join(feedsDir(), `${String(id).replace(/[^\w-]/g, '')}.json`);
}

function writeAll(list) {
  try {
    fs.writeFileSync(chatsFile(), JSON.stringify(list), 'utf8');
  } catch {
    // Losing history is sad but never fatal.
  }
}

function readAll() {
  try {
    const list = JSON.parse(fs.readFileSync(chatsFile(), 'utf8'));
    if (!Array.isArray(list)) return [];
    // One-time migration from the old format (feeds inline in the index).
    let migrated = false;
    for (const chat of list) {
      if (chat && chat.feed) {
        try {
          fs.writeFileSync(feedFile(chat.id), JSON.stringify(chat.feed), 'utf8');
        } catch { /* keep going — worst case that chat opens empty */ }
        delete chat.feed;
        migrated = true;
      }
    }
    if (migrated) writeAll(list);
    return list;
  } catch {
    return [];
  }
}

function readFeed(id) {
  try {
    const feed = JSON.parse(fs.readFileSync(feedFile(id), 'utf8'));
    return Array.isArray(feed) ? feed : [];
  } catch {
    return [];
  }
}

function deleteFeed(id) {
  try { fs.unlinkSync(feedFile(id)); } catch { /* already gone */ }
}

/* ---------- Terminal (CLI) sessions — visible and importable ----------
   The CLI stores every session as ~/.claude/projects/<encoded-cwd>/<id>.jsonl.
   Listing them lets the user pick up conversations they started in the
   terminal — something the terminal itself only offers via `--resume`. */

function cliProjectDir(projectPath) {
  const cwd = projectPath || os.homedir();
  const encoded = String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

function extractText(message) {
  const content = message && message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

// A user line worth showing: not subagent traffic, not meta, not an
// injected command/caveat message, and not our own Haiku title query.
function usableUserText(line) {
  if (!line || line.isSidechain || line.isMeta || line.attachment) return null;
  if (!line.message || line.message.role !== 'user') return null;
  const text = extractText(line.message).trim();
  if (!text || text.startsWith('<') || text.startsWith('Caveat:')) return null;
  if (text.startsWith('Write a very short title')) return null;
  return text;
}

function oneLine(text, max = 48) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, max);
}

// Cheap title pass: only the first chunk of the file is read.
function quickTitle(file) {
  let raw;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    raw = buf.toString('utf8', 0, read);
  } catch {
    return null;
  }
  let fallback = null;
  for (const lineText of raw.split('\n')) {
    let line;
    try { line = JSON.parse(lineText); } catch { continue; }
    if (line.type === 'ai-title' && line.aiTitle) return oneLine(line.aiTitle);
    if (line.type === 'summary' && line.summary) return oneLine(line.summary);
    if (!fallback) {
      const text = usableUserText(line);
      if (text) fallback = oneLine(text);
    }
  }
  return fallback;
}

function registerChatHandlers() {
  // CLI sessions for this folder that VibeShell doesn't know yet.
  registry.handle('chats:external', async (_event, project) => {
    try {
      const dir = cliProjectDir(project || null);
      const known = new Set(readAll().map((c) => c.id));
      const items = [];
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const id = f.slice(0, -6);
        if (known.has(id)) continue;
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        if (stat.size < 500) continue; // empty or aborted shells
        const title = quickTitle(full);
        if (!title) continue;
        items.push({ id, title, updatedAt: stat.mtimeMs });
      }
      return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 15);
    } catch {
      return []; // no CLI sessions for this folder — the section stays hidden
    }
  });

  // Rebuild a renderable feed from the raw JSONL so the conversation shows
  // in full; resuming continues it with the CLI's own memory intact.
  registry.handle('chats:import', async (_event, project, id) => {
    try {
      const file = path.join(cliProjectDir(project || null), `${String(id)}.jsonl`);
      const raw = fs.readFileSync(file, 'utf8');
      const feed = [];
      let title = null;
      for (const lineText of raw.split('\n')) {
        if (feed.length >= 400) break;
        if (!lineText.trim()) continue;
        let line;
        try { line = JSON.parse(lineText); } catch { continue; }
        if (line.type === 'ai-title' && line.aiTitle && !title) title = oneLine(line.aiTitle);
        if (line.type === 'summary' && line.summary && !title) title = oneLine(line.summary);
        if (line.isSidechain || line.attachment) continue;
        const role = line.message && line.message.role;
        if (role === 'user') {
          const text = usableUserText(line);
          if (text) feed.push({ t: 'user', text });
        } else if (role === 'assistant') {
          const text = extractText(line.message).trim();
          if (text) feed.push({ t: 'ai', html: renderMarkdown(text) });
        }
      }
      if (feed.length === 0) return null;
      const firstUser = feed.find((e) => e.t === 'user');
      return {
        id: String(id),
        project: project || null,
        title: title || oneLine((firstUser && firstUser.text) || 'Chat'),
        titled: !!title,
        feed,
      };
    } catch {
      return null;
    }
  });

  // Metadata only (the index holds nothing else) for the sidebar.
  registry.handle('chats:list', async (_event, project) => {
    return readAll()
      .filter((c) => (c.project || null) === (project || null))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  });

  registry.handle('chats:get', async (_event, id) => {
    const meta = readAll().find((c) => c.id === id);
    return meta ? { ...meta, feed: readFeed(id) } : null;
  });

  registry.handle('chats:save', async (_event, record) => {
    if (!record || !record.id) return { ok: false };
    const { feed, ...meta } = record;
    try {
      fs.writeFileSync(feedFile(record.id), JSON.stringify(feed || []), 'utf8');
    } catch { /* meta still saves; the chat just replays empty */ }
    const rest = readAll().filter((c) => c.id !== record.id);
    rest.unshift({ ...meta, updatedAt: Date.now() });
    const kept = rest.slice(0, MAX_CHATS);
    for (const dropped of rest.slice(MAX_CHATS)) deleteFeed(dropped.id);
    writeAll(kept);
    return { ok: true };
  });

  registry.handle('chats:delete', async (_event, id) => {
    writeAll(readAll().filter((c) => c.id !== id));
    deleteFeed(id);
    return { ok: true };
  });

  // One tiny Haiku call that names the conversation (like claude.ai does).
  // Runs once per chat, after the first reply; any failure is silent and
  // the first-message fallback title simply stays.
  registry.handle('chats:makeTitle', async (_event, payload) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30000);
    try {
      const user = String((payload && payload.user) || '').slice(0, 1500);
      const assistant = String((payload && payload.assistant) || '').slice(0, 1500);
      if (!user) return { ok: false };

      const prompt =
        'Write a very short title (3-6 words) for this conversation, ' +
        "in the same language as the user's message. " +
        'Reply with ONLY the title — no quotes, no trailing punctuation.\n\n' +
        `User: ${user}\n\nAssistant: ${assistant}`;

      const q = query({
        prompt,
        options: {
          model: 'haiku',
          maxTurns: 1,
          allowedTools: [],
          executable: 'node', // Electron's execPath is electron.exe
          abortController: abort,
        },
      });

      let title = null;
      for await (const msg of q) {
        if (msg.type === 'result' && msg.subtype === 'success') {
          title = String(msg.result || '').trim();
        }
      }
      if (title) {
        title = title
          .replace(/^["'«»„“]+|["'«»„”]+$/g, '')
          .replace(/\s+/g, ' ')
          .slice(0, 60)
          .trim();
      }
      return title ? { ok: true, title } : { ok: false };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  });
}

module.exports = { registerChatHandlers };
