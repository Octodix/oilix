'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileSignature,
  Fingerprint,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CorrectionModal, JustifyLateModal, type CorrectionTarget, type LateTarget } from '@/components/hr/attendance-modals';
import { ContractFormModal, TerminateContractModal, type Contract } from '@/components/hr/contract-form';
import { EmployeeFormModal, type EmployeeDetail } from '@/components/hr/employee-form';
import {
  apiError,
  BiLabel,
  HrPageHeader,
  Modal,
  money,
  Notice,
  Panel,
  QueryState,
  ReasonModal,
  Select,
  StatCard,
  StatusBadge,
  Table,
  Td,
  TextInput,
  Th,
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import {
  dateTimeDz,
  fmtDay,
  fmtMinutes,
  fullName,
  label,
  monthLabel,
  shiftMonth,
  timeDz,
  toNum,
  todayKeyDz,
  WEEKDAYS,
  weekdayOf,
} from '@/lib/hr-labels';
import { cn } from '@/lib/utils';

type Employee = EmployeeDetail & {
  department: { id: string; name: string } | null;
  user: { id: string; username: string; firstName: string | null; lastName: string | null } | null;
  contracts: Contract[];
  deviceMappings: {
    id: string;
    deviceId: string;
    deviceUserId: string;
    deviceUserName: string | null;
    device: { id: string; name: string; provider: string };
  }[];
  salaryVisible: boolean;
};

type Tab = 'profile' | 'contracts' | 'month' | 'devices';

const TABS: Tab[] = ['profile', 'contracts', 'month', 'devices'];

export default function EmployeePage() {
  return (
    <Suspense fallback={null}>
      <EmployeeBody />
    </Suspense>
  );
}

function EmployeeBody() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const can = useCan();
  const qc = useQueryClient();
  const initialTab = sp.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(initialTab && TABS.includes(initialTab) ? initialTab : 'profile');
  const initialYear = Number(sp.get('year'));
  const initialMonth = Number(sp.get('month'));
  const initialYm =
    Number.isInteger(initialYear) && initialYear > 2000 && Number.isInteger(initialMonth) && initialMonth >= 1 && initialMonth <= 12
      ? { year: initialYear, month: initialMonth }
      : undefined;
  const [editing, setEditing] = useState(false);

  const q = useQuery({
    queryKey: ['hr', 'employee', id],
    queryFn: async () => (await api.get<Employee>(`/hr/employees/${id}`)).data,
  });

  const archive = useMutation({
    mutationFn: async (archived: boolean) => (await api.post(`/hr/employees/${id}/archive`, { archived })).data,
    onSuccess: (_d, archived) => {
      toast.success(archived ? 'تمت أرشفة العامل' : 'تم إلغاء الأرشفة');
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const e = q.data;
  const tabs: { id: Tab; ar: string; fr: string; show: boolean }[] = [
    { id: 'profile', ar: 'الملف', fr: 'Profil', show: true },
    { id: 'contracts', ar: 'العقود', fr: 'Contrats', show: true },
    { id: 'month', ar: 'الحضور الشهري', fr: 'Présence', show: can('HR_ATTENDANCE_VIEW') },
    { id: 'devices', ar: 'البصمة', fr: 'Pointeuse', show: true },
  ];

  return (
    <div className="space-y-4">
      <Link href="/hr/employees" className="no-print inline-flex items-center gap-1 text-sm font-semibold text-[var(--app-text-dim)] hover:text-[var(--app-text)]">
        <ArrowRight className="h-4 w-4" /> العمال
      </Link>
      <QueryState q={q}>
        {e ? (
          <>
            <HrPageHeader
              title={fullName(e)}
              fr={e.matricule}
              icon={UserRound}
              subtitle={
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge l={label.employee(e.status)} />
                  {e.archivedAt ? <span className="text-xs font-bold text-[var(--app-text-dim)]">مؤرشف · Archivé</span> : null}
                  <span>{e.department?.name ?? ''}{e.jobTitle ? ` · ${e.jobTitle}` : ''}</span>
                </span>
              }
              actions={
                <>
                  {can('HR_EMPLOYEES_EDIT') && !e.archivedAt ? (
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                      <Pencil className="h-4 w-4" /> تعديل
                    </Button>
                  ) : null}
                  {can('HR_EMPLOYEES_ARCHIVE') && (e.status === 'LEFT' || e.archivedAt) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={archive.isPending}
                      onClick={() => archive.mutate(!e.archivedAt)}
                      title="الأرشفة متاحة فقط للعمال الذين غادروا"
                    >
                      {e.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      {e.archivedAt ? 'إلغاء الأرشفة' : 'أرشفة'}
                    </Button>
                  ) : null}
                </>
              }
            />

            <div className="no-print flex flex-wrap gap-1 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-1">
              {tabs
                .filter((t) => t.show)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'rounded-xl px-4 py-2 text-sm font-bold transition',
                      tab === t.id ? 'bg-sky-700 text-white' : 'text-[var(--app-text-muted)] hover:bg-[var(--app-bg-muted)]',
                    )}
                  >
                    {t.ar} <span className="text-xs opacity-70">· {t.fr}</span>
                  </button>
                ))}
            </div>

            {tab === 'profile' ? <ProfileTab e={e} /> : null}
            {tab === 'contracts' ? <ContractsTab e={e} /> : null}
            {tab === 'month' ? <MonthTab e={e} initial={initialYm} /> : null}
            {tab === 'devices' ? <DevicesTab e={e} /> : null}

            <EmployeeFormModal open={editing} onClose={() => setEditing(false)} employee={e} />
          </>
        ) : null}
      </QueryState>
    </div>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-[var(--app-text-dim)]">{k}</dt>
      <dd className="truncate text-sm font-bold text-[var(--app-text)]">{v || '—'}</dd>
    </div>
  );
}

function ProfileTab({ e }: { e: Employee }) {
  const current = e.contracts.find((c) => c.status === 'ACTIVE');
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <Panel>
        <div className="flex flex-col items-center gap-3 text-center">
          {e.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.photo} alt="" className="h-40 w-40 rounded-2xl object-cover" />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center rounded-2xl bg-[var(--app-bg-muted)] text-[var(--app-text-dim)]">
              <UserRound className="h-16 w-16" />
            </div>
          )}
          <div>
            <p className="font-black">{fullName(e)}</p>
            <p className="text-xs text-[var(--app-text-dim)]">{e.matricule}</p>
          </div>
        </div>
      </Panel>
      <div className="space-y-4">
        <Panel title="الهوية · Identité">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Info k="تاريخ الميلاد · Naissance" v={fmtDay(e.birthDate)} />
            <Info k="الهاتف · Téléphone" v={e.phone ? <span dir="ltr">{e.phone}</span> : null} />
            <Info k="العنوان · Adresse" v={e.address} />
            <Info k="رقم بطاقة التعريف · CNI" v={e.nationalIdNumber} />
            <Info k="تاريخ الإصدار · Délivrée le" v={fmtDay(e.nationalIdIssuedAt)} />
            <Info k="جهة الإصدار · Par" v={e.nationalIdIssuedBy} />
            <Info k="رقم الضمان الاجتماعي · N° SS" v={e.socialSecurityNumber} />
            <Info
              k="شخص للطوارئ · Urgence"
              v={
                e.emergencyContactName
                  ? `${e.emergencyContactName}${e.emergencyContactRelation ? ` (${e.emergencyContactRelation})` : ''} ${e.emergencyContactPhone ?? ''}`
                  : null
              }
            />
          </dl>
        </Panel>
        <Panel title="العمل · Emploi">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Info k="القسم · Service" v={e.department?.name} />
            <Info k="المنصب · Poste" v={e.jobTitle} />
            <Info k="موقع العمل · Site" v={e.workSite} />
            <Info k="تاريخ التوظيف · Embauche" v={fmtDay(e.hireDate)} />
            <Info k="طريقة الدفع · Paiement" v={label.payment(e.paymentMethod).ar} />
            <Info k="الحساب البنكي · Compte" v={e.bankAccount ? <span dir="ltr">{e.bankAccount}</span> : null} />
            <Info k="مستخدم Oilix" v={e.user ? `${e.user.username}` : null} />
            <Info
              k="العقد الحالي · Contrat"
              v={current ? `${label.contractType(current.contractType).fr}${current.endDate ? ` → ${fmtDay(current.endDate)}` : ''}` : null}
            />
            {e.salaryVisible && current ? (
              <Info k="الأجر الأساسي · Salaire" v={`${money(current.baseSalary)} (${label.salaryMode(current.salaryMode).ar})`} />
            ) : null}
            {e.status === 'LEFT' ? (
              <>
                <Info k="تاريخ المغادرة · Départ" v={fmtDay(e.leftAt)} />
                <Info k="سبب المغادرة · Motif" v={e.leftReason} />
              </>
            ) : null}
          </dl>
          {!current ? <Notice tone="warning" className="mt-3">لا يوجد عقد ساري — لن يُحسب أجر لهذا العامل حتى يُنشأ عقد.</Notice> : null}
        </Panel>
        {e.notes ? (
          <Panel title="ملاحظات · Notes">
            <p className="whitespace-pre-wrap text-sm">{e.notes}</p>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function ContractsTab({ e }: { e: Employee }) {
  const can = useCan();
  const [form, setForm] = useState<{ open: boolean; contract: Contract | null }>({ open: false, contract: null });
  const [terminating, setTerminating] = useState<Contract | null>(null);
  const manage = can('HR_CONTRACTS_MANAGE');
  return (
    <Panel
      title="العقود · Contrats"
      bodyClassName="p-0"
      action={
        manage && e.status !== 'LEFT' ? (
          <Button size="sm" onClick={() => setForm({ open: true, contract: null })}>
            <Plus className="h-4 w-4" /> عقد جديد
          </Button>
        ) : null
      }
    >
      {e.contracts.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--app-text-dim)]">لا توجد عقود</p>
      ) : (
        <Table minWidth={860}>
          <thead>
            <tr>
              <Th>النوع</Th>
              <Th>الفترة</Th>
              <Th>الأجر</Th>
              <Th>ساعات/أسبوع</Th>
              <Th>المنصب</Th>
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {e.contracts.map((c) => (
              <tr key={c.id}>
                <Td>
                  <p className="font-bold">{label.contractType(c.contractType).fr}</p>
                  {c.documentRef ? <p className="text-[11px] text-[var(--app-text-dim)]">{c.documentRef}</p> : null}
                </Td>
                <Td className="text-xs tabular-nums">
                  {fmtDay(c.startDate)} → {c.endDate ? fmtDay(c.endDate) : 'غير محدد'}
                  {c.trialEndDate ? <p className="text-[var(--app-text-dim)]">تجربة حتى {fmtDay(c.trialEndDate)}</p> : null}
                </Td>
                <Td className="tabular-nums">
                  {c.baseSalary != null ? money(c.baseSalary) : '••••'}
                  <p className="text-[11px] text-[var(--app-text-dim)]">{label.salaryMode(c.salaryMode).ar}</p>
                </Td>
                <Td className="tabular-nums">{toNum(c.weeklyHours)}</Td>
                <Td className="text-xs">{c.jobTitle ?? '—'}</Td>
                <Td>
                  <StatusBadge l={label.contractStatus(c.status)} />
                  {c.terminationReason ? <p className="mt-1 text-[11px] text-[var(--app-text-dim)]">{c.terminationReason}</p> : null}
                </Td>
                <Td>
                  {manage && c.status === 'ACTIVE' ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setForm({ open: true, contract: c })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setTerminating(c)} title="فسخ">
                        <FileSignature className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ContractFormModal open={form.open} contract={form.contract} employeeId={e.id} onClose={() => setForm({ open: false, contract: null })} />
      <TerminateContractModal contract={terminating} onClose={() => setTerminating(null)} />
    </Panel>
  );
}

type MonthData = {
  summary: Record<string, number>;
  days: {
    id: string;
    date: string;
    status: string;
    flags: string[];
    scheduleName: string | null;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    firstIn: string | null;
    lastOut: string | null;
    punchCount: number;
    workedMinutes: number;
    lateMinutes: number;
    lateJustified: boolean;
    earlyLeaveMinutes: number;
    overtimeMinutes: number;
    needsReview: boolean;
    isCorrected: boolean;
  }[];
  events: { id: string; punchedAt: string; localTime: string; verifyMethod: string | null; device: { name: string } | null; source: string }[];
  corrections: {
    id: string;
    date: string;
    checkIn: string | null;
    checkOut: string | null;
    status: string | null;
    reason: string;
    createdByName: string | null;
    createdAt: string;
    revokedAt: string | null;
    revokedByName: string | null;
    revokeReason: string | null;
  }[];
  payslip: { id: string; netSalary: string; paidAmount: string; paymentStatus: string; period: { id: string; status: string } } | null;
};

function MonthTab({ e, initial }: { e: Employee; initial?: { year: number; month: number } }) {
  const can = useCan();
  const qc = useQueryClient();
  const today = todayKeyDz();
  const [ym, setYm] = useState(initial ?? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const [correcting, setCorrecting] = useState<CorrectionTarget | null>(null);
  const [justifying, setJustifying] = useState<LateTarget | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showPunches, setShowPunches] = useState(false);

  const q = useQuery({
    queryKey: ['hr', 'employee-month', e.id, ym.year, ym.month],
    queryFn: async () => (await api.get<MonthData>(`/hr/employees/${e.id}/month`, { params: ym })).data,
  });

  const revoke = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await api.post(`/hr/attendance/corrections/${id}/revoke`, { reason })).data,
    onSuccess: () => {
      toast.success('تم إلغاء التصحيح');
      setRevoking(null);
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (err) => toast.error(apiError(err)),
  });

  const correct = can('HR_ATTENDANCE_CORRECT');
  const s = q.data?.summary;
  const eventsByDay = new Map<string, MonthData['events']>();
  for (const ev of q.data?.events ?? []) {
    const k = ev.localTime.slice(0, 10);
    eventsByDay.set(k, [...(eventsByDay.get(k) ?? []), ev]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setYm(shiftMonth(ym.year, ym.month, -1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="min-w-[9rem] text-center font-black">{monthLabel(ym.year, ym.month)}</span>
        <Button size="sm" variant="outline" onClick={() => setYm(shiftMonth(ym.year, ym.month, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <label className="mr-auto flex items-center gap-2 text-xs">
          <input type="checkbox" checked={showPunches} onChange={(ev) => setShowPunches(ev.target.checked)} />
          إظهار كل البصمات الخام
        </label>
        {correct ? (
          <Button size="sm" variant="outline" onClick={() => setCorrecting({ employeeId: e.id, employeeName: fullName(e) })}>
            <Wrench className="h-4 w-4" /> تصحيح يوم
          </Button>
        ) : null}
      </div>

      <QueryState q={q}>
        {q.data && s ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <StatCard label="أيام الحضور · Présence" value={`${s.presentDays} / ${s.employedWorkingDays}`} tone="success" />
              <StatCard label="الغياب · Absences" value={s.absentDays} tone={s.absentDays ? 'danger' : 'default'} hint={s.authorizedAbsenceDays ? `مرخص: ${s.authorizedAbsenceDays}` : undefined} />
              <StatCard label="التأخر · Retards" value={s.lateCount} tone={s.lateCount ? 'warning' : 'default'} hint={fmtMinutes(s.lateMinutes)} />
              <StatCard label="العطل · Congés" value={s.leaveDays + s.sickDays} hint={`مرضية: ${s.sickDays}`} />
              <StatCard label="ساعات العمل · Travaillé" value={fmtMinutes(s.workedMinutes)} hint={`المتوقع ${fmtMinutes(s.expectedMinutes)}`} />
              <StatCard
                label="إضافية · Heures sup."
                value={fmtMinutes(s.overtimeApprovedMinutes)}
                tone="primary"
                hint={s.overtimePendingMinutes ? `في الانتظار ${fmtMinutes(s.overtimePendingMinutes)}` : undefined}
              />
            </div>
            {s.missingPunchDays ? (
              <Notice tone="warning">{s.missingPunchDays} يوم ببصمة ناقصة — يجب تصحيحها قبل المصادقة على الأجور.</Notice>
            ) : null}
            {q.data.payslip ? (
              <Notice>
                كشف أجر هذا الشهر: الصافي {money(q.data.payslip.netSalary)} — مدفوع {money(q.data.payslip.paidAmount)} ({label.payslipPayment(q.data.payslip.paymentStatus).ar}) —{' '}
                <Link className="font-bold underline" href={`/hr/payroll/payslips/${q.data.payslip.id}`}>
                  فتح الكشف
                </Link>
              </Notice>
            ) : null}

            <Table minWidth={1040}>
              <thead>
                <tr>
                  <Th>اليوم</Th>
                  <Th>الحالة</Th>
                  <Th>التوقيت</Th>
                  <Th>دخول</Th>
                  <Th>خروج</Th>
                  <Th>العمل</Th>
                  <Th>تأخر</Th>
                  <Th>إضافي</Th>
                  <Th>ملاحظات</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {q.data.days.map((d) => (
                  <tr key={d.id} className={cn(d.needsReview && 'bg-amber-50/60 dark:bg-amber-950/20')}>
                    <Td className="whitespace-nowrap text-xs tabular-nums">
                      <span className="font-bold">{fmtDay(d.date)}</span>{' '}
                      <span className="text-[var(--app-text-dim)]">{WEEKDAYS[weekdayOf(d.date)].ar}</span>
                    </Td>
                    <Td>
                      <StatusBadge l={label.attendance(d.status)} />
                    </Td>
                    <Td className="text-xs tabular-nums">
                      {d.scheduledStart ? `${timeDz(d.scheduledStart)}–${timeDz(d.scheduledEnd)}` : '—'}
                    </Td>
                    <Td className="tabular-nums">{timeDz(d.firstIn) || '—'}</Td>
                    <Td className="tabular-nums">{timeDz(d.lastOut) || '—'}</Td>
                    <Td className="tabular-nums">{d.workedMinutes ? fmtMinutes(d.workedMinutes) : '—'}</Td>
                    <Td className="tabular-nums">
                      {d.lateMinutes ? (
                        <span className={d.lateJustified ? 'text-[var(--app-text-dim)] line-through' : 'font-bold text-amber-700 dark:text-amber-400'}>
                          {d.lateMinutes} د
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="tabular-nums">{d.overtimeMinutes ? fmtMinutes(d.overtimeMinutes) : '—'}</Td>
                    <Td className="max-w-[16rem] text-[11px]">
                      <div className="flex flex-wrap gap-1">
                        {d.flags.map((f) => (
                          <StatusBadge key={f} l={label.flag(f)} />
                        ))}
                      </div>
                      {showPunches && eventsByDay.get(d.date)?.length ? (
                        <p className="mt-1 text-[var(--app-text-dim)]" dir="ltr">
                          {eventsByDay
                            .get(d.date)!
                            .map((ev) => ev.localTime.slice(11, 16))
                            .join(' · ')}
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      {correct && d.date <= today && d.status !== 'NOT_EMPLOYED' ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="تصحيح"
                            onClick={() =>
                              setCorrecting({ employeeId: e.id, employeeName: fullName(e), date: d.date, firstIn: d.firstIn, lastOut: d.lastOut })
                            }
                          >
                            <Wrench className="h-4 w-4" />
                          </Button>
                          {d.lateMinutes ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="تبرير التأخر"
                              onClick={() =>
                                setJustifying({ dayId: d.id, employeeName: fullName(e), date: d.date, lateMinutes: d.lateMinutes, lateJustified: d.lateJustified })
                              }
                            >
                              ✓
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {q.data.corrections.length ? (
              <Panel title="سجل التصحيحات · Corrections" bodyClassName="p-0">
                <Table minWidth={820}>
                  <thead>
                    <tr>
                      <Th>اليوم</Th>
                      <Th>التصحيح</Th>
                      <Th>السبب</Th>
                      <Th>بواسطة</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.corrections.map((c) => (
                      <tr key={c.id} className={cn(c.revokedAt && 'opacity-60')}>
                        <Td className="text-xs tabular-nums">{fmtDay(c.date)}</Td>
                        <Td className="text-xs">
                          {c.checkIn ? `دخول ${timeDz(c.checkIn)} ` : ''}
                          {c.checkOut ? `خروج ${timeDz(c.checkOut)} ` : ''}
                          {c.status ? <BiLabel l={label.attendance(c.status)} /> : null}
                        </Td>
                        <Td className="text-xs">{c.reason}</Td>
                        <Td className="text-xs">
                          {c.createdByName ?? '—'}
                          <p className="text-[var(--app-text-dim)]">{dateTimeDz(c.createdAt)}</p>
                        </Td>
                        <Td className="text-xs">
                          {c.revokedAt ? (
                            <span>
                              ملغى بواسطة {c.revokedByName}: {c.revokeReason}
                            </span>
                          ) : correct ? (
                            <Button size="sm" variant="ghost" onClick={() => setRevoking(c.id)}>
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          ) : null}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Panel>
            ) : null}
          </>
        ) : null}
      </QueryState>

      <CorrectionModal target={correcting} onClose={() => setCorrecting(null)} />
      <JustifyLateModal target={justifying} onClose={() => setJustifying(null)} />
      <ReasonModal
        open={!!revoking}
        title="إلغاء التصحيح · Annuler la correction"
        description="سيُعاد حساب اليوم من البصمات الخام."
        danger
        busy={revoke.isPending}
        onClose={() => setRevoking(null)}
        onConfirm={(reason) => revoking && revoke.mutate({ id: revoking, reason })}
      />
    </div>
  );
}

function DevicesTab({ e }: { e: Employee }) {
  const can = useCan();
  const qc = useQueryClient();
  const manage = can('HR_DEVICES_MANAGE');
  const [linking, setLinking] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [deviceUserId, setDeviceUserId] = useState('');

  const devices = useQuery({
    queryKey: ['hr', 'devices'],
    queryFn: async () => (await api.get<{ id: string; name: string; enabled: boolean }[]>('/hr/devices')).data,
    enabled: manage,
  });

  const link = useMutation({
    mutationFn: async () => (await api.post(`/hr/devices/${deviceId}/mappings`, { employeeId: e.id, deviceUserId: deviceUserId.trim() })).data,
    onSuccess: (r: { relinked?: number }) => {
      toast.success(`تم الربط${r?.relinked ? ` — ${r.relinked} بصمة سابقة رُبطت بالعامل` : ''}`);
      setLinking(false);
      setDeviceUserId('');
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (err) => toast.error(apiError(err)),
  });

  const unlink = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/devices/mappings/${id}`)).data,
    onSuccess: () => {
      toast.success('تم فك الربط');
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (err) => toast.error(apiError(err)),
  });

  return (
    <Panel
      title="الربط مع جهاز البصمة · Liaison pointeuse"
      action={
        manage ? (
          <Button size="sm" onClick={() => setLinking(true)}>
            <Fingerprint className="h-4 w-4" /> ربط معرّف
          </Button>
        ) : null
      }
    >
      <Notice className="mb-3">
        الربط يتم بالمعرّف الرقمي للمستخدم في الجهاز (User ID / PIN)، وليس بالاسم. صور وقوالب البصمات لا تُنسخ إلى Oilix.
      </Notice>
      {e.deviceMappings.length === 0 ? (
        <p className="py-4 text-center text-sm text-amber-700 dark:text-amber-400">هذا العامل غير مربوط بأي جهاز — بصماته لن تُحتسب.</p>
      ) : (
        <ul className="divide-y divide-[var(--app-border)]">
          {e.deviceMappings.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="font-bold">
                  {m.device.name} — المعرّف <span dir="ltr" className="font-mono">{m.deviceUserId}</span>
                </p>
                <p className="text-xs text-[var(--app-text-dim)]">
                  {label.provider(m.device.provider).fr}
                  {m.deviceUserName ? ` · الاسم في الجهاز: ${m.deviceUserName}` : ''}
                </p>
              </div>
              {manage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={unlink.isPending && unlink.variables === m.id}
                  onClick={() => {
                    if (confirm('فك الربط؟ البصمات السابقة ستصبح غير مربوطة (لن تُحذف).')) unlink.mutate(m.id);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={linking}
        onClose={() => setLinking(false)}
        title="ربط معرّف جهاز · Lier un ID pointeuse"
        footer={
          <>
            <Button variant="outline" onClick={() => setLinking(false)}>
              إلغاء
            </Button>
            <Button disabled={!deviceId || !/^[A-Za-z0-9_.-]{1,32}$/.test(deviceUserId.trim())} loading={link.isPending} onClick={() => link.mutate()}>
              ربط
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select label="الجهاز · Pointeuse" value={deviceId} onChange={(ev) => setDeviceId(ev.target.value)}>
            <option value="">— اختر —</option>
            {(devices.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <TextInput
            label="المعرّف في الجهاز · User ID"
            value={deviceUserId}
            onChange={(ev) => setDeviceUserId(ev.target.value)}
            dir="ltr"
            maxLength={32}
            hint="الرقم الظاهر في الجهاز: Menu → User Mgt → المستخدم"
          />
          <p className="text-xs text-[var(--app-text-dim)]">
            يمكن أيضاً الربط من صفحة الجهاز حيث تظهر المعرّفات غير المربوطة التي أرسلت بصمات.
          </p>
        </div>
      </Modal>
    </Panel>
  );
}
