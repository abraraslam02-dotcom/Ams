import { getDatabase } from '../db/connection.ts';

export interface ClosedPeriodMatch {
  id: number;
  period_name: string;
  start_date: string;
  end_date: string;
  closed_by?: string | null;
  closed_at?: string | null;
}

/**
 * Checks whether a given date (YYYY-MM-DD) falls inside a locked/closed accounting period.
 * Returns the closed period record if locked, or null if open.
 */
export function getLockedPeriodForDate(dateStr?: string | null): ClosedPeriodMatch | null {
  if (!dateStr) return null;
  const cleanDate = String(dateStr).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return null;

  const db = getDatabase();

  const period = db
    .prepare(
      `
      SELECT id, period_name, start_date, end_date, closed_by, closed_at
      FROM accounting_periods
      WHERE is_closed = 1
        AND DATE(?) >= DATE(start_date)
        AND DATE(?) <= DATE(end_date)
      LIMIT 1
    `
    )
    .get(cleanDate, cleanDate) as ClosedPeriodMatch | undefined;

  if (period) {
    return period;
  }

  // Fallback check on financial_closings where is_locked = 1 and status = 'CLOSED'
  const finClosing = db
    .prepare(
      `
      SELECT id, period_name, period_start_date as start_date, period_end_date as end_date, closed_by, closed_at
      FROM financial_closings
      WHERE status = 'CLOSED'
        AND is_locked = 1
        AND closing_type IN ('MONTHLY', 'YEARLY')
        AND DATE(?) >= DATE(period_start_date)
        AND DATE(?) <= DATE(period_end_date)
      LIMIT 1
    `
    )
    .get(cleanDate, cleanDate) as ClosedPeriodMatch | undefined;

  return finClosing || null;
}

/**
 * Throws a descriptive error if the target transaction date belongs to a closed & locked financial period.
 * Never locks future periods outside closed [start_date, end_date].
 */
export function assertPeriodOpen(dateStr?: string | null, actionLabel: string = 'record or modify transactions'): void {
  const locked = getLockedPeriodForDate(dateStr);
  if (locked) {
    const cleanDate = String(dateStr || '').trim().slice(0, 10);
    throw new Error(
      `Period Locked: Accounting period "${locked.period_name}" (${locked.start_date} to ${locked.end_date}) is CLOSED. Cannot ${actionLabel} on ${cleanDate}. Only Super Admin can reopen a closed period with a mandatory reason.`
    );
  }
}
