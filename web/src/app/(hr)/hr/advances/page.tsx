'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Banknote, Download, HandCoins, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  apiError,
  downloadCsv,
  EMPTY_MONEY_OUT,
  EmployeeCell,
  EmployeeSelect,
  HrPageHeader,
  Modal,
  money,
  MoneyOutFields,
  moneyOutPayload,
  MonthInput,
  Notice,
  QueryState,
  ReasonModal,
  Select,
  StatCard,
  StatusBadge,
  Table,
  Td,
  TextArea,
  TextInput,
  Th,
  type MoneyOutValue,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import {
  ADVANCE_STATUS,
  fmtDay,
  fullName,
  label,
  LOAN_STATUS,
  monthLabel,
  newIdempotencyKey,
  round2,
  shiftMonth,
  todayKeyDz,
  toCsv,
  toNum,
} from '@/lib/hr-labels';
import { cn } from '@/lib/utils';

type Brief = { id: string; matricule: string; firstName: string; lastName: string };
type AdvanceRow = {
  id: string;
  employee: Brief;
  amount: string;
  date: string;
  paymentMethod: string;
  cashRegisterName: string | null;
  reference: string | null;
  deductYear: number;
  deductMonth: number;
  status: string;
  deductedPayslip: { id: string; periodId: string } | null;
  notes: string | null;
  createdByName: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
};
type LoanRow = {
  id: string;
  employee: Brief;
  principal: string;
  installmentAmount: string;
  startYear: number;
  startMonth: number;
  disbursedAt: string;
  paymentMethod: string;
  cashRegisterName: string | null;
  reference: string | null;
  status: string;
  notes: string | null;
  repayments: { id: string; amount: string; date: string; source: string; payslipId: string | null; notes: string | null }[];
  repaid: number;
  remaining: number;
};

function moneyOutOk(v: MoneyOutValue) {
  return v.paymentMethod !== 'CASH_REGISTER' || !!v.cashRegisterId;
}

export default function AdvancesPage() {
  const [tab, setTab] = useState<'advances' | 'loans'>('advances');
  return (
    <div className="space-y-4">
      <HrPageHeader title="التسبيقات والقروض" fr="Avances & prêts" icon={HandCoins} />
      <Notice>
        التسبيق يُقتطع مرة واحدة من أجر الشهر المحدد عند المصادقة على الأجور. القرض يُقتطع بأقساط شهرية حتى السداد. الدفع من الصندوق يُسجَّل
        كخروج في جلسة الصندوق المفتوحة، والإلغاء يُعيده.
      </Notice>
      <div className="flex gap-1 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-1">
        {(
          [
            ['advances', 'التسبيقات · Avances'],
            ['loans', 'القروض · Prêts'],
          ] as const
        ).map(([id, t]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'rounded-xl px-4 py-2 text-sm font-bold',
              tab === id ? 'bg-sky-700 text-white' : 'text-[var(--app-text-muted)] hover:bg-[var(--app-bg-muted)]',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'advances' ? <Advances /> : <Loans />}
    </div>
  );
}

function Advances() {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<AdvanceRow | null>(null);
  const q = useQuery({
    queryKey: ['hr', 'advances', employeeId, status],
    queryFn: async () => (await api.get<AdvanceRow[]>('/hr/advances', { params: { employeeId: employeeId || undefined, status: status || undefined } })).data,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const open = round2(rows.filter((r) => r.status === 'OPEN').reduce((s, r) => s + toNum(r.amount), 0));

  const cancel = useMutation({
    mutationFn: async (reason: string) => (await api.post(`/hr/advances/${cancelling!.id}/cancel`, { reason })).data,
    onSuccess: () => {
      toast.success('تم إلغاء التسبيق');
      setCancelling(null);
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <EmployeeSelect value={employeeId} onChange={setEmployeeId} allowAll includeLeft />
          <Select label="الحالة · Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">الكل</option>
            {Object.keys(ADVANCE_STATUS).map((s) => (
              <option key={s} value={s}>
                {label.advance(s).ar} · {label.advance(s).fr}
              </option>
            ))}
          </Select>
          <StatCard label="تسبيقات مفتوحة (لم تُقتطع)" value={money(open)} tone={open ? 'warning' : 'default'} />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                `avances-${todayKeyDz()}.csv`,
                toCsv(
                  ['Date', 'Matricule', 'Employé', 'Montant', 'Mode', 'Caisse/Réf', 'Mois de retenue', 'Statut'],
                  rows.map((r) => [
                    r.date.slice(0, 10),
                    r.employee.matricule,
                    fullName(r.employee),
                    toNum(r.amount),
                    label.payment(r.paymentMethod).fr,
                    r.cashRegisterName ?? r.reference ?? '',
                    `${r.deductYear}-${String(r.deductMonth).padStart(2, '0')}`,
                    label.advance(r.status).fr,
                  ]),
                ),
              )
            }
          >
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> تسبيق جديد
          </Button>
        </div>
      </div>
      <QueryState q={q} empty={!rows.length} emptyText="لا توجد تسبيقات">
        <Table minWidth={980}>
          <thead>
            <tr>
              <Th>التاريخ</Th>
              <Th>العامل</Th>
              <Th>المبلغ</Th>
              <Th>الدفع</Th>
              <Th>يُقتطع في</Th>
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="text-xs tabular-nums">{fmtDay(r.date)}</Td>
                <Td>
                  <EmployeeCell e={r.employee} />
                </Td>
                <Td className="font-bold tabular-nums">{money(r.amount)}</Td>
                <Td className="text-xs">
                  {label.payment(r.paymentMethod).ar}
                  <p className="text-[var(--app-text-dim)]">{r.cashRegisterName ?? r.reference ?? ''}</p>
                </Td>
                <Td className="text-xs">{monthLabel(r.deductYear, r.deductMonth)}</Td>
                <Td className="text-xs">
                  <StatusBadge l={label.advance(r.status)} />
                  {r.deductedPayslip ? (
                    <Link href={`/hr/payroll/payslips/${r.deductedPayslip.id}`} className="mt-1 block text-sky-700 hover:underline dark:text-sky-400">
                      كشف الأجر
                    </Link>
                  ) : null}
                  {r.cancelReason ? <p className="text-[var(--app-text-dim)]">{r.cancelReason}</p> : null}
                </Td>
                <Td>
                  {r.status === 'OPEN' ? (
                    <Button size="sm" variant="ghost" title="إلغاء" onClick={() => setCancelling(r)}>
                      <Ban className="h-4 w-4 text-red-600" />
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <AdvanceModal open={creating} onClose={() => setCreating(false)} />
      <ReasonModal
        open={!!cancelling}
        title="إلغاء التسبيق · Annuler l'avance"
        description={cancelling?.cashRegisterName ? `سيُعاد المبلغ إلى الصندوق «${cancelling.cashRegisterName}» (إن كانت الجلسة ما زالت مفتوحة).` : undefined}
        danger
        busy={cancel.isPending}
        onClose={() => setCancelling(null)}
        onConfirm={(r) => cancel.mutate(r)}
      />
    </div>
  );
}

function AdvanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const today = todayKeyDz();
  const [seed, setSeed] = useState(false);
  const [key, setKey] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [ym, setYm] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const [notes, setNotes] = useState('');
  const [mo, setMo] = useState<MoneyOutValue>(EMPTY_MONEY_OUT);
  if (open !== seed) {
    setSeed(open);
    if (open) {
      setKey(newIdempotencyKey('adv'));
      setAmount('');
      setNotes('');
      setDate(today);
      setYm({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
    }
  }

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post('/hr/advances', {
          employeeId,
          amount: Number(amount),
          date,
          deductYear: ym.year,
          deductMonth: ym.month,
          notes: notes.trim() || null,
          ...moneyOutPayload(mo),
          idempotencyKey: key,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم تسجيل التسبيق');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const amt = Number(amount);
  const ok = employeeId && amt > 0 && Math.round(amt * 100) === amt * 100 && date && moneyOutOk(mo);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تسبيق على الأجر · Avance sur salaire"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>
            <Banknote className="h-4 w-4" /> صرف التسبيق
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} required />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput label="المبلغ (د.ج)" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
          <TextInput label="تاريخ الصرف" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <MonthInput label="يُقتطع من أجر شهر" year={ym.year} month={ym.month} onChange={(y, mo2) => setYm({ year: y, month: mo2 })} />
        </div>
        <MoneyOutFields value={mo} onChange={setMo} />
        <TextArea label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </div>
    </Modal>
  );
}

function Loans() {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<LoanRow | null>(null);
  const [repaying, setRepaying] = useState<LoanRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['hr', 'loans', employeeId, status],
    queryFn: async () => (await api.get<LoanRow[]>('/hr/loans', { params: { employeeId: employeeId || undefined, status: status || undefined } })).data,
  });
  const rows = q.data ?? [];
  const outstanding = round2(rows.filter((r) => r.status === 'ACTIVE').reduce((s, r) => s + r.remaining, 0));

  const cancel = useMutation({
    mutationFn: async (reason: string) => (await api.post(`/hr/loans/${cancelling!.id}/cancel`, { reason })).data,
    onSuccess: () => {
      toast.success('تم إلغاء القرض');
      setCancelling(null);
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <EmployeeSelect value={employeeId} onChange={setEmployeeId} allowAll includeLeft />
          <Select label="الحالة · Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">الكل</option>
            {Object.keys(LOAN_STATUS).map((s) => (
              <option key={s} value={s}>
                {label.loan(s).ar} · {label.loan(s).fr}
              </option>
            ))}
          </Select>
          <StatCard label="المتبقي من القروض النشطة" value={money(outstanding)} tone={outstanding ? 'warning' : 'default'} />
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> قرض جديد
        </Button>
      </div>
      <QueryState q={q} empty={!rows.length} emptyText="لا توجد قروض">
        <Table minWidth={1040}>
          <thead>
            <tr>
              <Th>العامل</Th>
              <Th>المبلغ</Th>
              <Th>القسط</Th>
              <Th>من شهر</Th>
              <Th>المسدد / المتبقي</Th>
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = toNum(r.principal) ? Math.min(100, (r.repaid / toNum(r.principal)) * 100) : 0;
              return (
                <tr key={r.id} className="align-top">
                  <Td>
                    <EmployeeCell e={r.employee} sub={fmtDay(r.disbursedAt)} />
                  </Td>
                  <Td className="font-bold tabular-nums">{money(r.principal)}</Td>
                  <Td className="tabular-nums">{money(r.installmentAmount)}</Td>
                  <Td className="text-xs">{monthLabel(r.startYear, r.startMonth)}</Td>
                  <Td className="min-w-[12rem] text-xs">
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--app-bg-muted)]">
                      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 tabular-nums">
                      {money(r.repaid)} / <strong>{money(r.remaining)}</strong>
                    </p>
                    {r.repayments.length ? (
                      <button type="button" className="text-sky-700 hover:underline dark:text-sky-400" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {r.repayments.length} قسط {expanded === r.id ? '▲' : '▼'}
                      </button>
                    ) : null}
                    {expanded === r.id ? (
                      <ul className="mt-1 space-y-0.5">
                        {r.repayments.map((p) => (
                          <li key={p.id} className="tabular-nums">
                            {fmtDay(p.date)} — {money(p.amount)} ({p.source === 'PAYROLL' ? 'من الأجر' : 'يدوي'})
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusBadge l={label.loan(r.status)} />
                  </Td>
                  <Td>
                    {r.status === 'ACTIVE' ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setRepaying(r)}>
                          تسديد يدوي
                        </Button>
                        {r.repayments.length === 0 ? (
                          <Button size="sm" variant="ghost" title="إلغاء" onClick={() => setCancelling(r)}>
                            <Ban className="h-4 w-4 text-red-600" />
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </QueryState>
      <LoanModal open={creating} onClose={() => setCreating(false)} />
      <RepayModal loan={repaying} onClose={() => setRepaying(null)} />
      <ReasonModal
        open={!!cancelling}
        title="إلغاء القرض · Annuler le prêt"
        danger
        busy={cancel.isPending}
        onClose={() => setCancelling(null)}
        onConfirm={(r) => cancel.mutate(r)}
      />
    </div>
  );
}

function LoanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const today = todayKeyDz();
  const next = shiftMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1);
  const [seed, setSeed] = useState(false);
  const [key, setKey] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [installment, setInstallment] = useState('');
  const [ym, setYm] = useState(next);
  const [disbursedAt, setDisbursedAt] = useState(today);
  const [notes, setNotes] = useState('');
  const [mo, setMo] = useState<MoneyOutValue>(EMPTY_MONEY_OUT);
  if (open !== seed) {
    setSeed(open);
    if (open) {
      setKey(newIdempotencyKey('loan'));
      setPrincipal('');
      setInstallment('');
      setNotes('');
      setYm(next);
      setDisbursedAt(today);
    }
  }
  const p = Number(principal);
  const i = Number(installment);
  const months = p > 0 && i > 0 ? Math.ceil(p / i) : 0;

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post('/hr/loans', {
          employeeId,
          principal: p,
          installmentAmount: i,
          startYear: ym.year,
          startMonth: ym.month,
          disbursedAt,
          notes: notes.trim() || null,
          ...moneyOutPayload(mo),
          idempotencyKey: key,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم تسجيل القرض');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const ok = employeeId && p > 0 && i > 0 && i <= p && disbursedAt && moneyOutOk(mo);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="قرض للعامل · Prêt au salarié"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>
            <Banknote className="h-4 w-4" /> صرف القرض
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} required />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="مبلغ القرض (د.ج)" type="number" min={0.01} step="0.01" value={principal} onChange={(e) => setPrincipal(e.target.value)} dir="ltr" />
          <TextInput
            label="القسط الشهري (د.ج)"
            type="number"
            min={0.01}
            step="0.01"
            value={installment}
            onChange={(e) => setInstallment(e.target.value)}
            hint={months ? `≈ ${months} شهر` : undefined}
            dir="ltr"
          />
          <MonthInput label="أول اقتطاع في أجر شهر" year={ym.year} month={ym.month} onChange={(y, mo2) => setYm({ year: y, month: mo2 })} />
          <TextInput label="تاريخ الصرف" type="date" value={disbursedAt} onChange={(e) => setDisbursedAt(e.target.value)} />
        </div>
        {i > p && p > 0 ? <Notice tone="warning">القسط أكبر من مبلغ القرض.</Notice> : null}
        <MoneyOutFields value={mo} onChange={setMo} />
        <TextArea label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </div>
    </Modal>
  );
}

function RepayModal({ loan, onClose }: { loan: LoanRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayKeyDz());
  const [notes, setNotes] = useState('');
  const [seed, setSeed] = useState<LoanRow | null>(null);
  if (loan && seed !== loan) {
    setSeed(loan);
    setAmount(String(loan.remaining));
    setDate(todayKeyDz());
    setNotes('');
  }
  const m = useMutation({
    mutationFn: async () => (await api.post(`/hr/loans/${loan!.id}/repayments`, { amount: Number(amount), date, notes: notes.trim() || null })).data,
    onSuccess: () => {
      toast.success('تم تسجيل التسديد');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const a = Number(amount);
  return (
    <Modal
      open={!!loan}
      onClose={onClose}
      title="تسديد يدوي · Remboursement manuel"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!loan || !(a > 0 && a <= loan.remaining + 0.001) || !date} loading={m.isPending} onClick={() => m.mutate()}>
            تسجيل
          </Button>
        </>
      }
    >
      {loan ? (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{fullName(loan.employee)}</strong> — المتبقي {money(loan.remaining)}
          </p>
          <Notice tone="warning">
            التسديد اليدوي يُنقص رصيد القرض فقط ولا يُسجل دخول مبلغ في الصندوق — سجّل القبض في الصندوق إن لزم.
          </Notice>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="المبلغ" type="number" min={0.01} step="0.01" max={loan.remaining} value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
            <TextInput label="التاريخ" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <TextInput label="ملاحظة" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
        </div>
      ) : null}
    </Modal>
  );
}
