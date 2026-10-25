import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../common/constants/audit';
import { clientLabel, formatNum } from '../../common/audit/audit-format';
import { AuditService } from '../audit/audit.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { attributedDeviceId } from '../devices/device-context';
import { MillAssistanceService } from '../mill-assistance/mill-assistance.service';

function currentTime(): string {
  return new Date().toLocaleTimeString('ar-DZ', {
    timeZone: 'Africa/Algiers',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private assistance: MillAssistanceService,
  ) {}

  async create(dto: CreatePaymentDto, userId: string) {
    const amount = money(Number(dto.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('مبلغ الدفعة يجب أن يكون أكبر من صفر');
    }
    // Money collected by an assistant belongs to their ACTIVE assistance session (once, forever).
    const assistanceSessionId = await this.assistance.activeSessionIdFor(userId);

    const payment = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pressing_records WHERE id = ${dto.pressingRecordId} FOR UPDATE`;
      const pressing = await tx.pressingRecord.findUnique({
        where: { id: dto.pressingRecordId },
        include: { payments: true },
      });
      if (!pressing) throw new NotFoundException('سجل التصفية غير موجود');

      const paidSoFar = money(
        pressing.payments.reduce((s, p) => s + Number(p.amount), 0),
      );
      const totalDue = money(Number(pressing.amount));
      const remaining = money(Math.max(0, totalDue - paidSoFar));
      if (amount > remaining + 1e-9) {
        throw new BadRequestException(
          `مبلغ الدفعة يتجاوز المتبقي (${remaining} د.ج)`,
        );
      }
      const newTotal = money(paidSoFar + amount);
      const fullyPaid = newTotal + 1e-9 >= totalDue;

      const created = await tx.payment.create({
        data: {
          pressingRecordId: dto.pressingRecordId,
          amount,
          method: dto.method,
          notes: dto.notes,
          paymentTime: currentTime(),
          userId,
          deviceId: attributedDeviceId(),
          assistanceSessionId,
        },
        include: {
          pressingRecord: { include: { oliveEntry: { include: { client: true } } } },
        },
      });

      if (fullyPaid) {
        await tx.pressingRecord.update({
          where: { id: dto.pressingRecordId },
          data: { paid: true },
        });
        await tx.oliveEntry.update({
          where: { id: pressing.oliveEntryId },
          data: { status: EntryStatus.PAID },
        });
      }

      return { created, fullyPaid };
    });

    const client = payment.created.pressingRecord.oliveEntry.client;
    const ref = payment.created.pressingRecord.oliveEntry.referenceNumber;
    await this.auditService.log({
      userId,
      action: AUDIT_ACTIONS.CREATE,
      module: AUDIT_MODULES.PAYMENTS,
      description: `سجّل دفعة بقيمة ${formatNum(amount)} دج للزبون ${clientLabel(client)} — مرجع #${ref}${payment.fullyPaid ? ' (تسوية كاملة)' : ''}`,
      entity: 'Payment',
      entityId: payment.created.id,
      newData: {
        amount,
        pressingRecordId: dto.pressingRecordId,
        fullyPaid: payment.fullyPaid,
      } as Prisma.InputJsonValue,
    });

    return payment.created;
  }
}
