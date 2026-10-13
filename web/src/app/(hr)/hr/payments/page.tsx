'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Wallet, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  apiError,
  downloadCsv,
  EmployeeCell,
  EmployeeSelect,
  EmptyState,
  HrPageHeader,
  money,
  Panel,
  QueryState,
  ReasonModal,
  Select,
  StatCard,
  StatusBadge,
  Table,
  Td,
  TextInput,
  Th,
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { dateTimeDz, fullName, label, monthLabel, monthRange, PAYMENT_METHOD, round2, todayKeyDz, toCsv, toNum } from '@/lib/hr-labels';

type Payment = {
  id: string;
  payslipId: string;
  amount: string;
  paidAt: string;
  paymentMethod: string;
  cashRegisterName: string | null;
  reference: string | null;
  notes: string | null;
  status: string;
  paidByName: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  employee: { id: string; matricule: string; firstName: string; lastName: string };
  period: { id: string; year: number; month: number };
};
type PeriodOption = { id: string; year: number; month: number; status: string };

export default function PaymentsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const today = todayKeyDz();
  const initial = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const [periodId, setPeriodId] = useState('');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);

  const periodsQ = useQuery({
    queryKey: ['hr', 'payroll-periods'],
    queryFn: async () => (await api.get<PeriodOption[]>('/hr/payroll/periods')).data,
  });

  const params = {
    ...(periodId ? { periodId } : { from, to }),
    ...(employeeId ? { employeeId } : {}),
    ...(status ? { status } : {}),
  };
  const q = useQuery({
    queryKey: ['hr', 'payments', params],
    enabled: !!periodId || (!!from && !!to && from <= to),
    queryFn: async () => (await api.get<Payment[]>('/hr/payroll/payments', { params })).data,
  });

  const rows = useMemo(() => (q.data ?? []).filter((p) => !method || p.paymentMethod === method), [q.data, method]);
  const posted = rows.filter((p) => p.status === 'POSTED');
  const total = round2(posted.reduce((t, p) => t + toNum(p.amount), 0));
  const cashTotal = round2(posted.filter((p) => p.paymentMethod === 'CASH_REGISTER').reduce((t, p) => t + toNum(p.amount), 0));

  const cancel = useMutation({
    mutationFn: async (v: { id: string; reason: string }) => (await api.post(`/hr/payroll/payments/${v.id}/cancel`, { reason: v.reason })).data,
    onSuccess: () => {
      setCancelId(null);
      toast.success('تم إلغاء الدفعة');
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const closedPeriods = new Set((periodsQ.data ?? []).filter((p) => p.status === 'CLOSED').map((p) => p.id));

  function exportCsv() {
    downloadCsv(
      `paiements-salaires-${periodId ? 'periode' : `${from}_${to}`}.csv`,
      toCsv(
        ['Date', 'Matricule', 'Employé', 'Période', 'Montant', 'Mode', 'Caisse', 'Référence', 'Statut', 'Par', 'Motif annulation'],
        rows.map((p) => [
          dateTimeDz(p.paidAt),
          p.employee.matricule,
          fullName(p.employee),
          `${String(p.period.month).padStart(2, '0')}/${p.period.year}`,
          toNum(p.amount),
          label.payment(p.paymentMethod).fr,
          p.cashRegisterName ?? '',
          p.reference ?? '',
          label.money(p.status).fr,
          p.paidByName ?? '',
          p.cancelReason ?? '',
        ]),
      ),
    );
  }

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="دفعات الأجور"
        fr="Paiements des salaires"
        icon={Wallet}
        subtitle="كل دفعة مسجلة بشكل منفصل عن حساب الأجور. الإلغاء لا يحذف الدفعة بل يعكسها."
        actions={
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        }
      />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Select label="فترة الأجور" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">— حسب التاريخ —</option>
            {(periodsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {monthLabel(p.year, p.month)}
              </option>
            ))}
          </Select>
          <TextInput label="من" type="date" value={from} disabled={!!periodId} onChange={(e) => setFrom(e.target.value)} />
          <TextInput label="إلى" type="date" value={to} disabled={!!periodId} onChange={(e) => setTo(e.target.value)} />
          <EmployeeSelect label="العامل" value={employeeId} onChange={setEmployeeId} includeLeft allowAll />
          <Select label="الطريقة" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">الكل</option>
            {Object.keys(PAYMENT_METHOD).map((m) => (
              <option key={m} value={m}>
                {label.payment(m).ar}
              </option>
            ))}
          </Select>
          <Select label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">الكل</option>
            <option value="POSTED">مسجلة</option>
            <option value="CANCELLED">ملغاة</option>
          </Select>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="عدد الدفعات المسجلة" value={posted.length} />
        <StatCard label="المجموع · Total" value={money(total)} tone="primary" />
        <StatCard label="منها من الصندوق · Caisse" value={money(cashTotal)} tone="warning" />
      </div>

      <QueryState q={q}>
        {rows.length ? (
          <Panel bodyClassName="p-0">
            <Table minWidth={1050}>
              <thead>
                <tr>
                  <Th>التاريخ</Th>
                  <Th>العامل</Th>
                  <Th>الفترة</Th>
                  <Th>المبلغ</Th>
                  <Th>الطريقة</Th>
                  <Th>المرجع</Th>
                  <Th>بواسطة</Th>
                  <Th>الحالة</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={p.status === 'CANCELLED' ? 'opacity-60' : 'hover:bg-[var(--app-bg-muted)]'}>
                    <Td className="whitespace-nowrap text-xs">{dateTimeDz(p.paidAt)}</Td>
                    <Td>
                      <Link href={`/hr/payroll/payslips/${p.payslipId}`} className="hover:underline">
                        <EmployeeCell e={p.employee} />
                      </Link>
                    </Td>
                    <Td className="text-xs">
                      <Link href={`/hr/payroll/${p.period.id}`} className="hover:underline">
                        {monthLabel(p.period.year, p.period.month)}
                      </Link>
                    </Td>
                    <Td className={`font-bold tabular-nums ${p.status === 'CANCELLED' ? 'line-through' : ''}`}>{money(p.amount)}</Td>
                    <Td className="text-xs">
                      {label.payment(p.paymentMethod).ar}
                      {p.cashRegisterName ? <p className="text-[var(--app-text-dim)]">{p.cashRegisterName}</p> : null}
                    </Td>
                    <Td className="text-xs">
                      {p.reference ?? ''}
                      {p.notes ? <p className="text-[var(--app-text-dim)]">{p.notes}</p> : null}
                    </Td>
                    <Td className="text-xs">{p.paidByName ?? '—'}</Td>
                    <Td className="text-xs">
                      <StatusBadge l={label.money(p.status)} />
                      {p.status === 'CANCELLED' ? (
                        <p className="mt-1 max-w-[14rem] text-[11px]">
                          {p.cancelledByName} — {p.cancelReason}
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      {p.status === 'POSTED' && can('HR_SALARY_PAY') && !closedPeriods.has(p.period.id) ? (
                        <Button size="sm" variant="ghost" onClick={() => setCancelId(p.id)}>
                          <XCircle className="h-4 w-4" /> إلغاء
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        ) : (
          <EmptyState text="لا توجد دفعات في هذا النطاق" />
        )}
      </QueryState>

      <ReasonModal
        open={!!cancelId}
        title="إلغاء دفعة · Annuler le paiement"
        description="يُعاد المبلغ إلى جلسة الصندوق إن كان الدفع منه، ويعود الكشف إلى «غير مدفوع» أو «جزئي»."
        danger
        busy={cancel.isPending}
        onClose={() => setCancelId(null)}
        onConfirm={(reason) => cancelId && cancel.mutate({ id: cancelId, reason })}
      />
    </div>
  );
}
