import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceStatus, DeviceWorkspace, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import {
  DEVICE_INSTALLATION_HEADER,
  DEVICE_NAME_HEADER,
  DEVICE_WORKSPACE_HEADER,
  currentDevice,
  type WorkspaceHint,
} from './device-context';
import { ApproveDeviceDto, DeviceQueryDto, UpdateDeviceDto } from './dto/devices.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const devicePublicSelect = {
  id: true,
  code: true,
  name: true,
  workspace: true,
  status: true,
  location: true,
  notes: true,
  lastSeenAt: true,
  approvedAt: true,
  cashRegisterId: true,
  createdAt: true,
  cashRegister: { select: { id: true, code: true, name: true, isActive: true } },
  approvedBy: { select: { id: true, username: true, firstName: true, lastName: true } },
} as const;

function headerStr(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function parseWorkspaceHint(raw?: string): WorkspaceHint | null {
  const v = raw?.toLowerCase();
  if (v === 'mill' || v === 'sales' || v === 'hr') return v;
  return null;
}

@Injectable()
export class DevicesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  installationIdFromRequest(req: { headers?: Record<string, unknown> }): string | null {
    const raw = headerStr(req.headers?.[DEVICE_INSTALLATION_HEADER]);
    if (!raw || !UUID_RE.test(raw.trim())) return null;
    return raw.trim().toLowerCase();
  }

  workspaceHintFromRequest(req: { headers?: Record<string, unknown> }): WorkspaceHint | null {
    return parseWorkspaceHint(headerStr(req.headers?.[DEVICE_WORKSPACE_HEADER]));
  }

  async touchFromRequest(req: {
    headers?: Record<string, unknown>;
  }): Promise<Prisma.DeviceGetPayload<{ include: { cashRegister: true } }> | null> {
    const installationId = this.installationIdFromRequest(req);
    if (!installationId) return null;
    const hintedName = headerStr(req.headers?.[DEVICE_NAME_HEADER])?.trim();
    const workspaceHint = this.workspaceHintFromRequest(req);

    const existing = await this.prisma.device.findUnique({
      where: { installationId },
      include: { cashRegister: true },
    });
    if (existing) {
      return this.prisma.device.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
        include: { cashRegister: true },
      });
    }

    const defaultName =
      (hintedName && hintedName.slice(0, 80)) ||
      (workspaceHint === 'sales' ? 'صندوق بيع جديد' : 'جهاز جديد');

    return this.prisma.device.create({
      data: {
        installationId,
        name: defaultName,
        workspace: workspaceHint === 'sales' ? DeviceWorkspace.SALES : DeviceWorkspace.BOTH,
        status: DeviceStatus.PENDING,
        lastSeenAt: new Date(),
      },
      include: { cashRegister: true },
    });
  }

  async me() {
    const device = currentDevice();
    if (!device) return { device: null, registered: false };
    const full = await this.prisma.device.findUnique({
      where: { id: device.id },
      select: devicePublicSelect,
    });
    return { device: full, registered: true };
  }

  async list(query: DeviceQueryDto) {
    const where: Prisma.DeviceWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.workspace ? { workspace: query.workspace } : {}),
    };
    return this.prisma.device.findMany({
      where,
      select: {
        ...devicePublicSelect,
        _count: {
          select: {
            oilSales: true,
            oliveEntries: true,
            pressingRecords: true,
            payments: true,
            clients: true,
            sessions: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const device = await this.prisma.device.findUnique({
      where: { id },
      select: {
        ...devicePublicSelect,
        installationId: true,
        _count: {
          select: {
            oilSales: true,
            oliveEntries: true,
            pressingRecords: true,
            filtrationRecords: true,
            payments: true,
            clients: true,
            sessions: true,
            auditLogs: true,
          },
        },
      },
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');

    const [saleUsers, millUsers] = await Promise.all([
      this.prisma.oilSale.findMany({
        where: { deviceId: id },
        distinct: ['createdById'],
        select: {
          createdBy: { select: { id: true, username: true, firstName: true, lastName: true } },
        },
        take: 50,
      }),
      this.prisma.oliveEntry.findMany({
        where: { deviceId: id },
        distinct: ['userId'],
        select: {
          user: { select: { id: true, username: true, firstName: true, lastName: true } },
        },
        take: 50,
      }),
    ]);

    const users = new Map<string, { id: string; username: string; firstName: string | null; lastName: string | null }>();
    for (const row of saleUsers) users.set(row.createdBy.id, row.createdBy);
    for (const row of millUsers) users.set(row.user.id, row.user);

    return { ...device, users: [...users.values()] };
  }

  async approve(id: string, dto: ApproveDeviceDto, userId: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('الجهاز غير موجود');
    if (device.status === DeviceStatus.DISABLED) {
      throw new BadRequestException('الجهاز معطّل — أعد تفعيله أولاً');
    }

    const code = dto.code.trim().toUpperCase();
    this.assertCode(code);
    await this.assertCodeFree(code, id);

    if (
      (dto.workspace === DeviceWorkspace.SALES || dto.workspace === DeviceWorkspace.BOTH) &&
      !dto.cashRegisterId
    ) {
      throw new BadRequestException('يجب ربط جهاز البيع بصندوق نقدي');
    }
    if (dto.cashRegisterId) await this.assertRegister(dto.cashRegisterId);

    const updated = await this.prisma.device.update({
      where: { id },
      data: {
        code,
        name: dto.name.trim(),
        workspace: dto.workspace,
        status: DeviceStatus.ACTIVE,
        cashRegisterId: dto.cashRegisterId ?? null,
        location: dto.location?.trim() || null,
        notes: dto.notes?.trim() || null,
        approvedAt: new Date(),
        approvedById: userId,
      },
      select: devicePublicSelect,
    });

    await this.audit.log({
      userId,
      action: AUDIT_ACTIONS.VALIDATE,
      module: AUDIT_MODULES.DEVICES,
      entity: 'Device',
      entityId: id,
      description: `اعتماد الجهاز ${updated.code}`,
      oldData: device as unknown as Prisma.InputJsonValue,
      newData: updated as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async update(id: string, dto: UpdateDeviceDto, userId: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('الجهاز غير موجود');

    const code = dto.code ? dto.code.trim().toUpperCase() : undefined;
    if (code) {
      this.assertCode(code);
      await this.assertCodeFree(code, id);
    }
    if (dto.cashRegisterId) await this.assertRegister(dto.cashRegisterId);

    const workspace = dto.workspace ?? device.workspace;
    const registerId =
      dto.cashRegisterId === undefined ? device.cashRegisterId : dto.cashRegisterId;
    if (
      (workspace === DeviceWorkspace.SALES || workspace === DeviceWorkspace.BOTH) &&
      dto.status !== DeviceStatus.DISABLED &&
      dto.status !== DeviceStatus.PENDING &&
      (dto.status ?? device.status) === DeviceStatus.ACTIVE &&
      !registerId
    ) {
      throw new BadRequestException('يجب ربط جهاز البيع بصندوق نقدي');
    }

    const updated = await this.prisma.device.update({
      where: { id },
      data: {
        ...(code ? { code } : {}),
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.workspace ? { workspace: dto.workspace } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.cashRegisterId !== undefined ? { cashRegisterId: dto.cashRegisterId } : {}),
        ...(dto.location !== undefined ? { location: dto.location?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
      },
      select: devicePublicSelect,
    });

    await this.audit.log({
      userId,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.DEVICES,
      entity: 'Device',
      entityId: id,
      description: `تحديث الجهاز ${updated.code ?? updated.name}`,
      oldData: device as unknown as Prisma.InputJsonValue,
      newData: updated as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async setStatus(id: string, status: DeviceStatus, userId: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('الجهاز غير موجود');

    if (status === DeviceStatus.ACTIVE) {
      const workspace = device.workspace;
      if (
        (workspace === 'SALES' || workspace === 'BOTH') &&
        !device.cashRegisterId
      ) {
        throw new BadRequestException(
          'لا يمكن تفعيل جهاز البيع دون ربطه بصندوق نقدي. استخدم الموافقة/التعديل أولاً.',
        );
      }
      if (device.status === DeviceStatus.PENDING) {
        throw new BadRequestException('الجهاز معلّق — استخدم مسار الموافقة لتعيينه.');
      }
    }

    const updated = await this.prisma.device.update({
      where: { id },
      data: { status },
      select: devicePublicSelect,
    });
    await this.audit.log({
      userId,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.DEVICES,
      entity: 'Device',
      entityId: id,
      description:
        status === DeviceStatus.DISABLED
          ? `تعطيل الجهاز ${updated.code ?? updated.name}`
          : `تفعيل الجهاز ${updated.code ?? updated.name}`,
    });
    return updated;
  }

  /**
   * Deletes a device after detaching optional attributions.
   * Refuses when cash-register sessions still reference the device (required FK).
   */
  async remove(id: string, userId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id },
      include: {
        _count: { select: { sessions: true } },
      },
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');

    if (device._count.sessions > 0) {
      throw new BadRequestException(
        'لا يمكن حذف جهاز مرتبط بجلسات صندوق نقدي. عطّله بدلاً من الحذف للحفاظ على السجل.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await Promise.all([
        tx.oilSale.updateMany({ where: { deviceId: id }, data: { deviceId: null } }),
        tx.oliveEntry.updateMany({ where: { deviceId: id }, data: { deviceId: null } }),
        tx.pressingRecord.updateMany({ where: { deviceId: id }, data: { deviceId: null } }),
        tx.filtrationRecord.updateMany({ where: { deviceId: id }, data: { deviceId: null } }),
        tx.payment.updateMany({ where: { deviceId: id }, data: { deviceId: null } }),
        tx.client.updateMany({ where: { deviceId: id }, data: { deviceId: null } }),
        tx.auditLog.updateMany({ where: { deviceId: id }, data: { deviceId: null } }),
      ]);
      await tx.device.delete({ where: { id } });
    });

    await this.audit.log({
      userId,
      action: AUDIT_ACTIONS.DELETE,
      module: AUDIT_MODULES.DEVICES,
      entity: 'Device',
      entityId: id,
      description: `حذف الجهاز ${device.code ?? device.name}`,
      oldData: {
        id: device.id,
        code: device.code,
        name: device.name,
        workspace: device.workspace,
        status: device.status,
      } as Prisma.InputJsonValue,
    });

    return { deleted: true, id };
  }

  assertCanManage(workspace: 'mill' | 'sales' | 'any', perms: string[], role?: string) {
    if (role === 'ADMIN') return;
    const sales = perms.includes('OIL_SALES_DEVICES_MANAGE');
    const mill = perms.includes('MILL_DEVICES_MANAGE');
    if (workspace === 'sales' && !sales) throw new ForbiddenException();
    if (workspace === 'mill' && !mill) throw new ForbiddenException();
    if (workspace === 'any' && !sales && !mill) throw new ForbiddenException();
  }

  private assertCode(code: string) {
    if (!/^[A-Z0-9][A-Z0-9_-]{1,30}$/.test(code)) {
      throw new BadRequestException('رمز الجهاز غير صالح (مثال: VENTE-01)');
    }
  }

  private async assertCodeFree(code: string, exceptId: string) {
    const clash = await this.prisma.device.findFirst({
      where: { code, id: { not: exceptId } },
    });
    if (clash) throw new BadRequestException('رمز الجهاز مستخدم مسبقاً');
  }

  private async assertRegister(id: string) {
    const reg = await this.prisma.cashRegister.findUnique({ where: { id } });
    if (!reg || !reg.isActive) throw new BadRequestException('الصندوق غير موجود أو غير نشط');
  }
}
