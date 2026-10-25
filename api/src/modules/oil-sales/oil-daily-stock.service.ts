import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OilDailyClosing,
  OilSource,
  OilStockMovementType,
  OilType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SeasonScopeService } from '../../common/season/season-scope.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import { currentDevice } from '../devices/device-context';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { allOilBuckets, OIL_SOURCE_LABELS, OIL_TYPE_LABELS } from './oil-catalog';
import { OilSalesService } from './oil-sales.service';
import {
  addDaysKey,
  assertDateKey,
  businessDateOf,
  businessDayWindow,
  computeDay,
  DAILY_STOCK_ERROR_AR,
  decideConfirm,
  reasonRequired,
  reconcile,
  round2,
  type DayFigures,
  type DayMovement,
  type PreviousClosing,
} from './oil-daily-stock.math';
import type { ConfirmDailyClosingDto, ReopenDailyClosingDto } from './dto/oil-sales.dto';

type Db = Prisma.TransactionClient | PrismaService;
type Bucket = { oilSource: OilSource; oilType: OilType };

const num = (v: Prisma.Decimal | number | string | null | undefined) => Number(v ?? 0);
const dec = (n: number) => new Prisma.Decimal(round2(n));
const keyOf = (b: Bucket) => `${b.oilSource}:${b.oilType}`;
const dateOnly = (key: string) => new Date(`${key}T00:00:00.000Z`);
const keyOfDate = (d: Date) => d.toISOString().slice(0, 10);

export type DailyStockBucket = {
  oilSource: OilSource;
  oilType: OilType;
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
  /** Quantity the next day opens with: confirmed actual, else expected (provisional). */
  nextOpening: number;
  nextOpeningProvisional: boolean;
  reason: string | null;
  closing: {
    id: string;
    confirmedAt: Date;
    confirmedByName: string | null;
    deviceName: string | null;
    windowStart: Date;
    windowEnd: Date;
  } | null;
  /** Most recent reopened closing of the day, kept for audit. */
  lastReopen: { at: Date; reason: string | null } | null;
};

/**
 * Daily oil stock reconciliation (الجرد اليومي للزيت). Shared stock per oil bucket, never per
 * cash register. Live days are rebuilt from the movement ledger; confirmed days are read from
 * their frozen closing row and never recalculated.
 */
@Injectable()
export class OilDailyStockService {
  constructor(
    private prisma: PrismaService,
    private seasonScope: SeasonScopeService,
    private audit: AuditService,
    private oilSales: OilSalesService,
  ) {}

  private async rules() {
    const s = await this.oilSales.getSettings();
    return {
      startHour: s.dayStartHour,
      reason: { minLitres: s.closingReasonLitres, minPercent: s.closingReasonPercent },
    };
  }

  /** Buckets of the season that have ever had stock or movements (all 8 when none). */
  private async buckets(db: Db, seasonId: string): Promise<Bucket[]> {
    const rows = await db.oilStockBalance.findMany({
      where: { seasonId },
      select: { oilSource: true, oilType: true },
    });
    const known = new Set(rows.map(keyOf));
    const all = allOilBuckets();
    const used = all.filter((b) => known.has(keyOf(b)));
    return used.length ? used : all;
  }

  private async confirmedClosing(db: Db, seasonId: string, date: string, b: Bucket) {
    return db.oilDailyClosing.findFirst({
      where: { seasonId, businessDate: dateOnly(date), ...b, status: 'CONFIRMED' },
    });
  }

  /** Live figures of one bucket for `date`, counted up to `until`. */
  private async liveFigures(
    db: Db,
    seasonId: string,
    date: string,
    b: Bucket,
    startHour: number,
    until: Date,
  ): Promise<{ figures: DayFigures; prev: OilDailyClosing | null }> {
    const { start, end } = businessDayWindow(date, startHour);
    const prev = await this.confirmedClosing(db, seasonId, addDaysKey(date, -1), b);
    const prevInfo: PreviousClosing | null = prev
      ? { actualQty: num(prev.actualQty), windowEnd: prev.windowEnd }
      : null;
    const effectiveStart = prevInfo && prevInfo.windowEnd < start ? prevInfo.windowEnd : start;
    const effectiveEnd = until < end ? until : end;

    const [lastBefore, rows] = await Promise.all([
      db.oilStockMovement.findFirst({
        where: { seasonId, ...b, createdAt: { lt: effectiveStart } },
        orderBy: { createdAt: 'desc' },
        select: { stockAfter: true },
      }),
      db.oilStockMovement.findMany({
        where: {
          seasonId,
          ...b,
          createdAt: { gte: effectiveStart },
          OR: [{ createdAt: { lt: effectiveEnd } }, { dailyClosingId: { not: null } }],
        },
        select: {
          type: true,
          quantityL: true,
          createdAt: true,
          dailyClosingId: true,
          dailyClosing: { select: { businessDate: true } },
        },
      }),
    ]);
    const movements: DayMovement[] = rows.map((r) => ({
      type: r.type,
      quantityL: num(r.quantityL),
      createdAt: r.createdAt,
      dailyClosingId: r.dailyClosingId,
      closingBusinessDate: r.dailyClosing ? keyOfDate(r.dailyClosing.businessDate) : null,
    }));
    const figures = computeDay({
      date,
      dayStart: start,
      until: effectiveEnd,
      prev: prevInfo,
      ledgerBalanceAtStart: lastBefore ? num(lastBefore.stockAfter) : 0,
      movements,
    });
    return { figures, prev };
  }

  private frozen(c: OilDailyClosing, b: Bucket, lastReopen: DailyStockBucket['lastReopen']): DailyStockBucket {
    const sold = num(c.soldQty);
    const returned = num(c.returnedQty);
    return {
      ...b,
      status: 'CONFIRMED',
      openingSource: c.openingSource === 'CONFIRMED' ? 'CONFIRMED' : 'PROVISIONAL',
      opening: num(c.openingQty),
      added: num(c.addedQty),
      otherIn: num(c.otherInQty),
      otherOut: num(c.otherOutQty),
      sold,
      returned,
      netSold: round2(sold - returned),
      available: num(c.availableQty),
      expected: num(c.expectedQty),
      actual: num(c.actualQty),
      difference: num(c.difference),
      nextOpening: num(c.actualQty),
      nextOpeningProvisional: false,
      reason: c.reason,
      closing: {
        id: c.id,
        confirmedAt: c.confirmedAt,
        confirmedByName: c.confirmedByName,
        deviceName: c.deviceName,
        windowStart: c.windowStart,
        windowEnd: c.windowEnd,
      },
      lastReopen,
    };
  }

  /** One business day, every bucket. */
  async day(date: string) {
    try {
      assertDateKey(date);
    } catch {
      throw new BadRequestException(DAILY_STOCK_ERROR_AR.INVALID_DATE);
    }
    const seasonId = await this.seasonScope.getSeasonId();
    const rules = await this.rules();
    const { startHour } = rules;
    const now = new Date();
    const today = businessDateOf(now, startHour);
    const window = businessDayWindow(date, startHour);
    const buckets = await this.buckets(this.prisma, seasonId);
    const reopened = await this.prisma.oilDailyClosing.findMany({
      where: { seasonId, businessDate: dateOnly(date), status: 'REOPENED' },
      orderBy: { reopenedAt: 'desc' },
      select: { oilSource: true, oilType: true, reopenedAt: true, reopenReason: true },
    });

    const rows: DailyStockBucket[] = [];
    for (const b of buckets) {
      const r = reopened.find((x) => x.oilSource === b.oilSource && x.oilType === b.oilType);
      const lastReopen = r?.reopenedAt ? { at: r.reopenedAt, reason: r.reopenReason } : null;
      const closed = await this.confirmedClosing(this.prisma, seasonId, date, b);
      if (closed) {
        rows.push(this.frozen(closed, b, lastReopen));
        continue;
      }
      const { figures } = await this.liveFigures(this.prisma, seasonId, date, b, startHour, now);
      rows.push({
        ...b,
        status: 'OPEN',
        openingSource: figures.openingSource,
        opening: figures.opening,
        added: figures.added,
        otherIn: figures.otherIn,
        otherOut: figures.otherOut,
        sold: figures.sold,
        returned: figures.returned,
        netSold: figures.netSold,
        available: figures.available,
        expected: figures.expected,
        actual: null,
        difference: null,
        nextOpening: figures.expected,
        nextOpeningProvisional: true,
        reason: null,
        closing: null,
        lastReopen,
      });
    }

    const sum = (pick: (r: DailyStockBucket) => number, rs = rows) => round2(rs.reduce((s, r) => s + pick(r), 0));
    const totalsOf = (rs: DailyStockBucket[]) => ({
      opening: sum((r) => r.opening, rs),
      added: sum((r) => r.added, rs),
      netSold: sum((r) => r.netSold, rs),
      available: sum((r) => r.available, rs),
      expected: sum((r) => r.expected, rs),
      actual: rs.every((r) => r.actual != null) ? sum((r) => r.actual ?? 0, rs) : null,
      difference: sum((r) => r.difference ?? 0, rs),
      nextOpening: sum((r) => r.nextOpening, rs),
    });
    return {
      date,
      today,
      isToday: date === today,
      isFuture: date > today,
      window: { start: window.start, end: window.end, startHour },
      rules: { reasonMinLitres: rules.reason.minLitres, reasonMinPercent: rules.reason.minPercent },
      allConfirmed: rows.every((r) => r.status === 'CONFIRMED'),
      anyConfirmed: rows.some((r) => r.status === 'CONFIRMED'),
      buckets: rows,
      totals: {
        all: totalsOf(rows),
        STORED: totalsOf(rows.filter((r) => r.oilSource === 'STORED')),
        FARMER: totalsOf(rows.filter((r) => r.oilSource === 'FARMER')),
      },
    };
  }

  /** Several consecutive days (for multi-day reports); at most 62. */
  async range(from: string, to: string) {
    try {
      assertDateKey(from);
      assertDateKey(to);
    } catch {
      throw new BadRequestException(DAILY_STOCK_ERROR_AR.INVALID_DATE);
    }
    if (from > to) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    const days: Awaited<ReturnType<OilDailyStockService['day']>>[] = [];
    for (let d = from, i = 0; d <= to && i < 62; d = addDaysKey(d, 1), i++) days.push(await this.day(d));
    return { from, to, days };
  }

  /**
   * Confirms the physical count of every listed oil for `date`. One transaction; stock rows are
   * locked FOR UPDATE (sales of the same oil wait); the closing posts only its difference.
   */
  async confirm(dto: ConfirmDailyClosingDto, user: JwtPayload) {
    try {
      assertDateKey(dto.date);
    } catch {
      throw new BadRequestException(DAILY_STOCK_ERROR_AR.INVALID_DATE);
    }
    const seen = new Set<string>();
    for (const it of dto.items) {
      const k = keyOf(it);
      if (seen.has(k)) throw new BadRequestException('نفس الزيت مكرر في الجرد');
      seen.add(k);
    }
    const seasonId = await this.seasonScope.getSeasonId();
    const rules = await this.rules();
    const operator = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { username: true, firstName: true, lastName: true },
    });
    const operatorName =
      [operator?.firstName, operator?.lastName].filter(Boolean).join(' ').trim() || operator?.username || null;
    const device = currentDevice();
    const order = allOilBuckets().map(keyOf);
    const items = [...dto.items].sort((a, b) => order.indexOf(keyOf(a)) - order.indexOf(keyOf(b)));

    const results = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`oil-close:${seasonId}`}))`;
        const now = new Date();
        const today = businessDateOf(now, rules.startHour);
        const out: Array<{ closing: OilDailyClosing; created: boolean }> = [];

        for (const it of items) {
          const b: Bucket = { oilSource: it.oilSource, oilType: it.oilType };
          const label = `${OIL_SOURCE_LABELS[it.oilSource]} / ${OIL_TYPE_LABELS[it.oilType]}`;
          const balance = await this.lockBalance(tx, seasonId, b);
          const existing = await this.confirmedClosing(tx, seasonId, dto.date, b);
          const later = await tx.oilDailyClosing.findFirst({
            where: { seasonId, ...b, status: 'CONFIRMED', businessDate: { gt: dateOnly(dto.date) } },
            select: { id: true },
          });
          const decision = decideConfirm({
            date: dto.date,
            today,
            existingConfirmedActual: existing ? num(existing.actualQty) : null,
            laterConfirmedExists: !!later,
            actual: it.actualQty,
          });
          if (decision.action === 'REFUSE') {
            throw new BadRequestException(`${label}: ${DAILY_STOCK_ERROR_AR[decision.code]}`);
          }
          if (decision.action === 'ALREADY_CONFIRMED') {
            if (!decision.sameActual) {
              throw new ConflictException(`${label}: ${DAILY_STOCK_ERROR_AR.ALREADY_CONFIRMED}`);
            }
            out.push({ closing: existing!, created: false }); // idempotent repeat: nothing posted again
            continue;
          }

          const { figures } = await this.liveFigures(tx, seasonId, dto.date, b, rules.startHour, now);
          if (it.expectedQty != null && Math.abs(round2(it.expectedQty) - figures.expected) > 0.005) {
            throw new ConflictException({
              statusCode: 409,
              code: 'STOCK_CHANGED',
              message: `${label}: ${DAILY_STOCK_ERROR_AR.STOCK_CHANGED} (المتوقع الآن ${figures.expected} لتر)`,
            });
          }
          let rec;
          try {
            rec = reconcile(figures.expected, it.actualQty);
          } catch {
            throw new BadRequestException(`${label}: ${DAILY_STOCK_ERROR_AR.INVALID_ACTUAL}`);
          }
          if (reasonRequired(rec.difference, figures.expected, rules.reason) && !it.reason?.trim()) {
            throw new BadRequestException(`${label}: ${DAILY_STOCK_ERROR_AR.REASON_REQUIRED} (${rec.difference} لتر)`);
          }

          const closing = await tx.oilDailyClosing.create({
            data: {
              seasonId,
              businessDate: dateOnly(dto.date),
              ...b,
              openingSource: figures.openingSource,
              openingQty: dec(figures.opening),
              addedQty: dec(figures.added),
              otherInQty: dec(figures.otherIn),
              otherOutQty: dec(figures.otherOut),
              soldQty: dec(figures.sold),
              returnedQty: dec(figures.returned),
              availableQty: dec(figures.available),
              expectedQty: dec(figures.expected),
              actualQty: dec(rec.actual),
              difference: dec(rec.difference),
              reason: it.reason?.trim() || null,
              windowStart: figures.windowStart,
              windowEnd: figures.windowEnd,
              confirmedAt: now,
              confirmedById: user.sub,
              confirmedByName: operatorName,
              deviceId: device?.id ?? null,
              deviceName: device?.name ?? device?.code ?? null,
            },
          });

          if (rec.difference !== 0) {
            // Only the difference is posted: sales made after the counted window stay in stock.
            const before = balance.theoreticalQty;
            const after = round2(before + rec.difference);
            await tx.oilStockBalance.update({
              where: { id: balance.id },
              data: { theoreticalQty: dec(after), lastInventoryAt: now, version: { increment: 1 } },
            });
            await tx.oilStockMovement.create({
              data: {
                seasonId,
                ...b,
                type: OilStockMovementType.INVENTORY_ADJUSTMENT,
                quantityL: dec(rec.difference),
                stockBefore: dec(before),
                stockAfter: dec(after),
                dailyClosingId: closing.id,
                note: `جرد يوم ${dto.date}: المتوقع ${figures.expected} — الفعلي ${rec.actual} (${rec.difference > 0 ? '+' : ''}${rec.difference} لتر)${it.reason?.trim() ? ` — ${it.reason.trim()}` : ''}`,
                userId: user.sub,
                createdAt: now,
              },
            });
          }
          out.push({ closing, created: true });
        }
        return out;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    for (const r of results.filter((x) => x.created)) {
      const c = r.closing;
      await this.audit.log({
        userId: user.sub,
        action: AUDIT_ACTIONS.VALIDATE,
        module: AUDIT_MODULES.OIL_SALES,
        entity: 'OilDailyClosing',
        entityId: c.id,
        description: `جرد يومي ${dto.date} — ${OIL_SOURCE_LABELS[c.oilSource]} / ${OIL_TYPE_LABELS[c.oilType]}: متوقع ${num(c.expectedQty)} لتر، فعلي ${num(c.actualQty)} لتر، فرق ${num(c.difference)} لتر`,
        newData: c as unknown as Prisma.InputJsonValue,
      });
    }
    return this.day(dto.date);
  }

  /** Reopens the latest confirmed closing of one oil: its adjustment is reversed, history kept. */
  async reopen(dto: ReopenDailyClosingDto, user: JwtPayload) {
    const seasonId = await this.seasonScope.getSeasonId();
    const b: Bucket = { oilSource: dto.oilSource, oilType: dto.oilType };
    const label = `${OIL_SOURCE_LABELS[dto.oilSource]} / ${OIL_TYPE_LABELS[dto.oilType]}`;
    const reopened = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`oil-close:${seasonId}`}))`;
        const closing = await this.confirmedClosing(tx, seasonId, dto.date, b);
        if (!closing) throw new NotFoundException(`${label}: ${DAILY_STOCK_ERROR_AR.NOT_CONFIRMED}`);
        const later = await tx.oilDailyClosing.findFirst({
          where: { seasonId, ...b, status: 'CONFIRMED', businessDate: { gt: dateOnly(dto.date) } },
          select: { businessDate: true },
        });
        if (later) {
          throw new ForbiddenException(
            `${label}: يوم ${keyOfDate(later.businessDate)} مؤكد بعده — أعد فتح الأيام اللاحقة أولاً (من الأحدث إلى الأقدم)`,
          );
        }
        const now = new Date();
        const diff = num(closing.difference);
        if (diff !== 0) {
          const balance = await this.lockBalance(tx, seasonId, b);
          const before = balance.theoreticalQty;
          const after = round2(before - diff);
          await tx.oilStockBalance.update({
            where: { id: balance.id },
            data: { theoreticalQty: dec(after), version: { increment: 1 } },
          });
          await tx.oilStockMovement.create({
            data: {
              seasonId,
              ...b,
              type: OilStockMovementType.INVENTORY_ADJUSTMENT,
              quantityL: dec(-diff),
              stockBefore: dec(before),
              stockAfter: dec(after),
              dailyClosingId: closing.id,
              note: `إعادة فتح جرد يوم ${dto.date} — إلغاء تعديل ${diff} لتر: ${dto.reason.trim()}`,
              userId: user.sub,
              createdAt: now,
            },
          });
        }
        return tx.oilDailyClosing.update({
          where: { id: closing.id },
          data: { status: 'REOPENED', reopenedAt: now, reopenedById: user.sub, reopenReason: dto.reason.trim() },
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    await this.audit.log({
      userId: user.sub,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.OIL_SALES,
      entity: 'OilDailyClosing',
      entityId: reopened.id,
      description: `إعادة فتح جرد يوم ${dto.date} — ${label}: ${dto.reason.trim()}`,
      oldData: { actualQty: num(reopened.actualQty), difference: num(reopened.difference) } as Prisma.InputJsonValue,
    });
    return this.day(dto.date);
  }

  private async lockBalance(tx: Prisma.TransactionClient, seasonId: string, b: Bucket) {
    await tx.oilStockBalance.upsert({
      where: { seasonId_oilSource_oilType: { seasonId, ...b } },
      create: { seasonId, ...b },
      update: {},
    });
    const rows = await tx.$queryRaw<Array<{ id: string; theoretical_qty: Prisma.Decimal }>>`
      SELECT id, theoretical_qty FROM oil_stock_balances
      WHERE season_id = ${seasonId}
        AND oil_source = ${b.oilSource}::"OilSource"
        AND oil_type = ${b.oilType}::"OilType"
      FOR UPDATE
    `;
    if (!rows[0]) throw new BadRequestException('تعذر قفل رصيد المخزون');
    return { id: rows[0].id, theoreticalQty: num(rows[0].theoretical_qty) };
  }
}
