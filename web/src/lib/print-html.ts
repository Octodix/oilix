import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { PaperSpec, RenderedDocument } from './print-plan';

/**
 * Turns an Oilix print component (the same one used by the browser print pages) into a
 * self-contained HTML document for the Print Agent: app CSS inlined, fonts embedded as
 * data: URLs (the agent blocks every network request), dark mode stripped.
 */

const PX_TO_MM = 25.4 / 96;
const fontCache = new Map<string, Promise<string | null>>();

/** A4/A5 sheets show the 80mm documents enlarged so they stay readable on paper. */
const DOCUMENT_ZOOM: Record<'A4' | 'A5', number> = { A4: 1.4, A5: 1.2 };

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function toDataUrl(url: string): Promise<string | null> {
  let cached = fontCache.get(url);
  if (!cached) {
    cached = (async () => {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    })();
    fontCache.set(url, cached);
  }
  return cached;
}

async function inlineFontFace(cssText: string, baseHref: string): Promise<string> {
  const urls = [...cssText.matchAll(/url\((['"]?)([^'")]+)\1\)/g)];
  let out = cssText;
  for (const m of urls) {
    const raw = m[2];
    if (raw.startsWith('data:')) continue;
    let abs: URL;
    try {
      abs = new URL(raw, baseHref);
    } catch {
      continue;
    }
    if (abs.origin !== window.location.origin) continue;
    const data = await toDataUrl(abs.href);
    if (data) out = out.split(m[0]).join(`url("${data}")`);
  }
  return out;
}

async function collectCss(): Promise<string> {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const base = sheet.href ?? document.baseURI;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule) continue;
      if (rule instanceof CSSFontFaceRule) {
        parts.push(await inlineFontFace(rule.cssText, base));
      } else {
        parts.push(rule.cssText);
      }
    }
  }
  return parts.join('\n');
}

function paperCss(paper: PaperSpec): string {
  if (paper.kind === 'receipt') {
    const content = paper.widthMm - 8;
    return `
html,body{margin:0!important;padding:0!important;width:${paper.widthMm}mm!important;min-height:0!important;background:#fff!important;color:#000}
.print-root{width:${paper.widthMm}mm;overflow:hidden}
.print-root .thermal-receipt{width:${content}mm!important;max-width:${content}mm!important;margin:0 auto!important}
@page{size:auto;margin:0}`;
  }
  const zoom = DOCUMENT_ZOOM[paper.format];
  return `
html,body{margin:0!important;padding:0!important;width:auto!important;min-height:0!important;background:#fff!important;color:#000}
.print-root{zoom:${zoom};display:flex;justify-content:center}
.print-root .thermal-receipt{margin:0 auto!important}
.print-root:has(.a4-document){zoom:1;display:block}
.print-root .a4-document{width:100%!important;max-width:none!important;margin:0!important;box-shadow:none!important}
@page{size:auto;margin:8mm}`;
}

function rootClasses() {
  return Array.from(document.documentElement.classList)
    .filter((c) => c !== 'dark')
    .join(' ');
}

/** Must run in the browser, outside React rendering (event handlers, effects, async callbacks). */
export async function renderPrintHtml(
  element: ReactElement,
  paper: PaperSpec,
  title: string,
): Promise<RenderedDocument> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-100000px;top:0;pointer-events:none;background:#fff;' +
    (paper.kind === 'receipt' ? `width:${paper.widthMm}mm;` : 'width:210mm;');
  host.className = 'print-root';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(element));
    if (document.fonts?.ready) await document.fonts.ready;
    const contentHeightMm =
      paper.kind === 'receipt' ? Math.ceil(host.scrollHeight * PX_TO_MM) : undefined;
    const body = host.innerHTML;
    const css = await collectCss();
    const html =
      `<!doctype html><html lang="ar" dir="rtl" class="${escapeHtml(rootClasses())}">` +
      `<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>` +
      `<style>${paperCss(paper)}</style></head>` +
      `<body><div class="print-root">${body}</div></body></html>`;
    return { html, title, contentHeightMm };
  } finally {
    root.unmount();
    host.remove();
  }
}
