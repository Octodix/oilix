import type { HrAttendanceSummary } from '@/components/print/hr-payslip-document';
import { dateTimeDz, fmtDay, fmtMinutes } from '@/lib/hr-labels';

export type HrAttendanceReport = {
  from: string;
  to: string;
  rows: {
    employee: { id: string; matricule: string; fullName: string; department: { name: string } | null };
    summary: HrAttendanceSummary;
  }[];
};

export const HR_ATTENDANCE_REPORT_API = '/hr/reports/attendance';

export function reportTotals(rows: HrAttendanceReport['rows']) {
  const t = {
    employedWorkingDays: 0,
    presentDays: 0,
    absentDays: 0,
    authorizedAbsenceDays: 0,
    leaveDays: 0,
    sickDays: 0,
    lateCount: 0,
    lateMinutes: 0,
    missingPunchDays: 0,
    workedMinutes: 0,
    overtimeApprovedMinutes: 0,
    overtimePendingMinutes: 0,
  };
  for (const r of rows) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += r.summary[k] ?? 0;
  return t;
}

/** Monthly / range attendance report — A4 landscape, attendance figures only (no salaries). */
export function HrAttendanceReportDocument({ data, title, company }: { data: HrAttendanceReport; title?: string; company?: string }) {
  const t = reportTotals(data.rows);
  return (
    <div className="a4-document" dir="rtl" style={{ fontSize: 10 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 4, marginBottom: 6 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 900 }}>{company ?? 'Oilix'}</p>
          <p style={{ fontWeight: 700 }}>{title ?? 'تقرير الحضور · Rapport de présence'}</p>
        </div>
        <div style={{ textAlign: 'left' }}>
          <p>
            {fmtDay(data.from)} → {fmtDay(data.to)}
          </p>
          <p>{data.rows.length} عامل · employés</p>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th>الرقم</th>
            <th>العامل · Employé</th>
            <th>المصلحة</th>
            <th>أيام العمل</th>
            <th>حضور</th>
            <th>غياب</th>
            <th>غ. مرخص</th>
            <th>عطلة</th>
            <th>مرض</th>
            <th>تأخرات</th>
            <th>د. تأخر</th>
            <th>بصمة ناقصة</th>
            <th>ساعات العمل</th>
            <th>إضافية مقبولة</th>
            <th>إضافية معلقة</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.employee.id}>
              <td dir="ltr">{r.employee.matricule}</td>
              <td style={{ fontWeight: 700 }}>{r.employee.fullName}</td>
              <td>{r.employee.department?.name ?? ''}</td>
              <td>{r.summary.employedWorkingDays}</td>
              <td>{r.summary.presentDays}</td>
              <td>{r.summary.absentDays}</td>
              <td>{r.summary.authorizedAbsenceDays}</td>
              <td>{r.summary.leaveDays}</td>
              <td>{r.summary.sickDays}</td>
              <td>{r.summary.lateCount}</td>
              <td>{fmtMinutes(r.summary.lateMinutes)}</td>
              <td>{r.summary.missingPunchDays}</td>
              <td>{fmtMinutes(r.summary.workedMinutes)}</td>
              <td>{fmtMinutes(r.summary.overtimeApprovedMinutes)}</td>
              <td>{fmtMinutes(r.summary.overtimePendingMinutes)}</td>
            </tr>
          ))}
          <tr>
            <th colSpan={3}>المجموع · Total</th>
            <th>{t.employedWorkingDays}</th>
            <th>{t.presentDays}</th>
            <th>{t.absentDays}</th>
            <th>{t.authorizedAbsenceDays}</th>
            <th>{t.leaveDays}</th>
            <th>{t.sickDays}</th>
            <th>{t.lateCount}</th>
            <th>{fmtMinutes(t.lateMinutes)}</th>
            <th>{t.missingPunchDays}</th>
            <th>{fmtMinutes(t.workedMinutes)}</th>
            <th>{fmtMinutes(t.overtimeApprovedMinutes)}</th>
            <th>{fmtMinutes(t.overtimePendingMinutes)}</th>
          </tr>
        </tbody>
      </table>
      <p style={{ marginTop: 8, fontSize: 9, color: '#444' }} dir="ltr">
        Oilix · imprimé {dateTimeDz(new Date())}
      </p>
    </div>
  );
}
