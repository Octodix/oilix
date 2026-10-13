import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HrApprovalStatus, HrPayrollStatus, Prisma, type HrPayrollPeriod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import { SettingsService } from '../settings/settings.service';
import { dateKeyToDb, dbDateToKey, localDateKey, localTimeUtc, monthBounds } from './engine/hr-time';
import { computePayslip, round2, type PayrollContract, type PayrollResult } from './engine/payroll-engine';
import { HrAttendanceService } from './hr-attendance.service';
import { postCashOut, reverseCashOut } from './hr-cash';
import { HrSettingsService, type HrSettings } from './hr-settings.service';
import {
  fullName,
  isUniqueViolation,
  num,
  PAYMENT_METHODS,
  periodIndex,
  requireDateKey,
  requireMoney,
  requireYearMonth,
  type Actor,
} from './hr-common';

export type PaymentInput = {
  amount: number;
  paymentMethod: string;
  cashRegisterId?: string | null;
  paidAt?: string | null;
  reference?: string | null;
  notes?: string | null;
  idempotencyKey: string;
};

type Built = {
  employee: {
    id: string;
    matricule: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    workSite: string | null;
    hireDate: Date;
    leftAt: Date | null;
    socialSecurityNumber: string | null;
    nationalIdNumber: string | null;
    paymentMethod: string;
    bankAccount: string | null;
    department: { name: string } | null;
  };
  result: PayrollResult;
};

const EDITABLE: HrPayrollStatus[] = [HrPayrollStatus.DRAFT, HrPayrollStatus.CALCULATED, HrPayrollStatus.REVIEWED];

function lineSignature(lines: { code: string; kind: string; amount: unknown; sourceIds: string[] }[]) {
  return lines
    .map((l) => `${l.kind}|${l.code}|${num(l.amount as number).toFixed(2)}|${[...l.sourceIds].sort().join(',')}`)
    .sort()
    .join('\n');
}

@Injectable()
export class HrPayrollService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private attendance: HrAttendanceService,
    private hrSettings: HrSettingsService,
    private settings: SettingsService,
  ) {}

  // ── Periods ──────────────────────────────────────────────────────────────

  listPeriods() {
    return this.prisma.hrPayrollPeriod.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { _count: { select: { payslips: true, payments: { where: { status: 'POSTED' } } } } },
    });
  }

  async createPeriod(yearIn: number, monthIn: number, actor: Actor) {
    const { year, month } = requireYearMonth(yearIn, monthIn);
    const { start, end } = monthBounds(year, month);
    try {
      const row = await this.prisma.hrPayrollPeriod.create({
        data: { year, month, startDate: dateKeyToDb(start), endDate: dateKeyToDb(end) },
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.CREATE,
        module: AUDIT_MODULES.HR,
        description: `فتح فترة أجور ${String(month).padStart(2, '0')}/${year}`,
        entity: 'HrPayrollPeriod',
        entityId: row.id,
      });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('الفترة موجودة مسبقاً');
      throw e;
    }
  }

  private async period(id: string) {
    const p = await this.prisma.hrPayrollPeriod.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('فترة الأجور غير موجودة');
    return p;
  }

  async getPeriod(id: string) {
    const p = await this.prisma.hrPayrollPeriod.findUnique({
      where: { id },
      include: {
        payslips: {
          include: {
            employee: { select: { id: true, matricule: true, firstName: true, lastName: true, departmentId: true, paymentMethod: true } },
          },
          orderBy: { employee: { lastName: 'asc' } },
        },
      },
    });
    if (!p) throw new NotFoundException('فترة الأجور غير موجودة');
    return p;
  }

  private async build(period: HrPayrollPeriod, settings: HrSettings, reprocess: boolean): Promise<Built[]> {
    const start = dbDateToKey(period.startDate);
    const end = dbDateToKey(period.endDate);
    if (reprocess) await this.attendance.process({ from: start, to: end });
    const startDb = period.startDate;
    const endDb = period.endDate;
    const employees = await this.prisma.hrEmployee.findMany({
      where: { hireDate: { lte: endDb }, OR: [{ leftAt: null }, { leftAt: { gte: startDb } }] },
      include: {
        department: { select: { name: true } },
        contracts: {
          where: { startDate: { lte: endDb }, OR: [{ endDate: null }, { endDate: { gte: startDb } }] },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const ids = employees.map((e) => e.id);
    const idx = periodIndex(period.year, period.month);
    const [days, overtime, bonuses, deductions, advances, loans] = await Promise.all([
      this.attendance.payrollDays(ids, start, end, { fillUnprocessed: true }),
      this.prisma.hrOvertime.findMany({
        where: {
          employeeId: { in: ids },
          date: { gte: startDb, lte: endDb },
          status: { in: [HrApprovalStatus.APPROVED, HrApprovalStatus.PENDING] },
          payslipId: null,
        },
      }),
      this.prisma.hrBonus.findMany({
        where: { employeeId: { in: ids }, year: period.year, month: period.month, status: HrApprovalStatus.APPROVED, payslipId: null },
      }),
      this.prisma.hrDeduction.findMany({
        where: { employeeId: { in: ids }, year: period.year, month: period.month, status: HrApprovalStatus.APPROVED, payslipId: null },
      }),
      this.prisma.hrAdvance.findMany({ where: { employeeId: { in: ids }, status: 'OPEN', deductedPayslipId: null } }),
      this.prisma.hrLoan.findMany({ where: { employeeId: { in: ids }, status: 'ACTIVE' }, include: { repayments: true } }),
    ]);

    return employees.map((e) => {
      const contracts: PayrollContract[] = e.contracts.map((c) => ({
        id: c.id,
        startDate: dbDateToKey(c.startDate),
        endDate: c.endDate ? dbDateToKey(c.endDate) : null,
        salaryMode: c.salaryMode,
        baseSalary: num(c.baseSalary),
        weeklyHours: num(c.weeklyHours),
        contractType: c.contractType,
        jobTitle: c.jobTitle,
      }));
      const result = computePayslip({
        period: { year: period.year, month: period.month, start, end },
        contracts,
        days: days.get(e.id) ?? [],
        overtime: overtime
          .filter((o) => o.employeeId === e.id)
          .map((o) => ({
            id: o.id,
            date: dbDateToKey(o.date),
            minutes: o.status === HrApprovalStatus.APPROVED ? o.approvedMinutes ?? 0 : o.requestedMinutes,
            multiplier: num(o.multiplier),
            status: o.status as 'APPROVED' | 'PENDING',
          })),
        bonuses: bonuses
          .filter((b) => b.employeeId === e.id)
          .map((b) => ({ id: b.id, type: b.bonusType, label: b.bonusType, amount: num(b.amount), category: b.category === 'ALLOWANCE' ? 'ALLOWANCE' : 'BONUS' })),
        deductions: deductions
          .filter((d) => d.employeeId === e.id)
          .map((d) => ({ id: d.id, type: d.deductionType, label: `${d.deductionType} — ${d.reason}`, amount: num(d.amount) })),
        advances: advances
          .filter((a) => a.employeeId === e.id && periodIndex(a.deductYear, a.deductMonth) <= idx)
          .map((a) => ({ id: a.id, amount: num(a.amount), date: dbDateToKey(a.date) })),
        loans: loans
          .filter((l) => l.employeeId === e.id && periodIndex(l.startYear, l.startMonth) <= idx)
          .map((l) => ({
            id: l.id,
            installment: num(l.installmentAmount),
            remaining: round2(num(l.principal) - l.repayments.reduce((s, r) => s + num(r.amount), 0)),
          })),
        policy: settings.payroll,
      });
      return { employee: e, result };
    });
  }

  async calculate(id: string, actor: Actor) {
    const period = await this.period(id);
    if (!EDITABLE.includes(period.status)) throw new BadRequestException('الفترة مصادق عليها — أعد فتحها لإعادة الحساب');
    const settings = await this.hrSettings.get();
    const built = await this.build(period, settings, true);
    const today = localDateKey(new Date(), settings.timezoneOffsetMinutes);
    const periodWarnings: string[] = [];
    if (dbDateToKey(period.endDate) > today) periodWarnings.push('PERIOD_NOT_FINISHED');
    const pendingOt = built.reduce((s, b) => s + (b.result.warnings.find((w) => w.startsWith('PENDING_OVERTIME')) ? 1 : 0), 0);
    if (pendingOt) periodWarnings.push(`PENDING_OVERTIME_EMPLOYEES:${pendingOt}`);

    const totals = built.reduce(
      (t, b) => ({
        gross: t.gross + b.result.grossEarnings,
        deductions: t.deductions + b.result.totalDeductions,
        net: t.net + b.result.netSalary,
      }),
      { gross: 0, deductions: 0, net: 0 },
    );

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM hr_payroll_periods WHERE id = ${id} FOR UPDATE`;
        const locked = await tx.hrPayrollPeriod.findUnique({ where: { id } });
        if (!locked || !EDITABLE.includes(locked.status)) throw new BadRequestException('تغيرت حالة الفترة');
        await tx.hrPayslip.deleteMany({ where: { periodId: id, status: 'CALCULATED' } });
        for (const b of built) {
          const r = b.result;
          await tx.hrPayslip.create({
            data: {
              periodId: id,
              employeeId: b.employee.id,
              status: 'CALCULATED',
              employeeSnapshot: {
                matricule: b.employee.matricule,
                firstName: b.employee.firstName,
                lastName: b.employee.lastName,
                fullName: fullName(b.employee),
                jobTitle: r.contract?.jobTitle ?? b.employee.jobTitle,
                department: b.employee.department?.name ?? null,
                workSite: b.employee.workSite,
                hireDate: dbDateToKey(b.employee.hireDate),
                leftAt: b.employee.leftAt ? dbDateToKey(b.employee.leftAt) : null,
                socialSecurityNumber: b.employee.socialSecurityNumber,
                nationalIdNumber: b.employee.nationalIdNumber,
                paymentMethod: b.employee.paymentMethod,
                bankAccount: b.employee.bankAccount,
              },
              contractId: r.contract?.id ?? null,
              contractSnapshot: (r.contract as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
              attendanceSummary: r.summary as unknown as Prisma.InputJsonValue,
              salaryMode: r.salaryMode,
              baseSalary: r.baseSalary,
              dailyRate: r.dailyRate,
              hourlyRate: r.hourlyRate,
              grossEarnings: r.grossEarnings,
              totalDeductions: r.totalDeductions,
              netSalary: r.netSalary,
              warnings: r.warnings,
              lines: {
                create: r.lines.map((l) => ({
                  kind: l.kind,
                  code: l.code,
                  label: l.label,
                  labelFr: l.labelFr,
                  quantity: l.quantity,
                  unit: l.unit,
                  rate: l.rate,
                  amount: l.amount,
                  sourceType: l.sourceType,
                  sourceIds: l.sourceIds,
                  explanation: l.explanation,
                  sortOrder: l.sortOrder,
                })),
              },
            },
          });
        }
        await tx.hrPayrollPeriod.update({
          where: { id },
          data: {
            status: HrPayrollStatus.CALCULATED,
            employeeCount: built.length,
            totalGross: round2(totals.gross),
            totalDeductions: round2(totals.deductions),
            totalNet: round2(totals.net),
            totalPaid: 0,
            warnings: {
              period: periodWarnings,
              employees: built
                .filter((b) => b.result.warnings.length)
                .map((b) => ({ employeeId: b.employee.id, name: fullName(b.employee), warnings: b.result.warnings })),
            },
            calculatedAt: new Date(),
            calculatedById: actor.id,
            calculatedByName: actor.name,
            reviewedAt: null,
            reviewedById: null,
            reviewedByName: null,
          },
        });
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CALCULATE,
      module: AUDIT_MODULES.HR,
      description: `حساب أجور ${String(period.month).padStart(2, '0')}/${period.year}: ${built.length} موظف، صافي ${round2(totals.net)} د.ج (دون أي حركة نقدية)`,
      entity: 'HrPayrollPeriod',
      entityId: id,
    });
    return this.getPeriod(id);
  }

  async review(id: string, actor: Actor) {
    const p = await this.period(id);
    if (p.status !== HrPayrollStatus.CALCULATED) throw new BadRequestException('يجب حساب الفترة أولاً');
    const claim = await this.prisma.hrPayrollPeriod.updateMany({
      where: { id, status: HrPayrollStatus.CALCULATED },
      data: { status: HrPayrollStatus.REVIEWED, reviewedAt: new Date(), reviewedById: actor.id, reviewedByName: actor.name },
    });
    if (claim.count !== 1) throw new BadRequestException('تغيرت حالة الفترة');
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.VALIDATE,
      module: AUDIT_MODULES.HR,
      description: `مراجعة أجور ${String(p.month).padStart(2, '0')}/${p.year}`,
      entity: 'HrPayrollPeriod',
      entityId: id,
    });
    return this.getPeriod(id);
  }

  async validate(id: string, dto: { force?: boolean; reason?: string | null }, actor: Actor) {
    const period = await this.period(id);
    if (period.status !== HrPayrollStatus.REVIEWED) throw new BadRequestException('يجب مراجعة الفترة قبل المصادقة');
    const settings = await this.hrSettings.get();
    const stored = await this.prisma.hrPayslip.findMany({ where: { periodId: id }, include: { lines: true, employee: true } });

    const blockers: string[] = [];
    const today = localDateKey(new Date(), settings.timezoneOffsetMinutes);
    if (dbDateToKey(period.endDate) > today) blockers.push('الشهر لم ينتهِ بعد');
    if (settings.payroll.blockValidationOnMissingPunch) {
      const missing = stored.filter((p) => ((p.warnings as string[] | null) ?? []).some((w) => w.startsWith('MISSING_PUNCH_DAYS')));
      if (missing.length) blockers.push(`تسجيلات ناقصة غير معالجة لدى: ${missing.map((p) => fullName(p.employee)).join('، ')}`);
    }
    const negative = stored.filter((p) => num(p.netSalary) < 0);
    if (negative.length) blockers.push(`صافي سالب لدى: ${negative.map((p) => fullName(p.employee)).join('، ')}`);
    if (blockers.length && !dto.force) {
      throw new BadRequestException(`لا يمكن المصادقة: ${blockers.join(' — ')}. (يمكن الفرض مع ذكر السبب)`);
    }
    if (blockers.length && (!dto.reason || dto.reason.trim().length < 5)) {
      throw new BadRequestException('المصادقة المفروضة تتطلب سبباً واضحاً');
    }

    // Anything that changed since the calculation (new punch, approval, contract edit) ⇒ recalculate first.
    const fresh = await this.build(period, settings, false);
    const storedBy = new Map(stored.map((p) => [p.employeeId, p]));
    const drift: string[] = [];
    for (const b of fresh) {
      const s = storedBy.get(b.employee.id);
      if (!s || num(s.netSalary) !== b.result.netSalary || lineSignature(s.lines) !== lineSignature(b.result.lines)) {
        drift.push(fullName(b.employee));
      }
      storedBy.delete(b.employee.id);
    }
    for (const s of storedBy.values()) drift.push(fullName(s.employee));
    if (drift.length) {
      throw new BadRequestException(`تغيرت البيانات منذ آخر حساب (${drift.slice(0, 8).join('، ')}) — أعد الحساب ثم المراجعة`);
    }

    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM hr_payroll_periods WHERE id = ${id} FOR UPDATE`;
        const locked = await tx.hrPayrollPeriod.findUnique({ where: { id } });
        if (locked?.status !== HrPayrollStatus.REVIEWED) throw new BadRequestException('تغيرت حالة الفترة');

        for (const p of stored) {
          const ids = (type: string) => p.lines.filter((l) => l.sourceType === type).flatMap((l) => l.sourceIds);
          const expect = async (label: string, n: number, expected: number) => {
            if (n !== expected) throw new BadRequestException(`${label}: تغيرت البيانات أثناء المصادقة لدى ${fullName(p.employee)} — أعد الحساب`);
          };

          const otIds = ids('OVERTIME');
          if (otIds.length) {
            const approved = await tx.hrOvertime.updateMany({
              where: { id: { in: otIds }, payslipId: null, status: HrApprovalStatus.APPROVED },
              data: { payslipId: p.id },
            });
            let linked = approved.count;
            if (!settings.payroll.overtimeRequiresApproval) {
              const pending = await tx.hrOvertime.findMany({ where: { id: { in: otIds }, payslipId: null, status: HrApprovalStatus.PENDING } });
              for (const o of pending) {
                await tx.hrOvertime.update({
                  where: { id: o.id },
                  data: {
                    payslipId: p.id,
                    status: HrApprovalStatus.APPROVED,
                    approvedMinutes: o.requestedMinutes,
                    decidedByName: 'الأجور (دون مصادقة مسبقة حسب الإعدادات)',
                    decidedAt: now,
                  },
                });
                linked++;
              }
            }
            await expect('الساعات الإضافية', linked, otIds.length);
          }
          const bonusIds = ids('BONUS');
          if (bonusIds.length) {
            const r = await tx.hrBonus.updateMany({
              where: { id: { in: bonusIds }, payslipId: null, status: HrApprovalStatus.APPROVED },
              data: { payslipId: p.id },
            });
            await expect('المنح', r.count, bonusIds.length);
          }
          const dedIds = ids('DEDUCTION');
          if (dedIds.length) {
            const r = await tx.hrDeduction.updateMany({
              where: { id: { in: dedIds }, payslipId: null, status: HrApprovalStatus.APPROVED },
              data: { payslipId: p.id },
            });
            await expect('الاقتطاعات', r.count, dedIds.length);
          }
          const advIds = ids('ADVANCE');
          if (advIds.length) {
            const r = await tx.hrAdvance.updateMany({
              where: { id: { in: advIds }, deductedPayslipId: null, status: 'OPEN' },
              data: { deductedPayslipId: p.id, status: 'DEDUCTED' },
            });
            await expect('التسبيقات', r.count, advIds.length);
          }
          for (const l of p.lines.filter((x) => x.sourceType === 'LOAN')) {
            const loanId = l.sourceIds[0];
            await tx.$queryRaw`SELECT id FROM hr_loans WHERE id = ${loanId} FOR UPDATE`;
            const loan = await tx.hrLoan.findUnique({ where: { id: loanId }, include: { repayments: true } });
            if (!loan || loan.status !== 'ACTIVE') await expect('القروض', 0, 1);
            const remaining = num(loan!.principal) - loan!.repayments.reduce((s, r) => s + num(r.amount), 0);
            if (num(l.amount) > remaining + 0.005) await expect('القروض', 0, 1);
            await tx.hrLoanRepayment.create({
              data: {
                loanId,
                payslipId: p.id,
                amount: num(l.amount),
                date: period.endDate,
                source: 'PAYROLL',
                createdById: actor.id,
                createdByName: actor.name,
              },
            });
            if (remaining - num(l.amount) < 0.005) await tx.hrLoan.update({ where: { id: loanId }, data: { status: 'COMPLETED' } });
          }
          await tx.hrPayslip.update({
            where: { id: p.id },
            data: { status: 'VALIDATED', lockedAt: now, paymentStatus: num(p.netSalary) <= 0 ? 'PAID' : 'UNPAID' },
          });
        }

        const allPaid = stored.every((p) => num(p.netSalary) <= 0);
        await tx.hrPayrollPeriod.update({
          where: { id },
          data: {
            status: allPaid ? HrPayrollStatus.PAID : HrPayrollStatus.VALIDATED,
            ...(allPaid ? { paidAt: now } : {}),
            validatedAt: now,
            validatedById: actor.id,
            validatedByName: actor.name,
            settingsSnapshot: settings as unknown as Prisma.InputJsonValue,
            notes: blockers.length ? `مصادقة مفروضة: ${dto.reason!.trim()} (${blockers.join(' — ')})` : period.notes,
          },
        });
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.VALIDATE,
      module: AUDIT_MODULES.HR,
      description: `المصادقة على أجور ${String(period.month).padStart(2, '0')}/${period.year} (${stored.length} كشف، صافي ${num(period.totalNet)} د.ج)${blockers.length ? ` — مفروضة: ${dto.reason!.trim()}` : ''}`,
      entity: 'HrPayrollPeriod',
      entityId: id,
      newData: { forced: blockers.length > 0, blockers, reason: dto.reason ?? null },
    });
    return this.getPeriod(id);
  }

  async reopen(id: string, reason: string, actor: Actor) {
    if (!reason?.trim() || reason.trim().length < 5) throw new BadRequestException('سبب إعادة الفتح إلزامي');
    const period = await this.period(id);
    if (period.status !== HrPayrollStatus.VALIDATED) {
      throw new BadRequestException(period.status === HrPayrollStatus.PAID ? 'ألغِ الدفعات أولاً قبل إعادة الفتح' : 'لا يمكن إعادة فتح هذه الفترة');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_payroll_periods WHERE id = ${id} FOR UPDATE`;
      const locked = await tx.hrPayrollPeriod.findUnique({ where: { id } });
      if (locked?.status !== HrPayrollStatus.VALIDATED) throw new BadRequestException('تغيرت حالة الفترة');
      const posted = await tx.hrSalaryPayment.count({ where: { periodId: id, status: 'POSTED' } });
      if (posted) throw new BadRequestException('توجد دفعات مسجلة — ألغِها أولاً');
      const payslipIds = (await tx.hrPayslip.findMany({ where: { periodId: id }, select: { id: true } })).map((p) => p.id);
      await tx.hrOvertime.updateMany({ where: { payslipId: { in: payslipIds } }, data: { payslipId: null } });
      await tx.hrBonus.updateMany({ where: { payslipId: { in: payslipIds } }, data: { payslipId: null } });
      await tx.hrDeduction.updateMany({ where: { payslipId: { in: payslipIds } }, data: { payslipId: null } });
      await tx.hrAdvance.updateMany({
        where: { deductedPayslipId: { in: payslipIds } },
        data: { deductedPayslipId: null, status: 'OPEN' },
      });
      const reps = await tx.hrLoanRepayment.findMany({ where: { payslipId: { in: payslipIds }, source: 'PAYROLL' } });
      await tx.hrLoanRepayment.deleteMany({ where: { id: { in: reps.map((r) => r.id) } } });
      await tx.hrLoan.updateMany({
        where: { id: { in: [...new Set(reps.map((r) => r.loanId))] }, status: 'COMPLETED' },
        data: { status: 'ACTIVE' },
      });
      await tx.hrPayslip.updateMany({
        where: { periodId: id },
        data: { status: 'CALCULATED', lockedAt: null, paymentStatus: 'UNPAID', paidAmount: 0 },
      });
      await tx.hrPayrollPeriod.update({
        where: { id },
        data: {
          status: HrPayrollStatus.CALCULATED,
          validatedAt: null,
          validatedById: null,
          validatedByName: null,
          reviewedAt: null,
          reviewedById: null,
          reviewedByName: null,
          settingsSnapshot: Prisma.JsonNull,
          totalPaid: 0,
          notes: `${period.notes ? `${period.notes}\n` : ''}أعيد فتحها: ${reason.trim()}`,
        },
      });
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.REOPEN,
      module: AUDIT_MODULES.HR,
      description: `إعادة فتح أجور ${String(period.month).padStart(2, '0')}/${period.year} — ${reason.trim()}`,
      entity: 'HrPayrollPeriod',
      entityId: id,
    });
    return this.getPeriod(id);
  }

  async close(id: string, actor: Actor) {
    const p = await this.period(id);
    if (p.status !== HrPayrollStatus.PAID) throw new BadRequestException('لا تُغلق الفترة إلا بعد دفع كل الأجور');
    const claim = await this.prisma.hrPayrollPeriod.updateMany({
      where: { id, status: HrPayrollStatus.PAID },
      data: { status: HrPayrollStatus.CLOSED, closedAt: new Date(), closedById: actor.id, closedByName: actor.name },
    });
    if (claim.count !== 1) throw new BadRequestException('تغيرت حالة الفترة');
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CLOSE,
      module: AUDIT_MODULES.HR,
      description: `إغلاق أجور ${String(p.month).padStart(2, '0')}/${p.year}`,
      entity: 'HrPayrollPeriod',
      entityId: id,
    });
    return this.getPeriod(id);
  }

  async getPayslip(id: string) {
    const p = await this.prisma.hrPayslip.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'asc' } },
        period: true,
        employee: { select: { id: true, matricule: true, firstName: true, lastName: true, photo: true } },
      },
    });
    if (!p) throw new NotFoundException('كشف الأجر غير موجود');
    return { ...p, company: await this.hrSettings.companyInfo() };
  }

  // ── Payments (the only place payroll touches cash) ───────────────────────

  async pay(payslipId: string, dto: PaymentInput, actor: Actor) {
    const existing = await this.prisma.hrSalaryPayment.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) return { payment: existing, duplicate: true };
    if (!(PAYMENT_METHODS as readonly string[]).includes(dto.paymentMethod)) throw new BadRequestException('طريقة الدفع غير صالحة');
    if (dto.paymentMethod === 'CASH_REGISTER' && !dto.cashRegisterId) throw new BadRequestException('اختر الصندوق');
    const amount = requireMoney(dto.amount);
    const settings = await this.hrSettings.get();
    const paidAt = dto.paidAt
      ? localTimeUtc(requireDateKey(dto.paidAt, 'تاريخ الدفع'), 12 * 60, settings.timezoneOffsetMinutes)
      : new Date();
    const seasonId = dto.paymentMethod === 'CASH_REGISTER' ? await this.settings.getActiveSeasonId() : null;

    try {
      const out = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM hr_payslips WHERE id = ${payslipId} FOR UPDATE`;
        const slip = await tx.hrPayslip.findUnique({ where: { id: payslipId }, include: { period: true, employee: true } });
        if (!slip) throw new NotFoundException('كشف الأجر غير موجود');
        if (slip.status !== 'VALIDATED') throw new BadRequestException('لا يمكن دفع كشف غير مصادق عليه');
        if (slip.period.status !== HrPayrollStatus.VALIDATED && slip.period.status !== HrPayrollStatus.PAID) {
          throw new BadRequestException('فترة الأجور مغلقة أو غير مصادق عليها');
        }
        const net = num(slip.netSalary);
        const paid = num(slip.paidAmount);
        const remaining = round2(net - paid);
        if (remaining <= 0) throw new BadRequestException('الأجر مدفوع بالكامل');
        if (amount > remaining + 0.005) throw new BadRequestException(`المبلغ يتجاوز المتبقي (${remaining.toFixed(2)} د.ج)`);
        if (!settings.payroll.allowPartialPayments && Math.abs(amount - remaining) > 0.005) {
          throw new BadRequestException('الدفع الجزئي غير مسموح في الإعدادات');
        }
        const cash =
          dto.paymentMethod === 'CASH_REGISTER' ? await postCashOut(tx, { registerId: dto.cashRegisterId!, amount, seasonId: seasonId! }) : {};
        const payment = await tx.hrSalaryPayment.create({
          data: {
            payslipId,
            periodId: slip.periodId,
            employeeId: slip.employeeId,
            amount,
            paidAt,
            paymentMethod: dto.paymentMethod,
            ...cash,
            reference: dto.reference?.trim() || null,
            notes: dto.notes?.trim() || null,
            idempotencyKey: dto.idempotencyKey,
            paidById: actor.id,
            paidByName: actor.name,
          },
        });
        const newPaid = round2(paid + amount);
        await tx.hrPayslip.update({
          where: { id: payslipId },
          data: { paidAmount: newPaid, paymentStatus: newPaid >= net - 0.005 ? 'PAID' : 'PARTIAL' },
        });
        await tx.hrPayrollPeriod.update({ where: { id: slip.periodId }, data: { totalPaid: { increment: amount } } });
        const unpaid = await tx.hrPayslip.count({ where: { periodId: slip.periodId, paymentStatus: { not: 'PAID' } } });
        if (unpaid === 0) {
          await tx.hrPayrollPeriod.update({ where: { id: slip.periodId }, data: { status: HrPayrollStatus.PAID, paidAt: new Date() } });
        }
        return { payment, slip, remaining: round2(remaining - amount) };
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.PAY,
        module: AUDIT_MODULES.HR,
        description: `دفع أجر ${fullName(out.slip.employee)} (${String(out.slip.period.month).padStart(2, '0')}/${out.slip.period.year}): ${amount} د.ج ${dto.paymentMethod}${out.payment.cashRegisterName ? ` — ${out.payment.cashRegisterName}` : ''}، المتبقي ${out.remaining.toFixed(2)} د.ج`,
        entity: 'HrSalaryPayment',
        entityId: out.payment.id,
      });
      return { payment: out.payment, duplicate: false };
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await this.prisma.hrSalaryPayment.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
        if (again) return { payment: again, duplicate: true };
      }
      throw e;
    }
  }

  async payAll(periodId: string, dto: Omit<PaymentInput, 'amount'>, actor: Actor) {
    const period = await this.period(periodId);
    if (period.status !== HrPayrollStatus.VALIDATED) throw new BadRequestException('الفترة غير مصادق عليها أو مدفوعة');
    const slips = await this.prisma.hrPayslip.findMany({
      where: { periodId, status: 'VALIDATED', paymentStatus: { not: 'PAID' } },
      include: { employee: true },
    });
    const results: { payslipId: string; name: string; ok: boolean; amount?: number; error?: string }[] = [];
    for (const s of slips) {
      const amount = round2(num(s.netSalary) - num(s.paidAmount));
      if (amount <= 0) continue;
      try {
        await this.pay(s.id, { ...dto, amount, idempotencyKey: `${dto.idempotencyKey}:${s.id}` }, actor);
        results.push({ payslipId: s.id, name: fullName(s.employee), ok: true, amount });
      } catch (e) {
        results.push({ payslipId: s.id, name: fullName(s.employee), ok: false, error: (e as Error).message });
      }
    }
    return { results, paid: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  async cancelPayment(id: string, reason: string, actor: Actor) {
    if (!reason?.trim()) throw new BadRequestException('سبب الإلغاء إلزامي');
    const out = await this.prisma.$transaction(async (tx) => {
      const pay = await tx.hrSalaryPayment.findUnique({ where: { id } });
      if (!pay) throw new NotFoundException('الدفعة غير موجودة');
      await tx.$queryRaw`SELECT id FROM hr_payslips WHERE id = ${pay.payslipId} FOR UPDATE`;
      const period = await tx.hrPayrollPeriod.findUnique({ where: { id: pay.periodId } });
      if (period?.status === HrPayrollStatus.CLOSED) throw new BadRequestException('فترة الأجور مغلقة');
      const claim = await tx.hrSalaryPayment.updateMany({
        where: { id, status: 'POSTED' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.id, cancelledByName: actor.name, cancelReason: reason.trim() },
      });
      if (claim.count !== 1) throw new BadRequestException('الدفعة ملغاة مسبقاً');
      if (pay.cashSessionId) await reverseCashOut(tx, { sessionId: pay.cashSessionId, amount: num(pay.amount) });
      const slip = await tx.hrPayslip.findUnique({ where: { id: pay.payslipId }, include: { employee: true } });
      const newPaid = round2(num(slip!.paidAmount) - num(pay.amount));
      await tx.hrPayslip.update({
        where: { id: pay.payslipId },
        data: { paidAmount: newPaid, paymentStatus: newPaid <= 0.005 ? 'UNPAID' : 'PARTIAL' },
      });
      await tx.hrPayrollPeriod.update({
        where: { id: pay.periodId },
        data: {
          totalPaid: { decrement: num(pay.amount) },
          ...(period?.status === HrPayrollStatus.PAID ? { status: HrPayrollStatus.VALIDATED, paidAt: null } : {}),
        },
      });
      return { pay, slip: slip! };
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CANCEL,
      module: AUDIT_MODULES.HR,
      description: `إلغاء دفعة أجر ${num(out.pay.amount)} د.ج لـ ${fullName(out.slip.employee)} — ${reason.trim()}`,
      entity: 'HrSalaryPayment',
      entityId: id,
    });
    return { ok: true };
  }

  async listPayments(q: { periodId?: string; employeeId?: string; from?: string; to?: string; status?: string }) {
    const tz = (await this.hrSettings.get()).timezoneOffsetMinutes;
    return this.prisma.hrSalaryPayment.findMany({
      where: {
        ...(q.periodId ? { periodId: q.periodId } : {}),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.from ? { paidAt: { gte: localTimeUtc(q.from, 0, tz) } } : {}),
        ...(q.to ? { paidAt: { ...(q.from ? { gte: localTimeUtc(q.from, 0, tz) } : {}), lt: localTimeUtc(q.to, 24 * 60, tz) } } : {}),
      },
      include: {
        employee: { select: { id: true, matricule: true, firstName: true, lastName: true } },
        period: { select: { id: true, year: true, month: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 1000,
    });
  }
}
