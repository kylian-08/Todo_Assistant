import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

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

async function init() {
  if (!Capacitor.isNativePlatform()) return;
  setupListeners();
  await ensurePermission();
}

window.capacitorReminders = { sync, init, isNative: () => Capacitor.isNativePlatform() };
init();
