// One-command Android Studio install — cross-platform (Windows / macOS /
// Linux). Builds the plugin AGAINST the installed Android Studio (no ~1GB SDK
// download, using AS's own bundled JBR), installs it, ensures a JCEF runtime
// (auto-downloading one if needed), and puts `vibeshell` on PATH.
//   npm run vibeshell:android-studio
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { banner, task, ok, info, warn, done, note, download, addCliToPath, checkNode, style } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jb = path.join(root, 'jetbrains');
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const home = os.homedir();

banner('Android Studio setup');
checkNode();

// --- Platform-specific locations (JetBrains conventions per OS) -------------
const P = {
  // Candidate Android Studio install homes (the dir containing product-info.json).
  asHomes: WIN ? [
    process.env.VIBESHELL_IDE_HOME,
    'C:/Program Files/Android/Android Studio',
    path.join(home, 'AppData/Local/Programs/Android Studio'),
  ] : MAC ? [
    process.env.VIBESHELL_IDE_HOME,
    '/Applications/Android Studio.app/Contents',
    path.join(home, 'Applications/Android Studio.app/Contents'),
  ] : [
    process.env.VIBESHELL_IDE_HOME,
    '/opt/android-studio',
    path.join(home, 'android-studio'),
    path.join(home, '.local/share/JetBrains/Toolbox/apps/AndroidStudio'),
  ],
  productInfo: (h) => MAC ? path.join(h, 'Resources/product-info.json') : path.join(h, 'product-info.json'),
  jbrHome: (h) => MAC ? path.join(h, 'jbr/Contents/Home') : path.join(h, 'jbr'),
  jcefLib: (jbr) => WIN ? path.join(jbr, 'bin/jcef.dll')
    : MAC ? path.join(jbr, 'lib/libjcef.dylib')
    : path.join(jbr, 'lib/libjcef.so'),
  configBase: WIN ? path.join(home, 'AppData/Roaming/Google')
    : MAC ? path.join(home, 'Library/Application Support/Google')
    : path.join(home, '.config/Google'),
  bootFile: WIN ? 'studio64.exe.jdk' : 'studio.jdk',
  jbrOs: WIN ? 'windows' : MAC ? 'osx' : 'linux',
  jbrArch: process.arch === 'arm64' ? 'aarch64' : 'x64',
  gradlew: WIN ? path.join(jb, 'gradlew.bat') : path.join(jb, 'gradlew'),
  // Other installed JetBrains IDEs whose JBR may already ship JCEF.
  jetbrainsRoots: WIN ? ['C:/Program Files/JetBrains', 'C:/Program Files (x86)/JetBrains']
    : MAC ? ['/Applications', path.join(home, 'Applications')]
    : ['/opt', path.join(home, '.local/share/JetBrains/Toolbox/apps')],
};

// 1. Locate Android Studio.
const asHome = P.asHomes.filter(Boolean).find((c) => fs.existsSync(P.productInfo(c)));
if (!asHome) {
  warn('Android Studio not found. Set VIBESHELL_IDE_HOME to its folder and re-run.');
  process.exit(1);
}
ok(`Found Android Studio  ${style.dim(asHome)}`);

// 2. Build the plugin using AS's own JBR — no separate JDK, no SDK download.
if (!WIN) { try { fs.chmodSync(P.gradlew, 0o755); } catch { /* fine */ } }
task('Building the plugin (against your Android Studio)', `"${P.gradlew}" buildPlugin --console=plain`, jb, {
  JAVA_HOME: P.jbrHome(asHome),
  VIBESHELL_IDE_HOME: asHome,
});

// 3. Config + plugins directory.
const cfgName = fs.existsSync(P.configBase)
  ? fs.readdirSync(P.configBase).filter((d) => /^AndroidStudio\d+\.\d+$/.test(d)).sort().pop()
  : null;
if (!cfgName) {
  warn('Android Studio config folder not found under ' + P.configBase);
  process.exit(1);
}
const cfgDir = path.join(P.configBase, cfgName);
const pluginsDir = path.join(cfgDir, 'plugins');
fs.mkdirSync(pluginsDir, { recursive: true });

// 4. Install the built plugin (unzip into the plugins dir).
const zip = path.join(jb, 'build/distributions/vibeshell-jetbrains-0.1.0.zip');
fs.rmSync(path.join(pluginsDir, 'vibeshell-jetbrains'), { recursive: true, force: true });
const unzipCmd = WIN
  ? `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zip}' -DestinationPath '${pluginsDir}'"`
  : `unzip -o "${zip}" -d "${pluginsDir}"`;
task('Installing the plugin', unzipCmd, root);

// 5. Ensure a JCEF-capable runtime.
await ensureJcefRuntime(asHome, cfgDir);

// 6. `vibeshell` command on PATH.
addCliToPath(root);

done('Installed for Android Studio.');
console.log(`  ${style.dim('Restart Android Studio, then type')} ${style.bold('vibeshell')} ${style.dim('in its terminal.')}\n`);

async function ensureJcefRuntime(asHome, cfgDir) {
  if (fs.existsSync(P.jcefLib(P.jbrHome(asHome)))) {
    ok('JCEF runtime: already available in Android Studio');
    return;
  }
  const existing = findJcefJbr();
  if (existing) {
    fs.writeFileSync(path.join(cfgDir, P.bootFile), existing, 'ascii');
    ok('JCEF runtime: linked an existing one');
    note(existing);
    return;
  }
  info('JCEF runtime not found — downloading it once (needed to show the panel)');
  try {
    const jbrHome = await downloadJcefJbr(asHome, cfgDir);
    fs.writeFileSync(path.join(cfgDir, P.bootFile), jbrHome, 'ascii');
    ok('JCEF runtime: downloaded and linked to Android Studio');
    note('revert anytime by deleting ' + path.join(cfgDir, P.bootFile));
  } catch (e) {
    warn('Automatic JCEF download failed: ' + (e.message || e));
    note('Enable it in Android Studio: Help → Find Action →');
    note('"Choose Boot Java Runtime" → pick one WITH JCEF.');
  }
}

function findJcefJbr() {
  const jcefName = WIN ? 'bin/jcef.dll' : MAC ? 'jbr/Contents/Home/lib/libjcef.dylib' : 'jbr/lib/libjcef.so';
  for (const r of P.jetbrainsRoots) {
    if (!fs.existsSync(r)) continue;
    for (const entry of fs.readdirSync(r)) {
      if (!/(PyCharm|IntelliJ|WebStorm|PhpStorm|GoLand|CLion|Rider|RubyMine|DataGrip|Android)/i.test(entry)) continue;
      const base = MAC ? path.join(r, entry, 'Contents') : path.join(r, entry);
      const jbr = P.jbrHome(base);
      if (fs.existsSync(P.jcefLib(jbr))) return jbr;
    }
  }
  return null;
}

async function downloadJcefJbr(asHome, cfgDir) {
  const rel = fs.readFileSync(path.join(P.jbrHome(asHome), 'release'), 'utf8');
  const rv = (/JAVA_RUNTIME_VERSION="([^"]+)"/.exec(rel) || [])[1] || '';
  const ver = rv.split('+')[0];
  const build = (/b[0-9]+\.[0-9]+$/.exec(rv) || [])[0];
  if (!ver || !build) throw new Error('could not read the Android Studio runtime version');
  const url = `https://cache-redirector.jetbrains.com/intellij-jbr/jbr_jcef-${ver}-${P.jbrOs}-${P.jbrArch}-${build}.tar.gz`;

  const tmp = path.join(os.tmpdir(), `vibeshell-jbr-${ver}-${build}.tar.gz`);
  await download(url, tmp);

  const dest = path.join(cfgDir, `jbr-jcef-${ver}-${build}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  info('Extracting the runtime…');
  execSync(`tar -xzf "${tmp}" -C "${dest}"`, { stdio: 'ignore' }); // tar ships with Win10+/macOS/Linux
  fs.rmSync(tmp, { force: true });

  const javaExe = WIN ? 'bin/java.exe' : 'bin/java';
  const macHome = 'Contents/Home';
  const found = findDir(dest, (d) =>
    fs.existsSync(path.join(d, javaExe)) || (MAC && fs.existsSync(path.join(d, macHome, javaExe))));
  if (!found) throw new Error('extracted runtime has no java executable');
  return MAC && fs.existsSync(path.join(found, macHome, javaExe)) ? path.join(found, macHome) : found;
}

// Find dest or a one-level child matching a predicate.
function findDir(dest, pred) {
  if (pred(dest)) return dest;
  for (const entry of fs.readdirSync(dest)) {
    const sub = path.join(dest, entry);
    if (fs.statSync(sub).isDirectory() && pred(sub)) return sub;
  }
  return null;
}
