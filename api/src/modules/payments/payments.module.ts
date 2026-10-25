import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MillAssistanceModule } from '../mill-assistance/mill-assistance.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuditModule, MillAssistanceModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
