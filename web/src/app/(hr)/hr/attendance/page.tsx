'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Download, RefreshCw, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CorrectionModal, JustifyLateModal, type CorrectionTarget, type LateTarget } from '@/components/hr/attendance-modals';
import { AttendanceTable, type AttendanceDayRow } from '@/components/hr/attendance-table';
import {
  apiError,
  Check,
  DepartmentSelect,
  downloadCsv,
  EmployeeSelect,
  HrPageHeader,
  LoadingState,
  Notice,
  QueryState,
  Select,
  StatCard,
  TextInput,
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { addDays, ATTENDANCE_STATUS, daysBetween, fmtMinutes, fullName, label, timeDz, todayKeyDz, toCsv } from '@/lib/hr-labels';

export default function AttendancePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AttendanceInner />
    </Suspense>
  );
}

function AttendanceInner() {
  const sp = useSearchParams();
  const can = useCan();
  const qc = useQueryClient();
  const today = todayKeyDz();
  const reviewFromLink = sp.get('needsReview') === '1';
  const [from, setFrom] = useState(reviewFromLink ? addDays(today, -62) : `${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState(sp.get('employeeId') ?? '');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [needsReview, setNeedsReview] = useState(reviewFromLink);
  const [correcting, setCorrecting] = useState<CorrectionTarget | null>(null);
  const [justifying, setJustifying] = useState<LateTarget | null>(null);

  const rangeOk = !!from && !!to && from <= to && daysBetween(from, to) <= 400;
  const q = useQuery({
    queryKey: ['hr', 'attendance-days', { from, to, employeeId, departmentId, status, needsReview }],
    queryFn: async () =>
      (
        await api.get<AttendanceDayRow[]>('/hr/attendance/days', {
          params: {
            from,
            to,
            employeeId: employeeId || undefined,
            departmentId: departmentId || undefined,
            status: status || undefined,
            needsReview: needsReview || undefined,
            refresh: daysBetween(from, to) <= 62 ? true : undefined,
          },
        })
      ).data,
    enabled: rangeOk,
  });

  const reprocess = useMutation({
    mutationFn: async () =>
      (await api.post<{ changed: number }>('/hr/attendance/reprocess', { from, to: to > today ? today : to, employeeId: employeeId || undefined })).data,
    onSuccess: (r) => {
      toast.success(`تمت إعادة المعالجة — ${r.changed} يوم تغيّر`);
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const stats = useMemo(() => {
    const s = { present: 0, late: 0, absent: 0, missing: 0, worked: 0, overtime: 0 };
    for (const d of rows) {
      if (d.status === 'PRESENT' || d.status === 'LATE') s.present++;
      if (d.isLate) s.late++;
      if (d.status === 'ABSENT') s.absent++;
      if (d.status === 'MISSING_PUNCH') s.missing++;
      s.worked += d.workedMinutes;
      s.overtime += d.overtimeMinutes;
    }
    return s;
  }, [rows]);

  const correct = can('HR_ATTENDANCE_CORRECT');

  function exportCsv() {
    downloadCsv(
      `presence-${from}_${to}.csv`,
      toCsv(
        ['Date', 'Matricule', 'Employé', 'Statut', 'Horaire', 'Entrée', 'Sortie', 'Travaillé (min)', 'Retard (min)', 'Retard justifié', 'Heures sup (min)', 'Pointages', 'À revoir', 'Corrigé'],
        rows.map((d) => [
          d.date.slice(0, 10),
          d.employee.matricule,
          fullName(d.employee),
          label.attendance(d.status).fr,
          d.scheduledStart ? `${timeDz(d.scheduledStart)}-${timeDz(d.scheduledEnd)}` : '',
          timeDz(d.firstIn),
          timeDz(d.lastOut),
          d.workedMinutes,
          d.lateMinutes,
          d.lateJustified ? 'oui' : '',
          d.overtimeMinutes,
          d.punchCount,
          d.needsReview ? 'oui' : '',
          d.isCorrected ? 'oui' : '',
        ]),
      ),
    );
  }

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="الحضور"
        fr="Présence"
        icon={ClipboardCheck}
        subtitle="محسوب من البصمات الخام + التصحيحات المسجلة · Calculé à partir des pointages bruts"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            {correct ? (
              <>
                <Button size="sm" variant="outline" loading={reprocess.isPending} disabled={!rangeOk} onClick={() => reprocess.mutate()}>
                  <RefreshCw className="h-4 w-4" /> إعادة المعالجة
                </Button>
                <Button size="sm" onClick={() => setCorrecting({})}>
                  <Wrench className="h-4 w-4" /> تصحيح
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <TextInput label="من · Du" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextInput label="إلى · Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} allowAll includeLeft />
        <DepartmentSelect value={departmentId} onChange={setDepartmentId} />
        <Select label="الحالة · Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">الكل</option>
          {Object.keys(ATTENDANCE_STATUS)
            .filter((k) => k !== 'NOT_EMPLOYED')
            .map((k) => (
              <option key={k} value={k}>
                {label.attendance(k).ar} · {label.attendance(k).fr}
              </option>
            ))}
        </Select>
        <div className="flex items-end pb-2">
          <Check label="تحتاج مراجعة فقط · À revoir" checked={needsReview} onChange={setNeedsReview} />
        </div>
      </div>
      {!rangeOk ? <Notice tone="warning">المدى غير صالح (400 يوم كحد أقصى).</Notice> : null}

      {q.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="أيام حضور" value={stats.present} tone="success" />
          <StatCard label="تأخرات" value={stats.late} tone={stats.late ? 'warning' : 'default'} />
          <StatCard label="غيابات" value={stats.absent} tone={stats.absent ? 'danger' : 'default'} />
          <StatCard label="بصمة ناقصة" value={stats.missing} tone={stats.missing ? 'warning' : 'default'} />
          <StatCard label="ساعات العمل" value={fmtMinutes(stats.worked)} />
          <StatCard label="إضافي محسوب" value={fmtMinutes(stats.overtime)} tone="primary" hint="يحتاج موافقة قبل الدفع" />
        </div>
      ) : null}

      <QueryState
        q={q}
        empty={rows.length === 0}
        emptyText="لا توجد أيام في هذا المدى"
        emptyHint="تأكد من وجود عمال لديهم عقد وتوقيت، وأن البصمات وصلت من الجهاز."
      >
        <AttendanceTable rows={rows} canCorrect={correct} onCorrect={setCorrecting} onJustify={setJustifying} today={today} />
        {rows.length >= 3000 ? <Notice tone="warning">تم عرض أول 3000 سطر فقط — ضيّق المدى أو الفلاتر.</Notice> : null}
      </QueryState>

      <CorrectionModal target={correcting} onClose={() => setCorrecting(null)} />
      <JustifyLateModal target={justifying} onClose={() => setJustifying(null)} />
    </div>
  );
}
