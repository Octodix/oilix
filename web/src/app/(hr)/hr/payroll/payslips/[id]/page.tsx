'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Banknote, FileText, Printer, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  apiError,
  EMPTY_MONEY_OUT,
  HrPageHeader,
  Modal,
  money,
  MoneyOutFields,
  moneyOutPayload,
  Notice,
  Panel,
  QueryState,
  ReasonModal,
  StatCard,
  StatusBadge,
  Table,
  Td,
  TextInput,
  Th,
  useCan,
  type MoneyOutValue,
} from '@/components/hr/hr-ui';
import { HR_PAYSLIP_API, type HrPayslipData, type HrPayslipLine } from '@/components/print/hr-payslip-document';
import { useDirectPrint } from '@/hooks/use-direct-print';
import { api } from '@/lib/api';
import {
  dateTimeDz,
  fmtDay,
  fmtMinutes,
  label,
  monthLabel,
  newIdempotencyKey,
  payrollWarning,
  payslipRemaining,
  round2,
  todayKeyDz,
  toNum,
} from '@/lib/hr-labels';
import { hrPayslipRequest } from '@/lib/print-documents';

type PayResult = { payment: { id: string; amount: string }; duplicate: boolean };

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const { print, busy: printing, settings: printSettings } = useDirectPrint();

  const q = useQuery({
    queryKey: ['hr', 'payslip', id],
    queryFn: async () => (await api.get<HrPayslipData>(HR_PAYSLIP_API(id))).data,
  });

  const cancel = useMutation({
    mutationFn: async (v: { paymentId: string; reason: string }) =>
      (await api.post(`/hr/payroll/payments/${v.paymentId}/cancel`, { reason: v.reason })).data,
    onSuccess: () => {
      setCancelId(null);
      toast.success('تم إلغاء الدفعة — أُعيد المبلغ إلى جلسة الصندوق إن كان نقداً');
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const s = q.data;
  if (!s) {
    return (
      <div className="space-y-4">
        <Link href="/hr/payroll" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--app-text-dim)] hover:text-[var(--app-text)]">
          <ArrowRight className="h-4 w-4" /> الأجور
        </Link>
        <QueryState q={q}>{null}</QueryState>
      </div>
    );
  }

  const remaining = payslipRemaining(s);
  const payable = s.status === 'VALIDATED' && ['VALIDATED', 'PAID'].includes(s.period.status) && remaining > 0.005;
  const periodClosed = s.period.status === 'CLOSED';
  const earnings = s.lines.filter((l) => l.kind === 'EARNING');
  const deductions = s.lines.filter((l) => l.kind === 'DEDUCTION');
  const a = s.attendanceSummary;
  const directOk = printSettings.directPrinting && !!printSettings.documentPrinter;
  const openBrowserPrint = () => window.open(`/hr-payslip/${s.id}?print=1`, '_blank', 'noopener');

  return (
    <div className="space-y-4">
      <Link
        href={`/hr/payroll/${s.periodId}`}
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--app-text-dim)] hover:text-[var(--app-text)]"
      >
        <ArrowRight className="h-4 w-4" /> أجور {monthLabel(s.period.year, s.period.month)}
      </Link>

      <HrPageHeader
        title={s.employeeSnapshot.fullName}
        fr={`Bulletin ${String(s.period.month).padStart(2, '0')}/${s.period.year} · ${s.employeeSnapshot.matricule}`}
        icon={FileText}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge l={s.status === 'VALIDATED' ? { ar: 'مصادق عليه', fr: 'Validé', tone: 'success' } : { ar: 'محسوب (مسودة)', fr: 'Brouillon', tone: 'primary' }} />
            {s.status === 'VALIDATED' ? <StatusBadge l={label.payslipPayment(s.paymentStatus)} /> : null}
            <span className="text-xs text-[var(--app-text-dim)]">
              {s.employeeSnapshot.jobTitle ?? ''} {s.employeeSnapshot.department ? `· ${s.employeeSnapshot.department}` : ''}
            </span>
          </span>
        }
        actions={
          <>
            <Link href={`/hr/employees/${s.employeeId}?tab=month&year=${s.period.year}&month=${s.period.month}`}>
              <Button size="sm" variant="outline">
                الحضور
              </Button>
            </Link>
            {directOk ? (
              <Button
                size="sm"
                variant="outline"
                loading={printing}
                onClick={() =>
                  void print(hrPayslipRequest(s.id, { data: s }), {
                    browserFallback: openBrowserPrint,
                    successMessage: 'تم إرسال كشف الأجر للطابعة',
                  })
                }
              >
                <Send className="h-4 w-4" /> طباعة مباشرة
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={openBrowserPrint}>
              <Printer className="h-4 w-4" /> {directOk ? 'معاينة' : 'طباعة'}
            </Button>
            {payable && can('HR_SALARY_PAY') ? (
              <Button size="sm" variant="gold" onClick={() => setPaying(true)}>
                <Banknote className="h-4 w-4" /> دفع
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="الإجمالي · Brut" value={money(s.grossEarnings)} />
        <StatCard label="الاقتطاعات · Retenues" value={money(s.totalDeductions)} tone="warning" />
        <StatCard label="الصافي · Net" value={money(s.netSalary)} tone="primary" />
        <StatCard label="المدفوع · Payé" value={money(s.paidAmount)} tone="success" />
        <StatCard label="المتبقي · Reste" value={money(remaining)} tone={remaining > 0.005 ? 'danger' : 'success'} />
      </div>

      {s.status !== 'VALIDATED' ? (
        <Notice>هذا الكشف محسوب لكنه غير مصادق عليه — قد يتغير عند إعادة الحساب. لا يمكن دفعه قبل مصادقة الفترة.</Notice>
      ) : null}
      {periodClosed ? <Notice>الفترة مغلقة — لا يمكن تعديل الدفعات.</Notice> : null}
      {s.warnings?.length ? (
        <Notice tone="warning">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{s.warnings.map(payrollWarning).join(' · ')}</span>
          </span>
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="الأساس · Base" className="lg:col-span-1">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-[var(--app-text-dim)]">نمط الأجر</dt>
            <dd className="font-bold">{label.salaryMode(s.salaryMode).ar}</dd>
            <dt className="text-[var(--app-text-dim)]">الأجر الأساسي</dt>
            <dd className="font-bold tabular-nums">{money(s.baseSalary)}</dd>
            <dt className="text-[var(--app-text-dim)]">الأجر اليومي</dt>
            <dd className="tabular-nums">{money(s.dailyRate)}</dd>
            <dt className="text-[var(--app-text-dim)]">الأجر الساعي</dt>
            <dd className="tabular-nums">{money(s.hourlyRate)}</dd>
            <dt className="text-[var(--app-text-dim)]">العقد</dt>
            <dd>
              {s.contractSnapshot
                ? `${label.contractType(s.contractSnapshot.contractType).fr} · ${s.contractSnapshot.weeklyHours} سا/أسبوع`
                : '—'}
            </dd>
            <dt className="text-[var(--app-text-dim)]">تاريخ التوظيف</dt>
            <dd>{fmtDay(s.employeeSnapshot.hireDate)}</dd>
            <dt className="text-[var(--app-text-dim)]">الحساب</dt>
            <dd className="text-xs">{dateTimeDz(s.calculatedAt)}</dd>
            {s.lockedAt ? (
              <>
                <dt className="text-[var(--app-text-dim)]">المصادقة</dt>
                <dd className="text-xs">{dateTimeDz(s.lockedAt)}</dd>
              </>
            ) : null}
          </dl>
        </Panel>

        <Panel title="ملخص الحضور · Présence" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Mini k="أيام العمل المبرمجة" v={a.employedWorkingDays} />
            <Mini k="حضور" v={a.presentDays} />
            <Mini k="غياب غير مبرر" v={a.absentDays} danger={a.absentDays > 0} />
            <Mini k="غياب مرخص" v={a.authorizedAbsenceDays} />
            <Mini k="عطلة" v={`${a.leaveDays}${a.unpaidLeaveDays ? ` (${a.unpaidLeaveDays} بدون أجر)` : ''}`} />
            <Mini k="عطلة مرضية" v={a.sickDays} />
            <Mini k="عطل رسمية" v={a.holidayDays} />
            <Mini k="بصمة ناقصة" v={a.missingPunchDays} danger={a.missingPunchDays > 0} />
            <Mini k="تأخرات" v={`${a.lateCount} · ${fmtMinutes(a.lateMinutes)}`} />
            <Mini k="تأخر محسوب" v={fmtMinutes(a.chargeableLateMinutes)} />
            <Mini k="ساعات العمل" v={`${fmtMinutes(a.workedMinutes)} / ${fmtMinutes(a.expectedMinutes)}`} />
            <Mini
              k="ساعات إضافية"
              v={`${fmtMinutes(a.overtimeApprovedMinutes)} مقبولة${a.overtimePendingMinutes ? ` · ${fmtMinutes(a.overtimePendingMinutes)} معلقة` : ''}`}
            />
          </div>
        </Panel>
      </div>

      <LinesPanel title="المستحقات · Gains" lines={earnings} total={s.grossEarnings} />
      <LinesPanel title="الاقتطاعات · Retenues" lines={deductions} total={s.totalDeductions} negative />

      <Panel title="الدفعات · Paiements" bodyClassName="p-0">
        {s.payments.length ? (
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>التاريخ</Th>
                <Th>المبلغ</Th>
                <Th>الطريقة</Th>
                <Th>المرجع / ملاحظة</Th>
                <Th>بواسطة</Th>
                <Th>الحالة</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {s.payments.map((p) => (
                <tr key={p.id} className={p.status === 'CANCELLED' ? 'opacity-60' : ''}>
                  <Td className="text-xs">{dateTimeDz(p.paidAt)}</Td>
                  <Td className={`font-bold tabular-nums ${p.status === 'CANCELLED' ? 'line-through' : ''}`}>{money(p.amount)}</Td>
                  <Td className="text-xs">
                    {label.payment(p.paymentMethod).ar}
                    {p.cashRegisterName ? <p className="text-[var(--app-text-dim)]">{p.cashRegisterName}</p> : null}
                  </Td>
                  <Td className="text-xs">
                    {p.reference ?? ''}
                    {p.notes ? <p className="text-[var(--app-text-dim)]">{p.notes}</p> : null}
                  </Td>
                  <Td className="text-xs">{p.paidByName ?? '—'}</Td>
                  <Td className="text-xs">
                    <StatusBadge l={label.money(p.status)} />
                    {p.status === 'CANCELLED' ? (
                      <p className="mt-1 text-[11px]">
                        {p.cancelledByName} {dateTimeDz(p.cancelledAt)} — {p.cancelReason}
                      </p>
                    ) : null}
                  </Td>
                  <Td>
                    {p.status === 'POSTED' && !periodClosed && can('HR_SALARY_PAY') ? (
                      <Button size="sm" variant="ghost" onClick={() => setCancelId(p.id)}>
                        <XCircle className="h-4 w-4" /> إلغاء
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-[var(--app-text-dim)]">
            لا توجد دفعات. الحساب والمصادقة لا يُنشئان أي حركة نقدية — الدفع عملية مستقلة.
          </p>
        )}
      </Panel>

      <PayModal slip={s} open={paying} onClose={() => setPaying(false)} />
      <ReasonModal
        open={!!cancelId}
        title="إلغاء دفعة · Annuler le paiement"
        description="تُلغى الدفعة (لا تُحذف) ويُعاد المبلغ إلى جلسة الصندوق إن كان الدفع من الصندوق. يُسجل في سجل العمليات."
        danger
        busy={cancel.isPending}
        onClose={() => setCancelId(null)}
        onConfirm={(reason) => cancelId && cancel.mutate({ paymentId: cancelId, reason })}
      />
    </div>
  );
}

function Mini({ k, v, danger }: { k: string; v: React.ReactNode; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] px-3 py-2">
      <p className="text-[11px] text-[var(--app-text-dim)]">{k}</p>
      <p className={`font-bold tabular-nums ${danger ? 'text-red-600' : ''}`}>{v}</p>
    </div>
  );
}

const UNIT_AR: Record<string, string> = { DAY: 'يوم', HOUR: 'سا', MINUTE: 'د', OCCURRENCE: 'مرة' };

function LinesPanel({ title, lines, total, negative }: { title: string; lines: HrPayslipLine[]; total: string; negative?: boolean }) {
  return (
    <Panel title={title} bodyClassName="p-0">
      {lines.length ? (
        <Table minWidth={760}>
          <thead>
            <tr>
              <Th>البند</Th>
              <Th>الكمية</Th>
              <Th>المعدل</Th>
              <Th>المبلغ</Th>
              <Th>طريقة الحساب</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <Td>
                  <p className="font-bold">{l.label}</p>
                  <p className="text-[11px] text-[var(--app-text-dim)]">{l.labelFr ?? l.code}</p>
                </Td>
                <Td className="tabular-nums">{l.quantity !== null ? `${round2(toNum(l.quantity))} ${l.unit ? (UNIT_AR[l.unit] ?? l.unit) : ''}` : '—'}</Td>
                <Td className="tabular-nums">{l.rate !== null ? money(l.rate) : '—'}</Td>
                <Td className={`font-bold tabular-nums ${negative ? 'text-red-700 dark:text-red-400' : ''}`}>
                  {negative ? '− ' : ''}
                  {money(l.amount)}
                </Td>
                <Td className="max-w-[24rem] text-[11px] text-[var(--app-text-muted)]">{l.explanation}</Td>
              </tr>
            ))}
            <tr className="bg-[var(--app-bg-muted)]">
              <Td className="font-black">المجموع</Td>
              <Td />
              <Td />
              <Td className="font-black tabular-nums">
                {negative ? '− ' : ''}
                {money(total)}
              </Td>
              <Td />
            </tr>
          </tbody>
        </Table>
      ) : (
        <p className="p-4 text-sm text-[var(--app-text-dim)]">—</p>
      )}
    </Panel>
  );
}

function PayModal({ slip, open, onClose }: { slip: HrPayslipData; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const remaining = payslipRemaining(slip);
  const settingsQ = useQuery({
    queryKey: ['hr', 'settings'],
    enabled: open,
    queryFn: async () => (await api.get<{ payroll: { allowPartialPayments: boolean } }>('/hr/settings')).data,
  });
  const allowPartial = settingsQ.data?.payroll?.allowPartialPayments ?? false;
  const [seed, setSeed] = useState(false);
  const [key, setKey] = useState('');
  const [amount, setAmount] = useState('');
  const [mo, setMo] = useState<MoneyOutValue>(EMPTY_MONEY_OUT);
  const [paidAt, setPaidAt] = useState(todayKeyDz());
  const [notes, setNotes] = useState('');
  if (open !== seed) {
    setSeed(open);
    if (open) {
      setKey(newIdempotencyKey('pay'));
      setAmount(remaining.toFixed(2));
      setPaidAt(todayKeyDz());
      setNotes('');
      setMo(EMPTY_MONEY_OUT);
    }
  }

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post<PayResult>(`/hr/payroll/payslips/${slip.id}/payments`, {
          amount: Number(amount),
          ...moneyOutPayload(mo),
          paidAt,
          notes: notes.trim() || null,
          idempotencyKey: key,
        })
      ).data,
    onSuccess: (r) => {
      toast.success(r.duplicate ? 'هذه الدفعة مسجلة مسبقاً — لم يُسجل شيء جديد' : `تم تسجيل دفع ${money(r.payment.amount)}`);
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const n = Number(amount);
  const amountOk = Number.isFinite(n) && n > 0 && n <= remaining + 0.005 && (allowPartial || Math.abs(n - remaining) < 0.005);
  const ok = amountOk && (mo.paymentMethod !== 'CASH_REGISTER' || !!mo.cashRegisterId) && !!paidAt;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`دفع أجر ${slip.employeeSnapshot.fullName}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="gold" disabled={!ok || settingsQ.isLoading} loading={m.isPending} onClick={() => m.mutate()}>
            <Banknote className="h-4 w-4" /> دفع {amountOk ? money(n) : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm">
          الصافي {money(slip.netSalary)} — المدفوع {money(slip.paidAmount)} — <strong>المتبقي {money(remaining)}</strong>
        </p>
        <TextInput
          label="المبلغ (د.ج) · Montant"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          max={remaining}
          value={amount}
          disabled={!allowPartial}
          onChange={(e) => setAmount(e.target.value)}
          hint={allowPartial ? 'يمكن الدفع على أقساط حتى المبلغ المتبقي' : 'الدفع الجزئي غير مفعّل في إعدادات الموارد البشرية — يُدفع المتبقي كاملاً'}
        />
        <MoneyOutFields value={mo} onChange={setMo} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="تاريخ الدفع" type="date" value={paidAt} max={todayKeyDz()} onChange={(e) => setPaidAt(e.target.value)} />
          <TextInput label="ملاحظة" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </div>
        {mo.paymentMethod === 'CASH_REGISTER' ? (
          <Notice>يُسجَّل المبلغ خروجاً في جلسة الصندوق المفتوحة، ويُرفض الدفع إذا كان النقد المتوفر غير كافٍ.</Notice>
        ) : (
          <Notice>دفع خارج الصندوق: لا تُسجل أي حركة في الصندوق، فقط في سجل أجور العامل.</Notice>
        )}
      </div>
    </Modal>
  );
}
