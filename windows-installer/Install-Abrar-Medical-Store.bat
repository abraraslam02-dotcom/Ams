@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Abrar Medical Store - Windows Desktop Installer

echo ============================================================================
echo   ABRAR MEDICAL STORE (AMS) - WINDOWS DESKTOP ^& LOCAL SERVER INSTALLER
echo ============================================================================
echo.

:: 1. Verify Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
  echo [INFO] Node.js is not installed yet. Attempting automatic LTS install via winget...
  where winget >nul 2>&1
  if not errorlevel 1 (
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
  )
)

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ACTION REQUIRED] Node.js LTS could not be auto-installed.
  echo Please download and install Node.js LTS from: https://nodejs.org/
  echo After installing Node.js, double-click Install-Abrar-Medical-Store.bat again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
echo [OK] Found Node.js %NODE_VER%

:: 2. Determine permanent App & Database directories
set "SRC_DIR=%~dp0"
if "%SRC_DIR:~-1%"=="\" set "SRC_DIR=%SRC_DIR:~0,-1%"

set "APP_DIR=C:\AbrarMedicalStore\App"
mkdir "%APP_DIR%" >nul 2>&1
if not exist "%APP_DIR%" (
  set "APP_DIR=%LOCALAPPDATA%\AbrarMedicalStore\App"
  mkdir "!APP_DIR!" >nul 2>&1
)

if exist "D:\" (
  set "DATA_ROOT=D:\AbrarMedicalStore"
) else (
  set "DATA_ROOT=C:\AbrarMedicalStore"
)
set "DB_DIR=%DATA_ROOT%\Database"
set "BACKUP_DIR=%DATA_ROOT%\Backups"

mkdir "%DB_DIR%" >nul 2>&1
mkdir "%BACKUP_DIR%" >nul 2>&1

echo [OK] App Folder     : %APP_DIR%
echo [OK] Database Folder: %DB_DIR%
echo [OK] Backup Folder  : %BACKUP_DIR%
echo.

:: 3. Copy application files safely (without overwriting user database)
echo [STEP 1/5] Copying application files to %APP_DIR%...
robocopy "%SRC_DIR%" "%APP_DIR%" /E /XD node_modules seed /NFL /NDL /NJH /NJS /NC /NS /NP >nul
if errorlevel 8 (
  echo [ERROR] Failed to copy application files. Please check folder permissions.
  pause
  exit /b 1
)

:: 4. Preserve existing Windows database OR initialize from bundled snapshot
echo [STEP 2/5] Verifying local SQLite database...
set "TARGET_DB=%DB_DIR%\ams_medical.db"
if exist "%TARGET_DB%" (
  echo [SAFE] Existing database detected at "%TARGET_DB%".
  echo        All existing sales, purchases, stock, ledgers, and records are 100%% preserved.
) else (
  if exist "%SRC_DIR%\seed\ams_medical.db" (
    copy /Y "%SRC_DIR%\seed\ams_medical.db" "%TARGET_DB%" >nul
    echo [OK] Installed your live store database snapshot to "%TARGET_DB%".
  ) else (
    echo [WARN] No bundled seed database found; a clean schema will initialize on first boot.
  )
)

:: Configure Local-First Offline Mode by default if operating mode file does not exist
set "MODE_FILE=%DB_DIR%\ams_operating_mode.json"
if not exist "%MODE_FILE%" (
  if exist "%SRC_DIR%\seed\ams_operating_mode.json" (
    copy /Y "%SRC_DIR%\seed\ams_operating_mode.json" "%MODE_FILE%" >nul
  ) else (
    > "%MODE_FILE%" (
      echo {
      echo   "mode": "OFFLINE",
      echo   "dDriveConfiguredFolder": "%BACKUP_DIR:=\%",
      echo   "manualControlOnly": true
      echo }
    )
  )
  echo [OK] Configured Local-First OFFLINE MODE (0 cloud quota limits; optional Cloud Sync anytime).
)

:: Write .env pointing to the verified permanent Database and Backup directories
> "%APP_DIR%\.env" (
  echo NODE_ENV=production
  echo PORT=3000
  echo DATABASE_PATH=%TARGET_DB%
  echo BACKUP_DIRECTORY=%BACKUP_DIR%
  echo APP_TIMEZONE=Asia/Karachi
  echo APP_CURRENCY=PKR
)

:: 5. Install Node.js dependencies and build frontend if dist is missing
echo [STEP 3/5] Installing runtime dependencies (this may take 1-2 minutes)...
pushd "%APP_DIR%"
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [ERROR] npm install failed. Please check your internet connection and retry.
  popd
  pause
  exit /b 1
)

if not exist "%APP_DIR%\dist\index.html" (
  echo [STEP 4/5] Building frontend UI bundle...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Frontend build failed.
    popd
    pause
    exit /b 1
  )
) else (
  echo [STEP 4/5] Pre-built frontend UI verified.
)
popd

:: 6. Create Desktop & Start Menu shortcuts
echo [STEP 5/5] Creating Desktop and Start Menu shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desk = [Environment]::GetFolderPath('Desktop'); " ^
  "$menu = [Environment]::GetFolderPath('Programs'); " ^
  "foreach ($dir in @($desk, $menu)) { " ^
  "  $s = $ws.CreateShortcut((Join-Path $dir 'Abrar Medical Store POS.lnk')); " ^
  "  $s.TargetPath = '%APP_DIR%\Start-Abrar-Medical-Store.bat'; " ^
  "  $s.WorkingDirectory = '%APP_DIR%'; " ^
  "  if (Test-Path '%APP_DIR%\favicon.ico') { $s.IconLocation = '%APP_DIR%\favicon.ico,0'; } " ^
  "  $s.WindowStyle = 7; " ^
  "  $s.Description = 'Abrar Medical Store - Local Desktop POS & ERP'; " ^
  "  $s.Save(); " ^
  "}"

echo.
echo ============================================================================
echo   INSTALLATION COMPLETE!
echo ============================================================================
echo   Desktop Shortcut : Abrar Medical Store POS
echo   App Directory    : %APP_DIR%
echo   Database File    : %TARGET_DB%
echo   Backups Folder   : %BACKUP_DIR%
echo   Local Mode       : OFFLINE (Instant speed, ZERO Firestore quota limits)
echo ============================================================================
echo.
echo Starting Abrar Medical Store POS now...
call "%APP_DIR%\Start-Abrar-Medical-Store.bat"
exit /b 0
