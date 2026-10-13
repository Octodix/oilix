# Oilix Print Agent

Small Windows tray application that lets the Oilix web app print **silently** (no browser
print dialog) to the thermal receipt printer and the A4/A5 document printer configured for
each workstation.

```
Oilix web app (browser) ──HTTP, loopback only──▶ Oilix Print Agent (127.0.0.1:17777) ──▶ Windows printer
        │                                              │
        └── device printer settings (Oilix API) ───────┘  PrintAsync(printer, paper, copies)
```

Browser printing (`window.print()` on the existing print pages) is unchanged and always remains
available as a fallback. The POS never depends on the agent being online: a sale is committed
before any printing starts, and a print failure only produces a toast with **Réessayer** /
**Imprimer avec le navigateur**.

## Technology and why

| Part | Choice | Reason |
| --- | --- | --- |
| Runtime | .NET 8 (self-contained single exe, ~70 MB; or framework-dependent) | Native Windows printing APIs, tray icon, no Node/Python install on the till |
| HTTP | ASP.NET Core Kestrel bound to `127.0.0.1` only | Small, robust, explicit binding to loopback |
| Rendering + printing | Microsoft Edge **WebView2** (`CoreWebView2.PrintAsync`) | Same Chromium engine as the browser: identical Arabic shaping, RTL/LTR, Cairo font, tables and CSS as the existing Oilix print pages. No ESC/POS Arabic code pages needed |
| Printer discovery | Win32 `EnumPrinters` / `GetDefaultPrinter` | Lists local and network printers with status, offline flag and default printer |
| UI | WinForms `NotifyIcon` | Tray icon, status, test page, pairing code window, start-with-Windows toggle |

The web app renders the **same React document components** used by the browser print pages into
a self-contained HTML snapshot (CSS inlined, fonts embedded as `data:` URLs) and sends it to the
agent. Thermal receipts use a page as wide as the roll (58/80 mm) and as tall as the measured
content (+6 mm feed); A4/A5 jobs use the sheet size, orientation and 8 mm margins.

## Install on a workstation (production)

Requirements: Windows 10/11 x64, Microsoft Edge WebView2 Runtime (preinstalled on Windows 11;
otherwise <https://go.microsoft.com/fwlink/p/?LinkId=2124703>), printers installed in Windows.
No administrator rights are required.

1. Copy the `dist\OilixPrintAgent` folder (see *Build*) to the workstation.
2. Run, replacing the address with the Oilix URL used on that PC:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -AllowOrigin http://192.168.1.10:3000 -RestrictPairing
   ```

   - installs to `%LOCALAPPDATA%\Programs\OilixPrintAgent\OilixPrintAgent.exe`;
   - pre-approves the Oilix address (`-RestrictPairing` = no other site may even ask to pair);
   - registers start with Windows (`HKCU\...\Run`, `--background`) and starts the agent.
3. In Oilix, open **Appareils (الأجهزة)** on that PC → **طابعات هذا الجهاز**:
   1. click **ربط هذا المتصفح بالوكيل · Appairer**; the agent shows a 6-digit code in a window on
      top of the screen; type it in Oilix (expires after 2 minutes);
   2. choose the receipt printer (58/80 mm) and the document printer (A4/A5, orientation) from the
      discovered list (★ = Windows default printer);
   3. enable **Impression directe**, optionally **Imprimer automatiquement après validation de la
      vente**, save;
   4. press **اختبار الطباعة · Tester l'impression** for each printer.

   Chrome may ask once to allow the Oilix site to access *devices on your local network*: allow it
   (the request goes to `127.0.0.1`, this PC only).

**Update:** build the new version and run `install.ps1` again (it stops the running agent,
replaces the exe and keeps pairings/settings). The version is shown in the tray menu and in Oilix.

**Uninstall:** `uninstall.ps1` (`-KeepData` keeps pairings and logs).

## Local communication

Base URL `http://127.0.0.1:17777` (override in the web app with `NEXT_PUBLIC_PRINT_AGENT_URL`).

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /v1/health` | public (no data) | agent name, version, renderer, whether the calling origin is paired |
| `POST /v1/pair/start` | Origin header required | shows the 6-digit code window on this PC |
| `POST /v1/pair/complete` | Origin + pairing id + code | returns a pairing token (stored in the browser's `localStorage`) |
| `GET /v1/printers` | paired origin + `Authorization: Bearer <token>` | printers, default printer, offline/status |
| `POST /v1/print` | paired origin + bearer token | `{ jobId, printer, kind: receipt\|document, paperWidthMm \| paperFormat+orientation, copies, html, title, contentHeightMm }` |

Print responses: `200 SUBMITTED` (also for an idempotent repeat of the same `jobId`),
`404 PRINTER_NOT_FOUND`, `409 JOB_IN_PROGRESS`, `502 PRINTER_UNAVAILABLE | PRINT_FAILED`,
`504 PRINT_TIMEOUT`, `401 NOT_PAIRED`, `403 ORIGIN_NOT_ALLOWED`, `413 JOB_TOO_LARGE`.

## Security model

- **Loopback only:** Kestrel listens on `127.0.0.1`; requests whose peer is not loopback are refused.
  Nothing is exposed to the LAN.
- **DNS-rebinding protection:** the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`.
- **Origin + pairing:** printing and printer listing require an `Origin` that completed pairing
  **and** its bearer token. Pairing needs physical presence (code shown only on this PC's screen),
  expires after 2 minutes, allows 5 attempts and 3 starts per minute. Only a SHA-256 hash of each
  token is stored (`%LOCALAPPDATA%\Oilix\PrintAgent\config.json`), bound to its origin. Tokens are
  random per PC/browser — nothing secret is in the Oilix source code. "Révoquer les appairages"
  in the tray menu revokes all of them.
- **Strict job validation:** JSON only, known fields, UUID job id, printer name without control
  characters and existing in Windows, copies 1–5, paper sizes from a fixed list, HTML ≤ 4 MB that
  must be a full HTML document. No file paths, URLs, shell commands or printer parameters are
  accepted.
- **Sandboxed rendering:** WebView2 with scripts disabled, dev tools/context menus/downloads/
  popups/permissions disabled, CSP `default-src 'none'` and every network request answered `403`
  — a document cannot fetch remote URLs or local files.
- **Safe logging:** daily logs in `%LOCALAPPDATA%\Oilix\PrintAgent\logs` (30-day retention) with job
  id, printer, result and duration — never the document HTML or tokens.
- **Idempotency:** a repeated `jobId` while printing → `409`; after success → the cached result
  (no second print). Intentional reprints use a new `jobId` and are audited as reprints by Oilix.

## Printer discovery

`EnumPrinters(PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS, level 2)` returns local and
network-connected printers with driver, port and status bits (offline, paper out, paper jam,
error…); `GetDefaultPrinter` marks the default one. Printer names are matched exactly
(case-insensitive) before each job, so a renamed/removed printer gives `PRINTER_NOT_FOUND` with a
clear message instead of printing elsewhere.

## Silent print mechanism

1. The job HTML is served to an off-screen WebView2 from `https://print.oilix.invalid/job/<id>`.
2. Embedded fonts finish loading; receipt height is measured in the agent's own renderer.
3. `CoreWebView2.PrintAsync` is called with `PrinterName`, `Copies`, custom page width/height,
   orientation, margins, backgrounds on, headers/footers off — no dialog is shown.
4. `PrintAsync` result → `SUBMITTED` (accepted by the Windows spooler/driver),
   `PRINTER_UNAVAILABLE` or `PRINT_FAILED`.

`SUBMITTED` means *the Windows print system accepted the job*. It is **not** proof that paper came
out (paper out, cover open or a jam can still happen afterwards); Oilix records it as
"submitted", never as "printed".

## Windows startup and tray

`HKCU\Software\Microsoft\Windows\CurrentVersion\Run\OilixPrintAgent = "<exe>" --background`.
Tray menu: version, status (🟢 connected / errors), test page per printer, revoke pairings, start
with Windows on/off, open logs, quit. A single instance runs per user session.

## Development

```powershell
cd print-agent
dotnet test                                   # 55 unit tests (security, validation, layout, dedupe)
dotnet run --project src/OilixPrintAgent -- --allow-origin http://localhost:3000
dotnet run --project src/OilixPrintAgent -- --selftest   # renders %LOCALAPPDATA%\Oilix\PrintAgent\selftest.pdf
```

Command-line flags: `--background`, `--allow-origin <url>` (repeatable), `--restrict-pairing`,
`--configure-only`, `--selftest`.

## Build for production

```powershell
cd print-agent
.\scripts\build.ps1                      # tests + self-contained single exe → dist\OilixPrintAgent
.\scripts\build.ps1 -FrameworkDependent  # smaller exe; needs .NET 8 Desktop + ASP.NET Core runtimes
```

## Chrome `--kiosk-printing` (evaluated, optional only)

Starting Chrome with `--kiosk-printing` makes `window.print()` print immediately to the
**default** printer. It can be used as a stop-gap on a till with a single printer, but it is not
the primary architecture because it cannot route receipts and A4 reports to different printers,
cannot choose paper per document, cannot discover printers or report printer errors, applies to
every site in that browser profile, and depends on how Chrome is launched. The Print Agent covers
all of these; the existing browser print pages keep working with or without kiosk mode.
