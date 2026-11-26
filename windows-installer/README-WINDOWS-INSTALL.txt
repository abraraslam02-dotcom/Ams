ABRAR MEDICAL STORE (AMS) — WINDOWS INSTALLATION GUIDE
====================================================

WHAT IS INCLUDED IN THIS INSTALLER PACKAGE?
-------------------------------------------
1. Install-Abrar-Medical-Store.bat  -> 1-Click Windows Setup & Shortcut Creator
2. Start-Abrar-Medical-Store.bat    -> Starts Local Server & Opens POS Desktop Window
3. Stop-Abrar-Medical-Store.bat     -> Cleanly Stops the Local Server
4. seed/ams_medical.db              -> Verified snapshot of your current store database

HOW TO INSTALL ON WINDOWS 10 / 11
---------------------------------
Step 1: Right-click this .zip file -> Extract All... to a folder (e.g. Desktop\AMS-Setup).
Step 2: Double-click "Install-Abrar-Medical-Store.bat".
        (If Windows SmartScreen asks, click "More info" -> "Run anyway".)
Step 3: The installer automatically:
        - Verifies Node.js (installs Node.js LTS via winget if missing)
        - Copies the application to C:\AbrarMedicalStore\App
        - Protects any existing D:\AbrarMedicalStore\Database\ams_medical.db
          (or copies your live database snapshot if no DB exists yet)
        - Configures Local-First OFFLINE MODE so you NEVER hit Firestore daily quota limits
        - Creates "Abrar Medical Store POS" on your Windows Desktop & Start Menu

DAILY USE
---------
- Double-click the "Abrar Medical Store POS" icon on your Desktop.
- Backups are saved directly to D:\AbrarMedicalStore\Backups (or C:\AbrarMedicalStore\Backups).
- You can still click "Sync Cloud Now" in System Settings anytime you want to push a cloud backup.
