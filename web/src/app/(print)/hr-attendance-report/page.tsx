'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { A4PrintFrame } from '@/components/print/a4-print-frame';
import {
  HR_ATTENDANCE_REPORT_API,
  HrAttendanceReportDocument,
  type HrAttendanceReport,
} from '@/components/print/hr-attendance-report-document';
import { Button } from '@/components/ui/button';
import { useDirectPrint } from '@/hooks/use-direct-print';
import { api } from '@/lib/api';
import { hrAttendanceReportRequest } from '@/lib/print-documents';

export default function HrAttendanceReportPrintPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-stone-100 text-stone-500">جاري التحميل…</div>}>
      <Body />
    </Suspense>
  );
}

function Body() {
  const sp = useSearchParams();
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const departmentId = sp.get('departmentId') || undefined;
  const employeeId = sp.get('employeeId') || undefined;
  const autoPrint = sp.get('print') === '1';
  const q = useQuery({
    queryKey: ['hr', 'attendance-report-print', from, to, departmentId, employeeId],
    enabled: !!from && !!to,
    queryFn: async () =>
      (await api.get<HrAttendanceReport>(HR_ATTENDANCE_REPORT_API, { params: { from, to, departmentId, employeeId } })).data,
  });
  const { print, busy, settings } = useDirectPrint();
  const data = q.data;

  useEffect(() => {
    if (data) document.title = `Présence ${data.from} → ${data.to}`;
  }, [data]);
  useEffect(() => {
    if (!autoPrint || !data) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [autoPrint, data]);

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-100 p-8 text-center">
        <p className={q.isError || !from || !to ? 'text-lg font-bold text-red-600' : 'text-stone-500'}>
          {q.isError || !from || !to ? 'تعذر تحميل التقرير' : 'جاري تحميل التقرير…'}
        </p>
        {q.isError || !from || !to ? (
          <Button variant="outline" onClick={() => window.close()}>
            إغلاق
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <A4PrintFrame
      title="تقرير الحضور"
      orientation="landscape"
      directPrint={
        settings.directPrinting && settings.documentPrinter
          ? { busy, onPrint: () => void print(hrAttendanceReportRequest(data), { browserFallback: () => window.print(), successMessage: 'تم إرسال التقرير للطابعة' }) }
          : undefined
      }
    >
      <HrAttendanceReportDocument data={data} />
    </A4PrintFrame>
  );
}
