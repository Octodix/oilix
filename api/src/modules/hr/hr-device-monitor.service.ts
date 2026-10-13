import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HrDevicesService } from './hr-devices.service';
import { HrSettingsService } from './hr-settings.service';

/** Marks push terminals offline when they stop calling in (single API instance under PM2). */
@Injectable()
export class HrDeviceMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HrDeviceMonitorService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private devices: HrDevicesService,
    private hrSettings: HrSettingsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    try {
      const settings = await this.hrSettings.get();
      const r = await this.devices.markStaleDevicesOffline(settings.devices.offlineAfterMinutes);
      if (r.count) this.logger.warn(`${r.count} attendance terminal(s) marked offline`);
    } catch (e) {
      this.logger.error(`Device monitor failed: ${(e as Error).message}`);
    }
  }
}
