-- Walk-in counter sales: a sale may have no customer (never with debt).
ALTER TABLE "oil_sales" ALTER COLUMN "customer_id" DROP NOT NULL;

-- Waiting / held sales: drafts only, no stock, cash or ledger effects.
CREATE TABLE "oil_sale_holds" (
    "id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "hold_number" INTEGER NOT NULL,
    "customer_id" TEXT,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "payload" JSONB NOT NULL,
    "price_locks" JSONB NOT NULL,
    "item_count" INTEGER NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT,
    "device_id" TEXT,
    "device_name" TEXT,
    "cash_register_id" TEXT,
    "cash_register_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oil_sale_holds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oil_sale_holds_season_id_hold_number_key" ON "oil_sale_holds"("season_id", "hold_number");
CREATE INDEX "oil_sale_holds_season_id_cash_register_id_idx" ON "oil_sale_holds"("season_id", "cash_register_id");
CREATE INDEX "oil_sale_holds_season_id_created_by_id_idx" ON "oil_sale_holds"("season_id", "created_by_id");
