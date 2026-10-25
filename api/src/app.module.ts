import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './modules/clients/clients.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { OliveEntriesModule } from './modules/olive-entries/olive-entries.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PressingModule } from './modules/pressing/pressing.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MobileModule } from './modules/mobile/mobile.module';
import { FiltrationModule } from './modules/filtration/filtration.module';
import { OilSalesModule } from './modules/oil-sales/oil-sales.module';
import { DevicesModule } from './modules/devices/devices.module';
import { DeviceInterceptor } from './modules/devices/device.interceptor';
import { PrintingModule } from './modules/printing/printing.module';
import { SeasonModule } from './common/season/season.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { HealthModule } from './modules/health/health.module';
import { HrModule } from './modules/hr/hr.module';
import { MillAssistanceModule } from './modules/mill-assistance/mill-assistance.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SeasonModule,
    RealtimeModule,
    HealthModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    OliveEntriesModule,
    PressingModule,
    FiltrationModule,
    DevicesModule,
    OilSalesModule,
    PrintingModule,
    PaymentsModule,
    SettingsModule,
    ReportsModule,
    DashboardModule,
    NotificationsModule,
    MobileModule,
    HrModule,
    MillAssistanceModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: DeviceInterceptor },
  ],
})
export class AppModule {}
