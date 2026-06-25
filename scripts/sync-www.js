const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

const COPY_DIRS = ['css', 'js', 'assets'];
const COPY_FILES = ['index.html'];

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rmrf(WWW);
fs.mkdirSync(WWW, { recursive: true });

for (const dir of COPY_DIRS) {
  const src = path.join(ROOT, dir);
  if (fs.existsSync(src)) copyDir(src, path.join(WWW, dir));
}

for (const file of COPY_FILES) {
  fs.copyFileSync(path.join(ROOT, file), path.join(WWW, file));
}

// Android 专用：注入 mobile 样式与 Capacitor 桥接
const indexPath = path.join(WWW, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(
  '<link rel="stylesheet" href="css/style.css">',
  '<link rel="stylesheet" href="css/style.css">\n  <link rel="stylesheet" href="css/mobile.css">\n  <meta name="theme-color" content="#4f6bed">'
);
// 注意顺序：mobile-ui.js 必须在 app.js 之前，
// 以便在 app.js 初始化(applyAppearance)之前就标记 is-mobile，应用移动端风格
html = html.replace(
  '<script src="js/app.js"></script>',
  '<script src="js/capacitor-bridge.js"></script>\n  <script src="js/mobile-ui.js"></script>\n  <script src="js/app.js"></script>'
);

// 注入移动端外壳 DOM（底部 tabbar / FAB / 新建 sheet）
const shellPath = path.join(ROOT, 'mobile', 'shell.html');
if (fs.existsSync(shellPath)) {
  const shell = fs.readFileSync(shellPath, 'utf8');
  html = html.replace(
    '<div class="toast" id="toast"></div>',
    shell + '\n\n  <div class="toast" id="toast"></div>'
  );
}

fs.writeFileSync(indexPath, html);

console.log('Synced web assets -> www/');
