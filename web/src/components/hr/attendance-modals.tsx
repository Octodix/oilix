'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiError, Check, EmployeeSelect, Modal, Notice, Select, TextArea, TextInput } from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { fmtDay, timeDz, todayKeyDz } from '@/lib/hr-labels';

export type CorrectionTarget = {
  employeeId?: string;
  employeeName?: string;
  date?: string;
  firstIn?: string | null;
  lastOut?: string | null;
};

/**
 * Manual correction: never edits raw punches — it records an audited override that the
 * attendance engine applies on top of them (and that can be revoked later).
 */
export function CorrectionModal({
  target,
  onClose,
}: {
  target: CorrectionTarget | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [seed, setSeed] = useState<CorrectionTarget | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');

  if (target && seed !== target) {
    setSeed(target);
    setEmployeeId(target.employeeId ?? '');
    setDate(target.date ?? todayKeyDz());
    setCheckIn(target.firstIn ? timeDz(target.firstIn) : '');
    setCheckOut(target.lastOut ? timeDz(target.lastOut) : '');
    setStatus('');
    setReason('');
  }

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post('/hr/attendance/corrections', {
          employeeId,
          date,
          checkIn: checkIn || null,
          checkOut: checkOut || null,
          status: status || null,
          reason: reason.trim(),
        })
      ).data,
    onSuccess: () => {
      toast.success('تم تسجيل التصحيح (البصمات الأصلية لم تُعدَّل)');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const ok = employeeId && date && reason.trim().length >= 3 && (checkIn || checkOut || status);

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={`تصحيح الحضور · Correction${target?.employeeName ? ` — ${target.employeeName}` : ''}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>
            تسجيل التصحيح
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice>
          البصمات الخام القادمة من الجهاز لا تُعدَّل أبداً. التصحيح يُسجَّل منفصلاً مع السبب واسم المستخدم، ويمكن إلغاؤه لاحقاً.
          · Les pointages bruts ne sont jamais modifiés.
        </Notice>
        {target?.employeeId ? null : <EmployeeSelect value={employeeId} onChange={setEmployeeId} required />}
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput label="اليوم · Date" type="date" value={date} max={todayKeyDz()} onChange={(e) => setDate(e.target.value)} />
          <TextInput label="الدخول · Entrée" type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          <TextInput
            label="الخروج · Sortie"
            type="time"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            hint="إذا كان قبل الدخول يُعتبر في اليوم الموالي (مناوبة ليلية)"
          />
        </div>
        <Select label="فرض الحالة (اختياري) · Forcer le statut" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">— حسب البصمات —</option>
          <option value="PRESENT">حاضر (مثلاً: الجهاز كان معطلاً) · Présent</option>
          <option value="ABSENT">غائب · Absent</option>
          <option value="REST_DAY">يوم راحة · Repos</option>
        </Select>
        <TextArea
          label="السبب (إلزامي) · Motif"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          hint="مثال: نسي البصمة عند الخروج — أكد ذلك رئيس الورشة"
        />
      </div>
    </Modal>
  );
}

export type LateTarget = {
  dayId: string;
  employeeName: string;
  date: string;
  lateMinutes: number;
  lateJustified: boolean;
};

export function JustifyLateModal({ target, onClose }: { target: LateTarget | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [seed, setSeed] = useState<LateTarget | null>(null);
  const [justified, setJustified] = useState(true);
  const [reason, setReason] = useState('');
  if (target && seed !== target) {
    setSeed(target);
    setJustified(!target.lateJustified);
    setReason('');
  }

  const m = useMutation({
    mutationFn: async () =>
      (await api.post(`/hr/attendance/days/${target!.dayId}/justify-late`, { justified, reason: reason.trim() || null })).data,
    onSuccess: () => {
      toast.success(justified ? 'تم تبرير التأخر' : 'تم إلغاء التبرير');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title="تبرير التأخر · Justifier le retard"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={justified && reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>
            حفظ
          </Button>
        </>
      }
    >
      {target ? (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{target.employeeName}</strong> — {fmtDay(target.date)} — تأخر {target.lateMinutes} دقيقة
          </p>
          <Check
            label="تأخر مبرر (لا يُقتطع من الأجر) · Retard justifié"
            checked={justified}
            onChange={setJustified}
          />
          <TextArea
            label="السبب · Motif"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            hint={justified ? 'إلزامي عند التبرير' : 'اختياري'}
          />
        </div>
      ) : null}
    </Modal>
  );
}
