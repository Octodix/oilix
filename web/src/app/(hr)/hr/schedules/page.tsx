'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Copy, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  apiError,
  Check,
  DepartmentSelect,
  EmployeeCell,
  EmployeeSelect,
  HrPageHeader,
  Modal,
  Notice,
  Panel,
  QueryState,
  Select,
  StatusBadge,
  Table,
  Td,
  TextInput,
  Th,
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { fmtDay, fmtMinutes, todayKeyDz, WEEKDAYS, weekdayOf } from '@/lib/hr-labels';

type Segment = { id?: string; weekday: number; start: string; end: string; overnight?: boolean };
type Schedule = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  breakMinutes: number;
  isActive: boolean;
  isDefault: boolean;
  segments: Segment[];
  _count: { assignments: number };
};
type Assignment = {
  id: string;
  scheduleId: string;
  startDate: string;
  endDate: string | null;
  isOverride: boolean;
  reason: string | null;
  schedule: { id: string; name: string; code: string };
  employee: { id: string; firstName: string; lastName: string; matricule: string } | null;
  department: { id: string; name: string } | null;
};
type Holiday = { id: string; date: string; name: string; isPaid: boolean };

/** Saturday-first order used in Algeria. */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$|^24:00$/;

function hhmmToMin(v: string) {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}

function weeklyMinutes(segments: Segment[], breakMinutes: number) {
  const byDay = new Map<number, number>();
  for (const s of segments) {
    if (!HHMM.test(s.start) || !HHMM.test(s.end)) continue;
    let d = hhmmToMin(s.end) - hhmmToMin(s.start);
    if (d <= 0) d += 1440;
    byDay.set(s.weekday, (byDay.get(s.weekday) ?? 0) + d);
  }
  let total = 0;
  for (const v of byDay.values()) total += Math.max(0, v - breakMinutes);
  return total;
}

export default function SchedulesPage() {
  const can = useCan();
  const manage = can('HR_SCHEDULES_MANAGE');
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ open: boolean; schedule: Schedule | null }>({ open: false, schedule: null });
  const [assigning, setAssigning] = useState(false);
  const [year, setYear] = useState(Number(todayKeyDz().slice(0, 4)));
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '', isPaid: true });

  const schedules = useQuery({
    queryKey: ['hr', 'schedules'],
    queryFn: async () => (await api.get<Schedule[]>('/hr/schedules')).data,
  });
  const assignments = useQuery({
    queryKey: ['hr', 'schedule-assignments'],
    queryFn: async () => (await api.get<Assignment[]>('/hr/schedule-assignments')).data,
  });
  const holidays = useQuery({
    queryKey: ['hr', 'holidays', year],
    queryFn: async () => (await api.get<Holiday[]>('/hr/holidays', { params: { year } })).data,
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => (await api.patch('/hr/settings', { defaultScheduleId: id })).data,
    onSuccess: () => {
      toast.success('تم تعيين التوقيت الافتراضي');
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const deleteAssignment = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/schedule-assignments/${id}`)).data,
    onSuccess: () => {
      toast.success('تم حذف الإسناد وإعادة حساب الحضور');
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const addHoliday = useMutation({
    mutationFn: async () => (await api.post('/hr/holidays', { ...holidayForm, name: holidayForm.name.trim() })).data,
    onSuccess: () => {
      toast.success('تمت إضافة العطلة');
      setHolidayForm({ date: '', name: '', isPaid: true });
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const deleteHoliday = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/holidays/${id}`)).data,
    onSuccess: () => {
      toast.success('تم حذف العطلة');
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="التوقيت والجداول"
        fr="Planning / Horaires"
        icon={CalendarClock}
        actions={
          manage ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setAssigning(true)}>
                إسناد توقيت
              </Button>
              <Button size="sm" onClick={() => setEditing({ open: true, schedule: null })}>
                <Plus className="h-4 w-4" /> توقيت جديد
              </Button>
            </>
          ) : null
        }
      />

      <Notice>
        الأولوية: إسناد مؤقت للعامل ← إسناد العامل ← إسناد القسم ← التوقيت الافتراضي. أي تعديل يُعيد حساب الحضور للأيام المعنية (الأشهر
        المقفلة في الأجور لا تتغير).
      </Notice>

      <QueryState q={schedules} empty={!schedules.data?.length} emptyText="لا توجد توقيتات">
        <div className="grid gap-3 lg:grid-cols-2">
          {(schedules.data ?? []).map((s) => (
            <Panel
              key={s.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {s.name} <span className="font-mono text-xs text-[var(--app-text-dim)]">{s.code}</span>
                  {s.isDefault ? <StatusBadge l={{ ar: 'افتراضي', fr: 'Par défaut', tone: 'primary' }} /> : null}
                  {!s.isActive ? <StatusBadge l={{ ar: 'معطل', fr: 'Inactif' }} /> : null}
                </span>
              }
              action={
                manage ? (
                  <div className="flex gap-1">
                    {!s.isDefault && s.isActive && can('HR_SETTINGS_MANAGE') ? (
                      <Button size="sm" variant="ghost" title="تعيين كافتراضي" onClick={() => setDefault.mutate(s.id)}>
                        <Star className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" title="نسخ" onClick={() => setEditing({ open: true, schedule: { ...s, id: '', code: `${s.code}-2`, isDefault: false } })}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ open: true, schedule: s })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null
              }
            >
              <div className="space-y-1 text-sm">
                {WEEK_ORDER.map((wd) => {
                  const segs = s.segments.filter((g) => g.weekday === wd);
                  return (
                    <div key={wd} className="flex items-center gap-3">
                      <span className="w-16 font-semibold text-[var(--app-text-muted)]">{WEEKDAYS[wd].ar}</span>
                      {segs.length ? (
                        <span className="tabular-nums" dir="ltr">
                          {segs.map((g) => `${g.start}–${g.end}${g.overnight ? ' (+1)' : ''}`).join('  ·  ')}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--app-text-dim)]">راحة</span>
                      )}
                    </div>
                  );
                })}
                <p className="pt-2 text-xs text-[var(--app-text-dim)]">
                  استراحة {s.breakMinutes} د/يوم · المجموع الأسبوعي {fmtMinutes(weeklyMinutes(s.segments, s.breakMinutes))} · {s._count.assignments} إسناد
                </p>
              </div>
            </Panel>
          ))}
        </div>
      </QueryState>

      <Panel title="الإسنادات · Affectations" bodyClassName="p-0">
        <QueryState q={assignments} empty={!assignments.data?.length} emptyText="لا توجد إسنادات — يُطبَّق التوقيت الافتراضي على الجميع">
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>التوقيت</Th>
                <Th>المعني</Th>
                <Th>الفترة</Th>
                <Th>النوع</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(assignments.data ?? []).map((a) => (
                <tr key={a.id}>
                  <Td className="font-bold">{a.schedule.name}</Td>
                  <Td>{a.employee ? <EmployeeCell e={a.employee} /> : <span>قسم: {a.department?.name}</span>}</Td>
                  <Td className="text-xs tabular-nums">
                    {fmtDay(a.startDate)} → {a.endDate ? fmtDay(a.endDate) : '…'}
                  </Td>
                  <Td className="text-xs">
                    {a.isOverride ? 'مؤقت · Exception' : 'عادي'}
                    {a.reason ? <p className="text-[var(--app-text-dim)]">{a.reason}</p> : null}
                  </Td>
                  <Td>
                    {manage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={deleteAssignment.isPending && deleteAssignment.variables === a.id}
                        onClick={() => confirm('حذف هذا الإسناد؟ سيُعاد حساب الحضور.') && deleteAssignment.mutate(a.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </QueryState>
      </Panel>

      <Panel
        title="العطل الرسمية · Jours fériés"
        action={
          <TextInput type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} className="w-28" />
        }
      >
        <Notice className="mb-3">
          العطل الرسمية لا تُفرض تلقائياً (المواعيد الدينية تتغير كل سنة) — أضفها يدوياً حسب الإعلان الرسمي.
        </Notice>
        {manage ? (
          <div className="mb-3 grid gap-2 sm:grid-cols-[10rem_1fr_auto_auto] sm:items-end">
            <TextInput label="التاريخ" type="date" value={holidayForm.date} onChange={(e) => setHolidayForm((s) => ({ ...s, date: e.target.value }))} />
            <TextInput label="الاسم · Nom" value={holidayForm.name} maxLength={120} onChange={(e) => setHolidayForm((s) => ({ ...s, name: e.target.value }))} />
            <div className="pb-2">
              <Check label="مدفوعة" checked={holidayForm.isPaid} onChange={(v) => setHolidayForm((s) => ({ ...s, isPaid: v }))} />
            </div>
            <Button disabled={!holidayForm.date || holidayForm.name.trim().length < 2} loading={addHoliday.isPending} onClick={() => addHoliday.mutate()}>
              <Plus className="h-4 w-4" /> إضافة
            </Button>
          </div>
        ) : null}
        <QueryState q={holidays} empty={!holidays.data?.length} emptyText={`لا توجد عطل مسجلة لسنة ${year}`}>
          <ul className="divide-y divide-[var(--app-border)]">
            {(holidays.data ?? []).map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-bold tabular-nums">{fmtDay(h.date)}</span>{' '}
                  <span className="text-[var(--app-text-dim)]">{WEEKDAYS[weekdayOf(h.date)].ar}</span> — {h.name}
                  {!h.isPaid ? <span className="mr-2 text-xs text-amber-700">غير مدفوعة</span> : null}
                </span>
                {manage ? (
                  <Button size="sm" variant="ghost" onClick={() => confirm(`حذف «${h.name}»؟`) && deleteHoliday.mutate(h.id)}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </QueryState>
      </Panel>

      <ScheduleModal state={editing} onClose={() => setEditing({ open: false, schedule: null })} />
      <AssignModal open={assigning} onClose={() => setAssigning(false)} schedules={schedules.data ?? []} />
    </div>
  );
}

function ScheduleModal({ state, onClose }: { state: { open: boolean; schedule: Schedule | null }; onClose: () => void }) {
  const qc = useQueryClient();
  const s = state.schedule;
  const editing = !!s?.id;
  const [seed, setSeed] = useState<unknown>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [isActive, setIsActive] = useState(true);
  const [segments, setSegments] = useState<Segment[]>([]);

  if (state.open && seed !== state) {
    setSeed(state);
    setCode(s?.code ?? '');
    setName(s?.name ?? '');
    setDescription(s?.description ?? '');
    setBreakMinutes(String(s?.breakMinutes ?? 60));
    setIsActive(s?.isActive ?? true);
    setSegments(
      s?.segments.map((g) => ({ weekday: g.weekday, start: g.start, end: g.end })) ??
        [6, 0, 1, 2, 3].map((wd) => ({ weekday: wd, start: '08:00', end: '16:00' })),
    );
  }

  const m = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        breakMinutes: Number(breakMinutes) || 0,
        isActive,
        segments: segments.map(({ weekday, start, end }) => ({ weekday, start, end })),
      };
      return editing
        ? (await api.patch(`/hr/schedules/${s!.id}`, body)).data
        : (await api.post('/hr/schedules', { ...body, code: code.trim() })).data;
    },
    onSuccess: () => {
      toast.success(editing ? 'تم حفظ التوقيت وإعادة حساب الحضور' : 'تم إنشاء التوقيت');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const segValid = segments.every((g) => HHMM.test(g.start) && HHMM.test(g.end) && g.start !== g.end);
  const ok = name.trim().length >= 2 && (editing || code.trim()) && segValid;

  const upd = (i: number, patch: Partial<Segment>) => setSegments((list) => list.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  return (
    <Modal
      open={state.open}
      onClose={onClose}
      wide
      title={editing ? `تعديل التوقيت «${s?.name}»` : 'توقيت جديد · Nouvel horaire'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <TextInput label="الرمز · Code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} disabled={editing} dir="ltr" />
          <TextInput label="الاسم · Nom" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="sm:col-span-2" />
          <TextInput
            label="الاستراحة (د/يوم) · Pause"
            type="number"
            min={0}
            max={480}
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            hint="تُطرح من ساعات العمل المتوقعة"
          />
        </div>
        <TextInput label="وصف · Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        <Check label="مفعّل · Actif" checked={isActive} onChange={setIsActive} />

        <div className="rounded-xl border border-[var(--app-border)]">
          <div className="flex items-center justify-between border-b border-[var(--app-border)] px-3 py-2 text-sm font-bold">
            الفترات · Plages horaires
            <span className="text-xs font-normal text-[var(--app-text-dim)]">
              المجموع الأسبوعي: {fmtMinutes(weeklyMinutes(segments, Number(breakMinutes) || 0))}
            </span>
          </div>
          <div className="divide-y divide-[var(--app-border)]">
            {WEEK_ORDER.map((wd) => {
              const idx = segments.map((g, i) => (g.weekday === wd ? i : -1)).filter((i) => i >= 0);
              return (
                <div key={wd} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="w-16 text-sm font-semibold">{WEEKDAYS[wd].ar}</span>
                  {idx.length === 0 ? <span className="text-xs text-[var(--app-text-dim)]">راحة</span> : null}
                  {idx.map((i) => (
                    <span key={i} className="flex items-center gap-1" dir="ltr">
                      <input
                        value={segments[i].start}
                        onChange={(e) => upd(i, { start: e.target.value })}
                        className="w-16 rounded-lg border border-[var(--app-border-strong)] bg-transparent px-2 py-1 text-center text-sm tabular-nums"
                        placeholder="08:00"
                      />
                      –
                      <input
                        value={segments[i].end}
                        onChange={(e) => upd(i, { end: e.target.value })}
                        className="w-16 rounded-lg border border-[var(--app-border-strong)] bg-transparent px-2 py-1 text-center text-sm tabular-nums"
                        placeholder="16:00"
                      />
                      <button type="button" className="text-red-600" onClick={() => setSegments((l) => l.filter((_, j) => j !== i))} title="حذف">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSegments((l) => [...l, { weekday: wd, start: '08:00', end: '12:00' }])}
                    disabled={idx.length >= 6}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="px-3 py-2 text-[11px] text-[var(--app-text-dim)]">
            الصيغة HH:MM (24 ساعة). إذا كانت النهاية قبل البداية فالفترة ليلية تنتهي في اليوم الموالي (يجب أن تكون آخر فترة في اليوم).
          </p>
        </div>
        {!segValid ? <Notice tone="warning">بعض الأوقات غير صالحة (HH:MM).</Notice> : null}
      </div>
    </Modal>
  );
}

function AssignModal({ open, onClose, schedules }: { open: boolean; onClose: () => void; schedules: Schedule[] }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<'employee' | 'department'>('employee');
  const [scheduleId, setScheduleId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [startDate, setStartDate] = useState(todayKeyDz());
  const [endDate, setEndDate] = useState('');
  const [isOverride, setIsOverride] = useState(false);
  const [reason, setReason] = useState('');

  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post('/hr/schedule-assignments', {
          scheduleId,
          employeeId: target === 'employee' ? employeeId : null,
          departmentId: target === 'department' ? departmentId : null,
          startDate,
          endDate: endDate || null,
          isOverride: target === 'employee' && isOverride,
          reason: reason.trim() || null,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم الإسناد وإعادة حساب الحضور');
      qc.invalidateQueries({ queryKey: ['hr'] });
      setEmployeeId('');
      setDepartmentId('');
      setReason('');
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const ok =
    scheduleId &&
    startDate &&
    (target === 'employee' ? employeeId : departmentId) &&
    (!endDate || endDate >= startDate) &&
    (!isOverride || endDate);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إسناد توقيت · Affecter un horaire"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>
            إسناد
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select label="التوقيت · Horaire" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
          <option value="">— اختر —</option>
          {schedules
            .filter((s) => s.isActive)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
        </Select>
        <Select label="لمن · Pour" value={target} onChange={(e) => setTarget(e.target.value as 'employee' | 'department')}>
          <option value="employee">عامل · Employé</option>
          <option value="department">قسم كامل · Service</option>
        </Select>
        {target === 'employee' ? (
          <EmployeeSelect value={employeeId} onChange={setEmployeeId} required />
        ) : (
          <DepartmentSelect value={departmentId} onChange={setDepartmentId} allowAll={false} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="من · Du" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextInput label="إلى · Au" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} hint="فارغ = مستمر" />
        </div>
        {target === 'employee' ? (
          <Check
            label="استثناء مؤقت (له الأولوية على الإسنادات الأخرى) · Exception temporaire"
            checked={isOverride}
            onChange={setIsOverride}
            hint="يتطلب تاريخ نهاية"
          />
        ) : null}
        <TextInput label="سبب / ملاحظة" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </div>
    </Modal>
  );
}
