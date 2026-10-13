'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Droplets, Plus, ShoppingCart } from 'lucide-react';
import { api } from '@/lib/api';
import {
  OIL_SOURCES,
  OIL_TYPES,
  oilMeta,
  oilSourceMeta,
  type OilSourceValue,
  type OilTypeValue,
} from '@/lib/sales-nav';
import { formatNumber, formatMoney, formatDateTimeDz, cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import { OIL_SALE_DETAIL_PATH } from '@/lib/oil-sale-receipt';
import { saleCustomerName } from '@/lib/sales-cart';

type StockSummary = {
  totalAdded: number;
  totalSold: number;
  theoreticalQty: number;
  physicalQty: number | null;
  lossQty: number;
  lossPercent: number;
};

type Dash = {
  bySource: Record<OilSourceValue, Record<OilTypeValue, StockSummary>>;
  globalByType?: Record<
    OilTypeValue,
    { stored: number; farmer: number; total: number; storedLoss: number; farmerLoss: number }
  >;
  today: {
    count: number;
    litres: number;
    gross: number;
    assistance: number;
    net: number;
    cashFromSales?: number;
    newDebt?: number;
    cashReceived?: number;
  };
  debt?: {
    totalDebt: number;
    debtorsCount: number;
    collectedToday: number;
    newDebtToday: number;
  };
  latestSales: Array<{
    id: string;
    receiptNumber: number;
    oilSource?: string | null;
    oilType?: string | null;
    quantityL: string | number;
    finalAmount: string | number;
    createdAt: string;
    customer: { name: string } | null;
  }>;
  latestAdditions: Array<{
    id: string;
    oilSource: string;
    oilType: string;
    quantityL: string | number;
    createdAt: string;
    note?: string | null;
  }>;
  todayContainers?: Array<{
    name: string | null;
    capacityL: number;
    count: number;
    litres: number;
  }>;
  containerStock?: Array<{
    id: string;
    name: string;
    capacityL: number;
    available: number;
    minStock: number;
    lowStock: boolean;
  }>;
  todayByRegister?: Array<{
    cashRegisterId: string;
    code: string;
    name: string;
    count: number;
    litres: number;
    net: number;
  }>;
  allRegistersToday?: {
    count: number;
    litres: number;
    gross: number;
    assistance: number;
    net: number;
  };
  registers?: Array<{ id: string; code: string; name: string }>;
  currentRegisterId?: string | null;
};

export default function SalesDashboardPage() {
  const canWrite = useAuthStore((s) => s.hasPermission('OIL_SALES_SALES_CREATE'));
  const canSellContainers = useAuthStore((s) => s.hasPermission('OIL_SALES_CONTAINERS_SELL'));
  const canSeeLoss = useAuthStore((s) => s.hasPermission('OIL_SALES_STOCK_LOSS'));
  const canViewAll = useAuthStore((s) => s.hasPermission('OIL_SALES_CASH_REGISTER_VIEW_ALL'));
  const canViewDebts = useAuthStore((s) => s.hasPermission('OIL_SALES_DEBTS_VIEW'));
  const [registerId, setRegisterId] = useState('');
  const q = useQuery({
    queryKey: ['oil-sales-dashboard', registerId],
    queryFn: async () =>
      (
        await api.get<Dash>('/oil-sales/dashboard', {
          params: { cashRegisterId: registerId || undefined },
        })
      ).data,
    refetchInterval: 30_000,
  });

  const d = q.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-amber-800 dark:text-amber-400">بيع الزيت</p>
          <h1 className="text-2xl font-black text-[var(--app-text)]">لوحة التحكم</h1>
          <p className="mt-1 text-sm text-[var(--app-text-dim)]">
            المخزون المعروض / الباقي · المبيعات · الفرق
          </p>
        </div>
        {canWrite || canSellContainers ? (
          <Link
            href="/sales/new"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-800"
          >
            <ShoppingCart className="h-4 w-4" />
            بيع جديد
          </Link>
        ) : null}
      </div>

      {canViewAll && (d?.registers?.length ?? 0) > 0 ? (
        <label className="block max-w-xs text-sm">
          <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">الصندوق</span>
          <select
            className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5"
            value={registerId}
            onChange={(e) => setRegisterId(e.target.value)}
          >
            <option value="">كل الصناديق</option>
            {d?.registers?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {(d?.todayByRegister?.length ?? 0) > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {d!.todayByRegister!.map((r) => (
            <div
              key={r.cashRegisterId}
              className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4"
            >
              <p className="text-xs font-bold text-[var(--app-text-dim)]">{r.name}</p>
              <p className="mt-1 text-xl font-black tabular-nums">{formatMoney(r.net)} د.ج</p>
              <p className="text-xs text-[var(--app-text-dim)]">
                {r.count} بيع · {formatNumber(r.litres, 1)} لتر
              </p>
            </div>
          ))}
          {d?.allRegistersToday && canViewAll ? (
            <div className="rounded-2xl border border-amber-700/30 bg-amber-50 p-4 dark:bg-amber-950/30">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-400">كل الصناديق</p>
              <p className="mt-1 text-xl font-black tabular-nums">
                {formatMoney(d.allRegistersToday.net)} د.ج
              </p>
              <p className="text-xs text-[var(--app-text-dim)]">
                {d.allRegistersToday.count} بيع · {formatNumber(d.allRegistersToday.litres, 1)} لتر
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="مبيعات اليوم" value={String(d?.today.count ?? '—')} />
        <StatCard label="لترات اليوم" value={d ? formatNumber(d.today.litres, 1) : '—'} unit="لتر" />
        <StatCard
          label="صافي إيراد اليوم"
          value={d ? formatMoney(d.today.net) : '—'}
          unit="د.ج"
          emphasize
        />
        <StatCard
          label="نقد محصّل اليوم"
          value={d ? formatMoney(d.today.cashReceived ?? d.today.net) : '—'}
          unit="د.ج"
        />
      </div>

      {canViewDebts && d?.debt ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="إجمالي الديون"
            value={formatMoney(d.debt.totalDebt)}
            unit="د.ج"
          />
          <StatCard label="عدد المدينين" value={String(d.debt.debtorsCount)} />
          <StatCard
            label="محصّل ديون اليوم"
            value={formatMoney(d.debt.collectedToday)}
            unit="د.ج"
          />
          <StatCard
            label="دين جديد اليوم"
            value={formatMoney(d.debt.newDebtToday)}
            unit="د.ج"
          />
          <Link
            href="/sales/debts"
            className="sm:col-span-2 lg:col-span-4 text-sm font-bold text-amber-800 underline"
          >
            فتح صفحة الديون →
          </Link>
        </div>
      ) : null}

      {OIL_SOURCES.map((source) => (
        <SourceStockSection
          key={source.value}
          source={source}
          rows={d?.bySource?.[source.value]}
          canSeeLoss={canSeeLoss}
        />
      ))}

      {d?.globalByType ? (
        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
          <h2 className="mb-3 text-sm font-black">إجماليات عالمية (حسب نوع الزيت)</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-[var(--app-text-dim)]">
                <tr>
                  <th className="px-2 py-1.5 text-right font-bold">النوع</th>
                  <th className="px-2 py-1.5 text-right font-bold">المخزن</th>
                  <th className="px-2 py-1.5 text-right font-bold">الفلاح</th>
                  <th className="px-2 py-1.5 text-right font-bold">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {OIL_TYPES.map((t) => {
                  const g = d.globalByType?.[t.value];
                  return (
                    <tr key={t.value} className="border-t border-[var(--app-border)]">
                      <td className="px-2 py-2 font-bold" style={{ color: t.color }}>
                        {t.emoji} {t.label}
                      </td>
                      <td className="px-2 py-2 tabular-nums">{formatNumber(g?.stored ?? 0, 1)}</td>
                      <td className="px-2 py-2 tabular-nums">{formatNumber(g?.farmer ?? 0, 1)}</td>
                      <td className="px-2 py-2 font-black tabular-nums">
                        {formatNumber(g?.total ?? 0, 1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {(d?.containerStock ?? []).length > 0 ? (
        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
          <h2 className="mb-3 text-sm font-black">مخزون الضلف (قطعة)</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {d!.containerStock!.map((c) => (
              <Link
                key={c.id}
                href="/sales/container-stock"
                className={cn(
                  'rounded-xl border p-3',
                  c.lowStock
                    ? 'border-red-300 bg-red-50 dark:bg-red-950/30'
                    : 'border-[var(--app-border)]',
                )}
              >
                <p className="text-xs text-[var(--app-text-dim)]">{c.name}</p>
                <p className="text-xl font-black tabular-nums">{c.available}</p>
                <p className="text-xs">قطعة متاحة</p>
                {c.lowStock ? (
                  <p className="mt-1 text-xs font-bold text-red-700">
                    {c.name}: {c.available} متبقي — مخزون منخفض
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {(d?.todayContainers ?? []).length > 0 ? (
        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
          <h2 className="mb-3 text-sm font-black">تعبئة اليوم</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {d!.todayContainers!.map((c) => (
              <div
                key={`${c.name}-${c.capacityL}`}
                className="rounded-xl border border-[var(--app-border)] p-3"
              >
                <p className="text-xs text-[var(--app-text-dim)]">{c.name || `${c.capacityL} لتر`}</p>
                <p className="text-xl font-black tabular-nums">{c.count}</p>
                <p className="text-xs">{formatNumber(c.litres, 1)} لتر</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="آخر المبيعات">
          {(d?.latestSales ?? []).length === 0 ? (
            <Empty hint="لا مبيعات اليوم بعد" />
          ) : (
            <ul className="divide-y divide-[var(--app-border)]">
              {d!.latestSales.map((s) => {
                const src = s.oilSource ? oilSourceMeta(s.oilSource) : null;
                const m = s.oilType ? oilMeta(s.oilType) : null;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                    <div>
                      <p className="font-bold">
                        <Link href={OIL_SALE_DETAIL_PATH(s.id)} className="hover:underline">
                          #{s.receiptNumber}
                        </Link>
                        {' · '}
                        {saleCustomerName(s.customer)}
                      </p>
                      <p className="text-xs text-[var(--app-text-dim)]">
                        {m
                          ? `${src?.emoji ?? ''} ${m.emoji} ${formatNumber(Number(s.quantityL), 1)} لتر`
                          : 'ضلف فارغة'}{' '}
                        · {formatDateTimeDz(s.createdAt)}
                      </p>
                    </div>
                    <span className="font-black tabular-nums">
                      {formatNumber(Number(s.finalAmount), 0)} د.ج
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="آخر إضافات المخزون">
          {(d?.latestAdditions ?? []).length === 0 ? (
            <Empty hint="لا إضافات بعد">
              <Link
                href="/sales/stock"
                className="mt-2 inline-flex items-center gap-1 rounded-xl border border-[var(--app-border)] px-3 py-1.5 text-sm font-semibold"
              >
                <Plus className="h-3.5 w-3.5" /> إضافة
              </Link>
            </Empty>
          ) : (
            <ul className="divide-y divide-[var(--app-border)]">
              {d!.latestAdditions.map((m) => {
                const src = oilSourceMeta(m.oilSource);
                const meta = oilMeta(m.oilType);
                return (
                  <li key={m.id} className="flex justify-between py-2.5 text-sm">
                    <div>
                      <p className="font-bold">
                        {src.emoji} {meta.emoji} +{formatNumber(Number(m.quantityL), 1)} لتر
                      </p>
                      <p className="text-xs text-[var(--app-text-dim)]">
                        {formatDateTimeDz(m.createdAt)}
                        {m.note ? ` · ${m.note}` : ''}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function SourceStockSection({
  source,
  rows,
  canSeeLoss,
}: {
  source: (typeof OIL_SOURCES)[number];
  rows?: Record<OilTypeValue, StockSummary>;
  canSeeLoss: boolean;
}) {
  return (
    <div
      className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4"
      style={{ borderTopWidth: 4, borderTopColor: source.color }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black" style={{ color: source.color }}>
          {source.emoji} {source.label}
        </h2>
        <Droplets className="h-5 w-5" style={{ color: source.color }} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-[11px] text-[var(--app-text-dim)]">
            <tr>
              <th className="px-2 py-1.5 text-right font-bold">النوع</th>
              <th className="px-2 py-1.5 text-right font-bold">المعروض</th>
              <th className="px-2 py-1.5 text-right font-bold">المباع</th>
              {canSeeLoss ? (
                <th className="px-2 py-1.5 text-right font-bold">الفرق</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {OIL_TYPES.map((t) => {
              const s = rows?.[t.value];
              return (
                <tr key={t.value} className="border-t border-[var(--app-border)]">
                  <td className="px-2 py-2 font-bold" style={{ color: t.color }}>
                    {t.emoji} {t.label}
                  </td>
                  <td className="px-2 py-2 font-black tabular-nums">
                    {s ? formatNumber(s.theoreticalQty, 1) : '—'} لتر
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {s ? formatNumber(s.totalSold, 1) : '—'} لتر
                  </td>
                  {canSeeLoss ? (
                    <td
                      className={cn(
                        'px-2 py-2 tabular-nums',
                        (s?.lossQty ?? 0) > 0 && 'font-bold text-red-600',
                      )}
                    >
                      {s
                        ? `${formatNumber(s.lossQty, 1)} (${formatNumber(s.lossPercent, 1)}%)`
                        : '—'}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        <Link
          href="/sales/stock"
          className="rounded-xl border border-[var(--app-border)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--app-bg-muted)]"
        >
          المخزون
        </Link>
        <Link
          href="/sales/inventory"
          className="rounded-xl border border-[var(--app-border)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--app-bg-muted)]"
        >
          جرد
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  emphasize,
}: {
  label: string;
  value: string;
  unit?: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4',
        emphasize && 'border-amber-600/40 bg-amber-50/50 dark:bg-amber-950/20',
      )}
    >
      <p className="text-xs font-bold text-[var(--app-text-dim)]">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-[var(--app-text)]">
        {value}
        {unit ? (
          <span className="mr-1 text-sm font-bold text-[var(--app-text-muted)]">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <h3 className="mb-2 text-sm font-black text-[var(--app-text)]">{title}</h3>
      {children}
    </div>
  );
}

function Empty({ hint, children }: { hint: string; children?: React.ReactNode }) {
  return (
    <div className="py-6 text-center text-sm text-[var(--app-text-dim)]">
      <p>{hint}</p>
      {children}
    </div>
  );
}
