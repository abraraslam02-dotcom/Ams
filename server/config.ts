import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const workspaceRoot = path.resolve(process.cwd());
const kService = String(process.env.K_SERVICE || '').toLowerCase();
const isPublishedCloudRun = kService.startsWith('ais-pre-');
const isStartScript = process.env.npm_lifecycle_event === 'start';
const explicitDbEnv = process.env.AMS_DB_ENV;
const inferredProduction =
  String(process.env.NODE_ENV || '').toLowerCase() === 'production' ||
  isPublishedCloudRun ||
  isStartScript;

const rawNodeEnv = String(
  process.env.NODE_ENV || (inferredProduction ? 'production' : 'development')
).toLowerCase();

const envScope: 'production' | 'development' | 'test' =
  explicitDbEnv === 'production' ||
  explicitDbEnv === 'development' ||
  explicitDbEnv === 'test'
    ? explicitDbEnv
    : rawNodeEnv === 'test'
    ? 'test'
    : inferredProduction
    ? 'production'
    : 'development';

const defaultDbFilename =
  envScope === 'test' ? 'ams_medical.test.db' : 'ams_medical.db';

const rawEnvDbPath = process.env.DATABASE_PATH
  ? path.resolve(workspaceRoot, process.env.DATABASE_PATH)
  : '';
const permanentDatabasePath =
  rawEnvDbPath || path.resolve(workspaceRoot, 'data', defaultDbFilename);

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: envScope === 'production' ? 'production' : rawNodeEnv,
  envScope,
  isPublishedCloudRun,
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
