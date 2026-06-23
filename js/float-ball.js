/** 悬浮球：左键主窗口 · 长按快速新增 · 右键菜单 · 拖动移动 */
const LONG_PRESS_MS = 480;
const MOVE_THRESHOLD = 3;

let dragStart = null;
let moved = false;
let suppressClick = false;
let longPressTimer = null;
let longPressTriggered = false;

const ball = document.getElementById('floatBall');
const ballWrap = document.getElementById('ballWrap');
const badge = document.getElementById('ballBadge');

async function updateBadge() {
  try {
    const open = indexedDB.open('LiudangDB', 2);
    open.onsuccess = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('records')) return;
      const req = db.transaction('records', 'readonly').objectStore('records').getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        const openCount = list.filter(r => r.status !== 'resolved' && !r.done).length;
        if (openCount > 0) {
          badge.textContent = openCount > 99 ? '99+' : openCount;
          badge.classList.add('show');
        } else {
          badge.classList.remove('show');
        }
      };
    };
  } catch {}
}

function clearLongPressTimer() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function resetPressVisual() {
  ball.classList.remove('pressing', 'long-press-pulse');
}

function endInteraction() {
  clearLongPressTimer();
  resetPressVisual();
  if (moved || longPressTriggered) suppressClick = true;
  dragStart = null;
  const delay = longPressTriggered ? 200 : 50;
  setTimeout(() => {
    moved = false;
    suppressClick = false;
    longPressTriggered = false;
  }, delay);
}

ballWrap.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  dragStart = { x: e.screenX, y: e.screenY };
  moved = false;
  longPressTriggered = false;
  clearLongPressTimer();
  ball.classList.add('pressing');
  longPressTimer = setTimeout(() => {
    if (!moved && dragStart) {
      longPressTriggered = true;
      resetPressVisual();
      ball.classList.add('long-press-pulse');
      setTimeout(() => ball.classList.remove('long-press-pulse'), 320);
      window.electronAPI?.showFloatPanel();
    }
  }, LONG_PRESS_MS);
});

window.addEventListener('mousemove', e => {
  if (!dragStart) return;
  const dx = e.screenX - dragStart.x;
  const dy = e.screenY - dragStart.y;
  if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
    clearLongPressTimer();
    resetPressVisual();
    moved = true;
    window.electronAPI?.floatBallDrag(dx, dy);
    dragStart.x = e.screenX;
    dragStart.y = e.screenY;
  }
});

window.addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  if (!dragStart && !longPressTimer) return;
  endInteraction();
});

ball.addEventListener('click', e => {
  e.stopPropagation();
  if (suppressClick || moved || longPressTriggered) return;
  window.electronAPI?.showMainWindow();
});

ballWrap.addEventListener('contextmenu', e => {
  e.preventDefault();
  e.stopPropagation();
  clearLongPressTimer();
  resetPressVisual();
  dragStart = null;
  moved = false;
  window.electronAPI?.showFloatBallMenu();
});

initThemeSync();
window.electronAPI?.onDataChanged?.(() => updateBadge());
updateBadge();
setInterval(updateBadge, 30000);
