@echo off
setlocal EnableExtensions
title Abrar Medical Store - Launcher

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
cd /d "%APP_DIR%"

:: Check if server is already listening on port 3000
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/version.json' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  echo Starting Abrar Medical Store local server on http://localhost:3000 ...
  if exist "%APP_DIR%\node_modules\.bin\tsx.cmd" (
    start "Abrar Medical Store Server" /MIN cmd /c "cd /d ""%APP_DIR%"" && set NODE_ENV=production && ""%APP_DIR%\node_modules\.bin\tsx.cmd"" server.ts"
  ) else (
    start "Abrar Medical Store Server" /MIN cmd /c "cd /d ""%APP_DIR%"" && set NODE_ENV=production && node server.ts"
  )

  :: Wait up to 20 seconds for server readiness
  for /L %%i in (1,1,20) do (
    timeout /t 1 /nobreak >nul
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/version.json' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
    if not errorlevel 1 goto :SERVER_READY
  )
)

:SERVER_READY
:: Launch Chrome or Edge in Standalone POS App Window mode
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if defined BROWSER (
  start "" "%BROWSER%" --app=http://localhost:3000
) else (
  start "" http://localhost:3000
)
exit /b 0
