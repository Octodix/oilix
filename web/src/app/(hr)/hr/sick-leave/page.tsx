'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartPulse, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AttachmentInput, AttachmentLink, DecisionButtons, rangeParams, RequestFilters } from '@/components/hr/requests-ui';
import {
  apiError,
  Check,
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
import { fmtDay, label, SICK_TREATMENT, toNum } from '@/lib/hr-labels';

type SickRow = {
  id: string;
  employee: { id: string; matricule: string; firstName: string; lastName: string };
  startDate: string;
  endDate: string;
  days: number;
  certificateRef: string | null;
  doctorName: string | null;
  attachmentName: string | null;
  notes: string | null;
  status: string;
  payrollTreatment: string;
  paidPercent: string;
  createdByName: string | null;
  decidedByName: string | null;
};

export default function SickLeavePage() {
  const can = useCan();
  const [f, setF] = useState({ from: '', to: '', employeeId: '', status: '' });
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['hr', 'sick-leave', f],
    queryFn: async () => (await api.get<SickRow[]>('/hr/sick-leave', { params: rangeParams(f) })).data,
  });
  const rows = q.data ?? [];
  const manage = can('HR_LEAVE_MANAGE');

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="العطل المرضية"
        fr="Congés maladie"
        icon={HeartPulse}
        actions={
          manage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> عطلة مرضية
            </Button>
          ) : null
        }
      />
      <Notice>
        العطلة المرضية منفصلة عن الغياب: الأيام المعنية لا تُحسب غياباً. طريقة احتسابها في الأجر (غير مدفوعة / مدفوعة / نسبة) تُحدد لكل عطلة —
        تعويضات الضمان الاجتماعي (CNAS) لا تُحسب تلقائياً.
      </Notice>
      <RequestFilters {...f} onChange={(p) => setF((s) => ({ ...s, ...p }))} />
      <QueryState q={q} empty={!rows.length} emptyText="لا توجد عطل مرضية">
        <Table minWidth={980}>
          <thead>
            <tr>
              <Th>العامل</Th>
              <Th>الفترة</Th>
              <Th>الأيام</Th>
              <Th>الشهادة</Th>
              <Th>في الأجر</Th>
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
                <Td className="text-xs tabular-nums">
                  {fmtDay(r.startDate)} → {fmtDay(r.endDate)}
                </Td>
                <Td className="font-bold tabular-nums">{r.days}</Td>
                <Td className="max-w-[14rem] text-xs">
                  {r.certificateRef ?? '—'}
                  {r.doctorName ? <p className="text-[var(--app-text-dim)]">د. {r.doctorName}</p> : null}
                  <AttachmentLink kind="sick" id={r.id} name={r.attachmentName} />
                </Td>
                <Td className="text-xs">
                  {label.sick(r.payrollTreatment).ar}
                  {r.payrollTreatment === 'PARTIAL' ? ` ${toNum(r.paidPercent)}%` : ''}
                </Td>
                <Td className="text-xs">
                  <StatusBadge l={label.approval(r.status)} />
                  {r.decidedByName ? <p className="mt-1 text-[var(--app-text-dim)]">{r.decidedByName}</p> : null}
                </Td>
                <Td>
                  <DecisionButtons path={`/hr/sick-leave/${r.id}/decision`} status={r.status} canApprove={can('HR_LEAVE_APPROVE')} canCancel={manage} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <SickModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function SickModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['hr', 'settings'],
    queryFn: async () => (await api.get<{ sickLeave: { defaultTreatment: string; defaultPaidPercent: number } }>('/hr/settings')).data,
    enabled: open,
  });
  const [employeeId, setEmployeeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [certificateRef, setCertificateRef] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [notes, setNotes] = useState('');
  const [treatment, setTreatment] = useState('');
  const [paidPercent, setPaidPercent] = useState('');
  const [attachment, setAttachment] = useState<{ data: string; name: string } | null>(null);
  const [approveNow, setApproveNow] = useState(false);

  const effTreatment = treatment || settings.data?.sickLeave.defaultTreatment || 'UNPAID';
  const effPercent = paidPercent || String(settings.data?.sickLeave.defaultPaidPercent ?? 0);

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post('/hr/sick-leave', {
          employeeId,
          startDate,
          endDate,
          certificateRef: certificateRef.trim() || null,
          doctorName: doctorName.trim() || null,
          notes: notes.trim() || null,
          payrollTreatment: effTreatment,
          paidPercent: effTreatment === 'PARTIAL' ? Number(effPercent) : undefined,
          attachment: attachment?.data ?? null,
          attachmentName: attachment?.name ?? null,
          approveNow: approveNow || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم تسجيل العطلة المرضية');
      qc.invalidateQueries({ queryKey: ['hr'] });
      setEmployeeId('');
      setStartDate('');
      setEndDate('');
      setCertificateRef('');
      setDoctorName('');
      setNotes('');
      setTreatment('');
      setPaidPercent('');
      setAttachment(null);
      setApproveNow(false);
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const pctOk = effTreatment !== 'PARTIAL' || (Number(effPercent) >= 0 && Number(effPercent) <= 100);
  const ok = employeeId && startDate && endDate && endDate >= startDate && pctOk;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="عطلة مرضية · Congé maladie"
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
          <TextInput label="من · Du" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextInput label="إلى · Au" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          <TextInput label="رقم الشهادة الطبية · N° certificat" value={certificateRef} onChange={(e) => setCertificateRef(e.target.value)} maxLength={100} />
          <TextInput label="الطبيب · Médecin" value={doctorName} onChange={(e) => setDoctorName(e.target.value)} maxLength={100} />
          <Select label="في الأجر · Traitement paie" value={effTreatment} onChange={(e) => setTreatment(e.target.value)}>
            {Object.keys(SICK_TREATMENT).map((k) => (
              <option key={k} value={k}>
                {label.sick(k).ar} · {label.sick(k).fr}
              </option>
            ))}
          </Select>
          {effTreatment === 'PARTIAL' ? (
            <TextInput label="النسبة المدفوعة %" type="number" min={0} max={100} value={effPercent} onChange={(e) => setPaidPercent(e.target.value)} dir="ltr" />
          ) : null}
        </div>
        <TextArea label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        <AttachmentInput value={attachment} onChange={setAttachment} />
        {can('HR_LEAVE_APPROVE') ? (
          <Check label="الموافقة مباشرة · Approuver directement" checked={approveNow} onChange={setApproveNow} />
        ) : null}
      </div>
    </Modal>
  );
}
