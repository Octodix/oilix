import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import { DEFAULT_ATTENDANCE_POLICY, type AttendancePolicy } from './engine/attendance-engine';
import { DEFAULT_PAYROLL_POLICY, type PayrollPolicy } from './engine/payroll-engine';

export const HR_SETTINGS_KEY = 'hr_settings';

export type HrSettings = {
  /** Device/local clock offset from UTC — Algeria +60, no DST */
  timezoneOffsetMinutes: number;
  defaultScheduleId: string | null;
  workSites: string[];
  attendance: AttendancePolicy;
  payroll: PayrollPolicy & {
    overtimeMultipliers: { WORKDAY: number; REST_DAY: number; HOLIDAY: number };
    allowPartialPayments: boolean;
    /** Validation refuses periods with unresolved missing punches unless forced with a reason */
    blockValidationOnMissingPunch: boolean;
  };
  sickLeave: { defaultTreatment: 'UNPAID' | 'PAID' | 'PARTIAL'; defaultPaidPercent: number };
  devices: {
    admsDelaySeconds: number;
    admsTransIntervalMinutes: number;
    offlineAfterMinutes: number;
  };
};

export const DEFAULT_HR_SETTINGS: HrSettings = {
  timezoneOffsetMinutes: 60,
  defaultScheduleId: null,
  workSites: [],
  attendance: { ...DEFAULT_ATTENDANCE_POLICY },
  payroll: {
    ...DEFAULT_PAYROLL_POLICY,
    overtimeMultipliers: { WORKDAY: 1.5, REST_DAY: 1.75, HOLIDAY: 2 },
    allowPartialPayments: true,
    blockValidationOnMissingPunch: true,
  },
  sickLeave: { defaultTreatment: 'UNPAID', defaultPaidPercent: 0 },
  devices: { admsDelaySeconds: 30, admsTransIntervalMinutes: 1, offlineAfterMinutes: 5 },
};

const DEFAULT_LEAVE_TYPES = [
  { code: 'ANNUAL', name: 'عطلة سنوية', nameFr: 'Congé annuel', isPaid: true, deductsFromBalance: true, defaultDaysPerYear: 30, sortOrder: 1 },
  { code: 'UNPAID', name: 'عطلة بدون أجر', nameFr: 'Congé sans solde', isPaid: false, deductsFromBalance: false, sortOrder: 2 },
  { code: 'EXCEPTIONAL', name: 'عطلة استثنائية', nameFr: 'Congé exceptionnel', isPaid: true, deductsFromBalance: false, sortOrder: 3 },
  { code: 'RECOVERY', name: 'يوم تعويضي', nameFr: 'Récupération', isPaid: true, deductsFromBalance: false, sortOrder: 4 },
];

const DEFAULT_ABSENCE_TYPES = [
  { code: 'AUTHORIZED', name: 'غياب مرخص', nameFr: 'Absence autorisée', isPaid: false, isJustified: true, sortOrder: 1 },
  { code: 'JUSTIFIED_PAID', name: 'غياب مبرر مدفوع', nameFr: 'Absence justifiée payée', isPaid: true, isJustified: true, sortOrder: 2 },
  { code: 'FAMILY_EVENT', name: 'مناسبة عائلية', nameFr: 'Événement familial', isPaid: true, isJustified: true, sortOrder: 3 },
  { code: 'UNJUSTIFIED', name: 'غياب غير مبرر', nameFr: 'Absence injustifiée', isPaid: false, isJustified: false, sortOrder: 4 },
];

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function pick<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

/** Merges a stored/partial value over the defaults, dropping anything out of range. */
export function normaliseHrSettings(raw: unknown): HrSettings {
  const d = DEFAULT_HR_SETTINGS;
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const a = (s.attendance ?? {}) as Record<string, unknown>;
  const p = (s.payroll ?? {}) as Record<string, any>;
  const m = (p.overtimeMultipliers ?? {}) as Record<string, unknown>;
  const sick = (s.sickLeave ?? {}) as Record<string, unknown>;
  const dev = (s.devices ?? {}) as Record<string, unknown>;
  const divisor = (v: unknown, keyword: string): string | number => {
    if (v === keyword) return keyword;
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 400 ? n : keyword;
  };
  return {
    timezoneOffsetMinutes: clampInt(s.timezoneOffsetMinutes, -720, 840, d.timezoneOffsetMinutes),
    defaultScheduleId: typeof s.defaultScheduleId === 'string' && s.defaultScheduleId ? s.defaultScheduleId : null,
    workSites: Array.isArray(s.workSites)
      ? [...new Set(s.workSites.map((w: unknown) => String(w).trim()).filter(Boolean))].slice(0, 50)
      : [],
    attendance: {
      lateGraceMinutes: clampInt(a.lateGraceMinutes, 0, 240, d.attendance.lateGraceMinutes),
      lateChargeMode: pick(a.lateChargeMode, ['FULL', 'AFTER_GRACE'] as const, d.attendance.lateChargeMode),
      earlyLeaveGraceMinutes: clampInt(a.earlyLeaveGraceMinutes, 0, 240, d.attendance.earlyLeaveGraceMinutes),
      overtimeThresholdMinutes: clampInt(a.overtimeThresholdMinutes, 0, 600, d.attendance.overtimeThresholdMinutes),
      countEarlyArrivalOvertime: typeof a.countEarlyArrivalOvertime === 'boolean' ? a.countEarlyArrivalOvertime : d.attendance.countEarlyArrivalOvertime,
      minPunchGapMinutes: clampInt(a.minPunchGapMinutes, 0, 60, d.attendance.minPunchGapMinutes),
    },
    payroll: {
      dailyRateDivisor: divisor(p.dailyRateDivisor, 'SCHEDULED') as PayrollPolicy['dailyRateDivisor'],
      hourlyRateDivisor: divisor(p.hourlyRateDivisor, 'CONTRACT') as PayrollPolicy['hourlyRateDivisor'],
      deductUnjustifiedAbsences: typeof p.deductUnjustifiedAbsences === 'boolean' ? p.deductUnjustifiedAbsences : d.payroll.deductUnjustifiedAbsences,
      lateDeductionMode: pick(p.lateDeductionMode, ['NONE', 'PER_MINUTE', 'FIXED_PER_OCCURRENCE'] as const, d.payroll.lateDeductionMode),
      lateFixedAmount: clampNum(p.lateFixedAmount, 0, 1_000_000, d.payroll.lateFixedAmount),
      lateToleratedOccurrences: clampInt(p.lateToleratedOccurrences, 0, 31, d.payroll.lateToleratedOccurrences),
      overtimeRequiresApproval: typeof p.overtimeRequiresApproval === 'boolean' ? p.overtimeRequiresApproval : d.payroll.overtimeRequiresApproval,
      missingPunchTreatment: pick(p.missingPunchTreatment, ['PAY', 'UNPAID'] as const, d.payroll.missingPunchTreatment),
      overtimeMultipliers: {
        WORKDAY: clampNum(m.WORKDAY, 1, 5, d.payroll.overtimeMultipliers.WORKDAY),
        REST_DAY: clampNum(m.REST_DAY, 1, 5, d.payroll.overtimeMultipliers.REST_DAY),
        HOLIDAY: clampNum(m.HOLIDAY, 1, 5, d.payroll.overtimeMultipliers.HOLIDAY),
      },
      allowPartialPayments: typeof p.allowPartialPayments === 'boolean' ? p.allowPartialPayments : d.payroll.allowPartialPayments,
      blockValidationOnMissingPunch:
        typeof p.blockValidationOnMissingPunch === 'boolean' ? p.blockValidationOnMissingPunch : d.payroll.blockValidationOnMissingPunch,
    },
    sickLeave: {
      defaultTreatment: pick(sick.defaultTreatment, ['UNPAID', 'PAID', 'PARTIAL'] as const, d.sickLeave.defaultTreatment),
      defaultPaidPercent: clampNum(sick.defaultPaidPercent, 0, 100, d.sickLeave.defaultPaidPercent),
    },
    devices: {
      admsDelaySeconds: clampInt(dev.admsDelaySeconds, 10, 600, d.devices.admsDelaySeconds),
      admsTransIntervalMinutes: clampInt(dev.admsTransIntervalMinutes, 1, 60, d.devices.admsTransIntervalMinutes),
      offlineAfterMinutes: clampInt(dev.offlineAfterMinutes, 2, 1440, d.devices.offlineAfterMinutes),
    },
  };
}

/**
 * Paths of a partial update that normalisation would have dropped or replaced (out of range,
 * wrong type, unknown key). The caller rejects the whole update instead of silently saving defaults.
 */
export function rejectedSettingPaths(patch: Record<string, unknown>, next: HrSettings): string[] {
  const bad: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const walk = (given: unknown, saved: unknown, path: string) => {
    if (given && typeof given === 'object' && !Array.isArray(given)) {
      if (!saved || typeof saved !== 'object') return bad.push(path);
      for (const [k, v] of Object.entries(given)) {
        if (v === undefined) continue;
        if (!(k in saved)) bad.push(`${path}.${k}`);
        else walk(v, (saved as Record<string, unknown>)[k], `${path}.${k}`);
      }
      return;
    }
    if (!same(given, saved)) bad.push(path);
  };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || k === 'workSites') continue;
    if (!(k in next)) bad.push(k);
    else walk(v, next[k as keyof HrSettings], k);
  }
  return bad;
}

@Injectable()
export class HrSettingsService implements OnModuleInit {
  private readonly logger = new Logger(HrSettingsService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.ensureDefaults();
    } catch (e) {
      this.logger.warn(`HR defaults not seeded: ${(e as Error).message}`);
    }
  }

  /** Idempotent: only inserts reference rows that do not exist yet. */
  async ensureDefaults() {
    await this.prisma.hrLeaveType.createMany({ data: DEFAULT_LEAVE_TYPES, skipDuplicates: true });
    await this.prisma.hrAbsenceType.createMany({ data: DEFAULT_ABSENCE_TYPES, skipDuplicates: true });
    const schedules = await this.prisma.hrWorkSchedule.count();
    if (schedules === 0) {
      const workdays = [0, 1, 2, 3, 4];
      const schedule = await this.prisma.hrWorkSchedule.create({
        data: {
          code: 'STANDARD',
          name: 'التوقيت العادي 08:00–12:00 / 13:00–17:00',
          description: 'من الأحد إلى الخميس — قابل للتعديل',
          segments: {
            create: workdays.flatMap((weekday) => [
              { weekday, startMinute: 480, endMinute: 720, sortOrder: 0 },
              { weekday, startMinute: 780, endMinute: 1020, sortOrder: 1 },
            ]),
          },
        },
      });
      const current = await this.get();
      if (!current.defaultScheduleId) {
        const value = { ...current, defaultScheduleId: schedule.id } as unknown as Prisma.InputJsonValue;
        await this.prisma.setting.upsert({
          where: { key: HR_SETTINGS_KEY },
          create: { key: HR_SETTINGS_KEY, value },
          update: { value },
        });
      }
    }
  }

  async get(): Promise<HrSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: HR_SETTINGS_KEY } });
    return normaliseHrSettings(row?.value);
  }

  async update(rawPatch: Record<string, unknown>, userId: string): Promise<HrSettings> {
    // DTO instances carry every declared field (undefined when not sent) — an undefined must never erase a stored value.
    const patch = Object.fromEntries(Object.entries(rawPatch).filter(([, v]) => v !== undefined));
    const current = await this.get();
    const merged = {
      ...current,
      ...patch,
      attendance: { ...current.attendance, ...((patch.attendance as object) ?? {}) },
      payroll: {
        ...current.payroll,
        ...((patch.payroll as object) ?? {}),
        overtimeMultipliers: {
          ...current.payroll.overtimeMultipliers,
          ...(((patch.payroll as Record<string, unknown>)?.overtimeMultipliers as object) ?? {}),
        },
      },
      sickLeave: { ...current.sickLeave, ...((patch.sickLeave as object) ?? {}) },
      devices: { ...current.devices, ...((patch.devices as object) ?? {}) },
    };
    const next = normaliseHrSettings(merged);
    const rejected = rejectedSettingPaths(patch, next);
    if (rejected.length) throw new BadRequestException(`قيم غير صالحة في الإعدادات: ${rejected.join(', ')}`);
    if (next.defaultScheduleId) {
      const exists = await this.prisma.hrWorkSchedule.findUnique({ where: { id: next.defaultScheduleId } });
      if (!exists) throw new BadRequestException('التوقيت الافتراضي غير موجود');
    }
    await this.prisma.setting.upsert({
      where: { key: HR_SETTINGS_KEY },
      create: { key: HR_SETTINGS_KEY, value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    await this.audit.log({
      userId,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.HR,
      description: 'تعديل إعدادات الموارد البشرية',
      entity: 'HrSettings',
      entityId: HR_SETTINGS_KEY,
      oldData: current as unknown as Prisma.InputJsonValue,
      newData: next as unknown as Prisma.InputJsonValue,
    });
    return next;
  }

  async companyInfo() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: ['company_name', 'company_phone', 'company_address'] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      name: (map.company_name as string) ?? 'Oilix',
      phone: (map.company_phone as string) ?? null,
      address: (map.company_address as string) ?? null,
    };
  }
}
