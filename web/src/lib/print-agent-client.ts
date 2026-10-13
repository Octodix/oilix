import type { AgentPrintJob, AgentPrintResult, PrintAgentPort } from './print-plan';

/** Loopback only — the agent refuses non-local peers and foreign Host headers. */
export const PRINT_AGENT_DEFAULT_URL = 'http://127.0.0.1:17777';
export const PRINT_AGENT_TOKEN_KEY = 'oilix_print_agent_token';

export type AgentHealth =
  | {
      ok: true;
      version: string;
      paired: boolean;
      originAllowed: boolean;
      pairingPending: boolean;
      renderer?: string;
    }
  | { ok: false; code: 'AGENT_UNAVAILABLE' };

export type AgentPrinter = {
  name: string;
  isDefault: boolean;
  offline: boolean;
  status: string;
  driver?: string | null;
};

export type AgentFailure = { ok: false; code: string; message?: string };

export type PrintAgentClient = PrintAgentPort & {
  health(): Promise<AgentHealth>;
  printers(): Promise<{ ok: true; printers: AgentPrinter[]; defaultPrinter: string | null } | AgentFailure>;
  pairStart(label: string): Promise<{ ok: true; pairingId: string; expiresInSec: number } | AgentFailure>;
  pairComplete(pairingId: string, code: string): Promise<{ ok: true } | AgentFailure>;
  forgetPairing(): void;
  hasToken(): boolean;
};

type Options = {
  baseUrl?: string;
  fetchImpl: typeof fetch;
  getToken: () => string | null;
  setToken: (token: string | null) => void;
  healthTimeoutMs?: number;
  printTimeoutMs?: number;
};

const UNAVAILABLE: AgentFailure = { ok: false, code: 'AGENT_UNAVAILABLE' };

export function createPrintAgentClient(opts: Options): PrintAgentClient {
  const base = (opts.baseUrl || PRINT_AGENT_DEFAULT_URL).replace(/\/+$/, '');

  async function call(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs: number; auth: boolean },
  ): Promise<{ status: number; data: Record<string, unknown> } | 'unreachable' | 'timeout'> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';
      const token = init.auth ? opts.getToken() : null;
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await opts.fetchImpl(`${base}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ctrl.signal,
        cache: 'no-store',
        credentials: 'omit',
      });
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }
      return { status: res.status, data };
    } catch (e) {
      return (e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'unreachable';
    } finally {
      clearTimeout(timer);
    }
  }

  function failure(r: { status: number; data: Record<string, unknown> }): AgentFailure {
    const code =
      typeof r.data.code === 'string'
        ? r.data.code
        : r.status === 401
          ? 'NOT_PAIRED'
          : r.status === 404
            ? 'PRINTER_NOT_FOUND'
            : 'PRINT_FAILED';
    return { ok: false, code, message: typeof r.data.message === 'string' ? r.data.message : undefined };
  }

  return {
    hasToken: () => !!opts.getToken(),
    forgetPairing: () => opts.setToken(null),

    async health() {
      const r = await call('/v1/health', { method: 'GET', timeoutMs: opts.healthTimeoutMs ?? 1500, auth: true });
      if (typeof r === 'string' || r.data.agent !== 'oilix-print-agent') return { ok: false, code: 'AGENT_UNAVAILABLE' };
      return {
        ok: true,
        version: String(r.data.version ?? ''),
        paired: r.data.paired === true,
        originAllowed: r.data.originAllowed === true,
        pairingPending: r.data.pairingPending === true,
        renderer: typeof r.data.renderer === 'string' ? r.data.renderer : undefined,
      };
    },

    async printers() {
      const r = await call('/v1/printers', { method: 'GET', timeoutMs: 5000, auth: true });
      if (typeof r === 'string') return UNAVAILABLE;
      if (r.status !== 200 || r.data.ok !== true) return failure(r);
      return {
        ok: true,
        printers: (Array.isArray(r.data.printers) ? r.data.printers : []) as AgentPrinter[],
        defaultPrinter: typeof r.data.defaultPrinter === 'string' ? r.data.defaultPrinter : null,
      };
    },

    async pairStart(label) {
      const r = await call('/v1/pair/start', { method: 'POST', body: { label }, timeoutMs: 5000, auth: false });
      if (typeof r === 'string') return UNAVAILABLE;
      if (r.data.ok !== true || typeof r.data.pairingId !== 'string') return failure(r);
      return { ok: true, pairingId: r.data.pairingId, expiresInSec: Number(r.data.expiresInSec ?? 120) };
    },

    async pairComplete(pairingId, code) {
      const r = await call('/v1/pair/complete', {
        method: 'POST',
        body: { pairingId, code: code.replace(/\s+/g, '') },
        timeoutMs: 5000,
        auth: false,
      });
      if (typeof r === 'string') return UNAVAILABLE;
      if (r.data.ok !== true || typeof r.data.token !== 'string') return failure(r);
      opts.setToken(r.data.token);
      return { ok: true };
    },

    async print(job: AgentPrintJob): Promise<AgentPrintResult> {
      const r = await call('/v1/print', {
        method: 'POST',
        body: job,
        timeoutMs: opts.printTimeoutMs ?? 60_000,
        auth: true,
      });
      if (r === 'unreachable') return { ok: false, code: 'AGENT_UNAVAILABLE' };
      if (r === 'timeout') return { ok: false, code: 'PRINT_TIMEOUT' };
      if (r.status === 200 && r.data.ok === true) {
        return { ok: true, jobId: String(r.data.jobId ?? job.jobId), duplicate: r.data.duplicate === true };
      }
      return failure(r);
    },
  };
}
