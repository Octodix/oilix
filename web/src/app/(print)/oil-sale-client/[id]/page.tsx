'use client';

import { Suspense, use, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '@/lib/api';
import { OilSaleClientReceiptDocument } from '@/components/print/oil-sale-client-receipt-document';
import type { OilSaleReceiptPayload } from '@/components/print/oil-sale-receipt-document';
import { ThermalPrintFrame } from '@/components/print/thermal-print-frame';
import { Button } from '@/components/ui/button';
import { isOilSaleId, OIL_SALE_RECEIPT_API } from '@/lib/oil-sale-receipt';
import { useDirectPrint } from '@/hooks/use-direct-print';
import { oilSaleClientReceiptRequest } from '@/lib/print-documents';

export default function OilSaleClientPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-stone-100 text-stone-500">
          جاري تحميل وصل التسليم...
        </div>
      }
    >
      <OilSaleClientPrintBody id={id} />
    </Suspense>
  );
}

function OilSaleClientPrintBody({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';
  const validId = isOilSaleId(id);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['oil-sale-client-receipt', id],
    queryFn: async () =>
      (await api.get<OilSaleReceiptPayload>(OIL_SALE_RECEIPT_API(id))).data,
    retry: false,
    enabled: validId,
  });

  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  const { print, busy, settings } = useDirectPrint();

  useEffect(() => {
    if (data) document.title = `وصل تسليم ${data.sale.receiptNumber}`;
  }, [data]);

  useEffect(() => {
    if (!autoPrint || !data) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [autoPrint, data]);

  if (!validId) {
    return (
      <ReceiptState
        title="البيع غير موجود"
        message="معرّف الوصل غير صالح. استخدم رابط البيع وليس رقم الوصل."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 text-stone-500">
        جاري تحميل وصل التسليم...
      </div>
    );
  }

  if (status === 403) {
    return (
      <ReceiptState
        title="لا توجد صلاحية للطباعة"
        message="ليس لديك صلاحية عرض أو طباعة وصل بيع الزيت."
      />
    );
  }

  if (status === 404) {
    return (
      <ReceiptState
        title="البيع غير موجود"
        message="تعذر العثور على هذا البيع. قد يكون محذوفاً أو خارج الموسم الحالي."
      />
    );
  }

  if (isError || !data) {
    return (
      <ReceiptState
        title="تعذر تحميل وصل التسليم"
        message="حدث خطأ أثناء جلب الوصل. أعد المحاولة أو تحقق من الاتصال."
      />
    );
  }

  return (
    <ThermalPrintFrame
      title={`وصل تسليم · ${data.sale.receiptNumber}`}
      directPrint={
        settings.directPrinting
          ? {
              busy,
              onPrint: () =>
                void print(oilSaleClientReceiptRequest(id, { data, isReprint: true }), {
                  browserFallback: () => window.print(),
                }),
            }
          : undefined
      }
    >
      <OilSaleClientReceiptDocument data={data} />
    </ThermalPrintFrame>
  );
}

function ReceiptState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-100 p-8 text-center">
      <p className="text-lg font-bold text-red-600">{title}</p>
      <p className="max-w-md text-sm text-stone-600">{message}</p>
      <Button variant="outline" onClick={() => window.close()}>
        إغلاق
      </Button>
    </div>
  );
}
