'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Pencil, Plus, RefreshCw, Stethoscope, Trash2, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DeviceFormModal,
  DiagnoseModal,
  displayStatus,
  lastSeenLabel,
  ProviderHelp,
  TestResultModal,
  type Device,
  type SyncResult,
  type TestResult,
} from '@/components/hr/device-ui';
import { apiError, EmptyState, HrPageHeader, Notice, Panel, QueryState, StatusBadge, useCan } from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { ageLabel, dateTimeDz, label } from '@/lib/hr-labels';

export default function DevicesPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Device | null | undefined>(undefined);
  const [diagnosing, setDiagnosing] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const q = useQuery({
    queryKey: ['hr', 'devices'],
    queryFn: async () => (await api.get<Device[]>('/hr/devices')).data,
    refetchInterval: 30_000,
  });

  const test = useMutation({
    mutationFn: async (id: string) => (await api.post<TestResult>(`/hr/devices/${id}/test`)).data,
    onSuccess: (r) => {
      setTestResult(r);
      qc.invalidateQueries({ queryKey: ['hr', 'devices'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const sync = useMutation({
    mutationFn: async (id: string) => (await api.post<SyncResult>(`/hr/devices/${id}/sync`)).data,
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.warning(r.message, { duration: 10_000 });
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/devices/${id}`)).data,
    onSuccess: () => {
      toast.success('تم حذف الجهاز');
      qc.invalidateQueries({ queryKey: ['hr', 'devices'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const devices = q.data ?? [];
  const confirmed = devices.some((d) => d.firstEventImportedAt);

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="أجهزة البصمة"
        fr="Appareils de pointage"
        icon={Fingerprint}
        subtitle="البصمات تبقى في الجهاز — Oilix يستقبل فقط: من، متى، أين، وبأي طريقة تحقق."
        actions={
          can('HR_DEVICES_MANAGE') ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setDiagnosing(true)}>
                <Stethoscope className="h-4 w-4" /> تشخيص الشبكة
              </Button>
              <Button size="sm" onClick={() => setEditing(null)}>
                <Plus className="h-4 w-4" /> جهاز جديد
              </Button>
            </>
          ) : null
        }
      />

      {!confirmed ? (
        <Notice tone="warning">
          لم تصل بعد أي بصمة حقيقية من جهاز إلى Oilix. الربط لا يُعتبر مؤكداً إلا بعد أن يضع عامل إصبعه أو بطاقته على الجهاز وتظهر البصمة في «البصمات
          الخام». · Aucun pointage réel reçu pour l’instant.
        </Notice>
      ) : null}

      <QueryState q={q}>
        {devices.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {devices.map((d) => {
              const st = displayStatus(d);
              return (
                <Panel
                  key={d.id}
                  title={
                    <Link href={`/hr/devices/${d.id}`} className="hover:underline">
                      {d.name}
                    </Link>
                  }
                  action={
                    <span className="text-sm font-bold">
                      {st.dot} {st.ar} · {st.fr}
                    </span>
                  }
                >
                  <div className="space-y-3 text-sm">
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-[var(--app-text-dim)]">الطريقة</dt>
                      <dd>{label.provider(d.provider).ar}</dd>
                      <dt className="text-[var(--app-text-dim)]">الرقم التسلسلي</dt>
                      <dd dir="ltr" className="text-right">{d.serialNumber ?? '—'}</dd>
                      <dt className="text-[var(--app-text-dim)]">IP / Port</dt>
                      <dd dir="ltr" className="text-right">
                        {d.ipAddress ? `${d.ipAddress}${d.port ? `:${d.port}` : ''}` : '—'}
                      </dd>
                      <dt className="text-[var(--app-text-dim)]">الطراز / المكان</dt>
                      <dd>
                        {d.model ?? '—'} {d.location ? `· ${d.location}` : ''}
                      </dd>
                      <dt className="text-[var(--app-text-dim)]">الاتصال</dt>
                      <dd>{lastSeenLabel(d)}</dd>
                      <dt className="text-[var(--app-text-dim)]">آخر مزامنة ناجحة</dt>
                      <dd>{d.lastSuccessfulSyncAt ? dateTimeDz(d.lastSuccessfulSyncAt) : '—'}</dd>
                      <dt className="text-[var(--app-text-dim)]">آخر بصمة مستلمة</dt>
                      <dd>{d.lastEventAt ? `${dateTimeDz(d.lastEventAt)} (${ageLabel(d.lastEventAt)})` : '—'}</dd>
                      <dt className="text-[var(--app-text-dim)]">التسجيلات / العمال المربوطون</dt>
                      <dd>
                        {d.eventCount ?? 0} / {d.mappedUsers ?? 0}
                        {d.unmappedUsers ? <span className="font-bold text-amber-700"> · {d.unmappedUsers} معرّف غير مربوط</span> : null}
                      </dd>
                    </dl>
                    {d.firstEventImportedAt ? (
                      <StatusBadge l={{ ar: `أول بصمة حقيقية: ${dateTimeDz(d.firstEventImportedAt)}`, fr: 'Pointage réel reçu', tone: 'success' }} />
                    ) : d.provider !== 'ZKTECO_FILE' ? (
                      <StatusBadge l={{ ar: 'لم تصل أي بصمة حقيقية بعد', fr: 'Aucun pointage réel', tone: 'warning' }} />
                    ) : null}
                    {d.lastError ? <p className="text-xs text-red-700 dark:text-red-400">آخر خطأ: {d.lastError}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {can('HR_DEVICES_SYNC') && d.provider !== 'ZKTECO_FILE' ? (
                        <Button size="sm" variant="outline" loading={test.isPending && test.variables === d.id} onClick={() => test.mutate(d.id)}>
                          <Wifi className="h-4 w-4" /> اختبار الاتصال
                        </Button>
                      ) : null}
                      {can('HR_DEVICES_SYNC') && d.isEnabled && d.provider !== 'ZKTECO_FILE' ? (
                        <Button size="sm" variant="outline" loading={sync.isPending && sync.variables === d.id} onClick={() => sync.mutate(d.id)}>
                          <RefreshCw className="h-4 w-4" /> مزامنة الآن
                        </Button>
                      ) : null}
                      <Link href={`/hr/devices/${d.id}`}>
                        <Button size="sm" variant={d.provider === 'ZKTECO_FILE' ? 'primary' : 'ghost'}>
                          {d.provider === 'ZKTECO_FILE' ? 'استيراد ملف / الربط' : 'التفاصيل والربط'}
                        </Button>
                      </Link>
                      {can('HR_DEVICES_MANAGE') ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {!d.eventCount ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => confirm(`حذف الجهاز «${d.name}»؟`) && remove.mutate(d.id)}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                </Panel>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <EmptyState
              text="لا يوجد أي جهاز بصمة"
              hint="أضف الجهاز برقمه التسلسلي (من الملصق خلف الجهاز) ثم اختر طريقة الاتصال. إن لم تعرف الطريقة، استعمل «تشخيص الشبكة» بعنوان IP الجهاز."
            />
            <ProviderHelp provider="ZKTECO_ADMS" />
          </div>
        )}
      </QueryState>

      <DeviceFormModal open={editing !== undefined} device={editing ?? null} onClose={() => setEditing(undefined)} />
      <DiagnoseModal open={diagnosing} onClose={() => setDiagnosing(false)} />
      <TestResultModal result={testResult} onClose={() => setTestResult(null)} />
    </div>
  );
}
