'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check as CheckIcon, Paperclip, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiError, EmployeeSelect, Field, ReasonModal, Select, TextInput } from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { APPROVAL_STATUS, label } from '@/lib/hr-labels';

export type Decision = 'APPROVE' | 'REJECT' | 'CANCEL';

/**
 * Approve / reject / cancel buttons for a request. `path` is the decision endpoint
 * (e.g. `/hr/leave/:id/decision`). Rejecting, or cancelling an approved request, asks for a reason.
 */
export function DecisionButtons({
  path,
  status,
  canApprove,
  canCancel,
  extraBody,
  approveDisabledReason,
}: {
  path: string;
  status: string;
  canApprove: boolean;
  canCancel: boolean;
  extraBody?: () => Record<string, unknown>;
  approveDisabledReason?: string;
}) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState<Decision | null>(null);
  const m = useMutation({
    mutationFn: async ({ decision, note }: { decision: Decision; note?: string }) =>
      (await api.post(path, { decision, note: note || null, ...(decision === 'APPROVE' ? extraBody?.() : {}) })).data,
    onSuccess: (_d, v) => {
      toast.success(v.decision === 'APPROVE' ? 'تمت الموافقة' : v.decision === 'REJECT' ? 'تم الرفض' : 'تم الإلغاء');
      setAsking(null);
      qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const pending = status === 'PENDING';
  const cancellable = canCancel && (status === 'PENDING' || status === 'APPROVED');
  if (!pending && !cancellable) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {pending && canApprove ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            title={approveDisabledReason ?? 'موافقة'}
            disabled={!!approveDisabledReason}
            loading={m.isPending && m.variables?.decision === 'APPROVE'}
            onClick={() => m.mutate({ decision: 'APPROVE' })}
          >
            <CheckIcon className="h-4 w-4 text-emerald-600" />
          </Button>
          <Button size="sm" variant="ghost" title="رفض" onClick={() => setAsking('REJECT')}>
            <X className="h-4 w-4 text-red-600" />
          </Button>
        </>
      ) : null}
      {cancellable ? (
        <Button
          size="sm"
          variant="ghost"
          title="إلغاء"
          onClick={() => (status === 'APPROVED' ? setAsking('CANCEL') : m.mutate({ decision: 'CANCEL' }))}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
      ) : null}
      <ReasonModal
        open={!!asking}
        title={asking === 'REJECT' ? 'رفض الطلب · Refuser' : 'إلغاء طلب مصادق عليه · Annuler'}
        description={asking === 'CANCEL' ? 'سيُعاد حساب الحضور للأيام المعنية.' : undefined}
        danger
        busy={m.isPending}
        onClose={() => setAsking(null)}
        onConfirm={(note) => asking && m.mutate({ decision: asking, note })}
      />
    </div>
  );
}

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

export function AttachmentInput({
  value,
  onChange,
}: {
  value: { data: string; name: string } | null;
  onChange: (v: { data: string; name: string } | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Field label="مرفق (صورة أو PDF، 2 ميغا كحد أقصى) · Pièce jointe">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()}>
          <Paperclip className="h-4 w-4" /> اختيار ملف
        </Button>
        {value ? (
          <>
            <span className="truncate text-xs">{value.name}</span>
            <button type="button" className="text-red-600" onClick={() => onChange(null)}>
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <span className="text-xs text-[var(--app-text-dim)]">لا يوجد</span>
        )}
        <input
          ref={ref}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (f.size > MAX_ATTACHMENT_BYTES) {
              toast.error('الملف أكبر من 2 ميغابايت');
              return;
            }
            const reader = new FileReader();
            reader.onload = () => onChange({ data: String(reader.result), name: f.name.slice(0, 200) });
            reader.readAsDataURL(f);
          }}
        />
      </div>
    </Field>
  );
}

export function AttachmentLink({ kind, id, name }: { kind: 'leave' | 'sick' | 'absence'; id: string; name: string | null }) {
  const [busy, setBusy] = useState(false);
  if (!name) return null;
  return (
    <button
      type="button"
      disabled={busy}
      className="inline-flex items-center gap-1 text-xs font-bold text-sky-700 hover:underline disabled:opacity-60 dark:text-sky-400"
      onClick={async () => {
        setBusy(true);
        try {
          const { data } = await api.get<{ attachment: string; attachmentName: string | null }>(`/hr/attachments/${kind}/${id}`);
          const blob = await (await fetch(data.attachment)).blob();
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (e) {
          toast.error(apiError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Paperclip className="h-3.5 w-3.5" /> {name}
    </button>
  );
}

export function RequestFilters({
  from,
  to,
  employeeId,
  status,
  onChange,
}: {
  from: string;
  to: string;
  employeeId: string;
  status: string;
  onChange: (patch: Partial<{ from: string; to: string; employeeId: string; status: string }>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <TextInput label="من · Du" type="date" value={from} onChange={(e) => onChange({ from: e.target.value })} />
      <TextInput label="إلى · Au" type="date" value={to} onChange={(e) => onChange({ to: e.target.value })} />
      <EmployeeSelect value={employeeId} onChange={(v) => onChange({ employeeId: v })} allowAll includeLeft />
      <Select label="الحالة · Statut" value={status} onChange={(e) => onChange({ status: e.target.value })}>
        <option value="">الكل</option>
        {Object.keys(APPROVAL_STATUS).map((s) => (
          <option key={s} value={s}>
            {label.approval(s).ar} · {label.approval(s).fr}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Range params are only sent as a pair (the API ignores a lone bound). */
export function rangeParams(f: { from: string; to: string; employeeId: string; status: string }) {
  return {
    from: f.from && f.to ? f.from : undefined,
    to: f.from && f.to ? f.to : undefined,
    employeeId: f.employeeId || undefined,
    status: f.status || undefined,
  };
}
