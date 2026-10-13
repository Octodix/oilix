import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import type { DaySchedule } from './engine/attendance-engine';
import { dateKeyToDb, dbDateToKey, formatHhMm, parseHhMm, weekdayOf } from './engine/hr-time';
import { HrSettingsService } from './hr-settings.service';
import { isUniqueViolation, requireDateKey, type Actor } from './hr-common';

export type SegmentInput = { weekday: number; start: string; end: string };

export type ScheduleInput = {
  code: string;
  name: string;
  description?: string | null;
  breakMinutes?: number;
  isActive?: boolean;
  segments: SegmentInput[];
};

type ScheduleWithSegments = Prisma.HrWorkScheduleGetPayload<{ include: { segments: true } }>;

/** Validates and converts HH:MM segments; at most one block per weekday may cross midnight (the last). */
export function normaliseSegments(segments: SegmentInput[]) {
  if (!Array.isArray(segments)) throw new BadRequestException('الفترات غير صالحة');
  if (segments.some((s) => !Number.isInteger(Number(s.weekday)) || Number(s.weekday) < 0 || Number(s.weekday) > 6)) {
    throw new BadRequestException('اليوم غير صالح');
  }
  const out: { weekday: number; startMinute: number; endMinute: number; sortOrder: number }[] = [];
  for (let wd = 0; wd <= 6; wd++) {
    const day = segments
      .filter((s) => Number(s.weekday) === wd)
      .map((s) => {
        const start = parseHhMm(String(s.start ?? ''));
        const end = parseHhMm(String(s.end ?? ''));
        if (start === null || end === null || start >= 1440) {
          throw new BadRequestException(`توقيت غير صالح (${s.start} – ${s.end})`);
        }
        if (start === end) throw new BadRequestException('بداية الفترة ونهايتها متساويتان');
        return { start, end: end <= start ? end + 1440 : end };
      })
      .sort((a, b) => a.start - b.start);
    for (let i = 0; i < day.length; i++) {
      if (i > 0 && day[i].start < day[i - 1].end) {
        throw new BadRequestException('فترات متداخلة في نفس اليوم');
      }
      if (day[i].end > 1440 && i !== day.length - 1) {
        throw new BadRequestException('فترة الليل يجب أن تكون آخر فترة في اليوم');
      }
      const end = day[i].end > 1440 ? day[i].end - 1440 : day[i].end;
      out.push({ weekday: wd, startMinute: day[i].start, endMinute: end, sortOrder: i });
    }
  }
  return out;
}

export function presentSchedule(s: ScheduleWithSegments) {
  return {
    ...s,
    segments: [...s.segments]
      .sort((a, b) => a.weekday - b.weekday || a.sortOrder - b.sortOrder)
      .map((g) => ({
        id: g.id,
        weekday: g.weekday,
        start: formatHhMm(g.startMinute),
        end: g.endMinute === 1440 ? '24:00' : formatHhMm(g.endMinute),
        overnight: g.endMinute <= g.startMinute,
      })),
  };
}

export function toDaySchedule(s: ScheduleWithSegments, date: string): DaySchedule {
  const wd = weekdayOf(date);
  return {
    scheduleId: s.id,
    scheduleName: s.name,
    breakMinutes: s.breakMinutes,
    segments: s.segments
      .filter((g) => g.weekday === wd)
      .sort((a, b) => a.startMinute - b.startMinute)
      .map((g) => ({ startMinute: g.startMinute, endMinute: g.endMinute })),
  };
}

export type ScheduleResolver = (employeeId: string, date: string) => DaySchedule | null;

@Injectable()
export class HrSchedulesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private hrSettings: HrSettingsService,
  ) {}

  async list() {
    const rows = await this.prisma.hrWorkSchedule.findMany({
      include: { segments: true, _count: { select: { assignments: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    const settings = await this.hrSettings.get();
    return rows.map((r) => ({ ...presentSchedule(r), isDefault: r.id === settings.defaultScheduleId }));
  }

  async create(dto: ScheduleInput, actor: Actor) {
    const segments = normaliseSegments(dto.segments);
    try {
      const row = await this.prisma.hrWorkSchedule.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          breakMinutes: dto.breakMinutes ?? 0,
          isActive: dto.isActive ?? true,
          segments: { create: segments },
        },
        include: { segments: true },
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.CREATE,
        module: AUDIT_MODULES.HR,
        description: `إنشاء توقيت عمل «${row.name}»`,
        entity: 'HrWorkSchedule',
        entityId: row.id,
        newData: presentSchedule(row) as unknown as Prisma.InputJsonValue,
      });
      return presentSchedule(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('رمز التوقيت مستخدم مسبقاً');
      throw e;
    }
  }

  async update(id: string, dto: Partial<ScheduleInput>, actor: Actor) {
    const old = await this.prisma.hrWorkSchedule.findUnique({ where: { id }, include: { segments: true } });
    if (!old) throw new NotFoundException('التوقيت غير موجود');
    const segments = dto.segments ? normaliseSegments(dto.segments) : null;
    const row = await this.prisma.$transaction(async (tx) => {
      if (segments) {
        await tx.hrScheduleSegment.deleteMany({ where: { scheduleId: id } });
        await tx.hrScheduleSegment.createMany({ data: segments.map((s) => ({ ...s, scheduleId: id })) });
      }
      return tx.hrWorkSchedule.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...(dto.breakMinutes !== undefined ? { breakMinutes: dto.breakMinutes } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        include: { segments: true },
      });
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.HR,
      description: `تعديل توقيت العمل «${row.name}»`,
      entity: 'HrWorkSchedule',
      entityId: id,
      oldData: presentSchedule(old) as unknown as Prisma.InputJsonValue,
      newData: presentSchedule(row) as unknown as Prisma.InputJsonValue,
    });
    return presentSchedule(row);
  }

  listAssignments(filter: { employeeId?: string; departmentId?: string }) {
    return this.prisma.hrScheduleAssignment.findMany({
      where: {
        ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      },
      include: {
        schedule: { select: { id: true, name: true, code: true } },
        employee: { select: { id: true, firstName: true, lastName: true, matricule: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ startDate: 'desc' }],
      take: 500,
    });
  }

  async createAssignment(
    dto: {
      scheduleId: string;
      employeeId?: string | null;
      departmentId?: string | null;
      startDate: string;
      endDate?: string | null;
      isOverride?: boolean;
      reason?: string | null;
    },
    actor: Actor,
  ) {
    if (!!dto.employeeId === !!dto.departmentId) {
      throw new BadRequestException('اختر موظفاً أو قسماً (واحد فقط)');
    }
    const start = requireDateKey(dto.startDate, 'تاريخ البداية');
    const end = dto.endDate ? requireDateKey(dto.endDate, 'تاريخ النهاية') : null;
    if (end && end < start) throw new BadRequestException('تاريخ النهاية قبل البداية');
    if (dto.isOverride && !end) throw new BadRequestException('التوقيت المؤقت يحتاج تاريخ نهاية');
    const schedule = await this.prisma.hrWorkSchedule.findUnique({ where: { id: dto.scheduleId } });
    if (!schedule) throw new NotFoundException('التوقيت غير موجود');
    const row = await this.prisma.hrScheduleAssignment.create({
      data: {
        scheduleId: dto.scheduleId,
        employeeId: dto.employeeId || null,
        departmentId: dto.departmentId || null,
        startDate: dateKeyToDb(start),
        endDate: end ? dateKeyToDb(end) : null,
        isOverride: !!dto.isOverride,
        reason: dto.reason?.trim() || null,
        createdById: actor.id,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.HR,
      description: `إسناد التوقيت «${schedule.name}» ابتداءً من ${start}${dto.isOverride ? ' (مؤقت)' : ''}`,
      entity: 'HrScheduleAssignment',
      entityId: row.id,
      newData: { ...dto } as Prisma.InputJsonValue,
    });
    return row;
  }

  async deleteAssignment(id: string, actor: Actor) {
    const row = await this.prisma.hrScheduleAssignment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('الإسناد غير موجود');
    await this.prisma.hrScheduleAssignment.delete({ where: { id } });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.DELETE,
      module: AUDIT_MODULES.HR,
      description: `حذف إسناد توقيت (${dbDateToKey(row.startDate)})`,
      entity: 'HrScheduleAssignment',
      entityId: id,
      oldData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  listHolidays(year?: number) {
    return this.prisma.hrHoliday.findMany({
      where: year
        ? { date: { gte: dateKeyToDb(`${year}-01-01`), lte: dateKeyToDb(`${year}-12-31`) } }
        : undefined,
      orderBy: { date: 'asc' },
    });
  }

  async createHoliday(dto: { date: string; name: string; isPaid?: boolean }, actor: Actor) {
    const date = requireDateKey(dto.date);
    try {
      const row = await this.prisma.hrHoliday.create({
        data: { date: dateKeyToDb(date), name: dto.name.trim(), isPaid: dto.isPaid ?? true },
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.CREATE,
        module: AUDIT_MODULES.HR,
        description: `إضافة عطلة رسمية «${row.name}» (${date})`,
        entity: 'HrHoliday',
        entityId: row.id,
      });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('يوجد عطلة مسجلة في هذا التاريخ');
      throw e;
    }
  }

  async deleteHoliday(id: string, actor: Actor) {
    const row = await this.prisma.hrHoliday.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('العطلة غير موجودة');
    await this.prisma.hrHoliday.delete({ where: { id } });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.DELETE,
      module: AUDIT_MODULES.HR,
      description: `حذف العطلة «${row.name}» (${dbDateToKey(row.date)})`,
      entity: 'HrHoliday',
      entityId: id,
    });
    return row;
  }

  /**
   * Priority: employee override > employee schedule > department override > department schedule
   * > global default. Among equals, the most recent start date wins.
   */
  async resolver(employees: { id: string; departmentId: string | null }[], from: string, to: string): Promise<ScheduleResolver> {
    const settings = await this.hrSettings.get();
    const empIds = employees.map((e) => e.id);
    const deptIds = [...new Set(employees.map((e) => e.departmentId).filter((d): d is string => !!d))];
    const assignments = await this.prisma.hrScheduleAssignment.findMany({
      where: {
        startDate: { lte: dateKeyToDb(to) },
        OR: [{ endDate: null }, { endDate: { gte: dateKeyToDb(from) } }],
        AND: [{ OR: [{ employeeId: { in: empIds } }, { departmentId: { in: deptIds } }] }],
      },
      orderBy: { startDate: 'desc' },
    });
    const scheduleIds = new Set(assignments.map((a) => a.scheduleId));
    if (settings.defaultScheduleId) scheduleIds.add(settings.defaultScheduleId);
    const schedules = new Map(
      (
        await this.prisma.hrWorkSchedule.findMany({
          where: { id: { in: [...scheduleIds] } },
          include: { segments: true },
        })
      ).map((s) => [s.id, s]),
    );
    const deptOf = new Map(employees.map((e) => [e.id, e.departmentId]));
    const fallback = settings.defaultScheduleId ? schedules.get(settings.defaultScheduleId) ?? null : null;
    const covers = (a: (typeof assignments)[number], date: string) =>
      dbDateToKey(a.startDate) <= date && (!a.endDate || dbDateToKey(a.endDate) >= date);

    return (employeeId, date) => {
      const dept = deptOf.get(employeeId) ?? null;
      const tiers = [
        (a: (typeof assignments)[number]) => a.employeeId === employeeId && a.isOverride,
        (a: (typeof assignments)[number]) => a.employeeId === employeeId && !a.isOverride,
        (a: (typeof assignments)[number]) => !!dept && a.departmentId === dept && a.isOverride,
        (a: (typeof assignments)[number]) => !!dept && a.departmentId === dept && !a.isOverride,
      ];
      for (const tier of tiers) {
        const hit = assignments.find((a) => tier(a) && covers(a, date));
        if (hit) {
          const s = schedules.get(hit.scheduleId);
          if (s) return toDaySchedule(s, date);
        }
      }
      return fallback ? toDaySchedule(fallback, date) : null;
    };
  }
}
