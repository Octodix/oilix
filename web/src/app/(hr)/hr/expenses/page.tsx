'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Receipt, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  apiError,
  downloadCsv,
  EMPTY_MONEY_OUT,
  EmployeeCell,
  EmployeeSelect,
  EmptyState,
  HrPageHeader,
  Modal,
  money,
  MoneyOutFields,
  moneyOutPayload,
  Notice,
  Panel,
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
  useCan,
  type MoneyOutValue,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { EXPENSE_CATEGORY, fmtDay, fullName, label, monthRange, newIdempotencyKey, todayKeyDz, toCsv, toNum } from '@/lib/hr-labels';

const MANUAL_CATEGORIES = Object.keys(EXPENSE_CATEGORY).filter((k) => !['SALARY', 'ADVANCE', 'LOAN'].includes(k));

type Expense = {
  id: string;
  category: string;
  amount: string;
  date: string;
  description: string;
  paymentMethod: string;
  cashRegisterName: string | null;
  reference: string | null;
  status: string;
  createdByName: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  employee: { id: string; matricule: string; firstName: string; lastName: string } | null;
};
type Summary = { from: string; to: string; lines: { key: string; label: string; amount: number; count: number }[]; total: number; note: string };

export default function ExpensesPage() {
  const can = useCan();
  const qc = useQueryClient();
  const today = todayKeyDz();
  const initial = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [category, setCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const rangeOk = !!from && !!to && from <= to;

  const listQ = useQuery({
    queryKey: ['hr', 'expenses', from, to, category],
    enabled: rangeOk,
    queryFn: async () => (await api.get<Expense[]>('/hr/expenses', { params: { from, to, ...(category ? { category } : {}) } })).data,
  });
  const summaryQ = useQuery({
    queryKey: ['hr', 'expenses-summary', from, to],
    enabled: rangeOk,
    queryFn: async () => (await api.get<Summary>('/hr/reports/expenses', { params: { from, to } })).data,
  });

  const cancel = useMutation({
    mutationFn: async (v: { id: string; reason: string }) => (await api.post(`/hr/expenses/${v.id}/cancel`, { reason: v.reason })).data,
    onSuccess: () => {
      setCancelId(null);
      toast.success('تم إلغاء المصروف');
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const rows = listQ.data ?? [];

  function exportCsv() {
    downloadCsv(
      `depenses-rh-${from}_${to}.csv`,
      toCsv(
        ['Date', 'Catégorie', 'Montant', 'Employé', 'Description', 'Mode', 'Caisse', 'Référence', 'Statut', 'Par'],
        rows.map((e) => [
          fmtDay(e.date),
          label.expense(e.category).fr,
          toNum(e.amount),
          e.employee ? fullName(e.employee) : '',
          e.description,
          label.payment(e.paymentMethod).fr,
          e.cashRegisterName ?? '',
          e.reference ?? '',
          label.money(e.status).fr,
          e.createdByName ?? '',
        ]),
      ),
    );
  }

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="مصاريف الموارد البشرية"
        fr="Dépenses RH"
        icon={Receipt}
        subtitle="مصاريف العمال الأخرى (اشتراكات، تأمين، تكوين…). الأجور والتسبيقات والقروض تُسجَّل من أقسامها ولا تُعاد هنا."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            {can('HR_EXPENSES_MANAGE') ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> مصروف جديد
              </Button>
            ) : null}
          </>
        }
      />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput label="من" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextInput label="إلى" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select label="الفئة" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">الكل</option>
            {MANUAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label.expense(c).ar} · {label.expense(c).fr}
              </option>
            ))}
          </Select>
        </div>
        {!rangeOk ? <p className="mt-2 text-xs text-red-600">نطاق التواريخ غير صالح</p> : null}
      </Panel>

      <Panel title="تكلفة المستخدمين في الفترة · Coût du personnel">
        <QueryState q={summaryQ}>
          {summaryQ.data ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {summaryQ.data.lines.map((l) => (
                  <StatCard key={l.key} label={`${label.expense(l.key).ar} (${l.count})`} value={money(l.amount)} />
                ))}
                <StatCard label="المجموع · Total" value={money(summaryQ.data.total)} tone="primary" />
              </div>
              <p className="text-xs text-[var(--app-text-dim)]">{summaryQ.data.note}</p>
            </div>
          ) : null}
        </QueryState>
      </Panel>

      <QueryState q={listQ}>
        {rows.length ? (
          <Panel title="المصاريف المسجلة" bodyClassName="p-0">
            <Table minWidth={1000}>
              <thead>
                <tr>
                  <Th>التاريخ</Th>
                  <Th>الفئة</Th>
                  <Th>المبلغ</Th>
                  <Th>العامل</Th>
                  <Th>الوصف</Th>
                  <Th>الطريقة</Th>
                  <Th>الحالة</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className={e.status === 'CANCELLED' ? 'opacity-60' : ''}>
                    <Td className="whitespace-nowrap text-xs">{fmtDay(e.date)}</Td>
                    <Td className="text-xs">{label.expense(e.category).ar}</Td>
                    <Td className={`font-bold tabular-nums ${e.status === 'CANCELLED' ? 'line-through' : ''}`}>{money(e.amount)}</Td>
                    <Td>{e.employee ? <EmployeeCell e={e.employee} /> : <span className="text-xs text-[var(--app-text-dim)]">—</span>}</Td>
                    <Td className="max-w-[18rem] text-xs">
                      {e.description}
                      {e.createdByName ? <p className="text-[var(--app-text-dim)]">{e.createdByName}</p> : null}
                    </Td>
                    <Td className="text-xs">
                      {label.payment(e.paymentMethod).ar}
                      {e.cashRegisterName ? <p className="text-[var(--app-text-dim)]">{e.cashRegisterName}</p> : null}
                      {e.reference ? <p className="text-[var(--app-text-dim)]">{e.reference}</p> : null}
                    </Td>
                    <Td className="text-xs">
                      <StatusBadge l={label.money(e.status)} />
                      {e.status === 'CANCELLED' ? (
                        <p className="mt-1 max-w-[12rem] text-[11px]">
                          {e.cancelledByName} — {e.cancelReason}
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      {e.status === 'POSTED' && can('HR_EXPENSES_MANAGE') ? (
                        <Button size="sm" variant="ghost" onClick={() => setCancelId(e.id)}>
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
          <EmptyState text="لا توجد مصاريف في هذه الفترة" />
        )}
      </QueryState>

      <ExpenseModal open={creating} onClose={() => setCreating(false)} />
      <ReasonModal
        open={!!cancelId}
        title="إلغاء مصروف · Annuler la dépense"
        description="يُلغى المصروف (لا يُحذف) ويُعاد المبلغ إلى جلسة الصندوق إن كان مدفوعاً منه."
        danger
        busy={cancel.isPending}
        onClose={() => setCancelId(null)}
        onConfirm={(reason) => cancelId && cancel.mutate({ id: cancelId, reason })}
      />
    </div>
  );
}

function ExpenseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [seed, setSeed] = useState(false);
  const [key, setKey] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayKeyDz());
  const [employeeId, setEmployeeId] = useState('');
  const [description, setDescription] = useState('');
  const [mo, setMo] = useState<MoneyOutValue>(EMPTY_MONEY_OUT);
  if (open !== seed) {
    setSeed(open);
    if (open) {
      setKey(newIdempotencyKey('exp'));
      setCategory('OTHER');
      setAmount('');
      setDate(todayKeyDz());
      setEmployeeId('');
      setDescription('');
      setMo(EMPTY_MONEY_OUT);
    }
  }

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post('/hr/expenses', {
          category,
          amount: Number(amount),
          date,
          employeeId: employeeId || null,
          description: description.trim(),
          ...moneyOutPayload(mo),
          idempotencyKey: key,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم تسجيل المصروف');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const n = Number(amount);
  const ok =
    Number.isFinite(n) && n > 0 && !!date && description.trim().length >= 3 && (mo.paymentMethod !== 'CASH_REGISTER' || !!mo.cashRegisterId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="مصروف موارد بشرية · Nouvelle dépense RH"
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="الفئة · Catégorie" value={category} onChange={(e) => setCategory(e.target.value)}>
            {MANUAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label.expense(c).ar} · {label.expense(c).fr}
              </option>
            ))}
          </Select>
          <TextInput label="المبلغ (د.ج)" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <TextInput label="التاريخ" type="date" value={date} max={todayKeyDz()} onChange={(e) => setDate(e.target.value)} />
          <EmployeeSelect label="العامل (اختياري)" value={employeeId} onChange={setEmployeeId} emptyLabel="— بدون عامل —" />
        </div>
        <TextArea label="الوصف (3 أحرف على الأقل)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        <MoneyOutFields value={mo} onChange={setMo} />
        <Notice>لا تسجّل هنا أجوراً أو تسبيقات أو قروضاً — لها أقسامها حتى لا تُحتسب مرتين.</Notice>
      </div>
    </Modal>
  );
}
