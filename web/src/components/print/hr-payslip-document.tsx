import {
  dateTimeDz,
  fmtDay,
  fmtMinutes,
  label,
  monthLabel,
  payrollWarning,
  payslipRemaining,
  toNum,
} from '@/lib/hr-labels';

export type HrPayslipLine = {
  id: string;
  kind: 'EARNING' | 'DEDUCTION';
  code: string;
  label: string;
  labelFr: string | null;
  quantity: string | null;
  unit: string | null;
  rate: string | null;
  amount: string;
  explanation: string;
};

export type HrSalaryPaymentRow = {
  id: string;
  amount: string;
  paidAt: string;
  paymentMethod: string;
  cashRegisterName: string | null;
  reference: string | null;
  notes: string | null;
  status: string;
  paidByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
};

export type HrAttendanceSummary = {
  scheduledDays: number;
  employedWorkingDays: number;
  presentDays: number;
  lateCount: number;
  lateMinutes: number;
  chargeableLateMinutes: number;
  justifiedLateCount: number;
  absentDays: number;
  authorizedAbsenceDays: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  sickDays: number;
  holidayDays: number;
  missingPunchDays: number;
  restDaysWorked: number;
  workedMinutes: number;
  expectedMinutes: number;
  overtimeCalculatedMinutes: number;
  overtimeApprovedMinutes: number;
  overtimePendingMinutes: number;
};

export type HrPayslipData = {
  id: string;
  periodId: string;
  employeeId: string;
  status: string;
  salaryMode: string;
  baseSalary: string;
  dailyRate: string;
  hourlyRate: string;
  grossEarnings: string;
  totalDeductions: string;
  netSalary: string;
  paidAmount: string;
  paymentStatus: string;
  warnings: string[] | null;
  calculatedAt: string;
  lockedAt: string | null;
  notes: string | null;
  employeeSnapshot: {
    matricule: string;
    fullName: string;
    jobTitle: string | null;
    department: string | null;
    workSite: string | null;
    hireDate: string | null;
    leftAt: string | null;
    socialSecurityNumber: string | null;
    nationalIdNumber: string | null;
    paymentMethod: string | null;
    bankAccount: string | null;
  };
  contractSnapshot: { contractType: string; weeklyHours: number; startDate: string; endDate: string | null } | null;
  attendanceSummary: HrAttendanceSummary;
  lines: HrPayslipLine[];
  payments: HrSalaryPaymentRow[];
  period: { id: string; year: number; month: number; status: string; startDate: string; endDate: string };
  employee: { id: string; matricule: string; firstName: string; lastName: string; photo: string | null };
  company: { name: string; phone: string | null; address: string | null };
};

export const HR_PAYSLIP_API = (id: string) => `/hr/payroll/payslips/${id}`;

function dzd(v: unknown): string {
  return `${toNum(v).toLocaleString('fr-DZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;
}

const UNIT: Record<string, string> = { DAY: 'j', HOUR: 'h', MINUTE: 'min', OCCURRENCE: '×' };

function qty(l: HrPayslipLine): string {
  if (l.quantity === null) return '';
  const q = toNum(l.quantity);
  return `${Number.isInteger(q) ? q : q.toFixed(2)} ${l.unit ? (UNIT[l.unit] ?? l.unit) : ''}`.trim();
}

function rate(l: HrPayslipLine): string {
  if (l.rate === null) return '';
  return toNum(l.rate).toLocaleString('fr-DZ', { maximumFractionDigits: 2 });
}

/** Bulletin de paie A4 — bilingual, rendered identically for browser print and the Print Agent. */
export function HrPayslipDocument({ data, printedAt }: { data: HrPayslipData; printedAt?: Date }) {
  const e = data.employeeSnapshot;
  const s = data.attendanceSummary;
  const earnings = data.lines.filter((l) => l.kind === 'EARNING');
  const deductions = data.lines.filter((l) => l.kind === 'DEDUCTION');
  const posted = data.payments.filter((p) => p.status === 'POSTED');
  const remaining = payslipRemaining(data);
  const draft = data.status !== 'VALIDATED';

  return (
    <div className="a4-document" dir="rtl">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: 6 }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 900 }}>{data.company.name}</p>
          {data.company.address ? <p>{data.company.address}</p> : null}
          {data.company.phone ? <p dir="ltr" style={{ textAlign: 'right' }}>{data.company.phone}</p> : null}
        </div>
        <div style={{ textAlign: 'left' }}>
          <p style={{ fontSize: 16, fontWeight: 900 }}>كشف الأجر · Bulletin de paie</p>
          <p style={{ fontWeight: 700 }}>{monthLabel(data.period.year, data.period.month)}</p>
          <p>
            {fmtDay(data.period.startDate)} → {fmtDay(data.period.endDate)}
          </p>
        </div>
      </header>

      {draft ? (
        <p style={{ margin: '6px 0', border: '2px dashed #000', padding: 4, textAlign: 'center', fontWeight: 900 }}>
          مسودة غير مصادق عليها · BROUILLON — NON VALIDÉ
        </p>
      ) : null}

      <table style={{ marginTop: 8 }}>
        <tbody>
          <tr>
            <th style={{ width: '18%' }}>العامل · Employé</th>
            <td style={{ width: '32%', fontWeight: 800 }}>{e.fullName}</td>
            <th style={{ width: '18%' }}>الرقم · Matricule</th>
            <td style={{ width: '32%' }} dir="ltr">{e.matricule}</td>
          </tr>
          <tr>
            <th>المنصب · Poste</th>
            <td>{e.jobTitle ?? '—'}</td>
            <th>المصلحة · Service</th>
            <td>{e.department ?? '—'}</td>
          </tr>
          <tr>
            <th>تاريخ التوظيف · Embauche</th>
            <td>{fmtDay(e.hireDate)}</td>
            <th>العقد · Contrat</th>
            <td>
              {data.contractSnapshot ? `${label.contractType(data.contractSnapshot.contractType).fr} · ${data.contractSnapshot.weeklyHours} h/sem` : '—'}
            </td>
          </tr>
          <tr>
            <th>الضمان الاجتماعي · N° SS</th>
            <td dir="ltr">{e.socialSecurityNumber ?? '—'}</td>
            <th>نمط الأجر · Mode</th>
            <td>
              {label.salaryMode(data.salaryMode).ar} · {label.salaryMode(data.salaryMode).fr} — {dzd(data.baseSalary)}
            </td>
          </tr>
          <tr>
            <th>الأجر اليومي · Taux jour</th>
            <td>{dzd(data.dailyRate)}</td>
            <th>الأجر الساعي · Taux horaire</th>
            <td>{dzd(data.hourlyRate)}</td>
          </tr>
        </tbody>
      </table>

      <p style={{ marginTop: 10, fontWeight: 900 }}>الحضور · Présence</p>
      <table>
        <tbody>
          <tr>
            <th>أيام العمل · Jours prévus</th>
            <td>{s.employedWorkingDays}</td>
            <th>حضور · Présents</th>
            <td>{s.presentDays}</td>
            <th>غياب غير مبرر · Absences</th>
            <td>{s.absentDays}</td>
          </tr>
          <tr>
            <th>غياب مرخص · Abs. autorisées</th>
            <td>{s.authorizedAbsenceDays}</td>
            <th>عطلة · Congés</th>
            <td>
              {s.leaveDays}
              {s.unpaidLeaveDays ? ` (${s.unpaidLeaveDays} sans solde)` : ''}
            </td>
            <th>مرض · Maladie</th>
            <td>{s.sickDays}</td>
          </tr>
          <tr>
            <th>تأخرات · Retards</th>
            <td>
              {s.lateCount} ({fmtMinutes(s.lateMinutes)})
            </td>
            <th>ساعات العمل · Heures</th>
            <td>
              {fmtMinutes(s.workedMinutes)} / {fmtMinutes(s.expectedMinutes)}
            </td>
            <th>ساعات إضافية مقبولة · HS</th>
            <td>{fmtMinutes(s.overtimeApprovedMinutes)}</td>
          </tr>
        </tbody>
      </table>

      <p style={{ marginTop: 10, fontWeight: 900 }}>المستحقات · Gains</p>
      <LinesTable lines={earnings} total={data.grossEarnings} totalLabel="الإجمالي · Brut" />

      <p style={{ marginTop: 10, fontWeight: 900 }}>الاقتطاعات · Retenues</p>
      {deductions.length ? (
        <LinesTable lines={deductions} total={data.totalDeductions} totalLabel="مجموع الاقتطاعات · Total retenues" />
      ) : (
        <p>—</p>
      )}

      <table style={{ marginTop: 10 }}>
        <tbody>
          <tr>
            <th style={{ fontSize: 14 }}>صافي الأجر · Net à payer</th>
            <td style={{ fontSize: 16, fontWeight: 900, textAlign: 'left' }} dir="ltr">
              {dzd(data.netSalary)}
            </td>
          </tr>
        </tbody>
      </table>

      {posted.length ? (
        <>
          <p style={{ marginTop: 10, fontWeight: 900 }}>الدفعات · Paiements</p>
          <table>
            <thead>
              <tr>
                <th>التاريخ · Date</th>
                <th>الطريقة · Mode</th>
                <th>المرجع · Réf.</th>
                <th>المبلغ · Montant</th>
              </tr>
            </thead>
            <tbody>
              {posted.map((p) => (
                <tr key={p.id}>
                  <td>{dateTimeDz(p.paidAt)}</td>
                  <td>
                    {label.payment(p.paymentMethod).fr}
                    {p.cashRegisterName ? ` — ${p.cashRegisterName}` : ''}
                  </td>
                  <td dir="ltr">{p.reference ?? ''}</td>
                  <td dir="ltr" style={{ textAlign: 'left' }}>{dzd(p.amount)}</td>
                </tr>
              ))}
              <tr>
                <th colSpan={3}>المتبقي · Reste à payer</th>
                <td dir="ltr" style={{ textAlign: 'left', fontWeight: 900 }}>{dzd(remaining)}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      {data.warnings?.length ? (
        <p style={{ marginTop: 8, fontSize: 10 }}>ملاحظات · Remarques: {data.warnings.map(payrollWarning).join(' — ')}</p>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <div style={{ width: '45%', borderTop: '1px solid #000', paddingTop: 4, textAlign: 'center' }}>إمضاء العامل · Signature employé</div>
        <div style={{ width: '45%', borderTop: '1px solid #000', paddingTop: 4, textAlign: 'center' }}>إمضاء المؤسسة · Cachet employeur</div>
      </div>

      <p style={{ marginTop: 16, fontSize: 9, color: '#444' }} dir="ltr">
        Oilix · {data.id.slice(0, 8)} · calculé {dateTimeDz(data.calculatedAt)}
        {data.lockedAt ? ` · validé ${dateTimeDz(data.lockedAt)}` : ''} · imprimé {dateTimeDz(printedAt ?? new Date())}
      </p>
    </div>
  );
}

function LinesTable({ lines, total, totalLabel }: { lines: HrPayslipLine[]; total: string; totalLabel: string }) {
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: '40%' }}>البند · Rubrique</th>
          <th>الكمية · Qté</th>
          <th>المعدل · Taux</th>
          <th>المبلغ · Montant</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id}>
            <td>
              <span style={{ fontWeight: 700 }}>{l.label}</span>
              {l.labelFr ? <span> · {l.labelFr}</span> : null}
              <div style={{ fontSize: 9, color: '#444' }}>{l.explanation}</div>
            </td>
            <td dir="ltr">{qty(l)}</td>
            <td dir="ltr">{rate(l)}</td>
            <td dir="ltr" style={{ textAlign: 'left', fontWeight: 700 }}>{dzd(l.amount)}</td>
          </tr>
        ))}
        <tr>
          <th colSpan={3}>{totalLabel}</th>
          <td dir="ltr" style={{ textAlign: 'left', fontWeight: 900 }}>{dzd(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
