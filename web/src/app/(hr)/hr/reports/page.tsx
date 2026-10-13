'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, ExternalLink, Printer, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DepartmentSelect,
  downloadCsv,
  EmployeeCell,
  EmployeeSelect,
  HrPageHeader,
  money,
  MonthInput,
  Panel,
  QueryState,
  StatCard,
  Table,
  Td,
  TextInput,
  Th,
  useCan,
} from '@/components/hr/hr-ui';
import { HR_ATTENDANCE_REPORT_API, reportTotals, type HrAttendanceReport } from '@/components/print/hr-attendance-report-document';
import { useDirectPrint } from '@/hooks/use-direct-print';
import { api } from '@/lib/api';
import { daysBetween, fmtMinutes, label, monthRange, shiftMonth, todayKeyDz, toCsv } from '@/lib/hr-labels';
import { hrAttendanceReportRequest } from '@/lib/print-documents';

type ExpenseSummary = { lines: { key: string; label: string; amount: number; count: number }[]; total: number; note: string };

const LINKS: { href: string; t: string; perm: string }[] = [
  { href: '/hr/payroll', t: 'الأجور وكشوف الأجر (CSV لكل شهر) · Paie', perm: 'HR_PAYROLL_VIEW' },
  { href: '/hr/payments', t: 'دفعات الأجور · Paiements', perm: 'HR_PAYROLL_VIEW' },
  { href: '/hr/leave', t: 'أرصدة العطل · Soldes de congés', perm: 'HR_LEAVE_MANAGE' },
  { href: '/hr/sick-leave', t: 'العطل المرضية · Maladie', perm: 'HR_ATTENDANCE_VIEW' },
  { href: '/hr/absences', t: 'الغيابات · Absences', perm: 'HR_ATTENDANCE_VIEW' },
  { href: '/hr/lates', t: 'التأخرات · Retards', perm: 'HR_ATTENDANCE_VIEW' },
  { href: '/hr/overtime', t: 'الساعات الإضافية · Heures sup.', perm: 'HR_ATTENDANCE_VIEW' },
  { href: '/hr/advances', t: 'التسبيقات والقروض · Avances', perm: 'HR_ADVANCES_MANAGE' },
  { href: '/hr/bonuses', t: 'المنح · Primes', perm: 'HR_BONUSES_MANAGE' },
  { href: '/hr/deductions', t: 'الاقتطاعات · Retenues', perm: 'HR_DEDUCTIONS_MANAGE' },
  { href: '/hr/expenses', t: 'مصاريف العمال · Dépenses RH', perm: 'HR_EXPENSES_VIEW' },
];

export default function ReportsPage() {
  const can = useCan();
  const today = todayKeyDz();
  const prev = shiftMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)), -1);
  const initial = monthRange(prev.year, prev.month);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [departmentId, setDepartmentId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const rangeOk = !!from && !!to && from <= to && daysBetween(from, to) <= 366;
  const { print, busy, settings } = useDirectPrint();

  const params = { from, to, ...(departmentId ? { departmentId } : {}), ...(employeeId ? { employeeId } : {}) };
  const q = useQuery({
    queryKey: ['hr', 'report-attendance', params],
    enabled: rangeOk,
    queryFn: async () =>
      (await api.get<HrAttendanceReport>(HR_ATTENDANCE_REPORT_API, { params: { ...params, refresh: daysBetween(from, to) <= 62 } })).data,
  });
  const expQ = useQuery({
    queryKey: ['hr', 'expenses-summary', from, to],
    enabled: rangeOk && can('HR_EXPENSES_VIEW'),
    queryFn: async () => (await api.get<ExpenseSummary>('/hr/reports/expenses', { params: { from, to } })).data,
  });

  const data = q.data;
  const t = data ? reportTotals(data.rows) : null;

  function exportCsv() {
    if (!data) return;
    downloadCsv(
      `presence-${from}_${to}.csv`,
      toCsv(
        ['Matricule', 'Employé', 'Service', 'Jours prévus', 'Présents', 'Absences', 'Abs. autorisées', 'Congés', 'Congés sans solde', 'Maladie', 'Fériés', 'Retards', 'Minutes retard', 'Pointages incomplets', 'Minutes travaillées', 'Minutes prévues', 'HS approuvées (min)', 'HS en attente (min)'],
        data.rows.map((r) => [
          r.employee.matricule,
          r.employee.fullName,
          r.employee.department?.name ?? '',
          r.summary.employedWorkingDays,
          r.summary.presentDays,
          r.summary.absentDays,
          r.summary.authorizedAbsenceDays,
          r.summary.leaveDays,
          r.summary.unpaidLeaveDays,
          r.summary.sickDays,
          r.summary.holidayDays,
          r.summary.lateCount,
          r.summary.lateMinutes,
          r.summary.missingPunchDays,
          r.summary.workedMinutes,
          r.summary.expectedMinutes,
          r.summary.overtimeApprovedMinutes,
          r.summary.overtimePendingMinutes,
        ]),
      ),
    );
  }
  const printUrl = `/hr-attendance-report?${new URLSearchParams({ ...params, print: '1' }).toString()}`;

  return (
    <div className="space-y-4">
      <HrPageHeader title="التقارير" fr="Rapports RH" icon={BarChart3} subtitle="تقرير الحضور لا يحتوي على أي معلومة عن الأجور." />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MonthInput
            year={Number(from.slice(0, 4)) || prev.year}
            month={Number(from.slice(5, 7)) || prev.month}
            onChange={(y, m) => {
              const r = monthRange(y, m);
              setFrom(r.from);
              setTo(r.to);
            }}
          />
          <TextInput label="من" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextInput label="إلى" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <DepartmentSelect value={departmentId} onChange={setDepartmentId} />
          <EmployeeSelect value={employeeId} onChange={setEmployeeId} allowAll includeLeft />
        </div>
        {!rangeOk ? <p className="mt-2 text-xs text-red-600">نطاق غير صالح (366 يوماً كحد أقصى)</p> : null}
      </Panel>

      <Panel
        title="الحضور · Présence"
        bodyClassName="p-0"
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!data?.rows.length} onClick={exportCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            {settings.directPrinting && settings.documentPrinter ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!data?.rows.length}
                loading={busy}
                onClick={() => data && void print(hrAttendanceReportRequest(data), { browserFallback: () => window.open(printUrl, '_blank', 'noopener'), successMessage: 'تم إرسال التقرير للطابعة' })}
              >
                <Send className="h-4 w-4" /> طباعة مباشرة
              </Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={!data?.rows.length} onClick={() => window.open(printUrl, '_blank', 'noopener')}>
              <Printer className="h-4 w-4" /> طباعة A4
            </Button>
          </div>
        }
      >
        <QueryState q={q} empty={!data?.rows.length} emptyText="لا يوجد عمال في هذه الفترة">
          {data && t ? (
            <>
              <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-6">
                <StatCard label="حضور (أيام)" value={t.presentDays} tone="success" />
                <StatCard label="غياب غير مبرر" value={t.absentDays} tone={t.absentDays ? 'danger' : 'default'} />
                <StatCard label="عطل + مرض" value={t.leaveDays + t.sickDays} />
                <StatCard label="تأخرات" value={`${t.lateCount} · ${fmtMinutes(t.lateMinutes)}`} tone={t.lateCount ? 'warning' : 'default'} />
                <StatCard label="بصمة ناقصة" value={t.missingPunchDays} tone={t.missingPunchDays ? 'warning' : 'default'} />
                <StatCard label="إضافية مقبولة" value={fmtMinutes(t.overtimeApprovedMinutes)} hint={t.overtimePendingMinutes ? `${fmtMinutes(t.overtimePendingMinutes)} معلقة` : undefined} />
              </div>
              <Table minWidth={1200}>
                <thead>
                  <tr>
                    <Th>العامل</Th>
                    <Th>أيام العمل</Th>
                    <Th>حضور</Th>
                    <Th>غياب</Th>
                    <Th>غ. مرخص</Th>
                    <Th>عطلة</Th>
                    <Th>مرض</Th>
                    <Th>تأخرات</Th>
                    <Th>بصمة ناقصة</Th>
                    <Th>ساعات العمل</Th>
                    <Th>إضافية</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.employee.id} className="hover:bg-[var(--app-bg-muted)]">
                      <Td>
                        <Link href={`/hr/attendance?employeeId=${r.employee.id}`} className="hover:underline">
                          <EmployeeCell e={{ ...r.employee, firstName: r.employee.fullName, lastName: '' }} sub={r.employee.department?.name} />
                        </Link>
                      </Td>
                      <Td className="tabular-nums">{r.summary.employedWorkingDays}</Td>
                      <Td className="tabular-nums">{r.summary.presentDays}</Td>
                      <Td className={`tabular-nums ${r.summary.absentDays ? 'font-bold text-red-600' : ''}`}>{r.summary.absentDays}</Td>
                      <Td className="tabular-nums">{r.summary.authorizedAbsenceDays}</Td>
                      <Td className="tabular-nums">
                        {r.summary.leaveDays}
                        {r.summary.unpaidLeaveDays ? <span className="text-[11px]"> ({r.summary.unpaidLeaveDays} ب.أ)</span> : null}
                      </Td>
                      <Td className="tabular-nums">{r.summary.sickDays}</Td>
                      <Td className="tabular-nums">
                        {r.summary.lateCount ? `${r.summary.lateCount} · ${fmtMinutes(r.summary.lateMinutes)}` : '—'}
                      </Td>
                      <Td className={`tabular-nums ${r.summary.missingPunchDays ? 'font-bold text-orange-600' : ''}`}>{r.summary.missingPunchDays}</Td>
                      <Td className="tabular-nums">
                        {fmtMinutes(r.summary.workedMinutes)} / {fmtMinutes(r.summary.expectedMinutes)}
                      </Td>
                      <Td className="tabular-nums">
                        {fmtMinutes(r.summary.overtimeApprovedMinutes)}
                        {r.summary.overtimePendingMinutes ? <p className="text-[11px] text-amber-700">+{fmtMinutes(r.summary.overtimePendingMinutes)} معلقة</p> : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          ) : null}
        </QueryState>
      </Panel>

      {can('HR_EXPENSES_VIEW') ? (
        <Panel title="تكلفة المستخدمين المدفوعة فعلاً · Coût du personnel décaissé">
          <QueryState q={expQ}>
            {expQ.data ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {expQ.data.lines.map((l) => (
                    <StatCard key={l.key} label={`${label.expense(l.key).ar} (${l.count})`} value={money(l.amount)} />
                  ))}
                  <StatCard label="المجموع" value={money(expQ.data.total)} tone="primary" />
                </div>
                <p className="text-xs text-[var(--app-text-dim)]">{expQ.data.note}</p>
              </div>
            ) : null}
          </QueryState>
        </Panel>
      ) : null}

      <Panel title="تقارير أخرى (قوائم قابلة للتصفية والتصدير CSV)">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {LINKS.filter((l) => can(l.perm)).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center justify-between rounded-xl border border-[var(--app-border)] px-3 py-2 text-sm font-bold hover:bg-[var(--app-bg-muted)]"
            >
              {l.t}
              <ExternalLink className="h-4 w-4 opacity-60" />
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
