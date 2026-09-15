@echo off
title Voxaria AI Orchestrator - MusicBot Launcher

:: =============================================================================
:: Voxaria AI Orchestrator - MusicBot Service Launcher
:: =============================================================================
:: Starts MusicBot API and/or Voxaria Orchestrator with crash protection
:: 
:: Usage:
::   start.bat                 - Interactive menu
::   start.bat --musicbot      - Start MusicBot API only
::   start.bat --orchestrator  - Start Voxaria Orchestrator only
::   start.bat --both          - Start both services in separate windows
::   start.bat --pm2           - Start via PM2 (daemon mode)
:: =============================================================================

setlocal enabledelayedexpansion

for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "GREEN=%ESC%[92m"
set "YELLOW=%ESC%[93m"
set "RED=%ESC%[91m"
set "CYAN=%ESC%[96m"
set "RESET=%ESC%[0m"

set "MUSICBOT_DIR=%~dp0"
set "ORCHESTRATOR_DIR=%~dp0..\voxaria-orchestrator"
set "BOT_ROOT=%~dp0.."

:: Function: Print banner
:print_banner
cls
echo %CYAN%==================================================================%RESET%
echo %CYAN%   VOXARIA AI ORCHESTRATOR - MUSICBOT LAUNCHER                  %RESET%
echo %CYAN%==================================================================%RESET%
echo %CYAN%   MusicBot API      : http://localhost:3002                     %RESET%
echo %CYAN%   Orchestrator API  : http://localhost:3001                     %RESET%
echo %CYAN%   Ngrok Tunnel      : https://unhitched-shrink-dorsal.ngrok-free.dev%RESET%
echo %CYAN%   Frontend (Lovable): https://voxaria.lovable.app               %RESET%
echo %CYAN%==================================================================%RESET%
echo.
goto :eof

:: Function: Check prerequisites
:check_prereqs
echo %YELLOW%[CHECK] Verifying prerequisites...%RESET%

node --version >nul 2>&1
if errorlevel 1 (
    echo %RED%[ERROR] Node.js not found in PATH%RESET%
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set "NODE_VER=%%i"
echo %GREEN%[OK] Node.js %NODE_VER% found%RESET%

redis-cli ping >nul 2>&1
if errorlevel 1 (
    echo %YELLOW%[WARN] Redis not responding on localhost:6379%RESET%
    echo %YELLOW%       Starting Docker Redis...%RESET%
    docker run -d -p 6379:6379 redis:7-alpine >nul 2>&1
    timeout /t 3 >nul
    redis-cli ping >nul 2>&1
    if errorlevel 1 (
        echo %RED%[ERROR] Failed to start Redis%RESET%
        exit /b 1
    )
)
echo %GREEN%[OK] Redis running on 6379%RESET%

if not exist "%MUSICBOT_DIR%\.env" (
    echo %RED%[ERROR] .env not found in MusicBot directory%RESET%
    exit /b 1
)
if not exist "%ORCHESTRATOR_DIR%\.env" (
    echo %RED%[ERROR] .env not found in Orchestrator directory%RESET%
    exit /b 1
)
echo %GREEN%[OK] Environment files present%RESET%

:: Clean orphan database at repo root
if exist "%BOT_ROOT%\voxaria.db" (
    echo %YELLOW%[CLEAN] Removing orphan database at %BOT_ROOT%\voxaria.db%RESET%
    del /f /q "%BOT_ROOT%\voxaria.db" >nul 2>&1
)

echo.
goto :eof

:: Function: Start MusicBot API
:start_musicbot
echo %CYAN%[START] Launching MusicBot API on port 3002...%RESET%
cd /d "%MUSICBOT_DIR%"

if /i "%~1"=="--pm2" (
    echo %YELLOW%[PM2] Starting MusicBot via PM2...%RESET%
    pm2 start "%MUSICBOT_DIR%\ecosystem.config.js" --only voxaria-api
    goto :eof
)

:musicbot_loop
echo %YELLOW%[RUN] node index.js (PID: %RANDOM%)%RESET%
node index.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo %RED%[CRASH] MusicBot exited with code %EXIT_CODE% at %TIME%%RESET%
echo %YELLOW%[RESTART] Restarting in 5 seconds... (Press Ctrl+C to stop)%RESET%
timeout /t 5 >nul
goto :musicbot_loop

:: Function: Start Voxaria Orchestrator
:start_orchestrator
echo %CYAN%[START] Launching Voxaria Orchestrator on port 3001...%RESET%
cd /d "%ORCHESTRATOR_DIR%"

if /i "%~1"=="--pm2" (
    echo %YELLOW%[PM2] Starting Orchestrator via PM2...%RESET%
    pm2 start "%MUSICBOT_DIR%\ecosystem.config.js" --only voxaria-orchestrator
    goto :eof
)

:orchestrator_loop
echo %YELLOW%[RUN] node src/index.js (PID: %RANDOM%)%RESET%
node src/index.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo %RED%[CRASH] Orchestrator exited with code %EXIT_CODE% at %TIME%%RESET%
echo %YELLOW%[RESTART] Restarting in 5 seconds... (Press Ctrl+C to stop)%RESET%
timeout /t 5 >nul
goto :orchestrator_loop

:: Function: Start both services
:start_both
echo %CYAN%[START] Launching complete Voxaria stack...%RESET%
echo.

:: Start Orchestrator in background window
start "Voxaria Orchestrator" cmd /k "%~f0" --orchestrator

timeout /t 2 >nul

:: Start MusicBot in this window (with crash loop)
call :start_musicbot

goto :eof

:: Function: PM2 Status
:pm2_status
echo %CYAN%[PM2] Process status:%RESET%
pm2 status
echo.
goto :eof

:: =============================================================================
:: MAIN ENTRY POINT
:: =============================================================================

call :print_banner
call :check_prereqs

if "%~1"=="" (
    :: Interactive menu
    :menu
    echo %CYAN%Select startup mode:%RESET%
    echo.
    echo   1) MusicBot API only (port 3002)
    echo   2) Voxaria Orchestrator only (port 3001)
    echo   3) Both services (this window = MusicBot, new window = Orchestrator)
    echo   4) Both services via PM2 (daemon mode, no console windows)
    echo   5) Show PM2 status
    echo   6) Exit
    echo.
    set /p "CHOICE=Enter choice [1-6]: "
    
    if "%CHOICE%"=="1" call :start_musicbot & goto :pause_end
    if "%CHOICE%"=="2" call :start_orchestrator & goto :pause_end
    if "%CHOICE%"=="3" call :start_both & goto :pause_end
    if "%CHOICE%"=="4" (
        echo %YELLOW%[PM2] Starting both services via PM2...%RESET%
        cd /d "%MUSICBOT_DIR%"
        pm2 start "%MUSICBOT_DIR%\ecosystem.config.js"
        call :pm2_status
        goto :pause_end
    )
    if "%CHOICE%"=="5" call :pm2_status & goto :menu
    if "%CHOICE%"=="6" goto :exit_clean
    echo %RED%[ERROR] Invalid choice%RESET%
    timeout /t 2 >nul
    goto :menu
) else (
    :: Command-line mode
    if /i "%~1"=="--musicbot" call :start_musicbot %~2
    if /i "%~1"=="--orchestrator" call :start_orchestrator %~2
    if /i "%~1"=="--both" call :start_both
    if /i "%~1"=="--pm2" (
        cd /d "%MUSICBOT_DIR%"
        pm2 start "%MUSICBOT_DIR%\ecosystem.config.js"
        call :pm2_status
    )
    if /i "%~1"=="--status" call :pm2_status
)

:pause_end
echo.
echo %GREEN%[READY] Services running. Press Ctrl+C to stop.%RESET%
echo.

:exit_clean
echo %CYAN%[EXIT] Launcher terminated.%RESET%
pause