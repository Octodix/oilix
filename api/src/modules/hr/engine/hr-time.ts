/**
 * Calendar helpers for HR. A "date key" is a local calendar day 'YYYY-MM-DD'.
 * Local time = UTC + offsetMinutes (Africa/Algiers is a fixed +60, no DST).
 */

const DAY_MS = 86_400_000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = DATE_KEY_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function assertDateKey(v: string, field = 'date'): string {
  if (!isDateKey(v)) throw new Error(`${field}: expected YYYY-MM-DD, got "${v}"`);
  return v;
}

/** Prisma @db.Date value for a date key (midnight UTC). */
export function dateKeyToDb(key: string): Date {
  return new Date(`${assertDateKey(key)}T00:00:00.000Z`);
}

/** Date key of a @db.Date value read back from Prisma. */
export function dbDateToKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function localDateKey(at: Date, offsetMinutes: number): string {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Minutes since local midnight. */
export function localMinuteOfDay(at: Date, offsetMinutes: number): number {
  const local = new Date(at.getTime() + offsetMinutes * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** UTC instant of local midnight for a date key. */
export function localMidnightUtc(key: string, offsetMinutes: number): Date {
  return new Date(dateKeyToDb(key).getTime() - offsetMinutes * 60_000);
}

/** UTC instant for a local date key + minute of day (may exceed 1440 for next-day times). */
export function localTimeUtc(key: string, minuteOfDay: number, offsetMinutes: number): Date {
  return new Date(localMidnightUtc(key, offsetMinutes).getTime() + minuteOfDay * 60_000);
}

export function addDays(key: string, days: number): string {
  return new Date(dateKeyToDb(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(key: string): number {
  return dateKeyToDb(key).getUTCDay();
}

export function eachDateKey(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

export function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function minDateKey(a: string, b: string) {
  return a <= b ? a : b;
}

export function maxDateKey(a: string, b: string) {
  return a >= b ? a : b;
}

/**
 * Terminal clocks have no timezone: "2026-10-07 07:53:12" is local wall time.
 * Returns null for anything that is not a real calendar date/time.
 */
export function parseDeviceLocalTime(raw: string, offsetMinutes: number): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(utc);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null;
  return new Date(utc - offsetMinutes * 60_000);
}

/** Canonical "YYYY-MM-DD HH:MM:SS" local representation. */
export function formatDeviceLocalTime(at: Date, offsetMinutes: number): string {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

export function parseHhMm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

export function formatHhMm(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}
