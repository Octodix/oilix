import { formatNumber } from '@/lib/utils';
import { formatDateShortDz } from '@/lib/locale-dz';
import { oilMeta, oilSourceMeta } from '@/lib/sales-nav';
import { saleCustomerName } from '@/lib/sales-cart';

export type OilSaleReceiptPayload = {
  sale: {
    receiptNumber: number;
    oilSource?: string | null;
    oilType?: string | null;
    quantityL: string | number;
    unitPrice: string | number;
    grossAmount: string | number;
    assistanceFixed: string | number;
    assistancePercent: string | number;
    assistancePercentAmount: string | number;
    assistancePerLitre?: string | number;
    assistancePerLitreTotal?: string | number;
    totalAssistance: string | number;
    finalAmount: string | number;
    amountPaid?: string | number;
    remainingAmount?: string | number;
    paymentStatus?: string;
    notes?: string | null;
    saleDate: string;
    saleTime: string;
    status: string;
    customer: { name: string; phone?: string | null } | null;
    createdBy?: { username: string; firstName?: string | null; lastName?: string | null };
    createdByName?: string | null;
    createdByUsername?: string | null;
    deviceCode?: string | null;
    deviceName?: string | null;
    cashRegisterCode?: string | null;
    cashRegisterName?: string | null;
    items?: Array<{
      kind: 'CONTAINER' | 'LOOSE' | 'CONTAINER_ONLY';
      containerName?: string | null;
      containerCapacityL?: string | number | null;
      containerCount?: number | null;
      quantityL: string | number;
      unitPrice: string | number;
      containerPrice?: string | number | null;
      lineGross: string | number;
      oilType?: string | null;
      oilSource?: string | null;
      /** Assistance recorded on this line (per-line rate / fixed). */
      assistancePerLitre?: string | number | null;
      assistanceFixed?: string | number | null;
      lineAssistance?: string | number | null;
    }>;
  };
  settings: {
    receiptHeader: string;
    receiptFooter: string;
  };
  company: {
    name: string;
    phone: string;
    address: string;
  };
};

function money(n: string | number) {
  return formatNumber(Number(n), 2);
}

function litres(n: string | number) {
  return formatNumber(Number(n), 1);
}

export function OilSaleReceiptDocument({ data }: { data: OilSaleReceiptPayload }) {
  const { sale, settings, company } = data;
  const meta = sale.oilType ? oilMeta(sale.oilType) : null;
  const src = sale.oilSource ? oilSourceMeta(sale.oilSource) : null;
  const operator =
    sale.createdByName ||
    sale.createdByUsername ||
    [sale.createdBy?.firstName, sale.createdBy?.lastName].filter(Boolean).join(' ') ||
    sale.createdBy?.username ||
    '—';
  const assistPerLitre = Number(sale.assistancePerLitre ?? 0);
  const assistPerLitreTotal = Number(sale.assistancePerLitreTotal ?? 0);
  const hasOil = Number(sale.quantityL) > 0;
  const oilItems = (sale.items ?? []).filter((i) => i.kind !== 'CONTAINER_ONLY');
  // New sales record assistance on each line; legacy sales only carry sale-level totals.
  const lineLevelAssistance = (sale.items ?? []).some((i) => Number(i.lineAssistance ?? 0) > 0);
  // Header oil/price describe a single-oil sale only; mixed sales show them per line.
  const singleOil =
    new Set(oilItems.map((i) => `${i.oilSource}:${i.oilType}`)).size <= 1 &&
    new Set(oilItems.map((i) => Number(i.unitPrice))).size <= 1;

  return (
    <div className="thermal-receipt oil-sale-receipt mx-auto w-[80mm] bg-white px-2 py-3 text-black" dir="rtl">
      <div className="text-center">
        <p className="text-[15px] font-black leading-tight tracking-wide">
          {settings.receiptHeader || company.name || 'OILIX'}
        </p>
        {company.phone ? <p className="mt-0.5 text-[10px]">{company.phone}</p> : null}
        {company.address ? <p className="text-[9px] leading-snug opacity-80">{company.address}</p> : null}
        <p className="mt-1 text-[11px] font-bold">وصل بيع</p>
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="space-y-0.5 text-[11px]">
        <Row label="رقم الوصل" value={String(sale.receiptNumber).padStart(7, '0')} bold />
        <Row
          label="التاريخ"
          value={`${formatDateShortDz(sale.saleDate)} ${sale.saleTime}`}
        />
        <Row label="الزبون" value={saleCustomerName(sale.customer)} bold />
        {sale.customer?.phone ? <Row label="الهاتف" value={sale.customer.phone} /> : null}
        {sale.cashRegisterName || sale.cashRegisterCode ? (
          <Row label="الصندوق" value={sale.cashRegisterName || sale.cashRegisterCode || ''} />
        ) : null}
        {sale.deviceCode || sale.deviceName ? (
          <Row label="الجهاز" value={sale.deviceCode || sale.deviceName || ''} />
        ) : null}
        <Row label="المشغّل" value={operator} />
        {src && hasOil && singleOil ? <Row label="المصدر" value={src.label} bold /> : null}
        {meta && hasOil && singleOil ? (
          <Row label="نوع الزيت" value={`${meta.emoji} ${meta.label}`} bold />
        ) : null}
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      {sale.items?.length ? (
        <div className="space-y-2 text-[11px]">
          {sale.items.map((item, i) => (
            <div key={i} className="space-y-0.5">
              {item.kind === 'CONTAINER' ? (
                <>
                  <p className="font-bold">
                    {item.oilSource ? `${oilSourceMeta(item.oilSource).label} · ` : ''}
                    {item.oilType ? oilMeta(item.oilType).label : 'زيت'} · {item.containerCount} ×{' '}
                    {item.containerName || 'تعبئة'}
                  </p>
                  <div className="flex justify-between gap-2">
                    <span>
                      {litres(item.quantityL)} لتر
                      {Number(item.unitPrice) > 0 ? `  ${money(item.unitPrice)} د.ج/لتر` : ''}
                    </span>
                    <span className="font-bold tabular-nums">{money(item.lineGross)} د.ج</span>
                  </div>
                </>
              ) : item.kind === 'CONTAINER_ONLY' ? (
                <>
                  <p className="font-bold">{item.containerName || 'ضلف'} — بدون زيت</p>
                  <div className="flex justify-between gap-2">
                    <span>
                      {item.containerCount} × {money(item.containerPrice ?? item.unitPrice)} د.ج
                    </span>
                    <span className="font-bold tabular-nums">{money(item.lineGross)} د.ج</span>
                  </div>
                </>
              ) : (
                <>
                  <p className="font-bold">
                    بيع باللتر
                    {item.oilSource ? ` · ${oilSourceMeta(item.oilSource).label}` : ''}
                    {item.oilType ? ` · ${oilMeta(item.oilType).label}` : ''}
                  </p>
                  <div className="flex justify-between gap-2">
                    <span>
                      {litres(item.quantityL)} لتر
                      {Number(item.unitPrice) > 0 ? `  ${money(item.unitPrice)} د.ج/لتر` : ''}
                    </span>
                    <span className="font-bold tabular-nums">{money(item.lineGross)} د.ج</span>
                  </div>
                </>
              )}
              <LineAssistanceRow item={item} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-0.5 text-[11px]">
          <Row label="الكمية" value={`${litres(sale.quantityL)} لتر`} />
          <Row label="سعر / لتر" value={`${money(sale.unitPrice)} د.ج`} />
        </div>
      )}

      <div className="my-2 border-t border-dashed border-black" />

      <div className="space-y-0.5 text-[11px]">
        {hasOil ? <Row label="إجمالي الزيت" value={`${litres(sale.quantityL)} لتر`} /> : null}
        {hasOil && singleOil && Number(sale.unitPrice) > 0 ? (
          <Row label="سعر / لتر" value={`${money(sale.unitPrice)} د.ج`} />
        ) : null}
        <Row label="المبلغ الإجمالي" value={`${money(sale.grossAmount)} د.ج`} />
        {assistPerLitreTotal > 0 && lineLevelAssistance ? (
          <Row label="مساعدة اللتر (حسب كل سطر)" value={`− ${money(assistPerLitreTotal)} د.ج`} />
        ) : assistPerLitreTotal > 0 ? (
          <>
            <p className="opacity-80">مساعدة اللتر:</p>
            <div className="flex items-start justify-between gap-2">
              <span className="opacity-80">
                {money(assistPerLitre)} دج × {litres(sale.quantityL)} لتر
              </span>
              <span className="tabular-nums">− {money(assistPerLitreTotal)} د.ج</span>
            </div>
          </>
        ) : null}
        {Number(sale.assistanceFixed) > 0 ? (
          <Row label="مساعدة ثابتة" value={`− ${money(sale.assistanceFixed)} د.ج`} />
        ) : null}
        <Row label="إجمالي المساعدات" value={`− ${money(sale.totalAssistance)} د.ج`} bold />
      </div>

      <div className="my-2 border-t-2 border-black" />

      <div className="flex items-center justify-between text-[14px] font-black">
        <span>الصافي للدفع</span>
        <span className="tabular-nums">{money(sale.finalAmount)} د.ج</span>
      </div>

      <div className="mt-1 space-y-0.5 text-[11px]">
        <Row label="المدفوع" value={`${money(sale.amountPaid ?? sale.finalAmount)} د.ج`} bold />
        {Number(sale.remainingAmount ?? 0) > 0 ? (
          <div className="mt-1 flex items-center justify-between border border-black px-1 py-1 text-[12px] font-black">
            <span>المتبقي على الزبون</span>
            <span className="tabular-nums">{money(sale.remainingAmount ?? 0)} د.ج</span>
          </div>
        ) : (
          <Row label="المتبقي" value="0 د.ج" />
        )}
      </div>

      {sale.status === 'CANCELLED' ? (
        <p className="mt-2 text-center text-[12px] font-black">*** ملغى ***</p>
      ) : null}

      {sale.notes ? (
        <>
          <div className="my-2 border-t border-dashed border-black" />
          <p className="text-[10px]">
            <span className="font-bold">ملاحظة:</span> {sale.notes}
          </p>
        </>
      ) : null}

      <div className="my-2 border-t border-dashed border-black" />

      {settings.receiptFooter ? (
        <p className="mt-3 text-center text-[10px] font-bold">{settings.receiptFooter}</p>
      ) : null}
    </div>
  );
}

/** Assistance of one line: its litres × its rate (+ its fixed amount). */
function LineAssistanceRow({
  item,
}: {
  item: NonNullable<OilSaleReceiptPayload['sale']['items']>[number];
}) {
  const total = Number(item.lineAssistance ?? 0);
  if (!(total > 0)) return null;
  const rate = Number(item.assistancePerLitre ?? 0);
  const fixed = Number(item.assistanceFixed ?? 0);
  const parts = [
    rate > 0 ? `${money(rate)} دج × ${litres(item.quantityL)} لتر` : '',
    fixed > 0 ? `${money(fixed)} دج ثابتة` : '',
  ].filter(Boolean);
  return (
    <div className="flex items-start justify-between gap-2 opacity-90">
      <span>مساعدة{parts.length ? ` (${parts.join(' + ')})` : ''}</span>
      <span className="tabular-nums">− {money(total)} د.ج</span>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
      <span className="shrink-0 opacity-80">{label}</span>
      <span className="text-left tabular-nums">{value}</span>
    </div>
  );
}
