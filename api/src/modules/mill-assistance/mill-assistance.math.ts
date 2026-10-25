/**
 * Pure money rules for mill operator-assistance sessions (مساعدة المشغّل الرئيسي).
 *
 * Revenue lives in pressing records and their payments. A session only GROUPS the
 * payments one assistant collected and tracks the physical handover of that cash to the
 * primary operator. Nothing here creates money: a handover is an internal transfer.
 */

export function roundMoney(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Payment methods that leave physical cash in the assistant's hands. */
export const CASH_METHODS = new Set(['', 'CASH', 'ESPECES', 'ESPÈCES', 'نقدا', 'نقداً', 'نقد']);

export function isCashMethod(method: string | null | undefined): boolean {
  const m = (method ?? '').trim().toUpperCase();
  return CASH_METHODS.has(m) || CASH_METHODS.has(method?.trim() ?? '');
}

export type SessionPayment = {
  id: string;
  amount: number;
  method: string | null;
  pressingRecordId: string;
};

export type SessionOperation = {
  pressingRecordId: string;
  /** Total due for the operation (amount − aid already applied upstream). */
  amountDue: number;
  /** Everything ever paid on the operation, by anyone, any session. */
  paidTotal: number;
};

export type SessionTotals = {
  operationsCount: number;
  paymentsCount: number;
  /** Sum of amount due of the operations touched in this session. */
  totalCharged: number;
  /** Sum of the payments collected IN THIS SESSION only. */
  totalCollected: number;
  totalCash: number;
  totalNonCash: number;
  /** Still unpaid on the operations touched in this session (customer debt, NOT cash). */
  totalOutstanding: number;
  /** Cash the assistant must physically hand over. */
  expectedHandover: number;
};

/**
 * Totals of a session from its own payments and the operations they belong to.
 * Only payments linked to the session count as collected; debts never count as cash.
 */
export function computeSessionTotals(
  payments: SessionPayment[],
  operations: SessionOperation[],
): SessionTotals {
  const seen = new Set<string>();
  for (const p of payments) {
    if (seen.has(p.id)) throw new Error('DUPLICATE_PAYMENT_IN_SESSION');
    seen.add(p.id);
  }
  const totalCash = roundMoney(
    payments.filter((p) => isCashMethod(p.method)).reduce((s, p) => s + Number(p.amount), 0),
  );
  const totalNonCash = roundMoney(
    payments.filter((p) => !isCashMethod(p.method)).reduce((s, p) => s + Number(p.amount), 0),
  );
  const totalCollected = roundMoney(totalCash + totalNonCash);
  const byOp = new Map(operations.map((o) => [o.pressingRecordId, o]));
  const totalCharged = roundMoney([...byOp.values()].reduce((s, o) => s + Number(o.amountDue), 0));
  const totalOutstanding = roundMoney(
    [...byOp.values()].reduce((s, o) => s + Math.max(0, Number(o.amountDue) - Number(o.paidTotal)), 0),
  );
  return {
    operationsCount: byOp.size,
    paymentsCount: payments.length,
    totalCharged,
    totalCollected,
    totalCash,
    totalNonCash,
    totalOutstanding,
    expectedHandover: totalCash,
  };
}

export type HandoverCheck = {
  expected: number;
  declared: number;
  /** declared − expected; negative means cash is missing. */
  difference: number;
  balanced: boolean;
};

export function checkHandover(expected: number, declared: number): HandoverCheck {
  const e = roundMoney(expected);
  const d = roundMoney(declared);
  if (!Number.isFinite(d) || d < 0) throw new Error('INVALID_DECLARED_AMOUNT');
  const difference = roundMoney(d - e);
  return { expected: e, declared: d, difference, balanced: Math.abs(difference) < 0.005 };
}

export type SessionStatus = 'ACTIVE' | 'AWAITING_CONFIRMATION' | 'CONFIRMED' | 'DISCREPANCY';

/** Status after the assistant closes: always awaits the primary operator, balanced or not. */
export function statusAfterClose(): SessionStatus {
  return 'AWAITING_CONFIRMATION';
}

/**
 * Status after the primary operator counts the cash: confirmed only when what they received
 * equals what the session expects; otherwise a discrepancy that must be resolved explicitly.
 */
export function statusAfterConfirm(expected: number, received: number): {
  status: SessionStatus;
  difference: number;
} {
  const c = checkHandover(expected, received);
  return { status: c.balanced ? 'CONFIRMED' : 'DISCREPANCY', difference: c.difference };
}

export const ASSISTANCE_ERROR_AR: Record<string, string> = {
  DUPLICATE_PAYMENT_IN_SESSION: 'نفس الدفعة مسجلة مرتين في الجلسة',
  INVALID_DECLARED_AMOUNT: 'المبلغ المصرّح به غير صالح',
  SESSION_NOT_ACTIVE: 'جلسة المساعدة ليست نشطة',
  SESSION_ALREADY_CLOSED: 'جلسة المساعدة مغلقة مسبقاً',
  SELF_CONFIRM_FORBIDDEN: 'لا يمكن للمساعد تأكيد استلام مداخيله بنفسه',
  SESSION_LOCKED: 'لا يمكن تعديل جلسة بعد تأكيد التسليم — استعمل التسوية',
  DISCREPANCY_NOTE_REQUIRED: 'يجب توضيح سبب الفرق في المبلغ',
};
