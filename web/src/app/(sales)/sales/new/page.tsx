'use client';

import { FormEvent, KeyboardEvent, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Droplet, Lock, Pause, Play, Plus, Printer, Search, Trash2, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  OIL_SOURCES,
  OIL_TYPES,
  oilMeta,
  oilSourceMeta,
  type OilSourceValue,
  type OilTypeValue,
} from '@/lib/sales-nav';
import { previewSaleFromLines } from '@/lib/sales-math';
import {
  WALK_IN_CUSTOMER_LABEL,
  cartLineAssistance,
  cartLineLitres,
  cartLineNet,
  cartLineSubtotal,
  cartToApiItems,
  holdItemsToCartLines,
  repriceCart,
  resolveLinePrice,
  setCartLineAssistance,
  type CartLine,
  type HoldPayloadItem,
  type PriceLocks,
  type SalePrices,
} from '@/lib/sales-cart';
import { formatNumber, formatMoney, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/lib/auth-store';
import { openOilSaleClientReceipt } from '@/lib/oil-sale-receipt';
import { useDirectPrint } from '@/hooks/use-direct-print';
import { oilSaleClientReceiptRequest } from '@/lib/print-documents';
import { useSeasonReadOnly } from '@/hooks/use-season-read-only';

type Customer = { id: string; name: string; phone?: string | null; address?: string | null };
type StockRow = {
  oilSource: OilSourceValue;
  oilType: OilTypeValue;
  theoreticalQty: number;
  physicalQty: number | null;
};
type Container = {
  id: string;
  name: string;
  capacityL: string | number;
  isActive: boolean;
  unitPrice?: string | number | null;
  stock?: { available: number; theoreticalQty: number; minStock?: number };
};
type HoldRow = {
  id: string;
  holdNumber: number;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  payload: {
    items: HoldPayloadItem[];
    assistanceFixed?: number;
    assistancePerLitre?: number;
    notes?: string | null;
  };
  priceLocks: PriceLocks;
  itemCount: number;
  totalAmount: number;
  createdByName: string | null;
  cashRegisterName: string | null;
  createdAt: string;
  updatedAt: string;
};
type ActiveHold = { id: string; holdNumber: number; priceLocks: PriceLocks };
type ApiError = {
  response?: { status?: number; data?: { message?: string | string[]; code?: string } };
};

const LOW_STOCK_L = 20;
const PRICES_KEY = ['oil-sale-prices'] as const;
const HOLDS_KEY = ['oil-sale-holds'] as const;

const fetchPrices = async () => (await api.get<SalePrices>('/oil-sales/sale-prices')).data;
const fetchContainers = async () => (await api.get<Container[]>('/oil-sales/containers')).data;

function availableQty(row: StockRow | undefined) {
  return row ? Number(row.theoreticalQty) || 0 : 0;
}

function apiMessage(e: ApiError, fallback: string) {
  const msg = e.response?.data?.message;
  return Array.isArray(msg) ? msg.join('\n') : msg || fallback;
}

function timeHm(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function defaultZeroOnBlur(value: string, set: (v: string) => void) {
  if (value.trim() === '' || !Number.isFinite(Number(value))) set('0');
}

export default function NewSalePage() {
  const qc = useQueryClient();
  const { readOnly } = useSeasonReadOnly();
  const canWrite = useAuthStore((s) => s.hasPermission('OIL_SALES_SALES_CREATE'));
  const canSellContainers = useAuthStore((s) => s.hasPermission('OIL_SALES_CONTAINERS_SELL'));
  const canPrint = useAuthStore((s) => s.hasPermission('OIL_SALES_PRINT_RECEIPT'));
  const canOverride = useAuthStore((s) => s.hasPermission('OIL_SALES_STOCK_OVERRIDE'));
  const canOverrideContainers = useAuthStore((s) =>
    s.hasPermission('OIL_SALES_CONTAINER_STOCK_OVERRIDE'),
  );
  const canCustomer = useAuthStore((s) => s.hasPermission('OIL_SALES_CUSTOMERS_CREATE'));
  const canAssistFixed = useAuthStore((s) => s.hasPermission('OIL_SALES_ASSISTANCE_FIXED'));
  const canAssistPerLitre = useAuthStore((s) =>
    s.hasPermission('OIL_SALES_ASSISTANCE_PER_LITRE'),
  );
  const canAllowDebt = useAuthStore((s) => s.hasPermission('OIL_SALES_SALES_ALLOW_DEBT'));

  const [oilSource, setOilSource] = useState<OilSourceValue>('STORED');
  const [oilType, setOilType] = useState<OilTypeValue>('GREEN');
  const [customerId, setCustomerId] = useState('');
  const [customerQ, setCustomerQ] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [method, setMethod] = useState<'CONTAINER' | 'LOOSE' | 'CONTAINER_ONLY'>(
    canWrite ? 'LOOSE' : 'CONTAINER_ONLY',
  );
  const [pickedContainerId, setContainerId] = useState('');
  const [containerCount, setContainerCount] = useState('1');
  const [looseQty, setLooseQty] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  // Assistance of the line being composed — it is captured INTO that line when added
  // and reset afterwards, so the next oil never inherits it.
  const [draftAssistPerLitre, setDraftAssistPerLitre] = useState('0');
  const [draftAssistFixed, setDraftAssistFixed] = useState('0');
  const [notes, setNotes] = useState('');
  const [overrideStock, setOverrideStock] = useState(false);
  const [overrideContainerStock, setOverrideContainerStock] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [paymentMode, setPaymentMode] = useState<'full' | 'partial' | 'later'>('full');
  const [amountPaidNow, setAmountPaidNow] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [oilPanelOpen, setOilPanelOpen] = useState(false);
  const [activeHold, setActiveHold] = useState<ActiveHold | null>(null);
  const [lastSale, setLastSale] = useState<{ id: string; receiptNumber: number } | null>(null);
  const [printedSaleIds, setPrintedSaleIds] = useState<Set<string>>(() => new Set());
  const uid = useId();
  const { print: directPrint, busy: printing, settings: printSettings } = useDirectPrint();

  function printReceipt(saleId: string, isReprint: boolean) {
    setPrintedSaleIds((prev) => new Set(prev).add(saleId));
    return directPrint(oilSaleClientReceiptRequest(saleId, { isReprint }), {
      browserFallback: () => openOilSaleClientReceipt(saleId, { autoPrint: true }),
    });
  }

  const pricesQ = useQuery({ queryKey: PRICES_KEY, queryFn: fetchPrices });

  const stockQ = useQuery({
    queryKey: ['oil-sales-stock'],
    queryFn: async () => (await api.get<StockRow[]>('/oil-sales/stock')).data,
  });

  const containersQ = useQuery({ queryKey: ['oil-containers'], queryFn: fetchContainers });

  const holdsQ = useQuery({
    queryKey: HOLDS_KEY,
    queryFn: async () => (await api.get<HoldRow[]>('/oil-sales/holds')).data,
    refetchInterval: 15_000,
  });

  const customersQ = useQuery({
    queryKey: ['oil-sales-customers', customerQ],
    enabled: customerQ.trim().length >= 1 && !selectedCustomer,
    queryFn: async () =>
      (
        await api.get<{ items: Customer[] }>('/oil-sales/customers', {
          params: { q: customerQ.trim(), limit: 20 },
        })
      ).data.items,
  });

  const cashQ = useQuery({
    queryKey: ['oil-sales-cash-current'],
    queryFn: async () =>
      (
        await api.get<{
          register: { name: string; code: string } | null;
          session: { status: string } | null;
        }>('/oil-sales/cash/current')
      ).data,
  });

  const stockRows = stockQ.data ?? [];
  const stock = stockRows.find((s) => s.oilSource === oilSource && s.oilType === oilType);
  const stockAvailable = availableQty(stock);
  const sourceMeta = oilSourceMeta(oilSource);
  const meta = oilMeta(oilType);
  const containers = useMemo(() => containersQ.data ?? [], [containersQ.data]);
  const containerId = pickedContainerId || containers[0]?.id || '';
  const holds = holdsQ.data ?? [];
  const priceLocks = activeHold?.priceLocks ?? null;

  const selectedContainer = containers.find((c) => c.id === containerId);
  /** Read-only price of the selected oil — captured into each line when it is added. */
  const oilPrice = resolveLinePrice({ kind: 'LOOSE', oilType }, pricesQ.data, containers, priceLocks);
  const oilPriceLocked =
    priceLocks?.[`OIL:${oilType}`] != null &&
    Number(priceLocks[`OIL:${oilType}`]) !==
      resolveLinePrice({ kind: 'LOOSE', oilType }, pricesQ.data, containers, null);
  const emptyPrice = selectedContainer
    ? resolveLinePrice(
        { kind: 'CONTAINER_ONLY', containerId: selectedContainer.id },
        pricesQ.data,
        containers,
        priceLocks,
      )
    : null;
  const liveContainerLitres =
    selectedContainer && Number(containerCount) >= 1
      ? Number(selectedContainer.capacityL) * Number(containerCount)
      : 0;

  const draftPerLitre = canAssistPerLitre ? Number(draftAssistPerLitre || 0) : 0;
  const draftFixed = canAssistFixed ? Number(draftAssistFixed || 0) : 0;

  const draftLine = useMemo((): CartLine | null => {
    const key = `${uid}-draft`;
    const draftAssistance = { assistancePerLitre: draftPerLitre, assistanceFixed: draftFixed };
    if (method === 'LOOSE') {
      const qty = Number(looseQty);
      if (!(qty > 0) || oilPrice == null) return null;
      return {
        key,
        kind: 'LOOSE',
        oilSource,
        oilType,
        quantityL: qty,
        unitPrice: oilPrice,
        ...draftAssistance,
      };
    }
    if (method === 'CONTAINER') {
      const c = selectedContainer;
      const count = Number(containerCount);
      if (!c || !(count >= 1) || oilPrice == null) return null;
      return {
        key,
        kind: 'CONTAINER',
        oilSource,
        oilType,
        containerId: c.id,
        containerName: c.name,
        capacityL: Number(c.capacityL),
        containerCount: count,
        unitPrice: oilPrice,
        ...draftAssistance,
      };
    }
    const c = selectedContainer;
    const count = Number(containerCount);
    if (!c || !(count >= 1) || emptyPrice == null) return null;
    return {
      key,
      kind: 'CONTAINER_ONLY',
      containerId: c.id,
      containerName: c.name,
      capacityL: Number(c.capacityL),
      containerCount: count,
      unitPrice: emptyPrice,
      containerPrice: emptyPrice,
    };
  }, [
    method,
    looseQty,
    oilPrice,
    emptyPrice,
    oilSource,
    oilType,
    selectedContainer,
    containerCount,
    uid,
    draftPerLitre,
    draftFixed,
  ]);

  // Cart lines are never repriced from the currently selected oil.
  const composedLines = useMemo(
    () => (draftLine ? [...lines, draftLine] : lines),
    [lines, draftLine],
  );

  // Assistance lives on each line (its own litres × its own rate + its own fixed amount).
  const preview = previewSaleFromLines(composedLines);
  const draftLineAssistance = draftLine ? cartLineAssistance(draftLine) : 0;
  const draftLineTooMuchAssistance =
    draftLine != null && draftLineAssistance > cartLineSubtotal(draftLine);

  const debtAllowedHere = canAllowDebt && !!customerId;
  const paidNow = preview
    ? !debtAllowedHere || paymentMode === 'full'
      ? preview.finalAmount
      : paymentMode === 'later'
        ? 0
        : Math.min(Math.max(0, Number(amountPaidNow || 0)), preview.finalAmount)
    : 0;
  const remainingDebt = preview ? Math.max(0, preview.finalAmount - paidNow) : 0;

  const oilNeeded = useMemo(
    () =>
      composedLines
        .filter((l) => l.kind !== 'CONTAINER_ONLY')
        .filter((l) => l.oilSource === oilSource && l.oilType === oilType)
        .reduce((s, l) => {
          if (l.kind === 'LOOSE') return s + Number(l.quantityL ?? 0);
          return s + Number(l.capacityL ?? 0) * Number(l.containerCount ?? 0);
        }, 0),
    [composedLines, oilSource, oilType],
  );

  const qtyExceedsStock =
    method !== 'CONTAINER_ONLY' && oilNeeded > stockAvailable + 1e-9 && !overrideStock;

  const assistTooLarge = preview == null && composedLines.length > 0;

  const createCustomer = useMutation({
    mutationFn: async () =>
      (
        await api.post<Customer>('/oil-sales/customers', {
          name: newName.trim(),
          phone: newPhone.trim() || undefined,
          address: newAddress.trim() || undefined,
        })
      ).data,
    onSuccess: (c) => {
      toast.success('تم إنشاء الزبون');
      pickCustomer(c);
      setShowNewCustomer(false);
      setNewName('');
      setNewPhone('');
      setNewAddress('');
      void qc.invalidateQueries({ queryKey: ['oil-sales-customers'] });
    },
    onError: (e: ApiError) => toast.error(apiMessage(e, 'تعذر إنشاء الزبون')),
  });

  function pickCustomer(c: Customer | null) {
    setCustomerId(c?.id ?? '');
    setSelectedCustomer(c);
    setCustomerQ(c?.name ?? '');
    if (!c) setPaymentMode('full');
  }

  function selectOil(source: OilSourceValue, type: OilTypeValue) {
    if (method === 'CONTAINER_ONLY') return;
    const row = stockRows.find((s) => s.oilSource === source && s.oilType === type);
    const qty = availableQty(row);
    if (qty <= 0 && !canOverride && !overrideStock) {
      toast.error('هذا الزيت غير متوفر');
      return;
    }
    setOilSource(source);
    setOilType(type);
    setOilPanelOpen(false);
  }

  function addLine() {
    if (!draftLine) {
      if (method !== 'CONTAINER_ONLY' && oilPrice == null) {
        toast.error('لا يوجد سعر بيع مضبوط لهذا الزيت — حدده من الإعدادات');
      } else if (method === 'CONTAINER_ONLY' && selectedContainer && emptyPrice == null) {
        toast.error('لا يوجد سعر بيع لهذا الضلف — حدده من صفحة الضلف');
      } else if (method === 'LOOSE') toast.error('أدخل كمية اللترات');
      else if (method === 'CONTAINER_ONLY') toast.error('اختر الضلف والعدد');
      else toast.error('اختر التعبئة وعدد الضلف');
      return;
    }
    if (method === 'CONTAINER_ONLY' && !canSellContainers) {
      toast.error('ليس لديك صلاحية بيع الضلف فارغة');
      return;
    }
    if (method !== 'CONTAINER_ONLY' && !canWrite) {
      toast.error('ليس لديك صلاحية بيع الزيت');
      return;
    }
    if (method !== 'CONTAINER_ONLY' && stockAvailable <= 0 && !overrideStock && !canOverride) {
      toast.error('المخزون غير متوفر');
      return;
    }
    if (draftLineTooMuchAssistance) {
      toast.error('مساعدة هذا السطر تتجاوز مبلغه');
      return;
    }
    setLines((prev) => [...prev, { ...draftLine, key: `${uid}-${Date.now()}` }]);
    if (method === 'LOOSE') setLooseQty('');
    else setContainerCount('1');
    // The assistance belongs to the line just added; start the next line clean.
    setDraftAssistPerLitre('0');
    setDraftAssistFixed('0');
  }

  function updateLineAssistance(
    key: string,
    field: 'assistancePerLitre' | 'assistanceFixed',
    raw: string,
  ) {
    const n = Number(raw);
    const value = Number.isFinite(n) && n >= 0 ? n : 0;
    setLines((prev) => setCartLineAssistance(prev, key, { [field]: value }));
  }

  function onQtyKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addLine();
  }

  function resetForm() {
    setLines([]);
    setLooseQty('');
    setContainerCount('1');
    setDraftAssistPerLitre('0');
    setDraftAssistFixed('0');
    setNotes('');
    setOverrideStock(false);
    setOverrideContainerStock(false);
    setPaymentMode('full');
    setAmountPaidNow('');
    setShowNewCustomer(false);
    pickCustomer(null);
    setActiveHold(null);
  }

  function holdBody() {
    return {
      customerId: customerId || undefined,
      items: cartToApiItems(composedLines),
      notes: notes.trim() || undefined,
    };
  }

  const saveHold = useMutation({
    mutationFn: async () => {
      const body = holdBody();
      if (activeHold) {
        try {
          return (await api.put<HoldRow>(`/oil-sales/holds/${activeHold.id}`, body)).data;
        } catch (e) {
          if ((e as ApiError).response?.status !== 404) throw e;
        }
      }
      return (await api.post<HoldRow>('/oil-sales/holds', body)).data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: HOLDS_KEY });
    },
  });

  async function putOnHold(opts?: { silent?: boolean }) {
    if (!composedLines.length) {
      if (!opts?.silent) toast.error('لا توجد أسطر لتعليقها');
      return false;
    }
    try {
      const h = await saveHold.mutateAsync();
      resetForm();
      toast.success(`تم تعليق البيع #${h.holdNumber}`);
      return true;
    } catch (e) {
      toast.error(apiMessage(e as ApiError, 'تعذر تعليق البيع'));
      return false;
    }
  }

  async function resumeHold(h: HoldRow) {
    if (activeHold?.id === h.id) return;
    if (composedLines.length) {
      const ok = await putOnHold({ silent: true });
      if (!ok) return;
    }
    setLines(holdItemsToCartLines(h.payload.items ?? [], `${uid}-h${h.id}-${h.updatedAt}`));
    pickCustomer(
      h.customerId ? { id: h.customerId, name: h.customerName ?? '', phone: h.customerPhone } : null,
    );
    setDraftAssistPerLitre('0');
    setDraftAssistFixed('0');
    setNotes(h.payload.notes ?? '');
    setLooseQty('');
    setContainerCount('1');
    setPaymentMode('full');
    setActiveHold({ id: h.id, holdNumber: h.holdNumber, priceLocks: h.priceLocks ?? {} });
  }

  const deleteHold = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/oil-sales/holds/${id}`)).data,
    onSuccess: (_r, id) => {
      toast.success('تم حذف البيع المعلّق');
      if (activeHold?.id === id) resetForm();
      void qc.invalidateQueries({ queryKey: HOLDS_KEY });
    },
    onError: (e: ApiError) => toast.error(apiMessage(e, 'تعذر حذف البيع المعلّق')),
  });

  const createSale = useMutation({
    mutationFn: async (_print: boolean) =>
      (
        await api.post('/oil-sales/sales', {
          customerId: customerId || undefined,
          holdId: activeHold?.id,
          items: cartToApiItems(composedLines),
          amountPaid: paidNow,
          notes: notes.trim() || undefined,
          overrideStock,
          overrideContainerStock,
        })
      ).data as { id: string; receiptNumber: number },
    onSuccess: (sale, print) => {
      toast.success(`تم البيع #${sale.receiptNumber}`);
      void qc.invalidateQueries({ queryKey: ['oil-sales-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['oil-sales-stock'] });
      void qc.invalidateQueries({ queryKey: ['oil-containers'] });
      void qc.invalidateQueries({ queryKey: ['oil-sales-list'] });
      void qc.invalidateQueries({ queryKey: ['oil-debts'] });
      void qc.invalidateQueries({ queryKey: ['oil-debts-summary'] });
      void qc.invalidateQueries({ queryKey: HOLDS_KEY });
      // The sale is committed; printing runs after and can never undo it.
      resetForm();
      setLastSale(sale);
      if (canPrint && (print || printSettings.autoPrintAfterSale)) {
        void printReceipt(sale.id, false);
      }
    },
    onError: async (e: ApiError) => {
      if (e.response?.status === 409 && e.response.data?.code === 'PRICE_CHANGED') {
        const [freshPrices, freshContainers] = await Promise.all([
          qc.fetchQuery({ queryKey: PRICES_KEY, queryFn: fetchPrices, staleTime: 0 }),
          qc.fetchQuery({ queryKey: ['oil-containers'], queryFn: fetchContainers, staleTime: 0 }),
        ]);
        setLines((prev) => repriceCart(prev, freshPrices, freshContainers, priceLocks));
        toast.warning(apiMessage(e, 'تغيّرت الأسعار — راجع المجموع ثم أعد المحاولة'));
        return;
      }
      toast.error(apiMessage(e, 'تعذر إتمام البيع'));
    },
  });

  function onSubmit(e: FormEvent, print: boolean) {
    e.preventDefault();
    if (createSale.isPending) return;
    if (!preview) {
      toast.error('أدخل الكمية وتحقق من المساعدة');
      return;
    }
    if (qtyExceedsStock) {
      toast.error('الكمية تتجاوز المخزون المتوفر');
      return;
    }
    if (remainingDebt > 0 && !canAllowDebt) {
      toast.error('ليس لديك صلاحية البيع بالدين');
      return;
    }
    if (remainingDebt > 0 && !customerId) {
      toast.error('البيع بالدين يتطلب اختيار زبون مسجّل');
      return;
    }
    if (paymentMode === 'partial' && !(Number(amountPaidNow) >= 0)) {
      toast.error('أدخل المبلغ المدفوع');
      return;
    }
    createSale.mutate(print);
  }

  if ((!canWrite && !canSellContainers) || readOnly) {
    return (
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-center">
        <p className="font-bold">ليس لديك صلاحية إنشاء بيع</p>
        <Link href="/sales" className="mt-4 inline-block text-amber-800 underline">
          العودة
        </Link>
      </div>
    );
  }

  const oilPanelDisabled = method === 'CONTAINER_ONLY';
  const showOilFields = method !== 'CONTAINER_ONLY';
  const emptyLineTotal =
    method === 'CONTAINER_ONLY' && Number(containerCount) >= 1 && emptyPrice != null
      ? Number(containerCount) * emptyPrice
      : 0;
  const busy = createSale.isPending || saveHold.isPending;
  const oilPriceLabel = oilPrice == null ? 'غير مضبوط' : `${formatMoney(oilPrice)} د.ج`;

  const oilPanel = (
    <OilSelectionPanel
      stockRows={stockRows}
      selectedSource={oilSource}
      selectedType={oilType}
      disabled={oilPanelDisabled}
      canOverride={canOverride || overrideStock}
      onSelect={selectOil}
    />
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-amber-800 dark:text-amber-400">نقطة البيع</p>
          <h1 className="text-2xl font-black">
            {activeHold ? `استئناف البيع المعلّق #${activeHold.holdNumber}` : 'بيع جديد'}
          </h1>
        </div>
        {cashQ.data?.session && cashQ.data.register ? (
          <p className="text-sm text-[var(--app-text-dim)]">
            الصندوق: {cashQ.data.register.name} ({cashQ.data.register.code})
          </p>
        ) : null}
      </div>

      <WaitingSales
        holds={holds}
        activeHoldId={activeHold?.id ?? null}
        busy={busy || deleteHold.isPending}
        onResume={(h) => void resumeHold(h)}
        onDelete={(id) => deleteHold.mutate(id)}
      />

      {/* Mobile oil picker */}
      {!oilPanelDisabled ? (
        <div className="lg:hidden">
          <button
            type="button"
            onClick={() => setOilPanelOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5 text-sm"
          >
            <span className="font-bold">
              {sourceMeta.emoji} {sourceMeta.label} · {meta.emoji} {meta.shortLabel}
            </span>
            <span className="tabular-nums text-[var(--app-text-dim)]">
              {formatNumber(stockAvailable, 1)} لتر
            </span>
          </button>
          {oilPanelOpen ? (
            <div className="mt-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
              {oilPanel}
            </div>
          ) : (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {OIL_SOURCES.flatMap((src) =>
                OIL_TYPES.map((t) => {
                  const row = stockRows.find(
                    (s) => s.oilSource === src.value && s.oilType === t.value,
                  );
                  const qty = availableQty(row);
                  const selected = oilSource === src.value && oilType === t.value;
                  return (
                    <button
                      key={`${src.value}-${t.value}`}
                      type="button"
                      onClick={() => selectOil(src.value, t.value)}
                      className={cn(
                        'min-w-[7.5rem] shrink-0 rounded-xl border px-2.5 py-2 text-right',
                        selected
                          ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/40'
                          : 'border-[var(--app-border)] bg-[var(--app-surface)]',
                      )}
                    >
                      <p className="text-[10px] text-[var(--app-text-dim)]">{src.label}</p>
                      <p className="text-xs font-black" style={{ color: t.color }}>
                        {t.shortLabel}
                      </p>
                      <p className="text-[11px] tabular-nums">{formatNumber(qty, 1)} لتر</p>
                    </button>
                  );
                }),
              )}
            </div>
          )}
        </div>
      ) : null}

      <form
        className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]"
        onSubmit={(e) => onSubmit(e, false)}
      >
        {/* Desktop left oil panel */}
        <aside
          className={cn(
            'hidden lg:block',
            oilPanelDisabled && 'pointer-events-none opacity-40',
          )}
        >
          <div className="sticky top-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
            <p className="mb-3 text-sm font-black">اختيار الزيت</p>
            {oilPanel}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          {/* Customer */}
          <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black">الزبون</h2>
              {canCustomer && !showNewCustomer ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  onClick={() => setShowNewCustomer(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> زبون جديد
                </Button>
              ) : null}
            </div>

            {selectedCustomer ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-700/30 bg-amber-50/50 px-3 py-2 dark:bg-amber-950/20">
                <div>
                  <p className="font-bold">{selectedCustomer.name}</p>
                  <p className="text-xs text-[var(--app-text-dim)]">
                    {[selectedCustomer.phone, selectedCustomer.address].filter(Boolean).join(' · ') ||
                      'بدون هاتف'}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-[var(--app-text-dim)] hover:bg-[var(--app-bg-muted)]"
                  onClick={() => pickCustomer(null)}
                  aria-label="الرجوع إلى زبون عابر"
                  title="الرجوع إلى زبون عابر"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--app-border-strong)] bg-[var(--app-bg-muted)] px-3 py-2">
                  <UserRound className="h-4 w-4 shrink-0 text-[var(--app-text-dim)]" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {WALK_IN_CUSTOMER_LABEL}{' '}
                      <span className="text-xs font-medium text-[var(--app-text-dim)]">
                        · Client comptoir
                      </span>
                    </p>
                    <p className="text-[11px] text-[var(--app-text-dim)]">
                      بيع مباشر بدون زبون — ابحث أدناه لاختيار زبون مسجّل (مطلوب للدين)
                    </p>
                  </div>
                </div>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-text-dim)]" />
                  <input
                    className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] py-2 pr-10 pl-3 text-sm"
                    placeholder="بحث بالاسم أو الهاتف…"
                    value={customerQ}
                    onChange={(e) => setCustomerQ(e.target.value)}
                  />
                </div>
                {customerQ.trim().length >= 1 ? (
                  <div className="max-h-28 overflow-y-auto rounded-xl border border-[var(--app-border)]">
                    {(customersQ.data ?? []).length === 0 && !customersQ.isFetching ? (
                      <p className="px-3 py-2 text-xs text-[var(--app-text-dim)]">لا نتائج</p>
                    ) : (
                      (customersQ.data ?? []).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => pickCustomer(c)}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-[var(--app-bg-muted)]"
                        >
                          <span className="font-bold">{c.name}</span>
                          <span className="text-xs text-[var(--app-text-dim)]">
                            {c.phone || '—'}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </>
            )}

            {canCustomer && showNewCustomer ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  label="اسم الزبون"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Input
                  label="الهاتف"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
                <Input
                  label="العنوان"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                />
                <div className="flex items-end gap-2">
                  <Button
                    type="button"
                    onClick={() => createCustomer.mutate()}
                    loading={createCustomer.isPending}
                    disabled={newName.trim().length < 2}
                  >
                    حفظ
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowNewCustomer(false)}>
                    إلغاء
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          {/* Sale mode */}
          <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3 space-y-3">
            <div
              className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--app-bg-muted)] p-1"
              role="tablist"
              aria-label="نوع البيع"
            >
              {(
                [
                  { id: 'LOOSE' as const, label: 'زيت باللتر', enabled: canWrite },
                  { id: 'CONTAINER' as const, label: 'زيت معبأ', enabled: canWrite },
                  {
                    id: 'CONTAINER_ONLY' as const,
                    label: 'ضلف فقط',
                    enabled: canSellContainers,
                  },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={method === m.id}
                  disabled={!m.enabled}
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    'rounded-lg px-2 py-2 text-xs font-bold transition sm:text-sm',
                    method === m.id
                      ? 'bg-[var(--app-surface)] text-amber-900 shadow-sm dark:text-amber-200'
                      : 'text-[var(--app-text-dim)] hover:text-[var(--app-text)]',
                    !m.enabled && 'opacity-40',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {showOilFields ? (
              <div
                className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: `${sourceMeta.color}44`, background: sourceMeta.soft }}
              >
                <Droplet className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
                <span className="font-bold">
                  {sourceMeta.label} · {meta.label}
                </span>
                <span className="ms-auto tabular-nums text-[var(--app-text-dim)]">
                  المتوفر: {formatNumber(stockAvailable, 1)} لتر
                  {stockAvailable <= 0
                    ? ' — غير متوفر'
                    : stockAvailable <= LOW_STOCK_L
                      ? ' — مخزون منخفض'
                      : ''}
                </span>
              </div>
            ) : (
              <p className="text-xs text-[var(--app-text-dim)]">
                بيع الضلف كمنتج مستقل — بدون خصم من مخزون الزيت
              </p>
            )}

            {/* Primary input row — litre / packaged oil */}
            {method === 'LOOSE' ? (
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <Input
                  id="sale-qty"
                  label="الكمية (لتر)"
                  inputMode="decimal"
                  value={looseQty}
                  onChange={(e) => setLooseQty(e.target.value)}
                  onKeyDown={onQtyKeyDown}
                  error={
                    qtyExceedsStock
                      ? `تتجاوز المخزون (${formatNumber(stockAvailable, 1)} لتر)`
                      : undefined
                  }
                  autoFocus
                />
                <ReadOnlyPrice
                  label="سعر اللتر"
                  value={oilPriceLabel}
                  hint={oilPriceLocked ? 'سعر محفوظ من التعليق' : undefined}
                />
                {canAssistPerLitre ? (
                  <Input
                    id="sale-aid-l"
                    label="مساعدة باللتر (هذا السطر)"
                    inputMode="decimal"
                    value={draftAssistPerLitre}
                    onChange={(e) => setDraftAssistPerLitre(e.target.value)}
                    onBlur={() => defaultZeroOnBlur(draftAssistPerLitre, setDraftAssistPerLitre)}
                    hint="دج / لتر — لهذا الزيت فقط"
                  />
                ) : (
                  <div />
                )}
                {canAssistFixed ? (
                  <Input
                    id="sale-aid-fixed"
                    label="مساعدة ثابتة (هذا السطر)"
                    inputMode="decimal"
                    value={draftAssistFixed}
                    onChange={(e) => setDraftAssistFixed(e.target.value)}
                    onBlur={() => defaultZeroOnBlur(draftAssistFixed, setDraftAssistFixed)}
                    hint="دج — لهذا السطر فقط"
                  />
                ) : (
                  <div />
                )}
              </div>
            ) : null}

            {method === 'CONTAINER' ? (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  {containers.map((c) => {
                    const avail = c.stock?.available ?? 0;
                    const low = avail <= (c.stock?.minStock ?? 0);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setContainerId(c.id)}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-right text-sm',
                          containerId === c.id
                            ? 'border-amber-700 ring-2 ring-amber-700/20'
                            : 'border-[var(--app-border)]',
                          low && 'bg-red-50/70 dark:bg-red-950/20',
                        )}
                      >
                        <p className="font-bold">{c.name}</p>
                        <p className="text-xs tabular-nums text-[var(--app-text-dim)]">
                          {formatNumber(Number(c.capacityL), 0)} لتر · {avail} قطعة
                        </p>
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <Input
                    label="عدد الضلف"
                    inputMode="numeric"
                    value={containerCount}
                    onChange={(e) => setContainerCount(e.target.value)}
                    onBlur={() => {
                      if (!(Number(containerCount) >= 1)) setContainerCount('1');
                    }}
                    onKeyDown={onQtyKeyDown}
                  />
                  <ReadOnlyPrice
                    label="سعر اللتر"
                    value={oilPriceLabel}
                    hint={oilPriceLocked ? 'سعر محفوظ من التعليق' : undefined}
                  />
                  {canAssistPerLitre ? (
                    <Input
                      label="مساعدة باللتر (هذا السطر)"
                      inputMode="decimal"
                      value={draftAssistPerLitre}
                      onChange={(e) => setDraftAssistPerLitre(e.target.value)}
                      onBlur={() => defaultZeroOnBlur(draftAssistPerLitre, setDraftAssistPerLitre)}
                      hint="دج / لتر — لهذا الزيت فقط"
                    />
                  ) : (
                    <div />
                  )}
                  {canAssistFixed ? (
                    <Input
                      label="مساعدة ثابتة (هذا السطر)"
                      inputMode="decimal"
                      value={draftAssistFixed}
                      onChange={(e) => setDraftAssistFixed(e.target.value)}
                      onBlur={() => defaultZeroOnBlur(draftAssistFixed, setDraftAssistFixed)}
                      hint="دج — لهذا السطر فقط"
                    />
                  ) : (
                    <div />
                  )}
                </div>
                {liveContainerLitres > 0 ? (
                  <p className="text-sm font-bold text-amber-900 dark:text-amber-300">
                    {containerCount} × {formatNumber(Number(selectedContainer?.capacityL), 0)} لتر ={' '}
                    {formatNumber(liveContainerLitres, 1)} لتر
                  </p>
                ) : null}
                {qtyExceedsStock ? (
                  <p className="text-xs font-medium text-red-700">
                    الكمية تتجاوز المخزون ({formatNumber(stockAvailable, 1)} لتر)
                  </p>
                ) : null}
              </div>
            ) : null}

            {method === 'CONTAINER_ONLY' ? (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  {containers.map((c) => {
                    const avail = c.stock?.available ?? 0;
                    const low = avail <= (c.stock?.minStock ?? 0);
                    const p = resolveLinePrice(
                      { kind: 'CONTAINER_ONLY', containerId: c.id },
                      pricesQ.data,
                      containers,
                      priceLocks,
                    );
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setContainerId(c.id)}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-right text-sm',
                          containerId === c.id
                            ? 'border-amber-700 ring-2 ring-amber-700/20'
                            : 'border-[var(--app-border)]',
                          low && 'bg-red-50/70 dark:bg-red-950/20',
                        )}
                      >
                        <p className="font-bold">{c.name}</p>
                        <p className="text-xs tabular-nums">{avail} قطعة</p>
                        <p className="text-[11px]">
                          {p != null ? `${formatMoney(p)} د.ج` : 'بدون سعر بيع'}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    label="العدد"
                    inputMode="numeric"
                    value={containerCount}
                    onChange={(e) => setContainerCount(e.target.value)}
                    onBlur={() => {
                      if (!(Number(containerCount) >= 1)) setContainerCount('1');
                    }}
                    onKeyDown={onQtyKeyDown}
                  />
                  <ReadOnlyPrice
                    label="سعر القطعة"
                    value={emptyPrice == null ? 'غير مضبوط' : `${formatMoney(emptyPrice)} د.ج`}
                  />
                </div>
                {emptyLineTotal > 0 && emptyPrice != null ? (
                  <p className="text-sm font-bold text-amber-900 dark:text-amber-300">
                    {containerCount} × {formatMoney(emptyPrice)} د.ج ={' '}
                    {formatMoney(emptyLineTotal)} د.ج — بدون زيت
                  </p>
                ) : null}
              </div>
            ) : null}

            {showOilFields && draftLine && draftLineAssistance > 0 ? (
              <p
                className={cn(
                  'text-xs font-bold',
                  draftLineTooMuchAssistance
                    ? 'text-red-700'
                    : 'text-amber-900 dark:text-amber-300',
                )}
              >
                مساعدة هذا السطر:{' '}
                {draftPerLitre > 0
                  ? `${formatMoney(draftPerLitre)} دج × ${formatNumber(cartLineLitres(draftLine), 1)} لتر`
                  : ''}
                {draftPerLitre > 0 && draftFixed > 0 ? ' + ' : ''}
                {draftFixed > 0 ? `${formatMoney(draftFixed)} دج ثابتة` : ''}{' '}
                = {formatMoney(draftLineAssistance)} دج
                {draftLineTooMuchAssistance ? ' — تتجاوز مبلغ السطر' : ''}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" /> إضافة سطر
              </Button>
              <span className="text-[11px] text-[var(--app-text-dim)]">
                Enter في خانة الكمية يضيف السطر
              </span>
            </div>

            {lines.length > 0 ? (
              <ul className="divide-y divide-[var(--app-border)] rounded-xl border border-[var(--app-border)]">
                {lines.map((l) => (
                  <li
                    key={l.key}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-bold">
                        {l.kind === 'CONTAINER_ONLY'
                          ? `${l.containerName ?? 'ضلف'} — بدون زيت`
                          : `${oilSourceMeta(l.oilSource ?? '').emoji} ${oilMeta(l.oilType ?? '').shortLabel}${
                              l.kind === 'CONTAINER' ? ` · ${l.containerName ?? 'تعبئة'}` : ''
                            }`}
                      </p>
                      <p className="text-xs tabular-nums text-[var(--app-text-dim)]">
                        {l.kind === 'CONTAINER_ONLY'
                          ? `${l.containerCount} × ${formatMoney(Number(l.containerPrice ?? l.unitPrice))} د.ج`
                          : l.kind === 'CONTAINER'
                            ? `${l.containerCount} × ${formatNumber(Number(l.capacityL ?? 0), 0)} لتر = ${formatNumber(
                                Number(l.capacityL ?? 0) * Number(l.containerCount ?? 0),
                                1,
                              )} لتر × ${formatMoney(l.unitPrice)} د.ج`
                            : `${formatNumber(Number(l.quantityL ?? 0), 1)} لتر × ${formatMoney(l.unitPrice)} د.ج`}
                      </p>
                      {l.kind !== 'CONTAINER_ONLY' && (canAssistPerLitre || canAssistFixed) ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          {canAssistPerLitre ? (
                            <label className="flex items-center gap-1">
                              <span className="text-[var(--app-text-dim)]">مساعدة/لتر</span>
                              <input
                                className="w-16 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-1.5 py-0.5 text-right tabular-nums"
                                inputMode="decimal"
                                aria-label="مساعدة باللتر لهذا السطر"
                                value={String(l.assistancePerLitre ?? 0)}
                                onChange={(e) =>
                                  updateLineAssistance(l.key, 'assistancePerLitre', e.target.value)
                                }
                              />
                            </label>
                          ) : null}
                          {canAssistFixed ? (
                            <label className="flex items-center gap-1">
                              <span className="text-[var(--app-text-dim)]">ثابتة</span>
                              <input
                                className="w-16 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-1.5 py-0.5 text-right tabular-nums"
                                inputMode="decimal"
                                aria-label="مساعدة ثابتة لهذا السطر"
                                value={String(l.assistanceFixed ?? 0)}
                                onChange={(e) =>
                                  updateLineAssistance(l.key, 'assistanceFixed', e.target.value)
                                }
                              />
                            </label>
                          ) : null}
                          {cartLineAssistance(l) > 0 ? (
                            <span
                              className={cn(
                                'font-bold tabular-nums',
                                cartLineAssistance(l) > cartLineSubtotal(l)
                                  ? 'text-red-700'
                                  : 'text-amber-900 dark:text-amber-300',
                              )}
                            >
                              − {formatMoney(cartLineAssistance(l))} د.ج
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-left">
                        <span className="block font-black tabular-nums">
                          {formatMoney(cartLineNet(l))} د.ج
                        </span>
                        {cartLineAssistance(l) > 0 ? (
                          <span className="block text-[11px] tabular-nums text-[var(--app-text-dim)] line-through">
                            {formatMoney(cartLineSubtotal(l))}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                        className="rounded-lg p-1 text-red-600 hover:bg-red-50"
                        aria-label="حذف السطر"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Summary */}
          <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
            <h3 className="mb-3 text-sm font-black">ملخص الحساب</h3>
            {preview ? (
              <dl className="space-y-1.5 text-sm">
                {preview.quantityL > 0 ? (
                  <SummaryLine
                    label="إجمالي الزيت"
                    value={`${formatNumber(preview.quantityL, 1)} لتر`}
                  />
                ) : (
                  <SummaryLine label="النوع" value="ضلف فقط — بدون زيت" />
                )}
                <SummaryLine
                  label="المبلغ الإجمالي"
                  value={`${formatMoney(preview.grossAmount)} د.ج`}
                />
                {canAssistPerLitre ? (
                  <SummaryLine
                    label="مساعدة اللتر"
                    value={`− ${formatMoney(preview.assistancePerLitreTotal)} د.ج`}
                  />
                ) : null}
                {canAssistFixed ? (
                  <SummaryLine
                    label="مساعدة ثابتة"
                    value={`− ${formatMoney(preview.assistanceFixed)} د.ج`}
                  />
                ) : null}
                <div className="border-t border-[var(--app-border)] pt-1.5">
                  <SummaryLine
                    label="إجمالي المساعدات"
                    value={`− ${formatMoney(preview.totalAssistance)} د.ج`}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-600/25 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-950/30">
                  <span className="text-base font-black text-emerald-900 dark:text-emerald-200">
                    الصافي للدفع
                  </span>
                  <span className="text-2xl font-black tabular-nums text-emerald-800 dark:text-emerald-300">
                    {formatMoney(preview.finalAmount)} د.ج
                  </span>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-[var(--app-text-dim)]">
                أدخل الكمية لعرض الحساب
                {assistTooLarge ? ' — تحقق من قيم المساعدة' : ''}
              </p>
            )}
          </section>

          {preview ? (
            <section className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
              <h3 className="text-sm font-black">الدفع</h3>
              {canAllowDebt ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ['full', 'دفع كامل'],
                        ['partial', 'دفع جزئي'],
                        ['later', 'الدفع لاحقاً'],
                      ] as const
                    ).map(([mode, label]) => {
                      const disabled = mode !== 'full' && !customerId;
                      return (
                        <button
                          key={mode}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setPaymentMode(mode);
                            if (mode === 'partial' && paymentMode !== 'partial') {
                              setAmountPaidNow(String(preview.finalAmount));
                            }
                          }}
                          className={cn(
                            'rounded-xl border px-2 py-2.5 text-sm font-bold',
                            paymentMode === mode
                              ? 'border-amber-700 bg-amber-50 text-amber-900'
                              : 'border-[var(--app-border)]',
                            disabled && 'cursor-not-allowed opacity-40',
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {!customerId ? (
                    <p className="text-xs text-[var(--app-text-dim)]">
                      الزبون العابر يدفع كامل المبلغ — اختر زبوناً مسجّلاً للبيع بالدين
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-[var(--app-text-dim)]">
                  البيع نقداً بالكامل (لا صلاحية دين)
                </p>
              )}
              {debtAllowedHere && paymentMode === 'partial' ? (
                <Input
                  label="المبلغ المدفوع الآن"
                  inputMode="decimal"
                  value={amountPaidNow}
                  onChange={(e) => setAmountPaidNow(e.target.value)}
                  onBlur={() => defaultZeroOnBlur(amountPaidNow, setAmountPaidNow)}
                />
              ) : null}
              <dl className="space-y-1.5 text-sm">
                <SummaryLine label="الصافي" value={`${formatMoney(preview.finalAmount)} د.ج`} />
                <SummaryLine label="المدفوع الآن" value={`${formatMoney(paidNow)} د.ج`} />
                <div
                  className={cn(
                    'mt-2 flex items-center justify-between rounded-xl border px-4 py-3',
                    remainingDebt > 0
                      ? 'border-amber-600/30 bg-amber-50 dark:bg-amber-950/30'
                      : 'border-emerald-600/25 bg-emerald-50 dark:bg-emerald-950/30',
                  )}
                >
                  <span className="font-black">المتبقي على الزبون</span>
                  <span className="text-xl font-black tabular-nums">
                    {formatMoney(remainingDebt)} د.ج
                  </span>
                </div>
              </dl>
            </section>
          ) : null}

          <Input label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />

          {canOverride && showOilFields ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={overrideStock}
                onChange={(e) => setOverrideStock(e.target.checked)}
              />
              تجاوز مخزون الزيت (لتر)
            </label>
          ) : null}
          {canOverrideContainers &&
          (method === 'CONTAINER' || method === 'CONTAINER_ONLY' || lines.some((l) => l.kind !== 'LOOSE')) ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={overrideContainerStock}
                onChange={(e) => setOverrideContainerStock(e.target.checked)}
              />
              تجاوز مخزون الضلف (قطعة)
            </label>
          ) : null}

          {lastSale && canPrint ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-600/25 bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950/30">
              <span>
                آخر بيع: <strong className="tabular-nums">#{lastSale.receiptNumber}</strong>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={printing}
                onClick={() =>
                  void printReceipt(lastSale.id, printedSaleIds.has(lastSale.id))
                }
              >
                <Printer className="h-4 w-4" />
                {printedSaleIds.has(lastSale.id)
                  ? 'إعادة الطباعة · Réimprimer'
                  : 'طباعة الوصل · Imprimer'}
              </Button>
            </div>
          ) : null}

          {/* Actions */}
          <div className="sticky bottom-2 z-10 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]/95 p-3 shadow-lg backdrop-blur sm:grid-cols-4">
            <Button
              type="button"
              className="gap-2 bg-amber-700 py-5 text-base hover:bg-amber-800"
              loading={createSale.isPending}
              disabled={!preview || qtyExceedsStock || busy}
              onClick={(e) => onSubmit(e as unknown as FormEvent, false)}
            >
              إتمام البيع
            </Button>
            {canPrint ? (
              <Button
                type="button"
                variant="outline"
                className="gap-2 py-5 text-base"
                loading={createSale.isPending}
                disabled={!preview || qtyExceedsStock || busy}
                onClick={(e) => onSubmit(e as unknown as FormEvent, true)}
              >
                <Printer className="h-4 w-4" />
                إتمام وطباعة
              </Button>
            ) : (
              <div className="hidden sm:block" />
            )}
            <Button
              type="button"
              variant="outline"
              className="gap-2 border-amber-600/50 py-5 text-base text-amber-900 dark:text-amber-200"
              loading={saveHold.isPending}
              disabled={!composedLines.length || busy}
              onClick={() => void putOnHold()}
              title="Mettre en attente"
            >
              <Pause className="h-4 w-4" />
              تعليق
            </Button>
            <Button type="button" variant="ghost" className="py-5 text-base" onClick={resetForm}>
              {activeHold ? 'إغلاق (يبقى معلّقاً)' : 'إلغاء'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function WaitingSales({
  holds,
  activeHoldId,
  busy,
  onResume,
  onDelete,
}: {
  holds: HoldRow[];
  activeHoldId: string | null;
  busy: boolean;
  onResume: (h: HoldRow) => void;
  onDelete: (id: string) => void;
}) {
  const waiting = holds.length;
  return (
    <section
      className={cn(
        'rounded-2xl border p-3',
        waiting > 0
          ? 'border-amber-500/60 bg-amber-50/60 dark:bg-amber-950/20'
          : 'border-[var(--app-border)] bg-[var(--app-surface)]',
      )}
      aria-label="البيوع المعلّقة"
    >
      <div className="flex items-center gap-2">
        <Pause className="h-4 w-4 text-amber-700" />
        <h2 className="text-sm font-black">
          البيوع المعلّقة <span className="font-medium text-[var(--app-text-dim)]">· Ventes en attente</span>
        </h2>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-black tabular-nums',
            waiting > 0
              ? 'bg-amber-600 text-white'
              : 'bg-[var(--app-bg-muted)] text-[var(--app-text-dim)]',
          )}
        >
          {waiting}
        </span>
      </div>
      {waiting === 0 ? (
        <p className="mt-1 text-xs text-[var(--app-text-dim)]">
          لا توجد بيوع معلّقة — استعمل «تعليق» لخدمة زبون آخر دون فقدان البيع الحالي
        </p>
      ) : (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {holds.map((h) => {
            const active = h.id === activeHoldId;
            return (
              <div
                key={h.id}
                className={cn(
                  'min-w-[13rem] shrink-0 rounded-xl border bg-[var(--app-surface)] p-2.5 text-sm',
                  active ? 'border-amber-700 ring-2 ring-amber-700/25' : 'border-[var(--app-border)]',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-black">#{h.holdNumber}</span>
                  <span className="flex items-center gap-1 text-[11px] tabular-nums text-[var(--app-text-dim)]">
                    <Clock className="h-3 w-3" />
                    {timeHm(h.createdAt)}
                  </span>
                </div>
                <p className="mt-1 truncate font-bold">{h.customerName || WALK_IN_CUSTOMER_LABEL}</p>
                <p className="truncate text-[11px] text-[var(--app-text-dim)]">
                  {[h.createdByName, `${h.itemCount} سطر`].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-1 text-base font-black tabular-nums">
                  {formatMoney(h.totalAmount)} د.ج
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  {active ? (
                    <span className="flex-1 rounded-lg bg-amber-100 px-2 py-1 text-center text-xs font-bold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      قيد التنفيذ
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 flex-1 gap-1 bg-amber-700 hover:bg-amber-800"
                      disabled={busy}
                      onClick={() => onResume(h)}
                      title="Reprendre"
                    >
                      <Play className="h-3.5 w-3.5" /> استئناف
                    </Button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDelete(h.id)}
                    className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/30"
                    aria-label="حذف البيع المعلّق"
                    title="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReadOnlyPrice({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="space-y-2">
      <p className="block text-sm font-semibold text-[var(--app-text-muted)]">{label}</p>
      <div
        className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-[var(--app-border-strong)] bg-[var(--app-bg-muted)] px-[var(--space-input-x)] py-[var(--space-input-y)] text-sm font-black tabular-nums"
        title="السعر يُحدَّد من إعدادات المنتجات فقط"
        aria-readonly="true"
      >
        <span>{value}</span>
        <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-dim)]" />
      </div>
      <p className="text-xs text-[var(--app-text-dim)]">{hint ?? 'من إعدادات المنتجات'}</p>
    </div>
  );
}

function OilSelectionPanel({
  stockRows,
  selectedSource,
  selectedType,
  disabled,
  canOverride,
  onSelect,
}: {
  stockRows: StockRow[];
  selectedSource: OilSourceValue;
  selectedType: OilTypeValue;
  disabled: boolean;
  canOverride: boolean;
  onSelect: (source: OilSourceValue, type: OilTypeValue) => void;
}) {
  return (
    <div className={cn('space-y-4', disabled && 'pointer-events-none opacity-50')}>
      {OIL_SOURCES.map((src) => (
        <div key={src.value}>
          <div
            className="mb-2 flex items-center gap-2 border-b border-[var(--app-border)] pb-1.5"
            style={{ borderColor: `${src.color}33` }}
          >
            <span className="text-sm font-black" style={{ color: src.color }}>
              {src.emoji} {src.label}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
            {OIL_TYPES.map((t) => {
              const row = stockRows.find(
                (s) => s.oilSource === src.value && s.oilType === t.value,
              );
              const qty = availableQty(row);
              const selected = selectedSource === src.value && selectedType === t.value;
              const empty = qty <= 0;
              const low = !empty && qty <= LOW_STOCK_L;
              const blocked = empty && !canOverride;

              return (
                <button
                  key={t.value}
                  type="button"
                  disabled={blocked}
                  onClick={() => onSelect(src.value, t.value)}
                  className={cn(
                    'rounded-xl border px-2.5 py-2 text-right transition',
                    selected
                      ? 'border-2 shadow-sm'
                      : 'border-[var(--app-border)] bg-[var(--app-bg)] hover:border-[color-mix(in_srgb,var(--app-accent)_40%,var(--app-border))]',
                    blocked && 'cursor-not-allowed opacity-55',
                    low && !selected && 'border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/15',
                  )}
                  style={
                    selected
                      ? {
                          borderColor: t.color,
                          background: t.soft,
                        }
                      : undefined
                  }
                >
                  <div className="flex items-start gap-1.5">
                    <Droplet
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      style={{ color: t.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-tight" style={{ color: t.color }}>
                        {t.label}
                      </p>
                      <p className="mt-0.5 text-sm font-black tabular-nums">
                        {formatNumber(qty, 1)} لتر
                      </p>
                      <p
                        className={cn(
                          'text-[10px] font-bold',
                          empty
                            ? 'text-red-700 dark:text-red-400'
                            : low
                              ? 'text-amber-800 dark:text-amber-300'
                              : 'text-emerald-700 dark:text-emerald-400',
                        )}
                      >
                        {empty ? 'غير متوفر' : low ? 'مخزون منخفض' : 'متوفر'}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--app-text-muted)]">{label}</dt>
      <dd className="font-bold tabular-nums">{value}</dd>
    </div>
  );
}
