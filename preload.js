// VibeShell — preload bridge.
// The ONLY doorway between the UI and the system. The renderer gets this
// small, explicit API and nothing else (contextIsolation + sandbox are on).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vibeshell', {
  win: {
    /** Tint the native window buttons to match the active theme. */
    setOverlay: (opts) => ipcRenderer.invoke('win:overlay', opts),
    /** Open another window — a fully parallel session. */
    newWindow: () => ipcRenderer.invoke('win:new'),
  },

  settings: {
    /** MCP servers from both scopes. → [{name, scope, summary}] */
    mcpList: (project) => ipcRenderer.invoke('settings:mcpList', project),
    /** Add a server. spec: {command} (stdio) or {url} (remote). */
    mcpAdd: (scope, project, name, spec) =>
      ipcRenderer.invoke('settings:mcpAdd', scope, project, name, spec),
    mcpRemove: (scope, project, name) =>
      ipcRenderer.invoke('settings:mcpRemove', scope, project, name),
    /** Standing permissions.allow rules. → [{rule, scope}] */
    permList: (project) => ipcRenderer.invoke('settings:permList', project),
    permAdd: (scope, project, rule) =>
      ipcRenderer.invoke('settings:permAdd', scope, project, rule),
    permRemove: (scope, project, rule) =>
      ipcRenderer.invoke('settings:permRemove', scope, project, rule),
  },

  tools: {
    /** Catalog of AI tools with their installed versions (fast, local). */
    list: () => ipcRenderer.invoke('tools:list'),
    /** Newest published version per tool id (slow, hits the network). */
    latest: () => ipcRenderer.invoke('tools:latest'),
    /** Install or update a tool. → {ok, version?, error?, canceled?} */
    install: (toolId) => ipcRenderer.invoke('tools:install', toolId),
    /** Stop a download in progress. */
    cancel: (toolId) => ipcRenderer.invoke('tools:cancel', toolId),
    /** "!" mode: run a user command in the project dir. → {ok, output} */
    runShell: (dir, command) => ipcRenderer.invoke('tools:runShell', dir, command),
    /** Subscribe to install progress lines: {toolId, line}. */
    onEvent: (callback) => {
      ipcRenderer.on('tools:event', (_event, payload) => callback(payload));
    },
  },

  auth: {
    /** Anthropic account status. → {available, loggedIn, email?, plan?} */
    status: () => ipcRenderer.invoke('auth:status'),
    /** Open the interactive sign-in in a terminal window. */
    login: () => ipcRenderer.invoke('auth:login'),
    /** Sign out. Returns the fresh status. */
    logout: () => ipcRenderer.invoke('auth:logout'),
  },

  projects: {
    /** Open the native folder picker. → {ok, project?, canceled?, error?} */
    pick: () => ipcRenderer.invoke('projects:pick'),
    /** Create a new project folder with the given name. */
    create: (name) => ipcRenderer.invoke('projects:create', name),
    /** Open a known folder (from the recents list). */
    open: (dir) => ipcRenderer.invoke('projects:open', dir),
    /** List recent projects (most recent first). */
    recents: () => ipcRenderer.invoke('projects:recents'),
    /** Relative file paths for the "@" mention palette. */
    files: (dir) => ipcRenderer.invoke('projects:files', dir),
    /** Append a "#note" to CLAUDE.md (project memory). */
    addMemory: (dir, note) => ipcRenderer.invoke('projects:addMemory', dir, note),
    /** Remove one entry from the recents list. Returns the updated list. */
    removeRecent: (dir) => ipcRenderer.invoke('projects:removeRecent', dir),
  },

  chats: {
    /** Saved conversations for a project (null = general chat), newest first. */
    list: (project) => ipcRenderer.invoke('chats:list', project),
    /** Full record (with the rendered feed) for one chat. */
    get: (id) => ipcRenderer.invoke('chats:get', id),
    /** Insert or update a chat record. */
    save: (record) => ipcRenderer.invoke('chats:save', record),
    /** Forget one chat. */
    delete: (id) => ipcRenderer.invoke('chats:delete', id),
    /** AI-name a chat from its first exchange. → {ok, title?} */
    makeTitle: (payload) => ipcRenderer.invoke('chats:makeTitle', payload),
    /** CLI (terminal) sessions for this folder that VibeShell doesn't know. */
    external: (project) => ipcRenderer.invoke('chats:external', project),
    /** Rebuild one CLI session as a resumable chat record. */
    import: (project, id) => ipcRenderer.invoke('chats:import', project, id),
  },

  agent: {
    /** Start (or restart) a session; resumeId continues a saved chat, and
     *  resumeAt (an assistant-message uuid) truncates it there — rewind. */
    start: (projectDir, resumeId, resumeAt) =>
      ipcRenderer.invoke('agent:start', projectDir, resumeId, resumeAt),
    /** Send a user message: {text, images?: [{mediaType, data}]} or a string. */
    send: (payload) => ipcRenderer.invoke('agent:send', payload),
    /** Switch the model mid-session (one click instead of /model). */
    setModel: (model) => ipcRenderer.invoke('agent:setModel', model),
    /** Permission mode: default | acceptEdits | plan (like Shift+Tab). */
    setMode: (mode) => ipcRenderer.invoke('agent:setMode', mode),
    /** Restore files to their state before a user message (checkpoints). */
    rewind: (uuid) => ipcRenderer.invoke('agent:rewind', uuid),
    /** Tools granted "always allow" this session. */
    permissions: () => ipcRenderer.invoke('agent:permissions'),
    /** Revoke one grant; returns the updated list. */
    revokePermission: (name) => ipcRenderer.invoke('agent:revokePermission', name),
    /** Stop the current turn (the ■ button) — the session stays alive. */
    interrupt: () => ipcRenderer.invoke('agent:interrupt'),
    /** Master switch: approve every agent action without asking. */
    setAutoApprove: (enabled) => ipcRenderer.invoke('agent:autoApprove', enabled),
    /** Thinking-effort level: low | medium | high | xhigh. */
    setEffort: (level) => ipcRenderer.invoke('agent:setEffort', level),
    /** Fast mode on/off (supported models only, e.g. Opus). */
    setFastMode: (enabled) => ipcRenderer.invoke('agent:setFastMode', enabled),
    /** Answer an approval card. decision: {allow: bool, always?: bool} */
    respondPermission: (id, decision) => ipcRenderer.invoke('agent:permission', id, decision),
    /** Stop the running session. */
    stop: () => ipcRenderer.invoke('agent:stop'),
    /** Subscribe to session events (status, assistant-text, permission-request, …). */
    onEvent: (callback) => {
      ipcRenderer.on('agent:event', (_event, payload) => callback(payload));
    },
  },
});
