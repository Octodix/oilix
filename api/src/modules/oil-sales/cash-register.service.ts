import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CashSessionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SeasonScopeService } from '../../common/season/season-scope.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import { RealtimeService } from '../realtime/realtime.service';
import { REALTIME_ENTITIES } from '../realtime/realtime.constants';
import { hasPermission } from '../../common/permissions/permission-catalog';
import {
  DEVICE_PENDING_MESSAGE,
  DEVICE_REQUIRED_MESSAGE,
  currentDevice,
} from '../devices/device-context';
import {
  cashVarianceLabel,
  computeCashDifference,
  computeExpectedCash,
} from './cash-session.math';
import type {
  CashAdjustDto,
  CashSessionQueryDto,
  CloseCashSessionDto,
  OpenCashSessionDto,
} from '../devices/dto/devices.dto';

const userSelect = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
} as const;

function num(n: number | string | Prisma.Decimal | null | undefined): number {
  if (n == null) return 0;
  return Number(n);
}

@Injectable()
export class CashRegisterService {
  constructor(
    private prisma: PrismaService,
    private seasonScope: SeasonScopeService,
    private audit: AuditService,
    private realtime: RealtimeService,
  ) {}

  listRegisters(includeInactive = false) {
    return this.prisma.cashRegister.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async createRegister(
    dto: { code: string; name: string; sortOrder?: number; notes?: string },
    userId: string,
  ) {
    const code = dto.code.trim().toUpperCase();
    const name = dto.name.trim();
    const existing = await this.prisma.cashRegister.findUnique({ where: { code } });
    if (existing) throw new BadRequestException('رمز الصندوق مستخدم مسبقاً');

    const row = await this.prisma.cashRegister.create({
      data: {
        code,
        name,
        sortOrder: dto.sortOrder ?? 0,
        notes: dto.notes?.trim() || null,
      },
    });
    await this.audit.log({
      userId,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.CASH,
      entity: 'CashRegister',
      entityId: row.id,
      description: `إنشاء صندوق ${row.code}`,
      newData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  async updateRegister(
    id: string,
    dto: {
      code?: string;
      name?: string;
      sortOrder?: number;
      notes?: string | null;
      isActive?: boolean;
    },
    userId: string,
  ) {
    const existing = await this.prisma.cashRegister.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('الصندوق غير موجود');

    if (dto.code != null) {
      const code = dto.code.trim().toUpperCase();
      if (code !== existing.code) {
        const clash = await this.prisma.cashRegister.findUnique({ where: { code } });
        if (clash) throw new BadRequestException('رمز الصندوق مستخدم مسبقاً');
      }
    }

    const row = await this.prisma.cashRegister.update({
      where: { id },
      data: {
        code: dto.code != null ? dto.code.trim().toUpperCase() : undefined,
        name: dto.name != null ? dto.name.trim() : undefined,
        sortOrder: dto.sortOrder,
        notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
        isActive: dto.isActive,
      },
    });
    await this.audit.log({
      userId,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.CASH,
      entity: 'CashRegister',
      entityId: row.id,
      description: `تعديل صندوق ${row.code}`,
      oldData: existing as unknown as Prisma.InputJsonValue,
      newData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  /** Sales device must be approved; cash register link is optional. */
  requireSalesDevice(opts?: { requireCashRegister?: boolean }) {
    const device = currentDevice();
    if (!device) throw new ForbiddenException(DEVICE_REQUIRED_MESSAGE);
    if (device.status === 'DISABLED') {
      throw new ForbiddenException('هذا الجهاز غير مصرّح له بتنفيذ العمليات.');
    }
    if (device.status === 'PENDING') throw new ForbiddenException(DEVICE_PENDING_MESSAGE);
    // Workspace access is via user permissions (OIL_SALES_ACCESS), not Device.workspace.
    if (opts?.requireCashRegister !== false && !device.cashRegisterId) {
      throw new BadRequestException('هذا الجهاز غير مربوط بصندوق نقدي.');
    }
    return device;
  }

  async current(user: { sub: string; permissions: string[]; role?: string }) {
    const device = currentDevice();
    const seasonId = await this.seasonScope.getSeasonId();
    const registerId = device?.cashRegisterId ?? null;
    const session = registerId
      ? await this.prisma.cashRegisterSession.findFirst({
          where: { cashRegisterId: registerId, status: CashSessionStatus.OPEN, seasonId },
          include: {
            cashRegister: true,
            device: { select: { id: true, code: true, name: true } },
            openedBy: { select: userSelect },
          },
        })
      : null;

    return {
      device: device
        ? {
            id: device.id,
            code: device.code,
            name: device.name,
            status: device.status,
            workspace: device.workspace,
            cashRegisterId: device.cashRegisterId,
          }
        : null,
      register: session?.cashRegister ?? (registerId
        ? await this.prisma.cashRegister.findUnique({ where: { id: registerId } })
        : null),
      session: session ? this.presentSession(session, user) : null,
    };
  }

  async open(dto: OpenCashSessionDto, user: { sub: string; permissions: string[]; role?: string }) {
    const device = this.requireSalesDevice();
    const seasonId = await this.seasonScope.getSeasonId();
    const registerId = device.cashRegisterId!;

    const session = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash-open:${registerId}`}))`;
      const existing = await tx.cashRegisterSession.findFirst({
        where: { cashRegisterId: registerId, status: CashSessionStatus.OPEN },
      });
      if (existing) {
        if (existing.seasonId === seasonId) {
          throw new BadRequestException('يوجد صندوق مفتوح مسبقاً على هذا الجهاز. أغلقه أولاً.');
        }
        // Stale OPEN from another season would block sales forever — auto-close at expected cash.
        const expected = computeExpectedCash({
          openingCash: num(existing.openingCash),
          cashSales: num(existing.cashSales),
          cashRefunds: num(existing.cashRefunds),
          cashIn: num(existing.cashIn),
          cashOut: num(existing.cashOut),
        });
        await tx.cashRegisterSession.update({
          where: { id: existing.id },
          data: {
            status: CashSessionStatus.CLOSED,
            closedAt: new Date(),
            closedById: user.sub,
            expectedCash: expected,
            physicalCash: expected,
            difference: 0,
            closingNote: 'إغلاق تلقائي — جلسة موسم سابق عند فتح صندوق الموسم الحالي',
          },
        });
      }
      const register = await tx.cashRegister.findUnique({ where: { id: registerId } });
      if (!register?.isActive) throw new BadRequestException('الصندوق غير نشط');

      return tx.cashRegisterSession.create({
        data: {
          seasonId,
          cashRegisterId: registerId,
          deviceId: device.id,
          openedById: user.sub,
          openingCash: dto.openingCash,
          openingNote: dto.note?.trim() || null,
        },
        include: {
          cashRegister: true,
          device: { select: { id: true, code: true, name: true } },
          openedBy: { select: userSelect },
        },
      });
    });

    await this.audit.log({
      userId: user.sub,
      action: AUDIT_ACTIONS.START,
      module: AUDIT_MODULES.CASH,
      entity: 'CashRegisterSession',
      entityId: session.id,
      description: `فتح الصندوق ${session.cashRegister.code}`,
      newData: { openingCash: dto.openingCash } as Prisma.InputJsonValue,
    });
    this.emitCash(seasonId, user.sub, session.id);
    return this.presentSession(session, user);
  }

  async close(dto: CloseCashSessionDto, user: { sub: string; permissions: string[]; role?: string }) {
    const device = this.requireSalesDevice();
    const seasonId = await this.seasonScope.getSeasonId();
    const registerId = device.cashRegisterId!;

    const closed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash-open:${registerId}`}))`;
      const session = await tx.cashRegisterSession.findFirst({
        where: { cashRegisterId: registerId, status: CashSessionStatus.OPEN, seasonId },
      });
      if (!session) throw new BadRequestException('لا يوجد صندوق مفتوح للإغلاق');

      const expected = computeExpectedCash({
        openingCash: num(session.openingCash),
        cashSales: num(session.cashSales),
        cashRefunds: num(session.cashRefunds),
        cashIn: num(session.cashIn),
        cashOut: num(session.cashOut),
      });
      const physical = Number(dto.physicalCash);
      const difference = computeCashDifference(physical, expected);

      return tx.cashRegisterSession.update({
        where: { id: session.id },
        data: {
          status: CashSessionStatus.CLOSED,
          closedAt: new Date(),
          closedById: user.sub,
          expectedCash: expected,
          physicalCash: physical,
          difference,
          closingNote: dto.note?.trim() || null,
        },
        include: {
          cashRegister: true,
          device: { select: { id: true, code: true, name: true } },
          openedBy: { select: userSelect },
          closedBy: { select: userSelect },
        },
      });
    });

    await this.audit.log({
      userId: user.sub,
      action: AUDIT_ACTIONS.VALIDATE,
      module: AUDIT_MODULES.CASH,
      entity: 'CashRegisterSession',
      entityId: closed.id,
      description: `إغلاق الصندوق ${closed.cashRegister.code} (فرق ${num(closed.difference)} د.ج)`,
      newData: {
        expectedCash: num(closed.expectedCash),
        physicalCash: num(closed.physicalCash),
        difference: num(closed.difference),
        variance: cashVarianceLabel(num(closed.difference)),
      } as Prisma.InputJsonValue,
    });
    this.emitCash(seasonId, user.sub, closed.id);
    return this.presentSession(closed, user);
  }

  async adjust(dto: CashAdjustDto, user: { sub: string; permissions: string[]; role?: string }) {
    const device = this.requireSalesDevice();
    const seasonId = await this.seasonScope.getSeasonId();
    const registerId = device.cashRegisterId!;

    const session = await this.prisma.$transaction(async (tx) => {
      const open = await tx.cashRegisterSession.findFirst({
        where: { cashRegisterId: registerId, status: CashSessionStatus.OPEN, seasonId },
      });
      if (!open) throw new BadRequestException('يجب فتح الصندوق أولاً');
      await tx.$queryRaw`SELECT id FROM cash_register_sessions WHERE id = ${open.id} FOR UPDATE`;
      const data =
        dto.direction === 'IN'
          ? { cashIn: { increment: dto.amount } }
          : { cashOut: { increment: dto.amount } };
      return tx.cashRegisterSession.update({
        where: { id: open.id },
        data,
        include: {
          cashRegister: true,
          device: { select: { id: true, code: true, name: true } },
          openedBy: { select: userSelect },
        },
      });
    });

    await this.audit.log({
      userId: user.sub,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.CASH,
      entity: 'CashRegisterSession',
      entityId: session.id,
      description: `${dto.direction === 'IN' ? 'دخل نقدي' : 'خرج نقدي'} ${dto.amount} د.ج`,
    });
    this.emitCash(seasonId, user.sub, session.id);
    return this.presentSession(session, user);
  }

  async listSessions(
    query: CashSessionQueryDto,
    user: { sub: string; permissions: string[]; role?: string },
  ) {
    const seasonId = await this.seasonScope.getSeasonId();
    const canAll = hasPermission(user.permissions, 'OIL_SALES_CASH_REGISTER_VIEW_ALL', user.role);
    const device = currentDevice();
    const where: Prisma.CashRegisterSessionWhereInput = { seasonId };
    if (!canAll) {
      if (device?.cashRegisterId) where.cashRegisterId = device.cashRegisterId;
      else where.openedById = user.sub;
    } else {
      if (query.cashRegisterId) where.cashRegisterId = query.cashRegisterId;
      if (query.deviceId) where.deviceId = query.deviceId;
      if (query.userId) where.openedById = query.userId;
    }
    if (query.status) where.status = query.status;

    const items = await this.prisma.cashRegisterSession.findMany({
      where,
      include: {
        cashRegister: true,
        device: { select: { id: true, code: true, name: true } },
        openedBy: { select: userSelect },
        closedBy: { select: userSelect },
      },
      orderBy: { openedAt: 'desc' },
      take: 200,
    });
    return items.map((s) => this.presentSession(s, user));
  }

  async findSession(id: string, user: { sub: string; permissions: string[]; role?: string }) {
    const seasonId = await this.seasonScope.getSeasonId();
    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { id, seasonId },
      include: {
        cashRegister: true,
        device: { select: { id: true, code: true, name: true } },
        openedBy: { select: userSelect },
        closedBy: { select: userSelect },
      },
    });
    if (!session) throw new NotFoundException('جلسة الصندوق غير موجودة');
    const canAll = hasPermission(user.permissions, 'OIL_SALES_CASH_REGISTER_VIEW_ALL', user.role);
    const device = currentDevice();
    if (!canAll) {
      const ownRegister = device?.cashRegisterId;
      const isOpener = session.openedById === user.sub;
      if (ownRegister) {
        if (session.cashRegisterId !== ownRegister) throw new ForbiddenException();
      } else if (!isOpener) {
        throw new ForbiddenException();
      }
    }
    return this.presentSession(session, user);
  }

  presentSession(
    session: {
      openingCash: Prisma.Decimal | number;
      cashSales: Prisma.Decimal | number;
      cashRefunds: Prisma.Decimal | number;
      cashIn: Prisma.Decimal | number;
      cashOut: Prisma.Decimal | number;
      expectedCash: Prisma.Decimal | number | null;
      physicalCash: Prisma.Decimal | number | null;
      difference: Prisma.Decimal | number | null;
      status: CashSessionStatus;
    } & Record<string, unknown>,
    user: { permissions?: string[]; role?: string },
  ) {
    const openingCash = num(session.openingCash);
    const cashSales = num(session.cashSales);
    const cashRefunds = num(session.cashRefunds);
    const cashIn = num(session.cashIn);
    const cashOut = num(session.cashOut);
    const expected =
      session.expectedCash == null
        ? computeExpectedCash({ openingCash, cashSales, cashRefunds, cashIn, cashOut })
        : num(session.expectedCash);
    const canDiff = hasPermission(
      user.permissions,
      'OIL_SALES_CASH_REGISTER_VIEW_DIFFERENCES',
      user.role,
    ) || hasPermission(user.permissions, 'OIL_SALES_CASH_REGISTER_VIEW_ALL', user.role)
      || user.role === 'ADMIN'
      || session.status === CashSessionStatus.OPEN;

    const difference =
      session.difference == null
        ? session.physicalCash == null
          ? null
          : computeCashDifference(num(session.physicalCash), expected)
        : num(session.difference);

    return {
      ...session,
      openingCash,
      cashSales,
      cashRefunds,
      cashIn,
      cashOut,
      expectedCash: expected,
      physicalCash: session.physicalCash == null ? null : num(session.physicalCash),
      difference: canDiff ? difference : null,
      variance: canDiff && difference != null ? cashVarianceLabel(difference) : null,
    };
  }

  private emitCash(seasonId: string, actorId: string, entityId: string) {
    this.realtime.emit({
      entity: REALTIME_ENTITIES.CASH_SESSION,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.CASH,
      seasonId,
      actorId,
      entityId,
    });
  }
}
