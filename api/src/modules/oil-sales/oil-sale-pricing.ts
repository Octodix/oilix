import { OilType } from '@prisma/client';
import { priceForOilType, type OilPriceSettings } from './oil-catalog';
import {
  roundMoney,
  type SaleLineInput,
  type SaleLineKind,
} from './oil-sales.math';

/**
 * Server-side sale pricing. Selling prices come only from configuration
 * (oil price per type in settings, empty-container price on the container),
 * or from locks captured by the server when a sale was put on hold.
 * Client-submitted prices are only compared, never used.
 */

/** `{ "OIL:GREEN": 900, "CNT:<containerId>": 150 }` */
export type PriceLocks = Record<string, number>;

export type PricingLine = {
  kind: SaleLineKind;
  oilType?: OilType | null;
  containerId?: string | null;
  capacityL?: number;
  containerCount?: number;
  quantityL?: number;
  /** Price the client displayed — compared against the authoritative price. */
  unitPrice?: number | null;
  containerPrice?: number | null;
};

export type PricingContainer = {
  id: string;
  unitPrice?: number | string | { toString(): string } | null;
};

export type PriceMismatch = {
  index: number;
  key: string;
  submitted: number;
  expected: number;
};

export function salePriceKey(line: {
  kind: SaleLineKind;
  oilType?: OilType | null;
  containerId?: string | null;
}): string {
  if (line.kind === 'CONTAINER_ONLY') return `CNT:${line.containerId ?? ''}`;
  return `OIL:${line.oilType ?? ''}`;
}

export function catalogPriceFor(
  line: {
    kind: SaleLineKind;
    oilType?: OilType | null;
    containerId?: string | null;
  },
  settings: OilPriceSettings,
  containers: PricingContainer[],
): number | null {
  if (line.kind === 'CONTAINER_ONLY') {
    const c = containers.find((x) => x.id === line.containerId);
    if (!c || c.unitPrice == null) return null;
    const p = Number(c.unitPrice);
    return Number.isFinite(p) && p >= 0 ? roundMoney(p) : null;
  }
  if (!line.oilType) return null;
  const p = Number(priceForOilType(settings, line.oilType));
  return Number.isFinite(p) && p >= 0 ? roundMoney(p) : null;
}

/** Lock price if the sale was held, else the configured catalog price. */
export function authoritativePrice(
  line: {
    kind: SaleLineKind;
    oilType?: OilType | null;
    containerId?: string | null;
  },
  settings: OilPriceSettings,
  containers: PricingContainer[],
  locks?: PriceLocks | null,
): number {
  const key = salePriceKey(line);
  const locked = locks?.[key];
  if (
    locked != null &&
    Number.isFinite(Number(locked)) &&
    Number(locked) >= 0
  ) {
    return roundMoney(Number(locked));
  }
  const catalog = catalogPriceFor(line, settings, containers);
  if (catalog == null) throw new Error('PRICE_NOT_CONFIGURED');
  return catalog;
}

const PRICE_TOLERANCE = 0.005;

/**
 * Replaces every line price with the authoritative price.
 * Oil lines are always priced per litre (no client-chosen fixed container price).
 */
export function applyAuthoritativePrices(
  lines: PricingLine[],
  settings: OilPriceSettings,
  containers: PricingContainer[],
  locks?: PriceLocks | null,
): {
  lines: Array<SaleLineInput & { key: string }>;
  mismatches: PriceMismatch[];
} {
  const mismatches: PriceMismatch[] = [];
  const priced = lines.map((line, index) => {
    const key = salePriceKey(line);
    const expected = authoritativePrice(line, settings, containers, locks);
    const submittedRaw =
      line.kind === 'CONTAINER_ONLY'
        ? (line.containerPrice ?? line.unitPrice)
        : line.unitPrice;
    if (submittedRaw != null) {
      const submitted = Number(submittedRaw);
      if (
        !Number.isFinite(submitted) ||
        Math.abs(submitted - expected) > PRICE_TOLERANCE
      ) {
        mismatches.push({ index, key, submitted, expected });
      }
    }
    if (line.kind === 'CONTAINER_ONLY') {
      return {
        key,
        kind: line.kind,
        capacityL: line.capacityL,
        containerCount: line.containerCount,
        unitPrice: expected,
        containerPrice: expected,
      };
    }
    return {
      key,
      kind: line.kind,
      capacityL: line.capacityL,
      containerCount: line.containerCount,
      quantityL: line.quantityL,
      unitPrice: expected,
      pricingMode: 'PER_LITRE' as const,
    };
  });
  return { lines: priced, mismatches };
}

export function parsePriceLocks(raw: unknown): PriceLocks {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PriceLocks = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}
