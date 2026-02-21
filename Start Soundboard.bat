@echo off
title Soundboard Server
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed. Download it from https://nodejs.org
    echo.
    pause
    exit /b
)

if not exist node_modules (
    echo First run — installing dependencies...
    npm install
    echo.
)

echo Starting Soundboard...
echo.
start "" http://localhost:3000
node server.js
pause
