'use client';

import { Eye, Loader2, Printer, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  title: string;
  children: React.ReactNode;
  orientation?: 'portrait' | 'landscape';
  directPrint?: { busy: boolean; onPrint: () => void };
};

/** Preview + print frame for A4 documents (overrides the global 80mm print page). */
export function A4PrintFrame({ title, children, orientation = 'portrait', directPrint }: Props) {
  return (
    <>
      <style>{`@media print{@page{size:A4 ${orientation};margin:10mm}}`}</style>
      <div className="print-toolbar no-print sticky top-0 z-50 border-b border-stone-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-stone-600">
            <Eye className="h-4 w-4 shrink-0" />
            <span>
              {title} · <strong>A4</strong>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {directPrint ? (
              <Button className="gap-2" disabled={directPrint.busy} onClick={directPrint.onPrint}>
                {directPrint.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                طباعة مباشرة
              </Button>
            ) : null}
            <Button
              variant={directPrint ? 'outline' : 'primary'}
              className="gap-2"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" />
              {directPrint ? 'طباعة عبر المتصفح' : 'طباعة · Imprimer'}
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => window.close()}>
              <X className="h-4 w-4" />
              إغلاق
            </Button>
          </div>
        </div>
      </div>
      <div className="a4-preview-shell">{children}</div>
    </>
  );
}
