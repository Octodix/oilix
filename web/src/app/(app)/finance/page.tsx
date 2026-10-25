'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Banknote,
  Calculator,
  CalendarRange,
  HandCoins,
  Printer,
  Search,
  TrendingUp,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatNumber, formatDate, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModulePageHero } from '@/components/ui/module-page-hero';
import { HandoverSummary } from '@/components/assistance/handover-summary';

type DailyColumn = {
  oliveType: string;
  label: string;
  totalAmount: number;
  totalAid: number;
  netTotal: number;
  fullAidCount: number;
  transactions: Array<{
    id: string;
    date: string;
    referenceNumber: number;
    entryCount?: number;
    clientName: string;
    amount: number;
    aid: number;
    fullAid: boolean;
  }>;
};

type FinancialDaily = {
  columns: DailyColumn[];
  summary: Array<{ label: string; amount: number; aid: number; fullAidCount: number }>;
  grandTotal: number;
  grandAid: number;
  netTotal: number;
};

const TYPE_STYLES = [
  {
    border: 'border-t-emerald-500',
    header: 'from-emerald-700 to-teal-600',
    icon: '🫒',
    glow: 'shadow-emerald-500/15',
  },
  {
    border: 'border-t-blue-500',
    header: 'from-blue-700 to-indigo-600',
    icon: '🌿',
    glow: 'shadow-blue-500/15',
  },
  {
    border: 'border-t-rose-500',
    header: 'from-rose-700 to-red-600',
    icon: '🍇',
    glow: 'shadow-rose-500/15',
  },
];

export default function FinancePage() {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [fullAidOnly, setFullAidOnly] = useState(false);

  const { data, refetch, isLoading, isFetching } = useQuery({
    queryKey: ['financial-daily', dateFrom, dateTo],
    queryFn: async () =>
      (
        await api.get<FinancialDaily>('/reports/financial-daily', {
          params: { dateFrom, dateTo },
        })
      ).data,
  });

  const columns = (data?.columns ?? []).map((col) => {
    if (!fullAidOnly) return col;
    const transactions = col.transactions.filter((t) => t.fullAid);
    const totalAmount = transactions.reduce((s, t) => s + t.amount, 0);
    const totalAid = transactions.reduce((s, t) => s + t.aid, 0);
    return {
      ...col,
      transactions,
      totalAmount,
      totalAid,
      netTotal: totalAmount - totalAid,
      fullAidCount: transactions.length,
    };
  });

  return (
    <div className="finance-page relative -mx-3 min-h-full px-3 pb-10 md:-mx-6 md:px-6">
      <div className="finance-bg pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative z-10 mx-auto max-w-7xl space-y-5">
        <ModulePageHero
          gradient="from-violet-800 via-emerald-700 to-teal-600"
          glow="shadow-emerald-600/25"
          patternClass="olive-add-hero-pattern"
          icon={<Calculator className="h-7 w-7 text-white" />}
          badge={
            <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-bold text-white backdrop-blur-md">
              <CalendarRange className="h-3.5 w-3.5" />
              اليومية المالية
            </span>
          }
          title="المتابعة المالية"
          subtitle="مقارنة الإيرادات والمساعدات حسب نوع الزيتون"
          actions={
            <Button
              size="sm"
              className="gap-2 border border-white/30 bg-white/15 text-white hover:bg-white/25"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" />
              طباعة
            </Button>
          }
        />

        <div className="module-stats-enter grid gap-3 sm:grid-cols-3">
          <FinanceKpi
            icon={Banknote}
            label="إجمالي المبالغ"
            value={formatNumber(data?.grandTotal ?? 0)}
            unit="دج"
            tone="emerald"
          />
          <FinanceKpi
            icon={HandCoins}
            label="المساعدات"
            value={formatNumber(data?.grandAid ?? 0)}
            unit="دج"
            tone="amber"
          />
          <FinanceKpi
            icon={TrendingUp}
            label="الصافي"
            value={formatNumber(data?.netTotal ?? 0)}
            unit="دج"
            tone="violet"
          />
        </div>

        <HandoverSummary from={dateFrom} to={dateTo} />

        <div className="module-panel-enter grid gap-5 xl:grid-cols-[1fr_300px]">
          <div className="grid gap-4 md:grid-cols-3">
            {isLoading ? (
              <>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-80 animate-pulse rounded-3xl bg-white/60 dark:bg-stone-900/50"
                  />
                ))}
              </>
            ) : (
              columns.map((col, i) => {
                const style = TYPE_STYLES[i] ?? TYPE_STYLES[0];
                return (
                  <article
                    key={col.oliveType}
                    className={cn(
                      'overflow-hidden rounded-3xl border border-stone-200/80 bg-white/80 shadow-lg backdrop-blur-md dark:border-stone-700/60 dark:bg-stone-900/80',
                      style.border,
                      style.glow,
                    )}
                  >
                    <div
                      className={cn(
                        'bg-gradient-to-l px-4 py-4 text-white',
                        style.header,
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-2xl">{style.icon}</span>
                        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
                          {col.transactions.length} زبون
                        </span>
                      </div>
                      <h2 className="mt-2 text-lg font-black">{col.label}</h2>
                      <p className="mt-1 text-sm text-white/90">
                        المجموع: {formatNumber(col.totalAmount)} دج
                      </p>
                      <p className="text-xs text-white/75">
                        صافي: {formatNumber(col.netTotal)} دج
                      </p>
                    </div>
                    <div className="max-h-72 overflow-y-auto scroll-smooth">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-stone-50/95 dark:bg-stone-900/95">
                          <tr className="text-stone-600 dark:text-stone-400">
                            <th className="px-2 py-2 text-right">التاريخ</th>
                            <th className="px-2 py-2 text-right">رقم</th>
                            <th className="px-2 py-2 text-right">مبلغ</th>
                            <th className="px-2 py-2 text-right">مساعدة</th>
                            <th className="px-2 py-2 text-right">مساعدة 100%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {col.transactions.map((t, j) => (
                            <tr
                              key={t.id}
                              className={cn(
                                'border-b border-stone-100/80 dark:border-stone-800/80',
                                j % 2 === 0
                                  ? 'bg-white dark:bg-stone-900/30'
                                  : 'bg-stone-50/50 dark:bg-stone-900/10',
                                t.fullAid && 'bg-amber-50/80 dark:bg-amber-950/25',
                              )}
                            >
                              <td className="whitespace-nowrap px-2 py-1.5">
                                {formatDate(t.date)}
                              </td>
                              <td className="px-2 py-1.5 font-mono font-bold">{t.referenceNumber}</td>
                              <td className="px-2 py-1.5 tabular-nums">{formatNumber(t.amount)}</td>
                              <td className="px-2 py-1.5 tabular-nums text-amber-700 dark:text-amber-400">
                                {formatNumber(t.aid)}
                              </td>
                              <td className="px-2 py-1.5 text-center font-bold">
                                {t.fullAid ? (
                                  <span className="text-amber-700 dark:text-amber-300">نعم</span>
                                ) : (
                                  <span className="text-stone-300">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                          {!col.transactions.length && (
                            <tr>
                              <td colSpan={5} className="py-8 text-center text-stone-400">
                                لا توجد بيانات
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <aside className="h-fit rounded-3xl border border-stone-200/80 bg-white/80 p-5 shadow-lg backdrop-blur-xl dark:border-stone-700/60 dark:bg-stone-900/80">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-black text-stone-800 dark:text-white">
              <Search className="h-4 w-4 text-emerald-600" />
              تصفية الفترة
            </h3>
            <div className="space-y-3">
              <Input
                type="date"
                label="من"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <Input
                type="date"
                label="إلى"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
              <Button
                className="w-full gap-2"
                onClick={() => refetch()}
                loading={isFetching}
              >
                <Search className="h-4 w-4" />
                تحديث
              </Button>
              <button
                type="button"
                onClick={() => setFullAidOnly((v) => !v)}
                className={cn(
                  'w-full rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors',
                  fullAidOnly
                    ? 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-100'
                    : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300',
                )}
              >
                مساعدة 100% فقط
              </button>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-stone-200/80 dark:border-stone-700/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-100/90 text-stone-600 dark:bg-stone-800/90 dark:text-stone-300">
                    <th className="px-3 py-2 text-right">النوع</th>
                    <th className="px-3 py-2 text-right">مبلغ</th>
                    <th className="px-3 py-2 text-right">مساعدة</th>
                    <th className="px-3 py-2 text-right">مساعدة 100%</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.summary.map((row) => (
                    <tr
                      key={row.label}
                      className="border-t border-stone-100 dark:border-stone-800"
                    >
                      <td className="px-3 py-2 font-medium">{row.label}</td>
                      <td className="px-3 py-2 tabular-nums">{formatNumber(row.amount)}</td>
                      <td className="px-3 py-2 tabular-nums text-amber-700 dark:text-amber-400">
                        {formatNumber(row.aid)}
                      </td>
                      <td className="px-3 py-2 tabular-nums font-bold text-amber-800 dark:text-amber-300">
                        {row.fullAidCount}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-stone-200 bg-stone-50 font-bold dark:border-stone-700 dark:bg-stone-800/50">
                    <td className="px-3 py-2">المجموع</td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(data?.grandTotal ?? 0)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(data?.grandAid ?? 0)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {data?.summary.reduce((s, r) => s + (r.fullAidCount ?? 0), 0) ?? 0}
                    </td>
                  </tr>
                  <tr className="bg-emerald-50 font-black text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                    <td className="px-3 py-2">الصافي</td>
                    <td colSpan={3} className="px-3 py-2 tabular-nums">
                      {formatNumber(data?.netTotal ?? 0)} دج
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function FinanceKpi({
  icon: Icon,
  label,
  value,
  unit,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  unit: string;
  tone: 'emerald' | 'amber' | 'violet';
}) {
  const tones = {
    emerald: 'border-emerald-200/70 bg-white/75 dark:border-emerald-900/50',
    amber: 'border-amber-200/70 bg-white/75 dark:border-amber-900/50',
    violet: 'border-violet-200/70 bg-white/75 dark:border-violet-900/50',
  };
  const icons = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  };
  return (
    <div
      className={cn(
        'module-stat-enter flex items-center gap-3 rounded-2xl border p-4 shadow-sm backdrop-blur-md',
        tones[tone],
      )}
    >
      <span className={cn('flex h-12 w-12 items-center justify-center rounded-xl', icons[tone])}>
        <Icon className="h-6 w-6" />
      </span>
      <div>
        <p className="text-xs font-medium text-stone-500">{label}</p>
        <p className="text-xl font-black tabular-nums text-stone-900 dark:text-white">
          {value}
          <span className="mr-1 text-sm font-semibold text-stone-500">{unit}</span>
        </p>
      </div>
    </div>
  );
}
