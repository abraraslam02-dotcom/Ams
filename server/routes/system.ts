import fs from 'fs';
import os from 'os';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { checkDatabaseConnection, getDatabase } from '../db/connection.ts';
import { MODULE_CATALOG } from '../db/schema.ts';
import { config } from '../config.ts';
import { getPakistanDateISO, addDaysToIsoDate } from '../utils/pakistanTime.ts';
import { authenticateToken, requireRole } from '../middleware/authMiddleware.ts';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.ts';
import {
  getBackupDirectory,
  listBackups,
  createDatabaseBackup,
  verifyBackupFile,
  restoreDatabaseFromBackup,
  triggerPreChangeBackupIfEnabled,
  logSystemError,
  getLocalNetworkAddresses,
} from '../services/backupService.ts';
import {
  getCloudPersistenceStatus,
  runPreDeploymentSafetyChecks,
  syncDatabaseToCloudSQL,
  reconnectToCurrentDatabase,
} from '../services/cloudPersistenceService.ts';
import { isOfflineOperatingMode } from '../services/operatingModeStore.ts';
import {
  getOperatingModeFullStatus,
  switchOperatingMode,
  executeManualBackupAndSync,
  executeIndependentDDriveBackup,
  confirmBrowserDDriveBackupSave,
  executeIndependentCloudSync,
  listSyncConflicts,
  resolveSyncConflict,
  resolveAllSyncConflicts,
} from '../services/operatingModeService.ts';
import { APP_VERSION as SHARED_APP_VERSION, getBuildMetadata } from '../utils/buildInfo.ts';
import {
  buildWindowsFullInstallerZip,
  generateCloudShortcutBatContent,
} from '../services/windowsInstallerService.ts';

export const systemRouter = Router();

export const APP_VERSION = SHARED_APP_VERSION;
export const APP_RELEASE_PHASE = 'Phase 12 — Independent Permanent SQLite Central DB & Simple Incremental Sync';

function canAdministerSystem(req: Request): boolean {
  return Boolean(req.user && ['Super Admin', 'Administrator'].includes(req.user.role));
}

/**
 * Live Health Check
 * Verifies server process, actual database connection, and backup status.
 */
systemRouter.get('/health', (_req: Request, res: Response) => {
  const dbStatus = checkDatabaseConnection();
  const cloudStatus = getCloudPersistenceStatus();
  const offlineMode = isOfflineOperatingMode();
  const operatingMode = getOperatingModeFullStatus();
  const dbHealthy = offlineMode
    ? dbStatus.connected
    : dbStatus.connected && !cloudStatus.connectionBlocked;
  const uptimeSeconds = Math.floor(process.uptime());

  let lastBackup: Record<string, unknown> | null = null;
  let totalBackups = 0;
  let unresolvedErrors = 0;

  if (dbHealthy) {
    try {
      const db = getDatabase();
      lastBackup =
        (db
          .prepare(
            "SELECT id, filename, backup_type, file_size_bytes, integrity_status, status, created_at FROM backup_history WHERE status IN ('completed', 'restored') ORDER BY id DESC LIMIT 1"
          )
          .get() as Record<string, unknown>) || null;
      const cnt = db.prepare('SELECT COUNT(*) as cnt FROM backup_history').get() as { cnt: number };
      totalBackups = Number(cnt?.cnt || 0);
      const errCnt = db
        .prepare('SELECT COUNT(*) as cnt FROM system_error_logs WHERE resolved = 0')
        .get() as { cnt: number };
      unresolvedErrors = Number(errCnt?.cnt || 0);
    } catch {
      // ignore if table not ready
    }
  }

  let backupDirDisplay = config.primaryBackupDir;
  try {
    backupDirDisplay = getBackupDirectory();
  } catch {
    backupDirDisplay = config.primaryBackupDir;
  }

  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'healthy' : 'degraded',
    service: 'Abrar Medical Store API',
    version: APP_VERSION,
    environment: config.nodeEnv,
    uptimeSeconds,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
    operatingMode,
    database: {
      connected: dbHealthy,
      driver: dbStatus.driver,
      path: dbStatus.databasePath,
      latencyMs: dbStatus.latencyMs,
      integrity: dbStatus.integrityCheck,
      journalMode: dbStatus.journalMode,
      foreignKeys: dbStatus.foreignKeysEnabled,
      error: offlineMode ? dbStatus.error : cloudStatus.connectionError || dbStatus.error,
    },
    backup: {
      backupDirectory: backupDirDisplay,
      totalBackups,
      lastBackup,
      unresolvedErrors,
    },
    cloudPersistence: cloudStatus,
    connectionBlocked: offlineMode ? false : Boolean(cloudStatus.connectionBlocked),
    connectionError: offlineMode ? null : cloudStatus.connectionError || null,
    databaseIdentity: cloudStatus.databaseIdentity || cloudStatus.externalLocation,
    localization: {
      currency: config.appCurrency,
      currencySymbol: config.appCurrencySymbol,
      timezone: config.appTimezone,
      timezoneOffset: config.appTimezoneOffset,
      locale: config.appLocale,
    },
  });
});

/**
 * Explicit Reconnect to Current Active Database
 * Re-establishes connectivity to the SAME active database without ever switching or seeding an older copy.
 */
systemRouter.post('/reconnect-db', async (_req: Request, res: Response) => {
  try {
    const result = await reconnectToCurrentDatabase(true);
    const ok = !result.blocked && result.connected;
    return res.status(ok ? 200 : 503).json({
      success: ok,
      ...result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(503).json({
      success: false,
      connected: false,
      blocked: true,
      error: msg,
    });
  }
});

/**
 * Pre-Deployment & Runtime Database Safety Verification
 * Verifies local SQLite integrity, Cloud SQL PostgreSQL reachability, existing records, and non-destructive protection lock.
 */
systemRouter.get('/deployment-safety', async (_req: Request, res: Response) => {
  try {
    const report = await runPreDeploymentSafetyChecks();
    return res.status(report.safeToDeploy ? 200 : 503).json({
      success: report.safeToDeploy,
      ...report,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(503).json({
      success: false,
      safeToDeploy: false,
      error: `Deployment safety check failed: ${msg}`,
    });
  }
});

/**
 * Immediate Cloud Persistence Flush
 */
systemRouter.post('/cloud-sync-now', authenticateToken, async (req: Request, res: Response) => {
  try {
    const synced = await syncDatabaseToCloudSQL(`manual_flush_by_${req.user?.username || 'user'}`);
    const status = getCloudPersistenceStatus();
    return res.json({
      success: synced,
      cloudPersistence: status,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      success: false,
      error: msg,
    });
  }
});

/**
 * Detailed Database Status and Schema Verification
 */
systemRouter.get('/database', authenticateToken, (_req: Request, res: Response) => {
  const diagnostics = checkDatabaseConnection();

  if (!diagnostics.connected) {
    return res.status(503).json({
      success: false,
      diagnostics,
      tables: [],
      error: diagnostics.error || 'Database is not connected.',
    });
  }

  try {
    const db = getDatabase();

    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
      )
      .all() as Array<{ name: string }>;

    const tablesDetails = tableRows.map((t) => {
      const columns = db.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>;

      const foreignKeys = db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all() as Array<{
        id: number;
        table: string;
        from: string;
        to: string;
      }>;

      const indexes = db.prepare(`PRAGMA index_list("${t.name}")`).all() as Array<{
        name: string;
        unique: number;
      }>;

      const countResult = db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get() as {
        count: number;
      };

      return {
        name: t.name,
        columnsCount: columns.length,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.notnull === 0,
          isPrimary: c.pk > 0,
          defaultValue: c.dflt_value,
        })),
        foreignKeys: foreignKeys.map((fk) => ({
          fromColumn: fk.from,
          targetTable: fk.table,
          targetColumn: fk.to,
        })),
        indexes: indexes.map((idx) => idx.name),
        rowCount: countResult.count,
      };
    });

    return res.json({
      success: true,
      diagnostics,
      tables: tablesDetails,
      totalTables: tablesDetails.length,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to inspect database tables: ${errorMsg}`,
    });
  }
});

/**
 * Company, Store, Printing & Backup Settings (GET)
 */
systemRouter.get('/settings', authenticateToken, (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const settings = db.prepare('SELECT * FROM company_settings LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;

    return res.json({
      success: true,
      data: settings || {
        store_name: config.companyName,
        default_currency: config.appCurrency,
        currency_symbol: config.appCurrencySymbol,
        default_timezone: config.appTimezone,
        timezone_offset: config.appTimezoneOffset,
        default_language: 'en',
      },
      environment: {
        currency: config.appCurrency,
        timezone: config.appTimezone,
        timezoneOffset: config.appTimezoneOffset,
        locale: config.appLocale,
        country: config.country,
      },
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch company settings: ${errorMsg}`,
    });
  }
});

/**
 * Company, Store, Printing & Backup Settings (PUT)
 * Saves store profile, logo upload, invoice headings/footers, printer defaults, field visibility, and backup preferences.
 */
systemRouter.put('/settings', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only authorized administrators can modify Store & Printing Settings.',
    });
  }

  try {
    const db = getDatabase();
    const body = req.body || {};
    let existing = db.prepare('SELECT * FROM company_settings LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;

    if (!existing) {
      const initName = String(body.store_name || config.companyName || 'Abrar Medical Store').trim();
      const insertRes = db
        .prepare('INSERT INTO company_settings (store_name) VALUES (?)')
        .run(initName);
      existing = db
        .prepare('SELECT * FROM company_settings WHERE id = ?')
        .get(insertRes.lastInsertRowid) as Record<string, unknown> | undefined;
    }

    if (!existing) {
      return res.status(500).json({
        success: false,
        error: 'Failed to initialize company settings record.',
      });
    }

    const storeName =
      body.store_name !== undefined ? String(body.store_name).trim() : String(existing.store_name);
    if (!storeName) {
      return res.status(400).json({
        success: false,
        error: 'Store Name cannot be empty.',
      });
    }

    const legalName =
      body.legal_name !== undefined ? String(body.legal_name).trim() : String(existing.legal_name || '');
    const drugLicense =
      body.drug_license_number !== undefined
        ? String(body.drug_license_number).trim()
        : String(existing.drug_license_number || '');
    const ntnNumber =
      body.ntn_tax_number !== undefined
        ? String(body.ntn_tax_number).trim()
        : String(existing.ntn_tax_number || '');
    const address =
      body.address !== undefined ? String(body.address).trim() : String(existing.address || '');
    const phone =
      body.phone !== undefined ? String(body.phone).trim() : String(existing.phone || '');
    const mobile =
      body.mobile !== undefined ? String(body.mobile).trim() : String(existing.mobile || '');
    const email =
      body.email !== undefined ? String(body.email).trim() : String(existing.email || '');
    const invoiceFooterNote =
      body.invoice_footer_note !== undefined
        ? String(body.invoice_footer_note).trim()
        : String(existing.invoice_footer_note || '');
    const nearExpiryDays =
      body.near_expiry_days !== undefined
        ? Math.max(1, Math.min(365, Number(body.near_expiry_days) || 90))
        : Number(existing.near_expiry_days || 90);

    // Printing settings
    const logoDataUrl =
      body.logo_data_url !== undefined ? String(body.logo_data_url) : String(existing.logo_data_url || '');
    const invoiceHeading =
      body.invoice_heading !== undefined
        ? String(body.invoice_heading).trim()
        : String(existing.invoice_heading || 'TAX / COMMERCIAL INVOICE');
    const defaultPrinter =
      body.default_printer !== undefined
        ? String(body.default_printer).trim()
        : String(existing.default_printer || 'System Default Printer (OS Print Spooler)');
    const defaultPaperSize = ['legal', 'a4', '80mm', '58mm'].includes(String(body.default_paper_size))
      ? String(body.default_paper_size)
      : String(existing.default_paper_size || 'legal');
    const thermalPrinterWidth = ['80mm', '58mm'].includes(String(body.thermal_printer_width))
      ? String(body.thermal_printer_width)
      : String(existing.thermal_printer_width || '80mm');
    const printCopies =
      body.print_copies !== undefined
        ? Math.max(1, Math.min(10, Number(body.print_copies) || 1))
        : Number(existing.print_copies || 1);
    const pageOrientation = ['portrait', 'landscape'].includes(String(body.page_orientation))
      ? String(body.page_orientation)
      : 'portrait';
    const pageMargin = ['none', 'minimum', 'compact', 'standard'].includes(String(body.page_margin))
      ? String(body.page_margin)
      : String(existing.page_margin || 'standard');
    const fontSizeScale = ['small', 'normal', 'large'].includes(String(body.font_size_scale))
      ? String(body.font_size_scale)
      : String(existing.font_size_scale || 'normal');

    let fieldVisibilityJson = String(existing.field_visibility_json || '{}');
    if (body.field_visibility_json !== undefined) {
      fieldVisibilityJson =
        typeof body.field_visibility_json === 'string'
          ? body.field_visibility_json
          : JSON.stringify(body.field_visibility_json);
    }

    // Backup settings
    const backupDirectory =
      body.backup_directory !== undefined
        ? String(body.backup_directory).trim()
        : String(existing.backup_directory || '');
    const autoDailyBackup =
      body.auto_daily_backup !== undefined
        ? body.auto_daily_backup
          ? 1
          : 0
        : Number(existing.auto_daily_backup ?? 1);
    const autoBackupBeforeChanges =
      body.auto_backup_before_changes !== undefined
        ? body.auto_backup_before_changes
          ? 1
          : 0
        : Number(existing.auto_backup_before_changes ?? 1);
    const backupRetentionDays =
      body.backup_retention_days !== undefined
        ? Math.max(1, Math.min(365, Number(body.backup_retention_days) || 30))
        : Number(existing.backup_retention_days || 30);
    const autoWhatsappOnSave =
      body.auto_whatsapp_on_save !== undefined
        ? body.auto_whatsapp_on_save
          ? 1
          : 0
        : Number(existing.auto_whatsapp_on_save ?? 0);
    const allowNegativeStock =
      body.allow_negative_stock !== undefined
        ? body.allow_negative_stock
          ? 1
          : 0
        : Number(existing.allow_negative_stock ?? 1);
    const batchWiseSales =
      body.batch_wise_sales !== undefined
        ? body.batch_wise_sales
          ? 1
          : 0
        : Number(existing.batch_wise_sales ?? 1);
    const batchWisePurchase =
      body.batch_wise_purchase !== undefined
        ? body.batch_wise_purchase
          ? 1
          : 0
        : Number(existing.batch_wise_purchase ?? 1);

    db.prepare(
      `
      UPDATE company_settings
      SET store_name = ?,
          legal_name = ?,
          drug_license_number = ?,
          ntn_tax_number = ?,
          address = ?,
          phone = ?,
          mobile = ?,
          email = ?,
          invoice_footer_note = ?,
          near_expiry_days = ?,
          logo_data_url = ?,
          invoice_heading = ?,
          default_printer = ?,
          default_paper_size = ?,
          thermal_printer_width = ?,
          print_copies = ?,
          page_orientation = ?,
          page_margin = ?,
          font_size_scale = ?,
          field_visibility_json = ?,
          backup_directory = ?,
          auto_daily_backup = ?,
          auto_backup_before_changes = ?,
          backup_retention_days = ?,
          auto_whatsapp_on_save = ?,
          allow_negative_stock = ?,
          batch_wise_sales = ?,
          batch_wise_purchase = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      storeName,
      legalName,
      drugLicense,
      ntnNumber,
      address,
      phone,
      mobile,
      email,
      invoiceFooterNote,
      nearExpiryDays,
      logoDataUrl,
      invoiceHeading,
      defaultPrinter,
      defaultPaperSize,
      thermalPrinterWidth,
      printCopies,
      pageOrientation,
      pageMargin,
      fontSizeScale,
      fieldVisibilityJson,
      backupDirectory,
      autoDailyBackup,
      autoBackupBeforeChanges,
      backupRetentionDays,
      autoWhatsappOnSave,
      allowNegativeStock,
      batchWiseSales,
      batchWisePurchase,
      existing.id
    );

    db.prepare(
      `
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, 'SETTINGS_UPDATED', 'SUCCESS', ?, ?)
    `
    ).run(
      req.user?.id || null,
      req.user?.username || 'Administrator',
      req.ip || '',
      `Updated store, printing & backup settings (Paper: ${defaultPaperSize}, Printer: ${defaultPrinter}, BatchSales: ${batchWiseSales}, BatchPurchase: ${batchWisePurchase})`
    );

    const updated = db.prepare('SELECT * FROM company_settings WHERE id = ?').get(existing.id);

    return res.json({
      success: true,
      message: 'Store, Printing & Backup settings saved permanently.',
      data: updated,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logSystemError({
      module: 'system_settings',
      operation: 'PUT /api/system/settings',
      userMessage: 'Failed to save system settings',
      technicalDetails: errorMsg,
      username: req.user?.username,
    });
    return res.status(500).json({
      success: false,
      error: `Failed to update settings: ${errorMsg}`,
    });
  }
});

const DEFAULT_SALES_INVOICE_MORE_OPTIONS = {
  store_name: 'ABRAR MEDICAL STORE',
  invoice_title: 'TAX / COMMERCIAL INVOICE',
  invoice_subtitle: 'Retail & Wholesale Pharmacy Solutions',
  address: 'Main Bazar, Mandi Ahmad Abad',
  phone: '0300-1234567',
  ntn_strn: '1234567-8',
  custom_heading: '',
  footer_note: 'Thank you for choosing Abrar Medical Store! Medicines once sold will not be taken back without receipt.',
  custom_terms: '1. Expired/damaged items will be claimed as per company policy.\n2. Please check your medicines and change before leaving counter.',
  thank_you_message: 'Get Well Soon & Thank You For Your Visit!',
  visibility: {
    entry: {
      customer_address: true,
      customer_phone: true,
      item_company: true,
      item_code: true,
      barcode: true,
      batch_number: true,
      expiry_date: true,
      discount: true,
      tax: true,
      bonus_quantity: true,
      loose_quantity: true,
      packing_details: true,
      previous_balance: true,
      paid_amount: true,
      remaining_balance: true,
      remarks: true,
      footer_note: true,
    },
    preview: {
      customer_address: true,
      customer_phone: true,
      item_company: true,
      item_code: true,
      barcode: true,
      batch_number: true,
      expiry_date: true,
      discount: true,
      tax: true,
      bonus_quantity: true,
      loose_quantity: true,
      packing_details: true,
      previous_balance: true,
      paid_amount: true,
      remaining_balance: true,
      remarks: true,
      footer_note: true,
    },
    a4: {
      customer_address: true,
      customer_phone: true,
      item_company: true,
      item_code: true,
      barcode: true,
      batch_number: true,
      expiry_date: true,
      discount: true,
      tax: true,
      bonus_quantity: true,
      loose_quantity: true,
      packing_details: true,
      previous_balance: true,
      paid_amount: true,
      remaining_balance: true,
      remarks: true,
      footer_note: true,
    },
    thermal: {
      customer_address: false,
      customer_phone: false,
      item_company: false,
      item_code: false,
      barcode: false,
      batch_number: true,
      expiry_date: true,
      discount: true,
      tax: true,
      bonus_quantity: false,
      loose_quantity: false,
      packing_details: false,
      previous_balance: true,
      paid_amount: true,
      remaining_balance: true,
      remarks: false,
      footer_note: true,
    },
  },
};

/**
 * GET /api/system/sales-invoice-more-options
 * Fetches dedicated Sales Invoice headings, footer notes, and 4-scope field visibility
 */
systemRouter.get('/sales-invoice-more-options', authenticateToken, (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM company_settings LIMIT 1').get() as Record<string, any> | undefined;

    let parsedOptions: any = {};
    if (row?.sales_invoice_more_options_json) {
      try {
        parsedOptions = JSON.parse(row.sales_invoice_more_options_json);
      } catch {
        parsedOptions = {};
      }
    }

    const merged = {
      ...DEFAULT_SALES_INVOICE_MORE_OPTIONS,
      ...parsedOptions,
      store_name: parsedOptions.store_name || row?.store_name || DEFAULT_SALES_INVOICE_MORE_OPTIONS.store_name,
      invoice_title: parsedOptions.invoice_title || row?.invoice_heading || DEFAULT_SALES_INVOICE_MORE_OPTIONS.invoice_title,
      invoice_subtitle: parsedOptions.invoice_subtitle || row?.invoice_subtitle || DEFAULT_SALES_INVOICE_MORE_OPTIONS.invoice_subtitle,
      address: parsedOptions.address || row?.address || DEFAULT_SALES_INVOICE_MORE_OPTIONS.address,
      phone: parsedOptions.phone || row?.phone || DEFAULT_SALES_INVOICE_MORE_OPTIONS.phone,
      ntn_strn: parsedOptions.ntn_strn || row?.ntn_tax_number || DEFAULT_SALES_INVOICE_MORE_OPTIONS.ntn_strn,
      custom_heading: parsedOptions.custom_heading || row?.custom_invoice_heading || '',
      footer_note: parsedOptions.footer_note || row?.invoice_footer_note || DEFAULT_SALES_INVOICE_MORE_OPTIONS.footer_note,
      custom_terms: parsedOptions.custom_terms || DEFAULT_SALES_INVOICE_MORE_OPTIONS.custom_terms,
      thank_you_message: parsedOptions.thank_you_message || DEFAULT_SALES_INVOICE_MORE_OPTIONS.thank_you_message,
      visibility: {
        entry: { ...DEFAULT_SALES_INVOICE_MORE_OPTIONS.visibility.entry, ...(parsedOptions.visibility?.entry || {}) },
        preview: { ...DEFAULT_SALES_INVOICE_MORE_OPTIONS.visibility.preview, ...(parsedOptions.visibility?.preview || {}) },
        a4: { ...DEFAULT_SALES_INVOICE_MORE_OPTIONS.visibility.a4, ...(parsedOptions.visibility?.a4 || {}) },
        thermal: { ...DEFAULT_SALES_INVOICE_MORE_OPTIONS.visibility.thermal, ...(parsedOptions.visibility?.thermal || {}) },
      },
    };

    return res.json({
      success: true,
      data: merged,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to load Sales Invoice More Options: ${errorMsg}` });
  }
});

/**
 * PUT /api/system/sales-invoice-more-options
 * Super Admin only: Permanently save Sales Invoice headings, footer notes, and field visibility
 */
systemRouter.put(
  '/sales-invoice-more-options',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      const body = req.body || {};

      const currentJson = db
        .prepare('SELECT sales_invoice_more_options_json FROM company_settings LIMIT 1')
        .get() as { sales_invoice_more_options_json?: string } | undefined;

      let currentParsed: any = {};
      if (currentJson?.sales_invoice_more_options_json) {
        try {
          currentParsed = JSON.parse(currentJson.sales_invoice_more_options_json);
        } catch {
          currentParsed = {};
        }
      }

      const merged = {
        ...DEFAULT_SALES_INVOICE_MORE_OPTIONS,
        ...currentParsed,
        ...body,
        visibility: {
          entry: {
            ...DEFAULT_SALES_INVOICE_MORE_OPTIONS.visibility.entry,
            ...(currentParsed.visibility?.entry || {}),
            ...(body.visibility?.entry || {}),
          },
          preview: {
            ...DEFAULT_SALES_INVOICE_MORE_OPTIONS.visibility.preview,
            ...(currentParsed.visibility?.preview || {}),
            ...(body.visibility?.preview || {}),
          },
          a4: {
            ...DEFAULT_SALES_INVOICE_MORE_OPTIONS.visibility.a4,
            ...(currentParsed.visibility?.a4 || {}),
            ...(body.visibility?.a4 || {}),
          },
          thermal: {
            ...DEFAULT_SALES_INVOICE_MORE_OPTIONS.visibility.thermal,
            ...(currentParsed.visibility?.thermal || {}),
            ...(body.visibility?.thermal || {}),
          },
        },
      };

      const jsonStr = JSON.stringify(merged);

      // Persist to company_settings
      db.prepare(`
        UPDATE company_settings
        SET sales_invoice_more_options_json = ?,
            invoice_heading = COALESCE(?, invoice_heading),
            invoice_subtitle = COALESCE(?, invoice_subtitle),
            custom_invoice_heading = COALESCE(?, custom_invoice_heading),
            invoice_footer_note = COALESCE(?, invoice_footer_note),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT id FROM company_settings LIMIT 1)
      `).run(
        jsonStr,
        merged.invoice_title,
        merged.invoice_subtitle,
        merged.custom_heading,
        merged.footer_note
      );

      db.prepare(`
        INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
        VALUES (?, ?, 'MORE_OPTIONS_UPDATED', 'SUCCESS', ?, 'Updated Sales Invoice headings, footer notes, and field visibility')
      `).run(req.user?.id || null, req.user?.username || 'Super Admin', req.ip || '');

      return res.json({
        success: true,
        message: 'Sales Invoice More Options saved successfully and applied immediately.',
        data: merged,
      });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ success: false, error: `Failed to save Sales Invoice More Options: ${errorMsg}` });
    }
  }
);

/**
 * PATCH /api/system/batch-settings
 * Persistently updates batch_wise_sales, batch_wise_purchase, or allow_negative_stock independently.
 */
systemRouter.patch('/batch-settings', authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM company_settings ORDER BY id ASC LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'System settings record not found.',
      });
    }

    const body = req.body || {};
    const batchWiseSales =
      body.batch_wise_sales !== undefined
        ? body.batch_wise_sales === false ||
          body.batch_wise_sales === 0 ||
          body.batch_wise_sales === '0' ||
          body.batch_wise_sales === 'false'
          ? 0
          : 1
        : existing.batch_wise_sales !== undefined
        ? Number(existing.batch_wise_sales) === 0
          ? 0
          : 1
        : 1;

    const batchWisePurchase =
      body.batch_wise_purchase !== undefined
        ? body.batch_wise_purchase === false ||
          body.batch_wise_purchase === 0 ||
          body.batch_wise_purchase === '0' ||
          body.batch_wise_purchase === 'false'
          ? 0
          : 1
        : existing.batch_wise_purchase !== undefined
        ? Number(existing.batch_wise_purchase) === 0
          ? 0
          : 1
        : 1;

    const allowNegativeStock =
      body.allow_negative_stock !== undefined
        ? body.allow_negative_stock === true ||
          body.allow_negative_stock === 1 ||
          body.allow_negative_stock === '1' ||
          body.allow_negative_stock === 'true'
          ? 1
          : 0
        : existing.allow_negative_stock !== undefined
        ? Number(existing.allow_negative_stock) === 1
          ? 1
          : 0
        : 1;

    db.prepare(
      `
      UPDATE company_settings
      SET batch_wise_sales = ?,
          batch_wise_purchase = ?,
          allow_negative_stock = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(batchWiseSales, batchWisePurchase, allowNegativeStock, existing.id);

    const updated = db.prepare('SELECT * FROM company_settings WHERE id = ?').get(existing.id);

    return res.json({
      success: true,
      message: 'Batch settings updated permanently.',
      data: updated,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to update batch settings: ${errorMsg}`,
    });
  }
});

/**
 * GET /api/system/backups
 * Lists all database backups with date, time, size, status, and backup location info.
 */
systemRouter.get('/backups', authenticateToken, (_req: Request, res: Response) => {
  try {
    // Manual Control Only: never trigger automatic backups on list fetch
    const backups = listBackups();
    const backupDir = getBackupDirectory();
    const db = getDatabase();
    const settings = db
      .prepare(
        'SELECT backup_directory, auto_daily_backup, auto_backup_before_changes, backup_retention_days FROM company_settings LIMIT 1'
      )
      .get() as Record<string, unknown> | undefined;

    return res.json({
      success: true,
      backupDirectory: backupDir,
      configuredDirectory: settings?.backup_directory || '',
      autoDailyBackup: false,
      autoBackupBeforeChanges: false,
      manualControlOnly: true,
      backupRetentionDays: Number(settings?.backup_retention_days || 30),
      backups,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to list backups: ${errorMsg}`,
    });
  }
});

/**
 * POST /api/system/backups/create
 * Creates an immediate Manual Backup (or requested type) with date & time in filename.
 */
systemRouter.post('/backups/create', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only authorized administrators can create database backups.',
    });
  }

  try {
    const notes = req.body?.notes ? String(req.body.notes).trim() : 'Manual on-demand backup';
    const backup = createDatabaseBackup({
      backupType: 'manual',
      createdBy: req.user?.username || 'Administrator',
      notes,
    });

    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, 'DATABASE_BACKUP_CREATED', 'SUCCESS', ?, ?)
    `
    ).run(
      req.user?.id || null,
      req.user?.username || 'Administrator',
      req.ip || '',
      `Created manual backup ${backup.filename} (${backup.file_size_bytes} bytes, integrity: ${backup.integrity_status})`
    );

    return res.status(201).json({
      success: true,
      message: `Backup "${backup.filename}" created and verified (${backup.integrity_status}).`,
      backup,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logSystemError({
      severity: 'CRITICAL',
      module: 'backup',
      operation: 'POST /api/system/backups/create',
      userMessage: 'Manual database backup failed',
      technicalDetails: errorMsg,
      username: req.user?.username,
    });
    return res.status(500).json({
      success: false,
      error: `Failed to create database backup: ${errorMsg}`,
    });
  }
});

/**
 * POST /api/system/backups/verify
 * Verifies a backup file's integrity and returns record counts before restoration.
 */
systemRouter.post('/backups/verify', authenticateToken, async (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only authorized administrators can verify or restore backups.',
    });
  }

  try {
    const { backupId, filename } = req.body || {};
    const db = getDatabase();
    let filePath = '';
    let resolvedFilename = '';

    if (backupId) {
      const row = db
        .prepare('SELECT filename, file_path FROM backup_history WHERE id = ?')
        .get(Number(backupId)) as { filename: string; file_path: string } | undefined;
      if (!row) {
        return res.status(404).json({ success: false, error: 'Backup record not found.' });
      }
      filePath = row.file_path;
      resolvedFilename = row.filename;
    } else if (filename) {
      resolvedFilename = String(filename).replace(/[^a-zA-Z0-9._-]/g, '');
      filePath = `${getBackupDirectory()}/${resolvedFilename}`;
    } else {
      return res.status(400).json({ success: false, error: 'backupId or filename is required.' });
    }

    const verification = verifyBackupFile(filePath);
    return res.json({
      success: true,
      verification,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Backup verification failed: ${errorMsg}`,
    });
  }
});

/**
 * POST /api/system/backups/restore
 * Restores a verified backup after creating an automatic pre-restoration safety backup.
 */
systemRouter.post('/backups/restore', authenticateToken, async (req: Request, res: Response) => {
  if (req.user?.role !== 'Super Admin') {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only Super Admin can restore the database.',
    });
  }

  try {
    const { backupId, filename, confirmText } = req.body || {};
    if (String(confirmText || '').trim().toUpperCase() !== 'RESTORE') {
      return res.status(400).json({
        success: false,
        error: 'Explicit confirmation ("RESTORE") is required before restoring a database backup.',
      });
    }

    const result = restoreDatabaseFromBackup({
      backupId: backupId ? Number(backupId) : undefined,
      filename: filename ? String(filename) : undefined,
      restoredBy: req.user?.username || 'Super Admin',
    });

    return res.json(result);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logSystemError({
      severity: 'CRITICAL',
      module: 'backup_restore',
      operation: 'POST /api/system/backups/restore',
      userMessage: 'Database restoration failed; existing database preserved.',
      technicalDetails: errorMsg,
      username: req.user?.username,
    });
    return res.status(400).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * GET /api/system/backups/download/:id
 * Allows authorized administrators to download a backup .db file.
 */
systemRouter.get('/backups/download/:id', authenticateToken, async (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only authorized administrators can download database backups.',
    });
  }

  try {
    const db = getDatabase();
    const backupId = Number(req.params.id);
    const row = db
      .prepare('SELECT * FROM backup_history WHERE id = ?')
      .get(backupId) as { filename: string; file_path: string } | undefined;

    if (!row || !fs.existsSync(row.file_path)) {
      return res.status(404).json({
        success: false,
        error: 'Backup file not found on disk.',
      });
    }

    db.prepare(
      `
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, 'BACKUP_DOWNLOADED', 'INFO', ?, ?)
    `
    ).run(
      req.user?.id || null,
      req.user?.username || 'Administrator',
      req.ip || '',
      `Downloaded backup file ${row.filename}`
    );

    return res.download(row.file_path, row.filename);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to download backup: ${errorMsg}`,
    });
  }
});

/**
 * GET /api/system/error-logs
 * Lists application & database error logs for System Administration.
 */
systemRouter.get('/error-logs', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only administrators can view system error logs.',
    });
  }

  try {
    const db = getDatabase();
    const logs = db
      .prepare('SELECT * FROM system_error_logs ORDER BY id DESC LIMIT 100')
      .all();
    return res.json({
      success: true,
      logs,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * POST /api/system/error-logs/:id/resolve
 * Marks an application error log as resolved.
 */
systemRouter.post('/error-logs/:id/resolve', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied.',
    });
  }

  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    db.prepare('UPDATE system_error_logs SET resolved = 1 WHERE id = ?').run(id);
    return res.json({ success: true, message: 'Error log marked as resolved.' });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/system/info
 * Complete System Information, Version, Multi-Computer Network Readiness & Central DB Status.
 */
systemRouter.get('/info', authenticateToken, (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const dbStatus = checkDatabaseConnection();
    const lanAddresses = getLocalNetworkAddresses();

    const periods = db
      .prepare('SELECT * FROM accounting_periods ORDER BY start_date DESC')
      .all();

    const migrations = db
      .prepare('SELECT * FROM database_migrations ORDER BY id ASC')
      .all();

    const recordCounts = {
      users: Number((db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number })?.c || 0),
      items: Number((db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number })?.c || 0),
      accounts: Number((db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number })?.c || 0),
      inventoryBatches: Number(
        (db.prepare('SELECT COUNT(*) as c FROM inventory').get() as { c: number })?.c || 0
      ),
      purchases: Number(
        (db.prepare('SELECT COUNT(*) as c FROM purchases').get() as { c: number })?.c || 0
      ),
      purchaseReturns: Number(
        (db.prepare('SELECT COUNT(*) as c FROM purchase_returns').get() as { c: number })?.c || 0
      ),
      sales: Number((db.prepare('SELECT COUNT(*) as c FROM sales').get() as { c: number })?.c || 0),
      saleReturns: Number(
        (db.prepare('SELECT COUNT(*) as c FROM sale_returns').get() as { c: number })?.c || 0
      ),
      journalEntries: Number(
        (db.prepare('SELECT COUNT(*) as c FROM journal_entries').get() as { c: number })?.c || 0
      ),
      vouchers: Number(
        (db.prepare('SELECT COUNT(*) as c FROM accounting_vouchers').get() as { c: number })?.c || 0
      ),
      backups: Number(
        (db.prepare('SELECT COUNT(*) as c FROM backup_history').get() as { c: number })?.c || 0
      ),
    };

    const buildMeta = getBuildMetadata();

    return res.json({
      success: true,
      appInfo: {
        name: 'ABRAR MEDICAL STORE — Enterprise Pharmacy & Accounting ERP',
        version: APP_VERSION,
        buildId: buildMeta.buildId,
        buildHash: buildMeta.buildHash,
        builtAt: buildMeta.builtAt,
        releasePhase: APP_RELEASE_PHASE,
        architecture: 'Centralized Node.js + Express + SQLite (WAL Mode) Single-Source-of-Truth Server',
        nodeVersion: process.version,
        platform: `${os.type()} ${os.release()} (${os.arch()})`,
        hostname: os.hostname(),
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
      },
      networkReadiness: {
        bindAddress: '0.0.0.0',
        port: config.port,
        localLoopbackUrl: `http://localhost:${config.port}`,
        lanEndpoints: lanAddresses,
        centralDatabaseEnforced: true,
        centralDatabasePath: config.databasePath,
      },
      database: dbStatus,
      recordCounts,
      periods,
      migrations,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to load system info: ${errorMsg}`,
    });
  }
});

/**
 * Architectural Modules Catalog
 */
systemRouter.get('/modules', authenticateToken, (_req: Request, res: Response) => {
  res.json({
    success: true,
    modules: MODULE_CATALOG,
    taskPhase: APP_RELEASE_PHASE,
    rulesEnforced: [
      'No dummy data or fake business records',
      'No sample invoices or unverified transactions',
      'Printed invoices strictly match saved database records without recalculation',
      'Relational schema verified and persisted in SQLite WAL mode',
      'Automatic daily backups & pre-change safety backups enabled',
      'Posted invoices protected from unauthorized editing or physical deletion',
      'Default currency set to PKR (Rs.) & Asia/Karachi (UTC+5) timezone',
    ],
  });
});

/**
 * Run On-Demand Integrity Check
 */
systemRouter.post('/integrity-check', authenticateToken, (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const result = db.pragma('integrity_check', { simple: true });
    res.json({
      success: true,
      result: String(result),
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * Demo / Temporary Data Detection & Safe Purge
 * Allows administrators to preview and remove sample/testing/demo data
 * while strictly safeguarding all genuine business data, catalog items,
 * accounts, real sales, and purchases.
 */
systemRouter.get('/demo-data', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({ success: false, error: 'Unauthorized to view system demo data.' });
  }

  try {
    const db = getDatabase();

    // 1. Detected Demo / Sample / Test Records
    const demoSales = db
      .prepare(
        "SELECT COUNT(*) as c FROM sales WHERE invoice_number LIKE '%TEST%' OR remarks LIKE '%demo%' OR remarks LIKE '%test%' OR customer_name LIKE '%Demo%' OR customer_name LIKE '%Test%'"
      )
      .get() as { c: number };

    const demoPurchases = db
      .prepare(
        `SELECT COUNT(*) as c FROM purchases p
         LEFT JOIN accounts a ON p.supplier_account_id = a.id
         WHERE p.bill_number LIKE '%TEST%'
            OR p.supplier_invoice_number LIKE '%TEST%'
            OR p.remarks LIKE '%demo%'
            OR p.remarks LIKE '%test%'
            OR a.account_name LIKE '%Demo%'
            OR a.account_name LIKE '%Test%'`
      )
      .get() as { c: number };

    const demoVouchers = db
      .prepare(
        "SELECT COUNT(*) as c FROM accounting_vouchers WHERE voucher_number LIKE '%TEST%' OR narration LIKE '%demo%' OR narration LIKE '%test%'"
      )
      .get() as { c: number };

    const demoStockAdjustments = db
      .prepare(
        "SELECT COUNT(*) as c FROM stock_adjustments WHERE reason LIKE '%demo%' OR reason LIKE '%test%' OR adjustment_number LIKE '%TEST%'"
      )
      .get() as { c: number };

    const expiredSessions = db
      .prepare('SELECT COUNT(*) as c FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP')
      .get() as { c: number };

    const resolvedErrorLogs = db
      .prepare('SELECT COUNT(*) as c FROM system_error_logs')
      .get() as { c: number };

    const demoAuditLogs = db
      .prepare(
        "SELECT COUNT(*) as c FROM auth_audit_logs WHERE details LIKE '%demo%' OR details LIKE '%test%' OR details LIKE '%TEST%' OR action IN ('LOGIN_SUCCESS', 'LOGOUT', 'LOGIN_FAILED')"
      )
      .get() as { c: number };

    const demoItems = db
      .prepare(
        "SELECT COUNT(*) as c FROM items WHERE item_code LIKE 'TEST-%' OR item_code LIKE 'DEMO-%' OR item_name LIKE '%(Test Item)%' OR item_name LIKE '%(Demo)%'"
      )
      .get() as { c: number };

    const totalDemo =
      demoSales.c +
      demoPurchases.c +
      demoVouchers.c +
      demoStockAdjustments.c +
      expiredSessions.c +
      resolvedErrorLogs.c +
      demoAuditLogs.c +
      demoItems.c;

    // 2. Genuine Business Records That Will NEVER Be Deleted
    const genuineItems = db
      .prepare(
        "SELECT COUNT(*) as c FROM items WHERE NOT (item_code LIKE 'TEST-%' OR item_code LIKE 'DEMO-%' OR item_name LIKE '%(Test Item)%' OR item_name LIKE '%(Demo)%')"
      )
      .get() as { c: number };

    const genuineAccounts = db
      .prepare('SELECT COUNT(*) as c FROM accounts WHERE status = ?')
      .get('Active') as { c: number };

    const genuineSales = db
      .prepare(
        "SELECT COUNT(*) as c FROM sales WHERE NOT (COALESCE(invoice_number, '') LIKE '%TEST%' OR COALESCE(remarks, '') LIKE '%demo%' OR COALESCE(remarks, '') LIKE '%test%' OR COALESCE(customer_name, '') LIKE '%Demo%' OR COALESCE(customer_name, '') LIKE '%Test%')"
      )
      .get() as { c: number };

    const genuinePurchases = db
      .prepare(
        `SELECT COUNT(*) as c FROM purchases p
         LEFT JOIN accounts a ON p.supplier_account_id = a.id
         WHERE NOT (
           COALESCE(p.bill_number, '') LIKE '%TEST%'
           OR COALESCE(p.supplier_invoice_number, '') LIKE '%TEST%'
           OR COALESCE(p.remarks, '') LIKE '%demo%'
           OR COALESCE(p.remarks, '') LIKE '%test%'
           OR COALESCE(a.account_name, '') LIKE '%Demo%'
           OR COALESCE(a.account_name, '') LIKE '%Test%'
         )`
      )
      .get() as { c: number };

    const inventoryBatches = db
      .prepare('SELECT COUNT(*) as c FROM inventory WHERE current_pack_qty > 0')
      .get() as { c: number };

    return res.json({
      success: true,
      demoSummary: {
        demoSales: demoSales.c,
        demoPurchases: demoPurchases.c,
        demoVouchers: demoVouchers.c,
        demoStockAdjustments: demoStockAdjustments.c,
        expiredSessions: expiredSessions.c,
        resolvedErrorLogs: resolvedErrorLogs.c,
        demoAuditLogs: demoAuditLogs.c,
        demoItems: demoItems.c,
        totalDemoRecords: totalDemo,
      },
      genuineProtected: {
        genuineItems: genuineItems.c,
        genuineAccounts: genuineAccounts.c,
        genuineSales: genuineSales.c,
        genuinePurchases: genuinePurchases.c,
        inventoryBatches: inventoryBatches.c,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

systemRouter.post('/demo-data/clear', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({ success: false, error: 'Unauthorized to clear demo data.' });
  }

  try {
    // A. Automatic Safety Backup Snapshot before clearing demo data
    const safetyBackup = createDatabaseBackup({
      backupType: 'pre_change',
      createdBy: req.user?.username || 'admin',
      notes: 'Automatic safety snapshot before clearing temporary / demo data',
    });

    const db = getDatabase();

    const result = db.transaction(() => {
      // Helper to safely delete journal entries and their child lines
      const deleteJournalEntriesByRef = (refType: string, refId: number) => {
        const jRows = db
          .prepare('SELECT id FROM journal_entries WHERE reference_type = ? AND reference_id = ?')
          .all(refType, refId) as Array<{ id: number }>;
        for (const j of jRows) {
          db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(j.id);
          db.prepare('DELETE FROM journal_entries WHERE id = ?').run(j.id);
        }
      };

      // 1. Delete Demo Sales & Items
      const demoSaleIds = db
        .prepare(
          "SELECT id, journal_entry_id, payment_journal_entry_id FROM sales WHERE invoice_number LIKE '%TEST%' OR remarks LIKE '%demo%' OR remarks LIKE '%test%' OR customer_name LIKE '%Demo%' OR customer_name LIKE '%Test%'"
        )
        .all() as Array<{ id: number; journal_entry_id?: number; payment_journal_entry_id?: number }>;

      let deletedSales = 0;
      let deletedSaleItems = 0;
      for (const s of demoSaleIds) {
        const delItems = db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(s.id);
        deletedSaleItems += delItems.changes;
        const delSale = db.prepare('DELETE FROM sales WHERE id = ?').run(s.id);
        deletedSales += delSale.changes;
        deleteJournalEntriesByRef('SALE', s.id);
        for (const jId of [s.journal_entry_id, s.payment_journal_entry_id]) {
          if (jId) {
            db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(jId);
            db.prepare('DELETE FROM journal_entries WHERE id = ?').run(jId);
          }
        }
      }

      // 2. Delete Demo Purchases & Items
      const demoPurIds = db
        .prepare(
          `SELECT p.id, p.journal_entry_id, p.payment_journal_entry_id FROM purchases p
           LEFT JOIN accounts a ON p.supplier_account_id = a.id
           WHERE p.bill_number LIKE '%TEST%'
              OR p.supplier_invoice_number LIKE '%TEST%'
              OR p.remarks LIKE '%demo%'
              OR p.remarks LIKE '%test%'
              OR a.account_name LIKE '%Demo%'
              OR a.account_name LIKE '%Test%'`
        )
        .all() as Array<{ id: number; journal_entry_id?: number; payment_journal_entry_id?: number }>;

      let deletedPurchases = 0;
      let deletedPurchaseItems = 0;
      for (const p of demoPurIds) {
        const delItems = db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(p.id);
        deletedPurchaseItems += delItems.changes;
        const delPur = db.prepare('DELETE FROM purchases WHERE id = ?').run(p.id);
        deletedPurchases += delPur.changes;
        deleteJournalEntriesByRef('PURCHASE', p.id);
        for (const jId of [p.journal_entry_id, p.payment_journal_entry_id]) {
          if (jId) {
            db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(jId);
            db.prepare('DELETE FROM journal_entries WHERE id = ?').run(jId);
          }
        }
      }

      // 3. Delete Demo Vouchers
      const demoVouchers = db
        .prepare(
          "SELECT id, journal_entry_id FROM accounting_vouchers WHERE voucher_number LIKE '%TEST%' OR narration LIKE '%demo%' OR narration LIKE '%test%'"
        )
        .all() as Array<{ id: number; journal_entry_id?: number }>;

      let deletedVouchers = 0;
      for (const v of demoVouchers) {
        db.prepare('DELETE FROM accounting_voucher_lines WHERE voucher_id = ?').run(v.id);
        const delV = db.prepare('DELETE FROM accounting_vouchers WHERE id = ?').run(v.id);
        deletedVouchers += delV.changes;
        deleteJournalEntriesByRef('VOUCHER', v.id);
        if (v.journal_entry_id) {
          db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(v.journal_entry_id);
          db.prepare('DELETE FROM journal_entries WHERE id = ?').run(v.journal_entry_id);
        }
      }

      // 4. Delete Demo Stock Adjustments
      const demoAdjustments = db
        .prepare(
          "SELECT id FROM stock_adjustments WHERE reason LIKE '%demo%' OR reason LIKE '%test%' OR adjustment_number LIKE '%TEST%'"
        )
        .all() as Array<{ id: number }>;

      let deletedAdjustments = 0;
      for (const adj of demoAdjustments) {
        db.prepare('DELETE FROM stock_adjustment_items WHERE adjustment_id = ?').run(adj.id);
        const delAdj = db.prepare('DELETE FROM stock_adjustments WHERE id = ?').run(adj.id);
        deletedAdjustments += delAdj.changes;
      }

      // 5. Delete Expired User Sessions
      const delSessions = db
        .prepare('DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP')
        .run();

      // 6. Delete System Error Logs
      const delErrors = db.prepare('DELETE FROM system_error_logs').run();

      // 7. Delete explicitly tagged Demo Items (only if not referenced by genuine sales/purchases)
      const demoItemRows = db
        .prepare(
          "SELECT id FROM items WHERE item_code LIKE 'TEST-%' OR item_code LIKE 'DEMO-%' OR item_code LIKE 'VERIFY-%' OR item_name LIKE '%(Test Item)%' OR item_name LIKE '%(Demo)%' OR item_name LIKE '%Verify Medicine%'"
        )
        .all() as Array<{ id: number }>;

      let deletedDemoItemsCount = 0;
      for (const dit of demoItemRows) {
        const hasSales = db.prepare('SELECT COUNT(*) as c FROM sale_items WHERE item_id = ?').get(dit.id) as { c: number };
        const hasPurchases = db.prepare('SELECT COUNT(*) as c FROM purchase_items WHERE item_id = ?').get(dit.id) as { c: number };
        if (hasSales.c === 0 && hasPurchases.c === 0) {
          db.prepare('DELETE FROM inventory WHERE item_id = ?').run(dit.id);
          const delIt = db.prepare('DELETE FROM items WHERE id = ?').run(dit.id);
          deletedDemoItemsCount += delIt.changes;
        }
      }

      // 7b. Delete orphaned test journal entries and recalculate all account balances
      const orphanTestJes = db
        .prepare(`
          SELECT id FROM journal_entries
          WHERE description LIKE '%Verify Customer Clinic%'
             OR description LIKE '%Verify Supplier Co%'
             OR description LIKE '%Verify Medicine%'
             OR (reference_type IN ('SALE', 'SALES') AND reference_id IS NOT NULL AND reference_id NOT IN (SELECT id FROM sales))
             OR (reference_type = 'PURCHASE' AND reference_id IS NOT NULL AND reference_id NOT IN (SELECT id FROM purchases))
        `)
        .all() as Array<{ id: number }>;
      for (const je of orphanTestJes) {
        db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(je.id);
        db.prepare('DELETE FROM journal_entries WHERE id = ?').run(je.id);
      }

      const allAccs = db
        .prepare('SELECT id, opening_balance, opening_balance_type FROM accounts')
        .all() as Array<{ id: number; opening_balance: number; opening_balance_type: string }>;
      const sumStmt = db.prepare(`
        SELECT COALESCE(SUM(jl.debit_amount), 0) as d, COALESCE(SUM(jl.credit_amount), 0) as c
        FROM journal_entry_lines jl
        INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE jl.account_id = ? AND je.status = 'posted'
      `);
      const updAcc = db.prepare(`
        UPDATE accounts SET
          total_debit = ?,
          total_credit = ?,
          current_balance = ?,
          current_balance_type = ?
        WHERE id = ?
      `);
      for (const a of allAccs) {
        const sums = sumStmt.get(a.id) as { d: number; c: number };
        const openDebit = a.opening_balance_type === 'Debit' ? Number(a.opening_balance) || 0 : 0;
        const openCredit = a.opening_balance_type === 'Credit' ? Number(a.opening_balance) || 0 : 0;
        const td = Math.round((openDebit + (Number(sums.d) || 0)) * 100) / 100;
        const tc = Math.round((openCredit + (Number(sums.c) || 0)) * 100) / 100;
        const net = Math.round((td - tc) * 100) / 100;
        const cb = Math.abs(net);
        const cbt = net >= 0 ? 'Debit' : 'Credit';
        updAcc.run(td, tc, cb, cbt, a.id);
      }

      // 8. Security Audit Log
      try {
        db.prepare(
          `INSERT INTO auth_audit_logs (user_id, username, action, status, details)
           VALUES (?, ?, 'CLEAR_DEMO_DATA', 'SUCCESS', ?)`
        ).run(
          req.user?.id || 1,
          req.user?.username || 'admin',
          `Cleared temporary/demo data: ${deletedSales} sales, ${deletedPurchases} purchases, ${deletedVouchers} vouchers, ${deletedAdjustments} stock adjustments, ${delSessions.changes} expired sessions, ${delErrors.changes} error logs, ${deletedDemoItemsCount} demo items. Safety backup: ${safetyBackup.filename}`
        );
      } catch {
        // ignore audit log error
      }

      return {
        deletedSales,
        deletedSaleItems,
        deletedPurchases,
        deletedPurchaseItems,
        deletedVouchers,
        deletedAdjustments,
        deletedSessions: delSessions.changes,
        deletedResolvedErrors: delErrors.changes,
        deletedDemoItems: deletedDemoItemsCount,
        totalCleared:
          deletedSales +
          deletedPurchases +
          deletedVouchers +
          deletedAdjustments +
          delSessions.changes +
          delErrors.changes +
          deletedDemoItemsCount +
          orphanTestJes.length,
      };
    })();

    return res.json({
      success: true,
      message: `Temporary & demo data cleared successfully (${result.totalCleared} records purged). All genuine business records remain completely protected.`,
      result,
      safetyBackup: {
        filename: safetyBackup.filename,
        sizeBytes: safetyBackup.file_size_bytes,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Failed to clear demo data: ${msg}` });
  }
});

/**
 * POST /api/system/demo-logs/clear
 * Clears temporary/demo/test error logs and session/test audit logs while preserving genuine business transaction logs
 */
systemRouter.post('/demo-logs/clear', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({ success: false, error: 'Unauthorized to clear demo logs.' });
  }

  try {
    const db = getDatabase();
    const result = db.transaction(() => {
      const delErrorLogs = db.prepare('DELETE FROM system_error_logs').run();
      const delDemoAuditLogs = db
        .prepare(
          "DELETE FROM auth_audit_logs WHERE details LIKE '%demo%' OR details LIKE '%test%' OR details LIKE '%TEST%' OR action IN ('LOGIN_SUCCESS', 'LOGOUT', 'LOGIN_FAILED')"
        )
        .run();
      const delExpiredSessions = db
        .prepare('DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP')
        .run();

      return {
        deletedErrorLogs: delErrorLogs.changes,
        deletedDemoAuditLogs: delDemoAuditLogs.changes,
        deletedExpiredSessions: delExpiredSessions.changes,
        totalLogsCleared:
          delErrorLogs.changes + delDemoAuditLogs.changes + delExpiredSessions.changes,
      };
    })();

    return res.json({
      success: true,
      message: `Demo & temporary logs cleared successfully (${result.totalLogsCleared} log entries removed). Genuine business transaction logs remain intact.`,
      result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Failed to clear demo logs: ${msg}` });
  }
});

/**
 * GET /api/system/dashboard-analytics
 * Strictly read-only comprehensive dashboard analytics endpoint.
 * Computes real-time summary cards, interactive sales series, purchase vs sales comparison,
 * actual gross profit analysis (daily, monthly, account-wise, item-wise), and 8 operational tables.
 */
systemRouter.get('/dashboard-analytics', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const todayIso = getPakistanDateISO();
    const currentMonthPrefix = todayIso.slice(0, 7); // YYYY-MM
    const firstOfMonth = `${currentMonthPrefix}-01`;

    const startDate =
      typeof req.query.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.startDate)
        ? req.query.startDate
        : firstOfMonth;
    const endDate =
      typeof req.query.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.endDate)
        ? req.query.endDate
        : todayIso;

    // 1. Today's Sales & Period Sales
    const todaySalesRow = db
      .prepare(
        `SELECT COALESCE(SUM(net_total), 0) AS total, COUNT(*) AS cnt
         FROM sales
         WHERE LOWER(status) = 'completed' AND date(invoice_date) = date(?)`
      )
      .get(todayIso) as { total: number; cnt: number };

    const periodSalesRow = db
      .prepare(
        `SELECT COALESCE(SUM(net_total), 0) AS total, COUNT(*) AS cnt
         FROM sales
         WHERE LOWER(status) = 'completed' AND date(invoice_date) BETWEEN date(?) AND date(?)`
      )
      .get(startDate, endDate) as { total: number; cnt: number };

    const monthlySalesRow = db
      .prepare(
        `SELECT COALESCE(SUM(net_total), 0) AS total, COUNT(*) AS cnt
         FROM sales
         WHERE LOWER(status) = 'completed' AND strftime('%Y-%m', invoice_date) = ?`
      )
      .get(currentMonthPrefix) as { total: number; cnt: number };

    // 2. Today's Purchases, Period Purchases & Monthly Purchases
    const todayPurchasesRow = db
      .prepare(
        `SELECT COALESCE(SUM(net_total), 0) AS total, COUNT(*) AS cnt
         FROM purchases
         WHERE LOWER(status) = 'completed' AND date(bill_date) = date(?)`
      )
      .get(todayIso) as { total: number; cnt: number };

    const periodPurchasesRow = db
      .prepare(
        `SELECT COALESCE(SUM(net_total), 0) AS total, COUNT(*) AS cnt
         FROM purchases
         WHERE LOWER(status) = 'completed' AND date(bill_date) BETWEEN date(?) AND date(?)`
      )
      .get(startDate, endDate) as { total: number; cnt: number };

    const monthlyPurchasesRow = db
      .prepare(
        `SELECT COALESCE(SUM(net_total), 0) AS total, COUNT(*) AS cnt
         FROM purchases
         WHERE LOWER(status) = 'completed' AND strftime('%Y-%m', bill_date) = ?`
      )
      .get(currentMonthPrefix) as { total: number; cnt: number };

    // 3. Actual Gross Profit (Today & Selected Period)
    // Net Revenue = taxable_amount adjusted for returned_total_units
    // Cost of Goods Sold = (total_units - returned_total_units) * effective_unit_cost
    const effectiveUnitCostSql = `CASE
      WHEN COALESCE(si.cost_price_per_unit, 0) > 0 THEN si.cost_price_per_unit
      WHEN COALESCE(inv.pack_cost, 0) > 0 THEN inv.pack_cost * 1.0 / CASE WHEN COALESCE(si.units_per_pack, i.units_per_pack, 1) > 0 THEN COALESCE(si.units_per_pack, i.units_per_pack, 1) ELSE 1 END
      WHEN COALESCE(i.purchase_price, 0) > 0 THEN i.purchase_price * 1.0 / CASE WHEN COALESCE(si.units_per_pack, i.units_per_pack, 1) > 0 THEN COALESCE(si.units_per_pack, i.units_per_pack, 1) ELSE 1 END
      ELSE 0
    END`;

    const todayProfitRow = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN si.total_units > 0 THEN si.taxable_amount * ((si.total_units - COALESCE(si.returned_total_units, 0)) * 1.0 / si.total_units) ELSE 0 END), 0) AS netRevenue,
           COALESCE(SUM((si.total_units - COALESCE(si.returned_total_units, 0)) * (${effectiveUnitCostSql})), 0) AS totalCost
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         LEFT JOIN items i ON i.id = si.item_id
         LEFT JOIN inventory inv ON inv.id = si.inventory_id
         WHERE LOWER(s.status) = 'completed' AND date(s.invoice_date) = date(?)`
      )
      .get(todayIso) as { netRevenue: number; totalCost: number };

    const periodProfitRow = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN si.total_units > 0 THEN si.taxable_amount * ((si.total_units - COALESCE(si.returned_total_units, 0)) * 1.0 / si.total_units) ELSE 0 END), 0) AS netRevenue,
           COALESCE(SUM((si.total_units - COALESCE(si.returned_total_units, 0)) * (${effectiveUnitCostSql})), 0) AS totalCost
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         LEFT JOIN items i ON i.id = si.item_id
         LEFT JOIN inventory inv ON inv.id = si.inventory_id
         WHERE LOWER(s.status) = 'completed' AND date(s.invoice_date) BETWEEN date(?) AND date(?)`
      )
      .get(startDate, endDate) as { netRevenue: number; totalCost: number };

    const todayGrossProfit = Number((todayProfitRow.netRevenue - todayProfitRow.totalCost).toFixed(2));
    const periodGrossProfit = Number((periodProfitRow.netRevenue - periodProfitRow.totalCost).toFixed(2));

    // 4. Receivables, Payables, Cash in Hand, Bank Balance
    const receivablesRow = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN current_balance_type IN ('Debit', 'Dr') THEN current_balance ELSE 0 END), 0) AS total,
                COUNT(CASE WHEN current_balance_type IN ('Debit', 'Dr') AND current_balance > 0 THEN 1 END) AS cnt
         FROM accounts
         WHERE LOWER(status) = 'active' AND account_group = 'Customers'`
      )
      .get() as { total: number; cnt: number };

    const payablesRow = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN current_balance_type IN ('Credit', 'Cr') THEN current_balance ELSE 0 END), 0) AS total,
                COUNT(CASE WHEN current_balance_type IN ('Credit', 'Cr') AND current_balance > 0 THEN 1 END) AS cnt
         FROM accounts
         WHERE LOWER(status) = 'active' AND account_group = 'Suppliers'`
      )
      .get() as { total: number; cnt: number };

    const cashRow = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN current_balance_type IN ('Debit', 'Dr') THEN current_balance ELSE -current_balance END), 0) AS total
         FROM accounts
         WHERE LOWER(status) = 'active' AND (account_group = 'Cash in Hand' OR account_code = '1010')`
      )
      .get() as { total: number };

    const bankRow = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN current_balance_type IN ('Debit', 'Dr') THEN current_balance ELSE -current_balance END), 0) AS total
         FROM accounts
         WHERE LOWER(status) = 'active' AND account_group = 'Bank Accounts'`
      )
      .get() as { total: number };

    // 5. Total Items, Low Stock Items Count, Near Expiry Items Count
    const totalItemsRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM items WHERE LOWER(status) = 'active'`)
      .get() as { cnt: number };

    const lowStockList = db
      .prepare(
        `SELECT
           i.id,
           i.item_code,
           i.item_name,
           i.category,
           i.company_name,
           i.packing,
           CASE WHEN COALESCE(i.minimum_stock, 0) > 0 THEN i.minimum_stock ELSE 10 END AS reorder_level,
           COALESCE(SUM(CASE WHEN inv.status != 'expired' THEN inv.total_stock_units ELSE 0 END), 0) AS current_stock_units
         FROM items i
         LEFT JOIN inventory inv ON inv.item_id = i.id
         WHERE LOWER(i.status) = 'active'
         GROUP BY i.id
         HAVING current_stock_units <= (CASE WHEN COALESCE(i.minimum_stock, 0) > 0 THEN i.minimum_stock ELSE 10 END)
         ORDER BY current_stock_units ASC, i.item_name ASC`
      )
      .all() as Array<{
      id: number;
      item_code: string;
      item_name: string;
      category: string;
      company_name: string;
      packing: string;
      reorder_level: number;
      current_stock_units: number;
    }>;

    const nearExpiryList = db
      .prepare(
        `SELECT
           inv.id AS batch_id,
           inv.item_id,
           i.item_code,
           i.item_name,
           i.company_name,
           inv.batch_number,
           inv.expiry_date,
           inv.total_stock_units,
           inv.current_pack_qty,
           CAST(julianday(inv.expiry_date) - julianday(?) AS INTEGER) AS days_remaining
         FROM inventory inv
         INNER JOIN items i ON i.id = inv.item_id
         WHERE inv.total_stock_units > 0
           AND inv.expiry_date IS NOT NULL
           AND inv.expiry_date != ''
           AND date(inv.expiry_date) <= date(?)
         ORDER BY date(inv.expiry_date) ASC
         LIMIT 50`
      )
      .all(todayIso, addDaysToIsoDate(todayIso, 90)) as Array<{
      batch_id: number;
      item_id: number;
      item_code: string;
      item_name: string;
      company_name: string;
      batch_number: string;
      expiry_date: string;
      total_stock_units: number;
      current_pack_qty: number;
      days_remaining: number;
    }>;

    // B. Interactive Sales Graph (Daily, Weekly, Monthly, Yearly)
    const dailySalesSeries = db
      .prepare(
        `SELECT
           date(invoice_date) AS label,
           COALESCE(SUM(net_total), 0) AS sales,
           COUNT(*) AS count
         FROM sales
         WHERE LOWER(status) = 'completed' AND date(invoice_date) BETWEEN date(?) AND date(?)
         GROUP BY date(invoice_date)
         ORDER BY date(invoice_date) ASC`
      )
      .all(startDate, endDate) as Array<{ label: string; sales: number; count: number }>;

    const weeklySalesSeries = db
      .prepare(
        `SELECT
           strftime('%Y-W%W', invoice_date) AS label,
           MIN(date(invoice_date)) AS weekStart,
           COALESCE(SUM(net_total), 0) AS sales,
           COUNT(*) AS count
         FROM sales
         WHERE LOWER(status) = 'completed' AND date(invoice_date) BETWEEN date(?, '-84 days') AND date(?)
         GROUP BY strftime('%Y-W%W', invoice_date)
         ORDER BY label ASC`
      )
      .all(endDate, endDate) as Array<{ label: string; weekStart: string; sales: number; count: number }>;

    const monthlySalesSeries = db
      .prepare(
        `SELECT
           strftime('%Y-%m', invoice_date) AS label,
           COALESCE(SUM(net_total), 0) AS sales,
           COUNT(*) AS count
         FROM sales
         WHERE LOWER(status) = 'completed'
         GROUP BY strftime('%Y-%m', invoice_date)
         ORDER BY label ASC
         LIMIT 12`
      )
      .all() as Array<{ label: string; sales: number; count: number }>;

    const yearlySalesSeries = db
      .prepare(
        `SELECT
           strftime('%Y', invoice_date) AS label,
           COALESCE(SUM(net_total), 0) AS sales,
           COUNT(*) AS count
         FROM sales
         WHERE LOWER(status) = 'completed'
         GROUP BY strftime('%Y', invoice_date)
         ORDER BY label ASC`
      )
      .all() as Array<{ label: string; sales: number; count: number }>;

    // C. Purchase vs Sales Comparison Graph (Across selected date range)
    const purchaseByDayRows = db
      .prepare(
        `SELECT
           date(bill_date) AS label,
           COALESCE(SUM(net_total), 0) AS purchases,
           COUNT(*) AS count
         FROM purchases
         WHERE LOWER(status) = 'completed' AND date(bill_date) BETWEEN date(?) AND date(?)
         GROUP BY date(bill_date)
         ORDER BY date(bill_date) ASC`
      )
      .all(startDate, endDate) as Array<{ label: string; purchases: number; count: number }>;

    const dateKeysSet = new Set<string>();
    dailySalesSeries.forEach((r) => dateKeysSet.add(r.label));
    purchaseByDayRows.forEach((r) => dateKeysSet.add(r.label));
    const sortedDates = Array.from(dateKeysSet).sort();

    const salesMap = new Map(dailySalesSeries.map((r) => [r.label, r.sales]));
    const purchasesMap = new Map(purchaseByDayRows.map((r) => [r.label, r.purchases]));

    const purchaseVsSalesSeries = sortedDates.map((d) => {
      const s = Number((salesMap.get(d) || 0).toFixed(2));
      const p = Number((purchasesMap.get(d) || 0).toFixed(2));
      return {
        label: d,
        sales: s,
        purchases: p,
        netDifference: Number((s - p).toFixed(2)),
      };
    });

    // D. Profit Analysis Graph (Daily, Monthly, Account-wise, Item-wise)
    const dailyProfitSeries = db
      .prepare(
        `SELECT
           date(s.invoice_date) AS label,
           COALESCE(SUM(CASE WHEN si.total_units > 0 THEN si.taxable_amount * ((si.total_units - COALESCE(si.returned_total_units, 0)) * 1.0 / si.total_units) ELSE 0 END), 0) AS revenue,
           COALESCE(SUM((si.total_units - COALESCE(si.returned_total_units, 0)) * (${effectiveUnitCostSql})), 0) AS cost
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         LEFT JOIN items i ON i.id = si.item_id
         LEFT JOIN inventory inv ON inv.id = si.inventory_id
         WHERE LOWER(s.status) = 'completed' AND date(s.invoice_date) BETWEEN date(?) AND date(?)
         GROUP BY date(s.invoice_date)
         ORDER BY date(s.invoice_date) ASC`
      )
      .all(startDate, endDate)
      .map((r: any) => {
        const rev = Number(Number(r.revenue || 0).toFixed(2));
        const cost = Number(Number(r.cost || 0).toFixed(2));
        const profit = Number((rev - cost).toFixed(2));
        return {
          label: r.label,
          revenue: rev,
          cost,
          grossProfit: profit,
          marginPercent: rev > 0 ? Number(((profit / rev) * 100).toFixed(1)) : 0,
        };
      });

    const monthlyProfitSeries = db
      .prepare(
        `SELECT
           strftime('%Y-%m', s.invoice_date) AS label,
           COALESCE(SUM(CASE WHEN si.total_units > 0 THEN si.taxable_amount * ((si.total_units - COALESCE(si.returned_total_units, 0)) * 1.0 / si.total_units) ELSE 0 END), 0) AS revenue,
           COALESCE(SUM((si.total_units - COALESCE(si.returned_total_units, 0)) * (${effectiveUnitCostSql})), 0) AS cost
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         LEFT JOIN items i ON i.id = si.item_id
         LEFT JOIN inventory inv ON inv.id = si.inventory_id
         WHERE LOWER(s.status) = 'completed'
         GROUP BY strftime('%Y-%m', s.invoice_date)
         ORDER BY label ASC
         LIMIT 12`
      )
      .all()
      .map((r: any) => {
        const rev = Number(Number(r.revenue || 0).toFixed(2));
        const cost = Number(Number(r.cost || 0).toFixed(2));
        const profit = Number((rev - cost).toFixed(2));
        return {
          label: r.label,
          revenue: rev,
          cost,
          grossProfit: profit,
          marginPercent: rev > 0 ? Number(((profit / rev) * 100).toFixed(1)) : 0,
        };
      });

    const accountProfitSeries = db
      .prepare(
        `SELECT
           COALESCE(s.customer_account_id, 0) AS accountId,
           COALESCE(a.account_code, 'WALK-IN') AS accountCode,
           COALESCE(a.account_name, COALESCE(NULLIF(s.customer_name, ''), 'Walk-in Customer')) AS accountName,
           COUNT(DISTINCT s.id) AS invoiceCount,
           COALESCE(SUM(CASE WHEN si.total_units > 0 THEN si.taxable_amount * ((si.total_units - COALESCE(si.returned_total_units, 0)) * 1.0 / si.total_units) ELSE 0 END), 0) AS revenue,
           COALESCE(SUM((si.total_units - COALESCE(si.returned_total_units, 0)) * (${effectiveUnitCostSql})), 0) AS cost
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         LEFT JOIN items i ON i.id = si.item_id
         LEFT JOIN inventory inv ON inv.id = si.inventory_id
         LEFT JOIN accounts a ON a.id = s.customer_account_id
         WHERE LOWER(s.status) = 'completed' AND date(s.invoice_date) BETWEEN date(?) AND date(?)
         GROUP BY COALESCE(s.customer_account_id, 0), COALESCE(a.account_name, COALESCE(NULLIF(s.customer_name, ''), 'Walk-in Customer'))
         ORDER BY (revenue - cost) DESC
         LIMIT 15`
      )
      .all(startDate, endDate)
      .map((r: any) => {
        const rev = Number(Number(r.revenue || 0).toFixed(2));
        const cost = Number(Number(r.cost || 0).toFixed(2));
        const profit = Number((rev - cost).toFixed(2));
        return {
          accountId: r.accountId,
          accountCode: r.accountCode,
          label: r.accountName,
          accountName: r.accountName,
          invoiceCount: Number(r.invoiceCount || 0),
          revenue: rev,
          cost,
          grossProfit: profit,
          marginPercent: rev > 0 ? Number(((profit / rev) * 100).toFixed(1)) : 0,
        };
      });

    const itemProfitSeries = db
      .prepare(
        `SELECT
           si.item_id AS itemId,
           COALESCE(i.item_code, si.item_code) AS itemCode,
           COALESCE(i.item_name, si.item_name) AS itemName,
           SUM(si.total_units - COALESCE(si.returned_total_units, 0)) AS netUnitsSold,
           COALESCE(SUM(CASE WHEN si.total_units > 0 THEN si.taxable_amount * ((si.total_units - COALESCE(si.returned_total_units, 0)) * 1.0 / si.total_units) ELSE 0 END), 0) AS revenue,
           COALESCE(SUM((si.total_units - COALESCE(si.returned_total_units, 0)) * (${effectiveUnitCostSql})), 0) AS cost
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         LEFT JOIN items i ON i.id = si.item_id
         LEFT JOIN inventory inv ON inv.id = si.inventory_id
         WHERE LOWER(s.status) = 'completed' AND date(s.invoice_date) BETWEEN date(?) AND date(?)
         GROUP BY si.item_id
         ORDER BY (revenue - cost) DESC
         LIMIT 15`
      )
      .all(startDate, endDate)
      .map((r: any) => {
        const rev = Number(Number(r.revenue || 0).toFixed(2));
        const cost = Number(Number(r.cost || 0).toFixed(2));
        const profit = Number((rev - cost).toFixed(2));
        return {
          itemId: r.itemId,
          itemCode: r.itemCode,
          label: r.itemName,
          itemName: r.itemName,
          netUnitsSold: Number(r.netUnitsSold || 0),
          revenue: rev,
          cost,
          grossProfit: profit,
          marginPercent: rev > 0 ? Number(((profit / rev) * 100).toFixed(1)) : 0,
        };
      });

    // E. 8 Additional Dashboard Sections
    // 1. Top 10 Selling Items (within period)
    const topSellingItems = db
      .prepare(
        `SELECT
           si.item_id AS itemId,
           COALESCE(i.item_code, si.item_code) AS itemCode,
           COALESCE(i.item_name, si.item_name) AS itemName,
           COALESCE(i.company_name, si.company_name, '') AS companyName,
           SUM(si.total_units - COALESCE(si.returned_total_units, 0)) AS unitsSold,
           COUNT(DISTINCT s.id) AS invoiceCount,
           COALESCE(SUM(CASE WHEN si.total_units > 0 THEN si.taxable_amount * ((si.total_units - COALESCE(si.returned_total_units, 0)) * 1.0 / si.total_units) ELSE 0 END), 0) AS netRevenue,
           COALESCE(SUM((si.total_units - COALESCE(si.returned_total_units, 0)) * COALESCE(si.cost_price_per_unit, 0)), 0) AS totalCost
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         LEFT JOIN items i ON i.id = si.item_id
         WHERE LOWER(s.status) = 'completed' AND date(s.invoice_date) BETWEEN date(?) AND date(?)
         GROUP BY si.item_id
         HAVING unitsSold > 0
         ORDER BY netRevenue DESC, unitsSold DESC
         LIMIT 10`
      )
      .all(startDate, endDate)
      .map((r: any) => ({
        itemId: r.itemId,
        itemCode: r.itemCode,
        itemName: r.itemName,
        companyName: r.companyName,
        unitsSold: Number(r.unitsSold || 0),
        invoiceCount: Number(r.invoiceCount || 0),
        netRevenue: Number(Number(r.netRevenue || 0).toFixed(2)),
        grossProfit: Number((Number(r.netRevenue || 0) - Number(r.totalCost || 0)).toFixed(2)),
      }));

    // 2. Slow Moving Items (Active items with stock > 0 and lowest sales in range)
    const slowMovingItems = db
      .prepare(
        `SELECT
           i.id AS itemId,
           i.item_code AS itemCode,
           i.item_name AS itemName,
           i.company_name AS companyName,
           COALESCE(stock.stockUnits, 0) AS stockUnits,
           COALESCE(sold.unitsSold, 0) AS unitsSoldInPeriod,
           sold.lastSoldDate
         FROM items i
         INNER JOIN (
           SELECT item_id, SUM(total_stock_units) AS stockUnits
           FROM inventory
           WHERE status != 'expired' AND total_stock_units > 0
           GROUP BY item_id
         ) stock ON stock.item_id = i.id
         LEFT JOIN (
           SELECT
             si.item_id,
             SUM(si.total_units - COALESCE(si.returned_total_units, 0)) AS unitsSold,
             MAX(date(s.invoice_date)) AS lastSoldDate
           FROM sale_items si
           INNER JOIN sales s ON s.id = si.sale_id
           WHERE LOWER(s.status) = 'completed' AND date(s.invoice_date) BETWEEN date(?) AND date(?)
           GROUP BY si.item_id
         ) sold ON sold.item_id = i.id
         WHERE LOWER(i.status) = 'active'
         ORDER BY unitsSoldInPeriod ASC, stockUnits DESC
         LIMIT 10`
      )
      .all(startDate, endDate);

    // 3. Recent Sales Invoices
    const recentSales = db
      .prepare(
        `SELECT
           s.id,
           s.invoice_number AS invoiceNumber,
           date(s.invoice_date) AS invoiceDate,
           COALESCE(a.account_name, COALESCE(NULLIF(s.customer_name, ''), 'Walk-in Customer')) AS customerName,
           s.payment_mode AS paymentType,
           s.net_total AS netTotal,
           s.paid_amount AS paidAmount,
           s.status
         FROM sales s
         LEFT JOIN accounts a ON a.id = s.customer_account_id
         WHERE LOWER(s.status) = 'completed'
         ORDER BY date(s.invoice_date) DESC, s.id DESC
         LIMIT 10`
      )
      .all();

    // 4. Recent Purchase Invoices
    const recentPurchases = db
      .prepare(
        `SELECT
           p.id,
           p.bill_number AS billNumber,
           p.supplier_invoice_number AS supplierInvoiceNumber,
           date(p.bill_date) AS billDate,
           COALESCE(a.account_name, 'Supplier') AS supplierName,
           p.payment_mode AS paymentMode,
           p.net_total AS netTotal,
           p.paid_amount AS paidAmount,
           p.status
         FROM purchases p
         LEFT JOIN accounts a ON a.id = p.supplier_account_id
         WHERE LOWER(p.status) = 'completed'
         ORDER BY date(p.bill_date) DESC, p.id DESC
         LIMIT 10`
      )
      .all();

    // 7. Top Customers (within selected date range)
    const topCustomers = db
      .prepare(
        `SELECT
           COALESCE(s.customer_account_id, 0) AS accountId,
           COALESCE(a.account_code, 'WALK-IN') AS accountCode,
           COALESCE(a.account_name, COALESCE(NULLIF(s.customer_name, ''), 'Walk-in Customer')) AS customerName,
           COUNT(s.id) AS invoiceCount,
           COALESCE(SUM(s.net_total), 0) AS totalSales,
           COALESCE(SUM(s.paid_amount), 0) AS totalPaid
         FROM sales s
         LEFT JOIN accounts a ON a.id = s.customer_account_id
         WHERE LOWER(s.status) = 'completed' AND date(s.invoice_date) BETWEEN date(?) AND date(?)
         GROUP BY COALESCE(s.customer_account_id, 0), COALESCE(a.account_name, COALESCE(NULLIF(s.customer_name, ''), 'Walk-in Customer'))
         ORDER BY totalSales DESC
         LIMIT 10`
      )
      .all(startDate, endDate);

    // 8. Outstanding Customer Balances
    const outstandingCustomers = db
      .prepare(
        `SELECT
           id AS accountId,
           account_code AS accountCode,
           account_name AS customerName,
           city,
           phone,
           current_balance AS outstandingBalance,
           current_balance_type AS balanceType
         FROM accounts
         WHERE LOWER(status) = 'active'
           AND account_group IN ('Customer', 'Customers', 'Customer & Supplier')
           AND current_balance_type IN ('Debit', 'Dr')
           AND current_balance > 0
         ORDER BY current_balance DESC
         LIMIT 12`
      )
      .all();

    return res.json({
      success: true,
      filters: {
        startDate,
        endDate,
        todayIso,
        currentMonthPrefix,
      },
      summaryCards: {
        todaySales: Number((todaySalesRow?.total || 0).toFixed(2)),
        todaySalesCount: Number(todaySalesRow?.cnt || 0),
        periodSales: Number((periodSalesRow?.total || 0).toFixed(2)),
        periodSalesCount: Number(periodSalesRow?.cnt || 0),
        todayPurchases: Number((todayPurchasesRow?.total || 0).toFixed(2)),
        todayPurchasesCount: Number(todayPurchasesRow?.cnt || 0),
        periodPurchases: Number((periodPurchasesRow?.total || 0).toFixed(2)),
        periodPurchasesCount: Number(periodPurchasesRow?.cnt || 0),
        todayGrossProfit,
        periodGrossProfit,
        periodNetRevenue: Number((periodProfitRow?.netRevenue || 0).toFixed(2)),
        periodCostOfGoods: Number((periodProfitRow?.totalCost || 0).toFixed(2)),
        monthlySales: Number((monthlySalesRow?.total || 0).toFixed(2)),
        monthlySalesCount: Number(monthlySalesRow?.cnt || 0),
        monthlyPurchases: Number((monthlyPurchasesRow?.total || 0).toFixed(2)),
        monthlyPurchasesCount: Number(monthlyPurchasesRow?.cnt || 0),
        totalReceivables: Number((receivablesRow?.total || 0).toFixed(2)),
        receivablesCustomerCount: Number(receivablesRow?.cnt || 0),
        totalPayables: Number((payablesRow?.total || 0).toFixed(2)),
        payablesSupplierCount: Number(payablesRow?.cnt || 0),
        cashInHand: Number((cashRow?.total || 0).toFixed(2)),
        bankBalance: Number((bankRow?.total || 0).toFixed(2)),
        totalItems: Number(totalItemsRow?.cnt || 0),
        lowStockItemsCount: lowStockList.length,
        nearExpiryItemsCount: nearExpiryList.length,
      },
      salesGraph: {
        daily: dailySalesSeries,
        weekly: weeklySalesSeries,
        monthly: monthlySalesSeries,
        yearly: yearlySalesSeries,
      },
      purchaseVsSales: purchaseVsSalesSeries,
      profitAnalysis: {
        daily: dailyProfitSeries,
        monthly: monthlyProfitSeries,
        byAccount: accountProfitSeries,
        byItem: itemProfitSeries,
      },
      tables: {
        topSellingItems,
        slowMovingItems,
        recentSales,
        recentPurchases,
        lowStockItems: lowStockList.slice(0, 15),
        nearExpiryItems: nearExpiryList.slice(0, 15),
        topCustomers,
        outstandingCustomers,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      success: false,
      error: `Failed to load dashboard analytics: ${msg}`,
    });
  }
});

// ============================================================================
// CUSTOM EXCEL EXPORT TEMPLATES (PERMANENT SQLITE PERSISTENCE)
// ============================================================================

function ensureExcelExportTemplatesTable() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS excel_export_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_type TEXT NOT NULL CHECK(module_type IN ('SALES', 'PURCHASE')),
      template_name TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_by TEXT DEFAULT 'System',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(module_type, template_name COLLATE NOCASE)
    );
  `);

  const countRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM excel_export_templates')
    .get() as { cnt: number };

  if (Number(countRow?.cnt || 0) === 0) {
    const starterTemplates: Array<{
      module_type: 'SALES' | 'PURCHASE';
      template_name: string;
      fields: string[];
      is_default: number;
    }> = [
      // Sales Starter Templates
      {
        module_type: 'SALES',
        template_name: 'Daily Sales Report',
        fields: [
          'invoice_number',
          'invoice_date',
          'customer_name',
          'item_code',
          'item_name',
          'company_name',
          'packing',
          'quantity',
          'bonus_quantity',
          'unit_price',
          'discount_amount',
          'line_total',
          'net_total',
          'paid_amount',
          'balance_amount',
        ],
        is_default: 1,
      },
      {
        module_type: 'SALES',
        template_name: 'Customer Sales Report',
        fields: [
          'customer_code',
          'customer_name',
          'buyer_name',
          'invoice_number',
          'invoice_date',
          'payment_mode',
          'item_name',
          'quantity',
          'unit_price',
          'discount_percent',
          'discount_amount',
          'line_total',
          'net_total',
          'paid_amount',
          'balance_amount',
        ],
        is_default: 0,
      },
      {
        module_type: 'SALES',
        template_name: 'Company-Wise Sales',
        fields: [
          'company_name',
          'item_code',
          'item_name',
          'packing',
          'batch_number',
          'expiry_date',
          'invoice_number',
          'invoice_date',
          'customer_name',
          'quantity',
          'bonus_quantity',
          'unit_price',
          'line_total',
        ],
        is_default: 0,
      },
      {
        module_type: 'SALES',
        template_name: 'Salesman Performance',
        fields: [
          'salesman',
          'invoice_date',
          'invoice_number',
          'customer_name',
          'item_name',
          'company_name',
          'quantity',
          'gross_amount',
          'discount_amount',
          'line_total',
          'net_total',
          'paid_amount',
        ],
        is_default: 0,
      },
      // Purchase Starter Templates
      {
        module_type: 'PURCHASE',
        template_name: 'Daily Purchase Report',
        fields: [
          'bill_number',
          'supplier_invoice_number',
          'bill_date',
          'supplier_name',
          'item_code',
          'item_name',
          'company_name',
          'packing',
          'batch_number',
          'expiry_date',
          'quantity',
          'bonus_quantity',
          'purchase_rate',
          'discount_amount',
          'tax_amount',
          'line_total',
          'net_total',
        ],
        is_default: 1,
      },
      {
        module_type: 'PURCHASE',
        template_name: 'Supplier Purchase Report',
        fields: [
          'supplier_code',
          'supplier_name',
          'bill_number',
          'supplier_invoice_number',
          'bill_date',
          'payment_mode',
          'item_name',
          'quantity',
          'bonus_quantity',
          'purchase_rate',
          'line_total',
          'net_total',
          'paid_amount',
          'remaining_balance',
        ],
        is_default: 0,
      },
      {
        module_type: 'PURCHASE',
        template_name: 'Company-Wise Purchase',
        fields: [
          'company_name',
          'item_code',
          'item_name',
          'packing',
          'bill_number',
          'bill_date',
          'supplier_name',
          'quantity',
          'bonus_quantity',
          'mrp_rate',
          'purchase_rate',
          'discount_percent',
          'line_total',
        ],
        is_default: 0,
      },
      {
        module_type: 'PURCHASE',
        template_name: 'Batch-Wise Purchase',
        fields: [
          'item_code',
          'item_name',
          'company_name',
          'batch_number',
          'manufacturing_date',
          'expiry_date',
          'quantity',
          'bonus_quantity',
          'purchase_rate',
          'mrp_rate',
          'bill_number',
          'bill_date',
          'supplier_name',
        ],
        is_default: 0,
      },
    ];

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO excel_export_templates (module_type, template_name, fields_json, is_default, created_by)
      VALUES (?, ?, ?, ?, 'System')
    `);
    const seedTx = db.transaction(() => {
      for (const tpl of starterTemplates) {
        insertStmt.run(
          tpl.module_type,
          tpl.template_name,
          JSON.stringify(tpl.fields),
          tpl.is_default
        );
      }
    });
    seedTx();
  }
}

systemRouter.get('/export-templates', authenticateToken, (req: Request, res: Response) => {
  try {
    ensureExcelExportTemplatesTable();
    const db = getDatabase();
    const moduleFilter = String(req.query.module || '')
      .trim()
      .toUpperCase();

    const rows =
      moduleFilter === 'SALES' || moduleFilter === 'PURCHASE'
        ? (db
            .prepare(
              'SELECT * FROM excel_export_templates WHERE module_type = ? ORDER BY is_default DESC, template_name ASC'
            )
            .all(moduleFilter) as Array<Record<string, any>>)
        : (db
            .prepare(
              'SELECT * FROM excel_export_templates ORDER BY module_type ASC, is_default DESC, template_name ASC'
            )
            .all() as Array<Record<string, any>>);

    const templates = rows.map((r) => {
      let fields: string[] = [];
      try {
        const parsed = JSON.parse(String(r.fields_json || '[]'));
        if (Array.isArray(parsed)) {
          fields = parsed.map((f) => String(f));
        }
      } catch {
        fields = [];
      }
      return {
        id: Number(r.id),
        module_type: String(r.module_type) as 'SALES' | 'PURCHASE',
        template_name: String(r.template_name),
        fields,
        is_default: Number(r.is_default) === 1,
        created_by: String(r.created_by || 'User'),
        created_at: String(r.created_at || ''),
        updated_at: String(r.updated_at || ''),
      };
    });

    return res.json({ success: true, templates });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

systemRouter.post('/export-templates', authenticateToken, (req: Request, res: Response) => {
  try {
    ensureExcelExportTemplatesTable();
    const db = getDatabase();
    const moduleType =
      String(req.body.module_type || '')
        .trim()
        .toUpperCase() === 'PURCHASE'
        ? 'PURCHASE'
        : 'SALES';
    const templateName = String(req.body.template_name || '').trim();
    const fields = Array.isArray(req.body.fields)
      ? req.body.fields.map((f: unknown) => String(f)).filter(Boolean)
      : [];
    const isDefault = req.body.is_default ? 1 : 0;
    const overwrite = Boolean(req.body.overwrite);
    const username = (req as AuthenticatedRequest).user?.username || 'User';

    if (!templateName) {
      return res.status(400).json({ success: false, error: 'Template name is required.' });
    }
    if (fields.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: 'Please select at least one field for the template.' });
    }

    const existing = db
      .prepare(
        'SELECT id, template_name FROM excel_export_templates WHERE module_type = ? AND LOWER(template_name) = LOWER(?)'
      )
      .get(moduleType, templateName) as { id: number; template_name: string } | undefined;

    if (existing && !overwrite) {
      return res.status(409).json({
        success: false,
        exists: true,
        existingId: existing.id,
        error: `A template named "${existing.template_name}" already exists for ${moduleType}. Confirm overwrite or choose another name.`,
      });
    }

    let savedId = existing?.id || 0;
    const saveTx = db.transaction(() => {
      if (isDefault === 1) {
        db.prepare('UPDATE excel_export_templates SET is_default = 0 WHERE module_type = ?').run(
          moduleType
        );
      }
      if (existing) {
        db.prepare(
          `UPDATE excel_export_templates
           SET template_name = ?, fields_json = ?, is_default = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(templateName, JSON.stringify(fields), isDefault, existing.id);
        savedId = existing.id;
      } else {
        const info = db
          .prepare(
            `INSERT INTO excel_export_templates (module_type, template_name, fields_json, is_default, created_by)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(moduleType, templateName, JSON.stringify(fields), isDefault, username);
        savedId = Number(info.lastInsertRowid);
      }
    });
    saveTx();

    return res.json({
      success: true,
      id: savedId,
      message: `Template "${templateName}" saved permanently.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

systemRouter.put('/export-templates/:id', authenticateToken, (req: Request, res: Response) => {
  try {
    ensureExcelExportTemplatesTable();
    const db = getDatabase();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid template ID.' });
    }

    const current = db
      .prepare('SELECT * FROM excel_export_templates WHERE id = ?')
      .get(id) as Record<string, any> | undefined;
    if (!current) {
      return res.status(404).json({ success: false, error: 'Template not found.' });
    }

    const moduleType = String(current.module_type);
    const templateName =
      req.body.template_name !== undefined
        ? String(req.body.template_name || '').trim()
        : String(current.template_name);
    if (!templateName) {
      return res.status(400).json({ success: false, error: 'Template name cannot be empty.' });
    }

    // Check duplicate name on another template ID
    const duplicate = db
      .prepare(
        'SELECT id FROM excel_export_templates WHERE module_type = ? AND LOWER(template_name) = LOWER(?) AND id != ?'
      )
      .get(moduleType, templateName, id) as { id: number } | undefined;
    if (duplicate) {
      return res.status(409).json({
        success: false,
        error: `Another template named "${templateName}" already exists.`,
      });
    }

    const fieldsJson =
      Array.isArray(req.body.fields) && req.body.fields.length > 0
        ? JSON.stringify(req.body.fields.map((f: unknown) => String(f)).filter(Boolean))
        : String(current.fields_json);

    const isDefault =
      req.body.is_default !== undefined ? (req.body.is_default ? 1 : 0) : Number(current.is_default);

    const updateTx = db.transaction(() => {
      if (isDefault === 1) {
        db.prepare('UPDATE excel_export_templates SET is_default = 0 WHERE module_type = ?').run(
          moduleType
        );
      }
      db.prepare(
        `UPDATE excel_export_templates
         SET template_name = ?, fields_json = ?, is_default = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(templateName, fieldsJson, isDefault, id);
    });
    updateTx();

    return res.json({
      success: true,
      id,
      message: `Template "${templateName}" updated.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

systemRouter.delete('/export-templates/:id', authenticateToken, (req: Request, res: Response) => {
  try {
    ensureExcelExportTemplatesTable();
    const db = getDatabase();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid template ID.' });
    }

    db.prepare('DELETE FROM excel_export_templates WHERE id = ?').run(id);
    return res.json({ success: true, message: 'Template deleted.' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/system/operating-mode
 * Returns active System Operating Mode (ONLINE / OFFLINE), permanent storage diagnostics,
 * last manual backup & cloud sync timestamps/statuses, and unresolved conflict count.
 * Makes ZERO Cloud DB requests when in OFFLINE MODE.
 */
systemRouter.get('/operating-mode', authenticateToken, (_req: Request, res: Response) => {
  try {
    const status = getOperatingModeFullStatus();
    return res.json({
      success: true,
      data: status,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/system/operating-mode/switch
 * Strictly restricted to Super Admin.
 * Verifies target database availability and flushes WAL before switching ONLINE <-> OFFLINE.
 */
systemRouter.post(
  '/operating-mode/switch',
  authenticateToken,
  requireRole(['Super Admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rawMode = String(req.body?.mode || '').trim().toUpperCase();
      if (rawMode !== 'ONLINE' && rawMode !== 'OFFLINE') {
        return res.status(400).json({
          success: false,
          error: 'Invalid operating mode. Must be "ONLINE" or "OFFLINE".',
        });
      }

      const result = await switchOperatingMode({
        targetMode: rawMode,
        username: req.user?.username || 'Super Admin',
        userId: req.user?.id || null,
        ipAddress: req.ip || '',
        allowWithPendingOfflineChanges: Boolean(req.body?.allowWithPendingOfflineChanges),
      });

      const httpStatus = result.success ? 200 : result.requiresConfirmation ? 409 : 503;
      return res.status(httpStatus).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * POST /api/system/d-drive-backup
 * Independent D-Drive Local Backup (creates verified .db backup, checks D:\AbrarMedicalStore\Backups writability,
 * and returns exact path + status or browser File System Access save metadata).
 */
systemRouter.post(
  '/d-drive-backup',
  authenticateToken,
  (req: AuthenticatedRequest, res: Response) => {
    if (!canAdministerSystem(req)) {
      return res.status(403).json({
        success: false,
        error: 'Access Denied: Only authorized administrators can run D Drive Backups.',
      });
    }
    try {
      const customDDriveFolder = req.body?.customDDriveFolder
        ? String(req.body.customDDriveFolder).trim().slice(0, 260)
        : undefined;
      const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 200) : undefined;
      const result = executeIndependentDDriveBackup({
        username: req.user?.username || 'Super Admin',
        userId: req.user?.id || null,
        ipAddress: req.ip || '',
        customDDriveFolder,
        notes,
      });
      return res.status(result.backup ? 200 : 500).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * POST /api/system/d-drive-backup/confirm
 * Confirms the result of the browser File System Access save to the user's Windows D:\AbrarMedicalStore\Backups folder.
 */
systemRouter.post(
  '/d-drive-backup/confirm',
  authenticateToken,
  (req: AuthenticatedRequest, res: Response) => {
    if (!canAdministerSystem(req)) {
      return res.status(403).json({
        success: false,
        error: 'Access Denied: Only authorized administrators can confirm D Drive Backups.',
      });
    }
    try {
      const success = Boolean(req.body?.success);
      const savedFilePath = req.body?.savedFilePath
        ? String(req.body.savedFilePath).trim().slice(0, 300)
        : null;
      const configuredFolder = req.body?.configuredFolder
        ? String(req.body.configuredFolder).trim().slice(0, 260)
        : undefined;
      const error = req.body?.error ? String(req.body.error).trim().slice(0, 400) : null;

      const status = confirmBrowserDDriveBackupSave({
        success,
        savedFilePath,
        configuredFolder,
        error,
        username: req.user?.username || 'Super Admin',
      });
      return res.json({
        success: true,
        status,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * POST /api/system/independent-cloud-sync
 * Independent incremental Cloud Synchronization (does NOT require a Local Backup first).
 */
systemRouter.post(
  '/independent-cloud-sync',
  authenticateToken,
  requireRole(['Super Admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await executeIndependentCloudSync({
        username: req.user?.username || 'Super Admin',
        userId: req.user?.id || null,
        ipAddress: req.ip || '',
      });
      return res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * POST /api/system/backup-and-sync-now
 * Strictly restricted to Super Admin.
 * Decoupled Step 1 (D-Drive Local Backup) & Step 2 (Incremental Cloud Sync).
 */
systemRouter.post(
  '/backup-and-sync-now',
  authenticateToken,
  requireRole(['Super Admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 200) : undefined;
      const customDDriveFolder = req.body?.customDDriveFolder
        ? String(req.body.customDDriveFolder).trim().slice(0, 260)
        : undefined;
      const result = await executeManualBackupAndSync({
        username: req.user?.username || 'Super Admin',
        userId: req.user?.id || null,
        ipAddress: req.ip || '',
        notes,
        customDDriveFolder,
      });

      return res.status(result.step1LocalBackup.status === 'Successful' ? 200 : 500).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * GET /api/system/sync-conflicts
 * Strictly restricted to Super Admin. Lists detected Local vs Cloud record conflicts.
 */
systemRouter.get(
  '/sync-conflicts',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const filterRaw = String(req.query?.status || 'unresolved').trim().toLowerCase();
      const filter: 'unresolved' | 'resolved' | 'all' =
        filterRaw === 'all' ? 'all' : filterRaw === 'resolved' ? 'resolved' : 'unresolved';
      const conflicts = listSyncConflicts(filter);
      return res.json({
        success: true,
        conflicts,
        count: conflicts.length,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * POST /api/system/sync-conflicts/resolve-all
 * Strictly restricted to Super Admin. Resolves all unresolved conflicts using 'keep_local' or 'keep_cloud'.
 */
systemRouter.post(
  '/sync-conflicts/resolve-all',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const resolutionRaw = String(req.body?.resolution || '').trim().toLowerCase();
      if (resolutionRaw !== 'keep_local' && resolutionRaw !== 'keep_cloud') {
        return res.status(400).json({
          success: false,
          error: 'Resolution must be "keep_local" or "keep_cloud".',
        });
      }

      const result = resolveAllSyncConflicts({
        resolution: resolutionRaw,
        username: req.user?.username || 'Super Admin',
        userId: req.user?.id || null,
        ipAddress: req.ip || '',
      });
      return res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ success: false, error: msg });
    }
  }
);

/**
 * POST /api/system/sync-conflicts/:id/resolve
 * Strictly restricted to Super Admin. Resolves a conflict using 'keep_local' or 'keep_cloud'.
 */
systemRouter.post(
  '/sync-conflicts/:id/resolve',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const conflictId = Number(req.params.id);
      if (!Number.isFinite(conflictId) || conflictId <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid conflict ID.' });
      }
      const resolutionRaw = String(req.body?.resolution || '').trim().toLowerCase();
      if (resolutionRaw !== 'keep_local' && resolutionRaw !== 'keep_cloud') {
        return res.status(400).json({
          success: false,
          error: 'Resolution must be "keep_local" or "keep_cloud".',
        });
      }

      const result = resolveSyncConflict({
        conflictId,
        resolution: resolutionRaw,
        username: req.user?.username || 'Super Admin',
        userId: req.user?.id || null,
        ipAddress: req.ip || '',
      });
      return res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ success: false, error: msg });
    }
  }
);

/**
 * GET /api/system/windows-installer/download?type=full|shortcut
 * Generates and downloads either:
 * - type=full (Super Admin / Admin): Abrar-Medical-Store-Windows-Installer.zip (complete local Windows server + desktop app + DB snapshot)
 * - type=shortcut (any authenticated user): Install-Abrar-Medical-Store-Shortcut.bat (1-click Desktop & Start Menu POS shortcut)
 */
systemRouter.get(
  '/windows-installer/download',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const type = String(req.query?.type || 'full').trim().toLowerCase();

    if (type === 'shortcut') {
      const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
      const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000').split(',')[0].trim();
      const origin = `${protocol}://${host}`;
      const bat = generateCloudShortcutBatContent(origin);
      res.setHeader('Content-Type', 'application/x-bat; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="Install-Abrar-Medical-Store-Shortcut.bat"'
      );
      return res.status(200).send(bat);
    }

    if (!canAdministerSystem(req)) {
      return res.status(403).json({
        success: false,
        error: 'Access Denied: Only Super Admin or Administrator can download the full Windows Installer package.',
      });
    }

    let pkg: { zipPath: string; filename: string; cleanup: () => void } | null = null;
    try {
      pkg = await buildWindowsFullInstallerZip();
      try {
        const db = getDatabase();
        db.prepare(
          `INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
           VALUES (?, ?, 'WINDOWS_INSTALLER_DOWNLOADED', 'INFO', ?, ?)`
        ).run(
          req.user?.id || null,
          req.user?.username || 'Super Admin',
          req.ip || '',
          `Downloaded ${pkg.filename}`
        );
      } catch {
        // ignore non-critical audit log failure
      }

      return res.download(pkg.zipPath, pkg.filename, () => {
        pkg?.cleanup();
      });
    } catch (err: unknown) {
      pkg?.cleanup();
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        success: false,
        error: `Failed to build Windows installer package: ${msg}`,
      });
    }
  }
);

export { triggerPreChangeBackupIfEnabled, logSystemError };



