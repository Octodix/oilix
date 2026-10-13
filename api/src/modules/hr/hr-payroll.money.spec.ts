import { eachDateKey, dateKeyToDb, weekdayOf } from './engine/hr-time';
import type { PayrollDay } from './engine/payroll-engine';
import { HrPayrollService } from './hr-payroll.service';
import { DEFAULT_HR_SETTINGS } from './hr-settings.service';

/**
 * Money-safety tests for payroll: calculation never touches cash, payments post exactly
 * once (idempotent), stay within the payslip remainder and the register's available cash,
 * and cancelling reverses the same session.
 */

type Call = { model: string; method: string; args: any };

function octoberDays(): PayrollDay[] {
  return eachDateKey('2026-10-01', '2026-10-31').map((date) => {
    const working = ![5, 6].includes(weekdayOf(date));
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
    };
  });
}

function makeWorld(opts: { openingCash?: number; periodStatus?: string } = {}) {
  const calls: Call[] = [];
  const period: any = {
    id: 'p1',
    year: 2026,
    month: 10,
    startDate: dateKeyToDb('2026-10-01'),
    endDate: dateKeyToDb('2026-10-31'),
    status: opts.periodStatus ?? 'VALIDATED',
    totalPaid: 0,
    totalNet: 42_000,
  };
  const employee = {
    id: 'e1',
    matricule: 'EMP-0001',
    firstName: 'Ali',
    lastName: 'Benali',
    jobTitle: 'Opérateur',
    workSite: null,
    hireDate: dateKeyToDb('2025-01-01'),
    leftAt: null,
    socialSecurityNumber: null,
    nationalIdNumber: null,
    paymentMethod: 'CASH',
    bankAccount: null,
    department: null,
    contracts: [
      {
        id: 'c1',
        startDate: dateKeyToDb('2025-01-01'),
        endDate: null,
        salaryMode: 'MONTHLY',
        baseSalary: 42_000,
        weeklyHours: 40,
        contractType: 'CDI',
        jobTitle: 'Opérateur',
      },
    ],
  };
  const payslip: any = {
    id: 's1',
    periodId: 'p1',
    employeeId: 'e1',
    status: 'VALIDATED',
    netSalary: 42_000,
    paidAmount: 0,
    paymentStatus: 'UNPAID',
  };
  const register = { id: 'r1', code: 'C1', name: 'Caisse 1', isActive: true };
  const session: any = {
    id: 'sess1',
    cashRegisterId: 'r1',
    seasonId: 'season1',
    status: 'OPEN',
    openingCash: opts.openingCash ?? 100_000,
    cashSales: 0,
    cashRefunds: 0,
    cashIn: 0,
    cashOut: 0,
  };
  const payments: any[] = [];
  const createdPayslips: any[] = [];

  const handlers: Record<string, Record<string, (a: any) => any>> = {
    setting: { findUnique: () => null, findMany: () => [] },
    hrPayrollPeriod: {
      findUnique: () => ({ ...period, payslips: createdPayslips }),
      update: (a) => {
        const d = a.data;
        if (d.totalPaid?.increment) period.totalPaid += d.totalPaid.increment;
        else if (d.totalPaid?.decrement) period.totalPaid -= d.totalPaid.decrement;
        if (d.status) period.status = d.status;
        return period;
      },
    },
    hrEmployee: { findMany: () => [employee] },
    hrPayslip: {
      create: (a) => {
        createdPayslips.push(a.data);
        return a.data;
      },
      findUnique: () => ({ ...payslip, period: { ...period }, employee }),
      update: (a) => Object.assign(payslip, a.data),
      count: () => (payslip.paymentStatus === 'PAID' ? 0 : 1),
    },
    hrSalaryPayment: {
      findUnique: (a) => payments.find((p) => (a.where.id ? p.id === a.where.id : p.idempotencyKey === a.where.idempotencyKey)) ?? null,
      create: (a) => {
        const row = { id: `pay${payments.length + 1}`, status: 'POSTED', ...a.data };
        payments.push(row);
        return row;
      },
      updateMany: (a) => {
        const p = payments.find((x) => x.id === a.where.id && x.status === a.where.status);
        if (!p) return { count: 0 };
        Object.assign(p, a.data);
        return { count: 1 };
      },
    },
    cashRegister: { findUnique: () => register },
    cashRegisterSession: {
      findFirst: () => (session.status === 'OPEN' ? { ...session } : null),
      findUnique: () => ({ ...session }),
      update: (a) => {
        if (a.data.cashOut?.increment) session.cashOut += a.data.cashOut.increment;
        if (a.data.cashOut?.decrement) session.cashOut -= a.data.cashOut.decrement;
        return session;
      },
    },
  };

  const defaults: Record<string, (a: any) => any> = {
    findMany: () => [],
    findUnique: () => null,
    findFirst: () => null,
    count: () => 0,
    deleteMany: () => ({ count: 0 }),
    updateMany: () => ({ count: 0 }),
    update: (a) => a?.data ?? {},
    create: (a) => a?.data ?? {},
  };

  const prisma: any = new Proxy(
    {},
    {
      get(_t, model: string) {
        if (model === '$transaction') {
          return async (fn: (tx: unknown) => unknown) => {
            // Roll back in-memory state when the callback throws, like a real transaction.
            const snapshot = JSON.stringify({ session, payslip, period, payments });
            try {
              return await fn(prisma);
            } catch (e) {
              const s = JSON.parse(snapshot);
              Object.assign(session, s.session);
              Object.assign(payslip, s.payslip);
              Object.assign(period, s.period, { startDate: period.startDate, endDate: period.endDate });
              payments.splice(0, payments.length, ...s.payments);
              throw e;
            }
          };
        }
        if (model === '$queryRaw' || model === '$executeRaw') {
          return async () => {
            calls.push({ model, method: 'raw', args: null });
            return [];
          };
        }
        return new Proxy(
          {},
          {
            get(_m, method: string) {
              return async (args: any) => {
                calls.push({ model, method, args });
                const h = handlers[model]?.[method] ?? defaults[method];
                return h ? h(args) : undefined;
              };
            },
          },
        );
      },
    },
  );

  const attendance = {
    process: jest.fn(async () => ({})),
    payrollDays: jest.fn(async () => new Map([['e1', octoberDays()]])),
  };
  const hrSettings = { get: async () => DEFAULT_HR_SETTINGS, companyInfo: async () => ({ name: 'Oilix' }) };
  const audit = { log: jest.fn(async () => undefined) };
  const settings = { getActiveSeasonId: jest.fn(async () => 'season1') };

  const service = new HrPayrollService(prisma, audit as any, attendance as any, hrSettings as any, settings as any);
  return { service, calls, session, payslip, period, payments, createdPayslips, attendance };
}

const actor = { id: 'u1', name: 'Admin' };
const cashPay = (amount: number, key: string) => ({
  amount,
  paymentMethod: 'CASH_REGISTER',
  cashRegisterId: 'r1',
  idempotencyKey: key,
});

describe('payroll money safety', () => {
  it('calculation creates payslips but never touches cash or salary payments', async () => {
    const w = makeWorld({ periodStatus: 'DRAFT' });
    await w.service.calculate('p1', actor);
    // Unfinished months must be completed from the schedule, never truncated at "today".
    expect(w.attendance.payrollDays).toHaveBeenCalledWith(['e1'], '2026-10-01', '2026-10-31', { fillUnprocessed: true });
    expect(w.createdPayslips).toHaveLength(1);
    expect(Number(w.createdPayslips[0].netSalary)).toBe(42_000);
    const moneyCalls = w.calls.filter((c) => c.model.startsWith('cashRegister') || c.model === 'hrSalaryPayment');
    expect(moneyCalls).toEqual([]);
    expect(w.session.cashOut).toBe(0);
  });

  it('a cash payment posts exactly one cash-out and marks the payslip paid', async () => {
    const w = makeWorld();
    const r = await w.service.pay('s1', cashPay(42_000, 'key-00000001'), actor);
    expect(r.duplicate).toBe(false);
    expect(w.session.cashOut).toBe(42_000);
    expect(w.payments).toHaveLength(1);
    expect(w.payments[0].cashSessionId).toBe('sess1');
    expect(w.payslip.paymentStatus).toBe('PAID');
    expect(w.period.status).toBe('PAID');
  });

  it('retrying with the same idempotency key does not pay twice', async () => {
    const w = makeWorld();
    await w.service.pay('s1', cashPay(10_000, 'key-00000002'), actor);
    const again = await w.service.pay('s1', cashPay(10_000, 'key-00000002'), actor);
    expect(again.duplicate).toBe(true);
    expect(w.session.cashOut).toBe(10_000);
    expect(w.payments).toHaveLength(1);
  });

  it('partial payments accumulate and cannot exceed the net salary', async () => {
    const w = makeWorld();
    await w.service.pay('s1', cashPay(10_000, 'key-00000003'), actor);
    expect(w.payslip.paymentStatus).toBe('PARTIAL');
    await expect(w.service.pay('s1', cashPay(32_001, 'key-00000004'), actor)).rejects.toThrow(/يتجاوز المتبقي/);
    expect(w.session.cashOut).toBe(10_000);
    await w.service.pay('s1', cashPay(32_000, 'key-00000005'), actor);
    expect(w.session.cashOut).toBe(42_000);
    expect(w.payslip.paymentStatus).toBe('PAID');
  });

  it('refuses a cash payment larger than the cash available in the register', async () => {
    const w = makeWorld({ openingCash: 5_000 });
    await expect(w.service.pay('s1', cashPay(42_000, 'key-00000006'), actor)).rejects.toThrow(/النقد المتوفر/);
    expect(w.session.cashOut).toBe(0);
    expect(w.payments).toHaveLength(0);
    expect(w.payslip.paidAmount).toBe(0);
  });

  it('bank transfers never touch the cash register', async () => {
    const w = makeWorld();
    await w.service.pay('s1', { amount: 42_000, paymentMethod: 'BANK_TRANSFER', idempotencyKey: 'key-00000007' }, actor);
    expect(w.calls.filter((c) => c.model.startsWith('cashRegister'))).toEqual([]);
    expect(w.payments[0].cashSessionId).toBeUndefined();
  });

  it('cancelling a payment reverses the cash-out on the same session, once', async () => {
    const w = makeWorld();
    const { payment } = await w.service.pay('s1', cashPay(42_000, 'key-00000008'), actor);
    await w.service.cancelPayment(payment.id, 'erreur de saisie', actor);
    expect(w.session.cashOut).toBe(0);
    expect(w.payslip.paymentStatus).toBe('UNPAID');
    expect(w.period.status).toBe('VALIDATED');
    await expect(w.service.cancelPayment(payment.id, 'encore', actor)).rejects.toThrow(/ملغاة مسبقاً/);
    expect(w.session.cashOut).toBe(0);
  });

  it('cannot pay a payslip of a period that is not validated', async () => {
    const w = makeWorld({ periodStatus: 'CALCULATED' });
    await expect(w.service.pay('s1', cashPay(1_000, 'key-00000009'), actor)).rejects.toThrow();
    expect(w.session.cashOut).toBe(0);
  });
});
