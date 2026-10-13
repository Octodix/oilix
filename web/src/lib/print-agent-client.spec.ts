import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPrintAgentClient, PRINT_AGENT_DEFAULT_URL } from './print-agent-client.ts';

type Call = { url: string; init: RequestInit };

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown } | Error) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const r = handler(url, init ?? {});
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { impl, calls };
}

function client(handler: Parameters<typeof fakeFetch>[0], token: string | null = 'tok') {
  let stored = token;
  const f = fakeFetch(handler);
  const c = createPrintAgentClient({
    fetchImpl: f.impl,
    getToken: () => stored,
    setToken: (t) => (stored = t),
  });
  return { c, calls: f.calls, token: () => stored };
}

const job = {
  jobId: '00000000-0000-4000-8000-000000000001',
  printer: 'XPrinter XP-Q200',
  kind: 'receipt' as const,
  paperWidthMm: 80 as const,
  copies: 1,
  html: '<!doctype html><html></html>',
  title: 'VT1',
};

describe('print agent client', () => {
  it('talks to the loopback agent only', () => {
    assert.equal(PRINT_AGENT_DEFAULT_URL, 'http://127.0.0.1:17777');
  });

  it('health: unreachable agent is reported as unavailable', async () => {
    const { c } = client(() => new TypeError('Failed to fetch'));
    assert.deepEqual(await c.health(), { ok: false, code: 'AGENT_UNAVAILABLE' });
  });

  it('health: something else listening on the port is not mistaken for the agent', async () => {
    const { c } = client(() => ({ status: 200, body: { ok: true } }));
    assert.equal((await c.health()).ok, false);
  });

  it('health: reports version and pairing state', async () => {
    const { c } = client(() => ({
      status: 200,
      body: { ok: true, agent: 'oilix-print-agent', version: '1.0.0', paired: true, originAllowed: true },
    }));
    const h = await c.health();
    assert.ok(h.ok && h.version === '1.0.0' && h.paired);
  });

  it('print: sends the bearer token and the job, never cookies', async () => {
    const { c, calls } = client(() => ({ status: 200, body: { ok: true, jobId: job.jobId, status: 'SUBMITTED' } }));
    const r = await c.print(job);
    assert.deepEqual(r, { ok: true, jobId: job.jobId, duplicate: false });
    assert.equal(calls[0].url, 'http://127.0.0.1:17777/v1/print');
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
    assert.equal(calls[0].init.credentials, 'omit');
    assert.equal(JSON.parse(String(calls[0].init.body)).printer, 'XPrinter XP-Q200');
  });

  it('print: maps agent errors and network failures', async () => {
    const down = client(() => new TypeError('Failed to fetch'));
    assert.deepEqual(await down.c.print(job), { ok: false, code: 'AGENT_UNAVAILABLE' });

    const offline = client(() => ({
      status: 502,
      body: { ok: false, code: 'PRINTER_UNAVAILABLE', message: 'Imprimante indisponible' },
    }));
    assert.deepEqual(await offline.c.print(job), {
      ok: false,
      code: 'PRINTER_UNAVAILABLE',
      message: 'Imprimante indisponible',
    });

    const unpaired = client(() => ({ status: 401, body: {} }));
    assert.equal(((await unpaired.c.print(job)) as { code: string }).code, 'NOT_PAIRED');
  });

  it('print: a duplicate submission is reported as such by the agent', async () => {
    const { c } = client(() => ({ status: 200, body: { ok: true, jobId: job.jobId, duplicate: true } }));
    assert.deepEqual(await c.print(job), { ok: true, jobId: job.jobId, duplicate: true });
  });

  it('pairing stores the issued token locally (never in source code)', async () => {
    const { c, token } = client((url) =>
      url.endsWith('/v1/pair/start')
        ? { status: 200, body: { ok: true, pairingId: 'p1', expiresInSec: 120 } }
        : { status: 200, body: { ok: true, token: 'issued-token' } },
    null);
    const start = await c.pairStart('POS-HUILE-01');
    assert.ok(start.ok);
    const done = await c.pairComplete('p1', '123 456');
    assert.ok(done.ok);
    assert.equal(token(), 'issued-token');
    c.forgetPairing();
    assert.equal(token(), null);
  });

  it('pairing: a wrong code keeps the client unpaired', async () => {
    const { c, token } = client(() => ({ status: 400, body: { ok: false, code: 'WRONG_CODE' } }), null);
    const r = await c.pairComplete('p1', '000000');
    assert.equal(r.ok, false);
    assert.equal(token(), null);
  });
});
