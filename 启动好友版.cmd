@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或更新版本。
  pause
  exit /b 1
)
echo 无名杀 · 同袍 正在启动
echo 游戏页面将在服务就绪后自动打开。
echo 若此窗口正在运行服务，请保持窗口打开。
node friends-server/launch.mjs
if errorlevel 1 pause
