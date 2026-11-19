declare const __AMS_BUILD_ID__: string;

export const APP_VERSION = '2.12.0-ERP';

export const CLIENT_BUILD_ID =
  typeof __AMS_BUILD_ID__ !== 'undefined' && __AMS_BUILD_ID__ ? __AMS_BUILD_ID__ : 'dev';
