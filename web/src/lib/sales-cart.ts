import type { DraftSaleLine } from './sales-math';

/**
 * POS cart pricing. Prices are read-only on the sales screen: each line captures
 * the configured price of ITS OWN product when added and never takes another
 * line's price. Held sales carry server-captured price locks.
 */

export type SalePrices = {
  priceGreen: number;
  priceTaieb: number;
  priceDrou: number;
  priceZebbouche: number;
};

export type PriceLocks = Record<string, number>;

export type CartLine = DraftSaleLine & {
  key: string;
  oilSource?: string;
  oilType?: string;
};

export type PricedContainer = { id: string; unitPrice?: string | number | null };

export const WALK_IN_CUSTOMER_LABEL = 'زبون عابر';

export function saleCustomerName(customer?: { name?: string | null } | null): string {
  return customer?.name || WALK_IN_CUSTOMER_LABEL;
}

export function cartPriceKey(line: {
  kind: DraftSaleLine['kind'];
  oilType?: string;
  containerId?: string;
}): string {
  if (line.kind === 'CONTAINER_ONLY') return `CNT:${line.containerId ?? ''}`;
  return `OIL:${line.oilType ?? ''}`;
}

export function catalogOilPrice(prices: SalePrices | undefined, oilType: string): number | null {
  if (!prices) return null;
  const map: Record<string, number> = {
    GREEN: prices.priceGreen,
    TAIEB: prices.priceTaieb,
    DROU: prices.priceDrou,
    ZEBBOUCHE: prices.priceZebbouche,
  };
  const p = Number(map[oilType]);
  return Number.isFinite(p) && p >= 0 ? p : null;
}

/** Lock (held sale) first, else the configured price; null when not configured. */
export function resolveLinePrice(
  line: { kind: DraftSaleLine['kind']; oilType?: string; containerId?: string },
  prices: SalePrices | undefined,
  containers: PricedContainer[],
  locks?: PriceLocks | null,
): number | null {
  const locked = locks?.[cartPriceKey(line)];
  if (locked != null && Number.isFinite(Number(locked))) return Number(locked);
  if (line.kind === 'CONTAINER_ONLY') {
    const c = containers.find((x) => x.id === line.containerId);
    if (!c || c.unitPrice == null) return null;
    const p = Number(c.unitPrice);
    return Number.isFinite(p) && p >= 0 ? p : null;
  }
  return line.oilType ? catalogOilPrice(prices, line.oilType) : null;
}

/** After a server PRICE_CHANGED rejection: refresh unlocked lines to the latest catalog. */
export function repriceCart(
  lines: CartLine[],
  prices: SalePrices | undefined,
  containers: PricedContainer[],
  locks?: PriceLocks | null,
): CartLine[] {
  return lines.map((l) => {
    const p = resolveLinePrice(l, prices, containers, locks);
    if (p == null) return l;
    return l.kind === 'CONTAINER_ONLY'
      ? { ...l, unitPrice: p, containerPrice: p }
      : { ...l, unitPrice: p };
  });
}

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function cartLineLitres(line: DraftSaleLine): number {
  if (line.kind === 'CONTAINER_ONLY') return 0;
  return line.kind === 'CONTAINER'
    ? Number(line.capacityL ?? 0) * Number(line.containerCount ?? 0)
    : Number(line.quantityL ?? 0);
}

/** Gross of the line before its assistance. */
export function cartLineSubtotal(line: DraftSaleLine): number {
  if (line.kind === 'CONTAINER_ONLY') {
    return round(Number(line.containerCount ?? 0) * Number(line.containerPrice ?? line.unitPrice));
  }
  return round(cartLineLitres(line) * Number(line.unitPrice));
}

/** Assistance of THIS line only: its litres × its rate + its fixed amount. */
export function cartLineAssistance(line: DraftSaleLine): number {
  return round(
    cartLineLitres(line) * Number(line.assistancePerLitre ?? 0) + Number(line.assistanceFixed ?? 0),
  );
}

export function cartLineNet(line: DraftSaleLine): number {
  return round(cartLineSubtotal(line) - cartLineAssistance(line));
}

/** Replaces the assistance of one cart line; other lines are untouched. */
export function setCartLineAssistance(
  lines: CartLine[],
  key: string,
  patch: { assistancePerLitre?: number; assistanceFixed?: number },
): CartLine[] {
  return lines.map((l) => (l.key === key ? { ...l, ...patch } : l));
}

export type HoldPayloadItem = {
  kind: DraftSaleLine['kind'];
  oilSource?: string | null;
  oilType?: string | null;
  containerId?: string | null;
  containerName?: string | null;
  capacityL?: number | null;
  containerCount?: number | null;
  quantityL?: number | null;
  unitPrice: number;
  containerPrice?: number | null;
  assistancePerLitre?: number | null;
  assistanceFixed?: number | null;
};

/** Restores a held sale exactly as captured (same products, quantities, prices and line assistance). */
export function holdItemsToCartLines(items: HoldPayloadItem[], keyPrefix: string): CartLine[] {
  return items.map((it, i) => {
    const key = `${keyPrefix}-${i}`;
    const assistance = {
      assistancePerLitre: Number(it.assistancePerLitre ?? 0),
      assistanceFixed: Number(it.assistanceFixed ?? 0),
    };
    if (it.kind === 'CONTAINER_ONLY') {
      return {
        key,
        kind: 'CONTAINER_ONLY',
        containerId: it.containerId ?? undefined,
        containerName: it.containerName ?? undefined,
        capacityL: it.capacityL ?? undefined,
        containerCount: it.containerCount ?? 1,
        unitPrice: Number(it.containerPrice ?? it.unitPrice),
        containerPrice: Number(it.containerPrice ?? it.unitPrice),
        ...assistance,
      };
    }
    if (it.kind === 'CONTAINER') {
      return {
        key,
        kind: 'CONTAINER',
        oilSource: it.oilSource ?? undefined,
        oilType: it.oilType ?? undefined,
        containerId: it.containerId ?? undefined,
        containerName: it.containerName ?? undefined,
        capacityL: Number(it.capacityL ?? 0),
        containerCount: Number(it.containerCount ?? 1),
        unitPrice: Number(it.unitPrice),
        ...assistance,
      };
    }
    return {
      key,
      kind: 'LOOSE',
      oilSource: it.oilSource ?? undefined,
      oilType: it.oilType ?? undefined,
      quantityL: Number(it.quantityL ?? 0),
      unitPrice: Number(it.unitPrice),
      ...assistance,
    };
  });
}

/**
 * Payload sent to the API; prices are the displayed ones and are re-checked server-side.
 * Assistance is carried per line so each oil keeps its own rate and fixed amount.
 */
export function cartToApiItems(lines: CartLine[]) {
  return lines.map((l) => ({
    kind: l.kind,
    oilSource: l.kind === 'CONTAINER_ONLY' ? undefined : l.oilSource,
    oilType: l.kind === 'CONTAINER_ONLY' ? undefined : l.oilType,
    containerId: l.containerId,
    containerCount: l.containerCount,
    quantityL: l.kind === 'LOOSE' ? l.quantityL : undefined,
    unitPrice: l.kind === 'CONTAINER_ONLY' ? undefined : l.unitPrice,
    containerPrice: l.kind === 'CONTAINER_ONLY' ? (l.containerPrice ?? l.unitPrice) : undefined,
    assistancePerLitre:
      l.kind === 'CONTAINER_ONLY' ? undefined : Number(l.assistancePerLitre ?? 0) || undefined,
    assistanceFixed: Number(l.assistanceFixed ?? 0) || undefined,
  }));
}
