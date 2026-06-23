@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   留档助手 - 构建 Windows EXE
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js
  pause
  exit /b 1
)

if not exist "node_modules\electron-builder" (
  echo 正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败
    pause
    exit /b 1
  )
)

echo [1/2] 打包绿色版（无需联网下载 NSIS）...
call npm run build
if errorlevel 1 (
  echo [错误] 打包失败
  pause
  exit /b 1
)

echo.
echo [2/2] 创建 ZIP 压缩包...
if exist "dist\LiudangAssistant-1.0.0-win-x64.zip" del /f "dist\LiudangAssistant-1.0.0-win-x64.zip"
powershell -NoProfile -Command "Compress-Archive -Path 'dist\win-unpacked\*' -DestinationPath 'dist\LiudangAssistant-1.0.0-win-x64.zip' -Force"
if errorlevel 1 (
  echo [警告] ZIP 创建失败，可直接使用绿色版文件夹
) else (
  echo ZIP 已创建
)

echo.
echo 复制启动脚本...
copy /y "启动留档助手.bat" "dist\win-unpacked\启动留档助手.bat" >nul

echo.
echo ========================================
echo   构建完成！
echo ========================================
echo.
echo 直接运行:
echo   dist\win-unpacked\LiudangAssistant.exe
echo   dist\win-unpacked\启动留档助手.bat
echo.
echo 分发压缩包:
echo   dist\LiudangAssistant-1.0.0-win-x64.zip
echo.
echo 如需安装版，网络畅通时运行: npm run build:installer
echo.
explorer "dist\win-unpacked"
pause
