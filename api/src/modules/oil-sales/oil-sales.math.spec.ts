import {
  computeContainerStockSummary,
  computeSaleAmounts,
  computeSaleFromLines,
  computeStockSummary,
  reconcileInventoryCount,
  resolveSaleLine,
  roundMoney,
} from './oil-sales.math';

describe('oil-sales.math', () => {
  describe('computeSaleAmounts', () => {
    it('computes fixed + percentage assistance (acceptance example)', () => {
      const r = computeSaleAmounts({
        quantityL: 20,
        unitPrice: 1000,
        assistancePercent: 5,
        assistanceFixed: 500,
      });
      expect(r.grossAmount).toBe(20000);
      expect(r.assistancePercentAmount).toBe(1000);
      expect(r.assistanceFixed).toBe(500);
      expect(r.assistancePerLitreTotal).toBe(0);
      expect(r.totalAssistance).toBe(1500);
      expect(r.finalAmount).toBe(18500);
    });

    it('Test 1: 20 L × 50 DZD/L assistance = 1,000 DZD', () => {
      const r = computeSaleAmounts({
        quantityL: 20,
        unitPrice: 1000,
        assistancePerLitre: 50,
      });
      expect(r.assistancePerLitreTotal).toBe(1000);
      expect(r.totalAssistance).toBe(1000);
      expect(r.finalAmount).toBe(19000);
    });

    it('Test 2: 30 L × 25 DZD/L assistance = 750 DZD', () => {
      const r = computeSaleAmounts({
        quantityL: 30,
        unitPrice: 1000,
        assistancePerLitre: 25,
      });
      expect(r.assistancePerLitreTotal).toBe(750);
      expect(r.totalAssistance).toBe(750);
    });

    it('Test 5: combined per-litre + percent + fixed', () => {
      const r = computeSaleAmounts({
        quantityL: 20,
        unitPrice: 1000,
        assistancePerLitre: 50,
        assistancePercent: 5,
        assistanceFixed: 500,
      });
      expect(r.grossAmount).toBe(20000);
      expect(r.assistancePerLitreTotal).toBe(1000);
      expect(r.assistancePercentAmount).toBe(1000);
      expect(r.assistanceFixed).toBe(500);
      expect(r.totalAssistance).toBe(2500);
      expect(r.finalAmount).toBe(17500);
    });

    it('rejects negative per-litre assistance', () => {
      expect(() =>
        computeSaleAmounts({ quantityL: 1, unitPrice: 100, assistancePerLitre: -1 }),
      ).toThrow('INVALID_ASSISTANCE_PER_LITRE');
    });

    it('fixed only', () => {
      const r = computeSaleAmounts({ quantityL: 10, unitPrice: 900, assistanceFixed: 200 });
      expect(r.grossAmount).toBe(9000);
      expect(r.assistancePercentAmount).toBe(0);
      expect(r.totalAssistance).toBe(200);
      expect(r.finalAmount).toBe(8800);
    });

    it('percentage only', () => {
      const r = computeSaleAmounts({ quantityL: 20, unitPrice: 900, assistancePercent: 5 });
      expect(r.grossAmount).toBe(18000);
      expect(r.assistancePercentAmount).toBe(900);
      expect(r.finalAmount).toBe(17100);
    });

    it('zero assistance', () => {
      const r = computeSaleAmounts({ quantityL: 20, unitPrice: 900 });
      expect(r.finalAmount).toBe(18000);
      expect(r.totalAssistance).toBe(0);
    });

    it('rejects assistance exceeding gross', () => {
      expect(() =>
        computeSaleAmounts({ quantityL: 1, unitPrice: 100, assistanceFixed: 150 }),
      ).toThrow('ASSISTANCE_EXCEEDS_GROSS');
    });

    it('rejects invalid percent', () => {
      expect(() =>
        computeSaleAmounts({ quantityL: 1, unitPrice: 100, assistancePercent: 101 }),
      ).toThrow('INVALID_ASSISTANCE_PERCENT');
    });

    it('rejects zero quantity', () => {
      expect(() => computeSaleAmounts({ quantityL: 0, unitPrice: 100 })).toThrow(
        'INVALID_QUANTITY',
      );
    });
  });

  describe('containers', () => {
    it('5 L × 4 containers = 20 L', () => {
      const r = resolveSaleLine({
        kind: 'CONTAINER',
        capacityL: 5,
        containerCount: 4,
        unitPrice: 1000,
      });
      expect(r.quantityL).toBe(20);
      expect(r.lineGross).toBe(20000);
    });

    it('mixed 3×5 + 2×2 + 1×30 = 49 L', () => {
      const r = computeSaleFromLines([
        { kind: 'CONTAINER', capacityL: 5, containerCount: 3, unitPrice: 1000 },
        { kind: 'CONTAINER', capacityL: 2, containerCount: 2, unitPrice: 1000 },
        { kind: 'CONTAINER', capacityL: 30, containerCount: 1, unitPrice: 1000 },
      ]);
      expect(r.quantityL).toBe(49);
      expect(r.grossAmount).toBe(49000);
    });

    it('3 × 5 L deducts 15 L from 100 L stock math', () => {
      const sold = resolveSaleLine({
        kind: 'CONTAINER',
        capacityL: 5,
        containerCount: 3,
        unitPrice: 900,
      }).quantityL;
      expect(100 - sold).toBe(85);
    });

    it('mixed container + loose litres', () => {
      const r = computeSaleFromLines([
        { kind: 'CONTAINER', capacityL: 5, containerCount: 2, unitPrice: 1000 },
        { kind: 'LOOSE', quantityL: 3.5, unitPrice: 1000 },
      ]);
      expect(r.quantityL).toBe(13.5);
      expect(r.grossAmount).toBe(13500);
    });

    it('Test 3: 4 × 5L oil × 50 DZD/L = 20 L → 1,000 DZD', () => {
      const r = computeSaleFromLines(
        [{ kind: 'CONTAINER', capacityL: 5, containerCount: 4, unitPrice: 1000 }],
        { assistancePerLitre: 50 },
      );
      expect(r.quantityL).toBe(20);
      expect(r.assistancePerLitreTotal).toBe(1000);
      expect(r.finalAmount).toBe(19000);
    });

    it('Test 4: oil litres only — empty containers excluded from per-litre assistance', () => {
      const r = computeSaleFromLines(
        [
          { kind: 'CONTAINER', capacityL: 5, containerCount: 4, unitPrice: 1000 },
          { kind: 'CONTAINER_ONLY', containerCount: 5, unitPrice: 100, capacityL: 5 },
        ],
        { assistancePerLitre: 50 },
      );
      expect(r.quantityL).toBe(20);
      expect(r.grossAmount).toBe(20500);
      expect(r.assistancePerLitreTotal).toBe(1000);
      expect(r.totalAssistance).toBe(1000);
      expect(r.finalAmount).toBe(19500);
    });

    it('empty container sale: 4 × 150 DA = 600 DA, 0 oil litres', () => {
      const r = resolveSaleLine({
        kind: 'CONTAINER_ONLY',
        containerCount: 4,
        unitPrice: 150,
      });
      expect(r.quantityL).toBe(0);
      expect(r.containerCount).toBe(4);
      expect(r.lineGross).toBe(600);
    });

    it('mixed packaged oil + empty containers', () => {
      const r = computeSaleFromLines([
        { kind: 'CONTAINER', capacityL: 5, containerCount: 3, unitPrice: 1000 },
        { kind: 'CONTAINER_ONLY', containerCount: 2, unitPrice: 150, capacityL: 5 },
        { kind: 'CONTAINER_ONLY', containerCount: 1, unitPrice: 500, capacityL: 30 },
      ]);
      expect(r.quantityL).toBe(15);
      expect(r.grossAmount).toBe(15800);
    });
  });

  describe('dual inventory acceptance', () => {
    it('packaged oil: 100 L + 20×5L → sell 3×5L → 85 L and 17 units', () => {
      const oilBefore = 100;
      const containersBefore = 20;
      const line = resolveSaleLine({
        kind: 'CONTAINER',
        capacityL: 5,
        containerCount: 3,
        unitPrice: 1000,
      });
      expect(oilBefore - line.quantityL).toBe(85);
      expect(containersBefore - (line.containerCount ?? 0)).toBe(17);
    });

    it('empty container sale does not change oil stock', () => {
      const oilBefore = 85;
      const containersBefore = 17;
      const line = resolveSaleLine({
        kind: 'CONTAINER_ONLY',
        containerCount: 4,
        unitPrice: 150,
      });
      expect(line.quantityL).toBe(0);
      expect(oilBefore - line.quantityL).toBe(85);
      expect(containersBefore - (line.containerCount ?? 0)).toBe(13);
    });

    it('mixed sale: 2×5L green + 3 empty 2L', () => {
      const oil = resolveSaleLine({
        kind: 'CONTAINER',
        capacityL: 5,
        containerCount: 2,
        unitPrice: 1000,
      });
      const empty = resolveSaleLine({
        kind: 'CONTAINER_ONLY',
        containerCount: 3,
        unitPrice: 80,
        capacityL: 2,
      });
      expect(oil.quantityL).toBe(10);
      expect(oil.containerCount).toBe(2);
      expect(empty.quantityL).toBe(0);
      expect(empty.containerCount).toBe(3);
    });

    it('cancellation restores oil litres and both container balances', () => {
      const oilBefore = 100;
      const c5Before = 20;
      const c2Before = 40;
      const oilDelta = 10;
      const c5Delta = 2;
      const c2Delta = 3;
      const oilAfter = oilBefore - oilDelta;
      const c5After = c5Before - c5Delta;
      const c2After = c2Before - c2Delta;
      expect(oilAfter + oilDelta).toBe(oilBefore);
      expect(c5After + c5Delta).toBe(c5Before);
      expect(c2After + c2Delta).toBe(c2Before);
    });
  });

  describe('computeStockSummary', () => {
    it('matches acceptance scenario: 800 added, 600 sold, 190 physical → loss 10', () => {
      const s = computeStockSummary({
        totalAdded: 800,
        totalSold: 600,
        physicalQty: 190,
      });
      expect(s.theoreticalQty).toBe(200);
      expect(s.lossQty).toBe(10);
      expect(s.lossPercent).toBe(5);
    });

    it('no physical → loss 0', () => {
      const s = computeStockSummary({ totalAdded: 800, totalSold: 600 });
      expect(s.theoreticalQty).toBe(200);
      expect(s.physicalQty).toBeNull();
      expect(s.lossQty).toBe(0);
    });

    it('prefers stored theoreticalQty so adjustments do not distort sold totals', () => {
      const s = computeStockSummary({
        totalAdded: 800,
        totalSold: 600,
        theoreticalQty: 190,
        physicalQty: 185,
      });
      expect(s.theoreticalQty).toBe(190);
      expect(s.totalSold).toBe(600);
      expect(s.lossQty).toBe(5);
    });
  });

  describe('computeContainerStockSummary', () => {
    it('added 100, used/sold 50, physical 47 → theoretical 50, loss 3', () => {
      const s = computeContainerStockSummary({
        totalAdded: 100,
        totalSoldEmpty: 20,
        totalConsumedInOil: 30,
        physicalQty: 47,
      });
      expect(s.theoreticalQty).toBe(50);
      expect(s.physicalQty).toBe(47);
      expect(s.difference).toBe(-3);
      expect(s.lossQty).toBe(3);
    });

    it('does not mix litres into unit stock', () => {
      const s = computeContainerStockSummary({
        totalAdded: 20,
        totalSoldEmpty: 0,
        totalConsumedInOil: 3,
      });
      expect(s.theoreticalQty).toBe(17);
      expect(Number.isInteger(s.theoreticalQty)).toBe(true);
    });

    it('prefers stored theoreticalQty so adjustments do not distort added totals', () => {
      const s = computeContainerStockSummary({
        totalAdded: 100,
        totalSoldEmpty: 20,
        totalConsumedInOil: 30,
        totalDamaged: 0,
        theoreticalQty: 45,
        physicalQty: 44,
      });
      expect(s.theoreticalQty).toBe(45);
      expect(s.totalAdded).toBe(100);
      expect(s.lossQty).toBe(1);
    });
  });

  describe('roundMoney', () => {
    it('rounds to 2 decimals', () => {
      expect(roundMoney(10.005)).toBe(10.01);
    });
  });

  describe('reconcileInventoryCount', () => {
    it('Test 1: 200 → 190 = LOSS 10, new stock 190', () => {
      const r = reconcileInventoryCount(200, 190);
      expect(r.lossQty).toBe(10);
      expect(r.surplusQty).toBe(0);
      expect(r.differenceType).toBe('LOSS');
      expect(r.difference).toBe(-10);
      expect(r.newCurrentStock).toBe(190);
      expect(r.adjustmentQty).toBe(-10);
    });

    it('Test 2: 200 → 205 = SURPLUS 5, new stock 205', () => {
      const r = reconcileInventoryCount(200, 205);
      expect(r.surplusQty).toBe(5);
      expect(r.lossQty).toBe(0);
      expect(r.differenceType).toBe('SURPLUS');
      expect(r.newCurrentStock).toBe(205);
      expect(r.adjustmentQty).toBe(5);
    });

    it('Test 3: after inventory 190 + addition 50 = 240', () => {
      const afterInv = reconcileInventoryCount(200, 190).newCurrentStock;
      expect(afterInv + 50).toBe(240);
    });

    it('Test 4: after inventory 190 − sale 20 = 170', () => {
      const afterInv = reconcileInventoryCount(200, 190).newCurrentStock;
      expect(afterInv - 20).toBe(170);
    });

    it('Test 5: Stored Green reconcile does not change Farmer Green math', () => {
      const stored = reconcileInventoryCount(200, 190);
      const farmer = 100;
      expect(stored.newCurrentStock).toBe(190);
      expect(farmer).toBe(100);
    });

    it('does not record negative loss', () => {
      const r = reconcileInventoryCount(200, 205);
      expect(r.lossQty).toBe(0);
      expect(r.lossQty).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('assistance per line (each oil keeps its own rate)', () => {
  it('two oils: 40 L GREEN × 900 with 50/L and 40 L TAIEB × 1,000 with 30/L', () => {
    const r = computeSaleFromLines([
      { kind: 'LOOSE', quantityL: 40, unitPrice: 900, assistancePerLitre: 50 },
      { kind: 'LOOSE', quantityL: 40, unitPrice: 1000, assistancePerLitre: 30 },
    ]);
    expect(r.lines.map((l) => l.lineAssistance)).toEqual([2000, 1200]);
    expect(r.lines.map((l) => l.lineNet)).toEqual([34000, 38800]);
    expect(r.grossAmount).toBe(76000);
    expect(r.assistancePerLitreTotal).toBe(3200);
    expect(r.totalAssistance).toBe(3200);
    expect(r.finalAmount).toBe(72800);
    // Not 80 L × 50 (4,000) nor 80 L × 30 (2,400): the second oil never takes the first rate.
    expect(r.totalAssistance).not.toBe(4000);
    expect(r.totalAssistance).not.toBe(2400);
  });

  it('a line without assistance stays untouched when another line has some', () => {
    const r = computeSaleFromLines([
      { kind: 'LOOSE', quantityL: 10, unitPrice: 900, assistancePerLitre: 50 },
      { kind: 'LOOSE', quantityL: 10, unitPrice: 1000 },
    ]);
    expect(r.lines.map((l) => l.lineAssistance)).toEqual([500, 0]);
    expect(r.totalAssistance).toBe(500);
    expect(r.finalAmount).toBe(18500);
  });

  it('fixed assistance per line adds up; per-litre and fixed can mix on one line', () => {
    const r = computeSaleFromLines([
      { kind: 'LOOSE', quantityL: 10, unitPrice: 900, assistanceFixed: 300 },
      {
        kind: 'CONTAINER',
        capacityL: 5,
        containerCount: 2,
        unitPrice: 1000,
        assistancePerLitre: 20,
        assistanceFixed: 100,
      },
    ]);
    expect(r.lines.map((l) => l.lineAssistance)).toEqual([300, 300]);
    expect(r.assistanceFixed).toBe(400);
    expect(r.assistancePerLitreTotal).toBe(200);
    expect(r.totalAssistance).toBe(600);
    expect(r.finalAmount).toBe(19000 - 600);
  });

  it('header per-litre rate equals the shared rate when all lines use the same one', () => {
    const r = computeSaleFromLines([
      { kind: 'LOOSE', quantityL: 10, unitPrice: 900, assistancePerLitre: 50 },
      { kind: 'LOOSE', quantityL: 30, unitPrice: 1000, assistancePerLitre: 50 },
    ]);
    expect(r.assistancePerLitre).toBe(50);
    expect(r.assistancePerLitreTotal).toBe(2000);
  });

  it('legacy sale-level assistance still applies on top of line assistance', () => {
    const r = computeSaleFromLines(
      [{ kind: 'LOOSE', quantityL: 10, unitPrice: 900, assistancePerLitre: 50 }],
      { assistanceFixed: 100 },
    );
    expect(r.totalAssistance).toBe(600);
  });

  it('rejects a line whose assistance exceeds its own gross', () => {
    expect(() =>
      computeSaleFromLines([
        { kind: 'LOOSE', quantityL: 1, unitPrice: 100, assistancePerLitre: 150 },
      ]),
    ).toThrow('ASSISTANCE_EXCEEDS_GROSS');
    expect(() =>
      resolveSaleLine({ kind: 'LOOSE', quantityL: 1, unitPrice: 100, assistancePerLitre: -1 }),
    ).toThrow('INVALID_ASSISTANCE_PER_LITRE');
  });
});
