'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  apiError,
  DepartmentSelect,
  EmployeeSelect,
  Modal,
  Notice,
  Select,
  TextArea,
  TextInput,
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { CONTRACT_TYPE, label, SALARY_MODE, todayKeyDz } from '@/lib/hr-labels';

export type Contract = {
  id: string;
  employeeId: string;
  contractType: string;
  startDate: string;
  endDate: string | null;
  trialEndDate: string | null;
  salaryMode: string;
  baseSalary: number | null;
  weeklyHours: number;
  jobTitle: string | null;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  status: string;
  terminatedAt: string | null;
  terminationReason: string | null;
  documentRef: string | null;
  notes: string | null;
  createdByName?: string | null;
  employee?: { id: string; matricule: string; firstName: string; lastName: string; status: string };
};

type Form = {
  employeeId: string;
  contractType: string;
  startDate: string;
  endDate: string;
  trialEndDate: string;
  salaryMode: string;
  baseSalary: string;
  weeklyHours: string;
  jobTitle: string;
  departmentId: string;
  documentRef: string;
  notes: string;
};

function toForm(c?: Contract | null, employeeId?: string): Form {
  return {
    employeeId: c?.employeeId ?? employeeId ?? '',
    contractType: c?.contractType ?? 'CDI',
    startDate: c?.startDate ?? todayKeyDz(),
    endDate: c?.endDate ?? '',
    trialEndDate: c?.trialEndDate ?? '',
    salaryMode: c?.salaryMode ?? 'MONTHLY',
    baseSalary: c?.baseSalary != null ? String(c.baseSalary) : '',
    weeklyHours: c ? String(c.weeklyHours) : '40',
    jobTitle: c?.jobTitle ?? '',
    departmentId: c?.departmentId ?? '',
    documentRef: c?.documentRef ?? '',
    notes: c?.notes ?? '',
  };
}

export function ContractFormModal({
  open,
  onClose,
  contract,
  employeeId,
}: {
  open: boolean;
  onClose: () => void;
  contract?: Contract | null;
  employeeId?: string;
}) {
  const qc = useQueryClient();
  const can = useCan();
  const editing = !!contract;
  const [f, setF] = useState<Form>(() => toForm(contract, employeeId));
  const [seed, setSeed] = useState('');
  const key = `${contract?.id ?? 'new'}:${employeeId ?? ''}:${open}`;
  if (open && seed !== key) {
    setSeed(key);
    setF(toForm(contract, employeeId));
  }
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const canSalary = can('HR_SALARIES_EDIT');

  const m = useMutation({
    mutationFn: async () => {
      const full: Record<string, unknown> = {
        contractType: f.contractType,
        startDate: f.startDate,
        endDate: f.endDate || null,
        trialEndDate: f.trialEndDate || null,
        salaryMode: f.salaryMode,
        weeklyHours: Number(f.weeklyHours),
        baseSalary: Number(f.baseSalary),
        jobTitle: f.jobTitle.trim() || null,
        departmentId: f.departmentId || null,
        documentRef: f.documentRef.trim() || null,
        notes: f.notes.trim() || null,
      };
      if (!editing) return (await api.post('/hr/contracts', { ...full, employeeId: f.employeeId })).data;
      // Pay-affecting fields are permission- and payslip-lock-checked even when unchanged.
      const before = toForm(contract);
      const body: Record<string, unknown> = {};
      for (const k of Object.keys(full)) {
        if (k === 'baseSalary' && !can('HR_SALARIES_EDIT')) continue;
        if (f[k as keyof Form] !== before[k as keyof Form]) body[k] = full[k];
      }
      if (!Object.keys(body).length) return contract;
      return (await api.patch(`/hr/contracts/${contract!.id}`, body)).data;
    },
    onSuccess: () => {
      toast.success(editing ? 'تم تعديل العقد' : 'تم إنشاء العقد');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const salaryOk = editing && !canSalary ? true : Number(f.baseSalary) > 0;
  const ok = (editing || canSalary) && f.employeeId && f.startDate && salaryOk && Number(f.weeklyHours) >= 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? 'تعديل العقد · Modifier le contrat' : 'عقد جديد · Nouveau contrat'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!editing ? (
          <Notice>
            إنشاء عقد جديد يُنهي العقد الساري السابق تلقائياً في اليوم السابق لبدايته. العقود المرتبطة بكشف أجر مصادق عليه لا تُعدَّل.
          </Notice>
        ) : null}
        {!canSalary ? (
          <Notice tone="warning">
            {editing
              ? 'الأجر ونمطه وساعات العمل وتاريخ البداية تتطلب صلاحية «تعديل الأجور».'
              : 'إنشاء عقد يتطلب صلاحية «تعديل الأجور» لأنه يحدد الأجر.'}
          </Notice>
        ) : null}
        {!employeeId && !editing ? <EmployeeSelect value={f.employeeId} onChange={(v) => setF((s) => ({ ...s, employeeId: v }))} required /> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="نوع العقد · Type" value={f.contractType} onChange={set('contractType')}>
            {Object.keys(CONTRACT_TYPE).map((t) => (
              <option key={t} value={t}>
                {label.contractType(t).fr} · {label.contractType(t).ar}
              </option>
            ))}
          </Select>
          <TextInput label="البداية · Début *" type="date" value={f.startDate} onChange={set('startDate')} disabled={!canSalary} />
          <TextInput label="النهاية · Fin" type="date" value={f.endDate} onChange={set('endDate')} hint="فارغ = غير محدد المدة" />
          <TextInput label="نهاية التجربة · Fin d'essai" type="date" value={f.trialEndDate} onChange={set('trialEndDate')} />
          <Select label="نمط الأجر · Mode de salaire" value={f.salaryMode} onChange={set('salaryMode')} disabled={!canSalary}>
            {Object.keys(SALARY_MODE).map((s) => (
              <option key={s} value={s}>
                {label.salaryMode(s).ar} · {label.salaryMode(s).fr}
              </option>
            ))}
          </Select>
          <TextInput
            label={`الأجر الأساسي (${f.salaryMode === 'MONTHLY' ? 'شهري' : f.salaryMode === 'DAILY' ? 'لليوم' : 'للساعة'}) · Salaire de base *`}
            type="number"
            min={0.01}
            step="0.01"
            value={f.baseSalary}
            onChange={set('baseSalary')}
            disabled={!canSalary}
            placeholder={!canSalary ? '••••' : ''}
            dir="ltr"
          />
          <TextInput
            label="ساعات أسبوعية · Heures/semaine"
            type="number"
            min={1}
            max={84}
            step="0.5"
            value={f.weeklyHours}
            onChange={set('weeklyHours')}
            disabled={!canSalary}
            dir="ltr"
          />
          <TextInput label="المنصب · Poste" value={f.jobTitle} onChange={set('jobTitle')} maxLength={100} />
          <DepartmentSelect value={f.departmentId} onChange={(v) => setF((s) => ({ ...s, departmentId: v }))} allowAll={false} />
          <TextInput label="مرجع الوثيقة · Réf. document" value={f.documentRef} onChange={set('documentRef')} maxLength={100} />
        </div>
        <TextArea label="ملاحظات · Notes" value={f.notes} onChange={set('notes')} maxLength={1000} />
      </div>
    </Modal>
  );
}

export function TerminateContractModal({ contract, onClose }: { contract: Contract | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [endDate, setEndDate] = useState(todayKeyDz());
  const [reason, setReason] = useState('');
  const [seed, setSeed] = useState<Contract | null>(null);
  if (contract && seed !== contract) {
    setSeed(contract);
    setEndDate(todayKeyDz());
    setReason('');
  }
  const m = useMutation({
    mutationFn: async () => (await api.post(`/hr/contracts/${contract!.id}/terminate`, { endDate, reason: reason.trim() })).data,
    onSuccess: () => {
      toast.success('تم فسخ العقد');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal
      open={!!contract}
      onClose={onClose}
      title="فسخ العقد · Résilier le contrat"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 3 || !endDate} loading={m.isPending} onClick={() => m.mutate()}>
            فسخ
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextInput label="تاريخ النهاية · Date de fin" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <TextArea label="السبب (إلزامي) · Motif" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>
    </Modal>
  );
}
