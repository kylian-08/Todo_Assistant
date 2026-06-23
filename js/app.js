/* 留档助手 - 完整版 */
const DB_NAME = 'LiudangDB';
const DB_VERSION = 2;
const STORE = 'records';
const SETTINGS_STORE = 'settings';
const DRAFT_KEY = 'liudang_draft';
const LEGACY_KEY = 'liudang_records_v1';
const SYNC_FILE = 'liudang_sync.json';
const MAX_HISTORY = 30;

const TYPE_LABELS = { bug: 'Bug', todo: '待办', req: '需求', idea: '灵感' };
const PRIORITY_LABELS = { high: '高', mid: '中', low: '低' };
const STATUS_LABELS = { open: '待处理', progress: '进行中', resolved: '已解决' };
const PRIORITY_ORDER = { high: 0, mid: 1, low: 2 };
const KANBAN_COLS = [
  { key: 'open', label: '待处理' },
  { key: 'progress', label: '进行中' },
  { key: 'resolved', label: '已解决' },
];

const BUG_TEMPLATE = `## 环境
- 系统：
- 浏览器/版本：
- 相关模块：

## 复现步骤
1. 
2. 
3. 

## 期望结果


## 实际结果

`;

const DEFAULT_SETTINGS = {
  theme: 'light',
  viewMode: 'list',
  projects: ['默认项目'],
  autoExport: false,
  autoExportHour: 9,
  lastAutoExportDate: '',
  webdavUrl: '',
  webdavUser: '',
  webdavPass: '',
  webdavPath: SYNC_FILE,
  autoSync: false,
  minimizeToTray: true,
  alwaysOnTop: false,
  floatBall: true,
};

let db = null;
let recordsCache = [];
let settings = { ...DEFAULT_SETTINGS };
let currentType = 'bug';
let currentFilter = 'all';
let pendingAttachments = [];
let editingId = null;
let draftTimer = null;
let savePending = false;
let contentTab = 'edit';
let historyRecordId = null;
let dragRecordId = null;
let reminderMode = 'absolute';
const browserReminderTimers = new Map();

/* ── IndexedDB ── */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(SETTINGS_STORE)) d.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function idb(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    }
    tx.oncomplete = () => { if (!(result instanceof IDBRequest)) resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

const dbGetAll = () => idb(STORE, 'readonly', s => s.getAll());
const dbPut = r => idb(STORE, 'readwrite', s => s.put(r));
const dbDelete = id => idb(STORE, 'readwrite', s => s.delete(id));
const dbPutAll = list => idb(STORE, 'readwrite', s => { s.clear(); list.forEach(r => s.put(r)); });

async function loadSettings() {
  try {
    const row = await idb(SETTINGS_STORE, 'readonly', s => s.get('app'));
    if (row?.value) settings = { ...DEFAULT_SETTINGS, ...row.value };
  } catch {}
  applyTheme(settings.theme);
  setViewMode(settings.viewMode, true);
}

async function saveSettingsToDB() {
  await idb(SETTINGS_STORE, 'readwrite', s => s.put({ key: 'app', value: settings }));
}

function migrateAttachments(r) {
  if (r.attachments?.length) return r.attachments;
  return (r.images || []).map((data, i) => ({
    id: uid(), kind: 'image', name: `image_${i + 1}.png`, data,
  }));
}

function normalizeRecord(r) {
  const status = r.status || (r.done ? 'resolved' : 'open');
  return {
    id: r.id || uid(),
    type: r.type || 'bug',
    title: r.title || '',
    content: r.content || '',
    project: r.project || '默认项目',
    attachments: migrateAttachments(r),
    tags: r.tags || [],
    priority: r.priority || 'mid',
    status,
    done: status === 'resolved' || !!r.done,
    pinned: !!r.pinned,
    history: r.history || [],
    reminderAt: r.reminderAt || null,
    reminderNotified: !!r.reminderNotified,
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: r.updatedAt || new Date().toISOString(),
  };
}

function snapshotRecord(r) {
  return {
    title: r.title, content: r.content, project: r.project,
    tags: [...(r.tags || [])], priority: r.priority, status: r.status,
    attachments: JSON.parse(JSON.stringify(r.attachments || [])),
    savedAt: new Date().toISOString(),
  };
}

async function migrateFromLocalStorage() {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const old = JSON.parse(legacy);
    if (!Array.isArray(old) || !old.length) return;
    for (const r of old) await dbPut(normalizeRecord(r));
    localStorage.removeItem(LEGACY_KEY);
    toast(`已迁移 ${old.length} 条旧数据`);
  } catch {}
}

async function loadRecords() {
  recordsCache = (await dbGetAll()).map(normalizeRecord);
  syncRemindersToMain();
  return recordsCache;
}

async function persistRecord(record) {
  savePending = true;
  updateSaveStatus('pending');
  const norm = normalizeRecord(record);
  await dbPut(norm);
  const idx = recordsCache.findIndex(r => r.id === norm.id);
  if (idx >= 0) recordsCache[idx] = norm;
  else recordsCache.unshift(norm);
  savePending = false;
  updateSaveStatus('saved');
  notifyDataChanged();
  syncRemindersToMain();
}

async function persistAll(list) {
  savePending = true;
  updateSaveStatus('pending');
  recordsCache = list.map(normalizeRecord);
  await dbPutAll(recordsCache);
  savePending = false;
  updateSaveStatus('saved');
  notifyDataChanged();
  syncRemindersToMain();
}

async function removeRecord(id) {
  await dbDelete(id);
  recordsCache = recordsCache.filter(r => r.id !== id);
  updateSaveStatus('saved');
  notifyDataChanged();
  syncRemindersToMain();
}

function reminderPayload(r) {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    reminderAt: r.reminderAt,
    reminderNotified: r.reminderNotified,
  };
}

function syncRemindersToMain() {
  const list = recordsCache
    .filter(r => r.reminderAt && !r.reminderNotified && !r.done)
    .map(reminderPayload);

  if (window.electronAPI?.syncReminders) {
    window.electronAPI.syncReminders(list);
    return;
  }
  if (window.capacitorReminders?.isNative?.()) {
    window.capacitorReminders.sync(list);
    return;
  }
  scheduleBrowserReminders(list);
}

function clearBrowserReminderTimer(id) {
  const t = browserReminderTimers.get(id);
  if (t) clearTimeout(t);
  browserReminderTimers.delete(id);
}

async function fireBrowserReminder(item) {
  clearBrowserReminderTimer(item.id);
  const r = recordsCache.find(x => x.id === item.id);
  if (!r || r.reminderNotified || r.done) return;

  const label = TYPE_LABELS[r.type] || r.type;
  if ('Notification' in window) {
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') {
      const n = new Notification('TODO Assistant · 提醒', {
        body: `[${label}] ${r.title}`,
        icon: 'assets/icon.png',
      });
      n.onclick = () => window.focus();
    }
  }
  await handleReminderFired(item.id);
}

function scheduleBrowserReminders(list) {
  const active = new Set();
  const now = Date.now();

  for (const item of list) {
    if (!item?.id || !item.reminderAt) continue;
    const at = new Date(item.reminderAt).getTime();
    if (Number.isNaN(at)) continue;

    active.add(item.id);
    clearBrowserReminderTimer(item.id);

    if (at <= now) {
      fireBrowserReminder(item);
      continue;
    }

    browserReminderTimers.set(item.id, setTimeout(() => fireBrowserReminder(item), at - now));
  }

  for (const id of [...browserReminderTimers.keys()]) {
    if (!active.has(id)) clearBrowserReminderTimer(id);
  }
}

async function handleReminderFired(id) {
  const r = recordsCache.find(x => x.id === id);
  if (!r || r.reminderNotified) return;
  r.reminderNotified = true;
  r.updatedAt = new Date().toISOString();
  await persistRecord(r);
  renderView();
  toast(`提醒：${r.title}`);
}

async function clearRecordReminder(id) {
  const r = recordsCache.find(x => x.id === id);
  if (!r || !r.reminderAt) return;
  r.reminderAt = null;
  r.reminderNotified = false;
  r.updatedAt = new Date().toISOString();
  await persistRecord(r);
  toast('已取消提醒');
  renderView();
}

function toDatetimeLocalValue(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function defaultReminderDatetime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30, 0, 0);
  return toDatetimeLocalValue(d);
}

function toggleReminderPanel() {
  const enabled = document.getElementById('reminderEnabled').checked;
  document.getElementById('reminderPanel').classList.toggle('hidden', !enabled);
  if (enabled) {
    const dt = document.getElementById('reminderDateTime');
    if (!dt.value) dt.value = defaultReminderDatetime();
    updateReminderPreview();
  }
  scheduleDraftSave();
}

function setReminderMode(mode, btn) {
  reminderMode = mode;
  document.querySelectorAll('.reminder-mode .mini-seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('reminderAbsoluteRow').classList.toggle('hidden', mode !== 'absolute');
  document.getElementById('reminderRelativeRow').classList.toggle('hidden', mode !== 'relative');
  updateReminderPreview();
  scheduleDraftSave();
}

function computeReminderAtFromForm() {
  if (!document.getElementById('reminderEnabled').checked) return null;

  if (reminderMode === 'relative') {
    const mins = parseInt(document.getElementById('reminderMinutes').value, 10);
    if (!mins || mins < 1) return null;
    return new Date(Date.now() + mins * 60000).toISOString();
  }

  const raw = document.getElementById('reminderDateTime').value;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function updateReminderPreview() {
  const el = document.getElementById('reminderPreview');
  if (!document.getElementById('reminderEnabled').checked) {
    el.textContent = '';
    return;
  }

  const at = computeReminderAtFromForm();
  if (!at) {
    el.textContent = '请填写有效的提醒时间';
    el.classList.add('warn');
    return;
  }

  const diff = new Date(at).getTime() - Date.now();
  if (diff <= 0) {
    el.textContent = '提醒时间需晚于当前时间';
    el.classList.add('warn');
    return;
  }

  el.classList.remove('warn');
  const mins = Math.round(diff / 60000);
  if (mins < 60) el.textContent = `将在约 ${mins} 分钟后提醒（${formatDate(at)}）`;
  else if (mins < 1440) el.textContent = `将在约 ${Math.floor(mins / 60)} 小时 ${mins % 60} 分钟后提醒（${formatDate(at)}）`;
  else el.textContent = `将在 ${formatDate(at)} 提醒`;
}

function setReminderFormFromRecord(r) {
  const enabled = !!(r?.reminderAt && !r.reminderNotified);
  document.getElementById('reminderEnabled').checked = enabled;
  document.getElementById('reminderPanel').classList.toggle('hidden', !enabled);

  if (!enabled) {
    document.getElementById('reminderDateTime').value = defaultReminderDatetime();
    document.getElementById('reminderMinutes').value = '30';
    reminderMode = 'absolute';
    document.querySelectorAll('.reminder-mode .mini-seg-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === 'absolute'));
    document.getElementById('reminderAbsoluteRow').classList.remove('hidden');
    document.getElementById('reminderRelativeRow').classList.add('hidden');
    updateReminderPreview();
    return;
  }

  reminderMode = 'absolute';
  document.querySelectorAll('.reminder-mode .mini-seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === 'absolute'));
  document.getElementById('reminderAbsoluteRow').classList.remove('hidden');
  document.getElementById('reminderRelativeRow').classList.add('hidden');
  document.getElementById('reminderDateTime').value = toDatetimeLocalValue(r.reminderAt);
  updateReminderPreview();
}

function resetReminderForm() {
  document.getElementById('reminderEnabled').checked = false;
  document.getElementById('reminderPanel').classList.add('hidden');
  document.getElementById('reminderDateTime').value = defaultReminderDatetime();
  document.getElementById('reminderMinutes').value = '30';
  reminderMode = 'absolute';
  document.querySelectorAll('.reminder-mode .mini-seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === 'absolute'));
  document.getElementById('reminderAbsoluteRow').classList.remove('hidden');
  document.getElementById('reminderRelativeRow').classList.add('hidden');
  document.getElementById('reminderPreview').textContent = '';
  document.getElementById('reminderPreview').classList.remove('warn');
}

function renderReminderBadge(r) {
  if (r.reminderNotified) return '<span class="badge badge-reminder-done">已提醒</span>';
  if (!r.reminderAt || r.done) return '';
  const at = new Date(r.reminderAt).getTime();
  if (Number.isNaN(at) || at <= Date.now()) return '';
  return `<span class="badge badge-reminder" title="提醒时间">⏰ ${formatDate(r.reminderAt)}</span>`;
}

function notifyDataChanged() {
  window.electronAPI?.notifyDataChanged?.();
}

async function syncDesktopSettings() {
  if (!window.electronAPI?.getDesktopSettings) return;
  document.querySelectorAll('.electron-only').forEach(el => el.classList.remove('hidden'));
  await applyDesktopSettings();
}

async function applyDesktopSettings() {
  if (!window.electronAPI?.setDesktopSettings) return;
  await window.electronAPI.setDesktopSettings({
    minimizeToTray: settings.minimizeToTray,
    alwaysOnTop: settings.alwaysOnTop,
    floatBall: settings.floatBall,
  });
}

function minimizeToTray() {
  window.electronAPI?.minimizeToTray?.();
  toast('已收起到系统托盘');
}

function showFloatPanel() {
  window.electronAPI?.showFloatPanel?.();
}

/* ── UI helpers ── */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function parseTags(str) {
  return str.split(/[,，]/).map(t => t.trim()).filter(Boolean);
}

function formatDate(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function updateSaveStatus(state) {
  const dot = document.getElementById('saveDot');
  const text = document.getElementById('saveText');
  dot.className = 'save-dot';
  if (state === 'pending') {
    dot.classList.add('pending');
    text.textContent = '保存中...';
  } else if (state === 'saved') {
    dot.classList.add('live');
    const n = new Date();
    text.textContent = `自动存档 · ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
  } else {
    text.textContent = state;
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeButton(theme);
  window.electronAPI?.broadcastTheme?.(theme);
}

function toggleTheme() {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  applyTheme(settings.theme);
  saveSettingsToDB();
}

function setViewMode(mode, silent) {
  settings.viewMode = mode;
  document.getElementById('btnListView').classList.toggle('active', mode === 'list');
  document.getElementById('btnKanbanView').classList.toggle('active', mode === 'kanban');
  document.getElementById('cardList').classList.toggle('hidden', mode !== 'list');
  document.getElementById('kanbanBoard').classList.toggle('hidden', mode !== 'kanban');
  if (!silent) saveSettingsToDB();
  renderView();
}

function renderView() {
  if (settings.viewMode === 'kanban') renderKanban();
  else renderList();
}

/* ── Projects ── */
function ensureProject(name) {
  const n = (name || '').trim() || '默认项目';
  if (!settings.projects.includes(n)) {
    settings.projects.push(n);
    saveSettingsToDB();
  }
  refreshProjectUI();
  return n;
}

function refreshProjectUI() {
  const dl = document.getElementById('projectList');
  dl.innerHTML = settings.projects.map(p => `<option value="${esc(p)}">`).join('');
  const sel = document.getElementById('filterProject');
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部项目</option>' +
    settings.projects.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  sel.value = cur;
  const mg = document.getElementById('projectManage');
  if (mg) {
    mg.innerHTML = settings.projects.map((p, i) =>
      `<span class="project-tag">${esc(p)}${p !== '默认项目' ? `<button type="button" data-idx="${i}" onclick="removeProjectByIdx(this.dataset.idx)">×</button>` : ''}</span>`
    ).join('');
  }
}

function removeProjectByIdx(idx) {
  removeProject(settings.projects[parseInt(idx, 10)]);
}

function addProject() {
  const input = document.getElementById('newProjectName');
  const name = input.value.trim();
  if (!name) { toast('请输入项目名称'); return; }
  if (settings.projects.includes(name)) { toast('项目已存在'); return; }
  settings.projects.push(name);
  input.value = '';
  refreshProjectUI();
  toast('项目已添加');
}

function removeProject(name) {
  if (name === '默认项目') return;
  if (!confirm(`删除项目「${name}」？相关留档将归为「默认项目」`)) return;
  settings.projects = settings.projects.filter(p => p !== name);
  recordsCache.forEach(r => { if (r.project === name) r.project = '默认项目'; });
  persistAll(recordsCache);
  refreshProjectUI();
  renderView();
}

/* ── Content tabs & Bug template ── */
function setContentTab(tab) {
  contentTab = tab;
  document.getElementById('tabEdit').classList.toggle('active', tab === 'edit');
  document.getElementById('tabPreview').classList.toggle('active', tab === 'preview');
  const ta = document.getElementById('content');
  const prev = document.getElementById('contentPreview');
  if (tab === 'preview') {
    prev.innerHTML = renderMarkdown(ta.value);
    prev.classList.remove('hidden');
    ta.classList.add('hidden');
  } else {
    prev.classList.add('hidden');
    ta.classList.remove('hidden');
  }
}

function insertBugTemplate() {
  const ta = document.getElementById('content');
  if (ta.value.trim() && !confirm('当前内容将被 Bug 模板替换，继续？')) return;
  ta.value = BUG_TEMPLATE;
  setContentTab('edit');
  scheduleDraftSave();
  toast('已插入 Bug 模板');
}

function updateBugTemplateBtn() {
  document.getElementById('btnBugTemplate').style.display = currentType === 'bug' ? '' : 'none';
}

/* ── Draft auto-save ── */
function getFormState() {
  return {
    type: currentType,
    title: document.getElementById('title').value,
    content: document.getElementById('content').value,
    tags: document.getElementById('tags').value,
    project: document.getElementById('project').value,
    priority: document.getElementById('priority').value,
    status: document.getElementById('status').value,
    reminderEnabled: document.getElementById('reminderEnabled').checked,
    reminderMode,
    reminderDateTime: document.getElementById('reminderDateTime').value,
    reminderMinutes: document.getElementById('reminderMinutes').value,
    attachments: pendingAttachments,
    editingId,
    savedAt: new Date().toISOString(),
  };
}

function saveDraft() {
  const state = getFormState();
  const empty = !state.title && !state.content && !state.attachments.length;
  if (empty) {
    localStorage.removeItem(DRAFT_KEY);
    document.getElementById('draftBanner').classList.remove('show');
    return;
  }
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); }
  catch { toast('草稿过大，请减少附件'); }
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 600);
}

function checkDraftBanner() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (draft && (draft.title || draft.content || draft.attachments?.length)) {
      document.getElementById('draftBanner').classList.add('show');
    }
  } catch {}
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (!draft) return;
    editingId = draft.editingId || null;
    currentType = draft.type || 'bug';
    document.getElementById('title').value = draft.title || '';
    document.getElementById('content').value = draft.content || '';
    document.getElementById('tags').value = draft.tags || '';
    document.getElementById('project').value = draft.project || '';
    document.getElementById('priority').value = draft.priority || 'mid';
    document.getElementById('status').value = draft.status || 'open';
    if (draft.reminderEnabled) {
      document.getElementById('reminderEnabled').checked = true;
      reminderMode = draft.reminderMode || 'absolute';
      document.querySelectorAll('.reminder-mode .mini-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === reminderMode));
      document.getElementById('reminderAbsoluteRow').classList.toggle('hidden', reminderMode !== 'absolute');
      document.getElementById('reminderRelativeRow').classList.toggle('hidden', reminderMode !== 'relative');
      document.getElementById('reminderDateTime').value = draft.reminderDateTime || defaultReminderDatetime();
      document.getElementById('reminderMinutes').value = draft.reminderMinutes || '30';
      document.getElementById('reminderPanel').classList.remove('hidden');
      updateReminderPreview();
    } else {
      resetReminderForm();
    }
    pendingAttachments = draft.attachments || draft.images || [];
    document.querySelectorAll('.pill').forEach(t =>
      t.classList.toggle('active', t.dataset.type === currentType));
    document.getElementById('submitBtn').textContent = editingId ? '更新留档' : '保存留档';
    updateBugTemplateBtn();
    renderPreviews();
    setContentTab('edit');
    document.getElementById('draftBanner').classList.remove('show');
    toast('草稿已恢复');
  } catch { toast('草稿恢复失败'); }
}

/* ── Attachments ── */
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file, 'UTF-8');
  });
}

const TEXT_EXTS = ['.txt', '.log', '.json', '.md', '.csv'];

function isTextFile(file) {
  if (file.type.startsWith('text/') || file.type === 'application/json') return true;
  const name = file.name.toLowerCase();
  return TEXT_EXTS.some(ext => name.endsWith(ext));
}

async function handleFiles(files) {
  for (const f of files) {
    if (f.size > 8 * 1024 * 1024) { toast(`${f.name} 超过 8MB`); continue; }
    if (f.type.startsWith('image/')) {
      pendingAttachments.push({ id: uid(), kind: 'image', name: f.name, data: await readFileAsDataURL(f) });
    } else if (isTextFile(f)) {
      pendingAttachments.push({ id: uid(), kind: 'text', name: f.name, data: await readFileAsText(f) });
    } else {
      toast(`不支持: ${f.name}`);
    }
  }
  renderPreviews();
  scheduleDraftSave();
}

function renderPreviews() {
  document.getElementById('previewGrid').innerHTML = pendingAttachments.map((a, i) => {
    if (a.kind === 'image') {
      return `<div class="preview-item"><img src="${a.data}"><button type="button" onclick="removePreview(${i})">×</button></div>`;
    }
    return `<div class="preview-item text-file">📄 ${esc(a.name)}<button type="button" onclick="removePreview(${i})">×</button></div>`;
  }).join('');
}

function removePreview(i) {
  pendingAttachments.splice(i, 1);
  renderPreviews();
  scheduleDraftSave();
}

function renderAttachmentsHtml(attachments, recordId) {
  const images = (attachments || []).filter(a => a.kind === 'image');
  const texts = (attachments || []).filter(a => a.kind === 'text');
  let html = '';
  if (images.length) {
    html += '<div class="card-images">' + images.map(a => {
      const src = a.data.replace(/'/g, "\\'");
      return `<img src="${a.data}" alt="${esc(a.name)}" onclick="openLightbox('${src}')">`;
    }).join('') + '</div>';
  }
  texts.forEach(a => {
    const preview = esc((a.data || '').slice(0, 500));
    html += `<details class="text-attachment">
      <summary>📄 ${esc(a.name)} (${(a.data||'').length} 字符)</summary>
      <pre>${preview}${(a.data||'').length > 500 ? '\n...' : ''}</pre>
      <span class="dl-btn" onclick="downloadTextAttachment('${recordId}','${a.id}')">下载文件</span>
    </details>`;
  });
  return html;
}

function downloadTextAttachment(recordId, attId) {
  const r = recordsCache.find(x => x.id === recordId);
  const a = r?.attachments?.find(x => x.id === attId);
  if (!a) return;
  const blob = new Blob([a.data], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = a.name;
  link.click();
}

/* ── Form ── */
function setType(type, btn) {
  currentType = type;
  document.querySelectorAll('.pill').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  updateBugTemplateBtn();
  scheduleDraftSave();
}

function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderView();
}

function resetForm(clearDraft = false) {
  document.getElementById('title').value = '';
  document.getElementById('content').value = '';
  document.getElementById('tags').value = '';
  document.getElementById('project').value = '';
  document.getElementById('priority').value = 'mid';
  document.getElementById('status').value = 'open';
  pendingAttachments = [];
  renderPreviews();
  editingId = null;
  document.getElementById('submitBtn').textContent = '保存留档';
  document.querySelectorAll('.pill').forEach(t => t.classList.toggle('active', t.dataset.type === 'bug'));
  currentType = 'bug';
  updateBugTemplateBtn();
  resetReminderForm();
  setContentTab('edit');
  if (clearDraft) {
    localStorage.removeItem(DRAFT_KEY);
    document.getElementById('draftBanner').classList.remove('show');
    toast('已清空');
  }
}

async function saveEntry(e) {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  if (!title) { toast('请填写标题'); return; }

  const now = new Date().toISOString();
  const project = ensureProject(document.getElementById('project').value);
  const status = document.getElementById('status').value;
  const reminderAt = computeReminderAtFromForm();
  if (document.getElementById('reminderEnabled').checked) {
    if (!reminderAt) { toast('请填写有效的提醒时间'); return; }
    if (new Date(reminderAt).getTime() <= Date.now()) { toast('提醒时间需晚于当前时间'); return; }
  }

  let existing = editingId ? recordsCache.find(r => r.id === editingId) : null;
  const history = existing ? [...(existing.history || [])] : [];

  if (existing) {
    history.unshift(snapshotRecord(existing));
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  }

  const record = {
    id: editingId || uid(),
    type: currentType,
    title,
    content: document.getElementById('content').value.trim(),
    project,
    tags: parseTags(document.getElementById('tags').value),
    priority: document.getElementById('priority').value,
    status,
    done: status === 'resolved',
    pinned: existing?.pinned || false,
    attachments: JSON.parse(JSON.stringify(pendingAttachments)),
    history,
    reminderAt: document.getElementById('reminderEnabled').checked ? reminderAt : null,
    reminderNotified: document.getElementById('reminderEnabled').checked
      ? (existing?.reminderAt === reminderAt ? !!existing?.reminderNotified : false)
      : false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const wasEdit = !!editingId;
  await persistRecord(record);
  localStorage.removeItem(DRAFT_KEY);
  document.getElementById('draftBanner').classList.remove('show');
  resetForm();
  toast(wasEdit ? '已更新（版本已存档）' : '已保存');
  renderView();
}

async function editEntry(id) {
  const r = recordsCache.find(x => x.id === id);
  if (!r) return;
  editingId = id;
  document.getElementById('title').value = r.title;
  document.getElementById('content').value = r.content;
  document.getElementById('tags').value = (r.tags || []).join(', ');
  document.getElementById('project').value = r.project || '';
  document.getElementById('priority').value = r.priority || 'mid';
  document.getElementById('status').value = r.status || 'open';
  pendingAttachments = JSON.parse(JSON.stringify(r.attachments || []));
  renderPreviews();
  currentType = r.type;
  document.querySelectorAll('.pill').forEach(t => t.classList.toggle('active', t.dataset.type === r.type));
  document.getElementById('submitBtn').textContent = '更新留档';
  updateBugTemplateBtn();
  setContentTab('edit');
  setReminderFormFromRecord(r);
  document.querySelector('.composer').scrollTop = 0;
  scheduleDraftSave();
}

async function toggleDone(id) {
  const r = recordsCache.find(x => x.id === id);
  if (!r) return;
  r.done = !r.done;
  r.status = r.done ? 'resolved' : 'open';
  if (r.done) {
    r.reminderAt = null;
    r.reminderNotified = false;
  }
  r.updatedAt = new Date().toISOString();
  await persistRecord(r);
  renderView();
}

async function togglePin(id) {
  const r = recordsCache.find(x => x.id === id);
  if (!r) return;
  r.pinned = !r.pinned;
  r.updatedAt = new Date().toISOString();
  await persistRecord(r);
  renderView();
}

async function updateStatus(id, status) {
  const r = recordsCache.find(x => x.id === id);
  if (!r || r.status === status) return;
  r.status = status;
  r.done = status === 'resolved';
  r.updatedAt = new Date().toISOString();
  await persistRecord(r);
  renderView();
}

async function deleteEntry(id) {
  if (!confirm('确定删除这条留档？')) return;
  await removeRecord(id);
  if (editingId === id) resetForm(true);
  renderView();
  toast('已删除');
}

function copyEntry(id) {
  const r = recordsCache.find(x => x.id === id);
  if (!r) return;
  const text = [
    `[${TYPE_LABELS[r.type]}] ${r.title}`,
    `项目: ${r.project} | 优先级: ${PRIORITY_LABELS[r.priority]} | 状态: ${STATUS_LABELS[r.status]}`,
    r.tags?.length ? `标签: ${r.tags.join(', ')}` : '',
    '', r.content,
  ].filter(Boolean).join('\n');
  navigator.clipboard.writeText(text).then(() => toast('已复制'));
}

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}

function toggleExpand(btn, id) {
  const body = document.getElementById('body-' + id);
  const collapsed = body.classList.toggle('collapsed');
  btn.textContent = collapsed ? '展开全文' : '收起';
}

/* ── Version history ── */
function openHistoryModal(id) {
  historyRecordId = id;
  const r = recordsCache.find(x => x.id === id);
  const body = document.getElementById('historyBody');
  if (!r?.history?.length) {
    body.innerHTML = '<p class="hint-text">暂无历史版本（编辑保存后会自动记录）</p>';
  } else {
    body.innerHTML = r.history.map((h, i) => `
      <div class="history-item">
        <div class="hist-time">版本 ${r.history.length - i} · ${formatDate(h.savedAt)}</div>
        <div class="hist-title">${esc(h.title)}</div>
        <div class="hist-preview">${esc((h.content || '').slice(0, 120))}</div>
        <div class="hist-actions">
          <button class="btn btn-soft btn-sm" onclick="restoreHistory(${i})">恢复此版本</button>
        </div>
      </div>`).join('');
  }
  document.getElementById('historyModal').classList.add('open');
}

function closeHistoryModal() {
  document.getElementById('historyModal').classList.remove('open');
  historyRecordId = null;
}

async function restoreHistory(index) {
  const r = recordsCache.find(x => x.id === historyRecordId);
  if (!r || !r.history[index]) return;
  if (!confirm('将当前内容替换为所选历史版本，并保存新版本快照？')) return;
  const h = r.history[index];
  r.history.unshift(snapshotRecord(r));
  if (r.history.length > MAX_HISTORY) r.history.length = MAX_HISTORY;
  Object.assign(r, {
    title: h.title, content: h.content, project: h.project,
    tags: h.tags, priority: h.priority, status: h.status,
    attachments: h.attachments || [],
    done: h.status === 'resolved',
    updatedAt: new Date().toISOString(),
  });
  await persistRecord(r);
  closeHistoryModal();
  renderView();
  toast('已恢复历史版本');
}

/* ── Filter & sort ── */
function getFilteredRecords() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const projectFilter = document.getElementById('filterProject').value;
  let records = [...recordsCache];

  if (currentFilter === 'done') records = records.filter(r => r.done);
  else if (currentFilter === 'pinned') records = records.filter(r => r.pinned);
  else if (currentFilter !== 'all') records = records.filter(r => r.type === currentFilter && !r.done);

  if (projectFilter) records = records.filter(r => r.project === projectFilter);

  if (q) {
    records = records.filter(r => {
      const tagStr = (r.tags || []).join(' ').toLowerCase();
      return r.title.toLowerCase().includes(q) ||
        r.content.toLowerCase().includes(q) ||
        (r.project || '').toLowerCase().includes(q) ||
        tagStr.includes(q);
    });
  }

  const sort = document.getElementById('sortBy').value;
  records.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    if (sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
    if (sort === 'updated') return new Date(b.updatedAt) - new Date(a.updatedAt);
    if (sort === 'priority') {
      const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return pd || (new Date(b.createdAt) - new Date(a.createdAt));
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return records;
}

function renderStats() {
  const counts = { bug: 0, todo: 0, req: 0, idea: 0, done: 0, total: recordsCache.length };
  recordsCache.forEach(r => { counts[r.type]++; if (r.done) counts.done++; });
  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="num">${counts.total}</div><div class="lbl">全部</div></div>
    <div class="stat-card bug"><div class="num">${counts.bug}</div><div class="lbl">Bug</div></div>
    <div class="stat-card todo"><div class="num">${counts.todo}</div><div class="lbl">待办</div></div>
    <div class="stat-card req"><div class="num">${counts.req}</div><div class="lbl">需求</div></div>
    <div class="stat-card idea"><div class="num">${counts.idea}</div><div class="lbl">灵感</div></div>
    <div class="stat-card done"><div class="num">${counts.done}</div><div class="lbl">已完成</div></div>`;
}

function renderList() {
  renderStats();
  const records = getFilteredRecords();
  const list = document.getElementById('cardList');

  if (!records.length) {
        list.innerHTML = `<div class="empty"><div class="empty-icon">○</div><p>暂无留档</p><p style="font-size:.76rem;margin-top:8px;color:var(--text-3)">在左侧创建第一条记录</p></div>`;
    return;
  }

  list.innerHTML = records.map(r => {
    const long = r.content && r.content.length > 200;
    const tags = (r.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('');
    const mdContent = renderMarkdown(r.content);
    return `
      <article class="card ${r.done ? 'done-card' : ''} ${r.pinned ? 'pinned' : ''}">
        <div class="card-header">
              <button class="pin-btn ${r.pinned ? 'active' : ''}" onclick="togglePin('${r.id}')" title="置顶">${r.pinned ? '◆' : '◇'}</button>
          <div class="card-title-wrap">
            <div class="card-title">${esc(r.title)}</div>
            ${r.project ? `<div class="card-project">📁 ${esc(r.project)}</div>` : ''}
          </div>
          <div class="card-badges">
            <span class="badge badge-${r.type}">${TYPE_LABELS[r.type]}</span>
            <span class="badge badge-${r.priority}">${PRIORITY_LABELS[r.priority]}</span>
            <span class="badge badge-status">${STATUS_LABELS[r.status]}</span>
            ${renderReminderBadge(r)}
            ${r.done ? '<span class="badge badge-done">已完成</span>' : ''}
          </div>
        </div>
        ${tags ? `<div class="tags-row">${tags}</div>` : ''}
        ${r.content ? `
          <div class="card-body md-rendered ${long ? 'collapsed' : ''}" id="body-${r.id}">${mdContent}</div>
          ${long ? `<button class="expand-btn" onclick="toggleExpand(this,'${r.id}')">展开全文</button>` : ''}
        ` : ''}
        ${renderAttachmentsHtml(r.attachments, r.id)}
        <div class="card-meta">
          <span>${formatDate(r.createdAt)}</span>
          ${(r.history||[]).length ? `<span>${r.history.length} 个历史版本</span>` : ''}
          <div class="card-actions">
            <button onclick="copyEntry('${r.id}')">复制</button>
            <button onclick="openHistoryModal('${r.id}')">历史</button>
            ${r.reminderAt && !r.reminderNotified && !r.done ? `<button onclick="clearRecordReminder('${r.id}')">取消提醒</button>` : ''}
            <button onclick="toggleDone('${r.id}')">${r.done ? '重开' : '完成'}</button>
            <button onclick="editEntry('${r.id}')">编辑</button>
            <button class="danger" onclick="deleteEntry('${r.id}')">删除</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

/* ── Kanban ── */
function renderKanban() {
  renderStats();
  const records = getFilteredRecords();
  const board = document.getElementById('kanbanBoard');

  board.innerHTML = KANBAN_COLS.map(col => {
    const items = records.filter(r => r.status === col.key);
    return `
      <div class="kanban-col" data-status="${col.key}"
        ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)" ondrop="kanbanDrop(event,'${col.key}')">
        <div class="kanban-col-header">${col.label} <span class="count">${items.length}</span></div>
        ${items.map(r => `
          <div class="kanban-card" draggable="true" data-id="${r.id}"
            ondragstart="kanbanDragStart(event,'${r.id}')" ondragend="kanbanDragEnd(event)">
            <div class="kanban-card-title">${r.pinned ? '◆ ' : ''}${esc(r.title)}</div>
            <div class="kanban-card-meta">
              <span class="badge badge-${r.type}">${TYPE_LABELS[r.type]}</span>
              <span class="badge badge-${r.priority}">${PRIORITY_LABELS[r.priority]}</span>
              ${r.project ? `<span>📁 ${esc(r.project)}</span>` : ''}
              ${renderReminderBadge(r)}
            </div>
          </div>`).join('') || '<p class="hint-text" style="padding:8px">拖拽卡片到此处</p>'}
      </div>`;
  }).join('');
}

function kanbanDragStart(e, id) {
  dragRecordId = id;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function kanbanDragEnd(e) {
  e.target.classList.remove('dragging');
  dragRecordId = null;
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
}

function kanbanDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function kanbanDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function kanbanDrop(e, status) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (dragRecordId) updateStatus(dragRecordId, status);
}

/* ── Export / Import ── */
function downloadJson(data, filename) {
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

async function exportData(silent) {
  const data = JSON.stringify(recordsCache, null, 2);
  const name = `留档备份_${new Date().toISOString().slice(0, 10)}.json`;
  downloadJson(data, name);
  if (!silent) toast('导出成功');
  return data;
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error();
      if (!confirm(`导入 ${imported.length} 条？（合并，不覆盖已有 ID）`)) return;
      const ids = new Set(recordsCache.map(r => r.id));
      const merged = [...recordsCache];
      for (const r of imported) {
        const norm = normalizeRecord(r);
        if (!ids.has(norm.id)) { merged.unshift(norm); ids.add(norm.id); }
      }
      await persistAll(merged);
      renderView();
      toast('导入完成');
    } catch { toast('导入失败'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

/* ── Auto export ── */
function checkAutoExport() {
  if (!settings.autoExport) return;
  const today = new Date().toISOString().slice(0, 10);
  if (settings.lastAutoExportDate === today) return;
  const hour = new Date().getHours();
  if (hour < settings.autoExportHour) return;
  settings.lastAutoExportDate = today;
  saveSettingsToDB();
  exportData(true);
  toast('每日自动备份已导出');
}

/* ── WebDAV sync ── */
async function webdavRequest(method, body) {
  const { webdavUrl, webdavUser, webdavPass, webdavPath } = settings;
  if (!webdavUrl || !webdavUser) throw new Error('请配置 WebDAV');

  const base = webdavUrl.replace(/\/$/, '');
  const path = webdavPath.startsWith('/') ? webdavPath : '/' + webdavPath;
  const url = base + path;

  if (window.electronAPI?.webdav) {
    return window.electronAPI.webdav({ method, url, user: webdavUser, pass: webdavPass, body });
  }

  const headers = {
    Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(webdavUser + ':' + webdavPass))),
  };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { method, headers, body });
  if (!res.ok) throw new Error(`WebDAV ${res.status}: ${res.statusText}`);
  if (method === 'GET') return res.text();
}

async function webdavPush() {
  const status = document.getElementById('syncStatus');
  status.textContent = '上传中...';
  try {
    const payload = JSON.stringify({ records: recordsCache, exportedAt: new Date().toISOString() }, null, 2);
    await webdavRequest('PUT', payload);
    status.textContent = `上传成功 · ${formatDate(new Date().toISOString())}`;
    toast('已同步到云端');
  } catch (e) {
    status.textContent = '上传失败: ' + e.message;
    toast('同步失败');
  }
}

async function webdavPull() {
  const status = document.getElementById('syncStatus');
  status.textContent = '拉取中...';
  try {
    const text = await webdavRequest('GET');
    const data = JSON.parse(text);
    const list = data.records || data;
    if (!Array.isArray(list)) throw new Error('格式错误');
    if (!confirm(`云端有 ${list.length} 条记录，合并到本地？`)) return;
    const ids = new Set(recordsCache.map(r => r.id));
    const merged = [...recordsCache];
    for (const r of list) {
      const norm = normalizeRecord(r);
      const existing = merged.find(x => x.id === norm.id);
      if (!existing) {
        merged.unshift(norm);
        ids.add(norm.id);
      } else if (new Date(norm.updatedAt) > new Date(existing.updatedAt)) {
        Object.assign(existing, norm);
      }
    }
    await persistAll(merged);
    renderView();
    status.textContent = `拉取成功 · ${formatDate(new Date().toISOString())}`;
    toast('云端数据已合并');
  } catch (e) {
    status.textContent = '拉取失败: ' + e.message;
    toast('拉取失败');
  }
}

/* ── Settings modal ── */
function openSettings() {
  document.getElementById('autoExportEnabled').checked = settings.autoExport;
  document.getElementById('autoExportHour').value = settings.autoExportHour;
  document.getElementById('webdavUrl').value = settings.webdavUrl;
  document.getElementById('webdavUser').value = settings.webdavUser;
  document.getElementById('webdavPass').value = settings.webdavPass;
  document.getElementById('webdavPath').value = settings.webdavPath;
  document.getElementById('autoSyncEnabled').checked = settings.autoSync;
  const trayEl = document.getElementById('minimizeToTrayEnabled');
  const topEl = document.getElementById('alwaysOnTopEnabled');
  const ballEl = document.getElementById('floatBallEnabled');
  if (trayEl) trayEl.checked = settings.minimizeToTray !== false;
  if (topEl) topEl.checked = !!settings.alwaysOnTop;
  if (ballEl) ballEl.checked = settings.floatBall !== false;
  document.getElementById('lastExportHint').textContent = settings.lastAutoExportDate
    ? `上次自动导出: ${settings.lastAutoExportDate}` : '尚未自动导出';
  refreshProjectUI();
  document.getElementById('settingsModal').classList.add('open');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

async function saveSettings() {
  settings.autoExport = document.getElementById('autoExportEnabled').checked;
  settings.autoExportHour = parseInt(document.getElementById('autoExportHour').value, 10);
  settings.webdavUrl = document.getElementById('webdavUrl').value.trim();
  settings.webdavUser = document.getElementById('webdavUser').value.trim();
  settings.webdavPass = document.getElementById('webdavPass').value;
  settings.webdavPath = document.getElementById('webdavPath').value.trim() || SYNC_FILE;
  settings.autoSync = document.getElementById('autoSyncEnabled').checked;
  const trayEl = document.getElementById('minimizeToTrayEnabled');
  const topEl = document.getElementById('alwaysOnTopEnabled');
  const ballEl = document.getElementById('floatBallEnabled');
  if (trayEl) settings.minimizeToTray = trayEl.checked;
  if (topEl) settings.alwaysOnTop = topEl.checked;
  if (ballEl) settings.floatBall = ballEl.checked;
  await saveSettingsToDB();
  await applyDesktopSettings();
  closeSettings();
  toast('设置已保存');
}

/* ── Event bindings ── */
function bindEvents() {
  const dropZone = document.getElementById('dropZone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  document.getElementById('content').addEventListener('paste', async e => {
    for (const item of (e.clipboardData?.items || [])) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await handleFiles([file]);
      }
    }
  });

  document.getElementById('content').addEventListener('input', () => {
    scheduleDraftSave();
    if (contentTab === 'preview') setContentTab('preview');
  });

  ['title', 'tags', 'project', 'priority', 'status', 'reminderDateTime', 'reminderMinutes'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', scheduleDraftSave);
    el.addEventListener('change', scheduleDraftSave);
  });

  document.getElementById('reminderDateTime').addEventListener('change', updateReminderPreview);
  document.getElementById('reminderMinutes').addEventListener('change', updateReminderPreview);

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      document.getElementById('entryForm').requestSubmit();
    }
  });

  window.addEventListener('beforeunload', e => {
    saveDraft();
    if (savePending) { e.preventDefault(); e.returnValue = ''; }
  });

  const hourSel = document.getElementById('autoExportHour');
  for (let h = 0; h < 24; h++) {
    hourSel.innerHTML += `<option value="${h}">${String(h).padStart(2,'0')}:00</option>`;
  }
  hourSel.value = settings.autoExportHour;
}

/* ── Init ── */
(async () => {
  await openDB();
  await loadSettings();
  await syncDesktopSettings();
  await migrateFromLocalStorage();
  await loadRecords();
  bindEvents();
  window.electronAPI?.onDataChanged?.(() => loadRecords().then(renderView));
  window.electronAPI?.onReminderFired?.(data => handleReminderFired(data?.id));
  window.addEventListener('capacitor-reminder-fired', e => handleReminderFired(e.detail?.id));
  window.electronAPI?.onDesktopSettings?.(async d => {
    settings.alwaysOnTop = d.alwaysOnTop;
    const ballChanged = settings.floatBall !== d.floatBall;
    settings.floatBall = d.floatBall;
    if (ballChanged) await saveSettingsToDB();
    const ballEl = document.getElementById('floatBallEnabled');
    if (ballEl) ballEl.checked = d.floatBall !== false;
  });
  refreshProjectUI();
  updateBugTemplateBtn();
  resetReminderForm();
  updateSaveStatus('saved');
  checkDraftBanner();
  renderView();
  checkAutoExport();
  setInterval(checkAutoExport, 60000);

  if (settings.autoSync && settings.webdavUrl && settings.webdavUser) {
    try { await webdavPull(); } catch {}
  }
})();
