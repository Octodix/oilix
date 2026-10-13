import { BadRequestException, Injectable } from '@nestjs/common';
import { HrPayrollStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { dateKeyToDb, dbDateToKey } from './engine/hr-time';

export const LOCKED_PAYROLL_STATUSES: HrPayrollStatus[] = [
  HrPayrollStatus.VALIDATED,
  HrPayrollStatus.PAID,
  HrPayrollStatus.CLOSED,
];

export type LockedRange = { start: string; end: string; year: number; month: number };

/**
 * Once a payroll month is validated its attendance, leave, overtime and pay items are frozen:
 * they can only change after an audited reopen. Payslips stay immutable snapshots either way.
 */
@Injectable()
export class HrLocksService {
  constructor(private prisma: PrismaService) {}

  async lockedRanges(from?: string, to?: string): Promise<LockedRange[]> {
    const rows = await this.prisma.hrPayrollPeriod.findMany({
      where: {
        status: { in: LOCKED_PAYROLL_STATUSES },
        ...(from && to ? { startDate: { lte: dateKeyToDb(to) }, endDate: { gte: dateKeyToDb(from) } } : {}),
      },
      select: { startDate: true, endDate: true, year: true, month: true },
    });
    return rows.map((r) => ({ start: dbDateToKey(r.startDate), end: dbDateToKey(r.endDate), year: r.year, month: r.month }));
  }

  static isLocked(ranges: LockedRange[], date: string): boolean {
    return ranges.some((r) => r.start <= date && date <= r.end);
  }

  async assertDatesOpen(from: string, to: string) {
    const ranges = await this.lockedRanges(from, to);
    if (ranges.length) {
      const r = ranges[0];
      throw new BadRequestException(
        `الفترة ${String(r.month).padStart(2, '0')}/${r.year} مصادق عليها في الأجور ومقفلة — يجب إعادة فتحها أولاً`,
      );
    }
  }

  async assertMonthOpen(year: number, month: number) {
    const row = await this.prisma.hrPayrollPeriod.findUnique({ where: { year_month: { year, month } } });
    if (row && LOCKED_PAYROLL_STATUSES.includes(row.status)) {
      throw new BadRequestException(
        `أجور ${String(month).padStart(2, '0')}/${year} مصادق عليها ومقفلة — يجب إعادة فتحها أولاً`,
      );
    }
  }
}
