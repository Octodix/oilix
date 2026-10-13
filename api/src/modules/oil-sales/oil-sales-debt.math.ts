/**
 * Customer debt / payment helpers (source of truth for status + FIFO allocation).
 */

export type OilPaymentStatus = 'PAID' | 'PARTIALLY_PAID' | 'UNPAID';

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computePaymentStatus(
  netAmount: number,
  amountPaid: number,
): OilPaymentStatus {
  const net = roundMoney(netAmount);
  const paid = roundMoney(amountPaid);
  if (paid <= 0) return 'UNPAID';
  if (paid + 1e-9 >= net) return 'PAID';
  return 'PARTIALLY_PAID';
}

export function computeSalePaymentFields(netAmount: number, amountPaid: number) {
  const net = roundMoney(Number(netAmount));
  const paid = roundMoney(Number(amountPaid));
  if (!Number.isFinite(net) || net < 0) throw new Error('INVALID_NET_AMOUNT');
  if (!Number.isFinite(paid) || paid < 0) throw new Error('INVALID_AMOUNT_PAID');
  if (paid > net + 1e-9) throw new Error('PAYMENT_EXCEEDS_NET');
  const remainingAmount = roundMoney(Math.max(0, net - paid));
  return {
    amountPaid: paid,
    remainingAmount,
    paymentStatus: computePaymentStatus(net, paid),
  };
}

/**
 * Debt needs an identifiable customer: a walk-in sale (no customer) must be paid in full.
 * Returns an error code or null when the sale may proceed.
 */
export function saleDebtViolation(input: {
  remainingAmount: number;
  customerId?: string | null;
  canAllowDebt: boolean;
}): 'DEBT_NOT_ALLOWED' | 'DEBT_REQUIRES_CUSTOMER' | null {
  if (!(roundMoney(input.remainingAmount) > 0)) return null;
  if (!input.canAllowDebt) return 'DEBT_NOT_ALLOWED';
  if (!input.customerId) return 'DEBT_REQUIRES_CUSTOMER';
  return null;
}

export type DebtSaleSlice = {
  saleId: string;
  remainingAmount: number;
  saleDate?: Date | string;
};

export type DebtAllocation = {
  saleId: string;
  amount: number;
};

/**
 * Allocate a payment to outstanding sales oldest-first (FIFO).
 */
export function allocateDebtPaymentFifo(
  outstanding: DebtSaleSlice[],
  paymentAmount: number,
): DebtAllocation[] {
  const pay = roundMoney(Number(paymentAmount));
  if (!(pay > 0)) throw new Error('INVALID_PAYMENT_AMOUNT');

  const sorted = [...outstanding]
    .filter((s) => roundMoney(s.remainingAmount) > 0)
    .sort((a, b) => {
      const da = a.saleDate ? new Date(a.saleDate).getTime() : 0;
      const db = b.saleDate ? new Date(b.saleDate).getTime() : 0;
      if (da !== db) return da - db;
      return a.saleId.localeCompare(b.saleId);
    });

  const totalDue = roundMoney(sorted.reduce((s, x) => s + roundMoney(x.remainingAmount), 0));
  if (pay > totalDue + 1e-9) throw new Error('PAYMENT_EXCEEDS_DEBT');

  let left = pay;
  const allocations: DebtAllocation[] = [];
  for (const sale of sorted) {
    if (left <= 1e-9) break;
    const due = roundMoney(sale.remainingAmount);
    const take = roundMoney(Math.min(due, left));
    if (take > 0) {
      allocations.push({ saleId: sale.saleId, amount: take });
      left = roundMoney(left - take);
    }
  }
  return allocations;
}
