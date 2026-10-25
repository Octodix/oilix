'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Check,
  Droplets,
  Layers,
  ListOrdered,
  Pencil,
  Plus,
  Printer,
  CreditCard,
  Scale,
  User,
  Wallet,
  Banknote,
} from 'lucide-react';
import { toast } from 'sonner';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { TABLE_FETCH_LIMIT } from '@/lib/constants';
import { slugToType } from '@/lib/labels';
import { openClientCard } from '@/lib/open-client-card';
import { computePressingAmount } from '@/lib/order-row-status';
import {
  clientMatchesSearch,
  hasClientSearchQuery,
  useTableSearchNav,
} from '@/hooks/use-table-search';
import { cn, formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ModulePageHero } from '@/components/ui/module-page-hero';
import { TableSearchToolbar } from '@/components/ui/table-search-toolbar';
import { ProcessingEditModal } from '@/components/processing/processing-edit-modal';
import { AssistancePanel } from '@/components/assistance/assistance-panel';
import { useSeasonReadOnly } from '@/hooks/use-season-read-only';
import { ProcessingStatCard } from '@/components/processing/processing-stat-card';
import { ProcessingTable, type ProcessingRow } from '@/components/processing/processing-table';
import { PROCESSING_THEMES } from '@/components/processing/processing-theme';
import {
  WeighingsModal,
  type WeighingsModalClient,
} from '@/components/olive/weighings-modal';

type FilterKey = 'all' | 'unmilled' | 'taken' | 'paid' | 'full_aid' | 'cancelled';

type BoardResponse = {
  items: ProcessingRow[];
  totals: {
    bagCount: number;
    totalWeightKg: number;
    amount: number;
    aidAmount: number;
    netAmount: number;
    oilQuantityL: number;
  };
  total: number;
  pricePerQuintal: number;
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'unmilled', label: 'غير مرحي' },
  { key: 'taken', label: 'أخذه' },
  { key: 'paid', label: 'سالك' },
  { key: 'full_aid', label: 'مساعدة 100%' },
  { key: 'cancelled', label: 'ملغى' },
];

export default function ProcessingPage({ params }: { params: Promise<{ type: string }> }) {
  const { type: slug } = use(params);
  const oliveType = slugToType(slug);
  const theme = PROCESSING_THEMES[slug];
  if (!oliveType || !theme) notFound();

  const qc = useQueryClient();
  const { readOnly } = useSeasonReadOnly();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [refSearch, setRefSearch] = useState('');
  const [nameSearch, setNameSearch] = useState('');
  const [phoneSearch, setPhoneSearch] = useState('');
  const [selected, setSelected] = useState<ProcessingRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [weighingsOpen, setWeighingsOpen] = useState(false);
  const [weighingsClient, setWeighingsClient] = useState<WeighingsModalClient | null>(null);
  const [form, setForm] = useState({
    oilQuantityL: '',
    aidAmount: '0',
    region: '',
    zayat: '',
    yieldPercent: '',
    notes: '',
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['processing-board', oliveType, filter],
    queryFn: async () =>
      (
        await api.get<BoardResponse>('/pressing/board', {
          params: { oliveType, filter, limit: TABLE_FETCH_LIMIT },
        })
      ).data,
  });

  const rows = data?.items ?? [];
  const totals = data?.totals;
  const searchQuery = useMemo(
    () => ({ ref: refSearch, name: nameSearch, phone: phoneSearch }),
    [refSearch, nameSearch, phoneSearch],
  );
  const searchActive = hasClientSearchQuery(searchQuery);

  const matchRow = useCallback(
    (row: ProcessingRow) => clientMatchesSearch(row, searchQuery),
    [searchQuery],
  );

  const searchNav = useTableSearchNav(rows, (r) => r.clientId, matchRow, searchActive);

  useEffect(() => {
    if (!searchNav.currentMatchId) return;
    const row = rows.find((r) => r.clientId === searchNav.currentMatchId);
    if (row) setSelected(row);
  }, [searchNav.currentMatchId, rows]);

  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => r.clientId === selected.clientId);
    if (!fresh) {
      setSelected(null);
      return;
    }
    if (fresh !== selected) setSelected(fresh);
  }, [rows, selected]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['processing-board'] });
  const pricePerQuintal = data?.pricePerQuintal ?? 0;

  const collectMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      api.patch(`/pressing/${id}/collect`, undefined, { params: { value } }),
    onSuccess: (_data, vars) => {
      invalidate();
      toast.success(vars.value ? 'تم تسجيل أخذ الزيت' : 'تم استرجاع أخذ الزيت');
    },
    onError: () => toast.error('تعذر تحديث حالة أخذ الزيت'),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      api.patch(`/pressing/${id}/pay`, undefined, { params: { value } }),
    onSuccess: (_data, vars) => {
      invalidate();
      toast.success(vars.value ? 'تم تسجيل الدفع (سالك)' : 'تم استرجاع الدفع (سالك)');
    },
    onError: () => toast.error('تعذر تحديث حالة الدفع'),
  });

  const cancelMutation = useMutation({
    mutationFn: (entryId: string) => api.post(`/pressing/entries/${entryId}/cancel`, {}),
    onSuccess: () => {
      invalidate();
      setSelected(null);
      toast.success('تم الإلغاء');
    },
  });

  const savePressing = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const amount = computePressingAmount(pricePerQuintal, selected.totalWeightKg);
      const body = {
        oliveEntryId: selected.id,
        oilQuantityL: Number(form.oilQuantityL),
        amount,
        aidAmount: Number(form.aidAmount) || 0,
        region: form.region || undefined,
        zayat: form.zayat || undefined,
        yieldPercent: form.yieldPercent ? Number(form.yieldPercent) : undefined,
        notes: form.notes || undefined,
        oilCollected: false,
        paid: false,
        auditContext: 'processing',
      };
      if (selected.pressingId) return api.patch(`/pressing/${selected.pressingId}`, body);
      return api.post('/pressing', body);
    },
    onSuccess: () => {
      setEditOpen(false);
      invalidate();
      toast.success('تم الحفظ');
    },
    onError: () => toast.error('حدث خطأ'),
  });

  function openEdit(row: ProcessingRow) {
    setSelected(row);
    setForm({
      oilQuantityL: row.oilQuantityL?.toString() ?? '',
      aidAmount: row.aidAmount?.toString() ?? '0',
      region: row.region ?? '',
      zayat: '',
      yieldPercent: row.yieldPercent?.toString() ?? '',
      notes: row.notes ?? '',
    });
    setEditOpen(true);
  }

  function openWeighings(row: ProcessingRow) {
    setWeighingsClient({
      clientId: row.clientId,
      clientNumber: row.clientNumber,
      firstName: row.firstName ?? row.clientName.split(' ')[0] ?? '',
      lastName: row.lastName ?? row.clientName.split(' ').slice(1).join(' ') ?? '',
      phone: row.phone,
      totals: {
        totalWeightKg: row.totalWeightKg,
        bagCount: row.bagCount,
        adhlefCount: row.adhlefCount ?? 0,
        capacity: row.capacity ?? 0,
      },
    });
    setWeighingsOpen(true);
  }

  function applyFilter(next: FilterKey) {
    setFilter(next);
    setSelected(null);
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
    const row = rows.find((r) => r.clientId === id);
    if (row) setSelected(row);
    if (searchNav.matchCount > 1) {
      toast.success(`${searchNav.matchCount} نتائج — استخدم الأسهم للتنقل`);
    }
  }

  const heroActions = (
    <>
      <Link href={`/olive/${slug}`}>
        <Button
          size="sm"
          className="gap-2 border border-white/30 bg-white/15 text-white backdrop-blur-md hover:bg-white/25"
        >
          <Plus className="h-4 w-4" />
          استقبال
        </Button>
      </Link>
      <Link href="/print">
        <Button
          size="sm"
          className="gap-2 border border-white/30 bg-white/15 text-white backdrop-blur-md hover:bg-white/25"
        >
          <Printer className="h-4 w-4" />
          مركز الطباعة
        </Button>
      </Link>
      <Button
        size="sm"
        className="gap-2 border border-white/30 bg-white/15 text-white backdrop-blur-md hover:bg-white/25 disabled:opacity-40"
        disabled={!selected?.pressingId}
        onClick={() => {
          if (!selected?.id) return;
          window.open(`/receipt/${selected.id}`, '_blank', 'noopener');
        }}
      >
        <Printer className="h-4 w-4" />
        وصل المحدد
      </Button>
    </>
  );

  return (
    <div
      className={cn(
        'processing-page relative -mx-3 min-h-full px-3 pb-28 md:-mx-6 md:px-6',
        theme.pageBg,
      )}
      style={{ ['--processing-scrollbar' as string]: theme.scrollbar }}
    >
      <div className={cn('pointer-events-none absolute inset-0 opacity-40', theme.pagePattern)} aria-hidden />

      <div className="relative z-10 mx-auto max-w-[1600px] space-y-4">
        <ModulePageHero
          gradient={theme.headerGradient}
          glow={theme.headerGlow}
          patternClass="olive-add-hero-pattern"
          icon={<span>{theme.icon}</span>}
          badge={
            <span
              className={cn(
                'mb-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold backdrop-blur-md',
                theme.heroBadge,
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              جدول المعالجة · {data?.total ?? rows.length} زبون
            </span>
          }
          title={theme.label}
          subtitle={theme.subtitle}
          actions={heroActions}
        />

        {/* Operator assistance: start / live cash held / close + handover, right where the work is. */}
        <AssistancePanel />

        <div className="module-stats-enter grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ProcessingStatCard
            theme={theme}
            icon={Scale}
            label="الوزن الإجمالي"
            value={totals?.totalWeightKg ?? 0}
            unit="كغ"
          />
          <ProcessingStatCard
            theme={theme}
            icon={Droplets}
            label="كمية الزيت"
            value={totals?.oilQuantityL ?? 0}
            unit="ل"
          />
          <ProcessingStatCard
            theme={theme}
            icon={Banknote}
            label="الصافي"
            value={totals?.netAmount ?? 0}
            unit="دج"
          />
          <ProcessingStatCard
            theme={theme}
            icon={Wallet}
            label="سعر القنطار"
            value={pricePerQuintal}
            unit="دج/ق"
          />
        </div>

        <section
          className={cn(
            'module-panel-enter space-y-4 rounded-3xl border p-4 shadow-[var(--app-shadow-lg)] sm:p-5',
            theme.border,
            'bg-[var(--app-surface)]/85 backdrop-blur-xl',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--app-text-dim)]">
              تصفية
            </span>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => applyFilter(f.key)}
                className={cn(
                  'rounded-xl px-4 py-2 text-sm font-bold transition-all',
                  filter === f.key ? theme.pillActive : theme.pillInactive,
                )}
              >
                {f.label}
              </button>
            ))}
            <span
              className="mx-1 hidden h-6 w-px bg-[var(--app-border)] sm:block"
              aria-hidden
            />
            <span className="text-xs font-bold text-[var(--app-text-muted)]">دليل</span>
            <LegendItem dot="bg-emerald-500 text-white" label="محدد" check />
            <LegendItem ring="ring-amber-400 bg-amber-50" label="بحث" />
            <LegendItem swatch="bg-emerald-200" label="أخذ الزيت" />
            <LegendItem swatch="bg-red-200" label="ملغى" />
          </div>

          <TableSearchToolbar
            fields={[
              { label: 'الرقم', value: refSearch, onChange: setRefSearch },
              { label: 'الاسم واللقب', value: nameSearch, onChange: setNameSearch },
              { label: 'رقم الهاتف', value: phoneSearch, onChange: setPhoneSearch },
            ]}
            onSearch={runSearch}
            matchCount={searchNav.matchCount}
            matchIndex={searchNav.matchIndex}
            onPrev={searchNav.goPrev}
            onNext={searchNav.goNext}
            className="!border-0 !bg-transparent !p-0 !shadow-none"
          />

          {isError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              تعذر تحميل البيانات.{' '}
              <button type="button" className="font-bold underline" onClick={() => refetch()}>
                إعادة المحاولة
              </button>
              {error instanceof Error && (
                <span className="mt-1 block text-xs opacity-80">{error.message}</span>
              )}
            </div>
          )}

          <ProcessingTable
            rows={rows}
            theme={theme}
            pricePerQuintal={pricePerQuintal}
            selectedClientId={selected?.clientId ?? null}
            highlightClientId={searchNav.currentMatchId}
            loading={isLoading}
            onSelect={setSelected}
            onWeighingsDetail={openWeighings}
          />
        </section>
      </div>

      {selected && (
        <div className="processing-dock-enter fixed bottom-4 left-1/2 z-40 w-[min(98%,72rem)] -translate-x-1/2 px-2 sm:bottom-6">
          <div
            className={cn(
              'relative flex flex-col items-center gap-3 rounded-2xl border-2 bg-[var(--app-surface)]/95 px-4 py-3 shadow-[var(--app-shadow-lg)] backdrop-blur-xl sm:min-h-[4.25rem] sm:flex-row sm:justify-center sm:gap-0 sm:px-5',
              theme.dockBorder,
            )}
          >
            <div className="flex w-full items-center justify-center gap-2 sm:absolute sm:inset-y-0 sm:right-4 sm:w-auto sm:justify-end">
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', theme.statIcon)}>
                <User className="h-4 w-4" />
              </span>
              <div className="min-w-0 text-center sm:max-w-[16rem] sm:text-right">
                <p
                  className="text-sm font-black leading-snug text-stone-900 dark:text-white"
                  title={selected.clientName}
                >
                  {selected.clientName}
                </p>
                <p className="text-xs text-stone-500">
                  زبون {selected.clientNumber}
                  {selected.entryCount > 1 ? ` · ${selected.entryCount} وزن` : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
            <DockBtn icon={ListOrdered} label="الأوزان" onClick={() => openWeighings(selected)} />
            <DockBtn
              icon={CreditCard}
              label="بطاقة"
              onClick={() => {
                void openClientCard(selected.clientId, oliveType).catch(() =>
                  toast.error('تعذر تحميل البطاقة'),
                );
              }}
            />
            {!readOnly ? (
              <DockBtn icon={Pencil} label="تعديل" onClick={() => openEdit(selected)} />
            ) : null}
            {selected.pressingId && (
              <DockBtn
                icon={Printer}
                label="وصل"
                onClick={() => window.open(`/receipt/${selected.id}`, '_blank', 'noopener')}
              />
            )}
            {!readOnly && selected.pressingId ? (
              <DockBtn
                icon={Check}
                label="أخذه"
                tone="success"
                done={selected.oilCollected}
                onClick={() => {
                  const next = !selected.oilCollected;
                  if (
                    !next &&
                    !confirm('استرجاع عملية أخذ الزيت؟ سيعود الزبون إلى حالة غير مأخوذ.')
                  ) {
                    return;
                  }
                  collectMutation.mutate({ id: selected.pressingId!, value: next });
                }}
              />
            ) : null}
            {!readOnly && selected.pressingId ? (
              <DockBtn
                icon={Wallet}
                label="سالك"
                tone="info"
                done={selected.paid}
                onClick={() => {
                  const next = !selected.paid;
                  if (!next && !confirm('استرجاع عملية الدفع (سالك)؟')) {
                    return;
                  }
                  payMutation.mutate({ id: selected.pressingId!, value: next });
                }}
              />
            ) : null}
            {!readOnly && !selected.isCancelled && (
              <DockBtn
                icon={Ban}
                label="ملغى"
                tone="danger"
                onClick={() => {
                  if (confirm('إلغاء هذه العملية؟')) cancelMutation.mutate(selected.id);
                }}
              />
            )}
            </div>
          </div>
        </div>
      )}

      <WeighingsModal
        open={weighingsOpen}
        oliveType={oliveType}
        client={weighingsClient}
        onClose={() => setWeighingsOpen(false)}
      />

      <ProcessingEditModal
        open={editOpen}
        referenceNumber={selected?.referenceNumber ?? 0}
        clientName={selected?.clientName ?? ''}
        isEdit={!!selected?.pressingId}
        form={form}
        totalWeightKg={selected?.totalWeightKg ?? 0}
        pricePerQuintal={pricePerQuintal}
        loading={savePressing.isPending}
        accentGradient={`bg-gradient-to-l ${theme.headerGradient}`}
        onClose={() => setEditOpen(false)}
        onChange={setForm}
        readOnly={readOnly}
        onSave={() => savePressing.mutate()}
      />
    </div>
  );
}

function LegendItem({
  label,
  dot,
  ring,
  swatch,
  check,
}: {
  label: string;
  dot?: string;
  ring?: string;
  swatch?: string;
  check?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          'h-4 w-4 rounded',
          dot && `inline-flex items-center justify-center text-[9px] font-bold ${dot}`,
          ring && `ring-2 ${ring}`,
          swatch && swatch,
        )}
      >
        {check ? '✓' : null}
      </span>
      {label}
    </span>
  );
}

function DockBtn({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
  done = false,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'success' | 'info' | 'danger';
  done?: boolean;
}) {
  const tones = {
    default:
      'bg-stone-100 text-stone-800 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-600/25 shadow-md',
    info: 'bg-sky-600 text-white hover:bg-sky-700 shadow-md',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-md',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition',
        done ? 'bg-stone-200 text-stone-500 ring-1 ring-stone-300 dark:bg-stone-800 dark:text-stone-400' : tones[tone],
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {done ? ' ✓' : null}
    </button>
  );
}
