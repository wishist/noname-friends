@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "friends-server\stop-tunnel.ps1"
pause
