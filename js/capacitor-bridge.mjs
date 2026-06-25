import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';

const TYPE_LABELS = { bug: 'Bug', todo: '待办', req: '需求', idea: '灵感' };

function reminderNotificationId(recordId) {
  let h = 0;
  for (let i = 0; i < recordId.length; i++) {
    h = ((h << 5) - h + recordId.charCodeAt(i)) | 0;
  }
  const id = Math.abs(h) % 2147483646;
  return id || 1;
}

function recordIdFromNotificationId(nid, list) {
  for (const item of list) {
    if (reminderNotificationId(item.id) === nid) return item.id;
  }
  return null;
}

let lastSyncList = [];

async function ensurePermission() {
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display === 'granted') return true;
  const req = await LocalNotifications.requestPermissions();
  return req.display === 'granted';
}

async function sync(list) {
  if (!Capacitor.isNativePlatform()) return;
  lastSyncList = list || [];

  if (!(await ensurePermission())) return;

  const pending = await LocalNotifications.getPending();
  const keepIds = new Set(list.map(item => reminderNotificationId(item.id)));
  const cancel = (pending.notifications || [])
    .filter(n => !keepIds.has(n.id))
    .map(n => ({ id: n.id }));

  if (cancel.length) await LocalNotifications.cancel({ notifications: cancel });

  const now = Date.now();
  const toSchedule = [];

  for (const item of list) {
    const at = new Date(item.reminderAt).getTime();
    if (Number.isNaN(at) || at <= now) continue;
    const label = TYPE_LABELS[item.type] || item.type;
    toSchedule.push({
      id: reminderNotificationId(item.id),
      title: 'TODO Assistant · 提醒',
      body: `[${label}] ${item.title}`,
      schedule: { at: new Date(at) },
      sound: 'default',
      smallIcon: 'ic_stat_todo',
      extra: { recordId: item.id },
    });
  }

  if (toSchedule.length) {
    await LocalNotifications.schedule({ notifications: toSchedule });
  }
}

function dispatchFired(recordId) {
  if (!recordId) return;
  window.dispatchEvent(new CustomEvent('capacitor-reminder-fired', { detail: { id: recordId } }));
}

function setupListeners() {
  LocalNotifications.addListener('localNotificationReceived', notification => {
    const rid = notification.extra?.recordId
      || recordIdFromNotificationId(notification.id, lastSyncList);
    dispatchFired(rid);
  });

  LocalNotifications.addListener('localNotificationActionPerformed', action => {
    const rid = action.notification.extra?.recordId
      || recordIdFromNotificationId(action.notification.id, lastSyncList);
    dispatchFired(rid);
  });
}

/* 返回键：优先关闭弹层 / 返回上一页，最后最小化到后台（不退出） */
function setupBackButton() {
  App.addListener('backButton', () => {
    let handled = false;
    try {
      handled = !!(window.__mobileHandleBack && window.__mobileHandleBack());
    } catch (e) {
      handled = false;
    }
    if (!handled) {
      // 顶层返回：最小化到后台而不是退出，保留提醒与状态
      App.minimizeApp();
    }
  });
}

/* 首次开启提醒时的可靠性引导（仅原生、仅一次） */
function maybeShowReminderTips() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (localStorage.getItem('reminderTipsShown') === '1') return;
    localStorage.setItem('reminderTipsShown', '1');
  } catch (e) {}
  const msg =
    '为确保到点准时提醒（即使应用在后台或被清理）：\n\n' +
    '1. 已申请「精确闹钟」权限，系统会按时唤醒；\n' +
    '2. 建议在 系统设置 → 应用 → TODO Assistant → 电池 中，\n' +
    '   选择「无限制 / 允许后台活动」；\n' +
    '3. 小米 / 华为 / OPPO / vivo 等机型，请在「自启动管理」\n' +
    '   里允许本应用自启动。\n\n' +
    '（该提示只出现一次，可在「设置 → 提醒可靠性」再次查看）';
  setTimeout(() => {
    try { window.alert(msg); } catch (e) {}
  }, 200);
}

async function init() {
  if (!Capacitor.isNativePlatform()) return;
  setupListeners();
  setupBackButton();
  await ensurePermission();
}

window.capacitorReminders = { sync, init, isNative: () => Capacitor.isNativePlatform() };
window.maybeShowReminderTips = maybeShowReminderTips;
init();
