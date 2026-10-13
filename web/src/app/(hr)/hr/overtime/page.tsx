'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check as CheckIcon, Download, Plus, Timer, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { rangeParams, RequestFilters } from '@/components/hr/requests-ui';
import {
  apiError,
  downloadCsv,
  EmployeeCell,
  EmployeeSelect,
  HrPageHeader,
  Modal,
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
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { fmtDay, fmtMinutes, fullName, label, OVERTIME_RULE, todayKeyDz, toCsv, toNum } from '@/lib/hr-labels';

type OvertimeRow = {
  id: string;
  employeeId: string;
  employee: { id: string; matricule: string; firstName: string; lastName: string };
  date: string;
  source: string;
  calculatedMinutes: number;
  requestedMinutes: number;
  approvedMinutes: number | null;
  multiplier: string;
  ruleCode: string;
  reason: string | null;
  status: string;
  decidedByName: string | null;
  decisionNote: string | null;
  payslip: { id: string; periodId: string } | null;
};

export default function OvertimePage() {
  const can = useCan();
  const qc = useQueryClient();
  const today = todayKeyDz();
  const [f, setF] = useState({ from: `${today.slice(0, 8)}01`, to: today, employeeId: '', status: '' });
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState<OvertimeRow | null>(null);
  const [rejecting, setRejecting] = useState<{ row: OvertimeRow; decision: 'REJECT' | 'CANCEL' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const q = useQuery({
    queryKey: ['hr', 'overtime', f],
    queryFn: async () => (await api.get<OvertimeRow[]>('/hr/overtime', { params: rangeParams(f) })).data,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const manage = can('HR_OVERTIME_MANAGE');
  const approve = manage && can('HR_OVERTIME_APPROVE');

  const decide = useMutation({
    mutationFn: async (v: { id: string; decision: 'APPROVE' | 'REJECT' | 'CANCEL'; approvedMinutes?: number; note?: string }) =>
      (await api.post(`/hr/overtime/${v.id}/decision`, { decision: v.decision, approvedMinutes: v.approvedMinutes, note: v.note || null })).data,
    onSuccess: (_d, v) => {
      toast.success(v.decision === 'APPROVE' ? 'تمت المصادقة' : v.decision === 'REJECT' ? 'تم الرفض' : 'تم الإلغاء');
      setApproving(null);
      setRejecting(null);
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const totals = useMemo(() => {
    const t = { pending: 0, approved: 0, calculated: 0 };
    for (const r of rows) {
      if (r.status === 'PENDING') t.pending += r.requestedMinutes;
      if (r.status === 'APPROVED') t.approved += r.approvedMinutes ?? 0;
      t.calculated += r.calculatedMinutes;
    }
    return t;
  }, [rows]);

  const pendingIds = rows.filter((r) => r.status === 'PENDING' && !r.payslip).map((r) => r.id);

  async function bulkApprove() {
    const ids = [...selected].filter((id) => pendingIds.includes(id));
    if (!ids.length || !confirm(`المصادقة على ${ids.length} طلب بكامل المدة المطلوبة؟`)) return;
    setBulkBusy(true);
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await api.post(`/hr/overtime/${id}/decision`, { decision: 'APPROVE' });
        ok++;
      } catch (e) {
        errors.push(apiError(e));
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ['hr'] });
    if (ok) toast.success(`تمت المصادقة على ${ok} طلب`);
    if (errors.length) toast.error(`${errors.length} فشل: ${errors[0]}`);
  }

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="الساعات الإضافية"
        fr="Heures supplémentaires"
        icon={Timer}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  `heures-sup-${f.from}_${f.to}.csv`,
                  toCsv(
                    ['Date', 'Matricule', 'Employé', 'Source', 'Calculé (min)', 'Demandé (min)', 'Approuvé (min)', 'Taux', 'Règle', 'Statut'],
                    rows.map((r) => [
                      r.date.slice(0, 10),
                      r.employee.matricule,
                      fullName(r.employee),
                      label.overtimeSource(r.source).fr,
                      r.calculatedMinutes,
                      r.requestedMinutes,
                      r.approvedMinutes ?? '',
                      toNum(r.multiplier),
                      label.overtimeRule(r.ruleCode).fr,
                      label.approval(r.status).fr,
                    ]),
                  ),
                )
              }
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
            {approve && selected.size ? (
              <Button size="sm" variant="outline" loading={bulkBusy} onClick={bulkApprove}>
                <CheckIcon className="h-4 w-4" /> مصادقة على المحدد ({selected.size})
              </Button>
            ) : null}
            {manage ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> إضافة يدوية
              </Button>
            ) : null}
          </>
        }
      />
      <Notice>
        الساعات الإضافية تُحسب تلقائياً من البصمات (حسب الإعدادات)، لكنها <strong>لا تُدفع إلا بعد المصادقة</strong>. يمكن المصادقة على مدة أقل من
        المحسوبة.
      </Notice>
      <RequestFilters {...f} onChange={(p) => setF((s) => ({ ...s, ...p }))} />
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="في الانتظار" value={fmtMinutes(totals.pending)} tone={totals.pending ? 'warning' : 'default'} />
        <StatCard label="مصادق عليها" value={fmtMinutes(totals.approved)} tone="success" />
        <StatCard label="محسوبة من البصمات" value={fmtMinutes(totals.calculated)} />
      </div>
      <QueryState q={q} empty={!rows.length} emptyText="لا توجد ساعات إضافية في هذه الفترة">
        <Table minWidth={1080}>
          <thead>
            <tr>
              <Th>
                {approve && pendingIds.length ? (
                  <input
                    type="checkbox"
                    checked={pendingIds.every((id) => selected.has(id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(pendingIds) : new Set())}
                  />
                ) : null}
              </Th>
              <Th>اليوم</Th>
              <Th>العامل</Th>
              <Th>المصدر</Th>
              <Th>محسوب</Th>
              <Th>مطلوب</Th>
              <Th>مصادق</Th>
              <Th>النوع / المعامل</Th>
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  {approve && r.status === 'PENDING' && !r.payslip ? (
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                    />
                  ) : null}
                </Td>
                <Td className="text-xs tabular-nums">{fmtDay(r.date)}</Td>
                <Td>
                  <EmployeeCell e={r.employee} />
                </Td>
                <Td className="text-xs">
                  {label.overtimeSource(r.source).ar}
                  {r.reason ? <p className="max-w-[12rem] truncate text-[var(--app-text-dim)]" title={r.reason}>{r.reason}</p> : null}
                </Td>
                <Td className="tabular-nums">{r.calculatedMinutes ? fmtMinutes(r.calculatedMinutes) : '—'}</Td>
                <Td className="tabular-nums">{fmtMinutes(r.requestedMinutes)}</Td>
                <Td className="font-bold tabular-nums">{r.approvedMinutes != null ? fmtMinutes(r.approvedMinutes) : '—'}</Td>
                <Td className="text-xs">
                  {label.overtimeRule(r.ruleCode).ar} × {toNum(r.multiplier)}
                </Td>
                <Td className="text-xs">
                  <StatusBadge l={label.approval(r.status)} />
                  {r.payslip ? (
                    <Link href={`/hr/payroll/payslips/${r.payslip.id}`} className="mt-1 block text-sky-700 hover:underline dark:text-sky-400">
                      مدرجة في كشف أجر
                    </Link>
                  ) : null}
                  {r.decidedByName ? <p className="text-[var(--app-text-dim)]">{r.decidedByName}</p> : null}
                  {r.decisionNote ? <p className="text-[var(--app-text-dim)]">{r.decisionNote}</p> : null}
                </Td>
                <Td>
                  {!r.payslip ? (
                    <div className="flex gap-1">
                      {approve && r.status === 'PENDING' ? (
                        <>
                          <Button size="sm" variant="ghost" title="مصادقة" onClick={() => setApproving(r)}>
                            <CheckIcon className="h-4 w-4 text-emerald-600" />
                          </Button>
                          <Button size="sm" variant="ghost" title="رفض" onClick={() => setRejecting({ row: r, decision: 'REJECT' })}>
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                        </>
                      ) : null}
                      {manage && (r.status === 'PENDING' || r.status === 'APPROVED') ? (
                        <Button size="sm" variant="ghost" title="إلغاء" onClick={() => setRejecting({ row: r, decision: 'CANCEL' })}>
                          <Undo2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>

      <ApproveModal row={approving} busy={decide.isPending} onClose={() => setApproving(null)} onConfirm={(m) => approving && decide.mutate({ id: approving.id, decision: 'APPROVE', approvedMinutes: m })} />
      <ReasonModal
        open={!!rejecting}
        title={rejecting?.decision === 'REJECT' ? 'رفض الساعات الإضافية' : 'إلغاء الساعات الإضافية'}
        danger
        busy={decide.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(note) => rejecting && decide.mutate({ id: rejecting.row.id, decision: rejecting.decision, note })}
      />
      <OvertimeModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ApproveModal({
  row,
  busy,
  onClose,
  onConfirm,
}: {
  row: OvertimeRow | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (minutes: number) => void;
}) {
  const [minutes, setMinutes] = useState('');
  const [seed, setSeed] = useState<OvertimeRow | null>(null);
  if (row && seed !== row) {
    setSeed(row);
    setMinutes(String(row.requestedMinutes));
  }
  const n = Number(minutes);
  const ok = row && Number.isInteger(n) && n >= 1 && n <= row.requestedMinutes;
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title="المصادقة على الساعات الإضافية · Approuver"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!ok} loading={busy} onClick={() => onConfirm(n)}>
            مصادقة
          </Button>
        </>
      }
    >
      {row ? (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{fullName(row.employee)}</strong> — {fmtDay(row.date)} — مطلوب {fmtMinutes(row.requestedMinutes)}
          </p>
          <TextInput
            label="المدة المصادق عليها (دقائق) · Minutes approuvées"
            type="number"
            min={1}
            max={row.requestedMinutes}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            hint={Number.isFinite(n) && n > 0 ? `= ${fmtMinutes(n)} × ${toNum(row.multiplier)}` : undefined}
            dir="ltr"
          />
        </div>
      ) : null}
    </Modal>
  );
}

function OvertimeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(todayKeyDz());
  const [hours, setHours] = useState('');
  const [mins, setMins] = useState('');
  const [ruleCode, setRuleCode] = useState('WORKDAY');
  const [reason, setReason] = useState('');
  const total = (Number(hours) || 0) * 60 + (Number(mins) || 0);

  const m = useMutation({
    mutationFn: async () => (await api.post('/hr/overtime', { employeeId, date, minutes: total, ruleCode, reason: reason.trim() })).data,
    onSuccess: () => {
      toast.success('تم تسجيل الطلب (في انتظار المصادقة)');
      qc.invalidateQueries({ queryKey: ['hr'] });
      setHours('');
      setMins('');
      setReason('');
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const ok = employeeId && date && Number.isInteger(total) && total > 0 && total <= 1440 && reason.trim().length >= 3;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ساعات إضافية يدوية · Heures sup. manuelles"
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
        <Notice>للحالات التي لا تظهر في البصمات (مهمة خارجية…). تبقى في الانتظار حتى المصادقة.</Notice>
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} required />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput label="اليوم" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextInput label="ساعات" type="number" min={0} max={24} value={hours} onChange={(e) => setHours(e.target.value)} dir="ltr" />
          <TextInput label="دقائق" type="number" min={0} max={59} value={mins} onChange={(e) => setMins(e.target.value)} dir="ltr" />
        </div>
        <Select label="النوع · Règle" value={ruleCode} onChange={(e) => setRuleCode(e.target.value)}>
          {Object.keys(OVERTIME_RULE).map((k) => (
            <option key={k} value={k}>
              {label.overtimeRule(k).ar} · {label.overtimeRule(k).fr}
            </option>
          ))}
        </Select>
        <TextArea label="السبب (إلزامي)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>
    </Modal>
  );
}
