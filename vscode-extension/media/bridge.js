// VibeShell webview bridge (real).
// Provides window.vibeshell with the SAME shape as the desktop preload, but
// backed by webview messaging to a host instead of Electron IPC. The same
// message shapes ({__vibe:'invoke'|'response'|'event'|'cwd'}) ride over TWO
// transports, chosen at runtime:
//   • VS Code    — acquireVsCodeApi().postMessage  ↔  window 'message' events
//   • JetBrains  — window.__vibeToJava(json)        ↔  window.__vibeFromJava(json)
// so the identical renderer runs in a VS Code webview and a JetBrains JCEF
// browser without change.

(function () {
  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

  let seq = 0;
  const pending = new Map();          // request id → resolve
  const listeners = new Map();        // channel → [callback]

  // Transport starts known for VS Code (api is available synchronously); for
  // JetBrains, Java injects __vibeToJava after load and calls the ready hook,
  // so outbound messages queue until then.
  let transport = vscodeApi ? 'vscode' : null;
  let outbox = [];

  function rawSend(msg) {
    if (transport === 'vscode') vscodeApi.postMessage(msg);
    else if (transport === 'jetbrains' && window.__vibeToJava) window.__vibeToJava(JSON.stringify(msg));
    else outbox.push(msg); // not wired yet — flush on ready
  }

  // Backend-health signalling: the UI shows a clear banner instead of hanging
  // when the host/sidecar can't be reached (e.g. Node.js not installed).
  let backendWarned = false;
  function backendDown() {
    if (backendWarned) return;
    backendWarned = true;
    window.dispatchEvent(new CustomEvent('vibeshell:backend-down'));
  }
  function backendUp() {
    if (!backendWarned) return;
    backendWarned = false;
    window.dispatchEvent(new CustomEvent('vibeshell:backend-up'));
  }

  function dispatch(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.__vibe === 'response') {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        backendUp(); // a real response means the backend is alive
        entry.resolve(msg.result);
      }
    } else if (msg.__vibe === 'event') {
      const cbs = listeners.get(msg.channel);
      if (cbs) for (const cb of cbs) cb(msg.payload);
    } else if (msg.__vibe === 'cwd') {
      window.__vibeCwd = msg.cwd || null;
      window.dispatchEvent(new CustomEvent('vibeshell:cwd', { detail: { cwd: msg.cwd } }));
    } else if (msg.__vibe === 'backend-error') {
      // The host (JetBrains sidecar) reported it couldn't start / died.
      backendDown();
    }
  }

  // VS Code inbound.
  window.addEventListener('message', (event) => dispatch(event.data));

  // JetBrains inbound + readiness (harmless under VS Code — never called).
  window.__vibeFromJava = (json) => {
    try { dispatch(JSON.parse(json)); } catch (e) { void e; }
  };
  window.__vibeTransportReady = () => {
    transport = 'jetbrains';
    const queued = outbox;
    outbox = [];
    for (const m of queued) rawSend(m);
  };

  function invoke(channel, ...args) {
    return new Promise((resolve) => {
      const id = ++seq;
      // Generous timeout — legit calls (npm detection over the network) can be
      // slow; but a truly dead backend never answers, so surface a banner and
      // resolve null so nothing hangs forever.
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          backendDown();
          resolve(null);
        }
      }, 45000);
      pending.set(id, { resolve, timer });
      rawSend({ __vibe: 'invoke', id, channel, args });
    });
  }

  function on(channel, callback) {
    if (!listeners.has(channel)) listeners.set(channel, []);
    listeners.get(channel).push(callback);
  }

  window.vibeshell = {
    win: {
      setOverlay: (opts) => invoke('win:overlay', opts),
      newWindow: () => invoke('win:new'),
    },
    tools: {
      list: () => invoke('tools:list'),
      latest: () => invoke('tools:latest'),
      install: (toolId) => invoke('tools:install', toolId),
      cancel: (toolId) => invoke('tools:cancel', toolId),
      runShell: (dir, command) => invoke('tools:runShell', dir, command),
      onEvent: (cb) => on('tools:event', cb),
    },
    auth: {
      status: () => invoke('auth:status'),
      login: () => invoke('auth:login'),
      logout: () => invoke('auth:logout'),
    },
    projects: {
      pick: () => invoke('projects:pick'),
      create: (name) => invoke('projects:create', name),
      open: (dir) => invoke('projects:open', dir),
      recents: () => invoke('projects:recents'),
      files: (dir) => invoke('projects:files', dir),
      addMemory: (dir, note) => invoke('projects:addMemory', dir, note),
      removeRecent: (dir) => invoke('projects:removeRecent', dir),
    },
    chats: {
      list: (project) => invoke('chats:list', project),
      get: (id) => invoke('chats:get', id),
      save: (record) => invoke('chats:save', record),
      delete: (id) => invoke('chats:delete', id),
      makeTitle: (payload) => invoke('chats:makeTitle', payload),
      external: (project) => invoke('chats:external', project),
      import: (project, id) => invoke('chats:import', project, id),
    },
    agent: {
      start: (projectDir, resumeId, resumeAt) => invoke('agent:start', projectDir, resumeId, resumeAt),
      send: (payload) => invoke('agent:send', payload),
      setModel: (model) => invoke('agent:setModel', model),
      setMode: (mode) => invoke('agent:setMode', mode),
      rewind: (uuid) => invoke('agent:rewind', uuid),
      permissions: () => invoke('agent:permissions'),
      revokePermission: (name) => invoke('agent:revokePermission', name),
      interrupt: () => invoke('agent:interrupt'),
      setAutoApprove: (enabled) => invoke('agent:autoApprove', enabled),
      setEffort: (level) => invoke('agent:setEffort', level),
      setFastMode: (enabled) => invoke('agent:setFastMode', enabled),
      respondPermission: (id, decision) => invoke('agent:permission', id, decision),
      stop: () => invoke('agent:stop'),
      onEvent: (cb) => on('agent:event', cb),
    },
    settings: {
      mcpList: (project) => invoke('settings:mcpList', project),
      mcpAdd: (scope, project, name, spec) => invoke('settings:mcpAdd', scope, project, name, spec),
      mcpRemove: (scope, project, name) => invoke('settings:mcpRemove', scope, project, name),
      permList: (project) => invoke('settings:permList', project),
      permAdd: (scope, project, rule) => invoke('settings:permAdd', scope, project, rule),
      permRemove: (scope, project, rule) => invoke('settings:permRemove', scope, project, rule),
    },
  };
})();
