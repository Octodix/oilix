'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileUp, Fingerprint, Link2, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DeviceFormModal,
  displayStatus,
  InfoTable,
  lastSeenLabel,
  ProbeView,
  ProviderHelp,
  TestResultModal,
  type Device,
  type SyncResult,
  type TestResult,
} from '@/components/hr/device-ui';
import {
  apiError,
  Check,
  EmployeeCell,
  EmployeeSelect,
  EmptyState,
  HrPageHeader,
  Modal,
  Notice,
  Panel,
  QueryState,
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
import { dateTimeDz, label } from '@/lib/hr-labels';
import { cn } from '@/lib/utils';

type Mapping = {
  id: string;
  deviceUserId: string;
  deviceUserName: string | null;
  employee: { id: string; matricule: string; firstName: string; lastName: string; status: string };
};
type Unmapped = { deviceUserId: string; events: number; firstSeen: string; lastSeen: string };
type SyncLog = {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  fetchedCount: number;
  insertedCount: number;
  duplicateCount: number;
  unmappedCount: number;
  invalidCount: number;
  errorMessage: string | null;
  fileName: string | null;
  userName: string | null;
};
type ColumnMap = {
  pin: number;
  time: number;
  status: number | null;
  verify: number | null;
  workCode: number | null;
  delimiter: 'auto' | 'tab' | 'comma' | 'semicolon' | 'whitespace';
  dateOrder: 'DMY' | 'MDY';
};
type Preview = {
  columnMap: ColumnMap;
  totalLines: number;
  validCount: number;
  invalidCount: number;
  skippedHeader: boolean;
  firstPunch: string | null;
  lastPunch: string | null;
  users: number;
  unmappedUsers: string[];
  rawPreview: string[][];
  sample: { lineNo: number; deviceUserId: string; localTime: string; verifyMethod: string; punchState: number | null }[];
  invalidSample: { lineNo: number; line: string; reason: string }[];
  alreadyImportedAt: string | null;
};
type ImportResult = {
  fetched: number;
  inserted: number;
  duplicates: number;
  unmapped: number;
  invalid: number;
  firstEventEver: boolean;
  reprocessed: { from: string; to: string; employees: number } | null;
  alreadyImportedAt: string | null;
};

type Tab = 'import' | 'mappings' | 'unmapped' | 'logs';

const DEFAULT_MAP: ColumnMap = { pin: 0, time: 1, status: 2, verify: 3, workCode: 4, delimiter: 'auto', dateOrder: 'DMY' };

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('mappings');
  const [editing, setEditing] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const q = useQuery({
    queryKey: ['hr', 'device', id],
    queryFn: async () => (await api.get<Device>(`/hr/devices/${id}`)).data,
  });
  const test = useMutation({
    mutationFn: async () => (await api.post<TestResult>(`/hr/devices/${id}/test`)).data,
    onSuccess: (r) => {
      setTestResult(r);
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const sync = useMutation({
    mutationFn: async () => (await api.post<SyncResult>(`/hr/devices/${id}/sync`)).data,
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.warning(r.message, { duration: 10_000 });
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const d = q.data;
  const tabs: { id: Tab; t: string; show: boolean }[] = [
    { id: 'mappings', t: 'ربط العمال', show: true },
    { id: 'unmapped', t: 'معرّفات غير مربوطة', show: true },
    { id: 'import', t: 'استيراد ملف (USB)', show: !!d?.capabilities?.fileImport && can('HR_DEVICES_SYNC') },
    { id: 'logs', t: 'سجل المزامنة', show: true },
  ];

  return (
    <div className="space-y-4">
      <Link href="/hr/devices" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--app-text-dim)] hover:text-[var(--app-text)]">
        <ArrowRight className="h-4 w-4" /> أجهزة البصمة
      </Link>
      <QueryState q={q}>
        {d ? (
          <>
            <HrPageHeader
              title={d.name}
              fr={`${d.providerLabel}${d.serialNumber ? ` · SN ${d.serialNumber}` : ''}`}
              icon={Fingerprint}
              subtitle={
                <span className="font-bold">
                  {displayStatus(d).dot} {displayStatus(d).ar} · {displayStatus(d).fr} — {lastSeenLabel(d)}
                </span>
              }
              actions={
                <>
                  {can('HR_DEVICES_SYNC') && d.provider !== 'ZKTECO_FILE' ? (
                    <>
                      <Button size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
                        <Wifi className="h-4 w-4" /> اختبار الاتصال
                      </Button>
                      <Button size="sm" variant="outline" disabled={!d.isEnabled} loading={sync.isPending} onClick={() => sync.mutate()}>
                        <RefreshCw className="h-4 w-4" /> مزامنة الآن
                      </Button>
                    </>
                  ) : null}
                  {can('HR_DEVICES_MANAGE') ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                      تعديل
                    </Button>
                  ) : null}
                </>
              }
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="آخر مزامنة ناجحة" value={d.lastSuccessfulSyncAt ? dateTimeDz(d.lastSuccessfulSyncAt) : '—'} />
              <StatCard label="آخر بصمة" value={d.lastEventAt ? dateTimeDz(d.lastEventAt) : '—'} />
              <StatCard
                label="أول بصمة حقيقية"
                value={d.firstEventImportedAt ? dateTimeDz(d.firstEventImportedAt) : 'لم تصل بعد'}
                tone={d.firstEventImportedAt ? 'success' : 'warning'}
              />
              <StatCard label="فرق التوقيت" value={`${d.timezoneOffsetMinutes} min`} />
            </div>

            {d.lastError ? <Notice tone="danger">آخر خطأ: {d.lastError}</Notice> : null}
            <ProviderHelp provider={d.provider} />

            {d.deviceInfo || d.lastDiagnostic ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {d.deviceInfo ? (
                  <Panel title="معلومات قرأها Oilix من الجهاز · Infos terminal">
                    <InfoTable info={d.deviceInfo} />
                  </Panel>
                ) : null}
                {d.lastDiagnostic ? (
                  <Panel title={`آخر تشخيص · ${dateTimeDz(d.lastDiagnosticAt)}`}>
                    <ProbeView probe={d.lastDiagnostic} />
                  </Panel>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-1 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-1">
              {tabs
                .filter((t) => t.show)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'rounded-xl px-3 py-1.5 text-sm font-bold',
                      tab === t.id ? 'bg-sky-700 text-white' : 'text-[var(--app-text-muted)] hover:bg-[var(--app-bg-muted)]',
                    )}
                  >
                    {t.t}
                  </button>
                ))}
            </div>

            {tab === 'mappings' ? <MappingsTab device={d} /> : null}
            {tab === 'unmapped' ? <UnmappedTab device={d} /> : null}
            {tab === 'import' ? <ImportTab device={d} /> : null}
            {tab === 'logs' ? <LogsTab deviceId={d.id} /> : null}

            <DeviceFormModal open={editing} device={d} onClose={() => setEditing(false)} />
            <TestResultModal result={testResult} onClose={() => setTestResult(null)} />
          </>
        ) : null}
      </QueryState>
    </div>
  );
}

function MappingModal({
  device,
  open,
  onClose,
  initialUserId,
}: {
  device: Device;
  open: boolean;
  onClose: () => void;
  initialUserId?: string;
}) {
  const qc = useQueryClient();
  const [seed, setSeed] = useState(false);
  const [deviceUserId, setDeviceUserId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [name, setName] = useState('');
  if (open !== seed) {
    setSeed(open);
    if (open) {
      setDeviceUserId(initialUserId ?? '');
      setEmployeeId('');
      setName('');
    }
  }
  const m = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ relinked: number }>(`/hr/devices/${device.id}/mappings`, {
          deviceUserId: deviceUserId.trim(),
          employeeId,
          deviceUserName: name.trim() || null,
        })
      ).data,
    onSuccess: (r) => {
      toast.success(`تم الربط${r.relinked ? ` — ${r.relinked} بصمة سابقة رُبطت وأُعيد حساب أيامها` : ''}`);
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const ok = /^[A-Za-z0-9_.-]{1,32}$/.test(deviceUserId.trim()) && !!employeeId;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`ربط معرّف في «${device.name}» بعامل`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>
            <Link2 className="h-4 w-4" /> ربط
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextInput
          label="معرّف المستخدم في الجهاز (User ID / PIN)"
          dir="ltr"
          value={deviceUserId}
          onChange={(e) => setDeviceUserId(e.target.value)}
          maxLength={32}
          placeholder="15"
          hint="الرقم الظاهر في الجهاز: Menu → User Mgt. — الربط يتم بهذا المعرّف وليس بالاسم"
        />
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} />
        <TextInput label="الاسم في الجهاز (اختياري، للتذكير فقط)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </div>
    </Modal>
  );
}

function MappingsTab({ device }: { device: Device }) {
  const can = useCan();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['hr', 'device-mappings', device.id],
    queryFn: async () => (await api.get<Mapping[]>(`/hr/devices/${device.id}/mappings`)).data,
  });
  const del = useMutation({
    mutationFn: async (id: string) => (await api.delete<{ unlinked: number }>(`/hr/devices/mappings/${id}`)).data,
    onSuccess: (r) => {
      toast.success(`تم فك الربط — ${r.unlinked} بصمة أصبحت غير مربوطة (لم تُحذف)`);
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Panel
      title="ربط معرّفات الجهاز بالعمال · Correspondance"
      bodyClassName="p-0"
      action={
        can('HR_DEVICES_MANAGE') ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Link2 className="h-4 w-4" /> ربط جديد
          </Button>
        ) : null
      }
    >
      <QueryState q={q} empty={!q.data?.length} emptyText="لا يوجد أي ربط بعد" emptyHint="اربط كل عامل بمعرّفه في الجهاز (User ID).">
        <Table>
          <thead>
            <tr>
              <Th>معرّف الجهاز</Th>
              <Th>الاسم في الجهاز</Th>
              <Th>العامل في Oilix</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((m) => (
              <tr key={m.id}>
                <Td className="font-mono font-bold" >{m.deviceUserId}</Td>
                <Td className="text-xs">{m.deviceUserName ?? '—'}</Td>
                <Td>
                  <Link href={`/hr/employees/${m.employee.id}`} className="hover:underline">
                    <EmployeeCell e={m.employee} sub={label.employee(m.employee.status).ar} />
                  </Link>
                </Td>
                <Td>
                  {can('HR_DEVICES_MANAGE') ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={del.isPending && del.variables === m.id}
                      onClick={() => confirm(`فك ربط المعرّف ${m.deviceUserId}؟ البصمات تبقى محفوظة لكن تصبح غير مربوطة.`) && del.mutate(m.id)}
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
      <MappingModal device={device} open={adding} onClose={() => setAdding(false)} />
    </Panel>
  );
}

function UnmappedTab({ device }: { device: Device }) {
  const can = useCan();
  const [linking, setLinking] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['hr', 'device-unmapped', device.id],
    queryFn: async () => (await api.get<Unmapped[]>(`/hr/devices/${device.id}/unmapped`)).data,
  });
  return (
    <Panel title="معرّفات وصلت منها بصمات لكنها غير مربوطة بعامل" bodyClassName="p-0">
      <QueryState q={q} empty={!q.data?.length} emptyText="كل البصمات المستلمة مربوطة بعمال">
        <Table>
          <thead>
            <tr>
              <Th>معرّف الجهاز</Th>
              <Th>عدد البصمات</Th>
              <Th>أول ظهور</Th>
              <Th>آخر ظهور</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((u) => (
              <tr key={u.deviceUserId}>
                <Td className="font-mono font-bold">{u.deviceUserId}</Td>
                <Td className="tabular-nums">{u.events}</Td>
                <Td className="text-xs">{dateTimeDz(u.firstSeen)}</Td>
                <Td className="text-xs">{dateTimeDz(u.lastSeen)}</Td>
                <Td>
                  {can('HR_DEVICES_MANAGE') ? (
                    <Button size="sm" variant="outline" onClick={() => setLinking(u.deviceUserId)}>
                      <Link2 className="h-4 w-4" /> ربط بعامل
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <Notice>البصمات غير المربوطة محفوظة كما هي؛ عند الربط تُنسب للعامل ويُعاد حساب الأيام المعنية تلقائياً.</Notice>
      <MappingModal device={device} open={!!linking} initialUserId={linking ?? undefined} onClose={() => setLinking(null)} />
    </Panel>
  );
}

function ImportTab({ device }: { device: Device }) {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [map, setMap] = useState<ColumnMap>({ ...DEFAULT_MAP, ...((device.fileColumnMap ?? {}) as Partial<ColumnMap>) });
  const [saveMap, setSaveMap] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const body = (dryRun: boolean) => ({ content, fileName, columnMap: map, dryRun, saveColumnMap: !dryRun && saveMap });
  const dry = useMutation({
    mutationFn: async () => (await api.post<Preview>(`/hr/devices/${device.id}/import`, body(true))).data,
    onSuccess: (p) => {
      setPreview(p);
      setResult(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const commit = useMutation({
    mutationFn: async () => (await api.post<ImportResult>(`/hr/devices/${device.id}/import`, body(false))).data,
    onSuccess: (r) => {
      setResult(r);
      toast.success(`تم الاستيراد: ${r.inserted} جديد، ${r.duplicates} مكرر (تم تجاهله)`);
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  async function onFile(f: File | null) {
    setPreview(null);
    setResult(null);
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error('حجم الملف يتجاوز 5 ميغابايت');
      return;
    }
    setFileName(f.name);
    setContent(await f.text());
  }

  const idx = (v: string): number | null => (v === '' ? null : Number(v));
  const colSelect = (k: 'pin' | 'time' | 'status' | 'verify' | 'workCode', l: string, optional: boolean) => (
    <Select label={l} value={map[k] === null ? '' : String(map[k])} onChange={(e) => setMap({ ...map, [k]: optional ? idx(e.target.value) : Number(e.target.value) })}>
      {optional ? <option value="">— غير موجود —</option> : null}
      {Array.from({ length: 10 }, (_, i) => (
        <option key={i} value={i}>
          العمود {i}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="space-y-4">
      <Panel title="1. اختيار الملف · Fichier">
        <div className="space-y-2 text-sm">
          <p className="text-[var(--app-text-muted)]">
            ملف attlog.dat أو *_attlog.dat أو تصدير CSV/TXT من الجهاز (حتى 5 ميغابايت). يُقرأ محلياً ثم يُرسل نصه فقط؛ إعادة استيراد نفس الملف لا تُنشئ أي تكرار.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[var(--app-border)] px-4 py-3 font-bold hover:bg-[var(--app-bg-muted)]">
            <FileUp className="h-4 w-4" />
            {fileName ?? 'اختر ملفاً'}
            <input type="file" accept=".dat,.txt,.csv,.tsv,text/plain,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      </Panel>

      <Panel title="2. ترتيب الأعمدة · Colonnes">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {colSelect('pin', 'معرّف المستخدم', false)}
          {colSelect('time', 'التاريخ والوقت', false)}
          {colSelect('status', 'الحالة (دخول/خروج)', true)}
          {colSelect('verify', 'طريقة التحقق', true)}
          {colSelect('workCode', 'Work code', true)}
          <Select label="الفاصل" value={map.delimiter} onChange={(e) => setMap({ ...map, delimiter: e.target.value as ColumnMap['delimiter'] })}>
            <option value="auto">تلقائي</option>
            <option value="tab">Tab</option>
            <option value="comma">,</option>
            <option value="semicolon">;</option>
            <option value="whitespace">مسافات</option>
          </Select>
          <Select label="ترتيب التاريخ" value={map.dateOrder} onChange={(e) => setMap({ ...map, dateOrder: e.target.value as ColumnMap['dateOrder'] })}>
            <option value="DMY">يوم/شهر/سنة</option>
            <option value="MDY">شهر/يوم/سنة</option>
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setMap(DEFAULT_MAP)}>
            ترتيب ZKTeco الافتراضي
          </Button>
          <Button disabled={!content} loading={dry.isPending} onClick={() => dry.mutate()}>
            معاينة (بدون حفظ)
          </Button>
        </div>
      </Panel>

      {preview ? (
        <Panel title="3. المعاينة · Aperçu">
          <div className="space-y-3 text-sm">
            {preview.alreadyImportedAt ? (
              <Notice tone="warning">هذا الملف استُورد سابقاً في {dateTimeDz(preview.alreadyImportedAt)} — إعادة استيراده لن تضيف إلا البصمات الجديدة.</Notice>
            ) : null}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <StatCard label="الأسطر" value={preview.totalLines} />
              <StatCard label="صالحة" value={preview.validCount} tone="success" />
              <StatCard label="غير صالحة" value={preview.invalidCount} tone={preview.invalidCount ? 'danger' : 'default'} />
              <StatCard label="معرّفات" value={preview.users} />
              <StatCard label="غير مربوطة" value={preview.unmappedUsers.length} tone={preview.unmappedUsers.length ? 'warning' : 'default'} />
            </div>
            <p className="text-xs">
              من <b dir="ltr">{preview.firstPunch ?? '—'}</b> إلى <b dir="ltr">{preview.lastPunch ?? '—'}</b> (بتوقيت الجهاز)
            </p>
            {preview.unmappedUsers.length ? (
              <Notice tone="warning">
                معرّفات غير مربوطة: <span dir="ltr">{preview.unmappedUsers.slice(0, 40).join(', ')}</span>. ستُحفظ بصماتها وتُنسب للعامل عند ربطها لاحقاً.
              </Notice>
            ) : null}
            <p className="font-bold">الأسطر الخام (أول 12) — رقم العمود فوق كل خانة:</p>
            <div className="overflow-x-auto" dir="ltr">
              <table className="text-xs">
                <thead>
                  <tr>
                    {Array.from({ length: Math.max(0, ...preview.rawPreview.map((r) => r.length)) }, (_, i) => (
                      <th key={i} className="border px-2 py-1">
                        {i}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rawPreview.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} className={cn('border px-2 py-0.5 font-mono', j === map.pin && 'bg-sky-100 dark:bg-sky-900/40', j === map.time && 'bg-emerald-100 dark:bg-emerald-900/40')}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.sample.length ? (
              <>
                <p className="font-bold">كيف فهمها Oilix:</p>
                <Table minWidth={500}>
                  <thead>
                    <tr>
                      <Th>السطر</Th>
                      <Th>المعرّف</Th>
                      <Th>الوقت (الجهاز)</Th>
                      <Th>التحقق</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((s) => (
                      <tr key={s.lineNo}>
                        <Td className="text-xs">{s.lineNo}</Td>
                        <Td className="font-mono">{s.deviceUserId}</Td>
                        <Td className="font-mono text-xs">{s.localTime}</Td>
                        <Td className="text-xs">{label.verify(s.verifyMethod).ar}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </>
            ) : null}
            {preview.invalidSample.length ? (
              <details className="text-xs">
                <summary className="cursor-pointer font-bold text-red-700">أسطر مرفوضة ({preview.invalidCount})</summary>
                <ul className="mt-1 space-y-0.5" dir="ltr">
                  {preview.invalidSample.map((s) => (
                    <li key={s.lineNo}>
                      #{s.lineNo}: <code>{s.line}</code> — {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Check label="حفظ ترتيب الأعمدة لهذا الجهاز" checked={saveMap} onChange={setSaveMap} />
              <Button disabled={!preview.validCount} loading={commit.isPending} onClick={() => commit.mutate()}>
                استيراد {preview.validCount} بصمة
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {result ? (
        <Notice tone={result.inserted ? 'success' : 'info'}>
          <p className="font-black">
            {result.inserted} بصمة جديدة · {result.duplicates} مكررة (تجاهل) · {result.unmapped} غير مربوطة · {result.invalid} غير صالحة
          </p>
          {result.reprocessed ? (
            <p>
              أُعيد حساب الحضور من {result.reprocessed.from} إلى {result.reprocessed.to} ({result.reprocessed.employees} عامل).
            </p>
          ) : null}
          {result.firstEventEver ? <p className="font-bold">✅ أول بصمات حقيقية لهذا الجهاز وصلت إلى Oilix.</p> : null}
        </Notice>
      ) : null}
    </div>
  );
}

function LogsTab({ deviceId }: { deviceId: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['hr', 'sync-logs', deviceId, page],
    queryFn: async () =>
      (await api.get<{ items: SyncLog[]; meta: { pages: number; total: number } }>('/hr/devices/sync-logs', { params: { deviceId, page, limit: 30 } })).data,
  });
  const items = q.data?.items ?? [];
  return (
    <Panel title={`سجل المزامنة (${q.data?.meta.total ?? 0})`} bodyClassName="p-0">
      <QueryState q={q}>
        {items.length ? (
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>الوقت</Th>
                <Th>المصدر</Th>
                <Th>الحالة</Th>
                <Th>مستلمة / جديدة / مكررة</Th>
                <Th>غير مربوطة / غير صالحة</Th>
                <Th>تفاصيل</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap text-xs">{dateTimeDz(l.startedAt)}</Td>
                  <Td className="text-xs">
                    {label.trigger(l.trigger).ar}
                    {l.userName ? <p className="text-[var(--app-text-dim)]">{l.userName}</p> : null}
                  </Td>
                  <Td>
                    <StatusBadge l={label.sync(l.status)} />
                  </Td>
                  <Td className="tabular-nums">
                    {l.fetchedCount} / <b>{l.insertedCount}</b> / {l.duplicateCount}
                  </Td>
                  <Td className="tabular-nums">
                    {l.unmappedCount} / {l.invalidCount}
                  </Td>
                  <Td className="max-w-[22rem] text-xs">
                    {l.fileName ? <p>{l.fileName}</p> : null}
                    {l.errorMessage ? <p className="text-red-700 dark:text-red-400">{l.errorMessage}</p> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState text="لا يوجد سجل بعد" />
        )}
      </QueryState>
      {(q.data?.meta.pages ?? 1) > 1 ? (
        <div className="flex items-center justify-center gap-2 p-3">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            السابق
          </Button>
          <span className="text-xs">
            {page} / {q.data?.meta.pages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= (q.data?.meta.pages ?? 1)} onClick={() => setPage(page + 1)}>
            التالي
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
