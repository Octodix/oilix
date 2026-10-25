'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, LockOpen, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/auth-store';
import { oilMeta, oilSourceMeta } from '@/lib/sales-nav';
import {
  bucketHasActivity,
  DAILY_STOCK_KEY,
  fetchDailyStockDay,
  signedLitres,
  type DailyStockBucket,
  type DailyStockDay,
} from '@/lib/daily-stock';

type ApiError = { response?: { status?: number; data?: { message?: string | string[] } } };
type Rules = DailyStockDay['rules'];

const keyOf = (b: Pick<DailyStockBucket, 'oilSource' | 'oilType'>) => `${b.oilSource}:${b.oilType}`;
const l = (v: number) => formatNumber(v, 1);

function apiMessage(e: ApiError, fallback: string) {
  const m = e.response?.data?.message;
  return Array.isArray(m) ? m.join('\n') : m || fallback;
}

function shiftDate(key: string, days: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function algiersToday() {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}

function needsReason(diff: number, expected: number, r?: Rules) {
  const d = Math.abs(diff);
  if (d < 0.005) return false;
  const minL = r?.reasonMinLitres ?? 1;
  const minP = r?.reasonMinPercent ?? 1;
  return d >= minL || (expected > 0 && (d / expected) * 100 >= minP);
}

/**
 * الجرد اليومي للزيت — per business day: opening → additions → sales → expected → counted →
 * difference → next-day opening. Stock is shared by every register; one confirmation per oil.
 */
export default function DailyClosingPage() {
  const qc = useQueryClient();
  const canView = useAuthStore((s) => s.hasPermission('OIL_SALES_INVENTORY_VIEW'));
  const canClose = useAuthStore((s) => s.hasPermission('OIL_SALES_INVENTORY_CREATE'));
  const canReopen = useAuthStore((s) => s.hasPermission('OIL_SALES_INVENTORY_REOPEN'));
  const [date, setDate] = useState(algiersToday);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  const dayQ = useQuery({
    queryKey: [...DAILY_STOCK_KEY, date],
    queryFn: () => fetchDailyStockDay(date),
    enabled: canView,
    refetchInterval: 30_000,
  });
  const day = dayQ.data;
  const rows = useMemo(
    () => (day?.buckets ?? []).filter((b) => showAll || bucketHasActivity(b) || b.status === 'CONFIRMED'),
    [day, showAll],
  );
  const open = rows.filter((b) => b.status === 'OPEN');

  const refresh = (d: DailyStockDay) => {
    qc.setQueryData([...DAILY_STOCK_KEY, d.date], d);
    void qc.invalidateQueries({ queryKey: DAILY_STOCK_KEY });
    void qc.invalidateQueries({ queryKey: ['oil-sales-stock'] });
  };

  const confirm = useMutation({
    mutationFn: async () => {
      const items = open
        .filter((b) => actual[keyOf(b)] !== undefined && actual[keyOf(b)] !== '')
        .map((b) => ({
          oilSource: b.oilSource,
          oilType: b.oilType,
          actualQty: Number(actual[keyOf(b)]),
          expectedQty: b.expected,
          reason: reason[keyOf(b)]?.trim() || undefined,
        }));
      if (!items.length) throw new Error('EMPTY');
      return (await api.post<DailyStockDay>('/oil-sales/daily-stock/close', { date, items })).data;
    },
    onSuccess: (d) => {
      toast.success('تم تأكيد الجرد وترحيل الرصيد لليوم الموالي');
      setActual({});
      setReason({});
      refresh(d);
    },
    onError: (e: ApiError & Error) => {
      if (e.message === 'EMPTY') return toast.error('أدخل الكمية الفعلية لزيت واحد على الأقل');
      if (e.response?.status === 409) void dayQ.refetch();
      toast.error(apiMessage(e, 'تعذر تأكيد الجرد'));
    },
  });

  const reopen = useMutation({
    mutationFn: async (b: DailyStockBucket) => {
      const why = window.prompt(`سبب إعادة فتح جرد ${oilSourceMeta(b.oilSource).label} · ${oilMeta(b.oilType).label}:`);
      if (!why || why.trim().length < 3) throw new Error('CANCEL');
      return (
        await api.post<DailyStockDay>('/oil-sales/daily-stock/reopen', {
          date,
          oilSource: b.oilSource,
          oilType: b.oilType,
          reason: why.trim(),
        })
      ).data;
    },
    onSuccess: (d) => {
      toast.success('أُعيد فتح الجرد — أُلغي تعديله وبقي في السجل');
      refresh(d);
    },
    onError: (e: ApiError & Error) => {
      if (e.message !== 'CANCEL') toast.error(apiMessage(e, 'تعذر إعادة الفتح'));
    },
  });

  if (!canView) {
    return (
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-center">
        <p className="font-bold">ليس لديك صلاحية عرض الجرد</p>
      </div>
    );
  }

  const missingReason = open.some((b) => {
    const v = actual[keyOf(b)];
    if (v === undefined || v === '') return false;
    return needsReason(Number(v) - b.expected, b.expected, day?.rules) && !reason[keyOf(b)]?.trim();
  });
  const today = day?.today ?? algiersToday();

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-amber-800 dark:text-amber-400">بيع الزيت</p>
          <h1 className="flex items-center gap-2 text-2xl font-black">
            <CalendarCheck className="h-6 w-6 text-amber-700" /> الجرد اليومي للزيت
          </h1>
          <p className="text-sm text-[var(--app-text-dim)]">
            Inventaire journalier d&apos;huile — المخزون مشترك بين كل الصناديق. الافتتاح = الباقي الفعلي المؤكد لليوم السابق.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="اليوم السابق">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <input
            type="date"
            className="rounded-xl border border-[var(--app-border-strong)] bg-[var(--app-surface)] px-3 py-1.5 text-sm"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <Button type="button" size="sm" variant="outline" disabled={date >= today} onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="اليوم الموالي">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDate(today)}>
            اليوم
          </Button>
        </div>
      </div>

      {day ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={cn(
              'rounded-full px-3 py-1 text-xs font-bold',
              day.allConfirmed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900',
            )}
          >
            {day.allConfirmed ? 'يوم مؤكد بالكامل' : day.anyConfirmed ? 'مؤكد جزئياً' : 'غير مؤكد — أرصدة مؤقتة'}
          </span>
          {day.isToday ? <span className="text-xs text-[var(--app-text-dim)]">اليوم الجاري — الأرقام تتحدث مع كل بيع</span> : null}
          <label className="ms-auto flex items-center gap-1 text-xs">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> عرض كل الزيوت
          </label>
          <Link href="/sales/reports" className="flex items-center gap-1 text-xs font-bold text-amber-800 underline">
            <Printer className="h-3.5 w-3.5" /> اليومية المالية
          </Link>
        </div>
      ) : null}

      <section className="overflow-x-auto rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-[var(--app-bg-muted)] text-xs text-[var(--app-text-dim)]">
            <tr className="text-right">
              <th className="px-3 py-2 font-semibold">الزيت</th>
              <th className="px-2 py-2 font-semibold">افتتاح</th>
              <th className="px-2 py-2 font-semibold">إضافات</th>
              <th className="px-2 py-2 font-semibold">تعديلات</th>
              <th className="px-2 py-2 font-semibold">المتاح</th>
              <th className="px-2 py-2 font-semibold">المباع</th>
              <th className="px-2 py-2 font-semibold">المتوقع</th>
              <th className="px-2 py-2 font-semibold">الفعلي</th>
              <th className="px-2 py-2 font-semibold">الفرق</th>
              <th className="px-2 py-2 font-semibold">رصيد الغد</th>
              <th className="px-3 py-2 font-semibold">الحالة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--app-border)]">
            {dayQ.isLoading ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-[var(--app-text-dim)]">جاري الحساب…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-[var(--app-text-dim)]">لا مخزون ولا حركة في هذا اليوم</td>
              </tr>
            ) : (
              rows.map((b) => {
                const k = keyOf(b);
                const typed = actual[k];
                const live = b.status === 'OPEN' && typed !== undefined && typed !== '' ? Number(typed) - b.expected : null;
                const diff = b.status === 'CONFIRMED' ? b.difference : live;
                const reasonNeeded = live != null && needsReason(live, b.expected, day?.rules);
                return (
                  <tr key={k} className="align-top tabular-nums">
                    <td className="px-3 py-2">
                      <p className="font-bold">{oilMeta(b.oilType).label}</p>
                      <p className="text-[11px] text-[var(--app-text-dim)]">{oilSourceMeta(b.oilSource).label}</p>
                    </td>
                    <td className="px-2 py-2">
                      {l(b.opening)}
                      {b.openingSource === 'PROVISIONAL' ? (
                        <span className="block text-[10px] text-amber-700" title="اليوم السابق غير مؤكد — رصيد حسب الحركات">مؤقت</span>
                      ) : (
                        <span className="block text-[10px] text-emerald-700">مؤكد</span>
                      )}
                    </td>
                    <td className="px-2 py-2">{b.added ? `+${l(b.added)}` : '0'}</td>
                    <td className="px-2 py-2">{b.otherIn || b.otherOut ? signedLitres(b.otherIn - b.otherOut) : '0'}</td>
                    <td className="px-2 py-2 font-bold">{l(b.available)}</td>
                    <td className="px-2 py-2">
                      {l(b.netSold)}
                      {b.returned ? <span className="block text-[10px] text-[var(--app-text-dim)]">مرتجع {l(b.returned)}</span> : null}
                    </td>
                    <td className="px-2 py-2 font-bold">{l(b.expected)}</td>
                    <td className="px-2 py-2">
                      {b.status === 'CONFIRMED' ? (
                        <span className="font-black">{l(b.actual ?? 0)}</span>
                      ) : canClose && !day?.isFuture ? (
                        <div className="w-28 space-y-1">
                          <input
                            inputMode="decimal"
                            className="w-full rounded-lg border border-[var(--app-border-strong)] bg-[var(--app-bg)] px-2 py-1 text-right"
                            placeholder={l(b.expected)}
                            value={typed ?? ''}
                            onChange={(e) => setActual((a) => ({ ...a, [k]: e.target.value }))}
                            aria-label={`الكمية الفعلية ${oilMeta(b.oilType).label}`}
                          />
                          {reasonNeeded ? (
                            <input
                              className={cn(
                                'w-full rounded-lg border px-2 py-1 text-xs',
                                reason[k]?.trim() ? 'border-[var(--app-border)]' : 'border-red-400 bg-red-50 dark:bg-red-950/20',
                              )}
                              placeholder="سبب الفرق (إلزامي)"
                              value={reason[k] ?? ''}
                              onChange={(e) => setReason((r) => ({ ...r, [k]: e.target.value }))}
                            />
                          ) : null}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {diff == null ? (
                        '—'
                      ) : (
                        <span
                          className={cn(
                            'rounded-md px-1.5 py-0.5 font-black',
                            diff < -0.004 && 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
                            diff > 0.004 && 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
                            Math.abs(diff) <= 0.004 && 'bg-emerald-100 text-emerald-800',
                          )}
                        >
                          {diff < -0.004 ? 'نقص ' : diff > 0.004 ? 'فائض ' : ''}
                          {signedLitres(diff)}
                        </span>
                      )}
                      {b.reason ? <span className="mt-1 block text-[10px] text-[var(--app-text-dim)]">{b.reason}</span> : null}
                    </td>
                    <td className="px-2 py-2 font-black">
                      {l(b.status === 'OPEN' && typed !== undefined && typed !== '' ? Number(typed) : b.nextOpening)}
                      {b.status === 'OPEN' && (typed === undefined || typed === '') ? (
                        <span className="block text-[10px] font-normal text-amber-700">مؤقت</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {b.status === 'CONFIRMED' ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> مؤكد
                          </span>
                          <p className="text-[10px] text-[var(--app-text-dim)]">
                            {b.closing?.confirmedByName ?? '—'}
                            {b.closing?.deviceName ? ` · ${b.closing.deviceName}` : ''}
                            <br />
                            {b.closing ? new Date(b.closing.confirmedAt).toLocaleString('fr-DZ', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                          </p>
                          {canReopen ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 underline"
                              disabled={reopen.isPending}
                              onClick={() => reopen.mutate(b)}
                            >
                              <LockOpen className="h-3 w-3" /> إعادة فتح
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="font-bold text-amber-800">مفتوح</span>
                      )}
                      {b.lastReopen ? (
                        <p className="mt-1 text-[10px] text-[var(--app-text-dim)]">أُعيد فتحه: {b.lastReopen.reason}</p>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {day && rows.length > 1 ? (
            <tfoot className="border-t-2 border-[var(--app-border-strong)] bg-[var(--app-bg-muted)] text-xs font-bold tabular-nums">
              <tr>
                <td className="px-3 py-2">المجموع (لتر)</td>
                <td className="px-2 py-2">{l(day.totals.all.opening)}</td>
                <td className="px-2 py-2">{l(day.totals.all.added)}</td>
                <td className="px-2 py-2" />
                <td className="px-2 py-2">{l(day.totals.all.available)}</td>
                <td className="px-2 py-2">{l(day.totals.all.netSold)}</td>
                <td className="px-2 py-2">{l(day.totals.all.expected)}</td>
                <td className="px-2 py-2">{day.totals.all.actual == null ? '—' : l(day.totals.all.actual)}</td>
                <td className="px-2 py-2">{day.anyConfirmed ? signedLitres(day.totals.all.difference) : '—'}</td>
                <td className="px-2 py-2">{l(day.totals.all.nextOpening)}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>

      {canClose && open.length > 0 && !day?.isFuture ? (
        <div className="sticky bottom-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]/95 p-3 shadow-lg backdrop-blur">
          <p className="text-xs text-[var(--app-text-dim)]">
            أدخل الكمية الموجودة فعلياً لكل زيت، راجع الفرق، ثم أكّد. يُرحَّل الباقي الفعلي كرصيد افتتاح لليوم الموالي، ويُسجَّل الفرق كتعديل مخزون واحد.
          </p>
          <Button
            type="button"
            className="gap-2 bg-amber-700 hover:bg-amber-800"
            loading={confirm.isPending}
            disabled={missingReason || !open.some((b) => (actual[keyOf(b)] ?? '') !== '')}
            onClick={() => confirm.mutate()}
          >
            <CheckCircle2 className="h-4 w-4" /> تأكيد الجرد
          </Button>
        </div>
      ) : null}

      {day ? (
        <p className="text-[11px] text-[var(--app-text-dim)]">
          يبدأ اليوم التجاري على الساعة {String(day.window.startHour).padStart(2, '0')}:00 بتوقيت الجزائر. السبب إلزامي عندما يبلغ الفرق{' '}
          {formatNumber(day.rules.reasonMinLitres, 1)} لتر أو {formatNumber(day.rules.reasonMinPercent, 1)}% من المتوقع.
        </p>
      ) : null}
    </div>
  );
}
