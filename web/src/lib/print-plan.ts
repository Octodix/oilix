/**
 * Device-aware print planning shared by every Oilix document (receipts, day report,
 * future mill/stock documents). Pure module: transport, rendering and logging are injected.
 *
 * User permissions decide WHAT may be printed; the device settings decide WHERE.
 */

export type PrintDocumentType =
  | 'OIL_SALE_CLIENT_RECEIPT'
  | 'OIL_SALE_RECEIPT'
  | 'OIL_DAY_REPORT'
  | 'OIL_DEBT_PAYMENT_RECEIPT'
  | 'MILL_RECEIPT'
  | 'HR_PAYSLIP'
  | 'HR_REPORT'
  | 'TEST_PAGE'
  | 'OTHER';

export type PrintTarget = 'receipt' | 'document';

export type DevicePrintSettings = {
  directPrinting: boolean;
  browserFallback: boolean;
  autoPrintAfterSale: boolean;
  receiptPrinter: string | null;
  receiptPaperWidth: 58 | 80;
  receiptDirect: boolean;
  receiptCopies: number;
  documentPrinter: string | null;
  documentPaperFormat: 'A4' | 'A5';
  documentOrientation: 'PORTRAIT' | 'LANDSCAPE';
  documentCopies: number;
  dayReportTarget: 'RECEIPT' | 'DOCUMENT';
};

export const DEFAULT_DEVICE_PRINT_SETTINGS: DevicePrintSettings = {
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
};

export type PaperSpec =
  | { kind: 'receipt'; widthMm: 58 | 80 }
  | { kind: 'document'; format: 'A4' | 'A5'; orientation: 'portrait' | 'landscape' };

export type PrinterRoute = {
  target: PrintTarget;
  printer: string | null;
  paper: PaperSpec;
  copies: number;
  /** True when this device is configured to send the job to the local Print Agent. */
  direct: boolean;
};

export function resolvePrinterRoute(settings: DevicePrintSettings, target: PrintTarget): PrinterRoute {
  if (target === 'receipt') {
    const printer = settings.receiptPrinter?.trim() || null;
    return {
      target,
      printer,
      paper: { kind: 'receipt', widthMm: settings.receiptPaperWidth === 58 ? 58 : 80 },
      copies: clampCopies(settings.receiptCopies),
      direct: settings.directPrinting && settings.receiptDirect && !!printer,
    };
  }
  const printer = settings.documentPrinter?.trim() || null;
  return {
    target,
    printer,
    paper: {
      kind: 'document',
      format: settings.documentPaperFormat === 'A5' ? 'A5' : 'A4',
      orientation: settings.documentOrientation === 'LANDSCAPE' ? 'landscape' : 'portrait',
    },
    copies: clampCopies(settings.documentCopies),
    direct: settings.directPrinting && !!printer,
  };
}

/** Which configured printer a document goes to on this device. */
export function targetForDocument(type: PrintDocumentType, settings: DevicePrintSettings): PrintTarget {
  if (type === 'OIL_DAY_REPORT') return settings.dayReportTarget === 'RECEIPT' ? 'receipt' : 'document';
  if (type === 'HR_PAYSLIP' || type === 'HR_REPORT') return 'document';
  return 'receipt';
}

function clampCopies(v: number) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 5);
}

export type PrintErrorCode =
  | 'AGENT_UNAVAILABLE'
  | 'NOT_PAIRED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'PRINTER_NOT_FOUND'
  | 'PRINTER_UNAVAILABLE'
  | 'PRINT_FAILED'
  | 'PRINT_TIMEOUT'
  | 'JOB_IN_PROGRESS'
  | 'INVALID_JOB'
  | 'JOB_TOO_LARGE'
  | 'RENDER_FAILED';

export function printErrorMessage(code: string, printer?: string | null): string {
  switch (code) {
    case 'AGENT_UNAVAILABLE':
      return 'تعذر الاتصال بوكيل الطباعة · Agent d’impression indisponible';
    case 'NOT_PAIRED':
    case 'ORIGIN_NOT_ALLOWED':
      return 'وكيل الطباعة غير مربوط بهذا الجهاز · Agent non appairé';
    case 'PRINTER_NOT_FOUND':
      return `الطابعة «${printer ?? '—'}» غير موجودة على هذا الجهاز · Imprimante introuvable`;
    case 'PRINTER_UNAVAILABLE':
      return 'تعذر الاتصال بالطابعة (مطفأة أو غير متصلة) · Imprimante indisponible';
    case 'PRINT_TIMEOUT':
      return 'انتهت مهلة الطباعة · Délai d’impression dépassé';
    case 'JOB_IN_PROGRESS':
      return 'الطباعة جارية بالفعل · Impression déjà en cours';
    case 'JOB_TOO_LARGE':
      return 'المستند كبير جداً للطباعة المباشرة · Document trop volumineux';
    case 'RENDER_FAILED':
      return 'تعذر تجهيز المستند للطباعة · Préparation du document impossible';
    default:
      return 'تعذرت الطباعة · Échec de l’impression';
  }
}

export type AgentPrintJob = {
  jobId: string;
  printer: string;
  kind: 'receipt' | 'document';
  paperWidthMm?: 58 | 80;
  paperFormat?: 'A4' | 'A5';
  orientation?: 'portrait' | 'landscape';
  copies: number;
  html: string;
  title: string;
  contentHeightMm?: number;
};

export type AgentPrintResult =
  | { ok: true; jobId: string; duplicate?: boolean }
  | { ok: false; code: PrintErrorCode | string; message?: string };

/** Transport to the local Print Agent. Implementations must resolve (never reject). */
export type PrintAgentPort = {
  print(job: AgentPrintJob): Promise<AgentPrintResult>;
};

export type PrintLogEntry = {
  jobId: string;
  documentType: PrintDocumentType;
  documentRef?: string;
  copyLabel?: string;
  isReprint: boolean;
  channel: 'AGENT' | 'BROWSER';
  status: 'SUBMITTED' | 'FAILED' | 'BROWSER_OPENED';
  errorCode?: string;
  errorMessage?: string;
  printerName?: string;
  copies: number;
};

export type RenderedDocument = { html: string; title: string; contentHeightMm?: number };

export type PrintRequest = {
  documentType: PrintDocumentType;
  documentRef?: string;
  /** Distinguishes logical copies of one document (e.g. SUPERVISION / ARCHIVE). */
  copyLabel?: string;
  target: PrintTarget;
  isReprint?: boolean;
  /** Reuse the id of a failed job when retrying so the agent and the audit log stay idempotent. */
  jobId?: string;
  render: (route: PrinterRoute) => Promise<RenderedDocument>;
};

export type PrintOutcome =
  | { status: 'submitted'; jobId: string; printer: string; duplicate: boolean }
  | { status: 'browser'; reason: 'direct-disabled' | 'printer-not-configured' }
  | {
      status: 'failed';
      jobId: string;
      code: string;
      message: string;
      printer: string | null;
      fallbackAvailable: boolean;
    }
  | { status: 'skipped'; reason: 'in-flight' };

export type PrintGuard = {
  tryAcquire(key: string): boolean;
  release(key: string): void;
  isBusy(key: string): boolean;
};

/** Blocks a second submission of the same document while the first is still being sent. */
export function createPrintGuard(): PrintGuard {
  const inFlight = new Set<string>();
  return {
    tryAcquire(key) {
      if (inFlight.has(key)) return false;
      inFlight.add(key);
      return true;
    },
    release(key) {
      inFlight.delete(key);
    },
    isBusy(key) {
      return inFlight.has(key);
    },
  };
}

export function printGuardKey(req: Pick<PrintRequest, 'documentType' | 'documentRef' | 'copyLabel'>) {
  return `${req.documentType}:${req.documentRef ?? ''}:${req.copyLabel ?? ''}`;
}

/** RFC 4122 v4 id from getRandomValues (crypto.randomUUID needs a secure context; LAN Oilix is http). */
export function newPrintJobId(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type PrintDeps = {
  settings: DevicePrintSettings;
  agent: PrintAgentPort;
  guard: PrintGuard;
  log?: (entry: PrintLogEntry) => unknown;
  newJobId?: () => string;
};

function safeLog(deps: PrintDeps, entry: PrintLogEntry) {
  try {
    const r = deps.log?.(entry);
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => undefined);
  } catch {
    // Audit logging must never affect printing (or the sale that triggered it).
  }
}

/**
 * Sends one document to the device's configured printer through the Print Agent.
 * Never throws: a printing problem is reported as an outcome so the caller's business flow
 * (e.g. a completed sale) is untouched.
 */
export async function runPrint(req: PrintRequest, deps: PrintDeps): Promise<PrintOutcome> {
  const key = printGuardKey(req);
  if (!deps.guard.tryAcquire(key)) return { status: 'skipped', reason: 'in-flight' };
  try {
    const route = resolvePrinterRoute(deps.settings, req.target);
    if (!route.direct || !route.printer) {
      return {
        status: 'browser',
        reason: deps.settings.directPrinting ? 'printer-not-configured' : 'direct-disabled',
      };
    }

    const jobId = req.jobId ?? (deps.newJobId ?? newPrintJobId)();
    const base = {
      jobId,
      documentType: req.documentType,
      documentRef: req.documentRef,
      copyLabel: req.copyLabel,
      isReprint: !!req.isReprint,
      channel: 'AGENT' as const,
      printerName: route.printer,
      copies: route.copies,
    };
    const fail = (code: string, agentMessage?: string): PrintOutcome => {
      const message = printErrorMessage(code, route.printer);
      safeLog(deps, { ...base, status: 'FAILED', errorCode: code, errorMessage: agentMessage ?? message });
      return {
        status: 'failed',
        jobId,
        code,
        message,
        printer: route.printer,
        fallbackAvailable: deps.settings.browserFallback,
      };
    };

    let doc: RenderedDocument;
    try {
      doc = await req.render(route);
    } catch {
      return fail('RENDER_FAILED');
    }

    let res: AgentPrintResult;
    try {
      res = await deps.agent.print({
        jobId,
        printer: route.printer,
        kind: route.paper.kind,
        ...(route.paper.kind === 'receipt'
          ? { paperWidthMm: route.paper.widthMm, contentHeightMm: doc.contentHeightMm }
          : { paperFormat: route.paper.format, orientation: route.paper.orientation }),
        copies: route.copies,
        html: doc.html,
        title: doc.title,
      });
    } catch {
      res = { ok: false, code: 'AGENT_UNAVAILABLE' };
    }

    if (!res.ok) return fail(res.code, res.message);
    safeLog(deps, { ...base, status: 'SUBMITTED' });
    return { status: 'submitted', jobId, printer: route.printer, duplicate: !!res.duplicate };
  } finally {
    deps.guard.release(key);
  }
}

/** Sequential jobs (e.g. the two day-report copies). Stops at the first failure. */
export async function runPrintSequence(reqs: PrintRequest[], deps: PrintDeps): Promise<PrintOutcome[]> {
  const out: PrintOutcome[] = [];
  for (const req of reqs) {
    const r = await runPrint(req, deps);
    out.push(r);
    if (r.status !== 'submitted') break;
  }
  return out;
}

export const DAY_REPORT_ARCHIVE_FOOTER = 'COPIE ARCHIVE · نسخة الأرشيف';

/**
 * The financial day report is always produced as two logical copies, in this order:
 * 1) supervision / user copy, 2) archive copy. Shared by browser and direct printing.
 */
export function dayReportCopies<T extends { copyKind?: 'user' | 'archive'; footer?: string }>(
  data: T,
): Array<{ label: 'SUPERVISION' | 'ARCHIVE'; data: T }> {
  return [
    { label: 'SUPERVISION', data: { ...data, copyKind: 'user' } },
    { label: 'ARCHIVE', data: { ...data, copyKind: 'archive', footer: DAY_REPORT_ARCHIVE_FOOTER } },
  ];
}
