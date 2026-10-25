'use client';

import { FormEvent, use, useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Barcode,
  ClipboardList,
  Hash,
  Phone,
  Printer,
  Pencil,
  Scale,
  Table2,
  UserPlus,
  Users,
  Weight,
} from 'lucide-react';
import { toast } from 'sonner';
import { notFound } from 'next/navigation';
import { api, Paginated } from '@/lib/api';
import { TABLE_FETCH_LIMIT } from '@/lib/constants';
import { OLIVE_TYPES, slugToType, FIELD_LABELS } from '@/lib/labels';
import { orderRowClassName } from '@/lib/order-row-status';
import {
  clientMatchesSearch,
  hasClientSearchQuery,
  useTableSearchNav,
} from '@/hooks/use-table-search';
import { cn, formatNumber } from '@/lib/utils';
import { SelectionIndicator } from '@/components/ui/selection-indicator';
import { TableSearchToolbar } from '@/components/ui/table-search-toolbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OliveStatCard } from '@/components/olive/olive-stat-card';
import { WeighingsModal, type WeighingsModalClient } from '@/components/olive/weighings-modal';
import { ClientFormModal } from '@/components/clients/client-form-modal';
import { ModulePageHero } from '@/components/ui/module-page-hero';
import { OLIVE_PAGE_THEMES } from '@/lib/olive-page-theme';
import { openClientReceipt } from '@/lib/open-client-receipt';
import { openClientCard } from '@/lib/open-client-card';
import { useSeasonReadOnly } from '@/hooks/use-season-read-only';

type Entry = {
  id: string;
  referenceNumber: number;
  bagCount: number;
  totalWeightKg: string;
  adhlefCount?: number;
  capacity?: string;
  entryDate?: string;
  client: { id?: string; firstName: string; lastName: string; phone?: string };
};

type ClientBoardRow = {
  clientId: string;
  clientNumber: number;
  firstName: string;
  lastName: string;
  phone?: string | null;
  notes?: string | null;
  bagCount: number;
  totalWeightKg: number;
  adhlefCount: number;
  capacity: number;
  lastEntryDate?: string | null;
  lastReferenceNumber?: number | null;
};

export default function OliveTypePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type: slug } = use(params);
  const meta = OLIVE_TYPES.find((t) => t.slug === slug);
  const oliveType = slugToType(slug);
  if (!meta || !oliveType) notFound();

  const qc = useQueryClient();
  const { readOnly } = useSeasonReadOnly();
  // Most arrivals at reception are new clients: the form starts (and resets) on "زبون جديد".
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [newClient, setNewClient] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    notes: '',
  });

  const [bagCount, setBagCount] = useState<string>('1');
  const [totalWeightKg, setTotalWeightKg] = useState<string>('');
  const [adhlefCount, setAdhlefCount] = useState<string>('0');
  const [capacity, setCapacity] = useState<string>('0');

  const [detailOpen, setDetailOpen] = useState(false);
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const [detailClient, setDetailClient] = useState<WeighingsModalClient | null>(null);
  const [boardSelectedId, setBoardSelectedId] = useState<string | null>(null);
  const [boardRefSearch, setBoardRefSearch] = useState('');
  const [boardNameSearch, setBoardNameSearch] = useState('');
  const [boardPhoneSearch, setBoardPhoneSearch] = useState('');

  const { data: clients } = useQuery({
    queryKey: ['clients-select', oliveType, clientSearch],
    queryFn: async () =>
      (
        await api.get<
          Paginated<{
            id: string;
            clientNumber: number;
            firstName: string;
            lastName: string;
            phone?: string | null;
          }>
        >(
          '/clients',
          { params: { oliveType, search: clientSearch, limit: 15 } },
        )
      ).data,
  });

  const { data: entries } = useQuery({
    queryKey: ['olive-entries', oliveType],
    queryFn: async () =>
      (
        await api.get<Paginated<Entry>>('/olive-entries', {
          params: { oliveType, limit: 100 },
        })
      ).data,
  });

  const { data: clientBoard } = useQuery({
    queryKey: ['olive-client-board', oliveType],
    queryFn: async () =>
      (
        await api.get<{ items: ClientBoardRow[]; total: number }>(
          '/olive-entries/client-board',
          {
            params: { oliveType, limit: TABLE_FETCH_LIMIT },
          },
        )
      ).data,
  });

  const boardRows = clientBoard?.items ?? [];
  const boardSearchQuery = useMemo(
    () => ({ ref: boardRefSearch, name: boardNameSearch, phone: boardPhoneSearch }),
    [boardRefSearch, boardNameSearch, boardPhoneSearch],
  );
  const boardSearchActive = hasClientSearchQuery(boardSearchQuery);
  const boardMatchRow = useCallback(
    (row: ClientBoardRow) =>
      clientMatchesSearch(
        {
          clientNumber: row.clientNumber,
          firstName: row.firstName,
          lastName: row.lastName,
          phone: row.phone,
        },
        boardSearchQuery,
      ),
    [boardSearchQuery],
  );
  const boardSearchNav = useTableSearchNav(
    boardRows,
    (r) => r.clientId,
    boardMatchRow,
    boardSearchActive,
  );

  useEffect(() => {
    if (!boardSearchNav.currentMatchId) return;
    setBoardSelectedId(boardSearchNav.currentMatchId);
  }, [boardSearchNav.currentMatchId]);

  function runBoardSearch() {
    if (!boardSearchActive) {
      toast.message('أدخل معيار بحث');
      return;
    }
    const id = boardSearchNav.goFirst();
    if (!id) {
      toast.error('لا توجد نتائج');
      return;
    }
    setBoardSelectedId(id);
    if (boardSearchNav.matchCount > 1) {
      toast.success(`${boardSearchNav.matchCount} نتائج — استخدم الأسهم للتنقل`);
    }
  }

  const { data: nextRef } = useQuery({
    queryKey: ['next-ref', oliveType],
    queryFn: async () =>
      (
        await api.get<{ nextReferenceNumber: number }>('/olive-entries/next-reference', {
          params: { oliveType },
        })
      ).data,
  });

  const createClient = useMutation({
    mutationFn: (body: { firstName: string; lastName: string; phone?: string; notes?: string }) =>
      api.post('/clients', { ...body, oliveType }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['clients-select', oliveType] });
      return res.data;
    },
  });

  const createEntry = useMutation({
    mutationFn: (body: object) => api.post('/olive-entries', body),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['olive-entries', oliveType] });
      qc.invalidateQueries({ queryKey: ['olive-client-board', oliveType] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setTotalWeightKg('');
      setBagCount('1');
      setAdhlefCount('0');
      setCapacity('0');
      // Next client starts clean on "زبون جديد" (a kept name would register the same client twice).
      setMode('new');
      setNewClient({ firstName: '', lastName: '', phone: '', notes: '' });
      setClientId('');
      setClientSearch('');
      toast.success('تم الحفظ');
      const cid = (variables as { clientId: string }).clientId;
      if (cid) openClientReceipt(cid, { autoPrint: true, oliveType });
    },
    onError: () => toast.error('حدث خطأ'),
  });

  const selectedClientLabel = useMemo(() => {
    const c = clients?.items.find((x) => x.id === clientId);
    if (!c) return '';
    return `${c.clientNumber} — ${c.firstName} ${c.lastName}`.trim();
  }, [clients?.items, clientId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) {
      toast.error('وضع القراءة فقط — ارجع إلى الموسم الحالي للإضافة');
      return;
    }

    const bags = Number(bagCount);
    const weight = Number(totalWeightKg);
    const delfs = Number(adhlefCount);
    const cap = Number(capacity);

    if (!Number.isFinite(bags) || bags < 1) {
      toast.error('أدخل عدد الأكياس');
      return;
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error('أدخل الوزن');
      return;
    }
    if (!Number.isFinite(delfs) || delfs < 0) {
      toast.error('أدخل عدد الضلف');
      return;
    }
    if (!Number.isFinite(cap) || cap < 0) {
      toast.error('أدخل السعة');
      return;
    }

    let finalClientId = clientId;
    if (mode === 'existing') {
      if (!finalClientId) {
        toast.error('اختر زبوناً مسجلاً');
        return;
      }
    } else {
      if (!newClient.firstName.trim() || !newClient.lastName.trim()) {
        toast.error('أدخل الاسم واللقب');
        return;
      }
      try {
        const created = await createClient.mutateAsync({
          firstName: newClient.firstName.trim(),
          lastName: newClient.lastName.trim(),
          phone: newClient.phone.trim() || undefined,
          notes: newClient.notes.trim() || undefined,
        });
        finalClientId = created.data.id;
        setClientId(finalClientId);
        toast.success('تم تسجيل الزبون');
      } catch {
        toast.error('تعذر تسجيل الزبون');
        return;
      }
    }

    createEntry.mutate({
      clientId: finalClientId,
      oliveType,
      bagCount: bags,
      adhlefCount: delfs,
      capacity: cap,
      weights: [{ bagNumber: 1, weightKg: weight }],
    });
  }

  const theme = OLIVE_PAGE_THEMES[slug] ?? OLIVE_PAGE_THEMES.green;
  const boardCount = clientBoard?.total ?? boardRows.length;
  const boardTotals = useMemo(
    () =>
      boardRows.reduce(
        (acc, r) => ({
          weight: acc.weight + r.totalWeightKg,
          bags: acc.bags + r.bagCount,
        }),
        { weight: 0, bags: 0 },
      ),
    [boardRows],
  );

  return (
    <div
      className={cn('olive-intake-page module-page relative -mx-3 min-h-full px-3 pb-12 md:-mx-6 md:px-6', theme.pageBg)}
    >
      <div className={cn('pointer-events-none absolute inset-0 opacity-40', theme.pagePattern)} aria-hidden />

      <div className="relative z-10 mx-auto max-w-[1600px] space-y-5 py-5 md:py-8">
        <ModulePageHero
          gradient={theme.headerGradient}
          glow={theme.headerGlow}
          patternClass="olive-add-hero-pattern"
          icon={<span className="text-3xl">{theme.icon}</span>}
          badge={
            <span
              className={cn(
                'mb-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold backdrop-blur-md',
                theme.badge,
              )}
            >
              <ClipboardList className="h-3.5 w-3.5" />
              استقبال · {meta.label}
            </span>
          }
          title={theme.intakeTitle}
          subtitle={theme.intakeSubtitle}
          actions={
            <>
              <Link href={`/olive/${slug}/processing`}>
                <Button
                  size="sm"
                  className="gap-2 border border-white/30 bg-white/15 text-white backdrop-blur-md hover:bg-white/25"
                >
                  <Table2 className="h-4 w-4" />
                  جدول المعالجة
                </Button>
              </Link>
              <Link href="/print">
                <Button
                  size="sm"
                  className="gap-2 border border-white/30 bg-white/15 text-white backdrop-blur-md hover:bg-white/25"
                >
                  <Printer className="h-4 w-4" />
                  طباعة
                </Button>
              </Link>
            </>
          }
        />

        <div className="module-stats-enter grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OliveStatCard
            theme={theme}
            icon={Hash}
            label="الرقم التالي"
            value={nextRef?.nextReferenceNumber ?? 0}
          />
          <OliveStatCard theme={theme} icon={Users} label="الزبائن" value={boardCount} />
          <OliveStatCard
            theme={theme}
            icon={Weight}
            label="الوزن الإجمالي"
            value={boardTotals.weight}
            unit="كغ"
            decimals={1}
          />
          <OliveStatCard theme={theme} icon={Scale} label="الأكياس" value={boardTotals.bags} />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(340px,400px)_1fr]">
        <section
          className={cn(
            'module-panel-enter rounded-3xl border bg-[var(--app-surface)]/85 p-5 shadow-[var(--app-shadow-lg)] backdrop-blur-xl',
            theme.border,
          )}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-base font-black text-[var(--app-text)]">
              {readOnly ? 'إنشاء العملية (أرشيف)' : 'إنشاء العملية'}
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--app-bg-muted)] px-2.5 py-1 font-mono text-xs font-bold tabular-nums">
              <Barcode className="h-3.5 w-3.5" />
              {nextRef?.nextReferenceNumber ?? '—'}
            </span>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <fieldset disabled={readOnly} className="space-y-4 disabled:opacity-60">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('existing')}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-sm font-bold transition',
                  'focus:outline-none focus:ring-2',
                  theme.ring,
                  mode === 'existing'
                    ? cn('border-[var(--app-accent)]/30 bg-[var(--app-primary-soft)] text-[var(--app-text)]', theme.ring)
                    : 'border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text-muted)] hover:bg-[var(--app-bg-muted)]',
                )}
              >
                <Users className="h-4 w-4" />
                زبون موجود
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-sm font-bold transition',
                  'focus:outline-none focus:ring-2',
                  theme.ring,
                  mode === 'new'
                    ? cn('border-[var(--app-accent)]/30 bg-[var(--app-primary-soft)] text-[var(--app-text)]', theme.ring)
                    : 'border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text-muted)] hover:bg-[var(--app-bg-muted)]',
                )}
              >
                <UserPlus className="h-4 w-4" />
                زبون جديد
              </button>
            </div>

            {mode === 'existing' ? (
              <div className={cn('space-y-2 rounded-2xl border p-3', theme.formSection)}>
                <div className="flex items-center gap-2 text-sm font-bold text-stone-700 dark:text-stone-200">
                  <Users className="h-4 w-4 text-stone-400" />
                  اختر زبوناً
                </div>
                <Input
                  placeholder="بحث بالاسم أو الهاتف أو الرقم..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                />
                <select
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm shadow-sm dark:border-stone-600 dark:bg-stone-900"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required
                >
                  <option value="">—</option>
                  {clients?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.clientNumber} — {c.firstName} {c.lastName}
                      {c.phone ? ` (${c.phone})` : ''}
                    </option>
                  ))}
                </select>
                {selectedClientLabel && (
                  <p className="text-xs text-stone-500">
                    المحدد: <span className="font-bold">{selectedClientLabel}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className={cn('grid gap-3 rounded-2xl border p-3', theme.formSection)}>
                <div className="flex items-center gap-2 text-sm font-bold text-stone-700 dark:text-stone-200">
                  <UserPlus className="h-4 w-4 text-stone-400" />
                  بيانات الزبون (إجباري)
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="الإسم"
                    value={newClient.firstName}
                    onChange={(e) => setNewClient({ ...newClient, firstName: e.target.value })}
                    required
                  />
                  <Input
                    label="اللقب"
                    value={newClient.lastName}
                    onChange={(e) => setNewClient({ ...newClient, lastName: e.target.value })}
                    required
                  />
                </div>
                <Input
                  label={`${FIELD_LABELS.phone} (اختياري)`}
                  value={newClient.phone}
                  onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                />
                <Input
                  label="ملاحظات (اختياري)"
                  value={newClient.notes}
                  onChange={(e) => setNewClient({ ...newClient, notes: e.target.value })}
                />
              </div>
            )}

            <div className={cn('grid gap-3 rounded-2xl border p-3', theme.formSection)}>
              <div className="flex items-center gap-2 text-sm font-bold text-[var(--app-text)]">
                <Scale className="h-4 w-4 text-[var(--app-text-dim)]" />
                بيانات الوزن (إجباري)
              </div>
              <Input
                label={FIELD_LABELS.weight}
                type="number"
                step="0.01"
                value={totalWeightKg}
                onChange={(e) => setTotalWeightKg(e.target.value)}
                required
              />
              <Input
                label={FIELD_LABELS.bagCount}
                type="number"
                min={1}
                value={bagCount}
                onChange={(e) => setBagCount(e.target.value)}
                required
              />
              <Input
                label={FIELD_LABELS.adhlef}
                type="number"
                min={0}
                value={adhlefCount}
                onChange={(e) => setAdhlefCount(e.target.value)}
                required
              />
              <Input
                label={FIELD_LABELS.capacity}
                type="number"
                step="0.01"
                min={0}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                required
              />
            </div>

            <div className={cn('rounded-2xl border p-3 text-sm', theme.formSection)}>
              <div className="flex items-center justify-between">
                <span className="text-[var(--app-text-muted)]">ملخص سريع</span>
                <span className={cn('font-black', theme.accent)}>
                  {totalWeightKg ? `${formatNumber(Number(totalWeightKg) || 0)} كغ` : '—'}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-stone-500">أكياس</span>
                <span className="font-bold tabular-nums">{bagCount || '—'}</span>
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              className={cn(
                'w-full rounded-2xl bg-gradient-to-l text-white shadow-lg',
                theme.submitBtn,
              )}
              loading={createEntry.isPending || createClient.isPending}
            >
              <ClipboardList className="h-5 w-5" />
              حفظ العملية
            </Button>
            </fieldset>
          </form>
        </section>

        <section
          className={cn(
            'module-panel-enter overflow-hidden rounded-3xl border bg-[var(--app-surface)]/85 shadow-[var(--app-shadow-lg)] backdrop-blur-xl',
            theme.border,
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--app-border)] px-5 py-4">
            <h2 className="text-base font-black text-[var(--app-text)]">الزبائن (مجموع الأوزان)</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--app-bg-muted)] px-2.5 py-1 text-xs text-[var(--app-text-muted)]">
              <Phone className="h-3.5 w-3.5" />
              سطر واحد لكل زبون
            </span>
          </div>
          <div className="p-4">
          <div className="mb-3 px-1">
            <TableSearchToolbar
              fields={[
                { label: 'رقم الزبون', value: boardRefSearch, onChange: setBoardRefSearch },
                { label: 'الاسم', value: boardNameSearch, onChange: setBoardNameSearch },
                { label: 'الهاتف', value: boardPhoneSearch, onChange: setBoardPhoneSearch },
              ]}
              onSearch={runBoardSearch}
              matchCount={boardSearchNav.matchCount}
              matchIndex={boardSearchNav.matchIndex}
              onPrev={boardSearchNav.goPrev}
              onNext={boardSearchNav.goNext}
            />
          </div>
          <div className="max-h-[min(65dvh,36rem)] overflow-auto rounded-2xl border border-[var(--app-border)] scroll-smooth">
            <table className="app-table min-w-[860px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-11 px-2 py-3" />
                  <th className="px-3 py-3 text-right">الزبون</th>
                  <th className="px-3 py-3 text-right">الإسم واللقب</th>
                  <th className="px-3 py-3 text-right">الهاتف</th>
                  <th className="px-3 py-3 text-right">ملاحظات</th>
                  <th className="px-3 py-3 text-right">الأكياس</th>
                  <th className="px-3 py-3 text-right">الوزن</th>
                  <th className="px-3 py-3 text-right">الضلف</th>
                  <th className="px-3 py-3 text-right">السعة</th>
                  <th className="px-3 py-3 text-right">تفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {boardRows.map((r, i) => {
                  const isSelected = boardSelectedId === r.clientId;
                  const isSearchMatch =
                    boardSearchNav.currentMatchId === r.clientId && boardSearchActive;
                  return (
                  <tr
                    key={r.clientId}
                    id={`table-row-${r.clientId}`}
                    onClick={() => setBoardSelectedId(r.clientId)}
                    className={cn(
                      'cursor-pointer border-b border-stone-100/70 transition-colors dark:border-stone-800/70',
                      orderRowClassName({
                        isSelected,
                        isSearchMatch,
                        selectedClass: cn(
                          'bg-sky-50 ring-2 ring-sky-500/50 dark:bg-sky-950/30',
                          'shadow-sm',
                        ),
                        alternateIndex: i,
                      }),
                      'hover:bg-sky-50/70 dark:hover:bg-stone-800/50',
                    )}
                  >
                    <td className="px-2 py-2">
                      <SelectionIndicator selected={isSelected} />
                    </td>
                    <td className="px-3 py-2 font-mono font-black tabular-nums text-stone-600 dark:text-stone-300">
                      {r.clientNumber || '—'}
                    </td>
                    <td className={cn('px-3 py-2 font-semibold', theme.accent)}>
                      {r.firstName} {r.lastName}
                    </td>
                    <td className="px-3 py-2 text-stone-600 dark:text-stone-400" dir="ltr">
                      {r.phone ?? '—'}
                    </td>
                    <td
                      className="max-w-[8rem] truncate px-3 py-2 text-stone-500 dark:text-stone-400"
                      title={r.notes ?? undefined}
                    >
                      {r.notes?.trim() ? r.notes : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.bagCount}</td>
                    <td className="px-3 py-2 tabular-nums font-bold">{formatNumber(r.totalWeightKg)}</td>
                    <td className="px-3 py-2 tabular-nums">{r.adhlefCount}</td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(r.capacity)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-2 py-1.5 text-xs font-bold text-[var(--app-text)] transition hover:bg-[var(--app-primary-soft)]"
                        title="طباعة الوصل"
                        onClick={(e) => {
                          e.stopPropagation();
                          openClientReceipt(r.clientId, { oliveType });
                        }}
                      >
                        وصل
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-2 py-1.5 text-xs font-bold text-[var(--app-text)] transition hover:bg-[var(--app-bg-muted)]"
                        title="طباعة البطاقة"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openClientCard(r.clientId, oliveType).catch(() =>
                            toast.error('تعذر تحميل البطاقة'),
                          );
                        }}
                      >
                        بطاقة
                      </button>
                      {!readOnly ? (
                        <button
                          type="button"
                          className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-2 py-1.5 text-xs font-bold text-[var(--app-text)] transition hover:bg-[var(--app-bg-muted)]"
                          title="تعديل الزبون"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditClientId(r.clientId);
                          }}
                        >
                          <Pencil className="inline h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1.5 text-xs font-bold text-[var(--app-text)] transition hover:bg-[var(--app-bg-muted)]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailClient({
                            clientId: r.clientId,
                            clientNumber: r.clientNumber,
                            firstName: r.firstName,
                            lastName: r.lastName,
                            phone: r.phone,
                            notes: r.notes,
                            totals: {
                              totalWeightKg: r.totalWeightKg,
                              bagCount: r.bagCount,
                              adhlefCount: r.adhlefCount,
                              capacity: r.capacity,
                            },
                          });
                          setDetailOpen(true);
                        }}
                      >
                        تفاصيل الأوزان
                      </button>
                      </div>
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
          </div>
        </section>
        </div>
      </div>

      <WeighingsModal
        open={detailOpen}
        oliveType={oliveType}
        client={detailClient}
        onClose={() => setDetailOpen(false)}
      />

      {editClientId && !readOnly ? (
        <ClientFormModal
          mode="edit"
          clientId={editClientId}
          defaultOliveType={oliveType}
          onClose={() => setEditClientId(null)}
        />
      ) : null}
    </div>
  );
}
