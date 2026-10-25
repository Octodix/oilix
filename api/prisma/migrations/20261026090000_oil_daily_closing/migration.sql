-- Daily oil stock closing (الجرد اليومي للزيت). Additive only: no existing row is changed.
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'OIL_SALES_INVENTORY_REOPEN';

CREATE TYPE "OilDailyClosingStatus" AS ENUM ('CONFIRMED', 'REOPENED');

CREATE TABLE "oil_daily_closings" (
    "id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "oil_source" "OilSource" NOT NULL,
    "oil_type" "OilType" NOT NULL,
    "status" "OilDailyClosingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "opening_source" TEXT NOT NULL,
    "opening_qty" DECIMAL(14,2) NOT NULL,
    "added_qty" DECIMAL(14,2) NOT NULL,
    "other_in_qty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_out_qty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sold_qty" DECIMAL(14,2) NOT NULL,
    "returned_qty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "available_qty" DECIMAL(14,2) NOT NULL,
    "expected_qty" DECIMAL(14,2) NOT NULL,
    "actual_qty" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by_id" TEXT NOT NULL,
    "confirmed_by_name" TEXT,
    "device_id" TEXT,
    "device_name" TEXT,
    "reopened_at" TIMESTAMP(3),
    "reopened_by_id" TEXT,
    "reopen_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oil_daily_closings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "oil_daily_closings_season_id_business_date_idx" ON "oil_daily_closings"("season_id", "business_date");
CREATE INDEX "oil_daily_closings_season_id_oil_source_oil_type_business_date_idx" ON "oil_daily_closings"("season_id", "oil_source", "oil_type", "business_date");
-- Exactly one CONFIRMED closing per day and oil: a repeated confirmation can never post twice.
CREATE UNIQUE INDEX "oil_daily_closings_one_confirmed" ON "oil_daily_closings"("season_id", "business_date", "oil_source", "oil_type") WHERE "status" = 'CONFIRMED';

ALTER TABLE "oil_daily_closings" ADD CONSTRAINT "oil_daily_closings_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oil_daily_closings" ADD CONSTRAINT "oil_daily_closings_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oil_daily_closings" ADD CONSTRAINT "oil_daily_closings_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oil_daily_closings" ADD CONSTRAINT "oil_daily_closings_reopened_by_id_fkey" FOREIGN KEY ("reopened_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "oil_stock_movements" ADD COLUMN "daily_closing_id" TEXT;
CREATE INDEX "oil_stock_movements_daily_closing_id_idx" ON "oil_stock_movements"("daily_closing_id");
ALTER TABLE "oil_stock_movements" ADD CONSTRAINT "oil_stock_movements_daily_closing_id_fkey" FOREIGN KEY ("daily_closing_id") REFERENCES "oil_daily_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
