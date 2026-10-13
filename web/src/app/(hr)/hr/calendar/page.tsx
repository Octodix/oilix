'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DepartmentSelect, EmployeeCell, HrPageHeader, Modal, Panel, QueryState, StatusBadge } from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { ATTENDANCE_STATUS, fmtDay, fmtMinutes, label, monthLabel, shiftMonth, todayKeyDz, WEEKDAYS, weekdayOf } from '@/lib/hr-labels';
import { cn } from '@/lib/utils';

type Cell = {
  id: string;
  employeeId: string;
  date: string;
  status: string;
  isLate: boolean;
  lateMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  needsReview: boolean;
  isCorrected: boolean;
};
type CalendarData = {
  year: number;
  month: number;
  dates: string[];
  employees: { id: string; matricule: string; firstName: string; lastName: string; status: string }[];
  grid: Record<string, Record<string, Cell>>;
  holidays: { id: string; date: string; name: string }[];
};

const CELL: Record<string, { short: string; cls: string }> = {
  PRESENT: { short: 'ح', cls: 'bg-emerald-500 text-white' },
  LATE: { short: 'ت', cls: 'bg-amber-500 text-white' },
  ABSENT: { short: 'غ', cls: 'bg-red-600 text-white' },
  MISSING_PUNCH: { short: '!', cls: 'bg-orange-400 text-white' },
  IN_PROGRESS: { short: '•', cls: 'bg-sky-500 text-white' },
  NOT_ARRIVED: { short: '…', cls: 'bg-stone-300 text-stone-700' },
  UPCOMING: { short: '', cls: 'bg-stone-100 dark:bg-stone-800' },
  LEAVE: { short: 'ع', cls: 'bg-sky-600 text-white' },
  SICK_LEAVE: { short: 'م', cls: 'bg-violet-600 text-white' },
  AUTHORIZED_ABSENCE: { short: 'ر', cls: 'bg-yellow-400 text-stone-900' },
  REST_DAY: { short: '', cls: 'bg-stone-200 dark:bg-stone-700' },
  HOLIDAY: { short: 'ر', cls: 'bg-teal-500 text-white' },
  NOT_EMPLOYED: { short: '', cls: 'bg-transparent' },
};

export default function CalendarPage() {
  const today = todayKeyDz();
  const [ym, setYm] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const [departmentId, setDepartmentId] = useState('');
  const [open, setOpen] = useState<{ cell: Cell; name: string } | null>(null);

  const q = useQuery({
    queryKey: ['hr', 'calendar', ym, departmentId],
    queryFn: async () =>
      (await api.get<CalendarData>('/hr/attendance/calendar', { params: { ...ym, ...(departmentId ? { departmentId } : {}) } })).data,
  });
  const data = q.data;
  const holidayByDate = new Map((data?.holidays ?? []).map((h) => [h.date.slice(0, 10), h.name]));

  return (
    <div className="space-y-4">
      <HrPageHeader title="الرزنامة الشهرية" fr="Calendrier de présence" icon={CalendarDays} subtitle="انقر على أي يوم لعرض تفاصيله." />
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setYm(shiftMonth(ym.year, ym.month, -1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="min-w-[10rem] text-center font-black">{monthLabel(ym.year, ym.month)}</span>
            <Button size="sm" variant="outline" onClick={() => setYm(shiftMonth(ym.year, ym.month, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
          <div className="w-64">
            <DepartmentSelect value={departmentId} onChange={setDepartmentId} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {Object.entries(CELL)
            .filter(([k]) => !['UPCOMING', 'NOT_EMPLOYED', 'NOT_ARRIVED'].includes(k))
            .map(([k, v]) => (
              <span key={k} className="flex items-center gap-1">
                <span className={cn('inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold', v.cls)}>{v.short}</span>
                {ATTENDANCE_STATUS[k]?.ar ?? k}
              </span>
            ))}
        </div>
      </Panel>

      <QueryState q={q} empty={!data?.employees.length} emptyText="لا يوجد عمال في هذا الشهر">
        {data ? (
          <Panel bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-max min-w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky right-0 z-10 bg-[var(--app-surface)] px-3 py-2 text-right">العامل</th>
                    {data.dates.map((d) => (
                      <th
                        key={d}
                        title={holidayByDate.get(d)}
                        className={cn('px-0.5 py-1 text-center font-bold', weekdayOf(d) === 5 && 'text-red-600', holidayByDate.has(d) && 'text-teal-600', d === today && 'underline')}
                      >
                        <div>{Number(d.slice(8, 10))}</div>
                        <div className="text-[9px] font-normal opacity-70">{WEEKDAYS[weekdayOf(d)].ar.slice(0, 2)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((e) => (
                    <tr key={e.id} className="border-t border-[var(--app-border)]">
                      <td className="sticky right-0 z-10 max-w-[12rem] bg-[var(--app-surface)] px-3 py-1">
                        <Link href={`/hr/employees/${e.id}?tab=month&year=${ym.year}&month=${ym.month}`} className="hover:underline">
                          <EmployeeCell e={e} />
                        </Link>
                      </td>
                      {data.dates.map((d) => {
                        const c = data.grid[e.id]?.[d];
                        const style = c ? (CELL[c.status] ?? { short: '?', cls: 'bg-stone-300' }) : { short: '', cls: '' };
                        return (
                          <td key={d} className="p-0.5 text-center">
                            {c && c.status !== 'NOT_EMPLOYED' ? (
                              <button
                                type="button"
                                onClick={() => setOpen({ cell: c, name: `${e.lastName} ${e.firstName}` })}
                                className={cn(
                                  'relative h-6 w-6 rounded text-[10px] font-black',
                                  style.cls,
                                  c.needsReview && 'ring-2 ring-orange-500',
                                  c.isCorrected && 'outline outline-1 outline-offset-1 outline-amber-700',
                                )}
                                title={`${fmtDay(d)} — ${label.attendance(c.status).ar}`}
                              >
                                {style.short}
                              </button>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}
      </QueryState>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.name} — ${fmtDay(open.cell.date)}` : ''}>
        {open ? (
          <div className="space-y-3 text-sm">
            <StatusBadge l={label.attendance(open.cell.status)} />
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-[var(--app-text-dim)]">ساعات العمل</dt>
              <dd>{fmtMinutes(open.cell.workedMinutes)}</dd>
              <dt className="text-[var(--app-text-dim)]">التأخر</dt>
              <dd>{open.cell.isLate ? fmtMinutes(open.cell.lateMinutes) : '—'}</dd>
              <dt className="text-[var(--app-text-dim)]">ساعات إضافية محسوبة</dt>
              <dd>{open.cell.overtimeMinutes ? fmtMinutes(open.cell.overtimeMinutes) : '—'}</dd>
              <dt className="text-[var(--app-text-dim)]">ملاحظات</dt>
              <dd>
                {open.cell.needsReview ? 'يحتاج مراجعة · ' : ''}
                {open.cell.isCorrected ? 'مصحح يدوياً' : ''}
                {!open.cell.needsReview && !open.cell.isCorrected ? '—' : ''}
              </dd>
            </dl>
            <Link
              href={`/hr/employees/${open.cell.employeeId}?tab=month&year=${ym.year}&month=${ym.month}`}
              className="inline-block font-bold text-sky-700 hover:underline"
            >
              عرض الشهر كاملاً مع البصمات والتصحيحات ←
            </Link>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
