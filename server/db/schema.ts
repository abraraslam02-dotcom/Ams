/**
 * Abrar Medical Store (AMS) - Database Schema Definitions
 *
 * Strict compliance with foundation and Task 2-4 guidelines:
 * - Table schemas for all architectural domains + Advance Tax & Double-Entry Accounting.
 * - Enforces relational integrity, foreign keys, timestamps, and indexes.
 */

export const SCHEMA_SQL = `
-- 1. Company Settings (Store Profile, Currency, Timezone, Drug License)
CREATE TABLE IF NOT EXISTS company_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_name TEXT NOT NULL DEFAULT 'Abrar Medical Store',
    legal_name TEXT DEFAULT 'Abrar Medical Store (Pvt) Ltd',
    drug_license_number TEXT DEFAULT 'DL-PK-LHR-2026-0891',
    ntn_tax_number TEXT DEFAULT 'NTN-PK-9812450-7',
    address TEXT DEFAULT 'Main Market, Lahore, Punjab, Pakistan',
    phone TEXT DEFAULT '+92 42 35789000',
    mobile TEXT DEFAULT '+92 300 1234567',
    email TEXT DEFAULT 'contact@abrarmedical.pk',
    default_currency TEXT NOT NULL DEFAULT 'PKR',
    currency_symbol TEXT NOT NULL DEFAULT 'Rs.',
    default_timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
    timezone_offset TEXT NOT NULL DEFAULT '+05:00',
    default_language TEXT NOT NULL DEFAULT 'en',
    invoice_footer_note TEXT DEFAULT 'Medicines once sold will only be replaced or returned within 3 days with original bill.',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users (Authentication, Staff Roles & Security Controls)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
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

-- 2a. User Active Sessions (Server-side Session Tokens with Expiry)
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at DATETIME NOT NULL,
    remember_me INTEGER NOT NULL DEFAULT 0 CHECK(remember_me IN (0, 1)),
    last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 2b. Role Permissions (Module-Level Access Rights Matrix)
CREATE TABLE IF NOT EXISTS role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    module_key TEXT NOT NULL,
    can_view INTEGER NOT NULL DEFAULT 1 CHECK(can_view IN (0, 1)),
    can_create INTEGER NOT NULL DEFAULT 0 CHECK(can_create IN (0, 1)),
    can_edit INTEGER NOT NULL DEFAULT 0 CHECK(can_edit IN (0, 1)),
    can_delete INTEGER NOT NULL DEFAULT 0 CHECK(can_delete IN (0, 1)),
    can_export INTEGER NOT NULL DEFAULT 0 CHECK(can_export IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role, module_key)
);

-- 2c. Authentication & Security Audit Logs
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'FAILED', 'WARNING', 'INFO')),
    ip_address TEXT,
    user_agent TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Items (Items Master - Simplified & Finalized)
CREATE TABLE IF NOT EXISTS items (
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

-- 4. Accounts (Hierarchical Chart of Accounts, Party, Financial, Income & Expense + Supplier Tax Settings)
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_code TEXT NOT NULL UNIQUE,
    account_name TEXT NOT NULL,
    main_group TEXT NOT NULL CHECK(main_group IN ('PARTY ACCOUNTS', 'FINANCIAL ACCOUNTS', 'INCOME & EXPENSE ACCOUNTS')),
    account_group TEXT NOT NULL,
    account_type TEXT NOT NULL DEFAULT '',
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
    FOREIGN KEY (parent_account_id) REFERENCES accounts (id) ON DELETE RESTRICT
);

-- 4a. Account Sequences (Universal Automatic Account Code Generator)
CREATE TABLE IF NOT EXISTS account_sequences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prefix TEXT NOT NULL UNIQUE,
    account_type TEXT NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_account_sequences_prefix ON account_sequences(prefix);

-- 4b. Account Code History & Audit (Strictly prevents reuse of deleted account numbers)
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

-- 5. Inventory (Batch-wise Stock, Manufacturing & Expiry Date, Box/Strip/Loose Conversions)
CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    batch_number TEXT NOT NULL,
    manufacturing_date TEXT,
    expiry_date TEXT NOT NULL,
    packing TEXT NOT NULL DEFAULT '1x1',
    strips_per_box INTEGER NOT NULL DEFAULT 1,
    units_per_strip INTEGER NOT NULL DEFAULT 1,
    units_per_pack INTEGER NOT NULL DEFAULT 1,
    cost_price REAL NOT NULL DEFAULT 0.0,
    trade_price REAL NOT NULL DEFAULT 0.0,
    wholesale_price REAL NOT NULL DEFAULT 0.0,
    retail_price REAL NOT NULL DEFAULT 0.0,
    pack_cost REAL NOT NULL DEFAULT 0.0,
    pack_retail REAL NOT NULL DEFAULT 0.0,
    purchased_qty REAL NOT NULL DEFAULT 0.0,
    bonus_qty REAL NOT NULL DEFAULT 0.0,
    returned_qty REAL NOT NULL DEFAULT 0.0,
    sold_qty REAL NOT NULL DEFAULT 0.0,
    current_pack_qty REAL NOT NULL DEFAULT 0.0,
    current_strip_qty REAL NOT NULL DEFAULT 0.0,
    current_loose_qty REAL NOT NULL DEFAULT 0.0,
    total_stock_units REAL NOT NULL DEFAULT 0.0,
    rack_shelf TEXT,
    last_purchase_id INTEGER,
    last_supplier_id INTEGER,
    status TEXT NOT NULL DEFAULT 'in_stock' CHECK(status IN ('in_stock', 'low_stock', 'out_of_stock', 'expired')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE RESTRICT,
    UNIQUE(item_id, batch_number)
);

-- 6. Sales (Professional Pharmacy POS & Wholesale Invoice Headers)
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    invoice_date TEXT NOT NULL,
    customer_account_id INTEGER,
    customer_name TEXT NOT NULL DEFAULT 'Walk-in Cash Customer',
    customer_filer_status TEXT NOT NULL DEFAULT 'Non-Filer' CHECK(customer_filer_status IN ('Filer', 'Non-Filer', 'Exempt')),
    salesman TEXT NOT NULL DEFAULT 'Counter Pharmacist',
    invoice_type TEXT NOT NULL DEFAULT 'Retail' CHECK(invoice_type IN ('Retail', 'Wholesale')),
    payment_mode TEXT NOT NULL DEFAULT 'Cash' CHECK(payment_mode IN ('Cash', 'Credit', 'Partial', 'Bank')),
    payment_account_id INTEGER,
    gross_total REAL NOT NULL DEFAULT 0.0,
    item_discount_amount REAL NOT NULL DEFAULT 0.0,
    invoice_discount_percent REAL NOT NULL DEFAULT 0.0,
    invoice_discount_amount REAL NOT NULL DEFAULT 0.0,
    discount_override_by TEXT,
    discount_override_reason TEXT,
    discount_amount REAL NOT NULL DEFAULT 0.0,
    taxable_amount REAL NOT NULL DEFAULT 0.0,
    gst_amount REAL NOT NULL DEFAULT 0.0,
    advance_tax_applicable INTEGER NOT NULL DEFAULT 0 CHECK(advance_tax_applicable IN (0, 1)),
    advance_tax_rate REAL NOT NULL DEFAULT 0.0,
    advance_tax_amount REAL NOT NULL DEFAULT 0.0,
    is_tax_overridden INTEGER NOT NULL DEFAULT 0 CHECK(is_tax_overridden IN (0, 1)),
    tax_override_reason TEXT,
    tax_override_authorized_by TEXT,
    tax_amount REAL NOT NULL DEFAULT 0.0,
    net_total REAL NOT NULL DEFAULT 0.0,
    previous_customer_balance REAL NOT NULL DEFAULT 0.0,
    previous_balance_type TEXT NOT NULL DEFAULT 'Debit',
    total_receivable REAL NOT NULL DEFAULT 0.0,
    paid_amount REAL NOT NULL DEFAULT 0.0,
    balance_amount REAL NOT NULL DEFAULT 0.0,
    allow_negative_stock INTEGER NOT NULL DEFAULT 0 CHECK(allow_negative_stock IN (0, 1)),
    journal_entry_id INTEGER,
    payment_journal_entry_id INTEGER,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('draft', 'held', 'completed', 'cancelled')),
    created_by_user_id INTEGER,
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_account_id) REFERENCES accounts (id) ON DELETE SET NULL,
    FOREIGN KEY (payment_account_id) REFERENCES accounts (id) ON DELETE SET NULL,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- 7. Sale Items (14-Column Datasheet Invoice Lines with Full Box & Loose Unit Support)
CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    inventory_id INTEGER,
    item_code TEXT NOT NULL,
    company_name TEXT NOT NULL DEFAULT '',
    item_name TEXT NOT NULL,
    packing TEXT NOT NULL DEFAULT '1x1',
    units_per_pack INTEGER NOT NULL DEFAULT 1,
    batch_number TEXT NOT NULL DEFAULT 'DEFAULT-BATCH',
    expiry_date TEXT NOT NULL DEFAULT '2028-12-31',
    available_stock_packs REAL NOT NULL DEFAULT 0.0,
    available_stock_units REAL NOT NULL DEFAULT 0.0,
    quantity REAL NOT NULL DEFAULT 0.0,
    bonus_quantity REAL NOT NULL DEFAULT 0.0,
    unit_price REAL NOT NULL DEFAULT 0.0,
    discount_percent REAL NOT NULL DEFAULT 0.0,
    discount_amount REAL NOT NULL DEFAULT 0.0,
    loose_quantity REAL NOT NULL DEFAULT 0.0,
    loose_rate REAL NOT NULL DEFAULT 0.0,
    total_units REAL NOT NULL DEFAULT 0.0,
    cost_price_per_unit REAL NOT NULL DEFAULT 0.0,
    gross_amount REAL NOT NULL DEFAULT 0.0,
    taxable_amount REAL NOT NULL DEFAULT 0.0,
    tax_percent REAL NOT NULL DEFAULT 0.0,
    tax_amount REAL NOT NULL DEFAULT 0.0,
    line_total REAL NOT NULL DEFAULT 0.0,
    returned_pack_qty REAL NOT NULL DEFAULT 0.0,
    returned_loose_qty REAL NOT NULL DEFAULT 0.0,
    returned_total_units REAL NOT NULL DEFAULT 0.0,
    FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE RESTRICT,
    FOREIGN KEY (inventory_id) REFERENCES inventory (id) ON DELETE SET NULL
);

-- 8. Sale Returns (Customer Returns, Stock Restoration & Double-Entry Reversals)
CREATE TABLE IF NOT EXISTS sale_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_number TEXT NOT NULL UNIQUE,
    return_date TEXT NOT NULL,
    original_sale_id INTEGER NOT NULL,
    original_invoice_number TEXT NOT NULL,
    customer_account_id INTEGER,
    customer_name TEXT NOT NULL DEFAULT 'Walk-in Cash Customer',
    refund_mode TEXT NOT NULL DEFAULT 'Cash Refund' CHECK(refund_mode IN ('Account Adjustment', 'Cash Refund', 'Bank Refund')),
    refund_account_id INTEGER,
    gross_return_amount REAL NOT NULL DEFAULT 0.0,
    return_discount_amount REAL NOT NULL DEFAULT 0.0,
    taxable_return_amount REAL NOT NULL DEFAULT 0.0,
    gst_adjustment_amount REAL NOT NULL DEFAULT 0.0,
    advance_tax_adjustment_amount REAL NOT NULL DEFAULT 0.0,
    total_refund_amount REAL NOT NULL DEFAULT 0.0,
    return_reason TEXT,
    journal_entry_id INTEGER,
    processed_by_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('draft', 'completed', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (original_sale_id) REFERENCES sales (id) ON DELETE RESTRICT,
    FOREIGN KEY (customer_account_id) REFERENCES accounts (id) ON DELETE SET NULL,
    FOREIGN KEY (refund_account_id) REFERENCES accounts (id) ON DELETE SET NULL,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL
);

-- 9. Sale Return Items (Line items for returned medicines with Box & Loose restoration)
CREATE TABLE IF NOT EXISTS sale_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_return_id INTEGER NOT NULL,
    original_sale_item_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    inventory_id INTEGER,
    item_code TEXT NOT NULL,
    company_name TEXT NOT NULL DEFAULT '',
    item_name TEXT NOT NULL,
    packing TEXT NOT NULL DEFAULT '1x1',
    units_per_pack INTEGER NOT NULL DEFAULT 1,
    batch_number TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    sold_pack_qty REAL NOT NULL DEFAULT 0.0,
    sold_bonus_qty REAL NOT NULL DEFAULT 0.0,
    sold_loose_qty REAL NOT NULL DEFAULT 0.0,
    sold_total_units REAL NOT NULL DEFAULT 0.0,
    return_pack_qty REAL NOT NULL DEFAULT 0.0,
    return_bonus_qty REAL NOT NULL DEFAULT 0.0,
    return_loose_qty REAL NOT NULL DEFAULT 0.0,
    returned_units REAL NOT NULL DEFAULT 0.0,
    return_rate REAL NOT NULL DEFAULT 0.0,
    loose_return_rate REAL NOT NULL DEFAULT 0.0,
    discount_percent REAL NOT NULL DEFAULT 0.0,
    discount_amount REAL NOT NULL DEFAULT 0.0,
    tax_percent REAL NOT NULL DEFAULT 0.0,
    tax_amount REAL NOT NULL DEFAULT 0.0,
    line_total REAL NOT NULL DEFAULT 0.0,
    return_reason TEXT,
    restock_status TEXT NOT NULL DEFAULT 'restocked' CHECK(restock_status IN ('restocked', 'quarantine_damaged', 'expired_disposed')),
    FOREIGN KEY (sale_return_id) REFERENCES sale_returns (id) ON DELETE CASCADE,
    FOREIGN KEY (original_sale_item_id) REFERENCES sale_items (id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE RESTRICT
);

-- 10. Purchases (Supplier Purchase Invoices with Advance Tax, GST & Payment Tracking)
CREATE TABLE IF NOT EXISTS purchases (
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
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    created_by_user_id INTEGER,
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
    FOREIGN KEY (payment_account_id) REFERENCES accounts (id) ON DELETE SET NULL,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL
);

-- 11. Purchase Items (Detailed Goods Receipt with Batch, Mfg/Expiry, Bonus & Tax)
CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    inventory_id INTEGER,
    item_code TEXT NOT NULL,
    company_name TEXT NOT NULL,
    item_name TEXT NOT NULL,
    packing TEXT NOT NULL DEFAULT '1x1',
    units_per_pack INTEGER NOT NULL DEFAULT 1,
    batch_number TEXT NOT NULL,
    manufacturing_date TEXT,
    expiry_date TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0.0,
    bonus_quantity REAL NOT NULL DEFAULT 0.0,
    pack_quantity REAL NOT NULL DEFAULT 0.0,
    loose_quantity REAL NOT NULL DEFAULT 0.0,
    total_units REAL NOT NULL DEFAULT 0.0,
    purchase_rate REAL NOT NULL DEFAULT 0.0,
    mrp_rate REAL NOT NULL DEFAULT 0.0,
    gross_amount REAL NOT NULL DEFAULT 0.0,
    discount_percent REAL NOT NULL DEFAULT 0.0,
    discount_amount REAL NOT NULL DEFAULT 0.0,
    taxable_amount REAL NOT NULL DEFAULT 0.0,
    tax_percent REAL NOT NULL DEFAULT 0.0,
    tax_amount REAL NOT NULL DEFAULT 0.0,
    line_total REAL NOT NULL DEFAULT 0.0,
    returned_quantity REAL NOT NULL DEFAULT 0.0,
    FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE RESTRICT
);

-- 12. Purchase Returns (Supplier Debit Notes with Tax Adjustments)
CREATE TABLE IF NOT EXISTS purchase_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debit_note_number TEXT NOT NULL UNIQUE,
    return_date TEXT NOT NULL,
    original_purchase_id INTEGER NOT NULL,
    original_bill_number TEXT NOT NULL,
    supplier_account_id INTEGER NOT NULL,
    supplier_filer_status TEXT NOT NULL DEFAULT 'Filer',
    gross_return_amount REAL NOT NULL DEFAULT 0.0,
    return_discount_amount REAL NOT NULL DEFAULT 0.0,
    taxable_return_amount REAL NOT NULL DEFAULT 0.0,
    gst_adjustment_amount REAL NOT NULL DEFAULT 0.0,
    advance_tax_rate REAL NOT NULL DEFAULT 0.0,
    advance_tax_adjustment_amount REAL NOT NULL DEFAULT 0.0,
    total_debit_amount REAL NOT NULL DEFAULT 0.0,
    settlement_mode TEXT NOT NULL DEFAULT 'Account Adjustment' CHECK(settlement_mode IN ('Account Adjustment', 'Cash Refund', 'Bank Refund')),
    settlement_account_id INTEGER,
    return_reason TEXT NOT NULL,
    journal_entry_id INTEGER,
    processed_by_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (original_purchase_id) REFERENCES purchases (id) ON DELETE RESTRICT,
    FOREIGN KEY (supplier_account_id) REFERENCES accounts (id) ON DELETE RESTRICT
);

-- 13. Purchase Return Items
CREATE TABLE IF NOT EXISTS purchase_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_return_id INTEGER NOT NULL,
    original_purchase_item_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    inventory_id INTEGER,
    item_code TEXT NOT NULL,
    company_name TEXT NOT NULL,
    item_name TEXT NOT NULL,
    packing TEXT NOT NULL DEFAULT '1x1',
    units_per_pack INTEGER NOT NULL DEFAULT 1,
    batch_number TEXT NOT NULL,
    manufacturing_date TEXT,
    expiry_date TEXT NOT NULL,
    purchased_quantity REAL NOT NULL DEFAULT 0.0,
    return_quantity REAL NOT NULL DEFAULT 0.0,
    return_units REAL NOT NULL DEFAULT 0.0,
    debit_unit_rate REAL NOT NULL DEFAULT 0.0,
    discount_percent REAL NOT NULL DEFAULT 0.0,
    discount_amount REAL NOT NULL DEFAULT 0.0,
    taxable_amount REAL NOT NULL DEFAULT 0.0,
    tax_percent REAL NOT NULL DEFAULT 0.0,
    gst_amount REAL NOT NULL DEFAULT 0.0,
    advance_tax_rate REAL NOT NULL DEFAULT 0.0,
    advance_tax_amount REAL NOT NULL DEFAULT 0.0,
    line_total REAL NOT NULL DEFAULT 0.0,
    return_reason TEXT,
    FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns (id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE RESTRICT
);

-- 14. Double-Entry Journal Entries Header
CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_number TEXT NOT NULL UNIQUE,
    entry_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference_type TEXT NOT NULL CHECK(reference_type IN ('OPENING_BALANCE', 'SALE', 'SALE_RETURN', 'PURCHASE', 'PURCHASE_RETURN', 'VOUCHER', 'ADJUSTMENT')),
    reference_id INTEGER,
    description TEXT,
    total_debit REAL NOT NULL DEFAULT 0.0 CHECK(total_debit >= 0),
    total_credit REAL NOT NULL DEFAULT 0.0 CHECK(total_credit >= 0),
    is_balanced INTEGER NOT NULL DEFAULT 1 CHECK(is_balanced = 1 AND ROUND(total_debit, 2) = ROUND(total_credit, 2)),
    status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('draft', 'posted', 'voided')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 15. Double-Entry Journal Entry Lines (Balanced Debit & Credit Lines + Separate Customer/Supplier Sub-Ledgers)
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_entry_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    ledger_type TEXT NOT NULL DEFAULT 'general' CHECK(ledger_type IN ('general', 'customer', 'supplier')),
    debit_amount REAL NOT NULL DEFAULT 0.0 CHECK(debit_amount >= 0),
    credit_amount REAL NOT NULL DEFAULT 0.0 CHECK(credit_amount >= 0),
    narration TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT
);

-- 16. Configurable Advance Tax Settings
CREATE TABLE IF NOT EXISTS advance_tax_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tax_name TEXT NOT NULL DEFAULT 'Advance Tax u/s 236H',
    filer_rate REAL NOT NULL DEFAULT 0.5 CHECK(filer_rate >= 0),
    non_filer_rate REAL NOT NULL DEFAULT 2.5 CHECK(non_filer_rate >= 0),
    exempt_rate REAL NOT NULL DEFAULT 0.0 CHECK(exempt_rate >= 0),
    calculation_basis TEXT NOT NULL DEFAULT 'taxable_plus_gst' CHECK(calculation_basis IN ('taxable_plus_gst', 'taxable_amount', 'gross_amount')),
    effective_from TEXT NOT NULL DEFAULT '2026-01-01',
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
    tax_applicability TEXT NOT NULL DEFAULT 'All Taxable Purchases',
    updated_by TEXT DEFAULT 'Administrator',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 17. Advance Tax Rate Change Audit History
CREATE TABLE IF NOT EXISTS advance_tax_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tax_name TEXT NOT NULL,
    filer_rate REAL NOT NULL,
    non_filer_rate REAL NOT NULL,
    exempt_rate REAL NOT NULL DEFAULT 0.0,
    calculation_basis TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    status TEXT NOT NULL,
    tax_applicability TEXT NOT NULL,
    change_reason TEXT,
    changed_by TEXT DEFAULT 'Administrator',
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 18. Payment & Receipt Vouchers (Receive Payment, Customer Receipt, Cash Payment, Bank Payment)
CREATE TABLE IF NOT EXISTS payment_vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_number TEXT NOT NULL UNIQUE,
    voucher_date TEXT NOT NULL,
    voucher_type TEXT NOT NULL CHECK(voucher_type IN ('receive_payment', 'customer_receipt', 'cash_payment', 'bank_payment')),
    party_account_id INTEGER NOT NULL,
    financial_account_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0.0,
    payment_method TEXT NOT NULL DEFAULT 'Cash' CHECK(payment_method IN ('Cash', 'Bank Transfer', 'Cheque', 'Online')),
    reference_number TEXT DEFAULT '',
    description TEXT DEFAULT '',
    journal_entry_id INTEGER,
    status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (party_account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
    FOREIGN KEY (financial_account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL
);

-- 19. Database Migrations Audit Log
CREATE TABLE IF NOT EXISTS database_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_name TEXT NOT NULL UNIQUE,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    batch INTEGER NOT NULL DEFAULT 1
);

-- Performance and Relational Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_code ON items(item_code);
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(item_name);
CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_name);
CREATE INDEX IF NOT EXISTS idx_items_generic ON items(generic_name);
CREATE INDEX IF NOT EXISTS idx_inventory_item_batch ON inventory(item_id, batch_number);
CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory(expiry_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_code ON accounts(account_code);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(invoice_number);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_account_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_purchases_bill ON purchases(bill_number);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_account_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(bill_date);
CREATE INDEX IF NOT EXISTS idx_sale_returns_number ON sale_returns(return_number);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_number ON purchase_returns(debit_note_number);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_number ON payment_vouchers(voucher_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON auth_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON auth_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON auth_audit_logs(created_at);

-- 20. Stock Adjustments (Increase, Decrease, Damage, Expired, Physical Difference)
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adjustment_number TEXT NOT NULL UNIQUE,
    adjustment_date TEXT NOT NULL,
    adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('Increase', 'Decrease', 'Damage', 'Expired', 'Physical Difference', 'Correction')),
    total_items INTEGER NOT NULL DEFAULT 0,
    total_cost_impact REAL NOT NULL DEFAULT 0.0,
    journal_entry_id INTEGER,
    created_by_user_id INTEGER,
    created_by_username TEXT NOT NULL DEFAULT 'Super Admin',
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('draft', 'completed', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- 21. Stock Adjustment Items
CREATE TABLE IF NOT EXISTS stock_adjustment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adjustment_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    inventory_id INTEGER,
    item_code TEXT NOT NULL,
    item_name TEXT NOT NULL,
    company_name TEXT NOT NULL DEFAULT '',
    batch_number TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    packing TEXT NOT NULL DEFAULT '1x1',
    units_per_pack INTEGER NOT NULL DEFAULT 1,
    adjustment_mode TEXT NOT NULL CHECK(adjustment_mode IN ('Increase', 'Decrease')),
    pack_qty REAL NOT NULL DEFAULT 0.0,
    loose_qty REAL NOT NULL DEFAULT 0.0,
    total_units REAL NOT NULL DEFAULT 0.0,
    system_stock_units REAL NOT NULL DEFAULT 0.0,
    new_stock_units REAL NOT NULL DEFAULT 0.0,
    cost_price_per_unit REAL NOT NULL DEFAULT 0.0,
    total_cost REAL NOT NULL DEFAULT 0.0,
    reason_category TEXT NOT NULL CHECK(reason_category IN ('Damage', 'Expired', 'Physical Difference', 'Opening Correction', 'Supplier Bonus Correction', 'Breakage / Leakage', 'General Adjustment')),
    remarks TEXT,
    FOREIGN KEY (adjustment_id) REFERENCES stock_adjustments (id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE RESTRICT,
    FOREIGN KEY (inventory_id) REFERENCES inventory (id) ON DELETE SET NULL
);

-- 22. Stock Transfers (Rack / Shelf / Store Location Transfers)
CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_number TEXT NOT NULL UNIQUE,
    transfer_date TEXT NOT NULL,
    from_location TEXT NOT NULL,
    to_location TEXT NOT NULL,
    total_items INTEGER NOT NULL DEFAULT 0,
    total_units REAL NOT NULL DEFAULT 0.0,
    created_by_username TEXT NOT NULL DEFAULT 'Super Admin',
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('draft', 'completed', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 23. Stock Transfer Items
CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    inventory_id INTEGER,
    item_code TEXT NOT NULL,
    item_name TEXT NOT NULL,
    batch_number TEXT NOT NULL,
    pack_qty REAL NOT NULL DEFAULT 0.0,
    loose_qty REAL NOT NULL DEFAULT 0.0,
    total_units REAL NOT NULL DEFAULT 0.0,
    from_shelf TEXT,
    to_shelf TEXT,
    remarks TEXT,
    FOREIGN KEY (transfer_id) REFERENCES stock_transfers (id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE RESTRICT,
    FOREIGN KEY (inventory_id) REFERENCES inventory (id) ON DELETE SET NULL
);

-- 24. Physical Stock Verifications (Audit, Count Sheet & Variance Reconciliations)
CREATE TABLE IF NOT EXISTS physical_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verification_number TEXT NOT NULL UNIQUE,
    verification_date TEXT NOT NULL,
    verified_by TEXT NOT NULL DEFAULT 'Super Admin',
    total_items_checked INTEGER NOT NULL DEFAULT 0,
    total_discrepancies INTEGER NOT NULL DEFAULT 0,
    net_cost_discrepancy REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('draft', 'pending', 'reconciled', 'cancelled')),
    reconciled_at DATETIME,
    reconciled_by TEXT,
    adjustment_id INTEGER,
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (adjustment_id) REFERENCES stock_adjustments (id) ON DELETE SET NULL
);

-- 25. Physical Stock Verification Items
CREATE TABLE IF NOT EXISTS physical_verification_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verification_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    inventory_id INTEGER,
    item_code TEXT NOT NULL,
    item_name TEXT NOT NULL,
    company_name TEXT NOT NULL DEFAULT '',
    batch_number TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    system_units REAL NOT NULL DEFAULT 0.0,
    system_packs REAL NOT NULL DEFAULT 0.0,
    physical_units REAL NOT NULL DEFAULT 0.0,
    physical_packs REAL NOT NULL DEFAULT 0.0,
    difference_units REAL NOT NULL DEFAULT 0.0,
    difference_packs REAL NOT NULL DEFAULT 0.0,
    cost_price_per_unit REAL NOT NULL DEFAULT 0.0,
    discrepancy_cost REAL NOT NULL DEFAULT 0.0,
    adjustment_reason TEXT,
    is_reconciled INTEGER NOT NULL DEFAULT 0 CHECK(is_reconciled IN (0, 1)),
    FOREIGN KEY (verification_id) REFERENCES physical_verifications (id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE RESTRICT,
    FOREIGN KEY (inventory_id) REFERENCES inventory (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_adj_number ON stock_adjustments(adjustment_number);
CREATE INDEX IF NOT EXISTS idx_stock_adj_date ON stock_adjustments(adjustment_date);
CREATE INDEX IF NOT EXISTS idx_stock_trf_number ON stock_transfers(transfer_number);
CREATE INDEX IF NOT EXISTS idx_stock_ver_number ON physical_verifications(verification_number);
CREATE INDEX IF NOT EXISTS idx_stock_ver_status ON physical_verifications(status);

-- 26. Multi-Line Accounting Vouchers (CRV, CPV, BRV, BPV, JV, Contra)
CREATE TABLE IF NOT EXISTS accounting_vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_number TEXT NOT NULL UNIQUE,
    voucher_type TEXT NOT NULL CHECK(voucher_type IN ('CRV', 'CPV', 'BRV', 'BPV', 'JV', 'CV')),
    voucher_date TEXT NOT NULL,
    reference_number TEXT DEFAULT '',
    narration TEXT DEFAULT '',
    total_debit REAL NOT NULL DEFAULT 0.0 CHECK(total_debit >= 0),
    total_credit REAL NOT NULL DEFAULT 0.0 CHECK(total_credit >= 0),
    status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('draft', 'posted', 'reversed', 'cancelled')),
    approval_status TEXT NOT NULL DEFAULT 'Approved' CHECK(approval_status IN ('Draft', 'Pending', 'Approved', 'Reversed', 'Cancelled')),
    created_by TEXT NOT NULL DEFAULT 'Super Admin',
    approved_by TEXT DEFAULT 'Super Admin',
    journal_entry_id INTEGER,
    reversal_voucher_id INTEGER,
    reversed_from_voucher_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL
);

-- 27. Multi-Line Accounting Voucher Lines
CREATE TABLE IF NOT EXISTS accounting_voucher_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    account_code TEXT NOT NULL,
    account_name TEXT NOT NULL,
    ledger_type TEXT NOT NULL DEFAULT 'general' CHECK(ledger_type IN ('general', 'customer', 'supplier')),
    debit_amount REAL NOT NULL DEFAULT 0.0 CHECK(debit_amount >= 0),
    credit_amount REAL NOT NULL DEFAULT 0.0 CHECK(credit_amount >= 0),
    description TEXT DEFAULT '',
    line_order INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (voucher_id) REFERENCES accounting_vouchers (id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT
);

-- 28. Accounting Periods (Closed Period Protection)
CREATE TABLE IF NOT EXISTS accounting_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_name TEXT NOT NULL UNIQUE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    is_closed INTEGER NOT NULL DEFAULT 0 CHECK(is_closed IN (0, 1)),
    closed_by TEXT,
    closed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_acc_vouchers_num ON accounting_vouchers(voucher_number);
CREATE INDEX IF NOT EXISTS idx_acc_vouchers_type ON accounting_vouchers(voucher_type);
CREATE INDEX IF NOT EXISTS idx_acc_vouchers_date ON accounting_vouchers(voucher_date);
CREATE INDEX IF NOT EXISTS idx_acc_vouchers_status ON accounting_vouchers(status);
CREATE INDEX IF NOT EXISTS idx_acc_voucher_lines_vid ON accounting_voucher_lines(voucher_id);
CREATE INDEX IF NOT EXISTS idx_acc_voucher_lines_acc ON accounting_voucher_lines(account_id);

-- 29. Database Backup History & Integrity Verification Registry
CREATE TABLE IF NOT EXISTS backup_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    file_path TEXT NOT NULL,
    backup_type TEXT NOT NULL DEFAULT 'manual' CHECK(backup_type IN ('manual', 'daily_auto', 'pre_change', 'pre_restore_safety')),
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    integrity_status TEXT NOT NULL DEFAULT 'ok',
    tables_count INTEGER NOT NULL DEFAULT 0,
    records_summary TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'failed', 'restored', 'deleted')),
    created_by TEXT NOT NULL DEFAULT 'System',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 30. System Error & Database Operation Failure Logs
CREATE TABLE IF NOT EXISTS system_error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    severity TEXT NOT NULL DEFAULT 'ERROR' CHECK(severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    module TEXT NOT NULL DEFAULT 'system',
    operation TEXT NOT NULL,
    user_message TEXT NOT NULL,
    technical_details TEXT DEFAULT '',
    username TEXT DEFAULT 'System',
    resolved INTEGER NOT NULL DEFAULT 0 CHECK(resolved IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_backup_history_date ON backup_history(created_at);
CREATE INDEX IF NOT EXISTS idx_system_error_logs_date ON system_error_logs(created_at);

-- 31. Salesmen Master (Separate Salesman Responsibility & Commission Rules)
CREATE TABLE IF NOT EXISTS salesmen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    salesman_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    mobile TEXT DEFAULT '',
    address TEXT DEFAULT '',
    joining_date TEXT NOT NULL DEFAULT '2026-01-01',
    commission_type TEXT NOT NULL DEFAULT 'Percentage' CHECK(commission_type IN ('Percentage', 'Fixed Amount')),
    commission_rate REAL NOT NULL DEFAULT 0.0 CHECK(commission_rate >= 0),
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 32. Salesman Commission Payments (Tracks Paid vs Outstanding Commissions)
CREATE TABLE IF NOT EXISTS salesman_commission_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_number TEXT NOT NULL UNIQUE,
    salesman_id INTEGER NOT NULL,
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0.0 CHECK(amount > 0),
    payment_mode TEXT NOT NULL DEFAULT 'Cash' CHECK(payment_mode IN ('Cash', 'Bank')),
    reference_period TEXT DEFAULT '',
    remarks TEXT DEFAULT '',
    created_by TEXT DEFAULT 'Super Admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (salesman_id) REFERENCES salesmen (id) ON DELETE RESTRICT
);

-- 33. Deliverymen Master (Separate Goods Delivery Responsibility)
CREATE TABLE IF NOT EXISTS deliverymen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deliveryman_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    mobile TEXT DEFAULT '',
    address TEXT DEFAULT '',
    joining_date TEXT NOT NULL DEFAULT '2026-01-01',
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_salesmen_code ON salesmen(salesman_code);
CREATE INDEX IF NOT EXISTS idx_salesmen_status ON salesmen(status);
CREATE INDEX IF NOT EXISTS idx_deliverymen_code ON deliverymen(deliveryman_code);
CREATE INDEX IF NOT EXISTS idx_sale_items_item_sale ON sale_items(item_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_cust_status_date ON sales(customer_account_id, status, invoice_date, id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_item_pur ON purchase_items(item_id, purchase_id);

-- 34. Cash Book & Continuous Voucher Module
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
`;


export interface TableSummary {
  name: string;
  category: string;
  columnCount: number;
  rowCount: number;
  purpose: string;
}

export const MODULE_CATALOG = [
  {
    moduleKey: 'items',
    name: 'Items Master Module',
    tables: ['items'],
    purpose: 'Simplified and finalized Items Master: Item Code, Company, Item Name, Generic, Category, Packing, Barcode, Pricing (Purchase, Trade, Wholesale, Retail), Discount %, Tax %, Opening/Min Stock, Rack, Status, Excel Import/Export.',
    status: 'Finalized & Operational',
  },
  {
    moduleKey: 'accounts',
    name: 'Complete Double-Entry Accounting, Vouchers & Ledgers',
    tables: [
      'accounts',
      'journal_entries',
      'journal_entry_lines',
      'payment_vouchers',
      'accounting_vouchers',
      'accounting_voucher_lines',
      'accounting_periods',
    ],
    purpose: 'Complete 5-pillar Hierarchical Chart of Accounts (Assets, Liabilities, Capital/Equity, Income, Expenses), Multi-Line Vouchers (CRV, CPV, BRV, BPV, JV, Contra), Customer/Supplier/General Ledgers, Cash & Bank Books, Advance Tax Accounting, and 11 Financial Reports.',
    status: 'Finalized & Operational',
  },
  {
    moduleKey: 'purchases',
    name: 'Purchase Invoices & Configurable Advance Tax',
    tables: ['purchases', 'purchase_items', 'advance_tax_settings', 'advance_tax_history'],
    purpose: 'Professional Purchase Invoicing, Configurable Advance Tax (Filer 0.5%, Non-Filer 2.5%, Exempt, Rate History, Transaction Override), Payment Support (Cash, Bank, Partial, Credit), Double-Entry Posting, 8 Purchase Reports, and A4 Printing.',
    status: 'Finalized & Operational',
  },
  {
    moduleKey: 'purchase_returns',
    name: 'Purchase Returns (Debit Notes)',
    tables: ['purchase_returns', 'purchase_return_items'],
    purpose: 'Invoice-linked Supplier Purchase Returns with batch stock reduction, eligible quantity validation, GST & Advance Tax adjustments, Double-Entry reversal posting, and A4 Debit Note printing.',
    status: 'Finalized & Operational',
  },
  {
    moduleKey: 'inventory',
    name: 'Inventory Management, Stock Control & Audits',
    tables: [
      'inventory',
      'stock_adjustments',
      'stock_adjustment_items',
      'stock_transfers',
      'stock_transfer_items',
      'physical_verifications',
      'physical_verification_items',
    ],
    purpose: 'Complete professional stock control: Stock Overview, Current Stock, Batch-wise Stock Datasheet, Expiry Management (30/60/90 days), Low Stock Alerts, Stock Adjustments with Cost/Expense GL Posting, Stock Transfers, Chronological Stock Ledger with Running Balance, and Physical Stock Verification.',
    status: 'Finalized & Operational',
  },
  {
    moduleKey: 'sales',
    name: 'Sales, Billing & POS Datasheet',
    tables: ['sales', 'sale_items', 'payment_vouchers'],
    purpose: '14-column spreadsheet POS & Wholesale billing, Full Box / Strip / Loose tablet sales, Fast Item Search, Configurable Advance Tax & Customer Shortcuts, Draft & Hold Invoices, A4 & 58mm/80mm Thermal Printing, and 7 Sales Reports.',
    status: 'Finalized & Operational',
  },
  {
    moduleKey: 'sale_returns',
    name: 'Sale Returns & Stock Restoration',
    tables: ['sale_returns', 'sale_return_items'],
    purpose: 'Invoice-linked Customer Sale Returns with eligible sold quantity validation, batch stock restoration, customer balance adjustment, and Double-Entry accounting reversal.',
    status: 'Finalized & Operational',
  },
  {
    moduleKey: 'users',
    name: 'Users, Authentication & Role-Based Permissions',
    tables: ['users', 'user_sessions', 'role_permissions', 'auth_audit_logs'],
    purpose: 'Super Admin, Administrator, Accountant, Salesman, Purchase Operator, and Viewer role authentication, crypto scrypt hashing, server session tokens, lockout defense, role matrix access control, and security audit trail.',
    status: 'Finalized & Operational',
  },
  {
    moduleKey: 'company_settings',
    name: 'Company Settings',
    tables: ['company_settings'],
    purpose: 'Abrar Medical Store profile, drug license number, PKR currency rules, Asia/Karachi (UTC+5) timezone.',
    status: 'Schema Prepared & Initialized',
  },
];

