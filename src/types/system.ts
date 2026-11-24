export interface HealthResponse {
  status: 'healthy' | 'degraded';
  service: string;
  version?: string;
  environment: string;
  uptimeSeconds: number;
  nodeVersion: string;
  timestamp: string;
  operatingMode?: OperatingModeStatus;
  database: {
    connected: boolean;
    driver: string;
    path: string;
    latencyMs: number;
    integrity: string;
    journalMode: string;
    foreignKeys: boolean;
    error: string | null;
  };
  backup?: {
    backupDirectory: string;
    totalBackups: number;
    lastBackup: Record<string, unknown> | null;
    unresolvedErrors: number;
  };
  cloudPersistence?: {
    connected?: boolean;
    connectionBlocked?: boolean;
    connectionError?: string | null;
    databaseIdentity?: string;
    externalLocation?: string;
    [key: string]: unknown;
  };
  connectionBlocked?: boolean;
  connectionError?: string | null;
  databaseIdentity?: string;
  localization: {
    currency: string;
    currencySymbol: string;
    timezone: string;
    timezoneOffset: string;
    locale: string;
  };
}

export interface InvoiceFieldVisibility {
  showLogo: boolean;
  showDrugLicense: boolean;
  showNtn: boolean;
  showItemCode: boolean;
  showCompany: boolean;
  showPacking: boolean;
  showBatchExpiry: boolean;
  showBonus: boolean;
  showDiscount: boolean;
  showTax: boolean;
  showPreviousBalance: boolean;
  showSalesman: boolean;
  showDeliveryman: boolean;
  showSignature: boolean;
  showFooter: boolean;
  showAccountingVerification: boolean;
}

export const DEFAULT_FIELD_VISIBILITY: InvoiceFieldVisibility = {
  showLogo: true,
  showDrugLicense: true,
  showNtn: true,
  showItemCode: true,
  showCompany: true,
  showPacking: true,
  showBatchExpiry: true,
  showBonus: true,
  showDiscount: true,
  showTax: true,
  showPreviousBalance: true,
  showSalesman: true,
  showDeliveryman: true,
  showSignature: true,
  showFooter: true,
  showAccountingVerification: false,
};

export interface CompanySettings {
  id?: number;
  store_name: string;
  legal_name?: string;
  drug_license_number?: string;
  ntn_tax_number?: string;
  address?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  default_currency: string;
  currency_symbol: string;
  default_timezone: string;
  timezone_offset: string;
  default_language: string;
  invoice_footer_note?: string;
  near_expiry_days?: number;
  // Phase 9 Printing Settings
  logo_data_url?: string;
  invoice_heading?: string;
  default_printer?: string;
  default_paper_size?: 'legal' | 'a4' | '80mm' | '58mm';
  thermal_printer_width?: '80mm' | '58mm';
  print_copies?: number;
  page_orientation?: 'portrait' | 'landscape';
  page_margin?: 'none' | 'minimum' | 'compact' | 'standard';
  font_size_scale?: 'small' | 'normal' | 'large';
  field_visibility_json?: string;
  // Phase 10 Backup & WhatsApp Settings
  backup_directory?: string;
  auto_daily_backup?: number;
  auto_backup_before_changes?: number;
  backup_retention_days?: number;
  auto_whatsapp_on_save?: number;
  allow_negative_stock?: number;
  batch_wise_sales?: number;
  batch_wise_purchase?: number;
  created_at?: string;
  updated_at?: string;
}

export interface SettingsResponse {
  success: boolean;
  data: CompanySettings;
  environment: {
    currency: string;
    timezone: string;
    timezoneOffset: string;
    locale: string;
    country: string;
  };
}

export interface BackupRecord {
  id: number;
  filename: string;
  file_path: string;
  backup_type: 'manual' | 'daily_auto' | 'pre_change' | 'pre_restore_safety';
  file_size_bytes: number;
  integrity_status: string;
  tables_count: number;
  records_summary: string;
  status: 'completed' | 'failed' | 'restored' | 'deleted';
  created_by: string;
  notes: string;
  created_at: string;
  file_exists?: boolean;
}

export interface BackupVerificationResult {
  valid: boolean;
  filename: string;
  filePath: string;
  fileSizeBytes: number;
  modifiedAt: string;
  integrityCheck: string;
  tablesCount: number;
  coreCounts: {
    items: number;
    accounts: number;
    purchases: number;
    sales: number;
    inventoryBatches: number;
    journalEntries: number;
    users: number;
  };
  error?: string;
}

export interface SystemErrorLog {
  id: number;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  module: string;
  operation: string;
  user_message: string;
  technical_details: string;
  username: string;
  resolved: number;
  created_at: string;
}

export function parseFieldVisibility(jsonStr?: string | null): InvoiceFieldVisibility {
  if (!jsonStr) return { ...DEFAULT_FIELD_VISIBILITY };
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      ...DEFAULT_FIELD_VISIBILITY,
      ...(typeof parsed === 'object' && parsed !== null ? parsed : {}),
    };
  } catch {
    return { ...DEFAULT_FIELD_VISIBILITY };
  }
}

export type SystemOperatingMode = 'ONLINE' | 'OFFLINE';
export type LocalBackupStatus = 'Successful' | 'Failed' | 'Not Run';
export type CloudSyncStatus = 'Successful' | 'Pending' | 'Failed' | 'Not Run';

export interface SyncConflictRecord {
  id: number;
  table_name: string;
  record_id: string;
  record_label: string | null;
  local_updated_at: string | null;
  cloud_updated_at: string | null;
  local_snapshot: Record<string, unknown>;
  cloud_snapshot: Record<string, unknown>;
  changed_fields: string[];
  status: 'unresolved' | 'resolved';
  resolution_choice: 'keep_local' | 'keep_cloud' | null;
  resolved_by: string | null;
  resolved_at: string | null;
  detected_at: string;
}

export interface OperatingModeStatus {
  mode: SystemOperatingMode;
  activeDatabaseLabel: string;
  switchedAt: string | null;
  switchedBy: string | null;
  manualControlOnly: boolean;
  localBackupStatus: LocalBackupStatus;
  lastSuccessfulBackupAt: string | null;
  lastBackupFilename: string | null;
  lastBackupPath: string | null;
  lastBackupSizeBytes: number;
  lastBackupSha256: string | null;
  lastBackupError: string | null;
  cloudSyncStatus: CloudSyncStatus;
  lastSuccessfulCloudSyncAt: string | null;
  lastCloudSyncError: string | null;
  pendingLocalChangesCount: number;
  unresolvedConflictsCount: number;
  storage: {
    platform: string;
    isWindows: boolean;
    available: boolean;
    activeDatabasePath: string;
    activeDatabaseDir: string;
    activeBackupDir: string;
    windowsPermanentDatabaseDir: string;
    windowsPermanentBackupDir: string;
    localIntegrityOk: boolean;
    localDbConnected: boolean;
    localFileSizeBytes: number;
    warning: string | null;
  };
  cloud: {
    enabled: boolean;
    connected: boolean;
    databaseIdentity: string;
    lastVersionSeq: number;
    lastError: string | null;
  };
}

export interface SwitchOperatingModeResponse {
  success: boolean;
  switched: boolean;
  requiresConfirmation?: boolean;
  mode: SystemOperatingMode;
  previousMode: SystemOperatingMode;
  message: string;
  warning?: string | null;
  pendingLocalChangesCount: number;
  unresolvedConflictsCount: number;
  status: OperatingModeStatus;
  error?: string;
}

export interface BackupAndSyncNowResponse {
  success: boolean;
  step1LocalBackup: {
    status: 'Successful' | 'Failed';
    filename: string | null;
    filePath: string | null;
    fileSizeBytes: number;
    integrityStatus: string;
    sha256: string | null;
    completedAt: string | null;
    error: string | null;
  };
  step2CloudSync: {
    status: 'Successful' | 'Pending' | 'Failed';
    reachable: boolean;
    mergedFromCloud: number;
    updatedFromCloud: number;
    conflictsDetected: number;
    unresolvedConflictsCount: number;
    cloudVersionSeq: number;
    completedAt: string | null;
    message: string;
    error: string | null;
  };
  lastSuccessfulBackupAt: string | null;
  lastSuccessfulCloudSyncAt: string | null;
  conflicts: SyncConflictRecord[];
  status: OperatingModeStatus;
  error?: string;
}

