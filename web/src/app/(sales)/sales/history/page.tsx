'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { OIL_SOURCES, OIL_TYPES, oilMeta, oilSourceMeta } from '@/lib/sales-nav';
import { saleCustomerName } from '@/lib/sales-cart';
import { formatNumber, formatMoney, formatDateTimeDz, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/lib/auth-store';
import { OIL_SALE_DETAIL_PATH, openOilSaleReceipt, openOilSaleClientReceipt } from '@/lib/oil-sale-receipt';

type Sale = {
  id: string;
  receiptNumber: number;
  oilSource?: string | null;
  oilType: string;
  quantityL: string | number;
  unitPrice: string | number;
  grossAmount: string | number;
  totalAssistance: string | number;
  finalAmount: string | number;
  amountPaid?: string | number;
  remainingAmount?: string | number;
  paymentStatus?: string;
  status: string;
  saleDate: string;
  createdAt: string;
  customer: { id: string; name: string; phone?: string | null } | null;
  createdBy?: { username: string; firstName?: string | null };
  deviceCode?: string | null;
  cashRegisterName?: string | null;
  cashRegisterCode?: string | null;
};

function paymentStatusLabel(s?: string) {
  if (s === 'PARTIALLY_PAID') return 'جزئي';
  if (s === 'UNPAID') return 'غير مسدد';
  return 'مسدد';
}

export default function SalesHistoryPage() {
  const qc = useQueryClient();
  const canCancel = useAuthStore((s) => s.hasPermission('OIL_SALES_SALES_CANCEL'));
  const canReprint = useAuthStore((s) => s.hasPermission('OIL_SALES_SALES_REPRINT'));
  const canPrint = useAuthStore((s) => s.hasPermission('OIL_SALES_PRINT_RECEIPT'));
  const canOpenReceipt = canReprint || canPrint;
  const [q, setQ] = useState('');
  const [oilSource, setOilSource] = useState('');
  const [oilType, setOilType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');

  const listQ = useQuery({
    queryKey: ['oil-sales-list', q, oilSource, oilType, from, to, status, paymentStatus],
    queryFn: async () =>
      (
        await api.get<{ items: Sale[] }>('/oil-sales/sales', {
          params: {
            q: q || undefined,
            oilSource: oilSource || undefined,
            oilType: oilType || undefined,
            from: from || undefined,
            to: to || undefined,
            status: status || undefined,
            paymentStatus: paymentStatus || undefined,
            limit: 100,
          },
        })
      ).data.items,
  });

  const cancelMut = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await api.post(`/oil-sales/sales/${id}/cancel`, { reason })).data,
    onSuccess: () => {
      toast.success('تم إلغاء البيع واسترجاع المخزون');
      void qc.invalidateQueries({ queryKey: ['oil-sales-list'] });
      void qc.invalidateQueries({ queryKey: ['oil-sales-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['oil-sales-stock'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message || 'تعذر الإلغاء'),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-2xl font-black">سجل المبيعات</h1>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        <Input label="بحث" value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم، زبون…" />
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">المصدر</span>
          <select
            className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5"
            value={oilSource}
            onChange={(e) => setOilSource(e.target.value)}
          >
            <option value="">الكل</option>
            {OIL_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">النوع</span>
          <select
            className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5"
            value={oilType}
            onChange={(e) => setOilType(e.target.value)}
          >
            <option value="">الكل</option>
            {OIL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <Input label="من" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="إلى" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">الحالة</span>
          <select
            className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">الكل</option>
            <option value="COMPLETED">مكتمل</option>
            <option value="CANCELLED">ملغى</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">الدفع</span>
          <select
            className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5"
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value)}
          >
            <option value="">الكل</option>
            <option value="PAID">مسدد</option>
            <option value="PARTIALLY_PAID">جزئي</option>
            <option value="UNPAID">غير مسدد</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-[var(--app-bg-muted)] text-[var(--app-text-dim)]">
            <tr>
              <th className="px-3 py-2.5 text-right font-bold">الوصل</th>
              <th className="px-3 py-2.5 text-right font-bold">التاريخ</th>
              <th className="px-3 py-2.5 text-right font-bold">الزبون</th>
              <th className="px-3 py-2.5 text-right font-bold">الصندوق</th>
              <th className="px-3 py-2.5 text-right font-bold">الجهاز</th>
              <th className="px-3 py-2.5 text-right font-bold">المصدر</th>
              <th className="px-3 py-2.5 text-right font-bold">النوع</th>
              <th className="px-3 py-2.5 text-right font-bold">الكمية</th>
              <th className="px-3 py-2.5 text-right font-bold">الصافي</th>
              <th className="px-3 py-2.5 text-right font-bold">مدفوع</th>
              <th className="px-3 py-2.5 text-right font-bold">متبقي</th>
              <th className="px-3 py-2.5 text-right font-bold">الدفع</th>
              <th className="px-3 py-2.5 text-right font-bold">الحالة</th>
              <th className="px-3 py-2.5 text-right font-bold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {(listQ.data ?? []).map((s) => {
              const src = s.oilSource ? oilSourceMeta(s.oilSource) : null;
              const m = oilMeta(s.oilType);
              const remaining = Number(s.remainingAmount ?? 0);
              return (
                <tr key={s.id} className="border-t border-[var(--app-border)]">
                  <td className="px-3 py-2 font-black">
                    <Link href={OIL_SALE_DETAIL_PATH(s.id)} className="hover:underline">
                      #{s.receiptNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">{formatDateTimeDz(s.createdAt)}</td>
                  <td className="px-3 py-2 font-semibold">{saleCustomerName(s.customer)}</td>
                  <td className="px-3 py-2 text-xs">{s.cashRegisterName || s.cashRegisterCode || '—'}</td>
                  <td className="px-3 py-2 text-xs font-mono">{s.deviceCode || '—'}</td>
                  <td className="px-3 py-2 text-xs">{src ? src.label : '—'}</td>
                  <td className="px-3 py-2">
                    {m.emoji} {m.label}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatNumber(Number(s.quantityL), 1)}</td>
                  <td className="px-3 py-2 font-black tabular-nums">
                    {formatMoney(Number(s.finalAmount))}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatMoney(Number(s.amountPaid ?? s.finalAmount))}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 font-bold tabular-nums',
                      remaining > 0 ? 'text-amber-800' : '',
                    )}
                  >
                    {formatMoney(remaining)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-bold',
                        remaining > 0
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-emerald-100 text-emerald-800',
                      )}
                    >
                      {paymentStatusLabel(s.paymentStatus)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-bold',
                        s.status === 'CANCELLED'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-emerald-100 text-emerald-800',
                      )}
                    >
                      {s.status === 'CANCELLED' ? 'ملغى' : 'مكتمل'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {canOpenReceipt ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            title="وصل تسليم للزبون"
                            onClick={() => openOilSaleClientReceipt(s.id)}
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            title="وصل مفصل"
                            onClick={() => openOilSaleReceipt(s.id)}
                          >
                            وصل
                          </Button>
                        </>
                      ) : null}
                      {canCancel && s.status === 'COMPLETED' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          loading={cancelMut.isPending}
                          onClick={() => {
                            const reason = window.prompt('سبب الإلغاء (اختياري)') || undefined;
                            cancelMut.mutate({ id: s.id, reason });
                          }}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!listQ.isLoading && (listQ.data ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--app-text-dim)]">لا نتائج</p>
        ) : null}
      </div>
    </div>
  );
}
