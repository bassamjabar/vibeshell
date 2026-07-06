// VibeShell — Claude Code settings modal (MCP servers + standing allow
// rules). A graphical replacement for the terminal's /mcp and /permissions
// dialogs; everything goes through window.vibeshell.settings (preload.js).

(function () {
  const t = (key, vars) => window.I18N.t(key, vars);
  const $ = (sel) => document.querySelector(sel);

  const modal = $('#modal-settings');
  const tabMcp = $('#tab-mcp');
  const tabRules = $('#tab-rules');
  const paneMcp = $('#pane-mcp');
  const paneRules = $('#pane-rules');

  function projectPath() {
    return typeof window.getCurrentProjectPath === 'function'
      ? window.getCurrentProjectPath()
      : null;
  }

  /* ---------- Tabs ---------- */

  function showTab(which) {
    const mcp = which === 'mcp';
    tabMcp.classList.toggle('active', mcp);
    tabRules.classList.toggle('active', !mcp);
    paneMcp.classList.toggle('hidden', !mcp);
    paneRules.classList.toggle('hidden', mcp);
  }

  tabMcp.addEventListener('click', () => showTab('mcp'));
  tabRules.addEventListener('click', () => showTab('rules'));

  /* ---------- Shared bits ---------- */

  // Scope pickers are rebuilt on every open so they follow the language
  // and only offer "this project" when a project is actually open.
  function fillScopeSelect(select) {
    select.innerHTML = '';
    const scopes = projectPath()
      ? [['project', t('scopeProject')], ['user', t('scopeUser')]]
      : [['user', t('scopeUser')]];
    for (const [value, label] of scopes) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
  }

  function scopeChip(scope) {
    const chip = document.createElement('span');
    chip.className = 'perms-scope';
    chip.textContent = t(scope === 'project' ? 'scopeProject' : 'scopeUser');
    return chip;
  }

  function showError(el, message) {
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function errorMessage(code) {
    switch (code) {
      case 'bad-name': return t('badName');
      case 'no-project': return t('needProject');
      case 'file-unreadable': return t('fileUnreadable');
      default: return t('genericError');
    }
  }

  /* ---------- MCP servers ---------- */

  const mcpList = $('#mcp-list');
  const mcpEmpty = $('#mcp-empty');
  const mcpName = $('#mcp-name');
  const mcpCmd = $('#mcp-cmd');
  const mcpScope = $('#mcp-scope');
  const mcpError = $('#mcp-error');

  async function renderMcp() {
    const servers = await window.vibeshell.settings.mcpList(projectPath());
    mcpList.innerHTML = '';
    mcpEmpty.classList.toggle('hidden', servers.length > 0);

    for (const server of servers) {
      const item = document.createElement('li');
      item.className = 'perms-item';

      const info = document.createElement('span');
      info.className = 'perms-name';
      const name = document.createElement('strong');
      name.textContent = server.name;
      info.appendChild(name);
      info.appendChild(scopeChip(server.scope));
      if (server.summary) {
        const summary = document.createElement('span');
        summary.className = 'perms-summary';
        summary.dir = 'ltr';
        summary.textContent = server.summary;
        info.appendChild(summary);
      }

      const remove = document.createElement('button');
      remove.className = 'link-btn';
      remove.textContent = t('revoke');
      remove.addEventListener('click', async () => {
        await window.vibeshell.settings.mcpRemove(server.scope, projectPath(), server.name);
        renderMcp();
      });

      item.append(info, remove);
      mcpList.appendChild(item);
    }
  }

  $('#mcp-add').addEventListener('click', async () => {
    mcpError.classList.add('hidden');
    const name = mcpName.value.trim();
    const cmd = mcpCmd.value.trim();
    if (!name || !cmd) {
      showError(mcpError, t('fieldRequired'));
      return;
    }
    const spec = /^https?:\/\//i.test(cmd) ? { url: cmd } : { command: cmd };
    const res = await window.vibeshell.settings.mcpAdd(
      mcpScope.value, projectPath(), name, spec
    );
    if (res && res.ok) {
      mcpName.value = '';
      mcpCmd.value = '';
      renderMcp();
    } else {
      showError(mcpError, errorMessage(res && res.error));
    }
  });

  /* ---------- Standing allow rules ---------- */

  const rulesList = $('#rules-list');
  const rulesEmpty = $('#rules-empty');
  const ruleInput = $('#rule-input');
  const ruleScope = $('#rule-scope');
  const ruleError = $('#rule-error');

  async function renderRules() {
    const rules = await window.vibeshell.settings.permList(projectPath());
    rulesList.innerHTML = '';
    rulesEmpty.classList.toggle('hidden', rules.length > 0);

    for (const entry of rules) {
      const item = document.createElement('li');
      item.className = 'perms-item';

      const info = document.createElement('span');
      info.className = 'perms-name';
      const rule = document.createElement('code');
      rule.dir = 'ltr';
      rule.textContent = entry.rule;
      info.appendChild(rule);
      info.appendChild(scopeChip(entry.scope));

      const remove = document.createElement('button');
      remove.className = 'link-btn';
      remove.textContent = t('revoke');
      remove.addEventListener('click', async () => {
        await window.vibeshell.settings.permRemove(entry.scope, projectPath(), entry.rule);
        renderRules();
      });

      item.append(info, remove);
      rulesList.appendChild(item);
    }
  }

  $('#rule-add').addEventListener('click', async () => {
    ruleError.classList.add('hidden');
    const rule = ruleInput.value.trim();
    if (!rule) {
      showError(ruleError, t('fieldRequired'));
      return;
    }
    const res = await window.vibeshell.settings.permAdd(
      ruleScope.value, projectPath(), rule
    );
    if (res && res.ok) {
      ruleInput.value = '';
      renderRules();
    } else {
      showError(ruleError, errorMessage(res && res.error));
    }
  });

  /* ---------- Open / close ---------- */

  window.openSettingsModal = function openSettingsModal() {
    fillScopeSelect(mcpScope);
    fillScopeSelect(ruleScope);
    mcpError.classList.add('hidden');
    ruleError.classList.add('hidden');
    renderMcp();
    renderRules();
    showTab('mcp');
    modal.classList.remove('hidden');
  };

  $('#settings-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.classList.add('hidden');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') modal.classList.add('hidden');
  });
})();
