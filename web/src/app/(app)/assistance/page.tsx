'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, Play, Printer, Square } from 'lucide-react';
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
type SessionDetail = Session & { operations: MillHandoverReceiptPayload['operations'] };
type Primary = { id: string; name: string; username: string; role: string };
type ApiError = { response?: { data?: { message?: string | string[] } } };

const ME_KEY = ['mill-assist-me'] as const;

function apiMessage(e: ApiError, fallback: string) {
  const m = e.response?.data?.message;
  return Array.isArray(m) ? m.join('\n') : m || fallback;
}

function openBrowserReceipt(id: string) {
  window.open(`/mill-handover/${id}?print=1`, '_blank', 'noopener');
}

/** Assistant view: start helping the primary operator, watch live totals, close and hand over. */
export default function AssistancePage() {
  const qc = useQueryClient();
  const canStart = useAuthStore((s) => s.hasPermission('MILL_ASSIST_START'));
  const canClose = useAuthStore((s) => s.hasPermission('MILL_ASSIST_CLOSE'));
  const canPrint = useAuthStore((s) => s.hasPermission('MILL_ASSIST_PRINT'));
  const { print: directPrint, busy: printing } = useDirectPrint();

  const meQ = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => (await api.get<{ active: Session | null; pending: Session[] }>('/mill-assistance/me')).data,
    refetchInterval: 15_000,
    enabled: canStart,
  });
  const active = meQ.data?.active ?? null;
  const detailQ = useQuery({
    queryKey: ['mill-assist-detail', active?.id],
    queryFn: async () => (await api.get<SessionDetail>(`/mill-assistance/sessions/${active!.id}`)).data,
    enabled: !!active,
    refetchInterval: 15_000,
  });
  const primariesQ = useQuery({
    queryKey: ['mill-assist-primaries'],
    queryFn: async () => (await api.get<Primary[]>('/mill-assistance/primaries')).data,
    enabled: canStart && !active,
  });

  const [primaryId, setPrimaryId] = useState('');
  const [declared, setDeclared] = useState('');
  const [note, setNote] = useState('');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ME_KEY });
    void qc.invalidateQueries({ queryKey: ['mill-assist-detail'] });
  };

  const start = useMutation({
    mutationFn: async () => (await api.post<Session>('/mill-assistance/sessions', { primaryOperatorId: primaryId })).data,
    onSuccess: (s) => {
      toast.success(`بدأت جلسة المساعدة ${s.reference} — كل ما تقبضه الآن يُسجَّل باسمك`);
      refresh();
    },
    onError: (e: ApiError) => toast.error(apiMessage(e, 'تعذر بدء الجلسة')),
  });

  const close = useMutation({
    mutationFn: async () =>
      (
        await api.post<Session>(`/mill-assistance/sessions/${active!.id}/close`, {
          declaredHandover: Number(declared || 0),
          discrepancyNote: note.trim() || undefined,
        })
      ).data,
    onSuccess: (s) => {
      toast.success(`أُغلقت الجلسة ${s.reference} — سلّم ${formatMoney(s.declaredHandover ?? 0)} د.ج مع الوصل إلى ${s.primaryOperator.name}`);
      setDeclared('');
      setNote('');
      refresh();
      if (canPrint) void printReceipt(s.id, false);
    },
    onError: (e: ApiError) => toast.error(apiMessage(e, 'تعذر إغلاق الجلسة')),
  });

  function printReceipt(id: string, isReprint: boolean) {
    return directPrint(millHandoverReceiptRequest(id, { isReprint }), {
      browserFallback: () => openBrowserReceipt(id),
      successMessage: 'تم إرسال وصل التسليم للطابعة',
    });
  }

  if (!canStart) {
    return (
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-center">
        <p className="font-bold">ليس لديك صلاحية مساعدة المشغّل الرئيسي</p>
        <Link href="/dashboard" className="mt-4 inline-block text-amber-800 underline">العودة</Link>
      </div>
    );
  }

  const totals = detailQ.data?.totals ?? active?.totals;
  const expected = totals?.expectedHandover ?? 0;
  const declaredNum = Number(declared || 0);
  const diff = Math.round((declaredNum - expected) * 100) / 100;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <p className="text-xs font-bold text-amber-800 dark:text-amber-400">المعصرة</p>
        <h1 className="text-2xl font-black">مساعدة المشغّل الرئيسي وتسليم المداخيل</h1>
        <p className="text-sm text-[var(--app-text-dim)]">
          ابدأ جلسة عندما تساعد المشغّل الرئيسي من هذا الجهاز. كل مبلغ تقبضه يُسجَّل في جلستك، وعند الانتهاء تطبع وصل التسليم وتسلّم النقد.
        </p>
      </div>

      {!active ? (
        <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 space-y-3">
          <h2 className="text-sm font-black">بدء جلسة مساعدة</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="space-y-2">
              <span className="block text-sm font-semibold text-[var(--app-text-muted)]">المشغّل الرئيسي الذي تساعده</span>
              <select
                className="w-full rounded-xl border border-[var(--app-border-strong)] bg-[var(--app-input-bg,var(--app-surface))] px-3 py-2 text-sm"
                value={primaryId}
                onChange={(e) => setPrimaryId(e.target.value)}
              >
                <option value="">— اختر —</option>
                {(primariesQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.role}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" className="gap-2" disabled={!primaryId} loading={start.isPending} onClick={() => start.mutate()}>
              <Play className="h-4 w-4" /> بدء الجلسة
            </Button>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-amber-600/40 bg-amber-50/60 p-4 space-y-4 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300">جلسة نشطة · {active.reference}</p>
              <h2 className="text-lg font-black">تساعد {active.primaryOperator.name}</h2>
              <p className="text-xs text-[var(--app-text-dim)]">
                منذ {new Date(active.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                {active.assistantDevice ? ` · ${active.assistantDevice.code || active.assistantDevice.name}` : ''}
              </p>
            </div>
            <Link href="/pressing" className="text-sm font-bold text-amber-900 underline dark:text-amber-200">
              الذهاب إلى تصفية الزيت ←
            </Link>
          </div>

          {totals ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="العمليات" value={formatNumber(totals.operationsCount, 0)} />
              <Stat label="المقبوض نقداً" value={`${formatMoney(totals.totalCash)} د.ج`} strong />
              <Stat label="غير مدفوع (ديون)" value={`${formatMoney(totals.totalOutstanding)} د.ج`} />
              <Stat label="الواجب تسليمه" value={`${formatMoney(totals.expectedHandover)} د.ج`} strong />
            </div>
          ) : null}

          {detailQ.data?.operations?.length ? (
            <ul className="divide-y divide-[var(--app-border)] rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] text-sm">
              {detailQ.data.operations.map((op) => (
                <li key={op.pressingRecordId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-bold">#{op.reference} · {op.clientName}</p>
                    <p className="text-xs text-[var(--app-text-dim)]">
                      المبلغ {formatMoney(op.amountDue)} · مقبوض هنا {formatMoney(op.collectedInSession)}
                      {op.outstanding > 0 ? ` · متبقٍ ${formatMoney(op.outstanding)}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 font-black tabular-nums">{formatMoney(op.collectedCashInSession)} د.ج</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--app-text-dim)]">لا توجد عمليات مقبوضة في هذه الجلسة بعد.</p>
          )}

          {canClose ? (
            <div className="space-y-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
              <h3 className="text-sm font-black">إنهاء الجلسة وتسليم المداخيل</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="النقد الفعلي الذي عددته وستسلّمه (د.ج)"
                  inputMode="decimal"
                  value={declared}
                  onChange={(e) => setDeclared(e.target.value)}
                  hint={`المتوقع حسب النظام: ${formatMoney(expected)} د.ج`}
                  error={declared !== '' && Math.abs(diff) >= 0.005 ? `فرق ${diff > 0 ? '+' : ''}${formatMoney(diff)} د.ج — يجب توضيح السبب` : undefined}
                />
                <Input
                  label={Math.abs(diff) >= 0.005 && declared !== '' ? 'سبب الفرق (إلزامي)' : 'ملاحظة (اختياري)'}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="gap-2 bg-amber-700 hover:bg-amber-800"
                  disabled={declared === '' || (Math.abs(diff) >= 0.005 && !note.trim())}
                  loading={close.isPending}
                  onClick={() => close.mutate()}
                >
                  <Square className="h-4 w-4" /> إغلاق الجلسة وطباعة وصل التسليم
                </Button>
                {canPrint ? (
                  <Button type="button" variant="outline" className="gap-2" disabled={printing} onClick={() => void printReceipt(active.id, true)}>
                    <Printer className="h-4 w-4" /> طباعة مسودة
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      )}

      {(meQ.data?.pending ?? []).length > 0 ? (
        <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-black">
            <HandCoins className="h-4 w-4 text-amber-700" /> تسليمات بانتظار تأكيد المشغّل الرئيسي
          </h2>
          <ul className="divide-y divide-[var(--app-border)] text-sm">
            {meQ.data!.pending.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-bold">
                    {s.reference} → {s.primaryOperator.name}{' '}
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-bold',
                        s.status === 'DISCREPANCY' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900',
                      )}
                    >
                      {HANDOVER_STATUS_AR[s.status]}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--app-text-dim)]">
                    مصرّح {formatMoney(s.declaredHandover ?? 0)} د.ج · متوقع {formatMoney(s.totals.expectedHandover)} د.ج
                  </p>
                </div>
                {canPrint ? (
                  <Button type="button" size="sm" variant="outline" className="gap-1" disabled={printing} onClick={() => void printReceipt(s.id, true)}>
                    <Printer className="h-3.5 w-3.5" /> إعادة طباعة الوصل
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2', strong ? 'border-emerald-600/30 bg-emerald-50 dark:bg-emerald-950/30' : 'border-[var(--app-border)] bg-[var(--app-surface)]')}>
      <p className="text-[11px] text-[var(--app-text-dim)]">{label}</p>
      <p className="text-base font-black tabular-nums">{value}</p>
    </div>
  );
}
