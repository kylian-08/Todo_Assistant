/**
 * 移动端交互层（仅 Android/窄屏注入）
 * - 底部 Tab Bar 切换 列表/看板/统计
 * - FAB 打开全屏新建 sheet；编辑时复用同一 sheet
 * - 复用 app.js 的数据层（saveEntry / resetForm / editEntry / setViewMode / renderView / renderStats）
 * - 不影响桌面：本文件只在构建 Android 包时注入
 */
(function () {
  // 本文件仅注入到 Android 包，且在 app.js 之前加载：
  // 先打上 is-mobile，确保 app.js 初始化时按移动端风格(mobileStyle)应用外观
  document.documentElement.classList.add('is-mobile');
  if (!document.documentElement.getAttribute('data-mtab')) {
    document.documentElement.setAttribute('data-mtab', 'list');
  }

  let openingSheet = false;
  let booted = false;

  function isMobile() {
    return document.documentElement.classList.contains('is-mobile');
  }

  /* ---------- Sheet 控制 ---------- */
  function openSheet(title) {
    const sheet = document.getElementById('mSheet');
    const backdrop = document.getElementById('mSheetBackdrop');
    if (!sheet) return;
    document.getElementById('mSheetTitle').textContent = title || '新建留档';
    backdrop.classList.add('open');
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    const sheet = document.getElementById('mSheet');
    const backdrop = document.getElementById('mSheetBackdrop');
    if (!sheet) return;
    backdrop.classList.remove('open');
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
  }

  function openForNew() {
    openingSheet = true;
    try {
      // 无参 resetForm：重置字段但不弹「已清空」提示
      if (typeof window.resetForm === 'function') window.resetForm();
    } catch (e) {}
    openingSheet = false;
    const host = document.getElementById('mComposerHost');
    if (host) host.scrollTop = 0;
    openSheet('新建留档');
  }

  /* ============================================================
     日历视图
     ============================================================ */
  const TYPE_KEY = { bug: 'bug', todo: 'todo', req: 'req', idea: 'idea' };
  const TYPE_TEXT = { bug: 'Bug', todo: '待办', req: '需求', idea: '灵感' };
  const STATUS_TEXT = { open: '待处理', progress: '进行中', resolved: '已解决' };
  const calState = { view: startOfMonth(new Date()), selected: stripTime(new Date()) };

  function stripTime(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }
  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function toLocalInput(d) {
    if (typeof window.toDatetimeLocalValue === 'function') {
      return window.toDatetimeLocalValue(d);
    }
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
      d.getHours()
    )}:${pad2(d.getMinutes())}`;
  }

  function getRecords() {
    try {
      return Array.isArray(recordsCache) ? recordsCache : [];
    } catch (e) {
      return [];
    }
  }

  // 计划归属日期：优先提醒时间，否则创建时间
  function recordDate(r) {
    const raw = r.reminderAt || r.createdAt;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function recordsOnDay(day) {
    return getRecords()
      .filter((r) => {
        const d = recordDate(r);
        return d && sameDay(d, day);
      })
      .sort((a, b) => {
        const ta = new Date(a.reminderAt || a.createdAt).getTime();
        const tb = new Date(b.reminderAt || b.createdAt).getTime();
        return ta - tb;
      });
  }

  function renderCalendar() {
    const grid = document.getElementById('calGrid');
    const titleEl = document.getElementById('calTitle');
    if (!grid || !titleEl) return;

    const y = calState.view.getFullYear();
    const m = calState.view.getMonth();
    titleEl.textContent = `${y}年${m + 1}月`;

    const startDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = stripTime(new Date());

    let html = '';
    for (let i = 0; i < 42; i++) {
      const idx = i - startDay;
      let cellDate;
      let muted = false;
      if (idx < 0 || idx >= daysInMonth) {
        cellDate = new Date(y, m, idx + 1);
        muted = true;
      } else {
        cellDate = new Date(y, m, idx + 1);
      }
      const ds = stripTime(cellDate);
      const recs = recordsOnDay(ds);
      const types = [...new Set(recs.map((r) => TYPE_KEY[r.type]).filter(Boolean))].slice(0, 4);
      const dots = recs.length
        ? `<span class="cal-dot">${types
            .map((t) => `<i class="t-${t}"></i>`)
            .join('')}</span>`
        : '';
      const cls = [
        'cal-cell',
        muted ? 'muted' : '',
        sameDay(ds, today) ? 'today' : '',
        sameDay(ds, calState.selected) ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ');
      html += `<button type="button" class="${cls}" data-cal="${ds.getFullYear()}-${ds.getMonth()}-${ds.getDate()}">${cellDate.getDate()}${dots}</button>`;
    }
    grid.innerHTML = html;
  }

  function renderDayList() {
    const listEl = document.getElementById('calDayList');
    const titleEl = document.getElementById('calDayTitle');
    if (!listEl || !titleEl) return;

    const day = calState.selected;
    const today = stripTime(new Date());
    titleEl.textContent = sameDay(day, today)
      ? '今天 · ' + `${day.getMonth() + 1}月${day.getDate()}日`
      : `${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日`;

    const recs = recordsOnDay(day);
    if (!recs.length) {
      listEl.innerHTML = `<div class="cal-empty">这一天还没有计划，点「+ 新建计划」添加</div>`;
      return;
    }

    listEl.innerHTML = recs
      .map((r) => {
        const t = TYPE_KEY[r.type] || 'todo';
        const at = r.reminderAt ? new Date(r.reminderAt) : null;
        const time = at ? `${pad2(at.getHours())}:${pad2(at.getMinutes())}` : '全天';
        const sub = [TYPE_TEXT[r.type], STATUS_TEXT[r.status], r.project]
          .filter(Boolean)
          .join(' · ');
        return `
          <div class="cal-plan" data-edit="${r.id}">
            <span class="cal-plan-bar t-${t}"></span>
            <div class="cal-plan-main">
              <div class="cal-plan-title">${escapeHtml(r.title || '(无标题)')}</div>
              <div class="cal-plan-sub">${escapeHtml(sub)}</div>
            </div>
            <span class="cal-plan-time">${time}</span>
          </div>`;
      })
      .join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function refreshCalendar() {
    renderCalendar();
    renderDayList();
  }

  function selectDay(date) {
    calState.selected = stripTime(date);
    refreshCalendar();
  }

  // 从日历新建：打开 sheet 并预填选中日的提醒时间
  function openForNewOnDate(date) {
    openForNew();
    document.getElementById('mSheetTitle').textContent = '新建计划';
    const enabled = document.getElementById('reminderEnabled');
    const panel = document.getElementById('reminderPanel');
    const dt = document.getElementById('reminderDateTime');
    if (!enabled || !dt) return;

    const at = new Date(date);
    const now = new Date();
    if (sameDay(stripTime(at), stripTime(now))) {
      at.setTime(now.getTime() + 60 * 60 * 1000); // 今天默认 1 小时后
    } else {
      at.setHours(9, 0, 0, 0); // 其它日期默认 09:00
    }
    enabled.checked = true;
    panel && panel.classList.remove('hidden');
    dt.value = toLocalInput(at);
    window.updateReminderPreview && window.updateReminderPreview();
  }

  /* ============================================================
     看板：触屏无法用 HTML5 拖拽，改为状态切换条
     ============================================================ */
  const KSTATUS = [
    { k: 'open', l: '待处理' },
    { k: 'progress', l: '进行中' },
    { k: 'resolved', l: '已解决' },
  ];

  function enhanceKanban() {
    document.querySelectorAll('#kanbanBoard .kanban-card').forEach((card) => {
      if (card.querySelector('.kc-move')) return;
      const col = card.closest('.kanban-col');
      const cur = col ? col.dataset.status : '';
      const move = document.createElement('div');
      move.className = 'kc-move';
      move.innerHTML = KSTATUS.map(
        (s) =>
          `<button type="button" data-status="${s.k}" class="${
            s.k === cur ? 'cur' : ''
          }">${s.l}</button>`
      ).join('');
      card.appendChild(move);
    });
  }

  function bindKanban() {
    document.getElementById('kanbanBoard')?.addEventListener('click', (e) => {
      const moveBtn = e.target.closest('.kc-move button');
      if (moveBtn) {
        e.stopPropagation();
        const card = moveBtn.closest('.kanban-card');
        if (card && card.dataset.id) {
          window.updateStatus && window.updateStatus(card.dataset.id, moveBtn.dataset.status);
        }
        return;
      }
      const card = e.target.closest('.kanban-card');
      if (card && card.dataset.id) {
        window.editEntry && window.editEntry(card.dataset.id);
      }
    });
  }

  /* ---------- Tab 切换 ---------- */
  const tabHistory = [];

  function setTab(tab, fromBack) {
    const cur = document.documentElement.getAttribute('data-mtab');
    if (!fromBack && cur && cur !== tab) {
      tabHistory.push(cur);
      if (tabHistory.length > 20) tabHistory.shift();
    }
    document.documentElement.setAttribute('data-mtab', tab);
    document.querySelectorAll('.m-tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.mtab === tab)
    );
    if (tab === 'kanban') {
      window.setViewMode && window.setViewMode('kanban');
    } else if (tab === 'calendar') {
      refreshCalendar();
    } else {
      // list 与 stats 都用 list 数据渲染；stats 仅 CSS 切换显示统计卡
      window.setViewMode && window.setViewMode('list');
    }
    if (tab === 'stats') window.renderStats && window.renderStats();
    document.querySelector('.feed')?.scrollTo({ top: 0 });
  }

  /* ---------- 包裹 app.js 函数，联动 sheet ---------- */
  function hookAppFunctions() {
    const _resetForm = window.resetForm;
    if (typeof _resetForm === 'function' && !_resetForm.__mWrapped) {
      window.resetForm = function () {
        const r = _resetForm.apply(this, arguments);
        if (isMobile() && !openingSheet) {
          closeSheet();
          // 保存/删除后若停留在日历，刷新计划标记
          if (document.documentElement.getAttribute('data-mtab') === 'calendar') {
            refreshCalendar();
          }
        }
        return r;
      };
      window.resetForm.__mWrapped = true;
    }

    const _editEntry = window.editEntry;
    if (typeof _editEntry === 'function' && !_editEntry.__mWrapped) {
      window.editEntry = function () {
        openingSheet = true;
        const r = _editEntry.apply(this, arguments);
        openingSheet = false;
        if (isMobile()) openSheet('编辑留档');
        return r;
      };
      window.editEntry.__mWrapped = true;
    }

    const _renderKanban = window.renderKanban;
    if (typeof _renderKanban === 'function' && !_renderKanban.__mWrapped) {
      window.renderKanban = function () {
        const r = _renderKanban.apply(this, arguments);
        if (isMobile()) enhanceKanban();
        return r;
      };
      window.renderKanban.__mWrapped = true;
    }
  }

  /* ---------- 绑定移动端控件 ---------- */
  function bindControls() {
    document.querySelectorAll('.m-tab').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.mtab));
    });

    document.getElementById('mFab')?.addEventListener('click', openForNew);

    document.getElementById('mSheetCancel')?.addEventListener('click', () => {
      closeSheet();
      openingSheet = true;
      try {
        if (typeof window.resetForm === 'function') window.resetForm(true);
      } catch (e) {}
      openingSheet = false;
    });

    document.getElementById('mSheetSave')?.addEventListener('click', () => {
      const form = document.getElementById('entryForm');
      if (form) form.requestSubmit();
    });

    document.getElementById('mSheetBackdrop')?.addEventListener('click', () => {
      closeSheet();
    });

    document.getElementById('mThemeBtn')?.addEventListener('click', () => {
      window.toggleTheme && window.toggleTheme();
    });

    document.getElementById('mSettingsBtn')?.addEventListener('click', () => {
      window.openSettings && window.openSettings();
    });

    // 日历：月份切换
    document.getElementById('calPrev')?.addEventListener('click', () => {
      calState.view = new Date(calState.view.getFullYear(), calState.view.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById('calNext')?.addEventListener('click', () => {
      calState.view = new Date(calState.view.getFullYear(), calState.view.getMonth() + 1, 1);
      renderCalendar();
    });

    // 日历：点击日期格
    document.getElementById('calGrid')?.addEventListener('click', (e) => {
      const cell = e.target.closest('.cal-cell');
      if (!cell || !cell.dataset.cal) return;
      const [y, m, d] = cell.dataset.cal.split('-').map(Number);
      selectDay(new Date(y, m, d));
    });

    // 日历：点击当日计划 → 编辑
    document.getElementById('calDayList')?.addEventListener('click', (e) => {
      const plan = e.target.closest('.cal-plan');
      if (!plan || !plan.dataset.edit) return;
      window.editEntry && window.editEntry(plan.dataset.edit);
    });

    // 日历：新建计划（预填选中日提醒）
    document.getElementById('calAddBtn')?.addEventListener('click', () => {
      openForNewOnDate(calState.selected);
    });
  }

  /* ---------- 把桌面 composer 搬进 sheet ---------- */
  function relocateComposer() {
    const composer = document.querySelector('.composer');
    const host = document.getElementById('mComposerHost');
    if (composer && host && composer.parentElement !== host) {
      host.appendChild(composer);
    }
  }

  function enableMobile() {
    document.documentElement.classList.add('is-mobile');
    if (!document.documentElement.getAttribute('data-mtab')) {
      document.documentElement.setAttribute('data-mtab', 'list');
    }
    relocateComposer();
    // 重新套用外观：让 data-style 采用手机端风格
    window.applyAppearance && window.applyAppearance();
  }

  /* ---------- Android 返回键：关闭弹层 / 返回上一页，不直接退出 ---------- */
  function handleBack() {
    if (!isMobile()) return false;
    // 1. 底部录入 sheet
    const backdrop = document.getElementById('mSheetBackdrop');
    if (backdrop && backdrop.classList.contains('open')) {
      closeSheet();
      return true;
    }
    // 2. 设置 / 历史 / 图片预览（按显示优先级关闭，回到进入前的页面）
    const sm = document.getElementById('settingsModal');
    if (sm && sm.classList.contains('open')) {
      window.closeSettings ? window.closeSettings() : sm.classList.remove('open');
      return true;
    }
    const hm = document.getElementById('historyModal');
    if (hm && hm.classList.contains('open')) {
      window.closeHistoryModal ? window.closeHistoryModal() : hm.classList.remove('open');
      return true;
    }
    const lb = document.getElementById('lightbox');
    if (lb && lb.classList.contains('open')) {
      window.closeLightbox ? window.closeLightbox() : lb.classList.remove('open');
      return true;
    }
    // 3. 其它任意打开的浮层
    const anyOpen = document.querySelector('.modal-overlay.open');
    if (anyOpen) {
      anyOpen.classList.remove('open');
      return true;
    }
    // 4. 标签返回上一页
    const cur = document.documentElement.getAttribute('data-mtab') || 'list';
    if (tabHistory.length) {
      setTab(tabHistory.pop(), true);
      return true;
    }
    if (cur !== 'list') {
      setTab('list', true);
      return true;
    }
    // 5. 已在主页：返回 false，由原生最小化到后台（不退出）
    return false;
  }
  window.__mobileHandleBack = handleBack;

  function boot() {
    if (booted) return;
    booted = true;
    // app.js 的 init 是异步 IIFE，稍等其定义全局函数后再 hook
    const tryHook = () => {
      if (typeof window.resetForm === 'function') hookAppFunctions();
      else setTimeout(tryHook, 60);
    };
    bindControls();
    bindKanban();
    // 本文件仅注入到 Android 包中，运行环境必为移动端，恒启用移动 UI
    enableMobile();
    tryHook();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
