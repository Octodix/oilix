import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import { addDays, localDateKey } from './engine/hr-time';
import { HrAttendanceService } from './hr-attendance.service';
import { HrIngestService } from './hr-ingest.service';
import { HrSettingsService } from './hr-settings.service';
import { fullName, isUniqueViolation, type Actor } from './hr-common';
import { normaliseSerial } from './zkteco/adms-protocol';
import {
  coerceColumnMap,
  fileHash,
  MAX_IMPORT_BYTES,
  parseAttendanceText,
  ZK_ATTLOG_COLUMNS,
  type FileColumnMap,
} from './zkteco/attlog-parser';
import {
  isProviderKind,
  providerCatalog,
  providerFor,
  ProviderNotSupportedError,
  type ConnectionTest,
} from './zkteco/attendance-provider';
import { probeZkSdk } from './zkteco/zk-sdk-probe';

export type DeviceInput = {
  name: string;
  model?: string | null;
  serialNumber?: string | null;
  ipAddress?: string | null;
  port?: number | null;
  provider: string;
  commKey?: string | null;
  location?: string | null;
  isEnabled?: boolean;
  timezoneOffsetMinutes?: number;
  fileColumnMap?: Record<string, unknown> | null;
  syncIntervalMinutes?: number;
  notes?: string | null;
};

/** Diagnostics may only reach the local network — never arbitrary internet hosts. */
export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((x) => x > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function statusFromTest(t: ConnectionTest): string | null {
  switch (t.status) {
    case 'ONLINE':
      return 'ONLINE';
    case 'OFFLINE':
      return 'OFFLINE';
    case 'AUTH_REQUIRED':
    case 'ERROR':
      return 'ERROR';
    case 'WAITING_FOR_DEVICE':
      return 'UNKNOWN';
    default:
      return null;
  }
}

const REJECT_LOG_INTERVAL_MS = 10 * 60_000;

@Injectable()
export class HrDevicesService {
  private rejectedLoggedAt = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private ingest: HrIngestService,
    private hrSettings: HrSettingsService,
    private attendance: HrAttendanceService,
  ) {}

  providers() {
    return providerCatalog();
  }

  async list() {
    const devices = await this.prisma.hrAttendanceDevice.findMany({
      orderBy: [{ isEnabled: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { events: true, userMappings: true } } },
    });
    const unmapped = await this.prisma.hrAttendanceEvent.groupBy({
      by: ['deviceId', 'deviceUserId'],
      where: { employeeId: null },
    });
    const unmappedCount = new Map<string, number>();
    for (const u of unmapped) if (u.deviceId) unmappedCount.set(u.deviceId, (unmappedCount.get(u.deviceId) ?? 0) + 1);
    return devices.map((d) => ({
      ...this.present(d),
      eventCount: d._count.events,
      mappedUsers: d._count.userMappings,
      unmappedUsers: unmappedCount.get(d.id) ?? 0,
    }));
  }

  private present<T extends { commKey: string | null; provider: string }>(d: T) {
    const provider = isProviderKind(d.provider) ? providerFor(d.provider) : null;
    return {
      ...d,
      commKey: d.commKey ? '••••' : null,
      hasCommKey: !!d.commKey,
      providerLabel: provider?.label ?? d.provider,
      capabilities: provider?.capabilities ?? null,
    };
  }

  async get(id: string) {
    const d = await this.prisma.hrAttendanceDevice.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('جهاز البصمة غير موجود');
    return d;
  }

  async getPresented(id: string) {
    return this.present(await this.get(id));
  }

  private validate(dto: Partial<DeviceInput>) {
    if (dto.provider !== undefined && !isProviderKind(dto.provider)) {
      throw new BadRequestException('طريقة الاتصال غير معروفة');
    }
    if (dto.ipAddress && !/^(\d{1,3}\.){3}\d{1,3}$/.test(dto.ipAddress.trim())) {
      throw new BadRequestException('عنوان IP غير صالح');
    }
    if (dto.port !== undefined && dto.port !== null && (dto.port < 1 || dto.port > 65535)) {
      throw new BadRequestException('المنفذ غير صالح');
    }
    if (dto.commKey && !/^\d{1,9}$/.test(dto.commKey)) {
      throw new BadRequestException('مفتاح الاتصال يجب أن يكون رقمياً');
    }
    if (dto.serialNumber && !normaliseSerial(dto.serialNumber)) {
      throw new BadRequestException('الرقم التسلسلي غير صالح');
    }
  }

  private data(dto: Partial<DeviceInput>) {
    return {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.model !== undefined ? { model: dto.model?.trim() || null } : {}),
      ...(dto.serialNumber !== undefined ? { serialNumber: dto.serialNumber ? normaliseSerial(dto.serialNumber) : null } : {}),
      ...(dto.ipAddress !== undefined ? { ipAddress: dto.ipAddress?.trim() || null } : {}),
      ...(dto.port !== undefined ? { port: dto.port ?? null } : {}),
      ...(dto.provider !== undefined ? { provider: dto.provider } : {}),
      ...(dto.commKey !== undefined ? { commKey: dto.commKey || null } : {}),
      ...(dto.location !== undefined ? { location: dto.location?.trim() || null } : {}),
      ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
      ...(dto.timezoneOffsetMinutes !== undefined ? { timezoneOffsetMinutes: dto.timezoneOffsetMinutes } : {}),
      ...(dto.fileColumnMap !== undefined
        ? { fileColumnMap: dto.fileColumnMap ? (coerceColumnMap(dto.fileColumnMap) as Prisma.InputJsonValue) : Prisma.JsonNull }
        : {}),
      ...(dto.syncIntervalMinutes !== undefined ? { syncIntervalMinutes: dto.syncIntervalMinutes } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
    };
  }

  async create(dto: DeviceInput, actor: Actor) {
    this.validate(dto);
    if (dto.provider === 'ZKTECO_ADMS' && !dto.serialNumber) {
      throw new BadRequestException('الرقم التسلسلي إلزامي في وضع ADMS (يُعرَّف به الجهاز)');
    }
    try {
      const row = await this.prisma.hrAttendanceDevice.create({
        data: { ...this.data(dto), name: dto.name.trim(), provider: dto.provider, status: 'UNKNOWN' },
      });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.CREATE,
        module: AUDIT_MODULES.HR,
        description: `إضافة جهاز بصمة «${row.name}» (${row.provider}${row.serialNumber ? ` / SN ${row.serialNumber}` : ''})`,
        entity: 'HrAttendanceDevice',
        entityId: row.id,
      });
      return this.present(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('الرقم التسلسلي مسجل لجهاز آخر');
      throw e;
    }
  }

  async update(id: string, dto: Partial<DeviceInput>, actor: Actor) {
    const old = await this.get(id);
    this.validate(dto);
    const provider = dto.provider ?? old.provider;
    const serial = dto.serialNumber !== undefined ? dto.serialNumber : old.serialNumber;
    if (provider === 'ZKTECO_ADMS' && !serial) throw new BadRequestException('الرقم التسلسلي إلزامي في وضع ADMS');
    try {
      const row = await this.prisma.hrAttendanceDevice.update({ where: { id }, data: this.data(dto) });
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.UPDATE,
        module: AUDIT_MODULES.HR,
        description: `تعديل جهاز البصمة «${row.name}»`,
        entity: 'HrAttendanceDevice',
        entityId: id,
        oldData: { ...old, commKey: old.commKey ? '••••' : null } as unknown as Prisma.InputJsonValue,
        newData: { ...row, commKey: row.commKey ? '••••' : null } as unknown as Prisma.InputJsonValue,
      });
      return this.present(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('الرقم التسلسلي مسجل لجهاز آخر');
      throw e;
    }
  }

  async remove(id: string, actor: Actor) {
    const d = await this.get(id);
    const events = await this.prisma.hrAttendanceEvent.count({ where: { deviceId: id } });
    if (events > 0) {
      throw new BadRequestException(`لا يمكن حذف جهاز يحتوي على ${events} تسجيل — قم بتعطيله بدلاً من ذلك`);
    }
    await this.prisma.hrAttendanceDevice.delete({ where: { id } });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.DELETE,
      module: AUDIT_MODULES.HR,
      description: `حذف جهاز البصمة «${d.name}»`,
      entity: 'HrAttendanceDevice',
      entityId: id,
    });
    return { ok: true };
  }

  async testConnection(id: string, actor: Actor) {
    const device = await this.get(id);
    const provider = providerFor(device.provider);
    const result = await provider.testConnection(device);
    const status = statusFromTest(result);
    const serialMismatch =
      !!result.deviceInfo?.serialNumber &&
      !!device.serialNumber &&
      normaliseSerial(result.deviceInfo.serialNumber) !== device.serialNumber;
    const now = new Date();
    await this.prisma.hrAttendanceDevice.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(result.diagnostic
          ? { lastDiagnostic: result.diagnostic as unknown as Prisma.InputJsonValue, lastDiagnosticAt: now }
          : {}),
        ...(result.deviceInfo && Object.keys(result.deviceInfo).length
          ? {
              deviceInfo: {
                ...((device.deviceInfo as object) ?? {}),
                ...result.deviceInfo,
                confirmedAt: now.toISOString(),
              } as Prisma.InputJsonValue,
            }
          : {}),
        ...(device.provider === 'ZKTECO_TCP' && result.ok ? { lastConnectionAt: now } : {}),
        ...(result.ok ? {} : { lastError: result.message }),
      },
    });
    await this.prisma.hrAttendanceSyncLog.create({
      data: {
        deviceId: id,
        provider: device.provider,
        trigger: 'DIAGNOSTIC',
        status: result.ok ? 'SUCCESS' : 'FAILED',
        finishedAt: now,
        errorMessage: result.ok ? null : result.message,
        details: { ...result, serialMismatch } as unknown as Prisma.InputJsonValue,
        userId: actor.id,
        userName: actor.name,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.READ,
      module: AUDIT_MODULES.HR,
      description: `اختبار اتصال جهاز البصمة «${device.name}»: ${result.status}`,
      entity: 'HrAttendanceDevice',
      entityId: id,
    });
    return {
      ...result,
      serialMismatch,
      warning: serialMismatch
        ? `الرقم التسلسلي المقروء (${result.deviceInfo?.serialNumber}) يختلف عن المسجل (${device.serialNumber})`
        : null,
    };
  }

  async diagnose(dto: { host: string; port?: number; commKey?: string | null }, actor: Actor) {
    const host = dto.host?.trim() ?? '';
    if (!isPrivateIPv4(host)) {
      throw new BadRequestException('التشخيص مسموح فقط لعناوين الشبكة المحلية (192.168.x.x / 10.x.x.x / 172.16-31.x.x)');
    }
    const port = dto.port ?? 4370;
    if (port < 1 || port > 65535) throw new BadRequestException('المنفذ غير صالح');
    const result = await probeZkSdk({ host, port, commKey: dto.commKey ? Number(dto.commKey) || 0 : 0 });
    await this.prisma.hrAttendanceSyncLog.create({
      data: {
        provider: 'ZKTECO_TCP',
        trigger: 'DIAGNOSTIC',
        status: result.conclusion === 'SDK_CONNECTED' ? 'SUCCESS' : 'FAILED',
        finishedAt: new Date(),
        details: result as unknown as Prisma.InputJsonValue,
        userId: actor.id,
        userName: actor.name,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.READ,
      module: AUDIT_MODULES.HR,
      description: `تشخيص شبكة جهاز بصمة ${host}:${port} — ${result.conclusion}`,
      entity: 'HrAttendanceDevice',
    });
    return result;
  }

  async syncNow(id: string, actor: Actor) {
    const device = await this.get(id);
    if (!device.isEnabled) throw new BadRequestException('الجهاز معطل');
    const provider = providerFor(device.provider);
    if (provider.capabilities.pullLogs) {
      const punches = await provider.getAttendanceLogs(device, device.lastSuccessfulSyncAt);
      const r = await this.ingest.ingest(device, punches, {
        source: 'TCP_PULL',
        trigger: 'MANUAL',
        userId: actor.id,
        userName: actor.name,
      });
      return { ok: true, mode: 'PULL', message: `تم جلب ${r.fetched} تسجيل (${r.inserted} جديد)`, result: r };
    }

    if (device.provider === 'ZKTECO_ADMS') {
      const settings = await this.hrSettings.get();
      const today = localDateKey(new Date(), settings.timezoneOffsetMinutes);
      const r = await this.attendance.process({ from: addDays(today, -7), to: today });
      const test = await provider.testConnection(device);
      return {
        ok: test.ok,
        mode: 'PUSH',
        message:
          (test.ok
            ? 'الجهاز يرسل التسجيلات تلقائياً (ADMS). '
            : 'لم يتصل الجهاز مؤخراً — التسجيلات ستصل عند عودة الاتصال (يحتفظ بها الجهاز في ذاكرته). ') +
          `تمت إعادة معالجة آخر 7 أيام (${r.changed} يوم تغيّر).`,
        lastConnectionAt: device.lastConnectionAt,
        lastEventAt: device.lastEventAt,
        connection: test,
      };
    }
    try {
      await provider.getAttendanceLogs(device, null);
    } catch (e) {
      if (e instanceof ProviderNotSupportedError) {
        return { ok: false, mode: device.provider === 'ZKTECO_FILE' ? 'FILE' : 'UNSUPPORTED', message: e.message };
      }
      throw e;
    }
    return { ok: false, mode: 'UNSUPPORTED', message: 'غير مدعوم' };
  }

  async importFile(
    id: string,
    dto: { content: string; fileName?: string | null; columnMap?: Record<string, unknown> | null; dryRun?: boolean; saveColumnMap?: boolean },
    actor: Actor,
  ) {
    const device = await this.get(id);
    const content = String(dto.content ?? '');
    if (!content.trim()) throw new BadRequestException('الملف فارغ');
    if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) throw new BadRequestException('حجم الملف يتجاوز 5 ميغابايت');
    const map: FileColumnMap = dto.columnMap
      ? coerceColumnMap(dto.columnMap)
      : device.fileColumnMap
        ? coerceColumnMap(device.fileColumnMap)
        : ZK_ATTLOG_COLUMNS;
    const parsed = parseAttendanceText(content, map, device.timezoneOffsetMinutes);
    const hash = fileHash(content);
    const previous = await this.prisma.hrAttendanceSyncLog.findFirst({
      where: { deviceId: id, fileHash: hash, status: 'SUCCESS' },
      orderBy: { startedAt: 'desc' },
    });

    if (dto.dryRun) {
      const users = [...new Set(parsed.records.map((r) => r.deviceUserId))];
      const mapped = await this.prisma.hrAttendanceDeviceUser.findMany({
        where: { deviceId: id, deviceUserId: { in: users } },
        select: { deviceUserId: true },
      });
      const mappedSet = new Set(mapped.map((m) => m.deviceUserId));
      const times = parsed.records.map((r) => r.localTime).sort();
      return {
        columnMap: map,
        totalLines: parsed.totalLines,
        validCount: parsed.records.length,
        invalidCount: parsed.invalid.length,
        skippedHeader: parsed.skippedHeader,
        firstPunch: times[0] ?? null,
        lastPunch: times[times.length - 1] ?? null,
        users: users.length,
        unmappedUsers: users.filter((u) => !mappedSet.has(u)),
        rawPreview: content
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .slice(0, 12)
          .map((l) => (l.includes('\t') ? l.split('\t') : l.includes(';') ? l.split(';') : l.includes(',') ? l.split(',') : l.trim().split(/\s+/)).map((c) => c.trim())),
        sample: parsed.records.slice(0, 15).map(({ punchedAt, ...r }) => ({ ...r, punchedAt: punchedAt.toISOString() })),
        invalidSample: parsed.invalid.slice(0, 15),
        alreadyImportedAt: previous?.startedAt ?? null,
      };
    }

    if (dto.saveColumnMap && dto.columnMap) {
      await this.prisma.hrAttendanceDevice.update({
        where: { id },
        data: { fileColumnMap: map as unknown as Prisma.InputJsonValue },
      });
    }
    const result = await this.ingest.ingest(device, parsed.records, {
      source: 'FILE_IMPORT',
      trigger: 'FILE',
      userId: actor.id,
      userName: actor.name,
      fileName: dto.fileName?.slice(0, 200) ?? null,
      fileHash: hash,
      invalidCount: parsed.invalid.length,
      details: { columnMap: map, invalidSample: parsed.invalid.slice(0, 20) } as unknown as Prisma.InputJsonValue,
    });
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.IMPORT,
      module: AUDIT_MODULES.HR,
      description: `استيراد ملف حضور «${dto.fileName ?? 'ملف'}» للجهاز «${device.name}»: ${result.inserted} جديد، ${result.duplicates} مكرر، ${result.invalid} غير صالح`,
      entity: 'HrAttendanceSyncLog',
      entityId: result.syncLogId,
    });
    return { ...result, alreadyImportedAt: previous?.startedAt ?? null };
  }

  async syncLogs(q: { deviceId?: string; page?: number; limit?: number }) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const where: Prisma.HrAttendanceSyncLogWhereInput = q.deviceId ? { deviceId: q.deviceId } : {};
    const [items, total] = await Promise.all([
      this.prisma.hrAttendanceSyncLog.findMany({
        where,
        include: { device: { select: { id: true, name: true } } },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.hrAttendanceSyncLog.count({ where }),
    ]);
    return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async unmappedUsers(deviceId: string) {
    await this.get(deviceId);
    const groups = await this.prisma.hrAttendanceEvent.groupBy({
      by: ['deviceUserId'],
      where: { deviceId, employeeId: null },
      _count: { _all: true },
      _min: { punchedAt: true },
      _max: { punchedAt: true },
    });
    return groups
      .map((g) => ({
        deviceUserId: g.deviceUserId,
        events: g._count._all,
        firstSeen: g._min.punchedAt,
        lastSeen: g._max.punchedAt,
      }))
      .sort((a, b) => a.deviceUserId.localeCompare(b.deviceUserId, undefined, { numeric: true }));
  }

  async mappings(deviceId: string) {
    await this.get(deviceId);
    return this.prisma.hrAttendanceDeviceUser.findMany({
      where: { deviceId },
      include: { employee: { select: { id: true, matricule: true, firstName: true, lastName: true, status: true } } },
      orderBy: { deviceUserId: 'asc' },
    });
  }

  async createMapping(deviceId: string, dto: { deviceUserId: string; employeeId: string; deviceUserName?: string | null }, actor: Actor) {
    const device = await this.get(deviceId);
    const uid = dto.deviceUserId?.trim();
    if (!uid || !/^[A-Za-z0-9_.-]{1,32}$/.test(uid)) throw new BadRequestException('معرّف المستخدم في الجهاز غير صالح');
    const employee = await this.prisma.hrEmployee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) throw new NotFoundException('الموظف غير موجود');
    const sameEmployee = await this.prisma.hrAttendanceDeviceUser.findFirst({ where: { deviceId, employeeId: dto.employeeId } });
    if (sameEmployee) {
      throw new BadRequestException(`هذا الموظف مربوط مسبقاً بالمعرّف ${sameEmployee.deviceUserId} على هذا الجهاز`);
    }
    try {
      const row = await this.prisma.hrAttendanceDeviceUser.create({
        data: {
          deviceId,
          deviceUserId: uid,
          employeeId: dto.employeeId,
          deviceUserName: dto.deviceUserName?.trim() || null,
          createdById: actor.id,
        },
      });
      const relink = await this.ingest.relinkDeviceUser(deviceId, uid, dto.employeeId);
      await this.audit.log({
        userId: actor.id,
        action: AUDIT_ACTIONS.CREATE,
        module: AUDIT_MODULES.HR,
        description: `ربط المعرّف ${uid} في جهاز «${device.name}» بالموظف ${fullName(employee)} (${relink.relinked} تسجيل سابق)`,
        entity: 'HrAttendanceDeviceUser',
        entityId: row.id,
      });
      return { ...row, relinked: relink.relinked };
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('هذا المعرّف مربوط مسبقاً بموظف آخر');
      throw e;
    }
  }

  async deleteMapping(id: string, actor: Actor) {
    const row = await this.prisma.hrAttendanceDeviceUser.findUnique({ where: { id }, include: { employee: true, device: true } });
    if (!row) throw new NotFoundException('الربط غير موجود');
    await this.prisma.hrAttendanceDeviceUser.delete({ where: { id } });
    const relink = await this.ingest.relinkDeviceUser(row.deviceId, row.deviceUserId, null);
    await this.audit.log({
      userId: actor.id,
      action: AUDIT_ACTIONS.DELETE,
      module: AUDIT_MODULES.HR,
      description: `فك ربط المعرّف ${row.deviceUserId} (جهاز «${row.device.name}») عن ${fullName(row.employee)} — ${relink.relinked} تسجيل أصبح غير مربوط`,
      entity: 'HrAttendanceDeviceUser',
      entityId: id,
    });
    return { ok: true, unlinked: relink.relinked };
  }

  employeeMappings(employeeId: string) {
    return this.prisma.hrAttendanceDeviceUser.findMany({
      where: { employeeId },
      include: { device: { select: { id: true, name: true, provider: true } } },
    });
  }

  // ── ADMS push bookkeeping ───────────────────────────────────────────────

  async admsDevice(serial: string) {
    return this.prisma.hrAttendanceDevice.findUnique({ where: { serialNumber: serial } });
  }

  async admsTouch(id: string, info?: Record<string, string>) {
    const now = new Date();
    const current = info ? await this.prisma.hrAttendanceDevice.findUnique({ where: { id }, select: { deviceInfo: true } }) : null;
    await this.prisma.hrAttendanceDevice.update({
      where: { id },
      data: {
        lastConnectionAt: now,
        status: 'ONLINE',
        ...(info
          ? {
              deviceInfo: {
                ...((current?.deviceInfo as object) ?? {}),
                ...info,
                lastHandshakeAt: now.toISOString(),
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
  }

  async admsSetStamp(id: string, stamp: string) {
    await this.prisma.hrAttendanceDevice.update({ where: { id }, data: { lastLogStamp: stamp } });
  }

  /** Unknown/disabled terminals are refused (so they keep their data) and reported, throttled. */
  async admsReject(serial: string, reason: string, meta: Record<string, string>) {
    const key = `${serial}|${reason}`;
    const last = this.rejectedLoggedAt.get(key) ?? 0;
    if (Date.now() - last < REJECT_LOG_INTERVAL_MS) return;
    this.rejectedLoggedAt.set(key, Date.now());
    const device = await this.prisma.hrAttendanceDevice.findUnique({ where: { serialNumber: serial } });
    await this.prisma.hrAttendanceSyncLog.create({
      data: {
        deviceId: device?.id ?? null,
        provider: 'ZKTECO_ADMS',
        trigger: 'PUSH',
        status: 'REJECTED',
        finishedAt: new Date(),
        errorMessage: reason,
        details: { serialNumber: serial, ...meta } as Prisma.InputJsonValue,
      },
    });
  }

  async markStaleDevicesOffline(offlineAfterMinutes: number) {
    const cutoff = new Date(Date.now() - offlineAfterMinutes * 60_000);
    return this.prisma.hrAttendanceDevice.updateMany({
      where: { provider: 'ZKTECO_ADMS', status: 'ONLINE', lastConnectionAt: { lt: cutoff } },
      data: { status: 'OFFLINE' },
    });
  }
}
