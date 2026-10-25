import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MillAssistanceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SeasonScopeService } from '../../common/season/season-scope.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import { hasPermission } from '../../common/permissions/permission-catalog';
import { currentDevice } from '../devices/device-context';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  ASSISTANCE_ERROR_AR,
  checkHandover,
  computeSessionTotals,
  isCashMethod,
  roundMoney,
  statusAfterClose,
  statusAfterConfirm,
  type SessionOperation,
  type SessionPayment,
} from './mill-assistance.math';
import {
  CloseAssistanceDto,
  ConfirmHandoverDto,
  ResolveDiscrepancyDto,
  StartAssistanceDto,
} from './dto/mill-assistance.dto';

const num = (v: Prisma.Decimal | number | string | null | undefined) => Number(v ?? 0);
const dec = (n: number) => new Prisma.Decimal(roundMoney(n));

function fullName(u: { firstName?: string | null; lastName?: string | null; username: string }) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;
}

const userSelect = { id: true, username: true, firstName: true, lastName: true } as const;

const sessionInclude = {
  primaryOperator: { select: userSelect },
  assistant: { select: userSelect },
  confirmedBy: { select: userSelect },
  resolvedBy: { select: userSelect },
  assistantDevice: { select: { id: true, code: true, name: true } },
  primaryDevice: { select: { id: true, code: true, name: true } },
} satisfies Prisma.MillAssistanceSessionInclude;

type SessionRow = Prisma.MillAssistanceSessionGetPayload<{ include: typeof sessionInclude }>;

const OPEN_STATUSES: MillAssistanceStatus[] = ['ACTIVE', 'AWAITING_CONFIRMATION', 'DISCREPANCY'];

/**
 * Operator-assistance sessions for the olive press (مساعدة المشغّل الرئيسي).
 * Payments are attached to the assistant's ACTIVE session when they are recorded; the
 * session never creates money. Closing freezes the totals; the primary operator confirms
 * what was physically received. Confirmed sessions are immutable except through `resolve`.
 */
@Injectable()
export class MillAssistanceService {
  constructor(
    private prisma: PrismaService,
    private seasonScope: SeasonScopeService,
    private audit: AuditService,
  ) {}

  // ─── Attachment hooks used by payments / pressing ─────────────────────────

  /** The caller's ACTIVE session id, or null. Cheap: one indexed lookup. */
  async activeSessionIdFor(userId: string): Promise<string | null> {
    const s = await this.prisma.millAssistanceSession.findFirst({
      where: { assistantId: userId, status: 'ACTIVE' },
      select: { id: true },
    });
    return s?.id ?? null;
  }

  // ─── Assistant side ───────────────────────────────────────────────────────

  async start(dto: StartAssistanceDto, user: JwtPayload) {
    if (dto.primaryOperatorId === user.sub) {
      throw new BadRequestException('لا يمكنك مساعدة نفسك — اختر المشغّل الرئيسي');
    }
    const [seasonId, primary, assistant, existing] = await Promise.all([
      this.seasonScope.getSeasonId(),
      this.prisma.user.findFirst({
        where: { id: dto.primaryOperatorId, isActive: true, deletedAt: null },
        select: userSelect,
      }),
      this.prisma.user.findFirst({ where: { id: user.sub, deletedAt: null }, select: userSelect }),
      this.prisma.millAssistanceSession.findFirst({ where: { assistantId: user.sub, status: 'ACTIVE' } }),
    ]);
    if (!primary) throw new NotFoundException('المشغّل الرئيسي غير موجود أو غير نشط');
    if (!assistant) throw new NotFoundException('المستخدم غير موجود');
    if (existing) {
      throw new BadRequestException(`لديك جلسة مساعدة نشطة بالفعل (#${existing.sessionNumber}) — أغلقها أولاً`);
    }
    const device = currentDevice();

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mill-assist:${seasonId}`}))`;
      const last = await tx.millAssistanceSession.findFirst({
        where: { seasonId },
        orderBy: { sessionNumber: 'desc' },
        select: { sessionNumber: true },
      });
      return tx.millAssistanceSession.create({
        data: {
          seasonId,
          sessionNumber: (last?.sessionNumber ?? 0) + 1,
          primaryOperatorId: primary.id,
          primaryOperatorName: fullName(primary),
          assistantId: assistant.id,
          assistantName: fullName(assistant),
          assistantDeviceId: device?.id ?? null,
          assistantDeviceName: device?.name ?? device?.code ?? null,
          notes: dto.notes?.trim() || null,
        },
        include: sessionInclude,
      });
    });

    await this.audit.log({
      userId: user.sub,
      action: AUDIT_ACTIONS.START,
      module: AUDIT_MODULES.PAYMENTS,
      entity: 'MillAssistanceSession',
      entityId: row.id,
      description: `بدأ جلسة مساعدة #${row.sessionNumber} للمشغّل ${row.primaryOperatorName}`,
    });
    return this.present(row, await this.liveTotals(row.id));
  }

  /** The caller's own view: active session (live totals) and their sessions still open. */
  async mine(user: JwtPayload) {
    const seasonId = await this.seasonScope.getSeasonId();
    const rows = await this.prisma.millAssistanceSession.findMany({
      where: { seasonId, assistantId: user.sub, status: { in: OPEN_STATUSES } },
      include: sessionInclude,
      orderBy: { startedAt: 'desc' },
    });
    const active = rows.find((r) => r.status === 'ACTIVE') ?? null;
    return {
      active: active ? this.present(active, await this.liveTotals(active.id)) : null,
      pending: rows.filter((r) => r.status !== 'ACTIVE').map((r) => this.present(r)),
    };
  }

  /** Users an assistant may help: active users other than the caller. */
  async primaryCandidates(user: JwtPayload) {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null, id: { not: user.sub } },
      select: { ...userSelect, role: { select: { name: true, nameAr: true } } },
      orderBy: [{ firstName: 'asc' }, { username: 'asc' }],
    });
    return users.map((u) => ({ id: u.id, name: fullName(u), username: u.username, role: u.role.nameAr }));
  }

  async close(id: string, dto: CloseAssistanceDto, user: JwtPayload) {
    const row = await this.getRow(id);
    if (row.assistantId !== user.sub && !hasPermission(user.permissions, 'MILL_ASSIST_VIEW_ALL', user.role)) {
      throw new ForbiddenException('هذه الجلسة ليست جلستك');
    }
    if (row.status !== 'ACTIVE') throw new BadRequestException(ASSISTANCE_ERROR_AR.SESSION_ALREADY_CLOSED);

    const totals = await this.liveTotals(id);
    let check;
    try {
      check = checkHandover(totals.expectedHandover, dto.declaredHandover);
    } catch (e) {
      throw new BadRequestException(ASSISTANCE_ERROR_AR[(e as Error).message] ?? 'مبلغ غير صالح');
    }
    if (!check.balanced && !dto.discrepancyNote?.trim()) {
      throw new BadRequestException(ASSISTANCE_ERROR_AR.DISCREPANCY_NOTE_REQUIRED);
    }

    const updated = await this.prisma.millAssistanceSession.update({
      where: { id },
      data: {
        status: statusAfterClose(),
        closedAt: new Date(),
        operationsCount: totals.operationsCount,
        paymentsCount: totals.paymentsCount,
        totalCharged: dec(totals.totalCharged),
        totalCollected: dec(totals.totalCollected),
        totalCash: dec(totals.totalCash),
        totalNonCash: dec(totals.totalNonCash),
        totalOutstanding: dec(totals.totalOutstanding),
        expectedHandover: dec(totals.expectedHandover),
        declaredHandover: dec(check.declared),
        difference: dec(check.difference),
        discrepancyNote: dto.discrepancyNote?.trim() || null,
      },
      include: sessionInclude,
    });
    await this.audit.log({
      userId: user.sub,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.PAYMENTS,
      entity: 'MillAssistanceSession',
      entityId: id,
      description: `أغلق جلسة المساعدة #${row.sessionNumber}: المتوقع ${totals.expectedHandover} دج، المصرّح ${check.declared} دج${check.balanced ? '' : ` (فرق ${check.difference} دج)`}`,
      newData: { ...totals, declared: check.declared, difference: check.difference } as Prisma.InputJsonValue,
    });
    return this.present(updated);
  }

  // ─── Primary operator side ────────────────────────────────────────────────

  async confirm(id: string, dto: ConfirmHandoverDto, user: JwtPayload) {
    const row = await this.getRow(id);
    if (row.assistantId === user.sub) throw new ForbiddenException(ASSISTANCE_ERROR_AR.SELF_CONFIRM_FORBIDDEN);
    if (row.primaryOperatorId !== user.sub && !hasPermission(user.permissions, 'MILL_ASSIST_VIEW_ALL', user.role)) {
      throw new ForbiddenException('فقط المشغّل الرئيسي لهذه الجلسة يمكنه تأكيد الاستلام');
    }
    if (row.status !== 'AWAITING_CONFIRMATION') {
      throw new BadRequestException(
        row.status === 'ACTIVE' ? 'المساعد لم يغلق الجلسة بعد' : ASSISTANCE_ERROR_AR.SESSION_LOCKED,
      );
    }
    const expected = num(row.expectedHandover);
    const r = statusAfterConfirm(expected, dto.receivedHandover);
    if (r.status === 'DISCREPANCY' && !dto.note?.trim()) {
      throw new BadRequestException(ASSISTANCE_ERROR_AR.DISCREPANCY_NOTE_REQUIRED);
    }
    const primaryDevice = currentDevice();
    const updated = await this.prisma.millAssistanceSession.update({
      where: { id },
      data: {
        status: r.status,
        confirmedAt: new Date(),
        confirmedById: user.sub,
        // The main workstation is the one the primary operator confirms from.
        ...(primaryDevice ? { primaryDeviceId: primaryDevice.id } : {}),
        receivedHandover: dec(dto.receivedHandover),
        difference: dec(r.difference),
        ...(dto.note?.trim() ? { discrepancyNote: dto.note.trim() } : {}),
      },
      include: sessionInclude,
    });
    await this.audit.log({
      userId: user.sub,
      action: AUDIT_ACTIONS.VALIDATE,
      module: AUDIT_MODULES.PAYMENTS,
      entity: 'MillAssistanceSession',
      entityId: id,
      description:
        r.status === 'CONFIRMED'
          ? `أكّد استلام ${roundMoney(dto.receivedHandover)} دج من ${row.assistantName} (جلسة #${row.sessionNumber})`
          : `سجّل فرقاً في تسليم الجلسة #${row.sessionNumber}: المتوقع ${expected} دج، المستلم ${roundMoney(dto.receivedHandover)} دج`,
      newData: { expected, received: roundMoney(dto.receivedHandover), difference: r.difference } as Prisma.InputJsonValue,
    });
    return this.present(updated);
  }

  async resolve(id: string, dto: ResolveDiscrepancyDto, user: JwtPayload) {
    const row = await this.getRow(id);
    if (row.assistantId === user.sub) throw new ForbiddenException(ASSISTANCE_ERROR_AR.SELF_CONFIRM_FORBIDDEN);
    if (row.status !== 'DISCREPANCY') throw new BadRequestException('لا يوجد فرق لتسويته في هذه الجلسة');
    const updated = await this.prisma.millAssistanceSession.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        resolvedAt: new Date(),
        resolvedById: user.sub,
        resolutionNote: dto.resolutionNote.trim(),
      },
      include: sessionInclude,
    });
    await this.audit.log({
      userId: user.sub,
      action: AUDIT_ACTIONS.UPDATE,
      module: AUDIT_MODULES.PAYMENTS,
      entity: 'MillAssistanceSession',
      entityId: id,
      description: `سوّى فرق التسليم للجلسة #${row.sessionNumber} (${num(row.difference)} دج): ${dto.resolutionNote.trim()}`,
    });
    return this.present(updated);
  }

  /** Primary operator overview for the current season. */
  async dashboard(user: JwtPayload) {
    const seasonId = await this.seasonScope.getSeasonId();
    const seeAll = hasPermission(user.permissions, 'MILL_ASSIST_VIEW_ALL', user.role);
    const where: Prisma.MillAssistanceSessionWhereInput = {
      seasonId,
      ...(seeAll ? {} : { primaryOperatorId: user.sub }),
    };
    const rows = await this.prisma.millAssistanceSession.findMany({
      where,
      include: sessionInclude,
      orderBy: { startedAt: 'desc' },
      take: 200,
    });
    const active = rows.filter((r) => r.status === 'ACTIVE');
    const activeWithTotals = await Promise.all(
      active.map(async (r) => this.present(r, await this.liveTotals(r.id))),
    );
    const awaiting = rows.filter((r) => r.status === 'AWAITING_CONFIRMATION').map((r) => this.present(r));
    const discrepancies = rows.filter((r) => r.status === 'DISCREPANCY').map((r) => this.present(r));
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const confirmedToday = rows
      .filter((r) => r.status === 'CONFIRMED' && r.confirmedAt && r.confirmedAt >= dayStart)
      .map((r) => this.present(r));
    const sum = (list: Array<{ totals: { totalCollected: number; expectedHandover: number } }>, k: 'totalCollected' | 'expectedHandover') =>
      roundMoney(list.reduce((s, x) => s + x.totals[k], 0));
    return {
      active: activeWithTotals,
      awaiting,
      discrepancies,
      confirmedToday,
      summary: {
        activeCount: active.length,
        awaitingCount: awaiting.length,
        discrepancyCount: discrepancies.length,
        collectedByActiveAssistants: sum(activeWithTotals, 'totalCollected'),
        cashHeldByActiveAssistants: sum(activeWithTotals, 'expectedHandover'),
        cashAwaitingConfirmation: sum(awaiting, 'expectedHandover'),
        cashConfirmedToday: roundMoney(confirmedToday.reduce((s, x) => s + Number(x.receivedHandover ?? 0), 0)),
      },
    };
  }

  async list(user: JwtPayload, status?: MillAssistanceStatus, range?: { from?: string; to?: string }) {
    const seasonId = await this.seasonScope.getSeasonId();
    const seeAll = hasPermission(user.permissions, 'MILL_ASSIST_VIEW_ALL', user.role);
    const startedAt: Prisma.DateTimeFilter = {};
    if (range?.from && /^\d{4}-\d{2}-\d{2}$/.test(range.from)) startedAt.gte = new Date(`${range.from}T00:00:00`);
    if (range?.to && /^\d{4}-\d{2}-\d{2}$/.test(range.to)) startedAt.lte = new Date(`${range.to}T23:59:59.999`);
    const rows = await this.prisma.millAssistanceSession.findMany({
      where: {
        seasonId,
        ...(status ? { status } : {}),
        ...(Object.keys(startedAt).length ? { startedAt } : {}),
        ...(seeAll ? {} : { OR: [{ primaryOperatorId: user.sub }, { assistantId: user.sub }] }),
      },
      include: sessionInclude,
      orderBy: { startedAt: 'desc' },
      take: 300,
    });
    return rows.map((r) => this.present(r));
  }

  /** Full detail with the operation list; live totals while ACTIVE, frozen ones afterwards. */
  async detail(id: string, user: JwtPayload) {
    const row = await this.getRow(id);
    this.assertCanView(row, user);
    const ops = await this.operations(id);
    return {
      ...this.present(row, row.status === 'ACTIVE' ? await this.liveTotals(id) : undefined),
      operations: ops,
    };
  }

  /** Payload of the printable handover receipt (وصل تسليم المداخيل). */
  async receipt(id: string, user: JwtPayload) {
    const row = await this.getRow(id);
    this.assertCanView(row, user);
    const [ops, settings] = await Promise.all([
      this.operations(id),
      this.prisma.setting.findMany({ where: { key: { in: ['company_name', 'company_phone', 'company_address'] } } }),
    ]);
    const map = Object.fromEntries(settings.map((s) => [s.key, typeof s.value === 'string' ? s.value : '']));
    return {
      session: this.present(row, row.status === 'ACTIVE' ? await this.liveTotals(id) : undefined),
      operations: ops,
      company: {
        name: map.company_name || 'معصرة الزيتون',
        phone: map.company_phone || '',
        address: map.company_address || '',
      },
      printedAt: new Date().toISOString(),
      printedBy: user.username,
    };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async getRow(id: string): Promise<SessionRow> {
    const row = await this.prisma.millAssistanceSession.findUnique({ where: { id }, include: sessionInclude });
    if (!row) throw new NotFoundException('جلسة المساعدة غير موجودة');
    return row;
  }

  private assertCanView(row: SessionRow, user: JwtPayload) {
    if (row.assistantId === user.sub || row.primaryOperatorId === user.sub) return;
    if (hasPermission(user.permissions, 'MILL_ASSIST_VIEW_ALL', user.role)) return;
    throw new ForbiddenException('ليس لديك صلاحية عرض هذه الجلسة');
  }

  /** Payments collected in the session + operations recorded in it, with the customer. */
  private async operationRows(sessionId: string) {
    const [payments, records] = await Promise.all([
      this.prisma.payment.findMany({
        where: { assistanceSessionId: sessionId },
        include: {
          pressingRecord: {
            include: { payments: true, oliveEntry: { include: { client: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.pressingRecord.findMany({
        where: { assistanceSessionId: sessionId },
        include: { payments: true, oliveEntry: { include: { client: true } } },
      }),
    ]);
    return { payments, records };
  }

  private async liveTotals(sessionId: string) {
    const { payments, records } = await this.operationRows(sessionId);
    const byId = new Map<string, SessionOperation>();
    const opOf = (pr: { id: string; amount: Prisma.Decimal; payments: Array<{ amount: Prisma.Decimal }> }) => ({
      pressingRecordId: pr.id,
      amountDue: num(pr.amount),
      paidTotal: roundMoney(pr.payments.reduce((s, p) => s + num(p.amount), 0)),
    });
    for (const r of records) byId.set(r.id, opOf(r));
    for (const p of payments) byId.set(p.pressingRecord.id, opOf(p.pressingRecord));
    const sessionPayments: SessionPayment[] = payments.map((p) => ({
      id: p.id,
      amount: num(p.amount),
      method: p.method,
      pressingRecordId: p.pressingRecordId,
    }));
    return computeSessionTotals(sessionPayments, [...byId.values()]);
  }

  private async operations(sessionId: string) {
    const { payments, records } = await this.operationRows(sessionId);
    type Op = {
      pressingRecordId: string;
      reference: number;
      clientName: string;
      clientPhone: string | null;
      oliveType: string;
      recordedAt: Date;
      recordedHere: boolean;
      amountDue: number;
      paidTotal: number;
      collectedInSession: number;
      collectedCashInSession: number;
      outstanding: number;
      payments: Array<{ id: string; amount: number; method: string | null; at: Date; time: string }>;
    };
    const byId = new Map<string, Op>();
    const base = (
      pr: (typeof records)[number] | (typeof payments)[number]['pressingRecord'],
      recordedHere: boolean,
    ): Op => {
      const c = pr.oliveEntry.client;
      const paidTotal = roundMoney(pr.payments.reduce((s, p) => s + num(p.amount), 0));
      return {
        pressingRecordId: pr.id,
        reference: pr.oliveEntry.referenceNumber,
        clientName: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || '—',
        clientPhone: c.phone ?? null,
        oliveType: pr.oliveEntry.oliveType,
        recordedAt: pr.createdAt,
        recordedHere,
        amountDue: num(pr.amount),
        paidTotal,
        collectedInSession: 0,
        collectedCashInSession: 0,
        outstanding: roundMoney(Math.max(0, num(pr.amount) - paidTotal)),
        payments: [],
      };
    };
    for (const r of records) byId.set(r.id, base(r, true));
    for (const p of payments) {
      const op = byId.get(p.pressingRecordId) ?? base(p.pressingRecord, false);
      op.collectedInSession = roundMoney(op.collectedInSession + num(p.amount));
      if (isCashMethod(p.method)) op.collectedCashInSession = roundMoney(op.collectedCashInSession + num(p.amount));
      op.payments.push({ id: p.id, amount: num(p.amount), method: p.method, at: p.createdAt, time: p.paymentTime });
      byId.set(p.pressingRecordId, op);
    }
    return [...byId.values()].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  }

  private present(row: SessionRow, live?: ReturnType<typeof computeSessionTotals>) {
    const totals = live ?? {
      operationsCount: row.operationsCount,
      paymentsCount: row.paymentsCount,
      totalCharged: num(row.totalCharged),
      totalCollected: num(row.totalCollected),
      totalCash: num(row.totalCash),
      totalNonCash: num(row.totalNonCash),
      totalOutstanding: num(row.totalOutstanding),
      expectedHandover: num(row.expectedHandover),
    };
    return {
      id: row.id,
      sessionNumber: row.sessionNumber,
      reference: `AS-${String(row.sessionNumber).padStart(5, '0')}`,
      status: row.status,
      primaryOperator: { id: row.primaryOperatorId, name: row.primaryOperatorName ?? fullName(row.primaryOperator) },
      assistant: { id: row.assistantId, name: row.assistantName ?? fullName(row.assistant) },
      assistantDevice: row.assistantDevice
        ? { id: row.assistantDevice.id, name: row.assistantDevice.name, code: row.assistantDevice.code }
        : row.assistantDeviceName
          ? { id: null, name: row.assistantDeviceName, code: null }
          : null,
      startedAt: row.startedAt,
      closedAt: row.closedAt,
      totals,
      declaredHandover: row.declaredHandover == null ? null : num(row.declaredHandover),
      receivedHandover: row.receivedHandover == null ? null : num(row.receivedHandover),
      difference: num(row.difference),
      discrepancyNote: row.discrepancyNote,
      confirmedAt: row.confirmedAt,
      confirmedBy: row.confirmedBy ? { id: row.confirmedBy.id, name: fullName(row.confirmedBy) } : null,
      resolvedAt: row.resolvedAt,
      resolvedBy: row.resolvedBy ? { id: row.resolvedBy.id, name: fullName(row.resolvedBy) } : null,
      resolutionNote: row.resolutionNote,
      notes: row.notes,
      isLive: !!live,
    };
  }
}
