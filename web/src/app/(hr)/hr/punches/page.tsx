'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Fingerprint } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Device } from '@/components/hr/device-ui';
import { Check, EmployeeCell, EmployeeSelect, EmptyState, HrPageHeader, Notice, Panel, QueryState, Select, Table, Td, TextInput, Th, useCan } from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { addDays, daysBetween, dateTimeDz, label, todayKeyDz } from '@/lib/hr-labels';

type Event = {
  id: string;
  source: string;
  deviceUserId: string;
  punchedAt: string;
  deviceLocalTime: string;
  punchState: number | null;
  verifyMethod: string;
  workCode: string | null;
  receivedAt: string;
  employee: { id: string; matricule: string; firstName: string; lastName: string } | null;
  device: { id: string; name: string; serialNumber: string | null } | null;
};

const SOURCE: Record<string, string> = { ADMS_PUSH: 'ADMS (تلقائي)', FILE_IMPORT: 'ملف USB', TCP_PULL: 'SDK TCP' };
const STATE: Record<number, string> = { 0: 'دخول', 1: 'خروج', 2: 'خروج استراحة', 3: 'عودة استراحة', 4: 'دخول إضافي', 5: 'خروج إضافي' };

export default function PunchesPage() {
  const can = useCan();
  const today = todayKeyDz();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [deviceId, setDeviceId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [unmapped, setUnmapped] = useState(false);
  const [deviceUserId, setDeviceUserId] = useState('');
  const [page, setPage] = useState(1);
  const rangeOk = !!from && !!to && from <= to && daysBetween(from, to) <= 366;

  const devicesQ = useQuery({
    queryKey: ['hr', 'devices'],
    enabled: can('HR_DEVICES_VIEW'),
    queryFn: async () => (await api.get<Device[]>('/hr/devices')).data,
  });
  const params = {
    from,
    to,
    page,
    limit: 100,
    ...(deviceId ? { deviceId } : {}),
    ...(employeeId && !unmapped ? { employeeId } : {}),
    ...(unmapped ? { unmapped: true } : {}),
    ...(deviceUserId.trim() ? { deviceUserId: deviceUserId.trim() } : {}),
  };
  const q = useQuery({
    queryKey: ['hr', 'events', params],
    enabled: rangeOk,
    queryFn: async () => (await api.get<{ items: Event[]; meta: { total: number; pages: number } }>('/hr/attendance/events', { params })).data,
  });
  const reset = () => setPage(1);
  const items = q.data?.items ?? [];

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="البصمات الخام"
        fr="Pointage (événements bruts)"
        icon={Fingerprint}
        subtitle="كما وصلت من الجهاز — لا تُعدَّل أبداً. التصحيحات تتم على مستوى الحضور اليومي وتُسجَّل في سجل التدقيق."
      />
      <Panel>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <TextInput label="من" type="date" value={from} onChange={(e) => (setFrom(e.target.value), reset())} />
          <TextInput label="إلى" type="date" value={to} onChange={(e) => (setTo(e.target.value), reset())} />
          <Select label="الجهاز" value={deviceId} onChange={(e) => (setDeviceId(e.target.value), reset())}>
            <option value="">الكل</option>
            {(devicesQ.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <EmployeeSelect value={employeeId} onChange={(v) => (setEmployeeId(v), reset())} allowAll includeLeft />
          <TextInput label="معرّف الجهاز" dir="ltr" value={deviceUserId} onChange={(e) => (setDeviceUserId(e.target.value), reset())} maxLength={32} />
          <div className="flex items-end pb-2">
            <Check label="غير مربوطة فقط" checked={unmapped} onChange={(v) => (setUnmapped(v), reset())} />
          </div>
        </div>
        {!rangeOk ? <p className="mt-2 text-xs text-red-600">نطاق غير صالح (366 يوماً كحد أقصى)</p> : null}
      </Panel>

      <QueryState q={q}>
        {items.length ? (
          <Panel title={`${q.data?.meta.total ?? 0} بصمة`} bodyClassName="p-0">
            <Table minWidth={1000}>
              <thead>
                <tr>
                  <Th>وقت الجهاز</Th>
                  <Th>العامل</Th>
                  <Th>معرّف الجهاز</Th>
                  <Th>التحقق</Th>
                  <Th>الحالة المعلنة</Th>
                  <Th>الجهاز</Th>
                  <Th>المصدر / الاستلام</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap font-mono text-xs">{e.deviceLocalTime}</Td>
                    <Td>
                      {e.employee ? (
                        <Link href={`/hr/employees/${e.employee.id}`} className="hover:underline">
                          <EmployeeCell e={e.employee} />
                        </Link>
                      ) : (
                        <span className="text-xs font-bold text-amber-700">غير مربوط</span>
                      )}
                    </Td>
                    <Td className="font-mono">{e.deviceUserId}</Td>
                    <Td className="text-xs">{label.verify(e.verifyMethod).ar}</Td>
                    <Td className="text-xs">{e.punchState === null ? '—' : (STATE[e.punchState] ?? e.punchState)}</Td>
                    <Td className="text-xs">
                      {e.device ? (
                        <Link href={`/hr/devices/${e.device.id}`} className="hover:underline">
                          {e.device.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="text-xs">
                      {SOURCE[e.source] ?? e.source}
                      <p className="text-[var(--app-text-dim)]">{dateTimeDz(e.receivedAt)}</p>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
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
        ) : (
          <EmptyState text="لا توجد بصمات في هذا النطاق" hint="البصمات تصل من الجهاز (ADMS) أو من استيراد ملف في صفحة الجهاز." />
        )}
      </QueryState>
      <Notice>الحالة المعلنة (دخول/خروج) هي ما ضغطه العامل على الجهاز؛ محرك الحضور يعتمد على التوقيت والجدول ولا يثق بها وحدها.</Notice>
    </div>
  );
}
