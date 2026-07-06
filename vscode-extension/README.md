<div dir="rtl">

# VibeShell لـ VS Code

يفتح تطبيق VibeShell الكامل داخل **لوحة في VS Code** — بكل تفاصيله (المحادثة، الصور، اختيار النموذج، الإعدادات) — دون نافذة منفصلة. اكتب `vibeshell` في الترمنال المدمج فتظهر اللوحة على مشروعك الحالي.

## كيف يعمل
- الواجهة نفسها المستخدمة في تطبيق سطح المكتب (`../renderer`) تُحمّل في webview.
- الطبقة الخلفية (`../main/*`) تعمل في مضيف الإضافة عبر رسائل webview بدل Electron IPC — نفس منطق الوكيل والأدوات والمحادثات والإعدادات.

## التثبيت (وضع التطوير)
```bash
# من مجلد المشروع
code --extensionDevelopmentPath="./vscode-extension" .
```
ثم من لوحة الأوامر: **VibeShell: Open panel** — أو اكتب `vibeshell` في الترمنال.

## أمر الترمنال
أضف مجلد `../cli` إلى PATH، ثم في أي ترمنال VS Code:
```
vibeshell
```
يفتح اللوحة في نفس نافذة المحرر على مجلد الترمنال الحالي.

## الحالة
- ✅ الواجهة تُرسم كاملة داخل webview (مُختبَر).
- ✅ الطبقة الخلفية تعمل في المضيف — بما فيها جلسة وكيل حيّة (مُختبَر، 12/12).
- ⏳ اختبار VS Code الحيّ الكامل معلّق ريثما يكتمل تحديث VS Code على هذا الجهاز.

</div>

---

# VibeShell for VS Code

Opens the full VibeShell app inside a **VS Code panel** — chat, images, model
picker, settings, everything — no separate window. Type `vibeshell` in the
integrated terminal and the panel opens on your current project.

## How it works
- The same UI as the desktop app (`../renderer`) loads in a webview.
- The backend (`../main/*`) runs in the extension host over webview messaging
  instead of Electron IPC — identical agent / tools / chats / settings logic.

## Install (development)
```bash
code --extensionDevelopmentPath="./vscode-extension" .
```
Then run **VibeShell: Open panel** from the Command Palette, or type
`vibeshell` in a terminal.

## Terminal command
Put `../cli` on your PATH, then in any VS Code terminal:
```
vibeshell
```
It opens the panel in that same editor window, scoped to the terminal's folder.

## Tests
```bash
node vscode-extension/test/host-bridge.test.js       # backend in the host (no VS Code)
npx electron vscode-extension/test/webview-render.test.js   # UI renders in a webview
node cli/vibeshell.test.js                            # terminal command logic
```

## Status
- ✅ Full UI renders inside a webview (verified).
- ✅ Backend runs in the host, incl. a live agent session (verified, 12/12).
- ⏳ Live in-VS-Code E2E pending a VS Code update finishing on this machine.
