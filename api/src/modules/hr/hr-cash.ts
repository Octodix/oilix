import { BadRequestException } from '@nestjs/common';
import { CashSessionStatus, Prisma } from '@prisma/client';
import { computeExpectedCash } from '../oil-sales/cash-session.math';
import { num } from './hr-common';

export type CashPosting = { cashRegisterId: string; cashSessionId: string; cashRegisterName: string };

/**
 * Takes money out of an OPEN cash register session (active season), inside the caller's
 * transaction. Same advisory lock as open/close so a payment can never race a closing.
 */
export async function postCashOut(
  tx: Prisma.TransactionClient,
  opts: { registerId: string; amount: number; seasonId: string },
): Promise<CashPosting> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash-open:${opts.registerId}`}))`;
  const register = await tx.cashRegister.findUnique({ where: { id: opts.registerId } });
  if (!register || !register.isActive) throw new BadRequestException('الصندوق غير موجود أو معطل');
  const open = await tx.cashRegisterSession.findFirst({
    where: { cashRegisterId: opts.registerId, status: CashSessionStatus.OPEN, seasonId: opts.seasonId },
  });
  if (!open) {
    throw new BadRequestException(`الصندوق «${register.name}» غير مفتوح — يجب فتحه قبل الدفع النقدي`);
  }
  await tx.$queryRaw`SELECT id FROM cash_register_sessions WHERE id = ${open.id} FOR UPDATE`;
  const locked = await tx.cashRegisterSession.findUnique({ where: { id: open.id } });
  if (!locked || locked.status !== CashSessionStatus.OPEN) throw new BadRequestException('جلسة الصندوق لم تعد مفتوحة');
  const available = computeExpectedCash({
    openingCash: num(locked.openingCash),
    cashSales: num(locked.cashSales),
    cashRefunds: num(locked.cashRefunds),
    cashIn: num(locked.cashIn),
    cashOut: num(locked.cashOut),
  });
  if (available + 1e-6 < opts.amount) {
    throw new BadRequestException(
      `المبلغ (${opts.amount.toFixed(2)} د.ج) يتجاوز النقد المتوفر نظرياً في الصندوق (${available.toFixed(2)} د.ج)`,
    );
  }
  await tx.cashRegisterSession.update({ where: { id: open.id }, data: { cashOut: { increment: opts.amount } } });
  return { cashRegisterId: register.id, cashSessionId: open.id, cashRegisterName: `${register.code} — ${register.name}` };
}

/** Reverses a cash-out on the SAME session; refused once that session is closed (counted). */
export async function reverseCashOut(tx: Prisma.TransactionClient, opts: { sessionId: string; amount: number }) {
  const session = await tx.cashRegisterSession.findUnique({ where: { id: opts.sessionId } });
  if (!session) throw new BadRequestException('جلسة الصندوق غير موجودة');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash-open:${session.cashRegisterId}`}))`;
  await tx.$queryRaw`SELECT id FROM cash_register_sessions WHERE id = ${opts.sessionId} FOR UPDATE`;
  const locked = await tx.cashRegisterSession.findUnique({ where: { id: opts.sessionId } });
  if (!locked || locked.status !== CashSessionStatus.OPEN) {
    throw new BadRequestException('جلسة الصندوق التي خرج منها المبلغ مغلقة — لا يمكن الإلغاء تلقائياً، سجّل تسوية يدوية');
  }
  await tx.cashRegisterSession.update({ where: { id: opts.sessionId }, data: { cashOut: { decrement: opts.amount } } });
}
