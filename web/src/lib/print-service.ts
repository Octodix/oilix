import { api } from '@/lib/api';
import {
  createPrintAgentClient,
  PRINT_AGENT_TOKEN_KEY,
  type PrintAgentClient,
} from '@/lib/print-agent-client';
import {
  createPrintGuard,
  DEFAULT_DEVICE_PRINT_SETTINGS,
  runPrint,
  runPrintSequence,
  type DevicePrintSettings,
  type PrintLogEntry,
  type PrintOutcome,
  type PrintRequest,
} from '@/lib/print-plan';

/**
 * PrintService — one entry point for every Oilix document:
 *   PrintService.print(request, deviceSettings)
 * The request says WHAT (document type, reference, how to render it); the device settings
 * (loaded per workstation from the API) say WHERE.
 */

export type DevicePrintSettingsResponse = {
  device: {
    id: string;
    code: string | null;
    name: string;
    status: string;
    cashRegister: { id: string; code: string; name: string } | null;
  } | null;
  configured: boolean;
  settings: DevicePrintSettings;
};

let agent: PrintAgentClient | null = null;

/** The pairing token is issued by the agent on this PC and kept only in this browser profile. */
export function printAgent(): PrintAgentClient {
  if (!agent) {
    agent = createPrintAgentClient({
      baseUrl: process.env.NEXT_PUBLIC_PRINT_AGENT_URL,
      fetchImpl: (input, init) => fetch(input, init),
      getToken: () => {
        try {
          return localStorage.getItem(PRINT_AGENT_TOKEN_KEY);
        } catch {
          return null;
        }
      },
      setToken: (token) => {
        try {
          if (token) localStorage.setItem(PRINT_AGENT_TOKEN_KEY, token);
          else localStorage.removeItem(PRINT_AGENT_TOKEN_KEY);
        } catch {
          // Private mode / storage disabled: direct printing simply stays unpaired.
        }
      },
    });
  }
  return agent;
}

export async function fetchMyPrintSettings(): Promise<DevicePrintSettingsResponse> {
  try {
    return (await api.get<DevicePrintSettingsResponse>('/printing/settings/me')).data;
  } catch {
    return { device: null, configured: false, settings: { ...DEFAULT_DEVICE_PRINT_SETTINGS } };
  }
}

export function logPrintJob(entry: PrintLogEntry) {
  return api.post('/printing/jobs', entry).catch(() => undefined);
}

/** Shared by every page so a double click anywhere sends one job per document. */
export const printGuard = createPrintGuard();

export const PrintService = {
  print(req: PrintRequest, settings: DevicePrintSettings): Promise<PrintOutcome> {
    return runPrint(req, { settings, agent: printAgent(), guard: printGuard, log: logPrintJob });
  },
  printSequence(reqs: PrintRequest[], settings: DevicePrintSettings): Promise<PrintOutcome[]> {
    return runPrintSequence(reqs, { settings, agent: printAgent(), guard: printGuard, log: logPrintJob });
  },
};
