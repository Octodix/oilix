import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  CorrectionDto,
  CorrectionQueryDto,
  CreateDeviceDto,
  DaysQueryDto,
  DiagnoseDto,
  EventsQueryDto,
  ImportFileDto,
  JustifyLateDto,
  MappingDto,
  ReasonDto,
  ReprocessDto,
  SyncLogQueryDto,
  UpdateDeviceDto,
  YearMonthQueryDto,
} from './dto/hr.dto';
import { HrAttendanceService } from './hr-attendance.service';
import { actorOf } from './hr-common';
import { HrDevicesService } from './hr-devices.service';

const P = Permission;

@ApiTags('hr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr')
export class HrAttendanceController {
  constructor(
    private audit: AuditService,
    private attendance: HrAttendanceService,
    private devices: HrDevicesService,
  ) {}

  // ── Attendance ───────────────────────────────────────────────────────────

  @Get('attendance/live')
  @RequirePermissions(P.HR_ATTENDANCE_VIEW)
  live() {
    return this.attendance.live();
  }

  @Get('attendance/days')
  @RequirePermissions(P.HR_ATTENDANCE_VIEW)
  days(@Query() q: DaysQueryDto) {
    return this.attendance.listDays(q);
  }

  @Get('attendance/events')
  @RequirePermissions(P.HR_ATTENDANCE_VIEW)
  events(@Query() q: EventsQueryDto) {
    return this.attendance.listEvents(q);
  }

  @Get('attendance/calendar')
  @RequirePermissions(P.HR_ATTENDANCE_VIEW)
  calendar(@Query() q: YearMonthQueryDto) {
    return this.attendance.calendar(q);
  }

  @Post('attendance/reprocess')
  @RequirePermissions(P.HR_ATTENDANCE_CORRECT)
  async reprocess(@Body() dto: ReprocessDto, @CurrentUser() user: JwtPayload) {
    return this.attendance.reprocess(dto, await actorOf(this.audit, user));
  }

  @Get('attendance/corrections')
  @RequirePermissions(P.HR_ATTENDANCE_VIEW)
  corrections(@Query() q: CorrectionQueryDto) {
    return this.attendance.listCorrections(q);
  }

  @Post('attendance/corrections')
  @RequirePermissions(P.HR_ATTENDANCE_CORRECT)
  async createCorrection(@Body() dto: CorrectionDto, @CurrentUser() user: JwtPayload) {
    return this.attendance.createCorrection(dto, await actorOf(this.audit, user));
  }

  @Post('attendance/corrections/:id/revoke')
  @RequirePermissions(P.HR_ATTENDANCE_CORRECT)
  async revokeCorrection(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: JwtPayload) {
    return this.attendance.revokeCorrection(id, dto.reason, await actorOf(this.audit, user));
  }

  @Post('attendance/days/:id/justify-late')
  @RequirePermissions(P.HR_ATTENDANCE_CORRECT)
  async justifyLate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: JustifyLateDto, @CurrentUser() user: JwtPayload) {
    return this.attendance.justifyLate(id, dto, await actorOf(this.audit, user));
  }

  // ── Devices ──────────────────────────────────────────────────────────────

  @Get('devices/providers')
  @RequirePermissions(P.HR_DEVICES_VIEW)
  providers() {
    return this.devices.providers();
  }

  @Get('devices/sync-logs')
  @RequirePermissions(P.HR_DEVICES_VIEW)
  syncLogs(@Query() q: SyncLogQueryDto) {
    return this.devices.syncLogs(q);
  }

  @Post('devices/diagnose')
  @RequirePermissions(P.HR_DEVICES_MANAGE)
  async diagnose(@Body() dto: DiagnoseDto, @CurrentUser() user: JwtPayload) {
    return this.devices.diagnose(dto, await actorOf(this.audit, user));
  }

  @Delete('devices/mappings/:id')
  @RequirePermissions(P.HR_DEVICES_MANAGE)
  async deleteMapping(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.devices.deleteMapping(id, await actorOf(this.audit, user));
  }

  @Get('devices')
  @RequirePermissions(P.HR_DEVICES_VIEW)
  list() {
    return this.devices.list();
  }

  @Get('devices/:id')
  @RequirePermissions(P.HR_DEVICES_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.getPresented(id);
  }

  @Post('devices')
  @RequirePermissions(P.HR_DEVICES_MANAGE)
  async create(@Body() dto: CreateDeviceDto, @CurrentUser() user: JwtPayload) {
    return this.devices.create(dto, await actorOf(this.audit, user));
  }

  @Patch('devices/:id')
  @RequirePermissions(P.HR_DEVICES_MANAGE)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeviceDto, @CurrentUser() user: JwtPayload) {
    return this.devices.update(id, dto, await actorOf(this.audit, user));
  }

  @Delete('devices/:id')
  @RequirePermissions(P.HR_DEVICES_MANAGE)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.devices.remove(id, await actorOf(this.audit, user));
  }

  @Post('devices/:id/test')
  @RequirePermissions(P.HR_DEVICES_SYNC)
  async test(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.devices.testConnection(id, await actorOf(this.audit, user));
  }

  @Post('devices/:id/sync')
  @RequirePermissions(P.HR_DEVICES_SYNC)
  async sync(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.devices.syncNow(id, await actorOf(this.audit, user));
  }

  @Post('devices/:id/import')
  @RequirePermissions(P.HR_DEVICES_SYNC)
  async importFile(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ImportFileDto, @CurrentUser() user: JwtPayload) {
    return this.devices.importFile(id, dto, await actorOf(this.audit, user));
  }

  @Get('devices/:id/unmapped')
  @RequirePermissions(P.HR_DEVICES_VIEW)
  unmapped(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.unmappedUsers(id);
  }

  @Get('devices/:id/mappings')
  @RequirePermissions(P.HR_DEVICES_VIEW)
  mappings(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.mappings(id);
  }

  @Post('devices/:id/mappings')
  @RequirePermissions(P.HR_DEVICES_MANAGE)
  async createMapping(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MappingDto, @CurrentUser() user: JwtPayload) {
    return this.devices.createMapping(id, dto, await actorOf(this.audit, user));
  }
}
