@echo off
rem SPDX-License-Identifier: GPL-3.0-only
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先从 https://nodejs.org/ 安装 Node.js 22.12 或更新版本，建议 Node.js 24 LTS。
  pause
  exit /b 1
)
echo 首次准备需要联网安装依赖和构建。准备成功后将启动好友版。
node scripts/setup-friends.mjs %*
if errorlevel 1 pause
