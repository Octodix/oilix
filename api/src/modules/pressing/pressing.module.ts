import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { MillAssistanceModule } from '../mill-assistance/mill-assistance.module';
import { PressingController } from './pressing.controller';
import { PressingService } from './pressing.service';

@Module({
  imports: [AuditModule, SettingsModule, NotificationsModule, MillAssistanceModule],
  controllers: [PressingController],
  providers: [PressingService],
  exports: [PressingService],
})
export class PressingModule {}
