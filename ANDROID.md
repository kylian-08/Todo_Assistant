# Android 版构建指南

`android` 分支在 **Capacitor** 基础上复用现有 Web 代码，打包为 Android APK，并支持**系统通知提醒**（应用退到后台仍可触发）。

> **main** 分支：Windows Electron 桌面版  
> **android** 分支：Android 移动版（Capacitor）

---

## 环境要求

| 工具 | 版本建议 |
|------|----------|
| [Node.js](https://nodejs.org/) | 18+ |
| [Android Studio](https://developer.android.com/studio) | 最新稳定版 |
| Android SDK | API 33+ |
| JDK | 17（Android Studio 自带） |

安装 Android Studio 后，打开 **SDK Manager** 勾选：
- Android SDK Platform 33+
- Android SDK Build-Tools
- Android SDK Platform-Tools

设置环境变量（可选）：

```bash
ANDROID_HOME=C:\Users\<你>\AppData\Local\Android\Sdk
```

---

## 快速开始

```bash
git checkout android
npm install

# 1. 同步 Web 资源到 www/ 并打包 Capacitor 桥接
npm run cap:prepare

# 2. 首次：添加 Android 工程（只需一次）
npm run cap:add:android

# 3. 同步原生工程
npm run cap:sync

# 4. 用 Android Studio 打开并运行
npm run cap:open:android
```

在 Android Studio 中点击 **Run ▶** 即可安装到手机或模拟器。

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run cap:prepare` | 复制静态资源 + 构建 Capacitor 通知桥接 |
| `npm run cap:sync` | prepare 后同步到 `android/` |
| `npm run cap:open:android` | 打开 Android Studio |
| `npm run cap:run:android` | 命令行构建并安装（需配置 SDK） |

---

## 功能差异（相对桌面版）

| 功能 | Android | Windows 桌面 |
|------|---------|--------------|
| 留档 / 看板 / Markdown | ✅ | ✅ |
| 定时提醒 | ✅ 系统通知 | ✅ Windows 通知 |
| 系统托盘 / 悬浮球 | ❌ | ✅ |
| WebDAV / 导入导出 | ✅ | ✅ |

---

## 打包 Release APK

1. Android Studio → **Build → Generate Signed Bundle / APK**
2. 选择 **APK**，创建或选择 keystore
3. 构建 `release` 变体

或使用命令行（需先配置签名）：

```bash
cd android
./gradlew assembleRelease
```

输出：`android/app/build/outputs/apk/release/`

---

## 项目结构（Android 相关）

```
TODO_Assistant/
├── capacitor.config.json    # Capacitor 配置
├── www/                     # 构建产物（cap:prepare 生成，勿手改）
├── android/                 # Android 原生工程（cap add 生成）
├── js/capacitor-bridge.mjs  # 通知桥接源码
└── scripts/sync-www.js      # 静态资源同步脚本
```

---

## 故障排查

**通知不弹出**
- 在手机设置中允许「TODO Assistant」通知权限
- 部分国产 ROM 需开启「自启动 / 后台运行」

**`cap:sync` 失败**
- 确认已运行 `npm run cap:prepare`
- 确认 `www/index.html` 存在

**Gradle 下载慢**
- 在 Android Studio 配置国内 Maven 镜像，或使用代理

---

## 作者

[kylian-08](https://github.com/kylian-08)
