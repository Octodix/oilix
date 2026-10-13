import { formatNumber, formatDateTimeDz } from '@/lib/utils';

export type OilDebtPaymentReceiptPayload = {
  payment: {
    receiptNumber: number;
    amount: string | number;
    paymentMethod?: string | null;
    notes?: string | null;
    createdAt: string;
    cashRegisterCode?: string | null;
    cashRegisterName?: string | null;
    deviceCode?: string | null;
    deviceName?: string | null;
    userName?: string | null;
    userUsername?: string | null;
    user?: { username: string; firstName?: string | null; lastName?: string | null };
  };
  customer: { name: string; phone?: string | null };
  previousDebt?: number | null;
  remainingDebt?: number | null;
  settings: {
    receiptHeader: string;
    receiptFooter: string;
    company: { name: string; phone: string; address: string };
  };
};

function money(n: string | number) {
  return formatNumber(Number(n), 2);
}

export function OilDebtPaymentReceiptDocument({
  data,
}: {
  data: OilDebtPaymentReceiptPayload;
}) {
  const { payment, customer, settings, previousDebt, remainingDebt } = data;
  const operator =
    payment.userName ||
    payment.userUsername ||
    [payment.user?.firstName, payment.user?.lastName].filter(Boolean).join(' ') ||
    payment.user?.username ||
    '—';
  const deviceLabel = payment.deviceName || payment.deviceCode || null;

  return (
    <div className="thermal-receipt mx-auto w-[80mm] bg-white px-2 py-3 text-black" dir="rtl">
      <div className="text-center">
        <p className="text-[15px] font-black leading-tight tracking-wide">
          {settings.receiptHeader || settings.company.name || 'OILIX'}
        </p>
        {settings.company.phone ? (
          <p className="mt-0.5 text-[10px]">{settings.company.phone}</p>
        ) : null}
        <p className="mt-1 text-[12px] font-black">وصل تسديد دين</p>
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="space-y-0.5 text-[11px]">
        <Row
          label="رقم الوصل"
          value={`PAY-${String(payment.receiptNumber).padStart(6, '0')}`}
          bold
        />
        <Row
          label="التاريخ"
          value={formatDateTimeDz(payment.createdAt)}
        />
        <Row label="الزبون" value={customer.name} bold />
        {customer.phone ? <Row label="الهاتف" value={customer.phone} /> : null}
        {payment.cashRegisterName || payment.cashRegisterCode ? (
          <Row
            label="الصندوق"
            value={payment.cashRegisterName || payment.cashRegisterCode || ''}
          />
        ) : null}
        {deviceLabel ? <Row label="الجهاز" value={deviceLabel} /> : null}
        <Row label="المشغّل" value={operator} />
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="space-y-1 text-[12px]">
        {previousDebt != null ? (
          <Row label="الدين السابق" value={`${money(previousDebt)} د.ج`} />
        ) : null}
        <div className="flex items-center justify-between text-[14px] font-black">
          <span>المبلغ المسدد</span>
          <span className="tabular-nums">{money(payment.amount)} د.ج</span>
        </div>
        {remainingDebt != null ? (
          <div className="mt-1 flex items-center justify-between border border-black px-1 py-1 font-black">
            <span>المتبقي على الزبون</span>
            <span className="tabular-nums">{money(remainingDebt)} د.ج</span>
          </div>
        ) : null}
      </div>

      {payment.notes ? (
        <>
          <div className="my-2 border-t border-dashed border-black" />
          <p className="text-[10px]">
            <span className="font-bold">ملاحظة:</span> {payment.notes}
          </p>
        </>
      ) : null}

      {settings.receiptFooter ? (
        <p className="mt-3 text-center text-[10px] font-bold">{settings.receiptFooter}</p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
      <span className="opacity-80">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
