'use client';

import { Eye, Loader2, Printer, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  title: string;
  children: React.ReactNode;
  /** Present when this workstation prints silently through the Oilix Print Agent. */
  directPrint?: { busy: boolean; onPrint: () => void };
};

/** Cadre معاينة + طباعة 80mm (XPrinter) */
export function ThermalPrintFrame({ title, children, directPrint }: Props) {
  return (
    <>
      <div className="print-toolbar no-print sticky top-0 z-50 border-b border-stone-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-stone-600">
            <Eye className="h-4 w-4 shrink-0" />
            <span>
              {title} · <strong>80mm</strong>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {directPrint ? (
              <Button className="gap-2" disabled={directPrint.busy} onClick={directPrint.onPrint}>
                {directPrint.busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                طباعة مباشرة
              </Button>
            ) : null}
            <Button
              variant={directPrint ? 'outline' : 'primary'}
              className="gap-2"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" />
              {directPrint ? 'طباعة عبر المتصفح' : 'طباعة'}
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => window.close()}>
              <X className="h-4 w-4" />
              إغلاق
            </Button>
          </div>
        </div>
        <p className="border-t border-stone-100 bg-stone-50 px-4 py-2 text-center text-xs text-stone-500">
          عيّن حجم الورق 80mm في إعدادات الطابعة. للقوائم الطويلة، استخدم ورق متصل بدون هوامش.
        </p>
      </div>

      <div className="thermal-preview-shell no-print">
        <div className="thermal-preview-frame">{children}</div>
        <p className="mt-3 text-center text-xs text-stone-500">
          المعاينة بعرض 80 مم — يطابق الطباعة الحرارية
        </p>
      </div>

      <div className="thermal-print-only hidden print:block">{children}</div>
    </>
  );
}
