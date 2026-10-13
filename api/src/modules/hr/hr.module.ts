import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { HrAdmsController } from './hr-adms.controller';
import { HrAttendanceController } from './hr-attendance.controller';
import { HrAttendanceService } from './hr-attendance.service';
import { HrCoreController } from './hr-core.controller';
import { HrDeviceMonitorService } from './hr-device-monitor.service';
import { HrDevicesService } from './hr-devices.service';
import { HrEmployeesService } from './hr-employees.service';
import { HrIngestService } from './hr-ingest.service';
import { HrLeaveController } from './hr-leave.controller';
import { HrLeaveService } from './hr-leave.service';
import { HrLocksService } from './hr-locks.service';
import { HrPayItemsService } from './hr-pay-items.service';
import { HrPayrollController } from './hr-payroll.controller';
import { HrPayrollService } from './hr-payroll.service';
import { HrReportsService } from './hr-reports.service';
import { HrSchedulesService } from './hr-schedules.service';
import { HrSettingsService } from './hr-settings.service';

@Module({
  imports: [AuditModule, SettingsModule],
  controllers: [HrCoreController, HrAttendanceController, HrLeaveController, HrPayrollController, HrAdmsController],
  providers: [
    HrSettingsService,
    HrLocksService,
    HrSchedulesService,
    HrAttendanceService,
    HrIngestService,
    HrDevicesService,
    HrDeviceMonitorService,
    HrEmployeesService,
    HrLeaveService,
    HrPayItemsService,
    HrPayrollService,
    HrReportsService,
  ],
})
export class HrModule {}
