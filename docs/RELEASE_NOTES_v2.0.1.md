# TODO Assistant · Android v2.0.1

**移动端显示修复 + 后台提醒可靠性加固**

发布日期：2026-06-25 · 分支：`android` · versionCode 3

---

## 亮点速览

本次为 v2.0.0 的修复与增强版，重点解决了 Android 端「打开后显示桌面布局」的关键问题，并加固了到点提醒在后台 / 被清理场景下的可靠性，同时让返回键更符合手机使用习惯。

### 🐞 关键修复：手机端不再显示桌面布局

v2.0.0 的 APK 在部分场景下会渲染成桌面版界面（顶部工具栏 + 内联表单），且界面风格回退为玻璃拟态。根因是脚本加载顺序导致移动端初始化前未标记 `is-mobile`。

- 现调整为 `mobile-ui.js` 在 `app.js` 之前注入并最先标记 `is-mobile`，稳定渲染移动端「极简杂志」风格。

### ↩️ Android 返回键智能返回

返回键不再一按就退出应用，按以下优先级处理：

1. 关闭录入弹层（新建 / 编辑 sheet）
2. 关闭设置 / 版本历史 / 图片预览浮层
3. 返回上一个标签页（列表 / 看板 / 统计 / 日历）
4. 已在主页顶层 → 最小化到后台（**不退出、进程保活**）

### 🔔 到点提醒后台可靠性加固

| 措施 | 说明 |
|------|------|
| `USE_EXACT_ALARM` | 提醒类用途，Android 13+ 系统自动授予，确保被清理 / Doze 下精确触发 |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` / `VIBRATE` | 配合电池白名单引导与震动提醒 |
| 一次性引导 | 首次开启提醒时提示电池白名单 / 自启动设置 |
| 设置页帮助 | 新增「提醒可靠性」排查说明 |

> 说明：本地通知走系统 `AlarmManager`，应用即使被划掉也能到点触发，无需常驻保活进程；可靠性主要取决于上述权限与厂商电池策略。

---

## 升级与安装

```bash
git checkout android
npm install
npm run cap:prepare
cd android && ./gradlew assembleRelease
```

产物：`android/app/build/outputs/apk/release/app-release.apk`

> 数据存储在本地 IndexedDB，增量安装（`adb install -r`）不会丢失既有留档。

---

## 校验

在 Android 模拟器（1080×2340 / density 440）验证：

- 移动端「极简杂志」风格正确渲染。
- 返回键：设置 → 返回关闭、看板 → 返回回到上一页、录入 sheet → 返回关闭、主页顶层 → 返回最小化（进程存活）。
- 新增依赖 `@capacitor/app`，原生通知调度链路正常。
