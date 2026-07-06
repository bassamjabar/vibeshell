// Claude Code session manager.
//
// Drives Claude Code through the official Agent SDK (which runs the CLI with
// stream-json under the hood). One active session at a time, tied to the
// project folder the user opened.
//
// Permissions: the SDK calls `canUseTool` whenever Claude wants to do
// something that needs approval. We forward that to the renderer as an
// approval card and resolve the promise when the user clicks a button.

const registry = require('./registry');
const { query } = require('@anthropic-ai/claude-agent-sdk');
const { renderMarkdown } = require('./markdown');

const MAX_TEXT = 20000;

function clip(value, max = MAX_TEXT) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}

function fileName(p) {
  return p ? String(p).split(/[\\/]/).pop() : '';
}

// What the approval card needs to show, per tool.
function permissionView(toolName, input) {
  switch (toolName) {
    case 'Write':
      return { kind: 'write', file: input.file_path, content: clip(input.content) };
    case 'Edit':
      return {
        kind: 'edit',
        file: input.file_path,
        oldText: clip(input.old_string),
        newText: clip(input.new_string),
      };
    case 'Bash':
    case 'PowerShell': // the shell tool is named PowerShell on Windows
      return { kind: 'bash', command: clip(input.command, 2000), note: input.description };
    case 'ExitPlanMode':
      // Plan mode finished — show the plan itself, properly rendered,
      // instead of a raw JSON blob.
      return { kind: 'plan', html: renderMarkdown(String(input.plan || '')) };
    default:
      return { kind: 'other', detail: clip(JSON.stringify(input ?? {}, null, 2), 4000) };
  }
}

// Friendly one-liner shown in the chat feed while the agent works.
// Sent as an i18n key + argument so the renderer shows it in the UI language.
// A model-written description (Bash) passes through as literal text.
function activityInfo(name, input) {
  switch (name) {
    case 'Read': return { key: 'actReading', arg: fileName(input.file_path) };
    case 'Write': return { key: 'actWriting', arg: fileName(input.file_path) };
    case 'Edit': return { key: 'actEditing', arg: fileName(input.file_path) };
    case 'Bash':
    case 'PowerShell':
      return input.description
        ? { key: null, arg: String(input.description) }
        : { key: 'actCommand', arg: null };
    case 'Glob':
    case 'Grep': return { key: 'actSearching', arg: null };
    case 'TodoWrite': return { key: 'actPlanning', arg: null };
    case 'ExitPlanMode': return { key: 'actPlanReady', arg: null };
    case 'WebSearch':
    case 'WebFetch': return { key: 'actWeb', arg: null };
    case 'Task': return { key: 'actSubtask', arg: null };
    default: return { key: 'actUsing', arg: name };
  }
}

function mapCommands(list) {
  return (list || []).map((c) => ({
    name: String(c.name || ''),
    description: String(c.description || ''),
    argumentHint: String(c.argumentHint || ''),
    aliases: Array.isArray(c.aliases) ? c.aliases.map(String) : [],
  }));
}

// Tools whose "always allow" would be a blanket grant for ARBITRARY shell
// commands — far coarser than the CLI's own per-command-prefix rules. These
// stay one-click-per-command (the auto-approve master switch still covers
// users who explicitly want everything approved).
const NO_BLANKET_ALLOW = new Set(['Bash', 'PowerShell']);

// Classify failures as i18n codes; the renderer picks the localized text.
function friendlyError(err) {
  const raw = String((err && err.message) || err || 'Unknown error');
  if (/ENOENT/.test(raw) && /node/i.test(raw)) return { code: 'node-missing', raw };
  if (/not logged in|authentication|401/i.test(raw)) return { code: 'not-signed-in', raw };
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|socket hang up|network|fetch failed|getaddrinfo|Connection error|timeout/i.test(raw)) {
    return { code: 'network', raw };
  }
  return { code: 'generic', raw };
}

class AgentSession {
  constructor(sender, projectDir, resumeId, resumeAt) {
    this.sender = sender;
    this.projectDir = projectDir;
    this.toolUses = new Map(); // tool_use_id → { name } awaiting results
    this.queue = [];        // user messages waiting to be delivered
    this.wake = null;       // resolver that unblocks the input stream
    this.closed = false;
    this.pending = new Map();      // permission id → { resolve, toolName, input }
    this.alwaysAllow = new Set();  // tool names auto-approved this session
    this.autoApprove = false;      // master switch: approve everything, no cards
    this.currentModel = null;      // model id reported by the CLI
    this.currentEffort = 'high';   // CLI default per the docs
    this.fastMode = false;
    this.reconnects = 0;           // consecutive network-reconnect attempts
    // The CLI session id — the anchor for network reconnects. Starts as the
    // resume id (if any) and follows every init message from then on.
    this.currentSessionId = resumeId || null;

    this.query = this.createQuery(resumeId, resumeAt);

    this.usageTimer = null;
    this.usageReady = false;

    this.pump();
    // Fetch the model + command lists right away, and keep polling the quota
    // until it shows up — the user sees everything on entry, pre-message.
    this.loadModels();
    this.loadCommands();
    this.scheduleUsage(0);
  }

  // Quick retries until the CLI serves quota data, then a slow refresh.
  scheduleUsage(delay = null) {
    if (this.closed) return;
    const wait = delay !== null ? delay : (this.usageReady ? 30000 : 3000);
    this.usageTimer = setTimeout(async () => {
      await this.loadUsage();
      this.scheduleUsage();
    }, wait);
  }

  emit(type, data = {}) {
    if (!this.sender.isDestroyed()) {
      this.sender.send('agent:event', { type, ...data });
    }
  }

  // Build the SDK query. Used on start and to resume after a network drop.
  createQuery(resumeId, resumeAt) {
    return query({
      prompt: this.userMessages(),
      options: {
        cwd: this.projectDir,
        executable: 'node', // inside Electron, process.execPath is electron.exe — force real Node
        permissionMode: 'default',
        // Continue a saved conversation with its memory intact.
        resume: resumeId || undefined,
        // Conversation rewind: resume only up to this assistant message.
        resumeSessionAt: resumeAt || undefined,
        // Stream text deltas so replies type out live like the browser.
        includePartialMessages: true,
        // Snapshot files before edits so the user can rewind a turn.
        enableFileCheckpointing: true,
        // Full Claude Code system prompt: without it the model doesn't even
        // know its working directory and writes files to the wrong place.
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        // Load exactly what the terminal loads: settings.json permission
        // rules, MCP servers, hooks, and CLAUDE.md project memory. The SDK
        // loads NONE of these by default.
        settingSources: ['user', 'project', 'local'],
        canUseTool: (toolName, input, meta) => this.askPermission(toolName, input, meta),
      },
    });
  }

  // Open-ended stream of user messages; keeps the CLI session alive
  // between turns so the conversation has memory.
  async *userMessages() {
    while (true) {
      while (this.queue.length > 0) {
        yield {
          type: 'user',
          message: { role: 'user', content: this.queue.shift() },
          parent_tool_use_id: null,
          session_id: '',
        };
      }
      if (this.closed) return;
      await new Promise((resolve) => { this.wake = resolve; });
    }
  }

  nudge() {
    if (this.wake) {
      const wake = this.wake;
      this.wake = null;
      wake();
    }
  }

  // payload: plain string, or { text, images: [{ mediaType, data(base64) }],
  //          documents: [{ mediaType, data(base64), name }],
  //          files: [{ name, text }] }.
  // Documents, images, and code files go first in the content blocks (the API
  // reads them better that way), then the user's text.
  send(payload) {
    const { text, images, documents, files } =
      typeof payload === 'string'
        ? { text: payload, images: [], documents: [], files: [] }
        : (payload || {});

    const blocks = [];
    for (const doc of (documents || []).slice(0, 5)) {
      if (!doc || !doc.data || !doc.mediaType) continue;
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: String(doc.mediaType), data: String(doc.data) },
        ...(doc.name ? { title: String(doc.name) } : {}),
      });
    }
    for (const img of (images || []).slice(0, 8)) {
      if (!img || !img.data || !img.mediaType) continue;
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: String(img.mediaType), data: String(img.data) },
      });
    }
    // Code/text files: plain-text blocks the agent reads like pasted source.
    for (const file of (files || []).slice(0, 10)) {
      if (!file || typeof file.text !== 'string') continue;
      const name = file.name ? String(file.name) : 'file';
      const body = file.text.length > 400000 ? `${file.text.slice(0, 400000)}\n… (truncated)` : file.text;
      blocks.push({ type: 'text', text: `File: ${name}\n\n\`\`\`\n${body}\n\`\`\`` });
    }
    const trimmed = String(text || '').trim();
    if (trimmed) blocks.push({ type: 'text', text: trimmed });
    if (blocks.length === 0) return;

    this.queue.push(blocks);
    this.emit('status', { state: 'thinking' });
    this.nudge();
  }

  askPermission(toolName, input, meta) {
    // Planning is the agent's internal bookkeeping — never worth a card.
    if (toolName === 'TodoWrite') {
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    }
    if (this.autoApprove || this.alwaysAllow.has(toolName)) {
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    }
    const id = (meta && meta.toolUseID) ||
      `perm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.emit('permission-request', { id, toolName, view: permissionView(toolName, input || {}) });
    this.emit('status', { state: 'approval' });
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, toolName, input });
    });
  }

  resolvePermission(id, decision) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (decision && decision.allow) {
      if (decision.always && !NO_BLANKET_ALLOW.has(entry.toolName)) {
        this.alwaysAllow.add(entry.toolName);
      }
      entry.resolve({ behavior: 'allow', updatedInput: entry.input });
    } else {
      entry.resolve({ behavior: 'deny', message: 'The user declined this action in VibeShell.' });
    }
    this.emit('permission-resolved', { id, allowed: !!(decision && decision.allow) });
    this.emit('status', { state: 'working' });
  }

  onMessage(msg) {
    // Skip subagent-internal traffic; the user only needs the main thread.
    if (msg.parent_tool_use_id) return;

    // Live deltas — reply text types out, and the model's thinking streams
    // into its own collapsible block (like claude.ai shows its reasoning).
    if (msg.type === 'stream_event') {
      const ev = msg.event;
      if (ev && ev.type === 'content_block_delta' && ev.delta) {
        if (ev.delta.type === 'text_delta' && ev.delta.text) {
          this.emit('assistant-delta', { text: ev.delta.text });
        } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
          this.emit('thinking-delta', { text: ev.delta.thinking });
        }
      }
      return;
    }

    if (msg.type === 'system' && msg.subtype === 'init') {
      this.currentModel = msg.model;
      this.currentSessionId = msg.session_id || this.currentSessionId;
      this.emit('ready', { model: msg.model, sessionId: msg.session_id });
      // The picker already has the list; init just tells it which one is live.
      this.emit('model-changed', { model: msg.model });
      this.loadUsage();
      return;
    }

    // CLI status: compaction progress + the authoritative permission mode.
    if (msg.type === 'system' && msg.subtype === 'status') {
      this.emit('cli-status', {
        status: msg.status || null,
        permissionMode: msg.permissionMode || null,
        compactResult: msg.compact_result || null,
      });
      return;
    }

    // Slash commands discovered mid-session (e.g. project skills).
    if (msg.type === 'system' && msg.subtype === 'commands_changed') {
      this.emit('commands', { commands: mapCommands(msg.commands) });
      return;
    }

    // Output of local slash commands (/context, /todos, …) — plain text.
    if (msg.type === 'system' && msg.subtype === 'local_command_output') {
      if (msg.content && String(msg.content).trim()) {
        this.emit('command-output', { text: clip(String(msg.content), 8000) });
      }
      return;
    }

    if (msg.type === 'assistant') {
      const blocks = (msg.message && msg.message.content) || [];
      for (const block of blocks) {
        if (block.type === 'text' && block.text && block.text.trim()) {
          // uuid rides along — it's the anchor for conversation rewind.
          this.emit('assistant-text', { html: renderMarkdown(block.text), uuid: msg.uuid || null });
        } else if (block.type === 'tool_use') {
          // The plan is a first-class UI panel, not a generic tool card.
          if (block.name === 'TodoWrite') {
            const todos = ((block.input && block.input.todos) || []).map((td) => ({
              content: String(td.content || ''),
              status: String(td.status || 'pending'),
              activeForm: String(td.activeForm || ''),
            }));
            this.emit('plan', { todos });
            continue;
          }
          const info = activityInfo(block.name, block.input || {});
          this.toolUses.set(block.id, { name: block.name });
          // The renderer composes the label (and the status pill) from the
          // key so it always matches the current UI language.
          this.emit('tool-start', {
            id: block.id,
            name: block.name,
            labelKey: info.key,
            labelArg: info.arg,
            view: permissionView(block.name, block.input || {}),
          });
        }
      }
      return;
    }

    // Tool results arrive as user messages; pair them with their cards.
    // Real user messages echo back too, carrying the uuid we need for rewind.
    if (msg.type === 'user') {
      const blocks = (msg.message && msg.message.content) || [];
      const hasToolResult = Array.isArray(blocks) &&
        blocks.some((b) => b && b.type === 'tool_result');
      if (!hasToolResult && !msg.isSynthetic && msg.uuid) {
        this.emit('user-uuid', { uuid: msg.uuid });
        return;
      }
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block.type === 'tool_result' && this.toolUses.has(block.tool_use_id)) {
            this.toolUses.delete(block.tool_use_id);
            let output = '';
            if (typeof block.content === 'string') output = block.content;
            else if (Array.isArray(block.content)) {
              output = block.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('\n');
            }
            this.emit('tool-result', {
              id: block.tool_use_id,
              ok: !block.is_error,
              output: clip(output), // full 20k — the card scrolls
            });
          }
        }
      }
      return;
    }

    if (msg.type === 'result') {
      this.emit('turn-done', { ok: msg.subtype === 'success' && !msg.is_error });
      this.emit('status', { state: 'idle' });
      this.loadUsage(); // refresh the quota meter after every turn
      return;
    }

    if (msg.type === 'auth_status' && msg.error) {
      this.emit('error', { code: 'sign-in', raw: String(msg.error) });
    }
  }

  // Ask the CLI which models this account can use, so the UI can offer
  // one-click switching instead of a typed /model command.
  async loadModels() {
    try {
      const models = await this.query.supportedModels();
      const list = models.map((m) => ({
        value: m.value,
        resolvedModel: m.resolvedModel || null,
        displayName: m.displayName,
        description: m.description || '',
        // The persisted setting only accepts low…xhigh, so hide anything else.
        effortLevels: (m.supportedEffortLevels || []).filter((level) =>
          ['low', 'medium', 'high', 'xhigh'].includes(level)
        ),
        supportsFastMode: !!m.supportsFastMode,
      }));
      // init reports the full model id; the picker list may know it under
      // an alias (e.g. 'sonnet' resolves to 'claude-sonnet-5').
      const match = list.find(
        (m) => m.value === this.currentModel || m.resolvedModel === this.currentModel
      );
      this.emit('models', {
        models: list,
        current: match ? match.value : this.currentModel,
        effort: this.currentEffort,
        fastMode: this.fastMode,
      });
    } catch {
      // If the CLI can't list models, the picker simply stays hidden.
    }
  }

  // Plan quota (the /usage data): 5-hour window utilization + reset time.
  // The SDK marks this API experimental, so everything is feature-detected
  // and failures stay silent — the meter simply doesn't show.
  async loadUsage() {
    try {
      const fn = this.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (typeof fn !== 'function') return;
      const data = await fn.call(this.query);
      if (!data) return;

      const rl = (data.rate_limits_available && data.rate_limits) || {};
      const win = (w) => (w ? { pct: w.utilization, resetsAt: w.resets_at } : null);
      const s = data.session || {};
      if (rl.five_hour || rl.seven_day) this.usageReady = true;

      this.emit('usage', {
        session: {
          costUsd: s.total_cost_usd ?? null,
          apiDurationMs: s.total_api_duration_ms ?? null,
          durationMs: s.total_duration_ms ?? null,
          linesAdded: s.total_lines_added ?? 0,
          linesRemoved: s.total_lines_removed ?? 0,
        },
        plan: data.subscription_type || null,
        fiveHour: win(rl.five_hour),
        sevenDay: win(rl.seven_day),
        sevenDayOpus: win(rl.seven_day_opus),
        sevenDaySonnet: win(rl.seven_day_sonnet),
        modelScoped: (rl.model_scoped || []).map((m) => ({
          name: m.display_name,
          pct: m.utilization,
          resetsAt: m.resets_at,
        })),
        extra: rl.extra_usage && rl.extra_usage.is_enabled
          ? {
              used: rl.extra_usage.used_credits,
              limit: rl.extra_usage.monthly_limit,
              pct: rl.extra_usage.utilization,
              currency: rl.extra_usage.currency || 'USD',
            }
          : null,
      });
    } catch { /* experimental API — never let it break the session */ }
  }

  // Every slash command the CLI knows, including project-specific skills —
  // this is what makes the GUI a strict superset of the terminal.
  async loadCommands() {
    try {
      const commands = await this.query.supportedCommands();
      this.emit('commands', { commands: mapCommands(commands) });
    } catch { /* palette simply stays empty */ }
  }

  // default | acceptEdits | plan — the same modes Shift+Tab cycles in the CLI.
  async setPermissionMode(mode) {
    try {
      await this.query.setPermissionMode(mode);
      this.emit('mode-changed', { mode });
    } catch (err) {
      this.emit('error', {
        message: `Couldn't switch the mode: ${String((err && err.message) || err)}`,
      });
    }
  }

  // Restore every tracked file to its state before the given user message.
  async rewind(uuid) {
    try {
      const res = await this.query.rewindFiles(String(uuid));
      this.emit('rewind-done', {
        ok: !!(res && res.canRewind),
        error: (res && res.error) || null,
        files: (res && res.filesChanged && res.filesChanged.length) || 0,
      });
    } catch (err) {
      this.emit('rewind-done', {
        ok: false,
        error: String((err && err.message) || err),
        files: 0,
      });
    }
  }

  async setEffort(level) {
    try {
      await this.query.applyFlagSettings({ effortLevel: level });
      this.currentEffort = level;
      this.emit('effort-changed', { effort: level });
    } catch (err) {
      this.emit('error', {
        message: `Couldn't change the effort level: ${String((err && err.message) || err)}`,
      });
    }
  }

  async setFastMode(enabled) {
    try {
      await this.query.applyFlagSettings({ fastMode: !!enabled });
      this.fastMode = !!enabled;
      this.emit('fastmode-changed', { fastMode: this.fastMode });
    } catch (err) {
      this.emit('error', {
        message: `Couldn't toggle fast mode: ${String((err && err.message) || err)}`,
      });
    }
  }

  // Master approval switch. Turning it on also releases anything that is
  // currently waiting on a card, so the agent never stays stuck.
  setAutoApprove(enabled) {
    this.autoApprove = !!enabled;
    if (this.autoApprove && this.pending.size > 0) {
      for (const [id, entry] of this.pending) {
        entry.resolve({ behavior: 'allow', updatedInput: entry.input });
        this.emit('permission-resolved', { id, allowed: true });
      }
      this.pending.clear();
      this.emit('status', { state: 'working' });
    }
  }

  // Stop the current turn (the ■ button) without ending the session.
  async interruptTurn() {
    // Anything waiting for approval would keep the CLI hanging — deny it.
    for (const [id, entry] of this.pending) {
      entry.resolve({ behavior: 'deny', message: 'The user stopped this turn.' });
      this.emit('permission-resolved', { id, allowed: false });
    }
    this.pending.clear();
    try { await this.query.interrupt(); } catch { /* turn already over */ }
    this.emit('activity', { key: 'actStopped' });
    this.emit('status', { state: 'idle' });
  }

  async setModel(model) {
    try {
      await this.query.setModel(model);
      this.currentModel = model;
      this.emit('model-changed', { model });
    } catch (err) {
      this.emit('error', {
        message: `Couldn't switch the model: ${String((err && err.message) || err)}`,
      });
    }
  }

  // Drive the query. On a NETWORK error we don't kill the conversation —
  // we resume the same session (up to MAX_RECONNECTS) with backoff, so a
  // dropped/weak connection recovers on its own instead of ending the chat.
  async pump() {
    const MAX_RECONNECTS = 5;
    while (!this.closed) {
      try {
        for await (const msg of this.query) {
          // Any healthy init means the connection is good again.
          if (msg.type === 'system' && msg.subtype === 'init') {
            if (this.reconnects > 0) this.emit('reconnected', {});
            this.reconnects = 0;
          }
          this.onMessage(msg);
        }
        this.emit('closed', {});
        return;
      } catch (err) {
        const fe = friendlyError(err);
        const canRetry = fe.code === 'network' && !this.closed &&
          this.currentSessionId && this.reconnects < MAX_RECONNECTS;
        if (!canRetry) {
          if (!this.closed) {
            this.emit('error', { code: fe.code, raw: fe.raw });
            this.emit('status', { state: 'idle' });
          }
          return;
        }
        this.reconnects += 1;
        this.emit('reconnecting', { attempt: this.reconnects, max: MAX_RECONNECTS });
        this.emit('status', { state: 'working' });
        // Exponential backoff, capped — 2s, 4s, 8s, 15s, 15s.
        const wait = Math.min(2000 * 2 ** (this.reconnects - 1), 15000);
        await new Promise((r) => setTimeout(r, wait));
        if (this.closed) return;
        this.query = this.createQuery(this.currentSessionId, null); // resume same chat
      }
    }
  }

  async close() {
    this.closed = true;
    if (this.usageTimer) clearTimeout(this.usageTimer);
    // Deny anything still waiting so the CLI isn't stuck forever.
    for (const entry of this.pending.values()) {
      entry.resolve({ behavior: 'deny', message: 'Session closed.' });
    }
    this.pending.clear();
    this.nudge();
    try { await this.query.interrupt(); } catch { /* already gone */ }
  }
}

// One live session PER WINDOW, keyed by the WebContents that owns it —
// every "New window" is a fully parallel conversation.
const sessions = new Map();
const wired = new Set(); // sender ids with a destroyed-cleanup listener

function sessionFor(event) {
  return sessions.get(event.sender.id) || null;
}

function registerAgentHandlers() {
  registry.handle('agent:start', (event, projectDir, resumeId, resumeAt) => {
    const key = event.sender.id;
    const existing = sessions.get(key);
    if (existing) existing.close();
    // No project? Chat anyway — the session lives in the home folder and
    // the user can open a real project from the sidebar whenever they want.
    const dir = projectDir ? String(projectDir) : require('os').homedir();
    sessions.set(key, new AgentSession(
      event.sender,
      dir,
      resumeId ? String(resumeId) : null,
      resumeAt ? String(resumeAt) : null
    ));
    // Window closed → tear its session down and free the slot.
    if (!wired.has(key)) {
      wired.add(key);
      event.sender.once('destroyed', () => {
        wired.delete(key);
        const s = sessions.get(key);
        if (s) {
          s.close();
          sessions.delete(key);
        }
      });
    }
    return { ok: true };
  });

  registry.handle('agent:send', (event, payload) => {
    const s = sessionFor(event);
    if (!s) return { ok: false, error: 'No active session.' };
    s.send(payload);
    return { ok: true };
  });

  registry.handle('agent:setEffort', (event, level) => {
    const s = sessionFor(event);
    if (!s) return { ok: false, error: 'No active session.' };
    s.setEffort(String(level));
    return { ok: true };
  });

  registry.handle('agent:setFastMode', (event, enabled) => {
    const s = sessionFor(event);
    if (!s) return { ok: false, error: 'No active session.' };
    s.setFastMode(!!enabled);
    return { ok: true };
  });

  registry.handle('agent:autoApprove', (event, enabled) => {
    const s = sessionFor(event);
    if (!s) return { ok: false, error: 'No active session.' };
    s.setAutoApprove(!!enabled);
    return { ok: true };
  });

  registry.handle('agent:interrupt', (event) => {
    const s = sessionFor(event);
    if (!s) return { ok: false, error: 'No active session.' };
    s.interruptTurn();
    return { ok: true };
  });

  registry.handle('agent:setModel', (event, model) => {
    const s = sessionFor(event);
    if (!s) return { ok: false, error: 'No active session.' };
    s.setModel(String(model));
    return { ok: true };
  });

  registry.handle('agent:setMode', (event, mode) => {
    const s = sessionFor(event);
    if (!s) return { ok: false, error: 'No active session.' };
    s.setPermissionMode(String(mode));
    return { ok: true };
  });

  registry.handle('agent:rewind', async (event, uuid) => {
    const s = sessionFor(event);
    if (!s) return { ok: false, error: 'No active session.' };
    // Awaited: the renderer restarts the session right after, and the file
    // restore must finish before the session goes away.
    await s.rewind(String(uuid));
    return { ok: true };
  });

  // "Always allow" grants for this session — reviewable and revocable.
  registry.handle('agent:permissions', (event) => {
    const s = sessionFor(event);
    return s ? [...s.alwaysAllow] : [];
  });

  registry.handle('agent:revokePermission', (event, toolName) => {
    const s = sessionFor(event);
    if (s) s.alwaysAllow.delete(String(toolName));
    return s ? [...s.alwaysAllow] : [];
  });

  registry.handle('agent:permission', (event, id, decision) => {
    const s = sessionFor(event);
    if (s) s.resolvePermission(String(id), decision || {});
    return { ok: true };
  });

  registry.handle('agent:stop', async (event) => {
    const s = sessionFor(event);
    if (s) {
      sessions.delete(event.sender.id);
      await s.close();
    }
    return { ok: true };
  });
}

module.exports = { registerAgentHandlers, AgentSession };
