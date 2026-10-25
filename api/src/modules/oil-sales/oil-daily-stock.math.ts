/**
 * Daily oil stock (الجرد اليومي للزيت) — pure rules, no I/O.
 *
 * Stock is shared by every cash register: a "bucket" is one oil source × oil type of a season.
 * A business day D covers [start(D), end(D)) in Algeria time (UTC+1, no DST), starting at a
 * configurable hour. The day is rebuilt from the stock movement ledger:
 *
 *   available = opening + added + otherIn − otherOut
 *   expected  = available − (sold − returned)
 *   difference = actual − expected            (negative = shortage)
 *   next opening = confirmed actual, else expected (provisional)
 *
 * Carry-forward: when D−1 has a CONFIRMED closing, D opens with its physical quantity and D's
 * window starts where D−1's counted window ended (its confirmation time when it was closed
 * before midnight), so sales after an early count are carried into D, never lost or doubled.
 * Without a confirmed D−1, D opens with the ledger balance (provisional).
 *
 * A closing posts only its difference as an adjustment movement tagged with the closing id.
 * Such movements are reconciliation, never day movements: they are excluded from every day's
 * sums and, for a provisional opening, added back when they were posted after the day began.
 */

export const ALGERIA_UTC_OFFSET_MINUTES = 60;

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateKey(key: string): void {
  if (!DATE_KEY.test(key) || Number.isNaN(Date.parse(`${key}T00:00:00Z`))) {
    throw new Error('INVALID_DATE');
  }
}

export function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** [start, end) of business day `key` in UTC, the day starting at `startHour` Algeria time. */
export function businessDayWindow(key: string, startHour = 0): { start: Date; end: Date } {
  assertDateKey(key);
  const [y, m, d] = key.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, startHour, 0, 0, 0) - ALGERIA_UTC_OFFSET_MINUTES * 60_000);
  const end = new Date(start.getTime() + 24 * 3_600_000);
  return { start, end };
}

/** Business day an instant belongs to (e.g. 01:30 belongs to the previous day if the day starts at 05:00). */
export function businessDateOf(at: Date, startHour = 0): string {
  const local = new Date(at.getTime() + ALGERIA_UTC_OFFSET_MINUTES * 60_000 - startHour * 3_600_000);
  return local.toISOString().slice(0, 10);
}

export type DayMovement = {
  type: string;
  quantityL: number;
  createdAt: Date;
  /** Set on adjustments posted by a daily closing (and their reversals). */
  dailyClosingId?: string | null;
  /** Business date of that closing. */
  closingBusinessDate?: string | null;
};

export type PreviousClosing = {
  actualQty: number;
  /** End of the window D−1 counted (its confirmation time if closed before its day ended). */
  windowEnd: Date;
};

export type DayFigures = {
  openingSource: 'CONFIRMED' | 'PROVISIONAL';
  opening: number;
  added: number;
  otherIn: number;
  otherOut: number;
  sold: number;
  returned: number;
  netSold: number;
  available: number;
  expected: number;
  windowStart: Date;
  windowEnd: Date;
};

/** Effective start of day D: where the previous confirmed closing stopped counting. */
export function effectiveDayStart(dayStart: Date, prev: PreviousClosing | null): Date {
  if (!prev) return dayStart;
  return prev.windowEnd.getTime() < dayStart.getTime() ? prev.windowEnd : dayStart;
}

/**
 * Figures of business day `date` for one bucket.
 * @param ledgerBalanceAtStart stockAfter of the last movement strictly before the effective start (0 if none)
 * @param movements every movement of the bucket created at/after the effective start
 *                  (day movements up to `until`, closing adjustments at any time)
 * @param until end of the counted window (min(day end, now) for a live day)
 */
export function computeDay(input: {
  date: string;
  dayStart: Date;
  until: Date;
  prev: PreviousClosing | null;
  ledgerBalanceAtStart: number;
  movements: DayMovement[];
}): DayFigures {
  const windowStart = effectiveDayStart(input.dayStart, input.prev);
  const windowEnd = input.until;
  let added = 0;
  let sold = 0;
  let returned = 0;
  let otherIn = 0;
  let otherOut = 0;
  let addBack = 0;

  for (const m of input.movements) {
    const t = m.createdAt.getTime();
    if (t < windowStart.getTime()) continue;
    const q = Number(m.quantityL) || 0;
    if (m.dailyClosingId) {
      // Reconciliation of an EARLIER day posted after this day began: belongs to the opening.
      if (m.closingBusinessDate && m.closingBusinessDate < input.date) addBack += q;
      continue;
    }
    if (t >= windowEnd.getTime()) continue;
    switch (m.type) {
      case 'STOCK_ADDITION':
        added += q;
        break;
      case 'SALE':
        sold += -q;
        break;
      case 'SALE_CANCELLATION':
        returned += q;
        break;
      default:
        if (q >= 0) otherIn += q;
        else otherOut += -q;
    }
  }

  const opening = input.prev ? input.prev.actualQty : input.ledgerBalanceAtStart + addBack;
  const available = opening + added + otherIn - otherOut;
  const netSold = sold - returned;
  return {
    openingSource: input.prev ? 'CONFIRMED' : 'PROVISIONAL',
    opening: round2(opening),
    added: round2(added),
    otherIn: round2(otherIn),
    otherOut: round2(otherOut),
    sold: round2(sold),
    returned: round2(returned),
    netSold: round2(netSold),
    available: round2(available),
    expected: round2(available - netSold),
    windowStart,
    windowEnd,
  };
}

export function reconcile(expected: number, actual: number) {
  const a = Number(actual);
  if (!Number.isFinite(a) || a < 0) throw new Error('INVALID_ACTUAL');
  const difference = round2(a - Number(expected));
  return {
    actual: round2(a),
    difference,
    kind: (difference < 0 ? 'SHORTAGE' : difference > 0 ? 'SURPLUS' : 'BALANCED') as
      | 'SHORTAGE'
      | 'SURPLUS'
      | 'BALANCED',
  };
}

export type ReasonRule = { minLitres: number; minPercent: number };

/** A reason is required when the difference reaches either configured threshold. */
export function reasonRequired(difference: number, expected: number, rule: ReasonRule): boolean {
  const d = Math.abs(round2(difference));
  if (d === 0) return false;
  if (d >= rule.minLitres) return true;
  return expected > 0 && (d / expected) * 100 >= rule.minPercent;
}

export type ConfirmDecision =
  | { action: 'CREATE' }
  | { action: 'ALREADY_CONFIRMED'; sameActual: boolean }
  | { action: 'REFUSE'; code: 'FUTURE_DAY' | 'LATER_DAY_CONFIRMED' };

/**
 * Whether a closing may be created. A repeated confirmation never posts a second adjustment:
 * the same quantity is idempotent, a different one requires reopening first.
 */
export function decideConfirm(input: {
  date: string;
  today: string;
  existingConfirmedActual: number | null;
  laterConfirmedExists: boolean;
  actual: number;
}): ConfirmDecision {
  if (input.date > input.today) return { action: 'REFUSE', code: 'FUTURE_DAY' };
  if (input.existingConfirmedActual != null) {
    return {
      action: 'ALREADY_CONFIRMED',
      sameActual: round2(input.existingConfirmedActual) === round2(input.actual),
    };
  }
  if (input.laterConfirmedExists) return { action: 'REFUSE', code: 'LATER_DAY_CONFIRMED' };
  return { action: 'CREATE' };
}

export const DAILY_STOCK_ERROR_AR: Record<string, string> = {
  INVALID_DATE: 'تاريخ غير صالح',
  INVALID_ACTUAL: 'الكمية الفعلية غير صالحة',
  FUTURE_DAY: 'لا يمكن جرد يوم لم يبدأ بعد',
  LATER_DAY_CONFIRMED: 'يوجد جرد مؤكد ليوم لاحق لهذا الزيت — أعد فتحه أولاً',
  ALREADY_CONFIRMED: 'هذا اليوم مؤكد مسبقاً بكمية مختلفة — أعد فتحه للتصحيح',
  REASON_REQUIRED: 'الفرق كبير — يجب كتابة السبب',
  STOCK_CHANGED: 'تغيرت حركات المخزون أثناء الجرد — أعد تحميل الصفحة ثم أكّد',
  NOT_CONFIRMED: 'لا يوجد جرد مؤكد لهذا اليوم',
};
