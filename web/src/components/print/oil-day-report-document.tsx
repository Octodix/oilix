import { OIL_SOURCES, OIL_TYPES, oilMeta, oilSourceMeta } from '@/lib/sales-nav';
import { formatNumber } from '@/lib/utils';
import { dayReportCopies } from '@/lib/print-plan';
import { bucketHasActivity, type DailyStockDay, type DailyStockBucket } from '@/lib/daily-stock';

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
  /** Shared physical stock per business day (litres) — all registers, never mixed with money. */
  dailyStock?: DailyStockDay[] | null;
};

export type OilDayReportMeta = {
  cashRegister?: { code: string; name: string } | null;
  generatedByName?: string;
  generatedFromDevice?: string | null;
  generatedAtLabel?: string;
  copyKind?: 'user' | 'archive';
  cashSession?: OilDayReportPayload['cashSession'];
  dailyStock?: DailyStockDay[] | null;
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
    // Register-specific: what THIS register sold and cashed. Physical stock (shared by all
    // registers) is in the daily inventory section below, never mixed with money.
    { label: 'المباع (ل)', get: (c) => n(c.sold, 1) },
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

function signed(v: number) {
  const a = n(Math.abs(v), 1);
  return v > 0.004 ? `▲ +${a}` : v < -0.004 ? `▼ -${a}` : '0';
}

/** الجرد اليومي للزيت — opening → additions → sales → expected → actual → difference → next day. */
function DailyStockSection({ day }: { day: DailyStockDay }) {
  const sources = (OIL_SOURCES.map((s) => s.value) as Array<'STORED' | 'FARMER'>).map((src) => ({
    src,
    rows: day.buckets.filter((b) => b.oilSource === src && bucketHasActivity(b)),
  }));
  const shown = sources.filter((x) => x.rows.length);
  const rows: Array<{ label: string; get: (b: DailyStockBucket) => string; strong?: boolean }> = [
    { label: 'افتتاح', get: (b) => n(b.opening) + (b.openingSource === 'PROVISIONAL' ? '*' : '') },
    { label: 'إضافات', get: (b) => n(b.added) },
    ...(day.buckets.some((b) => b.otherIn || b.otherOut)
      ? [{ label: 'تعديلات', get: (b: DailyStockBucket) => signed(b.otherIn - b.otherOut).replace(/[▲▼] /, '') }]
      : []),
    { label: 'المتاح', get: (b) => n(b.available) },
    { label: 'المباع', get: (b) => n(b.netSold) },
    { label: 'المتوقع', get: (b) => n(b.expected) },
    { label: 'الفعلي', get: (b) => (b.actual == null ? '—' : n(b.actual)), strong: true },
    { label: 'الفرق', get: (b) => (b.difference == null ? '—' : signed(b.difference)), strong: true },
    { label: 'رصيد الغد', get: (b) => n(b.nextOpening) + (b.nextOpeningProvisional ? '*' : ''), strong: true },
  ];
  return (
    <div className="mb-2 border-t border-dashed border-black pt-2">
      <p className="text-center text-[11px] font-black">الجرد اليومي للزيت</p>
      <p className="mb-1 text-center text-[9px] font-bold">Inventaire journalier d&apos;huile · {day.date.split('-').reverse().join('-')}</p>
      <p className="mb-1 text-center text-[9px]">
        {day.allConfirmed ? 'جرد مؤكد — مخزون مشترك لكل الصناديق' : 'غير مؤكد بعد — مخزون مشترك لكل الصناديق'}
      </p>
      {shown.length === 0 ? <p className="text-center text-[9px]">لا مخزون ولا حركة</p> : null}
      {shown.map(({ src, rows: bs }) => (
        <table key={src} className="oil-day-report-table mb-1 w-full border-collapse text-[9px] leading-tight">
          <thead>
            <tr>
              <th className="oil-day-report-corner text-[8px]">{oilSourceMeta(src).label} · ل</th>
              {bs.map((b) => (
                <th key={b.oilType} className="oil-day-report-th">
                  {shortHeader(b.oilSource, b.oilType)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="oil-day-report-label">{r.label}</td>
                {bs.map((b) => (
                  <td key={b.oilType} className={`oil-day-report-cell ${r.strong ? 'font-black' : ''}`}>
                    {r.get(b)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {shown.length ? (
        <div className="space-y-0.5 text-[9px]">
          <InfoRow label="مجموع المتوقع (ل)" value={n(day.totals.all.expected)} />
          {day.totals.all.actual != null ? <InfoRow label="مجموع الفعلي (ل)" value={n(day.totals.all.actual)} /> : null}
          {day.anyConfirmed ? <InfoRow label="مجموع الفرق (ل)" value={signed(day.totals.all.difference)} /> : null}
          {day.buckets.some((b) => b.openingSource === 'PROVISIONAL' || b.nextOpeningProvisional) ? (
            <p className="text-[8px] opacity-80">* رصيد مؤقت (بدون جرد مؤكد)</p>
          ) : null}
        </div>
      ) : null}
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

      {(data.dailyStock ?? []).map((day) => (
        <DailyStockSection key={day.date} day={day} />
      ))}

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
    dailyStock: meta?.dailyStock ?? null,
  };
}
