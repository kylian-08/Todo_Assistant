# 更新日志 · Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.0] - 2026-06-25 · 移动端重构 + 统一外观系统

> Android 分支重大更新：全新的移动端交互、三套可切换界面风格、自定义背景，以及原生定时提醒与日历。

### ✨ 新增

- **统一外观系统（桌面 + 移动通用）**
  - **明暗主题**：浅色 / 深色 / 跟随系统，跟随系统会实时响应系统切换。
  - **界面风格**：玻璃拟态 / 极简杂志 / 扁平素色，桌面与移动端可各自独立选择。
  - **自定义背景**：上传背景图（自动压缩），可调节背景模糊度、透明度与底色，桌面与移动端同时生效。
  - 所有外观设置即时预览并持久化到本地（IndexedDB）。
- **全新移动端交互架构**
  - 底部 Tab Bar（列表 / 看板 / 日历 / 统计）+ 右下角 FAB 新建。
  - 底部弹出式（bottom-sheet）录入表单，贴合手机操作习惯。
  - 看板卡片改用「状态切换按钮」替代不适配触屏的 HTML5 拖拽。
  - 日历视图：标记有计划的日期，点击日期查看 / 直接新建当日计划。
- **Android 原生定时提醒**：通过 Capacitor Local Notifications 在到期时推送系统通知。
- **发布构建**：Android release 签名配置（`keystore.properties`，已 gitignore）、Gradle 下载加速。

### 🔧 优化与修复

- 修复移动端按钮点击无响应 / 错位 / 双击等触摸问题，改用事件委托与合规触摸目标尺寸。
- 修复列表卡片标题在窄屏下被挤压成竖排文字的问题。
- 移动端空状态文案改为贴合手机的引导提示。
- 日历页隐藏冗余 FAB，避免遮挡内容。
- 桌面与移动样式彻底分离（`css/mobile.css` 仅在 `html.is-mobile` 时生效），互不影响。

### 🧰 工程

- 新增 `js/mobile-ui.js`、`mobile/shell.html`，由 `scripts/sync-www.js` 在构建时注入。
- 新增 ADB 自动化冒烟 / 按钮测试脚本（`scripts/adb-*.ps1`）。
- 版本号升至 `2.0.0`（versionCode 2）。

---

## [1.0.0] - 初始发布

- 四类留档（Bug / 待办 / 需求 / 灵感）、Markdown、附件、列表 + 看板、版本历史、草稿。
- 定时提醒、JSON / WebDAV 同步、Electron 桌面增强（托盘 / 悬浮球 / 快捷面板 / 深色模式）。

[2.0.0]: https://github.com/kylian-08/TODO_Assistant/tree/android
[1.0.0]: https://github.com/kylian-08/TODO_Assistant/releases
