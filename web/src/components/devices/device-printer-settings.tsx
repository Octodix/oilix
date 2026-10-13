'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link2, Printer, RefreshCw, Unlink } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { printAgent, type DevicePrintSettingsResponse } from '@/lib/print-service';
import type { AgentPrinter } from '@/lib/print-agent-client';
import type { DevicePrintSettings, PrintTarget } from '@/lib/print-plan';
import { testPageRequest } from '@/lib/print-documents';
import { DEVICE_PRINT_SETTINGS_KEY, useDirectPrint } from '@/hooks/use-direct-print';

type DeviceInfo = { id: string; code: string | null; name: string };

const AGENT_HEALTH_KEY = ['print-agent-health'] as const;
const AGENT_PRINTERS_KEY = ['print-agent-printers'] as const;

const selectClass =
  'w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5';

function apiMessage(e: unknown, fallback: string) {
  const msg = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(' · ');
  return typeof msg === 'string' ? msg : fallback;
}

export function usePrintAgentStatus(enabled = true) {
  const health = useQuery({
    queryKey: AGENT_HEALTH_KEY,
    queryFn: () => printAgent().health(),
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const ready = health.data?.ok === true && health.data.paired;
  const printers = useQuery({
    queryKey: AGENT_PRINTERS_KEY,
    queryFn: () => printAgent().printers(),
    enabled: enabled && ready,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  return { health, printers, ready };
}

/** 🟢 / 🔴 indicator — one request on mount, refreshed on demand (no polling). */
export function PrintAgentBadge({ className }: { className?: string }) {
  const { health } = usePrintAgentStatus();
  const h = health.data;
  const ok = h?.ok === true;
  return (
    <button
      type="button"
      onClick={() => void health.refetch()}
      title={ok ? `Oilix Print Agent v${h.version}` : 'اضغط لإعادة الفحص'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold',
        ok
          ? 'border-emerald-600/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
          : 'border-red-600/30 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200',
        className,
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', ok ? 'bg-emerald-500' : 'bg-red-500')} />
      {health.isFetching
        ? 'جاري الفحص…'
        : ok
          ? h.paired
            ? 'Agent d’impression connecté'
            : 'Agent connecté — non appairé'
          : 'Agent d’impression indisponible'}
    </button>
  );
}

function AgentPanel({ device }: { device: DeviceInfo }) {
  const qc = useQueryClient();
  const { health, printers } = usePrintAgentStatus();
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const h = health.data;

  function refresh() {
    void qc.invalidateQueries({ queryKey: AGENT_HEALTH_KEY });
    void qc.invalidateQueries({ queryKey: AGENT_PRINTERS_KEY });
  }

  async function startPairing() {
    setBusy(true);
    const r = await printAgent().pairStart(device.code || device.name);
    setBusy(false);
    if (!r.ok) {
      toast.error(
        r.code === 'ORIGIN_NOT_ALLOWED'
          ? 'هذا العنوان غير مسموح به في إعدادات الوكيل (--allow-origin)'
          : r.code === 'AGENT_UNAVAILABLE'
            ? 'وكيل الطباعة غير متاح على هذا الجهاز'
            : 'تعذر بدء الربط — أعد المحاولة بعد قليل',
      );
      return;
    }
    setPairingId(r.pairingId);
    setCode('');
    toast.info('أدخل الرمز المكوّن من 6 أرقام الظاهر في نافذة Oilix Print Agent');
  }

  async function completePairing() {
    if (!pairingId) return;
    setBusy(true);
    const r = await printAgent().pairComplete(pairingId, code);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.code === 'WRONG_CODE' ? 'الرمز غير صحيح' : 'انتهت صلاحية الرمز — ابدأ من جديد');
      if (r.code !== 'WRONG_CODE') setPairingId(null);
      return;
    }
    setPairingId(null);
    toast.success('تم ربط هذا المتصفح بوكيل الطباعة');
    refresh();
  }

  function forget() {
    printAgent().forgetPairing();
    refresh();
  }

  const list = printers.data?.ok ? printers.data.printers : [];

  return (
    <section className="space-y-3 rounded-xl border border-[var(--app-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PrintAgentBadge />
          {h?.ok ? (
            <span className="text-xs text-[var(--app-text-dim)]">
              v{h.version}
              {h.renderer ? ` · ${h.renderer}` : ''}
            </span>
          ) : null}
        </div>
        <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          تحديث
        </Button>
      </div>

      {h && !h.ok ? (
        <p className="text-xs text-[var(--app-text-dim)]">
          ثبّت وشغّل «Oilix Print Agent» على هذا الجهاز لتفعيل الطباعة المباشرة. الطباعة عبر المتصفح
          تبقى متاحة دائماً.
        </p>
      ) : null}

      {h?.ok && !h.paired ? (
        pairingId ? (
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="رمز الربط · Code d’appairage"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-40"
            />
            <Button type="button" loading={busy} onClick={() => void completePairing()}>
              تأكيد
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPairingId(null)}>
              إلغاء
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            loading={busy}
            onClick={() => void startPairing()}
          >
            <Link2 className="h-4 w-4" />
            ربط هذا المتصفح بالوكيل · Appairer
          </Button>
        )
      ) : null}

      {h?.ok && h.paired ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[var(--app-text-dim)]">
            {printers.isLoading
              ? 'جاري البحث عن الطابعات…'
              : `${list.length} طابعة مكتشفة على هذا الجهاز`}
          </span>
          <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={forget}>
            <Unlink className="h-3.5 w-3.5" />
            إلغاء الربط
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function PrinterField({
  label,
  value,
  onChange,
  printers,
  disabled,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  printers: AgentPrinter[] | null;
  disabled?: boolean;
}) {
  if (!printers) {
    return (
      <Input
        label={label}
        value={value ?? ''}
        placeholder="اسم الطابعة كما يظهر في Windows"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  }
  const known = !value || printers.some((p) => p.name === value);
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">{label}</span>
      <select
        className={selectClass}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">— غير محددة —</option>
        {!known ? <option value={value!}>{value} (غير موجودة على هذا الجهاز)</option> : null}
        {printers.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
            {p.isDefault ? ' ★ (الافتراضية)' : ''}
            {p.offline ? ' — غير متصلة' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function SettingsForm({
  device,
  initial,
  isCurrentDevice,
  canManage,
  onClose,
}: {
  device: DeviceInfo;
  initial: DevicePrintSettings;
  isCurrentDevice: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<DevicePrintSettings>(initial);
  const { printers, ready } = usePrintAgentStatus(isCurrentDevice);
  const { print, busy } = useDirectPrint();
  const discovered = isCurrentDevice && ready && printers.data?.ok ? printers.data.printers : null;
  const set = <K extends keyof DevicePrintSettings>(k: K, v: DevicePrintSettings[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const ro = !canManage;

  const save = useMutation({
    mutationFn: async () =>
      (await api.put<DevicePrintSettingsResponse>(`/printing/settings/${device.id}`, form)).data,
    onSuccess: () => {
      toast.success('تم حفظ إعدادات الطباعة');
      void qc.invalidateQueries({ queryKey: DEVICE_PRINT_SETTINGS_KEY });
    },
    onError: (e) => toast.error(apiMessage(e, 'تعذر حفظ إعدادات الطباعة')),
  });

  function testPrint(target: PrintTarget) {
    const printer = target === 'receipt' ? form.receiptPrinter : form.documentPrinter;
    if (!printer) {
      toast.error('اختر الطابعة أولاً');
      return;
    }
    void print(testPageRequest(target, { deviceName: device.code || device.name, printerName: printer }), {
      settings: { ...form, directPrinting: true, receiptDirect: true },
      successMessage: 'تم إرسال صفحة الاختبار · Impression envoyée',
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ro) save.mutate();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Check
          label="الطباعة المباشرة · Impression directe"
          checked={form.directPrinting}
          disabled={ro}
          onChange={(v) => set('directPrinting', v)}
        />
        <Check
          label="الطباعة عبر المتصفح كبديل · Repli navigateur"
          checked={form.browserFallback}
          disabled={ro}
          onChange={(v) => set('browserFallback', v)}
        />
        <Check
          label="طباعة تلقائية بعد إتمام البيع · Imprimer automatiquement après validation de la vente"
          checked={form.autoPrintAfterSale}
          disabled={ro}
          onChange={(v) => set('autoPrintAfterSale', v)}
        />
      </div>

      <fieldset className="space-y-3 rounded-xl border border-[var(--app-border)] p-3">
        <legend className="px-1 text-sm font-black">طابعة الوصولات · Imprimante ticket</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <PrinterField
            label="الطابعة"
            value={form.receiptPrinter}
            printers={discovered}
            disabled={ro}
            onChange={(v) => set('receiptPrinter', v)}
          />
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">عرض الورق</span>
            <select
              className={selectClass}
              value={form.receiptPaperWidth}
              disabled={ro}
              onChange={(e) => set('receiptPaperWidth', Number(e.target.value) === 58 ? 58 : 80)}
            >
              <option value={80}>80 mm</option>
              <option value={58}>58 mm</option>
            </select>
          </label>
          <Input
            label="عدد النسخ"
            type="number"
            min={1}
            max={5}
            value={form.receiptCopies}
            disabled={ro}
            onChange={(e) => set('receiptCopies', Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Check
            label="طباعة الوصولات مباشرة · Ticket en direct"
            checked={form.receiptDirect}
            disabled={ro}
            onChange={(v) => set('receiptDirect', v)}
          />
          {isCurrentDevice ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={busy || !form.receiptPrinter}
              onClick={() => testPrint('receipt')}
            >
              <Printer className="h-4 w-4" />
              اختبار الطباعة · Tester l’impression
            </Button>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-[var(--app-border)] p-3">
        <legend className="px-1 text-sm font-black">طابعة المستندات · Imprimante documents</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          <PrinterField
            label="الطابعة"
            value={form.documentPrinter}
            printers={discovered}
            disabled={ro}
            onChange={(v) => set('documentPrinter', v)}
          />
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">حجم الورق</span>
            <select
              className={selectClass}
              value={form.documentPaperFormat}
              disabled={ro}
              onChange={(e) => set('documentPaperFormat', e.target.value === 'A5' ? 'A5' : 'A4')}
            >
              <option value="A4">A4</option>
              <option value="A5">A5</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">الاتجاه</span>
            <select
              className={selectClass}
              value={form.documentOrientation}
              disabled={ro}
              onChange={(e) =>
                set('documentOrientation', e.target.value === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT')
              }
            >
              <option value="PORTRAIT">عمودي · Portrait</option>
              <option value="LANDSCAPE">أفقي · Paysage</option>
            </select>
          </label>
          <Input
            label="عدد النسخ"
            type="number"
            min={1}
            max={5}
            value={form.documentCopies}
            disabled={ro}
            onChange={(e) => set('documentCopies', Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
          />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">
              اليومية المالية تُطبع على · Journée financière
            </span>
            <select
              className={selectClass}
              value={form.dayReportTarget}
              disabled={ro}
              onChange={(e) =>
                set('dayReportTarget', e.target.value === 'RECEIPT' ? 'RECEIPT' : 'DOCUMENT')
              }
            >
              <option value="DOCUMENT">طابعة المستندات (A4/A5)</option>
              <option value="RECEIPT">طابعة الوصولات (حرارية)</option>
            </select>
          </label>
          {isCurrentDevice ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={busy || !form.documentPrinter}
              onClick={() => testPrint('document')}
            >
              <Printer className="h-4 w-4" />
              اختبار الطباعة · Tester l’impression
            </Button>
          ) : null}
        </div>
      </fieldset>

      {!isCurrentDevice ? (
        <p className="text-xs text-[var(--app-text-dim)]">
          اكتشاف الطابعات واختبار الطباعة متاحان فقط عند فتح هذه الصفحة من الجهاز نفسه.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!ro ? (
          <Button type="submit" loading={save.isPending}>
            حفظ إعدادات الطباعة
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </form>
  );
}

/** Printer configuration of one workstation (stored per device, never per user). */
export function DevicePrinterSettings({
  device,
  isCurrentDevice,
  canManage,
  onClose,
}: {
  device: DeviceInfo;
  isCurrentDevice: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: [...DEVICE_PRINT_SETTINGS_KEY, device.id],
    queryFn: async () =>
      (await api.get<DevicePrintSettingsResponse>(`/printing/settings/${device.id}`)).data,
  });

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-black">
          الطابعات · Imprimantes: {device.code ? `${device.code} — ` : ''}
          {device.name}
        </h2>
        {isCurrentDevice ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            هذا الجهاز
          </span>
        ) : null}
      </div>
      {isCurrentDevice ? <AgentPanel device={device} /> : null}
      {q.isLoading ? (
        <p className="text-sm text-[var(--app-text-dim)]">جاري التحميل...</p>
      ) : q.isError || !q.data ? (
        <p className="text-sm text-red-600">تعذر تحميل إعدادات الطباعة</p>
      ) : (
        <SettingsForm
          key={device.id}
          device={device}
          initial={q.data.settings}
          isCurrentDevice={isCurrentDevice}
          canManage={canManage}
          onClose={onClose}
        />
      )}
    </div>
  );
}
