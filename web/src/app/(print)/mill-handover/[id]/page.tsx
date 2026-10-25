'use client';

import { Suspense, use, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '@/lib/api';
import {
  MillHandoverReceiptDocument,
  type MillHandoverReceiptPayload,
} from '@/components/print/mill-handover-receipt-document';
import { ThermalPrintFrame } from '@/components/print/thermal-print-frame';

export const MILL_HANDOVER_RECEIPT_API = (sessionId: string) =>
  `/mill-assistance/sessions/${sessionId}/receipt`;

/** Browser print page for وصل تسليم المداخيل — fallback when the Print Agent is unavailable. */
export default function MillHandoverPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-stone-100 text-stone-500">
          جاري تحميل وصل التسليم...
        </div>
      }
    >
      <Body id={id} />
    </Suspense>
  );
}

function Body({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';
  const { data, isLoading, error } = useQuery({
    queryKey: ['mill-handover-receipt', id],
    queryFn: async () => (await api.get<MillHandoverReceiptPayload>(MILL_HANDOVER_RECEIPT_API(id))).data,
    retry: false,
  });
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;

  useEffect(() => {
    if (data) document.title = `وصل تسليم المداخيل ${data.session.reference}`;
  }, [data]);

  useEffect(() => {
    if (!autoPrint || !data) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [autoPrint, data]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 text-stone-500">
        جاري تحميل وصل التسليم...
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 p-6 text-center text-stone-700">
        {status === 403
          ? 'ليس لديك صلاحية عرض هذا الوصل.'
          : status === 404
            ? 'جلسة المساعدة غير موجودة.'
            : 'تعذر تحميل وصل التسليم.'}
      </div>
    );
  }
  return (
    <ThermalPrintFrame title={`وصل تسليم المداخيل · ${data.session.reference}`}>
      <MillHandoverReceiptDocument data={data} />
    </ThermalPrintFrame>
  );
}
