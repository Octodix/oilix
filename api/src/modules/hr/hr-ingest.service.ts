import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays, dateKeyToDb, dbDateToKey, localDateKey } from './engine/hr-time';
import { HrAttendanceService } from './hr-attendance.service';
import { punchDedupeKey, type ParsedPunch } from './zkteco/attlog-parser';

export type IngestContext = {
  source: 'ADMS_PUSH' | 'FILE_IMPORT' | 'TCP_PULL';
  trigger: 'PUSH' | 'FILE' | 'MANUAL' | 'SCHEDULED';
  userId?: string | null;
  userName?: string | null;
  fileName?: string | null;
  fileHash?: string | null;
  invalidCount?: number;
  details?: Prisma.InputJsonValue;
};

export type IngestResult = {
  syncLogId: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  unmapped: number;
  invalid: number;
  firstEventEver: boolean;
  reprocessed: { from: string; to: string; employees: number } | null;
};

type IngestDevice = { id: string; provider: string; timezoneOffsetMinutes: number; firstEventImportedAt: Date | null };

/**
 * Single entry point for raw punches, whatever the channel. Idempotent: the unique dedupe key
 * means replaying the same push or re-importing the same file never creates a second event.
 */
@Injectable()
export class HrIngestService {
  private readonly logger = new Logger(HrIngestService.name);

  constructor(
    private prisma: PrismaService,
    private attendance: HrAttendanceService,
  ) {}

  async ingest(device: IngestDevice, punches: ParsedPunch[], ctx: IngestContext): Promise<IngestResult> {
    const log = await this.prisma.hrAttendanceSyncLog.create({
      data: {
        deviceId: device.id,
        provider: device.provider,
        trigger: ctx.trigger,
        status: 'RUNNING',
        fileName: ctx.fileName ?? null,
        fileHash: ctx.fileHash ?? null,
        userId: ctx.userId ?? null,
        userName: ctx.userName ?? null,
      },
    });

    try {
      const mappings = await this.prisma.hrAttendanceDeviceUser.findMany({ where: { deviceId: device.id } });
      const employeeOf = new Map(mappings.map((m) => [m.deviceUserId, m.employeeId]));
      const seen = new Set<string>();
      const rows: Prisma.HrAttendanceEventCreateManyInput[] = [];
      for (const p of punches) {
        const dedupeKey = punchDedupeKey(device.id, p.deviceUserId, p.localTime);
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        rows.push({
          dedupeKey,
          deviceId: device.id,
          source: ctx.source,
          deviceUserId: p.deviceUserId,
          employeeId: employeeOf.get(p.deviceUserId) ?? null,
          punchedAt: p.punchedAt,
          localDate: dateKeyToDb(p.localTime.slice(0, 10)),
          deviceLocalTime: p.localTime,
          punchState: p.punchState,
          verifyCode: p.verifyCode,
          verifyMethod: p.verifyMethod,
          workCode: p.workCode,
          rawLine: p.rawLine,
          batchId: log.id,
        });
      }

      let inserted = 0;
      for (let i = 0; i < rows.length; i += 1000) {
        const r = await this.prisma.hrAttendanceEvent.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
        inserted += r.count;
      }
      const duplicates = punches.length - inserted;
      const unmapped = rows.filter((r) => !r.employeeId).length;
      const now = new Date();
      const lastEventAt = rows.reduce<Date | null>(
        (max, r) => (!max || (r.punchedAt as Date) > max ? (r.punchedAt as Date) : max),
        null,
      );
      const firstEventEver = inserted > 0 && !device.firstEventImportedAt;

      await this.prisma.hrAttendanceDevice.update({
        where: { id: device.id },
        data: {
          lastSyncAt: now,
          lastSuccessfulSyncAt: now,
          lastError: null,
          ...(ctx.source === 'ADMS_PUSH' ? { lastConnectionAt: now, status: 'ONLINE' } : {}),
          ...(firstEventEver ? { firstEventImportedAt: now } : {}),
        },
      });
      if (lastEventAt) {
        await this.prisma.hrAttendanceDevice.updateMany({
          where: { id: device.id, OR: [{ lastEventAt: null }, { lastEventAt: { lt: lastEventAt } }] },
          data: { lastEventAt },
        });
      }

      let reprocessed: IngestResult['reprocessed'] = null;
      const mapped = rows.filter((r) => r.employeeId);
      if (inserted > 0 && mapped.length) {
        const dates = mapped.map((r) => dbDateToKey(r.localDate as Date)).sort();
        const employees = [...new Set(mapped.map((r) => r.employeeId as string))];
        const from = addDays(dates[0], -1);
        const to = dates[dates.length - 1];
        try {
          await this.attendance.process({ from, to, employeeIds: employees });
          reprocessed = { from, to, employees: employees.length };
        } catch (e) {
          this.logger.error(`Attendance processing after ingest failed: ${(e as Error).message}`);
        }
      }

      await this.prisma.hrAttendanceSyncLog.update({
        where: { id: log.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          fetchedCount: punches.length,
          insertedCount: inserted,
          duplicateCount: duplicates,
          unmappedCount: unmapped,
          invalidCount: ctx.invalidCount ?? 0,
          details: {
            ...(ctx.details && typeof ctx.details === 'object' ? (ctx.details as object) : {}),
            firstEventEver,
            reprocessed,
            today: localDateKey(now, device.timezoneOffsetMinutes),
          } as Prisma.InputJsonValue,
        },
      });

      return {
        syncLogId: log.id,
        fetched: punches.length,
        inserted,
        duplicates,
        unmapped,
        invalid: ctx.invalidCount ?? 0,
        firstEventEver,
        reprocessed,
      };
    } catch (e) {
      const message = (e as Error).message?.slice(0, 1000) ?? 'unknown error';
      await this.prisma.hrAttendanceSyncLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message, fetchedCount: punches.length },
      });
      await this.prisma.hrAttendanceDevice.update({
        where: { id: device.id },
        data: { lastSyncAt: new Date(), lastError: message, status: 'ERROR' },
      });
      throw e;
    }
  }

  /** Links already-received punches of a device user to an employee (raw values untouched). */
  async relinkDeviceUser(deviceId: string, deviceUserId: string, employeeId: string | null) {
    const affected = await this.prisma.hrAttendanceEvent.findMany({
      where: { deviceId, deviceUserId },
      select: { employeeId: true, localDate: true },
    });
    if (!affected.length) return { relinked: 0 };
    await this.prisma.hrAttendanceEvent.updateMany({ where: { deviceId, deviceUserId }, data: { employeeId } });
    const dates = affected.map((a) => dbDateToKey(a.localDate)).sort();
    const employees = [
      ...new Set([employeeId, ...affected.map((a) => a.employeeId)].filter((x): x is string => !!x)),
    ];
    await this.attendance.process({ from: addDays(dates[0], -1), to: dates[dates.length - 1], employeeIds: employees });
    return { relinked: affected.length };
  }
}
