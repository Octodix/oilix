'use client';

import { Suspense, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { OilDayReportPrintCopies } from '@/components/print/oil-day-report-document';
import { ThermalPrintFrame } from '@/components/print/thermal-print-frame';
import { Button } from '@/components/ui/button';
import {
  buildDayReportPrintPayload,
  fetchDayReport,
  registerDayReportPrint,
} from '@/lib/oil-day-report-data';
import { useDirectPrint } from '@/hooks/use-direct-print';
import { oilDayReportRequests } from '@/lib/print-documents';

function todayIso() {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function OilDayReportPrintPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-stone-100 text-stone-500">
          جاري تحميل اليومية...
        </div>
      }
    >
      <OilDayReportBody />
    </Suspense>
  );
}

function OilDayReportBody() {
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';
  const date = searchParams.get('date') || todayIso();
  const from = searchParams.get('from') || date;
  const to = searchParams.get('to') || date;
  const cashRegisterId = searchParams.get('cashRegisterId')?.trim() || '';

  const reportQ = useQuery({
    queryKey: ['oil-day-report', from, to, cashRegisterId],
    enabled: Boolean(cashRegisterId),
    queryFn: () => fetchDayReport({ from, to, cashRegisterId }),
  });

  const printMetaQ = useQuery({
    queryKey: ['oil-day-report-day-print', from, to, cashRegisterId],
    enabled: Boolean(cashRegisterId),
    staleTime: Infinity,
    retry: false,
    queryFn: () => registerDayReportPrint({ from, to, cashRegisterId }),
  });

  const payload = useMemo(() => {
    if (!reportQ.data || !printMetaQ.data) return null;
    return buildDayReportPrintPayload(reportQ.data, printMetaQ.data, from, to);
  }, [reportQ.data, printMetaQ.data, from, to]);

  const { print, busy, settings } = useDirectPrint();

  useEffect(() => {
    if (payload) document.title = `يومية بيع الزيت ${payload.dateLabel}`;
  }, [payload]);

  useEffect(() => {
    if (!autoPrint || !payload) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [autoPrint, payload]);

  if (!cashRegisterId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-100 p-8 text-center">
        <p className="text-lg font-bold text-red-600">يجب تحديد الصندوق (cashRegisterId)</p>
        <p className="text-sm text-stone-500">اختر صندوقاً من صفحة التقارير ثم افتح اليومية.</p>
        <Button variant="outline" onClick={() => window.close()}>
          إغلاق
        </Button>
      </div>
    );
  }

  if (reportQ.isLoading || printMetaQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 text-stone-500">
        جاري تحميل اليومية...
      </div>
    );
  }

  if (reportQ.isError || printMetaQ.isError || !payload) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-100 p-8 text-center">
        <p className="text-lg font-bold text-red-600">تعذر تحميل اليومية</p>
        <Button variant="outline" onClick={() => window.close()}>
          إغلاق
        </Button>
      </div>
    );
  }

  const metaId = printMetaQ.data?.id;
  return (
    <ThermalPrintFrame
      title={`يومية بيع الزيت · ${payload.dateLabel}`}
      directPrint={
        settings.directPrinting && metaId
          ? {
              busy,
              onPrint: () =>
                void print(oilDayReportRequests(payload, metaId, settings), {
                  browserFallback: () => window.print(),
                }),
            }
          : undefined
      }
    >
      <OilDayReportPrintCopies data={payload} />
    </ThermalPrintFrame>
  );
}
