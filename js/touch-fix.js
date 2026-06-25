/**
 * Android WebView 触控修复：解决第一次点击无效、点 A 触发 B 的问题。
 * 仅在 touch 环境启用；通过 touchend + elementFromPoint 确保命中视觉上的按钮。
 */
(function () {
  const touch =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  if (!touch) return;

  document.documentElement.classList.add('touch-env');

  const SELECTOR =
    'button, .chip, .pill, .seg-btn, .icon-btn, .text-btn, .mini-seg-btn, .expand-btn, .pin-btn, .modal-x, .draft-banner button, .card-actions button, .content-tabs button, .dl-btn';

  let startX = 0;
  let startY = 0;
  let moved = false;
  let lastHandledAt = 0;
  let lastHandledEl = null;

  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      moved = false;
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 1) return;
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dx > 12 || dy > 12) moved = true;
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    'touchend',
    (e) => {
      if (moved || e.changedTouches.length !== 1) return;

      const t = e.changedTouches[0];
      const hit = document.elementFromPoint(t.clientX, t.clientY);
      const btn = hit?.closest(SELECTOR);
      if (!btn || btn.disabled) return;
      if (btn.closest('input, textarea, select, label')) return;

      const now = Date.now();
      if (btn === lastHandledEl && now - lastHandledAt < 350) return;

      e.preventDefault();
      lastHandledAt = now;
      lastHandledEl = btn;
      btn.click();
    },
    { passive: false, capture: true }
  );

  const mo = new MutationObserver(() => {
    document.querySelectorAll('.card-actions button:not([type])').forEach((b) => {
      b.type = 'button';
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
