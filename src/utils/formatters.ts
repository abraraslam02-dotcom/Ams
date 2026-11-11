/**
 * Localization and Currency Formatters for Abrar Medical Store, Pakistan
 */

export const DEFAULT_CURRENCY = 'PKR';
export const DEFAULT_CURRENCY_SYMBOL = 'Rs.';
export const DEFAULT_TIMEZONE = 'Asia/Karachi';
export const DEFAULT_TIMEZONE_LABEL = 'PKT (UTC+5)';

/**
 * Formats a numeric amount in Pakistani Rupees (PKR)
 * Format example: Rs. 1,250.00
 */
export function formatPKR(amount: number | null | undefined, showSymbol: boolean = true): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return showSymbol ? 'Rs. 0.00' : '0.00';
  }
  const formatted = new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  return showSymbol ? `Rs. ${formatted}` : formatted;
}

/**
 * Formats a Date or ISO string into Pakistan Standard Time (UTC+5)
 */
export function formatPKTTime(dateInput: string | Date | number | null | undefined): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-PK', {
    timeZone: DEFAULT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Formats a Date into standard PKT Date format (e.g. 04 Nov 2026)
 */
export function formatPKTDate(dateInput: string | Date | number | null | undefined): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-PK', {
    timeZone: DEFAULT_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * Formats full PKT date and time with UTC+5 badge
 */
export function formatPKTFull(dateInput: string | Date | number | null | undefined): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  const datePart = formatPKTDate(date);
  const timePart = formatPKTTime(date);
  return `${datePart} at ${timePart} (PKT)`;
}

export const formatPKTDateTime = formatPKTFull;

/**
 * Formats bytes to human-readable file size (KB, MB)
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
