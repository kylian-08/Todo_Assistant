# TODO Assistant · Android ADB 冒烟测试
# 用法: powershell -ExecutionPolicy Bypass -File scripts/adb-smoke-test.ps1

$ErrorActionPreference = "Stop"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH = "$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"

$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$APK  = Join-Path $ROOT "dist\TODO_Assistant-android-release.apk"
$SHOT = Join-Path $ROOT "dist\adb-smoke"
New-Item -ItemType Directory -Force -Path $SHOT | Out-Null

function Require-Adb {
  if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw "adb 未找到，请确认 Android SDK platform-tools 已安装"
  }
}

function Wait-Boot {
  param([int]$TimeoutSec = 180)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    Start-Sleep -Seconds 3
    $serial = (adb devices | Select-String "device$" | Select-Object -First 1)
    if (-not $serial) { Write-Host "[adb] 等待设备..."; continue }
    $boot = (adb shell getprop sys.boot_completed 2>$null).Trim()
    if ($boot -eq "1") { Write-Host "[adb] 设备已就绪: $serial"; return }
    Write-Host "[adb] 等待开机完成..."
  } while ((Get-Date) -lt $deadline)
  throw "模拟器/设备在 ${TimeoutSec}s 内未就绪"
}

function Screenshot {
  param([string]$Name)
  $path = Join-Path $SHOT "$Name.png"
  adb exec-out screencap -p > $path
  Write-Host "[shot] $path"
}

function Tap {
  param([int]$X, [int]$Y, [string]$Label = "", [switch]$Double)
  if ($Label) { Write-Host "[tap] $Label ($X,$Y)" }
  adb shell input tap $X $Y
  if ($Double) {
    Start-Sleep -Milliseconds 150
    adb shell input tap $X $Y
  }
  Start-Sleep -Milliseconds 700
}

Require-Adb

# 1) 若无设备则启动 AVD
$devices = @(adb devices | Select-String "device$")
if ($devices.Count -eq 0) {
  Write-Host "[adb] 未检测到设备，启动 TodoAssistant 模拟器..."
  Start-Process -FilePath "emulator" -ArgumentList "-avd","TodoAssistant","-no-audio","-no-boot-anim","-gpu","swiftshader_indirect" -WindowStyle Minimized
  Wait-Boot
}

# 2) 安装 APK
if (-not (Test-Path $APK)) { throw "找不到 APK: $APK`n请先运行 npm run cap:sync 并 gradlew assembleRelease" }
Write-Host "[adb] 安装 $APK"
adb install -r $APK | Write-Host

# 3) 启动应用（WebView 需约 8–10 秒加载，否则会白屏）
adb shell am force-stop com.kylian.todoassistant
adb shell am start -n com.kylian.todoassistant/.MainActivity
Write-Host "[adb] 等待 WebView 加载 10s..."
Start-Sleep -Seconds 10
Screenshot "01-launched"

# 4) 模拟点击（坐标基于 1080×2340 / Pixel 5 AVD）
Tap 600 240 "看板切换"
adb shell input swipe 540 1900 540 600 500
Start-Sleep -Seconds 1
Screenshot "02-kanban-scrolled"

Tap 480 240 "回到列表"
Tap 350 175 "类型-待办" -Double
Screenshot "03-type-todo"

Tap 780 240 "主题切换"
Screenshot "04-theme"

Tap 920 240 "设置"
Start-Sleep -Seconds 1
Screenshot "05-settings"
adb shell input keyevent KEYCODE_BACK

Tap 540 720 "标题输入框"
adb shell input text "adb_smoke_test"
adb shell input keyevent KEYCODE_BACK
Screenshot "06-title-filled"

Write-Host ""
Write-Host "完成。截图目录: $SHOT"
Write-Host "常用命令:"
Write-Host "  adb devices"
Write-Host "  adb shell am start -n com.kylian.todoassistant/.MainActivity"
Write-Host "  adb shell input tap X Y"
Write-Host "  adb shell input swipe X1 Y1 X2 Y2 300"
Write-Host "  adb exec-out screencap -p > dist/screen.png"
Write-Host "  adb logcat -s Capacitor chromium"
