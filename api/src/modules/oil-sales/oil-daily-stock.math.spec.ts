import {
  businessDateOf,
  businessDayWindow,
  computeDay,
  decideConfirm,
  reasonRequired,
  reconcile,
  type DayMovement,
} from './oil-daily-stock.math';

const D1 = '2026-10-25';
const D2 = '2026-10-26';
const w1 = businessDayWindow(D1);
const w2 = businessDayWindow(D2);
const at = (base: Date, hours: number) => new Date(base.getTime() + hours * 3_600_000);
const mv = (type: string, q: number, when: Date, extra: Partial<DayMovement> = {}): DayMovement => ({
  type,
  quantityL: q,
  createdAt: when,
  ...extra,
});

/** Day 1 of the spec: 500 + 200 + 200 − 800. */
const day1Moves = [
  mv('STOCK_ADDITION', 200, at(w1.start, 8)),
  mv('SALE', -300, at(w1.start, 9)),
  mv('STOCK_ADDITION', 200, at(w1.start, 11)),
  mv('SALE', -500, at(w1.start, 15)),
];

describe('business day windows (Algeria UTC+1)', () => {
  it('midnight-to-midnight local by default', () => {
    expect(w1.start.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(w1.end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });
  it('a 00:30 local sale belongs to the new day; with a 05:00 boundary to the previous one', () => {
    const halfPastMidnight = new Date('2026-10-25T23:30:00.000Z'); // 00:30 on the 26th in Algiers
    expect(businessDateOf(halfPastMidnight)).toBe(D2);
    expect(businessDateOf(halfPastMidnight, 5)).toBe(D1);
    expect(businessDayWindow(D1, 5).start.toISOString()).toBe('2026-10-25T04:00:00.000Z');
  });
});

describe('daily oil stock — spec example', () => {
  const day1 = computeDay({
    date: D1,
    dayStart: w1.start,
    until: w1.end,
    prev: null,
    ledgerBalanceAtStart: 500,
    movements: day1Moves,
  });

  it('500 + 200 + 200 − 800 = 100 L expected', () => {
    expect(day1).toMatchObject({ opening: 500, added: 400, available: 900, sold: 800, netSold: 800, expected: 100 });
    expect(day1.openingSource).toBe('PROVISIONAL');
  });

  it('actual 90 L → −10 L shortage', () => {
    expect(reconcile(day1.expected, 90)).toEqual({ actual: 90, difference: -10, kind: 'SHORTAGE' });
  });

  it('next day opens with the confirmed 90 L, not the theoretical 100 L', () => {
    // Day 1 was confirmed this morning at 08:00 of day 2: its −10 adjustment was posted then.
    const closingAdj = mv('INVENTORY_ADJUSTMENT', -10, at(w2.start, 8), { dailyClosingId: 'c1', closingBusinessDate: D1 });
    const day2 = computeDay({
      date: D2,
      dayStart: w2.start,
      until: w2.end,
      prev: { actualQty: 90, windowEnd: w1.end },
      ledgerBalanceAtStart: 100,
      movements: [closingAdj],
    });
    expect(day2.openingSource).toBe('CONFIRMED');
    expect(day2.opening).toBe(90);
    expect(day2.expected).toBe(90); // no additions, no sales: starts and stays at exactly 90 L
  });

  it('the closing adjustment is never counted as a movement of any day (no double count)', () => {
    const closingAdj = mv('INVENTORY_ADJUSTMENT', -10, at(w2.start, 8), { dailyClosingId: 'c1', closingBusinessDate: D1 });
    const sale = mv('SALE', -40, at(w2.start, 10));
    // Provisional view of day 2 (as if day 1 were not linked): ledger 100 + late −10 add-back.
    const day2 = computeDay({
      date: D2,
      dayStart: w2.start,
      until: w2.end,
      prev: null,
      ledgerBalanceAtStart: 100,
      movements: [closingAdj, sale],
    });
    expect(day2.opening).toBe(90);
    expect(day2.otherOut).toBe(0);
    expect(day2.expected).toBe(50);
  });
});

describe('carry-forward details', () => {
  it('a day without any movement starts from the previous closing', () => {
    const d = computeDay({ date: D2, dayStart: w2.start, until: w2.end, prev: { actualQty: 90, windowEnd: w1.end }, ledgerBalanceAtStart: 90, movements: [] });
    expect(d).toMatchObject({ opening: 90, added: 0, netSold: 0, expected: 90 });
  });

  it('a count taken at 20:00 hands the 20:00–24:00 sales to the next day', () => {
    const countAt = at(w1.start, 20);
    const lateSale = mv('SALE', -30, at(w1.start, 22));
    const day1 = computeDay({ date: D1, dayStart: w1.start, until: countAt, prev: null, ledgerBalanceAtStart: 500, movements: [...day1Moves, lateSale] });
    expect(day1.expected).toBe(100); // the 22:00 sale is not in the counted window
    const day2 = computeDay({ date: D2, dayStart: w2.start, until: w2.end, prev: { actualQty: 90, windowEnd: countAt }, ledgerBalanceAtStart: 0, movements: [lateSale] });
    expect(day2.windowStart).toEqual(countAt);
    expect(day2.sold).toBe(30);
    expect(day2.expected).toBe(60);
  });

  it('a cancelled sale returns its litres; net sold is shown', () => {
    const d = computeDay({
      date: D1,
      dayStart: w1.start,
      until: w1.end,
      prev: null,
      ledgerBalanceAtStart: 100,
      movements: [mv('SALE', -20, at(w1.start, 9)), mv('SALE_CANCELLATION', 20, at(w1.start, 10))],
    });
    expect(d).toMatchObject({ sold: 20, returned: 20, netSold: 0, expected: 100 });
  });

  it('losses and manual corrections are other movements, not sales', () => {
    const d = computeDay({
      date: D1,
      dayStart: w1.start,
      until: w1.end,
      prev: null,
      ledgerBalanceAtStart: 100,
      movements: [mv('LOSS', -5, at(w1.start, 9)), mv('ADJUSTMENT', 3, at(w1.start, 10))],
    });
    expect(d).toMatchObject({ otherIn: 3, otherOut: 5, available: 98, expected: 98 });
  });
});

describe('several oils and several registers', () => {
  it('two oils stay independent (spec Oil A / Oil B)', () => {
    const a = computeDay({ date: D1, dayStart: w1.start, until: w1.end, prev: null, ledgerBalanceAtStart: 500, movements: day1Moves });
    const b = computeDay({
      date: D1,
      dayStart: w1.start,
      until: w1.end,
      prev: null,
      ledgerBalanceAtStart: 300,
      movements: [mv('STOCK_ADDITION', 100, at(w1.start, 8)), mv('SALE', -250, at(w1.start, 12))],
    });
    expect(reconcile(a.expected, 90).difference).toBe(-10);
    expect(b.expected).toBe(150);
    expect(reconcile(b.expected, 150).difference).toBe(0);
  });

  it('sales from two registers on the shared stock are each counted once', () => {
    // The ledger holds one movement per sale, whatever register made it.
    const d = computeDay({
      date: D1,
      dayStart: w1.start,
      until: w1.end,
      prev: null,
      ledgerBalanceAtStart: 200,
      movements: [mv('SALE', -40, at(w1.start, 9)), mv('SALE', -60, at(w1.start, 9.5))],
    });
    expect(d.sold).toBe(100);
    expect(d.expected).toBe(100);
  });
});

describe('confirmation rules', () => {
  it('a repeated confirmation with the same quantity is idempotent, a different one is refused', () => {
    expect(decideConfirm({ date: D1, today: D2, existingConfirmedActual: 90, laterConfirmedExists: false, actual: 90 })).toEqual({ action: 'ALREADY_CONFIRMED', sameActual: true });
    expect(decideConfirm({ date: D1, today: D2, existingConfirmedActual: 90, laterConfirmedExists: false, actual: 95 })).toEqual({ action: 'ALREADY_CONFIRMED', sameActual: false });
  });
  it('a closed later day protects earlier days; future days cannot be closed', () => {
    expect(decideConfirm({ date: D1, today: D2, existingConfirmedActual: null, laterConfirmedExists: true, actual: 90 })).toEqual({ action: 'REFUSE', code: 'LATER_DAY_CONFIRMED' });
    expect(decideConfirm({ date: D2, today: D1, existingConfirmedActual: null, laterConfirmedExists: false, actual: 90 })).toEqual({ action: 'REFUSE', code: 'FUTURE_DAY' });
    expect(decideConfirm({ date: D1, today: D1, existingConfirmedActual: null, laterConfirmedExists: false, actual: 90 })).toEqual({ action: 'CREATE' });
  });
  it('reason threshold in litres or percent', () => {
    const rule = { minLitres: 5, minPercent: 2 };
    expect(reasonRequired(0, 100, rule)).toBe(false);
    expect(reasonRequired(-1, 100, rule)).toBe(false);
    expect(reasonRequired(-3, 100, rule)).toBe(true); // 3 %
    expect(reasonRequired(-5, 1000, rule)).toBe(true); // 5 L
    expect(reasonRequired(-10, 100, { minLitres: 0, minPercent: 0 })).toBe(true);
  });
});
