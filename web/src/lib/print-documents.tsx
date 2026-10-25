import { api } from '@/lib/api';
import { OilSaleClientReceiptDocument } from '@/components/print/oil-sale-client-receipt-document';
import type { OilSaleReceiptPayload } from '@/components/print/oil-sale-receipt-document';
import {
  OilDayReportDocument,
  type OilDayReportPayload,
} from '@/components/print/oil-day-report-document';
import {
  HrAttendanceReportDocument,
  type HrAttendanceReport,
} from '@/components/print/hr-attendance-report-document';
import {
  HR_PAYSLIP_API,
  HrPayslipDocument,
  type HrPayslipData,
} from '@/components/print/hr-payslip-document';
import { OIL_SALE_RECEIPT_API } from '@/lib/oil-sale-receipt';
import {
  MillHandoverReceiptDocument,
  type MillHandoverReceiptPayload,
} from '@/components/print/mill-handover-receipt-document';
import { renderPrintHtml } from '@/lib/print-html';
import {
  dayReportCopies,
  targetForDocument,
  type DevicePrintSettings,
  type PrintRequest,
  type PrintTarget,
} from '@/lib/print-plan';

/** Customer delivery slip (وصل تسليم) — same component as the browser print page. */
export function oilSaleClientReceiptRequest(
  saleId: string,
  opts: { isReprint?: boolean; data?: OilSaleReceiptPayload } = {},
): PrintRequest {
  return {
    documentType: 'OIL_SALE_CLIENT_RECEIPT',
    documentRef: saleId,
    target: 'receipt',
    isReprint: opts.isReprint,
    render: async (route) => {
      const data =
        opts.data ?? (await api.get<OilSaleReceiptPayload>(OIL_SALE_RECEIPT_API(saleId))).data;
      return renderPrintHtml(
        <OilSaleClientReceiptDocument data={data} />,
        route.paper,
        `وصل تسليم ${data.sale.receiptNumber}`,
      );
    },
  };
}

/** وصل تسليم المداخيل — assistant's cash handover to the primary operator (receipt printer). */
export function millHandoverReceiptRequest(
  sessionId: string,
  opts: { isReprint?: boolean; data?: MillHandoverReceiptPayload } = {},
): PrintRequest {
  return {
    documentType: 'MILL_RECEIPT',
    documentRef: `handover:${sessionId}`,
    target: 'receipt',
    isReprint: opts.isReprint,
    render: async (route) => {
      const data =
        opts.data ??
        (await api.get<MillHandoverReceiptPayload>(`/mill-assistance/sessions/${sessionId}/receipt`)).data;
      return renderPrintHtml(
        <MillHandoverReceiptDocument data={data} />,
        route.paper,
        `وصل تسليم المداخيل ${data.session.reference}`,
      );
    },
  };
}

/**
 * Financial day report: two separate jobs — 1) supervision copy, 2) archive copy —
 * each rendered from its own logical copy so they are never merged.
 */
export function oilDayReportRequests(
  payload: OilDayReportPayload,
  dayPrintId: string,
  settings: DevicePrintSettings,
): PrintRequest[] {
  const target = targetForDocument('OIL_DAY_REPORT', settings);
  return dayReportCopies(payload).map((copy, i) => ({
    documentType: 'OIL_DAY_REPORT',
    documentRef: dayPrintId,
    copyLabel: copy.label,
    target,
    render: (route) =>
      renderPrintHtml(
        <OilDayReportDocument data={copy.data} />,
        route.paper,
        `يومية بيع الزيت ${payload.dateLabel} (${i + 1}/2)`,
      ),
  }));
}

/** A4 payslip (bulletin de paie) — always sent to the document printer. */
export function hrPayslipRequest(
  payslipId: string,
  opts: { data?: HrPayslipData } = {},
): PrintRequest {
  return {
    documentType: 'HR_PAYSLIP',
    documentRef: payslipId,
    target: 'document',
    render: async (route) => {
      const data = opts.data ?? (await api.get<HrPayslipData>(HR_PAYSLIP_API(payslipId))).data;
      return renderPrintHtml(
        <HrPayslipDocument data={data} />,
        route.paper,
        `Bulletin ${data.employeeSnapshot.matricule} ${String(data.period.month).padStart(2, '0')}/${data.period.year}`,
      );
    },
  };
}

/** A4 attendance report — rendered from data already loaded on screen. */
export function hrAttendanceReportRequest(data: HrAttendanceReport): PrintRequest {
  return {
    documentType: 'HR_REPORT',
    documentRef: `attendance:${data.from}:${data.to}`,
    target: 'document',
    render: (route) =>
      renderPrintHtml(<HrAttendanceReportDocument data={data} />, route.paper, `Présence ${data.from} → ${data.to}`),
  };
}

export type TestPageInfo = { deviceName: string; printerName: string };

function TestPageDocument({ info, target }: { info: TestPageInfo; target: PrintTarget }) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return (
    <div className="thermal-receipt mx-auto bg-white px-2 py-3 text-center text-black" dir="rtl">
      <p className="text-[18px] font-black tracking-widest">OILIX</p>
      <p className="mt-1 text-[12px] font-bold">اختبار الطباعة · Test d’impression</p>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="space-y-1 text-[11px]">
        <p>
          <span className="opacity-70">الجهاز · Poste : </span>
          <span className="font-bold">{info.deviceName}</span>
        </p>
        <p>
          <span className="opacity-70">الطابعة · Imprimante : </span>
          <span className="font-bold">{info.printerName}</span>
        </p>
        <p>
          <span className="opacity-70">النوع · Type : </span>
          <span className="font-bold">{target === 'receipt' ? 'Ticket' : 'Document'}</span>
        </p>
        <p dir="ltr" className="tabular-nums">
          {stamp}
        </p>
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <p className="text-[13px] font-black">Impression test réussie</p>
      <p className="text-[13px] font-black">تمت الطباعة التجريبية بنجاح</p>
      <p className="mt-2 text-[10px]" dir="ltr">
        زيت زيتون · Huile d’olive · 1 2 3 4 5 6 7 8 9 0
      </p>
    </div>
  );
}

export function testPageRequest(target: PrintTarget, info: TestPageInfo): PrintRequest {
  return {
    documentType: 'TEST_PAGE',
    documentRef: `test-${target}`,
    target,
    render: (route) =>
      renderPrintHtml(
        <TestPageDocument info={{ ...info, printerName: route.printer ?? info.printerName }} target={target} />,
        route.paper,
        'Oilix — test',
      ),
  };
}
