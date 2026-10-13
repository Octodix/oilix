'use client';

import { Suspense, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { A4PrintFrame } from '@/components/print/a4-print-frame';
import { HR_PAYSLIP_API, HrPayslipDocument, type HrPayslipData } from '@/components/print/hr-payslip-document';
import { Button } from '@/components/ui/button';
import { useDirectPrint } from '@/hooks/use-direct-print';
import { api } from '@/lib/api';
import { hrPayslipRequest } from '@/lib/print-documents';

export default function HrPayslipPrintPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-stone-100 text-stone-500">جاري التحميل…</div>}>
      <HrPayslipPrintBody />
    </Suspense>
  );
}

function HrPayslipPrintBody() {
  const { id } = useParams<{ id: string }>();
  const autoPrint = useSearchParams().get('print') === '1';
  const q = useQuery({
    queryKey: ['hr', 'payslip-print', id],
    queryFn: async () => (await api.get<HrPayslipData>(HR_PAYSLIP_API(id))).data,
  });
  const { print, busy, settings } = useDirectPrint();
  const data = q.data;

  useEffect(() => {
    if (data) document.title = `Bulletin ${data.employeeSnapshot.matricule} ${String(data.period.month).padStart(2, '0')}/${data.period.year}`;
  }, [data]);

  useEffect(() => {
    if (!autoPrint || !data) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [autoPrint, data]);

  if (q.isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-100 text-stone-500">جاري تحميل كشف الأجر…</div>;
  }
  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-100 p-8 text-center">
        <p className="text-lg font-bold text-red-600">تعذر تحميل كشف الأجر</p>
        <Button variant="outline" onClick={() => window.close()}>
          إغلاق
        </Button>
      </div>
    );
  }

  return (
    <A4PrintFrame
      title={`كشف أجر ${data.employeeSnapshot.fullName}`}
      directPrint={
        settings.directPrinting && settings.documentPrinter
          ? { busy, onPrint: () => void print(hrPayslipRequest(data.id, { data }), { browserFallback: () => window.print(), successMessage: 'تم إرسال كشف الأجر للطابعة' }) }
          : undefined
      }
    >
      <HrPayslipDocument data={data} />
    </A4PrintFrame>
  );
}
