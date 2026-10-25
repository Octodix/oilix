# Mill operator assistance & financial handover (مساعدة المشغّل الرئيسي) — implementation notes

**Completed:** 2026-10-25. Uncommitted in the working tree together with the per-line oil-sale
assistance fix and the ADMS legacy handshake.

## What it does
During busy periods an authorized user starts an **assistance session** from their own registered
workstation to help the **primary operator**. Every payment they record (partial payments and the
"سالك" settlement) is attached to that session. When they finish they **close** the session, declare
the cash they counted, print **وصل تسليم المداخيل** (Print Agent or browser) and hand cash + receipt
to the primary operator, who **confirms** the amount actually received. A mismatch becomes a
**discrepancy** that must be explained and explicitly **resolved**. Confirmed sessions are immutable.

A handover is an **internal transfer**: it creates no payment, sale, cash-register or report row.
`GET /reports/financial-daily` is computed from operations and is unchanged by any handover
(verified end-to-end).

## Data model (migration `20261025140000_mill_assistance_sessions`, additive only)
- `mill_assistance_sessions`: season, `sessionNumber` (reference `AS-00001`), status
  `ACTIVE | AWAITING_CONFIRMATION | CONFIRMED | DISCREPANCY`, primary/assistant users and devices,
  name snapshots, frozen totals, `declaredHandover`, `receivedHandover`, `difference`, notes,
  confirm/resolve audit fields. Partial unique index: one ACTIVE session per assistant.
- `payments.assistance_session_id`, `pressing_records.assistance_session_id` (nullable FKs).
- Permissions `MILL_ASSIST_START | CLOSE | PRINT | VIEW_ALL | CONFIRM | RESOLVE`. Seed: OPERATOR gets
  START/CLOSE/PRINT and `FINANCE_WRITE` (to record customer payments); confirm/resolve stay with the
  primary operator (ADMIN or a user granted VIEW_ALL/CONFIRM).

## Behaviour change in the mill
Marking an operation **سالك** now records a `Payment` for the remaining balance (idempotent, so
toggling never duplicates). Before it was only a flag and collected cash was untraceable.

## API `api/src/modules/mill-assistance/`
`GET me` · `GET primaries` · `POST sessions` · `GET sessions[?status&from&to]` · `GET sessions/:id`
· `GET sessions/:id/receipt` · `POST sessions/:id/close` · `POST sessions/:id/confirm` ·
`POST sessions/:id/resolve` · `GET dashboard`. All audited (module PAYMENTS).

## Web
Main entry point for assistants is the **oil-processing page** `/olive/<type>/processing`
(`AssistancePanel`): start a session (pick the primary operator), live cash held, close + declared
amount + handover receipt, all inline. The same panel sits on `/pressing` (compact).
`/assistance` (history, pending handovers, reprint), `/assistance/dashboard` (primary), read-only
handover table on `/finance`, print document `mill-handover-receipt-document.tsx`, browser print
page `/mill-handover/:id`, Print Agent request `millHandoverReceiptRequest`.

## Verification
- API: `tsc` clean, **202 tests** (6 money-rule + 6 service-flow tests added). Web: `tsc` clean,
  76 tests, lint clean on new files.
- Live two-user run (`smoke-assistance-session.mjs`): operator on "PC 02" helps admin on "Main PC";
  partial payment + سالك attach to the session; paid toggle does not duplicate; short declaration
  needs a reason; later payments stay out of the closed session; self-confirm refused; admin
  confirmation locks the session; receipt and dashboard correct; finance daily total moved only by
  the new operation. **All 25 checks passed.**

## Operational notes
- Cash vs non-cash: `payments.method` is free text; empty / CASH / نقداً / espèces count as cash,
  anything else as non-cash (collected but not handed over). Adjust `CASH_METHODS` if you add methods.
- Test data left in the local dev DB by the smoke runs: users `mohamed…`, clients `Ali/Omar Test…`,
  devices `Main PC`/`PC 02`, sessions AS-00001 (orphan ACTIVE from a first failed run) and AS-00002.
