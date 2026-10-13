import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrintingController } from './printing.controller';
import { PrintingService } from './printing.service';

@Module({
  imports: [AuditModule],
  controllers: [PrintingController],
  providers: [PrintingService],
})
export class PrintingModule {}
