'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Save, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  apiError,
  Check,
  HrPageHeader,
  Modal,
  Notice,
  Panel,
  QueryState,
  Select,
  StatusBadge,
  Table,
  TextArea,
  Td,
  TextInput,
  Th,
  useCan,
  useDepartments,
  type Department,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { toNum } from '@/lib/hr-labels';

type HrSettings = {
  timezoneOffsetMinutes: number;
  defaultScheduleId: string | null;
  workSites: string[];
  attendance: {
    lateGraceMinutes: number;
    lateChargeMode: 'FULL' | 'AFTER_GRACE';
    earlyLeaveGraceMinutes: number;
    overtimeThresholdMinutes: number;
    countEarlyArrivalOvertime: boolean;
    minPunchGapMinutes: number;
  };
  payroll: {
    dailyRateDivisor: 'SCHEDULED' | number;
    hourlyRateDivisor: 'CONTRACT' | number;
    deductUnjustifiedAbsences: boolean;
    lateDeductionMode: 'NONE' | 'PER_MINUTE' | 'FIXED_PER_OCCURRENCE';
    lateFixedAmount: number;
    lateToleratedOccurrences: number;
    overtimeRequiresApproval: boolean;
    missingPunchTreatment: 'PAY' | 'UNPAID';
    overtimeMultipliers: { WORKDAY: number; REST_DAY: number; HOLIDAY: number };
    allowPartialPayments: boolean;
    blockValidationOnMissingPunch: boolean;
  };
  sickLeave: { defaultTreatment: 'UNPAID' | 'PAID' | 'PARTIAL'; defaultPaidPercent: number };
  devices: { admsDelaySeconds: number; admsTransIntervalMinutes: number; offlineAfterMinutes: number };
};

type TypeRow = {
  id: string;
  code: string;
  name: string;
  nameFr: string | null;
  isPaid: boolean;
  isActive: boolean;
  sortOrder: number;
  deductsFromBalance?: boolean;
  defaultDaysPerYear?: string | null;
  isJustified?: boolean;
};

export default function HrSettingsPage() {
  const can = useCan();
  const canEdit = can('HR_SETTINGS_MANAGE');
  const q = useQuery({
    queryKey: ['hr', 'settings'],
    queryFn: async () => (await api.get<HrSettings>('/hr/settings')).data,
  });

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="إعدادات الموارد البشرية"
        fr="Paramètres RH"
        icon={Settings}
        subtitle="لا توجد قاعدة قانونية أو ضريبية مثبتة في البرنامج — كل القواعد هنا قابلة للضبط. التغيير لا يمس الأجور المصادق عليها."
      />
      {!canEdit ? <Notice>عرض فقط — تعديل الإعدادات يتطلب صلاحية «إدارة إعدادات الموارد البشرية».</Notice> : null}
      <QueryState q={q}>{q.data ? <PolicyForm initial={q.data} canEdit={canEdit} /> : null}</QueryState>
      <DepartmentsPanel canEdit={canEdit || can('HR_EMPLOYEES_EDIT')} />
      <TypesPanel kind="leave" canEdit={canEdit} />
      <TypesPanel kind="absence" canEdit={canEdit} />
    </div>
  );
}

function num(v: string, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function PolicyForm({ initial, canEdit }: { initial: HrSettings; canEdit: boolean }) {
  const qc = useQueryClient();
  const [s, setS] = useState<HrSettings>(initial);
  const [seed, setSeed] = useState(initial);
  const [sites, setSites] = useState(initial.workSites.join('\n'));
  if (seed !== initial) {
    setSeed(initial);
    setS(initial);
    setSites(initial.workSites.join('\n'));
  }
  const a = s.attendance;
  const p = s.payroll;
  const setA = (patch: Partial<HrSettings['attendance']>) => setS({ ...s, attendance: { ...a, ...patch } });
  const setP = (patch: Partial<HrSettings['payroll']>) => setS({ ...s, payroll: { ...p, ...patch } });

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch<HrSettings>('/hr/settings', {
          timezoneOffsetMinutes: s.timezoneOffsetMinutes,
          workSites: sites
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean),
          attendance: s.attendance,
          payroll: s.payroll,
          sickLeave: s.sickLeave,
          devices: s.devices,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم حفظ الإعدادات — سُجّل التغيير في سجل العمليات');
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const dis = !canEdit;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="الحضور والتأخر · Présence & retards">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="مهلة التأخر (دقائق)"
              type="number"
              min={0}
              max={240}
              disabled={dis}
              value={a.lateGraceMinutes}
              onChange={(e) => setA({ lateGraceMinutes: num(e.target.value, 0) })}
              hint="مثال 10: الوصول 08:07 لا يُعتبر تأخراً"
            />
            <Select label="احتساب التأخر بعد المهلة" disabled={dis} value={a.lateChargeMode} onChange={(e) => setA({ lateChargeMode: e.target.value as 'FULL' | 'AFTER_GRACE' })}>
              <option value="FULL">كامل المدة (08:18 → 18 د)</option>
              <option value="AFTER_GRACE">ما بعد المهلة فقط (08:18 → 8 د)</option>
            </Select>
            <TextInput label="مهلة الخروج المبكر (دقائق)" type="number" min={0} max={240} disabled={dis} value={a.earlyLeaveGraceMinutes} onChange={(e) => setA({ earlyLeaveGraceMinutes: num(e.target.value, 0) })} />
            <TextInput
              label="حد الساعات الإضافية (دقائق)"
              type="number"
              min={0}
              max={600}
              disabled={dis}
              value={a.overtimeThresholdMinutes}
              onChange={(e) => setA({ overtimeThresholdMinutes: num(e.target.value, 0) })}
              hint="أقل من هذا لا يُحسب إضافياً"
            />
            <TextInput
              label="تجاهل البصمات المتقاربة (دقائق)"
              type="number"
              min={0}
              max={60}
              disabled={dis}
              value={a.minPunchGapMinutes}
              onChange={(e) => setA({ minPunchGapMinutes: num(e.target.value, 0) })}
              hint="بصمتان خلال هذه المدة = بصمة واحدة"
            />
            <div className="flex items-end pb-2">
              <Check label="احتساب الحضور المبكر ساعات إضافية" disabled={dis} checked={a.countEarlyArrivalOvertime} onChange={(v) => setA({ countEarlyArrivalOvertime: v })} />
            </div>
          </div>
        </Panel>

        <Panel title="الأجور · Paie">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="قاسم الأجر اليومي (شهري)"
              disabled={dis}
              value={p.dailyRateDivisor === 'SCHEDULED' ? 'SCHEDULED' : 'FIXED'}
              onChange={(e) => setP({ dailyRateDivisor: e.target.value === 'SCHEDULED' ? 'SCHEDULED' : 26 })}
            >
              <option value="SCHEDULED">أيام العمل المبرمجة في الشهر</option>
              <option value="FIXED">عدد ثابت</option>
            </Select>
            {p.dailyRateDivisor !== 'SCHEDULED' ? (
              <TextInput label="عدد الأيام الثابت" type="number" min={1} max={400} disabled={dis} value={p.dailyRateDivisor} onChange={(e) => setP({ dailyRateDivisor: num(e.target.value, 26) })} />
            ) : (
              <span />
            )}
            <Select
              label="قاسم الأجر الساعي (شهري)"
              disabled={dis}
              value={p.hourlyRateDivisor === 'CONTRACT' ? 'CONTRACT' : 'FIXED'}
              onChange={(e) => setP({ hourlyRateDivisor: e.target.value === 'CONTRACT' ? 'CONTRACT' : 173.33 })}
            >
              <option value="CONTRACT">ساعات العقد × 52 ÷ 12</option>
              <option value="FIXED">عدد ثابت</option>
            </Select>
            {p.hourlyRateDivisor !== 'CONTRACT' ? (
              <TextInput label="عدد الساعات الثابت" type="number" step="0.01" min={1} max={400} disabled={dis} value={p.hourlyRateDivisor} onChange={(e) => setP({ hourlyRateDivisor: num(e.target.value, 173.33) })} />
            ) : (
              <span />
            )}
            <Select label="اقتطاع التأخر" disabled={dis} value={p.lateDeductionMode} onChange={(e) => setP({ lateDeductionMode: e.target.value as HrSettings['payroll']['lateDeductionMode'] })}>
              <option value="NONE">لا يُقتطع</option>
              <option value="PER_MINUTE">بالدقيقة (حسب الأجر الساعي)</option>
              <option value="FIXED_PER_OCCURRENCE">مبلغ ثابت لكل تأخر</option>
            </Select>
            {p.lateDeductionMode === 'FIXED_PER_OCCURRENCE' ? (
              <TextInput label="المبلغ لكل تأخر (د.ج)" type="number" min={0} disabled={dis} value={p.lateFixedAmount} onChange={(e) => setP({ lateFixedAmount: num(e.target.value, 0) })} />
            ) : (
              <span />
            )}
            <TextInput
              label="تأخرات مسموحة شهرياً بدون اقتطاع"
              type="number"
              min={0}
              max={31}
              disabled={dis}
              value={p.lateToleratedOccurrences}
              onChange={(e) => setP({ lateToleratedOccurrences: num(e.target.value, 0) })}
            />
            <Select label="أيام البصمة الناقصة" disabled={dis} value={p.missingPunchTreatment} onChange={(e) => setP({ missingPunchTreatment: e.target.value as 'PAY' | 'UNPAID' })}>
              <option value="PAY">تُدفع حتى تُراجع</option>
              <option value="UNPAID">لا تُدفع حتى تُصحح</option>
            </Select>
            <TextInput label="معامل إضافي يوم عمل" type="number" step="0.05" min={1} max={5} disabled={dis} value={p.overtimeMultipliers.WORKDAY} onChange={(e) => setP({ overtimeMultipliers: { ...p.overtimeMultipliers, WORKDAY: num(e.target.value, 1.5) } })} />
            <TextInput label="معامل إضافي يوم راحة" type="number" step="0.05" min={1} max={5} disabled={dis} value={p.overtimeMultipliers.REST_DAY} onChange={(e) => setP({ overtimeMultipliers: { ...p.overtimeMultipliers, REST_DAY: num(e.target.value, 1.75) } })} />
            <TextInput label="معامل إضافي عطلة رسمية" type="number" step="0.05" min={1} max={5} disabled={dis} value={p.overtimeMultipliers.HOLIDAY} onChange={(e) => setP({ overtimeMultipliers: { ...p.overtimeMultipliers, HOLIDAY: num(e.target.value, 2) } })} />
          </div>
          <div className="mt-3 grid gap-2">
            <Check label="اقتطاع أيام الغياب غير المبرر" disabled={dis} checked={p.deductUnjustifiedAbsences} onChange={(v) => setP({ deductUnjustifiedAbsences: v })} />
            <Check label="الساعات الإضافية لا تُدفع إلا بعد الموافقة" disabled={dis} checked={p.overtimeRequiresApproval} onChange={(v) => setP({ overtimeRequiresApproval: v })} />
            <Check label="السماح بالدفع الجزئي للأجور" disabled={dis} checked={p.allowPartialPayments} onChange={(v) => setP({ allowPartialPayments: v })} />
            <Check
              label="منع المصادقة عند وجود بصمات ناقصة"
              hint="يمكن الفرض مع ذكر السبب"
              disabled={dis}
              checked={p.blockValidationOnMissingPunch}
              onChange={(v) => setP({ blockValidationOnMissingPunch: v })}
            />
          </div>
        </Panel>

        <Panel title="العطل المرضية · Maladie">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="المعالجة الافتراضية في الأجر"
              disabled={dis}
              value={s.sickLeave.defaultTreatment}
              onChange={(e) => setS({ ...s, sickLeave: { ...s.sickLeave, defaultTreatment: e.target.value as HrSettings['sickLeave']['defaultTreatment'] } })}
            >
              <option value="UNPAID">غير مدفوعة (الضمان الاجتماعي يعوّض)</option>
              <option value="PAID">مدفوعة كلياً</option>
              <option value="PARTIAL">مدفوعة جزئياً</option>
            </Select>
            <TextInput
              label="النسبة المدفوعة (%)"
              type="number"
              min={0}
              max={100}
              disabled={dis || s.sickLeave.defaultTreatment !== 'PARTIAL'}
              value={s.sickLeave.defaultPaidPercent}
              onChange={(e) => setS({ ...s, sickLeave: { ...s.sickLeave, defaultPaidPercent: num(e.target.value, 0) } })}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--app-text-dim)]">قيمة افتراضية فقط — تُحدد لكل عطلة مرضية عند تسجيلها.</p>
        </Panel>

        <Panel title="عام وأجهزة البصمة · Général & pointeuses">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="فرق التوقيت عن UTC (دقائق)"
              type="number"
              disabled={dis}
              value={s.timezoneOffsetMinutes}
              onChange={(e) => setS({ ...s, timezoneOffsetMinutes: num(e.target.value, 60) })}
              hint="الجزائر = 60 (بدون توقيت صيفي)"
            />
            <TextInput
              label="اعتبار الجهاز غير متصل بعد (دقائق)"
              type="number"
              min={2}
              max={1440}
              disabled={dis}
              value={s.devices.offlineAfterMinutes}
              onChange={(e) => setS({ ...s, devices: { ...s.devices, offlineAfterMinutes: num(e.target.value, 5) } })}
            />
            <TextInput
              label="ADMS: فاصل الاستعلام (ثوانٍ)"
              type="number"
              min={10}
              max={600}
              disabled={dis}
              value={s.devices.admsDelaySeconds}
              onChange={(e) => setS({ ...s, devices: { ...s.devices, admsDelaySeconds: num(e.target.value, 30) } })}
            />
            <TextInput
              label="ADMS: فاصل إرسال البصمات (دقائق)"
              type="number"
              min={1}
              max={60}
              disabled={dis}
              value={s.devices.admsTransIntervalMinutes}
              onChange={(e) => setS({ ...s, devices: { ...s.devices, admsTransIntervalMinutes: num(e.target.value, 1) } })}
            />
          </div>
          <div className="mt-3" />
          <TextArea label="مواقع العمل (سطر لكل موقع)" disabled={dis} value={sites} onChange={(e) => setSites(e.target.value)} />
        </Panel>
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            <Save className="h-4 w-4" /> حفظ الإعدادات
          </Button>
        </div>
      ) : null}
    </>
  );
}

function DepartmentsPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useDepartments();
  const [editing, setEditing] = useState<Department | null | undefined>(undefined);
  const toggle = useMutation({
    mutationFn: async (d: Department) => (await api.patch(`/hr/departments/${d.id}`, { isActive: !d.isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Panel
      title="الأقسام · Services"
      bodyClassName="p-0"
      action={
        canEdit ? (
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus className="h-4 w-4" /> قسم
          </Button>
        ) : null
      }
    >
      <QueryState q={q} empty={!q.data?.length} emptyText="لا توجد أقسام">
        <Table>
          <thead>
            <tr>
              <Th>الاسم</Th>
              <Th>Nom</Th>
              <Th>الرمز</Th>
              <Th>العمال</Th>
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((d) => (
              <tr key={d.id}>
                <Td className="font-bold">{d.name}</Td>
                <Td>{d.nameFr ?? '—'}</Td>
                <Td className="font-mono text-xs">{d.code ?? '—'}</Td>
                <Td className="tabular-nums">{d._count?.employees ?? '—'}</Td>
                <Td>
                  <StatusBadge l={d.isActive ? { ar: 'نشط', fr: 'Actif', tone: 'success' } : { ar: 'معطل', fr: 'Inactif', tone: 'default' }} />
                </Td>
                <Td>
                  {canEdit ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === d.id} onClick={() => toggle.mutate(d)}>
                        {d.isActive ? 'تعطيل' : 'تفعيل'}
                      </Button>
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <DepartmentModal dept={editing} onClose={() => setEditing(undefined)} />
    </Panel>
  );
}

function DepartmentModal({ dept, onClose }: { dept: Department | null | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const open = dept !== undefined;
  const [seed, setSeed] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameFr, setNameFr] = useState('');
  const [code, setCode] = useState('');
  const key = open ? (dept?.id ?? 'new') : null;
  if (key !== seed) {
    setSeed(key);
    setName(dept?.name ?? '');
    setNameFr(dept?.nameFr ?? '');
    setCode(dept?.code ?? '');
  }
  const m = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), nameFr: nameFr.trim() || null, code: code.trim() || null };
      return dept ? (await api.patch(`/hr/departments/${dept.id}`, body)).data : (await api.post('/hr/departments', body)).data;
    },
    onSuccess: () => {
      toast.success('تم الحفظ');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={dept ? `تعديل ${dept.name}` : 'قسم جديد · Nouveau service'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={name.trim().length < 2} loading={m.isPending} onClick={() => m.mutate()}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput label="الاسم" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        <TextInput label="Nom" value={nameFr} onChange={(e) => setNameFr(e.target.value)} maxLength={100} />
        <TextInput label="الرمز" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} />
      </div>
    </Modal>
  );
}

function TypesPanel({ kind, canEdit }: { kind: 'leave' | 'absence'; canEdit: boolean }) {
  const path = kind === 'leave' ? '/hr/leave-types' : '/hr/absence-types';
  const q = useQuery({
    queryKey: ['hr', `${kind}-types-all`],
    queryFn: async () => (await api.get<TypeRow[]>(path)).data,
  });
  const [editing, setEditing] = useState<TypeRow | null | undefined>(undefined);
  return (
    <Panel
      title={kind === 'leave' ? 'أنواع العطل · Types de congés' : 'أنواع الغياب · Types d’absence'}
      bodyClassName="p-0"
      action={
        canEdit ? (
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus className="h-4 w-4" /> نوع
          </Button>
        ) : null
      }
    >
      <QueryState q={q} empty={!q.data?.length} emptyText="لا توجد أنواع">
        <Table>
          <thead>
            <tr>
              <Th>الرمز</Th>
              <Th>الاسم</Th>
              <Th>مدفوع</Th>
              {kind === 'leave' ? (
                <>
                  <Th>يُخصم من الرصيد</Th>
                  <Th>أيام/سنة</Th>
                </>
              ) : (
                <Th>مبرر</Th>
              )}
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((t) => (
              <tr key={t.id}>
                <Td className="font-mono text-xs">{t.code}</Td>
                <Td>
                  <p className="font-bold">{t.name}</p>
                  <p className="text-[11px] text-[var(--app-text-dim)]">{t.nameFr}</p>
                </Td>
                <Td>{t.isPaid ? '✓' : '—'}</Td>
                {kind === 'leave' ? (
                  <>
                    <Td>{t.deductsFromBalance ? '✓' : '—'}</Td>
                    <Td className="tabular-nums">{t.defaultDaysPerYear ? toNum(t.defaultDaysPerYear) : '—'}</Td>
                  </>
                ) : (
                  <Td>{t.isJustified ? '✓' : '—'}</Td>
                )}
                <Td>
                  <StatusBadge l={t.isActive ? { ar: 'نشط', fr: 'Actif', tone: 'success' } : { ar: 'معطل', fr: 'Inactif', tone: 'default' }} />
                </Td>
                <Td>
                  {canEdit ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <TypeModal kind={kind} path={path} row={editing} onClose={() => setEditing(undefined)} />
    </Panel>
  );
}

function TypeModal({ kind, path, row, onClose }: { kind: 'leave' | 'absence'; path: string; row: TypeRow | null | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const open = row !== undefined;
  const [seed, setSeed] = useState<string | null>(null);
  const [f, setF] = useState({ code: '', name: '', nameFr: '', isPaid: true, deductsFromBalance: false, defaultDaysPerYear: '', isJustified: true, isActive: true, sortOrder: '0' });
  const key = open ? (row?.id ?? 'new') : null;
  if (key !== seed) {
    setSeed(key);
    setF({
      code: row?.code ?? '',
      name: row?.name ?? '',
      nameFr: row?.nameFr ?? '',
      isPaid: row?.isPaid ?? true,
      deductsFromBalance: row?.deductsFromBalance ?? false,
      defaultDaysPerYear: row?.defaultDaysPerYear ? String(toNum(row.defaultDaysPerYear)) : '',
      isJustified: row?.isJustified ?? true,
      isActive: row?.isActive ?? true,
      sortOrder: String(row?.sortOrder ?? 0),
    });
  }
  const m = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        nameFr: f.nameFr.trim() || null,
        isPaid: f.isPaid,
        isActive: f.isActive,
        sortOrder: Number(f.sortOrder) || 0,
        ...(kind === 'leave'
          ? { deductsFromBalance: f.deductsFromBalance, defaultDaysPerYear: f.defaultDaysPerYear ? Number(f.defaultDaysPerYear) : null }
          : { isJustified: f.isJustified }),
      };
      if (!row) body.code = f.code.trim().toUpperCase();
      return row ? (await api.patch(`${path}/${row.id}`, body)).data : (await api.post(path, body)).data;
    },
    onSuccess: () => {
      toast.success('تم الحفظ');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const ok = f.name.trim().length >= 2 && (!!row || /^[A-Za-z0-9_-]{2,30}$/.test(f.code.trim()));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={row ? `تعديل ${row.name}` : kind === 'leave' ? 'نوع عطلة جديد' : 'نوع غياب جديد'}
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
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput label="الرمز" dir="ltr" value={f.code} disabled={!!row} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={30} />
          <TextInput label="الاسم" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} />
          <TextInput label="Nom" value={f.nameFr} onChange={(e) => setF({ ...f, nameFr: e.target.value })} maxLength={100} />
          {kind === 'leave' ? (
            <TextInput label="أيام في السنة (افتراضي)" type="number" step="0.5" min={0} max={366} value={f.defaultDaysPerYear} onChange={(e) => setF({ ...f, defaultDaysPerYear: e.target.value })} />
          ) : null}
          <TextInput label="الترتيب" type="number" min={0} max={999} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Check label="مدفوع الأجر" checked={f.isPaid} onChange={(v) => setF({ ...f, isPaid: v })} />
          {kind === 'leave' ? (
            <Check label="يُخصم من رصيد العطل" checked={f.deductsFromBalance} onChange={(v) => setF({ ...f, deductsFromBalance: v })} />
          ) : (
            <Check label="غياب مبرر" checked={f.isJustified} onChange={(v) => setF({ ...f, isJustified: v })} />
          )}
          <Check label="نشط" checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />
        </div>
      </div>
    </Modal>
  );
}
