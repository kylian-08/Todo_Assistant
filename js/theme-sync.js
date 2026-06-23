/** 主题同步（主窗口 / 悬浮球 / 悬浮面板） */
async function loadThemeFromDB() {
  return new Promise(resolve => {
    const req = indexedDB.open('LiudangDB', 2);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) { resolve('light'); return; }
      const r = db.transaction('settings', 'readonly').objectStore('settings').get('app');
      r.onsuccess = () => resolve(r.result?.value?.theme || 'light');
      r.onerror = () => resolve('light');
    };
    req.onerror = () => resolve('light');
  });
}

function applyDocumentTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

function initThemeSync() {
  loadThemeFromDB().then(applyDocumentTheme);
  window.electronAPI?.onThemeChanged?.(t => applyDocumentTheme(t));
}

const THEME_ICONS = {
  light: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`,
  dark: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
};

function updateThemeButton(theme) {
  const btn = document.getElementById('themeBtn');
  if (!btn) return;
  btn.title = theme === 'dark' ? '切换浅色模式' : '切换深色模式';
  btn.innerHTML = theme === 'dark' ? THEME_ICONS.dark : THEME_ICONS.light;
}
