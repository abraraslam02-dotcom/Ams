import { getDatabase } from './connection.ts';
import { SCHEMA_SQL } from './schema.ts';
import { config } from '../config.ts';

export interface MigrationResult {
  success: boolean;
  appliedMigration: string;
  tablesVerified: number;
  newlyAppliedCount: number;
  message: string;
}

/**
 * Runs the foundation and module DDL migrations.
 * Idempotent, safe, preserves existing data, and never creates fake transactions or demo data.
 */
export function runMigrations(): MigrationResult {
  const db = getDatabase();
  let migrationsBefore = 0;
  try {
    const migTbl = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='database_migrations'")
      .get();
    if (migTbl) {
      const cnt = db.prepare('SELECT COUNT(*) as c FROM database_migrations').get() as { c: number };
      migrationsBefore = Number(cnt?.c || 0);
    }
  } catch {}

  const migrationName1 = '001_initial_ams_foundation_schema';
  const migrationName2 = '002_finalize_items_master';
  const migrationName3 = '003_finalize_accounts_master';
  const migrationName4 = '004_finalize_purchases_and_advance_tax';
  const migrationName5 = '005_finalize_sales_billing_payments_and_ledgers';
  const migrationName6 = '006_finalize_authentication_and_user_roles';
  const migrationName7 = '007_finalize_inventory_management_adjustments_and_transfers';
  const migrationName8 = '008_finalize_complete_accounting_and_vouchers';
  const migrationName9 = '009_finalize_printing_backup_security_and_admin';
  const migrationName10 = '010_finalize_salesman_deliveryman_and_item_history';
  const migrationName11 = '011_unified_monthly_invoice_sequences_and_cloud_protection';
  const migrationName12 = '012_whatsapp_log_and_settings';
  const migrationName13 = '013_purchase_hold_draft_support';
  const migrationName14 = '014_user_password_management_and_lan_sync';
  const migrationName15 = '015_production_repair_login_and_demo_cleanup';
  const migrationName16 = '016_cash_book_and_continuous_voucher_module';
  const migrationName17 = '017_universal_auto_account_sequences';
  const migrationName18 = '018_cash_book_sequences_and_audit';
  const migrationName19 = '019_supply_and_distribution_management_system';
  const migrationName20 = '020_master_enhancement_fifo_offers_discounts_mobile_reset_backup';

  const executeMigration = db.transaction(() => {
    // A. Check if table 'items' exists and needs upgrade before SCHEMA_SQL
    const itemsTableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items'")
      .get();

    if (itemsTableExists) {
      const cols = db.prepare('PRAGMA table_info("items")').all() as Array<{ name: string }>;
      const colNames = cols.map((c) => c.name);
      const needsItemsMigration =
        !colNames.includes('company_name') ||
        !colNames.includes('item_name') ||
        !colNames.includes('purchase_price');

      if (needsItemsMigration) {
        db.exec('PRAGMA foreign_keys = OFF;');
        db.exec(`
          CREATE TABLE IF NOT EXISTS items_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_code TEXT NOT NULL UNIQUE,
            company_name TEXT NOT NULL,
            item_name TEXT NOT NULL,
            generic_name TEXT,
            category TEXT NOT NULL,
            packing TEXT NOT NULL DEFAULT '1x1',
            barcode TEXT,
            purchase_price REAL NOT NULL DEFAULT 0.0,
            trade_price REAL NOT NULL DEFAULT 0.0,
            wholesale_price REAL NOT NULL DEFAULT 0.0,
            retail_price REAL NOT NULL DEFAULT 0.0,
            discount_percent REAL NOT NULL DEFAULT 0.0,
            tax_percent REAL NOT NULL DEFAULT 0.0,
            opening_stock REAL NOT NULL DEFAULT 0.0,
            minimum_stock REAL NOT NULL DEFAULT 0.0,
            rack_number TEXT,
            status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);

        const oldRows = db.prepare('SELECT COUNT(*) as count FROM items').get() as { count: number };
        if (oldRows.count > 0) {
          db.exec(`
            INSERT INTO items_new (
              id, item_code, company_name, item_name, generic_name, category, packing, barcode,
              purchase_price, trade_price, wholesale_price, retail_price, discount_percent, tax_percent,
              opening_stock, minimum_stock, rack_number, status, created_at, updated_at
            )
            SELECT 
              id,
              item_code,
              COALESCE(manufacturer, 'Standard Pharma'),
              COALESCE(brand_name, 'Medicine Item'),
              generic_name,
              COALESCE(dosage_form, 'Tablet'),
              COALESCE(CAST(pack_size AS TEXT), '1x1'),
              barcode,
              0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
              COALESCE(min_stock_alert, 0.0),
              rack_location,
              'Active',
              created_at,
              updated_at
            FROM items;
          `);
        }

        db.exec('DROP TABLE items;');
        db.exec('ALTER TABLE items_new RENAME TO items;');
        db.exec('PRAGMA foreign_keys = ON;');
      }
    }

    // B. Check if table 'accounts' exists and needs upgrade before SCHEMA_SQL
    const accountsTableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
      .get();

    if (accountsTableExists) {
      const accCols = db.prepare('PRAGMA table_info("accounts")').all() as Array<{ name: string }>;
      const accColNames = accCols.map((c) => c.name);
      const needsAccountsMigration =
        !accColNames.includes('main_group') ||
        !accColNames.includes('account_group') ||
        !accColNames.includes('opening_balance_type') ||
        !accColNames.includes('parent_account_id');

      if (needsAccountsMigration) {
        db.exec('PRAGMA foreign_keys = OFF;');
        db.exec(`
          CREATE TABLE IF NOT EXISTS accounts_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_code TEXT NOT NULL UNIQUE,
            account_name TEXT NOT NULL,
            main_group TEXT NOT NULL CHECK(main_group IN ('PARTY ACCOUNTS', 'FINANCIAL ACCOUNTS', 'INCOME & EXPENSE ACCOUNTS')),
            account_group TEXT NOT NULL,
            parent_account_id INTEGER,
            opening_balance REAL NOT NULL DEFAULT 0.0 CHECK(opening_balance >= 0),
            opening_balance_type TEXT NOT NULL DEFAULT 'Debit' CHECK(opening_balance_type IN ('Debit', 'Credit')),
            total_debit REAL NOT NULL DEFAULT 0.0,
            total_credit REAL NOT NULL DEFAULT 0.0,
            current_balance REAL NOT NULL DEFAULT 0.0,
            current_balance_type TEXT NOT NULL DEFAULT 'Debit' CHECK(current_balance_type IN ('Debit', 'Credit')),
            customer_debit REAL NOT NULL DEFAULT 0.0,
            customer_credit REAL NOT NULL DEFAULT 0.0,
            supplier_debit REAL NOT NULL DEFAULT 0.0,
            supplier_credit REAL NOT NULL DEFAULT 0.0,
            contact_person TEXT,
            phone TEXT,
            email TEXT,
            ntn_cnic TEXT,
            ntn TEXT,
            strn TEXT,
            filer_status TEXT NOT NULL DEFAULT 'Filer' CHECK(filer_status IN ('Filer', 'Non-Filer', 'Exempt')),
            tax_registration_details TEXT,
            address TEXT,
            city TEXT,
            credit_limit REAL NOT NULL DEFAULT 0.0,
            is_system_account INTEGER NOT NULL DEFAULT 0 CHECK(is_system_account IN (0, 1)),
            status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (parent_account_id) REFERENCES accounts_new (id) ON DELETE RESTRICT
          );
        `);

        const oldAccCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
        if (oldAccCount.count > 0) {
          db.exec(`
            INSERT INTO accounts_new (
              id, account_code, account_name, main_group, account_group,
              opening_balance, opening_balance_type, total_debit, total_credit,
              current_balance, current_balance_type,
              contact_person, phone, ntn_cnic, address, credit_limit, status, created_at, updated_at
            )
            SELECT
              id,
              account_code,
              account_name,
              CASE
                WHEN account_type IN ('customer', 'supplier') THEN 'PARTY ACCOUNTS'
                WHEN account_type IN ('bank', 'cash') THEN 'FINANCIAL ACCOUNTS'
                ELSE 'INCOME & EXPENSE ACCOUNTS'
              END,
              CASE
                WHEN account_type = 'customer' THEN 'Customer'
                WHEN account_type = 'supplier' THEN 'Supplier'
                WHEN account_type = 'bank' THEN 'Bank'
                WHEN account_type = 'cash' THEN 'Cash in Hand'
                ELSE 'Other Expenses'
              END,
              ABS(COALESCE(current_balance, 0.0)),
              CASE WHEN account_type = 'supplier' THEN 'Credit' ELSE 'Debit' END,
              CASE WHEN account_type != 'supplier' THEN ABS(COALESCE(current_balance, 0.0)) ELSE 0.0 END,
              CASE WHEN account_type = 'supplier' THEN ABS(COALESCE(current_balance, 0.0)) ELSE 0.0 END,
              ABS(COALESCE(current_balance, 0.0)),
              CASE WHEN account_type = 'supplier' THEN 'Credit' ELSE 'Debit' END,
              contact_person,
              phone,
              tax_number,
              address,
              COALESCE(credit_limit, 0.0),
              CASE WHEN status = 'blocked' THEN 'Inactive' ELSE 'Active' END,
              created_at,
              updated_at
            FROM accounts;
          `);
        }

        db.exec('DROP TABLE accounts;');
        db.exec('ALTER TABLE accounts_new RENAME TO accounts;');
        db.exec('PRAGMA foreign_keys = ON;');
      } else {
        // Safely add Task 4 supplier tax columns to existing accounts table
        if (!accColNames.includes('ntn')) {
          db.exec('ALTER TABLE accounts ADD COLUMN ntn TEXT;');
        }
        if (!accColNames.includes('strn')) {
          db.exec('ALTER TABLE accounts ADD COLUMN strn TEXT;');
        }
        if (!accColNames.includes('filer_status')) {
          db.exec("ALTER TABLE accounts ADD COLUMN filer_status TEXT NOT NULL DEFAULT 'Filer';");
        }
        if (!accColNames.includes('tax_registration_details')) {
          db.exec('ALTER TABLE accounts ADD COLUMN tax_registration_details TEXT;');
        }
      }
    }

    // C. Safely add any missing columns to purchases & sales without dropping tables
    const purchasesExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='purchases'")
      .get();

    if (purchasesExists) {
      const purCols = db.prepare('PRAGMA table_info("purchases")').all() as Array<{ name: string }>;
      const purColNames = purCols.map((c) => c.name);
      if (!purColNames.includes('advance_tax_rate')) {
        db.exec('ALTER TABLE purchases ADD COLUMN advance_tax_rate REAL NOT NULL DEFAULT 0.0;');
      }
      if (!purColNames.includes('taxable_amount')) {
        db.exec('ALTER TABLE purchases ADD COLUMN taxable_amount REAL NOT NULL DEFAULT 0.0;');
      }
    }

    // D. Safely add any missing columns to sales without dropping tables
    const salesExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sales'")
      .get();

    if (salesExists) {
      const salesCols = db.prepare('PRAGMA table_info("sales")').all() as Array<{ name: string }>;
      const salesColNames = salesCols.map((c) => c.name);
      if (!salesColNames.includes('invoice_type')) {
        db.exec("ALTER TABLE sales ADD COLUMN invoice_type TEXT NOT NULL DEFAULT 'Retail';");
      }
      if (!salesColNames.includes('advance_tax_rate')) {
        db.exec('ALTER TABLE sales ADD COLUMN advance_tax_rate REAL NOT NULL DEFAULT 0.0;');
      }
    }

    // E. Check if users table exists and needs upgrade before SCHEMA_SQL
    const usersExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .get();

    if (usersExists) {
      const userCols = db.prepare('PRAGMA table_info("users")').all() as Array<{ name: string }>;
      const userColNames = userCols.map((c) => c.name);
      if (!userColNames.includes('salt') || !userColNames.includes('locked_until')) {
        db.exec('PRAGMA foreign_keys = OFF;');
        db.exec(`
          CREATE TABLE IF NOT EXISTS users_upgraded (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL CHECK(role IN ('Super Admin', 'Administrator', 'Accountant', 'Salesman', 'Purchase Operator', 'Viewer')),
            status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive', 'Suspended')),
            failed_login_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until DATETIME,
            last_login DATETIME,
            last_login_ip TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        const existingUsersCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
        if (existingUsersCount.count > 0) {
          db.exec(`
            INSERT INTO users_upgraded (
              id, username, full_name, email, password_hash, salt, role, status, last_login, created_at, updated_at
            )
            SELECT 
              id, username, full_name, email, password_hash, 'migrated_default_salt',
              CASE 
                WHEN role = 'admin' THEN 'Super Admin'
                WHEN role = 'pharmacist' THEN 'Salesman'
                WHEN role = 'cashier' THEN 'Salesman'
                WHEN role = 'auditor' THEN 'Viewer'
                ELSE 'Super Admin'
              END,
              CASE WHEN status = 'active' THEN 'Active' ELSE 'Inactive' END,
              last_login, created_at, updated_at
            FROM users;
          `);
        }
        db.exec('DROP TABLE users;');
        db.exec('ALTER TABLE users_upgraded RENAME TO users;');
        db.exec('PRAGMA foreign_keys = ON;');
      }
    }

    // 1. Execute base schema
    db.exec(SCHEMA_SQL);

    // 2. Ensure indexes on items & accounts
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_items_code ON items(item_code);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_items_name ON items(item_name);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_name);');

    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_code ON accounts(account_code);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_main_group ON accounts(main_group);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_group ON accounts(account_group);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_account_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(account_name);');

    // 3. Log completed migrations
    const existing1 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName1);
    if (!existing1) {
      const settingsCheck = db.prepare('SELECT COUNT(*) as count FROM company_settings').get() as { count: number };
      if (settingsCheck.count === 0) {
        db.prepare(`
          INSERT INTO company_settings (
            store_name, legal_name, drug_license_number, ntn_tax_number,
            address, phone, email, default_currency, currency_symbol,
            default_timezone, timezone_offset, default_language
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          config.companyName,
          'Abrar Medical Store (Pvt) Ltd',
          'DL-PK-LHR-2026-0891',
          'NTN-PK-9812450-7',
          'Main Commercial Market, Lahore, Punjab, Pakistan',
          '+92 42 35789000',
          'contact@abrarmedical.pk',
          config.appCurrency,
          config.appCurrencySymbol,
          config.appTimezone,
          config.appTimezoneOffset,
          'en'
        );
      }
      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName1, 1);
    }

    const existing2 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName2);
    if (!existing2) {
      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName2, 2);
    }

    // 4. Migration 003: Seed Standard Hierarchical Chart of Accounts
    const existing3 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName3);
    if (!existing3) {
      const accCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
      if (accCount.count === 0) {
        const insertCoa = db.prepare(`
          INSERT INTO accounts (
            account_code, account_name, main_group, account_group, parent_account_id,
            opening_balance, opening_balance_type, total_debit, total_credit,
            current_balance, current_balance_type, is_system_account, status, notes
          ) VALUES (?, ?, ?, ?, ?, 0.0, ?, 0.0, 0.0, 0.0, ?, ?, 'Active', ?)
        `);

        // 1. PARTY ACCOUNTS - Control / Parent Accounts
        insertCoa.run('ACC-1000', 'Trade Customers (Receivables Control)', 'PARTY ACCOUNTS', 'Customer', null, 'Debit', 'Debit', 1, 'Parent control head for Customer Receivable Ledgers');
        insertCoa.run('ACC-2000', 'Pharmaceutical Suppliers (Payables Control)', 'PARTY ACCOUNTS', 'Supplier', null, 'Credit', 'Credit', 1, 'Parent control head for Supplier & Distributor Payable Ledgers');
        insertCoa.run('ACC-3000', 'Dual Party Accounts (Customer & Supplier Control)', 'PARTY ACCOUNTS', 'Customer & Supplier', null, 'Debit', 'Debit', 1, 'Parent control head for parties acting as both Customer & Supplier');

        // 2. FINANCIAL ACCOUNTS
        insertCoa.run('FIN-1010', 'Cash in Hand (Main Counter Drawer)', 'FINANCIAL ACCOUNTS', 'Cash in Hand', null, 'Debit', 'Debit', 1, 'Primary store cash drawer account');
        insertCoa.run('FIN-1020', 'Bank Accounts Control', 'FINANCIAL ACCOUNTS', 'Bank', null, 'Debit', 'Debit', 1, 'Parent head for all bank accounts');
        insertCoa.run('FIN-1030', 'Store Fixed Assets & Furniture', 'FINANCIAL ACCOUNTS', 'Assets', null, 'Debit', 'Debit', 1, 'Refrigerators, racks, computer hardware & fixtures');
        insertCoa.run('FIN-2010', 'Accrued Store Liabilities & Taxes', 'FINANCIAL ACCOUNTS', 'Liabilities', null, 'Credit', 'Credit', 1, 'Short-term store liabilities and payables');
        insertCoa.run('FIN-2020', 'Business Loans & Financing', 'FINANCIAL ACCOUNTS', 'Loans', null, 'Credit', 'Credit', 1, 'Long-term and short-term loan accounts');
        insertCoa.run('FIN-3010', 'Owner Capital Account (Abrar Medical Store)', 'FINANCIAL ACCOUNTS', 'Capital', null, 'Credit', 'Credit', 1, 'Owner equity and capital investment');
        insertCoa.run('FIN-3020', 'Owner Drawings Account', 'FINANCIAL ACCOUNTS', 'Drawings', null, 'Debit', 'Debit', 1, 'Owner personal withdrawals');

        // 3. INCOME & EXPENSE ACCOUNTS
        insertCoa.run('INC-4010', 'Medicine Sales Income', 'INCOME & EXPENSE ACCOUNTS', 'Sales Income', null, 'Credit', 'Credit', 1, 'Revenue from retail and wholesale medicine sales');
        insertCoa.run('INC-4020', 'Purchase Discount Received', 'INCOME & EXPENSE ACCOUNTS', 'Purchase Discount', null, 'Credit', 'Credit', 1, 'Trade and cash discounts earned on supplier purchases');
        insertCoa.run('INC-4030', 'Other Pharmacy Income', 'INCOME & EXPENSE ACCOUNTS', 'Other Income', null, 'Credit', 'Credit', 1, 'Miscellaneous pharmacy income');
        insertCoa.run('EXP-5010', 'Shop Rent Expense', 'INCOME & EXPENSE ACCOUNTS', 'Rent', null, 'Debit', 'Debit', 1, 'Monthly medical store premises rent');
        insertCoa.run('EXP-5020', 'Electricity & Backup Power Expense', 'INCOME & EXPENSE ACCOUNTS', 'Electricity', null, 'Debit', 'Debit', 1, 'WAPDA electricity bills and cold-chain generator fuel');
        insertCoa.run('EXP-5030', 'Staff Salaries & Wages', 'INCOME & EXPENSE ACCOUNTS', 'Salaries', null, 'Debit', 'Debit', 1, 'Pharmacist and counter staff salaries');
        insertCoa.run('EXP-5040', 'Shop & Counter Expenses', 'INCOME & EXPENSE ACCOUNTS', 'Shop Expenses', null, 'Debit', 'Debit', 1, 'Packaging, thermal rolls, cleaning and daily store maintenance');
        insertCoa.run('EXP-5050', 'Other Miscellaneous Expenses', 'INCOME & EXPENSE ACCOUNTS', 'Other Expenses', null, 'Debit', 'Debit', 1, 'General administrative expenses');
      }

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName3, 3);
    }

    // 5. Migration 004: Seed Configurable Advance Tax Settings & Dedicated Purchase/Tax Ledger Accounts
    const existing4 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName4);
    if (!existing4) {
      // Seed default Advance Tax settings if empty
      const taxCount = db.prepare('SELECT COUNT(*) as count FROM advance_tax_settings').get() as { count: number };
      if (taxCount.count === 0) {
        db.prepare(`
          INSERT INTO advance_tax_settings (
            tax_name, filer_rate, non_filer_rate, exempt_rate,
            calculation_basis, effective_from, status, tax_applicability, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'Advance Tax u/s 236H (Pharmaceuticals)',
          0.5,
          2.5,
          0.0,
          'taxable_plus_gst',
          '2026-01-01',
          'Active',
          'All Taxable Medicine & Pharmaceutical Purchases',
          'System Administrator'
        );

        db.prepare(`
          INSERT INTO advance_tax_history (
            tax_name, filer_rate, non_filer_rate, exempt_rate,
            calculation_basis, effective_from, status, tax_applicability,
            change_reason, changed_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'Advance Tax u/s 236H (Pharmaceuticals)',
          0.5,
          2.5,
          0.0,
          'taxable_plus_gst',
          '2026-01-01',
          'Active',
          'All Taxable Medicine & Pharmaceutical Purchases',
          'Initial default statutory Advance Tax configuration (Filer: 0.5%, Non-Filer: 2.5%)',
          'System Administrator'
        );
      }

      // Ensure dedicated double-entry accounts exist for Purchase, Purchase Return, Advance Tax, and GST
      const ensureAccount = (
        code: string,
        name: string,
        mainGroup: string,
        accountGroup: string,
        naturalType: 'Debit' | 'Credit',
        notes: string
      ) => {
        const exists = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(code);
        if (!exists) {
          db.prepare(`
            INSERT INTO accounts (
              account_code, account_name, main_group, account_group, parent_account_id,
              opening_balance, opening_balance_type, total_debit, total_credit,
              current_balance, current_balance_type, is_system_account, status, notes
            ) VALUES (?, ?, ?, ?, NULL, 0.0, ?, 0.0, 0.0, 0.0, ?, 1, 'Active', ?)
          `).run(code, name, mainGroup, accountGroup, naturalType, naturalType, notes);
        }
      };

      ensureAccount(
        'PUR-5001',
        'Medicine Purchases Account',
        'INCOME & EXPENSE ACCOUNTS',
        'Purchases',
        'Debit',
        'Dedicated double-entry account for confirmed medicine and stock purchases'
      );
      ensureAccount(
        'PUR-5002',
        'Purchase Returns Account',
        'INCOME & EXPENSE ACCOUNTS',
        'Purchase Returns',
        'Credit',
        'Dedicated double-entry account for confirmed supplier purchase returns (debit notes)'
      );
      ensureAccount(
        'TAX-1040',
        'Advance Tax Receivable (u/s 236)',
        'FINANCIAL ACCOUNTS',
        'Assets',
        'Debit',
        'Dedicated account for Advance Tax paid on supplier purchases (separate from purchase discounts)'
      );
      ensureAccount(
        'TAX-1045',
        'GST / Input Tax Adjustable',
        'FINANCIAL ACCOUNTS',
        'Assets',
        'Debit',
        'Dedicated account for GST / Applicable Input Tax on supplier purchases'
      );

      // Populate NTN / STRN / Filer Status on existing supplier accounts if empty
      db.prepare(`
        UPDATE accounts
        SET ntn = COALESCE(ntn, ntn_cnic),
            strn = COALESCE(strn, 'STRN-PK-04-192837'),
            filer_status = COALESCE(filer_status, 'Filer'),
            tax_registration_details = COALESCE(tax_registration_details, 'Active Taxpayer List (ATL) Verified - FBR Pakistan')
        WHERE account_group IN ('Supplier', 'Customer & Supplier') AND (ntn IS NULL OR ntn = '')
      `).run();

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName4, 4);
    }

    const existing5 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName5);
    if (!existing5) {
      const ensureSalesAccount = (
        code: string,
        name: string,
        mainGroup: string,
        subGroup: string,
        balType: 'Debit' | 'Credit',
        notes: string
      ) => {
        const found = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(code);
        if (!found) {
          db.prepare(`
            INSERT INTO accounts (
              account_code, account_name, main_group, account_group,
              opening_balance, opening_balance_type, current_balance, current_balance_type,
              filer_status, status, is_system_account, notes
            ) VALUES (?, ?, ?, ?, 0.0, ?, 0.0, ?, 'Filer', 'Active', 1, ?)
          `).run(code, name, mainGroup, subGroup, balType, balType, notes);
        }
      };

      ensureSalesAccount(
        'CUS-1001',
        'Walk-in Cash Customer',
        'PARTY ACCOUNTS',
        'Customer',
        'Debit',
        'Default counter retail walk-in customer account'
      );
      ensureSalesAccount(
        'SAL-4015',
        'Medicine Sales Returns Account',
        'INCOME & EXPENSE ACCOUNTS',
        'Sales Income',
        'Debit',
        'Contra-revenue account for confirmed customer sale returns'
      );
      ensureSalesAccount(
        'DIS-5015',
        'Sales Discount Allowed',
        'INCOME & EXPENSE ACCOUNTS',
        'Other Expenses',
        'Debit',
        'Account for item & invoice discounts allowed on sales'
      );
      ensureSalesAccount(
        'TAX-2040',
        'Advance Tax Collected on Sales (u/s 236G/H)',
        'FINANCIAL ACCOUNTS',
        'Liabilities',
        'Credit',
        'Liability account for Advance Tax collected on applicable sales'
      );
      ensureSalesAccount(
        'TAX-2045',
        'GST / Output Sales Tax Payable',
        'FINANCIAL ACCOUNTS',
        'Liabilities',
        'Credit',
        'Liability account for GST / Output Tax collected on sales'
      );

      // Seed opening stock batches into inventory for any items that have opening_stock > 0 and no inventory batch yet
      const allItems = db.prepare('SELECT * FROM items').all() as Array<Record<string, unknown>>;
      for (const item of allItems) {
        const itemId = Number(item.id);
        const openingStock = Math.max(0, Number(item.opening_stock || 0));
        if (openingStock <= 0) continue;

        const batchCount = db
          .prepare('SELECT COUNT(*) as cnt FROM inventory WHERE item_id = ?')
          .get(itemId) as { cnt: number };

        if (batchCount.cnt === 0) {
          const cleanPacking = String(item.packing || '1x1').trim();
          const matrixMatch = cleanPacking.match(/^(\d+)\s*[xX*]\s*(\d+)/);
          let stripsPerBox = 1;
          let unitsPerStrip = 1;
          if (matrixMatch) {
            stripsPerBox = Math.max(1, parseInt(matrixMatch[1], 10) || 1);
            unitsPerStrip = Math.max(1, parseInt(matrixMatch[2], 10) || 1);
          } else {
            const singleMatch = cleanPacking.match(/^(\d+)\s*(tab|cap|sachet|amp|vial|strip|pack|unit)s?$/i);
            if (singleMatch) {
              unitsPerStrip = Math.max(1, parseInt(singleMatch[1], 10) || 1);
            }
          }
          const unitsPerPack = stripsPerBox * unitsPerStrip;
          const totalUnits = openingStock * unitsPerPack;
          const stripQty = openingStock * stripsPerBox;

          db.prepare(`
            INSERT INTO inventory (
              item_id, batch_number, manufacturing_date, expiry_date,
              packing, strips_per_box, units_per_strip, units_per_pack,
              cost_price, trade_price, wholesale_price, retail_price,
              pack_cost, pack_retail, purchased_qty, bonus_qty, returned_qty, sold_qty,
              current_pack_qty, current_strip_qty, current_loose_qty, total_stock_units,
              rack_shelf, status
            ) VALUES (?, ?, '2025-06-01', '2028-12-31', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 0, ?, ?, 'in_stock')
          `).run(
            itemId,
            `BATCH-${String(item.item_code || itemId).replace(/[^A-Z0-9]/gi, '')}-01`,
            cleanPacking,
            stripsPerBox,
            unitsPerStrip,
            unitsPerPack,
            Number(item.purchase_price || 0) / unitsPerPack,
            Number(item.trade_price || 0),
            Number(item.wholesale_price || 0),
            Number(item.retail_price || 0),
            Number(item.purchase_price || 0),
            Number(item.retail_price || 0),
            openingStock,
            openingStock,
            stripQty,
            totalUnits,
            String(item.rack_number || 'R-01')
          );
        }
      }

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName5, 5);
    }

    // 6. Migration 006: Seed Role Permissions Matrix for Medical Store Roles
    const existing6 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName6);
    if (!existing6) {
      const defaultRoles = [
        'Super Admin',
        'Administrator',
        'Accountant',
        'Salesman',
        'Purchase Operator',
        'Viewer',
      ];
      const modules = [
        'sales',
        'sale_returns',
        'items',
        'purchases',
        'purchase_returns',
        'inventory',
        'accounts',
        'ledgers',
        'payments',
        'tax',
        'reports',
        'user_management',
        'system_settings',
      ];

      const insertPerm = db.prepare(`
        INSERT OR IGNORE INTO role_permissions (
          role, module_key, can_view, can_create, can_edit, can_delete, can_export
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const role of defaultRoles) {
        for (const mod of modules) {
          let view = 1;
          let create = 0;
          let edit = 0;
          let del = 0;
          let exp = 1;

          if (role === 'Super Admin') {
            view = 1;
            create = 1;
            edit = 1;
            del = 1;
            exp = 1;
          } else if (role === 'Administrator') {
            view = 1;
            create = mod === 'user_management' ? 0 : 1;
            edit = mod === 'user_management' ? 0 : 1;
            del = ['user_management', 'system_settings'].includes(mod) ? 0 : 1;
            exp = 1;
          } else if (role === 'Accountant') {
            if (['accounts', 'ledgers', 'payments', 'tax', 'reports'].includes(mod)) {
              view = 1;
              create = 1;
              edit = 1;
              del = 0;
              exp = 1;
            } else if (['sales', 'purchases', 'sale_returns', 'purchase_returns', 'items', 'inventory'].includes(mod)) {
              view = 1;
              create = 0;
              edit = 0;
              del = 0;
              exp = 1;
            } else {
              view = 0;
              create = 0;
              edit = 0;
              del = 0;
              exp = 0;
            }
          } else if (role === 'Salesman') {
            if (['sales', 'sale_returns'].includes(mod)) {
              view = 1;
              create = 1;
              edit = 1;
              del = 0;
              exp = 1;
            } else if (['payments'].includes(mod)) {
              view = 1;
              create = 1;
              edit = 0;
              del = 0;
              exp = 1; // Counter Cash Receipts
            } else if (['items', 'inventory', 'ledgers'].includes(mod)) {
              view = 1;
              create = 0;
              edit = 0;
              del = 0;
              exp = 0; // Medicine inquiry & customer balances
            } else {
              view = 0;
              create = 0;
              edit = 0;
              del = 0;
              exp = 0;
            }
          } else if (role === 'Purchase Operator') {
            if (['purchases', 'purchase_returns'].includes(mod)) {
              view = 1;
              create = 1;
              edit = 1;
              del = 0;
              exp = 1;
            } else if (['items'].includes(mod)) {
              view = 1;
              create = 1;
              edit = 1;
              del = 0;
              exp = 1;
            } else if (['inventory', 'ledgers'].includes(mod)) {
              view = 1;
              create = 0;
              edit = 0;
              del = 0;
              exp = 1;
            } else {
              view = 0;
              create = 0;
              edit = 0;
              del = 0;
              exp = 0;
            }
          } else if (role === 'Viewer') {
            if (['user_management', 'system_settings'].includes(mod)) {
              view = 0;
              create = 0;
              edit = 0;
              del = 0;
              exp = 0;
            } else {
              view = 1;
              create = 0;
              edit = 0;
              del = 0;
              exp = 1;
            }
          }

          insertPerm.run(role, mod, view, create, edit, del, exp);
        }
      }

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName6, 6);
    }

    // 7. Migration 007: Finalize Inventory Management, Stock Adjustments, Transfers, and Physical Verifications
    const existing7 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName7);
    if (!existing7) {
      // 1. Upgrade inventory table columns if needed
      const invCols = db.prepare('PRAGMA table_info("inventory")').all() as Array<{ name: string }>;
      const invColNames = invCols.map((c) => c.name);

      if (!invColNames.includes('adjusted_qty')) {
        db.exec('ALTER TABLE inventory ADD COLUMN adjusted_qty REAL NOT NULL DEFAULT 0.0;');
      }
      if (!invColNames.includes('transferred_qty')) {
        db.exec('ALTER TABLE inventory ADD COLUMN transferred_qty REAL NOT NULL DEFAULT 0.0;');
      }
      if (!invColNames.includes('sales_return_qty')) {
        db.exec('ALTER TABLE inventory ADD COLUMN sales_return_qty REAL NOT NULL DEFAULT 0.0;');
      }
      if (!invColNames.includes('purchase_return_qty')) {
        db.exec('ALTER TABLE inventory ADD COLUMN purchase_return_qty REAL NOT NULL DEFAULT 0.0;');
      }
      if (!invColNames.includes('opening_stock_packs')) {
        db.exec('ALTER TABLE inventory ADD COLUMN opening_stock_packs REAL NOT NULL DEFAULT 0.0;');
      }

      // Sync opening_stock_packs from purchased_qty on initial records where last_purchase_id IS NULL
      db.prepare(`
        UPDATE inventory
        SET opening_stock_packs = purchased_qty
        WHERE (last_purchase_id IS NULL OR last_purchase_id = 0) AND opening_stock_packs = 0 AND purchased_qty > 0
      `).run();

      // 2. Upgrade company_settings with configurable near expiry threshold if needed
      const settingsCols = db.prepare('PRAGMA table_info("company_settings")').all() as Array<{ name: string }>;
      const settingsColNames = settingsCols.map((c) => c.name);
      if (!settingsColNames.includes('near_expiry_days')) {
        db.exec('ALTER TABLE company_settings ADD COLUMN near_expiry_days INTEGER NOT NULL DEFAULT 90;');
      }

      // 3. Ensure dedicated double-entry GL accounts exist for Inventory & Stock Adjustments
      const ensureInventoryAccount = (
        code: string,
        name: string,
        mainGroup: string,
        accountGroup: string,
        balType: 'Debit' | 'Credit',
        notes: string
      ) => {
        const found = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(code);
        if (!found) {
          db.prepare(`
            INSERT INTO accounts (
              account_code, account_name, main_group, account_group,
              opening_balance, opening_balance_type, current_balance, current_balance_type,
              filer_status, status, is_system_account, notes
            ) VALUES (?, ?, ?, ?, 0.0, ?, 0.0, ?, 'Filer', 'Active', 1, ?)
          `).run(code, name, mainGroup, accountGroup, balType, balType, notes);
        }
      };

      ensureInventoryAccount(
        'INV-1030',
        'Medicine Inventory (Asset Control)',
        'FINANCIAL ACCOUNTS',
        'Assets',
        'Debit',
        'Dedicated double-entry asset control account for pharmacy inventory'
      );
      ensureInventoryAccount(
        'ADJ-5035',
        'Stock Adjustment & Damage Expense',
        'INCOME & EXPENSE ACCOUNTS',
        'Other Expenses',
        'Debit',
        'Expense account for inventory shortages, write-offs, damages, and expired medicines'
      );
      ensureInventoryAccount(
        'ADJ-4035',
        'Stock Adjustment Surplus Income',
        'INCOME & EXPENSE ACCOUNTS',
        'Other Income',
        'Credit',
        'Income account for physical stock surpluses and positive adjustments'
      );

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName7, 7);
    }

    // 8. Migration 008: Finalize Complete Double-Entry Accounting, 5-Pillar COA, COGS, Multi-Line Vouchers & Periods
    const existing8 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName8);
    if (!existing8) {
      // 1. Add financial_category to accounts if not present
      const accCols = db.prepare('PRAGMA table_info("accounts")').all() as Array<{ name: string }>;
      const accColNames = accCols.map((c) => c.name);
      if (!accColNames.includes('financial_category')) {
        db.exec(`ALTER TABLE accounts ADD COLUMN financial_category TEXT NOT NULL DEFAULT 'Assets';`);
      }

      // 2. Ensure Cost of Goods Sold (EXP-5005) and standard system accounts exist without duplication
      const ensureCoreAccount = (
        code: string,
        name: string,
        mainGroup: string,
        accountGroup: string,
        finCat: string,
        balType: 'Debit' | 'Credit',
        notes: string
      ) => {
        const found = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(code);
        if (!found) {
          db.prepare(`
            INSERT INTO accounts (
              account_code, account_name, main_group, account_group, financial_category,
              opening_balance, opening_balance_type, current_balance, current_balance_type,
              filer_status, status, is_system_account, notes
            ) VALUES (?, ?, ?, ?, ?, 0.0, ?, 0.0, ?, 'Filer', 'Active', 1, ?)
          `).run(code, name, mainGroup, accountGroup, finCat, balType, balType, notes);
        }
      };

      ensureCoreAccount(
        'EXP-5005',
        'Cost of Goods Sold (COGS)',
        'INCOME & EXPENSE ACCOUNTS',
        'Purchases',
        'Expenses',
        'Debit',
        'Direct cost of medicines sold calculated via weighted-average batch cost'
      );

      // 3. Populate financial_category on all accounts based on account_group
      db.exec(`
        UPDATE accounts
        SET financial_category = CASE
          WHEN account_group IN ('Customer', 'Cash in Hand', 'Bank', 'Assets') THEN 'Assets'
          WHEN account_group IN ('Supplier', 'Liabilities', 'Loans') THEN 'Liabilities'
          WHEN account_group IN ('Capital', 'Drawings') THEN 'Capital / Equity'
          WHEN account_group IN ('Sales Income', 'Purchase Discount', 'Other Income') THEN 'Income'
          WHEN account_group IN ('Purchases', 'Purchase Returns', 'Rent', 'Electricity', 'Salaries', 'Shop Expenses', 'Other Expenses') THEN 'Expenses'
          WHEN account_group = 'Customer & Supplier' AND current_balance_type = 'Credit' THEN 'Liabilities'
          ELSE 'Assets'
        END;
      `);

      // 4. Link default sub-accounts to parent control accounts if parent_account_id is NULL
      const custControl = db.prepare("SELECT id FROM accounts WHERE account_code = 'ACC-1000'").get() as { id: number } | undefined;
      if (custControl) {
        db.prepare(`
          UPDATE accounts
          SET parent_account_id = ?
          WHERE account_group = 'Customer' AND id != ? AND parent_account_id IS NULL
        `).run(custControl.id, custControl.id);
      }

      const suppControl = db.prepare("SELECT id FROM accounts WHERE account_code = 'ACC-2000'").get() as { id: number } | undefined;
      if (suppControl) {
        db.prepare(`
          UPDATE accounts
          SET parent_account_id = ?
          WHERE account_group = 'Supplier' AND id != ? AND parent_account_id IS NULL
        `).run(suppControl.id, suppControl.id);
      }

      const bankControl = db.prepare("SELECT id FROM accounts WHERE account_code = 'FIN-1020'").get() as { id: number } | undefined;
      if (bankControl) {
        db.prepare(`
          UPDATE accounts
          SET parent_account_id = ?
          WHERE account_group = 'Bank' AND id != ? AND parent_account_id IS NULL
        `).run(bankControl.id, bankControl.id);
      }

      // 5. Seed default open accounting period
      const periodCount = db.prepare('SELECT COUNT(*) as cnt FROM accounting_periods').get() as { cnt: number };
      if (periodCount.cnt === 0) {
        db.prepare(`
          INSERT INTO accounting_periods (period_name, start_date, end_date, is_closed)
          VALUES ('FY 2026 (Jan - Dec 2026)', '2026-01-01', '2026-12-31', 0)
        `).run();
      }

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName8, 8);
    }

    // 9. Migration 009: Finalize Printing System, Backup & Recovery, Transaction Audit & Idempotency
    const existing9 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName9);
    if (!existing9) {
      const addColumnIfNotExists = (table: string, colName: string, colDef: string) => {
        const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
        if (!cols.some((c) => c.name === colName)) {
          db.exec(`ALTER TABLE "${table}" ADD COLUMN ${colName} ${colDef};`);
        }
      };

      // Printing & Store Settings columns on company_settings
      addColumnIfNotExists('company_settings', 'logo_data_url', "TEXT DEFAULT ''");
      addColumnIfNotExists('company_settings', 'invoice_heading', "TEXT DEFAULT 'TAX / COMMERCIAL INVOICE'");
      addColumnIfNotExists(
        'company_settings',
        'default_printer',
        "TEXT DEFAULT 'System Default Printer (OS Print Spooler)'"
      );
      addColumnIfNotExists('company_settings', 'default_paper_size', "TEXT DEFAULT 'a4'");
      addColumnIfNotExists('company_settings', 'thermal_printer_width', "TEXT DEFAULT '80mm'");
      addColumnIfNotExists('company_settings', 'print_copies', 'INTEGER NOT NULL DEFAULT 1');
      addColumnIfNotExists('company_settings', 'page_orientation', "TEXT DEFAULT 'portrait'");
      addColumnIfNotExists('company_settings', 'page_margin', "TEXT DEFAULT 'standard'");
      addColumnIfNotExists('company_settings', 'font_size_scale', "TEXT DEFAULT 'normal'");
      addColumnIfNotExists(
        'company_settings',
        'field_visibility_json',
        `TEXT DEFAULT '{"showLogo":true,"showDrugLicense":true,"showNtn":true,"showItemCode":true,"showCompany":true,"showPacking":true,"showBatchExpiry":true,"showBonus":true,"showDiscount":true,"showTax":true,"showPreviousBalance":true,"showSignature":true,"showFooter":true,"showAccountingVerification":false}'`
      );
      addColumnIfNotExists('company_settings', 'backup_directory', "TEXT DEFAULT ''");
      addColumnIfNotExists('company_settings', 'auto_daily_backup', 'INTEGER NOT NULL DEFAULT 1');
      addColumnIfNotExists('company_settings', 'auto_backup_before_changes', 'INTEGER NOT NULL DEFAULT 1');
      addColumnIfNotExists('company_settings', 'backup_retention_days', 'INTEGER NOT NULL DEFAULT 30');

      // Audit & idempotency columns on sales, purchases, sale_returns, purchase_returns
      addColumnIfNotExists('sales', 'created_by', "TEXT DEFAULT 'Super Admin'");
      addColumnIfNotExists('sales', 'updated_by', "TEXT DEFAULT 'Super Admin'");
      addColumnIfNotExists('sales', 'cancelled_by', 'TEXT');
      addColumnIfNotExists('sales', 'cancelled_at', 'DATETIME');
      addColumnIfNotExists('sales', 'cancel_reason', 'TEXT');
      addColumnIfNotExists('sales', 'client_request_id', 'TEXT');

      addColumnIfNotExists('purchases', 'created_by', "TEXT DEFAULT 'Super Admin'");
      addColumnIfNotExists('purchases', 'updated_by', "TEXT DEFAULT 'Super Admin'");
      addColumnIfNotExists('purchases', 'cancelled_by', 'TEXT');
      addColumnIfNotExists('purchases', 'cancelled_at', 'DATETIME');
      addColumnIfNotExists('purchases', 'cancel_reason', 'TEXT');
      addColumnIfNotExists('purchases', 'client_request_id', 'TEXT');

      addColumnIfNotExists('sale_returns', 'created_by', "TEXT DEFAULT 'Super Admin'");
      addColumnIfNotExists('purchase_returns', 'created_by', "TEXT DEFAULT 'Super Admin'");

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName9, 9);
    }

    // 10. Migration 010: Salesman Management, Deliveryman Management, Delivery Tracking & Customer-Wise Item History Indexes
    const existing10 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName10);
    if (!existing10) {
      const addCol = (table: string, colName: string, colDef: string) => {
        const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
        if (!cols.some((c) => c.name === colName)) {
          db.exec(`ALTER TABLE "${table}" ADD COLUMN ${colName} ${colDef};`);
        }
      };

      // Add Salesman & Deliveryman / Delivery Tracking columns to sales
      addCol('sales', 'salesman_id', 'INTEGER');
      addCol('sales', 'deliveryman_id', 'INTEGER');
      addCol('sales', 'deliveryman_name', "TEXT DEFAULT ''");
      addCol('sales', 'delivery_status', "TEXT NOT NULL DEFAULT 'Pending'");
      addCol('sales', 'delivery_date', "TEXT DEFAULT ''");
      addCol('sales', 'delivery_time', "TEXT DEFAULT ''");
      addCol('sales', 'delivery_notes', "TEXT DEFAULT ''");
      addCol('sales', 'delivery_charges', 'REAL NOT NULL DEFAULT 0.0');
      addCol('sales', 'delivery_completed_by', "TEXT DEFAULT ''");
      addCol('sales', 'delivery_completed_at', 'DATETIME');

      // Ensure fast Customer-Wise Item History & Purchase History indexes
      db.exec('CREATE INDEX IF NOT EXISTS idx_sale_items_item_sale ON sale_items(item_id, sale_id);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sales_cust_status_date ON sales(customer_account_id, status, invoice_date, id);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_purchase_items_item_pur ON purchase_items(item_id, purchase_id);');

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName10, 10);
    }

    // 11. Migration step (users and auth system removed per application reset)

    const existing11 = db.prepare('SELECT id FROM database_migrations WHERE migration_name = ?').get(migrationName11);

    // Ensure loose_rate column exists and has sensible default values where 0
    const finalItemCols = db.prepare('PRAGMA table_info("items")').all() as Array<{ name: string }>;
    if (!finalItemCols.some((c) => c.name === 'loose_rate')) {
      db.exec('ALTER TABLE items ADD COLUMN loose_rate REAL NOT NULL DEFAULT 0.0;');
    }
    const zeroLooseItems = db
      .prepare('SELECT id, packing, retail_price, loose_rate FROM items WHERE loose_rate <= 0 AND retail_price > 0')
      .all() as Array<{ id: number; packing: string; retail_price: number; loose_rate: number }>;
    if (zeroLooseItems.length > 0) {
      const updateLooseStmt = db.prepare('UPDATE items SET loose_rate = ? WHERE id = ?');
      for (const it of zeroLooseItems) {
        const raw = (it.packing || '1x1').trim().toLowerCase();
        const multMatch = raw.match(/^(\d+)\s*[x*×]\s*(\d+)/);
        let units = 1;
        if (multMatch) {
          units = Math.max(1, parseInt(multMatch[1], 10) * parseInt(multMatch[2], 10));
        } else {
          const singleMatch = raw.match(/(\d+)\s*(tab|cap|sachet|amp|vial|strip|unit|pc|pack)/i);
          if (singleMatch) units = Math.max(1, parseInt(singleMatch[1], 10));
        }
        const computedLoose = Math.round((Number(it.retail_price) / units + Number.EPSILON) * 100) / 100;
        updateLooseStmt.run(computedLoose, it.id);
      }
    }

    // 11. Migration 011: Unified Monthly Invoice Sequences (Inv-YYYY-MM-XX) & Registry
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoice_sequences (
        period_key TEXT PRIMARY KEY,
        last_seq INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invoice_number_registry (
        invoice_number TEXT PRIMARY KEY,
        period_key TEXT NOT NULL,
        seq_number INTEGER NOT NULL,
        module_type TEXT NOT NULL,
        record_id INTEGER,
        allocated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_inv_registry_period ON invoice_number_registry(period_key, seq_number);
    `);

    if (!existing11) {
      // Backfill any existing Inv-YYYY-MM-XX numbers from sales and purchases into invoice_number_registry & invoice_sequences
      const existingSalesInv = db
        .prepare(`SELECT id, invoice_number FROM sales WHERE invoice_number LIKE 'Inv-____-__-%'`)
        .all() as Array<{ id: number; invoice_number: string }>;
      const existingPurchasesInv = db
        .prepare(`SELECT id, bill_number FROM purchases WHERE bill_number LIKE 'Inv-____-__-%'`)
        .all() as Array<{ id: number; bill_number: string }>;

      const regInsert = db.prepare(`
        INSERT OR IGNORE INTO invoice_number_registry (invoice_number, period_key, seq_number, module_type, record_id)
        VALUES (?, ?, ?, ?, ?)
      `);
      const seqUpsert = db.prepare(`
        INSERT INTO invoice_sequences (period_key, last_seq, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(period_key) DO UPDATE SET
          last_seq = MAX(invoice_sequences.last_seq, excluded.last_seq),
          updated_at = CURRENT_TIMESTAMP
      `);

      for (const s of existingSalesInv) {
        const m = s.invoice_number.match(/^Inv-(\d{4}-\d{2})-(\d+)$/);
        if (m) {
          const pk = m[1];
          const seq = parseInt(m[2], 10);
          if (seq > 0) {
            regInsert.run(s.invoice_number, pk, seq, 'SALE', s.id);
            seqUpsert.run(pk, seq);
          }
        }
      }
      for (const p of existingPurchasesInv) {
        const m = p.bill_number.match(/^Inv-(\d{4}-\d{2})-(\d+)$/);
        if (m) {
          const pk = m[1];
          const seq = parseInt(m[2], 10);
          if (seq > 0) {
            regInsert.run(p.bill_number, pk, seq, 'PURCHASE', p.id);
            seqUpsert.run(pk, seq);
          }
        }
      }

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName11, 11);
    }

    // 12. Migration 012: WhatsApp Send Log (whatsapp_log) & Auto-Send Setting
    const existing12 = db
      .prepare('SELECT id FROM database_migrations WHERE migration_name = ?')
      .get(migrationName12);

    db.exec(`
      CREATE TABLE IF NOT EXISTS whatsapp_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER,
        document_type TEXT NOT NULL DEFAULT 'invoice',
        document_number TEXT NOT NULL DEFAULT '',
        customer_account_id INTEGER,
        customer_name TEXT NOT NULL DEFAULT '',
        number TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'phase1_wa_me',
        status TEXT NOT NULL DEFAULT 'Sent',
        error TEXT,
        sent_by TEXT DEFAULT 'system',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_whatsapp_log_invoice ON whatsapp_log(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_log_docnum ON whatsapp_log(document_number);
    `);

    const compSettingsCols12 = db.prepare('PRAGMA table_info("company_settings")').all() as Array<{ name: string }>;
    if (!compSettingsCols12.some((c) => c.name === 'auto_whatsapp_on_save')) {
      db.exec('ALTER TABLE company_settings ADD COLUMN auto_whatsapp_on_save INTEGER NOT NULL DEFAULT 0;');
    }
    if (!compSettingsCols12.some((c) => c.name === 'allow_negative_stock')) {
      db.exec('ALTER TABLE company_settings ADD COLUMN allow_negative_stock INTEGER NOT NULL DEFAULT 1;');
    }
    if (!compSettingsCols12.some((c) => c.name === 'batch_wise_sales')) {
      db.exec('ALTER TABLE company_settings ADD COLUMN batch_wise_sales INTEGER NOT NULL DEFAULT 1;');
    }
    if (!compSettingsCols12.some((c) => c.name === 'batch_wise_purchase')) {
      db.exec('ALTER TABLE company_settings ADD COLUMN batch_wise_purchase INTEGER NOT NULL DEFAULT 1;');
    }

    if (!existing12) {
      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName12, 12);
    }

    // 13. Migration 013: Purchase Invoice Hold & Draft Support
    const existing13 = db
      .prepare('SELECT id FROM database_migrations WHERE migration_name = ?')
      .get(migrationName13);
    if (!existing13) {
      const purSql = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='purchases'")
        .get() as { sql: string } | undefined;

      if (purSql && !purSql.sql.includes("'held'")) {
        db.exec('PRAGMA foreign_keys = OFF;');
        db.exec(`
          CREATE TABLE purchases_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_number TEXT NOT NULL UNIQUE,
            supplier_invoice_number TEXT NOT NULL DEFAULT '',
            bill_date TEXT NOT NULL,
            supplier_account_id INTEGER NOT NULL,
            supplier_filer_status TEXT NOT NULL DEFAULT 'Filer' CHECK(supplier_filer_status IN ('Filer', 'Non-Filer', 'Exempt')),
            gross_total REAL NOT NULL DEFAULT 0.0,
            item_discount_amount REAL NOT NULL DEFAULT 0.0,
            invoice_discount_percent REAL NOT NULL DEFAULT 0.0,
            invoice_discount_amount REAL NOT NULL DEFAULT 0.0,
            discount_amount REAL NOT NULL DEFAULT 0.0,
            taxable_amount REAL NOT NULL DEFAULT 0.0,
            gst_amount REAL NOT NULL DEFAULT 0.0,
            tax_amount REAL NOT NULL DEFAULT 0.0,
            advance_tax_name TEXT NOT NULL DEFAULT 'Advance Tax u/s 236H',
            advance_tax_rate REAL NOT NULL DEFAULT 0.5,
            advance_tax_basis TEXT NOT NULL DEFAULT 'taxable_plus_gst',
            advance_tax_amount REAL NOT NULL DEFAULT 0.0,
            is_tax_overridden INTEGER NOT NULL DEFAULT 0 CHECK(is_tax_overridden IN (0, 1)),
            tax_override_reason TEXT,
            tax_override_authorized_by TEXT,
            net_total REAL NOT NULL DEFAULT 0.0,
            previous_supplier_balance REAL NOT NULL DEFAULT 0.0,
            previous_balance_type TEXT NOT NULL DEFAULT 'Credit',
            total_payable REAL NOT NULL DEFAULT 0.0,
            paid_amount REAL NOT NULL DEFAULT 0.0,
            remaining_balance REAL NOT NULL DEFAULT 0.0,
            payment_mode TEXT NOT NULL DEFAULT 'Credit' CHECK(payment_mode IN ('Credit', 'Cash', 'Bank', 'Partial')),
            payment_account_id INTEGER,
            payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid', 'partial', 'paid')),
            journal_entry_id INTEGER,
            payment_journal_entry_id INTEGER,
            status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('draft', 'held', 'completed', 'cancelled')),
            created_by_user_id INTEGER,
            remarks TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT DEFAULT 'Super Admin',
            updated_by TEXT DEFAULT 'Super Admin',
            cancelled_by TEXT,
            cancelled_at DATETIME,
            cancel_reason TEXT,
            client_request_id TEXT,
            FOREIGN KEY (supplier_account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
            FOREIGN KEY (payment_account_id) REFERENCES accounts (id) ON DELETE SET NULL,
            FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL
          );
          INSERT INTO purchases_new SELECT * FROM purchases;
          DROP TABLE purchases;
          ALTER TABLE purchases_new RENAME TO purchases;
          CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
          CREATE INDEX IF NOT EXISTS idx_purchases_bill_date ON purchases(bill_date);
          CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_account_id);
          PRAGMA foreign_keys = ON;
        `);
      }
      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName13, 13);
    }

    // 14. Migration 014: User Password Management & LAN Multi-Terminal Enhancements
    const existing14 = db
      .prepare('SELECT id FROM database_migrations WHERE migration_name = ?')
      .get(migrationName14);

    if (!existing14) {
      // A. Add force_password_change and password_changed_at to users table
      const userCols = db.prepare('PRAGMA table_info("users")').all() as Array<{ name: string }>;
      if (!userCols.some((c) => c.name === 'force_password_change')) {
        db.exec('ALTER TABLE users ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 0;');
      }
      if (!userCols.some((c) => c.name === 'password_changed_at')) {
        db.exec('ALTER TABLE users ADD COLUMN password_changed_at DATETIME;');
      }

      // B. Ensure device_registry and sync tables exist and have terminal metadata
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_registry (
          device_id TEXT PRIMARY KEY,
          device_name TEXT,
          counter_name TEXT,
          terminal_type TEXT DEFAULT 'Counter',
          notes TEXT,
          last_sync_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          ip_address TEXT,
          user_agent TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sync_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_tx_id TEXT NOT NULL UNIQUE,
          device_id TEXT NOT NULL,
          action TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id INTEGER,
          invoice_number TEXT,
          status TEXT NOT NULL DEFAULT 'synced',
          payload_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sync_audit_tx ON sync_audit_log(client_tx_id);
        CREATE INDEX IF NOT EXISTS idx_sync_audit_device ON sync_audit_log(device_id);
        CREATE INDEX IF NOT EXISTS idx_sync_audit_status ON sync_audit_log(status);
      `);

      const devCols = db.prepare('PRAGMA table_info("device_registry")').all() as Array<{ name: string }>;
      if (!devCols.some((c) => c.name === 'terminal_type')) {
        db.exec("ALTER TABLE device_registry ADD COLUMN terminal_type TEXT DEFAULT 'Counter';");
      }
      if (!devCols.some((c) => c.name === 'notes')) {
        db.exec('ALTER TABLE device_registry ADD COLUMN notes TEXT;');
      }

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName14, 14);
    }

    // 15. Migration 015: Production Repair — Login Hash Fix, Financial Account Protection & Demo/Test Cleanup
    const existing15 = db
      .prepare('SELECT id FROM database_migrations WHERE migration_name = ?')
      .get(migrationName15);

    // Always self-heal any user row still holding the corrupted default hash
    const brokenDefaultHash =
      'c3b8e8049a16f715460d55e134b65c0640c2155264f9df0b3b97542921c20b706d80c8a863a82627b670312d414712237c12d282223828290282192381920192';
    const validDefaultHash =
      '9d3990a8be03bc0dabf2ec5561478f79b91cad2293883f425440adaa9044a05af31eb1615e349254617c19c45cca6a991ef4a2d606ca4d38cc18d6aa3381d2cc';
    db.prepare(`
      UPDATE users
      SET password_hash = ?,
          failed_login_attempts = 0,
          locked_until = NULL
      WHERE password_hash = ?
    `).run(validDefaultHash, brokenDefaultHash);

    // Self-heal core Chart of Accounts heads if missing
    const ensureCoaAccount = (
      code: string,
      name: string,
      mainGroup: string,
      accountGroup: string,
      balType: 'Debit' | 'Credit',
      openingBal: number,
      notes: string
    ) => {
      const found = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(code);
      if (!found) {
        db.prepare(`
          INSERT INTO accounts (
            account_code, account_name, main_group, account_group, parent_account_id,
            opening_balance, opening_balance_type, total_debit, total_credit,
            current_balance, current_balance_type, is_system_account, status, notes
          ) VALUES (?, ?, ?, ?, NULL, ?, ?, 0.0, 0.0, ?, ?, 1, 'Active', ?)
        `).run(code, name, mainGroup, accountGroup, openingBal, balType, openingBal, balType, notes);
      }
    };

    // 1. Control & Party Parent Accounts
    ensureCoaAccount('ACC-1000', 'Trade Customers (Receivables Control)', 'PARTY ACCOUNTS', 'Customer', 'Debit', 0, 'Parent control head for Customer Receivable Ledgers');
    ensureCoaAccount('ACC-2000', 'Pharmaceutical Suppliers (Payables Control)', 'PARTY ACCOUNTS', 'Supplier', 'Credit', 0, 'Parent control head for Supplier & Distributor Payable Ledgers');
    ensureCoaAccount('ACC-3000', 'Dual Party Accounts (Customer & Supplier Control)', 'PARTY ACCOUNTS', 'Customer & Supplier', 'Debit', 0, 'Parent control head for parties acting as both Customer & Supplier');
    ensureCoaAccount('CUS-1001', 'Walk-in Cash Customer', 'PARTY ACCOUNTS', 'Customer', 'Debit', 0, 'Default counter retail walk-in customer account');

    // 2. Financial Accounts
    ensureCoaAccount('FIN-1010', 'Cash in Hand (Main Counter Drawer)', 'FINANCIAL ACCOUNTS', 'Cash in Hand', 'Debit', 250000.0, 'Primary store cash drawer account');
    ensureCoaAccount('FIN-1020', 'Bank Accounts Control', 'FINANCIAL ACCOUNTS', 'Bank', 'Debit', 0, 'Parent head for all bank accounts');
    ensureCoaAccount('FIN-1021', 'Meezan Bank - Main Business Account', 'FINANCIAL ACCOUNTS', 'Bank', 'Debit', 500000.0, 'Primary operating bank account');
    ensureCoaAccount('FIN-1030', 'Store Fixed Assets & Furniture', 'FINANCIAL ACCOUNTS', 'Assets', 'Debit', 0, 'Refrigerators, racks, computer hardware & fixtures');
    ensureCoaAccount('FIN-2010', 'Accrued Store Liabilities & Taxes', 'FINANCIAL ACCOUNTS', 'Liabilities', 'Credit', 0, 'Short-term store liabilities and payables');
    ensureCoaAccount('FIN-2020', 'Business Loans & Financing', 'FINANCIAL ACCOUNTS', 'Loans', 'Credit', 0, 'Long-term and short-term loan accounts');
    ensureCoaAccount('FIN-3010', 'Owner Capital Account (Abrar Medical Store)', 'FINANCIAL ACCOUNTS', 'Capital', 'Credit', 750000.0, 'Owner equity and capital investment');
    ensureCoaAccount('FIN-3020', 'Owner Drawings Account', 'FINANCIAL ACCOUNTS', 'Drawings', 'Debit', 0, 'Owner personal withdrawals');

    // 3. Income, Expense & Dedicated Accounts
    ensureCoaAccount('INC-4010', 'Medicine Sales Income', 'INCOME & EXPENSE ACCOUNTS', 'Sales Income', 'Credit', 0, 'Revenue from retail and wholesale medicine sales');
    ensureCoaAccount('SAL-4015', 'Medicine Sales Returns Account', 'INCOME & EXPENSE ACCOUNTS', 'Sales Income', 'Debit', 0, 'Contra-revenue account for confirmed customer sale returns');
    ensureCoaAccount('INC-4020', 'Purchase Discount Received', 'INCOME & EXPENSE ACCOUNTS', 'Purchase Discount', 'Credit', 0, 'Trade and cash discounts earned on supplier purchases');
    ensureCoaAccount('INC-4030', 'Other Pharmacy Income', 'INCOME & EXPENSE ACCOUNTS', 'Other Income', 'Credit', 0, 'Miscellaneous pharmacy income');
    ensureCoaAccount('PUR-5001', 'Medicine Purchases Account', 'INCOME & EXPENSE ACCOUNTS', 'Purchases', 'Debit', 0, 'Dedicated double-entry account for confirmed medicine and stock purchases');
    ensureCoaAccount('PUR-5002', 'Purchase Returns Account', 'INCOME & EXPENSE ACCOUNTS', 'Purchase Returns', 'Credit', 0, 'Dedicated double-entry account for confirmed supplier purchase returns (debit notes)');
    ensureCoaAccount('TAX-1040', 'Advance Tax Receivable (u/s 236)', 'FINANCIAL ACCOUNTS', 'Assets', 'Debit', 0, 'Dedicated account for Advance Tax paid on supplier purchases');
    ensureCoaAccount('TAX-1045', 'GST / Input Tax Adjustable', 'FINANCIAL ACCOUNTS', 'Assets', 'Debit', 0, 'Dedicated account for GST / Applicable Input Tax on supplier purchases');
    ensureCoaAccount('TAX-2040', 'Advance Tax Collected on Sales (u/s 236G/H)', 'FINANCIAL ACCOUNTS', 'Liabilities', 'Credit', 0, 'Dedicated account for Advance Tax collected from customer sales');
    ensureCoaAccount('DIS-5015', 'Sales Discount Allowed', 'INCOME & EXPENSE ACCOUNTS', 'Other Expenses', 'Debit', 0, 'Account for item & invoice discounts allowed on sales');
    ensureCoaAccount('EXP-5010', 'Shop Rent Expense', 'INCOME & EXPENSE ACCOUNTS', 'Rent', 'Debit', 0, 'Monthly medical store premises rent');
    ensureCoaAccount('EXP-5020', 'Electricity & Backup Power Expense', 'INCOME & EXPENSE ACCOUNTS', 'Electricity', 'Debit', 0, 'WAPDA electricity bills and cold-chain generator fuel');
    ensureCoaAccount('EXP-5030', 'Staff Salaries & Wages', 'INCOME & EXPENSE ACCOUNTS', 'Salaries', 'Debit', 0, 'Pharmacist and counter staff salaries');
    ensureCoaAccount('EXP-5040', 'Shop & Counter Expenses', 'INCOME & EXPENSE ACCOUNTS', 'Shop Expenses', 'Debit', 0, 'Packaging, thermal rolls, cleaning and daily store maintenance');
    ensureCoaAccount('EXP-5050', 'Other Miscellaneous Expenses', 'INCOME & EXPENSE ACCOUNTS', 'Other Expenses', 'Debit', 0, 'General administrative expenses');

    // Ensure all Financial, Income, Expense & Control accounts are permanently protected
    db.prepare(`
      UPDATE accounts
      SET is_system_account = 1
      WHERE main_group IN ('FINANCIAL ACCOUNTS', 'INCOME & EXPENSE ACCOUNTS')
         OR account_code IN ('ACC-1000', 'ACC-2000', 'ACC-3000', 'CUS-1001', 'FIN-1021')
    `).run();

    if (!existing15) {
      // Restore original opening balances on core financial accounts if they were zeroed out during test resets
      db.prepare(`
        UPDATE accounts
        SET opening_balance = 250000.0, opening_balance_type = 'Debit'
        WHERE account_code = 'FIN-1010' AND opening_balance = 0
      `).run();
      db.prepare(`
        UPDATE accounts
        SET opening_balance = 500000.0, opening_balance_type = 'Debit'
        WHERE account_code = 'FIN-1021' AND opening_balance = 0
      `).run();
      db.prepare(`
        UPDATE accounts
        SET opening_balance = 750000.0, opening_balance_type = 'Credit'
        WHERE account_code = 'FIN-3010' AND opening_balance = 0
      `).run();

      // Remove confirmed leftover verification/test journal entries & lines
      const orphanTestJes = db
        .prepare(`
          SELECT id FROM journal_entries
          WHERE description LIKE '%Verify Customer Clinic%'
             OR description LIKE '%Verify Supplier Co%'
             OR description LIKE '%Verify Medicine 500mg%'
             OR (reference_type IN ('SALE', 'SALES') AND reference_id IS NOT NULL AND reference_id NOT IN (SELECT id FROM sales))
             OR (reference_type = 'PURCHASE' AND reference_id IS NOT NULL AND reference_id NOT IN (SELECT id FROM purchases))
        `)
        .all() as Array<{ id: number }>;

      for (const je of orphanTestJes) {
        db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(je.id);
        db.prepare('DELETE FROM journal_entries WHERE id = ?').run(je.id);
      }

      // Remove orphaned invoice_number_registry rows pointing to deleted test sales/purchases
      db.prepare(`
        DELETE FROM invoice_number_registry
        WHERE (module_type = 'SALE' AND (record_id IS NULL OR record_id NOT IN (SELECT id FROM sales)))
           OR (module_type = 'PURCHASE' AND (record_id IS NULL OR record_id NOT IN (SELECT id FROM purchases)))
      `).run();

      // Reset invoice_sequences to match actual remaining invoices
      const remainingPeriods = db
        .prepare('SELECT period_key, COALESCE(MAX(seq_number), 0) as max_seq FROM invoice_number_registry GROUP BY period_key')
        .all() as Array<{ period_key: string; max_seq: number }>;
      db.prepare('DELETE FROM invoice_sequences').run();
      for (const p of remainingPeriods) {
        if (p.max_seq > 0) {
          db.prepare('INSERT INTO invoice_sequences (period_key, last_seq) VALUES (?, ?)').run(p.period_key, p.max_seq);
        }
      }

      // Remove test system_error_logs and test auth_audit_logs
      db.prepare('DELETE FROM system_error_logs').run();
      db.prepare(`
        DELETE FROM auth_audit_logs
        WHERE details LIKE '%Verify Customer Clinic%'
           OR details LIKE '%Verify Supplier Co%'
           OR details LIKE '%HLD-PUR-2026-11-%'
           OR details LIKE '%Inv-2026-11-%'
           OR details LIKE '%demo%'
           OR details LIKE '%test%'
           OR action IN ('LOGIN_SUCCESS', 'LOGOUT', 'LOGIN_FAILED')
      `).run();

      // Recalculate all account balances from genuine opening balances + genuine posted journal lines
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

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName15, 15);
    }

    // 16. Cash Book & Continuous Voucher Module
    const mig16Applied = db
      .prepare('SELECT id FROM database_migrations WHERE migration_name = ?')
      .get(migrationName16);

    if (!mig16Applied) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cash_book_vouchers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          voucher_number TEXT NOT NULL UNIQUE,
          sequence_number INTEGER NOT NULL UNIQUE,
          voucher_date TEXT NOT NULL,
          transaction_type TEXT NOT NULL CHECK(transaction_type IN ('Receipt', 'Payment', 'Contra', 'Expense', 'Capital')),
          category TEXT NOT NULL CHECK(category IN (
            'customer_receipt',
            'supplier_payment',
            'shop_expense',
            'capital_introduced',
            'drawings',
            'cash_deposit_bank',
            'cash_withdrawal_bank',
            'bank_transfer',
            'other_receipt',
            'other_payment'
          )),
          head_account_id INTEGER NOT NULL,
          head_account_code TEXT NOT NULL,
          head_account_name TEXT NOT NULL,
          cash_bank_account_id INTEGER NOT NULL,
          cash_bank_account_code TEXT NOT NULL,
          cash_bank_account_name TEXT NOT NULL,
          receipt_amount REAL NOT NULL DEFAULT 0.0 CHECK(receipt_amount >= 0),
          payment_amount REAL NOT NULL DEFAULT 0.0 CHECK(payment_amount >= 0),
          net_amount REAL NOT NULL DEFAULT 0.0 CHECK(net_amount >= 0),
          narration TEXT DEFAULT '',
          reference_number TEXT DEFAULT '',
          journal_entry_id INTEGER,
          accounting_voucher_id INTEGER,
          status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted', 'cancelled')),
          created_by TEXT NOT NULL DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (head_account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
          FOREIGN KEY (cash_bank_account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
          FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL,
          FOREIGN KEY (accounting_voucher_id) REFERENCES accounting_vouchers (id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cb_vouchers_no ON cash_book_vouchers(voucher_number);
        CREATE INDEX IF NOT EXISTS idx_cb_vouchers_seq ON cash_book_vouchers(sequence_number);
        CREATE INDEX IF NOT EXISTS idx_cb_vouchers_date ON cash_book_vouchers(voucher_date);
        CREATE INDEX IF NOT EXISTS idx_cb_vouchers_type ON cash_book_vouchers(transaction_type);
        CREATE INDEX IF NOT EXISTS idx_cb_vouchers_head ON cash_book_vouchers(head_account_id);
        CREATE INDEX IF NOT EXISTS idx_cb_vouchers_cb_acc ON cash_book_vouchers(cash_bank_account_id);
        CREATE INDEX IF NOT EXISTS idx_cb_vouchers_status ON cash_book_vouchers(status);
      `);

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName16, 16);
    }

    // =========================================================================
    // MIGRATION 17: Universal Automatic Account Sequences & History
    // =========================================================================
    const mig17Applied = db
      .prepare('SELECT id FROM database_migrations WHERE migration_name = ?')
      .get(migrationName17);

    if (!mig17Applied) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS account_sequences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prefix TEXT NOT NULL UNIQUE,
          account_type TEXT NOT NULL,
          last_number INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_account_sequences_prefix ON account_sequences(prefix);

        CREATE TABLE IF NOT EXISTS account_code_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER,
          account_code TEXT NOT NULL UNIQUE,
          prefix TEXT NOT NULL,
          sequence_number INTEGER NOT NULL,
          account_name TEXT,
          account_group TEXT,
          action TEXT NOT NULL DEFAULT 'ALLOCATED',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_account_code_history_code ON account_code_history(account_code);
        CREATE INDEX IF NOT EXISTS idx_account_code_history_prefix ON account_code_history(prefix);
      `);

      // Initialize account_sequences with high-water marks:
      // Customers: highest sequential is 23 (so next is Cus-024)
      // Suppliers: highest sequential is 37 (so next is Sup-038)
      const baseInitialSequences: Array<{ prefix: string; type: string; initial: number }> = [
        { prefix: 'Cus', type: 'Customer', initial: 23 },
        { prefix: 'Sup', type: 'Supplier', initial: 37 },
        { prefix: 'Dual', type: 'Customer & Supplier', initial: 0 },
        { prefix: 'Exp', type: 'Expense', initial: 0 },
        { prefix: 'Fin', type: 'Finance', initial: 0 },
        { prefix: 'Bank', type: 'Bank', initial: 0 },
        { prefix: 'Cash', type: 'Cash', initial: 0 },
        { prefix: 'Cap', type: 'Capital', initial: 0 },
        { prefix: 'Inc', type: 'Income', initial: 0 },
        { prefix: 'Emp', type: 'Employee', initial: 0 },
        { prefix: 'Oth', type: 'Other', initial: 0 },
      ];

      const insertSeqStmt = db.prepare(`
        INSERT OR IGNORE INTO account_sequences (prefix, account_type, last_number, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `);

      for (const item of baseInitialSequences) {
        insertSeqStmt.run(item.prefix, item.type, item.initial);
      }

      // Populate account_code_history from all pre-existing accounts so their codes are permanently recorded
      const existingAccounts = db.prepare('SELECT id, account_code, account_name, account_group FROM accounts').all() as Array<{
        id: number;
        account_code: string;
        account_name: string;
        account_group: string;
      }>;

      const insertHistStmt = db.prepare(`
        INSERT OR IGNORE INTO account_code_history (
          account_id, account_code, prefix, sequence_number, account_name, account_group, action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ALLOCATED', CURRENT_TIMESTAMP)
      `);

      for (const acc of existingAccounts) {
        const match = acc.account_code.match(/^([A-Za-z]+)-(\d+)$/);
        const prefix = match ? match[1] : 'ACC';
        const num = match ? parseInt(match[2], 10) : 0;
        insertHistStmt.run(acc.id, acc.account_code.trim(), prefix, num, acc.account_name, acc.account_group);
      }

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName17, 17);
    }

    // =========================================================================
    // MIGRATION 18: Cash Book Continuous Sequences & Audit History
    // =========================================================================
    const mig18Applied = db
      .prepare('SELECT id FROM database_migrations WHERE migration_name = ?')
      .get(migrationName18);

    if (!mig18Applied) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cash_book_sequences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sequence_key TEXT NOT NULL UNIQUE,
          last_sequence INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cash_book_audit_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          voucher_id INTEGER,
          voucher_number TEXT NOT NULL,
          action TEXT NOT NULL, -- CREATED, UPDATED, DELETED, REVERSED
          details TEXT,
          previous_values TEXT, -- JSON snapshot
          new_values TEXT, -- JSON snapshot
          performed_by TEXT NOT NULL,
          performed_by_role TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_cb_audit_vno ON cash_book_audit_history(voucher_number);
        CREATE INDEX IF NOT EXISTS idx_cb_audit_action ON cash_book_audit_history(action);
        CREATE INDEX IF NOT EXISTS idx_cb_audit_created ON cash_book_audit_history(created_at);
      `);

      // Initialize sequence high water mark from existing vouchers if any
      const curMax = Number(
        (db.prepare('SELECT COALESCE(MAX(sequence_number), 0) as m FROM cash_book_vouchers').get() as { m: number })?.m || 0
      );

      db.prepare(`
        INSERT OR IGNORE INTO cash_book_sequences (sequence_key, last_sequence, updated_at)
        VALUES ('voucher_continuous', ?, CURRENT_TIMESTAMP)
      `).run(curMax);

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName18, 18);
    }

    // =========================================================================
    // DEVICE LOGIN SECURITY COLUMNS (Non-destructive additive columns)
    // =========================================================================
    const ensureCol = (table: string, colName: string, colDef: string) => {
      const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === colName)) {
        db.exec(`ALTER TABLE "${table}" ADD COLUMN ${colName} ${colDef};`);
      }
    };

    ensureCol('users', 'registered_device_id', 'TEXT DEFAULT NULL');
    ensureCol('users', 'registered_device_name', 'TEXT DEFAULT NULL');
    ensureCol('users', 'registered_device_at', 'DATETIME DEFAULT NULL');
    ensureCol('users', 'pending_device_id', 'TEXT DEFAULT NULL');
    ensureCol('users', 'pending_device_name', 'TEXT DEFAULT NULL');
    ensureCol('users', 'pending_device_ip', 'TEXT DEFAULT NULL');
    ensureCol('users', 'pending_device_requested_at', 'DATETIME DEFAULT NULL');

    ensureCol('user_sessions', 'device_id', 'TEXT DEFAULT NULL');
    ensureCol('user_sessions', 'device_name', 'TEXT DEFAULT NULL');

    // Sales Bonus Quantity Feature (Free items deducted from inventory)
    ensureCol('sale_items', 'bonus_quantity', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('sale_return_items', 'sold_bonus_qty', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('sale_return_items', 'return_bonus_qty', 'REAL NOT NULL DEFAULT 0.0');

    // =========================================================================
    // MIGRATION 19: Complete Supply & Distribution Management System
    // =========================================================================
    ensureCol('accounts', 'town_id', 'INTEGER DEFAULT NULL');
    ensureCol('accounts', 'town_name', "TEXT DEFAULT ''");
    ensureCol('accounts', 'area_id', 'INTEGER DEFAULT NULL');
    ensureCol('accounts', 'area_name', "TEXT DEFAULT ''");
    ensureCol('accounts', 'assigned_salesman_id', 'INTEGER DEFAULT NULL');
    ensureCol('accounts', 'assigned_salesman_name', "TEXT DEFAULT ''");

    ensureCol('salesmen', 'opening_balance', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('salesmen', 'opening_balance_type', "TEXT NOT NULL DEFAULT 'Debit'");
    ensureCol('salesmen', 'assigned_towns_json', "TEXT NOT NULL DEFAULT '[]'");
    ensureCol('salesmen', 'assigned_areas_json', "TEXT NOT NULL DEFAULT '[]'");
    ensureCol('salesmen', 'assigned_parties_json', "TEXT NOT NULL DEFAULT '[]'");

    ensureCol('inventory', 'reserved_pack_qty', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('inventory', 'damaged_pack_qty', 'REAL NOT NULL DEFAULT 0.0');

    ensureCol('sales', 'town_supply_id', 'INTEGER DEFAULT NULL');
    ensureCol('sales', 'party_supply_id', 'INTEGER DEFAULT NULL');
    ensureCol('sales', 'supply_number', 'TEXT DEFAULT NULL');
    ensureCol('sales', 'town_name', "TEXT DEFAULT ''");
    ensureCol('sales', 'area_name', "TEXT DEFAULT ''");
    ensureCol('sales', 'stock_deducted_at_dispatch', 'INTEGER NOT NULL DEFAULT 0');

    const mig19Applied = db
      .prepare('SELECT id FROM database_migrations WHERE migration_name = ?')
      .get(migrationName19);

    if (!mig19Applied) {
      db.exec(`
        -- 1. Towns Master (Single unified TOWN concept; no separate City table)
        CREATE TABLE IF NOT EXISTS towns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          town_code TEXT NOT NULL UNIQUE,
          town_name TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
          notes TEXT DEFAULT '',
          created_by TEXT DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- 2. Town Areas Master (Areas under each Town)
        CREATE TABLE IF NOT EXISTS town_areas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          area_code TEXT NOT NULL UNIQUE,
          area_name TEXT NOT NULL,
          town_id INTEGER NOT NULL,
          town_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
          notes TEXT DEFAULT '',
          created_by TEXT DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(town_id, area_name),
          FOREIGN KEY (town_id) REFERENCES towns (id) ON DELETE CASCADE
        );

        -- 3. Salesman Territory & Party Assignments
        CREATE TABLE IF NOT EXISTS salesman_towns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          salesman_id INTEGER NOT NULL,
          town_id INTEGER NOT NULL,
          town_name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(salesman_id, town_id),
          FOREIGN KEY (salesman_id) REFERENCES salesmen (id) ON DELETE CASCADE,
          FOREIGN KEY (town_id) REFERENCES towns (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS salesman_areas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          salesman_id INTEGER NOT NULL,
          area_id INTEGER NOT NULL,
          area_name TEXT NOT NULL,
          town_id INTEGER NOT NULL,
          town_name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(salesman_id, area_id),
          FOREIGN KEY (salesman_id) REFERENCES salesmen (id) ON DELETE CASCADE,
          FOREIGN KEY (area_id) REFERENCES town_areas (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS salesman_parties (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          salesman_id INTEGER NOT NULL,
          party_account_id INTEGER NOT NULL,
          party_name TEXT NOT NULL,
          town_id INTEGER,
          town_name TEXT DEFAULT '',
          area_id INTEGER,
          area_name TEXT DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(salesman_id, party_account_id),
          FOREIGN KEY (salesman_id) REFERENCES salesmen (id) ON DELETE CASCADE,
          FOREIGN KEY (party_account_id) REFERENCES accounts (id) ON DELETE CASCADE
        );

        -- 4. Order Form Module (Does NOT deduct stock)
        CREATE TABLE IF NOT EXISTS supply_order_forms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_number TEXT NOT NULL UNIQUE,
          order_date TEXT NOT NULL,
          store_name TEXT NOT NULL DEFAULT 'ABRAR MEDICAL STORE',
          salesman_id INTEGER,
          salesman_name TEXT NOT NULL DEFAULT '',
          town_id INTEGER,
          town_name TEXT NOT NULL DEFAULT '',
          area_id INTEGER,
          area_name TEXT NOT NULL DEFAULT '',
          party_account_id INTEGER,
          party_code TEXT DEFAULT '',
          party_name TEXT NOT NULL DEFAULT '',
          remarks TEXT DEFAULT '',
          total_items INTEGER NOT NULL DEFAULT 0,
          total_quantity REAL NOT NULL DEFAULT 0.0,
          estimated_amount REAL NOT NULL DEFAULT 0.0,
          status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open', 'Converted to Booking', 'Cancelled')),
          converted_booking_id INTEGER DEFAULT NULL,
          converted_booking_number TEXT DEFAULT NULL,
          converted_at DATETIME DEFAULT NULL,
          created_by TEXT DEFAULT 'Super Admin',
          updated_by TEXT DEFAULT 'Super Admin',
          cancelled_by TEXT DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS supply_order_form_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_form_id INTEGER NOT NULL,
          s_no INTEGER NOT NULL DEFAULT 1,
          item_id INTEGER NOT NULL,
          item_code TEXT NOT NULL,
          company_name TEXT NOT NULL,
          item_name TEXT NOT NULL,
          packing TEXT DEFAULT '1x1',
          trade_price REAL NOT NULL DEFAULT 0.0,
          quantity REAL NOT NULL DEFAULT 0.0,
          remarks TEXT DEFAULT '',
          FOREIGN KEY (order_form_id) REFERENCES supply_order_forms (id) ON DELETE CASCADE
        );

        -- 5. Order Booking Module (Does NOT deduct stock)
        CREATE TABLE IF NOT EXISTS supply_bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_number TEXT NOT NULL UNIQUE,
          booking_date TEXT NOT NULL,
          order_form_id INTEGER DEFAULT NULL,
          order_number TEXT DEFAULT NULL,
          salesman_id INTEGER,
          salesman_name TEXT NOT NULL DEFAULT '',
          town_id INTEGER,
          town_name TEXT NOT NULL DEFAULT '',
          area_id INTEGER,
          area_name TEXT NOT NULL DEFAULT '',
          party_account_id INTEGER NOT NULL,
          party_code TEXT DEFAULT '',
          party_name TEXT NOT NULL,
          remarks TEXT DEFAULT '',
          total_items INTEGER NOT NULL DEFAULT 0,
          total_quantity REAL NOT NULL DEFAULT 0.0,
          total_supplied_qty REAL NOT NULL DEFAULT 0.0,
          total_pending_qty REAL NOT NULL DEFAULT 0.0,
          total_bonus REAL NOT NULL DEFAULT 0.0,
          gross_amount REAL NOT NULL DEFAULT 0.0,
          discount_amount REAL NOT NULL DEFAULT 0.0,
          net_amount REAL NOT NULL DEFAULT 0.0,
          status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Partially Supplied', 'Supplied', 'Cancelled')),
          created_by TEXT DEFAULT 'Super Admin',
          updated_by TEXT DEFAULT 'Super Admin',
          cancelled_by TEXT DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (party_account_id) REFERENCES accounts (id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS supply_booking_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id INTEGER NOT NULL,
          s_no INTEGER NOT NULL DEFAULT 1,
          item_id INTEGER NOT NULL,
          item_code TEXT NOT NULL,
          company_name TEXT NOT NULL,
          item_name TEXT NOT NULL,
          packing TEXT DEFAULT '1x1',
          quantity REAL NOT NULL DEFAULT 0.0,
          supplied_quantity REAL NOT NULL DEFAULT 0.0,
          pending_quantity REAL NOT NULL DEFAULT 0.0,
          bonus_quantity REAL NOT NULL DEFAULT 0.0,
          trade_price REAL NOT NULL DEFAULT 0.0,
          discount_percent REAL NOT NULL DEFAULT 0.0,
          discount_amount REAL NOT NULL DEFAULT 0.0,
          amount REAL NOT NULL DEFAULT 0.0,
          FOREIGN KEY (booking_id) REFERENCES supply_bookings (id) ON DELETE CASCADE
        );

        -- 6. Town-Wise Supply Creation & Party-Wise Supply Documents
        CREATE TABLE IF NOT EXISTS town_supplies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supply_number TEXT NOT NULL UNIQUE,
          supply_date TEXT NOT NULL,
          salesman_id INTEGER,
          salesman_name TEXT NOT NULL DEFAULT '',
          town_id INTEGER,
          town_name TEXT NOT NULL DEFAULT '',
          area_id INTEGER,
          area_name TEXT DEFAULT '',
          total_parties INTEGER NOT NULL DEFAULT 0,
          total_items INTEGER NOT NULL DEFAULT 0,
          total_ordered_qty REAL NOT NULL DEFAULT 0.0,
          total_supply_qty REAL NOT NULL DEFAULT 0.0,
          total_packed_qty REAL NOT NULL DEFAULT 0.0,
          total_dispatched_qty REAL NOT NULL DEFAULT 0.0,
          total_returned_qty REAL NOT NULL DEFAULT 0.0,
          total_damaged_qty REAL NOT NULL DEFAULT 0.0,
          total_billed_qty REAL NOT NULL DEFAULT 0.0,
          total_bonus_qty REAL NOT NULL DEFAULT 0.0,
          gross_amount REAL NOT NULL DEFAULT 0.0,
          discount_amount REAL NOT NULL DEFAULT 0.0,
          supply_amount REAL NOT NULL DEFAULT 0.0,
          return_amount REAL NOT NULL DEFAULT 0.0,
          final_bill_amount REAL NOT NULL DEFAULT 0.0,
          recovered_amount REAL NOT NULL DEFAULT 0.0,
          packing_status TEXT NOT NULL DEFAULT 'Pending' CHECK(packing_status IN ('Pending', 'Partially Packed', 'Packed')),
          supply_status TEXT NOT NULL DEFAULT 'Packing Pending' CHECK(supply_status IN (
            'Booking Pending',
            'Packing Pending',
            'Ready for Dispatch',
            'Dispatched',
            'Return Pending',
            'Partially Returned',
            'Partially Billed',
            'Fully Billed',
            'Completed',
            'Cancelled'
          )),
          dispatch_id INTEGER DEFAULT NULL,
          dispatch_number TEXT DEFAULT NULL,
          dispatch_date TEXT DEFAULT NULL,
          vehicle_van TEXT DEFAULT '',
          delivery_person TEXT DEFAULT '',
          stock_deducted INTEGER NOT NULL DEFAULT 0,
          remarks TEXT DEFAULT '',
          created_by TEXT DEFAULT 'Super Admin',
          updated_by TEXT DEFAULT 'Super Admin',
          cancelled_by TEXT DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS party_supplies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          party_supply_number TEXT NOT NULL UNIQUE,
          town_supply_id INTEGER NOT NULL,
          supply_number TEXT NOT NULL,
          supply_date TEXT NOT NULL,
          salesman_id INTEGER,
          salesman_name TEXT NOT NULL DEFAULT '',
          town_id INTEGER,
          town_name TEXT NOT NULL DEFAULT '',
          area_id INTEGER,
          area_name TEXT DEFAULT '',
          party_account_id INTEGER NOT NULL,
          party_code TEXT DEFAULT '',
          party_name TEXT NOT NULL,
          booking_ids_json TEXT DEFAULT '[]',
          booking_numbers TEXT DEFAULT '',
          total_items INTEGER NOT NULL DEFAULT 0,
          ordered_qty REAL NOT NULL DEFAULT 0.0,
          supply_qty REAL NOT NULL DEFAULT 0.0,
          packed_qty REAL NOT NULL DEFAULT 0.0,
          dispatched_qty REAL NOT NULL DEFAULT 0.0,
          delivered_qty REAL NOT NULL DEFAULT 0.0,
          returned_qty REAL NOT NULL DEFAULT 0.0,
          damaged_qty REAL NOT NULL DEFAULT 0.0,
          billed_qty REAL NOT NULL DEFAULT 0.0,
          bonus_qty REAL NOT NULL DEFAULT 0.0,
          gross_amount REAL NOT NULL DEFAULT 0.0,
          discount_amount REAL NOT NULL DEFAULT 0.0,
          supply_amount REAL NOT NULL DEFAULT 0.0,
          return_amount REAL NOT NULL DEFAULT 0.0,
          final_bill_amount REAL NOT NULL DEFAULT 0.0,
          recovered_amount REAL NOT NULL DEFAULT 0.0,
          packing_status TEXT NOT NULL DEFAULT 'Pending' CHECK(packing_status IN ('Pending', 'Partially Packed', 'Packed')),
          delivery_status TEXT NOT NULL DEFAULT 'Pending' CHECK(delivery_status IN ('Pending', 'Dispatched', 'Delivered', 'Partially Returned', 'Returned')),
          supply_status TEXT NOT NULL DEFAULT 'Packing Pending',
          final_sale_id INTEGER DEFAULT NULL,
          final_invoice_number TEXT DEFAULT NULL,
          stock_deducted INTEGER NOT NULL DEFAULT 0,
          remarks TEXT DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (town_supply_id) REFERENCES town_supplies (id) ON DELETE CASCADE,
          FOREIGN KEY (party_account_id) REFERENCES accounts (id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS party_supply_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          party_supply_id INTEGER NOT NULL,
          town_supply_id INTEGER NOT NULL,
          supply_number TEXT NOT NULL,
          party_account_id INTEGER NOT NULL,
          party_name TEXT NOT NULL,
          booking_id INTEGER DEFAULT NULL,
          booking_item_id INTEGER DEFAULT NULL,
          s_no INTEGER NOT NULL DEFAULT 1,
          item_id INTEGER NOT NULL,
          inventory_id INTEGER DEFAULT NULL,
          batch_number TEXT DEFAULT '',
          expiry_date TEXT DEFAULT '',
          item_code TEXT NOT NULL,
          company_name TEXT NOT NULL,
          item_name TEXT NOT NULL,
          packing TEXT DEFAULT '1x1',
          ordered_qty REAL NOT NULL DEFAULT 0.0,
          supply_qty REAL NOT NULL DEFAULT 0.0,
          bonus_qty REAL NOT NULL DEFAULT 0.0,
          packed_qty REAL NOT NULL DEFAULT 0.0,
          remaining_pack_qty REAL NOT NULL DEFAULT 0.0,
          packing_status TEXT NOT NULL DEFAULT 'Pending' CHECK(packing_status IN ('Pending', 'Partially Packed', 'Packed')),
          reserved_qty REAL NOT NULL DEFAULT 0.0,
          dispatched_qty REAL NOT NULL DEFAULT 0.0,
          delivered_qty REAL NOT NULL DEFAULT 0.0,
          returned_qty REAL NOT NULL DEFAULT 0.0,
          accepted_return_qty REAL NOT NULL DEFAULT 0.0,
          damaged_return_qty REAL NOT NULL DEFAULT 0.0,
          billed_qty REAL NOT NULL DEFAULT 0.0,
          pending_bill_qty REAL NOT NULL DEFAULT 0.0,
          trade_price REAL NOT NULL DEFAULT 0.0,
          discount_percent REAL NOT NULL DEFAULT 0.0,
          discount_amount REAL NOT NULL DEFAULT 0.0,
          amount REAL NOT NULL DEFAULT 0.0,
          return_amount REAL NOT NULL DEFAULT 0.0,
          final_billed_amount REAL NOT NULL DEFAULT 0.0,
          FOREIGN KEY (party_supply_id) REFERENCES party_supplies (id) ON DELETE CASCADE,
          FOREIGN KEY (town_supply_id) REFERENCES town_supplies (id) ON DELETE CASCADE
        );

        -- 7. Dispatch / Supply Delivery Module (Deducts stock once when dispatched)
        CREATE TABLE IF NOT EXISTS supply_dispatches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dispatch_number TEXT NOT NULL UNIQUE,
          town_supply_id INTEGER NOT NULL,
          supply_number TEXT NOT NULL,
          dispatch_date TEXT NOT NULL,
          salesman_id INTEGER,
          salesman_name TEXT NOT NULL DEFAULT '',
          town_id INTEGER,
          town_name TEXT NOT NULL DEFAULT '',
          vehicle_van TEXT NOT NULL DEFAULT '',
          delivery_person TEXT NOT NULL DEFAULT '',
          total_parties INTEGER NOT NULL DEFAULT 0,
          total_items INTEGER NOT NULL DEFAULT 0,
          total_quantity REAL NOT NULL DEFAULT 0.0,
          total_amount REAL NOT NULL DEFAULT 0.0,
          status TEXT NOT NULL DEFAULT 'Dispatched' CHECK(status IN ('Dispatched', 'Delivered', 'Completed', 'Cancelled')),
          remarks TEXT DEFAULT '',
          created_by TEXT DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (town_supply_id) REFERENCES town_supplies (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS supply_dispatch_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dispatch_id INTEGER NOT NULL,
          town_supply_id INTEGER NOT NULL,
          party_supply_id INTEGER NOT NULL,
          party_supply_item_id INTEGER NOT NULL,
          party_account_id INTEGER NOT NULL,
          party_name TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          inventory_id INTEGER DEFAULT NULL,
          batch_number TEXT DEFAULT '',
          item_code TEXT NOT NULL,
          company_name TEXT NOT NULL,
          item_name TEXT NOT NULL,
          packing TEXT DEFAULT '1x1',
          packed_qty REAL NOT NULL DEFAULT 0.0,
          dispatched_qty REAL NOT NULL DEFAULT 0.0,
          delivered_qty REAL NOT NULL DEFAULT 0.0,
          pending_qty REAL NOT NULL DEFAULT 0.0,
          bonus_qty REAL NOT NULL DEFAULT 0.0,
          trade_price REAL NOT NULL DEFAULT 0.0,
          discount_percent REAL NOT NULL DEFAULT 0.0,
          amount REAL NOT NULL DEFAULT 0.0,
          FOREIGN KEY (dispatch_id) REFERENCES supply_dispatches (id) ON DELETE CASCADE
        );

        -- 8. Sales Return From Salesman Module (Restores accepted saleable stock, isolates damaged stock)
        CREATE TABLE IF NOT EXISTS supply_returns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          return_number TEXT NOT NULL UNIQUE,
          return_date TEXT NOT NULL,
          town_supply_id INTEGER NOT NULL,
          supply_number TEXT NOT NULL,
          party_supply_id INTEGER DEFAULT NULL,
          salesman_id INTEGER,
          salesman_name TEXT NOT NULL DEFAULT '',
          town_id INTEGER,
          town_name TEXT NOT NULL DEFAULT '',
          party_account_id INTEGER NOT NULL,
          party_name TEXT NOT NULL,
          total_returned_qty REAL NOT NULL DEFAULT 0.0,
          total_accepted_qty REAL NOT NULL DEFAULT 0.0,
          total_damaged_qty REAL NOT NULL DEFAULT 0.0,
          total_return_amount REAL NOT NULL DEFAULT 0.0,
          remarks TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'Completed' CHECK(status IN ('Completed', 'Cancelled')),
          created_by TEXT DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (town_supply_id) REFERENCES town_supplies (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS supply_return_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supply_return_id INTEGER NOT NULL,
          town_supply_id INTEGER NOT NULL,
          party_supply_id INTEGER NOT NULL,
          party_supply_item_id INTEGER NOT NULL,
          party_account_id INTEGER NOT NULL,
          party_name TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          inventory_id INTEGER DEFAULT NULL,
          batch_number TEXT DEFAULT '',
          item_code TEXT NOT NULL,
          company_name TEXT NOT NULL,
          item_name TEXT NOT NULL,
          packing TEXT DEFAULT '1x1',
          supplied_qty REAL NOT NULL DEFAULT 0.0,
          previously_returned_qty REAL NOT NULL DEFAULT 0.0,
          new_return_qty REAL NOT NULL DEFAULT 0.0,
          accepted_qty REAL NOT NULL DEFAULT 0.0,
          damaged_qty REAL NOT NULL DEFAULT 0.0,
          return_reason TEXT DEFAULT '',
          trade_price REAL NOT NULL DEFAULT 0.0,
          discount_percent REAL NOT NULL DEFAULT 0.0,
          return_amount REAL NOT NULL DEFAULT 0.0,
          FOREIGN KEY (supply_return_id) REFERENCES supply_returns (id) ON DELETE CASCADE
        );

        -- 9. Recovery / Collection Management Module
        CREATE TABLE IF NOT EXISTS supply_recoveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          receipt_number TEXT NOT NULL UNIQUE,
          recovery_date TEXT NOT NULL,
          salesman_id INTEGER,
          salesman_name TEXT NOT NULL DEFAULT '',
          town_id INTEGER,
          town_name TEXT NOT NULL DEFAULT '',
          area_id INTEGER,
          area_name TEXT DEFAULT '',
          party_account_id INTEGER NOT NULL,
          party_code TEXT DEFAULT '',
          party_name TEXT NOT NULL,
          town_supply_id INTEGER DEFAULT NULL,
          party_supply_id INTEGER DEFAULT NULL,
          supply_number TEXT DEFAULT '',
          sale_id INTEGER DEFAULT NULL,
          invoice_number TEXT DEFAULT '',
          invoice_amount REAL NOT NULL DEFAULT 0.0,
          previous_outstanding REAL NOT NULL DEFAULT 0.0,
          recovery_amount REAL NOT NULL DEFAULT 0.0,
          remaining_balance REAL NOT NULL DEFAULT 0.0,
          payment_method TEXT NOT NULL DEFAULT 'Cash' CHECK(payment_method IN ('Cash', 'Bank Transfer', 'Cheque', 'Online')),
          financial_account_id INTEGER NOT NULL,
          financial_account_name TEXT NOT NULL DEFAULT '',
          journal_entry_id INTEGER DEFAULT NULL,
          payment_voucher_id INTEGER DEFAULT NULL,
          cash_book_voucher_id INTEGER DEFAULT NULL,
          settlement_id INTEGER DEFAULT NULL,
          is_settled INTEGER NOT NULL DEFAULT 0,
          remarks TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'Posted' CHECK(status IN ('Posted', 'Cancelled')),
          created_by TEXT DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (party_account_id) REFERENCES accounts (id) ON DELETE RESTRICT
        );

        -- 10. Salesman Settlement Module
        CREATE TABLE IF NOT EXISTS salesman_settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          settlement_number TEXT NOT NULL UNIQUE,
          settlement_date TEXT NOT NULL,
          from_date TEXT NOT NULL,
          to_date TEXT NOT NULL,
          salesman_id INTEGER NOT NULL,
          salesman_code TEXT DEFAULT '',
          salesman_name TEXT NOT NULL,
          town_name TEXT DEFAULT '',
          total_supplies REAL NOT NULL DEFAULT 0.0,
          total_returns REAL NOT NULL DEFAULT 0.0,
          total_final_billing REAL NOT NULL DEFAULT 0.0,
          total_cash_collected REAL NOT NULL DEFAULT 0.0,
          total_bank_collections REAL NOT NULL DEFAULT 0.0,
          total_outstanding REAL NOT NULL DEFAULT 0.0,
          cash_submitted_to_store REAL NOT NULL DEFAULT 0.0,
          remaining_cash_in_hand REAL NOT NULL DEFAULT 0.0,
          difference REAL NOT NULL DEFAULT 0.0,
          remarks TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'Completed' CHECK(status IN ('Completed', 'Cancelled')),
          created_by TEXT DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (salesman_id) REFERENCES salesmen (id) ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS idx_towns_name ON towns(town_name);
        CREATE INDEX IF NOT EXISTS idx_town_areas_town ON town_areas(town_id);
        CREATE INDEX IF NOT EXISTS idx_order_forms_no ON supply_order_forms(order_number);
        CREATE INDEX IF NOT EXISTS idx_order_forms_date ON supply_order_forms(order_date);
        CREATE INDEX IF NOT EXISTS idx_bookings_no ON supply_bookings(booking_number);
        CREATE INDEX IF NOT EXISTS idx_bookings_town ON supply_bookings(town_id);
        CREATE INDEX IF NOT EXISTS idx_bookings_party ON supply_bookings(party_account_id);
        CREATE INDEX IF NOT EXISTS idx_town_supplies_no ON town_supplies(supply_number);
        CREATE INDEX IF NOT EXISTS idx_party_supplies_town_sup ON party_supplies(town_supply_id);
        CREATE INDEX IF NOT EXISTS idx_party_supplies_party ON party_supplies(party_account_id);
        CREATE INDEX IF NOT EXISTS idx_supply_dispatches_no ON supply_dispatches(dispatch_number);
        CREATE INDEX IF NOT EXISTS idx_supply_returns_no ON supply_returns(return_number);
        CREATE INDEX IF NOT EXISTS idx_supply_recoveries_no ON supply_recoveries(receipt_number);
        CREATE INDEX IF NOT EXISTS idx_supply_recoveries_sup ON supply_recoveries(supply_number);
        CREATE INDEX IF NOT EXISTS idx_salesman_settlements_no ON salesman_settlements(settlement_number);
      `);

      // Backfill existing accounts.city into accounts.town_name if town_name is empty, and sync into towns table
      const existingAccCities = db
        .prepare("SELECT DISTINCT TRIM(city) as t FROM accounts WHERE city IS NOT NULL AND TRIM(city) != ''")
        .all() as Array<{ t: string }>;
      let townSeq = 1;
      for (const row of existingAccCities) {
        const tName = row.t;
        if (!tName) continue;
        const code = `TWN-${String(townSeq++).padStart(3, '0')}`;
        db.prepare(
          "INSERT OR IGNORE INTO towns (town_code, town_name, status, notes) VALUES (?, ?, 'Active', 'Migrated from Party Master')"
        ).run(code, tName);
        const townRec = db
          .prepare('SELECT id, town_name FROM towns WHERE LOWER(town_name) = LOWER(?)')
          .get(tName) as { id: number; town_name: string } | undefined;
        if (townRec) {
          db.prepare(
            "UPDATE accounts SET town_id = ?, town_name = ? WHERE LOWER(TRIM(city)) = LOWER(?) AND (town_name IS NULL OR town_name = '')"
          ).run(townRec.id, townRec.town_name, tName);
        }
      }

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName19, 19);
    }

    // =========================================================================
    // MIGRATION 20: Salesman Login + Mobile Booking + Batch FIFO + Trade Deals
    //               + Party Discounts + Master Reset + Local Backup & Restore
    // =========================================================================
    // 1. Salesmen extended columns (syncing name/full_name and mobile/phone)
    ensureCol('salesmen', 'full_name', "TEXT NOT NULL DEFAULT ''");
    ensureCol('salesmen', 'phone', "TEXT NOT NULL DEFAULT ''");
    ensureCol('salesmen', 'assigned_area', "TEXT NOT NULL DEFAULT ''");
    ensureCol('salesmen', 'commission_percent', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('salesmen', 'monthly_target', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('salesmen', 'username', 'TEXT DEFAULT NULL');
    ensureCol('salesmen', 'password_hash', 'TEXT DEFAULT NULL');
    ensureCol('salesmen', 'user_id', 'INTEGER DEFAULT NULL');
    ensureCol('salesmen', 'permitted_items_json', "TEXT NOT NULL DEFAULT '[]'");

    db.exec(`
      UPDATE salesmen SET full_name = name WHERE (full_name IS NULL OR full_name = '') AND name IS NOT NULL AND name != '';
      UPDATE salesmen SET name = full_name WHERE (name IS NULL OR name = '') AND full_name IS NOT NULL AND full_name != '';
      UPDATE salesmen SET phone = mobile WHERE (phone IS NULL OR phone = '') AND mobile IS NOT NULL AND mobile != '';
      UPDATE salesmen SET mobile = phone WHERE (mobile IS NULL OR mobile = '') AND phone IS NOT NULL AND phone != '';
    `);

    // Ensure active Town Master and dependent Areas exist if empty
    const townCount = Number((db.prepare('SELECT COUNT(*) as c FROM towns').get() as { c: number })?.c || 0);
    if (townCount === 0) {
      db.prepare("INSERT OR IGNORE INTO towns (town_code, town_name, status, notes) VALUES ('TWN-001', 'Lahore City', 'Active', 'Primary store territory')").run();
      db.prepare("INSERT OR IGNORE INTO towns (town_code, town_name, status, notes) VALUES ('TWN-002', 'Faisalabad', 'Active', 'Distribution territory')").run();

      const lhr = db.prepare("SELECT id FROM towns WHERE town_code = 'TWN-001'").get() as { id: number } | undefined;
      if (lhr) {
        db.prepare("INSERT OR IGNORE INTO town_areas (area_code, area_name, town_id, town_name, status, notes) VALUES ('ARA-001', 'Circular Road (Medicine Market)', ?, 'Lahore City', 'Active', 'Wholesale market')").run(lhr.id);
        db.prepare("INSERT OR IGNORE INTO town_areas (area_code, area_name, town_id, town_name, status, notes) VALUES ('ARA-002', 'Anarkali & Mall Road', ?, 'Lahore City', 'Active', 'Retail pharmacy hub')").run(lhr.id);
        db.prepare("INSERT OR IGNORE INTO town_areas (area_code, area_name, town_id, town_name, status, notes) VALUES ('ARA-003', 'Gulberg & Main Market', ?, 'Lahore City', 'Active', 'Commercial zone')").run(lhr.id);
        db.prepare("INSERT OR IGNORE INTO town_areas (area_code, area_name, town_id, town_name, status, notes) VALUES ('ARA-004', 'Model Town & Faisal Town', ?, 'Lahore City', 'Active', 'Hospital and clinic belt')").run(lhr.id);
        db.prepare("INSERT OR IGNORE INTO town_areas (area_code, area_name, town_id, town_name, status, notes) VALUES ('ARA-005', 'Dharampura & Saddar Cantt', ?, 'Lahore City', 'Active', 'Local pharmacy route')").run(lhr.id);
      }

      const fsd = db.prepare("SELECT id FROM towns WHERE town_code = 'TWN-002'").get() as { id: number } | undefined;
      if (fsd) {
        db.prepare("INSERT OR IGNORE INTO town_areas (area_code, area_name, town_id, town_name, status, notes) VALUES ('ARA-006', 'Katchery Bazar & Rail Bazar', ?, 'Faisalabad', 'Active', 'Wholesale market')").run(fsd.id);
        db.prepare("INSERT OR IGNORE INTO town_areas (area_code, area_name, town_id, town_name, status, notes) VALUES ('ARA-007', 'Civil Lines & D Ground', ?, 'Faisalabad', 'Active', 'Commercial belt')").run(fsd.id);
      }
    }

    // Ensure active field salesmen exist if empty
    const salesmanCount = Number((db.prepare('SELECT COUNT(*) as c FROM salesmen').get() as { c: number })?.c || 0);
    if (salesmanCount === 0) {
      db.prepare(`
        INSERT OR IGNORE INTO salesmen (salesman_code, name, full_name, mobile, phone, assigned_area, commission_percent, monthly_target, status)
        VALUES ('SAL-001', 'Muhammad Akram', 'Muhammad Akram', '+92 300 4567890', '+92 300 4567890', 'Circular Road, Lahore', 1.5, 500000.0, 'Active')
      `).run();
      db.prepare(`
        INSERT OR IGNORE INTO salesmen (salesman_code, name, full_name, mobile, phone, assigned_area, commission_percent, monthly_target, status)
        VALUES ('SAL-002', 'Tariq Mahmood', 'Tariq Mahmood', '+92 321 8765432', '+92 321 8765432', 'Faisalabad Center', 1.5, 400000.0, 'Active')
      `).run();

      const lhr = db.prepare("SELECT id FROM towns WHERE town_code = 'TWN-001'").get() as { id: number } | undefined;
      const sal1 = db.prepare("SELECT id FROM salesmen WHERE salesman_code = 'SAL-001'").get() as { id: number } | undefined;
      if (lhr && sal1) {
        db.prepare("INSERT OR IGNORE INTO salesman_towns (salesman_id, town_id, town_name) VALUES (?, ?, 'Lahore City')").run(sal1.id, lhr.id);
      }
    }

    // 2. Inventory Batch-Wise FIFO & Expiry Management columns
    ensureCol('inventory', 'purchase_date', "TEXT DEFAULT ''");
    ensureCol('inventory', 'purchase_invoice_number', "TEXT DEFAULT ''");
    ensureCol('inventory', 'supplier_name', "TEXT DEFAULT ''");
    ensureCol('inventory', 'dispatched_pack_qty', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('inventory', 'is_blocked', 'INTEGER NOT NULL DEFAULT 0');
    ensureCol('inventory', 'blocked_reason', "TEXT DEFAULT ''");
    ensureCol('inventory', 'blocked_by', "TEXT DEFAULT ''");
    ensureCol('inventory', 'blocked_at', 'DATETIME DEFAULT NULL');
    ensureCol('inventory', 'batch_status', "TEXT NOT NULL DEFAULT 'Active'");

    // Reconcile existing inventory batch metadata from purchase records (never inventing batch numbers or expiry dates)
    db.exec(`
      UPDATE inventory
      SET purchase_date = COALESCE(
        NULLIF(purchase_date, ''),
        (SELECT p.bill_date FROM purchases p WHERE p.id = inventory.last_purchase_id),
        DATE(inventory.created_at)
      ),
      purchase_invoice_number = COALESCE(
        NULLIF(purchase_invoice_number, ''),
        (SELECT p.bill_number FROM purchases p WHERE p.id = inventory.last_purchase_id),
        ''
      ),
      supplier_name = COALESCE(
        NULLIF(supplier_name, ''),
        (SELECT a.account_name FROM accounts a WHERE a.id = inventory.last_supplier_id),
        ''
      )
      WHERE purchase_date IS NULL OR purchase_date = '';
    `);

    // 3. Company Settings columns for Discount Stacking & Local Backup/Retention
    ensureCol('company_settings', 'discount_stacking_rule', "TEXT NOT NULL DEFAULT 'higher_only'");
    ensureCol('company_settings', 'local_backup_folder', "TEXT NOT NULL DEFAULT 'D:\\Abrar Medical Store Backups'");
    ensureCol('company_settings', 'auto_weekly_backup', 'INTEGER NOT NULL DEFAULT 1');
    ensureCol('company_settings', 'auto_backup_time', "TEXT NOT NULL DEFAULT '22:00'");
    ensureCol('company_settings', 'daily_retention_count', 'INTEGER NOT NULL DEFAULT 7');
    ensureCol('company_settings', 'weekly_retention_count', 'INTEGER NOT NULL DEFAULT 4');
    ensureCol('company_settings', 'backup_before_master_reset', 'INTEGER NOT NULL DEFAULT 1');
    ensureCol('company_settings', 'last_scheduled_backup_check', 'TEXT DEFAULT NULL');

    // 4. Sale Items & Supply Items Offer, Party Discount & FIFO Batch Allocation columns
    ensureCol('sale_items', 'offer_id', 'INTEGER DEFAULT NULL');
    ensureCol('sale_items', 'offer_name', "TEXT DEFAULT ''");
    ensureCol('sale_items', 'offer_discount_percent', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('sale_items', 'offer_discount_amount', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('sale_items', 'party_discount_id', 'INTEGER DEFAULT NULL');
    ensureCol('sale_items', 'party_discount_percent', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('sale_items', 'party_discount_amount', 'REAL NOT NULL DEFAULT 0.0');
    ensureCol('sale_items', 'manual_override_reason', "TEXT DEFAULT ''");
    ensureCol('sale_items', 'fifo_batches_json', "TEXT DEFAULT '[]'");

    const mig20Applied = db
      .prepare('SELECT id FROM database_migrations WHERE migration_name = ?')
      .get(migrationName20);

    if (!mig20Applied) {
      // Upgrade supply tables if empty so all column aliases and mobile statuses are supported seamlessly
      const supplyCountRow = db.prepare('SELECT COUNT(*) as c FROM town_supplies').get() as { c: number } | undefined;
      const bookingCountRow = db.prepare('SELECT COUNT(*) as c FROM supply_bookings').get() as { c: number } | undefined;
      const orderFormCountRow = db.prepare('SELECT COUNT(*) as c FROM supply_order_forms').get() as { c: number } | undefined;

      if (Number(orderFormCountRow?.c || 0) === 0) {
        db.exec(`
          DROP TABLE IF EXISTS supply_order_form_items;
          DROP TABLE IF EXISTS supply_order_forms;
          CREATE TABLE supply_order_forms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT NOT NULL UNIQUE,
            order_date TEXT NOT NULL,
            store_name TEXT NOT NULL DEFAULT 'ABRAR MEDICAL STORE',
            salesman_id INTEGER,
            salesman_name TEXT NOT NULL DEFAULT '',
            town_id INTEGER,
            town_name TEXT NOT NULL DEFAULT '',
            area_id INTEGER,
            area_name TEXT NOT NULL DEFAULT '',
            party_account_id INTEGER,
            party_code TEXT DEFAULT '',
            party_name TEXT NOT NULL DEFAULT '',
            remarks TEXT DEFAULT '',
            total_items INTEGER NOT NULL DEFAULT 0,
            total_quantity REAL NOT NULL DEFAULT 0.0,
            total_amount REAL NOT NULL DEFAULT 0.0,
            estimated_amount REAL NOT NULL DEFAULT 0.0,
            status TEXT NOT NULL DEFAULT 'Draft',
            converted_booking_id INTEGER DEFAULT NULL,
            converted_booking_number TEXT DEFAULT NULL,
            converted_at DATETIME DEFAULT NULL,
            created_by TEXT DEFAULT 'Super Admin',
            updated_by TEXT DEFAULT 'Super Admin',
            cancelled_by TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE supply_order_form_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_form_id INTEGER NOT NULL,
            s_no INTEGER NOT NULL DEFAULT 1,
            item_id INTEGER NOT NULL,
            item_code TEXT NOT NULL,
            company_name TEXT NOT NULL,
            item_name TEXT NOT NULL,
            packing TEXT DEFAULT '1x1',
            trade_price REAL NOT NULL DEFAULT 0.0,
            quantity REAL NOT NULL DEFAULT 0.0,
            bonus_quantity REAL NOT NULL DEFAULT 0.0,
            amount REAL NOT NULL DEFAULT 0.0,
            remarks TEXT DEFAULT '',
            FOREIGN KEY (order_form_id) REFERENCES supply_order_forms (id) ON DELETE CASCADE
          );
        `);
      }

      if (Number(bookingCountRow?.c || 0) === 0) {
        db.exec(`
          DROP TABLE IF EXISTS supply_booking_items;
          DROP TABLE IF EXISTS supply_bookings;
          CREATE TABLE supply_bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_number TEXT NOT NULL UNIQUE,
            booking_date TEXT NOT NULL,
            order_form_id INTEGER DEFAULT NULL,
            order_number TEXT DEFAULT NULL,
            source_type TEXT NOT NULL DEFAULT 'ERP',
            mobile_booking_uuid TEXT DEFAULT NULL,
            import_batch_id INTEGER DEFAULT NULL,
            import_batch_number TEXT DEFAULT NULL,
            mobile_status TEXT NOT NULL DEFAULT 'Received',
            salesman_id INTEGER,
            salesman_name TEXT NOT NULL DEFAULT '',
            town_id INTEGER,
            town_name TEXT NOT NULL DEFAULT '',
            area_id INTEGER,
            area_name TEXT NOT NULL DEFAULT '',
            party_account_id INTEGER NOT NULL,
            party_code TEXT DEFAULT '',
            party_name TEXT NOT NULL,
            remarks TEXT DEFAULT '',
            total_items INTEGER NOT NULL DEFAULT 0,
            total_quantity REAL NOT NULL DEFAULT 0.0,
            total_supplied_qty REAL NOT NULL DEFAULT 0.0,
            total_pending_qty REAL NOT NULL DEFAULT 0.0,
            total_bonus REAL NOT NULL DEFAULT 0.0,
            gross_amount REAL NOT NULL DEFAULT 0.0,
            offer_discount_amount REAL NOT NULL DEFAULT 0.0,
            party_discount_amount REAL NOT NULL DEFAULT 0.0,
            discount_amount REAL NOT NULL DEFAULT 0.0,
            total_amount REAL NOT NULL DEFAULT 0.0,
            net_amount REAL NOT NULL DEFAULT 0.0,
            status TEXT NOT NULL DEFAULT 'Booking Pending',
            created_by TEXT DEFAULT 'Super Admin',
            updated_by TEXT DEFAULT 'Super Admin',
            cancelled_by TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (party_account_id) REFERENCES accounts (id) ON DELETE RESTRICT
          );

          CREATE TABLE supply_booking_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id INTEGER NOT NULL,
            s_no INTEGER NOT NULL DEFAULT 1,
            item_id INTEGER NOT NULL,
            item_code TEXT NOT NULL,
            company_name TEXT NOT NULL,
            item_name TEXT NOT NULL,
            packing TEXT DEFAULT '1x1',
            quantity REAL NOT NULL DEFAULT 0.0,
            supplied_quantity REAL NOT NULL DEFAULT 0.0,
            pending_quantity REAL NOT NULL DEFAULT 0.0,
            bonus_quantity REAL NOT NULL DEFAULT 0.0,
            trade_price REAL NOT NULL DEFAULT 0.0,
            offer_id INTEGER DEFAULT NULL,
            offer_name TEXT DEFAULT '',
            offer_discount_percent REAL NOT NULL DEFAULT 0.0,
            offer_discount_amount REAL NOT NULL DEFAULT 0.0,
            party_discount_id INTEGER DEFAULT NULL,
            party_discount_percent REAL NOT NULL DEFAULT 0.0,
            party_discount_amount REAL NOT NULL DEFAULT 0.0,
            discount_percent REAL NOT NULL DEFAULT 0.0,
            discount_amount REAL NOT NULL DEFAULT 0.0,
            amount REAL NOT NULL DEFAULT 0.0,
            remarks TEXT DEFAULT '',
            FOREIGN KEY (booking_id) REFERENCES supply_bookings (id) ON DELETE CASCADE
          );
        `);
      }

      if (Number(supplyCountRow?.c || 0) === 0) {
        db.exec(`
          DROP TABLE IF EXISTS supply_return_items;
          DROP TABLE IF EXISTS supply_returns;
          DROP TABLE IF EXISTS supply_dispatch_items;
          DROP TABLE IF EXISTS supply_dispatches;
          DROP TABLE IF EXISTS party_supply_items;
          DROP TABLE IF EXISTS party_supplies;
          DROP TABLE IF EXISTS town_supplies;
          DROP TABLE IF EXISTS supply_recoveries;
          DROP TABLE IF EXISTS salesman_settlements;

          CREATE TABLE town_supplies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supply_number TEXT NOT NULL UNIQUE,
            supply_date TEXT NOT NULL,
            salesman_id INTEGER,
            salesman_name TEXT NOT NULL DEFAULT '',
            town_id INTEGER,
            town_name TEXT NOT NULL DEFAULT '',
            area_id INTEGER,
            area_name TEXT DEFAULT '',
            import_batch_id INTEGER DEFAULT NULL,
            import_batch_number TEXT DEFAULT NULL,
            total_parties INTEGER NOT NULL DEFAULT 0,
            total_items INTEGER NOT NULL DEFAULT 0,
            total_ordered_qty REAL NOT NULL DEFAULT 0.0,
            total_supply_qty REAL NOT NULL DEFAULT 0.0,
            total_packed_qty REAL NOT NULL DEFAULT 0.0,
            total_dispatched_qty REAL NOT NULL DEFAULT 0.0,
            total_return_qty REAL NOT NULL DEFAULT 0.0,
            total_returned_qty REAL NOT NULL DEFAULT 0.0,
            total_damaged_qty REAL NOT NULL DEFAULT 0.0,
            total_billed_qty REAL NOT NULL DEFAULT 0.0,
            total_bonus_qty REAL NOT NULL DEFAULT 0.0,
            gross_amount REAL NOT NULL DEFAULT 0.0,
            offer_discount_amount REAL NOT NULL DEFAULT 0.0,
            party_discount_amount REAL NOT NULL DEFAULT 0.0,
            discount_amount REAL NOT NULL DEFAULT 0.0,
            total_supply_amount REAL NOT NULL DEFAULT 0.0,
            supply_amount REAL NOT NULL DEFAULT 0.0,
            total_return_amount REAL NOT NULL DEFAULT 0.0,
            return_amount REAL NOT NULL DEFAULT 0.0,
            net_billable_amount REAL NOT NULL DEFAULT 0.0,
            total_billed_amount REAL NOT NULL DEFAULT 0.0,
            final_bill_amount REAL NOT NULL DEFAULT 0.0,
            total_recovered_amount REAL NOT NULL DEFAULT 0.0,
            recovered_amount REAL NOT NULL DEFAULT 0.0,
            packing_status TEXT NOT NULL DEFAULT 'Pending',
            supply_status TEXT NOT NULL DEFAULT 'Packing Pending',
            super_admin_reviewed INTEGER NOT NULL DEFAULT 1,
            dispatch_id INTEGER DEFAULT NULL,
            dispatch_number TEXT DEFAULT NULL,
            dispatch_date TEXT DEFAULT NULL,
            vehicle_van TEXT DEFAULT '',
            delivery_person TEXT DEFAULT '',
            stock_deducted INTEGER NOT NULL DEFAULT 0,
            remarks TEXT DEFAULT '',
            created_by TEXT DEFAULT 'Super Admin',
            updated_by TEXT DEFAULT 'Super Admin',
            cancelled_by TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE party_supplies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            party_supply_number TEXT NOT NULL UNIQUE,
            town_supply_id INTEGER NOT NULL,
            supply_number TEXT NOT NULL,
            supply_date TEXT NOT NULL,
            salesman_id INTEGER,
            salesman_name TEXT NOT NULL DEFAULT '',
            town_id INTEGER,
            town_name TEXT NOT NULL DEFAULT '',
            area_id INTEGER,
            area_name TEXT DEFAULT '',
            party_account_id INTEGER NOT NULL,
            party_code TEXT DEFAULT '',
            party_name TEXT NOT NULL,
            booking_ids_json TEXT DEFAULT '[]',
            booking_numbers TEXT DEFAULT '',
            total_items INTEGER NOT NULL DEFAULT 0,
            ordered_qty REAL NOT NULL DEFAULT 0.0,
            supply_qty REAL NOT NULL DEFAULT 0.0,
            packed_qty REAL NOT NULL DEFAULT 0.0,
            dispatched_qty REAL NOT NULL DEFAULT 0.0,
            delivered_qty REAL NOT NULL DEFAULT 0.0,
            return_qty REAL NOT NULL DEFAULT 0.0,
            returned_qty REAL NOT NULL DEFAULT 0.0,
            damaged_qty REAL NOT NULL DEFAULT 0.0,
            billed_qty REAL NOT NULL DEFAULT 0.0,
            bonus_qty REAL NOT NULL DEFAULT 0.0,
            gross_amount REAL NOT NULL DEFAULT 0.0,
            offer_discount_amount REAL NOT NULL DEFAULT 0.0,
            party_discount_amount REAL NOT NULL DEFAULT 0.0,
            discount_amount REAL NOT NULL DEFAULT 0.0,
            supply_amount REAL NOT NULL DEFAULT 0.0,
            return_amount REAL NOT NULL DEFAULT 0.0,
            net_billable_amount REAL NOT NULL DEFAULT 0.0,
            billed_amount REAL NOT NULL DEFAULT 0.0,
            final_bill_amount REAL NOT NULL DEFAULT 0.0,
            recovered_amount REAL NOT NULL DEFAULT 0.0,
            packing_status TEXT NOT NULL DEFAULT 'Pending',
            delivery_status TEXT NOT NULL DEFAULT 'Pending',
            supply_status TEXT NOT NULL DEFAULT 'Packing Pending',
            final_sale_id INTEGER DEFAULT NULL,
            final_invoice_number TEXT DEFAULT NULL,
            stock_deducted INTEGER NOT NULL DEFAULT 0,
            remarks TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (town_supply_id) REFERENCES town_supplies (id) ON DELETE CASCADE,
            FOREIGN KEY (party_account_id) REFERENCES accounts (id) ON DELETE RESTRICT
          );

          CREATE TABLE party_supply_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            party_supply_id INTEGER NOT NULL,
            town_supply_id INTEGER NOT NULL,
            supply_number TEXT DEFAULT '',
            party_account_id INTEGER NOT NULL,
            party_name TEXT NOT NULL,
            booking_id INTEGER DEFAULT NULL,
            booking_item_id INTEGER DEFAULT NULL,
            booking_number TEXT DEFAULT '',
            s_no INTEGER NOT NULL DEFAULT 1,
            item_id INTEGER NOT NULL,
            inventory_id INTEGER DEFAULT NULL,
            batch_number TEXT DEFAULT '',
            expiry_date TEXT DEFAULT '',
            fifo_batches_json TEXT DEFAULT '[]',
            item_code TEXT NOT NULL,
            company_name TEXT NOT NULL,
            item_name TEXT NOT NULL,
            packing TEXT DEFAULT '1x1',
            ordered_quantity REAL NOT NULL DEFAULT 0.0,
            ordered_qty REAL NOT NULL DEFAULT 0.0,
            supply_quantity REAL NOT NULL DEFAULT 0.0,
            supply_qty REAL NOT NULL DEFAULT 0.0,
            bonus_quantity REAL NOT NULL DEFAULT 0.0,
            bonus_qty REAL NOT NULL DEFAULT 0.0,
            packed_quantity REAL NOT NULL DEFAULT 0.0,
            packed_qty REAL NOT NULL DEFAULT 0.0,
            remaining_pack_quantity REAL NOT NULL DEFAULT 0.0,
            remaining_pack_qty REAL NOT NULL DEFAULT 0.0,
            packing_status TEXT NOT NULL DEFAULT 'Pending',
            reserved_qty REAL NOT NULL DEFAULT 0.0,
            dispatched_qty REAL NOT NULL DEFAULT 0.0,
            delivered_qty REAL NOT NULL DEFAULT 0.0,
            returned_quantity REAL NOT NULL DEFAULT 0.0,
            returned_qty REAL NOT NULL DEFAULT 0.0,
            accepted_return_qty REAL NOT NULL DEFAULT 0.0,
            damaged_return_qty REAL NOT NULL DEFAULT 0.0,
            billed_quantity REAL NOT NULL DEFAULT 0.0,
            billed_qty REAL NOT NULL DEFAULT 0.0,
            net_billable_qty REAL NOT NULL DEFAULT 0.0,
            pending_bill_qty REAL NOT NULL DEFAULT 0.0,
            trade_price REAL NOT NULL DEFAULT 0.0,
            offer_id INTEGER DEFAULT NULL,
            offer_name TEXT DEFAULT '',
            offer_discount_percent REAL NOT NULL DEFAULT 0.0,
            offer_discount_amount REAL NOT NULL DEFAULT 0.0,
            party_discount_id INTEGER DEFAULT NULL,
            party_discount_percent REAL NOT NULL DEFAULT 0.0,
            party_discount_amount REAL NOT NULL DEFAULT 0.0,
            discount_percent REAL NOT NULL DEFAULT 0.0,
            discount_amount REAL NOT NULL DEFAULT 0.0,
            amount REAL NOT NULL DEFAULT 0.0,
            return_amount REAL NOT NULL DEFAULT 0.0,
            net_billable_amount REAL NOT NULL DEFAULT 0.0,
            final_billed_amount REAL NOT NULL DEFAULT 0.0,
            manual_override_reason TEXT DEFAULT '',
            remarks TEXT DEFAULT '',
            FOREIGN KEY (party_supply_id) REFERENCES party_supplies (id) ON DELETE CASCADE,
            FOREIGN KEY (town_supply_id) REFERENCES town_supplies (id) ON DELETE CASCADE
          );

          CREATE TABLE supply_dispatches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dispatch_number TEXT NOT NULL UNIQUE,
            town_supply_id INTEGER NOT NULL,
            supply_number TEXT NOT NULL,
            dispatch_date TEXT NOT NULL,
            salesman_id INTEGER,
            salesman_name TEXT NOT NULL DEFAULT '',
            town_id INTEGER,
            town_name TEXT NOT NULL DEFAULT '',
            vehicle_number TEXT NOT NULL DEFAULT '',
            vehicle_van TEXT NOT NULL DEFAULT '',
            driver_name TEXT NOT NULL DEFAULT '',
            driver_phone TEXT NOT NULL DEFAULT '',
            delivery_person TEXT NOT NULL DEFAULT '',
            total_parties INTEGER NOT NULL DEFAULT 0,
            total_items INTEGER NOT NULL DEFAULT 0,
            total_packed_qty REAL NOT NULL DEFAULT 0.0,
            total_dispatched_qty REAL NOT NULL DEFAULT 0.0,
            total_bonus_qty REAL NOT NULL DEFAULT 0.0,
            total_quantity REAL NOT NULL DEFAULT 0.0,
            total_dispatch_amount REAL NOT NULL DEFAULT 0.0,
            total_amount REAL NOT NULL DEFAULT 0.0,
            delivery_status TEXT NOT NULL DEFAULT 'Dispatched',
            status TEXT NOT NULL DEFAULT 'Dispatched',
            dispatched_by TEXT DEFAULT 'Super Admin',
            remarks TEXT DEFAULT '',
            created_by TEXT DEFAULT 'Super Admin',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (town_supply_id) REFERENCES town_supplies (id) ON DELETE CASCADE
          );

          CREATE TABLE supply_dispatch_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dispatch_id INTEGER NOT NULL,
            town_supply_id INTEGER NOT NULL,
            party_supply_id INTEGER NOT NULL,
            party_supply_item_id INTEGER NOT NULL,
            supply_number TEXT DEFAULT '',
            party_account_id INTEGER NOT NULL,
            party_name TEXT NOT NULL,
            s_no INTEGER NOT NULL DEFAULT 1,
            item_id INTEGER NOT NULL,
            inventory_id INTEGER DEFAULT NULL,
            batch_number TEXT DEFAULT '',
            expiry_date TEXT DEFAULT '',
            item_code TEXT NOT NULL,
            company_name TEXT NOT NULL,
            item_name TEXT NOT NULL,
            packing TEXT DEFAULT '1x1',
            ordered_quantity REAL NOT NULL DEFAULT 0.0,
            packed_quantity REAL NOT NULL DEFAULT 0.0,
            packed_qty REAL NOT NULL DEFAULT 0.0,
            dispatched_quantity REAL NOT NULL DEFAULT 0.0,
            dispatched_qty REAL NOT NULL DEFAULT 0.0,
            delivered_qty REAL NOT NULL DEFAULT 0.0,
            pending_qty REAL NOT NULL DEFAULT 0.0,
            bonus_quantity REAL NOT NULL DEFAULT 0.0,
            bonus_qty REAL NOT NULL DEFAULT 0.0,
            trade_price REAL NOT NULL DEFAULT 0.0,
            discount_percent REAL NOT NULL DEFAULT 0.0,
            discount_amount REAL NOT NULL DEFAULT 0.0,
            amount REAL NOT NULL DEFAULT 0.0,
            delivery_status TEXT NOT NULL DEFAULT 'Dispatched',
            FOREIGN KEY (dispatch_id) REFERENCES supply_dispatches (id) ON DELETE CASCADE
          );

          CREATE TABLE supply_returns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            return_number TEXT NOT NULL UNIQUE,
            return_date TEXT NOT NULL,
            town_supply_id INTEGER NOT NULL,
            supply_number TEXT NOT NULL,
            party_supply_id INTEGER DEFAULT NULL,
            salesman_id INTEGER,
            salesman_name TEXT NOT NULL DEFAULT '',
            town_id INTEGER,
            town_name TEXT NOT NULL DEFAULT '',
            party_account_id INTEGER,
            party_name TEXT DEFAULT '',
            total_returned_qty REAL NOT NULL DEFAULT 0.0,
            total_accepted_qty REAL NOT NULL DEFAULT 0.0,
            total_damaged_qty REAL NOT NULL DEFAULT 0.0,
            total_return_amount REAL NOT NULL DEFAULT 0.0,
            stock_restored INTEGER NOT NULL DEFAULT 1,
            remarks TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'Completed',
            created_by TEXT DEFAULT 'Super Admin',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (town_supply_id) REFERENCES town_supplies (id) ON DELETE CASCADE
          );

          CREATE TABLE supply_return_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supply_return_id INTEGER NOT NULL,
            town_supply_id INTEGER NOT NULL,
            party_supply_id INTEGER NOT NULL,
            party_supply_item_id INTEGER NOT NULL,
            party_account_id INTEGER NOT NULL,
            party_name TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            inventory_id INTEGER DEFAULT NULL,
            batch_number TEXT DEFAULT '',
            item_code TEXT NOT NULL,
            company_name TEXT NOT NULL,
            item_name TEXT NOT NULL,
            packing TEXT DEFAULT '1x1',
            supplied_quantity REAL NOT NULL DEFAULT 0.0,
            supplied_qty REAL NOT NULL DEFAULT 0.0,
            previously_returned_qty REAL NOT NULL DEFAULT 0.0,
            new_return_quantity REAL NOT NULL DEFAULT 0.0,
            new_return_qty REAL NOT NULL DEFAULT 0.0,
            accepted_quantity REAL NOT NULL DEFAULT 0.0,
            accepted_qty REAL NOT NULL DEFAULT 0.0,
            damaged_quantity REAL NOT NULL DEFAULT 0.0,
            damaged_qty REAL NOT NULL DEFAULT 0.0,
            return_reason TEXT DEFAULT '',
            trade_price REAL NOT NULL DEFAULT 0.0,
            discount_percent REAL NOT NULL DEFAULT 0.0,
            return_amount REAL NOT NULL DEFAULT 0.0,
            FOREIGN KEY (supply_return_id) REFERENCES supply_returns (id) ON DELETE CASCADE
          );

          CREATE TABLE supply_recoveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            receipt_number TEXT NOT NULL UNIQUE,
            recovery_date TEXT NOT NULL,
            salesman_id INTEGER,
            salesman_name TEXT NOT NULL DEFAULT '',
            town_id INTEGER,
            town_name TEXT NOT NULL DEFAULT '',
            area_id INTEGER,
            area_name TEXT DEFAULT '',
            party_account_id INTEGER NOT NULL,
            party_code TEXT DEFAULT '',
            party_name TEXT NOT NULL,
            town_supply_id INTEGER DEFAULT NULL,
            party_supply_id INTEGER DEFAULT NULL,
            supply_number TEXT DEFAULT '',
            sale_id INTEGER DEFAULT NULL,
            invoice_number TEXT DEFAULT '',
            invoice_amount REAL NOT NULL DEFAULT 0.0,
            previous_outstanding REAL NOT NULL DEFAULT 0.0,
            recovery_amount REAL NOT NULL DEFAULT 0.0,
            remaining_balance REAL NOT NULL DEFAULT 0.0,
            payment_method TEXT NOT NULL DEFAULT 'Cash',
            financial_account_id INTEGER,
            financial_account_name TEXT NOT NULL DEFAULT '',
            journal_entry_id INTEGER DEFAULT NULL,
            payment_voucher_id INTEGER DEFAULT NULL,
            cash_book_voucher_id INTEGER DEFAULT NULL,
            settlement_id INTEGER DEFAULT NULL,
            is_settled INTEGER NOT NULL DEFAULT 0,
            remarks TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'Posted',
            created_by TEXT DEFAULT 'Super Admin',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (party_account_id) REFERENCES accounts (id) ON DELETE RESTRICT
          );

          CREATE TABLE salesman_settlements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            settlement_number TEXT NOT NULL UNIQUE,
            settlement_date TEXT NOT NULL,
            from_date TEXT DEFAULT '',
            to_date TEXT DEFAULT '',
            salesman_id INTEGER NOT NULL,
            salesman_code TEXT DEFAULT '',
            salesman_name TEXT NOT NULL,
            town_id INTEGER DEFAULT NULL,
            town_name TEXT DEFAULT '',
            town_supply_id INTEGER DEFAULT NULL,
            supply_number TEXT DEFAULT '',
            total_supplies REAL NOT NULL DEFAULT 0.0,
            total_returns REAL NOT NULL DEFAULT 0.0,
            total_final_billing REAL NOT NULL DEFAULT 0.0,
            total_cash_collected REAL NOT NULL DEFAULT 0.0,
            total_bank_collections REAL NOT NULL DEFAULT 0.0,
            total_outstanding REAL NOT NULL DEFAULT 0.0,
            expenses_amount REAL NOT NULL DEFAULT 0.0,
            short_cash_amount REAL NOT NULL DEFAULT 0.0,
            final_handover_amount REAL NOT NULL DEFAULT 0.0,
            cash_submitted_to_store REAL NOT NULL DEFAULT 0.0,
            remaining_cash_in_hand REAL NOT NULL DEFAULT 0.0,
            difference REAL NOT NULL DEFAULT 0.0,
            financial_account_id INTEGER DEFAULT NULL,
            financial_account_name TEXT DEFAULT '',
            journal_entry_id INTEGER DEFAULT NULL,
            cash_book_voucher_id INTEGER DEFAULT NULL,
            remarks TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'Completed',
            created_by TEXT DEFAULT 'Super Admin',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salesman_id) REFERENCES salesmen (id) ON DELETE RESTRICT
          );
        `);
      }

      // Create New Enhancement Tables: FIFO Movements, Trade Offers, Party Discounts, Mobile Booking Imports, Verification Codes, Protected Audit Logs
      db.exec(`
        -- 11. Batch-Wise FIFO Stock Movement History
        CREATE TABLE IF NOT EXISTS batch_stock_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          movement_date TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          item_code TEXT NOT NULL DEFAULT '',
          item_name TEXT NOT NULL DEFAULT '',
          company_name TEXT NOT NULL DEFAULT '',
          inventory_id INTEGER NOT NULL,
          batch_number TEXT NOT NULL DEFAULT '',
          expiry_date TEXT NOT NULL DEFAULT '',
          purchase_date TEXT DEFAULT '',
          movement_type TEXT NOT NULL, -- 'PURCHASE_IN', 'RESERVE_PACKING', 'UNRESERVE_PACKING', 'DISPATCH_OUT', 'COUNTER_SALE_OUT', 'BONUS_OUT', 'RETURN_IN_SALEABLE', 'RETURN_DAMAGED', 'BATCH_ADJUSTMENT', 'BATCH_BLOCK', 'BATCH_UNBLOCK'
          reference_type TEXT NOT NULL DEFAULT '', -- 'PURCHASE', 'SALE', 'SUPPLY_PACK', 'SUPPLY_DISPATCH', 'SUPPLY_RETURN', 'SALE_RETURN', 'ADJUSTMENT'
          reference_id INTEGER DEFAULT NULL,
          reference_number TEXT DEFAULT '',
          party_account_id INTEGER DEFAULT NULL,
          party_name TEXT DEFAULT '',
          salesman_id INTEGER DEFAULT NULL,
          salesman_name TEXT DEFAULT '',
          town_name TEXT DEFAULT '',
          quantity_packs REAL NOT NULL DEFAULT 0.0,
          bonus_packs REAL NOT NULL DEFAULT 0.0,
          total_units REAL NOT NULL DEFAULT 0.0,
          purchase_rate REAL NOT NULL DEFAULT 0.0,
          trade_price REAL NOT NULL DEFAULT 0.0,
          balance_after_packs REAL NOT NULL DEFAULT 0.0,
          remarks TEXT DEFAULT '',
          performed_by TEXT NOT NULL DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_batch_mov_item ON batch_stock_movements(item_id);
        CREATE INDEX IF NOT EXISTS idx_batch_mov_inv ON batch_stock_movements(inventory_id);
        CREATE INDEX IF NOT EXISTS idx_batch_mov_batch ON batch_stock_movements(batch_number);
        CREATE INDEX IF NOT EXISTS idx_batch_mov_date ON batch_stock_movements(movement_date);

        -- 12. Trade Deals & Offers Management
        CREATE TABLE IF NOT EXISTS trade_offers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          offer_code TEXT NOT NULL UNIQUE,
          offer_name TEXT NOT NULL,
          offer_type TEXT NOT NULL DEFAULT 'percentage_discount', -- 'percentage_discount', 'bonus_quantity', 'fixed_discount', 'slab_based'
          scope_type TEXT NOT NULL DEFAULT 'item', -- 'all_items', 'company', 'item'
          company_name TEXT DEFAULT '',
          item_id INTEGER DEFAULT NULL,
          item_code TEXT DEFAULT '',
          item_name TEXT DEFAULT '',
          town_id INTEGER DEFAULT NULL,
          town_name TEXT DEFAULT '',
          party_account_id INTEGER DEFAULT NULL,
          party_name TEXT DEFAULT '',
          salesman_id INTEGER DEFAULT NULL,
          salesman_name TEXT DEFAULT '',
          min_quantity REAL NOT NULL DEFAULT 1.0,
          max_quantity REAL DEFAULT NULL,
          discount_percent REAL NOT NULL DEFAULT 0.0,
          fixed_discount_amount REAL NOT NULL DEFAULT 0.0,
          bonus_quantity REAL NOT NULL DEFAULT 0.0,
          bonus_item_id INTEGER DEFAULT NULL,
          bonus_item_code TEXT DEFAULT '',
          bonus_item_name TEXT DEFAULT '',
          slabs_json TEXT NOT NULL DEFAULT '[]', -- Array of { min_qty, max_qty, discount_percent, fixed_discount_amount, bonus_quantity, bonus_item_id, bonus_item_name }
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Active', -- 'Active', 'Inactive'
          remarks TEXT DEFAULT '',
          created_by TEXT DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_trade_offers_item ON trade_offers(item_id);
        CREATE INDEX IF NOT EXISTS idx_trade_offers_company ON trade_offers(company_name);
        CREATE INDEX IF NOT EXISTS idx_trade_offers_dates ON trade_offers(start_date, end_date);

        -- 13. Party-Wise Special Discounts Management
        CREATE TABLE IF NOT EXISTS party_discounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discount_code TEXT NOT NULL UNIQUE,
          party_account_id INTEGER NOT NULL,
          party_name TEXT NOT NULL,
          scope_type TEXT NOT NULL DEFAULT 'item', -- 'all_items', 'company', 'item'
          company_name TEXT DEFAULT '',
          item_id INTEGER DEFAULT NULL,
          item_code TEXT DEFAULT '',
          item_name TEXT DEFAULT '',
          discount_percent REAL NOT NULL DEFAULT 0.0,
          fixed_discount_amount REAL NOT NULL DEFAULT 0.0,
          start_date TEXT DEFAULT '',
          end_date TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'Active', -- 'Active', 'Inactive'
          remarks TEXT DEFAULT '',
          created_by TEXT DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (party_account_id) REFERENCES accounts (id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_party_discounts_party ON party_discounts(party_account_id);
        CREATE INDEX IF NOT EXISTS idx_party_discounts_item ON party_discounts(item_id);

        CREATE TABLE IF NOT EXISTS party_discount_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          party_discount_id INTEGER NOT NULL,
          discount_code TEXT NOT NULL,
          action TEXT NOT NULL, -- 'CREATED', 'UPDATED', 'DEACTIVATED', 'ACTIVATED'
          old_values_json TEXT DEFAULT '{}',
          new_values_json TEXT DEFAULT '{}',
          performed_by TEXT NOT NULL DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- 14. Salesman Mobile Booking Import Batches & History
        CREATE TABLE IF NOT EXISTS mobile_booking_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          import_batch_number TEXT NOT NULL UNIQUE,
          file_name TEXT NOT NULL DEFAULT '',
          file_hash TEXT NOT NULL DEFAULT '',
          salesman_id INTEGER DEFAULT NULL,
          salesman_name TEXT NOT NULL DEFAULT '',
          total_bookings_in_file INTEGER NOT NULL DEFAULT 0,
          valid_bookings_count INTEGER NOT NULL DEFAULT 0,
          duplicate_bookings_count INTEGER NOT NULL DEFAULT 0,
          invalid_bookings_count INTEGER NOT NULL DEFAULT 0,
          imported_booking_ids_json TEXT NOT NULL DEFAULT '[]',
          imported_booking_numbers TEXT NOT NULL DEFAULT '',
          generated_supply_ids_json TEXT NOT NULL DEFAULT '[]',
          generated_supply_numbers TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'Imported', -- 'Imported', 'Supply Generated'
          remarks TEXT DEFAULT '',
          imported_by TEXT NOT NULL DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- 15. One-Time Security Verification Codes (Master Reset & Local Restore)
        CREATE TABLE IF NOT EXISTS security_verification_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          purpose TEXT NOT NULL, -- 'MASTER_RESET_TRANSACTIONS', 'MASTER_RESET_COMPLETE', 'LOCAL_RESTORE'
          code_hash TEXT NOT NULL,
          target_email TEXT NOT NULL,
          expires_at DATETIME NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          locked_until DATETIME DEFAULT NULL,
          used INTEGER NOT NULL DEFAULT 0,
          used_at DATETIME DEFAULT NULL,
          created_by TEXT NOT NULL DEFAULT 'Super Admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- 16. Protected Immutable Audit Logs (NEVER deleted by Master Reset)
        CREATE TABLE IF NOT EXISTS protected_audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER DEFAULT NULL,
          username TEXT NOT NULL DEFAULT 'Super Admin',
          user_role TEXT NOT NULL DEFAULT 'Super Admin',
          action TEXT NOT NULL,
          module TEXT NOT NULL DEFAULT 'SYSTEM',
          record_reference TEXT DEFAULT '',
          old_value_json TEXT DEFAULT '',
          new_value_json TEXT DEFAULT '',
          result TEXT NOT NULL DEFAULT 'SUCCESS',
          ip_address TEXT DEFAULT '',
          details TEXT DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_protected_audit_action ON protected_audit_logs(action);
        CREATE INDEX IF NOT EXISTS idx_protected_audit_module ON protected_audit_logs(module);
        CREATE INDEX IF NOT EXISTS idx_protected_audit_created ON protected_audit_logs(created_at);
      `);

      db.prepare('INSERT INTO database_migrations (migration_name, batch) VALUES (?, ?)').run(migrationName20, 20);
    }
  });

  try {
    executeMigration();

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
      )
      .all() as Array<{ name: string }>;

    const migrationsAfter = Number(
      (db.prepare('SELECT COUNT(*) as c FROM database_migrations').get() as { c: number })?.c || 0
    );
    const newlyAppliedCount = Math.max(0, migrationsAfter - migrationsBefore);

    return {
      success: true,
      appliedMigration: `${migrationName1}, ${migrationName2}, ${migrationName3}, ${migrationName4}, ${migrationName5}, ${migrationName6}, ${migrationName7}, ${migrationName8}, ${migrationName9}, ${migrationName10}, ${migrationName11}, ${migrationName12}, ${migrationName13}, ${migrationName14}, ${migrationName15}, ${migrationName16}, ${migrationName17}, ${migrationName18}, ${migrationName19}, ${migrationName20}`,
      tablesVerified: tables.length,
      newlyAppliedCount,
      message: `Successfully verified schema (${newlyAppliedCount} new migration(s) applied). ${tables.length} tables verified.`,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Migration failure: ${errorMsg}`);
  }
}
