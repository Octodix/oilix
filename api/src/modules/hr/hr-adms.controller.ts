import { Body, Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { HrDevicesService } from './hr-devices.service';
import { HrIngestService } from './hr-ingest.service';
import { HrSettingsService } from './hr-settings.service';
import {
  admsHandshakeResponse,
  admsIsLegacyFirmware,
  admsTable,
  ADMS_ROUTES,
  bodyAsText,
  nonEmptyLineCount,
  normaliseSerial,
} from './zkteco/adms-protocol';
import { parseAttendanceText, ZK_ATTLOG_COLUMNS } from './zkteco/attlog-parser';

type AdmsQuery = Record<string, string | undefined>;

/**
 * ZKTeco ADMS push endpoint (outside /api/v1, no JWT: the terminal cannot log in).
 * A terminal is accepted only if its serial number is registered, enabled and set to ADMS;
 * otherwise it gets 403 and keeps its records in memory.
 */
@Public()
@ApiExcludeController()
@Controller()
export class HrAdmsController {
  private readonly logger = new Logger(HrAdmsController.name);

  constructor(
    private devices: HrDevicesService,
    private ingest: HrIngestService,
    private hrSettings: HrSettingsService,
  ) {}

  private send(res: Response, status: number, text: string) {
    res.status(status).type('text/plain').send(text);
  }

  private meta(req: Request): Record<string, string> {
    return {
      remoteAddress: String(req.ip ?? req.socket?.remoteAddress ?? ''),
      path: req.path,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
    };
  }

  private async accepted(q: AdmsQuery, req: Request, res: Response) {
    const serial = normaliseSerial(q.SN);
    if (!serial) {
      this.send(res, 400, 'ERROR: SN');
      return null;
    }
    const device = await this.devices.admsDevice(serial);
    const reason = !device
      ? 'جهاز غير مسجل في Oilix'
      : !device.isEnabled
        ? 'الجهاز معطل في Oilix'
        : device.provider !== 'ZKTECO_ADMS'
          ? `الجهاز مسجل بطريقة ${device.provider} وليس ADMS`
          : null;
    if (reason) {
      await this.devices.admsReject(serial, reason, this.meta(req));
      this.send(res, 403, 'ERROR: UNKNOWN DEVICE');
      return null;
    }
    return device!;
  }

  @Get(ADMS_ROUTES.cdata as unknown as string[])
  async handshake(@Query() q: AdmsQuery, @Req() req: Request, @Res() res: Response) {
    const device = await this.accepted(q, req, res);
    if (!device) return;
    const settings = await this.hrSettings.get();
    const info: Record<string, string> = { protocol: 'ADMS', ...this.meta(req) };
    for (const k of ['pushver', 'language', 'options', 'DeviceType', 'PushOptionsFlag']) {
      if (q[k]) info[k] = String(q[k]).slice(0, 100);
    }
    await this.devices.admsTouch(device.id, info);
    if (q.options !== undefined) {
      this.send(
        res,
        200,
        admsHandshakeResponse({
          serialNumber: device.serialNumber!,
          attlogStamp: device.lastLogStamp,
          delaySeconds: settings.devices.admsDelaySeconds,
          transIntervalMinutes: settings.devices.admsTransIntervalMinutes,
          timezoneHours: Math.round(device.timezoneOffsetMinutes / 60),
          legacy: admsIsLegacyFirmware(q),
        }),
      );
      return;
    }
    this.send(res, 200, 'OK');
  }

  @Post(ADMS_ROUTES.cdata as unknown as string[])
  async upload(@Query() q: AdmsQuery, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const device = await this.accepted(q, req, res);
    if (!device) return;
    const table = admsTable(q.table);
    const text = bodyAsText(body);
    const lines = nonEmptyLineCount(text);

    if (table !== 'ATTLOG') {
      // Operation logs, user records, fingerprint/face templates and photos are never stored.
      await this.devices.admsTouch(device.id);
      this.send(res, 200, `OK: ${lines}`);
      return;
    }

    const parsed = parseAttendanceText(text, { ...ZK_ATTLOG_COLUMNS, delimiter: 'tab' }, device.timezoneOffsetMinutes);
    try {
      await this.ingest.ingest(device, parsed.records, {
        source: 'ADMS_PUSH',
        trigger: 'PUSH',
        invalidCount: parsed.invalid.length,
        details: {
          stamp: q.Stamp ?? null,
          lines,
          invalidSample: parsed.invalid.slice(0, 10),
        },
      });
      if (q.Stamp && /^\d+$/.test(q.Stamp)) await this.devices.admsSetStamp(device.id, q.Stamp);
      this.send(res, 200, `OK: ${lines}`);
    } catch (e) {
      this.logger.error(`ADMS ATTLOG ingest failed for ${device.serialNumber}: ${(e as Error).message}`);
      // Non-OK reply ⇒ the terminal keeps the records and retries.
      this.send(res, 500, 'ERROR');
    }
  }

  @Get(ADMS_ROUTES.getrequest as unknown as string[])
  async poll(@Query() q: AdmsQuery, @Req() req: Request, @Res() res: Response) {
    const device = await this.accepted(q, req, res);
    if (!device) return;
    await this.devices.admsTouch(device.id);
    this.send(res, 200, 'OK');
  }

  @Post(ADMS_ROUTES.devicecmd as unknown as string[])
  async commandResult(@Query() q: AdmsQuery, @Req() req: Request, @Res() res: Response) {
    const device = await this.accepted(q, req, res);
    if (!device) return;
    this.send(res, 200, 'OK');
  }
}
