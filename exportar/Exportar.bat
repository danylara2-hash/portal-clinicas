@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Exportar-TIMON.ps1" %*
echo.
pause
