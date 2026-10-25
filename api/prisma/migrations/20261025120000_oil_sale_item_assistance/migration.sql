-- Assistance per sale line: each oil line carries its own per-litre rate and fixed amount.
-- Sale-level columns stay for legacy sales and as aggregated totals.
ALTER TABLE "oil_sale_items"
  ADD COLUMN "assistance_per_litre" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "assistance_fixed" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "line_assistance" DECIMAL(14,2) NOT NULL DEFAULT 0;
