# 留档助手 (Liudang Assistant)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

本地 Bug / 待办 / 需求 / 灵感留档工具，支持 Markdown、看板、WebDAV 同步与 Electron 桌面版（系统托盘、悬浮球、快捷面板）。

## 功能

- 留档类型：Bug、待办、需求、灵感
- 自动保存草稿、版本历史、置顶与完成状态
- 列表 / 看板视图，Markdown 编辑与预览
- 图片与文本附件、Bug 模板、JSON 导入导出
- WebDAV 同步（如坚果云）
- Electron 桌面版：系统托盘、悬浮球、快速留档面板、深色模式

## 快速开始

### 开发运行

```bash
npm install
npm start
```

### 打包 Windows 可执行文件

```bash
npm run build
```

输出目录：`dist/win-unpacked/LiudangAssistant.exe`

也可双击 `构建EXE.bat` 进行打包并生成 ZIP。

### 浏览器版

直接用浏览器打开 `index.html` 即可使用（不含 Electron 托盘/悬浮球功能）。

## 技术栈

- 前端：HTML / CSS / JavaScript（IndexedDB）
- 桌面：Electron 33 + electron-builder

## 许可证

[MIT](LICENSE)
