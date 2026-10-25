import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OilSalesController } from './oil-sales.controller';
import { OilSalesService } from './oil-sales.service';
import { CashRegisterService } from './cash-register.service';
import { OilSalesDebtService } from './oil-sales-debt.service';
import { OilDailyStockService } from './oil-daily-stock.service';

@Module({
  imports: [AuditModule],
  controllers: [OilSalesController],
  providers: [OilSalesService, CashRegisterService, OilSalesDebtService, OilDailyStockService],
  exports: [OilSalesService, CashRegisterService, OilSalesDebtService, OilDailyStockService],
})
export class OilSalesModule {}
