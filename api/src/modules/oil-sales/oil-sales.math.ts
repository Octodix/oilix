/**
 * Pure sale / stock calculation helpers (source of truth for business rules).
 * Backend must recompute — never trust client totals.
 */

export type SaleAmountInput = {
  quantityL: number;
  unitPrice: number;
  assistanceFixed?: number;
  assistancePercent?: number;
  assistancePerLitre?: number;
};

export type SaleAmountResult = {
  grossAmount: number;
  assistanceFixed: number;
  assistancePercent: number;
  assistancePercentAmount: number;
  assistancePerLitre: number;
  assistancePerLitreTotal: number;
  totalAssistance: number;
  finalAmount: number;
};

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Apply assistance to a precomputed gross using oil litres for per-litre assistance.
 * Empty-container revenue is in gross but not in oilQuantityL.
 *
 * `lineAssistance` carries the assistance already computed line by line (each oil
 * line has its own per-litre rate and fixed amount). The sale-level fields remain
 * for legacy callers and are applied on top of the line totals.
 */
export function finalizeSaleAmounts(input: {
  grossAmount: number;
  oilQuantityL: number;
  assistanceFixed?: number;
  assistancePercent?: number;
  assistancePerLitre?: number;
  lineAssistance?: { perLitreTotal: number; fixedTotal: number };
}): SaleAmountResult {
  const grossAmount = roundMoney(Number(input.grossAmount));
  const oilQuantityL = roundMoney(Number(input.oilQuantityL) || 0);
  const saleAssistanceFixed = roundMoney(Number(input.assistanceFixed ?? 0));
  const assistancePercent = Number(input.assistancePercent ?? 0);
  const saleAssistancePerLitre = roundMoney(Number(input.assistancePerLitre ?? 0));
  const linePerLitreTotal = roundMoney(Number(input.lineAssistance?.perLitreTotal ?? 0));
  const lineFixedTotal = roundMoney(Number(input.lineAssistance?.fixedTotal ?? 0));

  if (!Number.isFinite(grossAmount) || grossAmount < 0) {
    throw new Error('INVALID_UNIT_PRICE');
  }
  if (!Number.isFinite(oilQuantityL) || oilQuantityL < 0) {
    throw new Error('INVALID_QUANTITY');
  }
  if (!Number.isFinite(saleAssistanceFixed) || saleAssistanceFixed < 0) {
    throw new Error('INVALID_ASSISTANCE_FIXED');
  }
  if (!Number.isFinite(assistancePercent) || assistancePercent < 0 || assistancePercent > 100) {
    throw new Error('INVALID_ASSISTANCE_PERCENT');
  }
  if (!Number.isFinite(saleAssistancePerLitre) || saleAssistancePerLitre < 0) {
    throw new Error('INVALID_ASSISTANCE_PER_LITRE');
  }
  if (!Number.isFinite(linePerLitreTotal) || linePerLitreTotal < 0) {
    throw new Error('INVALID_ASSISTANCE_PER_LITRE');
  }
  if (!Number.isFinite(lineFixedTotal) || lineFixedTotal < 0) {
    throw new Error('INVALID_ASSISTANCE_FIXED');
  }

  const assistanceFixed = roundMoney(saleAssistanceFixed + lineFixedTotal);
  const assistancePerLitreTotal = roundMoney(
    oilQuantityL * saleAssistancePerLitre + linePerLitreTotal,
  );
  // Header rate: the single rate when every line shares it, else the effective
  // average (total ÷ litres) so legacy consumers still read a meaningful value.
  const assistancePerLitre =
    linePerLitreTotal > 0
      ? oilQuantityL > 0
        ? roundMoney(assistancePerLitreTotal / oilQuantityL)
        : 0
      : saleAssistancePerLitre;
  const assistancePercentAmount = roundMoney((grossAmount * assistancePercent) / 100);
  const totalAssistance = roundMoney(
    assistanceFixed + assistancePercentAmount + assistancePerLitreTotal,
  );

  if (totalAssistance > grossAmount + 1e-9) {
    throw new Error('ASSISTANCE_EXCEEDS_GROSS');
  }

  const finalAmount = roundMoney(grossAmount - totalAssistance);
  if (finalAmount < 0) {
    throw new Error('NEGATIVE_FINAL_AMOUNT');
  }

  return {
    grossAmount,
    assistanceFixed,
    assistancePercent,
    assistancePercentAmount,
    assistancePerLitre,
    assistancePerLitreTotal,
    totalAssistance,
    finalAmount,
  };
}

export function computeSaleAmounts(input: SaleAmountInput): SaleAmountResult {
  const quantityL = Number(input.quantityL);
  const unitPrice = Number(input.unitPrice);

  if (!Number.isFinite(quantityL) || quantityL <= 0) {
    throw new Error('INVALID_QUANTITY');
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('INVALID_UNIT_PRICE');
  }

  const grossAmount = roundMoney(quantityL * unitPrice);
  return finalizeSaleAmounts({
    grossAmount,
    oilQuantityL: quantityL,
    assistanceFixed: input.assistanceFixed,
    assistancePercent: input.assistancePercent,
    assistancePerLitre: input.assistancePerLitre,
  });
}

export type InventoryDifferenceType = 'LOSS' | 'SURPLUS' | 'BALANCED';

export type InventoryReconcileResult = {
  theoreticalBefore: number;
  physicalQty: number;
  difference: number;
  lossQty: number;
  surplusQty: number;
  differenceType: InventoryDifferenceType;
  newCurrentStock: number;
  adjustmentQty: number;
};

/**
 * Physical inventory becomes the new operational stock baseline.
 * difference = physical - theoretical; LOSS never negative.
 */
export function reconcileInventoryCount(
  theoreticalBefore: number,
  physicalQty: number,
): InventoryReconcileResult {
  const before = roundMoney(Number(theoreticalBefore) || 0);
  const physical = roundMoney(Number(physicalQty));
  if (!Number.isFinite(physical) || physical < 0) {
    throw new Error('INVALID_PHYSICAL_QTY');
  }
  const difference = roundMoney(physical - before);
  const lossQty = roundMoney(Math.max(0, before - physical));
  const surplusQty = roundMoney(Math.max(0, physical - before));
  const differenceType: InventoryDifferenceType =
    lossQty > 0 ? 'LOSS' : surplusQty > 0 ? 'SURPLUS' : 'BALANCED';
  return {
    theoreticalBefore: before,
    physicalQty: physical,
    difference,
    lossQty,
    surplusQty,
    differenceType,
    newCurrentStock: physical,
    adjustmentQty: difference,
  };
}

export type StockSummary = {
  totalAdded: number;
  totalSold: number;
  theoreticalQty: number;
  physicalQty: number | null;
  lossQty: number;
  lossPercent: number;
};

/**
 * Loss = theoretical - physical (when physical known); else 0.
 * Prefer stored `theoreticalQty` when provided so ADJUSTMENT movements
 * do not contaminate totalSold / sales reports.
 */
export function computeStockSummary(input: {
  totalAdded: number;
  totalSold: number;
  physicalQty?: number | null;
  theoreticalQty?: number | null;
}): StockSummary {
  const totalAdded = roundMoney(Number(input.totalAdded) || 0);
  const totalSold = roundMoney(Number(input.totalSold) || 0);
  const theoreticalQty =
    input.theoreticalQty == null || input.theoreticalQty === undefined
      ? roundMoney(totalAdded - totalSold)
      : roundMoney(Number(input.theoreticalQty));
  const physicalQty =
    input.physicalQty == null || input.physicalQty === undefined
      ? null
      : roundMoney(Number(input.physicalQty));

  const lossQty =
    physicalQty == null ? 0 : roundMoney(Math.max(0, theoreticalQty - physicalQty));
  const lossPercent =
    theoreticalQty > 0 && physicalQty != null
      ? roundMoney((lossQty / theoreticalQty) * 100)
      : 0;

  return {
    totalAdded,
    totalSold,
    theoreticalQty,
    physicalQty,
    lossQty,
    lossPercent,
  };
}

export const SALE_CALC_ERROR_AR: Record<string, string> = {
  INVALID_QUANTITY: 'الكمية يجب أن تكون أكبر من صفر',
  INVALID_UNIT_PRICE: 'سعر اللتر غير صالح',
  INVALID_ASSISTANCE_FIXED: 'قيمة المساعدة الثابتة غير صالحة',
  INVALID_ASSISTANCE_PERCENT: 'نسبة المساعدة يجب أن تكون بين 0 و 100',
  INVALID_ASSISTANCE_PER_LITRE: 'مساعدة اللتر غير صالحة',
  ASSISTANCE_EXCEEDS_GROSS: 'إجمالي المساعدة لا يمكن أن يتجاوز المبلغ الإجمالي',
  NEGATIVE_FINAL_AMOUNT: 'المبلغ النهائي لا يمكن أن يكون سالباً',
  INVALID_CONTAINER: 'تعبئة غير صالحة — تحقق من السعة وعدد الضلف',
  EMPTY_LINES: 'أضف سطراً واحداً على الأقل للبيع',
  INVALID_CONTAINER_QTY: 'عدد الضلف يجب أن يكون عدداً صحيحاً أكبر من صفر',
  PRICE_NOT_CONFIGURED: 'لا يوجد سعر بيع مضبوط لهذا المنتج — حدده من إعدادات المنتجات',
};

export type SaleLineKind = 'CONTAINER' | 'LOOSE' | 'CONTAINER_ONLY';
export type OilPricingMode = 'PER_LITRE' | 'FIXED_CONTAINER';

export type SaleLineInput = {
  kind: SaleLineKind;
  capacityL?: number;
  containerCount?: number;
  quantityL?: number;
  unitPrice: number;
  pricingMode?: OilPricingMode;
  containerPrice?: number;
  /** Assistance of this line only (DZD per litre of THIS line's oil). */
  assistancePerLitre?: number;
  /** Fixed assistance of this line only (DZD). */
  assistanceFixed?: number;
};

export type ResolvedSaleLine = {
  kind: SaleLineKind;
  quantityL: number;
  lineGross: number;
  containerCount: number | null;
  capacityL: number | null;
  assistancePerLitre: number;
  assistanceFixed: number;
  /** quantityL × assistancePerLitre + assistanceFixed */
  lineAssistance: number;
  lineNet: number;
};

function assertPositiveIntCount(n: number) {
  if (!(n >= 1) || !Number.isInteger(n)) {
    throw new Error('INVALID_CONTAINER_QTY');
  }
}

/**
 * Each line's assistance is computed from ITS OWN litres and ITS OWN rate; a second
 * oil in the cart never inherits the first line's assistance. A line's assistance may
 * not exceed the line's gross.
 */
function withLineAssistance(
  base: Omit<ResolvedSaleLine, 'assistancePerLitre' | 'assistanceFixed' | 'lineAssistance' | 'lineNet'>,
  input: SaleLineInput,
): ResolvedSaleLine {
  const assistancePerLitre = roundMoney(Number(input.assistancePerLitre ?? 0));
  const assistanceFixed = roundMoney(Number(input.assistanceFixed ?? 0));
  if (!Number.isFinite(assistancePerLitre) || assistancePerLitre < 0) {
    throw new Error('INVALID_ASSISTANCE_PER_LITRE');
  }
  if (!Number.isFinite(assistanceFixed) || assistanceFixed < 0) {
    throw new Error('INVALID_ASSISTANCE_FIXED');
  }
  const lineAssistance = roundMoney(base.quantityL * assistancePerLitre + assistanceFixed);
  if (lineAssistance > base.lineGross + 1e-9) {
    throw new Error('ASSISTANCE_EXCEEDS_GROSS');
  }
  return {
    ...base,
    assistancePerLitre,
    assistanceFixed,
    lineAssistance,
    lineNet: roundMoney(base.lineGross - lineAssistance),
  };
}

export function resolveSaleLine(input: SaleLineInput): ResolvedSaleLine {
  const unitPrice = Number(input.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('INVALID_UNIT_PRICE');
  }

  if (input.kind === 'CONTAINER_ONLY') {
    const containerCount = Number(input.containerCount);
    assertPositiveIntCount(containerCount);
    const sellingPrice = Number(
      input.containerPrice != null && Number.isFinite(Number(input.containerPrice))
        ? input.containerPrice
        : unitPrice,
    );
    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
      throw new Error('INVALID_UNIT_PRICE');
    }
    return withLineAssistance(
      {
        kind: 'CONTAINER_ONLY',
        quantityL: 0,
        lineGross: roundMoney(containerCount * sellingPrice),
        containerCount,
        capacityL: input.capacityL != null ? Number(input.capacityL) : null,
      },
      input,
    );
  }

  if (input.kind === 'CONTAINER') {
    const capacityL = Number(input.capacityL);
    const containerCount = Number(input.containerCount);
    if (!(capacityL > 0) || !(containerCount >= 1) || !Number.isInteger(containerCount)) {
      throw new Error('INVALID_CONTAINER');
    }
    const quantityL = roundMoney(capacityL * containerCount);
    let lineGross: number;
    if (input.pricingMode === 'FIXED_CONTAINER') {
      const containerPrice = Number(input.containerPrice);
      if (!Number.isFinite(containerPrice) || containerPrice < 0) {
        throw new Error('INVALID_UNIT_PRICE');
      }
      lineGross = roundMoney(containerCount * containerPrice);
    } else {
      lineGross = roundMoney(quantityL * unitPrice);
    }
    return withLineAssistance(
      { kind: 'CONTAINER', quantityL, lineGross, containerCount, capacityL },
      input,
    );
  }

  const quantityL = Number(input.quantityL);
  if (!Number.isFinite(quantityL) || quantityL <= 0) {
    throw new Error('INVALID_QUANTITY');
  }
  return withLineAssistance(
    {
      kind: 'LOOSE',
      quantityL: roundMoney(quantityL),
      lineGross: roundMoney(quantityL * unitPrice),
      containerCount: null,
      capacityL: null,
    },
    input,
  );
}

export function computeSaleFromLines(
  lines: SaleLineInput[],
  assistance?: {
    assistanceFixed?: number;
    assistancePercent?: number;
    assistancePerLitre?: number;
  },
): SaleAmountResult & { quantityL: number; lines: ResolvedSaleLine[] } {
  if (!lines.length) throw new Error('EMPTY_LINES');
  const resolved = lines.map(resolveSaleLine);
  // Oil litres only — CONTAINER_ONLY contributes 0 (empty containers excluded)
  const quantityL = roundMoney(resolved.reduce((s, l) => s + l.quantityL, 0));
  const grossAmount = roundMoney(resolved.reduce((s, l) => s + l.lineGross, 0));
  if (!(grossAmount > 0) && !(quantityL > 0)) {
    throw new Error('EMPTY_LINES');
  }
  // Per-line assistance: each line contributes litres × ITS rate + ITS fixed amount.
  const linePerLitreTotal = roundMoney(
    resolved.reduce((s, l) => s + l.quantityL * l.assistancePerLitre, 0),
  );
  const lineFixedTotal = roundMoney(resolved.reduce((s, l) => s + l.assistanceFixed, 0));
  const rest = finalizeSaleAmounts({
    grossAmount,
    oilQuantityL: quantityL,
    assistanceFixed: assistance?.assistanceFixed,
    assistancePercent: assistance?.assistancePercent,
    assistancePerLitre: assistance?.assistancePerLitre,
    lineAssistance: { perLitreTotal: linePerLitreTotal, fixedTotal: lineFixedTotal },
  });
  return { ...rest, quantityL, lines: resolved };
}

export type SaleOilShare = {
  oilSource: string;
  oilType: string;
  litres: number;
  gross: number;
  assistance: number;
  net: number;
};

/**
 * Splits one finalized sale into per-oil shares using its line snapshots.
 * Assistance recorded on the line itself (per-line rate / fixed) is attributed exactly.
 * Any remaining sale-level assistance (legacy sales) is spread: per-litre by litres,
 * fixed/percent by each line's share of the sale gross.
 * Legacy sales without items fall back to the header oil.
 */
export function splitSaleByOil(sale: {
  oilSource?: string | null;
  oilType?: string | null;
  quantityL: number;
  grossAmount: number;
  totalAssistance: number;
  assistancePerLitreTotal: number;
  items?: Array<{
    oilSource?: string | null;
    oilType?: string | null;
    quantityL: number;
    lineGross: number;
    assistancePerLitre?: number | null;
    lineAssistance?: number | null;
  }>;
}): SaleOilShare[] {
  const gross = Number(sale.grossAmount) || 0;
  const items = sale.items ?? [];
  // Assistance already attributed to lines (new sales); 0 for legacy sales.
  const lineLevelPerLitre = items.reduce(
    (s, l) => s + (Number(l.quantityL) || 0) * (Number(l.assistancePerLitre) || 0),
    0,
  );
  const lineLevelTotal = items.reduce((s, l) => s + (Number(l.lineAssistance) || 0), 0);
  const perLitreTotal = Math.max(
    0,
    (Number(sale.assistancePerLitreTotal) || 0) - lineLevelPerLitre,
  );
  const otherAssistance = Math.max(
    0,
    (Number(sale.totalAssistance) || 0) - lineLevelTotal - perLitreTotal,
  );

  const oilLines = (items.length
    ? items
    : sale.oilSource && sale.oilType
      ? [
          {
            oilSource: sale.oilSource,
            oilType: sale.oilType,
            quantityL: Number(sale.quantityL) || 0,
            lineGross: gross,
            lineAssistance: 0,
          },
        ]
      : []
  ).filter((l) => l.oilSource && l.oilType && Number(l.quantityL) > 0);

  const totalLitres = oilLines.reduce((s, l) => s + Number(l.quantityL), 0);
  const byKey = new Map<string, SaleOilShare>();
  for (const l of oilLines) {
    const litres = Number(l.quantityL);
    const lineGross = Number(l.lineGross) || 0;
    const assistance =
      (Number(l.lineAssistance) || 0) +
      (totalLitres > 0 ? (perLitreTotal * litres) / totalLitres : 0) +
      (gross > 0 ? (otherAssistance * lineGross) / gross : 0);
    const key = `${l.oilSource}:${l.oilType}`;
    const cur = byKey.get(key) ?? {
      oilSource: l.oilSource as string,
      oilType: l.oilType as string,
      litres: 0,
      gross: 0,
      assistance: 0,
      net: 0,
    };
    cur.litres += litres;
    cur.gross += lineGross;
    cur.assistance += assistance;
    byKey.set(key, cur);
  }
  return [...byKey.values()].map((s) => ({
    ...s,
    litres: roundMoney(s.litres),
    gross: roundMoney(s.gross),
    assistance: roundMoney(s.assistance),
    net: roundMoney(s.gross - s.assistance),
  }));
}

export type ContainerStockSummary = {
  totalAdded: number;
  totalSoldEmpty: number;
  totalConsumedInOil: number;
  totalDamaged: number;
  theoreticalQty: number;
  physicalQty: number | null;
  difference: number;
  lossQty: number;
};

/**
 * Container stock is counted in pieces. Never mix with oil litres.
 * Prefer stored `theoreticalQty` when provided so ADJUSTMENT movements
 * do not contaminate totalAdded / sold / damaged counters.
 */
export function computeContainerStockSummary(input: {
  totalAdded: number;
  totalSoldEmpty: number;
  totalConsumedInOil: number;
  totalDamaged?: number;
  physicalQty?: number | null;
  theoreticalQty?: number | null;
}): ContainerStockSummary {
  const totalAdded = Math.trunc(Number(input.totalAdded) || 0);
  const totalSoldEmpty = Math.trunc(Number(input.totalSoldEmpty) || 0);
  const totalConsumedInOil = Math.trunc(Number(input.totalConsumedInOil) || 0);
  const totalDamaged = Math.trunc(Number(input.totalDamaged) || 0);
  const theoreticalQty =
    input.theoreticalQty == null || input.theoreticalQty === undefined
      ? totalAdded - totalSoldEmpty - totalConsumedInOil - totalDamaged
      : Math.trunc(Number(input.theoreticalQty));
  const physicalQty =
    input.physicalQty == null || input.physicalQty === undefined
      ? null
      : Math.trunc(Number(input.physicalQty));
  const difference = physicalQty == null ? 0 : physicalQty - theoreticalQty;
  const lossQty = physicalQty == null ? 0 : Math.max(0, theoreticalQty - physicalQty);
  return {
    totalAdded,
    totalSoldEmpty,
    totalConsumedInOil,
    totalDamaged,
    theoreticalQty,
    physicalQty,
    difference,
    lossQty,
  };
}
