import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { HrEmployeeStatus, HrSalaryMode, Prisma, type HrContract } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { addDays, dateKeyToDb, dbDateToKey, localDateKey } from './engine/hr-time';
import { HrSettingsService } from './hr-settings.service';
import { can, canSeeSalaries, fullName, isUniqueViolation, num, requireDateKey, type Actor } from './hr-common';

export type EmployeeInput = {
  matricule?: string | null;
  firstName: string;
  lastName: string;
  photo?: string | null;
  birthDate?: string | null;
  phone?: string | null;
  address?: string | null;
  nationalIdNumber?: string | null;
  nationalIdIssuedAt?: string | null;
  nationalIdIssuedBy?: string | null;
  socialSecurityNumber?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  jobTitle?: string | null;
  departmentId?: string | null;
  workSite?: string | null;
  hireDate: string;
  status?: HrEmployeeStatus;
  leftAt?: string | null;
  leftReason?: string | null;
  paymentMethod?: string;
  bankAccount?: string | null;
  userId?: string | null;
  notes?: string | null;
};

export type ContractInput = {
  employeeId: string;
  contractType: string;
  startDate: string;
  endDate?: string | null;
  trialEndDate?: string | null;
  salaryMode?: HrSalaryMode;
  baseSalary: number;
  weeklyHours?: number;
  jobTitle?: string | null;
  departmentId?: string | null;
  documentRef?: string | null;
  notes?: string | null;
};

export const CONTRACT_TYPES = ['CDI', 'CDD', 'SEASONAL', 'PART_TIME', 'TRIAL', 'INTERNSHIP', 'OTHER'] as const;
export const EMPLOYEE_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CCP', 'CHEQUE'] as const;
const MAX_PHOTO_CHARS = 400_000;

const opt = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
const optDate = (v: string | null | undefined, label: string) =>
  v === undefined ? undefined : v ? dateKeyToDb(requireDateKey(v, label)) : null;

export function presentContract(c: HrContract, showSalary: boolean) {
  return {
    ...c,
    startDate: dbDateToKey(c.startDate),
    endDate: c.endDate ? dbDateToKey(c.endDate) : null,
    trialEndDate: c.trialEndDate ? dbDateToKey(c.trialEndDate) : null,
    terminatedAt: c.terminatedAt ? dbDateToKey(c.terminatedAt) : null,
    baseSalary: showSalary ? num(c.baseSalary) : null,
    weeklyHours: num(c.weeklyHours),
  };
}

@Injectable()
export class HrEmployeesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private hrSettings: HrSettingsService,
  ) {}

  // ── Departments ──────────────────────────────────────────────────────────

  listDepartments() {
    return this.prisma.hrDepartment.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { employees: { where: { archivedAt: null } } } } },
    });
  }

  async createDepartment(dto: { name: string; nameFr?: string | null; code?: string | null; notes?: string | null }, actor: Actor) {
    try {
      const row = await this.prisma.hrDepartment.create({
        data: {
          name: dto.name.trim(),
          nameFr: dto.nameFr?.trim() || null,
          code: dto.code?.trim().toUpperCase() || null,
          notes: dto.notes?.trim() || null,
        },
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.CREATE,
        module: AUDIT_MODULES.HR,
        description: `إنشاء قسم «${row.name}»`,
        entity: 'HrDepartment',
        entityId: row.id,
      });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('رمز القسم مستخدم مسبقاً');
      throw e;
    }
  }

  async updateDepartment(
    id: string,
    dto: { name?: string; nameFr?: string | null; code?: string | null; isActive?: boolean; notes?: string | null },
    actor: Actor,
  ) {
    const old = await this.prisma.hrDepartment.findUnique({ where: { id } });
    if (!old) throw new NotFoundException('القسم غير موجود');
    try {
      const row = await this.prisma.hrDepartment.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.nameFr !== undefined ? { nameFr: opt(dto.nameFr) } : {}),
          ...(dto.code !== undefined ? { code: dto.code?.trim().toUpperCase() || null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.notes !== undefined ? { notes: opt(dto.notes) } : {}),
        },
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.UPDATE,
        module: AUDIT_MODULES.HR,
        description: `تعديل القسم «${row.name}»`,
        entity: 'HrDepartment',
        entityId: id,
        oldData: old as unknown as Prisma.InputJsonValue,
        newData: row as unknown as Prisma.InputJsonValue,
      });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('رمز القسم مستخدم مسبقاً');
      throw e;
    }
  }

  // ── Employees ────────────────────────────────────────────────────────────

  private redact<T extends { bankAccount?: string | null }>(e: T, user: JwtPayload): T {
    return canSeeSalaries(user) ? e : { ...e, bankAccount: e.bankAccount ? '••••' : null };
  }

  async list(
    q: { search?: string; status?: HrEmployeeStatus; departmentId?: string; includeArchived?: boolean },
    user: JwtPayload,
  ) {
    const search = q.search?.trim();
    const settings = await this.hrSettings.get();
    const today = dateKeyToDb(localDateKey(new Date(), settings.timezoneOffsetMinutes));
    const rows = await this.prisma.hrEmployee.findMany({
      where: {
        ...(q.includeArchived ? {} : { archivedAt: null }),
        ...(q.status ? { status: q.status } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { matricule: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
                { jobTitle: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        department: { select: { id: true, name: true } },
        contracts: {
          where: { startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }], status: 'ACTIVE' },
          orderBy: { startDate: 'desc' },
          take: 1,
        },
        _count: { select: { deviceMappings: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const showSalary = canSeeSalaries(user);
    return rows.map(({ contracts, photo, ...e }) => ({
      ...this.redact(e, user),
      hasPhoto: !!photo,
      hireDate: dbDateToKey(e.hireDate),
      leftAt: e.leftAt ? dbDateToKey(e.leftAt) : null,
      birthDate: e.birthDate ? dbDateToKey(e.birthDate) : null,
      currentContract: contracts[0] ? presentContract(contracts[0], showSalary) : null,
      deviceMappings: e._count.deviceMappings,
    }));
  }

  /** Minimal list for pickers in leave / overtime / pay screens (no personal or salary data). */
  async options(includeLeft = false) {
    const rows = await this.prisma.hrEmployee.findMany({
      where: { archivedAt: null, ...(includeLeft ? {} : { status: { not: HrEmployeeStatus.LEFT } }) },
      select: { id: true, matricule: true, firstName: true, lastName: true, status: true, departmentId: true, jobTitle: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return rows.map((e) => ({ ...e, fullName: fullName(e) }));
  }

  async get(id: string, user: JwtPayload) {
    const e = await this.prisma.hrEmployee.findUnique({
      where: { id },
      include: {
        department: true,
        user: { select: { id: true, username: true, firstName: true, lastName: true } },
        contracts: { orderBy: { startDate: 'desc' } },
        deviceMappings: { include: { device: { select: { id: true, name: true, provider: true } } } },
      },
    });
    if (!e) throw new NotFoundException('الموظف غير موجود');
    const showSalary = canSeeSalaries(user);
    return {
      ...this.redact(e, user),
      hireDate: dbDateToKey(e.hireDate),
      leftAt: e.leftAt ? dbDateToKey(e.leftAt) : null,
      birthDate: e.birthDate ? dbDateToKey(e.birthDate) : null,
      nationalIdIssuedAt: e.nationalIdIssuedAt ? dbDateToKey(e.nationalIdIssuedAt) : null,
      contracts: e.contracts.map((c) => presentContract(c, showSalary)),
      salaryVisible: showSalary,
    };
  }

  private async nextMatricule(): Promise<string> {
    const count = await this.prisma.hrEmployee.count();
    for (let n = count + 1; n < count + 1000; n++) {
      const m = `EMP-${String(n).padStart(4, '0')}`;
      const taken = await this.prisma.hrEmployee.findUnique({ where: { matricule: m } });
      if (!taken) return m;
    }
    throw new BadRequestException('تعذر توليد رقم تسجيل');
  }

  private validate(dto: Partial<EmployeeInput>) {
    if (dto.photo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dto.photo) || dto.photo.length > MAX_PHOTO_CHARS)) {
      throw new BadRequestException('الصورة غير صالحة أو كبيرة جداً');
    }
    if (dto.paymentMethod && !(EMPLOYEE_PAYMENT_METHODS as readonly string[]).includes(dto.paymentMethod)) {
      throw new BadRequestException('طريقة الدفع غير صالحة');
    }
    if (dto.status === HrEmployeeStatus.LEFT && dto.leftAt === null) {
      throw new BadRequestException('تاريخ المغادرة إلزامي');
    }
  }

  private data(dto: Partial<EmployeeInput>) {
    return {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
      ...(dto.photo !== undefined ? { photo: dto.photo || null } : {}),
      ...(dto.birthDate !== undefined ? { birthDate: optDate(dto.birthDate, 'تاريخ الميلاد') } : {}),
      ...(dto.phone !== undefined ? { phone: opt(dto.phone) } : {}),
      ...(dto.address !== undefined ? { address: opt(dto.address) } : {}),
      ...(dto.nationalIdNumber !== undefined ? { nationalIdNumber: opt(dto.nationalIdNumber) } : {}),
      ...(dto.nationalIdIssuedAt !== undefined ? { nationalIdIssuedAt: optDate(dto.nationalIdIssuedAt, 'تاريخ الإصدار') } : {}),
      ...(dto.nationalIdIssuedBy !== undefined ? { nationalIdIssuedBy: opt(dto.nationalIdIssuedBy) } : {}),
      ...(dto.socialSecurityNumber !== undefined ? { socialSecurityNumber: opt(dto.socialSecurityNumber) } : {}),
      ...(dto.emergencyContactName !== undefined ? { emergencyContactName: opt(dto.emergencyContactName) } : {}),
      ...(dto.emergencyContactPhone !== undefined ? { emergencyContactPhone: opt(dto.emergencyContactPhone) } : {}),
      ...(dto.emergencyContactRelation !== undefined ? { emergencyContactRelation: opt(dto.emergencyContactRelation) } : {}),
      ...(dto.jobTitle !== undefined ? { jobTitle: opt(dto.jobTitle) } : {}),
      ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId || null } : {}),
      ...(dto.workSite !== undefined ? { workSite: opt(dto.workSite) } : {}),
      ...(dto.hireDate !== undefined ? { hireDate: dateKeyToDb(requireDateKey(dto.hireDate, 'تاريخ التوظيف')) } : {}),
      ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod } : {}),
      ...(dto.bankAccount !== undefined ? { bankAccount: opt(dto.bankAccount) } : {}),
      ...(dto.userId !== undefined ? { userId: dto.userId || null } : {}),
      ...(dto.notes !== undefined ? { notes: opt(dto.notes) } : {}),
    };
  }

  async create(dto: EmployeeInput, user: JwtPayload, actor: Actor) {
    this.validate(dto);
    if (dto.bankAccount && !can(user, 'HR_SALARIES_EDIT')) {
      throw new ForbiddenException('ليس لديك صلاحية تعديل البيانات البنكية');
    }
    const matricule = dto.matricule?.trim().toUpperCase() || (await this.nextMatricule());
    try {
      const row = await this.prisma.hrEmployee.create({
        data: {
          ...this.data(dto),
          matricule,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          hireDate: dateKeyToDb(requireDateKey(dto.hireDate, 'تاريخ التوظيف')),
          status: HrEmployeeStatus.ACTIVE,
          createdById: actor.id,
        },
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.CREATE,
        module: AUDIT_MODULES.HR,
        description: `إضافة موظف ${fullName(row)} (${row.matricule})`,
        entity: 'HrEmployee',
        entityId: row.id,
      });
      return this.get(row.id, user);
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('رقم التسجيل أو حساب المستخدم مستعمل مسبقاً');
      throw e;
    }
  }

  async update(id: string, dto: Partial<EmployeeInput>, user: JwtPayload, actor: Actor) {
    const old = await this.prisma.hrEmployee.findUnique({ where: { id } });
    if (!old) throw new NotFoundException('الموظف غير موجود');
    this.validate(dto);
    if (dto.bankAccount !== undefined && !can(user, 'HR_SALARIES_EDIT')) {
      throw new ForbiddenException('ليس لديك صلاحية تعديل البيانات البنكية');
    }
    const statusData: Prisma.HrEmployeeUncheckedUpdateInput = {};
    if (dto.status !== undefined && dto.status !== old.status) {
      statusData.status = dto.status;
      if (dto.status === HrEmployeeStatus.LEFT) {
        const leftAt = requireDateKey(dto.leftAt, 'تاريخ المغادرة');
        if (leftAt < dbDateToKey(old.hireDate)) throw new BadRequestException('تاريخ المغادرة قبل تاريخ التوظيف');
        statusData.leftAt = dateKeyToDb(leftAt);
        statusData.leftReason = dto.leftReason?.trim() || null;
      } else {
        statusData.leftAt = null;
        statusData.leftReason = null;
      }
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.hrEmployee.update({ where: { id }, data: { ...this.data(dto), ...statusData } });
        if (statusData.status === HrEmployeeStatus.LEFT && updated.leftAt) {
          await tx.hrContract.updateMany({
            where: { employeeId: id, status: 'ACTIVE', OR: [{ endDate: null }, { endDate: { gt: updated.leftAt } }] },
            data: { endDate: updated.leftAt, status: 'ENDED' },
          });
        }
        return updated;
      });
      const changed = Object.keys(dto).filter((k) => k !== 'photo');
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.UPDATE,
        module: AUDIT_MODULES.HR,
        description: `تعديل ملف الموظف ${fullName(row)}${dto.status && dto.status !== old.status ? ` (الحالة: ${old.status} ← ${dto.status})` : ''}`,
        entity: 'HrEmployee',
        entityId: id,
        oldData: Object.fromEntries(changed.map((k) => [k, (old as Record<string, unknown>)[k] as Prisma.InputJsonValue])),
        newData: Object.fromEntries(changed.map((k) => [k, (row as Record<string, unknown>)[k] as Prisma.InputJsonValue])),
      });
      return this.get(id, user);
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('حساب المستخدم مربوط بموظف آخر');
      throw e;
    }
  }

  async archive(id: string, archived: boolean, actor: Actor) {
    const e = await this.prisma.hrEmployee.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('الموظف غير موجود');
    if (archived && e.status !== HrEmployeeStatus.LEFT) {
      throw new BadRequestException('يجب تسجيل مغادرة الموظف قبل أرشفته');
    }
    const row = await this.prisma.hrEmployee.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.ARCHIVE,
      module: AUDIT_MODULES.HR,
      description: `${archived ? 'أرشفة' : 'استرجاع'} الموظف ${fullName(row)}`,
      entity: 'HrEmployee',
      entityId: id,
    });
    return row;
  }

  linkableUsers() {
    return this.prisma.user.findMany({
      where: { deletedAt: null, hrEmployee: null },
      select: { id: true, username: true, firstName: true, lastName: true },
      orderBy: { username: 'asc' },
    });
  }

  // ── Contracts ────────────────────────────────────────────────────────────

  async listContracts(employeeId: string, user: JwtPayload) {
    const rows = await this.prisma.hrContract.findMany({
      where: { employeeId },
      include: { department: { select: { id: true, name: true } } },
      orderBy: { startDate: 'desc' },
    });
    return rows.map((c) => presentContract(c, canSeeSalaries(user)));
  }

  /** All contracts; `endingWithinDays` keeps active fixed-term contracts or trials ending soon. */
  async listAllContracts(q: { status?: string; endingWithinDays?: number; today: string }, user: JwtPayload) {
    const horizon = q.endingWithinDays !== undefined ? dateKeyToDb(addDays(q.today, q.endingWithinDays)) : null;
    const todayDb = dateKeyToDb(q.today);
    const rows = await this.prisma.hrContract.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(horizon
          ? {
              status: 'ACTIVE',
              OR: [
                { endDate: { gte: todayDb, lte: horizon } },
                { trialEndDate: { gte: todayDb, lte: horizon } },
              ],
            }
          : {}),
      },
      include: {
        department: { select: { id: true, name: true } },
        employee: { select: { id: true, matricule: true, firstName: true, lastName: true, status: true } },
      },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      take: 1000,
    });
    return rows.map((c) => presentContract(c, canSeeSalaries(user)));
  }

  private async lockedByPayslip(contractId: string) {
    return this.prisma.hrPayslip.count({ where: { contractId, status: 'VALIDATED' } });
  }

  async createContract(dto: ContractInput, user: JwtPayload, actor: Actor) {
    if (!can(user, 'HR_SALARIES_EDIT')) throw new ForbiddenException('ليس لديك صلاحية تحديد الأجور');
    if (!(CONTRACT_TYPES as readonly string[]).includes(dto.contractType)) throw new BadRequestException('نوع العقد غير صالح');
    const start = requireDateKey(dto.startDate, 'تاريخ بداية العقد');
    const end = dto.endDate ? requireDateKey(dto.endDate, 'تاريخ نهاية العقد') : null;
    if (end && end < start) throw new BadRequestException('نهاية العقد قبل بدايته');
    if (!(dto.baseSalary > 0)) throw new BadRequestException('الأجر يجب أن يكون أكبر من صفر');
    const employee = await this.prisma.hrEmployee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) throw new NotFoundException('الموظف غير موجود');

    const row = await this.prisma.$transaction(async (tx) => {
      const overlapping = await tx.hrContract.findMany({
        where: {
          employeeId: dto.employeeId,
          status: 'ACTIVE',
          OR: [{ endDate: null }, { endDate: { gte: dateKeyToDb(start) } }],
          ...(end ? { startDate: { lte: dateKeyToDb(end) } } : {}),
        },
      });
      for (const c of overlapping) {
        if (dbDateToKey(c.startDate) >= start) {
          throw new BadRequestException(`يوجد عقد آخر يبدأ في ${dbDateToKey(c.startDate)} — عدّله أو أنهِه أولاً`);
        }
        await tx.hrContract.update({
          where: { id: c.id },
          data: { endDate: dateKeyToDb(addDays(start, -1)), status: 'ENDED' },
        });
      }
      return tx.hrContract.create({
        data: {
          employeeId: dto.employeeId,
          contractType: dto.contractType,
          startDate: dateKeyToDb(start),
          endDate: end ? dateKeyToDb(end) : null,
          trialEndDate: dto.trialEndDate ? dateKeyToDb(requireDateKey(dto.trialEndDate, 'نهاية فترة التجربة')) : null,
          salaryMode: dto.salaryMode ?? HrSalaryMode.MONTHLY,
          baseSalary: dto.baseSalary,
          weeklyHours: dto.weeklyHours ?? 40,
          jobTitle: dto.jobTitle?.trim() || employee.jobTitle,
          departmentId: dto.departmentId ?? employee.departmentId,
          documentRef: dto.documentRef?.trim() || null,
          notes: dto.notes?.trim() || null,
          createdById: actor.id,
          createdByName: actor.name,
        },
      });
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.HR,
      description: `عقد ${row.contractType} جديد لـ ${fullName(employee)} من ${start} (${row.salaryMode} ${num(row.baseSalary)} د.ج)`,
      entity: 'HrContract',
      entityId: row.id,
      newData: presentContract(row, true) as unknown as Prisma.InputJsonValue,
    });
    return presentContract(row, true);
  }

  async updateContract(id: string, dto: Partial<Omit<ContractInput, 'employeeId'>>, user: JwtPayload, actor: Actor) {
    const old = await this.prisma.hrContract.findUnique({ where: { id }, include: { employee: true } });
    if (!old) throw new NotFoundException('العقد غير موجود');
    const touchesPay =
      dto.baseSalary !== undefined || dto.salaryMode !== undefined || dto.weeklyHours !== undefined || dto.startDate !== undefined;
    if (touchesPay && !can(user, 'HR_SALARIES_EDIT')) throw new ForbiddenException('ليس لديك صلاحية تعديل الأجور');
    if (touchesPay && (await this.lockedByPayslip(id)) > 0) {
      throw new BadRequestException('هذا العقد مستعمل في أجور مصادق عليها — أنشئ عقداً جديداً (ملحق) بدلاً من تعديله');
    }
    if (dto.contractType && !(CONTRACT_TYPES as readonly string[]).includes(dto.contractType)) {
      throw new BadRequestException('نوع العقد غير صالح');
    }
    const start = dto.startDate ? requireDateKey(dto.startDate) : dbDateToKey(old.startDate);
    const end = dto.endDate !== undefined ? (dto.endDate ? requireDateKey(dto.endDate) : null) : old.endDate ? dbDateToKey(old.endDate) : null;
    if (end && end < start) throw new BadRequestException('نهاية العقد قبل بدايته');
    const row = await this.prisma.hrContract.update({
      where: { id },
      data: {
        ...(dto.contractType !== undefined ? { contractType: dto.contractType } : {}),
        ...(dto.startDate !== undefined ? { startDate: dateKeyToDb(start) } : {}),
        ...(dto.endDate !== undefined ? { endDate: end ? dateKeyToDb(end) : null } : {}),
        ...(dto.trialEndDate !== undefined ? { trialEndDate: dto.trialEndDate ? dateKeyToDb(requireDateKey(dto.trialEndDate)) : null } : {}),
        ...(dto.salaryMode !== undefined ? { salaryMode: dto.salaryMode } : {}),
        ...(dto.baseSalary !== undefined ? { baseSalary: dto.baseSalary } : {}),
        ...(dto.weeklyHours !== undefined ? { weeklyHours: dto.weeklyHours } : {}),
        ...(dto.jobTitle !== undefined ? { jobTitle: dto.jobTitle?.trim() || null } : {}),
        ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId || null } : {}),
        ...(dto.documentRef !== undefined ? { documentRef: dto.documentRef?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.HR,
      description: `تعديل عقد ${fullName(old.employee)} (${old.contractType})`,
      entity: 'HrContract',
      entityId: id,
      oldData: presentContract(old, true) as unknown as Prisma.InputJsonValue,
      newData: presentContract(row, true) as unknown as Prisma.InputJsonValue,
    });
    return presentContract(row, canSeeSalaries(user));
  }

  async terminateContract(id: string, dto: { endDate: string; reason: string }, user: JwtPayload, actor: Actor) {
    const old = await this.prisma.hrContract.findUnique({ where: { id }, include: { employee: true } });
    if (!old) throw new NotFoundException('العقد غير موجود');
    if (old.status !== 'ACTIVE') throw new BadRequestException('العقد غير ساري');
    const end = requireDateKey(dto.endDate, 'تاريخ الإنهاء');
    if (end < dbDateToKey(old.startDate)) throw new BadRequestException('تاريخ الإنهاء قبل بداية العقد');
    if (!dto.reason?.trim()) throw new BadRequestException('سبب الإنهاء إلزامي');
    const row = await this.prisma.hrContract.update({
      where: { id },
      data: {
        endDate: dateKeyToDb(end),
        status: 'TERMINATED',
        terminatedAt: dateKeyToDb(end),
        terminationReason: dto.reason.trim(),
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.CANCEL,
      module: AUDIT_MODULES.HR,
      description: `إنهاء عقد ${fullName(old.employee)} بتاريخ ${end} — ${dto.reason.trim()}`,
      entity: 'HrContract',
      entityId: id,
    });
    return presentContract(row, canSeeSalaries(user));
  }
}
