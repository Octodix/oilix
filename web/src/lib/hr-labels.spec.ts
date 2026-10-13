import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  dateTimeDz,
  dayKey,
  daysBetween,
  deviceStatus,
  fmtDay,
  fmtMinutes,
  fullName,
  isDateKey,
  label,
  monthRange,
  newIdempotencyKey,
  payrollActions,
  payrollWarning,
  payslipRemaining,
  shiftMonth,
  timeDz,
  toCsv,
  todayKeyDz,
  toNum,
  weekdayOf,
} from './hr-labels.ts';

describe('hr-labels: numbers and durations', () => {
  it('reads Prisma Decimal strings as numbers', () => {
    assert.equal(toNum('42000.50'), 42000.5);
    assert.equal(toNum(null), 0);
    assert.equal(toNum('abc'), 0);
  });

  it('formats minutes as h/min', () => {
    assert.equal(fmtMinutes(0), '0');
    assert.equal(fmtMinutes(45), '45 min');
    assert.equal(fmtMinutes(125), '2h05');
    assert.equal(fmtMinutes(-90), '-1h30');
  });

  it('never lets a payslip be paid beyond its net', () => {
    assert.equal(payslipRemaining({ netSalary: '42000.00', paidAmount: '10000.00' }), 32000);
    assert.equal(payslipRemaining({ netSalary: '100', paidAmount: '150' }), 0);
  });
});

describe('hr-labels: dates (Algeria UTC+1, no DST)', () => {
  it('keeps date-only columns on the right calendar day', () => {
    assert.equal(dayKey('2026-10-06T00:00:00.000Z'), '2026-10-06');
    assert.equal(fmtDay('2026-10-06T00:00:00.000Z'), '06/10/2026');
    assert.equal(fmtDay(null), '—');
  });

  it('converts instants to Algiers wall-clock time', () => {
    assert.equal(timeDz('2026-10-06T07:05:00.000Z'), '08:05');
    assert.equal(dateTimeDz('2026-10-06T23:30:00.000Z'), '07/10/2026 00:30');
    assert.equal(todayKeyDz(new Date('2026-10-06T23:30:00.000Z')), '2026-10-07');
  });

  it('does month and day arithmetic across boundaries', () => {
    assert.deepEqual(monthRange(2028, 2), { from: '2028-02-01', to: '2028-02-29' });
    assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
    assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(daysBetween('2026-10-01', '2026-10-31'), 30);
    assert.equal(weekdayOf('2026-10-04'), 0);
    assert.equal(isDateKey('2026-02-30'), false);
    assert.equal(isDateKey('2026-02-28'), true);
  });
});

describe('hr-labels: labels', () => {
  it('falls back to the raw code for unknown values', () => {
    assert.equal(label.attendance('LATE').fr, 'En retard');
    assert.equal(label.attendance('SOMETHING_NEW').ar, 'SOMETHING_NEW');
    assert.equal(label.approval(undefined).ar, '—');
  });

  it('shows disabled devices as disabled whatever their last status', () => {
    assert.equal(deviceStatus('ONLINE', false).fr, 'Désactivé');
    assert.equal(deviceStatus('ONLINE').dot, '🟢');
    assert.equal(deviceStatus('OFFLINE').dot, '🔴');
    assert.equal(deviceStatus('WAITING_FOR_DEVICE').dot, '🟠');
  });

  it('explains payroll warning codes with their detail', () => {
    assert.match(payrollWarning('MISSING_PUNCH_DAYS:3'), /^3 /);
    assert.match(payrollWarning('NO_CONTRACT_ON:2026-10-02'), /2026-10-02/);
    assert.equal(payrollWarning('UNKNOWN_CODE'), 'UNKNOWN_CODE');
  });

  it('orders names as on Algerian documents (last name first)', () => {
    assert.equal(fullName({ firstName: 'Karim', lastName: 'Benali' }), 'Benali Karim');
    assert.equal(fullName(null), '—');
  });
});

describe('hr-labels: payroll workflow mirrors the API', () => {
  it('only offers transitions the API accepts', () => {
    assert.deepEqual(payrollActions('DRAFT'), ['calculate']);
    assert.deepEqual(payrollActions('CALCULATED'), ['calculate', 'review']);
    assert.deepEqual(payrollActions('REVIEWED'), ['calculate', 'validate']);
    assert.deepEqual(payrollActions('VALIDATED'), ['pay', 'reopen']);
    assert.deepEqual(payrollActions('PAID'), ['close']);
    assert.deepEqual(payrollActions('CLOSED'), []);
  });
});

describe('hr-labels: CSV export and idempotency keys', () => {
  it('escapes separators/quotes and neutralises spreadsheet formulas', () => {
    const csv = toCsv(['Nom', 'Note'], [['Benali; Karim', '=HYPERLINK("x")'], ['"Q"', 12.5]]);
    assert.ok(csv.startsWith('\uFEFF'));
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines[0], 'Nom;Note');
    assert.equal(lines[1], '"Benali; Karim";"\'=HYPERLINK(""x"")"');
    assert.equal(lines[2], '"""Q""";12.5');
  });

  it('keeps negative numbers as numbers', () => {
    assert.equal(toCsv(['a'], [[-5]]).slice(1).split('\r\n')[1], '-5');
  });

  it('generates distinct keys long enough for the API (8–120 chars)', () => {
    const a = newIdempotencyKey('pay');
    const b = newIdempotencyKey('pay');
    assert.notEqual(a, b);
    assert.ok(a.length >= 8 && a.length <= 120);
    assert.ok(a.startsWith('pay-'));
  });
});
