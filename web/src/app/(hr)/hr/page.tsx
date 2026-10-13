'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarOff,
  Clock4,
  Fingerprint,
  HandCoins,
  LayoutDashboard,
  RefreshCw,
  UserCheck,
  UsersRound,
  UserX,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  HrPageHeader,
  money,
  Notice,
  Panel,
  QueryState,
  StatCard,
  StatusBadge,
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import {
  ageLabel,
  dateTimeDz,
  deviceStatus,
  fmtDay,
  fmtMinutes,
  fullName,
  label,
  LIVE_BUCKET_ORDER,
  monthLabel,
} from '@/lib/hr-labels';

type Dashboard = {
  today: string;
  generatedAt: string;
  employees: { total: number; byStatus: Record<string, number> };
  presence: { counts: Record<string, number>; lastSyncAt: string | null; lastEventReceivedAt: string | null };
  devices: {
    id: string;
    name: string;
    provider: string;
    status: string;
    lastConnectionAt: string | null;
    lastSuccessfulSyncAt: string | null;
    lastEventAt: string | null;
  }[];
  rejectedDevices: { id: string; startedAt: string; errorMessage: string | null; details: unknown }[];
  month: { from: string; to: string; lateCount: number; lateMinutes: number; absentDays: number };
  pending: {
    leave: number;
    sickLeave: number;
    absences: number;
    overtime: number;
    overtimeMinutes: number;
    bonuses: number;
    deductions: number;
    attendanceReview: number;
  };
  alerts: {
    contractsEnding: { id: string; employee: { id: string; firstName: string; lastName: string; matricule: string }; endDate: string; contractType: string }[];
    trialsEnding: { id: string; employee: { id: string; firstName: string; lastName: string; matricule: string }; trialEndDate: string }[];
  };
  payroll: { id: string; year: number; month: number; status: string; totalNet: number; totalPaid: number } | null;
  openAdvances: { total: number; count: number } | null;
};

export default function HrDashboardPage() {
  const can = useCan();
  const q = useQuery({
    queryKey: ['hr', 'dashboard'],
    queryFn: async () => (await api.get<Dashboard>('/hr/dashboard')).data,
    refetchInterval: 60_000,
    enabled: can('HR_DASHBOARD_VIEW'),
  });

  if (!can('HR_DASHBOARD_VIEW')) {
    return (
      <div className="space-y-4">
        <HrPageHeader title="الموارد البشرية" fr="Ressources Humaines" icon={UsersRound} />
        <Notice>استعمل القائمة الجانبية للوصول إلى الأقسام المسموح لك بها.</Notice>
      </div>
    );
  }

  const d = q.data;
  const present = (d?.presence.counts.PRESENT ?? 0) + (d?.presence.counts.LATE ?? 0) + (d?.presence.counts.LEFT ?? 0);
  const pendingTotal = d
    ? d.pending.leave + d.pending.sickLeave + d.pending.absences + d.pending.overtime + d.pending.bonuses + d.pending.deductions
    : 0;

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="لوحة التحكم"
        fr="Tableau de bord RH"
        icon={LayoutDashboard}
        subtitle={d ? `${fmtDay(d.today)} · آخر تحديث ${dateTimeDz(d.generatedAt)}` : undefined}
        actions={
          <Button variant="outline" size="sm" onClick={() => void q.refetch()} loading={q.isFetching}>
            <RefreshCw className="h-4 w-4" />
            تحديث
          </Button>
        }
      />

      <QueryState q={q}>
        {d ? (
          <>
            {d.rejectedDevices.length ? (
              <Notice tone="danger">
                <p className="font-bold">
                  جهاز بصمة غير مسجل حاول الاتصال بالخادم ({d.rejectedDevices.length} محاولة خلال 24 ساعة) · Terminal inconnu refusé
                </p>
                <p className="mt-1 text-xs">
                  {d.rejectedDevices[0].errorMessage ?? ''} — أضف الجهاز برقمه التسلسلي في{' '}
                  <Link href="/hr/devices" className="font-bold underline">
                    أجهزة البصمة
                  </Link>
                  .
                </p>
              </Notice>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="العمال النشطون · Effectif" value={d.employees.total} icon={UsersRound} tone="primary" />
              <StatCard
                label="حاضرون اليوم · Présents"
                value={`${present} / ${d.employees.total - (d.employees.byStatus.LEFT ?? 0)}`}
                icon={UserCheck}
                tone="success"
                hint={`متأخرون: ${d.presence.counts.LATE ?? 0} · لم يصلوا: ${d.presence.counts.NOT_ARRIVED ?? 0}`}
              />
              <StatCard
                label="غائبون اليوم · Absents"
                value={d.presence.counts.ABSENT ?? 0}
                icon={UserX}
                tone={(d.presence.counts.ABSENT ?? 0) > 0 ? 'danger' : 'default'}
                hint={`في عطلة: ${(d.presence.counts.LEAVE ?? 0) + (d.presence.counts.SICK_LEAVE ?? 0)}`}
              />
              <StatCard
                label="طلبات في الانتظار · En attente"
                value={pendingTotal}
                icon={AlertTriangle}
                tone={pendingTotal ? 'warning' : 'default'}
                hint={`أيام تحتاج مراجعة: ${d.pending.attendanceReview}`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel
                title="الحضور اليوم · Présence aujourd'hui"
                className="lg:col-span-2"
                action={
                  <Link href="/hr/presence" className="text-xs font-bold text-sky-700 hover:underline dark:text-sky-400">
                    العرض المباشر ←
                  </Link>
                }
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {LIVE_BUCKET_ORDER.map((b) => (
                    <div key={b} className="rounded-xl border border-[var(--app-border)] px-3 py-2">
                      <p className="text-[11px] font-bold text-[var(--app-text-muted)]">{label.bucket(b).ar}</p>
                      <p className="text-xl font-black tabular-nums">{d.presence.counts[b] ?? 0}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-[var(--app-text-dim)]">
                  آخر مزامنة · Dernière synchro : <strong>{d.presence.lastSyncAt ? dateTimeDz(d.presence.lastSyncAt) : '—'}</strong> (
                  {ageLabel(d.presence.lastSyncAt)}) · آخر بصمة مستلمة : {d.presence.lastEventReceivedAt ? dateTimeDz(d.presence.lastEventReceivedAt) : '—'}
                </p>
              </Panel>

              <Panel
                title="أجهزة البصمة · Terminaux"
                action={
                  <Link href="/hr/devices" className="text-xs font-bold text-sky-700 hover:underline dark:text-sky-400">
                    إدارة ←
                  </Link>
                }
              >
                {d.devices.length === 0 ? (
                  <p className="text-sm text-[var(--app-text-dim)]">
                    لا يوجد جهاز بصمة مفعّل. أضف جهاز ZKTeco من صفحة الأجهزة.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {d.devices.map((dev) => {
                      const s = deviceStatus(dev.status);
                      return (
                        <li key={dev.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-bold">
                            {s.dot} {dev.name}
                          </span>
                          <span className="text-[11px] text-[var(--app-text-dim)]">
                            {s.fr} · {ageLabel(dev.lastConnectionAt ?? dev.lastEventAt)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title={`هذا الشهر · Ce mois (${fmtDay(d.month.from)} → ${fmtDay(d.month.to)})`}>
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between">
                    <span>
                      <Clock4 className="ml-1 inline h-4 w-4" />
                      التأخرات · Retards
                    </span>
                    <strong className="tabular-nums">
                      {d.month.lateCount} ({fmtMinutes(d.month.lateMinutes)})
                    </strong>
                  </li>
                  <li className="flex justify-between">
                    <span>
                      <UserX className="ml-1 inline h-4 w-4" />
                      أيام الغياب · Jours d&apos;absence
                    </span>
                    <strong className="tabular-nums">{d.month.absentDays}</strong>
                  </li>
                </ul>
              </Panel>

              <Panel title="في انتظار القرار · À traiter">
                <ul className="space-y-1.5 text-sm">
                  <PendingRow href="/hr/leave" text="طلبات عطلة" n={d.pending.leave} />
                  <PendingRow href="/hr/sick-leave" text="عطل مرضية" n={d.pending.sickLeave} />
                  <PendingRow href="/hr/absences" text="غيابات" n={d.pending.absences} />
                  <PendingRow
                    href="/hr/overtime"
                    text={`ساعات إضافية (${fmtMinutes(d.pending.overtimeMinutes)})`}
                    n={d.pending.overtime}
                  />
                  <PendingRow href="/hr/bonuses" text="منح" n={d.pending.bonuses} />
                  <PendingRow href="/hr/deductions" text="اقتطاعات" n={d.pending.deductions} />
                  <PendingRow href="/hr/attendance?needsReview=1" text="أيام حضور تحتاج مراجعة" n={d.pending.attendanceReview} />
                </ul>
              </Panel>

              <Panel title="الأجور · Paie">
                {d.payroll ? (
                  <div className="space-y-2 text-sm">
                    <p className="flex items-center justify-between">
                      <Link href={`/hr/payroll/${d.payroll.id}`} className="font-bold hover:underline">
                        {monthLabel(d.payroll.year, d.payroll.month)}
                      </Link>
                      <StatusBadge l={label.payroll(d.payroll.status)} />
                    </p>
                    <p className="flex justify-between">
                      <span>الصافي · Net</span>
                      <strong className="tabular-nums">{money(d.payroll.totalNet)}</strong>
                    </p>
                    <p className="flex justify-between">
                      <span>المدفوع · Payé</span>
                      <strong className="tabular-nums">{money(d.payroll.totalPaid)}</strong>
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--app-text-dim)]">
                    {can('HR_SALARIES_VIEW') || can('HR_PAYROLL_VIEW') ? 'لا توجد فترة أجور بعد.' : 'غير متاح (صلاحية الرواتب).'}
                  </p>
                )}
                {d.openAdvances ? (
                  <p className="mt-3 flex items-center justify-between border-t border-[var(--app-border)] pt-2 text-sm">
                    <span>
                      <HandCoins className="ml-1 inline h-4 w-4" />
                      تسبيقات مفتوحة ({d.openAdvances.count})
                    </span>
                    <strong className="tabular-nums">{money(d.openAdvances.total)}</strong>
                  </p>
                ) : null}
                {can('HR_PAYROLL_VIEW') ? (
                  <Link href="/hr/payroll" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-sky-700 hover:underline dark:text-sky-400">
                    <Wallet className="h-3.5 w-3.5" /> فترات الأجور ←
                  </Link>
                ) : null}
              </Panel>
            </div>

            {d.alerts.contractsEnding.length || d.alerts.trialsEnding.length ? (
              <Panel title="تنبيهات العقود · Alertes contrats">
                <ul className="space-y-1.5 text-sm">
                  {d.alerts.contractsEnding.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <Link href={`/hr/employees/${c.employee.id}`} className="font-bold hover:underline">
                        {fullName(c.employee)} ({c.employee.matricule})
                      </Link>
                      <span className="text-xs">
                        {label.contractType(c.contractType).fr} ينتهي في {fmtDay(c.endDate)}
                      </span>
                    </li>
                  ))}
                  {d.alerts.trialsEnding.map((c) => (
                    <li key={`t-${c.id}`} className="flex items-center justify-between gap-2">
                      <Link href={`/hr/employees/${c.employee.id}`} className="font-bold hover:underline">
                        {fullName(c.employee)} ({c.employee.matricule})
                      </Link>
                      <span className="text-xs">نهاية فترة التجربة {fmtDay(c.trialEndDate)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            <div className="flex flex-wrap gap-2 text-xs">
              <QuickLink href="/hr/employees" icon={UsersRound} text="العمال" />
              <QuickLink href="/hr/leave" icon={CalendarOff} text="العطل" />
              <QuickLink href="/hr/devices" icon={Fingerprint} text="أجهزة البصمة" />
            </div>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}

function PendingRow({ href, text, n }: { href: string; text: string; n: number }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-[var(--app-bg-muted)]">
        <span>{text}</span>
        <span
          className={`min-w-[1.75rem] rounded-full px-2 text-center text-xs font-black tabular-nums ${
            n ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200' : 'text-[var(--app-text-dim)]'
          }`}
        >
          {n}
        </span>
      </Link>
    </li>
  );
}

function QuickLink({ href, icon: Icon, text }: { href: string; icon: typeof UsersRound; text: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 font-bold hover:border-sky-600"
    >
      <Icon className="h-4 w-4 text-sky-700" />
      {text}
    </Link>
  );
}
