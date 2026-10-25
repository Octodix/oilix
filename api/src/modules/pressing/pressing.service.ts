import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntryStatus, OliveType, Prisma } from '@prisma/client';
import { paginatedMeta } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { OLIVE_TYPE_AR } from '../../common/constants/arabic-labels';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import {
  extraction as extractionAudit,
  processing as processingAudit,
  pressingFieldChanges,
} from '../../common/audit/audit-format';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { REALTIME_ENTITIES } from '../realtime/realtime.constants';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { attributedDeviceId } from '../devices/device-context';
import { MillAssistanceService } from '../mill-assistance/mill-assistance.service';
import { SeasonScopeService } from '../../common/season/season-scope.service';
import {
  CreatePressingDto,
  PressingAuditContext,
  PressingQueryDto,
  UpdatePressingDto,
} from './dto/create-pressing.dto';
import { ProcessingFilter, ProcessingQueryDto } from './dto/processing-query.dto';

import { amountFromWeightQuintal, isFullPriceAid } from '../../common/constants/pricing';
import { currentTimeAlgeria } from '../../common/utils/algeria-locale';

function currentTime(): string {
  return currentTimeAlgeria();
}

const PRESSED: EntryStatus[] = [
  EntryStatus.PRESSED,
  EntryStatus.OIL_COLLECTED,
  EntryStatus.PAID,
  EntryStatus.COMPLETED,
];

@Injectable()
export class PressingService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private settingsService: SettingsService,
    private seasonScope: SeasonScopeService,
    private realtime: RealtimeService,
    private notifications: NotificationsService,
    private assistance: MillAssistanceService,
  ) {}

  private clientName(client: { firstName: string; lastName: string }) {
    return `${client.firstName} ${client.lastName}`.trim();
  }

  private async broadcastProcessing(
    action: string,
    module: string,
    params: {
      entryId: string;
      seasonId: string;
      oliveType: OliveType;
      client: { firstName: string; lastName: string };
      clientId: string;
    },
    userId: string,
    summary: string,
    entity: (typeof REALTIME_ENTITIES)[keyof typeof REALTIME_ENTITIES] = REALTIME_ENTITIES.PROCESSING,
  ) {
    const actorName = await this.auditService.getActorDisplayName(userId);
    const clientName = this.clientName(params.client);
    const oliveTypeAr = OLIVE_TYPE_AR[params.oliveType];

    this.realtime.emit({
      entity,
      entityId: params.entryId,
      action,
      module,
      seasonId: params.seasonId,
      oliveType: params.oliveType,
      oliveTypeAr,
      clientId: params.clientId,
      entryId: params.entryId,
      clientName,
      actorId: userId,
      actorName,
      source: 'web',
    });

    await this.notifications.notifyWebProcessing({
      action,
      clientName,
      oliveTypeAr,
      oliveType: params.oliveType,
      actorName,
      actorId: userId,
      seasonId: params.seasonId,
      clientId: params.clientId,
      entryId: params.entryId,
      summary,
      module,
    });
  }

  private async computeAmount(totalWeightKg: number): Promise<number> {
    const pricePerQuintal = await this.settingsService.getPricePerQuintal();
    return amountFromWeightQuintal(pricePerQuintal, totalWeightKg);
  }

  /** Poids cumulé des pesées en attente pour un client. */
  private async pendingWeightForClient(
    clientId: string,
    seasonId: string,
    oliveType: OliveType,
  ): Promise<{ pendingIds: string[]; totalWeightKg: number }> {
    const pending = await this.prisma.oliveEntry.findMany({
      where: {
        clientId,
        seasonId,
        oliveType,
        deletedAt: null,
        status: { in: [EntryStatus.RECEIVED, EntryStatus.IN_STORAGE] },
      },
      select: { id: true, totalWeightKg: true },
    });
    return {
      pendingIds: pending.map((e) => e.id),
      totalWeightKg: pending.reduce((s, e) => s + Number(e.totalWeightKg), 0),
    };
  }

  /** Poids cumulé des pesées déjà traitées pour un client. */
  private async pressedWeightForClient(
    clientId: string,
    seasonId: string,
    oliveType: OliveType,
  ): Promise<number> {
    const agg = await this.prisma.oliveEntry.aggregate({
      where: {
        clientId,
        seasonId,
        oliveType,
        deletedAt: null,
        status: { in: PRESSED },
      },
      _sum: { totalWeightKg: true },
    });
    return Number(agg._sum.totalWeightKg ?? 0);
  }

  private mapRow(
    entry: Prisma.OliveEntryGetPayload<{
      include: { client: true; pressingRecord: true };
    }>,
  ) {
    const p = entry.pressingRecord;
    const amount = p ? Number(p.amount) : 0;
    const aid = p ? Number(p.aidAmount) : 0;
    return {
      id: entry.id,
      oliveEntryId: entry.id,
      pressingId: p?.id ?? null,
      entryDate: entry.entryDate,
      entryTime: entry.entryTime,
      referenceNumber: entry.referenceNumber,
      clientName: entry.client
        ? `${entry.client.firstName} ${entry.client.lastName}`.trim()
        : '—',
      phone: entry.client.phone,
      bagCount: entry.bagCount,
      totalWeightKg: Number(entry.totalWeightKg),
      adhlefCount: entry.adhlefCount,
      capacity: entry.capacity ? Number(entry.capacity) : null,
      amount,
      aidAmount: aid,
      netAmount: amount - aid,
      yieldPercent: p?.yieldPercent ? Number(p.yieldPercent) : null,
      region: p?.region ?? null,
      zayat: p?.zayat ?? null,
      oilQuantityL: p ? Number(p.oilQuantityL) : null,
      treatmentDate: p?.treatmentDate ?? null,
      treatmentTime: p?.treatmentTime ?? null,
      oilCollected: p?.oilCollected ?? false,
      paid: p?.paid ?? false,
      pickupDate: p?.pickupDate ?? null,
      notes: entry.notes ?? p?.notes ?? null,
      notes2: entry.notes2 ?? p?.notes2 ?? null,
      status: entry.status,
      isNonReferential: entry.isNonReferential,
      isCancelled: entry.status === EntryStatus.CANCELLED,
      isMilled: PRESSED.includes(entry.status),
    };
  }

  private buildProcessingWhere(
    query: ProcessingQueryDto,
    seasonId: string,
  ): Prisma.OliveEntryWhereInput {
    return {
      seasonId,
      oliveType: query.oliveType,
      ...(query.filter === ProcessingFilter.CANCELLED
        ? { status: EntryStatus.CANCELLED }
        : { deletedAt: null }),
      ...(query.filter === ProcessingFilter.TAKEN
        ? { pressingRecord: { oilCollected: true } }
        : {}),
      ...(query.filter === ProcessingFilter.PAID
        ? { pressingRecord: { paid: true } }
        : {}),
      ...(query.filter === ProcessingFilter.UNMILLED
        ? { status: { in: [EntryStatus.RECEIVED, EntryStatus.IN_STORAGE] } }
        : {}),
      ...(query.filter === ProcessingFilter.FULL_AID
        ? { pressingRecord: { aidAmount: { gt: 0 } } }
        : {}),
      ...(query.filter === ProcessingFilter.CUSTOMER
        ? { status: { not: EntryStatus.CANCELLED } }
        : {}),
    };
  }

  private async aggregateBoardTotals(where: Prisma.OliveEntryWhereInput) {
    const [entryAgg, pressingAgg] = await Promise.all([
      this.prisma.oliveEntry.aggregate({
        where,
        _sum: { bagCount: true, totalWeightKg: true },
      }),
      this.prisma.pressingRecord.aggregate({
        where: { oliveEntry: where },
        _sum: { amount: true, aidAmount: true, oilQuantityL: true },
      }),
    ]);

    const amount = Number(pressingAgg._sum.amount ?? 0);
    const aidAmount = Number(pressingAgg._sum.aidAmount ?? 0);

    return {
      bagCount: entryAgg._sum.bagCount ?? 0,
      totalWeightKg: Number(entryAgg._sum.totalWeightKg ?? 0),
      amount,
      aidAmount,
      netAmount: amount - aidAmount,
      oilQuantityL: Number(pressingAgg._sum.oilQuantityL ?? 0),
    };
  }

  private mapClientBoardRow(
    clientId: string,
    entries: Prisma.OliveEntryGetPayload<{
      include: { client: true; pressingRecord: true };
    }>[],
    sums: {
      bagCount: number;
      totalWeightKg: number;
      adhlefCount: number;
      capacity: number;
    },
  ) {
    const sorted = [...entries].sort((a, b) => {
      const d = a.entryDate.getTime() - b.entryDate.getTime();
      if (d !== 0) return d;
      return a.referenceNumber - b.referenceNumber;
    });
    const primary = sorted[sorted.length - 1];
    const client = primary.client;

    let amount = 0;
    let aidAmount = 0;
    let oilQuantityL = 0;
    let yieldSum = 0;
    let yieldCount = 0;

    for (const e of entries) {
      const p = e.pressingRecord;
      if (!p) continue;
      amount += Number(p.amount);
      aidAmount += Number(p.aidAmount);
      oilQuantityL += Number(p.oilQuantityL);
      if (p.yieldPercent != null) {
        yieldSum += Number(p.yieldPercent);
        yieldCount += 1;
      }
    }

    const p = primary.pressingRecord;
    const anyCancelled = entries.some((e) => e.status === EntryStatus.CANCELLED);
    const allCancelled = entries.every((e) => e.status === EntryStatus.CANCELLED);
    const oilCollected = entries.some((e) => e.pressingRecord?.oilCollected);
    const paid = entries.some((e) => e.pressingRecord?.paid);
    const isMilled = entries.some((e) => PRESSED.includes(e.status));

    return {
      id: primary.id,
      clientId,
      clientNumber: client?.clientNumber ?? 0,
      entryCount: entries.length,
      oliveEntryId: primary.id,
      pressingId: p?.id ?? null,
      entryDate: primary.entryDate,
      entryTime: primary.entryTime,
      referenceNumber: primary.referenceNumber,
      firstName: client?.firstName ?? '',
      lastName: client?.lastName ?? '',
      clientName: client
        ? `${client.firstName} ${client.lastName}`.trim()
        : '—',
      phone: client?.phone,
      bagCount: sums.bagCount,
      totalWeightKg: sums.totalWeightKg,
      adhlefCount: sums.adhlefCount,
      capacity: sums.capacity > 0 ? sums.capacity : null,
      amount,
      aidAmount,
      netAmount: amount - aidAmount,
      yieldPercent: yieldCount > 0 ? yieldSum / yieldCount : null,
      region: p?.region ?? null,
      zayat: p?.zayat ?? null,
      oilQuantityL: oilQuantityL > 0 ? oilQuantityL : null,
      treatmentDate: p?.treatmentDate ?? null,
      treatmentTime: p?.treatmentTime ?? null,
      oilCollected,
      paid,
      pickupDate: p?.pickupDate ?? null,
      notes: primary.notes ?? p?.notes ?? null,
      notes2: primary.notes2 ?? p?.notes2 ?? null,
      status: primary.status,
      isNonReferential: entries.some((e) => e.isNonReferential),
      isCancelled: allCancelled,
      hasCancelled: anyCancelled,
      isMilled,
    };
  }

  async findProcessingBoard(query: ProcessingQueryDto) {
    const seasonId = await this.seasonScope.getSeasonId();
    const where = this.buildProcessingWhere(query, seasonId);

    const groups = await this.prisma.oliveEntry.groupBy({
      by: ['clientId'],
      where,
      _sum: {
        bagCount: true,
        totalWeightKg: true,
        adhlefCount: true,
        capacity: true,
      },
      _min: { entryDate: true },
      orderBy: { _min: { entryDate: 'asc' } },
    });

    const clientIds = groups.map((g) => g.clientId);
    const pricePerQuintal = await this.settingsService.getPricePerQuintal();

    if (clientIds.length === 0) {
      const totals = await this.aggregateBoardTotals(where);
      return {
        items: [],
        totals,
        total: 0,
        pricePerQuintal,
      };
    }

    const entries = await this.prisma.oliveEntry.findMany({
      where: { ...where, clientId: { in: clientIds } },
      include: { client: true, pressingRecord: true },
      orderBy: [{ entryDate: 'asc' }, { referenceNumber: 'asc' }],
    });

    const byClient = new Map<string, typeof entries>();
    for (const e of entries) {
      const list = byClient.get(e.clientId) ?? [];
      list.push(e);
      byClient.set(e.clientId, list);
    }

    const groupMap = new Map(groups.map((g) => [g.clientId, g]));
    let items = clientIds.map((clientId) => {
      const g = groupMap.get(clientId)!;
      const clientEntries = byClient.get(clientId) ?? [];
      return this.mapClientBoardRow(clientId, clientEntries, {
        bagCount: g._sum.bagCount ?? 0,
        totalWeightKg: Number(g._sum.totalWeightKg ?? 0),
        adhlefCount: g._sum.adhlefCount ?? 0,
        capacity: g._sum.capacity ? Number(g._sum.capacity) : 0,
      });
    });

    if (query.filter === ProcessingFilter.FULL_AID) {
      items = items.filter((row) => isFullPriceAid(row.amount, row.aidAmount));
    }

    let totals;
    if (query.filter === ProcessingFilter.FULL_AID) {
      totals = items.reduce(
        (acc, row) => {
          acc.bagCount += row.bagCount;
          acc.totalWeightKg += row.totalWeightKg;
          acc.amount += row.amount;
          acc.aidAmount += row.aidAmount;
          acc.netAmount += row.netAmount;
          acc.oilQuantityL += row.oilQuantityL ?? 0;
          return acc;
        },
        { bagCount: 0, totalWeightKg: 0, amount: 0, aidAmount: 0, netAmount: 0, oilQuantityL: 0 },
      );
    } else {
      try {
        totals = await this.aggregateBoardTotals(where);
      } catch {
        totals = items.reduce(
          (acc, row) => {
            acc.bagCount += row.bagCount;
            acc.totalWeightKg += row.totalWeightKg;
            acc.amount += row.amount;
            acc.aidAmount += row.aidAmount;
            acc.netAmount += row.netAmount;
            acc.oilQuantityL += row.oilQuantityL ?? 0;
            return acc;
          },
          { bagCount: 0, totalWeightKg: 0, amount: 0, aidAmount: 0, netAmount: 0, oilQuantityL: 0 },
        );
      }
    }

    return { items, totals, total: items.length, pricePerQuintal };
  }

  async findAllByClient(query: PressingQueryDto) {
    const seasonId = await this.seasonScope.getSeasonId();
    const records = await this.prisma.pressingRecord.findMany({
      where: {
        oliveEntry: {
          seasonId,
          deletedAt: null,
          ...(query.oliveType ? { oliveType: query.oliveType } : {}),
        },
        ...(query.dateFrom || query.dateTo
          ? {
              treatmentDate: {
                ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
              },
            }
          : {}),
        ...(query.unpaidOnly ? { paid: false } : {}),
        ...(query.oilNotCollected ? { oilCollected: false } : {}),
      },
      orderBy: { treatmentDate: 'desc' },
      include: {
        oliveEntry: {
          include: {
            client: {
              select: {
                id: true,
                clientNumber: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    const byClient = new Map<
      string,
      {
        clientId: string;
        clientNumber: number;
        clientName: string;
        phone?: string | null;
        pressingCount: number;
        oilQuantityL: number;
        amount: number;
        aidAmount: number;
        netAmount: number;
        oilCollected: boolean;
        paid: boolean;
        latestPressingId: string;
        latestReferenceNumber: number;
        bagCount: number;
        totalWeightKg: number;
        adhlefCount: number;
        capacity: number;
        oliveType?: string;
      }
    >();

    for (const r of records) {
      const client = r.oliveEntry.client;
      const cid = client.id;
      const oil = Number(r.oilQuantityL);
      const amount = Number(r.amount);
      const aid = Number(r.aidAmount);
      const existing = byClient.get(cid);

      if (!existing) {
        byClient.set(cid, {
          clientId: cid,
          clientNumber: client.clientNumber,
          clientName: `${client.firstName} ${client.lastName}`.trim(),
          phone: client.phone,
          pressingCount: 1,
          oilQuantityL: oil,
          amount,
          aidAmount: aid,
          netAmount: amount - aid,
          oilCollected: r.oilCollected,
          paid: r.paid,
          latestPressingId: r.id,
          latestReferenceNumber: r.oliveEntry.referenceNumber,
          bagCount: 0,
          totalWeightKg: 0,
          adhlefCount: 0,
          capacity: 0,
          oliveType: r.oliveEntry.oliveType,
        });
        continue;
      }

      existing.pressingCount += 1;
      existing.oilQuantityL += oil;
      existing.amount += amount;
      existing.aidAmount += aid;
      existing.netAmount += amount - aid;
      existing.oilCollected = existing.oilCollected && r.oilCollected;
      existing.paid = existing.paid && r.paid;
    }

    const clientIds = [...byClient.keys()];
    if (clientIds.length > 0) {
      const entrySums = await this.prisma.oliveEntry.groupBy({
        by: ['clientId'],
        where: {
          seasonId,
          deletedAt: null,
          clientId: { in: clientIds },
          ...(query.oliveType ? { oliveType: query.oliveType } : {}),
        },
        _sum: {
          bagCount: true,
          totalWeightKg: true,
          adhlefCount: true,
          capacity: true,
        },
      });
      const sumMap = new Map(entrySums.map((s) => [s.clientId, s]));
      for (const row of byClient.values()) {
        const s = sumMap.get(row.clientId);
        Object.assign(row, {
          bagCount: s?._sum.bagCount ?? 0,
          totalWeightKg: Number(s?._sum.totalWeightKg ?? 0),
          adhlefCount: s?._sum.adhlefCount ?? 0,
          capacity: s?._sum.capacity ? Number(s._sum.capacity) : 0,
        });
      }
    }

    return [...byClient.values()].sort((a, b) =>
      a.clientName.localeCompare(b.clientName, 'ar-DZ'),
    );
  }

  async findAll(query: PressingQueryDto) {
    const seasonId = await this.seasonScope.getSeasonId();
    return this.prisma.pressingRecord.findMany({
      where: {
        oliveEntry: {
          seasonId,
          deletedAt: null,
          ...(query.oliveType ? { oliveType: query.oliveType } : {}),
        },
        ...(query.dateFrom || query.dateTo
          ? {
              treatmentDate: {
                ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
              },
            }
          : {}),
        ...(query.unpaidOnly ? { paid: false } : {}),
        ...(query.oilNotCollected ? { oilCollected: false } : {}),
      },
      orderBy: { treatmentDate: 'desc' },
      include: {
        oliveEntry: {
          select: {
            referenceNumber: true,
            totalWeightKg: true,
            status: true,
            oliveType: true,
            client: { select: { firstName: true, lastName: true } },
          },
        },
        user: { select: { id: true, username: true } },
        payments: true,
      },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.pressingRecord.findUnique({
      where: { id },
      include: {
        oliveEntry: { include: { client: true, weights: true } },
        user: { select: { id: true, username: true } },
        payments: true,
      },
    });
    if (!record) throw new NotFoundException('سجل التصفية غير موجود');
    return record;
  }

  private stripAuditFields<T extends { auditContext?: PressingAuditContext }>(
    dto: T,
  ): Omit<T, 'auditContext'> {
    const { auditContext: _ctx, ...rest } = dto;
    return rest;
  }

  async create(dto: CreatePressingDto, userId: string) {
    const auditContext = dto.auditContext ?? PressingAuditContext.EXTRACTION;
    const data = this.stripAuditFields(dto);

    const entry = await this.prisma.oliveEntry.findFirst({
      where: { id: data.oliveEntryId, deletedAt: null },
      include: { client: true },
    });
    if (!entry) throw new NotFoundException('عملية الاستقبال غير موجودة');
    if (entry.status === EntryStatus.CANCELLED) {
      throw new BadRequestException('العملية ملغاة');
    }
    if (PRESSED.includes(entry.status)) {
      throw new BadRequestException('تم تسجيل تصفية هذه العملية مسبقاً');
    }

    const existing = await this.prisma.pressingRecord.findUnique({
      where: { oliveEntryId: data.oliveEntryId },
    });
    if (existing) throw new BadRequestException('سجل التصفية موجود مسبقاً');

    const { pendingIds, totalWeightKg } = await this.pendingWeightForClient(
      entry.clientId,
      entry.seasonId,
      entry.oliveType,
    );
    if (!pendingIds.includes(data.oliveEntryId)) {
      throw new BadRequestException('هذه الوزنة غير قابلة للتصفية');
    }

    const amount = await this.computeAmount(totalWeightKg);
    const yieldPercent =
      data.yieldPercent ??
      (totalWeightKg > 0 ? (data.oilQuantityL / totalWeightKg) * 100 : 0);

    const nextStatus = data.paid
      ? EntryStatus.PAID
      : data.oilCollected
        ? EntryStatus.OIL_COLLECTED
        : EntryStatus.PRESSED;

    // Operations recorded by an assistant stay traceable to their session.
    const assistanceSessionId = await this.assistance.activeSessionIdFor(userId);

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pressingRecord.create({
        data: {
          ...data,
          amount,
          yieldPercent,
          treatmentTime: currentTime(),
          userId,
          deviceId: attributedDeviceId(),
          assistanceSessionId,
          pickupDate: data.oilCollected ? new Date() : undefined,
        },
        include: { oliveEntry: { include: { client: true } } },
      });
      await tx.oliveEntry.updateMany({
        where: { id: { in: pendingIds } },
        data: { status: nextStatus },
      });
      return created;
    });
    if (data.paid) {
      await this.recordSettlementPayment(record.id, Number(record.amount), userId, assistanceSessionId);
    }

    const client = record.oliveEntry.client;
    const isExtraction = auditContext === PressingAuditContext.EXTRACTION;
    await this.auditService.log({
      userId,
      action: AUDIT_ACTIONS.START,
      module: isExtraction ? AUDIT_MODULES.PRESSING : AUDIT_MODULES.PROCESSING,
      description: isExtraction
        ? extractionAudit.start({
            client,
            reference: entry.referenceNumber,
            oilL: data.oilQuantityL,
            amount: Number(record.amount),
          })
        : processingAudit.startTreatment({
            client,
            reference: entry.referenceNumber,
          }),
      entity: 'PressingRecord',
      entityId: record.id,
      newData: {
        oliveEntryId: data.oliveEntryId,
        oilQuantityL: data.oilQuantityL,
        amount: Number(record.amount),
      },
    });

    if (data.paid || data.oilCollected) {
      await this.auditService.log({
        userId,
        action: AUDIT_ACTIONS.VALIDATE,
        module: AUDIT_MODULES.PRESSING,
        description: extractionAudit.validate({
          client,
          reference: entry.referenceNumber,
        }),
        entity: 'PressingRecord',
        entityId: record.id,
      });
    }

    await this.broadcastProcessing(
      AUDIT_ACTIONS.START,
      isExtraction ? AUDIT_MODULES.PRESSING : AUDIT_MODULES.PROCESSING,
      {
        entryId: entry.id,
        seasonId: entry.seasonId,
        oliveType: entry.oliveType,
        client,
        clientId: client.id,
      },
      userId,
      isExtraction ? 'بدء التصفية' : 'بدء المعالجة',
      isExtraction ? REALTIME_ENTITIES.PRESSING : REALTIME_ENTITIES.PROCESSING,
    );

    return record;
  }

  async update(id: string, dto: UpdatePressingDto, userId: string) {
    const auditContext = dto.auditContext ?? PressingAuditContext.PROCESSING;
    const data = this.stripAuditFields(dto);

    const existing = await this.findOne(id);
    const client = existing.oliveEntry.client;
    const ref = existing.oliveEntry.referenceNumber;

    const nextOilCollected =
      data.oilCollected !== undefined ? data.oilCollected : existing.oilCollected;
    const nextPaid = data.paid !== undefined ? data.paid : existing.paid;

    let pickupDate = existing.pickupDate;
    if (nextOilCollected && !existing.oilCollected) {
      pickupDate = new Date();
    } else if (!nextOilCollected && existing.oilCollected) {
      pickupDate = null;
    }

    const totalWeight = await this.pressedWeightForClient(
      client.id,
      existing.oliveEntry.seasonId,
      existing.oliveEntry.oliveType,
    );
    const amount = await this.computeAmount(totalWeight);

    const record = await this.prisma.pressingRecord.update({
      where: { id },
      data: {
        ...data,
        amount,
        pickupDate,
        ...(attributedDeviceId() ? { deviceId: attributedDeviceId() } : {}),
      },
      include: { oliveEntry: { include: { client: true } } },
    });

    if (data.paid === true && !existing.paid) {
      await this.recordSettlementPayment(
        id,
        Number(record.amount),
        userId,
        await this.assistance.activeSessionIdFor(userId),
      );
    }

    const status = nextPaid
      ? EntryStatus.PAID
      : nextOilCollected
        ? EntryStatus.OIL_COLLECTED
        : EntryStatus.PRESSED;

    await this.prisma.oliveEntry.updateMany({
      where: {
        clientId: client.id,
        seasonId: existing.oliveEntry.seasonId,
        oliveType: existing.oliveEntry.oliveType,
        deletedAt: null,
        status: { in: PRESSED },
      },
      data: { status },
    });

    const isCollect = data.oilCollected === true && !existing.oilCollected;
    const isUncollect = data.oilCollected === false && existing.oilCollected;
    const isPay = data.paid === true && !existing.paid;
    const isUnpay = data.paid === false && existing.paid;
    const fieldChanges = pressingFieldChanges(existing, data);

    if (isCollect) {
      await this.auditService.log({
        userId,
        action: AUDIT_ACTIONS.COLLECT,
        module: AUDIT_MODULES.PROCESSING,
        description: processingAudit.collectOil({ client, reference: ref }),
        entity: 'PressingRecord',
        entityId: id,
      });
    } else if (isUncollect) {
      await this.auditService.log({
        userId,
        action: AUDIT_ACTIONS.UPDATE,
        module: AUDIT_MODULES.PROCESSING,
        description: processingAudit.uncollectOil({ client, reference: ref }),
        entity: 'PressingRecord',
        entityId: id,
        oldData: { oilCollected: true } as Prisma.InputJsonValue,
        newData: { oilCollected: false } as Prisma.InputJsonValue,
      });
    } else if (isPay) {
      await this.auditService.log({
        userId,
        action: AUDIT_ACTIONS.PAY,
        module: AUDIT_MODULES.PROCESSING,
        description: processingAudit.payClient({ client, reference: ref }),
        entity: 'PressingRecord',
        entityId: id,
      });
      await this.auditService.log({
        userId,
        action: AUDIT_ACTIONS.VALIDATE,
        module: AUDIT_MODULES.PRESSING,
        description: extractionAudit.validate({ client, reference: ref }),
        entity: 'PressingRecord',
        entityId: id,
      });
    } else if (isUnpay) {
      await this.auditService.log({
        userId,
        action: AUDIT_ACTIONS.UPDATE,
        module: AUDIT_MODULES.PROCESSING,
        description: processingAudit.unpayClient({ client, reference: ref }),
        entity: 'PressingRecord',
        entityId: id,
        oldData: { paid: true } as Prisma.InputJsonValue,
        newData: { paid: false } as Prisma.InputJsonValue,
      });
    } else if (fieldChanges.length > 0) {
      const isExtraction = auditContext === PressingAuditContext.EXTRACTION;
      const hasOilChange = fieldChanges.some((c) =>
        ['كمية الزيت', 'الريات %', 'المساعدة'].includes(c.label),
      );
      await this.auditService.log({
        userId,
        action: AUDIT_ACTIONS.UPDATE,
        module:
          isExtraction || hasOilChange
            ? AUDIT_MODULES.PRESSING
            : AUDIT_MODULES.PROCESSING,
        description: (isExtraction || hasOilChange
          ? extractionAudit.update
          : processingAudit.updateTreatment)({
          client,
          reference: ref,
          changes: fieldChanges,
        }),
        entity: 'PressingRecord',
        entityId: id,
        oldData: existing as unknown as object,
        newData: record as unknown as object,
      });
    }

    if (isCollect || isUncollect || isPay || isUnpay || fieldChanges.length > 0) {
      const isExtraction = auditContext === PressingAuditContext.EXTRACTION;
      const hasOilChange = fieldChanges.some((c) =>
        ['كمية الزيت', 'الريات %', 'المساعدة'].includes(c.label),
      );
      const mod =
        isExtraction || hasOilChange || isPay
          ? AUDIT_MODULES.PRESSING
          : AUDIT_MODULES.PROCESSING;
      const action = isPay
        ? AUDIT_ACTIONS.PAY
        : isCollect
          ? AUDIT_ACTIONS.COLLECT
          : AUDIT_ACTIONS.UPDATE;
      await this.broadcastProcessing(
        action,
        mod,
        {
          entryId: existing.oliveEntryId,
          seasonId: existing.oliveEntry.seasonId,
          oliveType: existing.oliveEntry.oliveType,
          client,
          clientId: client.id,
        },
        userId,
        isPay
          ? 'تسديد'
          : isUnpay
            ? 'استرجاع الدفع'
            : isCollect
              ? 'استلام الزيت'
              : isUncollect
                ? 'استرجاع أخذ الزيت'
                : 'تحديث المعالجة',
        mod === AUDIT_MODULES.PRESSING
          ? REALTIME_ENTITIES.PRESSING
          : REALTIME_ENTITIES.PROCESSING,
      );
    }

    return record;
  }

  async markOilCollected(pressingId: string, userId: string, value = true) {
    return this.update(pressingId, { oilCollected: value }, userId);
  }

  async markPaid(pressingId: string, userId: string, value = true) {
    return this.update(pressingId, { paid: value }, userId);
  }

  /**
   * Marking an operation "سالك" collects its remaining balance in cash. Recording it as a
   * payment makes the collected amount traceable to the operator (and their assistance
   * session) instead of being just a flag. Nothing is created when the balance is already
   * covered, so toggling paid off and on never duplicates money.
   */
  private async recordSettlementPayment(
    pressingRecordId: string,
    amountDue: number,
    userId: string,
    assistanceSessionId: string | null,
  ) {
    const agg = await this.prisma.payment.aggregate({
      where: { pressingRecordId },
      _sum: { amount: true },
    });
    const remaining =
      Math.round((amountDue - Number(agg._sum.amount ?? 0) + Number.EPSILON) * 100) / 100;
    if (remaining <= 0) return null;
    return this.prisma.payment.create({
      data: {
        pressingRecordId,
        amount: remaining,
        method: null,
        notes: 'تسوية كاملة (سالك)',
        paymentTime: currentTime(),
        userId,
        deviceId: attributedDeviceId(),
        assistanceSessionId,
      },
    });
  }

  async cancelEntry(entryId: string, userId: string, reason?: string) {
    const entry = await this.prisma.oliveEntry.findFirst({
      where: { id: entryId },
      include: { client: true, pressingRecord: true },
    });
    if (!entry) throw new NotFoundException('العملية غير موجودة');

    await this.prisma.oliveEntry.update({
      where: { id: entryId },
      data: {
        status: EntryStatus.CANCELLED,
        notes2: reason ? `${entry.notes2 ?? ''}\nملغى: ${reason}`.trim() : entry.notes2,
      },
    });

    const hadPressing = !!entry.pressingRecord;
    await this.auditService.log({
      userId,
      action: AUDIT_ACTIONS.CANCEL,
      module: hadPressing ? AUDIT_MODULES.PRESSING : AUDIT_MODULES.PROCESSING,
      description: hadPressing
        ? extractionAudit.cancel({
            client: entry.client,
            reference: entry.referenceNumber,
            reason,
          })
        : processingAudit.cancelTreatment({
            client: entry.client,
            reference: entry.referenceNumber,
            reason,
          }),
      entity: 'OliveEntry',
      entityId: entryId,
      oldData: { status: entry.status },
      newData: { status: EntryStatus.CANCELLED, reason },
    });

    await this.broadcastProcessing(
      AUDIT_ACTIONS.CANCEL,
      hadPressing ? AUDIT_MODULES.PRESSING : AUDIT_MODULES.PROCESSING,
      {
        entryId,
        seasonId: entry.seasonId,
        oliveType: entry.oliveType,
        client: entry.client,
        clientId: entry.clientId,
      },
      userId,
      'إلغاء العملية',
      hadPressing ? REALTIME_ENTITIES.PRESSING : REALTIME_ENTITIES.PROCESSING,
    );

    return { message: 'تم إلغاء العملية' };
  }

  async setNonReferential(entryId: string, value: boolean, userId: string) {
    const entry = await this.prisma.oliveEntry.findFirst({
      where: { id: entryId },
      include: { client: true },
    });
    if (!entry) throw new NotFoundException('العملية غير موجودة');

    await this.prisma.oliveEntry.update({
      where: { id: entryId },
      data: { isNonReferential: value },
    });
    await this.auditService.log({
      userId,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.PROCESSING,
      description: processingAudit.nonReferential({
        client: entry.client,
        reference: entry.referenceNumber,
        value,
      }),
      entity: 'OliveEntry',
      entityId: entryId,
      oldData: { isNonReferential: entry.isNonReferential },
      newData: { isNonReferential: value },
    });

    await this.broadcastProcessing(
      AUDIT_ACTIONS.UPDATE,
      AUDIT_MODULES.PROCESSING,
      {
        entryId,
        seasonId: entry.seasonId,
        oliveType: entry.oliveType,
        client: entry.client,
        clientId: entry.clientId,
      },
      userId,
      value ? 'تحويل لغير مرجعي' : 'إلغاء غير مرجعي',
    );

    return { message: 'تم التحديث' };
  }
}
