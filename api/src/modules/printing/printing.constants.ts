import type { DevicePrintSettings } from '@prisma/client';

export const RECEIPT_PAPER_WIDTHS = [58, 80] as const;
export const DOCUMENT_PAPER_FORMATS = ['A4', 'A5'] as const;
export const DOCUMENT_ORIENTATIONS = ['PORTRAIT', 'LANDSCAPE'] as const;
export const DAY_REPORT_TARGETS = ['RECEIPT', 'DOCUMENT'] as const;

export const PRINT_DOCUMENT_TYPES = [
  'OIL_SALE_CLIENT_RECEIPT',
  'OIL_SALE_RECEIPT',
  'OIL_DAY_REPORT',
  'OIL_DEBT_PAYMENT_RECEIPT',
  'MILL_RECEIPT',
  'HR_PAYSLIP',
  'HR_REPORT',
  'TEST_PAGE',
  'OTHER',
] as const;
export const PRINT_CHANNELS = ['AGENT', 'BROWSER'] as const;
export const PRINT_JOB_STATUSES = [
  'SUBMITTED',
  'FAILED',
  'BROWSER_OPENED',
] as const;

export const MAX_PRINT_COPIES = 5;

/** Printable characters only — Windows printer names never contain control characters. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
export const PRINTER_NAME_RE = /^[^\u0000-\u001f\u007f]{1,200}$/;

export type PublicPrintSettings = {
  directPrinting: boolean;
  browserFallback: boolean;
  autoPrintAfterSale: boolean;
  receiptPrinter: string | null;
  receiptPaperWidth: (typeof RECEIPT_PAPER_WIDTHS)[number];
  receiptDirect: boolean;
  receiptCopies: number;
  documentPrinter: string | null;
  documentPaperFormat: (typeof DOCUMENT_PAPER_FORMATS)[number];
  documentOrientation: (typeof DOCUMENT_ORIENTATIONS)[number];
  documentCopies: number;
  dayReportTarget: (typeof DAY_REPORT_TARGETS)[number];
  updatedAt: Date | null;
};

export const DEFAULT_PRINT_SETTINGS: PublicPrintSettings = {
  directPrinting: false,
  browserFallback: true,
  autoPrintAfterSale: false,
  receiptPrinter: null,
  receiptPaperWidth: 80,
  receiptDirect: true,
  receiptCopies: 1,
  documentPrinter: null,
  documentPaperFormat: 'A4',
  documentOrientation: 'PORTRAIT',
  documentCopies: 1,
  dayReportTarget: 'DOCUMENT',
  updatedAt: null,
};

function oneOf<T extends readonly (string | number)[]>(
  list: T,
  v: unknown,
  fallback: T[number],
) {
  return (list as readonly unknown[]).includes(v) ? (v as T[number]) : fallback;
}

function clampCopies(v: unknown) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PRINT_COPIES);
}

/** Stored row → settings the web app consumes (defaults when the device has none yet). */
export function publicPrintSettings(
  row: DevicePrintSettings | null | undefined,
): PublicPrintSettings {
  if (!row) return { ...DEFAULT_PRINT_SETTINGS };
  const d = DEFAULT_PRINT_SETTINGS;
  return {
    directPrinting: row.directPrinting,
    browserFallback: row.browserFallback,
    autoPrintAfterSale: row.autoPrintAfterSale,
    receiptPrinter: row.receiptPrinter?.trim() || null,
    receiptPaperWidth: oneOf(
      RECEIPT_PAPER_WIDTHS,
      row.receiptPaperWidth,
      d.receiptPaperWidth,
    ),
    receiptDirect: row.receiptDirect,
    receiptCopies: clampCopies(row.receiptCopies),
    documentPrinter: row.documentPrinter?.trim() || null,
    documentPaperFormat: oneOf(
      DOCUMENT_PAPER_FORMATS,
      row.documentPaperFormat,
      d.documentPaperFormat,
    ),
    documentOrientation: oneOf(
      DOCUMENT_ORIENTATIONS,
      row.documentOrientation,
      d.documentOrientation,
    ),
    documentCopies: clampCopies(row.documentCopies),
    dayReportTarget: oneOf(
      DAY_REPORT_TARGETS,
      row.dayReportTarget,
      d.dayReportTarget,
    ),
    updatedAt: row.updatedAt,
  };
}
