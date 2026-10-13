-- Snapshot operator names on sales/payments + day-report print log

ALTER TABLE "oil_sales"
  ADD COLUMN IF NOT EXISTS "created_by_name" TEXT,
  ADD COLUMN IF NOT EXISTS "created_by_username" TEXT;

ALTER TABLE "oil_sale_payments"
  ADD COLUMN IF NOT EXISTS "user_name" TEXT,
  ADD COLUMN IF NOT EXISTS "user_username" TEXT;

UPDATE "oil_sales" s
SET
  "created_by_name" = NULLIF(TRIM(CONCAT(COALESCE(u."first_name", ''), ' ', COALESCE(u."last_name", ''))), ''),
  "created_by_username" = u."username"
FROM "users" u
WHERE u."id" = s."created_by_id"
  AND s."created_by_name" IS NULL;

UPDATE "oil_sales" s
SET "created_by_name" = COALESCE(s."created_by_name", s."created_by_username")
WHERE s."created_by_name" IS NULL AND s."created_by_username" IS NOT NULL;

UPDATE "oil_sale_payments" p
SET
  "user_name" = NULLIF(TRIM(CONCAT(COALESCE(u."first_name", ''), ' ', COALESCE(u."last_name", ''))), ''),
  "user_username" = u."username"
FROM "users" u
WHERE u."id" = p."user_id"
  AND p."user_name" IS NULL;

UPDATE "oil_sale_payments" p
SET "user_name" = COALESCE(p."user_name", p."user_username")
WHERE p."user_name" IS NULL AND p."user_username" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "oil_day_report_prints" (
  "id" TEXT NOT NULL,
  "season_id" TEXT NOT NULL,
  "from_date" DATE NOT NULL,
  "to_date" DATE NOT NULL,
  "cash_register_id" TEXT NOT NULL,
  "cash_register_code" TEXT NOT NULL,
  "cash_register_name" TEXT NOT NULL,
  "generated_by_id" TEXT NOT NULL,
  "generated_by_name" TEXT NOT NULL,
  "device_id" TEXT,
  "device_code" TEXT,
  "device_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oil_day_report_prints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "oil_day_report_prints_season_id_cash_register_id_from_date_idx"
  ON "oil_day_report_prints"("season_id", "cash_register_id", "from_date");
CREATE INDEX IF NOT EXISTS "oil_day_report_prints_generated_by_id_idx"
  ON "oil_day_report_prints"("generated_by_id");
CREATE INDEX IF NOT EXISTS "oil_day_report_prints_device_id_idx"
  ON "oil_day_report_prints"("device_id");

DO $$ BEGIN
  ALTER TABLE "oil_day_report_prints"
    ADD CONSTRAINT "oil_day_report_prints_season_id_fkey"
    FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "oil_day_report_prints"
    ADD CONSTRAINT "oil_day_report_prints_cash_register_id_fkey"
    FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "oil_day_report_prints"
    ADD CONSTRAINT "oil_day_report_prints_generated_by_id_fkey"
    FOREIGN KEY ("generated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "oil_day_report_prints"
    ADD CONSTRAINT "oil_day_report_prints_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
