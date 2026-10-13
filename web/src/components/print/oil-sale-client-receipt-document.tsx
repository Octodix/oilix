import { formatMoney, formatNumber } from '@/lib/utils';
import { oilMeta, oilSourceMeta } from '@/lib/sales-nav';
import type { OilSaleReceiptPayload } from '@/components/print/oil-sale-receipt-document';
import { saleCustomerName } from '@/lib/sales-cart';

const DAYS_FR = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'] as const;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** mer 26/08/2026 07:01:29 AM — matches sample client slips */
function formatClientReceiptDateTime(saleDate: string, saleTime: string) {
  const d = new Date(saleDate);
  if (Number.isNaN(d.getTime())) return `${saleDate} ${saleTime}`;

  const day = DAYS_FR[d.getDay()] ?? '';
  const datePart = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

  const timeRaw = (saleTime || '').trim();
  if (/[AP]M/i.test(timeRaw)) {
    return `${day} ${datePart} ${timeRaw}`;
  }

  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(timeRaw);
  if (m) {
    const h = Number(m[1]);
    const min = m[2];
    const sec = m[3] ?? '00';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${day} ${datePart} ${pad2(h12)}:${min}:${sec} ${ampm}`;
  }

  return `${day} ${datePart} ${timeRaw}`;
}

function receiptRef(n: number) {
  return `VT${String(n).padStart(7, '0')}`;
}

function itemDesignation(item: NonNullable<OilSaleReceiptPayload['sale']['items']>[number]) {
  if (item.kind === 'CONTAINER_ONLY') {
    return item.containerName || 'ضلف';
  }
  const typeLabel = item.oilType ? oilMeta(item.oilType).label : 'زيت';
  if (item.kind === 'CONTAINER' && item.containerName) {
    return `${typeLabel} · ${item.containerName}`;
  }
  return typeLabel;
}

function itemQty(item: NonNullable<OilSaleReceiptPayload['sale']['items']>[number]) {
  if (item.kind === 'CONTAINER_ONLY') {
    return String(item.containerCount ?? 0);
  }
  if (item.kind === 'CONTAINER' && item.containerCount) {
    return `${item.containerCount}×${formatNumber(Number(item.containerCapacityL ?? 0), 0)}ل`;
  }
  return formatNumber(Number(item.quantityL), 1);
}

function itemUnitPrice(item: NonNullable<OilSaleReceiptPayload['sale']['items']>[number]) {
  if (item.kind === 'CONTAINER_ONLY') {
    return formatMoney(Number(item.containerPrice ?? item.unitPrice));
  }
  return formatMoney(Number(item.unitPrice));
}

/**
 * Client-facing delivery slip (وصل تسليم) — table layout like shop thermal slips.
 */
export function OilSaleClientReceiptDocument({ data }: { data: OilSaleReceiptPayload }) {
  const { sale, settings, company } = data;
  const assistance = Number(sale.totalAssistance || 0);
  const remaining = Number(sale.remainingAmount ?? 0);
  const isPaid =
    sale.status === 'COMPLETED' &&
    (sale.paymentStatus === 'PAID' || remaining <= 0);
  const isCancelled = sale.status === 'CANCELLED';
  const cashRegisterLabel = sale.cashRegisterName || sale.cashRegisterCode || null;
  const userLabel =
    sale.createdByName ||
    sale.createdByUsername ||
    [sale.createdBy?.firstName, sale.createdBy?.lastName].filter(Boolean).join(' ') ||
    sale.createdBy?.username ||
    null;
  const deviceLabel = sale.deviceName || sale.deviceCode || null;

  const lines =
    sale.items && sale.items.length > 0
      ? sale.items
      : Number(sale.quantityL) > 0
        ? [
            {
              kind: 'LOOSE' as const,
              quantityL: sale.quantityL,
              unitPrice: sale.unitPrice,
              lineGross: sale.grossAmount,
              oilType: sale.oilType,
              oilSource: sale.oilSource,
            },
          ]
        : [];
  const singleSource =
    new Set(lines.filter((l) => l.kind !== 'CONTAINER_ONLY').map((l) => l.oilSource)).size <= 1;

  return (
    <div
      className="thermal-receipt oil-sale-client-receipt relative mx-auto w-[80mm] bg-white px-2 py-3 text-black"
      dir="rtl"
    >
      <div className="text-center">
        <p className="text-[14px] font-black leading-tight tracking-wide">
          {settings.receiptHeader || company.name || 'OILIX'}
        </p>
        <p className="mt-1 text-[13px] font-black underline decoration-1 underline-offset-2">
          وصل تسليم
        </p>
      </div>

      <div className="mt-3 space-y-0.5 text-center">
        <p className="text-[13px] font-black leading-tight">{saleCustomerName(sale.customer)}</p>
        <p className="font-mono text-[11px] font-bold tracking-wide">
          {receiptRef(sale.receiptNumber)}
        </p>
        <p className="text-[10px] tabular-nums">
          {formatClientReceiptDateTime(sale.saleDate, sale.saleTime)}
        </p>
        {cashRegisterLabel ? (
          <p className="text-[10px]">
            <span className="opacity-70">الصندوق:</span>{' '}
            <span className="font-bold">{cashRegisterLabel}</span>
          </p>
        ) : null}
        {userLabel ? (
          <p className="text-[10px]">
            <span className="opacity-70">المستخدم:</span>{' '}
            <span className="font-bold">{userLabel}</span>
          </p>
        ) : null}
        {deviceLabel ? (
          <p className="text-[10px]">
            <span className="opacity-70">الجهاز:</span>{' '}
            <span className="font-bold">{deviceLabel}</span>
          </p>
        ) : null}
        {sale.oilSource && singleSource ? (
          <p className="text-[10px] opacity-80">{oilSourceMeta(sale.oilSource).label}</p>
        ) : null}
      </div>

      <div className="relative mt-3">
        {isPaid ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          >
            <span className="rotate-[-18deg] border-2 border-red-700 px-3 py-1 text-[22px] font-black tracking-widest text-red-700/80">
              خالص
            </span>
          </div>
        ) : null}

        <table className="oil-client-receipt-table w-full border-collapse text-[10px] leading-tight">
          <thead>
            <tr>
              <th className="oil-client-receipt-th">الرقم</th>
              <th className="oil-client-receipt-th">التعيين</th>
              <th className="oil-client-receipt-th">الكمية</th>
              <th className="oil-client-receipt-th">س. وحدة</th>
              <th className="oil-client-receipt-th">المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((item, i) => (
              <tr key={i}>
                <td className="oil-client-receipt-td tabular-nums">{i + 1}</td>
                <td className="oil-client-receipt-td font-bold">{itemDesignation(item)}</td>
                <td className="oil-client-receipt-td tabular-nums">{itemQty(item)}</td>
                <td className="oil-client-receipt-td tabular-nums">{itemUnitPrice(item)}</td>
                <td className="oil-client-receipt-td tabular-nums">
                  {formatMoney(Number(item.lineGross))}
                </td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td className="oil-client-receipt-td" colSpan={5}>
                  —
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1 text-[11px]">
        <TotalRow label="المجموع" value={formatMoney(Number(sale.grossAmount))} />
        {assistance > 0 ? (
          <TotalRow label="المساعدات" value={formatMoney(assistance)} />
        ) : null}
        <TotalRow label="المجموع الكلي" value={formatMoney(Number(sale.finalAmount))} bold />
        {remaining > 0 ? (
          <TotalRow label="المتبقي" value={formatMoney(remaining)} bold />
        ) : null}
      </div>

      {isCancelled ? (
        <p className="mt-3 text-center text-[12px] font-black">*** ملغى ***</p>
      ) : null}

      {settings.receiptFooter ? (
        <p className="mt-3 text-center text-[10px] font-bold opacity-80">{settings.receiptFooter}</p>
      ) : null}
    </div>
  );
}

function TotalRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${bold ? 'font-black' : 'font-bold'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
