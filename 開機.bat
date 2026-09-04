@echo off
chcp 65001 >nul
title 買餸小幫手
cd /d "%~dp0"
echo.
echo   正在開機... 開好之後唔好熄咗呢個黑色視窗
echo.
node server.js
if errorlevel 1 (
  echo.
  echo   開唔到。檢查下有冇裝 Node.js: https://nodejs.org
  pause
)
