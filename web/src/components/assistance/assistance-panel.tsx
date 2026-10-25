'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, Play, Printer, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, formatMoney, formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/lib/auth-store';
import { useDirectPrint } from '@/hooks/use-direct-print';
import { millHandoverReceiptRequest } from '@/lib/print-documents';
import type { MillHandoverReceiptPayload } from '@/components/print/mill-handover-receipt-document';

type Session = MillHandoverReceiptPayload['session'];
type Primary = { id: string; name: string; username: string; role: string };
type ApiError = { response?: { data?: { message?: string | string[] } } };

export const MILL_ASSIST_ME_KEY = ['mill-assist-me'] as const;

function apiMessage(e: ApiError, fallback: string) {
  const m = e.response?.data?.message;
  return Array.isArray(m) ? m.join('\n') : m || fallback;
}

/**
 * Inline operator-assistance controls for the pages where the work happens (oil processing,
 * pressing). Without a session: one-click start. With a session: live cash held and the
 * close + handover form. Full history stays on /assistance.
 */
export function AssistancePanel({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const canStart = useAuthStore((s) => s.hasPermission('MILL_ASSIST_START'));
  const canClose = useAuthStore((s) => s.hasPermission('MILL_ASSIST_CLOSE'));
  const canPrint = useAuthStore((s) => s.hasPermission('MILL_ASSIST_PRINT'));
  const { print: directPrint, busy: printing } = useDirectPrint();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [primaryId, setPrimaryId] = useState('');
  const [declared, setDeclared] = useState('');
  const [note, setNote] = useState('');

  const meQ = useQuery({
    queryKey: MILL_ASSIST_ME_KEY,
    queryFn: async () => (await api.get<{ active: Session | null; pending: Session[] }>('/mill-assistance/me')).data,
    enabled: canStart,
    refetchInterval: 20_000,
  });
  const primariesQ = useQuery({
    queryKey: ['mill-assist-primaries'],
    queryFn: async () => (await api.get<Primary[]>('/mill-assistance/primaries')).data,
    enabled: canStart && open && !meQ.data?.active,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: MILL_ASSIST_ME_KEY });
    void qc.invalidateQueries({ queryKey: ['mill-assist-detail'] });
    void qc.invalidateQueries({ queryKey: ['mill-assist-dashboard'] });
  };

  const start = useMutation({
    mutationFn: async () => (await api.post<Session>('/mill-assistance/sessions', { primaryOperatorId: primaryId })).data,
    onSuccess: (s) => {
      toast.success(`بدأت جلسة المساعدة ${s.reference} — كل ما تقبضه الآن يُسجَّل باسمك`);
      setOpen(false);
      refresh();
    },
    onError: (e: ApiError) => toast.error(apiMessage(e, 'تعذر بدء الجلسة')),
  });

  const printReceipt = (id: string, isReprint: boolean) =>
    directPrint(millHandoverReceiptRequest(id, { isReprint }), {
      browserFallback: () => window.open(`/mill-handover/${id}?print=1`, '_blank', 'noopener'),
      successMessage: 'تم إرسال وصل التسليم للطابعة',
    });

  const close = useMutation({
    mutationFn: async (id: string) =>
      (
        await api.post<Session>(`/mill-assistance/sessions/${id}/close`, {
          declaredHandover: Number(declared || 0),
          discrepancyNote: note.trim() || undefined,
        })
      ).data,
    onSuccess: (s) => {
      toast.success(`أُغلقت الجلسة ${s.reference} — سلّم ${formatMoney(s.declaredHandover ?? 0)} د.ج مع الوصل إلى ${s.primaryOperator.name}`);
      setClosing(false);
      setDeclared('');
      setNote('');
      refresh();
      if (canPrint) void printReceipt(s.id, false);
    },
    onError: (e: ApiError) => toast.error(apiMessage(e, 'تعذر إغلاق الجلسة')),
  });

  if (!canStart) return null;
  const s = meQ.data?.active ?? null;

  // ── No session: offer to start one ──────────────────────────────────────
  if (!s) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--app-border-strong)] bg-[var(--app-surface)] px-3 py-2 text-sm">
        <HandCoins className="h-4 w-4 shrink-0 text-amber-700" />
        {!open ? (
          <>
            <span className="text-[var(--app-text-dim)]">
              تساعد المشغّل الرئيسي من هذا الجهاز؟ ابدأ جلسة لتُسجَّل مداخيلك باسمك وتسلّمها في النهاية.
            </span>
            <Button type="button" size="sm" variant="outline" className="ms-auto h-8 gap-1" onClick={() => setOpen(true)}>
              <Play className="h-3.5 w-3.5" /> بدء جلسة مساعدة
            </Button>
          </>
        ) : (
          <>
            <select
              className="min-w-[14rem] rounded-lg border border-[var(--app-border-strong)] bg-[var(--app-input-bg,var(--app-surface))] px-2 py-1.5 text-sm"
              value={primaryId}
              onChange={(e) => setPrimaryId(e.target.value)}
              aria-label="المشغّل الرئيسي الذي تساعده"
            >
              <option value="">— المشغّل الرئيسي الذي تساعده —</option>
              {(primariesQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.role}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" className="h-8 gap-1" disabled={!primaryId} loading={start.isPending} onClick={() => start.mutate()}>
              <Play className="h-3.5 w-3.5" /> بدء
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    );
  }

  // ── Active session ──────────────────────────────────────────────────────
  const expected = s.totals.expectedHandover;
  const declaredNum = Number(declared || 0);
  const diff = Math.round((declaredNum - expected) * 100) / 100;
  const needsNote = declared !== '' && Math.abs(diff) >= 0.005;

  return (
    <div className="space-y-2 rounded-xl border border-amber-600/40 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex flex-wrap items-center gap-2">
        <HandCoins className="h-4 w-4 shrink-0 text-amber-700" />
        <Link href="/assistance" className="font-bold underline-offset-2 hover:underline">
          جلسة مساعدة نشطة {s.reference}
        </Link>
        <span>تساعد {s.primaryOperator.name}</span>
        {!compact ? (
          <span className="text-xs text-amber-900/80 dark:text-amber-200/80">
            · {formatNumber(s.totals.operationsCount, 0)} عملية · ديون {formatMoney(s.totals.totalOutstanding)} د.ج
          </span>
        ) : null}
        <span className="ms-auto font-black tabular-nums">نقد بحوزتك: {formatMoney(expected)} د.ج</span>
        {canPrint ? (
          <button type="button" className="rounded-lg p-1.5 hover:bg-amber-100 dark:hover:bg-amber-900/40" disabled={printing} onClick={() => void printReceipt(s.id, true)} aria-label="طباعة مسودة الوصل" title="طباعة مسودة الوصل">
            <Printer className="h-4 w-4" />
          </button>
        ) : null}
        {canClose && !closing ? (
          <Button type="button" size="sm" className="h-8 gap-1 bg-amber-700 hover:bg-amber-800" onClick={() => { setDeclared(String(expected)); setClosing(true); }}>
            <Square className="h-3.5 w-3.5" /> إنهاء وتسليم المداخيل
          </Button>
        ) : null}
      </div>

      {closing ? (
        <div className="grid gap-2 rounded-lg border border-amber-600/30 bg-[var(--app-surface)] p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Input
            label="النقد الفعلي الذي عددته وستسلّمه (د.ج)"
            inputMode="decimal"
            value={declared}
            onChange={(e) => setDeclared(e.target.value)}
            hint={`المتوقع حسب النظام: ${formatMoney(expected)} د.ج`}
            error={needsNote ? `فرق ${diff > 0 ? '+' : ''}${formatMoney(diff)} د.ج — وضّح السبب` : undefined}
            autoFocus
          />
          <Input label={needsNote ? 'سبب الفرق (إلزامي)' : 'ملاحظة (اختياري)'} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button
              type="button"
              className={cn('gap-1 bg-amber-700 hover:bg-amber-800')}
              disabled={declared === '' || (needsNote && !note.trim())}
              loading={close.isPending}
              onClick={() => close.mutate(s.id)}
            >
              <Square className="h-4 w-4" /> إغلاق وطباعة الوصل
            </Button>
            <Button type="button" variant="ghost" onClick={() => setClosing(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
