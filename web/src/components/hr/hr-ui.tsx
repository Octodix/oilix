'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { hasPermission } from '@/lib/permission-catalog';
import { formatMoneyDz, CURRENCY_SYMBOL } from '@/lib/locale-dz';
import { cn } from '@/lib/utils';
import {
  fullName,
  label,
  PAYMENT_METHOD,
  toNum,
  type Label,
} from '@/lib/hr-labels';

// ── API helpers ──────────────────────────────────────────────────────────────

export function apiError(e: unknown, fallback = 'تعذر تنفيذ العملية'): string {
  const msg = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg)) return msg.join(' · ');
  return fallback;
}

export type HrMeta = {
  today: string;
  timezoneOffsetMinutes: number;
  workSites: string[];
  contractTypes: string[];
  employeePaymentMethods: string[];
  paymentMethods: string[];
  expenseCategories: string[];
  attendanceStatuses: string[];
  providers: { kind: string; label: string; capabilities: Record<string, boolean> }[];
  overtimeMultipliers: { WORKDAY: number; REST_DAY: number; HOLIDAY: number };
  allowPartialPayments: boolean;
};

export function useHrMeta() {
  return useQuery({
    queryKey: ['hr', 'meta'],
    queryFn: async () => (await api.get<HrMeta>('/hr/meta')).data,
    staleTime: 60_000,
  });
}

export type EmployeeOption = {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  fullName: string;
  status: string;
  departmentId: string | null;
  jobTitle: string | null;
};

export function useEmployeeOptions(includeLeft = false) {
  return useQuery({
    queryKey: ['hr', 'employee-options', includeLeft],
    queryFn: async () =>
      (await api.get<EmployeeOption[]>('/hr/employees/options', { params: includeLeft ? { includeLeft: true } : {} })).data,
    staleTime: 30_000,
  });
}

export type Department = { id: string; name: string; nameFr: string | null; code: string | null; isActive: boolean; notes: string | null; _count?: { employees: number } };

export function useDepartments() {
  return useQuery({
    queryKey: ['hr', 'departments'],
    queryFn: async () => (await api.get<Department[]>('/hr/departments')).data,
    staleTime: 60_000,
  });
}

export type CashRegisterOption = {
  id: string;
  code: string;
  name: string;
  openSession: { id: string; openedAt: string } | null;
};

export function useCashRegisters(enabled = true) {
  return useQuery({
    queryKey: ['hr', 'cash-registers'],
    enabled,
    queryFn: async () => (await api.get<CashRegisterOption[]>('/hr/cash-registers')).data,
    staleTime: 15_000,
  });
}

/** Permission check bound to the logged-in user (ADMIN passes everything). */
export function useCan() {
  const user = useAuthStore((s) => s.user);
  return useCallback((p: string) => hasPermission(user?.permissions, p, user?.role), [user]);
}

export function useCanAny(perms: string[]) {
  const can = useCan();
  return perms.some((p) => can(p));
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function money(v: unknown): string {
  return `${formatMoneyDz(toNum(v))} ${CURRENCY_SYMBOL}`;
}

export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Layout pieces ────────────────────────────────────────────────────────────

export function HrPageHeader({
  title,
  fr,
  icon: Icon,
  subtitle,
  actions,
}: {
  title: string;
  fr: string;
  icon: LucideIcon;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="no-print flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-sky-800 text-white shadow-sm">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-black text-[var(--app-text)] sm:text-2xl">
            {title} <span className="text-base font-bold text-[var(--app-text-dim)]">· {fr}</span>
          </h1>
          {subtitle ? <div className="mt-0.5 text-sm text-[var(--app-text-muted)]">{subtitle}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] shadow-sm', className)}>
      {title || action ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--app-border)] px-4 py-3">
          {title ? <h2 className="text-sm font-black text-[var(--app-text)]">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({
  label: l,
  value,
  hint,
  tone = 'default',
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'primary';
  icon?: LucideIcon;
}) {
  const tones = {
    default: 'text-[var(--app-text)]',
    success: 'text-emerald-700 dark:text-emerald-400',
    warning: 'text-amber-700 dark:text-amber-400',
    danger: 'text-red-700 dark:text-red-400',
    primary: 'text-sky-700 dark:text-sky-400',
  } as const;
  return (
    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-[var(--app-text-muted)]">{l}</p>
        {Icon ? <Icon className={cn('h-4 w-4', tones[tone])} /> : null}
      </div>
      <p className={cn('mt-2 text-2xl font-black tabular-nums', tones[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-[var(--app-text-dim)]">{hint}</p> : null}
    </div>
  );
}

export function StatusBadge({ l, className }: { l: Label; className?: string }) {
  return (
    <Badge tone={l.tone ?? 'default'} className={className}>
      <span title={l.fr}>{l.ar}</span>
    </Badge>
  );
}

export function BiLabel({ l }: { l: Label }) {
  return (
    <span>
      {l.ar} <span className="text-[var(--app-text-dim)]">· {l.fr}</span>
    </span>
  );
}

export function LoadingState({ text = 'جاري التحميل…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--app-text-dim)]">
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </div>
  );
}

export function EmptyState({ text, hint }: { text: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-[var(--app-text-dim)]">
      <Inbox className="h-8 w-8 opacity-50" />
      <p className="font-bold">{text}</p>
      {hint ? <div className="max-w-md text-xs">{hint}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 py-8 text-center text-sm text-red-800 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200">
      <AlertTriangle className="h-6 w-6" />
      <p className="font-bold">{apiError(error, 'تعذر تحميل البيانات · Chargement impossible')}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          إعادة المحاولة
        </Button>
      ) : null}
    </div>
  );
}

export function QueryState({
  q,
  empty,
  emptyText = 'لا توجد بيانات · Aucune donnée',
  emptyHint,
  children,
}: {
  q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  empty?: boolean;
  emptyText?: string;
  emptyHint?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (empty) return <EmptyState text={emptyText} hint={emptyHint} />;
  return <>{children}</>;
}

export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-500/30 dark:bg-sky-950/30 dark:text-sky-100',
    warning: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100',
    danger: 'border-red-300 bg-red-50 text-red-950 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-100',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-100',
  } as const;
  return <div className={cn('rounded-xl border px-4 py-3 text-sm', tones[tone], className)}>{children}</div>;
}

// ── Tables ───────────────────────────────────────────────────────────────────

export function Table({ children, minWidth = 720 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn('bg-[var(--app-bg-muted)] px-3 py-2.5 text-right text-xs font-bold text-[var(--app-text-dim)]', className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn('border-t border-[var(--app-border)] px-3 py-2 align-middle', className)}>
      {children}
    </td>
  );
}

// ── Form fields ──────────────────────────────────────────────────────────────

const fieldClass =
  'w-full rounded-xl border border-[var(--app-border-strong)] bg-[var(--app-input-bg,var(--app-surface))] px-3 py-2.5 text-sm text-[var(--app-text)] focus:border-[var(--app-accent)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--app-accent)_25%,transparent)] disabled:opacity-60';

export function Field({ label: l, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block text-sm', className)}>
      <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">{l}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-[var(--app-text-dim)]">{hint}</span> : null}
    </label>
  );
}

export function Select({
  label: l,
  hint,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string }) {
  const el = (
    <select className={cn(fieldClass, className)} {...props}>
      {children}
    </select>
  );
  return l ? (
    <Field label={l} hint={hint}>
      {el}
    </Field>
  ) : (
    el
  );
}

export function TextInput({
  label: l,
  hint,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  const el = <input className={cn(fieldClass, className)} {...props} />;
  return l ? (
    <Field label={l} hint={hint}>
      {el}
    </Field>
  ) : (
    el
  );
}

export function TextArea({
  label: l,
  hint,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }) {
  const el = <textarea className={cn(fieldClass, 'min-h-[4.5rem]', className)} {...props} />;
  return l ? (
    <Field label={l} hint={hint}>
      {el}
    </Field>
  ) : (
    el
  );
}

export function Check({
  label: l,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className={cn('flex items-start gap-2 text-sm', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-sky-700"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-semibold">{l}</span>
        {hint ? <span className="block text-[11px] text-[var(--app-text-dim)]">{hint}</span> : null}
      </span>
    </label>
  );
}

export function EmployeeSelect({
  value,
  onChange,
  label: l = 'العامل · Employé',
  allowAll = false,
  includeLeft = false,
  required,
  emptyLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  allowAll?: boolean;
  includeLeft?: boolean;
  required?: boolean;
  emptyLabel?: string;
}) {
  const q = useEmployeeOptions(includeLeft);
  return (
    <Select label={l} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">{emptyLabel ?? (allowAll ? 'الكل · Tous' : '— اختر —')}</option>
      {(q.data ?? []).map((e) => (
        <option key={e.id} value={e.id}>
          {e.matricule} — {e.fullName}
          {e.status === 'LEFT' ? ' (غادر)' : ''}
        </option>
      ))}
    </Select>
  );
}

export function DepartmentSelect({
  value,
  onChange,
  label: l = 'القسم · Service',
  allowAll = true,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  allowAll?: boolean;
}) {
  const q = useDepartments();
  return (
    <Select label={l} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowAll ? 'الكل · Tous' : '— بدون قسم —'}</option>
      {(q.data ?? [])
        .filter((d) => d.isActive || d.id === value)
        .map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
            {d.nameFr ? ` · ${d.nameFr}` : ''}
          </option>
        ))}
    </Select>
  );
}

export function MonthInput({
  year,
  month,
  onChange,
  label: l = 'الشهر · Mois',
}: {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
  label?: string;
}) {
  return (
    <TextInput
      label={l}
      type="month"
      value={`${year}-${String(month).padStart(2, '0')}`}
      onChange={(e) => {
        const [y, m] = e.target.value.split('-').map(Number);
        if (y && m) onChange(y, m);
      }}
    />
  );
}

// ── Money-out fields (advances, loans, salaries, expenses) ───────────────────

export type MoneyOutValue = {
  paymentMethod: string;
  cashRegisterId: string;
  reference: string;
};

export const EMPTY_MONEY_OUT: MoneyOutValue = { paymentMethod: 'CASH_REGISTER', cashRegisterId: '', reference: '' };

export function MoneyOutFields({
  value,
  onChange,
  methods,
}: {
  value: MoneyOutValue;
  onChange: (v: MoneyOutValue) => void;
  methods?: string[];
}) {
  const usesRegister = value.paymentMethod === 'CASH_REGISTER';
  const registersQ = useCashRegisters(usesRegister);
  const registers = useMemo(() => registersQ.data ?? [], [registersQ.data]);
  const selected = registers.find((r) => r.id === value.cashRegisterId);

  useEffect(() => {
    if (!usesRegister || value.cashRegisterId || registers.length === 0) return;
    const open = registers.filter((r) => r.openSession);
    if (open.length === 1) onChange({ ...value, cashRegisterId: open[0].id });
  }, [usesRegister, registers, value, onChange]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select
        label="طريقة الدفع · Mode de paiement"
        value={value.paymentMethod}
        onChange={(e) => onChange({ ...value, paymentMethod: e.target.value })}
      >
        {(methods ?? Object.keys(PAYMENT_METHOD)).map((m) => (
          <option key={m} value={m}>
            {label.payment(m).ar} · {label.payment(m).fr}
          </option>
        ))}
      </Select>
      {usesRegister ? (
        <Select
          label="الصندوق · Caisse"
          value={value.cashRegisterId}
          onChange={(e) => onChange({ ...value, cashRegisterId: e.target.value })}
          hint={
            selected && !selected.openSession
              ? 'هذا الصندوق مغلق — افتح جلسة أولاً · Caisse fermée'
              : 'يُسجَّل خروج المبلغ في جلسة الصندوق المفتوحة'
          }
          required
        >
          <option value="">— اختر —</option>
          {registers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.code}) {r.openSession ? '🟢' : '🔴 مغلق'}
            </option>
          ))}
        </Select>
      ) : (
        <TextInput
          label="المرجع · Référence"
          value={value.reference}
          onChange={(e) => onChange({ ...value, reference: e.target.value })}
          placeholder={value.paymentMethod === 'CASH' ? 'اختياري' : 'رقم التحويل / الصك'}
          maxLength={100}
        />
      )}
    </div>
  );
}

export function moneyOutPayload(v: MoneyOutValue) {
  return {
    paymentMethod: v.paymentMethod,
    ...(v.paymentMethod === 'CASH_REGISTER' ? { cashRegisterId: v.cashRegisterId || undefined } : {}),
    ...(v.reference.trim() ? { reference: v.reference.trim() } : {}),
  };
}

// ── Modal + reason prompt ────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center">
      <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative flex max-h-[min(92dvh,52rem)] w-full flex-col overflow-hidden rounded-3xl border border-[var(--app-border)] bg-[var(--app-surface)] shadow-2xl',
          wide ? 'max-w-4xl' : 'max-w-xl',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--app-border)] px-5 py-4">
          <h2 className="text-base font-black text-[var(--app-text)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-[var(--app-text-muted)] hover:bg-[var(--app-bg-muted)]"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--app-border)] px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export function ReasonModal({
  open,
  title,
  description,
  confirmLabel = 'تأكيد',
  danger = false,
  minLength = 3,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  minLength?: number;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReason('');
  }
  const ok = reason.trim().length >= minLength;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={!ok} loading={busy} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? <div className="mb-3 text-sm text-[var(--app-text-muted)]">{description}</div> : null}
      <TextArea
        label="السبب (إلزامي) · Motif"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        autoFocus
        hint={`${minLength} أحرف على الأقل — يُسجَّل في سجل التدقيق`}
      />
    </Modal>
  );
}

export function EmployeeCell({
  e,
  sub,
}: {
  e: { firstName?: string | null; lastName?: string | null; matricule?: string | null } | null | undefined;
  sub?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate font-bold">{fullName(e)}</p>
      <p className="truncate text-[11px] text-[var(--app-text-dim)]">
        {e?.matricule ?? ''}
        {sub ? <> · {sub}</> : null}
      </p>
    </div>
  );
}
