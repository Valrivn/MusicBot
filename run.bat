@echo off
title Voxaria Quick Start

:: =============================================================================
:: Voxaria Quick Start - One-click launcher for the complete stack
:: =============================================================================
:: Starts both MusicBot and Orchestrator with crash protection
:: No menu - just runs. Press Ctrl+C in the MusicBot window to stop all.
:: =============================================================================

setlocal enabledelayedexpansion

for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "GREEN=%ESC%[92m"
set "YELLOW=%ESC%[93m"
set "RED=%ESC%[91m"
set "CYAN=%ESC%[96m"
set "RESET=%ESC%[0m"

set "BOT_ROOT=C:\Bot"
set "MUSICBOT_DIR=%BOT_ROOT%\MusicBot"
set "ORCHESTRATOR_DIR=%BOT_ROOT%\voxaria-orchestrator"

cls
echo %CYAN%==================================================================%RESET%
echo %CYAN%  VOXARIA QUICK START - Starting full stack...                %RESET%
echo %CYAN%==================================================================%RESET%
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo %RED%[ERROR] Node.js not found in PATH%RESET%
    pause
    exit /b 1
)

:: Check Redis
redis-cli ping >nul 2>&1
if errorlevel 1 (
    echo %YELLOW%[REDIS] Starting Docker Redis...%RESET%
    docker run -d -p 6379:6379 redis:7-alpine >nul 2>&1
    timeout /t 3 >nul
)

:: Clean orphan database
if exist "%BOT_ROOT%\voxaria.db" (
    del /f /q "%BOT_ROOT%\voxaria.db" >nul 2>&1
)

:: Start Orchestrator in new window
echo %GREEN%[1/2] Starting Voxaria Orchestrator (port 3001)...%RESET%
start "Voxaria Orchestrator" cmd /k "cd /d %ORCHESTRATOR_DIR% && title Voxaria Orchestrator && node src/index.js"

:: Wait for orchestrator
timeout /t 3 >nul

:: Start MusicBot in this window (with crash loop)
echo %GREEN%[2/2] Starting MusicBot API (port 3002)...%RESET%
cd /d "%MUSICBOT_DIR%"

:loop
node index.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo %RED%[CRASH] MusicBot exited with code %EXIT_CODE% at %TIME%%RESET%
echo %YELLOW%[RESTART] Restarting in 5 seconds... (Ctrl+C to stop)%RESET%
timeout /t 5 >nul
goto :loop