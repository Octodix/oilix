'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, Fingerprint, Plus, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmployeeFormModal } from '@/components/hr/employee-form';
import {
  Check,
  DepartmentSelect,
  downloadCsv,
  EmployeeCell,
  HrPageHeader,
  money,
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
import { EMPLOYEE_STATUS, fmtDay, fullName, label, toCsv } from '@/lib/hr-labels';

type EmployeeRow = {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  hasPhoto: boolean;
  phone: string | null;
  jobTitle: string | null;
  department: { id: string; name: string } | null;
  workSite: string | null;
  hireDate: string;
  status: string;
  leftAt: string | null;
  paymentMethod: string;
  archivedAt: string | null;
  deviceMappings: number;
  currentContract: {
    id: string;
    contractType: string;
    salaryMode: string;
    baseSalary: number | null;
    endDate: string | null;
  } | null;
};

export default function EmployeesPage() {
  const router = useRouter();
  const can = useCan();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const q = useQuery({
    queryKey: ['hr', 'employees', { status, departmentId, includeArchived }],
    queryFn: async () =>
      (
        await api.get<EmployeeRow[]>('/hr/employees', {
          params: {
            status: status || undefined,
            departmentId: departmentId || undefined,
            includeArchived: includeArchived || undefined,
          },
        })
      ).data,
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return q.data ?? [];
    return (q.data ?? []).filter((e) =>
      [e.matricule, e.firstName, e.lastName, e.phone, e.jobTitle].some((v) => v?.toLowerCase().includes(s)),
    );
  }, [q.data, search]);

  const showSalary = can('HR_SALARIES_VIEW');

  function exportCsv() {
    const headers = ['Matricule', 'Nom', 'Service', 'Poste', 'Téléphone', 'Embauche', 'Statut', 'Contrat', ...(showSalary ? ['Salaire de base'] : [])];
    const data = rows.map((e) => [
      e.matricule,
      fullName(e),
      e.department?.name ?? '',
      e.jobTitle ?? '',
      e.phone ?? '',
      fmtDay(e.hireDate),
      label.employee(e.status).fr,
      e.currentContract ? label.contractType(e.currentContract.contractType).fr : '',
      ...(showSalary ? [e.currentContract?.baseSalary ?? ''] : []),
    ]);
    downloadCsv(`employes-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, data));
  }

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="العمال"
        fr="Employés"
        icon={UsersRound}
        subtitle={q.data ? `${rows.length} عامل` : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
              <Download className="h-4 w-4" />
              CSV
            </Button>
            {can('HR_EMPLOYEES_CREATE') ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                عامل جديد
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextInput label="بحث · Recherche" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="الاسم، الرقم، الهاتف…" />
        <Select label="الحالة · Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">الكل</option>
          {Object.keys(EMPLOYEE_STATUS).map((s) => (
            <option key={s} value={s}>
              {label.employee(s).ar} · {label.employee(s).fr}
            </option>
          ))}
        </Select>
        <DepartmentSelect value={departmentId} onChange={setDepartmentId} />
        <div className="flex items-end pb-2">
          <Check label="إظهار المؤرشفين · Archivés" checked={includeArchived} onChange={setIncludeArchived} />
        </div>
      </div>

      <QueryState q={q} empty={rows.length === 0} emptyText="لا يوجد عمال" emptyHint={can('HR_EMPLOYEES_CREATE') ? 'أضف أول عامل بزر «عامل جديد».' : undefined}>
        <Table minWidth={980}>
          <thead>
            <tr>
              <Th>العامل</Th>
              <Th>القسم / المنصب</Th>
              <Th>التوظيف</Th>
              <Th>العقد الحالي</Th>
              {showSalary ? <Th>الأجر الأساسي</Th> : null}
              <Th>البصمة</Th>
              <Th>الحالة</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.id}
                className="cursor-pointer hover:bg-[var(--app-bg-muted)]"
                onClick={() => router.push(`/hr/employees/${e.id}`)}
              >
                <Td>
                  <Link href={`/hr/employees/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="hover:underline">
                    <EmployeeCell e={e} sub={e.phone ? <span dir="ltr">{e.phone}</span> : undefined} />
                  </Link>
                </Td>
                <Td className="text-xs">
                  <p className="font-semibold">{e.department?.name ?? '—'}</p>
                  <p className="text-[var(--app-text-dim)]">{e.jobTitle ?? ''}</p>
                </Td>
                <Td className="text-xs tabular-nums">{fmtDay(e.hireDate)}</Td>
                <Td className="text-xs">
                  {e.currentContract ? (
                    <>
                      <p className="font-semibold">{label.contractType(e.currentContract.contractType).fr}</p>
                      <p className="text-[var(--app-text-dim)]">
                        {label.salaryMode(e.currentContract.salaryMode).ar}
                        {e.currentContract.endDate ? ` · حتى ${fmtDay(e.currentContract.endDate)}` : ''}
                      </p>
                    </>
                  ) : (
                    <span className="font-bold text-red-700 dark:text-red-400">بدون عقد ساري</span>
                  )}
                </Td>
                {showSalary ? (
                  <Td className="tabular-nums">{e.currentContract?.baseSalary != null ? money(e.currentContract.baseSalary) : '—'}</Td>
                ) : null}
                <Td className="text-xs">
                  {e.deviceMappings ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                      <Fingerprint className="h-3.5 w-3.5" /> {e.deviceMappings}
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">غير مربوط</span>
                  )}
                </Td>
                <Td>
                  <StatusBadge l={label.employee(e.status)} />
                  {e.archivedAt ? <span className="mr-1 text-[10px] text-[var(--app-text-dim)]">مؤرشف</span> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>

      <EmployeeFormModal open={creating} onClose={() => setCreating(false)} onSaved={(id) => router.push(`/hr/employees/${id}`)} />
    </div>
  );
}
