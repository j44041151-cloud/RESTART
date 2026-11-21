@echo off
title RE:START - A Bounce Back Game
cd /d "%~dp0"
echo.
echo   Starting RE:START...
echo   A small local server will open the game in your browser.
echo   Keep this window open while you play. Close it to stop the server.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 (
  echo.
  echo   Could not start the game server.
  pause
)
