'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CorrectionModal, JustifyLateModal, type CorrectionTarget, type LateTarget } from '@/components/hr/attendance-modals';
import { AttendanceTable, type AttendanceDayRow } from '@/components/hr/attendance-table';
import {
  DepartmentSelect,
  downloadCsv,
  EmployeeCell,
  EmployeeSelect,
  HrPageHeader,
  Notice,
  Panel,
  QueryState,
  Table,
  Td,
  TextInput,
  Th,
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { daysBetween, fmtMinutes, fullName, todayKeyDz, toCsv } from '@/lib/hr-labels';

type Settings = { attendance: { lateGraceMinutes: number; lateChargeMode: string }; payroll: { lateDeductionMode: string } };

export default function LatesPage() {
  const can = useCan();
  const today = todayKeyDz();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [correcting, setCorrecting] = useState<CorrectionTarget | null>(null);
  const [justifying, setJustifying] = useState<LateTarget | null>(null);
  const rangeOk = !!from && !!to && from <= to && daysBetween(from, to) <= 400;

  const settings = useQuery({
    queryKey: ['hr', 'settings'],
    queryFn: async () => (await api.get<Settings>('/hr/settings')).data,
  });

  const q = useQuery({
    queryKey: ['hr', 'attendance-days', { from, to, employeeId, departmentId, lateOnly: true }],
    queryFn: async () =>
      (
        await api.get<AttendanceDayRow[]>('/hr/attendance/days', {
          params: {
            from,
            to,
            employeeId: employeeId || undefined,
            departmentId: departmentId || undefined,
            lateOnly: true,
            refresh: daysBetween(from, to) <= 62 ? true : undefined,
          },
        })
      ).data,
    enabled: rangeOk,
  });

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const byEmployee = useMemo(() => {
    const m = new Map<string, { employee: AttendanceDayRow['employee']; count: number; minutes: number; chargeable: number; justified: number }>();
    for (const d of rows) {
      const r = m.get(d.employeeId) ?? { employee: d.employee, count: 0, minutes: 0, chargeable: 0, justified: 0 };
      r.count++;
      r.minutes += d.lateMinutes;
      if (d.lateJustified) r.justified++;
      else r.chargeable += d.chargeableLateMinutes;
      m.set(d.employeeId, r);
    }
    return [...m.values()].sort((a, b) => b.minutes - a.minutes);
  }, [rows]);

  const s = settings.data;

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="التأخرات"
        fr="Retards"
        icon={AlarmClock}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                `retards-${from}_${to}.csv`,
                toCsv(
                  ['Matricule', 'Employé', 'Retards', 'Minutes', 'Justifiés', 'Minutes retenues'],
                  byEmployee.map((r) => [r.employee.matricule, fullName(r.employee), r.count, r.minutes, r.justified, r.chargeable]),
                ),
              )
            }
          >
            <Download className="h-4 w-4" /> CSV
          </Button>
        }
      />
      {s ? (
        <Notice>
          سماح التأخر: {s.attendance.lateGraceMinutes} دقيقة ({s.attendance.lateChargeMode === 'AFTER_GRACE' ? 'تُحسب الدقائق بعد السماح فقط' : 'عند التجاوز تُحسب كل الدقائق'}) — الاقتطاع من الأجر:{' '}
          {s.payroll.lateDeductionMode === 'NONE'
            ? 'معطل'
            : s.payroll.lateDeductionMode === 'PER_MINUTE'
              ? 'بالدقيقة (حسب الأجر الساعي)'
              : 'مبلغ ثابت لكل تأخر'}
          . التأخر المبرر لا يُقتطع. (الإعدادات ← سياسة الحضور)
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <TextInput label="من · Du" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextInput label="إلى · Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} allowAll includeLeft />
        <DepartmentSelect value={departmentId} onChange={setDepartmentId} />
      </div>

      <QueryState q={q} empty={rows.length === 0} emptyText="لا توجد تأخرات في هذا المدى">
        <Panel title="حسب العامل · Par employé" bodyClassName="p-0">
          <Table minWidth={640}>
            <thead>
              <tr>
                <Th>العامل</Th>
                <Th>عدد التأخرات</Th>
                <Th>مجموع الدقائق</Th>
                <Th>مبررة</Th>
                <Th>دقائق قابلة للاقتطاع</Th>
              </tr>
            </thead>
            <tbody>
              {byEmployee.map((r) => (
                <tr key={r.employee.id}>
                  <Td>
                    <EmployeeCell e={r.employee} />
                  </Td>
                  <Td className="font-bold tabular-nums">{r.count}</Td>
                  <Td className="tabular-nums">{fmtMinutes(r.minutes)}</Td>
                  <Td className="tabular-nums">{r.justified}</Td>
                  <Td className="font-bold tabular-nums text-amber-700 dark:text-amber-400">{fmtMinutes(r.chargeable)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        <AttendanceTable rows={rows} canCorrect={can('HR_ATTENDANCE_CORRECT')} onCorrect={setCorrecting} onJustify={setJustifying} today={today} lateFocus />
      </QueryState>

      <CorrectionModal target={correcting} onClose={() => setCorrecting(null)} />
      <JustifyLateModal target={justifying} onClose={() => setJustifying(null)} />
    </div>
  );
}
