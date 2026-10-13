import { OilSource, OilType } from '@prisma/client';
import {
  applyAuthoritativePrices,
  parsePriceLocks,
  salePriceKey,
} from './oil-sale-pricing';
import { computeSaleFromLines, splitSaleByOil } from './oil-sales.math';
import { sumOilByBucket } from './oil-catalog';
import { saleDebtViolation } from './oil-sales-debt.math';

const settings = {
  priceGreen: 800,
  priceTaieb: 1000,
  priceDrou: 1200,
  priceZebbouche: 900,
};
const containers = [
  { id: 'c5', unitPrice: 150 },
  { id: 'cNoPrice', unitPrice: null },
];

function priceAndTotal(
  lines: Parameters<typeof applyAuthoritativePrices>[0],
  locks?: Record<string, number>,
) {
  const priced = applyAuthoritativePrices(lines, settings, containers, locks);
  return { ...priced, amounts: computeSaleFromLines(priced.lines) };
}

describe('oil sale pricing (server-side, per line)', () => {
  it('single oil: 10 L × 800 = 8,000', () => {
    const { amounts } = priceAndTotal([
      { kind: 'LOOSE', oilType: OilType.GREEN, quantityL: 10 },
    ]);
    expect(amounts.lines[0].lineGross).toBe(8000);
    expect(amounts.finalAmount).toBe(8000);
  });

  it('two oils keep their own price: 8,000 + 5,000 = 13,000 (not 15 × 1,000)', () => {
    const { amounts, lines } = priceAndTotal([
      { kind: 'LOOSE', oilType: OilType.GREEN, quantityL: 10 },
      { kind: 'LOOSE', oilType: OilType.TAIEB, quantityL: 5 },
    ]);
    expect(lines.map((l) => l.unitPrice)).toEqual([800, 1000]);
    expect(amounts.lines.map((l) => l.lineGross)).toEqual([8000, 5000]);
    expect(amounts.grossAmount).toBe(13000);
    expect(amounts.grossAmount).not.toBe(15000);
  });

  it('three oils (loose + packaged) each keep their price', () => {
    const { amounts, lines } = priceAndTotal([
      { kind: 'LOOSE', oilType: OilType.GREEN, quantityL: 10 },
      { kind: 'LOOSE', oilType: OilType.TAIEB, quantityL: 5 },
      {
        kind: 'CONTAINER',
        oilType: OilType.DROU,
        containerId: 'c5',
        capacityL: 5,
        containerCount: 2,
      },
    ]);
    expect(lines.map((l) => l.unitPrice)).toEqual([800, 1000, 1200]);
    expect(amounts.lines.map((l) => l.lineGross)).toEqual([8000, 5000, 12000]);
    expect(amounts.grossAmount).toBe(25000);
  });

  it('flags a manipulated client price and never uses it', () => {
    const { mismatches, lines, amounts } = priceAndTotal([
      { kind: 'LOOSE', oilType: OilType.GREEN, quantityL: 10, unitPrice: 1 },
      { kind: 'LOOSE', oilType: OilType.TAIEB, quantityL: 5, unitPrice: 1000 },
    ]);
    expect(mismatches).toEqual([
      { index: 0, key: 'OIL:GREEN', submitted: 1, expected: 800 },
    ]);
    expect(lines[0].unitPrice).toBe(800);
    expect(amounts.grossAmount).toBe(13000);
  });

  it('ignores a client-chosen FIXED_CONTAINER price for packaged oil', () => {
    const priced = applyAuthoritativePrices(
      [
        {
          kind: 'CONTAINER',
          oilType: OilType.GREEN,
          containerId: 'c5',
          capacityL: 5,
          containerCount: 1,
          containerPrice: 1,
        },
      ],
      settings,
      containers,
    );
    expect(priced.lines[0].pricingMode).toBe('PER_LITRE');
    expect(computeSaleFromLines(priced.lines).grossAmount).toBe(4000);
  });

  it('prices empty containers from the container configuration', () => {
    const { amounts, mismatches } = priceAndTotal([
      {
        kind: 'CONTAINER_ONLY',
        containerId: 'c5',
        containerCount: 3,
        containerPrice: 1,
      },
    ]);
    expect(mismatches).toHaveLength(1);
    expect(amounts.grossAmount).toBe(450);
  });

  it('rejects products without a configured price', () => {
    expect(() =>
      applyAuthoritativePrices(
        [
          {
            kind: 'CONTAINER_ONLY',
            containerId: 'cNoPrice',
            containerCount: 1,
          },
        ],
        settings,
        containers,
      ),
    ).toThrow('PRICE_NOT_CONFIGURED');
  });

  it('held sale keeps its captured price after a catalog change; new products use catalog', () => {
    const locks = parsePriceLocks({ 'OIL:GREEN': 800, junk: 'x' });
    const raised = { ...settings, priceGreen: 950 };
    const priced = applyAuthoritativePrices(
      [
        {
          kind: 'LOOSE',
          oilType: OilType.GREEN,
          quantityL: 10,
          unitPrice: 800,
        },
        { kind: 'LOOSE', oilType: OilType.TAIEB, quantityL: 5 },
      ],
      raised,
      containers,
      locks,
    );
    expect(priced.mismatches).toHaveLength(0);
    expect(priced.lines.map((l) => l.unitPrice)).toEqual([800, 1000]);
    expect(computeSaleFromLines(priced.lines).grossAmount).toBe(13000);
  });

  it('price keys separate oils and containers', () => {
    expect(salePriceKey({ kind: 'LOOSE', oilType: OilType.GREEN })).toBe(
      'OIL:GREEN',
    );
    expect(
      salePriceKey({
        kind: 'CONTAINER',
        oilType: OilType.GREEN,
        containerId: 'c5',
      }),
    ).toBe('OIL:GREEN');
    expect(salePriceKey({ kind: 'CONTAINER_ONLY', containerId: 'c5' })).toBe(
      'CNT:c5',
    );
  });
});

describe('inventory deduction per oil', () => {
  it('deducts each oil only from its own bucket', () => {
    const m = sumOilByBucket([
      { oilSource: OilSource.STORED, oilType: OilType.GREEN, quantityL: 10 },
      { oilSource: OilSource.STORED, oilType: OilType.TAIEB, quantityL: 5 },
      { oilSource: null, oilType: null, quantityL: 0 },
    ]);
    expect([...m.entries()]).toEqual([
      ['STORED:GREEN', 10],
      ['STORED:TAIEB', 5],
    ]);
  });

  it('merges repeated lines of the same oil, keeps sources apart', () => {
    const m = sumOilByBucket([
      { oilSource: OilSource.STORED, oilType: OilType.GREEN, quantityL: 10 },
      { oilSource: OilSource.STORED, oilType: OilType.GREEN, quantityL: 2.5 },
      { oilSource: OilSource.FARMER, oilType: OilType.GREEN, quantityL: 4 },
    ]);
    expect(m.get('STORED:GREEN')).toBe(12.5);
    expect(m.get('FARMER:GREEN')).toBe(4);
  });
});

describe('report split of a mixed sale', () => {
  it('attributes litres and money to each oil line', () => {
    const shares = splitSaleByOil({
      oilSource: 'STORED',
      oilType: 'GREEN',
      quantityL: 15,
      grossAmount: 13000,
      totalAssistance: 0,
      assistancePerLitreTotal: 0,
      items: [
        {
          oilSource: 'STORED',
          oilType: 'GREEN',
          quantityL: 10,
          lineGross: 8000,
        },
        {
          oilSource: 'STORED',
          oilType: 'TAIEB',
          quantityL: 5,
          lineGross: 5000,
        },
      ],
    });
    expect(shares).toEqual([
      {
        oilSource: 'STORED',
        oilType: 'GREEN',
        litres: 10,
        gross: 8000,
        assistance: 0,
        net: 8000,
      },
      {
        oilSource: 'STORED',
        oilType: 'TAIEB',
        litres: 5,
        gross: 5000,
        assistance: 0,
        net: 5000,
      },
    ]);
  });

  it('spreads assistance so per-oil nets sum to the sale net', () => {
    const shares = splitSaleByOil({
      quantityL: 15,
      grossAmount: 13000,
      totalAssistance: 750 + 1300,
      assistancePerLitreTotal: 750,
      items: [
        {
          oilSource: 'STORED',
          oilType: 'GREEN',
          quantityL: 10,
          lineGross: 8000,
        },
        {
          oilSource: 'STORED',
          oilType: 'TAIEB',
          quantityL: 5,
          lineGross: 5000,
        },
      ],
    });
    expect(shares.map((s) => s.assistance)).toEqual([500 + 800, 250 + 500]);
    expect(shares.reduce((s, x) => s + x.net, 0)).toBe(13000 - 2050);
  });
});

describe('walk-in sale debt rule', () => {
  it('walk-in sale paid in full is allowed', () => {
    expect(
      saleDebtViolation({
        remainingAmount: 0,
        customerId: null,
        canAllowDebt: true,
      }),
    ).toBe(null);
  });

  it('walk-in sale cannot leave anonymous debt', () => {
    expect(
      saleDebtViolation({
        remainingAmount: 500,
        customerId: null,
        canAllowDebt: true,
      }),
    ).toBe('DEBT_REQUIRES_CUSTOMER');
  });

  it('named customer debt still needs the permission', () => {
    expect(
      saleDebtViolation({
        remainingAmount: 500,
        customerId: 'c1',
        canAllowDebt: false,
      }),
    ).toBe('DEBT_NOT_ALLOWED');
    expect(
      saleDebtViolation({
        remainingAmount: 500,
        customerId: 'c1',
        canAllowDebt: true,
      }),
    ).toBe(null);
  });
});
