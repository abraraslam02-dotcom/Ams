/**
 * Localization, Pakistan Standard Time (Asia/Karachi, UTC+05:00), Date (dd-MMM-yy),
 * and Currency Formatters for Abrar Medical Store, Pakistan.
 *
 * Timezone Architecture (Single Source of Truth):
 * - All persisted timestamps (SQLite CURRENT_TIMESTAMP 'YYYY-MM-DD HH:MM:SS' and ISO '...Z') are UTC.
 * - `parseUtcTimestamp()` normalizes timezone-less SQLite timestamps as UTC so Windows (+05:00),
 *   Android (+05:00), and Cloud/Linux (UTC) resolve the exact same UTC instant with ZERO 5-hour drift.
 * - Display formatters convert UTC -> 'Asia/Karachi' via Intl.DateTimeFormat EXACTLY ONCE.
 * - Calendar date-only values ('YYYY-MM-DD' such as invoice_date / bill_date / expiry_date) are
 *   formatted directly without timezone shifting; "today" defaults always use `getPakistanDateISO()`.
 * - NEVER uses hardcoded manual +5h/-5h millisecond arithmetic.
 */

export const DEFAULT_CURRENCY = 'PKR';
export const DEFAULT_CURRENCY_SYMBOL = 'Rs.';
export const DEFAULT_TIMEZONE = 'Asia/Karachi';
export const DEFAULT_TIMEZONE_OFFSET = '+05:00';
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

export interface PakistanDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  weekday: string;
}

const pkPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DEFAULT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'long',
});

/**
 * Parses any timestamp value (Date, epoch ms, ISO-8601 with/without offset, or SQLite UTC 'YYYY-MM-DD HH:MM:SS')
 * into a canonical UTC Date instance without OS-timezone drift.
 *
 * CRITICAL FIX for 5-hour shift on Pakistan Windows/Android devices:
 * SQLite's CURRENT_TIMESTAMP produces 'YYYY-MM-DD HH:MM:SS' in UTC WITHOUT a trailing 'Z'.
 * Native `new Date('2026-11-23 07:48:33')` parses that string as local OS time (+05:00) on PKT devices,
 * shifting displayed times 5 hours backwards. Normalizing timezone-less datetime strings to '...Z'
 * guarantees identical UTC instant resolution across Windows, Android, Linux, Online, and Offline modes.
 */
export function parseUtcTimestamp(
  input: string | Date | number | null | undefined
): Date | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const raw = String(input).trim();
  if (!raw || raw === '—' || raw === '-') return null;

  // 1. Explicit timezone offset or UTC 'Z'
  if (/(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // 2. SQLite CURRENT_TIMESTAMP / datetime('now') or ISO datetime without timezone -> UTC
  const noTzDateTime = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?$/
  );
  if (noTzDateTime) {
    const [, y, m, day, hh, mm, ss = '00', frac] = noTzDateTime;
    const msPart = frac ? `.${frac.slice(0, 3).padEnd(3, '0')}` : '';
    const d = new Date(`${y}-${m}-${day}T${hh}:${mm}:${ss}${msPart}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // 3. Pure calendar date 'YYYY-MM-DD'
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const d = new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Extracts exact calendar & wall-clock components in Asia/Karachi using Intl.DateTimeFormat.
 */
export function getPakistanDateParts(
  input?: string | Date | number | null
): PakistanDateParts {
  const date =
    input === undefined || input === null ? new Date() : parseUtcTimestamp(input) || new Date();
  const parts = pkPartsFormatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value || '';
  const rawHour = Number(pick('hour') || 0);

  return {
    year: Number(pick('year') || 1970),
    month: Number(pick('month') || 1),
    day: Number(pick('day') || 1),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(pick('minute') || 0),
    second: Number(pick('second') || 0),
    weekday: pick('weekday') || '',
  };
}

/**
 * Returns the canonical 'YYYY-MM-DD' calendar date in Asia/Karachi (Pakistan Standard Time).
 * Replaces `new Date().toISOString().slice(0, 10)` so midnight boundaries match 00:00 PKT exactly.
 */
export function getPakistanDateISO(input?: string | Date | number | null): string {
  const p = getPakistanDateParts(input);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Returns the first day of the current month ('YYYY-MM-01') in Asia/Karachi.
 */
export function getPakistanMonthStartISO(input?: string | Date | number | null): string {
  const p = getPakistanDateParts(input);
  return `${p.year}-${String(p.month).padStart(2, '0')}-01`;
}

/**
 * Returns the current year (YYYY) in Asia/Karachi.
 */
export function getPakistanYear(input?: string | Date | number | null): number {
  return getPakistanDateParts(input).year;
}

/**
 * Returns the current month (1-12) in Asia/Karachi.
 */
export function getPakistanMonth(input?: string | Date | number | null): number {
  return getPakistanDateParts(input).month;
}

/**
 * Returns the English weekday name (e.g. "Monday") in Asia/Karachi.
 */
export function getPakistanWeekday(input?: string | Date | number | null): string {
  return getPakistanDateParts(input).weekday;
}

/**
 * Pure calendar day arithmetic on 'YYYY-MM-DD' date strings (immune to OS timezone or midnight drift).
 */
export function addDaysToIsoDate(baseIsoDate: string, deltaDays: number): string {
  const match = String(baseIsoDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  const [y, m, d] = match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : (() => {
        const p = getPakistanDateParts();
        return [p.year, p.month, p.day];
      })();
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(
    utc.getUTCDate()
  ).padStart(2, '0')}`;
}

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
    return fallback;
  }
}

/**
 * Formats any date input into the application-wide standard format: dd-MMM-yy (e.g. 21-Nov-26).
 * - Pure date-only strings ('YYYY-MM-DD', e.g. invoice_date, bill_date, expiry_date) preserve their
 *   exact calendar date without timezone shifting.
 * - Full timestamps (SQLite UTC 'YYYY-MM-DD HH:MM:SS', ISO '...Z', Date objects, epoch ms) are
 *   parsed as UTC and converted EXACTLY ONCE to Asia/Karachi so dates flip at Pakistan midnight.
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

    // 1. Pure calendar date-only string (YYYY-MM-DD, no time component) -> preserve calendar date
    const pureDateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (pureDateOnlyMatch) {
      const yr = Number(pureDateOnlyMatch[1]);
      const mon = Number(pureDateOnlyMatch[2]) - 1;
      const day = Number(pureDateOnlyMatch[3]);
      const formatted = buildDdMmmYy(day, mon, yr);
      if (formatted) return formatted;
    }

    // 2. Timestamp with time component (SQLite UTC 'YYYY-MM-DD HH:MM:SS' or ISO with/without Z/offset)
    //    -> Parse as UTC and convert once to Asia/Karachi so midnight boundary is PKT-accurate
    if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}/.test(raw)) {
      const parsedTs = parseUtcTimestamp(raw);
      if (parsedTs) {
        return formatDateObjectPKT(parsedTs, fallback);
      }
    }

    // 3. Already in dd-MMM-yy or dd-MMM-yyyy (e.g., 21-Nov-26 or 21-nov-2026)
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

    // 4. DD/MM/YYYY or DD-MM-YYYY (common PK/UK format)
    const dmyMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
    if (dmyMatch) {
      const p1 = Number(dmyMatch[1]);
      const p2 = Number(dmyMatch[2]);
      const yr = Number(dmyMatch[3]);
      const day = p2 > 12 ? p2 : p1;
      const mon = (p2 > 12 ? p1 : p2) - 1;
      const formatted = buildDdMmmYy(day, mon, yr);
      if (formatted) return formatted;
    }

    // 5. General date string with digits
    if (/\d/.test(raw)) {
      const parsed = parseUtcTimestamp(raw);
      if (parsed) {
        return formatDateObjectPKT(parsed, fallback);
      }
    }

    // Non-date sentinel string (e.g. "OPENING", "Current", "N/A") -> keep as-is
    return raw;
  }

  const dateObj = parseUtcTimestamp(dateInput);
  if (!dateObj) return fallback;
  return formatDateObjectPKT(dateObj, fallback);
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
 * Formats a Date, SQLite UTC string, or ISO string into Pakistan Standard Time (Asia/Karachi) hh:mm:ss AM/PM.
 */
export function formatPKTTime(dateInput: string | Date | number | null | undefined): string {
  if (!dateInput) return '—';
  const date = parseUtcTimestamp(dateInput);
  if (!date) return '—';

  return new Intl.DateTimeFormat('en-PK', {
    timeZone: DEFAULT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Formats a Date or UTC timestamp into short Pakistan Standard Time (hh:mm AM/PM) in Asia/Karachi.
 */
export function formatPKTShortTime(dateInput: string | Date | number | null | undefined): string {
  if (!dateInput) return '—';
  const date = parseUtcTimestamp(dateInput);
  if (!date) return '—';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Formats a Date or UTC timestamp into 24-hour Pakistan Standard Time (HH:mm:ss) in Asia/Karachi (for thermal receipts).
 */
export function formatPKT24Time(dateInput: string | Date | number | null | undefined): string {
  if (!dateInput) return '';
  const date = parseUtcTimestamp(dateInput);
  if (!date) return '';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DEFAULT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Formats a Date into standard application Date format: dd-MMM-yy (e.g. 21-Nov-26) in Asia/Karachi.
 */
export function formatPKTDate(dateInput: string | Date | number | null | undefined): string {
  return formatAppDate(dateInput, '—');
}

/**
 * Formats a Date and Time into dd-MMM-yy hh:mm AM/PM (e.g. 21-Nov-26 03:54 PM) in Asia/Karachi.
 */
export function formatAppDateTime(
  dateInput: string | Date | number | null | undefined,
  fallback: string = '—'
): string {
  if (!dateInput) return fallback;
  const date = parseUtcTimestamp(dateInput);
  if (!date) return formatAppDate(dateInput, fallback);

  const datePart = formatDateObjectPKT(date, '');
  if (!datePart) return fallback;

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
  const date = parseUtcTimestamp(dateInput);
  if (!date) return '—';

  const datePart = formatDateObjectPKT(date, '—');
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
