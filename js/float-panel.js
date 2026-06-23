/** 悬浮面板 - 快速留档 */
const TYPE_LABELS = { bug: 'Bug', todo: '待办', req: '需求', idea: '灵感' };
let quickType = 'bug';
let db = null;

function toast(msg) {
  const el = document.getElementById('panelToast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('LiudangDB', 2);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function dbPut(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readonly');
    const req = tx.objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function normalizeRecord(r) {
  return {
    id: r.id || uid(),
    type: r.type || 'bug',
    title: r.title || '',
    content: r.content || '',
    project: r.project || '默认项目',
    attachments: r.attachments || r.images || [],
    tags: r.tags || [],
    priority: r.priority || 'mid',
    status: r.status || 'open',
    done: false,
    pinned: !!r.pinned,
    history: r.history || [],
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: r.updatedAt || new Date().toISOString(),
  };
}

function switchTab(tab, btn) {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tabQuick').classList.toggle('hidden', tab !== 'quick');
  document.getElementById('tabRecent').classList.toggle('hidden', tab !== 'recent');
  if (tab === 'recent') loadRecent();
}

function setQuickType(type, btn) {
  quickType = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function quickSave() {
  const title = document.getElementById('qTitle').value.trim();
  if (!title) { toast('请填写标题'); return; }
  const now = new Date().toISOString();
  const record = normalizeRecord({
    type: quickType,
    title,
    content: document.getElementById('qContent').value.trim(),
    project: document.getElementById('qProject').value.trim() || '默认项目',
    createdAt: now,
    updatedAt: now,
  });
  await dbPut(record);
  window.electronAPI?.notifyDataChanged();
  document.getElementById('qTitle').value = '';
  document.getElementById('qContent').value = '';
  toast('已保存');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadRecent() {
  const list = document.getElementById('recentList');
  const records = (await dbGetAll()).map(normalizeRecord);
  records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const top = records.slice(0, 15);
  if (!top.length) {
    list.innerHTML = '<div class="recent-empty">暂无留档</div>';
    return;
  }
  list.innerHTML = top.map(r => `
    <div class="recent-item" onclick="openMain()">
      <div class="recent-item-title">${esc(r.title)}</div>
      <div class="recent-item-meta">
        <span>${TYPE_LABELS[r.type]}</span>
        <span>${esc(r.project)}</span>
        <span>${formatDate(r.createdAt)}</span>
      </div>
    </div>`).join('');
}

function openMain() { window.electronAPI?.showMainWindow(); }
function hidePanel() { window.electronAPI?.hideFloatPanel(); }

document.getElementById('btnClose').onclick = hidePanel;
document.getElementById('btnMain').onclick = openMain;

initThemeSync();

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    quickSave();
  }
});

window.electronAPI?.onDataChanged?.(() => {
  if (!document.getElementById('tabRecent').classList.contains('hidden')) loadRecent();
});

openDB().then(() => loadRecent());
