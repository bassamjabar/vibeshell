// VibeShell — renderer logic for the launcher, project picker, and navigation.
// Talks to the system ONLY through window.vibeshell (see preload.js).
// Kept framework-free but componentized, so a later React migration is easy.

const $ = (sel) => document.querySelector(sel);
const t = (key, vars) => window.I18N.t(key, vars);

/* ---------- Screen switching ---------- */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

// Everything after the launcher wears the chosen tool's browser look:
// claude.ai ivory, chatgpt.com white, gemini.google.com Google style.
function applyTheme(toolId) {
  if (toolId) document.body.dataset.theme = toolId;
  else delete document.body.dataset.theme;
  syncTitleBar();
}

// Tint the native window buttons (min/max/close) to the active palette.
function syncTitleBar() {
  const styles = getComputedStyle(document.body);
  window.vibeshell.win.setOverlay({
    color: styles.getPropertyValue('--bg').trim(),
    symbolColor: styles.getPropertyValue('--text').trim(),
  });
}

/* ---------- Tool launcher (home screen) ---------- */

// id → { tool, installedVersion, latestVersion, installing, progressLine, error }
const toolState = new Map();

// Anthropic account shown on the Claude card. null = still loading.
let claudeAccount = null;
let signInWaiting = false;
let signInCancel = false;

// Official brand marks (Claude & Gemini from Simple Icons, OpenAI from svgl),
// inlined so the strict CSP never has to fetch anything.
const TOOL_LOGOS = {
  claude:
    '<svg viewBox="0 0 24 24"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>',
  codex:
    '<svg viewBox="0 0 256 260"><path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z"/></svg>',
  gemini:
    '<svg viewBox="0 0 24 24"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/></svg>',
};

// Good-enough semver compare on the numeric parts (ignores prereleases).
function newerThan(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

function hasUpdate(state) {
  return Boolean(
    state.installed &&
    state.installedVersion &&
    state.latestVersion &&
    newerThan(state.latestVersion, state.installedVersion)
  );
}

function toolStatusText(state) {
  if (state.installing) return t('installing');
  if (!state.installed) return t('notInstalled');
  if (hasUpdate(state)) return `v${state.installedVersion} → v${state.latestVersion}`;
  return state.installedVersion ? `v${state.installedVersion}` : t('installed');
}

function toolCard(state) {
  const { tool } = state;
  const li = document.createElement('li');
  li.className = 'tool-card';
  li.dataset.toolId = tool.id;

  // Header row: badge, name/vendor, version pill.
  const head = document.createElement('div');
  head.className = 'tool-head';

  const badge = document.createElement('div');
  badge.className = `tool-badge badge-${tool.id}`;
  if (TOOL_LOGOS[tool.id]) badge.innerHTML = TOOL_LOGOS[tool.id];
  else badge.textContent = tool.name.charAt(0);

  const info = document.createElement('div');
  info.className = 'tool-info';
  const name = document.createElement('div');
  name.className = 'tool-name';
  name.textContent = tool.name;
  const vendor = document.createElement('div');
  vendor.className = 'tool-vendor';
  vendor.textContent = tool.vendor;
  info.append(name, vendor);

  const pill = document.createElement('span');
  pill.className = 'tool-version';
  if (state.installing) pill.classList.add('busy');
  else if (!state.installed) pill.classList.add('missing');
  else if (hasUpdate(state)) pill.classList.add('stale');
  pill.textContent = toolStatusText(state);

  head.append(badge, info, pill);
  li.appendChild(head);

  const blurb = document.createElement('p');
  blurb.className = 'tool-blurb';
  blurb.textContent = t(`blurb-${tool.id}`) !== `blurb-${tool.id}`
    ? t(`blurb-${tool.id}`)
    : tool.blurb;
  li.appendChild(blurb);

  if (state.installing) {
    const progress = document.createElement('div');
    progress.className = 'tool-progress';
    progress.textContent = state.progressLine || t('workingEllipsis');
    li.appendChild(progress);
  }

  if (state.error) {
    const error = document.createElement('div');
    error.className = 'tool-error';
    error.textContent = state.error;
    li.appendChild(error);
  }

  // Account row — Claude only, and only once the CLI is installed.
  if (tool.id === 'claude' && state.installed && claudeAccount && claudeAccount.available) {
    const account = document.createElement('div');
    account.className = 'tool-account';

    const label = document.createElement('span');
    label.className = 'tool-account-label';

    if (signInWaiting) {
      label.textContent = t('waitingSignIn');
      account.appendChild(label);
      // Let the user bail out (e.g. they closed the sign-in terminal) and retry.
      const cancel = document.createElement('button');
      cancel.className = 'link-btn';
      cancel.textContent = t('cancel');
      cancel.addEventListener('click', cancelSignIn);
      account.appendChild(cancel);
    } else if (claudeAccount.loggedIn) {
      label.textContent = t('signedInAs', { email: claudeAccount.email || '—' }) +
        (claudeAccount.plan ? t('planSuffix', { plan: claudeAccount.plan }) : '');
      account.appendChild(label);

      const signOut = document.createElement('button');
      signOut.className = 'link-btn';
      signOut.textContent = t('signOut');
      signOut.addEventListener('click', signOutClaude);
      account.appendChild(signOut);
    } else {
      // The Sign in action lives in the action row below — label only here.
      label.textContent = t('notSignedIn');
      account.appendChild(label);
    }

    li.appendChild(account);
  }

  // Action row. Install and Update run the same flow; the label differs.
  const actions = document.createElement('div');
  actions.className = 'tool-actions';

  if (state.installing) {
    const cancel = document.createElement('button');
    cancel.className = 'ghost-btn btn-danger';
    cancel.textContent = t('cancel');
    cancel.addEventListener('click', () => window.vibeshell.tools.cancel(tool.id));
    actions.appendChild(cancel);
  } else if (!state.installed) {
    const install = document.createElement('button');
    install.className = 'primary-btn';
    install.textContent = t('install');
    install.addEventListener('click', () => installTool(tool.id));
    actions.appendChild(install);
  } else {
    if (hasUpdate(state)) {
      const update = document.createElement('button');
      update.className = 'update-btn';
      update.textContent = t('update');
      update.addEventListener('click', () => installTool(tool.id));
      actions.appendChild(update);
    }
    if (tool.chatReady) {
      // Signed out (and we know it for sure): chat can only fail, so Open is
      // hidden entirely and Sign in becomes the one action. While the sign-in
      // window is open, the account row already says "waiting" — no buttons.
      const signedOut = tool.id === 'claude' && claudeAccount &&
        claudeAccount.available && !claudeAccount.loggedIn;
      if (signedOut && !signInWaiting) {
        const signIn = document.createElement('button');
        signIn.className = 'primary-btn';
        signIn.textContent = t('signIn');
        signIn.addEventListener('click', signInClaude);
        actions.appendChild(signIn);
      } else if (!signedOut) {
        const open = document.createElement('button');
        open.className = 'primary-btn';
        open.textContent = t('open');
        open.addEventListener('click', () => openTool(tool));
        actions.appendChild(open);
      }
    } else {
      const soon = document.createElement('span');
      soon.className = 'tool-soon';
      soon.textContent = t('comingSoon');
      actions.appendChild(soon);
    }
  }

  li.appendChild(actions);
  return li;
}

function renderTools() {
  const list = $('#tools-list');
  list.innerHTML = '';
  for (const state of toolState.values()) {
    list.appendChild(toolCard(state));
  }
}

async function installTool(id) {
  const state = toolState.get(id);
  if (!state || state.installing) return;
  state.installing = true;
  state.error = null;
  state.progressLine = t('startingDownload');
  renderTools();

  const res = await window.vibeshell.tools.install(id);
  state.installing = false;
  state.progressLine = null;
  if (res.ok) {
    state.installed = true;
    state.installedVersion = res.version || state.latestVersion || state.installedVersion;
    // Whatever npm just installed IS the latest — clear the update badge.
    if (state.installedVersion) state.latestVersion = state.installedVersion;
    // A fresh Claude install means account controls just became possible.
    if (id === 'claude') refreshAccount();
  } else if (!res.canceled) {
    state.error = res.error || t('genericError');
  }
  renderTools();
}

// Live npm output while an install runs: update the one line in place.
window.vibeshell.tools.onEvent(({ toolId, line }) => {
  const state = toolState.get(toolId);
  if (!state || !state.installing) return;
  state.progressLine = line;
  const el = document.querySelector(`.tool-card[data-tool-id="${toolId}"] .tool-progress`);
  if (el) el.textContent = line;
});

/* ---------- Anthropic account (on the Claude card) ---------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function refreshAccount() {
  claudeAccount = await window.vibeshell.auth.status();
  renderTools();
  updateAccountButton();
}

async function signInClaude() {
  if (signInWaiting) return;
  signInWaiting = true;
  signInCancel = false;
  renderTools();
  await window.vibeshell.auth.login();
  // The browser flow finishes in the terminal window; poll until it lands
  // (or until the user cancels / ~2 minutes pass — then they can retry).
  for (let i = 0; i < 40 && !signInCancel; i += 1) {
    await sleep(3000);
    if (signInCancel) break;
    const status = await window.vibeshell.auth.status();
    if (status.loggedIn) {
      claudeAccount = status;
      break;
    }
  }
  signInWaiting = false;
  renderTools();
  updateAccountButton();
}

// Stop waiting (e.g. the sign-in terminal was closed) so the user can retry.
function cancelSignIn() {
  signInCancel = true;
  signInWaiting = false;
  renderTools();
}

async function signOutClaude() {
  if (!window.confirm(t('confirmSignOut'))) return;
  claudeAccount = await window.vibeshell.auth.logout();
  renderTools();
}

async function initTools() {
  const tools = await window.vibeshell.tools.list();
  for (const tool of tools) {
    const previous = toolState.get(tool.id);
    toolState.set(tool.id, {
      tool,
      installed: !!tool.installed,
      installedVersion: tool.installedVersion,
      latestVersion: previous ? previous.latestVersion : null,
      installing: false,
      progressLine: null,
      error: null,
    });
  }
  renderTools();

  // Update check runs after first paint so the launcher never feels slow.
  const latest = await window.vibeshell.tools.latest();
  for (const [id, version] of Object.entries(latest)) {
    const state = toolState.get(id);
    if (state && version) state.latestVersion = version;
  }
  renderTools();
}

// Open goes STRAIGHT into the workspace (sidebar + chat), like the browser
// apps. The most recent project opens automatically; switching projects
// happens in the sidebar without ever leaving the chat.
async function openTool(tool) {
  applyTheme(tool.id);
  showScreen('#screen-project');
  updateAccountButton();

  // In an editor panel, opening a tool enters the folder the terminal was in.
  if (embeddedCwd) {
    const name = String(embeddedCwd).split(/[\\/]/).filter(Boolean).pop() || embeddedCwd;
    enterProject({ path: embeddedCwd, name });
    return;
  }

  const recents = await window.vibeshell.projects.recents();
  renderSidebar(recents);

  if (recents.length > 0) {
    const res = await window.vibeshell.projects.open(recents[0].path);
    if (res.ok) {
      enterProject(res.project);
      return;
    }
  }
  // No projects yet — chat works anyway, no folder required.
  enterGeneralChat();
}

// "Just chat": a full session with no project attached. The agent runs
// from the home folder; a real project is one sidebar click away.
function enterGeneralChat() {
  currentProject = null;
  activeChatId = null;
  $('#project-name').textContent = t('generalChat');
  $('#project-path').textContent = t('noFolderOpen');
  showScreen('#screen-project');
  updateAccountButton();
  renderSidebar();
  renderChats();
  window.AIShellChat.start(null);
}

/* ---------- Project screen entry ---------- */

let currentProject = null;

// settings.js (and anything else) can ask where we are without coupling.
window.getCurrentProjectPath = () => (currentProject ? currentProject.path : null);

function enterProject(project) {
  currentProject = project;
  activeChatId = null;
  $('#project-name').textContent = project.name;
  $('#project-path').textContent = project.path;
  showScreen('#screen-project');
  updateAccountButton();
  renderSidebar();
  renderChats();
  window.AIShellChat.start(project);
}

/* ---------- Sidebar: project switching inside the chat ---------- */

$('#btn-sidebar').addEventListener('click', () => {
  $('#workspace').classList.toggle('sb-hidden');
});

// A parallel session in its own window — each window owns its own agent.
$('#btn-new-window').addEventListener('click', () => {
  window.vibeshell.win.newWindow();
});

// MCP servers + standing permission rules (renderer/settings.js).
$('#btn-settings').addEventListener('click', () => {
  if (typeof window.openSettingsModal === 'function') window.openSettingsModal();
});

async function renderSidebar(recents) {
  if (!recents) recents = await window.vibeshell.projects.recents();
  if (sbQuery) {
    recents = recents.filter((p) => p.name.toLowerCase().includes(sbQuery));
  }
  const list = $('#sb-projects');
  list.innerHTML = '';
  $('#sb-empty').classList.toggle('hidden', recents.length > 0);

  for (const project of recents) {
    const item = document.createElement('li');
    item.className =
      'sb-item' +
      (currentProject && currentProject.path === project.path ? ' active' : '');
    item.title = project.path;

    const name = document.createElement('span');
    name.className = 'sb-item-name';
    name.textContent = project.name;

    const remove = document.createElement('button');
    remove.className = 'sb-remove';
    remove.textContent = '×';
    remove.title = t('removeRecent');
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      await window.vibeshell.projects.removeRecent(project.path);
      renderSidebar();
    });

    item.append(name, remove);
    item.addEventListener('click', async () => {
      if (currentProject && currentProject.path === project.path) return;
      const res = await window.vibeshell.projects.open(project.path);
      if (res.ok) enterProject(res.project);
      else renderSidebar(); // folder vanished — refresh cleans the list
    });

    list.appendChild(item);
  }
}

/* ---------- Saved chats in the sidebar ---------- */

let activeChatId = null;
let sbQuery = ''; // lowercase filter shared by both sidebar lists

async function renderChats() {
  let chats = await window.vibeshell.chats.list(
    currentProject ? currentProject.path : null
  );
  if (sbQuery) {
    chats = chats.filter((c) => (c.title || '').toLowerCase().includes(sbQuery));
  }
  const list = $('#sb-chats');
  list.innerHTML = '';
  $('#sb-chats-empty').classList.toggle('hidden', chats.length > 0);

  for (const chat of chats) {
    const item = document.createElement('li');
    item.className = 'sb-item' + (chat.id === activeChatId ? ' active' : '');
    item.title = chat.title;

    const name = document.createElement('span');
    name.className = 'sb-item-name';
    name.textContent = chat.title;

    const remove = document.createElement('button');
    remove.className = 'sb-remove';
    remove.textContent = '×';
    remove.title = t('deleteChat');
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      await window.vibeshell.chats.delete(chat.id);
      if (activeChatId === chat.id) activeChatId = null;
      renderChats();
    });

    item.append(name, remove);
    item.addEventListener('click', async () => {
      if (chat.id === activeChatId) return;
      const rec = await window.vibeshell.chats.get(chat.id);
      if (!rec) { renderChats(); return; }
      activeChatId = chat.id;
      renderChats();
      window.AIShellChat.resume(currentProject, rec);
    });

    list.appendChild(item);
  }

  renderExternalChats();
}

// Terminal (CLI) sessions for this folder — conversations started outside
// VibeShell, one click away from continuing here. The terminal itself only
// offers these through `claude --resume`.
async function renderExternalChats() {
  let sessions = await window.vibeshell.chats.external(
    currentProject ? currentProject.path : null
  );
  if (sbQuery) {
    sessions = sessions.filter((s) => (s.title || '').toLowerCase().includes(sbQuery));
  }
  const list = $('#sb-external');
  list.innerHTML = '';
  $('#sb-external-label').classList.toggle('hidden', sessions.length === 0);

  for (const session of sessions) {
    const item = document.createElement('li');
    item.className = 'sb-item sb-item-ext';
    item.title = session.title;

    const name = document.createElement('span');
    name.className = 'sb-item-name';
    name.textContent = session.title;
    item.appendChild(name);

    item.addEventListener('click', async () => {
      const rec = await window.vibeshell.chats.import(
        currentProject ? currentProject.path : null,
        session.id
      );
      if (!rec) { renderExternalChats(); return; }
      activeChatId = rec.id;
      window.AIShellChat.resume(currentProject, rec);
      renderChats();
    });

    list.appendChild(item);
  }
}

// A brand-new chat gets saved for the first time → it appears in the list.
document.addEventListener('vibeshell:chats-changed', (event) => {
  if (event.detail && event.detail.id) activeChatId = event.detail.id;
  renderChats();
});

// Sidebar search filters both lists as you type (Ctrl+K focuses it).
$('#sb-search').addEventListener('input', () => {
  sbQuery = $('#sb-search').value.trim().toLowerCase();
  renderSidebar();
  renderChats();
});

$('#sb-open').addEventListener('click', async () => {
  const res = await window.vibeshell.projects.pick();
  if (res.ok) enterProject(res.project);
});

$('#sb-new').addEventListener('click', () => openCreateModal());

$('#sb-general').addEventListener('click', () => {
  if (currentProject !== null) enterGeneralChat();
});

/* ---------- New chat (fresh session, same project) ---------- */

$('#btn-new-chat').addEventListener('click', () => {
  // Works in both modes: with a project, or the no-folder general chat.
  activeChatId = null;
  renderChats();
  window.AIShellChat.start(currentProject);
});

/* ---------- Account button in the chat header ---------- */

const accountBtn = $('#account-btn');
const accountMenu = $('#account-menu');

function updateAccountButton() {
  const signedIn = claudeAccount && claudeAccount.available && claudeAccount.loggedIn;
  accountBtn.classList.toggle('hidden', !signedIn);
  if (signedIn) {
    accountBtn.textContent = (claudeAccount.email || '?').charAt(0).toUpperCase();
  }
}

/* ---------- Usage helpers (shared by menu + modal) ---------- */

function usageTimeLeft(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// One labeled progress bar: "Session (5h)   32% · resets in 2h 10m"
function usageRow(label, entry) {
  if (!entry || entry.pct === null || entry.pct === undefined) return null;
  const pct = Math.max(0, Math.min(100, Math.round(entry.pct)));
  const left = usageTimeLeft(entry.resetsAt);

  const row = document.createElement('div');
  row.className = 'u-row';

  const top = document.createElement('div');
  top.className = 'u-top';
  const name = document.createElement('span');
  name.textContent = label;
  const value = document.createElement('span');
  value.className = 'u-value';
  value.textContent = left ? `${pct}% · ${t('resetsIn', { t: left })}` : `${pct}%`;
  top.append(name, value);

  const bar = document.createElement('div');
  bar.className = 'usage-bar u-bar';
  const fill = document.createElement('span');
  fill.className = 'usage-fill';
  fill.style.width = `${pct}%`;
  fill.dataset.level = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
  bar.appendChild(fill);

  row.append(top, bar);
  return row;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0m';
  const minutes = Math.round(ms / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/* ---------- Usage details modal (like the Claude app) ---------- */

const usageModal = $('#modal-usage');
const usageDetail = $('#usage-detail');

function statLine(label, value) {
  const line = document.createElement('div');
  line.className = 'u-stat';
  const name = document.createElement('span');
  name.textContent = label;
  const val = document.createElement('span');
  val.className = 'u-value';
  val.textContent = value;
  line.append(name, val);
  return line;
}

function sectionTitle(text) {
  const el = document.createElement('div');
  el.className = 'u-section-title';
  el.textContent = text;
  return el;
}

function openUsageModal() {
  const usage = window.__vibeUsage;
  usageDetail.innerHTML = '';

  if (!usage) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('noUsage');
    usageDetail.appendChild(empty);
  } else {
    // Plan limit windows, most immediate first.
    usageDetail.appendChild(sectionTitle(t('planLimits')));
    const rows = [
      usageRow(t('session5h'), usage.fiveHour),
      usageRow(t('weeklyAll'), usage.sevenDay),
      usageRow(t('weeklyModel', { name: 'Opus' }), usage.sevenDayOpus),
      usageRow(t('weeklyModel', { name: 'Sonnet' }), usage.sevenDaySonnet),
      ...(usage.modelScoped || []).map((m) => usageRow(t('weeklyModel', { name: m.name }), m)),
    ].filter(Boolean);
    if (rows.length === 0) {
      const na = document.createElement('p');
      na.className = 'empty';
      na.textContent = t('planNA');
      usageDetail.appendChild(na);
    } else {
      rows.forEach((row) => usageDetail.appendChild(row));
    }

    // Extra usage credits (if the account has them enabled).
    if (usage.extra) {
      usageDetail.appendChild(sectionTitle(t('extraUsage')));
      usageDetail.appendChild(
        statLine(
          t('creditsUsed'),
          `${usage.extra.used ?? 0} / ${usage.extra.limit ?? '∞'} ${usage.extra.currency}`
        )
      );
    }

    // What this particular session has consumed so far.
    if (usage.session) {
      usageDetail.appendChild(sectionTitle(t('thisSession')));
      if (usage.session.costUsd !== null) {
        usageDetail.appendChild(
          statLine(t('apiCost'), `$${usage.session.costUsd.toFixed(2)}`)
        );
      }
      usageDetail.appendChild(
        statLine(t('sessionLength'), formatDuration(usage.session.durationMs))
      );
      usageDetail.appendChild(
        statLine(t('modelTime'), formatDuration(usage.session.apiDurationMs))
      );
      usageDetail.appendChild(
        statLine(
          t('codeChanges'),
          t('linesChanged', { a: usage.session.linesAdded, r: usage.session.linesRemoved })
        )
      );
    }
  }

  usageModal.classList.remove('hidden');
}
window.openUsageModal = openUsageModal; // chat.js opens it from the pill

$('#usage-close').addEventListener('click', () => usageModal.classList.add('hidden'));
usageModal.addEventListener('click', (event) => {
  if (event.target === usageModal) usageModal.classList.add('hidden');
});

function renderAccountMenu() {
  accountMenu.innerHTML = '';
  if (!claudeAccount || !claudeAccount.loggedIn) return;

  const info = document.createElement('div');
  info.className = 'account-info';
  const email = document.createElement('div');
  email.className = 'account-email';
  email.textContent = claudeAccount.email || 'Signed in';
  info.appendChild(email);
  if (claudeAccount.plan) {
    const plan = document.createElement('div');
    plan.className = 'account-plan';
    plan.textContent = t('planSuffix', { plan: claudeAccount.plan }).replace(/^ · /, '');
    info.appendChild(plan);
  }
  accountMenu.appendChild(info);

  // Quick usage summary right in the menu, like the Claude app —
  // every limit window the account reports, including per-model weeklies.
  const usage = window.__vibeUsage;
  const usageRows = usage
    ? [
        usageRow(t('session5h'), usage.fiveHour),
        usageRow(t('weeklyAll'), usage.sevenDay),
        usageRow(t('weeklyModel', { name: 'Opus' }), usage.sevenDayOpus),
        usageRow(t('weeklyModel', { name: 'Sonnet' }), usage.sevenDaySonnet),
        ...((usage.modelScoped || []).map((m) => usageRow(t('weeklyModel', { name: m.name }), m))),
      ].filter(Boolean)
    : [];
  if (usageRows.length > 0) {
    const box = document.createElement('div');
    box.className = 'account-usage';
    usageRows.forEach((row) => box.appendChild(row));
    accountMenu.appendChild(box);

    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'account-item';
    details.textContent = t('viewUsage');
    details.addEventListener('click', () => {
      accountMenu.classList.add('hidden');
      openUsageModal();
    });
    accountMenu.appendChild(details);
  }

  const signOut = document.createElement('button');
  signOut.type = 'button';
  signOut.className = 'account-signout';
  signOut.textContent = t('signOut');
  signOut.addEventListener('click', async () => {
    accountMenu.classList.add('hidden');
    if (!window.confirm(t('confirmSignOut'))) return;
    claudeAccount = await window.vibeshell.auth.logout();
    window.AIShellChat.stop();
    applyTheme(null);
    showScreen('#screen-home');
    renderTools();
    updateAccountButton();
  });
  accountMenu.appendChild(signOut);
}

accountBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  renderAccountMenu();
  accountMenu.classList.toggle('hidden');
});

document.addEventListener('click', (event) => {
  if (!accountMenu.contains(event.target) && event.target !== accountBtn) {
    accountMenu.classList.add('hidden');
  }
});

/* ---------- Create new project (modal) ---------- */

const modal = $('#modal-create');
const nameInput = $('#input-project-name');
const createError = $('#create-error');

function openCreateModal() {
  nameInput.value = '';
  createError.classList.add('hidden');
  modal.classList.remove('hidden');
  nameInput.focus();
}

function closeCreateModal() {
  modal.classList.add('hidden');
}

function showCreateError(message) {
  createError.textContent = message;
  createError.classList.remove('hidden');
}

async function confirmCreate() {
  const name = nameInput.value.trim();
  if (!name) {
    showCreateError(t('nameRequired'));
    return;
  }
  const res = await window.vibeshell.projects.create(name);
  if (res.ok) {
    closeCreateModal();
    enterProject(res.project);
  } else if (!res.canceled) {
    showCreateError(res.error || t('genericError'));
  }
  // If the user canceled the location dialog, keep the modal open silently.
}

$('#btn-create-cancel').addEventListener('click', closeCreateModal);
$('#btn-create-confirm').addEventListener('click', confirmCreate);

nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') confirmCreate();
  if (event.key === 'Escape') closeCreateModal();
});

modal.addEventListener('click', (event) => {
  if (event.target === modal) closeCreateModal();
});

/* ---------- Back to the tool launcher ---------- */

$('#btn-back').addEventListener('click', () => {
  window.AIShellChat.stop();
  currentProject = null;
  applyTheme(null);
  showScreen('#screen-home');
  initTools(); // re-check versions — cheap, and catches installs done elsewhere
});

/* ---------- Dark mode ---------- */

function setDark(on) {
  document.body.classList.toggle('dark', on);
  try { localStorage.setItem('vibeshell-dark', on ? '1' : '0'); } catch { /* fine */ }
  for (const btn of [$('#btn-dark'), $('#btn-dark-home')]) {
    if (btn) btn.textContent = on ? '☀️' : '🌙';
  }
  syncTitleBar();
}

$('#btn-dark').addEventListener('click', () => setDark(!document.body.classList.contains('dark')));
$('#btn-dark-home').addEventListener('click', () => setDark(!document.body.classList.contains('dark')));

/* ---------- Language (Arabic ⇄ English) ---------- */

function setLang(lang) {
  window.I18N.applyLang(lang); // fires vibeshell:lang-changed → chat.js reacts
  // The toggle shows the language you would SWITCH TO.
  const other = lang === 'ar' ? 'EN' : 'ع';
  for (const btn of [$('#btn-lang'), $('#btn-lang-home')]) {
    if (btn) { btn.textContent = other; btn.title = t('toggleLang'); }
  }
  // Re-render everything app.js owns that holds translated text.
  renderTools();
  const inChat = !$('#screen-project').classList.contains('hidden');
  if (inChat) {
    renderSidebar();
    renderChats();
    if (!currentProject) {
      $('#project-name').textContent = t('generalChat');
      $('#project-path').textContent = t('noFolderOpen');
    }
  }
}

function toggleLang() {
  setLang(window.I18N.lang === 'ar' ? 'en' : 'ar');
}

$('#btn-lang').addEventListener('click', toggleLang);
$('#btn-lang-home').addEventListener('click', toggleLang);

/* ---------- Keyboard shortcuts ---------- */

document.addEventListener('keydown', (event) => {
  const inChat = !$('#screen-project').classList.contains('hidden');
  if (event.ctrlKey && event.key.toLowerCase() === 'n' && inChat) {
    event.preventDefault();
    activeChatId = null;
    renderChats();
    window.AIShellChat.start(currentProject);
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'b' && inChat) {
    event.preventDefault();
    $('#workspace').classList.toggle('sb-hidden');
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'k' && inChat) {
    event.preventDefault();
    $('#workspace').classList.remove('sb-hidden');
    $('#sb-search').focus();
  }
  if (event.key === 'Escape') {
    document.querySelectorAll('.model-menu').forEach((m) => m.classList.add('hidden'));
    usageModal.classList.add('hidden');
  }
});

/* ---------- Embedded panel (VS Code / Android Studio) ----------
   The host hands us the terminal's folder. We stay on the launcher so the
   user can pick the tool (Claude / Codex / Gemini); choosing one then opens
   the chat on that folder (see openTool). */
let embeddedCwd = null;
window.addEventListener('vibeshell:cwd', (event) => {
  document.body.classList.add('embedded'); // compact chrome for a small panel
  embeddedCwd = (event.detail && event.detail.cwd) || null;
  // The launcher (#screen-home) is already the boot screen — leave it up so
  // the tool cards are visible; picking one routes into embeddedCwd.
});

/* ---------- Backend health banner (embedded panels) ----------
   The bridge fires these when the host/sidecar can't be reached, so the panel
   explains itself instead of hanging on a spinner. */
window.addEventListener('vibeshell:backend-down', () => {
  const banner = $('#backend-banner');
  if (banner) { banner.textContent = t('backendDown'); banner.classList.remove('hidden'); }
});
window.addEventListener('vibeshell:backend-up', () => {
  const banner = $('#backend-banner');
  if (banner) banner.classList.add('hidden');
});

/* ---------- Boot ---------- */

setLang(window.I18N.lang); // Arabic by default; also translates static HTML
setDark(localStorage.getItem('vibeshell-dark') === '1');
initTools();
refreshAccount();
