'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDateTimeDz } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/lib/auth-store';
import { useDeviceMe } from '@/hooks/use-device-me';
import { DevicePrinterSettings, PrintAgentBadge } from '@/components/devices/device-printer-settings';

type Register = { id: string; code: string; name: string; isActive: boolean };
type DeviceRow = {
  id: string;
  code: string | null;
  name: string;
  workspace: 'SALES' | 'MILL' | 'BOTH';
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  location?: string | null;
  lastSeenAt?: string | null;
  cashRegister?: { id: string; code: string; name: string } | null;
  _count?: { oilSales: number; oliveEntries: number };
};

const STATUS_AR: Record<string, string> = {
  PENDING: 'بانتظار الموافقة',
  ACTIVE: 'نشط',
  DISABLED: 'معطّل',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  ACTIVE: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
  DISABLED: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
};

const WS_AR: Record<string, string> = {
  SALES: 'بيع الزيت',
  MILL: 'المعصرة',
  BOTH: 'كلا المساحتين',
};

export function DevicesAdmin({ workspace }: { workspace: 'mill' | 'sales' }) {
  const qc = useQueryClient();
  const canManage = useAuthStore((s) =>
    s.hasPermission(workspace === 'sales' ? 'OIL_SALES_DEVICES_MANAGE' : 'MILL_DEVICES_MANAGE'),
  );
  const [selected, setSelected] = useState<DeviceRow | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [ws, setWs] = useState<'SALES' | 'MILL' | 'BOTH'>(workspace === 'sales' ? 'SALES' : 'MILL');
  const [registerId, setRegisterId] = useState('');
  const [location, setLocation] = useState('');
  const [printerDevice, setPrinterDevice] = useState<DeviceRow | null>(null);
  const deviceMeQ = useDeviceMe();
  const currentDeviceId = deviceMeQ.data?.device?.id ?? null;

  const listQ = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api.get<DeviceRow[]>('/devices')).data,
  });

  const registersQ = useQuery({
    queryKey: ['cash-registers'],
    queryFn: async () => (await api.get<Register[]>('/oil-sales/cash/registers')).data,
    enabled: workspace === 'sales',
  });

  const approveMut = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/devices/${selected!.id}/approve`, {
          code: code.trim(),
          name: name.trim(),
          workspace: ws,
          cashRegisterId: ws === 'MILL' ? undefined : registerId || undefined,
          location: location.trim() || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم اعتماد الجهاز');
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ['devices'] });
      void qc.invalidateQueries({ queryKey: ['device-me'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message || 'تعذر الاعتماد'),
  });

  const updateMut = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/devices/${selected!.id}`, {
          code: code.trim(),
          name: name.trim(),
          workspace: ws,
          cashRegisterId: ws === 'MILL' ? null : registerId || undefined,
          location: location.trim() || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success('تم تحديث الجهاز');
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ['devices'] });
      void qc.invalidateQueries({ queryKey: ['device-me'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message || 'تعذر التحديث'),
  });

  const disableMut = useMutation({
    mutationFn: async (id: string) => (await api.post(`/devices/${id}/disable`)).data,
    onSuccess: () => {
      toast.success('تم تعطيل الجهاز');
      void qc.invalidateQueries({ queryKey: ['devices'] });
      void qc.invalidateQueries({ queryKey: ['device-me'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message || 'تعذر التعطيل'),
  });

  const enableMut = useMutation({
    mutationFn: async (id: string) => (await api.post(`/devices/${id}/enable`)).data,
    onSuccess: () => {
      toast.success('تم تفعيل الجهاز');
      void qc.invalidateQueries({ queryKey: ['devices'] });
      void qc.invalidateQueries({ queryKey: ['device-me'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message || 'تعذر التفعيل'),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/devices/${id}`)).data,
    onSuccess: () => {
      toast.success('تم حذف الجهاز');
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ['devices'] });
      void qc.invalidateQueries({ queryKey: ['device-me'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message || 'تعذر الحذف'),
  });

  function pick(d: DeviceRow) {
    setSelected(d);
    setCode(d.code || (workspace === 'sales' ? 'VENTE-0' : 'HUILERIE-0'));
    setName(d.name);
    setWs(d.workspace);
    setRegisterId(d.cashRegister?.id || '');
    setLocation(d.location || '');
  }

  function onDisable(d: DeviceRow) {
    if (!confirm(`تعطيل الجهاز «${d.name}»؟ لن يتمكن من تنفيذ عمليات البيع أو الكتابة.`)) return;
    disableMut.mutate(d.id);
  }

  function onEnable(d: DeviceRow) {
    if (
      (d.workspace === 'SALES' || d.workspace === 'BOTH') &&
      !d.cashRegister?.id
    ) {
      toast.error('اربط الجهاز بصندوق نقدي أولاً عبر «تعديل»، ثم فعّله.');
      pick(d);
      return;
    }
    enableMut.mutate(d.id);
  }

  function onDelete(d: DeviceRow) {
    if (
      !confirm(
        `حذف الجهاز «${d.name}» نهائياً؟\nلن يُحذف السجل التشغيلي، لكن الجهاز سيُزال من القائمة ولا يمكن التراجع.`,
      )
    ) {
      return;
    }
    deleteMut.mutate(d.id);
  }

  const rows = listQ.data ?? [];
  const saving = approveMut.isPending || updateMut.isPending;

  const currentRow = rows.find((d) => d.id === currentDeviceId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">الطباعة المباشرة على هذا الجهاز:</span>
          <PrintAgentBadge />
        </div>
        {currentRow ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => setPrinterDevice(currentRow)}
          >
            <Printer className="h-4 w-4" />
            طابعات هذا الجهاز
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[var(--app-border)] text-right text-[var(--app-text-dim)]">
              <th className="px-3 py-2 font-semibold">الرمز</th>
              <th className="px-3 py-2 font-semibold">الاسم</th>
              <th className="px-3 py-2 font-semibold">المساحة</th>
              <th className="px-3 py-2 font-semibold">الحالة</th>
              <th className="px-3 py-2 font-semibold">الصندوق</th>
              <th className="px-3 py-2 font-semibold">آخر ظهور</th>
              <th className="px-3 py-2 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-b border-[var(--app-border)] last:border-0">
                <td className="px-3 py-2 font-mono font-bold">{d.code || '—'}</td>
                <td className="px-3 py-2">{d.name}</td>
                <td className="px-3 py-2">{WS_AR[d.workspace]}</td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold',
                      STATUS_CLASS[d.status],
                    )}
                  >
                    {STATUS_AR[d.status]}
                  </span>
                </td>
                <td className="px-3 py-2">{d.cashRegister?.name || '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {d.lastSeenAt ? formatDateTimeDz(d.lastSeenAt) : '—'}
                </td>
                {!canManage ? (
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => setPrinterDevice(d)}
                    >
                      <Printer className="h-3.5 w-3.5" />
                      الطابعات
                    </Button>
                  </td>
                ) : null}
                {canManage ? (
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {d.status !== 'PENDING' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => setPrinterDevice(d)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                          الطابعات
                        </Button>
                      ) : null}
                      {d.status === 'PENDING' ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => pick(d)}>
                          اعتماد
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" onClick={() => pick(d)}>
                          تعديل
                        </Button>
                      )}
                      {d.status === 'ACTIVE' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          loading={disableMut.isPending}
                          onClick={() => onDisable(d)}
                        >
                          تعطيل
                        </Button>
                      ) : null}
                      {d.status === 'DISABLED' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          loading={enableMut.isPending}
                          onClick={() => onEnable(d)}
                        >
                          تفعيل
                        </Button>
                      ) : null}
                      {d.status === 'PENDING' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          loading={disableMut.isPending}
                          onClick={() => onDisable(d)}
                        >
                          رفض / تعطيل
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        loading={deleteMut.isPending}
                        onClick={() => onDelete(d)}
                      >
                        حذف
                      </Button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-[var(--app-text-dim)]">لا أجهزة مسجّلة بعد</p>
        ) : null}
      </div>

      {selected && canManage ? (
        <form
          className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (selected.status === 'PENDING') {
              approveMut.mutate();
            } else {
              updateMut.mutate();
            }
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-black">
              {selected.status === 'PENDING' ? 'اعتماد الجهاز' : 'تعديل الجهاز'}: {selected.name}
            </h2>
            <span
              className={cn(
                'inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold',
                STATUS_CLASS[selected.status],
              )}
            >
              {STATUS_AR[selected.status]}
            </span>
          </div>
          {selected.status === 'DISABLED' ? (
            <p className="rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100">
              الجهاز معطّل حالياً. احفظ التعديلات ثم اضغط «تفعيل» من الجدول لإعادته للعمل.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="الرمز" value={code} onChange={(e) => setCode(e.target.value)} required />
            <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} required />
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">المساحة</span>
              <select
                className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5"
                value={ws}
                onChange={(e) => setWs(e.target.value as typeof ws)}
              >
                <option value="SALES">بيع الزيت</option>
                <option value="MILL">المعصرة</option>
                <option value="BOTH">كلا المساحتين</option>
              </select>
            </label>
            {ws !== 'MILL' ? (
              <label className="block text-sm">
                <span className="mb-1 block font-semibold text-[var(--app-text-muted)]">الصندوق</span>
                <select
                  className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5"
                  value={registerId}
                  onChange={(e) => setRegisterId(e.target.value)}
                  required
                >
                  <option value="">—</option>
                  {(registersQ.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} · {r.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Input label="الموقع (اختياري)" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving} loading={saving}>
              حفظ
            </Button>
            {selected.status === 'DISABLED' ? (
              <Button
                type="button"
                variant="primary"
                loading={enableMut.isPending}
                onClick={() => {
                  updateMut.mutate(undefined, {
                    onSuccess: () => {
                      enableMut.mutate(selected.id);
                    },
                  });
                }}
              >
                حفظ وتفعيل
              </Button>
            ) : null}
            {selected.status === 'ACTIVE' ? (
              <Button
                type="button"
                variant="danger"
                loading={disableMut.isPending}
                onClick={() => onDisable(selected)}
              >
                تعطيل
              </Button>
            ) : null}
            <Button
              type="button"
              variant="danger"
              loading={deleteMut.isPending}
              onClick={() => onDelete(selected)}
            >
              حذف
            </Button>
            <Button type="button" variant="outline" onClick={() => setSelected(null)}>
              إلغاء
            </Button>
          </div>
        </form>
      ) : null}

      {printerDevice ? (
        <DevicePrinterSettings
          key={printerDevice.id}
          device={printerDevice}
          isCurrentDevice={printerDevice.id === currentDeviceId}
          canManage={canManage}
          onClose={() => setPrinterDevice(null)}
        />
      ) : null}
    </div>
  );
}
