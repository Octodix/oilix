import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OilCustomerLedgerType,
  OilSalePaymentStatus,
  OilSaleStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import { SeasonScopeService } from '../../common/season/season-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CashRegisterService } from './cash-register.service';
import { hasPermission } from '../../common/permissions/permission-catalog';
import {
  allocateDebtPaymentFifo,
  computeSalePaymentFields,
  roundMoney,
} from './oil-sales-debt.math';

function num(v: Prisma.Decimal | number | null | undefined): number {
  if (v == null) return 0;
  return Number(v);
}

function dec(n: number) {
  return new Prisma.Decimal(roundMoney(n));
}

@Injectable()
export class OilSalesDebtService {
  constructor(
    private prisma: PrismaService,
    private seasonScope: SeasonScopeService,
    private cashRegisters: CashRegisterService,
    private audit: AuditService,
  ) {}

  private userSelect = {
    id: true,
    username: true,
    firstName: true,
    lastName: true,
  } as const;

  async customerBalance(customerId: string, seasonId?: string) {
    const sid = seasonId ?? (await this.seasonScope.getSeasonId());
    const agg = await this.prisma.oilSale.aggregate({
      where: {
        seasonId: sid,
        customerId,
        status: OilSaleStatus.COMPLETED,
        remainingAmount: { gt: 0 },
      },
      _sum: { remainingAmount: true },
    });
    return roundMoney(num(agg._sum.remainingAmount));
  }

  async debtorsSummary() {
    const seasonId = await this.seasonScope.getSeasonId();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const outstanding = await this.prisma.oilSale.groupBy({
      by: ['customerId'],
      where: {
        seasonId,
        customerId: { not: null },
        status: OilSaleStatus.COMPLETED,
        remainingAmount: { gt: 0 },
      },
      _sum: { remainingAmount: true },
      _count: { _all: true },
      _min: { saleDate: true },
      _max: { saleDate: true },
    });

    const totalDebt = roundMoney(
      outstanding.reduce((s, r) => s + num(r._sum.remainingAmount), 0),
    );

    const saleDebtLedger = await this.prisma.oilCustomerLedgerEntry.findMany({
      where: {
        seasonId,
        type: OilCustomerLedgerType.SALE_DEBT,
        createdAt: { gte: start, lte: end },
      },
      select: { debit: true, credit: true },
    });
    const newDebtCreated = roundMoney(
      saleDebtLedger.reduce((s, e) => s + num(e.debit) - num(e.credit), 0),
    );

    const collectedToday = await this.prisma.oilSalePayment.aggregate({
      where: { seasonId, createdAt: { gte: start, lte: end } },
      _sum: { amount: true },
    });

    return {
      totalDebt,
      debtorsCount: outstanding.length,
      collectedToday: roundMoney(num(collectedToday._sum.amount)),
      newDebtToday: Math.max(0, newDebtCreated),
      openSalesWithDebt: outstanding.reduce((s, r) => s + r._count._all, 0),
    };
  }

  async listDebtors(query: { q?: string; sort?: string }) {
    const seasonId = await this.seasonScope.getSeasonId();
    const groups = await this.prisma.oilSale.groupBy({
      by: ['customerId'],
      where: {
        seasonId,
        customerId: { not: null },
        status: OilSaleStatus.COMPLETED,
        remainingAmount: { gt: 0 },
      },
      _sum: { remainingAmount: true },
      _count: { _all: true },
      _min: { saleDate: true, createdAt: true },
      _max: { saleDate: true },
    });

    const ids = groups
      .map((g) => g.customerId)
      .filter((id): id is string => id != null);
    if (!ids.length) return [];

    const customers = await this.prisma.oilSaleCustomer.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { phone: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    });

    const lastPayments = await this.prisma.oilSalePayment.groupBy({
      by: ['customerId'],
      where: { seasonId, customerId: { in: ids } },
      _max: { createdAt: true },
    });

    let rows = customers.map((c) => {
      const g = groups.find((x) => x.customerId === c.id)!;
      const lastPay = lastPayments.find((p) => p.customerId === c.id);
      return {
        customer: c,
        debt: roundMoney(num(g._sum.remainingAmount)),
        unpaidSalesCount: g._count._all,
        oldestDebtDate: g._min.saleDate,
        lastSaleDate: g._max.saleDate,
        lastPaymentAt: lastPay?._max.createdAt ?? null,
      };
    });

    const sort = query.sort || 'debt_desc';
    rows = rows.sort((a, b) => {
      if (sort === 'name') return a.customer.name.localeCompare(b.customer.name, 'ar');
      if (sort === 'oldest')
        return (a.oldestDebtDate?.getTime() ?? 0) - (b.oldestDebtDate?.getTime() ?? 0);
      if (sort === 'recent')
        return (b.lastSaleDate?.getTime() ?? 0) - (a.lastSaleDate?.getTime() ?? 0);
      return b.debt - a.debt;
    });

    return rows;
  }

  async customerDebtDetail(customerId: string) {
    const seasonId = await this.seasonScope.getSeasonId();
    const customer = await this.prisma.oilSaleCustomer.findFirst({
      where: { id: customerId, seasonId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('الزبون غير موجود');

    const sales = await this.prisma.oilSale.findMany({
      where: { seasonId, customerId, status: OilSaleStatus.COMPLETED },
      orderBy: { saleDate: 'asc' },
      include: { createdBy: { select: this.userSelect } },
    });

    const outstanding = sales.filter((s) => num(s.remainingAmount) > 0);
    const totalPurchases = roundMoney(sales.reduce((s, r) => s + num(r.finalAmount), 0));
    const totalPaidOnSales = roundMoney(sales.reduce((s, r) => s + num(r.amountPaid), 0));
    const debt = roundMoney(outstanding.reduce((s, r) => s + num(r.remainingAmount), 0));

    const payments = await this.prisma.oilSalePayment.findMany({
      where: { seasonId, customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: this.userSelect },
        allocations: { include: { sale: { select: { receiptNumber: true } } } },
      },
    });

    const ledger = await this.prisma.oilCustomerLedgerEntry.findMany({
      where: { seasonId, customerId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { user: { select: this.userSelect } },
    });

    return {
      customer,
      summary: {
        totalPurchases,
        totalPaidOnSales,
        debt,
        unpaidSalesCount: outstanding.length,
        lastSale: sales[sales.length - 1] ?? null,
        lastPayment: payments[0] ?? null,
      },
      outstandingSales: outstanding,
      payments,
      ledger,
    };
  }

  /**
   * Record debt repayment. FIFO allocation unless saleId provided.
   * Cash attributed to CURRENT device/register/session.
   */
  async recordPayment(
    dto: {
      customerId: string;
      amount: number;
      saleId?: string;
      notes?: string;
      reference?: string;
      paymentMethod?: string;
    },
    userId: string,
    permissions: string[],
    role?: string,
  ) {
    if (!hasPermission(permissions, 'OIL_SALES_DEBTS_RECORD_PAYMENT', role)) {
      throw new ForbiddenException('ليس لديك صلاحية تسجيل تسديد دين');
    }

    const amount = roundMoney(Number(dto.amount));
    if (!(amount > 0)) throw new BadRequestException('مبلغ التسديد غير صالح');

    const seasonId = await this.seasonScope.getSeasonId();
    const customer = await this.prisma.oilSaleCustomer.findFirst({
      where: { id: dto.customerId, seasonId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('الزبون غير موجود');

    const device = this.cashRegisters.requireSalesDevice({ requireCashRegister: false });
    const operator = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.userSelect,
    });
    const operatorName =
      [operator?.firstName, operator?.lastName].filter(Boolean).join(' ').trim() ||
      operator?.username ||
      null;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`oil-debt:${seasonId}:${dto.customerId}`}))`;

      let session: Awaited<
        ReturnType<typeof tx.cashRegisterSession.findFirst>
      > & { cashRegister?: { id: string; code: string; name: string } | null } | null = null;

      if (device.cashRegisterId) {
        const open = await tx.cashRegisterSession.findFirst({
          where: {
            cashRegisterId: device.cashRegisterId,
            status: 'OPEN',
            seasonId,
          },
          include: { cashRegister: true },
        });
        if (open) {
          await tx.$queryRaw`SELECT id FROM cash_register_sessions WHERE id = ${open.id} FOR UPDATE`;
          session = open;
        }
      }

      const outstandingWhere: Prisma.OilSaleWhereInput = {
        seasonId,
        customerId: dto.customerId,
        status: OilSaleStatus.COMPLETED,
        remainingAmount: { gt: 0 },
      };
      if (dto.saleId) outstandingWhere.id = dto.saleId;

      const outstanding = await tx.oilSale.findMany({
        where: outstandingWhere,
        orderBy: [{ saleDate: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          remainingAmount: true,
          amountPaid: true,
          finalAmount: true,
          saleDate: true,
          receiptNumber: true,
        },
      });

      if (!outstanding.length) {
        throw new BadRequestException('لا يوجد دين مستحق لهذا الزبون');
      }

      const slices = outstanding.map((s) => ({
        saleId: s.id,
        remainingAmount: num(s.remainingAmount),
        saleDate: s.saleDate,
      }));

      const balanceBefore = roundMoney(
        slices.reduce((s, x) => s + roundMoney(x.remainingAmount), 0),
      );

      let allocations;
      try {
        allocations = allocateDebtPaymentFifo(slices, amount);
      } catch (e) {
        const code = e instanceof Error ? e.message : '';
        if (code === 'PAYMENT_EXCEEDS_DEBT') {
          throw new BadRequestException('مبلغ التسديد يتجاوز الدين المستحق');
        }
        throw new BadRequestException('تعذر توزيع التسديد');
      }

      const lastPay = await tx.oilSalePayment.findFirst({
        where: { seasonId },
        orderBy: { receiptNumber: 'desc' },
        select: { receiptNumber: true },
      });
      const receiptNumber = (lastPay?.receiptNumber ?? 0) + 1;

      const payment = await tx.oilSalePayment.create({
        data: {
          seasonId,
          receiptNumber,
          customerId: dto.customerId,
          amount: dec(amount),
          paymentMethod: dto.paymentMethod?.trim() || 'CASH',
          reference: dto.reference?.trim() || null,
          notes: dto.notes?.trim() || null,
          userId,
          userName: operatorName,
          userUsername: operator?.username ?? null,
          deviceId: device.id,
          cashRegisterId: session?.cashRegisterId ?? device.cashRegisterId ?? null,
          cashSessionId: session?.id ?? null,
          deviceCode: device.code,
          deviceName: device.name,
          cashRegisterCode: session?.cashRegister?.code ?? null,
          cashRegisterName: session?.cashRegister?.name ?? null,
          allocations: {
            create: allocations.map((a) => ({
              saleId: a.saleId,
              amount: dec(a.amount),
            })),
          },
        },
      });

      for (const a of allocations) {
        const sale = outstanding.find((s) => s.id === a.saleId)!;
        const newPaid = roundMoney(num(sale.amountPaid) + a.amount);
        const fields = computeSalePaymentFields(num(sale.finalAmount), newPaid);
        await tx.oilSale.update({
          where: { id: a.saleId },
          data: {
            amountPaid: dec(fields.amountPaid),
            remainingAmount: dec(fields.remainingAmount),
            paymentStatus: fields.paymentStatus as OilSalePaymentStatus,
          },
        });
      }

      const balanceAfter = roundMoney(balanceBefore - amount);

      await tx.oilCustomerLedgerEntry.create({
        data: {
          seasonId,
          customerId: dto.customerId,
          type: OilCustomerLedgerType.PAYMENT,
          paymentId: payment.id,
          debit: dec(0),
          credit: dec(amount),
          balanceAfter: dec(Math.max(0, balanceAfter)),
          reference: `PAY-${String(receiptNumber).padStart(6, '0')}`,
          notes: dto.notes?.trim() || null,
          userId,
          deviceId: device.id,
        },
      });

      if (session) {
        await tx.cashRegisterSession.update({
          where: { id: session.id },
          data: { cashIn: { increment: amount } },
        });
      }

      return { payment, allocations, balanceAfter: Math.max(0, balanceAfter), balanceBefore };
    });

    await this.audit.log({
      userId,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.OIL_SALES,
      entity: 'OilSalePayment',
      entityId: result.payment.id,
      description: `تسديد دين ${amount} دج للزبون ${customer.name}`,
    });

    return {
      ...result.payment,
      allocations: result.allocations,
      previousDebt: result.balanceBefore,
      remainingDebt: result.balanceAfter,
      customer,
    };
  }

  async paymentReceiptPayload(paymentId: string) {
    const payment = await this.prisma.oilSalePayment.findFirst({
      where: { id: paymentId },
      include: {
        customer: true,
        user: { select: this.userSelect },
        allocations: {
          include: {
            sale: { select: { receiptNumber: true, remainingAmount: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('التسديد غير موجود');

    const ledger = await this.prisma.oilCustomerLedgerEntry.findFirst({
      where: { paymentId },
    });

    return {
      payment: {
        id: payment.id,
        receiptNumber: payment.receiptNumber,
        amount: payment.amount,
        paymentMethod: payment.paymentMethod,
        notes: payment.notes,
        reference: payment.reference,
        createdAt: payment.createdAt,
        cashRegisterCode: payment.cashRegisterCode,
        cashRegisterName: payment.cashRegisterName,
        deviceCode: payment.deviceCode,
        user: payment.user,
        allocations: payment.allocations,
      },
      customer: payment.customer,
      previousDebt: ledger
        ? roundMoney(num(ledger.balanceAfter) + num(payment.amount))
        : null,
      remainingDebt: ledger ? num(ledger.balanceAfter) : null,
      settings: await this.getReceiptSettings(),
    };
  }

  private async getReceiptSettings() {
    const company = await this.prisma.setting.findMany({
      where: { key: { in: ['company_name', 'company_phone', 'company_address', 'oil_receipt_header', 'oil_receipt_footer'] } },
    });
    const cmap = Object.fromEntries(company.map((c) => [c.key, c.value]));
    return {
      receiptHeader: String(cmap.oil_receipt_header ?? cmap.company_name ?? 'OILIX'),
      receiptFooter: String(cmap.oil_receipt_footer ?? ''),
      company: {
        name: String(cmap.company_name ?? 'Oilix'),
        phone: String(cmap.company_phone ?? ''),
        address: String(cmap.company_address ?? ''),
      },
    };
  }

  private async sumRemaining(
    tx: Prisma.TransactionClient,
    seasonId: string,
    customerId: string,
  ) {
    const agg = await tx.oilSale.aggregate({
      where: {
        seasonId,
        customerId,
        status: OilSaleStatus.COMPLETED,
        remainingAmount: { gt: 0 },
      },
      _sum: { remainingAmount: true },
    });
    return roundMoney(num(agg._sum.remainingAmount));
  }

  /** Append ledger row for a new sale (called inside createSale transaction). */
  async appendSaleLedger(
    tx: Prisma.TransactionClient,
    input: {
      seasonId: string;
      customerId: string;
      saleId: string;
      receiptNumber: number;
      netAmount: number;
      amountPaid: number;
      remainingAmount: number;
      userId: string;
      deviceId?: string | null;
    },
  ) {
    const prev = await this.sumRemaining(tx, input.seasonId, input.customerId);
    // prev does not yet include this sale's remaining (sale already inserted with remaining)
    // So balanceAfter = prev (which includes this sale if already written)
    const balanceAfter = prev;

    await tx.oilCustomerLedgerEntry.create({
      data: {
        seasonId: input.seasonId,
        customerId: input.customerId,
        type: OilCustomerLedgerType.SALE_DEBT,
        saleId: input.saleId,
        debit: dec(input.netAmount),
        credit: dec(input.amountPaid),
        balanceAfter: dec(balanceAfter),
        reference: `#${input.receiptNumber}`,
        notes:
          input.remainingAmount > 0
            ? `متبقي ${input.remainingAmount} دج`
            : 'مدفوع بالكامل',
        userId: input.userId,
        deviceId: input.deviceId ?? null,
      },
    });
  }
}
