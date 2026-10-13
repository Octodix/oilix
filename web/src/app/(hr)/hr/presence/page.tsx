'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Radio, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  EmployeeCell,
  HrPageHeader,
  Notice,
  QueryState,
  StatusBadge,
  Table,
  Td,
  Th,
  TextInput,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import {
  ageLabel,
  dateTimeDz,
  deviceStatus,
  fmtDay,
  fmtMinutes,
  fullName,
  label,
  LIVE_BUCKET_ORDER,
  timeDz,
} from '@/lib/hr-labels';
import { cn } from '@/lib/utils';

type LiveItem = {
  employee: { id: string; matricule: string; firstName: string; lastName: string; jobTitle: string | null; department: { name: string } | null };
  status: string;
  bucket: string;
  firstIn: string | null;
  lastOut: string | null;
  punchCount: number;
  isLate: boolean;
  lateMinutes: number;
  inVerifyMethod: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  flags: string[];
};

type Live = {
  date: string;
  generatedAt: string;
  lastSyncAt: string | null;
  lastEventReceivedAt: string | null;
  devices: { id: string; name: string; provider: string; status: string; lastConnectionAt: string | null; lastEventAt: string | null }[];
  counts: Record<string, number>;
  items: LiveItem[];
};

export default function PresencePage() {
  const [bucket, setBucket] = useState('');
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['hr', 'live'],
    queryFn: async () => (await api.get<Live>('/hr/attendance/live')).data,
    refetchInterval: 30_000,
  });

  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.items ?? []).filter(
      (i) =>
        (!bucket || i.bucket === bucket) &&
        (!s || fullName(i.employee).toLowerCase().includes(s) || i.employee.matricule.toLowerCase().includes(s)),
    );
  }, [q.data, bucket, search]);

  const d = q.data;
  const stale = d?.devices.some((x) => x.status !== 'ONLINE' && x.provider !== 'ZKTECO_FILE');

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="الحضور اليوم"
        fr="Présence aujourd'hui"
        icon={Radio}
        subtitle={
          d ? (
            <>
              {fmtDay(d.date)} · آخر مزامنة / Dernière synchro :{' '}
              <strong>{d.lastSyncAt ? dateTimeDz(d.lastSyncAt) : '—'}</strong> ({ageLabel(d.lastSyncAt)}) · تحديث تلقائي كل 30 ثانية
            </>
          ) : null
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => void q.refetch()} loading={q.isFetching}>
            <RefreshCw className="h-4 w-4" />
            تحديث
          </Button>
        }
      />

      {d && d.devices.length === 0 ? (
        <Notice tone="warning">
          لا يوجد جهاز بصمة مفعّل: هذه الحالة محسوبة فقط من التسجيلات اليدوية والملفات المستوردة. ·{' '}
          <Link href="/hr/devices" className="font-bold underline">
            إضافة جهاز
          </Link>
        </Notice>
      ) : null}
      {stale ? (
        <Notice tone="warning">
          <p className="font-bold">تنبيه: جهاز بصمة غير متصل — قد لا تظهر آخر البصمات · Terminal hors ligne</p>
          <ul className="mt-1 text-xs">
            {d?.devices.map((x) => {
              const s = deviceStatus(x.status);
              return (
                <li key={x.id}>
                  {s.dot} {x.name}: {s.ar} · {s.fr} — آخر اتصال {ageLabel(x.lastConnectionAt)}
                </li>
              );
            })}
          </ul>
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <BucketChip active={!bucket} onClick={() => setBucket('')} text="الكل · Tous" n={d?.items.length ?? 0} />
        {LIVE_BUCKET_ORDER.map((b) => (
          <BucketChip key={b} active={bucket === b} onClick={() => setBucket(b)} text={label.bucket(b).ar} n={d?.counts[b] ?? 0} />
        ))}
      </div>

      <div className="max-w-sm">
        <TextInput placeholder="بحث بالاسم أو الرقم…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <QueryState q={q} empty={items.length === 0} emptyText="لا يوجد عمال في هذه الفئة">
        <Table minWidth={900}>
          <thead>
            <tr>
              <Th>العامل</Th>
              <Th>الحالة</Th>
              <Th>التوقيت المبرمج</Th>
              <Th>الدخول</Th>
              <Th>الخروج</Th>
              <Th>البصمات</Th>
              <Th>التأخر</Th>
              <Th>طريقة التحقق</Th>
              <Th>ملاحظات</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.employee.id}>
                <Td>
                  <Link href={`/hr/employees/${i.employee.id}`} className="hover:underline">
                    <EmployeeCell e={i.employee} sub={i.employee.department?.name ?? i.employee.jobTitle ?? undefined} />
                  </Link>
                </Td>
                <Td>
                  <StatusBadge l={label.bucket(i.bucket)} />
                </Td>
                <Td className="text-xs tabular-nums" >
                  {i.scheduledStart ? `${timeDz(i.scheduledStart)} → ${timeDz(i.scheduledEnd)}` : '—'}
                </Td>
                <Td className="font-bold tabular-nums">{timeDz(i.firstIn)}</Td>
                <Td className="tabular-nums">{i.lastOut ? timeDz(i.lastOut) : '—'}</Td>
                <Td className="tabular-nums">{i.punchCount}</Td>
                <Td className={cn('tabular-nums', i.isLate && 'font-bold text-amber-700 dark:text-amber-400')}>
                  {i.isLate ? fmtMinutes(i.lateMinutes) : '—'}
                </Td>
                <Td className="text-xs">{i.inVerifyMethod ? label.verify(i.inVerifyMethod).ar : '—'}</Td>
                <Td className="text-[11px]">
                  {i.flags.map((f) => (
                    <span key={f} className="ml-1 inline-block">
                      {label.flag(f).ar}
                    </span>
                  ))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
    </div>
  );
}

function BucketChip({ active, onClick, text, n }: { active: boolean; onClick: () => void; text: string; n: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition',
        active
          ? 'border-sky-700 bg-sky-700 text-white'
          : 'border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text-muted)] hover:border-sky-600',
      )}
    >
      {text}
      <span className="tabular-nums">{n}</span>
    </button>
  );
}
