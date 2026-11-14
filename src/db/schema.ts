// src/db/schema.ts
import { relations } from 'drizzle-orm';
import {
  pgTable,
  serial,
  text,
  timestamp,
  doublePrecision,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';

// 1. Users table (PostgreSQL schema)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // External / Local User Unique Identifier
  email: text('email').notNull(),
  displayName: text('display_name'),
  role: text('role').default('operator').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 2. Medicine Items Master
export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  itemCode: text('item_code').notNull().unique(),
  itemName: text('item_name').notNull(),
  genericName: text('generic_name'),
  companyName: text('company_name').notNull(),
  category: text('category').default('Tablet'),
  packing: text('packing').default('10x10'),
  barcode: text('barcode'),
  purchasePrice: doublePrecision('purchase_price').default(0).notNull(),
  tradePrice: doublePrecision('trade_price').default(0).notNull(),
  retailPrice: doublePrecision('retail_price').default(0).notNull(),
  looseRate: doublePrecision('loose_rate').default(0).notNull(),
  openingStock: integer('opening_stock').default(0).notNull(),
  minimumStock: integer('minimum_stock').default(10).notNull(),
  rackNumber: text('rack_number'),
  status: text('status').default('Active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 3. Sales Invoices
export const salesInvoices = pgTable('sales_invoices', {
  id: serial('id').primaryKey(),
  invoiceNumber: text('invoice_number').notNull().unique(),
  userId: integer('user_id').references(() => users.id),
  customerName: text('customer_name').default('Walking Customer'),
  totalAmount: doublePrecision('total_amount').default(0).notNull(),
  discountAmount: doublePrecision('discount_amount').default(0).notNull(),
  taxAmount: doublePrecision('tax_amount').default(0).notNull(),
  netAmount: doublePrecision('net_amount').default(0).notNull(),
  paidAmount: doublePrecision('paid_amount').default(0).notNull(),
  balanceAmount: doublePrecision('balance_amount').default(0).notNull(),
  paymentMethod: text('payment_method').default('Cash').notNull(),
  invoiceDate: text('invoice_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 4. Sales Invoice Items
export const salesInvoiceItems = pgTable('sales_invoice_items', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id')
    .references(() => salesInvoices.id, { onDelete: 'cascade' })
    .notNull(),
  itemId: integer('item_id').references(() => items.id),
  itemCode: text('item_code').notNull(),
  itemName: text('item_name').notNull(),
  batchNumber: text('batch_number'),
  expiryDate: text('expiry_date'),
  packQuantity: integer('pack_quantity').default(0).notNull(),
  looseQuantity: integer('loose_quantity').default(0).notNull(),
  unitPrice: doublePrecision('unit_price').default(0).notNull(),
  looseRate: doublePrecision('loose_rate').default(0).notNull(),
  discountPercent: doublePrecision('discount_percent').default(0).notNull(),
  totalAmount: doublePrecision('total_amount').default(0).notNull(),
});

// 5. System Settings
export const systemSettings = pgTable('system_settings', {
  id: serial('id').primaryKey(),
  storeName: text('store_name').default('ABRAR MEDICAL STORE').notNull(),
  legalName: text('legal_name').default('Retail & Wholesale Chemists & Pharmacists'),
  drugLicenseNumber: text('drug_license_number').default('DL-PK-LHR-2026-0891'),
  ntnTaxNumber: text('ntn_tax_number').default('NTN-PK-9812450-7'),
  address: text('address').default('Main Commercial Market, Lahore, Punjab, Pakistan'),
  phone: text('phone').default('+92 42 35789000'),
  mobile: text('mobile').default('+92 300 1234567'),
  currency: text('currency').default('PKR').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  invoices: many(salesInvoices),
}));

export const salesInvoicesRelations = relations(salesInvoices, ({ one, many }) => ({
  user: one(users, {
    fields: [salesInvoices.userId],
    references: [users.id],
  }),
  items: many(salesInvoiceItems),
}));

export const salesInvoiceItemsRelations = relations(salesInvoiceItems, ({ one }) => ({
  invoice: one(salesInvoices, {
    fields: [salesInvoiceItems.invoiceId],
    references: [salesInvoices.id],
  }),
  item: one(items, {
    fields: [salesInvoiceItems.itemId],
    references: [items.id],
  }),
}));

// 6. Permanent Production Database Persistence Store (cross-deployment & multi-device sync)
export const amsCloudPersistence = pgTable('ams_cloud_persistence', {
  storeKey: text('store_key').primaryKey(),
  versionSeq: integer('version_seq').default(1).notNull(),
  dbBase64: text('db_base64').notNull(),
  sha256Hash: text('sha256_hash').notNull(),
  recordCounts: text('record_counts').default('{}').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedByEnv: text('updated_by_env'),
});

// 7. Permanent Cloud Backups Archive
export const amsCloudBackups = pgTable('ams_cloud_backups', {
  filename: text('filename').primaryKey(),
  backupType: text('backup_type').notNull(),
  fileSizeBytes: integer('file_size_bytes').notNull(),
  sha256Hash: text('sha256_hash').notNull(),
  recordCounts: text('record_counts').default('{}').notNull(),
  notes: text('notes'),
  dbBase64: text('db_base64').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

