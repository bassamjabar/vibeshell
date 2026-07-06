@echo off
rem Double-click to launch VibeShell.
cd /d "%~dp0"
start "" /min cmd /c "npx electron ."
