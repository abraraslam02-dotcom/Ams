import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const workspaceRoot = path.resolve(process.cwd());
const rawNodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
const envScope: 'production' | 'development' | 'test' =
  process.env.AMS_DB_ENV === 'production' ||
  process.env.AMS_DB_ENV === 'development' ||
  process.env.AMS_DB_ENV === 'test'
    ? process.env.AMS_DB_ENV
    : rawNodeEnv === 'test'
    ? 'test'
    : rawNodeEnv === 'production'
    ? 'production'
    : 'development';

const defaultDbFilename =
  envScope === 'production'
    ? 'ams_medical.prod.db'
    : envScope === 'test'
    ? 'ams_medical.test.db'
    : 'ams_medical.db';

const rawEnvDbPath = process.env.DATABASE_PATH
  ? path.resolve(workspaceRoot, process.env.DATABASE_PATH)
  : '';
const permanentDatabasePath =
  rawEnvDbPath || path.resolve(workspaceRoot, 'data', defaultDbFilename);

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: rawNodeEnv,
  envScope,
  seedDatabasePath: path.resolve(workspaceRoot, 'data', 'ams_medical.db'),
  databasePath: permanentDatabasePath,
  appTimezone: process.env.APP_TIMEZONE || 'Asia/Karachi',
  appTimezoneOffset: '+05:00',
  appCurrency: process.env.APP_CURRENCY || 'PKR',
  appCurrencySymbol: 'Rs.',
  appLocale: process.env.APP_LOCALE || 'en-PK',
  companyName: process.env.COMPANY_NAME || 'Abrar Medical Store',
  country: 'Pakistan',
};
