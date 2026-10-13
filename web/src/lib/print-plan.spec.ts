import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createPrintGuard,
  dayReportCopies,
  DEFAULT_DEVICE_PRINT_SETTINGS,
  newPrintJobId,
  resolvePrinterRoute,
  runPrint,
  runPrintSequence,
  targetForDocument,
  type AgentPrintJob,
  type AgentPrintResult,
  type DevicePrintSettings,
  type PrintLogEntry,
  type PrintRequest,
} from './print-plan.ts';

const deviceA: DevicePrintSettings = {
  ...DEFAULT_DEVICE_PRINT_SETTINGS,
  directPrinting: true,
  autoPrintAfterSale: true,
  receiptPrinter: 'XPrinter XP-Q200',
  receiptPaperWidth: 80,
  documentPrinter: 'HP LaserJet Pro M404',
  documentPaperFormat: 'A4',
};

const deviceB: DevicePrintSettings = {
  ...DEFAULT_DEVICE_PRINT_SETTINGS,
  directPrinting: true,
  receiptPrinter: 'Epson TM-T20',
  receiptPaperWidth: 58,
  documentPrinter: 'Canon LBP',
  documentPaperFormat: 'A5',
};

function fakeAgent(respond: (job: AgentPrintJob) => AgentPrintResult | Promise<AgentPrintResult>) {
  const jobs: AgentPrintJob[] = [];
  return {
    jobs,
    print: async (job: AgentPrintJob) => {
      jobs.push(job);
      return respond(job);
    },
  };
}

const okAgent = () => fakeAgent((j) => ({ ok: true, jobId: j.jobId }));

function receiptRequest(over: Partial<PrintRequest> = {}): PrintRequest {
  return {
    documentType: 'OIL_SALE_CLIENT_RECEIPT',
    documentRef: 'sale-1',
    target: 'receipt',
    render: async (route) => ({
      html: `<!doctype html><html><body>VT0000123 ${route.paper.kind}</body></html>`,
      title: 'VT0000123',
      contentHeightMm: 140,
    }),
    ...over,
  };
}

let seq = 0;
const ids = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

describe('printer routing per device', () => {
  it('device A and device B route the same document to their own printers', async () => {
    const a = okAgent();
    const b = okAgent();
    await runPrint(receiptRequest(), { settings: deviceA, agent: a, guard: createPrintGuard(), newJobId: ids });
    await runPrint(receiptRequest(), { settings: deviceB, agent: b, guard: createPrintGuard(), newJobId: ids });
    assert.equal(a.jobs[0].printer, 'XPrinter XP-Q200');
    assert.equal(a.jobs[0].paperWidthMm, 80);
    assert.equal(b.jobs[0].printer, 'Epson TM-T20');
    assert.equal(b.jobs[0].paperWidthMm, 58);
  });

  it('receipts go to the thermal printer, reports to the A4/A5 document printer', () => {
    assert.equal(targetForDocument('OIL_SALE_CLIENT_RECEIPT', deviceA), 'receipt');
    assert.equal(targetForDocument('OIL_DAY_REPORT', deviceA), 'document');
    assert.equal(targetForDocument('OIL_DAY_REPORT', { ...deviceA, dayReportTarget: 'RECEIPT' }), 'receipt');
    assert.equal(targetForDocument('HR_PAYSLIP', deviceA), 'document');
    assert.equal(targetForDocument('HR_REPORT', { ...deviceA, dayReportTarget: 'RECEIPT' }), 'document');
    const doc = resolvePrinterRoute(deviceB, 'document');
    assert.deepEqual(doc.paper, { kind: 'document', format: 'A5', orientation: 'portrait' });
    assert.equal(doc.printer, 'Canon LBP');
  });

  it('direct printing is off without a configured printer or when disabled', () => {
    assert.equal(resolvePrinterRoute({ ...deviceA, receiptPrinter: null }, 'receipt').direct, false);
    assert.equal(resolvePrinterRoute({ ...deviceA, directPrinting: false }, 'receipt').direct, false);
    assert.equal(resolvePrinterRoute({ ...deviceA, receiptDirect: false }, 'receipt').direct, false);
    assert.equal(resolvePrinterRoute(deviceA, 'receipt').direct, true);
  });
});

describe('direct printing', () => {
  it('sends the rendered document to the configured printer and audits the submission', async () => {
    const agent = okAgent();
    const logs: PrintLogEntry[] = [];
    const out = await runPrint(receiptRequest(), {
      settings: deviceA,
      agent,
      guard: createPrintGuard(),
      log: (e) => logs.push(e),
      newJobId: ids,
    });
    assert.equal(out.status, 'submitted');
    assert.equal(agent.jobs.length, 1);
    const job = agent.jobs[0];
    assert.equal(job.kind, 'receipt');
    assert.equal(job.title, 'VT0000123');
    assert.equal(job.contentHeightMm, 140);
    assert.match(job.html, /VT0000123 receipt/);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'SUBMITTED');
    assert.equal(logs[0].channel, 'AGENT');
    assert.equal(logs[0].printerName, 'XPrinter XP-Q200');
    assert.equal(logs[0].isReprint, false);
  });

  it('uses browser printing when the device has no direct printing', async () => {
    const agent = okAgent();
    const out = await runPrint(receiptRequest(), {
      settings: DEFAULT_DEVICE_PRINT_SETTINGS,
      agent,
      guard: createPrintGuard(),
    });
    assert.deepEqual(out, { status: 'browser', reason: 'direct-disabled' });
    assert.equal(agent.jobs.length, 0);
  });
});

describe('failures offer the browser fallback', () => {
  it('agent unavailable → failed outcome with fallback, never a thrown error', async () => {
    const agent = fakeAgent(() => ({ ok: false, code: 'AGENT_UNAVAILABLE' }));
    const logs: PrintLogEntry[] = [];
    const out = await runPrint(receiptRequest(), {
      settings: deviceA,
      agent,
      guard: createPrintGuard(),
      log: (e) => logs.push(e),
    });
    assert.equal(out.status, 'failed');
    if (out.status !== 'failed') return;
    assert.equal(out.code, 'AGENT_UNAVAILABLE');
    assert.equal(out.fallbackAvailable, true);
    assert.match(out.message, /وكيل الطباعة/);
    assert.equal(logs[0].status, 'FAILED');
  });

  it('a transport that throws is treated as agent unavailable', async () => {
    const out = await runPrint(receiptRequest(), {
      settings: deviceA,
      agent: { print: async () => Promise.reject(new TypeError('Failed to fetch')) },
      guard: createPrintGuard(),
    });
    assert.equal(out.status === 'failed' && out.code, 'AGENT_UNAVAILABLE');
  });

  it('printer unavailable → useful message naming the problem', async () => {
    const agent = fakeAgent(() => ({ ok: false, code: 'PRINTER_UNAVAILABLE', message: 'offline' }));
    const out = await runPrint(receiptRequest(), { settings: deviceA, agent, guard: createPrintGuard() });
    assert.equal(out.status, 'failed');
    if (out.status !== 'failed') return;
    assert.match(out.message, /تعذر الاتصال بالطابعة/);
    assert.match(out.message, /Imprimante indisponible/);
  });

  it('printer not found mentions the configured printer name', async () => {
    const agent = fakeAgent(() => ({ ok: false, code: 'PRINTER_NOT_FOUND' }));
    const out = await runPrint(receiptRequest(), { settings: deviceA, agent, guard: createPrintGuard() });
    assert.ok(out.status === 'failed' && out.message.includes('XPrinter XP-Q200'));
  });

  it('fallback is not offered when the device disabled browser printing', async () => {
    const agent = fakeAgent(() => ({ ok: false, code: 'AGENT_UNAVAILABLE' }));
    const out = await runPrint(receiptRequest(), {
      settings: { ...deviceA, browserFallback: false },
      agent,
      guard: createPrintGuard(),
    });
    assert.ok(out.status === 'failed' && out.fallbackAvailable === false);
  });

  it('a rendering error is reported, not thrown', async () => {
    const agent = okAgent();
    const out = await runPrint(
      receiptRequest({
        render: async () => {
          throw new Error('receipt API 500');
        },
      }),
      { settings: deviceA, agent, guard: createPrintGuard() },
    );
    assert.ok(out.status === 'failed' && out.code === 'RENDER_FAILED');
    assert.equal(agent.jobs.length, 0);
  });

  it('a failing audit log does not break printing', async () => {
    const out = await runPrint(receiptRequest(), {
      settings: deviceA,
      agent: okAgent(),
      guard: createPrintGuard(),
      log: () => Promise.reject(new Error('API down')),
    });
    assert.equal(out.status, 'submitted');
  });
});

describe('duplicate clicks and reprints', () => {
  it('a double click sends exactly one job', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const agent = fakeAgent(async (j) => {
      await gate;
      return { ok: true, jobId: j.jobId };
    });
    const deps = { settings: deviceA, agent, guard: createPrintGuard(), newJobId: ids };
    const first = runPrint(receiptRequest(), deps);
    const second = await runPrint(receiptRequest(), deps);
    release();
    assert.deepEqual(second, { status: 'skipped', reason: 'in-flight' });
    assert.equal((await first).status, 'submitted');
    assert.equal(agent.jobs.length, 1);
  });

  it('an intentional reprint after completion is sent with a new job id and flagged', async () => {
    const agent = okAgent();
    const logs: PrintLogEntry[] = [];
    const deps = { settings: deviceA, agent, guard: createPrintGuard(), log: (e: PrintLogEntry) => logs.push(e), newJobId: ids };
    await runPrint(receiptRequest(), deps);
    await runPrint(receiptRequest({ isReprint: true }), deps);
    assert.equal(agent.jobs.length, 2);
    assert.notEqual(agent.jobs[0].jobId, agent.jobs[1].jobId);
    assert.deepEqual(
      logs.map((l) => l.isReprint),
      [false, true],
    );
  });

  it('retry after a failure reuses the failed job id (idempotent agent + audit)', async () => {
    let fail = true;
    const agent = fakeAgent((j) => (fail ? { ok: false, code: 'PRINTER_UNAVAILABLE' } : { ok: true, jobId: j.jobId }));
    const deps = { settings: deviceA, agent, guard: createPrintGuard(), newJobId: ids };
    const first = await runPrint(receiptRequest(), deps);
    assert.equal(first.status, 'failed');
    fail = false;
    const retry = await runPrint(receiptRequest({ jobId: first.status === 'failed' ? first.jobId : undefined }), deps);
    assert.equal(retry.status, 'submitted');
    assert.equal(agent.jobs[0].jobId, agent.jobs[1].jobId);
  });

  it('job ids are RFC 4122 v4', () => {
    assert.match(newPrintJobId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('sale integrity', () => {
  it('a printer failure after a completed sale leaves the sale flow untouched', async () => {
    const sale = { id: 'sale-1', receiptNumber: 123, status: 'COMPLETED' };
    const saleFlow: string[] = [];
    // The POS completes the sale first, then prints without awaiting failure handling.
    saleFlow.push('sale-completed');
    const outcome = await runPrint(receiptRequest({ documentRef: sale.id }), {
      settings: deviceA,
      agent: fakeAgent(() => ({ ok: false, code: 'PRINTER_UNAVAILABLE' })),
      guard: createPrintGuard(),
    });
    saleFlow.push('form-reset');
    assert.equal(outcome.status, 'failed');
    assert.deepEqual(saleFlow, ['sale-completed', 'form-reset']);
    assert.equal(sale.status, 'COMPLETED');
  });
});

describe('financial day report', () => {
  const payload = { dateLabel: '01-10-2026', netTotal: 13000, footer: 'نسخة الأرشيف', copyKind: undefined };

  it('produces the supervision copy then the archive copy', () => {
    const copies = dayReportCopies(payload);
    assert.equal(copies.length, 2);
    assert.equal(copies[0].label, 'SUPERVISION');
    assert.equal(copies[0].data.copyKind, 'user');
    assert.equal(copies[1].label, 'ARCHIVE');
    assert.equal(copies[1].data.copyKind, 'archive');
    assert.equal(copies[1].data.footer, 'COPIE ARCHIVE · نسخة الأرشيف');
    assert.equal(copies[0].data.netTotal, 13000);
    assert.equal(copies[1].data.netTotal, 13000);
  });

  it('sends the two copies as two separate jobs to the document printer, in order', async () => {
    const agent = okAgent();
    const logs: PrintLogEntry[] = [];
    const reqs: PrintRequest[] = dayReportCopies(payload).map((c) => ({
      documentType: 'OIL_DAY_REPORT',
      documentRef: 'day-print-1',
      copyLabel: c.label,
      target: targetForDocument('OIL_DAY_REPORT', deviceA),
      render: async () => ({
        html: `<!doctype html><html><body>${c.data.copyKind}</body></html>`,
        title: `Journée ${c.label}`,
      }),
    }));
    const out = await runPrintSequence(reqs, {
      settings: deviceA,
      agent,
      guard: createPrintGuard(),
      log: (e) => logs.push(e),
      newJobId: ids,
    });
    assert.deepEqual(
      out.map((o) => o.status),
      ['submitted', 'submitted'],
    );
    assert.equal(agent.jobs.length, 2);
    assert.ok(agent.jobs.every((j) => j.printer === 'HP LaserJet Pro M404' && j.paperFormat === 'A4'));
    assert.match(agent.jobs[0].html, /user/);
    assert.match(agent.jobs[1].html, /archive/);
    assert.notEqual(agent.jobs[0].jobId, agent.jobs[1].jobId);
    assert.deepEqual(
      logs.map((l) => l.copyLabel),
      ['SUPERVISION', 'ARCHIVE'],
    );
  });

  it('stops after the first copy fails so the cashier can fall back once', async () => {
    const agent = fakeAgent(() => ({ ok: false, code: 'AGENT_UNAVAILABLE' }));
    const reqs: PrintRequest[] = dayReportCopies(payload).map((c) => ({
      documentType: 'OIL_DAY_REPORT',
      copyLabel: c.label,
      target: 'document',
      render: async () => ({ html: '<!doctype html><html></html>', title: c.label }),
    }));
    const out = await runPrintSequence(reqs, { settings: deviceA, agent, guard: createPrintGuard() });
    assert.equal(out.length, 1);
    assert.equal(agent.jobs.length, 1);
  });
});
