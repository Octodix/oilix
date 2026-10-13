'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HrPageHeader, Panel, QueryState, Select, Table, Td, TextInput, Th } from '@/components/hr/hr-ui';
import { api, type Paginated } from '@/lib/api';
import { auditActionLabel, formatAuditDiff } from '@/lib/audit-labels';
import { dateTimeDz } from '@/lib/hr-labels';

type AuditLog = {
  id: string;
  action: string;
  description?: string | null;
  entity: string;
  entityId?: string | null;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  createdAt: string;
  user?: { username: string; firstName?: string | null; lastName?: string | null } | null;
};

const ENTITIES: Record<string, string> = {
  HrEmployee: 'عامل',
  HrContract: 'عقد',
  HrWorkSchedule: 'توقيت',
  HrScheduleAssignment: 'تعيين توقيت',
  HrAttendanceCorrection: 'تصحيح حضور',
  HrAttendanceDay: 'يوم حضور',
  HrAttendanceDevice: 'جهاز بصمة',
  HrAttendanceDeviceUser: 'ربط جهاز',
  HrAttendanceSyncLog: 'مزامنة',
  HrLeaveRequest: 'عطلة',
  HrSickLeave: 'عطلة مرضية',
  HrAbsence: 'غياب',
  HrOvertime: 'ساعات إضافية',
  HrAdvance: 'تسبيق',
  HrLoan: 'قرض',
  HrBonus: 'منحة',
  HrDeduction: 'اقتطاع',
  HrPayrollPeriod: 'فترة أجور',
  HrSalaryPayment: 'دفع أجر',
  HrExpense: 'مصروف',
  HrSettings: 'إعدادات',
};

export default function HrAuditPage() {
  const [entity, setEntity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ['hr', 'audit', entity, dateFrom, dateTo, search, page],
    queryFn: async () =>
      (
        await api.get<Paginated<AuditLog>>('/audit-logs', {
          params: {
            module: 'hr',
            page,
            limit: 100,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            search: search.trim() || entity || undefined,
          },
        })
      ).data,
  });
  const items = (q.data?.items ?? []).filter((l) => !entity || l.entity === entity);

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="سجل العمليات"
        fr="Journal d’audit RH"
        icon={ScrollText}
        subtitle="كل عملية حساسة: من، متى، القيمة السابقة والجديدة، والسبب."
      />
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="النوع" value={entity} onChange={(e) => (setEntity(e.target.value), setPage(1))}>
            <option value="">الكل</option>
            {Object.entries(ENTITIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <TextInput label="من" type="date" value={dateFrom} onChange={(e) => (setDateFrom(e.target.value), setPage(1))} />
          <TextInput label="إلى" type="date" value={dateTo} onChange={(e) => (setDateTo(e.target.value), setPage(1))} />
          <TextInput label="بحث" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} placeholder="اسم عامل، مبلغ…" />
        </div>
      </Panel>
      <QueryState q={q} empty={!items.length} emptyText="لا توجد عمليات">
        <Panel bodyClassName="p-0">
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>الوقت</Th>
                <Th>المستخدم</Th>
                <Th>الإجراء</Th>
                <Th>النوع</Th>
                <Th>الوصف</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => {
                const diff = formatAuditDiff(l.oldData, l.newData);
                return (
                  <tr key={l.id} className="align-top">
                    <Td className="whitespace-nowrap text-xs">{dateTimeDz(l.createdAt)}</Td>
                    <Td className="text-xs">
                      <p className="font-bold">{l.user?.username ?? '—'}</p>
                      {l.user?.firstName ? <p className="text-[var(--app-text-dim)]">{`${l.user.firstName} ${l.user.lastName ?? ''}`}</p> : null}
                    </Td>
                    <Td className="text-xs font-bold">{auditActionLabel(l.action)}</Td>
                    <Td className="text-xs">{ENTITIES[l.entity] ?? l.entity}</Td>
                    <Td className="max-w-2xl text-sm">
                      {l.description ?? `${l.entity}${l.entityId ? ` #${l.entityId.slice(0, 8)}` : ''}`}
                      {diff ? (
                        <p className="mt-1 text-xs text-[var(--app-text-dim)]" dir="ltr">
                          {diff}
                        </p>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {(q.data?.meta.totalPages ?? 1) > 1 ? (
            <div className="flex items-center justify-center gap-2 p-3">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                السابق
              </Button>
              <span className="text-xs">
                {page} / {q.data?.meta.totalPages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= (q.data?.meta.totalPages ?? 1)} onClick={() => setPage(page + 1)}>
                التالي
              </Button>
            </div>
          ) : null}
        </Panel>
      </QueryState>
    </div>
  );
}
