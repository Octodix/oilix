'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Droplets, ListOrdered } from 'lucide-react';
import { ModulePageHero } from '@/components/ui/module-page-hero';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { TABLE_FETCH_LIMIT } from '@/lib/constants';
import { OLIVE_TYPES, type OliveTypeValue } from '@/lib/labels';
import { computePressingAmount, orderRowClassName } from '@/lib/order-row-status';
import {
  clientMatchesSearch,
  hasClientSearchQuery,
  useTableSearchNav,
} from '@/hooks/use-table-search';
import { cn, formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { SelectionIndicator } from '@/components/ui/selection-indicator';
import { TableSearchToolbar } from '@/components/ui/table-search-toolbar';
import { SearchableClientPicker } from '@/components/pressing/searchable-client-picker';
import { AssistancePanel } from '@/components/assistance/assistance-panel';
import {
  WeighingsModal,
  type WeighingsModalClient,
} from '@/components/olive/weighings-modal';
import { useSeasonReadOnly } from '@/hooks/use-season-read-only';

type UntreatedClientRow = {
  clientId: string;
  clientNumber: number;
  firstName: string;
  lastName: string;
  phone?: string | null;
  bagCount: number;
  totalWeightKg: number;
  adhlefCount: number;
  capacity: number;
  entryCount: number;
  latestEntryId: string | null;
};

type PressingClientRow = {
  clientId: string;
  clientNumber: number;
  clientName: string;
  phone?: string | null;
  pressingCount: number;
  oilQuantityL: number;
  amount: number;
  aidAmount: number;
  netAmount: number;
  oilCollected: boolean;
  paid: boolean;
  bagCount: number;
  totalWeightKg: number;
  adhlefCount: number;
  capacity: number;
};

const PRESSING_ROW_SELECTED =
  'bg-violet-50 ring-2 ring-violet-500/45 dark:bg-violet-950/30 shadow-sm';

const OLIVE_TYPE_EMOJI: Record<OliveTypeValue, string> = {
  GREEN: '🟢',
  ZBOUCH: '🫒',
  RIPE: '⚫',
};

export default function PressingPage() {
  const qc = useQueryClient();
  const { readOnly } = useSeasonReadOnly();
  const [oliveType, setOliveType] = useState<OliveTypeValue | ''>('');
  const [formClientId, setFormClientId] = useState('');
  const [tableSelectedId, setTableSelectedId] = useState<string | null>(null);
  const [refSearch, setRefSearch] = useState('');
  const [nameSearch, setNameSearch] = useState('');
  const [phoneSearch, setPhoneSearch] = useState('');
  const [weighingsOpen, setWeighingsOpen] = useState(false);
  const [weighingsClient, setWeighingsClient] = useState<WeighingsModalClient | null>(null);

  const selectedTypeMeta = useMemo(
    () => OLIVE_TYPES.find((t) => t.value === oliveType) ?? null,
    [oliveType],
  );

  const { data: pricePerQuintal = 0 } = useQuery({
    queryKey: ['dashboard-price'],
    queryFn: async () =>
      (await api.get<{ pricePerQuintal: number }>('/dashboard')).data.pricePerQuintal,
  });

  const { data: untreatedClients } = useQuery({
    queryKey: ['olive-untreated-clients', oliveType],
    enabled: !!oliveType,
    queryFn: async () =>
      (
        await api.get<{ items: UntreatedClientRow[] }>('/olive-entries/client-board', {
          params: {
            untreatedOnly: true,
            oliveType,
            limit: TABLE_FETCH_LIMIT,
          },
        })
      ).data.items,
  });

  const { data: byClient } = useQuery({
    queryKey: ['pressing-by-client', oliveType],
    enabled: !!oliveType,
    queryFn: async () =>
      (
        await api.get<PressingClientRow[]>('/pressing/by-client', {
          params: { oliveType },
        })
      ).data,
  });

  const rows = byClient ?? [];
  const searchQuery = useMemo(
    () => ({ ref: refSearch, name: nameSearch, phone: phoneSearch }),
    [refSearch, nameSearch, phoneSearch],
  );
  const searchActive = hasClientSearchQuery(searchQuery);

  const matchRow = useCallback(
    (row: PressingClientRow) =>
      clientMatchesSearch(
        { clientNumber: row.clientNumber, clientName: row.clientName, phone: row.phone },
        searchQuery,
      ),
    [searchQuery],
  );

  const searchNav = useTableSearchNav(rows, (r) => r.clientId, matchRow, searchActive);

  useEffect(() => {
    if (!searchNav.currentMatchId) return;
    setTableSelectedId(searchNav.currentMatchId);
  }, [searchNav.currentMatchId]);

  useEffect(() => {
    setFormClientId('');
    setTableSelectedId(null);
    setRefSearch('');
    setNameSearch('');
    setPhoneSearch('');
  }, [oliveType]);

  const formClient = useMemo(
    () => untreatedClients?.find((c) => c.clientId === formClientId),
    [untreatedClients, formClientId],
  );

  const selectedEntryId = formClient?.latestEntryId ?? '';
  const selectedWeight = formClient?.totalWeightKg ?? 0;
  const computedAmount = computePressingAmount(pricePerQuintal, selectedWeight);

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post('/pressing', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pressing-by-client'] });
      void qc.invalidateQueries({ queryKey: ['olive-untreated-clients'] });
      void qc.invalidateQueries({ queryKey: ['processing-board'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      setFormClientId('');
      toast.success('تم تسجيل التصفية');
    },
    onError: () => toast.error('حدث خطأ'),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly) {
      toast.error('وضع القراءة فقط — ارجع إلى الموسم الحالي');
      return;
    }
    if (!oliveType) {
      toast.error('اختر نوع الزيتون أولاً');
      return;
    }
    if (!selectedEntryId) {
      toast.error('اختر زبوناً');
      return;
    }
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      oliveEntryId: selectedEntryId,
      oilQuantityL: Number(fd.get('oilQuantityL')),
      region: fd.get('region') || undefined,
      zayat: fd.get('zayat') || undefined,
      aidAmount: Number(fd.get('aidAmount')) || 0,
      oilCollected: fd.get('oilCollected') === 'on',
      paid: fd.get('paid') === 'on',
      notes: fd.get('notes') || undefined,
      auditContext: 'extraction',
    });
  }

  function openWeighings(row: PressingClientRow) {
    const parts = row.clientName.trim().split(/\s+/);
    setWeighingsClient({
      clientId: row.clientId,
      clientNumber: row.clientNumber,
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      phone: row.phone,
      totals: {
        totalWeightKg: row.totalWeightKg,
        bagCount: row.bagCount,
        adhlefCount: row.adhlefCount,
        capacity: row.capacity,
      },
    });
    setWeighingsOpen(true);
  }

  function runSearch() {
    if (!searchActive) {
      toast.message('أدخل معيار بحث');
      return;
    }
    const id = searchNav.goFirst();
    if (!id) {
      toast.error('لا توجد نتائج');
      return;
    }
    setTableSelectedId(id);
  }

  return (
    <div className="pressing-page module-page relative -mx-3 min-h-full space-y-6 px-3 pb-12 md:-mx-6 md:px-6">
      <div className="module-page-bg" aria-hidden />
      <div className="relative z-10 mx-auto max-w-6xl space-y-6 py-5 md:py-8">
        <ModulePageHero
          gradient="from-amber-900 via-amber-800 to-orange-700"
          glow="shadow-amber-800/25"
          patternClass="olive-add-hero-pattern"
          icon={<Droplets className="h-7 w-7 text-white" />}
          title="تصفية الزيت"
          subtitle={
            selectedTypeMeta
              ? `تسجيل نتائج التصفية · ${selectedTypeMeta.label} · ${rows.length} زبون`
              : 'اختر نوع الزيتون أولاً ثم سجّل التصفية'
          }
        />
        <AssistancePanel compact />

        <Card title="1 — نوع الزيتون">
          <div className="grid gap-3 sm:grid-cols-3">
            {OLIVE_TYPES.map((t) => {
              const active = oliveType === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setOliveType(t.value)}
                  className={cn(
                    'rounded-2xl border px-4 py-5 text-center transition',
                    active
                      ? 'border-amber-700 bg-amber-50 shadow-sm ring-2 ring-amber-600/30 dark:bg-amber-950/40'
                      : 'border-[var(--app-border)] bg-[var(--app-surface)] hover:bg-[var(--app-bg-muted)]',
                  )}
                >
                  <p className="text-2xl">{OLIVE_TYPE_EMOJI[t.value]}</p>
                  <p className="mt-2 text-base font-black">{t.label}</p>
                  {active ? (
                    <p className="mt-1 text-xs font-bold text-amber-800">محدد</p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </Card>

        {!oliveType ? (
          <div className="rounded-2xl border border-dashed border-[var(--app-border)] bg-[var(--app-surface)]/70 px-6 py-12 text-center">
            <p className="text-lg font-black text-[var(--app-text)]">اختر نوع الزيتون للمتابعة</p>
            <p className="mt-2 text-sm text-[var(--app-text-dim)]">
              الأخضر · الزبوش · الطايب — ثم يظهر نموذج التسجيل والسجل
            </p>
          </div>
        ) : (
          <>
            <Card
              title={
                readOnly
                  ? `2 — تسجيل تصفية (معطّل — أرشيف) · ${selectedTypeMeta?.label}`
                  : `2 — تسجيل تصفية جديد · ${selectedTypeMeta?.label}`
              }
            >
              <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
                <fieldset disabled={readOnly} className="contents disabled:opacity-60">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium">الزبون (غير معالج)</label>
                    <SearchableClientPicker
                      clients={untreatedClients ?? []}
                      value={formClientId}
                      onChange={setFormClientId}
                      disabled={readOnly}
                      required
                      placeholder="ابحث بالرقم أو الاسم أو الهاتف…"
                    />
                    {formClient && formClient.entryCount > 1 && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        يوجد {formClient.entryCount} عمليات وزن — تُسجَّل التصفية على آخر عملية
                      </p>
                    )}
                    {!readOnly && (untreatedClients?.length ?? 0) === 0 ? (
                      <p className="mt-1 text-xs text-[var(--app-text-dim)]">
                        لا يوجد زبائن غير معالجين لهذا النوع حالياً
                      </p>
                    ) : null}
                  </div>
                  <Input
                    name="oilQuantityL"
                    label="كمية الزيت (لتر)"
                    type="number"
                    step="0.01"
                    required
                  />
                  <div>
                    <label className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
                      المبلغ
                    </label>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                      {formClientId ? formatNumber(computedAmount) : '—'}
                    </div>
                    {formClientId && pricePerQuintal > 0 && (
                      <p className="mt-1 text-xs text-stone-500">
                        {formatNumber(pricePerQuintal)} دج/ق ×{' '}
                        {formatNumber(selectedWeight / 100, 2)} ق ({formatNumber(selectedWeight)} كغ)
                      </p>
                    )}
                  </div>
                  <Input name="region" label="المنطقة" />
                  <Input name="zayat" label="الزيات" />
                  <Input
                    name="aidAmount"
                    label="المساعدة"
                    type="number"
                    step="0.01"
                    defaultValue={0}
                  />
                  <Input name="notes" label="ملاحظات" className="md:col-span-2" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="oilCollected" className="h-4 w-4 rounded" />
                    استلم الزبون زيته
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="paid" className="h-4 w-4 rounded" />
                    دفع الزبون
                  </label>
                  <div className="md:col-span-2">
                    <Button
                      type="submit"
                      loading={createMutation.isPending}
                      disabled={!selectedEntryId}
                    >
                      حفظ
                    </Button>
                  </div>
                </fieldset>
              </form>
            </Card>

            <Card title={`3 — سجل التصفية · ${selectedTypeMeta?.label} (مجموع حسب الزبون)`}>
              <div className="mb-3 space-y-3">
                <TableSearchToolbar
                  fields={[
                    { label: 'رقم الزبون', value: refSearch, onChange: setRefSearch },
                    { label: 'الاسم', value: nameSearch, onChange: setNameSearch },
                    { label: 'الهاتف', value: phoneSearch, onChange: setPhoneSearch },
                  ]}
                  onSearch={runSearch}
                  matchCount={searchNav.matchCount}
                  matchIndex={searchNav.matchIndex}
                  onPrev={searchNav.goPrev}
                  onNext={searchNav.goNext}
                />
                <div className="flex flex-wrap gap-3 text-xs text-stone-600">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                      ✓
                    </span>
                    السطر المحدد
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-6 rounded ring-2 ring-amber-400 bg-amber-50" />
                    نتيجة البحث
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-6 rounded bg-emerald-200" /> أخذ الزيت
                  </span>
                </div>
              </div>
              <div className="max-h-[min(65dvh,36rem)] overflow-y-auto scroll-smooth">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur dark:bg-stone-900/95">
                    <tr className="border-b bg-stone-50 dark:bg-stone-800/50">
                      <th className="w-11 px-2 py-3" />
                      <th className="px-3 py-3 text-right">الزبون</th>
                      <th className="px-3 py-3 text-right">الاسم</th>
                      <th className="px-3 py-3 text-right">الأكياس / الوزن</th>
                      <th className="px-3 py-3 text-right">الزيت (ل)</th>
                      <th className="px-3 py-3 text-right">المبلغ</th>
                      <th className="px-3 py-3 text-right">الصافي</th>
                      <th className="px-3 py-3 text-right">الأخذ</th>
                      <th className="px-3 py-3 text-right">الدفع</th>
                      <th className="px-3 py-3 text-right">تفاصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const isSelected = tableSelectedId === r.clientId;
                      const isSearchMatch =
                        searchNav.currentMatchId === r.clientId && searchActive;
                      return (
                        <tr
                          key={r.clientId}
                          id={`table-row-${r.clientId}`}
                          onClick={() => setTableSelectedId(r.clientId)}
                          className={cn(
                            'cursor-pointer border-b transition-colors',
                            orderRowClassName({
                              isCancelled: false,
                              oilCollected: r.oilCollected,
                              isSelected,
                              isSearchMatch,
                              selectedClass: PRESSING_ROW_SELECTED,
                              alternateIndex: i,
                            }),
                          )}
                        >
                          <td className="px-2 py-3">
                            <SelectionIndicator selected={isSelected} />
                          </td>
                          <td className="px-3 py-3 font-mono font-bold tabular-nums">
                            {r.clientNumber}
                          </td>
                          <td className="px-3 py-3">
                            {r.clientName}
                            {r.pressingCount > 1 && (
                              <span className="mr-1 text-xs text-stone-500">
                                ({r.pressingCount} تصفية)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 tabular-nums text-stone-600">
                            {r.bagCount} · {formatNumber(r.totalWeightKg)} كغ
                          </td>
                          <td className="px-3 py-3">{formatNumber(r.oilQuantityL)} ل</td>
                          <td className="px-3 py-3">{formatNumber(r.amount)} د</td>
                          <td className="px-3 py-3 font-bold">{formatNumber(r.netAmount)} د</td>
                          <td className="px-3 py-3">{r.oilCollected ? '✓' : '—'}</td>
                          <td className="px-3 py-3">{r.paid ? '✓' : '—'}</td>
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800"
                              onClick={() => openWeighings(r)}
                            >
                              <ListOrdered className="h-3.5 w-3.5" />
                              تفاصيل الأوزان
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="px-3 py-8 text-center text-sm text-[var(--app-text-dim)]"
                        >
                          لا سجلات تصفية لهذا النوع بعد
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        <WeighingsModal
          open={weighingsOpen}
          oliveType={oliveType || undefined}
          client={weighingsClient}
          onClose={() => setWeighingsOpen(false)}
        />
      </div>
    </div>
  );
}
