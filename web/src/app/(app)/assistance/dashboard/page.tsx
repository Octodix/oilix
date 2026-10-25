'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatMoney, formatNumber, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/lib/auth-store';
import { useDirectPrint } from '@/hooks/use-direct-print';
import { millHandoverReceiptRequest } from '@/lib/print-documents';
import {
  HANDOVER_STATUS_AR,
  type MillHandoverReceiptPayload,
} from '@/components/print/mill-handover-receipt-document';

type Session = MillHandoverReceiptPayload['session'];
type Dashboard = {
  active: Session[];
  awaiting: Session[];
  discrepancies: Session[];
  confirmedToday: Session[];
  summary: {
    activeCount: number;
    awaitingCount: number;
    discrepancyCount: number;
    collectedByActiveAssistants: number;
    cashHeldByActiveAssistants: number;
    cashAwaitingConfirmation: number;
    cashConfirmedToday: number;
  };
};
type ApiError = { response?: { data?: { message?: string | string[] } } };
const KEY = ['mill-assist-dashboard'] as const;

function apiMessage(e: ApiError, fallback: string) {
  const m = e.response?.data?.message;
  return Array.isArray(m) ? m.join('\n') : m || fallback;
}

/** Primary operator view: who is helping, what they collected, and confirming cash handovers. */
export default function AssistanceDashboardPage() {
  const qc = useQueryClient();
  const canConfirm = useAuthStore((s) => s.hasPermission('MILL_ASSIST_CONFIRM'));
  const canResolve = useAuthStore((s) => s.hasPermission('MILL_ASSIST_RESOLVE'));
  const canView = useAuthStore((s) => s.hasPermission('MILL_ASSIST_VIEW_ALL')) || canConfirm;
  const { print: directPrint, busy: printing } = useDirectPrint();
  const q = useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<Dashboard>('/mill-assistance/dashboard')).data,
    refetchInterval: 15_000,
    enabled: canView,
  });
  const [received, setReceived] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const confirm = useMutation({
    mutationFn: async (s: Session) =>
      (
        await api.post<Session>(`/mill-assistance/sessions/${s.id}/confirm`, {
          receivedHandover: Number(received[s.id] ?? s.declaredHandover ?? 0),
          note: notes[s.id]?.trim() || undefined,
        })
      ).data,
    onSuccess: (s) => {
      toast[s.status === 'CONFIRMED' ? 'success' : 'warning'](
        s.status === 'CONFIRMED' ? `تم تأكيد استلام ${formatMoney(s.receivedHandover ?? 0)} د.ج (${s.reference})` : `سُجّل فرق ${formatMoney(s.difference)} د.ج في ${s.reference}`,
      );
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: ApiError) => toast.error(apiMessage(e, 'تعذر تأكيد الاستلام')),
  });

  const resolve = useMutation({
    mutationFn: async (s: Session) =>
      (await api.post<Session>(`/mill-assistance/sessions/${s.id}/resolve`, { resolutionNote: notes[s.id]?.trim() })).data,
    onSuccess: () => {
      toast.success('تمت تسوية الفرق');
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: ApiError) => toast.error(apiMessage(e, 'تعذر تسوية الفرق')),
  });

  if (!canView) {
    return (
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-center">
        <p className="font-bold">هذه اللوحة مخصصة للمشغّل الرئيسي</p>
        <Link href="/dashboard" className="mt-4 inline-block text-amber-800 underline">العودة</Link>
      </div>
    );
  }
  const d = q.data;
  const printReceipt = (id: string) =>
    directPrint(millHandoverReceiptRequest(id, { isReprint: true }), {
      browserFallback: () => window.open(`/mill-handover/${id}?print=1`, '_blank', 'noopener'),
    });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <p className="text-xs font-bold text-amber-800 dark:text-amber-400">المعصرة</p>
        <h1 className="text-2xl font-black">لوحة المشغّل الرئيسي — المساعدون وتسليم المداخيل</h1>
      </div>

      {d ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="مساعدون نشطون" value={formatNumber(d.summary.activeCount, 0)} />
          <Stat label="نقد بحوزة المساعدين الآن" value={`${formatMoney(d.summary.cashHeldByActiveAssistants)} د.ج`} />
          <Stat label="بانتظار تأكيدك" value={`${formatMoney(d.summary.cashAwaitingConfirmation)} د.ج`} strong />
          <Stat label="مؤكَّد اليوم" value={`${formatMoney(d.summary.cashConfirmedToday)} د.ج`} />
        </div>
      ) : null}

      <Section title={`بانتظار التأكيد (${d?.awaiting.length ?? 0})`}>
        {(d?.awaiting ?? []).map((s) => {
          const val = received[s.id] ?? String(s.declaredHandover ?? s.totals.expectedHandover);
          const diff = Math.round((Number(val || 0) - s.totals.expectedHandover) * 100) / 100;
          return (
            <li key={s.id} className="space-y-2 py-3">
              <Head s={s} onPrint={() => void printReceipt(s.id)} printing={printing} />
              <p className="text-xs text-[var(--app-text-dim)]">
                {s.totals.operationsCount} عملية · متوقع {formatMoney(s.totals.expectedHandover)} د.ج · صرّح المساعد بـ {formatMoney(s.declaredHandover ?? 0)} د.ج
                {s.discrepancyNote ? ` · ملاحظة المساعد: ${s.discrepancyNote}` : ''}
              </p>
              {canConfirm ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <Input
                    label="المبلغ الذي عددته واستلمته فعلياً (د.ج)"
                    inputMode="decimal"
                    value={val}
                    onChange={(e) => setReceived((r) => ({ ...r, [s.id]: e.target.value }))}
                    error={Math.abs(diff) >= 0.005 ? `فرق ${diff > 0 ? '+' : ''}${formatMoney(diff)} د.ج — وضّح السبب` : undefined}
                  />
                  <Input label="ملاحظة" value={notes[s.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))} />
                  <Button
                    type="button"
                    className="gap-2"
                    loading={confirm.isPending}
                    disabled={Math.abs(diff) >= 0.005 && !notes[s.id]?.trim()}
                    onClick={() => confirm.mutate(s)}
                  >
                    <CheckCircle2 className="h-4 w-4" /> تأكيد الاستلام
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </Section>

      <Section title={`فروق تحتاج تسوية (${d?.discrepancies.length ?? 0})`} tone="danger">
        {(d?.discrepancies ?? []).map((s) => (
          <li key={s.id} className="space-y-2 py-3">
            <Head s={s} onPrint={() => void printReceipt(s.id)} printing={printing} />
            <p className="text-xs">
              متوقع {formatMoney(s.totals.expectedHandover)} · مستلَم {formatMoney(s.receivedHandover ?? 0)} ·{' '}
              <strong>فرق {s.difference > 0 ? '+' : ''}{formatMoney(s.difference)} د.ج</strong>
              {s.discrepancyNote ? ` · ${s.discrepancyNote}` : ''}
            </p>
            {canResolve ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <Input label="قرار التسوية (إلزامي)" value={notes[s.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))} />
                <Button type="button" variant="outline" disabled={!(notes[s.id]?.trim().length >= 3)} loading={resolve.isPending} onClick={() => resolve.mutate(s)}>
                  تسوية الفرق
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </Section>

      <Section title={`جلسات نشطة الآن (${d?.active.length ?? 0})`}>
        {(d?.active ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <Head s={s} onPrint={() => void printReceipt(s.id)} printing={printing} />
            <p className="text-xs text-[var(--app-text-dim)]">
              {s.totals.operationsCount} عملية · مقبوض نقداً {formatMoney(s.totals.totalCash)} د.ج · ديون {formatMoney(s.totals.totalOutstanding)} د.ج
            </p>
          </li>
        ))}
      </Section>

      <Section title={`مؤكَّد اليوم (${d?.confirmedToday.length ?? 0})`}>
        {(d?.confirmedToday ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <Head s={s} onPrint={() => void printReceipt(s.id)} printing={printing} />
            <p className="text-xs text-[var(--app-text-dim)]">استُلم {formatMoney(s.receivedHandover ?? 0)} د.ج · أكّده {s.confirmedBy?.name ?? '—'}</p>
          </li>
        ))}
      </Section>
    </div>
  );
}

function Head({ s, onPrint, printing }: { s: Session; onPrint: () => void; printing: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs font-black">{s.reference}</span>
      <span className="font-bold">{s.assistant.name}</span>
      <span className="text-xs text-[var(--app-text-dim)]">→ {s.primaryOperator.name}</span>
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
      <button type="button" className="ms-auto rounded-lg p-1.5 text-[var(--app-text-dim)] hover:bg-[var(--app-bg-muted)]" disabled={printing} onClick={onPrint} aria-label="طباعة الوصل">
        <Printer className="h-4 w-4" />
      </button>
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone?: 'danger'; children: React.ReactNode }) {
  const empty = Array.isArray(children) ? children.length === 0 : !children;
  return (
    <section className={cn('rounded-2xl border p-4', tone === 'danger' ? 'border-red-300/60 bg-red-50/40 dark:bg-red-950/10' : 'border-[var(--app-border)] bg-[var(--app-surface)]')}>
      <h2 className="text-sm font-black">{title}</h2>
      {empty ? <p className="mt-1 text-xs text-[var(--app-text-dim)]">لا شيء</p> : <ul className="divide-y divide-[var(--app-border)] text-sm">{children}</ul>}
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2', strong ? 'border-amber-600/40 bg-amber-50 dark:bg-amber-950/30' : 'border-[var(--app-border)] bg-[var(--app-surface)]')}>
      <p className="text-[11px] text-[var(--app-text-dim)]">{label}</p>
      <p className="text-base font-black tabular-nums">{value}</p>
    </div>
  );
}
