import { Injectable } from '@nestjs/common';
import { HrApprovalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { addDays, dateKeyToDb, localDateKey } from './engine/hr-time';
import { summarize, type PayrollOvertime } from './engine/payroll-engine';
import { HrAttendanceService } from './hr-attendance.service';
import { HrSettingsService } from './hr-settings.service';
import { canSeeSalaries, fullName, num, requireRange } from './hr-common';

@Injectable()
export class HrReportsService {
  constructor(
    private prisma: PrismaService,
    private attendance: HrAttendanceService,
    private hrSettings: HrSettingsService,
  ) {}

  async dashboard(user: JwtPayload) {
    const settings = await this.hrSettings.get();
    const today = localDateKey(new Date(), settings.timezoneOffsetMinutes);
    const monthStart = `${today.slice(0, 8)}01`;
    const live = await this.attendance.live();
    const pending = { status: HrApprovalStatus.PENDING };
    const monthRange = { gte: dateKeyToDb(monthStart), lte: dateKeyToDb(today) };
    const showPay = canSeeSalaries(user);

    const [
      byStatus,
      leavePending,
      sickPending,
      absencePending,
      overtimePending,
      bonusPending,
      deductionPending,
      monthLates,
      monthAbsent,
      needsReview,
      contractsEnding,
      trialsEnding,
      rejectedDevices,
      lastPeriod,
      openAdvances,
    ] = await Promise.all([
      this.prisma.hrEmployee.groupBy({ by: ['status'], where: { archivedAt: null }, _count: { _all: true } }),
      this.prisma.hrLeaveRequest.count({ where: pending }),
      this.prisma.hrSickLeave.count({ where: pending }),
      this.prisma.hrAbsence.count({ where: pending }),
      this.prisma.hrOvertime.aggregate({ where: pending, _count: { _all: true }, _sum: { requestedMinutes: true } }),
      this.prisma.hrBonus.count({ where: pending }),
      this.prisma.hrDeduction.count({ where: pending }),
      this.prisma.hrAttendanceDay.aggregate({
        where: { date: monthRange, isLate: true },
        _count: { _all: true },
        _sum: { lateMinutes: true },
      }),
      this.prisma.hrAttendanceDay.count({ where: { date: monthRange, status: 'ABSENT' } }),
      this.prisma.hrAttendanceDay.count({ where: { needsReview: true, date: { gte: dateKeyToDb(addDays(today, -62)) } } }),
      this.prisma.hrContract.findMany({
        where: { status: 'ACTIVE', endDate: { gte: dateKeyToDb(today), lte: dateKeyToDb(addDays(today, 30)) } },
        include: { employee: { select: { id: true, firstName: true, lastName: true, matricule: true } } },
        orderBy: { endDate: 'asc' },
      }),
      this.prisma.hrContract.findMany({
        where: { status: 'ACTIVE', trialEndDate: { gte: dateKeyToDb(today), lte: dateKeyToDb(addDays(today, 15)) } },
        include: { employee: { select: { id: true, firstName: true, lastName: true, matricule: true } } },
      }),
      this.prisma.hrAttendanceSyncLog.findMany({
        where: { status: 'REJECTED', startedAt: { gte: new Date(Date.now() - 86_400_000) } },
        orderBy: { startedAt: 'desc' },
        take: 5,
      }),
      showPay
        ? this.prisma.hrPayrollPeriod.findFirst({ orderBy: [{ year: 'desc' }, { month: 'desc' }] })
        : Promise.resolve(null),
      showPay
        ? this.prisma.hrAdvance.aggregate({ where: { status: 'OPEN' }, _sum: { amount: true }, _count: { _all: true } })
        : Promise.resolve(null),
    ]);

    return {
      today,
      generatedAt: new Date(),
      employees: {
        total: byStatus.filter((s) => s.status !== 'LEFT').reduce((s, x) => s + x._count._all, 0),
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      },
      presence: { counts: live.counts, lastSyncAt: live.lastSyncAt, lastEventReceivedAt: live.lastEventReceivedAt },
      devices: live.devices,
      rejectedDevices,
      month: {
        from: monthStart,
        to: today,
        lateCount: monthLates._count._all,
        lateMinutes: monthLates._sum.lateMinutes ?? 0,
        absentDays: monthAbsent,
      },
      pending: {
        leave: leavePending,
        sickLeave: sickPending,
        absences: absencePending,
        overtime: overtimePending._count._all,
        overtimeMinutes: overtimePending._sum.requestedMinutes ?? 0,
        bonuses: bonusPending,
        deductions: deductionPending,
        attendanceReview: needsReview,
      },
      alerts: {
        contractsEnding: contractsEnding.map((c) => ({ id: c.id, employee: c.employee, endDate: c.endDate, contractType: c.contractType })),
        trialsEnding: trialsEnding.map((c) => ({ id: c.id, employee: c.employee, trialEndDate: c.trialEndDate })),
      },
      payroll: lastPeriod
        ? {
            id: lastPeriod.id,
            year: lastPeriod.year,
            month: lastPeriod.month,
            status: lastPeriod.status,
            totalNet: num(lastPeriod.totalNet),
            totalPaid: num(lastPeriod.totalPaid),
          }
        : null,
      openAdvances: openAdvances ? { total: num(openAdvances._sum.amount), count: openAdvances._count._all } : null,
    };
  }

  /** Per-employee totals for any date range (attendance only — no salary data). */
  async attendanceSummary(q: { from: string; to: string; departmentId?: string; employeeId?: string; refresh?: boolean }) {
    const { from, to } = requireRange(q.from, q.to);
    const employees = await this.prisma.hrEmployee.findMany({
      where: {
        hireDate: { lte: dateKeyToDb(to) },
        OR: [{ leftAt: null }, { leftAt: { gte: dateKeyToDb(from) } }],
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.employeeId ? { id: q.employeeId } : {}),
      },
      select: { id: true, matricule: true, firstName: true, lastName: true, department: { select: { name: true } } },
      orderBy: [{ lastName: 'asc' }],
    });
    const ids = employees.map((e) => e.id);
    if (q.refresh) await this.attendance.process({ from, to, employeeIds: ids });
    const [days, overtime] = await Promise.all([
      this.attendance.payrollDays(ids, from, to),
      this.prisma.hrOvertime.findMany({
        where: {
          employeeId: { in: ids },
          date: { gte: dateKeyToDb(from), lte: dateKeyToDb(to) },
          status: { in: [HrApprovalStatus.APPROVED, HrApprovalStatus.PENDING] },
        },
      }),
    ]);
    const rows = employees.map((e) => {
      const ot: PayrollOvertime[] = overtime
        .filter((o) => o.employeeId === e.id)
        .map((o) => ({
          id: o.id,
          date: '',
          minutes: o.status === 'APPROVED' ? o.approvedMinutes ?? 0 : o.requestedMinutes,
          multiplier: num(o.multiplier),
          status: o.status as 'APPROVED' | 'PENDING',
        }));
      return { employee: { ...e, fullName: fullName(e) }, summary: summarize(days.get(e.id) ?? [], ot) };
    });
    return { from, to, rows };
  }
}
