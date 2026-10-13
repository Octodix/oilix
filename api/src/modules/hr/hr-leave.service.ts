import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HrApprovalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import { dateKeyToDb, dbDateToKey, eachDateKey } from './engine/hr-time';
import { HrAttendanceService } from './hr-attendance.service';
import { HrLocksService } from './hr-locks.service';
import { HrSchedulesService } from './hr-schedules.service';
import { HrSettingsService } from './hr-settings.service';
import { fullName, isUniqueViolation, num, requireRange, type Actor } from './hr-common';

type Kind = 'leave' | 'sick' | 'absence';

const KIND_LABEL: Record<Kind, string> = { leave: 'عطلة', sick: 'عطلة مرضية', absence: 'غياب' };
const MAX_ATTACHMENT_CHARS = 3_000_000;

function checkAttachment(a?: string | null) {
  if (!a) return;
  if (!/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(a) || a.length > MAX_ATTACHMENT_CHARS) {
    throw new BadRequestException('المرفق غير صالح (صورة أو PDF، 2 ميغابايت كحد أقصى)');
  }
}

@Injectable()
export class HrLeaveService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private attendance: HrAttendanceService,
    private schedules: HrSchedulesService,
    private locks: HrLocksService,
    private hrSettings: HrSettingsService,
  ) {}

  // ── Types ────────────────────────────────────────────────────────────────

  listLeaveTypes() {
    return this.prisma.hrLeaveType.findMany({ orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }] });
  }

  async upsertLeaveType(
    id: string | null,
    dto: { code?: string; name?: string; nameFr?: string | null; isPaid?: boolean; deductsFromBalance?: boolean; defaultDaysPerYear?: number | null; isActive?: boolean; sortOrder?: number },
    actor: Actor,
  ) {
    try {
      const data = {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.nameFr !== undefined ? { nameFr: dto.nameFr?.trim() || null } : {}),
        ...(dto.isPaid !== undefined ? { isPaid: dto.isPaid } : {}),
        ...(dto.deductsFromBalance !== undefined ? { deductsFromBalance: dto.deductsFromBalance } : {}),
        ...(dto.defaultDaysPerYear !== undefined ? { defaultDaysPerYear: dto.defaultDaysPerYear } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      };
      const row = id
        ? await this.prisma.hrLeaveType.update({ where: { id }, data })
        : await this.prisma.hrLeaveType.create({
            data: { ...data, code: (dto.code ?? '').trim().toUpperCase(), name: (dto.name ?? '').trim() },
          });
      await this.audit.log({
        userId: actor.id,
        action: id ? AUDIT_ACTIONS.UPDATE : AUDIT_ACTIONS.CREATE,
        module: AUDIT_MODULES.HR,
        description: `${id ? 'تعديل' : 'إنشاء'} نوع العطلة «${row.name}»`,
        entity: 'HrLeaveType',
        entityId: row.id,
        newData: row as unknown as Prisma.InputJsonValue,
      });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('الرمز مستخدم مسبقاً');
      throw e;
    }
  }

  listAbsenceTypes() {
    return this.prisma.hrAbsenceType.findMany({ orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }] });
  }

  async upsertAbsenceType(
    id: string | null,
    dto: { code?: string; name?: string; nameFr?: string | null; isPaid?: boolean; isJustified?: boolean; isActive?: boolean; sortOrder?: number },
    actor: Actor,
  ) {
    try {
      const data = {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.nameFr !== undefined ? { nameFr: dto.nameFr?.trim() || null } : {}),
        ...(dto.isPaid !== undefined ? { isPaid: dto.isPaid } : {}),
        ...(dto.isJustified !== undefined ? { isJustified: dto.isJustified } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      };
      const row = id
        ? await this.prisma.hrAbsenceType.update({ where: { id }, data })
        : await this.prisma.hrAbsenceType.create({
            data: { ...data, code: (dto.code ?? '').trim().toUpperCase(), name: (dto.name ?? '').trim() },
          });
      await this.audit.log({
        userId: actor.id,
        action: id ? AUDIT_ACTIONS.UPDATE : AUDIT_ACTIONS.CREATE,
        module: AUDIT_MODULES.HR,
        description: `${id ? 'تعديل' : 'إنشاء'} نوع الغياب «${row.name}»`,
        entity: 'HrAbsenceType',
        entityId: row.id,
        newData: row as unknown as Prisma.InputJsonValue,
      });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('الرمز مستخدم مسبقاً');
      throw e;
    }
  }

  // ── Balances ─────────────────────────────────────────────────────────────

  async setEntitlement(dto: { employeeId: string; leaveTypeId: string; year: number; days: number; notes?: string | null }, actor: Actor) {
    if (!(dto.days >= 0 && dto.days <= 366)) throw new BadRequestException('عدد الأيام غير صالح');
    const row = await this.prisma.hrLeaveEntitlement.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year } },
      create: { employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year, days: dto.days, notes: dto.notes?.trim() || null },
      update: { days: dto.days, notes: dto.notes?.trim() || null },
      include: { employee: true, leaveType: true },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.HR,
      description: `رصيد ${row.leaveType.name} ${dto.year} لـ ${fullName(row.employee)}: ${dto.days} يوم`,
      entity: 'HrLeaveEntitlement',
      entityId: row.id,
    });
    return row;
  }

  async balances(year: number, employeeId?: string) {
    const [employees, types, entitlements, requests] = await Promise.all([
      this.prisma.hrEmployee.findMany({
        where: { archivedAt: null, ...(employeeId ? { id: employeeId } : {}) },
        select: { id: true, matricule: true, firstName: true, lastName: true },
        orderBy: { lastName: 'asc' },
      }),
      this.prisma.hrLeaveType.findMany({ where: { deductsFromBalance: true, isActive: true } }),
      this.prisma.hrLeaveEntitlement.findMany({ where: { year, ...(employeeId ? { employeeId } : {}) } }),
      this.prisma.hrLeaveRequest.findMany({
        where: {
          status: { in: [HrApprovalStatus.APPROVED, HrApprovalStatus.PENDING] },
          startDate: { gte: dateKeyToDb(`${year}-01-01`), lte: dateKeyToDb(`${year}-12-31`) },
          ...(employeeId ? { employeeId } : {}),
        },
      }),
    ]);
    return employees.map((e) => ({
      employee: e,
      balances: types.map((t) => {
        const ent = entitlements.find((x) => x.employeeId === e.id && x.leaveTypeId === t.id);
        const entitled = ent ? num(ent.days) : num(t.defaultDaysPerYear);
        const mine = requests.filter((r) => r.employeeId === e.id && r.leaveTypeId === t.id);
        const taken = mine.filter((r) => r.status === HrApprovalStatus.APPROVED).reduce((s, r) => s + num(r.days), 0);
        const pending = mine.filter((r) => r.status === HrApprovalStatus.PENDING).reduce((s, r) => s + num(r.days), 0);
        return { leaveType: t, entitled, explicit: !!ent, taken, pending, remaining: entitled - taken };
      }),
    }));
  }

  /** Scheduled working days in the range (holidays excluded); falls back to calendar days. */
  private async workingDays(employeeId: string, from: string, to: string): Promise<number> {
    const emp = await this.prisma.hrEmployee.findUnique({ where: { id: employeeId }, select: { id: true, departmentId: true } });
    if (!emp) throw new NotFoundException('الموظف غير موجود');
    const resolve = await this.schedules.resolver([emp], from, to);
    const holidays = new Set(
      (await this.prisma.hrHoliday.findMany({ where: { date: { gte: dateKeyToDb(from), lte: dateKeyToDb(to) } } })).map((h) =>
        dbDateToKey(h.date),
      ),
    );
    const dates = eachDateKey(from, to);
    const working = dates.filter((d) => !holidays.has(d) && (resolve(emp.id, d)?.segments.length ?? 0) > 0).length;
    return working || dates.length;
  }

  private async assertNoOverlap(employeeId: string, from: string, to: string, except: { kind: Kind; id: string }) {
    const where = {
      employeeId,
      status: HrApprovalStatus.APPROVED,
      startDate: { lte: dateKeyToDb(to) },
      endDate: { gte: dateKeyToDb(from) },
    };
    const [l, s, a] = await Promise.all([
      this.prisma.hrLeaveRequest.findFirst({ where: { ...where, ...(except.kind === 'leave' ? { id: { not: except.id } } : {}) } }),
      this.prisma.hrSickLeave.findFirst({ where: { ...where, ...(except.kind === 'sick' ? { id: { not: except.id } } : {}) } }),
      this.prisma.hrAbsence.findFirst({ where: { ...where, ...(except.kind === 'absence' ? { id: { not: except.id } } : {}) } }),
    ]);
    const hit = l ? 'عطلة' : s ? 'عطلة مرضية' : a ? 'غياب' : null;
    if (hit) throw new BadRequestException(`يتداخل مع ${hit} مصادق عليها لنفس الموظف`);
  }

  // ── Leave requests ───────────────────────────────────────────────────────

  listLeaveRequests(q: { status?: HrApprovalStatus; employeeId?: string; from?: string; to?: string }) {
    return this.prisma.hrLeaveRequest.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.from && q.to ? { startDate: { lte: dateKeyToDb(q.to) }, endDate: { gte: dateKeyToDb(q.from) } } : {}),
      },
      include: {
        employee: { select: { id: true, matricule: true, firstName: true, lastName: true } },
        leaveType: true,
      },
      omit: { attachment: true },
      orderBy: { startDate: 'desc' },
      take: 500,
    });
  }

  /** Attachments are omitted from lists (up to ~2 MB each) and fetched one at a time. */
  async getAttachment(kind: Kind, id: string) {
    const select = { attachment: true, attachmentName: true } as const;
    const row =
      kind === 'leave'
        ? await this.prisma.hrLeaveRequest.findUnique({ where: { id }, select })
        : kind === 'sick'
          ? await this.prisma.hrSickLeave.findUnique({ where: { id }, select })
          : await this.prisma.hrAbsence.findUnique({ where: { id }, select });
    if (!row?.attachment) throw new NotFoundException('لا يوجد مرفق');
    return row;
  }

  async createLeaveRequest(
    dto: { employeeId: string; leaveTypeId: string; startDate: string; endDate: string; reason?: string | null; attachment?: string | null; attachmentName?: string | null; approveNow?: boolean },
    canApprove: boolean,
    actor: Actor,
  ) {
    const { from, to } = requireRange(dto.startDate, dto.endDate);
    checkAttachment(dto.attachment);
    const type = await this.prisma.hrLeaveType.findUnique({ where: { id: dto.leaveTypeId } });
    if (!type || !type.isActive) throw new BadRequestException('نوع العطلة غير صالح');
    const days = await this.workingDays(dto.employeeId, from, to);
    const row = await this.prisma.hrLeaveRequest.create({
      data: {
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        startDate: dateKeyToDb(from),
        endDate: dateKeyToDb(to),
        days,
        reason: dto.reason?.trim() || null,
        attachment: dto.attachment || null,
        attachmentName: dto.attachmentName?.slice(0, 200) || null,
        requestedById: actor.id,
        requestedByName: actor.name,
      },
      include: { employee: true },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.HR,
      description: `طلب ${type.name} لـ ${fullName(row.employee)} من ${from} إلى ${to} (${days} يوم)`,
      entity: 'HrLeaveRequest',
      entityId: row.id,
    });
    if (dto.approveNow && canApprove) return this.decide('leave', row.id, 'APPROVE', { note: null }, actor);
    return row;
  }

  // ── Sick leave ───────────────────────────────────────────────────────────

  listSickLeaves(q: { status?: HrApprovalStatus; employeeId?: string; from?: string; to?: string }) {
    return this.prisma.hrSickLeave.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.from && q.to ? { startDate: { lte: dateKeyToDb(q.to) }, endDate: { gte: dateKeyToDb(q.from) } } : {}),
      },
      include: { employee: { select: { id: true, matricule: true, firstName: true, lastName: true } } },
      omit: { attachment: true },
      orderBy: { startDate: 'desc' },
      take: 500,
    });
  }

  async createSickLeave(
    dto: {
      employeeId: string;
      startDate: string;
      endDate: string;
      certificateRef?: string | null;
      doctorName?: string | null;
      attachment?: string | null;
      attachmentName?: string | null;
      notes?: string | null;
      payrollTreatment?: 'UNPAID' | 'PAID' | 'PARTIAL';
      paidPercent?: number;
      approveNow?: boolean;
    },
    canApprove: boolean,
    actor: Actor,
  ) {
    const { from, to } = requireRange(dto.startDate, dto.endDate);
    checkAttachment(dto.attachment);
    const settings = await this.hrSettings.get();
    const treatment = dto.payrollTreatment ?? settings.sickLeave.defaultTreatment;
    const pct = treatment === 'PAID' ? 100 : treatment === 'UNPAID' ? 0 : dto.paidPercent ?? settings.sickLeave.defaultPaidPercent;
    if (!(pct >= 0 && pct <= 100)) throw new BadRequestException('النسبة غير صالحة');
    const row = await this.prisma.hrSickLeave.create({
      data: {
        employeeId: dto.employeeId,
        startDate: dateKeyToDb(from),
        endDate: dateKeyToDb(to),
        days: eachDateKey(from, to).length,
        certificateRef: dto.certificateRef?.trim() || null,
        doctorName: dto.doctorName?.trim() || null,
        attachment: dto.attachment || null,
        attachmentName: dto.attachmentName?.slice(0, 200) || null,
        notes: dto.notes?.trim() || null,
        payrollTreatment: treatment,
        paidPercent: pct,
        createdById: actor.id,
        createdByName: actor.name,
      },
      include: { employee: true },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.HR,
      description: `تسجيل عطلة مرضية لـ ${fullName(row.employee)} من ${from} إلى ${to}`,
      entity: 'HrSickLeave',
      entityId: row.id,
    });
    if (dto.approveNow && canApprove) return this.decide('sick', row.id, 'APPROVE', { note: null }, actor);
    return row;
  }

  // ── Absences ─────────────────────────────────────────────────────────────

  listAbsences(q: { status?: HrApprovalStatus; employeeId?: string; from?: string; to?: string }) {
    return this.prisma.hrAbsence.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.from && q.to ? { startDate: { lte: dateKeyToDb(q.to) }, endDate: { gte: dateKeyToDb(q.from) } } : {}),
      },
      include: {
        employee: { select: { id: true, matricule: true, firstName: true, lastName: true } },
        absenceType: true,
      },
      omit: { attachment: true },
      orderBy: { startDate: 'desc' },
      take: 500,
    });
  }

  async createAbsence(
    dto: {
      employeeId: string;
      absenceTypeId: string;
      startDate: string;
      endDate: string;
      reason?: string | null;
      isPaid?: boolean;
      attachment?: string | null;
      attachmentName?: string | null;
      approveNow?: boolean;
    },
    canApprove: boolean,
    actor: Actor,
  ) {
    const { from, to } = requireRange(dto.startDate, dto.endDate);
    checkAttachment(dto.attachment);
    const type = await this.prisma.hrAbsenceType.findUnique({ where: { id: dto.absenceTypeId } });
    if (!type || !type.isActive) throw new BadRequestException('نوع الغياب غير صالح');
    const days = await this.workingDays(dto.employeeId, from, to);
    const row = await this.prisma.hrAbsence.create({
      data: {
        employeeId: dto.employeeId,
        absenceTypeId: dto.absenceTypeId,
        startDate: dateKeyToDb(from),
        endDate: dateKeyToDb(to),
        days,
        reason: dto.reason?.trim() || null,
        isPaid: dto.isPaid ?? type.isPaid,
        attachment: dto.attachment || null,
        attachmentName: dto.attachmentName?.slice(0, 200) || null,
        createdById: actor.id,
        createdByName: actor.name,
      },
      include: { employee: true },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.HR,
      description: `تسجيل ${type.name} لـ ${fullName(row.employee)} من ${from} إلى ${to}`,
      entity: 'HrAbsence',
      entityId: row.id,
    });
    if (dto.approveNow && canApprove) return this.decide('absence', row.id, 'APPROVE', { note: null }, actor);
    return row;
  }

  // ── Shared approval workflow ─────────────────────────────────────────────

  private async load(kind: Kind, id: string) {
    const include = { employee: true } as const;
    const row =
      kind === 'leave'
        ? await this.prisma.hrLeaveRequest.findUnique({ where: { id }, include })
        : kind === 'sick'
          ? await this.prisma.hrSickLeave.findUnique({ where: { id }, include })
          : await this.prisma.hrAbsence.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundException(`${KIND_LABEL[kind]} غير موجودة`);
    return row;
  }

  async decide(kind: Kind, id: string, decision: 'APPROVE' | 'REJECT' | 'CANCEL', dto: { note?: string | null }, actor: Actor) {
    const row = await this.load(kind, id);
    const from = dbDateToKey(row.startDate);
    const to = dbDateToKey(row.endDate);
    const next =
      decision === 'APPROVE' ? HrApprovalStatus.APPROVED : decision === 'REJECT' ? HrApprovalStatus.REJECTED : HrApprovalStatus.CANCELLED;
    if (decision !== 'CANCEL' && row.status !== HrApprovalStatus.PENDING) {
      throw new BadRequestException('تمت معالجة هذا الطلب مسبقاً');
    }
    if (decision === 'CANCEL' && row.status !== HrApprovalStatus.PENDING && row.status !== HrApprovalStatus.APPROVED) {
      throw new BadRequestException('لا يمكن إلغاء هذا الطلب');
    }
    if ((decision === 'REJECT' || decision === 'CANCEL') && !dto.note?.trim() && row.status === HrApprovalStatus.APPROVED) {
      throw new BadRequestException('السبب إلزامي');
    }
    const affectsAttendance = decision === 'APPROVE' || row.status === HrApprovalStatus.APPROVED;
    if (affectsAttendance) await this.locks.assertDatesOpen(from, to);
    if (decision === 'APPROVE') await this.assertNoOverlap(row.employeeId, from, to, { kind, id });

    const decided = { decidedById: actor.id, decidedByName: actor.name, decidedAt: new Date() };
    const where = { id, status: row.status };
    const claim =
      kind === 'leave'
        ? await this.prisma.hrLeaveRequest.updateMany({ where, data: { status: next, ...decided, decisionNote: dto.note?.trim() || null } })
        : kind === 'sick'
          ? await this.prisma.hrSickLeave.updateMany({ where, data: { status: next, ...decided } })
          : await this.prisma.hrAbsence.updateMany({ where, data: { status: next, ...decided } });
    if (claim.count !== 1) throw new BadRequestException('تم تعديل الطلب من مستخدم آخر — أعد المحاولة');

    if (affectsAttendance) await this.attendance.process({ from, to, employeeIds: [row.employeeId] });
    const verb = decision === 'APPROVE' ? 'المصادقة على' : decision === 'REJECT' ? 'رفض' : 'إلغاء';
    await this.audit.log({
      userId: actor.id,
      action: decision === 'APPROVE' ? AUDIT_ACTIONS.APPROVE : decision === 'REJECT' ? AUDIT_ACTIONS.REJECT : AUDIT_ACTIONS.CANCEL,
      module: AUDIT_MODULES.HR,
      description: `${verb} ${KIND_LABEL[kind]} ${fullName(row.employee)} (${from} → ${to})${dto.note?.trim() ? ` — ${dto.note.trim()}` : ''}`,
      entity: kind === 'leave' ? 'HrLeaveRequest' : kind === 'sick' ? 'HrSickLeave' : 'HrAbsence',
      entityId: id,
    });
    return this.load(kind, id);
  }
}
