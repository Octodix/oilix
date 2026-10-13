'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSignature, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContractFormModal, TerminateContractModal, type Contract } from '@/components/hr/contract-form';
import {
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
import { daysBetween, fmtDay, fullName, label, todayKeyDz, toCsv, toNum } from '@/lib/hr-labels';

export default function ContractsPage() {
  const can = useCan();
  const [status, setStatus] = useState('ACTIVE');
  const [ending, setEnding] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ open: boolean; contract: Contract | null }>({ open: false, contract: null });
  const [terminating, setTerminating] = useState<Contract | null>(null);
  const manage = can('HR_CONTRACTS_MANAGE');
  const today = todayKeyDz();

  const q = useQuery({
    queryKey: ['hr', 'contracts', { status, ending }],
    queryFn: async () =>
      (
        await api.get<Contract[]>('/hr/contracts', {
          params: { status: ending ? 'ACTIVE' : status || undefined, endingWithinDays: ending || undefined },
        })
      ).data,
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = q.data ?? [];
    return s ? list.filter((c) => `${fullName(c.employee)} ${c.employee?.matricule}`.toLowerCase().includes(s)) : list;
  }, [q.data, search]);

  function exportCsv() {
    downloadCsv(
      `contrats-${today}.csv`,
      toCsv(
        ['Matricule', 'Employé', 'Type', 'Début', 'Fin', 'Fin essai', 'Mode', 'Salaire', 'H/sem', 'Poste', 'Service', 'Statut'],
        rows.map((c) => [
          c.employee?.matricule ?? '',
          fullName(c.employee),
          label.contractType(c.contractType).fr,
          c.startDate,
          c.endDate ?? '',
          c.trialEndDate ?? '',
          label.salaryMode(c.salaryMode).fr,
          c.baseSalary ?? '',
          toNum(c.weeklyHours),
          c.jobTitle ?? '',
          c.department?.name ?? '',
          label.contractStatus(c.status).fr,
        ]),
      ),
    );
  }

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="العقود"
        fr="Contrats"
        icon={FileSignature}
        subtitle={q.data ? `${rows.length} عقد` : undefined}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            {manage ? (
              <Button size="sm" onClick={() => setForm({ open: true, contract: null })}>
                <Plus className="h-4 w-4" /> عقد جديد
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput label="بحث · Recherche" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select label="الحالة · Statut" value={status} onChange={(e) => setStatus(e.target.value)} disabled={!!ending}>
          <option value="">الكل</option>
          <option value="ACTIVE">سارية · Actifs</option>
          <option value="ENDED">منتهية · Terminés</option>
          <option value="TERMINATED">مفسوخة · Résiliés</option>
        </Select>
        <Select label="تنتهي خلال · Expirant sous" value={ending} onChange={(e) => setEnding(e.target.value)}>
          <option value="">—</option>
          <option value="15">15 يوم</option>
          <option value="30">30 يوم</option>
          <option value="60">60 يوم</option>
          <option value="90">90 يوم</option>
        </Select>
      </div>

      <QueryState q={q} empty={rows.length === 0} emptyText="لا توجد عقود">
        <Table minWidth={1000}>
          <thead>
            <tr>
              <Th>العامل</Th>
              <Th>النوع</Th>
              <Th>الفترة</Th>
              <Th>الأجر</Th>
              <Th>المنصب / القسم</Th>
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const endIn = c.endDate && c.status === 'ACTIVE' ? daysBetween(today, c.endDate) : null;
              const trialIn = c.trialEndDate && c.status === 'ACTIVE' ? daysBetween(today, c.trialEndDate) : null;
              return (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/hr/employees/${c.employeeId}`} className="hover:underline">
                      <EmployeeCell e={c.employee} />
                    </Link>
                  </Td>
                  <Td className="font-bold">{label.contractType(c.contractType).fr}</Td>
                  <Td className="text-xs tabular-nums">
                    {fmtDay(c.startDate)} → {c.endDate ? fmtDay(c.endDate) : 'غير محدد'}
                    {endIn !== null && endIn >= 0 && endIn <= 60 ? (
                      <p className="font-bold text-amber-700 dark:text-amber-400">ينتهي بعد {endIn} يوم</p>
                    ) : null}
                    {trialIn !== null && trialIn >= 0 && trialIn <= 30 ? (
                      <p className="font-bold text-sky-700 dark:text-sky-400">نهاية التجربة بعد {trialIn} يوم</p>
                    ) : null}
                  </Td>
                  <Td className="tabular-nums">
                    {c.baseSalary != null ? money(c.baseSalary) : '••••'}
                    <p className="text-[11px] text-[var(--app-text-dim)]">{label.salaryMode(c.salaryMode).ar}</p>
                  </Td>
                  <Td className="text-xs">
                    {c.jobTitle ?? '—'}
                    <p className="text-[var(--app-text-dim)]">{c.department?.name ?? ''}</p>
                  </Td>
                  <Td>
                    <StatusBadge l={label.contractStatus(c.status)} />
                  </Td>
                  <Td>
                    {manage && c.status === 'ACTIVE' ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setForm({ open: true, contract: c })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="فسخ" onClick={() => setTerminating(c)}>
                          <FileSignature className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </QueryState>

      <ContractFormModal open={form.open} contract={form.contract} onClose={() => setForm({ open: false, contract: null })} />
      <TerminateContractModal contract={terminating} onClose={() => setTerminating(null)} />
    </div>
  );
}
