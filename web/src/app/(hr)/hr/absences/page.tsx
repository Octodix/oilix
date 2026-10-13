'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { AttendanceDayRow } from '@/components/hr/attendance-table';
import { AttachmentInput, AttachmentLink, DecisionButtons, rangeParams, RequestFilters } from '@/components/hr/requests-ui';
import {
  apiError,
  Check,
  EmployeeCell,
  EmployeeSelect,
  HrPageHeader,
  Modal,
  Notice,
  Panel,
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
import { fmtDay, label, todayKeyDz, toNum, WEEKDAYS, weekdayOf } from '@/lib/hr-labels';

type AbsenceType = { id: string; code: string; name: string; nameFr: string | null; isPaid: boolean; isJustified: boolean; isActive: boolean };
type AbsenceRow = {
  id: string;
  employee: { id: string; matricule: string; firstName: string; lastName: string };
  absenceType: AbsenceType;
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  isPaid: boolean;
  attachmentName: string | null;
  status: string;
  createdByName: string | null;
  decidedByName: string | null;
};

type Prefill = { employeeId: string; date: string } | null;

export default function AbsencesPage() {
  const can = useCan();
  const today = todayKeyDz();
  const [f, setF] = useState({ from: '', to: '', employeeId: '', status: '' });
  const [creating, setCreating] = useState<{ open: boolean; prefill: Prefill }>({ open: false, prefill: null });
  const [absFrom, setAbsFrom] = useState(`${today.slice(0, 8)}01`);
  const [absTo, setAbsTo] = useState(today);
  const manage = can('HR_LEAVE_MANAGE');

  const q = useQuery({
    queryKey: ['hr', 'absences', f],
    queryFn: async () => (await api.get<AbsenceRow[]>('/hr/absences', { params: rangeParams(f) })).data,
  });
  const unjustified = useQuery({
    queryKey: ['hr', 'attendance-days', { from: absFrom, to: absTo, status: 'ABSENT' }],
    queryFn: async () =>
      (await api.get<AttendanceDayRow[]>('/hr/attendance/days', { params: { from: absFrom, to: absTo, status: 'ABSENT', refresh: true } })).data,
    enabled: can('HR_ATTENDANCE_VIEW') && !!absFrom && !!absTo && absFrom <= absTo,
  });
  const rows = q.data ?? [];

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="الغيابات"
        fr="Absences"
        icon={UserX}
        actions={
          manage ? (
            <Button size="sm" onClick={() => setCreating({ open: true, prefill: null })}>
              <Plus className="h-4 w-4" /> تسجيل غياب
            </Button>
          ) : null
        }
      />

      {can('HR_ATTENDANCE_VIEW') ? (
        <Panel
          title="غيابات غير مبررة (حسب البصمات) · Absences non justifiées"
          bodyClassName="p-0"
          action={
            <div className="flex items-center gap-2">
              <TextInput type="date" value={absFrom} onChange={(e) => setAbsFrom(e.target.value)} />
              <TextInput type="date" value={absTo} onChange={(e) => setAbsTo(e.target.value)} />
            </div>
          }
        >
          <QueryState q={unjustified} empty={!unjustified.data?.length} emptyText="لا توجد غيابات غير مبررة في هذه الفترة">
            <Table minWidth={640}>
              <thead>
                <tr>
                  <Th>اليوم</Th>
                  <Th>العامل</Th>
                  <Th>التوقيت</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {(unjustified.data ?? []).map((d) => {
                  const date = d.date.slice(0, 10);
                  return (
                    <tr key={d.id}>
                      <Td className="text-xs tabular-nums">
                        <span className="font-bold">{fmtDay(date)}</span> {WEEKDAYS[weekdayOf(date)].ar}
                      </Td>
                      <Td>
                        <EmployeeCell e={d.employee} />
                      </Td>
                      <Td className="text-xs">{d.scheduleName ?? '—'}</Td>
                      <Td>
                        {manage ? (
                          <Button size="sm" variant="outline" onClick={() => setCreating({ open: true, prefill: { employeeId: d.employeeId, date } })}>
                            تبرير / تسجيل
                          </Button>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </QueryState>
        </Panel>
      ) : null}

      <Panel title="الغيابات المسجلة · Absences déclarées">
        <div className="mb-3">
          <RequestFilters {...f} onChange={(p) => setF((s) => ({ ...s, ...p }))} />
        </div>
        <QueryState q={q} empty={!rows.length} emptyText="لا توجد غيابات مسجلة">
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
                    <p className="font-bold">{r.absenceType.name}</p>
                    <p className="text-[var(--app-text-dim)]">
                      {r.absenceType.isJustified ? 'مبرر' : 'غير مبرر'} · {r.isPaid ? 'مدفوع' : 'غير مدفوع'}
                    </p>
                  </Td>
                  <Td className="text-xs tabular-nums">
                    {fmtDay(r.startDate)} → {fmtDay(r.endDate)}
                  </Td>
                  <Td className="font-bold tabular-nums">{toNum(r.days)}</Td>
                  <Td className="max-w-[16rem] text-xs">
                    {r.reason ?? '—'}
                    <div>
                      <AttachmentLink kind="absence" id={r.id} name={r.attachmentName} />
                    </div>
                  </Td>
                  <Td className="text-xs">
                    <StatusBadge l={label.approval(r.status)} />
                    {r.decidedByName ? <p className="mt-1 text-[var(--app-text-dim)]">{r.decidedByName}</p> : null}
                  </Td>
                  <Td>
                    <DecisionButtons path={`/hr/absences/${r.id}/decision`} status={r.status} canApprove={can('HR_LEAVE_APPROVE')} canCancel={manage} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </QueryState>
      </Panel>

      <AbsenceModal state={creating} onClose={() => setCreating({ open: false, prefill: null })} />
    </div>
  );
}

function AbsenceModal({ state, onClose }: { state: { open: boolean; prefill: Prefill }; onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: ['hr', 'absence-types'],
    queryFn: async () => (await api.get<AbsenceType[]>('/hr/absence-types')).data,
    enabled: state.open,
  });
  const [seed, setSeed] = useState<unknown>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [absenceTypeId, setAbsenceTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [attachment, setAttachment] = useState<{ data: string; name: string } | null>(null);
  const [approveNow, setApproveNow] = useState(false);

  if (state.open && seed !== state) {
    setSeed(state);
    setEmployeeId(state.prefill?.employeeId ?? '');
    setStartDate(state.prefill?.date ?? '');
    setEndDate(state.prefill?.date ?? '');
    setReason('');
    setIsPaid(null);
    setAttachment(null);
    setApproveNow(false);
  }

  const type = types.data?.find((t) => t.id === absenceTypeId);
  const paid = isPaid ?? type?.isPaid ?? false;

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post('/hr/absences', {
          employeeId,
          absenceTypeId,
          startDate,
          endDate,
          reason: reason.trim() || null,
          isPaid: paid,
          attachment: attachment?.data ?? null,
          attachmentName: attachment?.name ?? null,
          approveNow: approveNow || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم تسجيل الغياب');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const ok = employeeId && absenceTypeId && startDate && endDate && endDate >= startDate;
  return (
    <Modal
      open={state.open}
      onClose={onClose}
      title="تسجيل غياب · Déclarer une absence"
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
        {state.prefill ? (
          <Notice>
            تسجيل غياب مبرر يُغيّر حالة اليوم من «غائب» إلى «غياب مرخص» بعد الموافقة — البصمات الخام لا تتغير.
          </Notice>
        ) : null}
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} required />
        <Select
          label="نوع الغياب · Type"
          value={absenceTypeId}
          onChange={(e) => {
            setAbsenceTypeId(e.target.value);
            setIsPaid(null);
          }}
        >
          <option value="">— اختر —</option>
          {(types.data ?? [])
            .filter((t) => t.isActive)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.nameFr ? ` · ${t.nameFr}` : ''}
              </option>
            ))}
        </Select>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="من · Du" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextInput label="إلى · Au" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <Check label="مدفوع (لا يُقتطع من الأجر) · Payée" checked={paid} onChange={setIsPaid} hint={type ? `الافتراضي لهذا النوع: ${type.isPaid ? 'مدفوع' : 'غير مدفوع'}` : undefined} />
        <TextArea label="السبب · Motif" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <AttachmentInput value={attachment} onChange={setAttachment} />
        {can('HR_LEAVE_APPROVE') ? (
          <Check label="الموافقة مباشرة · Approuver directement" checked={approveNow} onChange={setApproveNow} />
        ) : null}
      </div>
    </Modal>
  );
}
