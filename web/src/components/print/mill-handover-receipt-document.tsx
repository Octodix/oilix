import { formatMoney, formatNumber } from '@/lib/utils';
import { formatDateShortDz } from '@/lib/locale-dz';

/** Payload of GET /mill-assistance/sessions/:id/receipt */
export type MillHandoverReceiptPayload = {
  session: {
    id: string;
    sessionNumber: number;
    reference: string;
    status: 'ACTIVE' | 'AWAITING_CONFIRMATION' | 'CONFIRMED' | 'DISCREPANCY';
    primaryOperator: { id: string; name: string };
    assistant: { id: string; name: string };
    assistantDevice: { id: string | null; name: string; code: string | null } | null;
    startedAt: string;
    closedAt: string | null;
    totals: {
      operationsCount: number;
      paymentsCount: number;
      totalCharged: number;
      totalCollected: number;
      totalCash: number;
      totalNonCash: number;
      totalOutstanding: number;
      expectedHandover: number;
    };
    declaredHandover: number | null;
    receivedHandover: number | null;
    difference: number;
    discrepancyNote: string | null;
    confirmedAt: string | null;
    confirmedBy: { id: string; name: string } | null;
    resolutionNote: string | null;
    isLive: boolean;
  };
  operations: Array<{
    pressingRecordId: string;
    reference: number;
    clientName: string;
    oliveType: string;
    recordedHere: boolean;
    amountDue: number;
    collectedInSession: number;
    collectedCashInSession: number;
    outstanding: number;
    payments: Array<{ id: string; amount: number; method: string | null; time: string }>;
  }>;
  company: { name: string; phone: string; address: string };
  printedAt: string;
  printedBy: string;
};

export const HANDOVER_STATUS_AR: Record<MillHandoverReceiptPayload['session']['status'], string> = {
  ACTIVE: 'نشطة',
  AWAITING_CONFIRMATION: 'بانتظار تأكيد المشغّل الرئيسي',
  CONFIRMED: 'مؤكَّدة',
  DISCREPANCY: 'فرق في المبلغ',
};

function dt(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatDateShortDz(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * وصل تسليم المداخيل — Bon de remise. Thermal 80 mm. Lists what the assistant did, what
 * they collected and what they must hand to the primary operator. Printed through the
 * Print Agent or the browser like every other Oilix document.
 */
export function MillHandoverReceiptDocument({ data }: { data: MillHandoverReceiptPayload }) {
  const { session: s, operations, company } = data;
  const t = s.totals;
  return (
    <div className="thermal-receipt mill-handover-receipt mx-auto w-[80mm] bg-white px-2 py-3 text-black" dir="rtl">
      <div className="text-center">
        <p className="text-[15px] font-black leading-tight">{company.name || 'OILIX'}</p>
        {company.phone ? <p className="text-[10px]">{company.phone}</p> : null}
        <p className="mt-1 text-[12px] font-black">وصل تسليم المداخيل · Bon de remise</p>
        <p className="font-mono text-[11px] font-bold">{s.reference}</p>
        {s.isLive ? <p className="text-[10px] font-bold">*** مسودة — الجلسة ما زالت نشطة ***</p> : null}
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="space-y-0.5 text-[11px]">
        <Row label="المشغّل الرئيسي" value={s.primaryOperator.name} bold />
        <Row label="المساعد" value={s.assistant.name} bold />
        <Row label="جهاز المساعد" value={s.assistantDevice ? s.assistantDevice.code || s.assistantDevice.name : '—'} />
        <Row label="البداية" value={dt(s.startedAt)} />
        <Row label="النهاية" value={dt(s.closedAt)} />
        <Row label="الحالة" value={HANDOVER_STATUS_AR[s.status]} />
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <p className="text-[11px] font-black">العمليات ({t.operationsCount})</p>
      <div className="mt-1 space-y-1.5 text-[10px]">
        {operations.length === 0 ? <p>لا توجد عمليات</p> : null}
        {operations.map((op) => (
          <div key={op.pressingRecordId} className="border-b border-dotted border-black/40 pb-1">
            <div className="flex justify-between gap-2 font-bold">
              <span>
                #{op.reference} · {op.clientName}
              </span>
              <span className="tabular-nums">{formatMoney(op.amountDue)}</span>
            </div>
            <div className="flex justify-between gap-2 opacity-90">
              <span>مقبوض هنا{op.payments.length > 1 ? ` (${op.payments.length} دفعات)` : ''}</span>
              <span className="tabular-nums">{formatMoney(op.collectedInSession)}</span>
            </div>
            {op.outstanding > 0 ? (
              <div className="flex justify-between gap-2 font-bold">
                <span>متبقٍ على الزبون</span>
                <span className="tabular-nums">{formatMoney(op.outstanding)}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="space-y-0.5 text-[11px]">
        <Row label="عدد العمليات" value={formatNumber(t.operationsCount, 0)} />
        <Row label="إجمالي مبالغ العمليات" value={`${formatMoney(t.totalCharged)} د.ج`} />
        <Row label="المقبوض نقداً" value={`${formatMoney(t.totalCash)} د.ج`} bold />
        {t.totalNonCash > 0 ? <Row label="المقبوض غير نقدي" value={`${formatMoney(t.totalNonCash)} د.ج`} /> : null}
        <Row label="إجمالي المقبوض" value={`${formatMoney(t.totalCollected)} د.ج`} />
        <Row label="غير مدفوع (ديون الزبائن)" value={`${formatMoney(t.totalOutstanding)} د.ج`} />
      </div>

      <div className="my-2 border-t-2 border-black" />

      <div className="flex items-center justify-between text-[14px] font-black">
        <span>المبلغ الواجب تسليمه</span>
        <span className="tabular-nums">{formatMoney(t.expectedHandover)} د.ج</span>
      </div>
      <div className="mt-1 space-y-0.5 text-[11px]">
        {s.declaredHandover != null ? <Row label="المبلغ المصرّح به من المساعد" value={`${formatMoney(s.declaredHandover)} د.ج`} bold /> : null}
        {s.receivedHandover != null ? <Row label="المبلغ المستلَم فعلياً" value={`${formatMoney(s.receivedHandover)} د.ج`} bold /> : null}
        {Math.abs(s.difference) >= 0.005 ? (
          <div className="mt-1 border border-black px-1 py-1 text-[12px] font-black">
            <div className="flex justify-between">
              <span>الفرق</span>
              <span className="tabular-nums">{s.difference > 0 ? '+' : ''}{formatMoney(s.difference)} د.ج</span>
            </div>
            {s.discrepancyNote ? <p className="text-[10px] font-normal">السبب: {s.discrepancyNote}</p> : null}
            {s.resolutionNote ? <p className="text-[10px] font-normal">التسوية: {s.resolutionNote}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <p className="font-bold">توقيع المساعد</p>
          <p>{s.assistant.name}</p>
          <div className="mt-6 border-t border-black" />
        </div>
        <div>
          <p className="font-bold">توقيع المشغّل الرئيسي</p>
          <p>{s.confirmedBy?.name ?? s.primaryOperator.name}</p>
          {s.confirmedAt ? <p className="text-[9px]">تأكيد: {dt(s.confirmedAt)}</p> : null}
          <div className="mt-6 border-t border-black" />
        </div>
      </div>

      <p className="mt-2 text-center text-[9px] opacity-80">
        هذا الوصل يثبت تسليم مبالغ مقبوضة مسبقاً ولا يُعد إيراداً جديداً · طُبع {dt(data.printedAt)} بواسطة {data.printedBy}
      </p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
      <span className="shrink-0 opacity-80">{label}</span>
      <span className="text-left tabular-nums">{value}</span>
    </div>
  );
}
