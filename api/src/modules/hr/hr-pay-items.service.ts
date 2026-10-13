import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HrApprovalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import { SettingsService } from '../settings/settings.service';
import { dateKeyToDb, dbDateToKey, localTimeUtc } from './engine/hr-time';
import { postCashOut, reverseCashOut, type CashPosting } from './hr-cash';
import { HrLocksService } from './hr-locks.service';
import { HrSettingsService } from './hr-settings.service';
import {
  fullName,
  isUniqueViolation,
  num,
  PAYMENT_METHODS,
  requireDateKey,
  requireMoney,
  requireYearMonth,
  type Actor,
} from './hr-common';

export const EXPENSE_CATEGORIES = [
  'SOCIAL_CONTRIBUTION',
  'INSURANCE',
  'MEDICAL',
  'TRAINING',
  'UNIFORM',
  'TRANSPORT',
  'MEAL',
  'RECRUITMENT',
  'OTHER',
] as const;

const employeeBrief = { select: { id: true, matricule: true, firstName: true, lastName: true } } as const;

type MoneyOut = { paymentMethod: string; cashRegisterId?: string | null };

@Injectable()
export class HrPayItemsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private settings: SettingsService,
    private hrSettings: HrSettingsService,
    private locks: HrLocksService,
  ) {}

  private checkMethod(dto: MoneyOut) {
    if (!(PAYMENT_METHODS as readonly string[]).includes(dto.paymentMethod)) throw new BadRequestException('طريقة الدفع غير صالحة');
    if (dto.paymentMethod === 'CASH_REGISTER' && !dto.cashRegisterId) throw new BadRequestException('اختر الصندوق');
  }

  private async cashOut(tx: Prisma.TransactionClient, dto: MoneyOut, amount: number): Promise<Partial<CashPosting>> {
    if (dto.paymentMethod !== 'CASH_REGISTER') return {};
    const seasonId = await this.settings.getActiveSeasonId();
    return postCashOut(tx, { registerId: dto.cashRegisterId!, amount, seasonId });
  }

  async openCashRegisters() {
    const seasonId = await this.settings.getActiveSeasonId();
    const registers = await this.prisma.cashRegister.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: { sessions: { where: { status: 'OPEN', seasonId }, select: { id: true, openedAt: true }, take: 1 } },
    });
    return registers.map(({ sessions, ...r }) => ({ ...r, openSession: sessions[0] ?? null }));
  }

  // ── Overtime ─────────────────────────────────────────────────────────────

  listOvertime(q: { status?: HrApprovalStatus; employeeId?: string; from?: string; to?: string }) {
    return this.prisma.hrOvertime.findMany({
      where: {
        ...(q.status ? { status: q.status } : { status: { not: HrApprovalStatus.CANCELLED } }),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.from && q.to ? { date: { gte: dateKeyToDb(q.from), lte: dateKeyToDb(q.to) } } : {}),
      },
      include: { employee: employeeBrief, payslip: { select: { id: true, periodId: true } } },
      orderBy: [{ date: 'desc' }],
      take: 1000,
    });
  }

  async createOvertime(dto: { employeeId: string; date: string; minutes: number; reason: string; ruleCode?: string }, actor: Actor) {
    const date = requireDateKey(dto.date);
    await this.locks.assertDatesOpen(date, date);
    if (!(Number.isInteger(dto.minutes) && dto.minutes > 0 && dto.minutes <= 24 * 60)) throw new BadRequestException('المدة غير صالحة');
    if (!dto.reason?.trim()) throw new BadRequestException('السبب إلزامي');
    const rule = (['WORKDAY', 'REST_DAY', 'HOLIDAY'] as const).find((r) => r === dto.ruleCode) ?? 'WORKDAY';
    const settings = await this.hrSettings.get();
    const row = await this.prisma.hrOvertime.create({
      data: {
        employeeId: dto.employeeId,
        date: dateKeyToDb(date),
        source: 'MANUAL',
        calculatedMinutes: 0,
        requestedMinutes: dto.minutes,
        multiplier: settings.payroll.overtimeMultipliers[rule],
        ruleCode: rule,
        reason: dto.reason.trim(),
        createdById: actor.id,
      },
      include: { employee: true },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.HR,
      description: `طلب ساعات إضافية يدوي لـ ${fullName(row.employee)} يوم ${date} (${dto.minutes} د)`,
      entity: 'HrOvertime',
      entityId: row.id,
    });
    return row;
  }

  async decideOvertime(id: string, decision: 'APPROVE' | 'REJECT' | 'CANCEL', dto: { approvedMinutes?: number; note?: string | null }, actor: Actor) {
    const ot = await this.prisma.hrOvertime.findUnique({ where: { id }, include: { employee: true } });
    if (!ot) throw new NotFoundException('الساعات الإضافية غير موجودة');
    if (ot.payslipId) throw new BadRequestException('مدرجة في كشف أجر مصادق عليه');
    const date = dbDateToKey(ot.date);
    await this.locks.assertDatesOpen(date, date);
    if (decision !== 'CANCEL' && ot.status !== HrApprovalStatus.PENDING) throw new BadRequestException('تمت معالجتها مسبقاً');
    let approvedMinutes: number | null = null;
    if (decision === 'APPROVE') {
      approvedMinutes = dto.approvedMinutes ?? ot.requestedMinutes;
      if (!(Number.isInteger(approvedMinutes) && approvedMinutes > 0 && approvedMinutes <= ot.requestedMinutes)) {
        throw new BadRequestException(`المدة المصادق عليها يجب أن تكون بين 1 و ${ot.requestedMinutes} دقيقة`);
      }
    }
    if (decision === 'REJECT' && !dto.note?.trim()) throw new BadRequestException('سبب الرفض إلزامي');
    const status =
      decision === 'APPROVE' ? HrApprovalStatus.APPROVED : decision === 'REJECT' ? HrApprovalStatus.REJECTED : HrApprovalStatus.CANCELLED;
    const claim = await this.prisma.hrOvertime.updateMany({
      where: { id, status: ot.status, payslipId: null },
      data: {
        status,
        approvedMinutes,
        decidedById: actor.id,
        decidedByName: actor.name,
        decidedAt: new Date(),
        decisionNote: dto.note?.trim() || null,
      },
    });
    if (claim.count !== 1) throw new BadRequestException('تم تعديلها من مستخدم آخر');
    await this.audit.log({
      userId: actor.id,
      action: decision === 'APPROVE' ? AUDIT_ACTIONS.APPROVE : decision === 'REJECT' ? AUDIT_ACTIONS.REJECT : AUDIT_ACTIONS.CANCEL,
      module: AUDIT_MODULES.HR,
      description: `${decision === 'APPROVE' ? `المصادقة على ${approvedMinutes} د` : decision === 'REJECT' ? 'رفض' : 'إلغاء'} ساعات إضافية ${fullName(ot.employee)} يوم ${date} (محسوبة ${ot.calculatedMinutes} د)`,
      entity: 'HrOvertime',
      entityId: id,
    });
    return this.prisma.hrOvertime.findUnique({ where: { id } });
  }

  // ── Bonuses & deductions ─────────────────────────────────────────────────

  listBonuses(q: { year?: number; month?: number; employeeId?: string; status?: HrApprovalStatus }) {
    return this.prisma.hrBonus.findMany({
      where: {
        ...(q.year ? { year: q.year } : {}),
        ...(q.month ? { month: q.month } : {}),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      include: { employee: employeeBrief },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });
  }

  listDeductions(q: { year?: number; month?: number; employeeId?: string; status?: HrApprovalStatus }) {
    return this.prisma.hrDeduction.findMany({
      where: {
        ...(q.year ? { year: q.year } : {}),
        ...(q.month ? { month: q.month } : {}),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      include: { employee: employeeBrief },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });
  }

  async createBonus(
    dto: { employeeId: string; category?: 'BONUS' | 'ALLOWANCE'; bonusType: string; amount: number; year: number; month: number; reason?: string | null; approveNow?: boolean },
    actor: Actor,
  ) {
    const { year, month } = requireYearMonth(dto.year, dto.month);
    await this.locks.assertMonthOpen(year, month);
    const amount = requireMoney(dto.amount);
    const approve = !!dto.approveNow;
    const row = await this.prisma.hrBonus.create({
      data: {
        employeeId: dto.employeeId,
        category: dto.category === 'ALLOWANCE' ? 'ALLOWANCE' : 'BONUS',
        bonusType: dto.bonusType.trim(),
        amount,
        year,
        month,
        reason: dto.reason?.trim() || null,
        status: approve ? HrApprovalStatus.APPROVED : HrApprovalStatus.PENDING,
        createdById: actor.id,
        createdByName: actor.name,
        ...(approve ? { decidedById: actor.id, decidedByName: actor.name, decidedAt: new Date() } : {}),
      },
      include: { employee: true },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.HR,
      description: `${row.category === 'ALLOWANCE' ? 'تعويض' : 'منحة'} «${row.bonusType}» ${amount} د.ج لـ ${fullName(row.employee)} (${month}/${year})${approve ? ' — مصادق عليها' : ''}`,
      entity: 'HrBonus',
      entityId: row.id,
    });
    return row;
  }

  async createDeduction(
    dto: { employeeId: string; deductionType: string; amount: number; year: number; month: number; reason: string; approveNow?: boolean },
    actor: Actor,
  ) {
    const { year, month } = requireYearMonth(dto.year, dto.month);
    await this.locks.assertMonthOpen(year, month);
    const amount = requireMoney(dto.amount);
    if (!dto.reason?.trim()) throw new BadRequestException('سبب الاقتطاع إلزامي');
    const approve = !!dto.approveNow;
    const row = await this.prisma.hrDeduction.create({
      data: {
        employeeId: dto.employeeId,
        deductionType: dto.deductionType.trim(),
        amount,
        year,
        month,
        reason: dto.reason.trim(),
        status: approve ? HrApprovalStatus.APPROVED : HrApprovalStatus.PENDING,
        createdById: actor.id,
        createdByName: actor.name,
        ...(approve ? { decidedById: actor.id, decidedByName: actor.name, decidedAt: new Date() } : {}),
      },
      include: { employee: true },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.HR,
      description: `اقتطاع «${row.deductionType}» ${amount} د.ج من ${fullName(row.employee)} (${month}/${year}) — ${row.reason}`,
      entity: 'HrDeduction',
      entityId: row.id,
    });
    return row;
  }

  async decideItem(kind: 'bonus' | 'deduction', id: string, decision: 'APPROVE' | 'REJECT' | 'CANCEL', note: string | null, actor: Actor) {
    const row =
      kind === 'bonus'
        ? await this.prisma.hrBonus.findUnique({ where: { id }, include: { employee: true } })
        : await this.prisma.hrDeduction.findUnique({ where: { id }, include: { employee: true } });
    if (!row) throw new NotFoundException('العنصر غير موجود');
    if (row.payslipId) throw new BadRequestException('مدرج في كشف أجر مصادق عليه');
    await this.locks.assertMonthOpen(row.year, row.month);
    if (decision !== 'CANCEL' && row.status !== HrApprovalStatus.PENDING) throw new BadRequestException('تمت معالجته مسبقاً');
    if (decision === 'CANCEL' && row.status === HrApprovalStatus.CANCELLED) throw new BadRequestException('ملغى مسبقاً');
    const status =
      decision === 'APPROVE' ? HrApprovalStatus.APPROVED : decision === 'REJECT' ? HrApprovalStatus.REJECTED : HrApprovalStatus.CANCELLED;
    const data = { status, decidedById: actor.id, decidedByName: actor.name, decidedAt: new Date() };
    const where = { id, status: row.status, payslipId: null };
    const claim =
      kind === 'bonus' ? await this.prisma.hrBonus.updateMany({ where, data }) : await this.prisma.hrDeduction.updateMany({ where, data });
    if (claim.count !== 1) throw new BadRequestException('تم تعديله من مستخدم آخر');
    await this.audit.log({
      userId: actor.id,
      action: decision === 'APPROVE' ? AUDIT_ACTIONS.APPROVE : decision === 'REJECT' ? AUDIT_ACTIONS.REJECT : AUDIT_ACTIONS.CANCEL,
      module: AUDIT_MODULES.HR,
      description: `${decision === 'APPROVE' ? 'المصادقة على' : decision === 'REJECT' ? 'رفض' : 'إلغاء'} ${kind === 'bonus' ? 'منحة' : 'اقتطاع'} ${num(row.amount)} د.ج — ${fullName(row.employee)}${note ? ` — ${note}` : ''}`,
      entity: kind === 'bonus' ? 'HrBonus' : 'HrDeduction',
      entityId: id,
    });
    return { ok: true };
  }

  // ── Advances ─────────────────────────────────────────────────────────────

  listAdvances(q: { employeeId?: string; status?: string; from?: string; to?: string }) {
    return this.prisma.hrAdvance.findMany({
      where: {
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.from && q.to ? { date: { gte: dateKeyToDb(q.from), lte: dateKeyToDb(q.to) } } : {}),
      },
      include: { employee: employeeBrief, deductedPayslip: { select: { id: true, periodId: true } } },
      orderBy: { date: 'desc' },
      take: 1000,
    });
  }

  async createAdvance(
    dto: MoneyOut & {
      employeeId: string;
      amount: number;
      date: string;
      deductYear?: number;
      deductMonth?: number;
      reference?: string | null;
      notes?: string | null;
      idempotencyKey: string;
    },
    actor: Actor,
  ) {
    const existing = await this.prisma.hrAdvance.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) return existing;
    this.checkMethod(dto);
    const amount = requireMoney(dto.amount);
    const date = requireDateKey(dto.date);
    const { year, month } = requireYearMonth(dto.deductYear ?? Number(date.slice(0, 4)), dto.deductMonth ?? Number(date.slice(5, 7)));
    await this.locks.assertMonthOpen(year, month);
    const employee = await this.prisma.hrEmployee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) throw new NotFoundException('الموظف غير موجود');
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const cash = await this.cashOut(tx, dto, amount);
        return tx.hrAdvance.create({
          data: {
            employeeId: dto.employeeId,
            amount,
            date: dateKeyToDb(date),
            paymentMethod: dto.paymentMethod,
            ...cash,
            reference: dto.reference?.trim() || null,
            deductYear: year,
            deductMonth: month,
            notes: dto.notes?.trim() || null,
            idempotencyKey: dto.idempotencyKey,
            createdById: actor.id,
            createdByName: actor.name,
          },
        });
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.PAY,
        module: AUDIT_MODULES.HR,
        description: `تسبيق ${amount} د.ج لـ ${fullName(employee)} (${dto.paymentMethod}${row.cashRegisterName ? ` — ${row.cashRegisterName}` : ''})، يُقتطع من أجر ${month}/${year}`,
        entity: 'HrAdvance',
        entityId: row.id,
      });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await this.prisma.hrAdvance.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
        if (again) return again;
      }
      throw e;
    }
  }

  async cancelAdvance(id: string, reason: string, actor: Actor) {
    if (!reason?.trim()) throw new BadRequestException('سبب الإلغاء إلزامي');
    const adv = await this.prisma.hrAdvance.findUnique({ where: { id }, include: { employee: true } });
    if (!adv) throw new NotFoundException('التسبيق غير موجود');
    if (adv.status !== 'OPEN') throw new BadRequestException(adv.status === 'DEDUCTED' ? 'التسبيق مقتطع في أجر مصادق عليه' : 'ملغى مسبقاً');
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.hrAdvance.updateMany({
        where: { id, status: 'OPEN' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.id, cancelledByName: actor.name, cancelReason: reason.trim() },
      });
      if (claim.count !== 1) throw new BadRequestException('تم تعديله من مستخدم آخر');
      if (adv.cashSessionId) await reverseCashOut(tx, { sessionId: adv.cashSessionId, amount: num(adv.amount) });
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CANCEL,
      module: AUDIT_MODULES.HR,
      description: `إلغاء تسبيق ${num(adv.amount)} د.ج لـ ${fullName(adv.employee)} — ${reason.trim()}`,
      entity: 'HrAdvance',
      entityId: id,
    });
    return { ok: true };
  }

  // ── Loans ────────────────────────────────────────────────────────────────

  async listLoans(q: { employeeId?: string; status?: string }) {
    const rows = await this.prisma.hrLoan.findMany({
      where: { ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.status ? { status: q.status } : {}) },
      include: { employee: employeeBrief, repayments: { orderBy: { date: 'asc' } } },
      orderBy: { disbursedAt: 'desc' },
      take: 500,
    });
    return rows.map((l) => {
      const repaid = l.repayments.reduce((s, r) => s + num(r.amount), 0);
      return { ...l, repaid, remaining: Math.round((num(l.principal) - repaid) * 100) / 100 };
    });
  }

  async createLoan(
    dto: MoneyOut & {
      employeeId: string;
      principal: number;
      installmentAmount: number;
      startYear: number;
      startMonth: number;
      disbursedAt: string;
      reference?: string | null;
      notes?: string | null;
      idempotencyKey: string;
    },
    actor: Actor,
  ) {
    const existing = await this.prisma.hrLoan.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) return existing;
    this.checkMethod(dto);
    const principal = requireMoney(dto.principal, 'مبلغ القرض');
    const installment = requireMoney(dto.installmentAmount, 'القسط');
    if (installment > principal) throw new BadRequestException('القسط أكبر من مبلغ القرض');
    const { year, month } = requireYearMonth(dto.startYear, dto.startMonth);
    await this.locks.assertMonthOpen(year, month);
    const date = requireDateKey(dto.disbursedAt);
    const employee = await this.prisma.hrEmployee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) throw new NotFoundException('الموظف غير موجود');
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const cash = await this.cashOut(tx, dto, principal);
        return tx.hrLoan.create({
          data: {
            employeeId: dto.employeeId,
            principal,
            installmentAmount: installment,
            startYear: year,
            startMonth: month,
            disbursedAt: dateKeyToDb(date),
            paymentMethod: dto.paymentMethod,
            ...cash,
            reference: dto.reference?.trim() || null,
            notes: dto.notes?.trim() || null,
            idempotencyKey: dto.idempotencyKey,
            createdById: actor.id,
            createdByName: actor.name,
          },
        });
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.PAY,
        module: AUDIT_MODULES.HR,
        description: `قرض ${principal} د.ج لـ ${fullName(employee)}، قسط ${installment} د.ج ابتداءً من ${month}/${year}`,
        entity: 'HrLoan',
        entityId: row.id,
      });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await this.prisma.hrLoan.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
        if (again) return again;
      }
      throw e;
    }
  }

  async cancelLoan(id: string, reason: string, actor: Actor) {
    if (!reason?.trim()) throw new BadRequestException('سبب الإلغاء إلزامي');
    const loan = await this.prisma.hrLoan.findUnique({ where: { id }, include: { employee: true, _count: { select: { repayments: true } } } });
    if (!loan) throw new NotFoundException('القرض غير موجود');
    if (loan.status !== 'ACTIVE') throw new BadRequestException('القرض غير نشط');
    if (loan._count.repayments > 0) throw new BadRequestException('للقرض أقساط مسددة — لا يمكن إلغاؤه');
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.hrLoan.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'CANCELLED', notes: `${loan.notes ?? ''}\nملغى: ${reason.trim()}`.trim() } });
      if (claim.count !== 1) throw new BadRequestException('تم تعديله من مستخدم آخر');
      if (loan.cashSessionId) await reverseCashOut(tx, { sessionId: loan.cashSessionId, amount: num(loan.principal) });
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CANCEL,
      module: AUDIT_MODULES.HR,
      description: `إلغاء قرض ${num(loan.principal)} د.ج لـ ${fullName(loan.employee)} — ${reason.trim()}`,
      entity: 'HrLoan',
      entityId: id,
    });
    return { ok: true };
  }

  async manualRepayment(id: string, dto: { amount: number; date: string; notes?: string | null }, actor: Actor) {
    const amount = requireMoney(dto.amount);
    const date = requireDateKey(dto.date);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hr_loans WHERE id = ${id} FOR UPDATE`;
      const loan = await tx.hrLoan.findUnique({ where: { id }, include: { repayments: true, employee: true } });
      if (!loan) throw new NotFoundException('القرض غير موجود');
      if (loan.status !== 'ACTIVE') throw new BadRequestException('القرض غير نشط');
      const remaining = num(loan.principal) - loan.repayments.reduce((s, r) => s + num(r.amount), 0);
      if (amount > remaining + 1e-6) throw new BadRequestException(`المبلغ يتجاوز المتبقي (${remaining.toFixed(2)} د.ج)`);
      const rep = await tx.hrLoanRepayment.create({
        data: {
          loanId: id,
          amount,
          date: dateKeyToDb(date),
          source: 'MANUAL',
          notes: dto.notes?.trim() || null,
          createdById: actor.id,
          createdByName: actor.name,
        },
      });
      if (remaining - amount < 0.005) await tx.hrLoan.update({ where: { id }, data: { status: 'COMPLETED' } });
      return { rep, loan, remaining: remaining - amount };
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.PAY,
      module: AUDIT_MODULES.HR,
      description: `تسديد يدوي ${amount} د.ج لقرض ${fullName(result.loan.employee)} (المتبقي ${result.remaining.toFixed(2)} د.ج)`,
      entity: 'HrLoanRepayment',
      entityId: result.rep.id,
    });
    return result.rep;
  }

  // ── HR expenses ──────────────────────────────────────────────────────────

  listExpenses(q: { from?: string; to?: string; category?: string }) {
    return this.prisma.hrExpense.findMany({
      where: {
        ...(q.category ? { category: q.category } : {}),
        ...(q.from && q.to ? { date: { gte: dateKeyToDb(q.from), lte: dateKeyToDb(q.to) } } : {}),
      },
      include: { employee: employeeBrief },
      orderBy: { date: 'desc' },
      take: 1000,
    });
  }

  async createExpense(
    dto: MoneyOut & {
      category: string;
      amount: number;
      date: string;
      employeeId?: string | null;
      description: string;
      reference?: string | null;
      idempotencyKey: string;
    },
    actor: Actor,
  ) {
    const existing = await this.prisma.hrExpense.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) return existing;
    if (!(EXPENSE_CATEGORIES as readonly string[]).includes(dto.category)) {
      throw new BadRequestException('الفئة غير صالحة (الأجور والتسبيقات والقروض تُسجَّل من أقسامها)');
    }
    this.checkMethod(dto);
    const amount = requireMoney(dto.amount);
    const date = requireDateKey(dto.date);
    if (!dto.description?.trim()) throw new BadRequestException('الوصف إلزامي');
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const cash = await this.cashOut(tx, dto, amount);
        return tx.hrExpense.create({
          data: {
            category: dto.category,
            amount,
            date: dateKeyToDb(date),
            employeeId: dto.employeeId || null,
            description: dto.description.trim(),
            paymentMethod: dto.paymentMethod,
            ...cash,
            reference: dto.reference?.trim() || null,
            idempotencyKey: dto.idempotencyKey,
            createdById: actor.id,
            createdByName: actor.name,
          },
        });
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.PAY,
        module: AUDIT_MODULES.HR,
        description: `مصروف موارد بشرية (${dto.category}) ${amount} د.ج — ${row.description}`,
        entity: 'HrExpense',
        entityId: row.id,
      });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await this.prisma.hrExpense.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
        if (again) return again;
      }
      throw e;
    }
  }

  async cancelExpense(id: string, reason: string, actor: Actor) {
    if (!reason?.trim()) throw new BadRequestException('سبب الإلغاء إلزامي');
    const exp = await this.prisma.hrExpense.findUnique({ where: { id } });
    if (!exp) throw new NotFoundException('المصروف غير موجود');
    if (exp.status !== 'POSTED') throw new BadRequestException('ملغى مسبقاً');
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.hrExpense.updateMany({
        where: { id, status: 'POSTED' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.id, cancelledByName: actor.name, cancelReason: reason.trim() },
      });
      if (claim.count !== 1) throw new BadRequestException('تم تعديله من مستخدم آخر');
      if (exp.cashSessionId) await reverseCashOut(tx, { sessionId: exp.cashSessionId, amount: num(exp.amount) });
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CANCEL,
      module: AUDIT_MODULES.HR,
      description: `إلغاء مصروف ${num(exp.amount)} د.ج — ${reason.trim()}`,
      entity: 'HrExpense',
      entityId: id,
    });
    return { ok: true };
  }

  /** Personnel cost without double counting: each source is read from its own table once. */
  async expenseSummary(fromIn: string, toIn: string) {
    const from = requireDateKey(fromIn);
    const to = requireDateKey(toIn);
    if (from > to) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    const fromDb = dateKeyToDb(from);
    const toDb = dateKeyToDb(to);
    const tz = (await this.hrSettings.get()).timezoneOffsetMinutes;
    const [salaries, advances, loans, expenses] = await Promise.all([
      this.prisma.hrSalaryPayment.findMany({
        where: { status: 'POSTED', paidAt: { gte: localTimeUtc(from, 0, tz), lt: localTimeUtc(to, 24 * 60, tz) } },
        select: { amount: true, paymentMethod: true },
      }),
      this.prisma.hrAdvance.findMany({
        where: { status: { not: 'CANCELLED' }, date: { gte: fromDb, lte: toDb } },
        select: { amount: true, paymentMethod: true },
      }),
      this.prisma.hrLoan.findMany({
        where: { status: { not: 'CANCELLED' }, disbursedAt: { gte: fromDb, lte: toDb } },
        select: { principal: true, paymentMethod: true },
      }),
      this.prisma.hrExpense.findMany({
        where: { status: 'POSTED', date: { gte: fromDb, lte: toDb } },
        select: { amount: true, category: true, paymentMethod: true },
      }),
    ]);
    const sum = (xs: { amount?: unknown; principal?: unknown }[]) =>
      Math.round(xs.reduce((s, x) => s + num((x.amount ?? x.principal) as number), 0) * 100) / 100;
    const byCategory: Record<string, number> = {};
    for (const e of expenses) byCategory[e.category] = Math.round(((byCategory[e.category] ?? 0) + num(e.amount)) * 100) / 100;
    const lines = [
      { key: 'SALARY', label: 'أجور مدفوعة', amount: sum(salaries), count: salaries.length },
      { key: 'ADVANCE', label: 'تسبيقات', amount: sum(advances), count: advances.length },
      { key: 'LOAN', label: 'قروض ممنوحة', amount: sum(loans), count: loans.length },
      ...Object.entries(byCategory).map(([k, v]) => ({ key: k, label: k, amount: v, count: expenses.filter((e) => e.category === k).length })),
    ];
    return {
      from,
      to,
      lines,
      total: Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100,
      note: 'التسبيقات والقروض مبالغ مسبقة تُسترجع من الأجور؛ لا تُحسب الأجور المقتطعة مرة ثانية.',
    };
  }
}
