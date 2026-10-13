'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Download, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AttachmentInput, AttachmentLink, DecisionButtons, rangeParams, RequestFilters } from '@/components/hr/requests-ui';
import {
  apiError,
  Check,
  downloadCsv,
  EmployeeCell,
  EmployeeSelect,
  HrPageHeader,
  Modal,
  Notice,
  QueryState,
  Select,
  StatusBadge,
  Table,
  Td,
  TextArea,
  TextInput,
  Th,
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { daysBetween, fmtDay, fullName, label, todayKeyDz, toCsv, toNum } from '@/lib/hr-labels';
import { cn } from '@/lib/utils';

type LeaveType = {
  id: string;
  code: string;
  name: string;
  nameFr: string | null;
  isPaid: boolean;
  deductsFromBalance: boolean;
  defaultDaysPerYear: string | null;
  isActive: boolean;
};
type Brief = { id: string; matricule: string; firstName: string; lastName: string };
type LeaveRow = {
  id: string;
  employeeId: string;
  employee: Brief;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  attachmentName: string | null;
  status: string;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};
type BalanceRow = {
  employee: Brief;
  balances: { leaveType: LeaveType; entitled: number; explicit: boolean; taken: number; pending: number; remaining: number }[];
};

export default function LeavePage() {
  const [tab, setTab] = useState<'requests' | 'balances'>('requests');
  return (
    <div className="space-y-4">
      <HrPageHeader title="العطل" fr="Congés" icon={CalendarOff} />
      <div className="flex gap-1 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-1">
        {(
          [
            ['requests', 'الطلبات · Demandes'],
            ['balances', 'الأرصدة · Soldes'],
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
      {tab === 'requests' ? <Requests /> : <Balances />}
    </div>
  );
}

function useLeaveTypes() {
  return useQuery({
    queryKey: ['hr', 'leave-types'],
    queryFn: async () => (await api.get<LeaveType[]>('/hr/leave-types')).data,
    staleTime: 60_000,
  });
}

function Requests() {
  const can = useCan();
  const [f, setF] = useState({ from: '', to: '', employeeId: '', status: '' });
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['hr', 'leave', f],
    queryFn: async () => (await api.get<LeaveRow[]>('/hr/leave', { params: rangeParams(f) })).data,
  });
  const rows = q.data ?? [];
  const manage = can('HR_LEAVE_MANAGE');
  const approve = can('HR_LEAVE_APPROVE');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <RequestFilters {...f} onChange={(p) => setF((s) => ({ ...s, ...p }))} />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                `conges-${todayKeyDz()}.csv`,
                toCsv(
                  ['Matricule', 'Employé', 'Type', 'Du', 'Au', 'Jours', 'Statut', 'Motif', 'Décidé par'],
                  rows.map((r) => [
                    r.employee.matricule,
                    fullName(r.employee),
                    r.leaveType.nameFr ?? r.leaveType.name,
                    r.startDate.slice(0, 10),
                    r.endDate.slice(0, 10),
                    toNum(r.days),
                    label.approval(r.status).fr,
                    r.reason ?? '',
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
              <Plus className="h-4 w-4" /> طلب عطلة
            </Button>
          ) : null}
        </div>
      </div>

      <QueryState q={q} empty={!rows.length} emptyText="لا توجد طلبات عطلة">
        <Table minWidth={980}>
          <thead>
            <tr>
              <Th>العامل</Th>
              <Th>النوع</Th>
              <Th>الفترة</Th>
              <Th>الأيام</Th>
              <Th>السبب</Th>
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <EmployeeCell e={r.employee} />
                </Td>
                <Td className="text-xs">
                  <p className="font-bold">{r.leaveType.name}</p>
                  <p className="text-[var(--app-text-dim)]">{r.leaveType.isPaid ? 'مدفوعة' : 'غير مدفوعة'}</p>
                </Td>
                <Td className="text-xs tabular-nums">
                  {fmtDay(r.startDate)} → {fmtDay(r.endDate)}
                </Td>
                <Td className="font-bold tabular-nums">{toNum(r.days)}</Td>
                <Td className="max-w-[16rem] text-xs">
                  {r.reason ?? '—'}
                  <div>
                    <AttachmentLink kind="leave" id={r.id} name={r.attachmentName} />
                  </div>
                </Td>
                <Td className="text-xs">
                  <StatusBadge l={label.approval(r.status)} />
                  {r.decidedByName ? <p className="mt-1 text-[var(--app-text-dim)]">{r.decidedByName}</p> : null}
                  {r.decisionNote ? <p className="text-[var(--app-text-dim)]">{r.decisionNote}</p> : null}
                </Td>
                <Td>
                  <DecisionButtons path={`/hr/leave/${r.id}/decision`} status={r.status} canApprove={approve} canCancel={manage} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <LeaveModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function LeaveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const types = useLeaveTypes();
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [attachment, setAttachment] = useState<{ data: string; name: string } | null>(null);
  const [approveNow, setApproveNow] = useState(false);

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post('/hr/leave', {
          employeeId,
          leaveTypeId,
          startDate,
          endDate,
          reason: reason.trim() || null,
          attachment: attachment?.data ?? null,
          attachmentName: attachment?.name ?? null,
          approveNow: approveNow || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم تسجيل طلب العطلة');
      qc.invalidateQueries({ queryKey: ['hr'] });
      setEmployeeId('');
      setStartDate('');
      setEndDate('');
      setReason('');
      setAttachment(null);
      setApproveNow(false);
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const ok = employeeId && leaveTypeId && startDate && endDate && endDate >= startDate;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="طلب عطلة · Demande de congé"
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
        <Select label="نوع العطلة · Type" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
          <option value="">— اختر —</option>
          {(types.data ?? [])
            .filter((t) => t.isActive)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.nameFr ? ` · ${t.nameFr}` : ''} {t.isPaid ? '' : '(غير مدفوعة)'}
              </option>
            ))}
        </Select>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="من · Du" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextInput
            label="إلى · Au"
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            hint={startDate && endDate && endDate >= startDate ? `${daysBetween(startDate, endDate) + 1} يوم تقويمي — تُحسب أيام العمل فقط` : undefined}
          />
        </div>
        <TextArea label="السبب · Motif" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <AttachmentInput value={attachment} onChange={setAttachment} />
        {can('HR_LEAVE_APPROVE') ? (
          <Check label="الموافقة مباشرة · Approuver directement" checked={approveNow} onChange={setApproveNow} />
        ) : (
          <Notice>سيبقى الطلب في الانتظار حتى يوافق عليه مسؤول لديه صلاحية الموافقة.</Notice>
        )}
      </div>
    </Modal>
  );
}

function Balances() {
  const can = useCan();
  const [year, setYear] = useState(Number(todayKeyDz().slice(0, 4)));
  const [employeeId, setEmployeeId] = useState('');
  const [editing, setEditing] = useState<{ employee: Brief; leaveType: LeaveType; days: number } | null>(null);
  const q = useQuery({
    queryKey: ['hr', 'leave-balances', year, employeeId],
    queryFn: async () => (await api.get<BalanceRow[]>('/hr/leave/balances', { params: { year, employeeId: employeeId || undefined } })).data,
  });
  const types = q.data?.[0]?.balances.map((b) => b.leaveType) ?? [];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput label="السنة · Année" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} allowAll includeLeft />
      </div>
      <Notice>
        الرصيد = الاستحقاق (المحدد للعامل أو الافتراضي لنوع العطلة) − العطل المصادق عليها. الطلبات المعلقة تظهر منفصلة. القانون لا يُفرض
        تلقائياً: حدد الاستحقاق حسب سياسة المؤسسة.
      </Notice>
      <QueryState q={q} empty={!q.data?.length || !types.length} emptyText="لا توجد أنواع عطل تُخصم من الرصيد أو لا يوجد عمال">
        <Table minWidth={320 + types.length * 220}>
          <thead>
            <tr>
              <Th>العامل</Th>
              {types.map((t) => (
                <Th key={t.id}>{t.name}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r) => (
              <tr key={r.employee.id}>
                <Td>
                  <EmployeeCell e={r.employee} />
                </Td>
                {r.balances.map((b) => (
                  <Td key={b.leaveType.id} className="text-xs">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-base font-black tabular-nums', b.remaining < 0 && 'text-red-600')}>{b.remaining}</span>
                      <span className="text-[var(--app-text-dim)]">
                        / {b.entitled}
                        {b.explicit ? '' : ' (افتراضي)'}
                      </span>
                      {can('HR_LEAVE_APPROVE') ? (
                        <button
                          type="button"
                          title="تعديل الاستحقاق"
                          onClick={() => setEditing({ employee: r.employee, leaveType: b.leaveType, days: b.entitled })}
                        >
                          <Pencil className="h-3.5 w-3.5 text-[var(--app-text-dim)]" />
                        </button>
                      ) : null}
                    </div>
                    <p className="text-[var(--app-text-dim)]">
                      مأخوذ {b.taken}
                      {b.pending ? ` · معلق ${b.pending}` : ''}
                    </p>
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <EntitlementModal target={editing} year={year} onClose={() => setEditing(null)} />
    </div>
  );
}

function EntitlementModal({
  target,
  year,
  onClose,
}: {
  target: { employee: Brief; leaveType: LeaveType; days: number } | null;
  year: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [days, setDays] = useState('');
  const [notes, setNotes] = useState('');
  const [seed, setSeed] = useState<unknown>(null);
  if (target && seed !== target) {
    setSeed(target);
    setDays(String(target.days));
    setNotes('');
  }
  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post('/hr/leave/entitlements', {
          employeeId: target!.employee.id,
          leaveTypeId: target!.leaveType.id,
          year,
          days: Number(days),
          notes: notes.trim() || null,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم حفظ الاستحقاق');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const n = Number(days);
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title="استحقاق العطلة · Droit au congé"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!(days !== '' && n >= 0 && n <= 366 && Math.round(n * 10) === n * 10)} loading={m.isPending} onClick={() => m.mutate()}>
            حفظ
          </Button>
        </>
      }
    >
      {target ? (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{fullName(target.employee)}</strong> — {target.leaveType.name} — {year}
          </p>
          <TextInput label="عدد الأيام · Jours" type="number" min={0} max={366} step="0.5" value={days} onChange={(e) => setDays(e.target.value)} dir="ltr" />
          <TextInput label="ملاحظة" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
        </div>
      ) : null}
    </Modal>
  );
}
