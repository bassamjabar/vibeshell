// VibeShell — chat screen logic.
// Renders the conversation with the agent: message bubbles, activity lines,
// status pill, and approval cards. Talks to the system only via
// window.vibeshell.agent (see preload.js).

(function () {
  // Shorthand for the shared translator (renderer/i18n.js loads first).
  const t = (key, vars) => window.I18N.t(key, vars);

  const messagesEl = document.querySelector('#chat-messages');
  const inputEl = document.querySelector('#chat-input');
  const sendBtn = document.querySelector('#btn-send');
  const statusEl = document.querySelector('#agent-status');
  const statusText = document.querySelector('#status-text');
  const pickerGroup = document.querySelector('#picker-group');
  const modelPicker = document.querySelector('#model-picker');
  const modelBtn = document.querySelector('#model-btn');
  const modelLabel = document.querySelector('#model-label');
  const modelMenu = document.querySelector('#model-menu');
  const effortPicker = document.querySelector('#effort-picker');
  const effortBtn = document.querySelector('#effort-btn');
  const effortLabel = document.querySelector('#effort-label');
  const effortMenu = document.querySelector('#effort-menu');
  const modelMountHeader = document.querySelector('#model-mount-header');
  const modelMountComposer = document.querySelector('#model-mount-composer');

  // Each site keeps its pickers in a different spot: claude.ai inside the
  // composer (menus open upward), ChatGPT and Gemini up top.
  function mountModelPicker() {
    const inComposer = document.body.dataset.theme === 'claude' || !document.body.dataset.theme;
    (inComposer ? modelMountComposer : modelMountHeader).appendChild(pickerGroup);
    for (const menu of [modelMenu, effortMenu]) {
      menu.classList.toggle('up', inComposer);
      menu.classList.toggle('left', !inComposer);
    }
  }

  const STATUS_KEYS = {
    idle: 'statusIdle',
    thinking: 'statusThinking',
    working: 'statusWorking',
    approval: 'statusApproval',
  };

  /* ---------- Provider avatar (the model's icon next to its replies) ---------- */

  function providerAvatar() {
    const theme = document.body.dataset.theme || 'claude';
    const el = document.createElement('div');
    el.className = `msg-avatar avatar-${theme}`;
    // TOOL_LOGOS is defined in app.js; both scripts share the page scope.
    if (typeof TOOL_LOGOS !== 'undefined' && TOOL_LOGOS[theme]) {
      el.innerHTML = TOOL_LOGOS[theme];
    }
    return el;
  }

  /* ---------- Live streaming reply (types out like the browser) ----------
     Network deltas arrive in uneven chunks; showing them raw looks jerky.
     Instead they land in a queue and a steady typewriter drains it — the
     pace adapts to the backlog so it never falls behind the model. */

  let streamBody = null;  // the .msg-body currently receiving text
  let streamShown = '';   // characters already on screen
  let streamQueue = '';   // characters waiting to be typed
  let streamTimer = null;

  function typeTick() {
    if (!streamBody || streamQueue.length === 0) return;
    // At least ~2 chars per frame, faster the more is queued.
    const take = Math.max(2, Math.ceil(streamQueue.length / 12));
    streamShown += streamQueue.slice(0, take);
    streamQueue = streamQueue.slice(take);
    streamBody.textContent = streamShown;
    scrollToBottom();
  }

  function appendDelta(text) {
    clearIntro();
    finalizeThink(); // reply begins → fold the reasoning
    if (!streamBody) {
      hideThinking(); // the dots hand over to the typing cursor
      const el = document.createElement('div');
      el.className = 'msg msg-assistant streaming';
      el.appendChild(providerAvatar());
      streamBody = document.createElement('div');
      streamBody.className = 'msg-body stream-text';
      el.appendChild(streamBody);
      messagesEl.appendChild(el);
      scrollToBottom();
    }
    streamQueue += text;
    if (!streamTimer) streamTimer = setInterval(typeTick, 16); // ~60fps
  }

  // Swap the streamed text for the final rendered markdown.
  function finalizeStream(html) {
    if (!streamBody) return false;
    if (streamTimer) {
      clearInterval(streamTimer);
      streamTimer = null;
    }
    const container = streamBody.closest('.msg-assistant');
    if (html) {
      streamBody.innerHTML = html;
      localizeCopyButtons(streamBody);
      streamBody.classList.remove('stream-text');
    } else if (streamQueue) {
      // No final render (stopped mid-turn) — just flush what's left.
      streamBody.textContent = streamShown + streamQueue;
    }
    if (container) container.classList.remove('streaming');
    streamBody = null;
    streamShown = '';
    streamQueue = '';
    scrollToBottom();
    return true;
  }

  /* ---------- Live plan panel (the agent's TodoWrite list) ---------- */

  const planPanel = document.querySelector('#plan-panel');
  const planHead = document.querySelector('#plan-head');
  const planCount = document.querySelector('#plan-count');
  const planFill = document.querySelector('#plan-fill');
  const planList = document.querySelector('#plan-list');

  planHead.addEventListener('click', () => planPanel.classList.toggle('collapsed'));

  const PLAN_ICONS = { completed: '✓', in_progress: '●', pending: '○' };

  function renderPlan(todos) {
    if (!todos || todos.length === 0) {
      planPanel.classList.add('hidden');
      return;
    }
    const done = todos.filter((td) => td.status === 'completed').length;
    planCount.textContent = `${done}/${todos.length}`;
    planFill.style.width = `${Math.round((done / todos.length) * 100)}%`;

    planList.innerHTML = '';
    for (const td of todos) {
      const item = document.createElement('li');
      item.className = 'plan-item' +
        (td.status === 'completed' ? ' done' : td.status === 'in_progress' ? ' now' : '');

      const icon = document.createElement('span');
      icon.className = 'plan-ico';
      icon.textContent = PLAN_ICONS[td.status] || PLAN_ICONS.pending;

      const text = document.createElement('span');
      text.className = 'plan-text';
      // While a step runs, show its live form ("Building…" over "Build").
      text.textContent = (td.status === 'in_progress' && td.activeForm) || td.content;

      item.append(icon, text);
      planList.appendChild(item);
    }
    planPanel.classList.remove('hidden');
  }

  /* ---------- Streaming thought process (like claude.ai) ---------- */

  let thinkEl = null;    // the block currently receiving thinking text
  let thinkBody = null;
  let thinkText = '';

  function buildThinkBlock(text, done) {
    const el = document.createElement('div');
    el.className = 'msg-think' + (done ? ' collapsed' : ' streaming');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'think-head';
    head.textContent = done ? t('thinkingDoneTitle') : t('thinkingLiveTitle');
    head.addEventListener('click', () => el.classList.toggle('collapsed'));

    const body = document.createElement('div');
    body.className = 'think-body';
    body.textContent = text;

    el.append(head, body);
    return el;
  }

  function appendThinkDelta(text) {
    clearIntro();
    if (!thinkBody) {
      hideThinking(); // real reasoning replaces the placeholder dots
      thinkEl = buildThinkBlock('', false);
      thinkBody = thinkEl.querySelector('.think-body');
      messagesEl.appendChild(thinkEl);
    }
    thinkText += text;
    if (thinkText.length > 60000) thinkText = thinkText.slice(-60000);
    thinkBody.textContent = thinkText;
    thinkBody.scrollTop = thinkBody.scrollHeight;
    scrollToBottom();
  }

  // The thought ends when the reply (or a tool call) begins: collapse it.
  function finalizeThink() {
    if (!thinkEl) return;
    thinkEl.classList.remove('streaming');
    thinkEl.classList.add('collapsed');
    const head = thinkEl.querySelector('.think-head');
    if (head) head.textContent = t('thinkingDoneTitle');
    record({ t: 'think', text: thinkText });
    thinkEl = null;
    thinkBody = null;
    thinkText = '';
  }

  /* ---------- Thinking indicator (like the browser apps) ---------- */

  let thinkingEl = null;

  function showThinking() {
    if (streamBody || thinkBody) return; // real content is already flowing
    if (!thinkingEl || !thinkingEl.parentNode) {
      thinkingEl = document.createElement('div');
      thinkingEl.className = 'msg-thinking';
      thinkingEl.appendChild(providerAvatar());
      for (let i = 0; i < 3; i += 1) {
        const dot = document.createElement('span');
        dot.className = 'think-dot';
        thinkingEl.appendChild(dot);
      }
    }
    messagesEl.appendChild(thinkingEl); // appendChild also moves it to the end
    scrollToBottom();
  }

  function hideThinking() {
    if (thinkingEl && thinkingEl.parentNode) thinkingEl.remove();
  }

  // New content lands above the dots: keep them pinned to the bottom.
  function bumpThinking() {
    if (thinkingEl && thinkingEl.parentNode) messagesEl.appendChild(thinkingEl);
  }

  /* ---------- Status pill + send/stop toggle ---------- */

  // While the agent works, the send arrow becomes a stop square (claude.ai style).
  function setSendMode(stop) {
    sendBtn.classList.toggle('stop-mode', stop);
    sendBtn.innerHTML = stop ? '&#9632;' : '&#8593;';
    sendBtn.title = stop ? t('stop') : t('send');
  }

  let lastStatusState = 'idle'; // re-localized when the language flips

  function setStatus(state, label) {
    lastStatusState = state;
    statusEl.dataset.state = state;
    statusText.textContent = label || t(STATUS_KEYS[state] || 'statusIdle');
    const busy = state === 'thinking' || state === 'working';
    setSendMode(busy);
    if (busy) showThinking();
    else hideThinking();
  }

  /* ---------- Message feed helpers ---------- */

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function clearIntro() {
    const intro = messagesEl.querySelector('.chat-intro');
    if (intro) intro.remove();
  }

  // Each site greets you its own way: claude.ai with a time-of-day line
  // under its starburst, ChatGPT with its question, Gemini in gradient.
  function buildIntro() {
    clearIntro();
    const theme = document.body.dataset.theme || 'claude';
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? t('goodMorning') : t('goodEvening');

    const intro = document.createElement('div');
    intro.className = 'chat-intro';

    if (theme === 'claude') {
      const mark = document.createElement('div');
      mark.className = 'intro-mark';
      if (typeof TOOL_LOGOS !== 'undefined') mark.innerHTML = TOOL_LOGOS.claude;
      intro.appendChild(mark);
    }

    const title = document.createElement('h2');
    title.textContent =
      theme === 'codex' ? t('codexIntro') :
      theme === 'gemini' ? t('geminiIntro') :
      timeGreeting;
    intro.appendChild(title);

    const sub = document.createElement('p');
    sub.textContent = t('introSub');
    intro.appendChild(sub);

    messagesEl.prepend(intro);
  }

  // Live user bubbles waiting for their CLI uuid (best-effort file rewind).
  const pendingRewind = [];
  const pendingRewindEntries = []; // matching feed entries, same order

  // Every user message gets a ↩ button that goes back to just before it:
  // the conversation is trimmed to that point and the message returns to the
  // composer to edit and resend. File edits are reverted when the CLI has a
  // checkpoint for the turn (best-effort — it isn't always available).
  function attachRewind(bubble, entry) {
    const btn = document.createElement('button');
    btn.className = 'msg-rewind';
    btn.textContent = '↩';
    btn.title = t('rewindTitle');
    btn.addEventListener('click', () => {
      if (!window.confirm(t('confirmRewind'))) return;
      rewindTo(entry);
    });
    bubble.appendChild(btn);
  }

  function rewindTo(entry) {
    const idx = feed.indexOf(entry);
    if (idx === -1) return;
    const prefill = entry.text || '';

    // Best-effort file restore — silent when the CLI has no checkpoint.
    if (entry.uuid) window.vibeshell.agent.rewind(entry.uuid);

    // Trim the conversation to before this message and re-render cleanly.
    feed = feed.slice(0, idx);
    feedTools.clear();
    for (const e of feed) if (e.t === 'tool') feedTools.set(e.id, e);
    resetFeed();
    if (feed.length === 0) buildIntro();
    else replayFeed(feed);
    saveChat();

    inputEl.value = prefill;
    autoGrow();
    inputEl.focus();
    scrollToBottom();
  }

  function addUserBubble(text, previews = [], live = false, queued = false, entry = null) {
    clearIntro();
    const el = document.createElement('div');
    el.className = 'msg msg-user' + (queued ? ' queued' : '');
    if (queued) {
      const hint = document.createElement('div');
      hint.className = 'queued-hint';
      hint.textContent = t('queuedHint');
      el.appendChild(hint);
    }
    if (live) pendingRewind.push(el);
    // The rewind anchor is the feed entry itself (position-based), so it
    // never depends on the CLI's flaky user-message echo.
    if (entry) attachRewind(el, entry);
    if (previews.length > 0) {
      const strip = document.createElement('div');
      strip.className = 'msg-images';
      for (const src of previews) {
        const img = document.createElement('img');
        img.src = src;
        strip.appendChild(img);
      }
      el.appendChild(strip);
    }
    if (entry && Array.isArray(entry.docs) && entry.docs.length > 0) {
      const docs = document.createElement('div');
      docs.className = 'msg-docs';
      for (const d of entry.docs) {
        const name = typeof d === 'string' ? d : d.name;
        const icon = (d && d.kind === 'file') ? '📃' : '📄';
        const chip = document.createElement('div');
        chip.className = 'msg-doc';
        chip.textContent = `${icon} ${name}`;
        docs.appendChild(chip);
      }
      el.appendChild(docs);
    }
    if (text) {
      const body = document.createElement('div');
      body.textContent = text;
      el.appendChild(body);
    }
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  // Markdown arrives from main with English "Copy" buttons — localize them.
  function localizeCopyButtons(root) {
    root.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.textContent = t('copy');
    });
  }

  function addAssistantBubble(html) {
    clearIntro();
    const el = document.createElement('div');
    el.className = 'msg msg-assistant';
    el.appendChild(providerAvatar());
    const body = document.createElement('div');
    body.className = 'msg-body';
    // html is produced and sanitized in the main process (main/markdown.js)
    body.innerHTML = html;
    localizeCopyButtons(body);
    el.appendChild(body);
    messagesEl.appendChild(el);
    bumpThinking();
    scrollToBottom();
  }

  function addActivityLine(label) {
    clearIntro();
    const el = document.createElement('div');
    el.className = 'msg-activity';
    el.textContent = label;
    messagesEl.appendChild(el);
    bumpThinking();
    scrollToBottom();
  }

  function addErrorLine(message) {
    clearIntro();
    const el = document.createElement('div');
    el.className = 'msg-error';
    el.textContent = message;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  /* ---------- Rich tool cards (collapsible, like the browser apps) ---------- */

  const TOOL_GLYPHS = {
    Read: '📄', Write: '📝', Edit: '✏️', Bash: '⚡', PowerShell: '⚡',
    Glob: '🔎', Grep: '🔎', WebSearch: '🌐', WebFetch: '🌐',
    Task: '🧩', TodoWrite: '🗒️',
  };

  const toolCards = new Map(); // tool_use_id → { statusEl, outputEl, outLabelEl }

  function setToolState(refs, result) {
    if (!result) {
      refs.statusEl.textContent = '⋯';
      refs.statusEl.dataset.state = 'run';
      return;
    }
    refs.statusEl.textContent = result.ok === false ? '✕' : '✓';
    refs.statusEl.dataset.state = result.ok === false ? 'err' : 'ok';
    if (result.output && String(result.output).trim()) {
      refs.outputEl.textContent = result.output;
      refs.outputEl.classList.remove('hidden');
      refs.outLabelEl.classList.remove('hidden');
    }
  }

  // done=true renders a finished card straight away (used when restoring).
  function addToolCard(info, done) {
    clearIntro();
    const card = document.createElement('div');
    card.className = 'tool-card';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'tool-head';

    const icon = document.createElement('span');
    icon.className = 'tool-ico';
    icon.textContent = TOOL_GLYPHS[info.name] || '🔧';

    const label = document.createElement('span');
    label.className = 'tool-label';
    label.textContent = info.label;

    const status = document.createElement('span');
    status.className = 'tool-state';

    const chev = document.createElement('span');
    chev.className = 'tool-chev';
    chev.textContent = '▸';

    head.append(icon, label, status, chev);
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'tool-body hidden';

    for (const el of viewBlocks(info.view || {})) body.appendChild(el);

    const outLabel = document.createElement('div');
    outLabel.className = 'tool-out-label hidden';
    outLabel.textContent = t('result');
    const output = document.createElement('pre');
    output.className = 'tool-output hidden';
    body.append(outLabel, output);
    card.appendChild(body);

    head.addEventListener('click', () => {
      card.classList.toggle('open');
      body.classList.toggle('hidden');
    });

    messagesEl.appendChild(card);
    bumpThinking();
    scrollToBottom();

    const refs = { statusEl: status, outputEl: output, outLabelEl: outLabel };
    if (done) setToolState(refs, { ok: info.ok, output: info.output });
    else {
      setToolState(refs, null);
      toolCards.set(info.id, refs);
    }
  }

  function completeToolCard(id, result) {
    const refs = toolCards.get(id);
    if (!refs) return;
    toolCards.delete(id);
    setToolState(refs, result);
  }

  /* ---------- Conversation persistence ---------- */

  let lastProject = null;       // project of the live session (null = general)
  let currentSessionId = null;  // CLI session id, known after init
  let resumedFromId = null;     // id we asked to resume (may get replaced)
  let feed = [];                // serialized render events for saving
  const feedTools = new Map();  // tool id → its feed entry
  let saveTimer = null;
  let announcedChat = false;    // sidebar told about this chat yet?
  let aiTitle = null;           // model-generated name (beats the fallback)
  let titlePending = false;     // a naming request is in flight

  function chatTitle() {
    if (aiTitle) return aiTitle;
    const firstUser = feed.find((e) => e.t === 'user' && e.text);
    if (!firstUser) return t('newChatTitle');
    // Collapse newlines/whitespace so sidebar titles stay one clean line.
    return firstUser.text.replace(/\s+/g, ' ').trim().slice(0, 48);
  }

  function saveChat() {
    if (!currentSessionId || feed.length === 0) return;
    window.vibeshell.chats.save({
      id: currentSessionId,
      project: lastProject ? lastProject.path : null,
      title: chatTitle(),
      titled: !!aiTitle,
      feed,
    });
    if (!announcedChat) {
      announcedChat = true;
      document.dispatchEvent(
        new CustomEvent('vibeshell:chats-changed', { detail: { id: currentSessionId } })
      );
    }
  }

  // After the first exchange, ask Haiku to name the chat — once, quietly.
  async function maybeTitleChat() {
    if (aiTitle || titlePending) return;
    const firstUser = feed.find((e) => e.t === 'user' && e.text);
    const firstAi = feed.find((e) => e.t === 'ai' && e.html);
    if (!firstUser || !firstAi) return;

    titlePending = true;
    const sessionAtRequest = currentSessionId;
    const scratch = document.createElement('div');
    scratch.innerHTML = firstAi.html;
    const res = await window.vibeshell.chats.makeTitle({
      user: firstUser.text,
      assistant: scratch.textContent || '',
    });
    titlePending = false;

    // The user may have switched chats while Haiku thought — drop the result.
    if (currentSessionId !== sessionAtRequest) return;
    if (res && res.ok && res.title) {
      aiTitle = res.title;
      saveChat();
      document.dispatchEvent(
        new CustomEvent('vibeshell:chats-changed', { detail: { id: currentSessionId } })
      );
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveChat, 800);
  }

  function record(entry) {
    feed.push(entry);
    scheduleSave();
  }

  function replayFeed(entries) {
    for (const e of entries) {
      if (e.t === 'user') addUserBubble(e.text || '', [], false, false, e);
      else if (e.t === 'ai') addAssistantBubble(e.html);
      else if (e.t === 'act') addActivityLine(e.label);
      else if (e.t === 'err') addErrorLine(e.message);
      else if (e.t === 'think') messagesEl.appendChild(buildThinkBlock(e.text || '', true));
      else if (e.t === 'plan') renderPlan(e.todos);
      else if (e.t === 'tool') {
        addToolCard(
          { id: e.id, name: e.name, label: e.label, view: e.view, ok: e.ok, output: e.output },
          true
        );
      }
    }
  }

  /* ---------- Line diff (GitHub-style, computed locally) ---------- */

  // Classic LCS over lines. Returns [{t:' '|'-'|'+', text}] or null when the
  // inputs are too large to diff comfortably (caller falls back to blocks).
  function diffLines(oldText, newText) {
    const a = String(oldText).split('\n');
    const b = String(newText).split('\n');
    const n = a.length;
    const m = b.length;
    if (n * m > 1_000_000) return null;

    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i][j] = a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    const ops = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ t: ' ', text: a[i] }); i += 1; j += 1; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', text: a[i] }); i += 1; }
      else { ops.push({ t: '+', text: b[j] }); j += 1; }
    }
    while (i < n) { ops.push({ t: '-', text: a[i] }); i += 1; }
    while (j < m) { ops.push({ t: '+', text: b[j] }); j += 1; }
    return ops;
  }

  // Colored line-by-line view: −red, +green, long unchanged runs collapsed.
  function diffView(oldText, newText) {
    const ops = oldText === ''
      ? String(newText).split('\n').map((text) => ({ t: '+', text }))
      : diffLines(oldText, newText);
    if (!ops) return null;

    // Keep 3 context lines around each change; fold the rest.
    const rows = [];
    let run = [];
    const flushRun = (atEdge) => {
      if (run.length > 7) {
        if (!atEdge.start) rows.push(...run.slice(0, 3));
        rows.push({ t: '…', count: run.length - (atEdge.start ? 3 : atEdge.end ? 3 : 6) });
        if (!atEdge.end) rows.push(...run.slice(-3));
      } else {
        rows.push(...run);
      }
      run = [];
    };
    let seenChange = false;
    for (const op of ops) {
      if (op.t === ' ') { run.push(op); continue; }
      flushRun({ start: !seenChange, end: false });
      seenChange = true;
      rows.push(op);
    }
    flushRun({ start: !seenChange, end: true });

    const wrap = document.createElement('div');
    wrap.className = 'diff-view';
    for (const row of rows) {
      const line = document.createElement('div');
      if (row.t === '…') {
        line.className = 'diff-line diff-skip';
        line.dir = 'auto';
        line.textContent = t('unchangedLines', { n: row.count });
      } else {
        line.className = 'diff-line ' +
          (row.t === '+' ? 'diff-line-add' : row.t === '-' ? 'diff-line-del' : 'diff-line-ctx');
        const gutter = document.createElement('span');
        gutter.className = 'diff-gutter';
        gutter.textContent = row.t === ' ' ? '' : row.t;
        const text = document.createElement('span');
        text.className = 'diff-text';
        text.textContent = row.text || ' ';
        line.append(gutter, text);
      }
      wrap.appendChild(line);
    }
    return wrap;
  }

  /* ---------- Approval cards ---------- */

  function diffBlock(cls, text) {
    const pre = document.createElement('pre');
    pre.className = `diff ${cls}`;
    pre.textContent = text;
    return pre;
  }

  // One renderer for what a tool wants to do — shared by the approval card
  // and the collapsible tool card so both show the same colored diff.
  function viewBlocks(view) {
    const els = [];
    if (view.kind === 'bash') {
      if (view.note) {
        const note = document.createElement('p');
        note.className = 'approval-note';
        note.textContent = view.note;
        els.push(note);
      }
      els.push(diffBlock('diff-cmd', view.command || ''));
    } else if (view.kind === 'write') {
      els.push(diffView('', view.content || '') || diffBlock('diff-add', view.content || ''));
    } else if (view.kind === 'edit') {
      const dv = diffView(view.oldText || '', view.newText || '');
      if (dv) els.push(dv);
      else {
        els.push(diffBlock('diff-del', view.oldText || ''));
        els.push(diffBlock('diff-add', view.newText || ''));
      }
    } else if (view.kind === 'plan') {
      // The plan arrives pre-rendered (and sanitized) from main/markdown.js.
      const plan = document.createElement('div');
      plan.className = 'plan-review';
      plan.innerHTML = view.html || '';
      els.push(plan);
    } else if (view.detail) {
      els.push(diffBlock('diff-cmd', view.detail));
    }
    return els;
  }

  function cardTitle(toolName, view) {
    switch (view.kind) {
      case 'write': return t('wantsCreate', { f: view.file || t('aFile') });
      case 'edit': return t('wantsEdit', { f: view.file || t('aFile') });
      case 'bash': return t('wantsRun');
      case 'plan': return t('wantsPlan');
      default: return t('wantsUse', { name: toolName });
    }
  }

  function addApprovalCard({ id, toolName, view }) {
    clearIntro();
    const card = document.createElement('div');
    card.className = 'approval-card';
    card.dataset.permissionId = id;
    card.dataset.toolName = toolName;

    const title = document.createElement('div');
    title.className = 'approval-title';
    title.textContent = cardTitle(toolName, view);
    card.appendChild(title);

    const body = document.createElement('div');
    body.className = 'approval-body';
    for (const el of viewBlocks(view)) body.appendChild(el);
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'approval-actions';
    const mk = (label, cls, decision) => {
      const btn = document.createElement('button');
      btn.className = cls;
      btn.textContent = label;
      btn.addEventListener('click', () => decide(card, id, decision, label));
      actions.appendChild(btn);
    };
    mk(t('approve'), 'primary-btn', { allow: true });
    mk(t('alwaysAllow'), 'ghost-btn', { allow: true, always: true });
    mk(t('deny'), 'ghost-btn btn-danger', { allow: false });
    card.appendChild(actions);

    messagesEl.appendChild(card);
    scrollToBottom();
  }

  function decide(card, id, decision, label) {
    window.vibeshell.agent.respondPermission(id, decision);
    card.classList.add(decision.allow ? 'approved' : 'denied');
    const actions = card.querySelector('.approval-actions');
    actions.innerHTML = '';
    const verdict = document.createElement('span');
    verdict.className = 'approval-verdict';
    verdict.textContent = decision.allow ? `✓ ${label}` : t('denied');
    actions.appendChild(verdict);

    // Approving a plan flows straight into building it, like the terminal:
    // plan mode hands over to auto-accept-edits.
    if (decision.allow && card.dataset.toolName === 'ExitPlanMode' && currentMode !== 'auto') {
      currentMode = 'acceptEdits';
      window.vibeshell.agent.setMode('acceptEdits');
      updateModeUI();
      addActivityLine(t('modeAccept'));
    }
  }

  /* ---------- Usage meter (plan quota, like /usage in the terminal) ---------- */

  const usagePill = document.querySelector('#usage-pill');
  const usageFill = document.querySelector('#usage-fill');
  const usageText = document.querySelector('#usage-text');

  // Plan limits are account-wide with absolute reset times, so the last
  // session's numbers stay valid — cache them and show them on entry,
  // long before the CLI can serve fresh ones.
  const USAGE_CACHE_KEY = 'vibeshell-usage';

  let usageData = null; // { fiveHour: {pct, resetsAt}, sevenDay: {...} }

  function windowExpired(w) {
    return !!(w && w.resetsAt && new Date(w.resetsAt).getTime() <= Date.now());
  }

  // Drop windows whose reset time has passed (their pct is stale).
  function sanitizeUsage(u) {
    if (!u) return null;
    return {
      ...u,
      session: null, // session stats belong to the previous session
      fiveHour: windowExpired(u.fiveHour) ? null : u.fiveHour,
      sevenDay: windowExpired(u.sevenDay) ? null : u.sevenDay,
      sevenDayOpus: windowExpired(u.sevenDayOpus) ? null : u.sevenDayOpus,
      sevenDaySonnet: windowExpired(u.sevenDaySonnet) ? null : u.sevenDaySonnet,
      modelScoped: (u.modelScoped || []).filter((m) => !windowExpired(m)),
    };
  }

  function loadCachedUsage() {
    try {
      const cached = sanitizeUsage(JSON.parse(localStorage.getItem(USAGE_CACHE_KEY)));
      if (cached && (cached.fiveHour || cached.sevenDay)) {
        usageData = cached;
        window.__vibeUsage = cached;
      }
    } catch { /* no cache yet */ }
  }

  // The server doesn't send every window on every refresh (the per-model
  // weeklies like Fable come and go). Merge: a window missing from the
  // fresh payload keeps its last known value until its reset time passes.
  function mergeUsage(fresh) {
    let prev = null;
    try {
      prev = sanitizeUsage(JSON.parse(localStorage.getItem(USAGE_CACHE_KEY)));
    } catch { /* nothing to merge */ }
    if (!prev) return fresh;

    const pick = (now, before) =>
      now && now.pct !== null && now.pct !== undefined ? now : (before || null);

    return {
      ...fresh,
      fiveHour: pick(fresh.fiveHour, prev.fiveHour),
      sevenDay: pick(fresh.sevenDay, prev.sevenDay),
      sevenDayOpus: pick(fresh.sevenDayOpus, prev.sevenDayOpus),
      sevenDaySonnet: pick(fresh.sevenDaySonnet, prev.sevenDaySonnet),
      modelScoped:
        fresh.modelScoped && fresh.modelScoped.length > 0
          ? fresh.modelScoped
          : prev.modelScoped || [],
    };
  }

  function timeLeft(iso) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return null;
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  function renderUsage() {
    const window5h = usageData && usageData.fiveHour;
    if (!window5h || window5h.pct === null || window5h.pct === undefined) {
      usagePill.classList.add('hidden');
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round(window5h.pct)));
    const left = timeLeft(window5h.resetsAt);

    usageFill.style.width = `${pct}%`;
    usageFill.dataset.level = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
    usageText.textContent = left ? `${pct}% · ${t('timeLeft', { t: left })}` : `${pct}%`;

    const weekly = usageData.sevenDay;
    usagePill.title =
      t('sessionShort', { p: pct }) +
      (left ? ` — ${t('resetsIn', { t: left })}` : '') +
      (weekly && weekly.pct !== null ? `\n${t('weeklyShort', { p: Math.round(weekly.pct) })}` : '');

    usagePill.classList.remove('hidden');
  }

  // Keep the countdown fresh even when no new turns happen.
  setInterval(renderUsage, 60000);

  // The pill is a shortcut to the full breakdown (defined in app.js).
  usagePill.addEventListener('click', () => {
    if (typeof window.openUsageModal === 'function') window.openUsageModal();
  });

  /* ---------- Working mode (ask / accept edits / plan / full auto) ---------- */

  const modeBtn = document.querySelector('#mode-btn');
  const modeLabel = document.querySelector('#mode-label');
  const modeMenu = document.querySelector('#mode-menu');

  // The same modes Shift+Tab cycles in the terminal, plus our full-auto.
  const MODES = [
    { id: 'default', label: 'modeDefault', short: 'modeDefaultShort' },
    { id: 'acceptEdits', label: 'modeAccept', short: 'modeAcceptShort' },
    { id: 'plan', label: 'modePlan', short: 'modePlanShort' },
    { id: 'auto', label: 'modeAuto', short: 'modeAutoShort' },
  ];

  let currentMode = 'default';

  function modeInfo(id) {
    return MODES.find((m) => m.id === id) || MODES[0];
  }

  function updateModeUI() {
    modeLabel.textContent = t(modeInfo(currentMode).short);
    modeBtn.classList.toggle('mode-hot', currentMode === 'auto');
    modeMenu.innerHTML = '';
    for (const mode of MODES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'model-item' + (mode.id === currentMode ? ' active' : '');
      const name = document.createElement('span');
      name.className = 'model-item-name';
      name.textContent = t(mode.label);
      item.appendChild(name);
      item.addEventListener('click', () => chooseMode(mode.id));
      modeMenu.appendChild(item);
    }
    // Review (and revoke) everything granted "always allow" this session.
    const perms = document.createElement('button');
    perms.type = 'button';
    perms.className = 'account-item perms-link';
    perms.textContent = t('permsManage');
    perms.addEventListener('click', () => {
      modeMenu.classList.add('hidden');
      openPermsModal();
    });
    modeMenu.appendChild(perms);
  }

  /* ---------- Granted-permissions modal ---------- */

  const permsModal = document.querySelector('#modal-perms');
  const permsList = document.querySelector('#perms-list');
  const permsEmpty = document.querySelector('#perms-empty');

  function renderPerms(names) {
    permsList.innerHTML = '';
    permsEmpty.classList.toggle('hidden', names.length > 0);
    for (const name of names) {
      const item = document.createElement('li');
      item.className = 'perms-item';

      const label = document.createElement('span');
      label.className = 'perms-name';
      label.textContent = name;

      const revoke = document.createElement('button');
      revoke.className = 'link-btn';
      revoke.textContent = t('revoke');
      revoke.addEventListener('click', async () => {
        renderPerms(await window.vibeshell.agent.revokePermission(name));
      });

      item.append(label, revoke);
      permsList.appendChild(item);
    }
  }

  async function openPermsModal() {
    renderPerms(await window.vibeshell.agent.permissions());
    permsModal.classList.remove('hidden');
  }

  document.querySelector('#perms-close').addEventListener('click', () => {
    permsModal.classList.add('hidden');
  });
  permsModal.addEventListener('click', (event) => {
    if (event.target === permsModal) permsModal.classList.add('hidden');
  });

  function chooseMode(id) {
    modeMenu.classList.add('hidden');
    if (id === currentMode) return;
    currentMode = id;
    if (id === 'auto') {
      // Our master switch: approve everything via canUseTool.
      window.vibeshell.agent.setAutoApprove(true);
    } else {
      window.vibeshell.agent.setAutoApprove(false);
      window.vibeshell.agent.setMode(id);
    }
    updateModeUI();
    addActivityLine(t(modeInfo(id).label));
  }

  modeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    updateModeUI();
    modeMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', (event) => {
    if (!modeMenu.contains(event.target) && event.target !== modeBtn) {
      modeMenu.classList.add('hidden');
    }
  });

  /* ---------- Model picker (one click instead of /model) ---------- */

  // The real list comes from the CLI and takes a few seconds on session
  // start, so we serve the last session's list instantly from cache.
  const MODELS_CACHE_KEY = 'vibeshell-models';

  let models = [];
  let currentModel = null;
  let currentEffort = 'high';
  let fastModeOn = false;

  function activeModelInfo() {
    return models.find(
      (m) => m.value === currentModel || m.resolvedModel === currentModel
    ) || null;
  }

  // The model button shows the name; the effort button is always visible
  // next to it. The CLI silently downgrades levels a model can't use.
  function updatePickers() {
    modelLabel.textContent = modelName(currentModel);
    effortPicker.classList.remove('hidden');
    effortLabel.textContent = currentEffort;
  }

  function modelName(value) {
    if (!value) return 'Default';
    // init reports the full wire id; menu rows may know it under an alias.
    const found = models.find((m) => m.value === value || m.resolvedModel === value);
    return found ? found.displayName : String(value);
  }

  function renderModelMenu() {
    modelMenu.innerHTML = '';
    if (models.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'model-empty';
      empty.textContent = t('loadingModels');
      modelMenu.appendChild(empty);
      return;
    }
    for (const m of models) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'model-item' + (m.value === currentModel ? ' active' : '');

      const name = document.createElement('span');
      name.className = 'model-item-name';
      name.textContent = m.displayName;
      item.appendChild(name);

      if (m.description) {
        const desc = document.createElement('span');
        desc.className = 'model-item-desc';
        desc.textContent = m.description;
        item.appendChild(desc);
      }

      item.addEventListener('click', () => chooseModel(m.value));
      modelMenu.appendChild(item);
    }
  }

  const EFFORT_HINT_KEYS = {
    low: 'effortLow',
    medium: 'effortMedium',
    high: 'effortHigh',
    xhigh: 'effortXhigh',
  };

  function renderEffortMenu() {
    effortMenu.innerHTML = '';
    const info = activeModelInfo();
    // Standard four as the fallback so the menu is never empty.
    const levels =
      info && info.effortLevels && info.effortLevels.length > 0
        ? info.effortLevels
        : ['low', 'medium', 'high', 'xhigh'];

    for (const level of levels) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'model-item' + (level === currentEffort ? ' active' : '');

      const name = document.createElement('span');
      name.className = 'model-item-name';
      name.textContent = level;
      item.appendChild(name);

      if (EFFORT_HINT_KEYS[level]) {
        const desc = document.createElement('span');
        desc.className = 'model-item-desc';
        desc.textContent = t(EFFORT_HINT_KEYS[level]);
        item.appendChild(desc);
      }

      item.addEventListener('click', () => chooseEffort(level));
      effortMenu.appendChild(item);
    }

    // Fast mode lives here too — it's a speed control, same family.
    if (info && info.supportsFastMode) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'fast-toggle' + (fastModeOn ? ' on' : '');
      row.innerHTML = `<span>${t('fastMode')}</span><span class="auto-knob"></span>`;
      row.addEventListener('click', () => {
        fastModeOn = !fastModeOn;
        window.vibeshell.agent.setFastMode(fastModeOn);
        renderEffortMenu();
      });
      effortMenu.appendChild(row);
    }
  }

  function chooseEffort(level) {
    effortMenu.classList.add('hidden');
    if (level === currentEffort) return;
    currentEffort = level;
    window.vibeshell.agent.setEffort(level);
    updatePickers();
    renderEffortMenu();
    addActivityLine(t('effortSet', { level }));
  }

  function chooseModel(value) {
    modelMenu.classList.add('hidden');
    inputEl.focus(); // keep the composer active so the picker doesn't vanish
    if (value === currentModel) return;
    currentModel = value;
    updatePickers();
    renderModelMenu();
    renderEffortMenu();
    addActivityLine(t('switchingTo', { model: modelName(value) }));
    window.vibeshell.agent.setModel(value);
  }

  modelBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    effortMenu.classList.add('hidden');
    modelMenu.classList.toggle('hidden');
  });

  effortBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    modelMenu.classList.add('hidden');
    effortMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', (event) => {
    if (!pickerGroup.contains(event.target)) {
      modelMenu.classList.add('hidden');
      effortMenu.classList.add('hidden');
    }
  });

  /* ---------- Copy buttons on code blocks ---------- */

  messagesEl.addEventListener('click', async (event) => {
    const btn = event.target.closest('.copy-btn');
    if (!btn) return;
    const code = btn.closest('.code-block')?.querySelector('code');
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      btn.textContent = t('copied');
      setTimeout(() => { btn.textContent = t('copy'); }, 1500);
    } catch { /* clipboard unavailable — ignore */ }
  });

  /* ---------- Image attachments ---------- */

  const attachBtn = document.querySelector('#btn-attach');
  const attachMenu = document.querySelector('#attach-menu');
  const attachStrip = document.querySelector('#attach-strip');
  const fileInput = document.querySelector('#file-input');
  const pdfInput = document.querySelector('#pdf-input');
  const codeInput = document.querySelector('#code-input');
  const dropHint = document.querySelector('#drop-hint');
  const screenEl = document.querySelector('#screen-project');

  const MAX_IMAGES = 8;
  const MAX_DOCS = 5;
  const MAX_FILES = 10;
  const MAX_PDF_BYTES = 25 * 1024 * 1024; // ~33MB once base64-encoded, under the API cap
  const MAX_TEXT_BYTES = 1024 * 1024;     // code/text files are small; 1MB is generous
  const MAX_EDGE = 1568;      // Anthropic's sweet spot; bigger is wasted tokens
  const KEEP_AS_IS = 2 * 1024 * 1024;

  // Source files the "code file" picker recognises (drag/drop uses this too).
  const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|kts|c|h|cpp|cc|hpp|hxx|cs|php|swift|dart|scala|clj|ex|exs|erl|hs|ml|sh|bash|zsh|fish|ps1|bat|pl|lua|r|jl|m|mm|sql|graphql|proto|html?|css|scss|sass|less|styl|vue|svelte|astro|json|jsonc|ya?ml|toml|ini|cfg|conf|env|xml|md|markdown|mdx|txt|text|csv|tsv|gradle|properties|dockerfile|makefile|mk|cmake|gitignore|gitattributes|editorconfig|npmrc|log|tex|rst|adoc|ipynb)$/i;

  // Images: { kind:'image', mediaType, data(base64), previewUrl }
  // PDFs:   { kind:'pdf',   mediaType:'application/pdf', data(base64), name }
  // Code:   { kind:'file',  name, text }
  let attachments = [];
  const imageCount = () => attachments.filter((a) => a.kind === 'image').length;
  const docCount = () => attachments.filter((a) => a.kind === 'pdf').length;
  const fileCount = () => attachments.filter((a) => a.kind === 'file').length;

  function isPdfFile(file) {
    return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
  }

  // A file we can safely read as text (so drag/drop doesn't mangle a binary).
  function isTextFile(file) {
    if (!file) return false;
    const type = file.type || '';
    return type.startsWith('text/') ||
      type === 'application/json' ||
      type === 'application/xml' ||
      CODE_EXT.test(file.name || '') ||
      (type === '' && !/\.(png|jpe?g|gif|webp|bmp|ico|svg|pdf|zip|gz|tar|rar|7z|exe|dll|so|dylib|bin|mp[34]|mov|avi|mkv|wav|ogg|ttf|otf|woff2?|doc|xls|ppt)x?$/i.test(file.name || ''));
  }

  // PDFs ride along as base64 "document" blocks — Claude reads them natively.
  async function preparePdf(file) {
    if (!isPdfFile(file)) return null;
    if (file.size > MAX_PDF_BYTES) {
      addErrorLine(t('pdfTooLarge', { n: Math.round(MAX_PDF_BYTES / 1024 / 1024) }));
      return null;
    }
    try {
      const dataUrl = await readAsDataURL(file);
      return {
        kind: 'pdf',
        mediaType: 'application/pdf',
        data: String(dataUrl).split(',')[1],
        name: file.name || 'document.pdf',
      };
    } catch {
      return null;
    }
  }

  // Code/text files ride along as plain-text blocks — the surest way for the
  // agent to read source of any language, whatever the extension.
  async function prepareTextFile(file) {
    if (!file) return null;
    if (file.size > MAX_TEXT_BYTES) {
      addErrorLine(t('fileTooLarge', { n: Math.round(MAX_TEXT_BYTES / 1024 / 1024) }));
      return null;
    }
    try {
      const text = await file.text();
      return { kind: 'file', name: file.name || 'file.txt', text };
    } catch {
      return null;
    }
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Small originals pass through untouched; big ones are scaled down and
  // re-encoded as JPEG so uploads stay fast and under the API limits.
  async function prepareImage(file) {
    if (!file || !file.type.startsWith('image/')) return null;
    try {
      const dataUrl = await readAsDataURL(file);
      const img = await loadImage(dataUrl);
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const keep = scale === 1 &&
        file.size <= KEEP_AS_IS &&
        /^image\/(png|jpeg|webp|gif)$/.test(file.type);
      if (keep) {
        return { kind: 'image', mediaType: file.type, data: dataUrl.split(',')[1], previewUrl: dataUrl };
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL('image/jpeg', 0.85);
      return { kind: 'image', mediaType: 'image/jpeg', data: out.split(',')[1], previewUrl: out };
    } catch {
      return null;
    }
  }

  function renderAttachments() {
    attachStrip.innerHTML = '';
    attachStrip.classList.toggle('hidden', attachments.length === 0);
    attachments.forEach((att, index) => {
      const chip = document.createElement('div');
      chip.className = 'attach-chip';

      if (att.kind !== 'image') {
        chip.classList.add('file');
        const icon = document.createElement('span');
        icon.className = 'file-icon';
        icon.textContent = att.kind === 'pdf' ? '📄' : '📃';
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = att.name;
        chip.appendChild(icon);
        chip.appendChild(name);
      } else {
        const img = document.createElement('img');
        img.src = att.previewUrl;
        chip.appendChild(img);
      }

      const remove = document.createElement('button');
      remove.className = 'attach-remove';
      remove.textContent = '×';
      remove.title = t(att.kind === 'image' ? 'removeImage' : 'removeFile');
      remove.addEventListener('click', () => {
        attachments.splice(index, 1);
        renderAttachments();
      });
      chip.appendChild(remove);

      attachStrip.appendChild(chip);
    });
  }

  // forceText: the "code file" picker treats whatever you chose as text, even
  // an odd extension. Drag/drop & paste stay conservative (isTextFile guard).
  async function addFiles(fileList, forceText = false) {
    const all = Array.from(fileList || []);
    const images = all.filter((f) => f.type.startsWith('image/'));
    const pdfs = all.filter((f) => isPdfFile(f) && !f.type.startsWith('image/'));
    const codeFiles = all.filter(
      (f) => !f.type.startsWith('image/') && !isPdfFile(f) && (forceText || isTextFile(f))
    );
    if (images.length === 0 && pdfs.length === 0 && codeFiles.length === 0) return;

    for (const file of images) {
      if (imageCount() >= MAX_IMAGES) {
        addErrorLine(t('maxImages', { n: MAX_IMAGES }));
        break;
      }
      const prepared = await prepareImage(file);
      if (prepared) attachments.push(prepared);
    }
    for (const file of pdfs) {
      if (docCount() >= MAX_DOCS) {
        addErrorLine(t('maxDocs', { n: MAX_DOCS }));
        break;
      }
      const prepared = await preparePdf(file);
      if (prepared) attachments.push(prepared);
    }
    for (const file of codeFiles) {
      if (fileCount() >= MAX_FILES) {
        addErrorLine(t('maxFiles', { n: MAX_FILES }));
        break;
      }
      const prepared = await prepareTextFile(file);
      if (prepared) attachments.push(prepared);
    }
    renderAttachments();
    inputEl.focus();
  }

  // "+" opens a menu; each option opens the matching native file picker.
  function closeAttachMenu() {
    attachMenu.classList.add('hidden');
    attachBtn.setAttribute('aria-expanded', 'false');
  }
  attachBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const nowHidden = attachMenu.classList.toggle('hidden');
    attachBtn.setAttribute('aria-expanded', String(!nowHidden));
  });
  document.querySelector('#attach-pick-image').addEventListener('click', () => {
    closeAttachMenu();
    fileInput.click();
  });
  document.querySelector('#attach-pick-pdf').addEventListener('click', () => {
    closeAttachMenu();
    pdfInput.click();
  });
  document.querySelector('#attach-pick-code').addEventListener('click', () => {
    closeAttachMenu();
    codeInput.click();
  });
  document.addEventListener('click', (event) => {
    if (!attachMenu.classList.contains('hidden') && !event.target.closest('.attach-wrap')) {
      closeAttachMenu();
    }
  });
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  pdfInput.addEventListener('change', () => {
    addFiles(pdfInput.files);
    pdfInput.value = '';
  });
  codeInput.addEventListener('change', () => {
    addFiles(codeInput.files, true); // whatever the user picked, read it as text
    codeInput.value = '';
  });

  // Paste a screenshot straight into the box.
  inputEl.addEventListener('paste', (event) => {
    const files = event.clipboardData && event.clipboardData.files;
    if (files && files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  });

  // Drag & drop anywhere on the chat screen.
  let dragDepth = 0;
  screenEl.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    dropHint.classList.remove('hidden');
  });
  screenEl.addEventListener('dragover', (event) => event.preventDefault());
  screenEl.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropHint.classList.add('hidden');
  });
  screenEl.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropHint.classList.add('hidden');
    if (event.dataTransfer) addFiles(event.dataTransfer.files);
  });

  /* ---------- "!" — run a command yourself (terminal bash mode) ---------- */

  let pendingShell = []; // command outputs waiting to ride with the next message

  async function runShell(cmd) {
    if (!cmd) return;
    const id = `shell-${Date.now()}`;
    const label = `$ ${cmd}`;
    addToolCard({ id, name: 'PowerShell', label, view: { kind: 'bash', command: cmd } }, false);
    const res = await window.vibeshell.tools.runShell(
      lastProject ? lastProject.path : null,
      cmd
    );
    completeToolCard(id, { ok: res.ok, output: res.output || t('noOutput') });
    record({
      t: 'tool', id, name: 'PowerShell', label,
      view: { kind: 'bash', command: cmd }, ok: res.ok, output: res.output || '',
    });
    pendingShell.push({ cmd, output: res.output || '' });
  }

  /* ---------- Composer ---------- */

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text && attachments.length === 0) return;

    // "!command" runs right here, in the project folder — like bash mode
    // in the terminal. The output joins the next real message as context.
    if (text.startsWith('!') && text.length > 1 && attachments.length === 0) {
      inputEl.value = '';
      autoGrow();
      hidePalette();
      runShell(text.slice(1).trim());
      return;
    }

    // "#note" saves to project memory (CLAUDE.md) instead of chatting.
    if (text.startsWith('#') && text.length > 1 && attachments.length === 0) {
      const note = text.slice(1).trim();
      inputEl.value = '';
      autoGrow();
      hidePalette();
      window.vibeshell.projects.addMemory(
        lastProject ? lastProject.path : null,
        note
      ).then((res) => {
        const label = res && res.ok ? t('memorySaved') : t('memoryFailed');
        addActivityLine(label);
        record({ t: 'act', label });
      });
      return;
    }

    const busy = sendBtn.classList.contains('stop-mode');
    const images = attachments
      .filter((a) => a.kind === 'image')
      .map(({ mediaType, data }) => ({ mediaType, data }));
    const documents = attachments
      .filter((a) => a.kind === 'pdf')
      .map(({ mediaType, data, name }) => ({ mediaType, data, name }));
    const files = attachments
      .filter((a) => a.kind === 'file')
      .map(({ name, text: content }) => ({ name, text: content }));
    const previews = attachments.filter((a) => a.kind === 'image').map((a) => a.previewUrl);
    const docNames = [
      ...documents.map((d) => ({ name: d.name, kind: 'pdf' })),
      ...files.map((f) => ({ name: f.name, kind: 'file' })),
    ];
    attachments = [];
    renderAttachments();
    inputEl.value = '';
    autoGrow();
    hidePalette();
    // While the agent works, the message queues (like typing in the CLI):
    // the bubble shows a hint until the CLI actually picks it up.
    const userEntry = { t: 'user', text, images: images.length, docs: docNames };
    addUserBubble(text, previews, true, busy, userEntry);
    record(userEntry);
    pendingRewindEntries.push(userEntry); // its uuid arrives on echo (files)
    if (!busy) setStatus('thinking');
    // Outputs of manual "!" commands ride along invisibly, exactly like
    // bash-mode context in the terminal — the bubble shows only the text.
    let outgoing = text;
    if (pendingShell.length > 0) {
      const ctx = pendingShell
        .map((s) => `$ ${s.cmd}\n${s.output || '(no output)'}`)
        .join('\n\n');
      outgoing =
        `[Context — commands I ran myself in the project folder:]\n${ctx}\n\n${text}`;
      pendingShell = [];
    }
    window.vibeshell.agent.send({ text: outgoing, images, documents, files });
  }

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 160)}px`;
  }

  // The button is Stop while busy; Enter always sends (queues when busy).
  sendBtn.addEventListener('click', () => {
    if (sendBtn.classList.contains('stop-mode')) {
      window.vibeshell.agent.interrupt();
      return;
    }
    sendMessage();
  });
  inputEl.addEventListener('input', autoGrow);
  inputEl.addEventListener('keydown', (event) => {
    if (paletteKeydown(event)) return; // the "/" and "@" palettes eat their keys
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  /* ---------- "/" command palette (full CLI parity) ----------
     Every slash command the CLI reports — built-ins, project skills,
     future additions — appears here with its description. Selecting one
     inserts it; sending passes it straight through to the CLI. */

  const paletteEl = document.querySelector('#cmd-palette');
  const CMDS_CACHE_KEY = 'vibeshell-commands';

  let slashCommands = [];
  let projectFiles = [];   // relative paths for "@" mentions
  let paletteItems = [];   // currently rendered matches
  let paletteIndex = 0;
  let paletteToken = null; // { type: 'cmd'|'file', text, start }

  try {
    slashCommands = JSON.parse(localStorage.getItem(CMDS_CACHE_KEY)) || [];
  } catch { slashCommands = []; }

  // What is being typed at the caret: a leading "/command" or an "@file"
  // token anywhere in the message.
  function paletteQuery() {
    const pos = inputEl.selectionStart ?? inputEl.value.length;
    const before = inputEl.value.slice(0, pos);
    const mention = before.match(/(^|\s)(@[^\s]*)$/);
    if (mention && projectFiles.length > 0) {
      return { type: 'file', text: mention[2], start: pos - mention[2].length };
    }
    if (inputEl.value.startsWith('/') && !/\s/.test(inputEl.value)) {
      return { type: 'cmd', text: inputEl.value, start: 0 };
    }
    return null;
  }

  function hidePalette() {
    paletteEl.classList.add('hidden');
    paletteItems = [];
    paletteIndex = 0;
    paletteToken = null;
  }

  function pickItem(item) {
    if (paletteToken && paletteToken.type === 'file') {
      const value = inputEl.value;
      const end = paletteToken.start + paletteToken.text.length;
      inputEl.value = `${value.slice(0, paletteToken.start)}@${item.path} ${value.slice(end)}`;
    } else {
      inputEl.value = `/${item.name} `;
    }
    hidePalette();
    inputEl.focus();
    autoGrow();
  }

  function paletteRow(index, title, subtitle) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cmd-item' + (index === paletteIndex ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'cmd-name';
    name.textContent = title;
    row.appendChild(name);
    if (subtitle) {
      const desc = document.createElement('span');
      desc.className = 'cmd-desc';
      desc.textContent = subtitle;
      row.appendChild(desc);
    }
    return row;
  }

  function renderPalette() {
    paletteToken = paletteQuery();
    if (!paletteToken) { hidePalette(); return; }

    if (paletteToken.type === 'cmd') {
      const query = paletteToken.text.slice(1).toLowerCase();
      paletteItems = slashCommands
        .filter((c) =>
          c.name.toLowerCase().startsWith(query) ||
          (c.aliases || []).some((a) => a.toLowerCase().startsWith(query)))
        .slice(0, 8);
    } else {
      const query = paletteToken.text.slice(1).toLowerCase();
      paletteItems = projectFiles
        .filter((p) => p.toLowerCase().includes(query))
        .slice(0, 8)
        .map((p) => ({ path: p }));
    }
    if (slashCommands.length === 0 && paletteToken.type === 'cmd') { hidePalette(); return; }
    paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));

    paletteEl.innerHTML = '';
    if (paletteItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmd-empty';
      empty.textContent = t(paletteToken.type === 'file' ? 'noFiles' : 'noCommands');
      paletteEl.appendChild(empty);
    } else {
      paletteItems.forEach((item, index) => {
        const row = paletteToken.type === 'file'
          ? paletteRow(index, `@${item.path}`, null)
          : paletteRow(
              index,
              `/${item.name}` + (item.argumentHint ? ` ${item.argumentHint}` : ''),
              item.description
            );
        row.addEventListener('click', () => pickItem(item));
        paletteEl.appendChild(row);
      });
    }
    paletteEl.classList.remove('hidden');
  }

  // Returns true when the palette consumed the key.
  function paletteKeydown(event) {
    if (paletteEl.classList.contains('hidden')) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      paletteIndex = (paletteIndex + delta + paletteItems.length) % Math.max(1, paletteItems.length);
      renderPalette();
      return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && paletteItems.length > 0) {
      event.preventDefault();
      pickItem(paletteItems[paletteIndex]);
      return true;
    }
    if (event.key === 'Escape') {
      hidePalette();
      return true;
    }
    return false;
  }

  inputEl.addEventListener('input', renderPalette);
  inputEl.addEventListener('blur', () => setTimeout(hidePalette, 150));

  /* ---------- Agent events ---------- */

  // Main sends i18n keys; the label is composed here in the UI language.
  function composeActLabel(event) {
    if (event.labelKey) return t(event.labelKey, { f: event.labelArg, name: event.labelArg });
    return event.labelArg || event.label || '';
  }

  function errorText(event) {
    switch (event.code) {
      case 'node-missing': return t('errNodeMissing');
      case 'not-signed-in': return t('errNotSignedIn');
      case 'network': return t('errNetwork');
      case 'sign-in': return t('errSignIn', { raw: event.raw });
      case 'generic': return t('errAgent', { raw: event.raw });
      default: return event.message || t('genericError');
    }
  }

  window.vibeshell.agent.onEvent((event) => {
    switch (event.type) {
      case 'ready': {
        // The CLI may issue a fresh id when resuming — move the record over.
        const newId = event.sessionId || null;
        if (newId && resumedFromId && newId !== resumedFromId) {
          window.vibeshell.chats.delete(resumedFromId);
        }
        if (newId) currentSessionId = newId;
        resumedFromId = null;
        scheduleSave();
        break;
      }
      case 'status':
        setStatus(event.state, event.label);
        break;
      case 'assistant-delta':
        appendDelta(event.text);
        break;
      case 'thinking-delta':
        appendThinkDelta(event.text);
        break;
      case 'plan':
        renderPlan(event.todos);
        // Only the latest snapshot matters — replace, don't accumulate.
        feed = feed.filter((e) => e.t !== 'plan');
        feed.push({ t: 'plan', todos: event.todos });
        scheduleSave();
        break;
      case 'assistant-text':
        finalizeThink();
        // Replace the live-typed text with the rendered markdown; if there
        // was no stream (e.g. very short reply), fall back to a new bubble.
        if (!finalizeStream(event.html)) addAssistantBubble(event.html);
        record({ t: 'ai', html: event.html, uuid: event.uuid || null });
        break;
      case 'tool-start': {
        finalizeThink(); // the thought led to an action — fold it
        const label = composeActLabel(event);
        const entry = {
          t: 'tool',
          id: event.id,
          name: event.name,
          label,
          view: event.view,
          ok: null,
          output: null,
        };
        feedTools.set(event.id, entry);
        record(entry);
        addToolCard({ ...event, label }, false);
        setStatus('working', label);
        break;
      }
      case 'tool-result': {
        completeToolCard(event.id, event);
        const entry = feedTools.get(event.id);
        if (entry) {
          entry.ok = event.ok;
          entry.output = event.output;
          scheduleSave();
        }
        break;
      }
      case 'activity': {
        const label = event.key ? t(event.key) : event.label;
        addActivityLine(label);
        record({ t: 'act', label });
        break;
      }
      case 'permission-request':
        addApprovalCard(event);
        break;
      case 'permission-resolved': {
        // Resolved from outside a click (e.g. Stop denied it) — settle the card.
        const card = messagesEl.querySelector(
          `.approval-card[data-permission-id="${event.id}"]`
        );
        if (card && !card.classList.contains('approved') && !card.classList.contains('denied')) {
          card.classList.add(event.allowed ? 'approved' : 'denied');
          const actions = card.querySelector('.approval-actions');
          actions.innerHTML = '';
          const verdict = document.createElement('span');
          verdict.className = 'approval-verdict';
          verdict.textContent = event.allowed ? t('approved') : t('stoppedVerdict');
          actions.appendChild(verdict);
        }
        break;
      }
      case 'models':
        models = event.models || [];
        currentModel = event.current || currentModel;
        if (event.effort) currentEffort = event.effort;
        if (typeof event.fastMode === 'boolean') fastModeOn = event.fastMode;
        updatePickers();
        renderModelMenu();
        renderEffortMenu();
        try {
          localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(models));
        } catch { /* cache is a nicety, never a requirement */ }
        break;
      case 'usage': {
        const merged = mergeUsage(event);
        usageData = merged;
        window.__vibeUsage = merged; // app.js reads this for the account menu
        renderUsage();
        try {
          localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(merged));
        } catch { /* cache is best-effort */ }
        break;
      }
      case 'effort-changed':
        currentEffort = event.effort;
        updatePickers();
        renderEffortMenu();
        break;
      case 'fastmode-changed':
        fastModeOn = event.fastMode;
        renderEffortMenu();
        break;
      case 'model-changed': {
        const found = models.find(
          (m) => m.value === event.model || m.resolvedModel === event.model
        );
        currentModel = found ? found.value : event.model;
        updatePickers();
        renderModelMenu();
        renderEffortMenu();
        break;
      }
      case 'commands':
        slashCommands = event.commands || [];
        try {
          localStorage.setItem(CMDS_CACHE_KEY, JSON.stringify(slashCommands));
        } catch { /* cache is a nicety */ }
        break;
      case 'command-output':
        // Local slash-command output (/context, /todos…) as monospace text.
        finalizeStream(null);
        addToolCard({
          id: `cmd-${Date.now()}`,
          name: 'Command',
          label: '/',
          view: { kind: 'other', detail: event.text },
          ok: true,
          output: null,
        }, true);
        break;
      case 'mode-changed':
        if (event.mode && event.mode !== currentMode && currentMode !== 'auto') {
          currentMode = event.mode;
          updateModeUI();
        }
        break;
      case 'cli-status':
        if (event.status === 'compacting') {
          setStatus('working', t('compacting'));
        } else if (event.compactResult === 'success') {
          addActivityLine(t('compactDone'));
        } else if (event.compactResult === 'failed') {
          addErrorLine(t('compactFailed'));
        }
        if (event.permissionMode && currentMode !== 'auto' &&
            event.permissionMode !== currentMode &&
            MODES.some((m) => m.id === event.permissionMode)) {
          currentMode = event.permissionMode;
          updateModeUI();
        }
        break;
      case 'user-uuid': {
        // The CLI picked the message up — clear the "queued" hint (it's
        // being processed now). The rewind button is already attached.
        const bubble = pendingRewind.shift();
        if (bubble && bubble.isConnected) {
          bubble.classList.remove('queued');
          const hint = bubble.querySelector('.queued-hint');
          if (hint) hint.remove();
        }
        // Stash the uuid on the feed entry for best-effort file rewind.
        // (The CLI only echoes some messages, so this may not arrive.)
        const entry = pendingRewindEntries.shift();
        if (entry && event.uuid) {
          entry.uuid = event.uuid;
          scheduleSave();
        }
        break;
      }
      case 'rewind-done':
        // Only worth announcing when files actually moved. "No checkpoint"
        // is expected (the conversation still rewound) — stay quiet.
        if (event.ok && event.files > 0) addActivityLine(t('rewindDone', { n: event.files }));
        break;
      case 'reconnecting': {
        // Network dropped — the session is auto-resuming, not dead.
        const label = t('reconnecting', { n: event.attempt, m: event.max });
        setStatus('working', label);
        addActivityLine(label);
        break;
      }
      case 'reconnected':
        addActivityLine(t('reconnectedMsg'));
        break;
      case 'turn-done':
        finalizeThink();
        finalizeStream(null); // an interrupted stream keeps its text as-is
        setStatus('idle');
        inputEl.focus();
        maybeTitleChat(); // first full exchange → AI names the chat
        break;
      case 'error': {
        finalizeThink();
        finalizeStream(null);
        const message = errorText(event);
        addErrorLine(message);
        record({ t: 'err', message });
        setStatus('idle');
        break;
      }
      default:
        break; // ready / permission-resolved / closed need no UI change here
    }
  });

  /* ---------- Public API used by app.js ---------- */

  function setComposerEnabled(on) {
    inputEl.disabled = !on;
    sendBtn.disabled = !on;
    attachBtn.disabled = !on;
    document.querySelector('.composer').classList.toggle('disabled', !on);
  }

  function resetFeed() {
    messagesEl.querySelectorAll('.msg, .msg-activity, .msg-error, .approval-card, .tool-card, .msg-think')
      .forEach((el) => el.remove());
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
    streamBody = null;
    streamShown = '';
    streamQueue = '';
    thinkEl = null;
    thinkBody = null;
    thinkText = '';
    renderPlan(null);
    planPanel.classList.remove('collapsed');
    hideThinking();
    setStatus('idle');
  }

  // One path for fresh chats, resumed ones, and rewinds (resumeAt).
  function beginSession(project, resumeRecord, resumeAt) {
    lastProject = project || null;
    resetFeed();
    toolCards.clear();
    feedTools.clear();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }

    feed = resumeRecord ? (resumeRecord.feed || []).slice() : [];
    currentSessionId = resumeRecord ? resumeRecord.id : null;
    resumedFromId = resumeRecord ? resumeRecord.id : null;
    announcedChat = !!resumeRecord;
    aiTitle = resumeRecord && resumeRecord.titled ? resumeRecord.title : null;
    titlePending = false;
    for (const e of feed) if (e.t === 'tool') feedTools.set(e.id, e);

    if (resumeRecord) {
      clearIntro();
      replayFeed(feed);
    } else {
      buildIntro();
    }

    setComposerEnabled(true);
    inputEl.value = '';
    // Show the picker immediately with the cached list; the live list
    // replaces it quietly once the CLI reports in.
    models = [];
    try {
      models = JSON.parse(localStorage.getItem(MODELS_CACHE_KEY)) || [];
    } catch { models = []; }
    currentModel = null;
    currentEffort = 'high';
    fastModeOn = false;
    mountModelPicker();
    updatePickers();
    renderModelMenu();
    renderEffortMenu();
    modelPicker.classList.remove('hidden');
    modelMenu.classList.add('hidden');
    effortMenu.classList.add('hidden');
    currentMode = 'default';
    updateModeUI();
    modeMenu.classList.add('hidden');
    pendingRewind.length = 0;
    pendingRewindEntries.length = 0;
    pendingShell = [];
    hidePalette();
    usageData = null;
    window.__vibeUsage = null;
    loadCachedUsage(); // meter is visible immediately, from the last session
    renderUsage();
    attachments = [];
    renderAttachments();
    // File list for "@" mentions — loads quietly in the background.
    projectFiles = [];
    if (project) {
      window.vibeshell.projects.files(project.path).then((list) => {
        projectFiles = Array.isArray(list) ? list : [];
      });
    }
    // project may be null — that's the "just chat, no folder" mode.
    window.vibeshell.agent.start(
      project ? project.path : null,
      resumeRecord ? resumeRecord.id : null,
      resumeAt || null
    );
    inputEl.focus();
    scrollToBottom();
  }

  // Language flip: re-localize everything currently on screen.
  document.addEventListener('vibeshell:lang-changed', () => {
    setStatus(lastStatusState);
    if (messagesEl.querySelector('.chat-intro')) buildIntro();
    updatePickers();
    renderModelMenu();
    renderEffortMenu();
    updateModeUI();
    renderUsage();
    localizeCopyButtons(messagesEl);
    messagesEl.querySelectorAll('.tool-out-label').forEach((el) => {
      el.textContent = t('result');
    });
    messagesEl.querySelectorAll('.msg-think:not(.streaming) .think-head').forEach((el) => {
      el.textContent = t('thinkingDoneTitle');
    });
  });

  window.AIShellChat = {
    start(project) {
      beginSession(project, null);
    },
    resume(project, chatRecord) {
      beginSession(project, chatRecord);
    },
    stop() {
      window.vibeshell.agent.stop();
    },
  };
})();
