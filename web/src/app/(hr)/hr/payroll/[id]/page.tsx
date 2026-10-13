'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Banknote, Calculator, CheckCheck, ClipboardCheck, Download, Lock, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  apiError,
  Check,
  downloadCsv,
  EMPTY_MONEY_OUT,
  EmployeeCell,
  HrPageHeader,
  Modal,
  money,
  MoneyOutFields,
  moneyOutPayload,
  Notice,
  Panel,
  QueryState,
  ReasonModal,
  StatCard,
  StatusBadge,
  Table,
  Td,
  TextArea,
  TextInput,
  Th,
  useCan,
  type MoneyOutValue,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import {
  dateTimeDz,
  fullName,
  label,
  monthLabel,
  newIdempotencyKey,
  payrollActions,
  payrollWarning,
  payslipRemaining,
  round2,
  todayKeyDz,
  toCsv,
  toNum,
} from '@/lib/hr-labels';

type Payslip = {
  id: string;
  employeeId: string;
  status: string;
  salaryMode: string;
  baseSalary: string;
  grossEarnings: string;
  totalDeductions: string;
  netSalary: string;
  paidAmount: string;
  paymentStatus: string;
  warnings: string[] | null;
  employeeSnapshot: { fullName: string; matricule: string; department: string | null; jobTitle: string | null };
  attendanceSummary: { presentDays: number; absentDays: number; lateCount: number; overtimeApprovedMinutes: number };
  employee: { id: string; matricule: string; firstName: string; lastName: string; paymentMethod: string };
};
type Period = {
  id: string;
  year: number;
  month: number;
  status: string;
  employeeCount: number;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  totalPaid: string;
  warnings: { period: string[]; employees: { employeeId: string; name: string; warnings: string[] }[] } | null;
  notes: string | null;
  calculatedAt: string | null;
  calculatedByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  validatedAt: string | null;
  validatedByName: string | null;
  paidAt: string | null;
  closedAt: string | null;
  closedByName: string | null;
  payslips: Payslip[];
};
type PayAllResult = { results: { payslipId: string; name: string; ok: boolean; amount?: number; error?: string }[]; paid: number; failed: number };

export default function PayrollPeriodPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const [forceOpen, setForceOpen] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [paying, setPaying] = useState(false);
  const [filter, setFilter] = useState<'all' | 'warnings' | 'unpaid'>('all');

  const q = useQuery({
    queryKey: ['hr', 'payroll-period', id],
    queryFn: async () => (await api.get<Period>(`/hr/payroll/periods/${id}`)).data,
  });

  const done = (msg: string) => () => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['hr'] });
  };
  const calculate = useMutation({
    mutationFn: async () => (await api.post(`/hr/payroll/periods/${id}/calculate`)).data,
    onSuccess: done('تم الحساب — لم تُسجل أي حركة نقدية'),
    onError: (e) => toast.error(apiError(e)),
  });
  const review = useMutation({
    mutationFn: async () => (await api.post(`/hr/payroll/periods/${id}/review`)).data,
    onSuccess: done('تم تأكيد المراجعة'),
    onError: (e) => toast.error(apiError(e)),
  });
  const validate = useMutation({
    mutationFn: async (v: { force?: boolean; reason?: string }) => (await api.post(`/hr/payroll/periods/${id}/validate`, v)).data,
    onSuccess: () => {
      setForceOpen(null);
      done('تمت المصادقة — الكشوف مقفلة')();
    },
    onError: (e, v) => {
      const msg = apiError(e);
      if (!v.force && msg.includes('يمكن الفرض')) setForceOpen(msg);
      else toast.error(msg);
    },
  });
  const reopen = useMutation({
    mutationFn: async (reason: string) => (await api.post(`/hr/payroll/periods/${id}/reopen`, { reason })).data,
    onSuccess: () => {
      setReopening(false);
      done('تمت إعادة فتح الفترة')();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const close = useMutation({
    mutationFn: async () => (await api.post(`/hr/payroll/periods/${id}/close`)).data,
    onSuccess: done('تم إغلاق الفترة'),
    onError: (e) => toast.error(apiError(e)),
  });

  const p = q.data;
  const slips = useMemo(() => {
    const all = p?.payslips ?? [];
    if (filter === 'warnings') return all.filter((s) => s.warnings?.length);
    if (filter === 'unpaid') return all.filter((s) => s.paymentStatus !== 'PAID');
    return all;
  }, [p, filter]);

  if (!p) {
    return (
      <div className="space-y-4">
        <BackLink />
        <QueryState q={q}>{null}</QueryState>
      </div>
    );
  }

  const actions = payrollActions(p.status);
  const remaining = round2(toNum(p.totalNet) - toNum(p.totalPaid));
  const busy = calculate.isPending || review.isPending || validate.isPending || close.isPending;

  function exportCsv() {
    downloadCsv(
      `journal-paie-${p!.year}-${String(p!.month).padStart(2, '0')}.csv`,
      toCsv(
        ['Matricule', 'Employé', 'Service', 'Mode', 'Base', 'Brut', 'Retenues', 'Net', 'Payé', 'Statut paiement', 'Jours présents', 'Absences', 'Retards', 'HS approuvées (min)'],
        p!.payslips.map((s) => [
          s.employeeSnapshot.matricule,
          s.employeeSnapshot.fullName,
          s.employeeSnapshot.department ?? '',
          label.salaryMode(s.salaryMode).fr,
          toNum(s.baseSalary),
          toNum(s.grossEarnings),
          toNum(s.totalDeductions),
          toNum(s.netSalary),
          toNum(s.paidAmount),
          label.payslipPayment(s.paymentStatus).fr,
          s.attendanceSummary?.presentDays ?? '',
          s.attendanceSummary?.absentDays ?? '',
          s.attendanceSummary?.lateCount ?? '',
          s.attendanceSummary?.overtimeApprovedMinutes ?? '',
        ]),
      ),
    );
  }

  return (
    <div className="space-y-4">
      <BackLink />
      <HrPageHeader
        title={`أجور ${monthLabel(p.year, p.month)}`}
        fr={`Paie ${String(p.month).padStart(2, '0')}/${p.year}`}
        icon={Calculator}
        subtitle={<StatusBadge l={label.payroll(p.status)} />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!p.payslips.length}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            {actions.includes('calculate') && can('HR_PAYROLL_CALCULATE') ? (
              <Button size="sm" variant={p.status === 'DRAFT' ? 'primary' : 'outline'} loading={calculate.isPending} disabled={busy} onClick={() => calculate.mutate()}>
                <Calculator className="h-4 w-4" /> {p.status === 'DRAFT' ? 'حساب' : 'إعادة الحساب'}
              </Button>
            ) : null}
            {actions.includes('review') && can('HR_PAYROLL_CALCULATE') ? (
              <Button size="sm" loading={review.isPending} disabled={busy} onClick={() => review.mutate()}>
                <ClipboardCheck className="h-4 w-4" /> تأكيد المراجعة
              </Button>
            ) : null}
            {actions.includes('validate') && can('HR_PAYROLL_VALIDATE') ? (
              <Button
                size="sm"
                loading={validate.isPending}
                disabled={busy}
                onClick={() => confirm('المصادقة تُقفل الكشوف وتربط التسبيقات والمنح والساعات الإضافية بها. متابعة؟') && validate.mutate({})}
              >
                <CheckCheck className="h-4 w-4" /> مصادقة
              </Button>
            ) : null}
            {actions.includes('pay') && can('HR_SALARY_PAY') && remaining > 0.005 ? (
              <Button size="sm" variant="gold" onClick={() => setPaying(true)}>
                <Banknote className="h-4 w-4" /> دفع الكل
              </Button>
            ) : null}
            {actions.includes('reopen') && can('HR_PAYROLL_VALIDATE') ? (
              <Button size="sm" variant="outline" onClick={() => setReopening(true)}>
                <RotateCcw className="h-4 w-4" /> إعادة فتح
              </Button>
            ) : null}
            {actions.includes('close') && can('HR_PAYROLL_VALIDATE') ? (
              <Button
                size="sm"
                variant="outline"
                loading={close.isPending}
                onClick={() => confirm('إغلاق الفترة نهائياً؟ لن يمكن إلغاء الدفعات بعد ذلك.') && close.mutate()}
              >
                <Lock className="h-4 w-4" /> إغلاق
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="العمال" value={p.payslips.length} />
        <StatCard label="الإجمالي · Brut" value={money(p.totalGross)} />
        <StatCard label="الاقتطاعات · Retenues" value={money(p.totalDeductions)} tone="warning" />
        <StatCard label="الصافي · Net" value={money(p.totalNet)} tone="primary" />
        <StatCard label="المدفوع · Payé" value={money(p.totalPaid)} tone="success" hint={remaining > 0.005 && ['VALIDATED', 'PAID'].includes(p.status) ? `متبقي ${money(remaining)}` : undefined} />
      </div>

      <Timeline p={p} />

      {p.status === 'DRAFT' ? <Notice>الفترة لم تُحسب بعد. الحساب يُعيد معالجة الحضور ويُنشئ كشفاً لكل عامل لديه عقد في هذا الشهر.</Notice> : null}
      {p.notes ? <Notice tone="warning">{p.notes}</Notice> : null}
      {p.warnings && (p.warnings.period.length || p.warnings.employees.length) && ['CALCULATED', 'REVIEWED'].includes(p.status) ? (
        <Panel title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> تنبيهات قبل المصادقة · Alertes</span>}>
          <ul className="space-y-1 text-sm">
            {p.warnings.period.map((w) => (
              <li key={w} className="font-bold text-amber-800 dark:text-amber-300">• {payrollWarning(w)}</li>
            ))}
            {p.warnings.employees.map((e) => (
              <li key={e.employeeId}>
                <strong>{e.name}:</strong> {e.warnings.map(payrollWarning).join(' · ')}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {p.payslips.length ? (
        <Panel
          title="كشوف الأجور · Bulletins"
          bodyClassName="p-0"
          action={
            <div className="flex gap-1 text-xs">
              {(
                [
                  ['all', 'الكل'],
                  ['warnings', 'بتنبيهات'],
                  ['unpaid', 'غير مدفوعة'],
                ] as const
              ).map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={`rounded-lg px-2 py-1 font-bold ${filter === k ? 'bg-sky-700 text-white' : 'hover:bg-[var(--app-bg-muted)]'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          }
        >
          <Table minWidth={1100}>
            <thead>
              <tr>
                <Th>العامل</Th>
                <Th>الأساسي</Th>
                <Th>حضور / غياب</Th>
                <Th>الإجمالي</Th>
                <Th>الاقتطاعات</Th>
                <Th>الصافي</Th>
                <Th>المدفوع</Th>
                <Th>تنبيهات</Th>
              </tr>
            </thead>
            <tbody>
              {slips.map((s) => (
                <tr key={s.id} className="hover:bg-[var(--app-bg-muted)]">
                  <Td>
                    <Link href={`/hr/payroll/payslips/${s.id}`} className="hover:underline">
                      <EmployeeCell e={s.employee} sub={s.employeeSnapshot.department ?? undefined} />
                    </Link>
                  </Td>
                  <Td className="tabular-nums">
                    {money(s.baseSalary)}
                    <p className="text-[11px] text-[var(--app-text-dim)]">{label.salaryMode(s.salaryMode).ar}</p>
                  </Td>
                  <Td className="text-xs tabular-nums">
                    {s.attendanceSummary?.presentDays ?? 0} / <span className={s.attendanceSummary?.absentDays ? 'font-bold text-red-600' : ''}>{s.attendanceSummary?.absentDays ?? 0}</span>
                    {s.attendanceSummary?.lateCount ? <p className="text-amber-700">{s.attendanceSummary.lateCount} تأخر</p> : null}
                  </Td>
                  <Td className="tabular-nums">{money(s.grossEarnings)}</Td>
                  <Td className="tabular-nums text-red-700 dark:text-red-400">{toNum(s.totalDeductions) ? `− ${money(s.totalDeductions)}` : '—'}</Td>
                  <Td className={`font-black tabular-nums ${toNum(s.netSalary) < 0 ? 'text-red-600' : ''}`}>{money(s.netSalary)}</Td>
                  <Td className="text-xs">
                    {s.status === 'VALIDATED' ? (
                      <>
                        <StatusBadge l={label.payslipPayment(s.paymentStatus)} />
                        {toNum(s.paidAmount) > 0 ? <p className="mt-1 tabular-nums">{money(s.paidAmount)}</p> : null}
                      </>
                    ) : (
                      <span className="text-[var(--app-text-dim)]">قبل المصادقة</span>
                    )}
                  </Td>
                  <Td className="max-w-[16rem] text-[11px] text-amber-800 dark:text-amber-300">{(s.warnings ?? []).map(payrollWarning).join(' · ')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      ) : null}

      <ForceValidateModal
        message={forceOpen}
        busy={validate.isPending}
        onClose={() => setForceOpen(null)}
        onConfirm={(reason) => validate.mutate({ force: true, reason })}
      />
      <ReasonModal
        open={reopening}
        title="إعادة فتح الفترة · Rouvrir"
        description="تُفك الكشوف وتُعاد التسبيقات والمنح والساعات الإضافية والأقساط إلى حالتها السابقة. غير ممكن إذا وُجدت دفعات."
        minLength={5}
        danger
        busy={reopen.isPending}
        onClose={() => setReopening(false)}
        onConfirm={(r) => reopen.mutate(r)}
      />
      <PayAllModal period={p} open={paying} onClose={() => setPaying(false)} />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/hr/payroll" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--app-text-dim)] hover:text-[var(--app-text)]">
      <ArrowRight className="h-4 w-4" /> الأجور
    </Link>
  );
}

function Timeline({ p }: { p: Period }) {
  const steps = [
    { k: 'calc', t: 'الحساب', at: p.calculatedAt, by: p.calculatedByName },
    { k: 'rev', t: 'المراجعة', at: p.reviewedAt, by: p.reviewedByName },
    { k: 'val', t: 'المصادقة', at: p.validatedAt, by: p.validatedByName },
    { k: 'paid', t: 'الدفع الكامل', at: p.paidAt, by: null },
    { k: 'close', t: 'الإغلاق', at: p.closedAt, by: p.closedByName },
  ];
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {steps.map((s) => (
        <div
          key={s.k}
          className={`rounded-xl border px-3 py-2 ${s.at ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-950/30' : 'border-[var(--app-border)] text-[var(--app-text-dim)]'}`}
        >
          <p className="font-bold">{s.t}</p>
          <p>{s.at ? `${s.by ?? ''} ${dateTimeDz(s.at)}` : '—'}</p>
        </div>
      ))}
    </div>
  );
}

function ForceValidateModal({
  message,
  busy,
  onClose,
  onConfirm,
}: {
  message: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  if (message && seed !== message) {
    setSeed(message);
    setReason('');
    setAck(false);
  }
  return (
    <Modal
      open={!!message}
      onClose={onClose}
      title="المصادقة مرفوضة · Validation bloquée"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            رجوع (مستحسن)
          </Button>
          <Button variant="danger" disabled={!ack || reason.trim().length < 5} loading={busy} onClick={() => onConfirm(reason.trim())}>
            فرض المصادقة
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice tone="danger">{message}</Notice>
        <p className="text-sm">
          الأفضل معالجة هذه النقاط أولاً (تصحيح البصمات الناقصة، انتظار نهاية الشهر…). الفرض يُسجَّل في سجل العمليات مع السبب واسمك.
        </p>
        <Check label="أفهم أن الأجور ستُقفل رغم هذه التنبيهات" checked={ack} onChange={setAck} />
        <TextArea label="سبب الفرض (5 أحرف على الأقل)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>
    </Modal>
  );
}

function PayAllModal({ period, open, onClose }: { period: Period; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [seed, setSeed] = useState(false);
  const [key, setKey] = useState('');
  const [mo, setMo] = useState<MoneyOutValue>(EMPTY_MONEY_OUT);
  const [paidAt, setPaidAt] = useState(todayKeyDz());
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<PayAllResult | null>(null);
  if (open !== seed) {
    setSeed(open);
    if (open) {
      setKey(newIdempotencyKey('payall'));
      setResult(null);
      setPaidAt(todayKeyDz());
      setNotes('');
    }
  }
  const unpaid = period.payslips.filter((s) => s.status === 'VALIDATED' && payslipRemaining(s) > 0);
  const total = round2(unpaid.reduce((t, s) => t + payslipRemaining(s), 0));

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post<PayAllResult>(`/hr/payroll/periods/${period.id}/pay-all`, {
          ...moneyOutPayload(mo),
          paidAt,
          notes: notes.trim() || null,
          idempotencyKey: key,
        })
      ).data,
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['hr'] });
      if (r.failed) toast.error(`${r.failed} دفعة فشلت`);
      else toast.success(`تم دفع ${r.paid} أجر`);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const ok = mo.paymentMethod !== 'CASH_REGISTER' || !!mo.cashRegisterId;
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="دفع كل الأجور المتبقية · Payer tout"
      footer={
        result ? (
          <Button onClick={onClose}>إغلاق</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button variant="gold" disabled={!ok || !unpaid.length} loading={m.isPending} onClick={() => m.mutate()}>
              <Banknote className="h-4 w-4" /> دفع {money(total)}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-sm">
          <Notice tone={result.failed ? 'warning' : 'success'}>
            تم دفع {result.paid} — فشل {result.failed}
          </Notice>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {result.results.map((r) => (
              <li key={r.payslipId} className={r.ok ? '' : 'text-red-700 dark:text-red-400'}>
                {r.ok ? '✓' : '✗'} {r.name} {r.ok ? money(r.amount) : `— ${r.error}`}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            {unpaid.length} كشف — المجموع <strong>{money(total)}</strong>. كل كشف يُدفع بالمبلغ المتبقي له. الدفع من الصندوق يُسجل خروجاً في جلسته
            المفتوحة (يجب أن يكفي الرصيد).
          </p>
          <MoneyOutFields value={mo} onChange={setMo} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="تاريخ الدفع" type="date" value={paidAt} max={todayKeyDz()} onChange={(e) => setPaidAt(e.target.value)} />
            <TextInput label="ملاحظة" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer font-bold">التفاصيل</summary>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
              {unpaid.map((s) => (
                <li key={s.id}>
                  {fullName(s.employee)} — {money(payslipRemaining(s))}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </Modal>
  );
}
