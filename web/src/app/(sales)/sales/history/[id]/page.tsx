'use client';

import Link from 'next/link';
import { FormEvent, use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { oilMeta, oilSourceMeta } from '@/lib/sales-nav';
import { saleCustomerName } from '@/lib/sales-cart';
import { formatNumber, formatMoney, formatDateTimeDz } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/lib/auth-store';
import { openOilSaleReceipt, openOilSaleClientReceipt } from '@/lib/oil-sale-receipt';
import { useSeasonReadOnly } from '@/hooks/use-season-read-only';
import { useDirectPrint } from '@/hooks/use-direct-print';
import { oilSaleClientReceiptRequest } from '@/lib/print-documents';

type SaleDetail = {
  id: string;
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
  status: string;
  saleDate: string;
  saleTime: string;
  createdAt: string;
  notes?: string | null;
  customer: { id: string; name: string; phone?: string | null } | null;
  createdBy?: { username: string; firstName?: string | null; lastName?: string | null };
  items?: Array<{
    kind: 'CONTAINER' | 'LOOSE' | 'CONTAINER_ONLY';
    oilType?: string | null;
    containerName?: string | null;
    containerCount?: number | null;
    quantityL: string | number;
    unitPrice: string | number;
    containerPrice?: string | number | null;
    lineGross: string | number;
  }>;
  paymentAllocations?: Array<{
    amount: string | number;
    createdAt: string;
    payment: {
      id: string;
      receiptNumber: number;
      cashRegisterName?: string | null;
      user?: { username: string; firstName?: string | null };
    };
  }>;
};

export default function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { readOnly } = useSeasonReadOnly();
  const canPrint = useAuthStore((s) => s.hasPermission('OIL_SALES_PRINT_RECEIPT'));
  const canReprint = useAuthStore((s) => s.hasPermission('OIL_SALES_SALES_REPRINT'));
  const canPay = useAuthStore((s) => s.hasPermission('OIL_SALES_DEBTS_RECORD_PAYMENT'));
  const canOpenReceipt = canPrint || canReprint;
  const [payAmount, setPayAmount] = useState('');

  const q = useQuery({
    queryKey: ['oil-sale', id],
    queryFn: async () => (await api.get<SaleDetail>(`/oil-sales/sales/${id}`)).data,
    retry: false,
  });

  const payMut = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/oil-sales/sales/${id}/pay`, {
          amount: Number(payAmount),
        })
      ).data as { id: string; remainingDebt: number },
    onSuccess: (r) => {
      toast.success(`تم التسديد — المتبقي الإجمالي ${formatMoney(r.remainingDebt)} د.ج`);
      setPayAmount('');
      void qc.invalidateQueries({ queryKey: ['oil-sale', id] });
      void qc.invalidateQueries({ queryKey: ['oil-sales-list'] });
      void qc.invalidateQueries({ queryKey: ['oil-debts'] });
      void qc.invalidateQueries({ queryKey: ['oil-debts-summary'] });
      if (r.id) window.open(`/oil-debt-payment/${r.id}?print=1`, '_blank', 'noopener');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message || 'تعذر التسديد'),
  });

  const status = axios.isAxiosError(q.error) ? q.error.response?.status : undefined;
  const { print: directPrint, busy: printing, settings: printSettings } = useDirectPrint();

  if (q.isLoading) {
    return <p className="text-sm text-[var(--app-text-dim)]">جاري التحميل...</p>;
  }

  if (status === 403) {
    return (
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-center">
        <p className="font-bold">ليس لديك صلاحية عرض هذا البيع</p>
        <Link href="/sales/history" className="mt-4 inline-block text-amber-800 underline">
          العودة إلى المبيعات
        </Link>
      </div>
    );
  }

  if (status === 404 || !q.data) {
    return (
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-center">
        <p className="font-bold">البيع غير موجود</p>
        <Link href="/sales/history" className="mt-4 inline-block text-amber-800 underline">
          العودة إلى المبيعات
        </Link>
      </div>
    );
  }

  const s = q.data;
  const src = s.oilSource ? oilSourceMeta(s.oilSource) : null;
  const m = s.oilType ? oilMeta(s.oilType) : null;
  const mixedOils =
    new Set((s.items ?? []).filter((i) => i.oilType).map((i) => i.oilType)).size > 1;
  const operator =
    [s.createdBy?.firstName, s.createdBy?.lastName].filter(Boolean).join(' ') ||
    s.createdBy?.username ||
    '—';
  const remaining = Number(s.remainingAmount ?? 0);
  const paid = Number(s.amountPaid ?? s.finalAmount);

  function onPay(e: FormEvent) {
    e.preventDefault();
    payMut.mutate();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/sales/history" className="text-sm text-amber-800 underline">
            المبيعات
          </Link>
          <h1 className="text-2xl font-black">وصل #{s.receiptNumber}</h1>
          <p className="text-sm text-[var(--app-text-dim)]">{formatDateTimeDz(s.createdAt)}</p>
        </div>
        {canOpenReceipt ? (
          <div className="flex flex-wrap gap-2">
            {printSettings.directPrinting ? (
              <Button
                type="button"
                className="gap-2"
                loading={printing}
                onClick={() =>
                  void directPrint(oilSaleClientReceiptRequest(s.id, { isReprint: true }), {
                    browserFallback: () => openOilSaleClientReceipt(s.id, { autoPrint: true }),
                  })
                }
              >
                <Printer className="h-4 w-4" />
                إعادة الطباعة · Réimprimer
              </Button>
            ) : null}
            <Button
              type="button"
              variant={printSettings.directPrinting ? 'outline' : 'primary'}
              className={
                printSettings.directPrinting ? 'gap-2' : 'gap-2 bg-amber-700 hover:bg-amber-800'
              }
              onClick={() => openOilSaleClientReceipt(s.id)}
            >
              <Printer className="h-4 w-4" />
              وصل تسليم
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => openOilSaleReceipt(s.id)}
            >
              <Printer className="h-4 w-4" />
              وصل مفصل
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-5 text-sm">
        <p>
          <span className="text-[var(--app-text-dim)]">الزبون: </span>
          <strong>{saleCustomerName(s.customer)}</strong>
          {s.customer?.id ? (
            <>
              {' · '}
              <Link href={`/sales/debts/${s.customer.id}`} className="text-amber-800 underline">
                حساب الدين
              </Link>
            </>
          ) : null}
        </p>
        {src && m ? (
          <p>
            <span className="text-[var(--app-text-dim)]">المصدر: </span>
            {src.label}
          </p>
        ) : null}
        {mixedOils ? (
          <p>
            <span className="text-[var(--app-text-dim)]">النوع: </span>
            عدة أنواع زيت
          </p>
        ) : m ? (
          <p>
            <span className="text-[var(--app-text-dim)]">النوع: </span>
            {m.emoji} {m.label}
          </p>
        ) : (
          <p>
            <span className="text-[var(--app-text-dim)]">النوع: </span>
            ضلف فقط
          </p>
        )}
        <p>
          <span className="text-[var(--app-text-dim)]">الحالة: </span>
          {s.status === 'CANCELLED' ? 'ملغى' : 'مكتمل'}
        </p>
        {(s.items ?? []).length > 0 ? (
          <ul className="divide-y divide-[var(--app-border)] rounded-xl border border-[var(--app-border)]">
            {s.items!.map((item, i) => (
              <li key={i} className="flex justify-between px-3 py-2">
                <span>
                  {item.kind === 'CONTAINER_ONLY'
                    ? `${item.containerCount} × ${item.containerName} (منتج) × ${formatMoney(Number(item.containerPrice ?? item.unitPrice))} د.ج`
                    : `${item.oilType ? `${oilMeta(item.oilType).shortLabel} · ` : ''}${
                        item.kind === 'CONTAINER'
                          ? `${item.containerCount} × ${item.containerName} = `
                          : ''
                      }${formatNumber(Number(item.quantityL), 1)} لتر × ${formatMoney(Number(item.unitPrice))} د.ج`}
                </span>
                <span className="tabular-nums">{formatMoney(Number(item.lineGross))} د.ج</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p>
          إجمالي الزيت: <strong>{formatNumber(Number(s.quantityL), 1)} لتر</strong>
        </p>
        <p>الإجمالي: {formatMoney(Number(s.grossAmount))} د.ج</p>
        {Number(s.assistancePerLitreTotal ?? 0) > 0 ? (
          <p>
            مساعدة اللتر ({formatMoney(Number(s.assistancePerLitre ?? 0))} دج/لتر):{' '}
            {formatMoney(Number(s.assistancePerLitreTotal))} د.ج
          </p>
        ) : null}
        {Number(s.assistanceFixed) > 0 ? (
          <p>مساعدة ثابتة: {formatMoney(Number(s.assistanceFixed))} د.ج</p>
        ) : null}
        <p>إجمالي المساعدات: {formatMoney(Number(s.totalAssistance))} د.ج</p>
        <p className="text-lg font-black">الصافي: {formatMoney(Number(s.finalAmount))} د.ج</p>
        <p>المدفوع: {formatMoney(paid)} د.ج</p>
        <p className={remaining > 0 ? 'font-black text-amber-800' : ''}>
          المتبقي: {formatMoney(remaining)} د.ج
        </p>
        <p className="text-xs text-[var(--app-text-dim)]">العامل: {operator}</p>
      </div>

      {canPay && !readOnly && s.status === 'COMPLETED' && remaining > 0 ? (
        <form
          onSubmit={onPay}
          className="space-y-3 rounded-2xl border border-amber-700/30 bg-amber-50 p-4 dark:bg-amber-950/20"
        >
          <h2 className="font-black">تسديد المتبقي</h2>
          <Input
            label="المبلغ"
            inputMode="decimal"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPayAmount(String(remaining))}>
              تسديد كامل المتبقي
            </Button>
            <Button type="submit" loading={payMut.isPending} className="bg-amber-700 hover:bg-amber-800">
              تسجيل الدفع
            </Button>
          </div>
        </form>
      ) : null}

      {(s.paymentAllocations ?? []).length > 0 ? (
        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
          <h2 className="mb-2 font-black">تسديدات لاحقة</h2>
          <ul className="divide-y divide-[var(--app-border)] text-sm">
            {s.paymentAllocations!.map((a, i) => (
              <li key={i} className="flex justify-between gap-2 py-2">
                <div>
                  <p className="font-bold">PAY-{String(a.payment.receiptNumber).padStart(6, '0')}</p>
                  <p className="text-xs text-[var(--app-text-dim)]">
                    {formatDateTimeDz(a.createdAt)}
                    {a.payment.cashRegisterName ? ` · ${a.payment.cashRegisterName}` : ''}
                  </p>
                </div>
                <span className="font-black tabular-nums">{formatMoney(Number(a.amount))} د.ج</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
