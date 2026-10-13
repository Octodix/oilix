import { api } from '@/lib/api';
import {
  buildOilDayReportPayload,
  type OilDayReportPayload,
} from '@/components/print/oil-day-report-document';
import { formatDateTimeDz } from '@/lib/locale-dz';

export type OilDayReportSource = {
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
  cashSessions?: Array<{
    openingCash: number;
    cashSales: number;
    expectedCash: number | null;
    physicalCash: number | null;
    difference: number | null;
  }>;
};

export type DayPrintMeta = {
  id: string;
  from: string;
  to: string;
  cashRegister: { id: string; code: string; name: string };
  generatedBy: { id: string; name: string };
  device: { id: string; code: string | null; name: string } | null;
  generatedAt: string;
};

export type DayReportQuery = { from: string; to: string; cashRegisterId: string };

export function formatDayLabel(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

export function buildDayReportPrintPayload(
  report: OilDayReportSource,
  meta: DayPrintMeta,
  from: string,
  to: string,
): OilDayReportPayload {
  const label = from === to ? formatDayLabel(from) : `${formatDayLabel(from)} → ${formatDayLabel(to)}`;
  const sessions = report.cashSessions ?? [];
  const sessionAgg = sessions.length
    ? {
        openingCash: sessions[0]?.openingCash,
        cashSales: sessions.reduce((s, x) => s + (x.cashSales || 0), 0),
        expectedCash: sessions[sessions.length - 1]?.expectedCash ?? undefined,
      }
    : null;
  return buildOilDayReportPayload(report, label, {
    cashRegister: { code: meta.cashRegister.code, name: meta.cashRegister.name },
    generatedByName: meta.generatedBy.name,
    generatedFromDevice: meta.device?.name || meta.device?.code || null,
    generatedAtLabel: formatDateTimeDz(meta.generatedAt),
    cashSession: sessionAgg,
  });
}

export function fetchDayReport(q: DayReportQuery) {
  return api
    .get<OilDayReportSource>('/oil-sales/reports', { params: q })
    .then((r) => r.data);
}

/** Records the day-report print (who / which register / which device) and returns its metadata. */
export function registerDayReportPrint(q: DayReportQuery) {
  return api.post<DayPrintMeta>('/oil-sales/reports/day-print', q).then((r) => r.data);
}

export async function loadDayReportForPrint(q: DayReportQuery) {
  const [report, meta] = await Promise.all([fetchDayReport(q), registerDayReportPrint(q)]);
  return { meta, payload: buildDayReportPrintPayload(report, meta, q.from, q.to) };
}
