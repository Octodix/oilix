import { api } from '@/lib/api';

/** One oil bucket of one business day — GET /oil-sales/daily-stock */
export type DailyStockBucket = {
  oilSource: 'STORED' | 'FARMER';
  oilType: string;
  status: 'CONFIRMED' | 'OPEN';
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
  actual: number | null;
  difference: number | null;
  nextOpening: number;
  nextOpeningProvisional: boolean;
  reason: string | null;
  closing: {
    id: string;
    confirmedAt: string;
    confirmedByName: string | null;
    deviceName: string | null;
    windowStart: string;
    windowEnd: string;
  } | null;
  lastReopen: { at: string; reason: string | null } | null;
};

export type DailyStockTotals = {
  opening: number;
  added: number;
  netSold: number;
  available: number;
  expected: number;
  actual: number | null;
  difference: number;
  nextOpening: number;
};

export type DailyStockDay = {
  date: string;
  today: string;
  isToday: boolean;
  isFuture: boolean;
  window: { start: string; end: string; startHour: number };
  /** Server-enforced reason thresholds (litres / % of expected). */
  rules: { reasonMinLitres: number; reasonMinPercent: number };
  allConfirmed: boolean;
  anyConfirmed: boolean;
  buckets: DailyStockBucket[];
  totals: { all: DailyStockTotals; STORED: DailyStockTotals; FARMER: DailyStockTotals };
};

export const DAILY_STOCK_KEY = ['oil-daily-stock'] as const;

export function fetchDailyStockDay(date: string) {
  return api.get<DailyStockDay>('/oil-sales/daily-stock', { params: { date } }).then((r) => r.data);
}

/** Days of [from, to] (one request); null when the user cannot read inventory. */
export async function fetchDailyStockRange(from: string, to: string): Promise<DailyStockDay[] | null> {
  try {
    if (from === to) return [await fetchDailyStockDay(from)];
    const r = await api.get<{ days: DailyStockDay[] }>('/oil-sales/daily-stock', { params: { from, to } });
    return r.data.days;
  } catch {
    return null;
  }
}

/** A bucket worth showing: anything happened or any stock is there. */
export function bucketHasActivity(b: DailyStockBucket): boolean {
  return [b.opening, b.added, b.otherIn, b.otherOut, b.sold, b.returned, b.expected, b.actual ?? 0].some(
    (v) => Math.abs(v) > 0.004,
  );
}

export function signedLitres(v: number, decimals = 1): string {
  const a = Math.abs(v).toFixed(decimals);
  return v > 0.004 ? `+${a}` : v < -0.004 ? `-${a}` : '0';
}
