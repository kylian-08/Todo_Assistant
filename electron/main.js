const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, Notification } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PRELOAD = path.join(__dirname, 'preload.js');

let mainWindow = null;
let floatBallWindow = null;
let floatPanelWindow = null;
let tray = null;
let isQuitting = false;

const reminderTimers = new Map();
const recentlyFiredReminders = new Set();
const TYPE_LABELS_MAIN = { bug: 'Bug', todo: '待办', req: '需求', idea: '灵感' };

function clearReminderTimer(id) {
  const t = reminderTimers.get(id);
  if (t) clearTimeout(t);
  reminderTimers.delete(id);
}

function showRecordReminder({ id, title, type, reminderAt }) {
  if (recentlyFiredReminders.has(id)) return;
  recentlyFiredReminders.add(id);
  setTimeout(() => recentlyFiredReminders.delete(id), 15000);
  clearReminderTimer(id);
  if (!Notification.isSupported()) return;
  const when = reminderAt ? new Date(reminderAt) : null;
  const timeStr = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' })
    : '';
  const n = new Notification({
    title: 'TODO Assistant · 提醒',
    body: `[${TYPE_LABELS_MAIN[type] || type}] ${title}${timeStr ? `\n${timeStr}` : ''}`,
    icon: iconPath(),
    silent: false,
  });
  n.on('click', () => showMainWindow());
  broadcast('reminder-fired', { id });
}

function syncReminderTimers(reminders) {
  const active = new Set();
  const now = Date.now();

  for (const r of reminders || []) {
    if (!r?.id || !r.reminderAt || r.reminderNotified) continue;
    const at = new Date(r.reminderAt).getTime();
    if (Number.isNaN(at)) continue;

    active.add(r.id);
    clearReminderTimer(r.id);

    if (at <= now) {
      showRecordReminder(r);
      continue;
    }

    reminderTimers.set(r.id, setTimeout(() => showRecordReminder(r), at - now));
  }

  for (const id of [...reminderTimers.keys()]) {
    if (!active.has(id)) clearReminderTimer(id);
  }
}

const desktopSettings = {
  minimizeToTray: true,
  alwaysOnTop: false,
  floatBall: true,
  floatPanelOnTop: true,
};

function iconPath() {
  const icon = path.join(ROOT, 'assets', 'icon.png');
  const tray = path.join(ROOT, 'assets', 'tray.png');
  if (fs.existsSync(icon)) return icon;
  if (fs.existsSync(tray)) return tray;
  return undefined;
}

function getTrayImage() {
  const p = iconPath();
  if (p) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
  }
  return nativeImage.createEmpty();
}

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  else {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function applyAlwaysOnTop(enabled) {
  desktopSettings.alwaysOnTop = !!enabled;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(desktopSettings.alwaysOnTop, 'screen-saver');
  if (floatPanelWindow && !floatPanelWindow.isDestroyed()) {
    floatPanelWindow.setAlwaysOnTop(desktopSettings.floatPanelOnTop, 'screen-saver');
  }
  if (floatBallWindow && !floatBallWindow.isDestroyed()) {
    floatBallWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  updateTrayMenu();
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'TODO Assistant · 留档助手',
    icon: iconPath(),
    backgroundColor: '#f0f4fb',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(ROOT, 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.setAlwaysOnTop(desktopSettings.alwaysOnTop, 'screen-saver');

  mainWindow.on('close', e => {
    if (!isQuitting && desktopSettings.minimizeToTray) {
      e.preventDefault();
      hideMainWindow();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function createFloatBall() {
  if (floatBallWindow && !floatBallWindow.isDestroyed()) {
    floatBallWindow.show();
    return floatBallWindow;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  floatBallWindow = new BrowserWindow({
    width: 64,
    height: 64,
    x: width - 88,
    y: height - 140,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  floatBallWindow.loadFile(path.join(ROOT, 'float-ball.html'));
  floatBallWindow.setAlwaysOnTop(true, 'screen-saver');
  floatBallWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  floatBallWindow.on('closed', () => {
    floatBallWindow = null;
    updateTrayMenu();
  });

  return floatBallWindow;
}

function destroyFloatBall() {
  if (floatBallWindow && !floatBallWindow.isDestroyed()) {
    floatBallWindow.destroy();
    floatBallWindow = null;
  }
}

function showFloatPanel() {
  if (floatPanelWindow && !floatPanelWindow.isDestroyed()) {
    floatPanelWindow.show();
    floatPanelWindow.focus();
    return floatPanelWindow;
  }

  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const panelW = 380;
  const panelH = 520;

  floatPanelWindow = new BrowserWindow({
    width: panelW,
    height: panelH,
    x: width - panelW - 24,
    y: height - panelH - 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: 320,
    minHeight: 420,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  floatPanelWindow.loadFile(path.join(ROOT, 'float-panel.html'));
  floatPanelWindow.setAlwaysOnTop(desktopSettings.floatPanelOnTop, 'screen-saver');
  floatPanelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatPanelWindow.once('ready-to-show', () => floatPanelWindow.show());

  floatPanelWindow.on('closed', () => { floatPanelWindow = null; });
  return floatPanelWindow;
}

function hideFloatPanel() {
  if (floatPanelWindow && !floatPanelWindow.isDestroyed()) floatPanelWindow.hide();
}

function hideFloatBallFromMenu() {
  destroyFloatBall();
  desktopSettings.floatBall = false;
  updateTrayMenu();
  broadcast('desktop-settings', getDesktopSettingsPayload());
}

function quitApplication() {
  isQuitting = true;
  app.quit();
}

function showFloatBallContextMenu() {
  const menu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: showMainWindow },
    { label: '快速留档', click: showFloatPanel },
    { type: 'separator' },
    { label: '隐藏悬浮球', click: hideFloatBallFromMenu },
    { type: 'separator' },
    { label: '退出 TODO Assistant', click: quitApplication },
  ]);
  if (floatBallWindow && !floatBallWindow.isDestroyed()) {
    menu.popup({ window: floatBallWindow });
  } else {
    menu.popup();
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const ballVisible = floatBallWindow && !floatBallWindow.isDestroyed() && floatBallWindow.isVisible();
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { label: '快速留档面板', click: showFloatPanel },
    { type: 'separator' },
    {
      label: '显示悬浮球',
      type: 'checkbox',
      checked: ballVisible,
      click: item => (item.checked ? createFloatBall() : destroyFloatBall()),
    },
    {
      label: '主窗口始终置顶',
      type: 'checkbox',
      checked: desktopSettings.alwaysOnTop,
      click: item => {
        applyAlwaysOnTop(item.checked);
        broadcast('desktop-settings', getDesktopSettingsPayload());
      },
    },
    { type: 'separator' },
    {
      label: '退出 TODO Assistant',
      click: quitApplication,
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(getTrayImage());
  tray.setToolTip('TODO Assistant — 双击显示主窗口');
  tray.on('double-click', showMainWindow);
  tray.on('click', () => {
    if (process.platform === 'win32') showMainWindow();
  });
  updateTrayMenu();
}

function getDesktopSettingsPayload() {
  return {
    ...desktopSettings,
    floatBallVisible: !!(floatBallWindow && !floatBallWindow.isDestroyed()),
  };
}

function webdavRequest({ method, url, user, pass, body }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    };
    const req = lib.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(method === 'GET' ? text : { ok: true, status: res.statusCode });
        } else {
          reject(new Error(`WebDAV ${res.statusCode}: ${text.slice(0, 120)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/* ── IPC ── */
ipcMain.handle('webdav', (_, opts) => webdavRequest(opts));

ipcMain.handle('get-desktop-settings', () => getDesktopSettingsPayload());

ipcMain.handle('set-desktop-settings', (_, patch) => {
  if ('minimizeToTray' in patch) desktopSettings.minimizeToTray = !!patch.minimizeToTray;
  if ('floatPanelOnTop' in patch) desktopSettings.floatPanelOnTop = !!patch.floatPanelOnTop;
  if ('alwaysOnTop' in patch) applyAlwaysOnTop(patch.alwaysOnTop);
  if ('floatBall' in patch) {
    if (patch.floatBall) createFloatBall();
    else destroyFloatBall();
  }
  updateTrayMenu();
  return getDesktopSettingsPayload();
});

ipcMain.handle('minimize-to-tray', () => hideMainWindow());
ipcMain.handle('show-main-window', () => showMainWindow());
ipcMain.handle('show-float-panel', () => showFloatPanel());
ipcMain.handle('hide-float-panel', () => hideFloatPanel());
ipcMain.handle('toggle-float-ball', (_, show) => {
  if (show) createFloatBall();
  else destroyFloatBall();
  updateTrayMenu();
  return getDesktopSettingsPayload();
});
ipcMain.handle('notify-data-changed', () => broadcast('data-changed'));
ipcMain.handle('broadcast-theme', (_, theme) => { broadcast('theme-changed', theme); });
ipcMain.handle('sync-reminders', (_, reminders) => {
  syncReminderTimers(reminders);
  return { ok: true, count: reminderTimers.size };
});
ipcMain.handle('show-float-ball-menu', () => showFloatBallContextMenu());
ipcMain.handle('quit-app', () => { quitApplication(); });

ipcMain.on('float-ball-drag', (_, { dx, dy }) => {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
  const [x, y] = floatBallWindow.getPosition();
  floatBallWindow.setPosition(x + dx, y + dy);
});

/* ── App lifecycle ── */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.kylian.todo-assistant');
    createTray();
    createMainWindow();
  });

  app.on('window-all-closed', () => {
    /* 保持托盘运行，不退出 */
  });

  app.on('before-quit', () => { isQuitting = true; });

  app.on('activate', () => showMainWindow());
}
