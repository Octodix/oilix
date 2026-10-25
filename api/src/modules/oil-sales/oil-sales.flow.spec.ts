/**
 * Drives the real OilSalesService sale / hold code paths against an in-memory
 * Prisma stand-in: pricing, item snapshots, per-oil stock movements, cash,
 * ledger, walk-in rules and the waiting list.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- untyped in-memory Prisma fake */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { OilSalesService } from './oil-sales.service';
import type { CreateOilSaleDto } from './dto/oil-sales.dto';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

type Row = Record<string, any>;

const SEASON = 'season-1';

function createDb() {
  const state = {
    settings: [
      { key: 'oil_price_green', value: 800 },
      { key: 'oil_price_taieb', value: 1000 },
      { key: 'oil_price_drou', value: 1200 },
      { key: 'oil_price_zebbouche', value: 900 },
    ] as Row[],
    customers: [
      {
        id: 'cust-1',
        seasonId: SEASON,
        name: 'Ali',
        phone: '0555',
        deletedAt: null,
      },
    ],
    balances: [] as Row[],
    sales: [] as Row[],
    movements: [] as Row[],
    holds: [] as Row[],
    session: { id: 'sess-1', cashSales: 0 },
    seq: 0,
  };
  const n = (v: unknown) => Number(v ?? 0);
  const id = (p: string) => `${p}-${++state.seq}`;
  const stock = (oilSource: string, oilType: string, qty: number) =>
    state.balances.push({
      id: id('bal'),
      seasonId: SEASON,
      oilSource,
      oilType,
      totalAdded: qty,
      totalSold: 0,
      theoreticalQty: qty,
      physicalQty: null,
      version: 0,
    });
  const matchHold = (h: Row, where: Row) =>
    (!where.id || h.id === where.id) &&
    (!where.seasonId || h.seasonId === where.seasonId) &&
    (!where.createdById || h.createdById === where.createdById) &&
    (!where.cashRegisterId || h.cashRegisterId === where.cashRegisterId);

  const prisma: Row = {
    setting: {
      findMany: async ({ where }: Row) =>
        state.settings.filter((s) => where.key.in.includes(s.key)),
    },
    oilSaleCustomer: {
      findFirst: async ({ where }: Row) =>
        state.customers.find((c) => c.id === where.id && c.deletedAt == null) ??
        null,
    },
    oilContainer: { findMany: async () => [] },
    user: {
      findUnique: async () => ({
        id: 'u1',
        username: 'cashier',
        firstName: 'Sami',
        lastName: 'K',
      }),
    },
    cashRegister: {
      findUnique: async () => ({ id: 'reg-1', code: 'R1', name: 'Caisse 1' }),
    },
    cashRegisterSession: {
      findFirst: async () => ({
        id: state.session.id,
        cashRegister: { id: 'reg-1', code: 'R1', name: 'Caisse 1' },
        device: null,
      }),
      update: async ({ data }: Row) => {
        state.session.cashSales += n(data.cashSales?.increment);
        return state.session;
      },
    },
    oilStockBalance: {
      findUnique: async ({ where }: Row) => {
        const k = where.seasonId_oilSource_oilType;
        return (
          state.balances.find(
            (b) => b.oilSource === k.oilSource && b.oilType === k.oilType,
          ) ?? null
        );
      },
      create: async ({ data }: Row) => {
        stock(data.oilSource, data.oilType, 0);
        return state.balances[state.balances.length - 1];
      },
      update: async ({ where, data }: Row) => {
        const b = state.balances.find((x) => x.id === where.id)!;
        b.totalSold = n(data.totalSold);
        b.theoreticalQty = n(data.theoreticalQty);
        return b;
      },
    },
    oilStockMovement: {
      create: async ({ data }: Row) => {
        const row = { ...data, quantityL: n(data.quantityL) };
        state.movements.push(row);
        return row;
      },
    },
    oilSale: {
      findFirst: async ({ where }: Row) => {
        if (where.id) return state.sales.find((s) => s.id === where.id) ?? null;
        return (
          [...state.sales].sort(
            (a, b) => b.receiptNumber - a.receiptNumber,
          )[0] ?? null
        );
      },
      create: async ({ data }: Row) => {
        const { items, ...rest } = data;
        const sale = {
          ...rest,
          id: id('sale'),
          grossAmount: n(rest.grossAmount),
          finalAmount: n(rest.finalAmount),
          amountPaid: n(rest.amountPaid),
          remainingAmount: n(rest.remainingAmount),
          items: items.create.map((it: Row) => ({
            ...it,
            quantityL: n(it.quantityL),
            unitPrice: n(it.unitPrice),
            lineGross: n(it.lineGross),
          })),
        };
        state.sales.push(sale);
        return sale;
      },
    },
    oilSaleHold: {
      findFirst: async ({ where }: Row) =>
        state.holds.find((h) => matchHold(h, where)) ?? null,
      findMany: async ({ where }: Row) =>
        state.holds.filter((h) => matchHold(h, where)),
      create: async ({ data }: Row) => {
        const row = {
          ...data,
          id: id('hold'),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.holds.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => {
        const h = state.holds.find((x) => x.id === where.id)!;
        Object.assign(h, data, { updatedAt: new Date() });
        return h;
      },
      deleteMany: async ({ where }: Row) => {
        const before = state.holds.length;
        state.holds = state.holds.filter((h) => h.id !== where.id);
        return { count: before - state.holds.length };
      },
    },
    $executeRaw: async () => 1,
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('FROM oil_stock_balances')) {
        const [, oilSource, oilType] = values as string[];
        const b = state.balances.find(
          (x) => x.oilSource === oilSource && x.oilType === oilType,
        )!;
        return [
          {
            id: b.id,
            total_added: b.totalAdded,
            total_sold: b.totalSold,
            theoretical_qty: b.theoreticalQty,
            physical_qty: b.physicalQty,
            version: b.version,
          },
        ];
      }
      return [];
    },
  };
  prisma.$transaction = async (cb: (tx: Row) => Promise<unknown>) => {
    const copy = (rows: Row[]) => rows.map((r) => ({ ...r }));
    const snapshot = {
      balances: copy(state.balances),
      sales: copy(state.sales),
      movements: copy(state.movements),
      holds: copy(state.holds),
      session: { ...state.session },
    };
    try {
      return await cb(prisma);
    } catch (e) {
      Object.assign(state, snapshot);
      throw e;
    }
  };
  return { prisma, state, stock };
}

function setup() {
  const db = createDb();
  db.stock('STORED', 'GREEN', 100);
  db.stock('STORED', 'TAIEB', 100);
  db.stock('STORED', 'DROU', 4);
  const ledger = jest.fn();
  const service = new OilSalesService(
    db.prisma as never,
    { getSeasonId: async () => SEASON } as never,
    { log: jest.fn() } as never,
    { emit: jest.fn() } as never,
    {
      requireSalesDevice: () => ({
        id: 'dev-1',
        code: 'D1',
        name: 'POS 1',
        cashRegisterId: 'reg-1',
      }),
    } as never,
    { appendSaleLedger: ledger } as never,
  );
  return { ...db, service, ledger };
}

const CASHIER: JwtPayload = {
  sub: 'u1',
  role: 'CASHIER',
  permissions: ['OIL_SALES_SALES_CREATE', 'OIL_SALES_SALES_ALLOW_DEBT'],
} as unknown as JwtPayload;

const twoOils = (unitPrices: [number?, number?] = []) => [
  {
    kind: 'LOOSE' as const,
    oilSource: 'STORED' as const,
    oilType: 'GREEN' as const,
    quantityL: 10,
    unitPrice: unitPrices[0],
  },
  {
    kind: 'LOOSE' as const,
    oilSource: 'STORED' as const,
    oilType: 'TAIEB' as const,
    quantityL: 5,
    unitPrice: unitPrices[1],
  },
];

function sell(
  ctx: ReturnType<typeof setup>,
  dto: Partial<CreateOilSaleDto>,
  admin = false,
) {
  return ctx.service.createSale(
    dto,
    'u1',
    admin ? [] : CASHIER.permissions,
    admin,
    admin ? 'ADMIN' : 'CASHIER',
  );
}

const bal = (ctx: ReturnType<typeof setup>, type: string) =>
  ctx.state.balances.find((b) => b.oilType === type)!.theoreticalQty;

describe('oil sale flow (service level)', () => {
  it('multi-oil sale by an admin: each line keeps its own price, stock and cash are per oil', async () => {
    const ctx = setup();
    const sale: Row = await sell(
      ctx,
      { customerId: 'cust-1', items: twoOils([800, 1000]) },
      true,
    );

    expect(
      sale.items.map((i: Row) => [i.oilType, i.unitPrice, i.lineGross]),
    ).toEqual([
      ['GREEN', 800, 8000],
      ['TAIEB', 1000, 5000],
    ]);
    expect(sale.grossAmount).toBe(13000);
    expect(sale.finalAmount).toBe(13000);
    expect(sale.amountPaid).toBe(13000);
    expect(ctx.state.movements.map((m) => [m.oilType, m.quantityL])).toEqual([
      ['GREEN', -10],
      ['TAIEB', -5],
    ]);
    expect(bal(ctx, 'GREEN')).toBe(90);
    expect(bal(ctx, 'TAIEB')).toBe(95);
    expect(ctx.state.session.cashSales).toBe(13000);
    expect(ctx.ledger).toHaveBeenCalledTimes(1);
  });

  it('rejects a manipulated unit price and leaves no trace', async () => {
    const ctx = setup();
    await expect(
      sell(ctx, { customerId: 'cust-1', items: twoOils([1, 1000]) }, true),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.state.sales).toHaveLength(0);
    expect(ctx.state.movements).toHaveLength(0);
    expect(ctx.state.session.cashSales).toBe(0);
  });

  it('old sale keeps its snapshot after the product price changes', async () => {
    const ctx = setup();
    const sale: Row = await sell(ctx, {
      customerId: 'cust-1',
      items: twoOils([800, 1000]),
    });
    ctx.state.settings.find((s) => s.key === 'oil_price_green')!.value = 2000;

    const receipt: Row = await ctx.service.receiptPayload(sale.id as string);
    expect(receipt.sale.items.map((i: Row) => i.unitPrice)).toEqual([
      800, 1000,
    ]);
    expect(receipt.sale.finalAmount).toBe(13000);
    expect(receipt.settings.priceGreen).toBe(2000);
  });

  it('walk-in sale completes without a customer and writes no ledger row', async () => {
    const ctx = setup();
    const sale: Row = await sell(ctx, { items: twoOils() });
    expect(sale.customerId).toBeNull();
    expect(sale.finalAmount).toBe(13000);
    expect(sale.remainingAmount).toBe(0);
    expect(ctx.ledger).not.toHaveBeenCalled();
  });

  it('walk-in sale cannot create anonymous debt', async () => {
    const ctx = setup();
    await expect(
      sell(ctx, { items: twoOils(), amountPaid: 5000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.state.sales).toHaveLength(0);
    expect(ctx.state.movements).toHaveLength(0);
  });

  it('insufficient stock on one oil aborts the whole sale', async () => {
    const ctx = setup();
    await expect(
      sell(ctx, {
        items: [
          ...twoOils(),
          {
            kind: 'LOOSE',
            oilSource: 'STORED',
            oilType: 'DROU',
            quantityL: 10,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.state.sales).toHaveLength(0);
    expect(ctx.state.movements).toHaveLength(0);
    expect(bal(ctx, 'GREEN')).toBe(100);
  });

  it('waiting list: hold A, complete B, resume A at its captured prices, no duplicates', async () => {
    const ctx = setup();

    const holdA: Row = await ctx.service.saveHold(
      { customerId: 'cust-1', items: twoOils([1, 1]) },
      CASHIER,
    );
    expect(holdA.totalAmount).toBe(13000);
    expect(holdA.itemCount).toBe(2);
    expect(holdA.priceLocks).toEqual({ 'OIL:GREEN': 800, 'OIL:TAIEB': 1000 });
    expect(ctx.state.sales).toHaveLength(0);
    expect(ctx.state.movements).toHaveLength(0);
    expect(ctx.state.session.cashSales).toBe(0);
    expect(await ctx.service.listHolds(CASHIER)).toHaveLength(1);

    const saleB: Row = await sell(ctx, {
      items: [
        {
          kind: 'LOOSE',
          oilSource: 'STORED',
          oilType: 'DROU',
          quantityL: 3,
          unitPrice: 1200,
        },
      ],
    });
    expect(saleB.finalAmount).toBe(3600);

    ctx.state.settings.find((s) => s.key === 'oil_price_green')!.value = 950;

    const payloadItems = (holdA.payload as Row).items as Row[];
    const saleA: Row = await sell(ctx, {
      holdId: holdA.id as string,
      customerId: 'cust-1',
      items: payloadItems.map((i) => ({
        kind: i.kind,
        oilSource: i.oilSource,
        oilType: i.oilType,
        quantityL: i.quantityL,
        unitPrice: i.unitPrice,
      })),
    });
    expect(saleA.items.map((i: Row) => i.unitPrice)).toEqual([800, 1000]);
    expect(saleA.finalAmount).toBe(13000);
    expect(ctx.state.holds).toHaveLength(0);
    expect(ctx.state.session.cashSales).toBe(16600);
    expect(bal(ctx, 'GREEN')).toBe(90);
    expect(bal(ctx, 'TAIEB')).toBe(95);
    expect(bal(ctx, 'DROU')).toBe(1);

    await expect(
      sell(ctx, {
        holdId: holdA.id as string,
        customerId: 'cust-1',
        items: twoOils(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.state.sales).toHaveLength(2);
  });

  it('re-holding keeps the original captured price', async () => {
    const ctx = setup();
    const hold: Row = await ctx.service.saveHold(
      { items: [twoOils()[0]] },
      CASHIER,
    );
    ctx.state.settings.find((s) => s.key === 'oil_price_green')!.value = 950;
    const updated: Row = await ctx.service.saveHold(
      { items: twoOils() },
      CASHIER,
      hold.id as string,
    );
    expect(updated.holdNumber).toBe(hold.holdNumber);
    expect(updated.priceLocks).toEqual({ 'OIL:GREEN': 800, 'OIL:TAIEB': 1000 });
    expect(updated.totalAmount).toBe(13000);
  });
});

describe('per-line assistance through the sale flow', () => {
  const ASSIST_CASHIER: JwtPayload = {
    sub: 'u1',
    role: 'CASHIER',
    permissions: [
      'OIL_SALES_SALES_CREATE',
      'OIL_SALES_ASSISTANCE_PER_LITRE',
      'OIL_SALES_ASSISTANCE_FIXED',
    ],
  } as unknown as JwtPayload;

  it('each oil line stores and applies its own assistance', async () => {
    const ctx = setup();
    const sale: Row = await ctx.service.createSale(
      {
        customerId: 'cust-1',
        items: [
          { ...twoOils([800, 1000])[0], assistancePerLitre: 50 },
          { ...twoOils([800, 1000])[1], assistancePerLitre: 30, assistanceFixed: 100 },
        ],
      },
      'u1',
      ASSIST_CASHIER.permissions,
      false,
      'CASHIER',
    );
    expect(
      sale.items.map((i: Row) => [
        i.oilType,
        Number(i.assistancePerLitre),
        Number(i.assistanceFixed),
        Number(i.lineAssistance),
      ]),
    ).toEqual([
      ['GREEN', 50, 0, 500],
      ['TAIEB', 30, 100, 250],
    ]);
    expect(Number(sale.totalAssistance)).toBe(750);
    expect(sale.finalAmount).toBe(13000 - 750);
    expect(ctx.state.session.cashSales).toBe(13000 - 750);
  });

  it('line assistance needs the permission', async () => {
    const ctx = setup();
    await expect(
      sell(ctx, {
        customerId: 'cust-1',
        items: [{ ...twoOils([800, 1000])[0], assistancePerLitre: 50 }],
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(ctx.state.sales).toHaveLength(0);
  });

  it('a held sale keeps each line assistance when resumed', async () => {
    const ctx = setup();
    const hold: Row = await ctx.service.saveHold(
      {
        customerId: 'cust-1',
        items: [
          { ...twoOils()[0], assistancePerLitre: 50 },
          { ...twoOils()[1], assistanceFixed: 200 },
        ],
      },
      ASSIST_CASHIER,
    );
    expect(hold.payload.items.map((i: Row) => i.lineAssistance)).toEqual([500, 200]);
    expect(hold.payload.totalAssistance).toBe(700);
    expect(hold.totalAmount).toBe(13000 - 700);
  });
});
