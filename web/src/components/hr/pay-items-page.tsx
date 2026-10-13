'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Gift, MinusCircle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DecisionButtons } from '@/components/hr/requests-ui';
import {
  apiError,
  Check,
  downloadCsv,
  EmployeeCell,
  EmployeeSelect,
  HrPageHeader,
  Modal,
  money,
  MonthInput,
  Notice,
  QueryState,
  Select,
  StatCard,
  StatusBadge,
  Table,
  Td,
  TextArea,
  TextInput,
  Th,
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { APPROVAL_STATUS, BONUS_CATEGORY, fullName, label, monthLabel, round2, todayKeyDz, toCsv, toNum } from '@/lib/hr-labels';

type Kind = 'bonus' | 'deduction';
type ItemRow = {
  id: string;
  employee: { id: string; matricule: string; firstName: string; lastName: string };
  category?: string;
  bonusType?: string;
  deductionType?: string;
  amount: string;
  year: number;
  month: number;
  reason: string | null;
  status: string;
  createdByName: string | null;
  decidedByName: string | null;
  payslipId: string | null;
};

const COPY = {
  bonus: {
    title: 'المنح والتعويضات',
    fr: 'Primes',
    icon: Gift,
    endpoint: '/hr/bonuses',
    perm: 'HR_BONUSES_MANAGE',
    add: 'منحة جديدة',
    typeLabel: 'نوع المنحة · Type de prime',
    typeHint: 'مثال: منحة المردودية، منحة النقل، منحة العيد…',
    note: 'المنح المصادق عليها فقط تُضاف إلى كشف أجر الشهر المحدد. بعد المصادقة على الأجور تُقفل ولا يمكن تعديلها.',
  },
  deduction: {
    title: 'الاقتطاعات',
    fr: 'Retenues',
    icon: MinusCircle,
    endpoint: '/hr/deductions',
    perm: 'HR_DEDUCTIONS_MANAGE',
    add: 'اقتطاع جديد',
    typeLabel: 'نوع الاقتطاع · Type de retenue',
    typeHint: 'مثال: ضرر بالمعدات، غرامة داخلية…',
    note: 'اقتطاعات يدوية فقط. اقتطاعات الغياب والتأخر والتسبيقات والقروض تُحسب تلقائياً في الأجور ولا يجب إدخالها هنا (لتجنب الاقتطاع المزدوج).',
  },
} as const;

export function PayItemsPage({ kind }: { kind: Kind }) {
  const c = COPY[kind];
  const can = useCan();
  const today = todayKeyDz();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [allMonths, setAllMonths] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);

  const params = { year: allMonths ? undefined : year, month: allMonths ? undefined : month, employeeId: employeeId || undefined, status: status || undefined };
  const q = useQuery({
    queryKey: ['hr', kind, params],
    queryFn: async () => (await api.get<ItemRow[]>(c.endpoint, { params })).data,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const totals = useMemo(() => {
    const t = { approved: 0, pending: 0 };
    for (const r of rows) {
      if (r.status === 'APPROVED') t.approved += toNum(r.amount);
      if (r.status === 'PENDING') t.pending += toNum(r.amount);
    }
    return { approved: round2(t.approved), pending: round2(t.pending) };
  }, [rows]);

  const manage = can(c.perm);
  const Icon = c.icon;

  return (
    <div className="space-y-4">
      <HrPageHeader
        title={c.title}
        fr={c.fr}
        icon={Icon}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  `${kind === 'bonus' ? 'primes' : 'retenues'}-${allMonths ? 'tout' : `${year}-${month}`}.csv`,
                  toCsv(
                    ['Mois', 'Matricule', 'Employé', 'Type', 'Montant', 'Statut', 'Motif', 'Créé par', 'Décidé par'],
                    rows.map((r) => [
                      `${r.year}-${String(r.month).padStart(2, '0')}`,
                      r.employee.matricule,
                      fullName(r.employee),
                      r.bonusType ?? r.deductionType ?? '',
                      toNum(r.amount),
                      label.approval(r.status).fr,
                      r.reason ?? '',
                      r.createdByName ?? '',
                      r.decidedByName ?? '',
                    ]),
                  ),
                )
              }
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
            {manage ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> {c.add}
              </Button>
            ) : null}
          </>
        }
      />
      <Notice>{c.note}</Notice>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <MonthInput
            year={year}
            month={month}
            onChange={(y, m) => {
              setYear(y);
              setMonth(m);
            }}
          />
          <Check label="كل الأشهر" checked={allMonths} onChange={setAllMonths} />
        </div>
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} allowAll includeLeft />
        <Select label="الحالة · Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">الكل</option>
          {Object.keys(APPROVAL_STATUS).map((s) => (
            <option key={s} value={s}>
              {label.approval(s).ar} · {label.approval(s).fr}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="مصادق عليها" value={money(totals.approved)} tone="success" />
        <StatCard label="في الانتظار" value={money(totals.pending)} tone={totals.pending ? 'warning' : 'default'} />
      </div>
      <QueryState q={q} empty={!rows.length} emptyText="لا توجد عناصر">
        <Table minWidth={960}>
          <thead>
            <tr>
              <Th>الشهر</Th>
              <Th>العامل</Th>
              <Th>النوع</Th>
              <Th>المبلغ</Th>
              <Th>السبب</Th>
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="text-xs">{monthLabel(r.year, r.month)}</Td>
                <Td>
                  <EmployeeCell e={r.employee} />
                </Td>
                <Td className="text-xs">
                  <p className="font-bold">{r.bonusType ?? r.deductionType}</p>
                  {r.category ? <p className="text-[var(--app-text-dim)]">{label.bonusCategory(r.category).ar}</p> : null}
                </Td>
                <Td className="font-bold tabular-nums">{money(r.amount)}</Td>
                <Td className="max-w-[16rem] text-xs">{r.reason ?? '—'}</Td>
                <Td className="text-xs">
                  <StatusBadge l={label.approval(r.status)} />
                  {r.payslipId ? (
                    <Link href={`/hr/payroll/payslips/${r.payslipId}`} className="mt-1 block text-sky-700 hover:underline dark:text-sky-400">
                      مدرج في كشف أجر
                    </Link>
                  ) : null}
                  {r.decidedByName ? <p className="text-[var(--app-text-dim)]">{r.decidedByName}</p> : null}
                </Td>
                <Td>
                  {!r.payslipId ? (
                    <DecisionButtons path={`${c.endpoint}/${r.id}/decision`} status={r.status} canApprove={manage} canCancel={manage} />
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <ItemModal kind={kind} open={creating} onClose={() => setCreating(false)} defaultYear={year} defaultMonth={month} />
    </div>
  );
}

function ItemModal({
  kind,
  open,
  onClose,
  defaultYear,
  defaultMonth,
}: {
  kind: Kind;
  open: boolean;
  onClose: () => void;
  defaultYear: number;
  defaultMonth: number;
}) {
  const c = COPY[kind];
  const qc = useQueryClient();
  const [seed, setSeed] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [category, setCategory] = useState('BONUS');
  const [type, setType] = useState('');
  const [amount, setAmount] = useState('');
  const [ym, setYm] = useState({ year: defaultYear, month: defaultMonth });
  const [reason, setReason] = useState('');
  const [approveNow, setApproveNow] = useState(false);
  if (open !== seed) {
    setSeed(open);
    if (open) {
      setYm({ year: defaultYear, month: defaultMonth });
      setAmount('');
      setReason('');
      setApproveNow(false);
    }
  }

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post(c.endpoint, {
          employeeId,
          ...(kind === 'bonus' ? { category, bonusType: type.trim() } : { deductionType: type.trim() }),
          amount: Number(amount),
          year: ym.year,
          month: ym.month,
          reason: reason.trim() || (kind === 'bonus' ? null : undefined),
          approveNow: approveNow || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم التسجيل');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const amt = Number(amount);
  const ok =
    employeeId &&
    type.trim().length >= 2 &&
    amt > 0 &&
    Math.round(amt * 100) === amt * 100 &&
    (kind === 'bonus' || reason.trim().length >= 3);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={c.add}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>
            تسجيل
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} required />
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === 'bonus' ? (
            <Select label="الفئة · Catégorie" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.keys(BONUS_CATEGORY).map((k) => (
                <option key={k} value={k}>
                  {label.bonusCategory(k).ar} · {label.bonusCategory(k).fr}
                </option>
              ))}
            </Select>
          ) : null}
          <TextInput label={c.typeLabel} value={type} onChange={(e) => setType(e.target.value)} maxLength={100} hint={c.typeHint} />
          <TextInput label="المبلغ (د.ج) · Montant" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
          <MonthInput label="شهر الأجر · Mois de paie" year={ym.year} month={ym.month} onChange={(y, mo) => setYm({ year: y, month: mo })} />
        </div>
        <TextArea
          label={kind === 'bonus' ? 'السبب · Motif' : 'السبب (إلزامي) · Motif'}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
        <Check label="المصادقة مباشرة · Approuver directement" checked={approveNow} onChange={setApproveNow} />
      </div>
    </Modal>
  );
}
