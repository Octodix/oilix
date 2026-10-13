/**
 * Payroll engine — pure. Contracts + processed attendance + approved items → payslip lines.
 * No legal/tax/social rule is hard-coded: every rate and treatment comes from PayrollPolicy.
 * Each line keeps its source ids and a human-readable formula so any figure can be audited.
 */

export type SalaryMode = 'MONTHLY' | 'DAILY' | 'HOURLY';

export type PayrollPolicy = {
  /** Monthly daily-rate divisor: scheduled working days of the month, or a fixed number (26, 30…). */
  dailyRateDivisor: 'SCHEDULED' | number;
  /** Monthly hourly-rate divisor: contract weekly hours × 52 / 12, or a fixed number (173.33…). */
  hourlyRateDivisor: 'CONTRACT' | number;
  deductUnjustifiedAbsences: boolean;
  lateDeductionMode: 'NONE' | 'PER_MINUTE' | 'FIXED_PER_OCCURRENCE';
  lateFixedAmount: number;
  /** First N unjustified late arrivals of the month are not deducted. */
  lateToleratedOccurrences: number;
  overtimeRequiresApproval: boolean;
  /** Missing punch days are flagged for review; PAY keeps them paid until HR decides. */
  missingPunchTreatment: 'PAY' | 'UNPAID';
};

export const DEFAULT_PAYROLL_POLICY: PayrollPolicy = {
  dailyRateDivisor: 'SCHEDULED',
  hourlyRateDivisor: 'CONTRACT',
  deductUnjustifiedAbsences: true,
  lateDeductionMode: 'NONE',
  lateFixedAmount: 0,
  lateToleratedOccurrences: 0,
  overtimeRequiresApproval: true,
  missingPunchTreatment: 'PAY',
};

export type PayrollContract = {
  id: string;
  startDate: string;
  endDate: string | null;
  salaryMode: SalaryMode;
  baseSalary: number;
  weeklyHours: number;
  contractType: string;
  jobTitle: string | null;
};

export type PayrollDay = {
  id: string;
  date: string;
  status: string;
  isWorkingDay: boolean;
  expectedMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  isLate: boolean;
  chargeableLateMinutes: number;
  lateJustified: boolean;
  leavePaid: boolean | null;
  absencePaid: boolean | null;
  sickPaidPercent: number | null;
  holidayPaid: boolean | null;
};

export type PayrollOvertime = {
  id: string;
  date: string;
  minutes: number;
  multiplier: number;
  status: 'APPROVED' | 'PENDING';
};

export type PayrollItem = { id: string; type: string; label: string; amount: number };
export type PayrollBonus = PayrollItem & { category: 'BONUS' | 'ALLOWANCE' };
export type PayrollAdvance = { id: string; amount: number; date: string };
export type PayrollLoan = { id: string; installment: number; remaining: number };

export type PayrollInput = {
  period: { year: number; month: number; start: string; end: string };
  contracts: PayrollContract[];
  days: PayrollDay[];
  overtime: PayrollOvertime[];
  bonuses: PayrollBonus[];
  deductions: PayrollItem[];
  advances: PayrollAdvance[];
  loans: PayrollLoan[];
  policy: PayrollPolicy;
};

export type PayslipLineOut = {
  kind: 'EARNING' | 'DEDUCTION';
  code: string;
  label: string;
  labelFr: string;
  quantity: number | null;
  unit: 'DAY' | 'HOUR' | 'MINUTE' | 'OCCURRENCE' | null;
  rate: number | null;
  amount: number;
  sourceType: string | null;
  sourceIds: string[];
  explanation: string;
  sortOrder: number;
};

export type AttendanceSummary = {
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

export type PayrollResult = {
  contract: PayrollContract | null;
  salaryMode: SalaryMode;
  baseSalary: number;
  dailyRate: number;
  hourlyRate: number;
  lines: PayslipLineOut[];
  grossEarnings: number;
  totalDeductions: number;
  netSalary: number;
  summary: AttendanceSummary;
  warnings: string[];
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}

const NF = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function money(n: number): string {
  return NF.format(round2(n));
}

function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function hours(minutes: number): number {
  return round2(minutes / 60);
}

const PRESENT_STATUSES = new Set(['PRESENT', 'LATE', 'IN_PROGRESS']);

function contractOn(contracts: PayrollContract[], date: string): PayrollContract | null {
  let best: PayrollContract | null = null;
  for (const c of contracts) {
    if (c.startDate <= date && (!c.endDate || c.endDate >= date)) {
      if (!best || c.startDate > best.startDate) best = c;
    }
  }
  return best;
}

function datesLabel(dates: string[]): string {
  if (!dates.length) return '';
  const shown = dates.slice(0, 10).map((d) => d.slice(8, 10) + '/' + d.slice(5, 7));
  return shown.join('، ') + (dates.length > 10 ? ` … (+${dates.length - 10})` : '');
}

type UnpaidBucket = {
  code: string;
  label: string;
  labelFr: string;
  days: number;
  dates: string[];
  ids: string[];
};

export function computePayslip(input: PayrollInput): PayrollResult {
  const { policy, period } = input;
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  const warnings: string[] = [];

  const scheduledDays = days.filter((d) => d.isWorkingDay).length;
  const employedDays = days.filter((d) => d.status !== 'NOT_EMPLOYED');
  const employedWorking = employedDays.filter((d) => d.isWorkingDay);

  const primary =
    contractOn(input.contracts, period.end) ??
    [...input.contracts]
      .filter((c) => c.startDate <= period.end && (!c.endDate || c.endDate >= period.start))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ??
    null;

  const summary = summarize(days, input.overtime);
  if (!primary) {
    warnings.push('NO_CONTRACT');
    return {
      contract: null,
      salaryMode: 'MONTHLY',
      baseSalary: 0,
      dailyRate: 0,
      hourlyRate: 0,
      lines: [],
      grossEarnings: 0,
      totalDeductions: 0,
      netSalary: 0,
      summary,
      warnings,
    };
  }

  const usedContracts = new Set<string>();
  for (const d of employedDays) {
    const c = contractOn(input.contracts, d.date);
    if (c) usedContracts.add(c.id);
    else if (d.isWorkingDay) warnings.push(`NO_CONTRACT_ON:${d.date}`);
  }
  if (usedContracts.size > 1) warnings.push('CONTRACT_CHANGED_IN_PERIOD');

  const mode = primary.salaryMode;
  const avgDayMinutes = employedWorking.length
    ? employedWorking.reduce((s, d) => s + d.expectedMinutes, 0) / employedWorking.length
    : 480;
  const avgDayHours = avgDayMinutes > 0 ? avgDayMinutes / 60 : 8;

  let dailyRate: number;
  let hourlyRate: number;
  if (mode === 'MONTHLY') {
    const divisor =
      policy.dailyRateDivisor === 'SCHEDULED' ? scheduledDays : Number(policy.dailyRateDivisor);
    dailyRate = divisor > 0 ? primary.baseSalary / divisor : 0;
    const hDiv =
      policy.hourlyRateDivisor === 'CONTRACT'
        ? (primary.weeklyHours * 52) / 12
        : Number(policy.hourlyRateDivisor);
    hourlyRate = hDiv > 0 ? primary.baseSalary / hDiv : 0;
  } else if (mode === 'DAILY') {
    dailyRate = primary.baseSalary;
    hourlyRate = primary.baseSalary / avgDayHours;
  } else {
    hourlyRate = primary.baseSalary;
    dailyRate = primary.baseSalary * avgDayHours;
  }
  dailyRate = round4(dailyRate);
  hourlyRate = round4(hourlyRate);

  const lines: PayslipLineOut[] = [];
  let order = 0;
  const push = (l: Omit<PayslipLineOut, 'sortOrder' | 'amount'> & { amount: number }) => {
    const amount = round2(l.amount);
    if (amount === 0 && l.code !== 'BASE') return;
    lines.push({ ...l, amount, sortOrder: order++ });
  };

  // ── Unpaid days (same classification for every salary mode) ──────────────
  const buckets: Record<string, UnpaidBucket> = {};
  const bucket = (code: string, label: string, labelFr: string) =>
    (buckets[code] ??= { code, label, labelFr, days: 0, dates: [], ids: [] });
  for (const d of employedWorking) {
    let unpaidFraction = 0;
    let b: UnpaidBucket | null = null;
    switch (d.status) {
      case 'ABSENT':
        if (policy.deductUnjustifiedAbsences) {
          unpaidFraction = 1;
          b = bucket('ABSENCE_UNJUSTIFIED', 'غياب غير مبرر', 'Absence injustifiée');
        }
        break;
      case 'AUTHORIZED_ABSENCE':
        if (d.absencePaid === false) {
          unpaidFraction = 1;
          b = bucket('ABSENCE_UNPAID', 'غياب مرخص غير مدفوع', 'Absence autorisée non payée');
        }
        break;
      case 'LEAVE':
        if (d.leavePaid === false) {
          unpaidFraction = 1;
          b = bucket('LEAVE_UNPAID', 'عطلة بدون أجر', 'Congé sans solde');
        }
        break;
      case 'SICK_LEAVE': {
        const pct = Math.min(100, Math.max(0, d.sickPaidPercent ?? 0));
        if (pct < 100) {
          unpaidFraction = (100 - pct) / 100;
          b = bucket('SICK_UNPAID', 'عطلة مرضية (غير مدفوعة من المؤسسة)', 'Congé maladie (non payé employeur)');
        }
        break;
      }
      case 'HOLIDAY':
        if (d.holidayPaid === false) {
          unpaidFraction = 1;
          b = bucket('HOLIDAY_UNPAID', 'عطلة رسمية غير مدفوعة', 'Jour férié non payé');
        }
        break;
      case 'MISSING_PUNCH':
        if (policy.missingPunchTreatment === 'UNPAID') {
          unpaidFraction = 1;
          b = bucket('MISSING_PUNCH_UNPAID', 'يوم بتسجيل ناقص', 'Pointage incomplet');
        }
        break;
      default:
        break;
    }
    if (b && unpaidFraction > 0) {
      b.days += unpaidFraction;
      b.dates.push(d.date);
      b.ids.push(d.id);
    }
  }
  if (summary.missingPunchDays > 0) warnings.push(`MISSING_PUNCH_DAYS:${summary.missingPunchDays}`);
  const unpaidDays = Object.values(buckets).reduce((s, b) => s + b.days, 0);

  // ── Base ───────────────────────────────────────────────────────────────────
  if (mode === 'MONTHLY') {
    const basis = scheduledDays > 0 ? scheduledDays : days.length;
    const parts: string[] = [];
    let base = 0;
    for (const c of input.contracts.filter((x) => usedContracts.has(x.id))) {
      const covered = employedDays.filter(
        (d) => (scheduledDays > 0 ? d.isWorkingDay : true) && contractOn(input.contracts, d.date)?.id === c.id,
      ).length;
      const share = basis > 0 ? (c.baseSalary * covered) / basis : 0;
      base += share;
      parts.push(
        covered === basis
          ? `راتب شهري ${money(c.baseSalary)}`
          : `${money(c.baseSalary)} × ${covered}/${basis} يوم عمل = ${money(share)}`,
      );
    }
    push({
      kind: 'EARNING',
      code: 'BASE',
      label: 'الراتب الأساسي',
      labelFr: 'Salaire de base',
      quantity: null,
      unit: null,
      rate: primary.baseSalary,
      amount: base,
      sourceType: 'CONTRACT',
      sourceIds: [...usedContracts],
      explanation: parts.join(' + ') || 'لا يوجد عقد ساري',
    });
    for (const b of Object.values(buckets)) {
      push({
        kind: 'DEDUCTION',
        code: b.code,
        label: b.label,
        labelFr: b.labelFr,
        quantity: round2(b.days),
        unit: 'DAY',
        rate: dailyRate,
        amount: b.days * dailyRate,
        sourceType: 'ATTENDANCE_DAY',
        sourceIds: b.ids,
        explanation: `${qty(round2(b.days))} يوم × ${money(dailyRate)} = ${money(b.days * dailyRate)} — ${datesLabel(b.dates)}`,
      });
    }
  } else if (mode === 'DAILY') {
    const payable = Math.max(0, employedWorking.length - unpaidDays);
    push({
      kind: 'EARNING',
      code: 'BASE',
      label: 'الأجر اليومي',
      labelFr: 'Salaire journalier',
      quantity: round2(payable),
      unit: 'DAY',
      rate: dailyRate,
      amount: payable * dailyRate,
      sourceType: 'ATTENDANCE_DAY',
      sourceIds: employedWorking.map((d) => d.id),
      explanation:
        `${qty(round2(payable))} يوم مدفوع × ${money(dailyRate)}` +
        (unpaidDays > 0
          ? ` (${employedWorking.length} يوم عمل − ${qty(round2(unpaidDays))} غير مدفوع: ${Object.values(buckets)
              .map((b) => `${b.label} ${qty(round2(b.days))}`)
              .join('، ')})`
          : ''),
    });
  } else {
    let payableMinutes = 0;
    for (const d of employedWorking) {
      if (PRESENT_STATUSES.has(d.status)) payableMinutes += Math.min(d.workedMinutes, d.expectedMinutes);
      else if (d.status === 'MISSING_PUNCH' && policy.missingPunchTreatment === 'PAY') payableMinutes += d.expectedMinutes;
      else if (d.status === 'LEAVE' && d.leavePaid) payableMinutes += d.expectedMinutes;
      else if (d.status === 'AUTHORIZED_ABSENCE' && d.absencePaid) payableMinutes += d.expectedMinutes;
      else if (d.status === 'HOLIDAY' && d.holidayPaid !== false) payableMinutes += d.expectedMinutes;
      else if (d.status === 'SICK_LEAVE') payableMinutes += (d.expectedMinutes * (d.sickPaidPercent ?? 0)) / 100;
    }
    const h = hours(payableMinutes);
    push({
      kind: 'EARNING',
      code: 'BASE',
      label: 'الأجر بالساعة',
      labelFr: 'Salaire horaire',
      quantity: h,
      unit: 'HOUR',
      rate: hourlyRate,
      amount: h * hourlyRate,
      sourceType: 'ATTENDANCE_DAY',
      sourceIds: employedWorking.map((d) => d.id),
      explanation: `${qty(h)} ساعة × ${money(hourlyRate)} (الساعات العادية فقط، الإضافية منفصلة)`,
    });
  }

  // ── Overtime (approved only unless policy says otherwise) ─────────────────
  const payableOt = input.overtime.filter(
    (o) => o.status === 'APPROVED' || (!policy.overtimeRequiresApproval && o.status === 'PENDING'),
  );
  const byMultiplier = new Map<number, PayrollOvertime[]>();
  for (const o of payableOt) {
    if (o.minutes <= 0) continue;
    const list = byMultiplier.get(o.multiplier) ?? [];
    list.push(o);
    byMultiplier.set(o.multiplier, list);
  }
  for (const [mult, list] of [...byMultiplier.entries()].sort((a, b) => a[0] - b[0])) {
    const minutes = list.reduce((s, o) => s + o.minutes, 0);
    const h = hours(minutes);
    const rate = round4(hourlyRate * mult);
    push({
      kind: 'EARNING',
      code: 'OVERTIME',
      label: `ساعات إضافية ×${mult}`,
      labelFr: `Heures supplémentaires ×${mult}`,
      quantity: h,
      unit: 'HOUR',
      rate,
      amount: h * rate,
      sourceType: 'OVERTIME',
      sourceIds: list.map((o) => o.id),
      explanation: `${qty(h)} ساعة × ${money(hourlyRate)} × ${mult} — ${datesLabel(list.map((o) => o.date))}`,
    });
  }
  const pendingOt = input.overtime.filter((o) => o.status === 'PENDING');
  if (policy.overtimeRequiresApproval && pendingOt.length) {
    warnings.push(`PENDING_OVERTIME:${pendingOt.length}`);
  }

  // ── Bonuses & allowances ───────────────────────────────────────────────────
  for (const b of input.bonuses) {
    push({
      kind: 'EARNING',
      code: b.category === 'ALLOWANCE' ? 'ALLOWANCE' : 'BONUS',
      label: b.label,
      labelFr: b.category === 'ALLOWANCE' ? 'Indemnité' : 'Prime',
      quantity: null,
      unit: null,
      rate: null,
      amount: b.amount,
      sourceType: 'BONUS',
      sourceIds: [b.id],
      explanation: `${b.label}: ${money(b.amount)}`,
    });
  }

  // ── Late arrivals (policy-driven, justified lates never deducted) ─────────
  if (policy.lateDeductionMode !== 'NONE') {
    const lates = employedWorking.filter((d) => d.isLate && !d.lateJustified && d.chargeableLateMinutes > 0);
    const charged = lates.slice(Math.max(0, policy.lateToleratedOccurrences));
    if (charged.length) {
      if (policy.lateDeductionMode === 'PER_MINUTE') {
        const minutes = charged.reduce((s, d) => s + d.chargeableLateMinutes, 0);
        const perMinute = hourlyRate / 60;
        push({
          kind: 'DEDUCTION',
          code: 'LATE',
          label: 'اقتطاع التأخر',
          labelFr: 'Retenue retards',
          quantity: minutes,
          unit: 'MINUTE',
          rate: round4(perMinute),
          amount: minutes * perMinute,
          sourceType: 'ATTENDANCE_DAY',
          sourceIds: charged.map((d) => d.id),
          explanation:
            `${minutes} دقيقة × ${money(hourlyRate)}/60 — ${datesLabel(charged.map((d) => d.date))}` +
            (policy.lateToleratedOccurrences > 0 ? ` (أول ${policy.lateToleratedOccurrences} تأخر معفى)` : ''),
        });
      } else {
        push({
          kind: 'DEDUCTION',
          code: 'LATE',
          label: 'اقتطاع التأخر',
          labelFr: 'Retenue retards',
          quantity: charged.length,
          unit: 'OCCURRENCE',
          rate: policy.lateFixedAmount,
          amount: charged.length * policy.lateFixedAmount,
          sourceType: 'ATTENDANCE_DAY',
          sourceIds: charged.map((d) => d.id),
          explanation: `${charged.length} تأخر × ${money(policy.lateFixedAmount)} — ${datesLabel(charged.map((d) => d.date))}`,
        });
      }
    }
  }

  // ── Manual deductions, advances, loans ─────────────────────────────────────
  for (const d of input.deductions) {
    push({
      kind: 'DEDUCTION',
      code: 'DEDUCTION',
      label: d.label,
      labelFr: 'Retenue',
      quantity: null,
      unit: null,
      rate: null,
      amount: d.amount,
      sourceType: 'DEDUCTION',
      sourceIds: [d.id],
      explanation: `${d.label}: ${money(d.amount)}`,
    });
  }
  for (const a of input.advances) {
    push({
      kind: 'DEDUCTION',
      code: 'ADVANCE',
      label: 'تسبيق على الراتب',
      labelFr: 'Avance sur salaire',
      quantity: null,
      unit: null,
      rate: null,
      amount: a.amount,
      sourceType: 'ADVANCE',
      sourceIds: [a.id],
      explanation: `تسبيق بتاريخ ${a.date}: ${money(a.amount)}`,
    });
  }
  for (const l of input.loans) {
    const amount = Math.min(l.installment, l.remaining);
    if (amount <= 0) continue;
    push({
      kind: 'DEDUCTION',
      code: 'LOAN',
      label: 'قسط قرض',
      labelFr: 'Échéance de prêt',
      quantity: null,
      unit: null,
      rate: null,
      amount,
      sourceType: 'LOAN',
      sourceIds: [l.id],
      explanation: `قسط ${money(amount)} (المتبقي قبل الاقتطاع ${money(l.remaining)})`,
    });
  }

  const grossEarnings = round2(lines.filter((l) => l.kind === 'EARNING').reduce((s, l) => s + l.amount, 0));
  const totalDeductions = round2(lines.filter((l) => l.kind === 'DEDUCTION').reduce((s, l) => s + l.amount, 0));
  const netSalary = round2(grossEarnings - totalDeductions);
  if (netSalary < 0) warnings.push('NEGATIVE_NET');

  return {
    contract: primary,
    salaryMode: mode,
    baseSalary: primary.baseSalary,
    dailyRate,
    hourlyRate,
    lines,
    grossEarnings,
    totalDeductions,
    netSalary,
    summary,
    warnings,
  };
}

export function summarize(days: PayrollDay[], overtime: PayrollOvertime[]): AttendanceSummary {
  const s: AttendanceSummary = {
    scheduledDays: 0,
    employedWorkingDays: 0,
    presentDays: 0,
    lateCount: 0,
    lateMinutes: 0,
    chargeableLateMinutes: 0,
    justifiedLateCount: 0,
    absentDays: 0,
    authorizedAbsenceDays: 0,
    leaveDays: 0,
    unpaidLeaveDays: 0,
    sickDays: 0,
    holidayDays: 0,
    missingPunchDays: 0,
    restDaysWorked: 0,
    workedMinutes: 0,
    expectedMinutes: 0,
    overtimeCalculatedMinutes: 0,
    overtimeApprovedMinutes: 0,
    overtimePendingMinutes: 0,
  };
  for (const d of days) {
    if (d.isWorkingDay) s.scheduledDays++;
    if (d.status === 'NOT_EMPLOYED') continue;
    if (d.isWorkingDay) {
      s.employedWorkingDays++;
      s.expectedMinutes += d.expectedMinutes;
    }
    s.workedMinutes += d.workedMinutes;
    s.overtimeCalculatedMinutes += d.overtimeMinutes;
    if (d.isLate) {
      s.lateCount++;
      s.lateMinutes += d.chargeableLateMinutes;
      if (d.lateJustified) s.justifiedLateCount++;
      else s.chargeableLateMinutes += d.chargeableLateMinutes;
    }
    switch (d.status) {
      case 'PRESENT':
      case 'LATE':
      case 'IN_PROGRESS':
        s.presentDays++;
        break;
      case 'ABSENT':
        s.absentDays++;
        break;
      case 'AUTHORIZED_ABSENCE':
        s.authorizedAbsenceDays++;
        break;
      case 'LEAVE':
        s.leaveDays++;
        if (d.leavePaid === false) s.unpaidLeaveDays++;
        break;
      case 'SICK_LEAVE':
        s.sickDays++;
        break;
      case 'HOLIDAY':
        s.holidayDays++;
        break;
      case 'MISSING_PUNCH':
        s.missingPunchDays++;
        break;
      case 'REST_DAY':
        if (d.workedMinutes > 0) s.restDaysWorked++;
        break;
      default:
        break;
    }
  }
  for (const o of overtime) {
    if (o.status === 'APPROVED') s.overtimeApprovedMinutes += o.minutes;
    else s.overtimePendingMinutes += o.minutes;
  }
  return s;
}
