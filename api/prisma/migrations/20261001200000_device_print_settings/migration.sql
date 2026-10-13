-- Per-device printer configuration (direct / silent printing via the local Oilix Print Agent).
CREATE TABLE "device_print_settings" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "direct_printing" BOOLEAN NOT NULL DEFAULT false,
    "browser_fallback" BOOLEAN NOT NULL DEFAULT true,
    "auto_print_after_sale" BOOLEAN NOT NULL DEFAULT false,
    "receipt_printer" TEXT,
    "receipt_paper_width" INTEGER NOT NULL DEFAULT 80,
    "receipt_direct" BOOLEAN NOT NULL DEFAULT true,
    "receipt_copies" INTEGER NOT NULL DEFAULT 1,
    "document_printer" TEXT,
    "document_paper_format" TEXT NOT NULL DEFAULT 'A4',
    "document_orientation" TEXT NOT NULL DEFAULT 'PORTRAIT',
    "document_copies" INTEGER NOT NULL DEFAULT 1,
    "day_report_target" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_print_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_print_settings_device_id_key" ON "device_print_settings"("device_id");

ALTER TABLE "device_print_settings" ADD CONSTRAINT "device_print_settings_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Print submissions audit (submitted ≠ physically printed).
CREATE TABLE "print_job_logs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_ref" TEXT,
    "copy_label" TEXT,
    "is_reprint" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "printer_name" TEXT,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT,
    "device_id" TEXT,
    "device_code" TEXT,
    "device_name" TEXT,
    "cash_register_id" TEXT,
    "cash_register_name" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_job_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "print_job_logs_job_id_key" ON "print_job_logs"("job_id");
CREATE INDEX "print_job_logs_device_id_requested_at_idx" ON "print_job_logs"("device_id", "requested_at");
CREATE INDEX "print_job_logs_document_type_document_ref_idx" ON "print_job_logs"("document_type", "document_ref");
CREATE INDEX "print_job_logs_user_id_idx" ON "print_job_logs"("user_id");
