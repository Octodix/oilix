import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { currentDevice } from '../devices/device-context';
import {
  DEFAULT_PRINT_SETTINGS,
  publicPrintSettings,
} from './printing.constants';
import {
  LogPrintJobDto,
  PrintJobQueryDto,
  UpdateDevicePrintSettingsDto,
} from './dto/printing.dto';

const deviceSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  cashRegister: { select: { id: true, code: true, name: true } },
  printSettings: true,
} as const;

function cleanPrinter(v: string | null | undefined) {
  if (v === undefined) return undefined;
  const t = v?.trim();
  return t ? t : null;
}

@Injectable()
export class PrintingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Printer settings of the workstation making the request (X-Device-Installation-Id),
   * independent of which user is logged in.
   */
  async forCurrentDevice() {
    const device = currentDevice();
    if (!device) {
      return {
        device: null,
        configured: false,
        settings: { ...DEFAULT_PRINT_SETTINGS },
      };
    }
    return this.forDevice(device.id);
  }

  async forDevice(deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: deviceSelect,
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');
    const { printSettings, ...info } = device;
    return {
      device: info,
      configured: !!printSettings,
      settings: publicPrintSettings(printSettings),
    };
  }

  async updateForDevice(
    deviceId: string,
    dto: UpdateDevicePrintSettingsDto,
    userId: string,
  ) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, code: true, name: true, printSettings: true },
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');

    const data = {
      ...(dto.directPrinting !== undefined
        ? { directPrinting: dto.directPrinting }
        : {}),
      ...(dto.browserFallback !== undefined
        ? { browserFallback: dto.browserFallback }
        : {}),
      ...(dto.autoPrintAfterSale !== undefined
        ? { autoPrintAfterSale: dto.autoPrintAfterSale }
        : {}),
      ...(dto.receiptPrinter !== undefined
        ? { receiptPrinter: cleanPrinter(dto.receiptPrinter) }
        : {}),
      ...(dto.receiptPaperWidth !== undefined
        ? { receiptPaperWidth: Number(dto.receiptPaperWidth) }
        : {}),
      ...(dto.receiptDirect !== undefined
        ? { receiptDirect: dto.receiptDirect }
        : {}),
      ...(dto.receiptCopies !== undefined
        ? { receiptCopies: dto.receiptCopies }
        : {}),
      ...(dto.documentPrinter !== undefined
        ? { documentPrinter: cleanPrinter(dto.documentPrinter) }
        : {}),
      ...(dto.documentPaperFormat !== undefined
        ? { documentPaperFormat: dto.documentPaperFormat }
        : {}),
      ...(dto.documentOrientation !== undefined
        ? { documentOrientation: dto.documentOrientation }
        : {}),
      ...(dto.documentCopies !== undefined
        ? { documentCopies: dto.documentCopies }
        : {}),
      ...(dto.dayReportTarget !== undefined
        ? { dayReportTarget: dto.dayReportTarget }
        : {}),
      updatedById: userId,
    };

    const row = await this.prisma.devicePrintSettings.upsert({
      where: { deviceId },
      create: { deviceId, ...data },
      update: data,
    });

    await this.audit.log({
      userId,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.DEVICES,
      entity: 'DevicePrintSettings',
      entityId: deviceId,
      description: `تحديث إعدادات الطباعة للجهاز ${device.code ?? device.name}`,
      oldData: (device.printSettings ??
        null) as unknown as Prisma.InputJsonValue,
      newData: row,
    });

    return this.forDevice(deviceId);
  }

  /**
   * Records a print submission. Never touches sales, cash or stock — a failed print
   * cannot affect a completed sale. Idempotent per client jobId (retries update the row).
   */
  async logJob(dto: LogPrintJobDto, user: JwtPayload) {
    const device = currentDevice();
    const register = device?.cashRegisterId
      ? await this.prisma.cashRegister.findUnique({
          where: { id: device.cashRegisterId },
          select: { id: true, name: true },
        })
      : null;

    const outcome = {
      status: dto.status,
      channel: dto.channel,
      errorCode: dto.errorCode ?? null,
      errorMessage: dto.errorMessage ?? null,
      printerName: dto.printerName ?? null,
      copies: dto.copies ?? 1,
    };

    return this.prisma.printJobLog.upsert({
      where: { jobId: dto.jobId },
      create: {
        jobId: dto.jobId,
        documentType: dto.documentType,
        documentRef: dto.documentRef ?? null,
        copyLabel: dto.copyLabel ?? null,
        isReprint: dto.isReprint ?? false,
        ...outcome,
        userId: user.sub,
        userName: user.username,
        deviceId: device?.id ?? null,
        deviceCode: device?.code ?? null,
        deviceName: device?.name ?? null,
        cashRegisterId: register?.id ?? null,
        cashRegisterName: register?.name ?? null,
      },
      update: outcome,
      select: { id: true, jobId: true, status: true, channel: true },
    });
  }

  listJobs(query: PrintJobQueryDto) {
    return this.prisma.printJobLog.findMany({
      where: {
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
        ...(query.documentType ? { documentType: query.documentType } : {}),
        ...(query.documentRef ? { documentRef: query.documentRef } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      take: query.limit ?? 50,
    });
  }
}
