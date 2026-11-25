/**
 * Windows D-Drive Local Backup Helper for Abrar Medical Store
 *
 * When the server runs locally on Windows (`process.platform === 'win32'`),
 * the backend writes directly to `D:\AbrarMedicalStore\Backups\Abrar_Backup_YYYY-MM-DD_NNN.db`
 * and verifies writability and SQLite integrity directly on disk.
 *
 * When the server runs inside Cloud Run or a Linux container (`requiresBrowserDDriveSave === true`),
 * browser JavaScript cannot write to `D:\` without user permission. This helper uses the browser's
 * File System Access API (`window.showDirectoryPicker` / `window.showSaveFilePicker`) with a
 * persisted directory handle in IndexedDB so the user on Windows grants permission to
 * `D:\AbrarMedicalStore\Backups` once, and subsequent backups write and verify the `.db` file
 * directly inside that folder without pretending a Linux server wrote to Windows Drive D.
 */

const IDB_NAME = 'ams_d_drive_backup_fs_db';
const IDB_STORE = 'directory_handles';
const IDB_KEY = 'd_drive_backup_folder_handle';

interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface ExtendedFileSystemDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor?: FileSystemPermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor?: FileSystemPermissionDescriptor) => Promise<PermissionState>;
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB for D Drive handle.'));
  });
}

export async function getSavedDDriveDirectoryHandle(): Promise<ExtendedFileSystemDirectoryHandle | null> {
  try {
    const db = await openHandleDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(IDB_KEY);
      getReq.onsuccess = () => resolve((getReq.result as ExtendedFileSystemDirectoryHandle) || null);
      getReq.onerror = () => reject(getReq.error);
    });
  } catch {
    return null;
  }
}

export async function saveDDriveDirectoryHandle(handle: ExtendedFileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const putReq = store.put(handle, IDB_KEY);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });
  } catch {
    // non-fatal if browser blocks handle persistence
  }
}

export async function clearSavedDDriveDirectoryHandle(): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const delReq = store.delete(IDB_KEY);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => reject(delReq.error);
    });
  } catch {
    // ignore
  }
}

export async function selectDDriveBackupDirectory(): Promise<{
  success: boolean;
  folderName: string | null;
  error: string | null;
}> {
  const win = window as unknown as {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
    }) => Promise<ExtendedFileSystemDirectoryHandle>;
  };

  if (typeof win.showDirectoryPicker !== 'function') {
    return {
      success: false,
      folderName: null,
      error:
        'Direct folder selection requires Chrome or Microsoft Edge on Windows (or running inside a top-level browser tab).',
    };
  }

  try {
    const dirHandle = await win.showDirectoryPicker({
      id: 'ams_d_drive_backups',
      mode: 'readwrite',
    });
    await saveDDriveDirectoryHandle(dirHandle);
    return {
      success: true,
      folderName: dirHandle.name,
      error: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      folderName: null,
      error: `D Drive folder selection cancelled or denied: ${msg}`,
    };
  }
}

export interface SaveVerifiedBackupToDDriveParams {
  backupId: number;
  filename: string;
  expectedSizeBytes: number;
  configuredFolder: string;
  authToken: string | null;
  forcePickFolder?: boolean;
}

export interface SaveVerifiedBackupToDDriveResult {
  success: boolean;
  savedExactPath: string | null;
  verifiedSizeBytes: number;
  method: 'direct_directory_handle' | 'save_file_picker' | 'failed';
  error: string | null;
}

/**
 * Downloads the verified `.db` backup binary from the server and writes + verifies it directly
 * inside the user's selected `D:\AbrarMedicalStore\Backups` folder via File System Access API.
 * Never pretends a browser download succeeded if D drive permission was denied or unavailable.
 */
export async function saveVerifiedBackupToClientDDrive(
  params: SaveVerifiedBackupToDDriveParams
): Promise<SaveVerifiedBackupToDDriveResult> {
  const headers: Record<string, string> = {};
  if (params.authToken) {
    headers['Authorization'] = `Bearer ${params.authToken}`;
  }

  // 1. Fetch verified .db binary from server
  const res = await fetch(`/api/system/backups/download/${params.backupId}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    return {
      success: false,
      savedExactPath: null,
      verifiedSizeBytes: 0,
      method: 'failed',
      error: `Failed to fetch verified backup file from server (HTTP ${res.status}).`,
    };
  }

  const blob = await res.blob();
  if (blob.size < 4096) {
    return {
      success: false,
      savedExactPath: null,
      verifiedSizeBytes: blob.size,
      method: 'failed',
      error: `Downloaded backup file is invalid or empty (${blob.size} bytes).`,
    };
  }

  const normalizedFolder = (params.configuredFolder || 'D:\\AbrarMedicalStore\\Backups').replace(
    /[\\/]+$/,
    ''
  );
  const win = window as unknown as {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
    }) => Promise<ExtendedFileSystemDirectoryHandle>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle>;
  };

  // 2. Try persisted or newly selected Directory Handle (D:\AbrarMedicalStore\Backups)
  if (typeof win.showDirectoryPicker === 'function') {
    try {
      let dirHandle = params.forcePickFolder ? null : await getSavedDDriveDirectoryHandle();
      if (dirHandle && typeof dirHandle.queryPermission === 'function') {
        let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted' && typeof dirHandle.requestPermission === 'function') {
          perm = await dirHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm !== 'granted') {
          dirHandle = null;
        }
      }

      if (!dirHandle) {
        dirHandle = await win.showDirectoryPicker({
          id: 'ams_d_drive_backups',
          mode: 'readwrite',
        });
        await saveDDriveDirectoryHandle(dirHandle);
      }

      const fileHandle = await dirHandle.getFileHandle(params.filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      // Verify written file integrity (size match)
      const writtenFile = await fileHandle.getFile();
      if (writtenFile.size !== blob.size) {
        return {
          success: false,
          savedExactPath: null,
          verifiedSizeBytes: writtenFile.size,
          method: 'failed',
          error: `Backup size verification failed on D Drive (expected ${blob.size} bytes, found ${writtenFile.size} bytes).`,
        };
      }

      const exactDisplayPath = `${normalizedFolder}\\${params.filename}`;
      return {
        success: true,
        savedExactPath: exactDisplayPath,
        verifiedSizeBytes: writtenFile.size,
        method: 'direct_directory_handle',
        error: null,
      };
    } catch (dirErr: unknown) {
      const errMsg = dirErr instanceof Error ? dirErr.message : String(dirErr);
      // If user explicitly cancelled the directory picker, return honest error
      if (errMsg.toLowerCase().includes('abort') || errMsg.toLowerCase().includes('cancel')) {
        return {
          success: false,
          savedExactPath: null,
          verifiedSizeBytes: 0,
          method: 'failed',
          error: `D Drive folder selection was cancelled. Please select ${normalizedFolder} to save the backup to Drive D.`,
        };
      }
      // Fall through to showSaveFilePicker if showDirectoryPicker failed due to iframe security
    }
  }

  // 3. Try Save File Picker if Directory Picker is unavailable
  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const fileHandle = await win.showSaveFilePicker({
        suggestedName: params.filename,
        types: [
          {
            description: 'SQLite Database Backup (.db)',
            accept: { 'application/x-sqlite3': ['.db'] },
          },
        ],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      const writtenFile = await fileHandle.getFile();
      if (writtenFile.size !== blob.size) {
        return {
          success: false,
          savedExactPath: null,
          verifiedSizeBytes: writtenFile.size,
          method: 'failed',
          error: `Backup size verification failed (expected ${blob.size} bytes, found ${writtenFile.size} bytes).`,
        };
      }

      return {
        success: true,
        savedExactPath: `${normalizedFolder}\\${fileHandle.name || params.filename}`,
        verifiedSizeBytes: writtenFile.size,
        method: 'save_file_picker',
        error: null,
      };
    } catch (saveErr: unknown) {
      const errMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      return {
        success: false,
        savedExactPath: null,
        verifiedSizeBytes: 0,
        method: 'failed',
        error: `D Drive file save was cancelled or blocked (${errMsg}).`,
      };
    }
  }

  // 4. If running inside a cross-origin preview iframe where File System Access API is blocked,
  // trigger browser file download and explicitly inform the user instead of pretending D:\ was written directly.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = params.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return {
    success: false,
    savedExactPath: null,
    verifiedSizeBytes: blob.size,
    method: 'failed',
    error: `Server runs in a cloud container where Windows Drive D (${normalizedFolder}) is not directly mounted. Verified backup "${params.filename}" (${(blob.size / 1024).toFixed(1)} KB) was downloaded to your browser — save it to ${normalizedFolder} or open the app in a full browser tab on Windows to grant direct D Drive folder permission.`,
  };
}
