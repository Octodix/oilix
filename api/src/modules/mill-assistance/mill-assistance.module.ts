import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MillAssistanceController } from './mill-assistance.controller';
import { MillAssistanceService } from './mill-assistance.service';

/** Operator-assistance sessions and cash handover for the olive press workspace. */
@Module({
  imports: [AuditModule],
  controllers: [MillAssistanceController],
  providers: [MillAssistanceService],
  exports: [MillAssistanceService],
})
export class MillAssistanceModule {}
