import { OIL_SOURCES, OIL_TYPES, oilMeta, oilSourceMeta } from '@/lib/sales-nav';
import { formatNumber } from '@/lib/utils';
import { dayReportCopies } from '@/lib/print-plan';

export type DayReportColumn = {
  oilSource: string;
  oilType: string;
  /** المعروض */
  offered: number;
  /** المباع */
  sold: number;
  /** الباقي */
  remaining: number;
  /** الفرق (الباقي − المعروض) */
  difference: number;
  /** المجموع (إجمالي المبيعات) */
  gross: number;
  /** مساعدات */
  assistance: number;
  net: number;
};

export type OilDayReportPayload = {
  dateLabel: string;
  columns: DayReportColumn[];
  netTotal: number;
  footer?: string;
  cashRegister?: { code: string; name: string } | null;
  generatedByName?: string;
  generatedFromDevice?: string | null;
  generatedAtLabel?: string;
  copyKind?: 'user' | 'archive';
  /** Compact cash session snapshot (optional) */
  cashSession?: {
    openingCash?: number;
    cashSales?: number;
    expectedCash?: number;
  } | null;
};

export type OilDayReportMeta = {
  cashRegister?: { code: string; name: string } | null;
  generatedByName?: string;
  generatedFromDevice?: string | null;
  generatedAtLabel?: string;
  copyKind?: 'user' | 'archive';
  cashSession?: OilDayReportPayload['cashSession'];
};

function n(v: number, decimals = 1) {
  if (!Number.isFinite(v)) return '0';
  return formatNumber(v, decimals);
}

function money(v: number) {
  return formatNumber(v, 2);
}

function shortHeader(oilSource: string, oilType: string) {
  const t = oilMeta(oilType).shortLabel;
  if (oilSource === 'FARMER') return `${t} فلاح`;
  return t;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 text-[10px]">
      <span className="shrink-0 opacity-80">{label}</span>
      <span className="text-left font-bold tabular-nums">{value}</span>
    </div>
  );
}

function ReportMatrix({
  title,
  cols,
}: {
  title?: string;
  cols: DayReportColumn[];
}) {
  if (!cols.length) return null;

  const rows: Array<{
    label: string;
    get: (c: DayReportColumn) => string;
    money?: boolean;
  }> = [
    { label: 'المعروض', get: (c) => n(c.offered, 1) },
    { label: 'المباع', get: (c) => n(c.sold, 1) },
    { label: 'الباقي', get: (c) => n(c.remaining, 1) },
    {
      label: 'الفرق',
      get: (c) => {
        const d = c.difference;
        const s = n(Math.abs(d), 1);
        return d > 0 ? `+${s}` : d < 0 ? `-${s}` : '0';
      },
    },
    { label: 'المجموع', get: (c) => money(c.gross), money: true },
    { label: 'مساعدات', get: (c) => money(c.assistance), money: true },
  ];

  return (
    <div className="mb-2">
      {title ? (
        <p className="mb-1 text-center text-[11px] font-black underline decoration-dashed underline-offset-2">
          {title}
        </p>
      ) : null}
      <table className="oil-day-report-table w-full border-collapse text-[9px] leading-tight">
        <thead>
          <tr>
            <th className="oil-day-report-corner" />
            {cols.map((c) => (
              <th key={`${c.oilSource}-${c.oilType}`} className="oil-day-report-th">
                {shortHeader(c.oilSource, c.oilType)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="oil-day-report-label">{row.label}</td>
              {cols.map((c) => (
                <td
                  key={`${row.label}-${c.oilSource}-${c.oilType}`}
                  className="oil-day-report-cell"
                >
                  {row.get(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OilDayReportDocument({ data }: { data: OilDayReportPayload }) {
  const zeroCol = (oilSource: string, oilType: string): DayReportColumn => ({
    oilSource,
    oilType,
    offered: 0,
    sold: 0,
    remaining: 0,
    difference: 0,
    gross: 0,
    assistance: 0,
    net: 0,
  });

  const storedCols = OIL_TYPES.map(
    (t) =>
      data.columns.find((c) => c.oilSource === 'STORED' && c.oilType === t.value) ??
      zeroCol('STORED', t.value),
  );

  const farmerCols = OIL_TYPES.map(
    (t) =>
      data.columns.find((c) => c.oilSource === 'FARMER' && c.oilType === t.value) ??
      zeroCol('FARMER', t.value),
  );

  const registerLabel =
    data.cashRegister?.name || data.cashRegister?.code || null;
  const copyKind = data.copyKind ?? 'archive';

  return (
    <div
      className="thermal-receipt oil-day-report mx-auto w-[80mm] bg-white px-1.5 py-3 text-black"
      dir="rtl"
    >
      <p className="mb-2 text-center text-[14px] font-black tracking-wide">يومية بيع الزيت</p>

      <div className="mb-2 space-y-0.5 border-b border-dashed border-black pb-2">
        {registerLabel ? <InfoRow label="الصندوق" value={registerLabel} /> : null}
        <InfoRow label="التاريخ" value={data.dateLabel} />
        {data.generatedByName ? (
          <InfoRow label="أُنشئت بواسطة" value={data.generatedByName} />
        ) : null}
        {data.generatedFromDevice ? (
          <InfoRow label="من الجهاز" value={data.generatedFromDevice} />
        ) : null}
        {data.generatedAtLabel ? (
          <InfoRow label="وقت الإنشاء" value={data.generatedAtLabel} />
        ) : null}
      </div>

      <ReportMatrix title={oilSourceMeta('STORED').label} cols={storedCols} />
      <ReportMatrix title={oilSourceMeta('FARMER').label} cols={farmerCols} />

      {data.cashSession &&
      (data.cashSession.openingCash != null ||
        data.cashSession.cashSales != null ||
        data.cashSession.expectedCash != null) ? (
        <div className="mb-2 space-y-0.5 border-t border-dashed border-black pt-2 text-[10px]">
          <p className="mb-0.5 text-center text-[10px] font-bold opacity-80">ملخص الصندوق</p>
          {data.cashSession.openingCash != null ? (
            <InfoRow label="افتتاح" value={money(data.cashSession.openingCash)} />
          ) : null}
          {data.cashSession.cashSales != null ? (
            <InfoRow label="مبيعات نقدية" value={money(data.cashSession.cashSales)} />
          ) : null}
          {data.cashSession.expectedCash != null ? (
            <InfoRow label="المتوقع" value={money(data.cashSession.expectedCash)} />
          ) : null}
        </div>
      ) : null}

      <div className="my-2 border-t-2 border-black" />
      <div className="flex items-center justify-between gap-2 px-1 text-[13px] font-black">
        <span>صافي المجموع</span>
        <span className="tabular-nums">{money(data.netTotal)}</span>
      </div>
      <div className="my-2 border-t border-dashed border-black" />

      <p className="text-center text-[11px] font-bold tabular-nums">{data.dateLabel}</p>
      {copyKind === 'user' ? (
        <p className="mt-1 text-center text-[10px] font-bold">
          تحت إشراف: {data.generatedByName || '—'}
        </p>
      ) : (
        <p className="mt-1 text-center text-[10px] font-black tracking-wide">
          {data.footer || 'COPIE ARCHIVE · نسخة الأرشيف'}
        </p>
      )}
    </div>
  );
}

/** Two thermal copies (user + archive) with a page break between them. */
export function OilDayReportPrintCopies({ data }: { data: OilDayReportPayload }) {
  return (
    <div className="oil-day-report-print-copies">
      {dayReportCopies(data).map((copy) => (
        <div key={copy.label} className="oil-day-report-copy">
          <OilDayReportDocument data={copy.data} />
        </div>
      ))}
    </div>
  );
}

/** Build print payload from /oil-sales/reports response. */
export function buildOilDayReportPayload(
  report: {
    summary: { net: number };
    byBucket?: Array<{
      oilSource: string;
      oilType: string;
      litres: number;
      gross: number;
      assistance: number;
      net: number;
      stock: {
        totalAdded: number;
        theoreticalQty: number;
        physicalQty: number | null;
        lossQty: number;
      } | null;
    }>;
  },
  dateLabel: string,
  meta?: OilDayReportMeta,
): OilDayReportPayload {
  const buckets = report.byBucket ?? [];
  const columns: DayReportColumn[] = [];

  for (const src of OIL_SOURCES) {
    for (const t of OIL_TYPES) {
      const b = buckets.find((x) => x.oilSource === src.value && x.oilType === t.value);
      const stock = b?.stock;
      const remaining = stock?.theoreticalQty ?? 0;
      const physical = stock?.physicalQty;
      const difference =
        physical != null ? physical - remaining : stock ? -Number(stock.lossQty || 0) : 0;

      columns.push({
        oilSource: src.value,
        oilType: t.value,
        offered: stock?.totalAdded ?? 0,
        sold: b?.litres ?? 0,
        remaining,
        difference,
        gross: b?.gross ?? 0,
        assistance: b?.assistance ?? 0,
        net: b?.net ?? 0,
      });
    }
  }

  return {
    dateLabel,
    columns,
    netTotal: report.summary.net,
    footer: 'نسخة الأرشيف',
    cashRegister: meta?.cashRegister ?? null,
    generatedByName: meta?.generatedByName,
    generatedFromDevice: meta?.generatedFromDevice ?? null,
    generatedAtLabel: meta?.generatedAtLabel,
    copyKind: meta?.copyKind,
    cashSession: meta?.cashSession ?? null,
  };
}
