import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HrApprovalStatus, Prisma, type HrAttendanceDay } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  assignPunchesToDays,
  computeAttendanceDay,
  CORRECTABLE_STATUSES,
  expectedMinutesOf,
  liveBucket,
  scheduleBlocks,
  type DayCorrection,
  type DayResult,
} from './engine/attendance-engine';
import {
  addDays,
  dateKeyToDb,
  dbDateToKey,
  eachDateKey,
  formatDeviceLocalTime,
  localDateKey,
  localMidnightUtc,
  localTimeUtc,
  minDateKey,
  monthBounds,
  parseHhMm,
} from './engine/hr-time';
import { summarize, type PayrollDay, type PayrollOvertime } from './engine/payroll-engine';
import { HrLocksService } from './hr-locks.service';
import { HrSchedulesService } from './hr-schedules.service';
import { HrSettingsService } from './hr-settings.service';
import { canSeeSalaries, fullName, requireDateKey, requireRange, requireYearMonth, type Actor } from './hr-common';

export type ProcessResult = { evaluated: number; changed: number; skippedLocked: number; from: string; to: string };

const employeeBrief = {
  id: true,
  matricule: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
} as const;

function rowOf(r: DayResult) {
  return {
    status: r.status,
    flags: r.flags,
    isWorkingDay: r.isWorkingDay,
    scheduleId: r.scheduleId,
    scheduleName: r.scheduleName,
    scheduledStart: r.scheduledStart,
    scheduledEnd: r.scheduledEnd,
    expectedMinutes: r.expectedMinutes,
    firstIn: r.firstIn,
    lastOut: r.lastOut,
    punchCount: r.punchCount,
    inEventId: r.inEventId,
    outEventId: r.outEventId,
    inVerifyMethod: r.inVerifyMethod,
    inDeviceId: r.inDeviceId,
    workedMinutes: r.workedMinutes,
    lateMinutes: r.lateMinutes,
    chargeableLateMinutes: r.chargeableLateMinutes,
    isLate: r.isLate,
    earlyLeaveMinutes: r.earlyLeaveMinutes,
    overtimeMinutes: r.overtimeMinutes,
    overtimeRule: r.overtimeRule,
    leaveRequestId: r.leaveRequestId,
    sickLeaveId: r.sickLeaveId,
    absenceId: r.absenceId,
    holidayId: r.holidayId,
    needsReview: r.needsReview,
    isCorrected: r.isCorrected,
  };
}

type DayRow = ReturnType<typeof rowOf>;

function sameDay(a: HrAttendanceDay, b: DayRow): boolean {
  for (const k of Object.keys(b) as (keyof DayRow)[]) {
    const x = (a as unknown as Record<string, unknown>)[k];
    const y = b[k] as unknown;
    if (x instanceof Date || y instanceof Date) {
      if ((x as Date | null)?.getTime?.() !== (y as Date | null)?.getTime?.()) return false;
    } else if (Array.isArray(x) || Array.isArray(y)) {
      if ((x as string[]).join('|') !== (y as string[]).join('|')) return false;
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}

function within(date: string, start: Date, end: Date) {
  return dbDateToKey(start) <= date && date <= dbDateToKey(end);
}

@Injectable()
export class HrAttendanceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private hrSettings: HrSettingsService,
    private schedules: HrSchedulesService,
    private locks: HrLocksService,
  ) {}

  async today(): Promise<string> {
    const s = await this.hrSettings.get();
    return localDateKey(new Date(), s.timezoneOffsetMinutes);
  }

  /** Recomputes processed days from raw events. Raw events and locked months are never touched. */
  async process(opts: { employeeIds?: string[]; from: string; to: string }): Promise<ProcessResult> {
    const settings = await this.hrSettings.get();
    const offset = settings.timezoneOffsetMinutes;
    const now = new Date();
    const from = opts.from;
    const to = minDateKey(opts.to, localDateKey(now, offset));
    const result: ProcessResult = { evaluated: 0, changed: 0, skippedLocked: 0, from, to };
    if (from > to) return result;
    if (opts.employeeIds && !opts.employeeIds.length) return result;

    const fromDb = dateKeyToDb(from);
    const toDb = dateKeyToDb(to);
    const employees = await this.prisma.hrEmployee.findMany({
      where: {
        ...(opts.employeeIds ? { id: { in: opts.employeeIds } } : {}),
        hireDate: { lte: toDb },
        OR: [{ leftAt: null }, { leftAt: { gte: fromDb } }],
      },
      select: { id: true, departmentId: true, hireDate: true, leftAt: true },
    });
    if (!employees.length) return result;
    const empIds = employees.map((e) => e.id);
    const approved = HrApprovalStatus.APPROVED;
    const overlap = { employeeId: { in: empIds }, status: approved, startDate: { lte: toDb }, endDate: { gte: fromDb } };

    const [locked, resolve, holidays, leaves, sicks, absences, corrections, events, existingDays, overtimes] =
      await Promise.all([
        this.locks.lockedRanges(from, to),
        this.schedules.resolver(employees, addDays(from, -1), addDays(to, 1)),
        this.prisma.hrHoliday.findMany({ where: { date: { gte: fromDb, lte: toDb } } }),
        this.prisma.hrLeaveRequest.findMany({ where: overlap, include: { leaveType: true } }),
        this.prisma.hrSickLeave.findMany({ where: overlap }),
        this.prisma.hrAbsence.findMany({ where: overlap, include: { absenceType: true } }),
        this.prisma.hrAttendanceCorrection.findMany({
          where: { employeeId: { in: empIds }, date: { gte: fromDb, lte: toDb }, revokedAt: null },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.hrAttendanceEvent.findMany({
          where: {
            employeeId: { in: empIds },
            punchedAt: {
              gte: localMidnightUtc(addDays(from, -1), offset),
              lt: localMidnightUtc(addDays(to, 2), offset),
            },
          },
          select: { id: true, employeeId: true, punchedAt: true, verifyMethod: true, deviceId: true, punchState: true },
          orderBy: { punchedAt: 'asc' },
        }),
        this.prisma.hrAttendanceDay.findMany({ where: { employeeId: { in: empIds }, date: { gte: fromDb, lte: toDb } } }),
        this.prisma.hrOvertime.findMany({
          where: { employeeId: { in: empIds }, date: { gte: fromDb, lte: toDb }, source: 'CALCULATED' },
        }),
      ]);

    const holidayOf = new Map(holidays.map((h) => [dbDateToKey(h.date), h]));
    const existingOf = new Map(existingDays.map((d) => [`${d.employeeId}|${dbDateToKey(d.date)}`, d]));
    const overtimeOf = new Map(overtimes.map((o) => [`${o.employeeId}|${dbDateToKey(o.date)}`, o]));
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const emp of employees) {
      const hire = dbDateToKey(emp.hireDate);
      const left = emp.leftAt ? dbDateToKey(emp.leftAt) : null;
      const punches = events
        .filter((e) => e.employeeId === emp.id)
        .map((e) => ({ id: e.id, at: e.punchedAt, verifyMethod: e.verifyMethod, deviceId: e.deviceId, punchState: e.punchState }));
      const byDay = assignPunchesToDays(punches, (d) => resolve(emp.id, d), offset);

      for (const date of eachDateKey(from, to)) {
        if (HrLocksService.isLocked(locked, date)) {
          result.skippedLocked++;
          continue;
        }
        result.evaluated++;
        const employed = hire <= date && (!left || date <= left);
        const holiday = holidayOf.get(date) ?? null;
        const leave = leaves.find((l) => l.employeeId === emp.id && within(date, l.startDate, l.endDate)) ?? null;
        const sick = sicks.find((s) => s.employeeId === emp.id && within(date, s.startDate, s.endDate)) ?? null;
        const absence = absences.find((a) => a.employeeId === emp.id && within(date, a.startDate, a.endDate)) ?? null;
        const dayCorrections = corrections.filter((c) => c.employeeId === emp.id && dbDateToKey(c.date) === date);
        const correction = dayCorrections.reduce<DayCorrection | null>(
          (acc, c) => ({
            checkIn: c.checkIn ?? acc?.checkIn ?? null,
            checkOut: c.checkOut ?? acc?.checkOut ?? null,
            status: c.status ?? acc?.status ?? null,
          }),
          null,
        );

        const r = computeAttendanceDay(
          {
            date,
            offsetMinutes: offset,
            employed,
            schedule: resolve(emp.id, date),
            coverage: {
              holiday: holiday ? { id: holiday.id, name: holiday.name, isPaid: holiday.isPaid } : null,
              leave: leave ? { id: leave.id, typeCode: leave.leaveType.code, isPaid: leave.leaveType.isPaid } : null,
              sickLeave: sick ? { id: sick.id } : null,
              absence:
                absence && absence.absenceType.isJustified
                  ? { id: absence.id, typeCode: absence.absenceType.code, isPaid: absence.isPaid }
                  : null,
            },
            correction,
            punches: byDay.get(date) ?? [],
            now,
          },
          settings.attendance,
        );
        if (absence && !absence.absenceType.isJustified && r.status === 'ABSENT') {
          r.absenceId = absence.id;
          r.flags.push('UNJUSTIFIED_ABSENCE_RECORDED');
        }

        const key = `${emp.id}|${date}`;
        const row = rowOf(r);
        const existing = existingOf.get(key);
        if (!existing || !sameDay(existing, row)) {
          result.changed++;
          ops.push(
            this.prisma.hrAttendanceDay.upsert({
              where: { employeeId_date: { employeeId: emp.id, date: dateKeyToDb(date) } },
              create: { ...row, employeeId: emp.id, date: dateKeyToDb(date), computedAt: now },
              update: { ...row, computedAt: now },
            }),
          );
        }

        const ot = overtimeOf.get(key);
        if (r.overtimeMinutes > 0 && employed) {
          const rule = r.overtimeRule ?? 'WORKDAY';
          const multiplier = settings.payroll.overtimeMultipliers[rule];
          if (!ot) {
            ops.push(
              this.prisma.hrOvertime.create({
                data: {
                  employeeId: emp.id,
                  date: dateKeyToDb(date),
                  source: 'CALCULATED',
                  calculatedMinutes: r.overtimeMinutes,
                  requestedMinutes: r.overtimeMinutes,
                  multiplier,
                  ruleCode: rule,
                  status: HrApprovalStatus.PENDING,
                },
              }),
            );
          } else if (!ot.payslipId) {
            if (ot.status === HrApprovalStatus.PENDING || ot.status === HrApprovalStatus.CANCELLED) {
              if (
                ot.status !== HrApprovalStatus.PENDING ||
                ot.calculatedMinutes !== r.overtimeMinutes ||
                ot.ruleCode !== rule ||
                Number(ot.multiplier) !== multiplier
              ) {
                ops.push(
                  this.prisma.hrOvertime.update({
                    where: { id: ot.id },
                    data: {
                      calculatedMinutes: r.overtimeMinutes,
                      requestedMinutes: r.overtimeMinutes,
                      multiplier,
                      ruleCode: rule,
                      status: HrApprovalStatus.PENDING,
                      decisionNote: null,
                    },
                  }),
                );
              }
            } else if (ot.calculatedMinutes !== r.overtimeMinutes) {
              ops.push(this.prisma.hrOvertime.update({ where: { id: ot.id }, data: { calculatedMinutes: r.overtimeMinutes } }));
            }
          }
        } else if (ot && !ot.payslipId) {
          if (ot.status === HrApprovalStatus.PENDING) {
            ops.push(
              this.prisma.hrOvertime.update({
                where: { id: ot.id },
                data: {
                  status: HrApprovalStatus.CANCELLED,
                  calculatedMinutes: 0,
                  decisionNote: 'لم تعد محسوبة بعد إعادة معالجة الحضور',
                },
              }),
            );
          } else if (ot.calculatedMinutes !== 0) {
            ops.push(this.prisma.hrOvertime.update({ where: { id: ot.id }, data: { calculatedMinutes: 0 } }));
          }
        }
      }
    }

    for (let i = 0; i < ops.length; i += 200) {
      await this.prisma.$transaction(ops.slice(i, i + 200));
    }
    return result;
  }

  async reprocess(dto: { from: string; to: string; employeeId?: string }, actor: Actor) {
    const { from, to } = requireRange(dto.from, dto.to);
    if (eachDateKey(from, to).length > 400) throw new BadRequestException('المدى طويل جداً (400 يوم كحد أقصى)');
    const r = await this.process({ from, to, employeeIds: dto.employeeId ? [dto.employeeId] : undefined });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CALCULATE,
      module: AUDIT_MODULES.HR,
      description: `إعادة معالجة الحضور من ${from} إلى ${to} (${r.changed} يوم تغيّر)`,
      entity: 'HrAttendanceDay',
      newData: r as unknown as Prisma.InputJsonValue,
    });
    return r;
  }

  /**
   * Processed days with paid/unpaid information for payroll and summaries.
   * With `fillUnprocessed`, dates that have no processed row yet (the rest of an unfinished month)
   * are filled from the schedule as UPCOMING — payable, never deducted — so the daily rate is
   * always based on the whole period rather than on the days elapsed so far.
   */
  async payrollDays(
    employeeIds: string[],
    from: string,
    to: string,
    opts: { fillUnprocessed?: boolean } = {},
  ): Promise<Map<string, PayrollDay[]>> {
    const out = await this.processedPayrollDays(employeeIds, from, to);
    if (!opts.fillUnprocessed || !employeeIds.length) return out;

    const settings = await this.hrSettings.get();
    const employees = await this.prisma.hrEmployee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, departmentId: true, hireDate: true, leftAt: true },
    });
    const [resolve, holidays] = await Promise.all([
      this.schedules.resolver(employees, from, to),
      this.prisma.hrHoliday.findMany({ where: { date: { gte: dateKeyToDb(from), lte: dateKeyToDb(to) } } }),
    ]);
    const holidayOf = new Map(holidays.map((h) => [dbDateToKey(h.date), h]));
    for (const emp of employees) {
      const list = out.get(emp.id) ?? [];
      const have = new Set(list.map((d) => d.date));
      const hire = dbDateToKey(emp.hireDate);
      const left = emp.leftAt ? dbDateToKey(emp.leftAt) : null;
      for (const date of eachDateKey(from, to)) {
        if (have.has(date)) continue;
        const schedule = resolve(emp.id, date);
        const blocks = scheduleBlocks(date, schedule, settings.timezoneOffsetMinutes);
        const holiday = holidayOf.get(date) ?? null;
        const employed = hire <= date && (!left || date <= left);
        list.push({
          id: `unprocessed:${emp.id}:${date}`,
          date,
          status: !employed ? 'NOT_EMPLOYED' : holiday ? 'HOLIDAY' : blocks.length ? 'UPCOMING' : 'REST_DAY',
          isWorkingDay: blocks.length > 0,
          expectedMinutes: expectedMinutesOf(blocks, schedule?.breakMinutes ?? 0),
          workedMinutes: 0,
          overtimeMinutes: 0,
          isLate: false,
          chargeableLateMinutes: 0,
          lateJustified: false,
          leavePaid: null,
          absencePaid: null,
          sickPaidPercent: null,
          holidayPaid: holiday ? holiday.isPaid : null,
        });
      }
      list.sort((a, b) => a.date.localeCompare(b.date));
      out.set(emp.id, list);
    }
    return out;
  }

  private async processedPayrollDays(employeeIds: string[], from: string, to: string): Promise<Map<string, PayrollDay[]>> {
    const rows = await this.prisma.hrAttendanceDay.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: dateKeyToDb(from), lte: dateKeyToDb(to) } },
      orderBy: { date: 'asc' },
    });
    const ids = (k: 'leaveRequestId' | 'sickLeaveId' | 'absenceId' | 'holidayId') =>
      [...new Set(rows.map((r) => r[k]).filter((x): x is string => !!x))];
    const [leaves, sicks, absences, holidays] = await Promise.all([
      this.prisma.hrLeaveRequest.findMany({ where: { id: { in: ids('leaveRequestId') } }, include: { leaveType: true } }),
      this.prisma.hrSickLeave.findMany({ where: { id: { in: ids('sickLeaveId') } } }),
      this.prisma.hrAbsence.findMany({ where: { id: { in: ids('absenceId') } } }),
      this.prisma.hrHoliday.findMany({ where: { id: { in: ids('holidayId') } } }),
    ]);
    const leavePaid = new Map(leaves.map((l) => [l.id, l.leaveType.isPaid]));
    const sickPct = new Map(
      sicks.map((s) => [s.id, s.payrollTreatment === 'PAID' ? 100 : s.payrollTreatment === 'PARTIAL' ? Number(s.paidPercent) : 0]),
    );
    const absencePaid = new Map(absences.map((a) => [a.id, a.isPaid]));
    const holidayPaid = new Map(holidays.map((h) => [h.id, h.isPaid]));
    const out = new Map<string, PayrollDay[]>();
    for (const r of rows) {
      const list = out.get(r.employeeId) ?? [];
      list.push({
        id: r.id,
        date: dbDateToKey(r.date),
        status: r.status,
        isWorkingDay: r.isWorkingDay,
        expectedMinutes: r.expectedMinutes,
        workedMinutes: r.workedMinutes,
        overtimeMinutes: r.overtimeMinutes,
        isLate: r.isLate,
        chargeableLateMinutes: r.chargeableLateMinutes,
        lateJustified: r.lateJustified,
        leavePaid: r.leaveRequestId ? leavePaid.get(r.leaveRequestId) ?? null : null,
        absencePaid: r.absenceId ? absencePaid.get(r.absenceId) ?? null : null,
        sickPaidPercent: r.sickLeaveId ? sickPct.get(r.sickLeaveId) ?? 0 : null,
        holidayPaid: r.holidayId ? holidayPaid.get(r.holidayId) ?? true : null,
      });
      out.set(r.employeeId, list);
    }
    return out;
  }

  async listDays(q: {
    from: string;
    to: string;
    employeeId?: string;
    departmentId?: string;
    status?: string;
    needsReview?: boolean;
    lateOnly?: boolean;
    refresh?: boolean;
  }) {
    const { from, to } = requireRange(q.from, q.to);
    if (q.refresh) await this.process({ from, to, employeeIds: q.employeeId ? [q.employeeId] : undefined });
    return this.prisma.hrAttendanceDay.findMany({
      where: {
        date: { gte: dateKeyToDb(from), lte: dateKeyToDb(to) },
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.departmentId ? { employee: { departmentId: q.departmentId } } : {}),
        ...(q.status ? { status: q.status } : { status: { not: 'NOT_EMPLOYED' } }),
        ...(q.needsReview ? { needsReview: true } : {}),
        ...(q.lateOnly ? { isLate: true } : {}),
      },
      include: { employee: { select: employeeBrief } },
      orderBy: [{ date: 'desc' }, { employee: { lastName: 'asc' } }],
      take: 3000,
    });
  }

  async listEvents(q: {
    from: string;
    to: string;
    deviceId?: string;
    employeeId?: string;
    unmapped?: boolean;
    deviceUserId?: string;
    page?: number;
    limit?: number;
  }) {
    const { from, to } = requireRange(q.from, q.to);
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(500, Math.max(1, q.limit ?? 100));
    const where: Prisma.HrAttendanceEventWhereInput = {
      localDate: { gte: dateKeyToDb(from), lte: dateKeyToDb(to) },
      ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.unmapped ? { employeeId: null } : {}),
      ...(q.deviceUserId ? { deviceUserId: q.deviceUserId.trim() } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.hrAttendanceEvent.findMany({
        where,
        include: {
          employee: { select: { id: true, matricule: true, firstName: true, lastName: true } },
          device: { select: { id: true, name: true, serialNumber: true } },
        },
        orderBy: { punchedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.hrAttendanceEvent.count({ where }),
    ]);
    return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  /** "Présence aujourd'hui" — as fresh as the last terminal sync, never presented as real-time. */
  async live() {
    const settings = await this.hrSettings.get();
    const today = localDateKey(new Date(), settings.timezoneOffsetMinutes);
    const active = await this.prisma.hrEmployee.findMany({
      where: { archivedAt: null, status: { not: 'LEFT' } },
      select: { id: true },
    });
    await this.process({ from: today, to: today, employeeIds: active.map((e) => e.id) });
    const [days, devices, lastEvent] = await Promise.all([
      this.prisma.hrAttendanceDay.findMany({
        where: { date: dateKeyToDb(today), employeeId: { in: active.map((e) => e.id) } },
        include: { employee: { select: { ...employeeBrief, status: true } } },
      }),
      this.prisma.hrAttendanceDevice.findMany({
        where: { isEnabled: true },
        select: { id: true, name: true, provider: true, status: true, lastConnectionAt: true, lastSuccessfulSyncAt: true, lastEventAt: true },
      }),
      this.prisma.hrAttendanceEvent.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true, punchedAt: true } }),
    ]);
    const items = days
      .map((d) => ({
        employee: d.employee,
        status: d.status,
        bucket: liveBucket(d),
        firstIn: d.firstIn,
        lastOut: d.lastOut,
        punchCount: d.punchCount,
        isLate: d.isLate,
        lateMinutes: d.lateMinutes,
        inVerifyMethod: d.inVerifyMethod,
        inDeviceId: d.inDeviceId,
        scheduledStart: d.scheduledStart,
        scheduledEnd: d.scheduledEnd,
        flags: d.flags,
      }))
      .sort((a, b) => fullName(a.employee).localeCompare(fullName(b.employee)));
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.bucket] = (counts[i.bucket] ?? 0) + 1;
    const lastSync = devices
      .map((d) => d.lastSuccessfulSyncAt ?? d.lastEventAt)
      .filter((x): x is Date => !!x)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      date: today,
      generatedAt: new Date(),
      lastSyncAt: lastSync,
      lastEventReceivedAt: lastEvent?.receivedAt ?? null,
      devices,
      counts,
      items,
    };
  }

  async calendar(q: { year: number; month: number; departmentId?: string }) {
    const { year, month } = requireYearMonth(q.year, q.month);
    const { start, end } = monthBounds(year, month);
    const employees = await this.prisma.hrEmployee.findMany({
      where: {
        hireDate: { lte: dateKeyToDb(end) },
        OR: [{ leftAt: null }, { leftAt: { gte: dateKeyToDb(start) } }],
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      },
      select: { ...employeeBrief, status: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    await this.process({ from: start, to: end, employeeIds: employees.map((e) => e.id) });
    const days = await this.prisma.hrAttendanceDay.findMany({
      where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: dateKeyToDb(start), lte: dateKeyToDb(end) } },
      select: {
        id: true,
        employeeId: true,
        date: true,
        status: true,
        isLate: true,
        lateMinutes: true,
        workedMinutes: true,
        overtimeMinutes: true,
        needsReview: true,
        isCorrected: true,
      },
    });
    const holidays = await this.prisma.hrHoliday.findMany({
      where: { date: { gte: dateKeyToDb(start), lte: dateKeyToDb(end) } },
    });
    const grid: Record<string, Record<string, unknown>> = {};
    for (const d of days) {
      (grid[d.employeeId] ??= {})[dbDateToKey(d.date)] = { ...d, date: dbDateToKey(d.date) };
    }
    return { year, month, start, end, dates: eachDateKey(start, end), employees, grid, holidays };
  }

  /** Employee monthly drill-down: every figure links back to days, punches, corrections and decisions. */
  async employeeMonth(employeeId: string, yearIn: number, monthIn: number, user: JwtPayload) {
    const { year, month } = requireYearMonth(yearIn, monthIn);
    const { start, end } = monthBounds(year, month);
    const employee = await this.prisma.hrEmployee.findUnique({ where: { id: employeeId }, select: { ...employeeBrief, status: true, hireDate: true, leftAt: true } });
    if (!employee) throw new NotFoundException('الموظف غير موجود');
    await this.process({ from: start, to: end, employeeIds: [employeeId] });
    const settings = await this.hrSettings.get();
    const startDb = dateKeyToDb(start);
    const endDb = dateKeyToDb(end);
    const overlap = { employeeId, startDate: { lte: endDb }, endDate: { gte: startDb } };
    const [days, events, corrections, overtime, leaves, sick, absences, payslip, payrollDays, bonuses, deductions, advances] =
      await Promise.all([
        this.prisma.hrAttendanceDay.findMany({ where: { employeeId, date: { gte: startDb, lte: endDb } }, orderBy: { date: 'asc' } }),
        this.prisma.hrAttendanceEvent.findMany({
          where: { employeeId, localDate: { gte: dateKeyToDb(addDays(start, -1)), lte: dateKeyToDb(addDays(end, 1)) } },
          select: { id: true, punchedAt: true, deviceLocalTime: true, verifyMethod: true, punchState: true, deviceId: true, source: true, device: { select: { name: true } } },
          orderBy: { punchedAt: 'asc' },
        }),
        this.prisma.hrAttendanceCorrection.findMany({ where: { employeeId, date: { gte: startDb, lte: endDb } }, orderBy: { createdAt: 'desc' } }),
        this.prisma.hrOvertime.findMany({ where: { employeeId, date: { gte: startDb, lte: endDb } }, orderBy: { date: 'asc' } }),
        this.prisma.hrLeaveRequest.findMany({ where: overlap, include: { leaveType: true }, omit: { attachment: true }, orderBy: { startDate: 'asc' } }),
        this.prisma.hrSickLeave.findMany({ where: overlap, omit: { attachment: true }, orderBy: { startDate: 'asc' } }),
        this.prisma.hrAbsence.findMany({ where: overlap, include: { absenceType: true }, omit: { attachment: true }, orderBy: { startDate: 'asc' } }),
        canSeeSalaries(user)
          ? this.prisma.hrPayslip.findFirst({
              where: { employeeId, period: { year, month } },
              include: { lines: { orderBy: { sortOrder: 'asc' } }, payments: true, period: { select: { id: true, status: true } } },
            })
          : Promise.resolve(null),
        this.payrollDays([employeeId], start, end),
        canSeeSalaries(user) ? this.prisma.hrBonus.findMany({ where: { employeeId, year, month } }) : Promise.resolve([]),
        canSeeSalaries(user) ? this.prisma.hrDeduction.findMany({ where: { employeeId, year, month } }) : Promise.resolve([]),
        canSeeSalaries(user)
          ? this.prisma.hrAdvance.findMany({ where: { employeeId, deductYear: year, deductMonth: month } })
          : Promise.resolve([]),
      ]);
    const otForSummary: PayrollOvertime[] = overtime
      .filter((o) => o.status === 'APPROVED' || o.status === 'PENDING')
      .map((o) => ({
        id: o.id,
        date: dbDateToKey(o.date),
        minutes: o.status === 'APPROVED' ? o.approvedMinutes ?? 0 : o.requestedMinutes,
        multiplier: Number(o.multiplier),
        status: o.status as 'APPROVED' | 'PENDING',
      }));
    return {
      employee,
      year,
      month,
      start,
      end,
      timezoneOffsetMinutes: settings.timezoneOffsetMinutes,
      summary: summarize(payrollDays.get(employeeId) ?? [], otForSummary),
      days: days.map((d) => ({ ...d, date: dbDateToKey(d.date) })),
      events: events.map((e) => ({ ...e, localTime: formatDeviceLocalTime(e.punchedAt, settings.timezoneOffsetMinutes) })),
      corrections,
      overtime,
      leaves,
      sickLeaves: sick,
      absences,
      bonuses,
      deductions,
      advances,
      payslip,
      salaryVisible: canSeeSalaries(user),
    };
  }

  listCorrections(q: { employeeId?: string; from?: string; to?: string }) {
    return this.prisma.hrAttendanceCorrection.findMany({
      where: {
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.from && q.to ? { date: { gte: dateKeyToDb(q.from), lte: dateKeyToDb(q.to) } } : {}),
      },
      include: { employee: { select: { id: true, matricule: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async createCorrection(
    dto: { employeeId: string; date: string; checkIn?: string | null; checkOut?: string | null; status?: string | null; reason: string },
    actor: Actor,
  ) {
    const date = requireDateKey(dto.date);
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 3) throw new BadRequestException('سبب التصحيح إلزامي');
    if (!dto.checkIn && !dto.checkOut && !dto.status) throw new BadRequestException('لا يوجد أي تعديل');
    if (dto.status && !(CORRECTABLE_STATUSES as string[]).includes(dto.status)) {
      throw new BadRequestException('الحالة غير مسموحة');
    }
    const settings = await this.hrSettings.get();
    if (date > localDateKey(new Date(), settings.timezoneOffsetMinutes)) {
      throw new BadRequestException('لا يمكن تصحيح يوم مستقبلي');
    }
    await this.locks.assertDatesOpen(date, date);
    const employee = await this.prisma.hrEmployee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) throw new NotFoundException('الموظف غير موجود');

    const offset = settings.timezoneOffsetMinutes;
    const inMin = dto.checkIn ? parseHhMm(dto.checkIn) : null;
    const outMinRaw = dto.checkOut ? parseHhMm(dto.checkOut) : null;
    if ((dto.checkIn && inMin === null) || (dto.checkOut && outMinRaw === null)) {
      throw new BadRequestException('الوقت غير صالح (HH:MM)');
    }
    const before = await this.prisma.hrAttendanceDay.findUnique({
      where: { employeeId_date: { employeeId: dto.employeeId, date: dateKeyToDb(date) } },
    });
    const refIn = inMin ?? (before?.firstIn ? (before.firstIn.getTime() - localMidnightUtc(date, offset).getTime()) / 60_000 : null);
    const outMin = outMinRaw !== null && refIn !== null && outMinRaw <= refIn ? outMinRaw + 1440 : outMinRaw;
    const checkIn = inMin !== null ? localTimeUtc(date, inMin, offset) : null;
    const checkOut = outMin !== null ? localTimeUtc(date, outMin, offset) : null;

    const snapshot = (d: HrAttendanceDay | null) =>
      d
        ? {
            status: d.status,
            firstIn: d.firstIn?.toISOString() ?? null,
            lastOut: d.lastOut?.toISOString() ?? null,
            workedMinutes: d.workedMinutes,
            lateMinutes: d.lateMinutes,
            overtimeMinutes: d.overtimeMinutes,
          }
        : null;
    const row = await this.prisma.hrAttendanceCorrection.create({
      data: {
        employeeId: dto.employeeId,
        date: dateKeyToDb(date),
        checkIn,
        checkOut,
        status: dto.status || null,
        reason,
        oldValue: snapshot(before) ?? Prisma.JsonNull,
        createdById: actor.id,
        createdByName: actor.name,
      },
    });
    await this.process({ from: date, to: date, employeeIds: [dto.employeeId] });
    const after = await this.prisma.hrAttendanceDay.findUnique({
      where: { employeeId_date: { employeeId: dto.employeeId, date: dateKeyToDb(date) } },
    });
    const saved = await this.prisma.hrAttendanceCorrection.update({
      where: { id: row.id },
      data: { newValue: snapshot(after) ?? Prisma.JsonNull },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CORRECT,
      module: AUDIT_MODULES.HR,
      description: `تصحيح حضور ${fullName(employee)} ليوم ${date}${dto.checkIn ? ` دخول ${dto.checkIn}` : ''}${dto.checkOut ? ` خروج ${dto.checkOut}` : ''}${dto.status ? ` حالة ${dto.status}` : ''} — ${reason}`,
      entity: 'HrAttendanceCorrection',
      entityId: row.id,
      oldData: snapshot(before) as Prisma.InputJsonValue,
      newData: snapshot(after) as Prisma.InputJsonValue,
    });
    return saved;
  }

  async revokeCorrection(id: string, reason: string, actor: Actor) {
    const row = await this.prisma.hrAttendanceCorrection.findUnique({ where: { id }, include: { employee: true } });
    if (!row) throw new NotFoundException('التصحيح غير موجود');
    if (row.revokedAt) throw new BadRequestException('التصحيح ملغى مسبقاً');
    if (!reason?.trim()) throw new BadRequestException('سبب الإلغاء إلزامي');
    const date = dbDateToKey(row.date);
    await this.locks.assertDatesOpen(date, date);
    const saved = await this.prisma.hrAttendanceCorrection.update({
      where: { id },
      data: { revokedAt: new Date(), revokedById: actor.id, revokedByName: actor.name, revokeReason: reason.trim() },
    });
    await this.process({ from: date, to: date, employeeIds: [row.employeeId] });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CANCEL,
      module: AUDIT_MODULES.HR,
      description: `إلغاء تصحيح حضور ${fullName(row.employee)} ليوم ${date} — ${reason.trim()}`,
      entity: 'HrAttendanceCorrection',
      entityId: id,
    });
    return saved;
  }

  async justifyLate(dayId: string, dto: { justified: boolean; reason?: string | null }, actor: Actor) {
    const day = await this.prisma.hrAttendanceDay.findUnique({ where: { id: dayId }, include: { employee: true } });
    if (!day) throw new NotFoundException('اليوم غير موجود');
    if (!day.isLate) throw new BadRequestException('لا يوجد تأخر في هذا اليوم');
    const date = dbDateToKey(day.date);
    await this.locks.assertDatesOpen(date, date);
    if (dto.justified && !dto.reason?.trim()) throw new BadRequestException('سبب التبرير إلزامي');
    const saved = await this.prisma.hrAttendanceDay.update({
      where: { id: dayId },
      data: {
        lateJustified: dto.justified,
        lateJustification: dto.reason?.trim() || null,
        lateDecidedById: actor.id,
        lateDecidedByName: actor.name,
        lateDecidedAt: new Date(),
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: dto.justified ? AUDIT_ACTIONS.APPROVE : AUDIT_ACTIONS.REJECT,
      module: AUDIT_MODULES.HR,
      description: `${dto.justified ? 'تبرير' : 'إلغاء تبرير'} تأخر ${fullName(day.employee)} يوم ${date} (${day.lateMinutes} د)${dto.reason ? ` — ${dto.reason.trim()}` : ''}`,
      entity: 'HrAttendanceDay',
      entityId: dayId,
    });
    return saved;
  }
}
