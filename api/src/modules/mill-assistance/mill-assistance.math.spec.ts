import {
  checkHandover,
  computeSessionTotals,
  isCashMethod,
  statusAfterConfirm,
} from './mill-assistance.math';

describe('mill assistance money rules', () => {
  const ops = [
    { pressingRecordId: 'op1', amountDue: 5000, paidTotal: 5000 },
    { pressingRecordId: 'op2', amountDue: 3000, paidTotal: 1000 },
    { pressingRecordId: 'op3', amountDue: 2000, paidTotal: 0 },
  ];
  const payments = [
    { id: 'p1', amount: 5000, method: null, pressingRecordId: 'op1' },
    { id: 'p2', amount: 1000, method: 'CASH', pressingRecordId: 'op2' },
  ];

  it('collected = payments of the session only; debts never count as cash', () => {
    const t = computeSessionTotals(payments, ops);
    expect(t.operationsCount).toBe(3);
    expect(t.paymentsCount).toBe(2);
    expect(t.totalCharged).toBe(10000);
    expect(t.totalCollected).toBe(6000);
    expect(t.totalCash).toBe(6000);
    expect(t.totalOutstanding).toBe(4000);
    expect(t.expectedHandover).toBe(6000);
    expect(t.expectedHandover).not.toBe(t.totalCharged);
  });

  it('non-cash payments are collected but not handed over as cash', () => {
    const t = computeSessionTotals(
      [
        { id: 'p1', amount: 5000, method: 'CASH', pressingRecordId: 'op1' },
        { id: 'p2', amount: 1000, method: 'CCP', pressingRecordId: 'op2' },
      ],
      ops,
    );
    expect(t.totalCollected).toBe(6000);
    expect(t.totalCash).toBe(5000);
    expect(t.totalNonCash).toBe(1000);
    expect(t.expectedHandover).toBe(5000);
  });

  it('the same payment can never be counted twice', () => {
    expect(() =>
      computeSessionTotals([payments[0], payments[0]], ops),
    ).toThrow('DUPLICATE_PAYMENT_IN_SESSION');
  });

  it('cash method detection accepts the Arabic and French labels and the empty default', () => {
    expect(isCashMethod(null)).toBe(true);
    expect(isCashMethod('cash')).toBe(true);
    expect(isCashMethod('نقداً')).toBe(true);
    expect(isCashMethod('Espèces')).toBe(true);
    expect(isCashMethod('CCP')).toBe(false);
    expect(isCashMethod('virement')).toBe(false);
  });

  it('handover difference is declared minus expected', () => {
    expect(checkHandover(6000, 6000)).toMatchObject({ difference: 0, balanced: true });
    expect(checkHandover(6000, 5500)).toMatchObject({ difference: -500, balanced: false });
    expect(checkHandover(6000, 6100)).toMatchObject({ difference: 100, balanced: false });
    expect(() => checkHandover(6000, -1)).toThrow('INVALID_DECLARED_AMOUNT');
  });

  it('primary confirmation: equal amount confirms, anything else is a discrepancy', () => {
    expect(statusAfterConfirm(6000, 6000)).toEqual({ status: 'CONFIRMED', difference: 0 });
    expect(statusAfterConfirm(6000, 5000)).toEqual({ status: 'DISCREPANCY', difference: -1000 });
  });
});
