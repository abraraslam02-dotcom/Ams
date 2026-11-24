/**
 * Single Source of Truth for Pakistan Standard Time (Asia/Karachi, UTC+05:00) on the Backend.
 *
 * Rules:
 * - Always uses IANA timezone 'Asia/Karachi' via Intl.DateTimeFormat — NEVER hardcoded manual +5h/-5h math.
 * - Timestamps stored in SQLite (CURRENT_TIMESTAMP / datetime('now')) are UTC strings ('YYYY-MM-DD HH:MM:SS')
 *   without a 'Z' suffix. `parseUtcTimestamp` normalizes them to UTC cleanly so every platform (Windows PKT,
 *   Android PKT, Linux UTC, macOS) resolves the exact same UTC instant with zero 5-hour shift.
 * - Calendar date keys ('YYYY-MM-DD') are always computed in 'Asia/Karachi' so date boundaries flip at
 *   exact Pakistan midnight (00:00:00 PKT), never at UTC midnight (05:00:00 PKT).
 */

export const PAKISTAN_TIMEZONE = 'Asia/Karachi';
export const PAKISTAN_UTC_OFFSET = '+05:00';

export interface PakistanDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  millisecond: number; // 0-999
  weekday: string;
}

const pkPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PAKISTAN_TIMEZONE,
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
 * - Strings with explicit timezone ('Z' or '+HH:MM' / '-HH:MM') are parsed directly.
 * - Strings with date + time but NO timezone offset (e.g. SQLite CURRENT_TIMESTAMP '2026-11-23 07:48:33'
 *   or '2026-11-23T07:48:33') are explicitly normalized as UTC ('2026-11-23T07:48:33Z').
 * - Pure date-only strings ('YYYY-MM-DD') are parsed at midnight UTC for safe calendar handling.
 */
export function parseUtcTimestamp(input: string | Date | number | null | undefined): Date | null {
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
  if (!raw) return null;

  // Explicit timezone offset or UTC 'Z'
  if (/(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // SQLite CURRENT_TIMESTAMP / datetime('now') or ISO datetime without timezone -> treat as UTC
  const noTzDateTime = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?$/
  );
  if (noTzDateTime) {
    const [, y, m, day, hh, mm, ss = '00', frac] = noTzDateTime;
    const msPart = frac ? `.${frac.slice(0, 3).padEnd(3, '0')}` : '';
    const d = new Date(`${y}-${m}-${day}T${hh}:${mm}:${ss}${msPart}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Pure YYYY-MM-DD calendar date
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const d = new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Extracts exact calendar & wall-clock components in Asia/Karachi using Intl.DateTimeFormat.
 */
export function getPakistanDateParts(input?: string | Date | number | null): PakistanDateParts {
  const date = input === undefined || input === null ? new Date() : parseUtcTimestamp(input) || new Date();
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
    millisecond: date.getUTCMilliseconds(),
    weekday: pick('weekday') || '',
  };
}

/**
 * Returns the canonical 'YYYY-MM-DD' calendar date in Asia/Karachi (Pakistan Standard Time).
 * Guarantees accurate midnight boundary at 00:00:00 Asia/Karachi across Windows, Android, and Linux/Cloud.
 */
export function getPakistanDateISO(input?: string | Date | number | null): string {
  const p = getPakistanDateParts(input);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Returns current Pakistan year (YYYY) in Asia/Karachi.
 */
export function getPakistanYear(input?: string | Date | number | null): number {
  return getPakistanDateParts(input).year;
}

/**
 * Returns current Pakistan month (1-12) in Asia/Karachi.
 */
export function getPakistanMonth(input?: string | Date | number | null): number {
  return getPakistanDateParts(input).month;
}

/**
 * Pure calendar day arithmetic on 'YYYY-MM-DD' date keys (no timezone or DST drift).
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

/**
 * Returns 'YYYY-MM-DD_HH-mm-ss-SSS' formatted in Asia/Karachi for deterministic local backup filenames.
 */
export function getPakistanFilenameStamp(input?: string | Date | number | null): string {
  const p = getPakistanDateParts(input);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}_${pad2(p.hour)}-${pad2(p.minute)}-${pad2(
    p.second
  )}-${pad3(p.millisecond)}`;
}

/**
 * Formats any timestamp in Pakistan Standard Time (Asia/Karachi) for server-side labels/exports.
 */
export function formatPakistanDateDDMMYYYY(input?: string | Date | number | null): string {
  const p = getPakistanDateParts(input);
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`;
}
