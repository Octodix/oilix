import {
  computePayslip,
  DEFAULT_PAYROLL_POLICY,
  round2,
  type PayrollContract,
  type PayrollDay,
  type PayrollInput,
} from './payroll-engine';
import { eachDateKey, weekdayOf } from './hr-time';

const PERIOD = { year: 2026, month: 10, start: '2026-10-01', end: '2026-10-31' };

const CONTRACT: PayrollContract = {
  id: 'c1',
  startDate: '2025-01-01',
  endDate: null,
  salaryMode: 'MONTHLY',
  baseSalary: 42_000,
  weeklyHours: 40,
  contractType: 'CDI',
  jobTitle: 'Opérateur',
};

/** Sun–Thu working week (Algeria), Fri/Sat rest. */
function month(overrides: Record<string, Partial<PayrollDay>> = {}): PayrollDay[] {
  return eachDateKey(PERIOD.start, PERIOD.end).map((date) => {
    const wd = weekdayOf(date);
    const working = wd !== 5 && wd !== 6;
    return {
      id: `d-${date}`,
      date,
      status: working ? 'PRESENT' : 'REST_DAY',
      isWorkingDay: working,
      expectedMinutes: working ? 480 : 0,
      workedMinutes: working ? 480 : 0,
      overtimeMinutes: 0,
      isLate: false,
      chargeableLateMinutes: 0,
      lateJustified: false,
      leavePaid: null,
      absencePaid: null,
      sickPaidPercent: null,
      holidayPaid: null,
      ...overrides[date],
    };
  });
}

function input(partial: Partial<PayrollInput> = {}): PayrollInput {
  return {
    period: PERIOD,
    contracts: [CONTRACT],
    days: month(),
    overtime: [],
    bonuses: [],
    deductions: [],
    advances: [],
    loans: [],
    policy: DEFAULT_PAYROLL_POLICY,
    ...partial,
  };
}

const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

describe('payroll engine', () => {
  const workingDays = month().filter((d) => d.isWorkingDay).length; // 21 in Oct 2026

  it('full month, no events ⇒ net = base', () => {
    const r = computePayslip(input());
    expect(workingDays).toBe(21);
    expect(r.grossEarnings).toBe(42_000);
    expect(r.totalDeductions).toBe(0);
    expect(r.netSalary).toBe(42_000);
    expect(r.dailyRate).toBe(2000);
    expect(r.lines.find((l) => l.code === 'BASE')?.sourceIds).toEqual(['c1']);
  });

  it('Net = Base + additions − deductions, each line traceable', () => {
    const r = computePayslip(
      input({
        days: month({ '2026-10-05': { status: 'ABSENT', workedMinutes: 0 } }),
        overtime: [{ id: 'ot1', date: '2026-10-06', minutes: 120, multiplier: 1.5, status: 'APPROVED' }],
        bonuses: [{ id: 'b1', type: 'RENDEMENT', label: 'Prime de rendement', amount: 3000, category: 'BONUS' }],
        deductions: [{ id: 'r1', type: 'DAMAGE', label: 'Casse matériel', amount: 500 }],
        advances: [{ id: 'a1', amount: 5000, date: '2026-10-10' }],
        loans: [{ id: 'l1', installment: 2000, remaining: 1500 }],
      }),
    );
    const earnings = r.lines.filter((l) => l.kind === 'EARNING').map((l) => l.amount);
    const deductions = r.lines.filter((l) => l.kind === 'DEDUCTION').map((l) => l.amount);
    expect(r.grossEarnings).toBe(sum(earnings));
    expect(r.totalDeductions).toBe(sum(deductions));
    expect(r.netSalary).toBe(round2(r.grossEarnings - r.totalDeductions));

    const hourly = 42_000 / ((40 * 52) / 12);
    expect(r.lines.find((l) => l.code === 'OVERTIME')?.amount).toBeCloseTo(2 * hourly * 1.5, 1);
    expect(r.lines.find((l) => l.code === 'ABSENCE_UNJUSTIFIED')).toMatchObject({
      amount: 2000,
      quantity: 1,
      sourceIds: ['d-2026-10-05'],
    });
    expect(r.lines.find((l) => l.code === 'LOAN')?.amount).toBe(1500);
    expect(r.lines.find((l) => l.code === 'ADVANCE')?.sourceIds).toEqual(['a1']);
    expect(r.lines.every((l) => l.explanation.length > 0)).toBe(true);
  });

  it('pending overtime is not paid until approved', () => {
    const r = computePayslip(
      input({ overtime: [{ id: 'ot1', date: '2026-10-06', minutes: 120, multiplier: 1.5, status: 'PENDING' }] }),
    );
    expect(r.lines.some((l) => l.code === 'OVERTIME')).toBe(false);
    expect(r.netSalary).toBe(42_000);
    expect(r.warnings).toContain('PENDING_OVERTIME:1');
  });

  it('paid leave is not deducted, unpaid leave is', () => {
    const paid = computePayslip(input({ days: month({ '2026-10-07': { status: 'LEAVE', leavePaid: true } }) }));
    expect(paid.netSalary).toBe(42_000);
    const unpaid = computePayslip(input({ days: month({ '2026-10-07': { status: 'LEAVE', leavePaid: false } }) }));
    expect(unpaid.lines.find((l) => l.code === 'LEAVE_UNPAID')?.amount).toBe(2000);
    expect(unpaid.netSalary).toBe(40_000);
  });

  it('sick leave follows its payroll treatment, separate from absence', () => {
    const r = computePayslip(
      input({
        days: month({
          '2026-10-07': { status: 'SICK_LEAVE', sickPaidPercent: 50 },
          '2026-10-08': { status: 'SICK_LEAVE', sickPaidPercent: 0 },
        }),
      }),
    );
    expect(r.lines.find((l) => l.code === 'SICK_UNPAID')).toMatchObject({ quantity: 1.5, amount: 3000 });
    expect(r.lines.some((l) => l.code === 'ABSENCE_UNJUSTIFIED')).toBe(false);
    expect(r.summary.sickDays).toBe(2);
    expect(r.summary.absentDays).toBe(0);
  });

  it('late deduction follows policy, tolerance and justification', () => {
    const days = month({
      '2026-10-04': { status: 'LATE', isLate: true, chargeableLateMinutes: 20 },
      '2026-10-05': { status: 'LATE', isLate: true, chargeableLateMinutes: 30 },
      '2026-10-06': { status: 'LATE', isLate: true, chargeableLateMinutes: 60, lateJustified: true },
    });
    const none = computePayslip(input({ days }));
    expect(none.lines.some((l) => l.code === 'LATE')).toBe(false);

    const fixed = computePayslip(
      input({
        days,
        policy: { ...DEFAULT_PAYROLL_POLICY, lateDeductionMode: 'FIXED_PER_OCCURRENCE', lateFixedAmount: 200, lateToleratedOccurrences: 1 },
      }),
    );
    expect(fixed.lines.find((l) => l.code === 'LATE')).toMatchObject({ quantity: 1, amount: 200, sourceIds: ['d-2026-10-05'] });
  });

  it('missing punch days are paid by default but reported as a warning', () => {
    const r = computePayslip(input({ days: month({ '2026-10-05': { status: 'MISSING_PUNCH', workedMinutes: 0 } }) }));
    expect(r.netSalary).toBe(42_000);
    expect(r.warnings).toContain('MISSING_PUNCH_DAYS:1');
  });

  it('hired mid-month ⇒ base prorated on scheduled working days', () => {
    const days = month();
    for (const d of days) if (d.date < '2026-10-15') d.status = 'NOT_EMPLOYED';
    const covered = days.filter((d) => d.isWorkingDay && d.status !== 'NOT_EMPLOYED').length;
    const r = computePayslip(input({ days, contracts: [{ ...CONTRACT, startDate: '2026-10-15' }] }));
    expect(r.grossEarnings).toBe(round2((42_000 * covered) / workingDays));
  });

  it('salary change mid-month ⇒ each contract pays its own share', () => {
    const contracts: PayrollContract[] = [
      { ...CONTRACT, id: 'old', endDate: '2026-10-14' },
      { ...CONTRACT, id: 'new', startDate: '2026-10-15', baseSalary: 55_000 },
    ];
    const days = month();
    const before = days.filter((d) => d.isWorkingDay && d.date <= '2026-10-14').length;
    const r = computePayslip(input({ contracts, days }));
    expect(r.contract?.id).toBe('new');
    expect(r.warnings).toContain('CONTRACT_CHANGED_IN_PERIOD');
    expect(r.grossEarnings).toBe(round2((42_000 * before) / workingDays + (55_000 * (workingDays - before)) / workingDays));
  });

  it('daily-paid employee: only payable days are paid', () => {
    const r = computePayslip(
      input({
        contracts: [{ ...CONTRACT, salaryMode: 'DAILY', baseSalary: 1800 }],
        days: month({ '2026-10-05': { status: 'ABSENT', workedMinutes: 0 } }),
      }),
    );
    expect(r.lines.find((l) => l.code === 'BASE')).toMatchObject({ quantity: workingDays - 1, amount: (workingDays - 1) * 1800 });
    expect(r.totalDeductions).toBe(0);
  });

  it('hourly-paid employee: regular hours capped at schedule, overtime separate', () => {
    const r = computePayslip(
      input({
        contracts: [{ ...CONTRACT, salaryMode: 'HOURLY', baseSalary: 250 }],
        days: month({ '2026-10-05': { workedMinutes: 600, overtimeMinutes: 120 } }),
      }),
    );
    expect(r.lines.find((l) => l.code === 'BASE')).toMatchObject({ quantity: workingDays * 8, amount: workingDays * 8 * 250 });
  });

  it('no contract ⇒ zero payslip with explicit warning', () => {
    const r = computePayslip(input({ contracts: [] }));
    expect(r.netSalary).toBe(0);
    expect(r.warnings).toContain('NO_CONTRACT');
  });

  it('negative net is reported, never silently clamped', () => {
    const r = computePayslip(input({ advances: [{ id: 'a1', amount: 50_000, date: '2026-10-02' }] }));
    expect(r.netSalary).toBe(-8000);
    expect(r.warnings).toContain('NEGATIVE_NET');
  });
});
