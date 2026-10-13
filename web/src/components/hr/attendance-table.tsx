'use client';

import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CorrectionTarget, LateTarget } from '@/components/hr/attendance-modals';
import { EmployeeCell, StatusBadge, Table, Td, Th } from '@/components/hr/hr-ui';
import { fmtDay, fmtMinutes, fullName, label, timeDz, WEEKDAYS, weekdayOf } from '@/lib/hr-labels';
import { cn } from '@/lib/utils';

export type AttendanceDayRow = {
  id: string;
  employeeId: string;
  date: string;
  status: string;
  flags: string[];
  scheduleName: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  firstIn: string | null;
  lastOut: string | null;
  punchCount: number;
  inVerifyMethod: string | null;
  workedMinutes: number;
  expectedMinutes: number;
  lateMinutes: number;
  chargeableLateMinutes: number;
  isLate: boolean;
  lateJustified: boolean;
  lateJustification: string | null;
  lateDecidedByName: string | null;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  needsReview: boolean;
  isCorrected: boolean;
  employee: { id: string; matricule: string; firstName: string; lastName: string };
};

export function AttendanceTable({
  rows,
  canCorrect,
  onCorrect,
  onJustify,
  today,
  lateFocus = false,
}: {
  rows: AttendanceDayRow[];
  canCorrect: boolean;
  onCorrect: (t: CorrectionTarget) => void;
  onJustify: (t: LateTarget) => void;
  today: string;
  lateFocus?: boolean;
}) {
  return (
    <Table minWidth={1120}>
      <thead>
        <tr>
          <Th>اليوم</Th>
          <Th>العامل</Th>
          <Th>الحالة</Th>
          <Th>التوقيت</Th>
          <Th>دخول</Th>
          <Th>خروج</Th>
          <Th>العمل</Th>
          <Th>تأخر</Th>
          {lateFocus ? <Th>التبرير</Th> : <Th>إضافي</Th>}
          <Th>ملاحظات</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const date = d.date.slice(0, 10);
          return (
            <tr key={d.id} className={cn(d.needsReview && 'bg-amber-50/60 dark:bg-amber-950/20')}>
              <Td className="whitespace-nowrap text-xs tabular-nums">
                <span className="font-bold">{fmtDay(date)}</span>{' '}
                <span className="text-[var(--app-text-dim)]">{WEEKDAYS[weekdayOf(date)].ar}</span>
              </Td>
              <Td>
                <Link href={`/hr/employees/${d.employee.id}`} className="hover:underline">
                  <EmployeeCell e={d.employee} />
                </Link>
              </Td>
              <Td>
                <StatusBadge l={label.attendance(d.status)} />
              </Td>
              <Td className="text-xs tabular-nums">
                {d.scheduledStart ? `${timeDz(d.scheduledStart)}–${timeDz(d.scheduledEnd)}` : '—'}
              </Td>
              <Td className="tabular-nums">
                {timeDz(d.firstIn) || '—'}
                {d.inVerifyMethod ? <p className="text-[10px] text-[var(--app-text-dim)]">{label.verify(d.inVerifyMethod).ar}</p> : null}
              </Td>
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
                {d.lateMinutes && !d.lateJustified && d.chargeableLateMinutes !== d.lateMinutes ? (
                  <p className="text-[10px] text-[var(--app-text-dim)]">محسوب: {d.chargeableLateMinutes} د</p>
                ) : null}
              </Td>
              {lateFocus ? (
                <Td className="max-w-[14rem] text-xs">
                  {d.lateJustified ? (
                    <>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">مبرر</span>
                      {d.lateJustification ? `: ${d.lateJustification}` : ''}
                      {d.lateDecidedByName ? <p className="text-[var(--app-text-dim)]">{d.lateDecidedByName}</p> : null}
                    </>
                  ) : (
                    <span className="text-[var(--app-text-dim)]">غير مبرر</span>
                  )}
                </Td>
              ) : (
                <Td className="tabular-nums">{d.overtimeMinutes ? fmtMinutes(d.overtimeMinutes) : '—'}</Td>
              )}
              <Td className="max-w-[16rem]">
                <div className="flex flex-wrap gap-1">
                  {d.flags.map((f) => (
                    <StatusBadge key={f} l={label.flag(f)} />
                  ))}
                </div>
              </Td>
              <Td>
                {canCorrect && date <= today ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="تصحيح"
                      onClick={() =>
                        onCorrect({ employeeId: d.employeeId, employeeName: fullName(d.employee), date, firstIn: d.firstIn, lastOut: d.lastOut })
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
                          onJustify({ dayId: d.id, employeeName: fullName(d.employee), date, lateMinutes: d.lateMinutes, lateJustified: d.lateJustified })
                        }
                      >
                        ✓
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
