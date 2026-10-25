'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import {
  HANDOVER_STATUS_AR,
  type MillHandoverReceiptPayload,
} from '@/components/print/mill-handover-receipt-document';

type Session = MillHandoverReceiptPayload['session'];

/**
 * Read-only breakdown of the assistance sessions started in the period: who collected what
 * and whether the cash reached the primary operator. Informational only — the daily totals
 * above come from the operations themselves and are never changed by a handover.
 */
export function HandoverSummary({ from, to }: { from: string; to: string }) {
  const canSee = useAuthStore(
    (s) => s.hasPermission('MILL_ASSIST_VIEW_ALL') || s.hasPermission('MILL_ASSIST_START'),
  );
  const q = useQuery({
    queryKey: ['mill-assist-sessions', from, to],
    queryFn: async () => (await api.get<Session[]>('/mill-assistance/sessions', { params: { from, to } })).data,
    enabled: canSee,
  });
  if (!canSee || !q.data?.length) return null;
  const sum = (f: (s: Session) => number) => Math.round(q.data!.reduce((a, s) => a + f(s), 0) * 100) / 100;
  return (
    <section className="module-panel-enter rounded-3xl border border-stone-200/80 bg-white/80 p-4 shadow-lg backdrop-blur-md dark:border-stone-700/60 dark:bg-stone-900/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-black">
          <HandCoins className="h-4 w-4 text-amber-700" /> مداخيل المساعدين وتسليمها ({q.data.length} جلسة)
        </h2>
        <Link href="/assistance/dashboard" className="text-xs font-bold text-amber-800 underline">
          لوحة المشغّل الرئيسي
        </Link>
      </div>
      <p className="mt-1 text-xs text-[var(--app-text-dim)]">
        نقد قبضه المساعدون: {formatMoney(sum((s) => s.totals.totalCash))} د.ج · مؤكَّد الاستلام:{' '}
        {formatMoney(sum((s) => (s.status === 'CONFIRMED' ? (s.receivedHandover ?? 0) : 0)))} د.ج · بانتظار التأكيد:{' '}
        {formatMoney(sum((s) => (s.status === 'AWAITING_CONFIRMATION' ? s.totals.expectedHandover : 0)))} د.ج —
        هذه تسليمات داخلية لا تُضاف إلى الإيرادات أعلاه.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-[var(--app-text-dim)]">
            <tr className="text-right">
              <th className="py-1 pe-3 font-semibold">المرجع</th>
              <th className="py-1 pe-3 font-semibold">المساعد</th>
              <th className="py-1 pe-3 font-semibold">المشغّل الرئيسي</th>
              <th className="py-1 pe-3 font-semibold">عمليات</th>
              <th className="py-1 pe-3 font-semibold">مقبوض نقداً</th>
              <th className="py-1 pe-3 font-semibold">مستلَم</th>
              <th className="py-1 pe-3 font-semibold">الفرق</th>
              <th className="py-1 font-semibold">الحالة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--app-border)]">
            {q.data.map((s) => (
              <tr key={s.id} className="tabular-nums">
                <td className="py-1.5 pe-3 font-mono text-xs font-bold">{s.reference}</td>
                <td className="py-1.5 pe-3 font-bold">{s.assistant.name}</td>
                <td className="py-1.5 pe-3">{s.primaryOperator.name}</td>
                <td className="py-1.5 pe-3">{s.totals.operationsCount}</td>
                <td className="py-1.5 pe-3">{formatMoney(s.totals.totalCash)}</td>
                <td className="py-1.5 pe-3">{s.receivedHandover == null ? '—' : formatMoney(s.receivedHandover)}</td>
                <td className={cn('py-1.5 pe-3', Math.abs(s.difference) >= 0.005 && 'font-black text-red-700')}>
                  {Math.abs(s.difference) >= 0.005 ? `${s.difference > 0 ? '+' : ''}${formatMoney(s.difference)}` : '0'}
                </td>
                <td className="py-1.5">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-bold',
                      s.status === 'CONFIRMED' && 'bg-emerald-100 text-emerald-800',
                      s.status === 'DISCREPANCY' && 'bg-red-100 text-red-800',
                      (s.status === 'ACTIVE' || s.status === 'AWAITING_CONFIRMATION') && 'bg-amber-100 text-amber-900',
                    )}
                  >
                    {HANDOVER_STATUS_AR[s.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
