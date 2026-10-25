/**
 * Drives the real MillAssistanceService + PaymentsService against an in-memory Prisma
 * stand-in: session start, payment attachment, close with declared cash, the no-self-confirm
 * rule, confirmation, discrepancy and resolution, and immutability after confirmation.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- untyped in-memory Prisma fake */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MillAssistanceService } from './mill-assistance.service';
import { PaymentsService } from '../payments/payments.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

type Row = Record<string, any>;
const SEASON = 'season-1';

function createDb() {
  const state = {
    users: [
      { id: 'ahmed', username: 'ahmed', firstName: 'Ahmed', lastName: 'B', isActive: true, deletedAt: null, role: { name: 'OPERATOR', nameAr: 'عامل' } },
      { id: 'mohamed', username: 'mohamed', firstName: 'Mohamed', lastName: 'K', isActive: true, deletedAt: null, role: { name: 'OPERATOR', nameAr: 'عامل' } },
      { id: 'youcef', username: 'youcef', firstName: 'Youcef', lastName: 'M', isActive: true, deletedAt: null, role: { name: 'OPERATOR', nameAr: 'عامل' } },
    ] as Row[],
    sessions: [] as Row[],
    payments: [] as Row[],
    pressing: [
      { id: 'op1', oliveEntryId: 'e1', amount: 5000, paid: false, createdAt: new Date('2026-10-25T08:00:00Z'), oliveEntry: { id: 'e1', referenceNumber: 101, oliveType: 'GREEN', client: { id: 'c1', firstName: 'Ali', lastName: 'S', phone: '0555' } } },
      { id: 'op2', oliveEntryId: 'e2', amount: 3000, paid: false, createdAt: new Date('2026-10-25T08:10:00Z'), oliveEntry: { id: 'e2', referenceNumber: 102, oliveType: 'TAIEB', client: { id: 'c2', firstName: 'Samir', lastName: 'T', phone: null } } },
    ] as Row[],
    entries: [{ id: 'e1', status: 'PRESSED' }, { id: 'e2', status: 'PRESSED' }] as Row[],
    settings: [{ key: 'company_name', value: 'معصرة تجريبية' }] as Row[],
    seq: 0,
  };
  const id = (p: string) => `${p}-${++state.seq}`;
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return (v.in as unknown[]).includes(row[k]);
        if ('not' in v) return row[k] !== v.not;
        return true;
      }
      return row[k] === v;
    });
  const withPayments = (pr: Row) => ({ ...pr, payments: state.payments.filter((p) => p.pressingRecordId === pr.id) });
  const sessionInclude = (s: Row) => ({
    ...s,
    primaryOperator: state.users.find((u) => u.id === s.primaryOperatorId),
    assistant: state.users.find((u) => u.id === s.assistantId),
    confirmedBy: state.users.find((u) => u.id === s.confirmedById) ?? null,
    resolvedBy: state.users.find((u) => u.id === s.resolvedById) ?? null,
    assistantDevice: null,
    primaryDevice: null,
  });
  const byOrder = (rows: Row[], orderBy?: Row) => {
    if (!orderBy) return rows;
    const [[k, dir]] = Object.entries(orderBy) as [string, string][];
    return [...rows].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (dir === 'desc' ? -1 : 1));
  };

  const prisma: Row = {
    user: {
      findFirst: async ({ where }: Row) => state.users.find((u) => matches(u, where)) ?? null,
      findMany: async ({ where }: Row) => state.users.filter((u) => matches(u, where)),
    },
    setting: { findMany: async () => state.settings },
    millAssistanceSession: {
      findFirst: async ({ where, orderBy }: Row) => byOrder(state.sessions.filter((s) => matches(s, where)), orderBy)[0] ?? null,
      findMany: async ({ where, orderBy }: Row) => byOrder(state.sessions.filter((s) => matches(s, where)), orderBy).map(sessionInclude),
      findUnique: async ({ where }: Row) => {
        const s = state.sessions.find((x) => x.id === where.id);
        return s ? sessionInclude(s) : null;
      },
      create: async ({ data }: Row) => {
        if (state.sessions.some((s) => s.assistantId === data.assistantId && s.status === 'ACTIVE')) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { ...data, id: id('as'), status: 'ACTIVE', startedAt: new Date(), closedAt: null, difference: 0, declaredHandover: null, receivedHandover: null, confirmedAt: null, confirmedById: null, resolvedAt: null, resolvedById: null, resolutionNote: null, discrepancyNote: null, operationsCount: 0, paymentsCount: 0, totalCharged: 0, totalCollected: 0, totalCash: 0, totalNonCash: 0, totalOutstanding: 0, expectedHandover: 0 };
        state.sessions.push(row);
        return sessionInclude(row);
      },
      update: async ({ where, data }: Row) => {
        const s = state.sessions.find((x) => x.id === where.id)!;
        Object.assign(s, data);
        return sessionInclude(s);
      },
    },
    payment: {
      findMany: async ({ where }: Row) =>
        state.payments
          .filter((p) => matches(p, where))
          .map((p) => ({ ...p, pressingRecord: withPayments(state.pressing.find((r) => r.id === p.pressingRecordId)!) })),
      create: async ({ data }: Row) => {
        const row = { ...data, id: id('pay'), createdAt: new Date() };
        state.payments.push(row);
        const pr = withPayments(state.pressing.find((r) => r.id === data.pressingRecordId)!);
        return { ...row, pressingRecord: pr };
      },
      aggregate: async ({ where }: Row) => ({
        _sum: { amount: state.payments.filter((p) => matches(p, where)).reduce((s, p) => s + Number(p.amount), 0) },
      }),
    },
    pressingRecord: {
      findUnique: async ({ where }: Row) => {
        const r = state.pressing.find((x) => x.id === where.id);
        return r ? withPayments(r) : null;
      },
      findMany: async ({ where }: Row) => state.pressing.filter((r) => matches(r, where)).map(withPayments),
      update: async ({ where, data }: Row) => Object.assign(state.pressing.find((x) => x.id === where.id)!, data),
    },
    oliveEntry: {
      update: async ({ where, data }: Row) => Object.assign(state.entries.find((x) => x.id === where.id)!, data),
    },
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
  };
  prisma.$transaction = async (cb: (tx: Row) => Promise<unknown>) => cb(prisma);
  return { prisma, state };
}

function setup() {
  const db = createDb();
  const audit = { log: jest.fn() };
  const assistance = new MillAssistanceService(
    db.prisma as never,
    { getSeasonId: async () => SEASON } as never,
    audit as never,
  );
  const payments = new PaymentsService(db.prisma as never, audit as never, assistance);
  return { ...db, assistance, payments, audit };
}

const user = (sub: string, permissions: string[] = []): JwtPayload =>
  ({ sub, username: sub, role: 'OPERATOR', permissions }) as unknown as JwtPayload;

const AHMED = user('ahmed', ['MILL_ASSIST_VIEW_ALL', 'MILL_ASSIST_CONFIRM', 'MILL_ASSIST_RESOLVE']);
const MOHAMED = user('mohamed', ['MILL_ASSIST_START', 'MILL_ASSIST_CLOSE']);
const YOUCEF = user('youcef', ['MILL_ASSIST_START', 'MILL_ASSIST_CLOSE']);

describe('mill operator assistance (service level)', () => {
  it('payments made during a session belong to that session and nobody else', async () => {
    const ctx = setup();
    const s: Row = await ctx.assistance.start({ primaryOperatorId: 'ahmed' }, MOHAMED);
    expect(s.status).toBe('ACTIVE');
    expect(s.reference).toBe('AS-00001');

    await ctx.payments.create({ pressingRecordId: 'op1', amount: 5000 }, 'mohamed');
    await ctx.payments.create({ pressingRecordId: 'op2', amount: 1000 }, 'mohamed');
    // Ahmed (no session) collects on op2 too: his money is NOT in Mohamed's session.
    await ctx.payments.create({ pressingRecordId: 'op2', amount: 500 }, 'ahmed');

    expect(ctx.state.payments.map((p) => p.assistanceSessionId)).toEqual([s.id, s.id, null]);
    const mine: Row = await ctx.assistance.mine(MOHAMED);
    expect(mine.active.totals).toMatchObject({
      operationsCount: 2,
      paymentsCount: 2,
      totalCharged: 8000,
      totalCollected: 6000,
      totalCash: 6000,
      totalOutstanding: 1500, // op2: 3000 − (1000 + 500)
      expectedHandover: 6000,
    });
  });

  it('one active session per assistant; you cannot assist yourself', async () => {
    const ctx = setup();
    await ctx.assistance.start({ primaryOperatorId: 'ahmed' }, MOHAMED);
    await expect(ctx.assistance.start({ primaryOperatorId: 'ahmed' }, MOHAMED)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.assistance.start({ primaryOperatorId: 'mohamed' }, MOHAMED)).rejects.toBeInstanceOf(BadRequestException);
    // A second assistant works in parallel with their own session number.
    const y: Row = await ctx.assistance.start({ primaryOperatorId: 'ahmed' }, YOUCEF);
    expect(y.sessionNumber).toBe(2);
  });

  it('close freezes totals; declared ≠ expected needs a reason; assistant cannot self-confirm', async () => {
    const ctx = setup();
    const s: Row = await ctx.assistance.start({ primaryOperatorId: 'ahmed' }, MOHAMED);
    await ctx.payments.create({ pressingRecordId: 'op1', amount: 5000 }, 'mohamed');

    await expect(ctx.assistance.close(s.id, { declaredHandover: 4500 }, MOHAMED)).rejects.toBeInstanceOf(BadRequestException);
    const closed: Row = await ctx.assistance.close(s.id, { declaredHandover: 4500, discrepancyNote: 'نقص 500' }, MOHAMED);
    expect(closed.status).toBe('AWAITING_CONFIRMATION');
    expect(closed.totals.expectedHandover).toBe(5000);
    expect(closed.declaredHandover).toBe(4500);
    expect(closed.difference).toBe(-500);

    // Later payments by the same user no longer attach to the closed session.
    await ctx.payments.create({ pressingRecordId: 'op2', amount: 1000 }, 'mohamed');
    expect(ctx.state.payments[1].assistanceSessionId).toBeNull();
    const detail: Row = await ctx.assistance.detail(s.id, MOHAMED);
    expect(detail.totals.expectedHandover).toBe(5000);

    await expect(ctx.assistance.confirm(s.id, { receivedHandover: 4500 }, MOHAMED)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctx.assistance.close(s.id, { declaredHandover: 5000 }, MOHAMED)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('primary confirms the exact amount → CONFIRMED and locked', async () => {
    const ctx = setup();
    const s: Row = await ctx.assistance.start({ primaryOperatorId: 'ahmed' }, MOHAMED);
    await ctx.payments.create({ pressingRecordId: 'op1', amount: 5000 }, 'mohamed');
    await ctx.assistance.close(s.id, { declaredHandover: 5000 }, MOHAMED);
    await expect(ctx.assistance.confirm(s.id, { receivedHandover: 5000 }, YOUCEF)).rejects.toBeInstanceOf(ForbiddenException);

    const c: Row = await ctx.assistance.confirm(s.id, { receivedHandover: 5000 }, AHMED);
    expect(c.status).toBe('CONFIRMED');
    expect(c.confirmedBy.id).toBe('ahmed');
    await expect(ctx.assistance.confirm(s.id, { receivedHandover: 1 }, AHMED)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.assistance.resolve(s.id, { resolutionNote: 'x' }, AHMED)).rejects.toBeInstanceOf(BadRequestException);
    // Confirming created no money: still exactly one payment row.
    expect(ctx.state.payments).toHaveLength(1);
  });

  it('a short handover becomes a DISCREPANCY that only a resolution closes', async () => {
    const ctx = setup();
    const s: Row = await ctx.assistance.start({ primaryOperatorId: 'ahmed' }, MOHAMED);
    await ctx.payments.create({ pressingRecordId: 'op1', amount: 5000 }, 'mohamed');
    await ctx.assistance.close(s.id, { declaredHandover: 5000 }, MOHAMED);

    await expect(ctx.assistance.confirm(s.id, { receivedHandover: 4800 }, AHMED)).rejects.toBeInstanceOf(BadRequestException);
    const d: Row = await ctx.assistance.confirm(s.id, { receivedHandover: 4800, note: 'ورقة 200 ناقصة' }, AHMED);
    expect(d.status).toBe('DISCREPANCY');
    expect(d.difference).toBe(-200);

    const dash: Row = await ctx.assistance.dashboard(AHMED);
    expect(dash.discrepancies).toHaveLength(1);
    expect(dash.summary.cashConfirmedToday).toBe(0);

    await expect(ctx.assistance.resolve(s.id, { resolutionNote: 'يخصم من المساعد' }, MOHAMED)).rejects.toBeInstanceOf(ForbiddenException);
    const r: Row = await ctx.assistance.resolve(s.id, { resolutionNote: 'يخصم من المساعد' }, AHMED);
    expect(r.status).toBe('CONFIRMED');
    expect(r.resolvedBy.id).toBe('ahmed');
    expect(ctx.audit.log).toHaveBeenCalled();
  });

  it('receipt payload lists each operation with what was collected here vs. still owed', async () => {
    const ctx = setup();
    const s: Row = await ctx.assistance.start({ primaryOperatorId: 'ahmed' }, MOHAMED);
    await ctx.payments.create({ pressingRecordId: 'op2', amount: 1000, method: 'CCP' }, 'mohamed');
    const receipt: Row = await ctx.assistance.receipt(s.id, MOHAMED);
    expect(receipt.company.name).toBe('معصرة تجريبية');
    expect(receipt.operations).toHaveLength(1);
    expect(receipt.operations[0]).toMatchObject({
      reference: 102,
      clientName: 'Samir T',
      amountDue: 3000,
      collectedInSession: 1000,
      collectedCashInSession: 0,
      outstanding: 2000,
    });
    expect(receipt.session.totals.totalNonCash).toBe(1000);
    expect(receipt.session.totals.expectedHandover).toBe(0);
  });
});
