import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';
import { config } from '../config.ts';
import { getDatabase, isDatabaseOpen } from '../db/connection.ts';

function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

export function generateInstallBatContent(): string {
  return toCrlf(`@echo off
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
    if exist "%ProgramFiles%\\nodejs\\node.exe" set "PATH=%ProgramFiles%\\nodejs;%PATH%"
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
if "%SRC_DIR:~-1%"=="\\" set "SRC_DIR=%SRC_DIR:~0,-1%"

set "APP_DIR=C:\\AbrarMedicalStore\\App"
mkdir "%APP_DIR%" >nul 2>&1
if not exist "%APP_DIR%" (
  set "APP_DIR=%LOCALAPPDATA%\\AbrarMedicalStore\\App"
  mkdir "!APP_DIR!" >nul 2>&1
)

if exist "D:\\" (
  set "DATA_ROOT=D:\\AbrarMedicalStore"
) else (
  set "DATA_ROOT=C:\\AbrarMedicalStore"
)
set "DB_DIR=%DATA_ROOT%\\Database"
set "BACKUP_DIR=%DATA_ROOT%\\Backups"

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
set "TARGET_DB=%DB_DIR%\\ams_medical.db"
if exist "%TARGET_DB%" (
  echo [SAFE] Existing database detected at "%TARGET_DB%".
  echo        All existing sales, purchases, stock, ledgers, and records are 100%% preserved.
) else (
  if exist "%SRC_DIR%\\seed\\ams_medical.db" (
    copy /Y "%SRC_DIR%\\seed\\ams_medical.db" "%TARGET_DB%" >nul
    echo [OK] Installed your live store database snapshot to "%TARGET_DB%".
  ) else (
    echo [WARN] No bundled seed database found; a clean schema will initialize on first boot.
  )
)

:: Configure Local-First Offline Mode by default if operating mode file does not exist
set "MODE_FILE=%DB_DIR%\\ams_operating_mode.json"
if not exist "%MODE_FILE%" (
  if exist "%SRC_DIR%\\seed\\ams_operating_mode.json" (
    copy /Y "%SRC_DIR%\\seed\\ams_operating_mode.json" "%MODE_FILE%" >nul
  ) else (
    > "%MODE_FILE%" (
      echo {
      echo   "mode": "OFFLINE",
      echo   "dDriveConfiguredFolder": "%BACKUP_DIR:\=\\%",
      echo   "manualControlOnly": true
      echo }
    )
  )
  echo [OK] Configured Local-First OFFLINE MODE (0 cloud quota limits; optional Cloud Sync anytime).
)

:: Write .env pointing to the verified permanent Database and Backup directories
> "%APP_DIR%\\.env" (
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

if not exist "%APP_DIR%\\dist\\index.html" (
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
  "  $s.TargetPath = '%APP_DIR%\\Start-Abrar-Medical-Store.bat'; " ^
  "  $s.WorkingDirectory = '%APP_DIR%'; " ^
  "  if (Test-Path '%APP_DIR%\\favicon.ico') { $s.IconLocation = '%APP_DIR%\\favicon.ico,0'; } " ^
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
call "%APP_DIR%\\Start-Abrar-Medical-Store.bat"
exit /b 0
`);
}

export function generateStartBatContent(): string {
  return toCrlf(`@echo off
setlocal EnableExtensions
title Abrar Medical Store - Launcher

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\\" set "APP_DIR=%APP_DIR:~0,-1%"
cd /d "%APP_DIR%"

:: Check if server is already listening on port 3000
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/version.json' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  echo Starting Abrar Medical Store local server on http://localhost:3000 ...
  if exist "%APP_DIR%\\node_modules\\.bin\\tsx.cmd" (
    start "Abrar Medical Store Server" /MIN cmd /c "cd /d ""%APP_DIR%"" && set NODE_ENV=production && ""%APP_DIR%\\node_modules\\.bin\\tsx.cmd"" server.ts"
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
if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" set "BROWSER=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"

if defined BROWSER (
  start "" "%BROWSER%" --app=http://localhost:3000
) else (
  start "" http://localhost:3000
)
exit /b 0
`);
}

export function generateStopBatContent(): string {
  return toCrlf(`@echo off
setlocal
echo Stopping Abrar Medical Store Server on port 3000...
powershell -NoProfile -Command ^
  "$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; " ^
  "foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo Server stopped cleanly.
timeout /t 2 >nul
exit /b 0
`);
}

export function generateReadmeTxtContent(): string {
  return toCrlf(`ABRAR MEDICAL STORE (AMS) — WINDOWS INSTALLATION GUIDE
====================================================

WHAT IS INCLUDED IN THIS INSTALLER PACKAGE?
-------------------------------------------
1. Install-Abrar-Medical-Store.bat  -> 1-Click Windows Setup & Shortcut Creator
2. Start-Abrar-Medical-Store.bat    -> Starts Local Server & Opens POS Desktop Window
3. Stop-Abrar-Medical-Store.bat     -> Cleanly Stops the Local Server
4. seed/ams_medical.db              -> Verified snapshot of your current store database

HOW TO INSTALL ON WINDOWS 10 / 11
---------------------------------
Step 1: Right-click this .zip file -> Extract All... to a folder (e.g. Desktop\\AMS-Setup).
Step 2: Double-click "Install-Abrar-Medical-Store.bat".
        (If Windows SmartScreen asks, click "More info" -> "Run anyway".)
Step 3: The installer automatically:
        - Verifies Node.js (installs Node.js LTS via winget if missing)
        - Copies the application to C:\\AbrarMedicalStore\\App
        - Protects any existing D:\\AbrarMedicalStore\\Database\\ams_medical.db
          (or copies your live database snapshot if no DB exists yet)
        - Configures Local-First OFFLINE MODE so you NEVER hit Firestore daily quota limits
        - Creates "Abrar Medical Store POS" on your Windows Desktop & Start Menu

DAILY USE
---------
- Double-click the "Abrar Medical Store POS" icon on your Desktop.
- Backups are saved directly to D:\\AbrarMedicalStore\\Backups (or C:\\AbrarMedicalStore\\Backups).
- You can still click "Sync Cloud Now" in System Settings anytime you want to push a cloud backup.
`);
}

export function generateCloudShortcutBatContent(appUrl: string): string {
  const safeUrl = String(appUrl || 'http://localhost:3000').replace(/["^&|<>]/g, '');
  return toCrlf(`@echo off
setlocal EnableExtensions
title Abrar Medical Store - Windows Desktop Shortcut Installer

set "TARGET_URL=${safeUrl}"
echo Creating Windows Desktop and Start Menu shortcuts for Abrar Medical Store...
echo Target URL: %TARGET_URL%

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desk = [Environment]::GetFolderPath('Desktop'); " ^
  "$menu = [Environment]::GetFolderPath('Programs'); " ^
  "$pf = [Environment]::GetFolderPath('ProgramFiles'); " ^
  "$pf86 = [Environment]::GetFolderPath('ProgramFilesX86'); " ^
  "$localApp = [Environment]::GetFolderPath('LocalApplicationData'); " ^
  "$candidates = @((Join-Path $pf 'Google\\Chrome\\Application\\chrome.exe'), (Join-Path $pf86 'Google\\Chrome\\Application\\chrome.exe'), (Join-Path $localApp 'Google\\Chrome\\Application\\chrome.exe'), (Join-Path $pf86 'Microsoft\\Edge\\Application\\msedge.exe'), (Join-Path $pf 'Microsoft\\Edge\\Application\\msedge.exe')); " ^
  "$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1; " ^
  "foreach ($dir in @($desk, $menu)) { " ^
  "  $s = $ws.CreateShortcut((Join-Path $dir 'Abrar Medical Store POS.lnk')); " ^
  "  if ($browser) { " ^
  "    $s.TargetPath = $browser; " ^
  "    $s.Arguments = '--app=' + '%TARGET_URL%'; " ^
  "    $s.IconLocation = $browser + ',0'; " ^
  "  } else { " ^
  "    $s.TargetPath = '%TARGET_URL%'; " ^
  "  } " ^
  "  $s.Description = 'Abrar Medical Store - POS & Accounting System'; " ^
  "  $s.Save(); " ^
  "}"

echo.
echo [OK] Desktop shortcut "Abrar Medical Store POS" created!
start "" "%TARGET_URL%"
pause
exit /b 0
`);
}

/**
 * Ensures /windows-installer/ scripts exist in the repository root and builds
 * a verified, non-destructive Windows Installer ZIP in a temporary file.
 */
export function writeRepoWindowsInstallerScripts(): void {
  const installerDir = path.resolve(process.cwd(), 'windows-installer');
  if (!fs.existsSync(installerDir)) {
    fs.mkdirSync(installerDir, { recursive: true });
  }
  fs.writeFileSync(path.join(installerDir, 'Install-Abrar-Medical-Store.bat'), generateInstallBatContent(), 'utf8');
  fs.writeFileSync(path.join(installerDir, 'Start-Abrar-Medical-Store.bat'), generateStartBatContent(), 'utf8');
  fs.writeFileSync(path.join(installerDir, 'Stop-Abrar-Medical-Store.bat'), generateStopBatContent(), 'utf8');
  fs.writeFileSync(path.join(installerDir, 'README-WINDOWS-INSTALL.txt'), generateReadmeTxtContent(), 'utf8');
}

export async function buildWindowsFullInstallerZip(): Promise<{
  zipPath: string;
  filename: string;
  cleanup: () => void;
}> {
  const rootDir = process.cwd();
  const stageDir = path.join(path.dirname(config.databasePath), `ams_win_installer_${Date.now()}`);
  const zipPath = `${stageDir}.zip`;

  fs.mkdirSync(stageDir, { recursive: true });
  fs.mkdirSync(path.join(stageDir, 'seed'), { recursive: true });

  // 1. Write Windows launcher & installer scripts
  fs.writeFileSync(path.join(stageDir, 'Install-Abrar-Medical-Store.bat'), generateInstallBatContent(), 'utf8');
  fs.writeFileSync(path.join(stageDir, 'Start-Abrar-Medical-Store.bat'), generateStartBatContent(), 'utf8');
  fs.writeFileSync(path.join(stageDir, 'Stop-Abrar-Medical-Store.bat'), generateStopBatContent(), 'utf8');
  fs.writeFileSync(path.join(stageDir, 'README-WINDOWS-INSTALL.txt'), generateReadmeTxtContent(), 'utf8');

  // 2. Write default OFFLINE operating mode template for local Windows zero-quota operation
  fs.writeFileSync(
    path.join(stageDir, 'seed', 'ams_operating_mode.json'),
    JSON.stringify(
      {
        mode: 'OFFLINE',
        switchedAt: new Date().toISOString(),
        switchedBy: 'Windows Installer',
        localBackupStatus: 'Not Run',
        dDriveBackupStatus: 'Not Run',
        dDriveConfiguredFolder: 'D:\\AbrarMedicalStore\\Backups',
        cloudSyncStatus: 'Not Run',
        pendingLocalChangesCount: 0,
        manualControlOnly: true,
        quotaExhausted: false,
        quotaCooldownUntilMs: 0,
      },
      null,
      2
    ),
    'utf8'
  );

  // 3. Create a safe read-only verified snapshot of the current database via VACUUM INTO
  const seedDbPath = path.join(stageDir, 'seed', 'ams_medical.db');
  if (isDatabaseOpen()) {
    const db = getDatabase();
    try {
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch {
      // ignore
    }
    const escaped = seedDbPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}';`);
  } else if (fs.existsSync(config.databasePath)) {
    const srcDb = new Database(config.databasePath, { readonly: true });
    try {
      await srcDb.backup(seedDbPath);
    } finally {
      srcDb.close();
    }
  }

  // Verify snapshot integrity before packaging
  if (fs.existsSync(seedDbPath)) {
    const probe = new Database(seedDbPath, { readonly: true });
    try {
      const check = String(probe.pragma('integrity_check', { simple: true }) || '').toLowerCase();
      if (check !== 'ok') {
        throw new Error('Bundled database snapshot failed integrity verification.');
      }
    } finally {
      probe.close();
    }
    for (const suffix of ['-wal', '-shm']) {
      try {
        if (fs.existsSync(`${seedDbPath}${suffix}`)) {
          fs.unlinkSync(`${seedDbPath}${suffix}`);
        }
      } catch {
        // ignore
      }
    }
  }

  // 4. Zip application files + staged installer scripts & verified DB snapshot using Python zipfile
  const pyScript = `
import os, sys, zipfile

root_dir = sys.argv[1]
stage_dir = sys.argv[2]
zip_path = sys.argv[3]

include_files = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'favicon.ico',
    'firebase-applet-config.json',
    'server.ts',
    'metadata.json',
]
include_dirs = ['server', 'src', 'public', 'dist']
skip_names = {'node_modules', '.git', 'data', 'quarantine', 'backups'}

with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for root, dirs, files in os.walk(stage_dir):
        for fname in files:
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, stage_dir)
            zf.write(full, os.path.join('Abrar-Medical-Store-Setup', rel))

    for fname in include_files:
        full = os.path.join(root_dir, fname)
        if os.path.isfile(full):
            zf.write(full, os.path.join('Abrar-Medical-Store-Setup', fname))

    for dname in include_dirs:
        dpath = os.path.join(root_dir, dname)
        if not os.path.isdir(dpath):
            continue
        for root, dirs, files in os.walk(dpath):
            dirs[:] = [d for d in dirs if d not in skip_names]
            for fname in files:
                if fname.endswith('.db') or fname.endswith('.db-wal') or fname.endswith('.db-shm'):
                    continue
                full = os.path.join(root, fname)
                rel = os.path.relpath(full, root_dir)
                zf.write(full, os.path.join('Abrar-Medical-Store-Setup', rel))
`;

  execFileSync('python3', ['-c', pyScript, rootDir, stageDir, zipPath], {
    stdio: 'pipe',
    timeout: 60000,
  });

  // Remove staging folder immediately after zip creation
  fs.rmSync(stageDir, { recursive: true, force: true });

  return {
    zipPath,
    filename: 'Abrar-Medical-Store-Windows-Installer.zip',
    cleanup: () => {
      try {
        if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      } catch {
        // ignore
      }
    },
  };
}
