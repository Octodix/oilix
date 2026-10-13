import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  LogPrintJobDto,
  PrintJobQueryDto,
  UpdateDevicePrintSettingsDto,
} from './dto/printing.dto';
import { PrintingService } from './printing.service';

const DEVICE_VIEW = [
  Permission.OIL_SALES_DEVICES_VIEW,
  Permission.MILL_DEVICES_VIEW,
  Permission.OIL_SALES_DEVICES_MANAGE,
  Permission.MILL_DEVICES_MANAGE,
] as const;

@ApiTags('الطباعة')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('printing')
export class PrintingController {
  constructor(private printing: PrintingService) {}

  /** Settings of the requesting workstation — any signed-in user printing from it. */
  @Get('settings/me')
  mySettings() {
    return this.printing.forCurrentDevice();
  }

  @Get('settings/:deviceId')
  @RequireAnyPermissions(...DEVICE_VIEW)
  deviceSettings(@Param('deviceId', ParseUUIDPipe) deviceId: string) {
    return this.printing.forDevice(deviceId);
  }

  @Put('settings/:deviceId')
  @RequireAnyPermissions(
    Permission.OIL_SALES_DEVICES_MANAGE,
    Permission.MILL_DEVICES_MANAGE,
  )
  updateDeviceSettings(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: UpdateDevicePrintSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.printing.updateForDevice(deviceId, dto, user.sub);
  }

  @Post('jobs')
  logJob(@Body() dto: LogPrintJobDto, @CurrentUser() user: JwtPayload) {
    return this.printing.logJob(dto, user);
  }

  @Get('jobs')
  @RequireAnyPermissions(...DEVICE_VIEW)
  listJobs(@Query() query: PrintJobQueryDto) {
    return this.printing.listJobs(query);
  }
}
