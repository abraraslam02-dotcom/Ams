export interface DatabaseDiagnostics {
  connected: boolean;
  driver: string;
  databasePath: string;
  databaseDirectoryExists: boolean;
  fileExists: boolean;
  fileSizeBytes: number;
  journalMode: string;
  foreignKeysEnabled: boolean;
  integrityCheck: string;
  tableCount: number;
  tables: string[];
  latencyMs: number;
  checkedAt: string;
  error?: string | null;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary: boolean;
  defaultValue: unknown;
}

export interface ForeignKeyInfo {
  fromColumn: string;
  targetTable: string;
  targetColumn: string;
}

export interface TableDetail {
  name: string;
  columnsCount: number;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
  indexes: string[];
  rowCount: number;
}

export interface DatabaseStatusResponse {
  success: boolean;
  diagnostics: DatabaseDiagnostics;
  tables: TableDetail[];
  totalTables: number;
  error?: string;
}

export interface ModuleCatalogItem {
  moduleKey: string;
  name: string;
  tables: string[];
  purpose: string;
  status: string;
}

export interface ModulesResponse {
  success: boolean;
  modules: ModuleCatalogItem[];
  taskPhase: string;
  rulesEnforced: string[];
}
