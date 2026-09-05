@echo off
title FieldTrack
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Get the LTS version from https://nodejs.org,
  echo   install it, then double-click START.bat again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo.
  echo   First run - installing. This takes a few minutes.
  echo.
  call npm install || (echo Install failed. & pause & exit /b 1)
)
node setup.js
node server.js
pause
