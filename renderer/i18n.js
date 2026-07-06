// VibeShell — bilingual UI strings (Arabic-first, English fallback).
// Static HTML is translated via data-i18n attributes; dynamic strings go
// through t(). Switching languages flips the whole document direction.

(function () {
  const STRINGS = {
    ar: {
      // Launcher
      tagline: 'طرفية الذكاء الاصطناعي التي لا تحتاج أن تتعلمها.',
      yourTools: 'أدوات الذكاء الاصطناعي لديك',
      checkingInstalled: 'نتحقق مما هو مثبّت…',
      toolsHint: 'اختر أداة لبدء المحادثة. أي أداة غير مثبّتة تبعد نقرة واحدة فقط.',
      'blurb-claude': 'وكيل البرمجة من Anthropic — مدعوم بالكامل في VibeShell.',
      'blurb-codex': 'وكيل البرمجة من OpenAI. ثبّته الآن — دعم المحادثة قريباً.',
      'blurb-gemini': 'وكيل البرمجة من Google. ثبّته الآن — دعم المحادثة قريباً.',
      installing: 'جارٍ التثبيت…',
      notInstalled: 'غير مثبّت',
      installed: 'مثبّت',
      install: 'تثبيت',
      update: 'تحديث',
      open: 'فتح',
      cancel: 'إلغاء',
      comingSoon: 'المحادثة قريباً',
      startingDownload: 'بدء التنزيل…',
      workingEllipsis: 'جارٍ العمل…',
      genericError: 'حدث خطأ ما. حاول مجدداً.',
      waitingSignIn: 'بانتظار تسجيل الدخول… أكمِله في نافذة الطرفية التي فُتحت.',
      signedInAs: 'مسجّل الدخول: {email}',
      planSuffix: ' · خطة {plan}',
      notSignedIn: 'غير مسجّل الدخول',
      signIn: 'تسجيل الدخول',
      signOut: 'تسجيل الخروج',
      confirmSignOut: 'تسجيل الخروج من Claude على هذا الجهاز؟',
      toggleDark: 'تبديل الوضع الداكن',
      toggleLang: 'Switch to English',

      // Sidebar & workspace
      sidebarTitle: 'مساحة العمل',
      justChat: 'محادثة فقط',
      newProject: 'مشروع جديد',
      openFolder: 'فتح مجلد',
      projectsLabel: 'المشاريع',
      chatsLabel: 'المحادثات',
      sbEmpty: 'لا شيء بعد — أنشئ أو افتح مشروعاً من الأعلى.',
      sbChatsEmpty: 'لا محادثات محفوظة هنا بعد.',
      searchChats: 'ابحث… (Ctrl+K)',
      noSearchResults: 'لا نتائج مطابقة.',
      allTools: '→ كل الأدوات',
      newChat: '＋ محادثة جديدة',
      newChatTitle: 'محادثة جديدة',
      toggleSidebar: 'إظهار/إخفاء الشريط الجانبي',
      startFresh: 'بدء محادثة جديدة',
      removeRecent: 'إزالة من هذه القائمة (المجلد نفسه لا يُمَس)',
      deleteChat: 'حذف هذه المحادثة',
      generalChat: 'محادثة عامة',
      noFolderOpen: 'لا يوجد مجلد مفتوح — يمكنك اختيار واحد من الشريط الجانبي في أي وقت',

      // Chat
      statusIdle: 'بانتظارك',
      statusThinking: 'يفكّر…',
      statusWorking: 'يعمل…',
      statusApproval: 'بانتظار موافقتك',
      goodMorning: 'صباح الخير',
      goodEvening: 'مساء الخير',
      codexIntro: 'بمَ أستطيع مساعدتك؟',
      geminiIntro: 'مرحباً',
      introSub: 'صِف ما تريد بناءه — الوكيل يكتب الكود ويستأذنك قبل أي تغيير.',
      composerPlaceholder: 'صِف ما تريد بناءه…',
      send: 'إرسال',
      stop: 'إيقاف',
      attachImages: 'إرفاق صور',
      removeImage: 'إزالة هذه الصورة',
      dropHint: 'أفلت الصور هنا لإرفاقها',
      maxImages: 'يمكنك إرفاق حتى {n} صور في الرسالة الواحدة.',
      copy: 'نسخ',
      copied: 'نُسخ!',
      autoApprove: 'موافقة تلقائية',
      autoApproveTitle: 'الموافقة على كل إجراءات الوكيل تلقائياً، دون سؤال',
      account: 'الحساب',

      // Working modes (like Shift+Tab in the terminal)
      modeTitle: 'وضع العمل',
      modeDefault: 'يسأل قبل كل تغيير',
      modeAccept: 'يقبل التعديلات تلقائياً',
      modePlan: 'تخطيط فقط — دون تنفيذ',
      modeAuto: 'موافقة تلقائية كاملة',
      modeDefaultShort: 'يسأل',
      modeAcceptShort: 'يقبل التعديلات',
      modePlanShort: 'تخطيط',
      modeAutoShort: 'تلقائي كامل',

      // Slash commands & compaction & rewind
      noCommands: 'لا أوامر مطابقة',
      compacting: 'يضغط المحادثة…',
      compactDone: 'تم ضغط المحادثة',
      compactFailed: 'فشل ضغط المحادثة',
      rewindTitle: 'الرجوع إلى هنا وتعديل هذه الرسالة',
      confirmRewind: 'الرجوع إلى ما قبل هذه الرسالة؟ تُحذف الرسائل التالية من المحادثة وتعود رسالتك إلى صندوق الكتابة لتعديلها وإعادة إرسالها. (تُستعاد الملفات إن توفّرت نقطة حفظ.)',
      rewindDone: '↩ استُرجعت الملفات ({n} ملف)',
      rewindFailed: 'تعذّر الاسترجاع: {e}',
      queuedHint: 'سيُرسل بعد انتهاء الدور الحالي',
      memorySaved: '💾 حُفظ في الذاكرة (CLAUDE.md)',
      memoryFailed: 'تعذّر الحفظ في الذاكرة',
      noFiles: 'لا ملفات مطابقة',
      permsTitle: 'الصلاحيات الممنوحة',
      permsEmpty: 'لا صلاحيات دائمة بعد — تظهر هنا عندما تختار "السماح دائماً" في بطاقة موافقة.',
      permsManage: 'الصلاحيات الممنوحة…',
      revoke: 'سحب',

      // Agent activity
      actReading: 'يقرأ {f}',
      actWriting: 'يكتب {f}',
      actEditing: 'يعدّل {f}',
      actCommand: 'ينفّذ أمراً',
      actSearching: 'يبحث في المشروع',
      actPlanning: 'يخطط للعمل',
      actWeb: 'يبحث في الإنترنت',
      actSubtask: 'يعمل على مهمة فرعية',
      actUsing: 'يستخدم {name}',
      actStopped: 'تم الإيقاف',
      result: 'النتيجة',
      planTitle: 'خطة العمل',
      thinkingLiveTitle: '💭 يفكّر…',
      thinkingDoneTitle: '💭 التفكير',

      // Approval cards
      wantsCreate: 'يريد الوكيل إنشاء {f}',
      wantsEdit: 'يريد الوكيل تعديل {f}',
      wantsRun: 'يريد الوكيل تنفيذ أمر',
      wantsUse: 'يريد الوكيل استخدام {name}',
      aFile: 'ملف',
      unchangedLines: '⋯ {n} سطر بدون تغيير',
      approve: 'موافقة',
      alwaysAllow: 'السماح دائماً',
      deny: 'رفض',
      denied: '✕ مرفوض',
      approved: '✓ تمت الموافقة',
      stoppedVerdict: '✕ أُوقف',

      // Models & effort
      loadingModels: 'جارٍ تحميل النماذج…',
      switchModel: 'تبديل النموذج',
      thinkingEffort: 'مستوى التفكير',
      effortSet: 'ضُبط مستوى التفكير على {level}',
      switchingTo: 'التبديل إلى {model}',
      fastMode: 'الوضع السريع',
      effortLow: 'الأسرع، تفكير أدنى',
      effortMedium: 'متوازن',
      effortHigh: 'تفكير عميق (افتراضي)',
      effortXhigh: 'الأعمق والأبطأ',

      // Usage
      usage: 'الاستخدام',
      usageTitle: 'استخدام الجلسة',
      planLimits: 'حدود الخطة',
      session5h: 'الجلسة (نافذة ٥ ساعات)',
      weeklyAll: 'أسبوعي (كل النماذج)',
      weeklyModel: 'أسبوعي · {name}',
      resetsIn: 'يتجدد خلال {t}',
      timeLeft: '{t} متبقية',
      planNA: 'حدود الخطة غير متاحة لهذا النوع من الحسابات.',
      noUsage: 'لا بيانات استخدام بعد — أرسل رسالة أولاً.',
      extraUsage: 'استخدام إضافي',
      creditsUsed: 'الرصيد المستخدم',
      thisSession: 'هذه الجلسة',
      apiCost: 'تكلفة API',
      sessionLength: 'مدة الجلسة',
      modelTime: 'زمن التحدث مع النموذج',
      codeChanges: 'تغييرات الكود',
      linesChanged: '+{a} / −{r} سطر',
      viewUsage: 'عرض تفاصيل الاستخدام ←',
      weeklyShort: 'أسبوعي: {p}%',
      sessionShort: 'استخدام الجلسة: {p}% من نافذة الـ٥ ساعات',
      close: 'إغلاق',

      // Modal
      modalTitle: 'اختر اسماً لمشروعك',
      modalHint: 'بعدها ستختار مكان حفظه.',
      modalPlaceholder: 'تطبيقي-الأول',
      chooseLocation: 'اختر الموقع…',
      nameRequired: 'فضلاً أعطِ مشروعك اسماً.',

      // Errors from the agent
      errNodeMissing: 'تعذّر تشغيل الوكيل — لم يُعثر على Node.js في هذا الجهاز.',
      errNotSignedIn: 'لست مسجّل الدخول في Claude. سجّل الدخول وحاول مجدداً.',
      errAgent: 'حدث خطأ في الوكيل: {raw}',
      errSignIn: 'مشكلة في تسجيل الدخول: {raw}',
      errNetwork: 'انقطع الاتصال بالإنترنت ولم نتمكّن من إعادة الاتصال. تحقّق من شبكتك ثم أرسل رسالتك مجدداً.',
      reconnecting: 'انقطع الاتصال — إعادة المحاولة ({n}/{m})…',
      reconnectedMsg: '✓ عاد الاتصال — نكمل من حيث توقّفنا',
      backendDown: 'تعذّر تشغيل الخلفية. تأكّد من تثبيت Node.js على جهازك، ثم أغلق هذه اللوحة وافتحها من جديد.',

      // Parallel windows & terminal sessions
      newWindow: 'نافذة جديدة — جلسة موازية',
      terminalSessionsLabel: 'جلسات الطرفية',

      // Plan review card
      wantsPlan: 'الوكيل جهّز خطة لمراجعتك',
      actPlanReady: 'يعرض الخطة',

      // "!" bash mode
      noOutput: '(لا مخرجات)',

      // Settings (MCP + standing rules)
      settings: 'إعدادات Claude Code',
      settingsTitle: 'إعدادات Claude Code',
      mcpTab: 'خوادم MCP',
      permsTab: 'قواعد الصلاحيات',
      mcpHint: 'خوادم MCP تمنح الوكيل أدوات إضافية (GitHub، قواعد بيانات…). التغييرات تسري على المحادثات الجديدة.',
      mcpEmpty: 'لا خوادم MCP مضافة بعد.',
      mcpNamePh: 'الاسم — مثل github',
      mcpCmdPh: 'أمر التشغيل أو رابط https://…',
      permRulesHint: 'قواعد سماح دائمة بصيغة "الأداة(النمط)" — مثل Bash(npm *) أو Read. تسري على المحادثات الجديدة.',
      rulesEmpty: 'لا قواعد دائمة بعد.',
      add: 'إضافة',
      scopeProject: 'هذا المشروع',
      scopeUser: 'كل المشاريع',
      fieldRequired: 'أكمل الحقول المطلوبة.',
      badName: 'الاسم: حروف وأرقام و- و_ فقط.',
      needProject: 'افتح مشروعاً أولاً لاستخدام هذا النطاق.',
    },

    en: {
      tagline: 'The AI terminal you never have to learn.',
      yourTools: 'Your AI tools',
      checkingInstalled: 'Checking what’s installed…',
      toolsHint: 'Pick a tool to start chatting. Anything not installed yet is one click away.',
      'blurb-claude': "Anthropic's coding agent — fully supported in VibeShell.",
      'blurb-codex': "OpenAI's coding agent. Install it now — chat support is coming soon.",
      'blurb-gemini': "Google's coding agent. Install it now — chat support is coming soon.",
      installing: 'Installing…',
      notInstalled: 'Not installed',
      installed: 'Installed',
      install: 'Install',
      update: 'Update',
      open: 'Open',
      cancel: 'Cancel',
      comingSoon: 'Chat coming soon',
      startingDownload: 'Starting the download…',
      workingEllipsis: 'Working…',
      genericError: 'Something went wrong. Please try again.',
      waitingSignIn: 'Waiting for sign-in… finish it in the terminal window that opened.',
      signedInAs: 'Signed in as {email}',
      planSuffix: ' · {plan} plan',
      notSignedIn: 'Not signed in',
      signIn: 'Sign in',
      signOut: 'Sign out',
      confirmSignOut: 'Sign out of Claude on this computer?',
      toggleDark: 'Toggle dark mode',
      toggleLang: 'التبديل إلى العربية',

      sidebarTitle: 'Workspace',
      justChat: 'Just chat',
      newProject: 'New project',
      openFolder: 'Open folder',
      projectsLabel: 'Projects',
      chatsLabel: 'Chats',
      sbEmpty: 'Nothing yet — create or open a project above.',
      sbChatsEmpty: 'No saved chats here yet.',
      searchChats: 'Search… (Ctrl+K)',
      noSearchResults: 'No matches.',
      allTools: '← All tools',
      newChat: '＋ New chat',
      newChatTitle: 'New chat',
      toggleSidebar: 'Toggle sidebar',
      startFresh: 'Start a fresh conversation',
      removeRecent: 'Remove from this list (the folder itself is not touched)',
      deleteChat: 'Delete this chat',
      generalChat: 'General chat',
      noFolderOpen: 'No folder open — you can pick one from the sidebar anytime',

      statusIdle: 'Waiting for you',
      statusThinking: 'Thinking…',
      statusWorking: 'Working…',
      statusApproval: 'Waiting for your approval',
      goodMorning: 'Good morning',
      goodEvening: 'Good evening',
      codexIntro: 'What can I help with?',
      geminiIntro: 'Hello',
      introSub: 'Describe what you want to build — the agent writes the code and asks you before changing anything.',
      composerPlaceholder: 'Describe what you want to build…',
      send: 'Send',
      stop: 'Stop',
      attachImages: 'Attach images',
      removeImage: 'Remove this image',
      dropHint: 'Drop images to attach them',
      maxImages: 'You can attach up to {n} images per message.',
      copy: 'Copy',
      copied: 'Copied!',
      autoApprove: 'Auto-approve',
      autoApproveTitle: 'Approve every agent action automatically, without asking',
      account: 'Account',

      modeTitle: 'Working mode',
      modeDefault: 'Ask before changes',
      modeAccept: 'Auto-accept file edits',
      modePlan: 'Plan only — no execution',
      modeAuto: 'Approve everything',
      modeDefaultShort: 'Ask',
      modeAcceptShort: 'Accept edits',
      modePlanShort: 'Plan',
      modeAutoShort: 'Full auto',

      noCommands: 'No matching commands',
      compacting: 'Compacting the conversation…',
      compactDone: 'Conversation compacted',
      compactFailed: 'Compaction failed',
      rewindTitle: 'Go back here and edit this message',
      confirmRewind: 'Go back to before this message? Later messages are removed from the conversation and your message returns to the composer to edit and resend. (Files are restored when a checkpoint is available.)',
      rewindDone: '↩ Files restored ({n})',
      rewindFailed: "Couldn't rewind: {e}",
      queuedHint: 'Will send when the current turn finishes',
      memorySaved: '💾 Saved to memory (CLAUDE.md)',
      memoryFailed: "Couldn't save to memory",
      noFiles: 'No matching files',
      permsTitle: 'Granted permissions',
      permsEmpty: 'No standing grants yet — they appear here when you pick "Always allow" on an approval card.',
      permsManage: 'Granted permissions…',
      revoke: 'Revoke',

      actReading: 'Reading {f}',
      actWriting: 'Writing {f}',
      actEditing: 'Editing {f}',
      actCommand: 'Running a command',
      actSearching: 'Searching the project',
      actPlanning: 'Planning the work',
      actWeb: 'Looking something up online',
      actSubtask: 'Working on a subtask',
      actUsing: 'Using {name}',
      actStopped: 'Stopped',
      result: 'Result',
      planTitle: 'Plan',
      thinkingLiveTitle: '💭 Thinking…',
      thinkingDoneTitle: '💭 Thought process',

      wantsCreate: 'The agent wants to create {f}',
      wantsEdit: 'The agent wants to edit {f}',
      wantsRun: 'The agent wants to run a command',
      wantsUse: 'The agent wants to use {name}',
      aFile: 'a file',
      unchangedLines: '⋯ {n} unchanged lines',
      approve: 'Approve',
      alwaysAllow: 'Always allow',
      deny: 'Deny',
      denied: '✕ Denied',
      approved: '✓ Approved',
      stoppedVerdict: '✕ Stopped',

      loadingModels: 'Loading models…',
      switchModel: 'Switch model',
      thinkingEffort: 'Thinking effort',
      effortSet: 'Thinking effort set to {level}',
      switchingTo: 'Switching to {model}',
      fastMode: 'Fast mode',
      effortLow: 'Fastest, minimal thinking',
      effortMedium: 'Balanced',
      effortHigh: 'Deep reasoning (default)',
      effortXhigh: 'Deepest, slowest',

      usage: 'Usage',
      usageTitle: 'Session usage',
      planLimits: 'Plan limits',
      session5h: 'Session (5-hour window)',
      weeklyAll: 'Weekly (all models)',
      weeklyModel: 'Weekly · {name}',
      resetsIn: 'resets in {t}',
      timeLeft: '{t} left',
      planNA: 'Plan limits are not available for this account type.',
      noUsage: 'No usage data yet — send a message first.',
      extraUsage: 'Extra usage',
      creditsUsed: 'Credits used',
      thisSession: 'This session',
      apiCost: 'API cost',
      sessionLength: 'Session length',
      modelTime: 'Time talking to the model',
      codeChanges: 'Code changes',
      linesChanged: '+{a} / −{r} lines',
      viewUsage: 'View detailed usage →',
      weeklyShort: 'Weekly: {p}%',
      sessionShort: 'Session usage: {p}% of the 5-hour window',
      close: 'Close',

      modalTitle: 'Name your project',
      modalHint: "Next, you'll choose where to keep it.",
      modalPlaceholder: 'my-first-app',
      chooseLocation: 'Choose location…',
      nameRequired: 'Please give your project a name.',

      errNodeMissing: "Couldn't start the agent — Node.js was not found on this computer.",
      errNotSignedIn: "You're not signed in to Claude. Sign in and try again.",
      errAgent: 'Something went wrong with the agent: {raw}',
      errSignIn: 'Sign-in problem: {raw}',
      errNetwork: "The internet connection dropped and we couldn't reconnect. Check your network and resend your message.",
      reconnecting: 'Connection lost — reconnecting ({n}/{m})…',
      reconnectedMsg: '✓ Reconnected — picking up where we left off',
      backendDown: "Couldn't start the backend. Make sure Node.js is installed, then close and reopen this panel.",

      newWindow: 'New window — parallel session',
      terminalSessionsLabel: 'Terminal sessions',

      wantsPlan: 'The agent has a plan for you to review',
      actPlanReady: 'Presenting the plan',

      noOutput: '(no output)',

      settings: 'Claude Code settings',
      settingsTitle: 'Claude Code settings',
      mcpTab: 'MCP servers',
      permsTab: 'Permission rules',
      mcpHint: 'MCP servers give the agent extra tools (GitHub, databases…). Changes apply to new chats.',
      mcpEmpty: 'No MCP servers yet.',
      mcpNamePh: 'Name — e.g. github',
      mcpCmdPh: 'Launch command or https://… URL',
      permRulesHint: 'Standing allow rules as "Tool(pattern)" — e.g. Bash(npm *) or Read. Apply to new chats.',
      rulesEmpty: 'No standing rules yet.',
      add: 'Add',
      scopeProject: 'This project',
      scopeUser: 'All projects',
      fieldRequired: 'Fill in the required fields.',
      badName: 'Name: letters, digits, - and _ only.',
      needProject: 'Open a project first to use this scope.',
    },
  };

  let lang = 'ar';
  try {
    const saved = localStorage.getItem('vibeshell-lang');
    if (saved === 'ar' || saved === 'en') lang = saved;
  } catch { /* default stands */ }

  function t(key, vars) {
    let text = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replace(`{${name}}`, String(value));
      }
    }
    return text;
  }

  // Translate every element carrying data-i18n / data-i18n-title /
  // data-i18n-placeholder, and flip the document direction.
  function applyLang(next) {
    if (next === 'ar' || next === 'en') lang = next;
    try { localStorage.setItem('vibeshell-lang', lang); } catch { /* fine */ }

    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });

    document.dispatchEvent(new CustomEvent('vibeshell:lang-changed', { detail: { lang } }));
  }

  window.I18N = {
    t,
    applyLang,
    get lang() { return lang; },
  };
})();
