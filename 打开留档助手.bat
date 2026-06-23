@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if not errorlevel 1 if exist "node_modules\electron" (
  start "" cmd /c "cd /d "%~dp0" && npm start"
  exit /b 0
)

start "" "%~dp0index.html"
