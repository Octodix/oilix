'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DEFAULT_DEVICE_PRINT_SETTINGS,
  newPrintJobId,
  type DevicePrintSettings,
  type PrintOutcome,
  type PrintRequest,
} from '@/lib/print-plan';
import {
  fetchMyPrintSettings,
  logPrintJob,
  printAgent,
  PrintService,
} from '@/lib/print-service';

export const DEVICE_PRINT_SETTINGS_KEY = ['device-print-settings'] as const;

export function useDevicePrintSettings() {
  return useQuery({
    queryKey: DEVICE_PRINT_SETTINGS_KEY,
    queryFn: fetchMyPrintSettings,
    staleTime: 60_000,
  });
}

export type DirectPrintOptions = {
  /** Opens the existing browser print flow (always available unless the device disabled it). */
  browserFallback?: () => void;
  /** Use these settings instead of the saved ones (e.g. unsaved test-print form). */
  settings?: DevicePrintSettings;
  successMessage?: string;
};

export type DirectPrintResult = 'submitted' | 'browser' | 'failed' | 'skipped';

type RunContext = { settings: DevicePrintSettings; onPending: (delta: number) => void };

export async function checkPrintAgent() {
  const h = await printAgent().health();
  if (!h.ok) {
    toast.error('🔴 Agent d’impression indisponible · وكيل الطباعة غير متاح', {
      description: 'شغّل «Oilix Print Agent» على هذا الجهاز (أيقونة شريط المهام) ثم أعد المحاولة.',
    });
  } else if (!h.paired) {
    toast.warning('🟢 Agent connecté — non appairé · الوكيل يعمل لكنه غير مربوط', {
      description: 'اربط هذا المتصفح بالوكيل من إعدادات الجهاز ← الطابعات.',
    });
  } else {
    toast.success(`🟢 Agent d’impression connecté · v${h.version}`, {
      description: 'الوكيل يعمل. تحقق من تشغيل الطابعة واتصالها ومن الورق.',
    });
  }
}

function openBrowserFallback(first: PrintRequest, opts: DirectPrintOptions) {
  if (!opts.browserFallback) return;
  opts.browserFallback();
  logPrintJob({
    jobId: newPrintJobId(),
    documentType: first.documentType,
    documentRef: first.documentRef,
    isReprint: !!first.isReprint,
    channel: 'BROWSER',
    status: 'BROWSER_OPENED',
    copies: 1,
  });
}

async function executePrint(
  reqs: PrintRequest[],
  opts: DirectPrintOptions,
  ctx: RunContext,
): Promise<DirectPrintResult> {
  if (!reqs.length) return 'skipped';
  const { settings } = ctx;
  const first = reqs[0];

  ctx.onPending(1);
  const toastId = toast.loading('جاري الإرسال للطابعة · Impression en cours…');
  let outcomes: PrintOutcome[];
  try {
    outcomes =
      reqs.length === 1
        ? [await PrintService.print(first, settings)]
        : await PrintService.printSequence(reqs, settings);
  } finally {
    ctx.onPending(-1);
  }
  const last = outcomes[outcomes.length - 1];

  if (last.status === 'skipped') {
    toast.dismiss(toastId);
    return 'skipped';
  }

  if (last.status === 'browser') {
    if (opts.browserFallback && settings.browserFallback) {
      toast.dismiss(toastId);
      openBrowserFallback(first, opts);
      return 'browser';
    }
    toast.error('الطباعة المباشرة غير مفعلة لهذا الجهاز · Impression directe non configurée', {
      id: toastId,
    });
    return 'failed';
  }

  if (last.status === 'submitted') {
    toast.success(opts.successMessage ?? 'تم إرسال الوصل للطابعة · Impression envoyée', {
      id: toastId,
      description:
        outcomes.length > 1
          ? `${outcomes.length} نسخ → ${last.printer}`
          : `→ ${last.printer}${last.duplicate ? ' (déjà envoyé)' : ''}`,
    });
    return 'submitted';
  }

  const failedIndex = outcomes.length - 1;
  const retryReqs = reqs
    .slice(failedIndex)
    .map((r, i) => (i === 0 ? { ...r, jobId: last.jobId } : r));
  const sentBefore = failedIndex > 0 ? ` (${failedIndex}/${reqs.length} نسخة أُرسلت)` : '';
  toast.error(`تعذر الاتصال بالطابعة${sentBefore}`, {
    id: toastId,
    duration: 15_000,
    description: (
      <span className="block space-y-1">
        <span className="block">{last.message}</span>
        <button
          type="button"
          className="text-xs font-bold underline underline-offset-2"
          onClick={() => void checkPrintAgent()}
        >
          التحقق من وكيل الطباعة · Vérifier l’agent
        </button>
      </span>
    ),
    action: {
      label: 'إعادة المحاولة · Réessayer',
      onClick: () => void executePrint(retryReqs, opts, ctx),
    },
    ...(last.fallbackAvailable && opts.browserFallback
      ? {
          cancel: {
            label: 'Imprimer avec le navigateur',
            onClick: () => openBrowserFallback(retryReqs[0], opts),
          },
        }
      : {}),
  });
  return 'failed';
}

/**
 * Direct (silent) printing for the current workstation, with toasts, retry and the
 * browser fallback. Never throws — callers can fire-and-forget after a completed sale.
 */
export function useDirectPrint() {
  const settingsQ = useDevicePrintSettings();
  const saved = settingsQ.data?.settings ?? DEFAULT_DEVICE_PRINT_SETTINGS;
  const [pending, setPending] = useState(0);
  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  const print = useCallback(
    (req: PrintRequest | PrintRequest[], opts: DirectPrintOptions = {}) =>
      executePrint(Array.isArray(req) ? req : [req], opts, {
        settings: opts.settings ?? savedRef.current,
        onPending: (d) => setPending((n) => Math.max(0, n + d)),
      }),
    [],
  );

  return {
    print,
    busy: pending > 0,
    settings: saved,
    device: settingsQ.data?.device ?? null,
    settingsLoaded: settingsQ.isSuccess,
  };
}
