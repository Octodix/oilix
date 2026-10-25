-- Mill operator assistance: an authorized user helps the primary operator from another
-- workstation; the money they collect is grouped in a session and physically handed over.
-- Additive only: new enum values, one new table, two nullable columns. No data is touched.
-- Payments remain the only revenue records; a handover is an internal cash transfer.

ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'MILL_ASSIST_START';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'MILL_ASSIST_CLOSE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'MILL_ASSIST_PRINT';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'MILL_ASSIST_VIEW_ALL';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'MILL_ASSIST_CONFIRM';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'MILL_ASSIST_RESOLVE';

CREATE TYPE "MillAssistanceStatus" AS ENUM ('ACTIVE', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'DISCREPANCY');

CREATE TABLE "mill_assistance_sessions" (
    "id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "session_number" INTEGER NOT NULL,
    "status" "MillAssistanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "primary_operator_id" TEXT NOT NULL,
    "assistant_id" TEXT NOT NULL,
    "assistant_device_id" TEXT,
    "primary_device_id" TEXT,
    "primary_operator_name" TEXT,
    "assistant_name" TEXT,
    "assistant_device_name" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "operations_count" INTEGER NOT NULL DEFAULT 0,
    "payments_count" INTEGER NOT NULL DEFAULT 0,
    "total_charged" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_collected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_cash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_non_cash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_outstanding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expected_handover" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "declared_handover" DECIMAL(14,2),
    "difference" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discrepancy_note" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "received_handover" DECIMAL(14,2),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "resolution_note" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mill_assistance_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mill_assistance_sessions_season_id_session_number_key" ON "mill_assistance_sessions"("season_id", "session_number");
CREATE INDEX "mill_assistance_sessions_assistant_id_status_idx" ON "mill_assistance_sessions"("assistant_id", "status");
CREATE INDEX "mill_assistance_sessions_primary_operator_id_status_idx" ON "mill_assistance_sessions"("primary_operator_id", "status");
CREATE INDEX "mill_assistance_sessions_season_id_status_idx" ON "mill_assistance_sessions"("season_id", "status");
-- One ACTIVE session per assistant at any time (same pattern as the one-open cash session).
CREATE UNIQUE INDEX "mill_assistance_sessions_one_active_per_assistant" ON "mill_assistance_sessions"("assistant_id") WHERE "status" = 'ACTIVE';

ALTER TABLE "mill_assistance_sessions" ADD CONSTRAINT "mill_assistance_sessions_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mill_assistance_sessions" ADD CONSTRAINT "mill_assistance_sessions_primary_operator_id_fkey" FOREIGN KEY ("primary_operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mill_assistance_sessions" ADD CONSTRAINT "mill_assistance_sessions_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mill_assistance_sessions" ADD CONSTRAINT "mill_assistance_sessions_assistant_device_id_fkey" FOREIGN KEY ("assistant_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mill_assistance_sessions" ADD CONSTRAINT "mill_assistance_sessions_primary_device_id_fkey" FOREIGN KEY ("primary_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mill_assistance_sessions" ADD CONSTRAINT "mill_assistance_sessions_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mill_assistance_sessions" ADD CONSTRAINT "mill_assistance_sessions_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A payment / operation belongs to at most one assistance session.
ALTER TABLE "payments" ADD COLUMN "assistance_session_id" TEXT;
CREATE INDEX "payments_assistance_session_id_idx" ON "payments"("assistance_session_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_assistance_session_id_fkey" FOREIGN KEY ("assistance_session_id") REFERENCES "mill_assistance_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pressing_records" ADD COLUMN "assistance_session_id" TEXT;
ALTER TABLE "pressing_records" ADD CONSTRAINT "pressing_records_assistance_session_id_fkey" FOREIGN KEY ("assistance_session_id") REFERENCES "mill_assistance_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
