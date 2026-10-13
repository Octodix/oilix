'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  apiError,
  HrPageHeader,
  Modal,
  money,
  MonthInput,
  Notice,
  QueryState,
  StatusBadge,
  Table,
  Td,
  Th,
  useCan,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { dateTimeDz, label, monthLabel, shiftMonth, todayKeyDz, toNum } from '@/lib/hr-labels';

type PeriodRow = {
  id: string;
  year: number;
  month: number;
  status: string;
  employeeCount: number;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  totalPaid: string;
  calculatedAt: string | null;
  calculatedByName: string | null;
  validatedAt: string | null;
  validatedByName: string | null;
  closedAt: string | null;
  _count: { payslips: number; payments: number };
};

export default function PayrollPage() {
  const can = useCan();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['hr', 'payroll-periods'],
    queryFn: async () => (await api.get<PeriodRow[]>('/hr/payroll/periods')).data,
  });

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="الأجور"
        fr="Paie"
        icon={Calculator}
        actions={
          can('HR_PAYROLL_CALCULATE') ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> فترة جديدة
            </Button>
          ) : null
        }
      />
      <Notice>
        المراحل: مسودة ← محسوبة ← مراجَعة ← مصادق عليها ← مدفوعة ← مغلقة. <strong>الحساب لا يُخرج أي مبلغ من الصندوق</strong> — الدفع خطوة منفصلة
        بعد المصادقة. القواعد القانونية والضريبية (IRG، CNAS…) لا تُحسب تلقائياً: أضفها كاقتطاعات إن لزم بعد التحقق منها.
      </Notice>
      <QueryState q={q} empty={!q.data?.length} emptyText="لا توجد فترات أجور" emptyHint="أنشئ فترة للشهر ثم احسبها.">
        <Table minWidth={980}>
          <thead>
            <tr>
              <Th>الشهر</Th>
              <Th>الحالة</Th>
              <Th>العمال</Th>
              <Th>الإجمالي</Th>
              <Th>الاقتطاعات</Th>
              <Th>الصافي</Th>
              <Th>المدفوع</Th>
              <Th>آخر عملية</Th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((p) => {
              const remaining = toNum(p.totalNet) - toNum(p.totalPaid);
              return (
                <tr key={p.id} className="cursor-pointer hover:bg-[var(--app-bg-muted)]" onClick={() => router.push(`/hr/payroll/${p.id}`)}>
                  <Td className="font-black">
                    <Link href={`/hr/payroll/${p.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                      {monthLabel(p.year, p.month)}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge l={label.payroll(p.status)} />
                  </Td>
                  <Td className="tabular-nums">{p._count.payslips || p.employeeCount}</Td>
                  <Td className="tabular-nums">{money(p.totalGross)}</Td>
                  <Td className="tabular-nums">{money(p.totalDeductions)}</Td>
                  <Td className="font-bold tabular-nums">{money(p.totalNet)}</Td>
                  <Td className="tabular-nums">
                    {money(p.totalPaid)}
                    {['VALIDATED', 'PAID'].includes(p.status) && remaining > 0.005 ? (
                      <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">متبقي {money(remaining)}</p>
                    ) : null}
                  </Td>
                  <Td className="text-xs text-[var(--app-text-dim)]">
                    {p.validatedAt
                      ? `مصادقة: ${p.validatedByName ?? ''} ${dateTimeDz(p.validatedAt)}`
                      : p.calculatedAt
                        ? `حساب: ${p.calculatedByName ?? ''} ${dateTimeDz(p.calculatedAt)}`
                        : '—'}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </QueryState>
      <CreatePeriodModal open={creating} onClose={() => setCreating(false)} existing={q.data ?? []} />
    </div>
  );
}

function CreatePeriodModal({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: PeriodRow[] }) {
  const qc = useQueryClient();
  const router = useRouter();
  const today = todayKeyDz();
  const prev = shiftMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)), -1);
  const [ym, setYm] = useState(prev);
  const m = useMutation({
    mutationFn: async () => (await api.post<{ id: string }>('/hr/payroll/periods', ym)).data,
    onSuccess: (p) => {
      toast.success('تم إنشاء الفترة');
      qc.invalidateQueries({ queryKey: ['hr'] });
      onClose();
      router.push(`/hr/payroll/${p.id}`);
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const dup = existing.some((p) => p.year === ym.year && p.month === ym.month);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="فترة أجور جديدة · Nouvelle période"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={dup} loading={m.isPending} onClick={() => m.mutate()}>
            إنشاء
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <MonthInput year={ym.year} month={ym.month} onChange={(y, mo) => setYm({ year: y, month: mo })} />
        {dup ? <Notice tone="warning">هذه الفترة موجودة مسبقاً.</Notice> : null}
      </div>
    </Modal>
  );
}
