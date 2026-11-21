/**
 * Localization, Date (dd-MMM-yy), and Currency Formatters for Abrar Medical Store, Pakistan
 */

export const DEFAULT_CURRENCY = 'PKR';
export const DEFAULT_CURRENCY_SYMBOL = 'Rs.';
export const DEFAULT_TIMEZONE = 'Asia/Karachi';
export const DEFAULT_TIMEZONE_LABEL = 'PKT (UTC+5)';

export const APP_DATE_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MONTH_INDEX_BY_ABBR: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function buildDdMmmYy(day: number, monthIndex: number, year: number): string {
  if (
    !Number.isFinite(day) ||
    !Number.isFinite(monthIndex) ||
    !Number.isFinite(year) ||
    day < 1 ||
    day > 31 ||
    monthIndex < 0 ||
    monthIndex > 11
  ) {
    return '';
  }
  const dd = String(day).padStart(2, '0');
  const mmm = APP_DATE_MONTHS[monthIndex];
  const yy = String(Math.abs(year) % 100).padStart(2, '0');
  return `${dd}-${mmm}-${yy}`;
}

/**
 * Formats any date input into the application-wide standard format: dd-MMM-yy (e.g. 21-Nov-26).
 * - Preserves calendar dates for ISO date-only strings (YYYY-MM-DD) without timezone shifting.
 * - Uses Asia/Karachi (PKT) for Date objects, timestamps, and UTC ISO strings.
 * - Leaves non-date sentinel strings (e.g. "OPENING", "Start", "Current", "—") intact.
 */
export function formatAppDate(
  dateInput: string | Date | number | null | undefined,
  fallback: string = '—'
): string {
  if (dateInput === null || dateInput === undefined) return fallback;

  if (typeof dateInput === 'string') {
    const raw = dateInput.trim();
    if (!raw || raw === '—' || raw === '-') return fallback;

    // 1. ISO date-only or local SQLite timestamp (YYYY-MM-DD or YYYY-MM-DD HH:mm:ss without timezone offset)
    const isoLocalMatch = raw.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:$|[\sT]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$)/
    );
    if (isoLocalMatch) {
      const yr = Number(isoLocalMatch[1]);
      const mon = Number(isoLocalMatch[2]) - 1;
      const day = Number(isoLocalMatch[3]);
      const formatted = buildDdMmmYy(day, mon, yr);
      if (formatted) return formatted;
    }

    // 2. Already in dd-MMM-yy or dd-MMM-yyyy (e.g., 21-Nov-26 or 21-nov-2026)
    const dMmmYMatch = raw.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[-\s/](\d{2}|\d{4})$/);
    if (dMmmYMatch) {
      const day = Number(dMmmYMatch[1]);
      const mon = MONTH_INDEX_BY_ABBR[dMmmYMatch[2].toLowerCase()];
      const yr = Number(dMmmYMatch[3]);
      if (mon !== undefined) {
        const formatted = buildDdMmmYy(day, mon, yr);
        if (formatted) return formatted;
      }
    }

    // 3. DD/MM/YYYY or DD-MM-YYYY (common PK/UK format)
    const dmyMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
    if (dmyMatch) {
      const p1 = Number(dmyMatch[1]);
      const p2 = Number(dmyMatch[2]);
      const yr = Number(dmyMatch[3]);
      // Treat as DD/MM/YYYY unless second segment > 12 (MM/DD/YYYY)
      const day = p2 > 12 ? p2 : p1;
      const mon = (p2 > 12 ? p1 : p2) - 1;
      const formatted = buildDdMmmYy(day, mon, yr);
      if (formatted) return formatted;
    }

    // 4. Full ISO with timezone (Z or +/-HH:MM) or general date string
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime()) && /\d/.test(raw)) {
      return formatDateObjectPKT(parsed, fallback);
    }

    // Non-date sentinel string (e.g. "OPENING", "Current", "N/A") -> keep as-is
    return raw;
  }

  const dateObj = typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
    return fallback;
  }
  return formatDateObjectPKT(dateObj, fallback);
}

function formatDateObjectPKT(date: Date, fallback: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      day: '2-digit',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(date);

    const day = Number(parts.find((p) => p.type === 'day')?.value || 0);
    const month = Number(parts.find((p) => p.type === 'month')?.value || 0) - 1;
    const year = Number(parts.find((p) => p.type === 'year')?.value || 0);
    return buildDdMmmYy(day, month, year) || fallback;
  } catch {
    return buildDdMmmYy(date.getDate(), date.getMonth(), date.getFullYear()) || fallback;
  }
}

/**
 * Formats a date range using dd-MMM-yy (e.g. "22-Oct-26 to 21-Nov-26").
 */
export function formatDateRange(
  startDate?: string | Date | null,
  endDate?: string | Date | null,
  fallbackStart: string = 'Opening',
  fallbackEnd: string = 'Current'
): string {
  const from = startDate ? formatAppDate(startDate, fallbackStart) : fallbackStart;
  const to = endDate ? formatAppDate(endDate, fallbackEnd) : fallbackEnd;
  return `${from} to ${to}`;
}

/**
 * Replaces standalone ISO dates (YYYY-MM-DD) inside arbitrary text (narrations, headers, print HTML text)
 * with the standard dd-MMM-yy format (e.g. 21-Nov-26), without touching invoice/batch codes like INV-2026-0001.
 */
export function replaceIsoDatesInText(text: string): string {
  if (!text) return text;
  return text.replace(
    /(^|[^A-Za-z0-9_-])((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?=$|[^A-Za-z0-9_-]|T\d{2}:\d{2})/g,
    (match, prefix, yrStr, monStr, dayStr) => {
      const formatted = buildDdMmmYy(Number(dayStr), Number(monStr) - 1, Number(yrStr));
      return formatted ? `${prefix}${formatted}` : match;
    }
  );
}

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
 * Formats a Date into standard application Date format: dd-MMM-yy (e.g. 21-Nov-26)
 */
export function formatPKTDate(dateInput: string | Date | number | null | undefined): string {
  return formatAppDate(dateInput, '—');
}

/**
 * Formats a Date and Time into dd-MMM-yy hh:mm AM/PM (e.g. 21-Nov-26 03:54 PM)
 */
export function formatAppDateTime(
  dateInput: string | Date | number | null | undefined,
  fallback: string = '—'
): string {
  if (!dateInput) return fallback;
  const datePart = formatAppDate(dateInput, '');
  if (!datePart) return fallback;
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return datePart;

  try {
    const timePart = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
    return `${datePart} ${timePart}`;
  } catch {
    return datePart;
  }
}

/**
 * Formats full PKT date and time with UTC+5 badge (e.g. 21-Nov-26 at 03:54:09 pm (PKT))
 */
export function formatPKTFull(dateInput: string | Date | number | null | undefined): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  const datePart = formatAppDate(dateInput, '—');
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
