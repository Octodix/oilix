'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiError, Check, Modal, Notice, Select, TextArea, TextInput } from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { ageLabel, dateTimeDz, deviceStatus, PROVIDER, type Label } from '@/lib/hr-labels';

export type Capabilities = { connectionTest: boolean; pullLogs: boolean; pushLogs: boolean; fileImport: boolean; listUsers: boolean };

export type Device = {
  id: string;
  name: string;
  model: string | null;
  serialNumber: string | null;
  ipAddress: string | null;
  port: number | null;
  provider: string;
  providerLabel: string;
  capabilities: Capabilities | null;
  commKey: string | null;
  hasCommKey: boolean;
  location: string | null;
  isEnabled: boolean;
  timezoneOffsetMinutes: number;
  fileColumnMap: Record<string, unknown> | null;
  syncIntervalMinutes: number;
  status: string;
  lastConnectionAt: string | null;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  lastEventAt: string | null;
  deviceInfo: Record<string, unknown> | null;
  lastDiagnostic: ProbeResult | null;
  lastDiagnosticAt: string | null;
  firstEventImportedAt: string | null;
  notes: string | null;
  eventCount?: number;
  mappedUsers?: number;
  unmappedUsers?: number;
};

export type ProbeResult = {
  at: string;
  host: string;
  port: number;
  transport: 'TCP' | 'UDP' | null;
  conclusion: string;
  steps: { step: string; ok: boolean; detail: string; ms: number }[];
  deviceInfo: Record<string, string | undefined>;
};

export type TestResult = {
  ok: boolean;
  status: string;
  message: string;
  deviceInfo?: Record<string, string>;
  diagnostic?: ProbeResult;
  serialMismatch?: boolean;
  warning?: string | null;
};

export type SyncResult = { ok: boolean; mode: string; message: string };

/** What the UI shows — never "connected" without real evidence from the terminal. */
export function displayStatus(d: Pick<Device, 'provider' | 'status' | 'isEnabled' | 'lastConnectionAt'>): Label & { dot: string } {
  if (!d.isEnabled) return deviceStatus(null, false);
  if (d.provider === 'ZKTECO_FILE') return deviceStatus('NOT_APPLICABLE');
  if (d.status === 'UNKNOWN' && !d.lastConnectionAt) return deviceStatus(d.provider === 'ZKTECO_ADMS' ? 'WAITING_FOR_DEVICE' : 'NEVER_CONNECTED');
  return deviceStatus(d.status);
}

const CONCLUSION: Record<string, string> = {
  SDK_CONNECTED: '🟢 الجهاز يجيب ببروتوكول ZKTeco SDK · Terminal ZKTeco joignable',
  SDK_AUTH_REQUIRED: '🔴 الجهاز يطلب مفتاح اتصال (Comm Key) · Clé de communication requise',
  SDK_AUTH_FAILED: '🔴 مفتاح الاتصال مرفوض · Clé refusée',
  PORT_OPEN_NO_ZK_REPLY: '🟠 المنفذ مفتوح لكن الرد ليس ZKTeco · Port ouvert, réponse non ZKTeco',
  UNREACHABLE: '🔴 لا رد من العنوان (TCP ولا UDP) · Injoignable',
};

export function ProbeView({ probe }: { probe: ProbeResult }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-bold">{CONCLUSION[probe.conclusion] ?? probe.conclusion}</p>
      <p className="text-xs text-[var(--app-text-dim)]" dir="ltr">
        {probe.host}:{probe.port} · {probe.transport ?? '—'} · {dateTimeDz(probe.at)}
      </p>
      <ol className="space-y-1 text-xs" dir="ltr">
        {probe.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            {s.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />}
            <span>
              <strong>{s.step}</strong> — {s.detail} <span className="text-[var(--app-text-dim)]">({s.ms} ms)</span>
            </span>
          </li>
        ))}
      </ol>
      <InfoTable info={probe.deviceInfo} />
    </div>
  );
}

export function InfoTable({ info }: { info: Record<string, unknown> | null | undefined }) {
  const entries = Object.entries(info ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-[var(--app-border)] p-2 text-xs" dir="ltr">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-bold text-[var(--app-text-dim)]">{k}</dt>
          <dd className="break-all">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TestResultModal({ result, onClose }: { result: TestResult | null; onClose: () => void }) {
  const st = result ? deviceStatus(result.status) : null;
  return (
    <Modal open={!!result} onClose={onClose} title="نتيجة اختبار الاتصال · Test de connexion" footer={<Button onClick={onClose}>إغلاق</Button>}>
      {result && st ? (
        <div className="space-y-3">
          <Notice tone={result.ok ? 'success' : result.status === 'WAITING_FOR_DEVICE' || result.status === 'NOT_APPLICABLE' ? 'info' : 'danger'}>
            <p className="font-black">
              {st.dot} {st.ar} · {st.fr}
            </p>
            <p className="mt-1">{result.message}</p>
          </Notice>
          {result.warning ? <Notice tone="warning">{result.warning}</Notice> : null}
          <InfoTable info={result.deviceInfo} />
          {result.diagnostic ? <ProbeView probe={result.diagnostic} /> : null}
          {result.ok && result.status === 'ONLINE' ? (
            <p className="text-xs text-[var(--app-text-dim)]">
              الاتصال وحده لا يكفي: يُعتبر الربط مؤكداً فقط بعد وصول بصمة حقيقية (إصبع أو بطاقة) إلى Oilix.
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

export function DiagnoseModal({ open, onClose, initialHost }: { open: boolean; onClose: () => void; initialHost?: string | null }) {
  const [seed, setSeed] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4370');
  const [commKey, setCommKey] = useState('');
  const [result, setResult] = useState<ProbeResult | null>(null);
  if (open !== seed) {
    setSeed(open);
    if (open) {
      setHost(initialHost ?? '');
      setPort('4370');
      setCommKey('');
      setResult(null);
    }
  }
  const m = useMutation({
    mutationFn: async () =>
      (await api.post<ProbeResult>('/hr/devices/diagnose', { host: host.trim(), port: Number(port) || 4370, commKey: commKey.trim() || null })).data,
    onSuccess: setResult,
    onError: (e) => toast.error(apiError(e)),
  });
  const hostOk = /^(\d{1,3}\.){3}\d{1,3}$/.test(host.trim());
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تشخيص الشبكة · Diagnostic réseau"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
          <Button disabled={!hostOk || (!!commKey && !/^\d{1,9}$/.test(commKey))} loading={m.isPending} onClick={() => m.mutate()}>
            فحص
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--app-text-muted)]">
          يفحص عنواناً واحداً على الشبكة المحلية فقط (192.168.x.x / 10.x.x.x / 172.16-31.x.x) بمنفذ SDK ZKTeco. لا يقرأ ولا ينقل أي بصمات أو قوالب.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput label="عنوان IP للجهاز" dir="ltr" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.201" />
          <TextInput label="المنفذ" dir="ltr" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
          <TextInput label="Comm Key (اختياري)" dir="ltr" value={commKey} onChange={(e) => setCommKey(e.target.value)} placeholder="0" />
        </div>
        {result ? <ProbeView probe={result} /> : null}
      </div>
    </Modal>
  );
}

type FormState = {
  name: string;
  provider: string;
  model: string;
  serialNumber: string;
  ipAddress: string;
  port: string;
  commKey: string;
  clearCommKey: boolean;
  location: string;
  isEnabled: boolean;
  timezoneOffsetMinutes: string;
  notes: string;
};

function toForm(d?: Device | null): FormState {
  return {
    name: d?.name ?? '',
    provider: d?.provider ?? 'ZKTECO_ADMS',
    model: d?.model ?? '',
    serialNumber: d?.serialNumber ?? '',
    ipAddress: d?.ipAddress ?? '',
    port: d?.port ? String(d.port) : '',
    commKey: '',
    clearCommKey: false,
    location: d?.location ?? '',
    isEnabled: d?.isEnabled ?? true,
    timezoneOffsetMinutes: String(d?.timezoneOffsetMinutes ?? 60),
    notes: d?.notes ?? '',
  };
}

export function DeviceFormModal({ open, onClose, device }: { open: boolean; onClose: () => void; device?: Device | null }) {
  const qc = useQueryClient();
  const [seed, setSeed] = useState<string | null>(null);
  const [f, setF] = useState<FormState>(toForm(device));
  const seedKey = open ? (device?.id ?? 'new') : null;
  if (seedKey !== seed) {
    setSeed(seedKey);
    if (open) setF(toForm(device));
  }
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const m = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        provider: f.provider,
        model: f.model.trim() || null,
        serialNumber: f.serialNumber.trim() || null,
        ipAddress: f.ipAddress.trim() || null,
        port: f.port ? Number(f.port) : null,
        location: f.location.trim() || null,
        isEnabled: f.isEnabled,
        timezoneOffsetMinutes: Number(f.timezoneOffsetMinutes),
        notes: f.notes.trim() || null,
      };
      if (f.commKey.trim()) body.commKey = f.commKey.trim();
      else if (f.clearCommKey) body.commKey = null;
      return device ? (await api.patch(`/hr/devices/${device.id}`, body)).data : (await api.post('/hr/devices', body)).data;
    },
    onSuccess: () => {
      toast.success(device ? 'تم حفظ الجهاز' : 'تمت إضافة الجهاز');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const ipOk = !f.ipAddress.trim() || /^(\d{1,3}\.){3}\d{1,3}$/.test(f.ipAddress.trim());
  const keyOk = !f.commKey.trim() || /^\d{1,9}$/.test(f.commKey.trim());
  const tz = Number(f.timezoneOffsetMinutes);
  const ok =
    f.name.trim().length >= 2 &&
    ipOk &&
    keyOk &&
    Number.isInteger(tz) &&
    (f.provider !== 'ZKTECO_ADMS' || !!f.serialNumber.trim()) &&
    (f.provider !== 'ZKTECO_TCP' || !!f.ipAddress.trim());

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={device ? `تعديل ${device.name}` : 'جهاز بصمة جديد · Nouvelle pointeuse'}
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
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="الاسم · Nom" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="Pointeuse entrée" />
          <Select label="طريقة الاتصال · Mode" value={f.provider} onChange={(e) => set('provider', e.target.value)}>
            {Object.keys(PROVIDER).map((p) => (
              <option key={p} value={p}>
                {PROVIDER[p].ar}
              </option>
            ))}
          </Select>
          <TextInput
            label={`الرقم التسلسلي (SN)${f.provider === 'ZKTECO_ADMS' ? ' — إلزامي' : ''}`}
            dir="ltr"
            value={f.serialNumber}
            onChange={(e) => set('serialNumber', e.target.value.toUpperCase())}
            maxLength={40}
            placeholder="CQU4233560067"
            hint="من الملصق خلف الجهاز أو Menu → System Info"
          />
          <TextInput label="الطراز · Modèle" value={f.model} onChange={(e) => set('model', e.target.value)} maxLength={80} />
          <TextInput
            label={`عنوان IP${f.provider === 'ZKTECO_TCP' ? ' — إلزامي' : ' (اختياري)'}`}
            dir="ltr"
            value={f.ipAddress}
            onChange={(e) => set('ipAddress', e.target.value)}
            maxLength={15}
            placeholder="192.168.1.201"
          />
          <TextInput label="المنفذ · Port" dir="ltr" type="number" value={f.port} onChange={(e) => set('port', e.target.value)} placeholder="4370" />
          <TextInput
            label="Comm Key"
            dir="ltr"
            value={f.commKey}
            onChange={(e) => set('commKey', e.target.value)}
            maxLength={9}
            placeholder={device?.hasCommKey ? '•••• (اتركه فارغاً للإبقاء)' : '0'}
            hint="رقمي فقط. لا يُعرض بعد الحفظ."
          />
          <TextInput label="المكان · Emplacement" value={f.location} onChange={(e) => set('location', e.target.value)} maxLength={120} />
          <TextInput
            label="فرق توقيت الجهاز (دقائق)"
            dir="ltr"
            type="number"
            value={f.timezoneOffsetMinutes}
            onChange={(e) => set('timezoneOffsetMinutes', e.target.value)}
            hint="الجزائر = 60"
          />
          <div className="flex flex-col justify-end gap-2 pb-1">
            <Check label="الجهاز مفعّل" checked={f.isEnabled} onChange={(v) => set('isEnabled', v)} />
            {device?.hasCommKey ? <Check label="حذف Comm Key المحفوظ" checked={f.clearCommKey} onChange={(v) => set('clearCommKey', v)} /> : null}
          </div>
        </div>
        <TextArea label="ملاحظات" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} />
        <ProviderHelp provider={f.provider} />
      </div>
    </Modal>
  );
}

export function ProviderHelp({ provider }: { provider: string }) {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'IP-SERVEUR';
  if (provider === 'ZKTECO_ADMS') {
    return (
      <Notice>
        <span className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="space-y-1 text-xs">
            <span className="block font-bold">ADMS: الجهاز هو من يتصل بـ Oilix ويرسل البصمات تلقائياً.</span>
            <span className="block">
              على الجهاز: Menu → COMM. → Cloud Server Setting (أو ADMS): Server Address = <b dir="ltr">{host}</b>، Port ={' '}
              <b dir="ltr">80</b> (عبر Nginx) أو <b dir="ltr">3001</b> (مباشرة إلى API)، HTTPS = OFF، Proxy = OFF.
            </span>
            <span className="block">يُقبل فقط الجهاز الذي سُجّل رقمه التسلسلي هنا. لا تُطلب البصمات/القوالب من الجهاز — فقط سجلات الحضور.</span>
          </span>
        </span>
      </Notice>
    );
  }
  if (provider === 'ZKTECO_TCP') {
    return (
      <Notice tone="warning">
        وضع SDK (المنفذ 4370): يمكن اختبار الاتصال وقراءة معلومات الجهاز فقط. سحب التسجيلات عبر SDK غير مفعّل حتى يتم التحقق منه على الجهاز
        الحقيقي — استعمل ADMS أو استيراد ملف USB.
      </Notice>
    );
  }
  return <Notice>استيراد ملف: صدّر سجلات الحضور من الجهاز على مفتاح USB (Menu → USB Manager → Download → Attendance) ثم استوردها من صفحة الجهاز.</Notice>;
}

export function lastSeenLabel(d: Device): string {
  if (d.provider === 'ZKTECO_FILE') return d.lastSuccessfulSyncAt ? `آخر استيراد ${ageLabel(d.lastSuccessfulSyncAt)}` : 'لم يُستورد أي ملف';
  return d.lastConnectionAt ? `آخر اتصال ${ageLabel(d.lastConnectionAt)}` : 'لم يتصل بعد';
}
